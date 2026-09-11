import {
  decodeStorageSignerDecision,
  decodeStorageSignerRequest,
  Sha256,
  validKey,
  type StorageSignerDecision,
  type StorageSignerRequest,
} from '@ccc/contracts/audio';
import { canonicalizeJcs } from '@ccc/contracts/jcs';

const REGION = 'ap-northeast-2';
const BUCKET = 'ccc-audio';
const MAX_REQUEST_BYTES = 8 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_READ_LIFETIME_MS = 600_000;
const MAX_UPLOAD_LIFETIME_MS = 2 * 60 * 60_000;
const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const MAX_LIST_ITEMS = 10;
// API, Signer and provider run on three independently set clocks, so a decision stamped a little
// ahead of the Signer's own clock is still a fresh decision, not a forged one.
const MAX_CLOCK_SKEW_MS = 2_000;
const AUDIO_CONTENT_TYPES: Record<string, true> = {
  'audio/mp4': true, 'audio/mpeg': true, 'audio/wav': true, 'audio/x-wav': true,
  'audio/webm': true, 'audio/x-m4a': true,
};
const BEARER = /^Bearer [A-Za-z0-9._~+/-]{1,8192}=*$/;
const SECRET = /^[A-Za-z0-9._~+/-]{1,8192}=*$/;

export interface StorageSignerConfig {
  apiBase: string;
  installationId: string;
  supabaseOrigin: string;
  serviceRoleKey: string;
  region: 'ap-northeast-2';
  fetch?: typeof fetch;
  now?: () => number;
}

type FailureCode =
  | 'METHOD_NOT_ALLOWED'
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'AUDIO_BODY_FORBIDDEN'
  | 'AUTHORIZATION_DENIED'
  | 'AUTHORIZATION_UNAVAILABLE'
  | 'AUTHORIZATION_INVALID'
  | 'STORAGE_UNAVAILABLE';

class SignerFailure extends Error {
  constructor(readonly status: number, readonly code: FailureCode) {
    super(code);
  }
}

export function createStorageSignerHandler(config: StorageSignerConfig): (request: Request) => Promise<Response> {
  const apiBase = exactApiBase(config.apiBase);
  const supabaseOrigin = exactHttpsOrigin(config.supabaseOrigin);
  if (
    config.region !== REGION
    || utf8Length(config.installationId) < 1
    || utf8Length(config.installationId) > 256
    || !SECRET.test(config.serviceRoleKey)
  ) throw new Error('storage_signer_config_invalid');

  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('storage_signer_config_invalid');
  const now = config.now ?? Date.now;
  const authorizationUrl = `${apiBase}/internal/storage/authorize`;
  const storageBase = `${supabaseOrigin}/storage/v1`;

  return async (request: Request): Promise<Response> => {
    try {
      const parsedRequest = await parseRequest(request);
      const authorization = request.headers.get('authorization')!;
      const canonicalRequest = canonicalizeJcs(parsedRequest);
      const requestSha256 = sha256(canonicalRequest);
      const decision = await authorize({
        authorization,
        authorizationUrl,
        canonicalRequest,
        config,
        fetchImpl,
        now,
        requestSha256,
        request: parsedRequest,
      });

      if (parsedRequest.action === 'upload') {
        return await createUploadTarget(parsedRequest, decision, storageBase, config, fetchImpl, now);
      }
      if (parsedRequest.action === 'agent_read') {
        return await createReadTarget(parsedRequest, decision, storageBase, config, fetchImpl, now);
      }
      if (parsedRequest.action === 'delete') {
        return await deleteObject(parsedRequest, decision, storageBase, config, fetchImpl, now);
      }
      if (parsedRequest.action === 'absence') {
        return await verifyAbsence(parsedRequest, decision, storageBase, config, fetchImpl, now);
      }
      return await headObject(parsedRequest, decision, storageBase, config, fetchImpl, now);
    } catch (error) {
      if (error instanceof SignerFailure) return jsonResponse(error.status, { code: error.code }, config.installationId);
      return jsonResponse(500, { code: 'INVALID_REQUEST' }, config.installationId);
    }
  };
}

