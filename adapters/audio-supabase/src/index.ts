import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { AUDIO_CONTENT_TYPES, type AudioContentType, type AudioDeletionEvidence, type AudioObjectMetadata, type AudioStore, type SecretStore } from '@ccc/contracts/runtime';
import { AudioStoreError, checkedTransfer, MAX_AUDIO_BYTES, type CheckedTransfer } from './stream';

export { AudioStoreError } from './stream';
export interface SupabaseAudioStoreConfig {
  origin: string;
  bucket: string;
  secretStore: SecretStore;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

const AUDIO_KEY = /^audio\/[A-Za-z0-9_-]{1,128}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LENGTH = 'ccc-content-length';
const TYPE = 'ccc-content-type';
const EXPIRY = 'ccc-expires-at';
const ATTEMPT = 'ccc-upload-attempt';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function assertKey(key: string): void {
  if (typeof key !== 'string' || !AUDIO_KEY.test(key)) throw new AudioStoreError();
}
function validMetadata(value: AudioObjectMetadata): boolean {
  return Number.isSafeInteger(value.contentLength) && value.contentLength > 0 && value.contentLength <= MAX_AUDIO_BYTES
    && Object.hasOwn(AUDIO_CONTENT_TYPES, value.contentType)
    && typeof value.expiresAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value.expiresAt)
    && Number.isFinite(Date.parse(value.expiresAt));
}
async function discard(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}
async function smallJson(response: Response): Promise<unknown> {
  if (response.body === null) throw new AudioStoreError();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 65_536) throw new AudioStoreError();
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new AudioStoreError();
  } finally { reader.releaseLock(); }
}

