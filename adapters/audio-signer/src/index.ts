import type {
  AudioContentType,
  AudioDeletionEvidence,
  AudioDownload,
  AudioStore,
  AudioStoreBinding,
} from '@ccc/contracts/runtime';
import { AUDIO_CONTENT_TYPES } from '@ccc/contracts/runtime';
import { MAX_AUDIO_BYTES, hashKey, validKey, type StorageSignerRequest } from '@ccc/contracts/audio';

// The Signer spends up to 5s on the business-API callback and, for 'absence', up to three more
// 5s provider reads, so a shorter deadline would report a failure for work it actually finished.
const FETCH_TIMEOUT_MS = 25_000;
const MAX_URL_BYTES = 8_192;

/**
 * S11 §2.7·§2.8. Cloud 업무 API 는 원음 byte 도 provider 자격도 만지지 않는다. 이 어댑터는
 * 호출자의 Bearer 를 그대로 Signer 에 넘기고, Signer 가 같은 Bearer 로 업무 API 에 되물어
 * 권한을 판정한다. 그래서 모든 동작에는 호출 근거(binding)가 있어야 하고, 응답이 계약과
 * 조금이라도 다르면 허용 결과를 만들어내지 않고 예외를 던진다.
 */
export type SignerAudioStoreFailure = 'SIGNER_UNAVAILABLE' | 'SIGNER_DENIED' | 'SIGNER_INVALID';

export class SignerAudioStoreError extends Error {
  readonly code: SignerAudioStoreFailure;

  constructor(code: SignerAudioStoreFailure) {
    super(code);
    this.name = 'SignerAudioStoreError';
    this.code = code;
  }
}

export interface SignerAudioStoreConfig {
  signerUrl: string;
  authorization: string | null;
  installationId: string;
  fetch?: typeof fetch;
  now?: () => number;
}

type SignerAction = StorageSignerRequest['action'];

function fail(code: SignerAudioStoreFailure): never {
  throw new SignerAudioStoreError(code);
}

function requireBinding<K extends AudioStoreBinding['kind']>(
  binding: AudioStoreBinding | undefined,
  ...kinds: K[]
): Extract<AudioStoreBinding, { kind: K }> {
  if (binding === undefined || !kinds.some((kind) => kind === binding.kind)) fail('SIGNER_INVALID');
  return binding as Extract<AudioStoreBinding, { kind: K }>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

/** Canonical UTC instant or nothing; a provider string that reformats is not an instant. */
function exactIsoMillis(value: unknown): number {
  if (typeof value !== 'string') fail('SIGNER_INVALID');
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    fail('SIGNER_INVALID');
  }
  return milliseconds;
}

/** Canonical https target string, refused before it can reach a caller. */
function signedUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_URL_BYTES) fail('SIGNER_INVALID');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return fail('SIGNER_INVALID');
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') fail('SIGNER_INVALID');
  return value;
}