async function parseRequest(request: Request): Promise<StorageSignerRequest> {
  if (request.method !== 'POST') throw new SignerFailure(405, 'METHOD_NOT_ALLOWED');
  const url = new URL(request.url);
  if (url.search !== '' || url.hash !== '') throw new SignerFailure(400, 'INVALID_REQUEST');
  if (request.headers.has('origin')) throw new SignerFailure(403, 'FORBIDDEN');

  const authorization = request.headers.get('authorization');
  if (authorization === null || !BEARER.test(authorization)) throw new SignerFailure(401, 'UNAUTHORIZED');
  if (request.headers.has('content-encoding') && request.headers.get('content-encoding') !== 'identity') {
    throw new SignerFailure(415, 'INVALID_REQUEST');
  }
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (mediaType.startsWith('audio/') || mediaType.startsWith('multipart/')) {
    throw new SignerFailure(415, 'AUDIO_BODY_FORBIDDEN');
  }
  if (mediaType !== 'application/json') throw new SignerFailure(415, 'INVALID_REQUEST');

  let raw: unknown;
  try {
    raw = JSON.parse(await readBounded(request.body, request.headers.get('content-length'), MAX_REQUEST_BYTES));
    const parsed = decodeStorageSignerRequest(raw);
    if (parsed.bucket !== BUCKET || !validKey(parsed.objectKey)) throw new Error('invalid signer request');
    return parsed;
  } catch (error) {
    if (error instanceof SignerFailure) throw error;
    throw new SignerFailure(400, 'INVALID_REQUEST');
  }
}

async function authorize(input: {
  authorization: string;
  authorizationUrl: string;
  canonicalRequest: string;
  config: StorageSignerConfig;
  fetchImpl: typeof fetch;
  now: () => number;
  requestSha256: string;
  request: StorageSignerRequest;
}): Promise<StorageSignerDecision> {
  let response: Response;
  try {
    response = await input.fetchImpl(input.authorizationUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        authorization: input.authorization,
        'content-type': 'application/json',
        'x-region': REGION,
      },
      body: input.canonicalRequest,
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new SignerFailure(503, 'AUTHORIZATION_UNAVAILABLE');
  }

  if (response.status === 401) throw new SignerFailure(401, 'AUTHORIZATION_DENIED');
  if (response.status === 403) throw new SignerFailure(403, 'AUTHORIZATION_DENIED');
  if (response.status >= 500) throw new SignerFailure(503, 'AUTHORIZATION_UNAVAILABLE');
  if (
    response.status !== 200
    || response.headers.get('x-ccc-installation-id') !== input.config.installationId
    || !hasNoStore(response.headers.get('cache-control'))
    || response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
  ) throw new SignerFailure(503, 'AUTHORIZATION_INVALID');

  let decision: StorageSignerDecision;
  try {
    decision = decodeStorageSignerDecision(JSON.parse(await readBounded(
      response.body,
      response.headers.get('content-length'),
      MAX_RESPONSE_BYTES,
    )));
  } catch {
    throw new SignerFailure(503, 'AUTHORIZATION_INVALID');
  }

  const authorizedAt = exactIsoMillis(decision.authorizedAt);
  const authorizationExpiresAt = exactIsoMillis(decision.authorizationExpiresAt);
  const checkedAt = input.now();
  if (
    decision.requestSha256 !== input.requestSha256
    || authorizedAt > checkedAt + MAX_CLOCK_SKEW_MS
    || authorizationExpiresAt <= checkedAt
    || authorizationExpiresAt <= authorizedAt
    || utf8Length(decision.generationId) < 1
    || utf8Length(decision.generationId) > 256
  ) throw new SignerFailure(503, 'AUTHORIZATION_INVALID');

  if (
    input.request.context.kind === 'deletion'
    && decision.generationId !== input.request.context.generationId
  ) throw new SignerFailure(503, 'AUTHORIZATION_INVALID');

  if (input.request.action === 'upload' || input.request.action === 'agent_read') {
    if (decision.expiresAt === null) throw new SignerFailure(503, 'AUTHORIZATION_INVALID');
    const expiresAt = exactIsoMillis(decision.expiresAt);
    // Upload ceilings are pinned to the authorization expiry the business API moved,
    // reads stay measured from the instant the decision was made.
    const ceiling = input.request.action === 'upload'
      ? authorizationExpiresAt + MAX_UPLOAD_LIFETIME_MS
      : authorizedAt + MAX_READ_LIFETIME_MS;
    if (expiresAt <= checkedAt || expiresAt > ceiling) {
      throw new SignerFailure(503, 'AUTHORIZATION_INVALID');
    }
  } else if (decision.expiresAt !== null) {
    throw new SignerFailure(503, 'AUTHORIZATION_INVALID');
  }
  return decision;
}