/** Private Storage REST adapter. Targets and credentials come only from server installation state. */
export function createSupabaseAudioStore(config: SupabaseAudioStoreConfig): AudioStore {
  const { origin, bucket, secretStore } = config;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.protocol !== 'https:' || url.port !== ''
      || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)
      || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucket)) throw new AudioStoreError();
  } catch { throw new AudioStoreError(); }
  const base = `${origin}/storage/v1`;
  const fetcher = config.fetch ?? globalThis.fetch;
  const now = config.now ?? Date.now;

  async function call(path: string, init: RequestInit & { duplex?: 'half' } = {}): Promise<Response> {
    try {
      const secret = await secretStore.get('SUPABASE_SERVICE_ROLE_KEY');
      if (secret === null || secret.length === 0 || /[\s\u0000-\u001f\u007f]/.test(secret)) throw new AudioStoreError();
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${secret}`);
      headers.set('apikey', secret);
      const target = `${base}${path}`;
      const response = await fetcher(target, { ...init, headers, redirect: 'error', credentials: 'omit', cache: 'no-store',
        signal: init.signal ?? AbortSignal.timeout(30_000) });
      if (response.redirected || (response.status >= 300 && response.status < 400)
        || (response.url !== '' && response.url !== target)) {
        await discard(response);
        throw new AudioStoreError();
      }
      return response;
    } catch { throw new AudioStoreError(); }
  }

  async function privateBucket(): Promise<void> {
    const response = await call(`/bucket/${bucket}`);
    if (response.status !== 200) { await discard(response); throw new AudioStoreError(); }
    const data = await smallJson(response);
    if (!record(data) || data.id !== bucket || data.public !== false) throw new AudioStoreError();
  }

  async function info(key: string): Promise<Record<string, unknown> | null> {
    const response = await call(`/object/info/authenticated/${bucket}/${key}`);
    if (response.status === 404) { await discard(response); return null; }
    if (response.status !== 200) { await discard(response); throw new AudioStoreError(); }
    const data = await smallJson(response);
    if (!record(data) || data.name !== key || data.bucket_id !== bucket) throw new AudioStoreError();
    return data;
  }

  async function remove(prefix: string | { path: string; versionId: string }): Promise<boolean> {
    const response = await call(`/object/${bucket}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: [prefix] }) });
    if (response.status !== 200) { await discard(response); return false; }
    return Array.isArray(await smallJson(response));
  }

  async function cleanupUpload(key: string, attempt: string): Promise<void> {
    // A failed POST can be a collision or an ambiguous network result. Never delete
    // another writer's object. Version targeting also fences replacement after this read.
    try {
      const object = await info(key);
      if (object !== null && record(object.metadata) && object.metadata[ATTEMPT] === attempt
        && typeof object.version === 'string' && UUID.test(object.version)) {
        await remove({ path: key, versionId: object.version });
      }
    } catch {
      // Cleanup is best effort; put always rejects its original operation, even here.
    }
  }

  return {
    async put(key, body, metadata) {
      const abort = new AbortController();
      let transfer: CheckedTransfer | undefined;
      let attempted = false;
      const attempt = crypto.randomUUID();
      const hash = sha256.create();
      try {
        assertKey(key);
        if (!validMetadata(metadata) || Date.parse(metadata.expiresAt) <= now()) throw new AudioStoreError();
        await privateBucket();
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(900_000)]);
        transfer = checkedTransfer(body, metadata.contentLength, Date.parse(metadata.expiresAt), now, signal, chunk => { hash.update(chunk); });
        attempted = true;
        const response = await call(`/object/${bucket}/${key}`, {
          method: 'POST', body: transfer.body, duplex: 'half', signal,
          headers: { 'Content-Type': metadata.contentType, 'Content-Length': String(metadata.contentLength),
            'Cache-Control': 'max-age=0', 'x-upsert': 'false',
            'x-metadata': btoa(JSON.stringify({ [LENGTH]: metadata.contentLength, [TYPE]: metadata.contentType,
              [EXPIRY]: metadata.expiresAt, [ATTEMPT]: attempt })) },
        });
        if (response.status !== 200 && response.status !== 201) { await discard(response); throw new AudioStoreError(); }
        const result = await smallJson(response);
        if (!record(result) || result.Key !== `${bucket}/${key}` || !await transfer.done) throw new AudioStoreError();
        return { sha256: bytesToHex(hash.digest()) };
      } catch {
        abort.abort(new AudioStoreError());
        if (transfer !== undefined) {
          await transfer.body.cancel().catch(() => undefined);
          await transfer.done;
        } else {
          await body.cancel().catch(() => undefined);
        }
        if (attempted) await cleanupUpload(key, attempt);
        throw new AudioStoreError();
      } finally { hash.destroy(); }
    },

    async get(key) {
      assertKey(key);
      await privateBucket();
      const object = await info(key);
      if (object === null) return null;
      const custom = object.metadata;
      if (!record(custom) || typeof custom[LENGTH] !== 'number' || typeof custom[TYPE] !== 'string'
        || typeof custom[EXPIRY] !== 'string' || typeof object.version !== 'string' || !UUID.test(object.version)) throw new AudioStoreError();
      const metadata: AudioObjectMetadata = { contentLength: custom[LENGTH], contentType: custom[TYPE] as AudioContentType, expiresAt: custom[EXPIRY] };
      if (!validMetadata(metadata) || object.size !== metadata.contentLength || object.content_type !== metadata.contentType
        || Date.parse(metadata.expiresAt) <= now()) throw new AudioStoreError();
      const signal = AbortSignal.timeout(900_000);
      const response = await call(`/object/authenticated/${bucket}/${key}?versionId=${object.version}`, { signal });
      if (response.status === 404) { await discard(response); return null; }
      const length = response.headers.get('Content-Length');
      const encoding = response.headers.get('Content-Encoding');
      if (response.status !== 200 || response.body === null
        || response.headers.get('Content-Type')?.split(';')[0]?.trim().toLowerCase() !== metadata.contentType
        || (encoding !== null && encoding !== 'identity')
        || (length !== null && (!/^\d+$/.test(length) || Number(length) !== metadata.contentLength))
        || Date.parse(metadata.expiresAt) <= now()) {
        await discard(response);
        throw new AudioStoreError();
      }
      const transfer = checkedTransfer(response.body, metadata.contentLength, Date.parse(metadata.expiresAt), now, signal);
      return { ...metadata, body: transfer.body, sha256: null };
    },

    async delete(key) {
      assertKey(key);
      const requestedAt = new Date(now()).toISOString();
      const evidence: AudioDeletionEvidence = {
        keyHash: bytesToHex(sha256(new TextEncoder().encode(key))), generationId: null, objectSha256: null,
        deletionAttemptId: crypto.randomUUID(), deletionRequestedAt: requestedAt,
        providerDeleteAcceptedAt: null, deletedAt: null, deleteSucceeded: false,
        absentFromList: false, absentFromMetadata: false, directReadAbsent: false,
        verificationMethod: 'authenticated-get-404', verifiedAt: requestedAt,
      };
      try {
        const object = await info(key);
        if (object !== null && typeof object.version === 'string' && UUID.test(object.version)) evidence.generationId = object.version;
      } catch { /* Pre-delete metadata failure never blocks the deletion attempt. */ }
      try {
        evidence.deleteSucceeded = await remove(evidence.generationId === null
          ? key : { path: key, versionId: evidence.generationId });
        if (evidence.deleteSucceeded) evidence.providerDeleteAcceptedAt = new Date(now()).toISOString();
      } catch { /* Acceptance remains false; all absence observations are still attempted. */ }
      const separator = key.lastIndexOf('/');
      const name = key.slice(separator + 1);
      try {
        const response = await call(`/object/list/${bucket}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prefix: key.slice(0, separator), search: name, limit: 1000, offset: 0, sortBy: { column: 'name', order: 'asc' } }) });
        if (response.status === 200) {
          const rows = await smallJson(response);
          // A full/truncated page is inconclusive, never proof of absence.
          evidence.absentFromList = Array.isArray(rows) && rows.length < 1000
            && rows.every(row => record(row) && typeof row.name === 'string' && row.name !== name && row.name !== key);
        } else await discard(response);
      } catch { /* Independent list observation failed. */ }
      try {
        const response = await call(`/object/info/authenticated/${bucket}/${key}`);
        evidence.absentFromMetadata = response.status === 404;
        await discard(response);
      } catch { /* Independent metadata observation failed. */ }
      try {
        const versionQuery = evidence.generationId === null ? '' : `?versionId=${evidence.generationId}`;
        const response = await call(`/object/authenticated/${bucket}/${key}${versionQuery}`);
        evidence.providerStatus = response.status;
        evidence.directReadAbsent = response.status === 404;
        await discard(response);
      } catch { /* Independent authenticated direct read failed. */ }
      evidence.verifiedAt = new Date(now()).toISOString();
      if (evidence.deleteSucceeded && evidence.absentFromList && evidence.absentFromMetadata && evidence.directReadAbsent) {
        evidence.deletedAt = evidence.verifiedAt;
      }
      return evidence;
    },
    async createUploadTarget() { return null; },
    async createDownloadTarget() { return null; },
  };
}