export function createSignerAudioStore(config: SignerAudioStoreConfig): AudioStore {
  const fetchImpl = config.fetch ?? globalThis.fetch;
  const now = config.now ?? Date.now;
  if (typeof fetchImpl !== 'function' || config.installationId.length === 0) {
    throw new Error('signer_audio_store_config_invalid');
  }

  async function call(
    action: SignerAction,
    key: string,
    binding: AudioStoreBinding,
  ): Promise<Record<string, unknown>> {
    if (config.authorization === null) fail('SIGNER_DENIED');
    if (!validKey(key)) fail('SIGNER_INVALID');
    const body: StorageSignerRequest = {
      bucket: 'ccc-audio',
      objectKey: key,
      action,
      principal: binding.kind === 'upload' ? 'client' : binding.kind === 'claim' ? 'agent' : 'scheduler',
      objectSha256: null,
      context: binding,
    };

    let response: Response;
    try {
      // No Origin: this is a server-to-server call and the Signer refuses browser-shaped requests.
      response = await fetchImpl(config.signerUrl, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          authorization: config.authorization,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
    } catch {
      return fail('SIGNER_UNAVAILABLE');
    }

    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      fail('SIGNER_DENIED');
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      fail('SIGNER_UNAVAILABLE');
    }
    // A right-shaped answer from the wrong installation is never a result.
    if (response.headers.get('x-ccc-installation-id') !== config.installationId) {
      await response.body?.cancel().catch(() => undefined);
      fail('SIGNER_INVALID');
    }

    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return fail('SIGNER_INVALID');
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) fail('SIGNER_INVALID');
    const data = parsed as Record<string, unknown>;
    if (data.action !== action) fail('SIGNER_INVALID');
    return data;
  }

  function target(data: Record<string, unknown>): {
    url: string;
    expiresAt: string;
    expiresAtMs: number;
  } {
    if (!exactKeys(data, ['action', 'url', 'expiresAt', 'generationId'])) fail('SIGNER_INVALID');
    if (typeof data.generationId !== 'string' || data.generationId.length === 0) fail('SIGNER_INVALID');
    const expiresAtMs = exactIsoMillis(data.expiresAt);
    if (expiresAtMs <= now()) fail('SIGNER_INVALID');
    return { url: signedUrl(data.url), expiresAt: data.expiresAt as string, expiresAtMs };
  }

  return {
    async put() {
      // S11 §2.8: the Cloud business runtime never receives audio bytes.
      throw new Error('audio_body_forbidden');
    },

    async get(key, binding) {
      const bound = requireBinding(binding, 'upload', 'deletion');
      const data = await call('head', key, bound);
      if (data.exists === false) {
        if (!exactKeys(data, ['action', 'exists', 'generationId'])) fail('SIGNER_INVALID');
        return null;
      }
      if (
        data.exists !== true
        || !exactKeys(data, [
          'action', 'exists', 'generationId', 'contentLength', 'contentType', 'etag', 'lastModified',
        ])
        || typeof data.generationId !== 'string'
        || data.generationId.length === 0
        || !Number.isSafeInteger(data.contentLength)
        || (data.contentLength as number) < 1
        || (data.contentLength as number) > MAX_AUDIO_BYTES
        || typeof data.contentType !== 'string'
        || !Object.hasOwn(AUDIO_CONTENT_TYPES, data.contentType)
      ) fail('SIGNER_INVALID');
      return {
        contentLength: data.contentLength as number,
        contentType: data.contentType as AudioContentType,
        // Signer head carries no retention instant and no stored hash, and never the bytes.
        expiresAt: null,
        sha256: null,
        generationId: data.generationId,
        // The Cloud runtime never proxies bytes, so the stream exists only to fail on first read.
        body: new ReadableStream<Uint8Array>({
          pull() {
            throw new Error('audio body is not proxied');
          },
        }),
      } satisfies AudioDownload;
    },

    async delete(key, binding) {
      const bound = requireBinding(binding, 'deletion');
      const deletionRequestedAt = new Date(now()).toISOString();
      const deleted = await call('delete', key, bound);
      const providerDeleteAcceptedAt = new Date(now()).toISOString();
      // An abandoned upload intent carries no provider generation, so the Signer answers the
      // unbound delete with a null one. Any other binding must still name the version it removed.
      const unbound = bound.generationId.startsWith('pending:');
      const generationId = deleted.generationId;
      if (
        !exactKeys(deleted, ['action', 'accepted', 'generationId'])
        || typeof deleted.accepted !== 'boolean'
        || (generationId === null
          ? !unbound
          : typeof generationId !== 'string' || generationId.length === 0)
      ) fail('SIGNER_INVALID');

      // A refused delete that names another version is a regeneration at the key: nothing was
      // removed and nothing is absent, so the evidence carries the live version and lets the
      // caller adopt it instead of retrying against a generation that is gone.
      if (deleted.accepted === false && !unbound && generationId !== bound.generationId) {
        return {
          keyHash: hashKey(key),
          generationId: generationId as string,
          objectSha256: null,
          deletionAttemptId: bound.deletionAttemptId,
          deletionRequestedAt,
          providerDeleteAcceptedAt,
          deletedAt: null,
          deleteSucceeded: false,
          absentFromList: false,
          absentFromMetadata: false,
          directReadAbsent: false,
          verificationMethod: 'authenticated-get-404',
          verifiedAt: providerDeleteAcceptedAt,
        } satisfies AudioDeletionEvidence;
      }

      // S8 §2.3: the four booleans are one fresh absence pass after the accepted delete.
      const absence = await call('absence', key, bound);
      if (
        !exactKeys(absence, [
          'action', 'generationId', 'absentFromList', 'absentFromMetadata', 'directReadAbsent', 'verifiedAt',
        ])
        || absence.generationId !== deleted.generationId
        || typeof absence.absentFromList !== 'boolean'
        || typeof absence.absentFromMetadata !== 'boolean'
        || typeof absence.directReadAbsent !== 'boolean'
      ) fail('SIGNER_INVALID');
      exactIsoMillis(absence.verifiedAt);

      return {
        keyHash: hashKey(key),
        generationId: generationId as string | null,
        objectSha256: null,
        deletionAttemptId: bound.deletionAttemptId,
        deletionRequestedAt,
        providerDeleteAcceptedAt,
        deletedAt: providerDeleteAcceptedAt,
        deleteSucceeded: deleted.accepted === true,
        absentFromList: absence.absentFromList,
        absentFromMetadata: absence.absentFromMetadata,
        directReadAbsent: absence.directReadAbsent,
        verificationMethod: 'authenticated-get-404',
        verifiedAt: absence.verifiedAt as string,
      } satisfies AudioDeletionEvidence;
    },

    async createUploadTarget(key, _metadata, binding) {
      const bound = requireBinding(binding, 'upload');
      const minted = target(await call('upload', key, bound));
      return { url: minted.url, expiresAt: minted.expiresAt };
    },

    async createDownloadTarget(key, expiresInSeconds, binding) {
      const bound = requireBinding(binding, 'claim');
      // The business API decision bounds the read window, so the ask is never sent; the answer
      // is refused when it outlives what this caller asked for.
      const requestedAt = now();
      const minted = target(await call('agent_read', key, bound));
      if (
        expiresInSeconds !== undefined
        && minted.expiresAtMs > requestedAt + expiresInSeconds * 1_000
      ) fail('SIGNER_INVALID');
      return { url: minted.url, expiresAt: minted.expiresAt };
    },
  };
}