async function createReadTarget(
  request: StorageSignerRequest,
  decision: StorageSignerDecision,
  storageBase: string,
  config: StorageSignerConfig,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<Response> {
  const checkedAt = requireLiveDecision(decision, now);
  const expiresAt = exactIsoMillis(decision.expiresAt!);
  // One whole second of headroom: the provider signs `exp` from its own clock and only in
  // seconds, so the ask must land strictly inside the authorized ceiling.
  const expiresIn = Math.min(600, Math.floor((expiresAt - checkedAt) / 1_000) - 1);
  if (expiresIn < 1) throw new SignerFailure(503, 'AUTHORIZATION_INVALID');
  const path = `/object/sign/${BUCKET}/${encodeObjectKey(request.objectKey)}`;
  const data = await providerJson(
    fetchImpl,
    `${storageBase}${path}`,
    {
      method: 'POST',
      headers: providerHeaders(config, true),
      body: JSON.stringify({ expiresIn, versionId: decision.generationId }),
    },
  );
  if (!hasExactKeys(data, ['signedURL']) || typeof data.signedURL !== 'string') {
    throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  }
  const url = canonicalSignedUrl(data.signedURL, path, storageBase);
  // Release the URL only after the token the provider actually signed is proven
  // to be live and inside the authorized ceiling. No re-signing, no retry.
  const providerExpiresAt = provenTokenExpiry(url, {
    accepts: (claims) => claims.scope === 'download'
      && claims.url === `${BUCKET}/${request.objectKey}`
      && claims.versionId === decision.generationId,
    ceilingMs: expiresAt,
    checkedAtMs: checkedAt,
  });
  return jsonResponse(200, {
    action: 'agent_read',
    url,
    expiresAt: new Date(providerExpiresAt).toISOString(),
    generationId: decision.generationId,
  }, config.installationId);
}

async function createUploadTarget(
  request: StorageSignerRequest,
  decision: StorageSignerDecision,
  storageBase: string,
  config: StorageSignerConfig,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<Response> {
  const checkedAt = requireLiveDecision(decision, now);
  const expiresAt = exactIsoMillis(decision.expiresAt!);
  if (expiresAt <= checkedAt) throw new SignerFailure(503, 'AUTHORIZATION_INVALID');
  const path = `/object/upload/sign/${BUCKET}/${encodeObjectKey(request.objectKey)}`;
  // No x-upsert header: the mint must never authorize overwriting an existing object.
  // No JSON content-type either, because the endpoint takes no body.
  const data = await providerJson(fetchImpl, `${storageBase}${path}`, {
    method: 'POST',
    headers: providerHeaders(config, false),
  });
  if (
    (!hasExactKeys(data, ['url']) && !hasExactKeys(data, ['url', 'token']))
    || typeof data.url !== 'string'
  ) throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  const url = canonicalSignedUrl(data.url, path, storageBase);
  // The provider picks the upload TTL from its own deployment config, so the URL is
  // released only when the token it actually signed is inside the authorized ceiling.
  const providerExpiresAt = provenTokenExpiry(url, {
    accepts: (claims) => claims.scope === 'upload'
      && claims.url === `${BUCKET}/${request.objectKey}`
      && (claims.upsert === undefined || claims.upsert === false),
    ceilingMs: expiresAt,
    checkedAtMs: checkedAt,
  });
  return jsonResponse(200, {
    action: 'upload',
    url,
    expiresAt: new Date(providerExpiresAt).toISOString(),
    generationId: decision.generationId,
  }, config.installationId);
}

/**
 * A `pending:` generation is an upload intent the client never completed, so no provider
 * generation was ever bound to it. The delete then targets whatever sits at the key and a
 * key that never existed is already the absence the caller asked for; in both cases the
 * answer carries no generation, because an unbound delete cannot name the version it removed.
 * A bound generation answers a 404 from what is live at the key right now, never from the
 * 404 alone: the same generation is deleted twice across the S8 §2.3 propagation wait.
 */
async function deleteObject(
  request: StorageSignerRequest,
  decision: StorageSignerDecision,
  storageBase: string,
  config: StorageSignerConfig,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<Response> {
  requireLiveDecision(decision, now);
  const pending = decision.generationId.startsWith('pending:');
  const url = new URL(`${storageBase}/object/${BUCKET}/${encodeObjectKey(request.objectKey)}`);
  if (!pending) url.searchParams.set('versionId', decision.generationId);
  const response = await providerFetch(fetchImpl, url.href, {
    method: 'DELETE',
    headers: providerHeaders(config, false),
  });
  if (response.status === 404) {
    await discardBounded(response);
    if (pending) {
      return jsonResponse(200, {
        action: 'delete',
        accepted: true,
        generationId: null,
      }, config.installationId);
    }
    // S8 §2.3 re-deletes the same generation after the propagation wait, so a bound 404 is the
    // ordinary second cycle. One fresh versionless read decides what it means: nothing at the key
    // is the absence the caller asked for, and another live version is a regeneration the caller
    // must adopt before it can prove anything about it.
    const liveGeneration = await absenceMetadataVersion(
      fetchImpl,
      `${storageBase}/object/info/${BUCKET}/${encodeObjectKey(request.objectKey)}`,
      config,
      null,
    );
    if (liveGeneration === decision.generationId) {
      // The provider refuses to delete a version it still reports live: no answer, fail closed.
      throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
    }
    return jsonResponse(200, {
      action: 'delete',
      accepted: liveGeneration === null,
      generationId: liveGeneration ?? decision.generationId,
    }, config.installationId);
  }
  const data = await parseProviderJson(response);
  if (!hasExactKeys(data, ['message']) || data.message !== 'Successfully deleted') {
    throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  }
  return jsonResponse(200, {
    action: 'delete',
    accepted: true,
    generationId: pending ? null : decision.generationId,
  }, config.installationId);
}

async function headObject(
  request: StorageSignerRequest,
  decision: StorageSignerDecision,
  storageBase: string,
  config: StorageSignerConfig,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<Response> {
  requireLiveDecision(decision, now);
  const url = new URL(`${storageBase}/object/info/${BUCKET}/${encodeObjectKey(request.objectKey)}`);
  if (request.context.kind === 'deletion') url.searchParams.set('versionId', decision.generationId);

  const response = await providerFetch(fetchImpl, url.href, {
    method: 'GET',
    headers: providerHeaders(config, false),
  });
  if (response.status === 404) {
    await discardBounded(response);
    return jsonResponse(200, {
      action: 'head', exists: false, generationId: decision.generationId,
    }, config.installationId);
  }
  const data = await parseProviderJson(response);
  const generationId = data.version;
  if (
    typeof generationId !== 'string'
    || utf8Length(generationId) < 1
    || utf8Length(generationId) > 256
    || (request.context.kind === 'deletion' && generationId !== decision.generationId)
    || !Number.isSafeInteger(data.size)
    || (data.size as number) < 0
    || (data.size as number) > MAX_AUDIO_BYTES
    || typeof data.content_type !== 'string'
    || AUDIO_CONTENT_TYPES[data.content_type] !== true
    || (data.etag !== null && typeof data.etag !== 'string')
    || (data.last_modified !== null && typeof data.last_modified !== 'string')
  ) throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');

  return jsonResponse(200, {
    action: 'head',
    exists: true,
    generationId,
    contentLength: data.size,
    contentType: data.content_type,
    etag: data.etag,
    lastModified: data.last_modified,
  }, config.installationId);
}

/**
 * S8 §2.3 absence evidence. Three fresh provider reads after the live decision, never a cached or
 * reused true: a prefix list, a generation-scoped metadata read and a one-byte authenticated read.
 * Any timeout, redirect, 5xx or malformed body is STORAGE_UNAVAILABLE, never a boolean, and no
 * object name, size or provider text leaves this function.
 */
async function verifyAbsence(
  request: StorageSignerRequest,
  decision: StorageSignerDecision,
  storageBase: string,
  config: StorageSignerConfig,
  fetchImpl: typeof fetch,
  now: () => number,
): Promise<Response> {
  requireLiveDecision(decision, now);
  // An unbound (`pending:`) generation asks a plainer question: is anything at all at this key.
  const pending = decision.generationId.startsWith('pending:');
  const versionId = pending ? null : decision.generationId;
  const separator = request.objectKey.lastIndexOf('/');
  const name = request.objectKey.slice(separator + 1);
  const prefix = separator < 0 ? '' : request.objectKey.slice(0, separator);
  const encodedKey = encodeObjectKey(request.objectKey);

  const listed = await listNamePresent(fetchImpl, `${storageBase}/object/list/${BUCKET}`, config, prefix, name);
  const liveGeneration = await absenceMetadataVersion(fetchImpl, `${storageBase}/object/info/${BUCKET}/${encodedKey}`, config, versionId);
  const directReadAbsent = await absenceDirectRead(fetchImpl, `${storageBase}/object/authenticated/${BUCKET}/${encodedKey}`, config, versionId);

  // A listed name that carries another generation is still absence for this generation,
  // but an unbound check is absence only when nothing at all answers at the key.
  const absentFromMetadata = pending ? liveGeneration === null : liveGeneration !== decision.generationId;
  return jsonResponse(200, {
    action: 'absence',
    generationId: versionId,
    absentFromList: pending ? !listed : !listed || absentFromMetadata,
    absentFromMetadata,
    directReadAbsent,
    verifiedAt: new Date(now()).toISOString(),
  }, config.installationId);
}

/**
 * `POST /object/list/:bucket` takes `{prefix, search, limit}` and answers with an array of entries
 * whose `name` is relative to the prefix folder (supabase/storage
 * `src/http/routes/object/listObjects.ts`, `src/storage/schemas/object.ts` `objectListEntrySchema`,
 * `src/storage/database/pg.ts` `searchObjects` over `storage.search`).
 */
async function listNamePresent(
  fetchImpl: typeof fetch,
  url: string,
  config: StorageSignerConfig,
  prefix: string,
  name: string,
): Promise<boolean> {
  const response = await providerFetch(fetchImpl, url, {
    method: 'POST',
    headers: providerHeaders(config, true),
    body: JSON.stringify({ prefix, search: name, limit: MAX_LIST_ITEMS }),
  });
  const value = await providerJsonValue(response);
  if (!Array.isArray(value) || value.length > MAX_LIST_ITEMS) throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  return value.some((item) => item !== null
    && typeof item === 'object'
    && !Array.isArray(item)
    && (item as Record<string, unknown>).name === name);
}

/** `GET /object/info/:bucket/*?versionId=` is the generation-scoped metadata read; 404 is absence. */
async function absenceMetadataVersion(
  fetchImpl: typeof fetch,
  url: string,
  config: StorageSignerConfig,
  versionId: string | null,
): Promise<string | null> {
  const target = new URL(url);
  if (versionId !== null) target.searchParams.set('versionId', versionId);
  const response = await providerFetch(fetchImpl, target.href, {
    method: 'GET',
    headers: providerHeaders(config, false),
  });
  if (response.status === 404) {
    await discardBounded(response);
    return null;
  }
  const data = await parseProviderJson(response);
  const version = data.version;
  if (typeof version !== 'string' || utf8Length(version) < 1 || utf8Length(version) > 256) {
    throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  }
  return version;
}

/** S8 §2.3 `authenticated-get-404`. A present object answers with bytes, so the body is cancelled unread. */
async function absenceDirectRead(
  fetchImpl: typeof fetch,
  url: string,
  config: StorageSignerConfig,
  versionId: string | null,
): Promise<boolean> {
  const target = new URL(url);
  if (versionId !== null) target.searchParams.set('versionId', versionId);
  const response = await providerFetch(fetchImpl, target.href, {
    method: 'GET',
    headers: { ...providerHeaders(config, false), range: 'bytes=0-0' },
  });
  if (response.status === 404) {
    await discardBounded(response);
    return true;
  }
  if (response.status === 200 || response.status === 206) {
    await response.body?.cancel().catch(() => undefined);
    return false;
  }
  await discardBounded(response);
  throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
}

async function providerJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  return parseProviderJson(await providerFetch(fetchImpl, url, init));
}

async function providerFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      ...init,
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  }
}

async function parseProviderJson(response: Response): Promise<Record<string, unknown>> {
  const value = await providerJsonValue(response);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  }
  return value as Record<string, unknown>;
}

async function providerJsonValue(response: Response): Promise<unknown> {
  if (
    response.status !== 200
    || response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json'
  ) {
    await discardBounded(response);
    throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  }
  try {
    return JSON.parse(await readBounded(
      response.body,
      response.headers.get('content-length'),
      MAX_RESPONSE_BYTES,
    ));
  } catch {
    // Every provider-side failure (oversized body, bad length, malformed JSON) is a provider failure, never a caller error.
    throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  }
}

function providerHeaders(config: StorageSignerConfig, jsonBody: boolean): Record<string, string> {
  return {
    accept: 'application/json',
    apikey: config.serviceRoleKey,
    authorization: `Bearer ${config.serviceRoleKey}`,
    'x-region': REGION,
    ...(jsonBody ? { 'content-type': 'application/json' } : {}),
  };
}

function requireLiveDecision(decision: StorageSignerDecision, now: () => number): number {
  const checkedAt = now();
  if (exactIsoMillis(decision.authorizationExpiresAt) <= checkedAt) {
    throw new SignerFailure(503, 'AUTHORIZATION_INVALID');
  }
  return checkedAt;
}

function canonicalSignedUrl(raw: string, expectedPath: string, storageBase: string): string {
  if (raw.length > 8_192 || !raw.startsWith(`${expectedPath}?`)) {
    throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  }
  let candidate: URL;
  try {
    candidate = new URL(`${storageBase}${raw}`);
  } catch {
    throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  }
  const query = [...candidate.searchParams.entries()];
  if (
    candidate.origin !== new URL(storageBase).origin
    || candidate.pathname !== `${new URL(storageBase).pathname}${expectedPath}`
    || candidate.hash !== ''
    || query.length !== 1
    || query[0]?.[0] !== 'token'
    || query[0][1].length < 1
    || query[0][1].length > 4_096
  ) throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  return candidate.href;
}

/**
 * Reads the expiry the provider actually signed into the returned token.
 * The token is provider-response metadata only: it is never verified here as a
 * credential, and a token that outlives the authorized ceiling is refused.
 * `accepts` carries the per-action claim binding (scope, object path, version, upsert).
 */
function provenTokenExpiry(url: string, bound: {
  accepts: (claims: Record<string, unknown>) => boolean;
  ceilingMs: number;
  checkedAtMs: number;
}): number {
  const claims = tokenClaims(url);
  const expiresAtMs = typeof claims.exp === 'number' && Number.isSafeInteger(claims.exp) ? claims.exp * 1_000 : NaN;
  if (
    !Number.isSafeInteger(expiresAtMs)
    || expiresAtMs <= bound.checkedAtMs
    || expiresAtMs > bound.ceilingMs
    || !bound.accepts(claims)
  ) throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  return expiresAtMs;
}

/** Decodes the unverified claim set carried by the provider token in a signed URL. */
function tokenClaims(url: string): Record<string, unknown> {
  const token = new URL(url).searchParams.get('token') ?? '';
  const segments = token.split('.');
  if (segments.length !== 3) throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  try {
    const padded = segments[1]!.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(padded.padEnd(padded.length + (4 - padded.length % 4) % 4, '='));
    const parsed: unknown = JSON.parse(decoded);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid token claims');
    return parsed as Record<string, unknown>;
  } catch {
    throw new SignerFailure(502, 'STORAGE_UNAVAILABLE');
  }
}

async function readBounded(
  body: ReadableStream<Uint8Array> | null,
  contentLength: string | null,
  limit: number,
): Promise<string> {
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > limit)) {
    throw new SignerFailure(413, 'INVALID_REQUEST');
  }
  if (body === null) return '';
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    total += item.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new SignerFailure(413, 'INVALID_REQUEST');
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

async function discardBounded(response: Response): Promise<void> {
  try {
    await readBounded(response.body, response.headers.get('content-length'), MAX_RESPONSE_BYTES);
  } catch {
    await response.body?.cancel().catch(() => undefined);
  }
}

function jsonResponse(status: number, body: Record<string, unknown>, installationId: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      'x-ccc-installation-id': installationId,
    },
  });
}

function exactApiBase(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.username !== ''
      || url.password !== ''
      || url.search !== ''
      || url.hash !== ''
      || (url.pathname !== '/' && url.pathname.endsWith('/'))
      || value !== `${url.origin}${url.pathname}`
    ) throw new Error('invalid');
    // A bare origin is a route prefix of nothing (install-manifest.ts assertModeFields,
    // runtime.ts routePrefix), so its trailing slash is dropped instead of doubling the separator.
    return url.pathname === '/' ? url.origin : value;
  } catch {
    throw new Error('storage_signer_config_invalid');
  }
}

function exactHttpsOrigin(value: string): string {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.username !== ''
      || url.password !== ''
      || url.search !== ''
      || url.hash !== ''
      || url.pathname !== '/'
      || value !== url.origin
    ) throw new Error('invalid');
    return value;
  } catch {
    throw new Error('storage_signer_config_invalid');
  }
}

function exactIsoMillis(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new SignerFailure(503, 'AUTHORIZATION_INVALID');
  }
  return milliseconds;
}

function encodeObjectKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function sha256(value: string): string {
  const hash = new Sha256();
  hash.update(new TextEncoder().encode(value));
  return hash.digestHex();
}

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hasNoStore(value: string | null): boolean {
  return value !== null && value.split(',').some((part) => part.trim().toLowerCase() === 'no-store');
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}
