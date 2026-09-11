import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createStorageSignerHandler, type StorageSignerConfig } from '../../community-cloud/src/storage-signer';

const API_BASE = 'https://callback.example.test/functions/v1/ccc-api';
const PROVIDER_ORIGIN = 'https://provider.example.test';
const SIGNER_URL = 'https://signer.example.test/storage-sign';
const INSTALLATION_ID = 'installation-1';
const CALLER_BEARER = 'caller-bearer-token';
const SERVICE_ROLE_KEY = 'service-role-secret';
const NOW = Date.parse('2026-09-11T00:00:00.000Z');
const AUTHORIZED_AT = '2026-09-11T00:00:00.000Z';
const AUTHORIZATION_EXPIRES_AT = '2026-09-11T00:00:05.000Z';
const GENERATION_ID = 'version-7';
const PENDING_GENERATION_ID = 'pending:audio-object-1';
const OBJECT_KEY = 'audio/session_01/550e8400-e29b-41d4-a716-446655440000';
const OBJECT_SHA256 = 'a'.repeat(64);
const CALLBACK_URL = `${API_BASE}/internal/storage/authorize`;
const STORAGE_BASE = `${PROVIDER_ORIGIN}/storage/v1`;

const HEAD_REQUEST = {
  bucket: 'ccc-audio', objectKey: OBJECT_KEY, action: 'head', principal: 'scheduler', objectSha256: OBJECT_SHA256,
  context: { kind: 'deletion', audioObjectId: 'audio-object-1', generationId: GENERATION_ID, deletionAttemptId: 'delete-attempt-1' },
} as const;
const READ_REQUEST = {
  bucket: 'ccc-audio', objectKey: OBJECT_KEY, action: 'agent_read', principal: 'agent', objectSha256: OBJECT_SHA256,
  context: { kind: 'claim', jobId: 'job-1', claimToken: 'claim-token-1', attempt: 1 },
} as const;
const DELETE_REQUEST = { ...HEAD_REQUEST, action: 'delete' } as const;
const ABSENCE_REQUEST = { ...HEAD_REQUEST, action: 'absence' } as const;
const UPLOAD_REQUEST = {
  bucket: 'ccc-audio', objectKey: OBJECT_KEY, action: 'upload', principal: 'client', objectSha256: null,
  context: { kind: 'upload', audioObjectId: 'audio-object-1' },
} as const;

const HEAD_HASH = fixtureHash(`{"action":"head","bucket":"ccc-audio","context":{"audioObjectId":"audio-object-1","deletionAttemptId":"delete-attempt-1","generationId":"version-7","kind":"deletion"},"objectKey":"${OBJECT_KEY}","objectSha256":"${OBJECT_SHA256}","principal":"scheduler"}`);
const READ_HASH = fixtureHash(`{"action":"agent_read","bucket":"ccc-audio","context":{"attempt":1,"claimToken":"claim-token-1","jobId":"job-1","kind":"claim"},"objectKey":"${OBJECT_KEY}","objectSha256":"${OBJECT_SHA256}","principal":"agent"}`);
const DELETE_HASH = fixtureHash(`{"action":"delete","bucket":"ccc-audio","context":{"audioObjectId":"audio-object-1","deletionAttemptId":"delete-attempt-1","generationId":"version-7","kind":"deletion"},"objectKey":"${OBJECT_KEY}","objectSha256":"${OBJECT_SHA256}","principal":"scheduler"}`);
const UPLOAD_HASH = fixtureHash(`{"action":"upload","bucket":"ccc-audio","context":{"audioObjectId":"audio-object-1","kind":"upload"},"objectKey":"${OBJECT_KEY}","objectSha256":null,"principal":"client"}`);
const ABSENCE_HASH = fixtureHash(`{"action":"absence","bucket":"ccc-audio","context":{"audioObjectId":"audio-object-1","deletionAttemptId":"delete-attempt-1","generationId":"version-7","kind":"deletion"},"objectKey":"${OBJECT_KEY}","objectSha256":"${OBJECT_SHA256}","principal":"scheduler"}`);
const LIST_URL = `${STORAGE_BASE}/object/list/ccc-audio`;
const INFO_URL = `${STORAGE_BASE}/object/info/ccc-audio/${OBJECT_KEY}?versionId=${GENERATION_ID}`;
const READ_URL = `${STORAGE_BASE}/object/authenticated/ccc-audio/${OBJECT_KEY}?versionId=${GENERATION_ID}`;
const PENDING_CONTEXT = { ...HEAD_REQUEST.context, generationId: PENDING_GENERATION_ID } as const;
const PENDING_DELETE_REQUEST = { ...DELETE_REQUEST, context: PENDING_CONTEXT } as const;
const PENDING_ABSENCE_REQUEST = { ...ABSENCE_REQUEST, context: PENDING_CONTEXT } as const;
const PENDING_DELETE_HASH = fixtureHash(`{"action":"delete","bucket":"ccc-audio","context":{"audioObjectId":"audio-object-1","deletionAttemptId":"delete-attempt-1","generationId":"${PENDING_GENERATION_ID}","kind":"deletion"},"objectKey":"${OBJECT_KEY}","objectSha256":"${OBJECT_SHA256}","principal":"scheduler"}`);
const PENDING_ABSENCE_HASH = fixtureHash(`{"action":"absence","bucket":"ccc-audio","context":{"audioObjectId":"audio-object-1","deletionAttemptId":"delete-attempt-1","generationId":"${PENDING_GENERATION_ID}","kind":"deletion"},"objectKey":"${OBJECT_KEY}","objectSha256":"${OBJECT_SHA256}","principal":"scheduler"}`);
const UNBOUND_DELETE_URL = `${STORAGE_BASE}/object/ccc-audio/${OBJECT_KEY}`;
const UNBOUND_INFO_URL = `${STORAGE_BASE}/object/info/ccc-audio/${OBJECT_KEY}`;
const UNBOUND_READ_URL = `${STORAGE_BASE}/object/authenticated/ccc-audio/${OBJECT_KEY}`;

function fixtureHash(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex');
}

/** Mirrors the provider's signed token shape: header.payload.signature, base64url claims. */
function downloadToken(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.c2lnbmF0dXJl`;
}

function signedUrlResponse(claims: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ signedURL: `/object/sign/ccc-audio/${OBJECT_KEY}?token=${downloadToken(claims)}` }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
}

function config(fetchImpl: typeof fetch, now: () => number = () => NOW): StorageSignerConfig {
  return {
    apiBase: API_BASE,
    installationId: INSTALLATION_ID,
    supabaseOrigin: PROVIDER_ORIGIN,
    serviceRoleKey: SERVICE_ROLE_KEY,
    region: 'ap-northeast-2',
    fetch: fetchImpl,
    now,
  };
}

function signerRequest(body: unknown = HEAD_REQUEST, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has('authorization')) headers.set('authorization', `Bearer ${CALLER_BEARER}`);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Request(SIGNER_URL, { method: 'POST', ...init, headers, body: init.body ?? JSON.stringify(body) });
}

function decision(requestSha256: string, expiresAt: string | null, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    allowed: true,
    requestSha256,
    generationId: GENERATION_ID,
    authorizedAt: AUTHORIZED_AT,
    authorizationExpiresAt: AUTHORIZATION_EXPIRES_AT,
    expiresAt,
    ...overrides,
  };
}

function callbackResponse(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  if (!headers.has('x-ccc-installation-id')) headers.set('x-ccc-installation-id', INSTALLATION_ID);
  return new Response(JSON.stringify(body), { status: init.status ?? 200, ...init, headers });
}

async function fixedError(response: Response): Promise<{ code: string }> {
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(response.headers.get('x-ccc-installation-id')).toBe(INSTALLATION_ID);
  expect(response.headers.get('content-type')).toBe('application/json; charset=utf-8');
  return response.json() as Promise<{ code: string }>;
}

function headersOf(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers);
}

/**
 * A provider body that records every pull. `highWaterMark: 0` keeps the source demand-driven, so a
 * single recorded pull means the signer actually consumed audio bytes.
 */
function countingBody(): { body: ReadableStream<Uint8Array>; reads: () => number; cancelled: () => boolean } {
  let reads = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      reads += 1;
      controller.enqueue(new Uint8Array([0x52, 0x49, 0x46, 0x46]));
    },
    cancel() {
      cancelled = true;
    },
  }, new CountQueuingStrategy({ highWaterMark: 0 }));
  return { body, reads: () => reads, cancelled: () => cancelled };
}

describe('StorageSigner online authorization boundary', () => {
  it('rejects untrusted endpoint and secret configuration at construction', () => {
    const base = config(fetch);
    const invalid: Array<Partial<StorageSignerConfig>> = [
      { apiBase: 'http://callback.example.test/functions/v1/ccc-api' },
      { apiBase: `${API_BASE}/` },
      { apiBase: `${API_BASE}?redirect=https://attacker.invalid` },
      { supabaseOrigin: 'http://provider.example.test' },
      { supabaseOrigin: `${PROVIDER_ORIGIN}/storage/v1` },
      { supabaseOrigin: `${PROVIDER_ORIGIN}/` },
      { installationId: '' },
      { serviceRoleKey: 'contains whitespace' },
      { region: 'us-east-1' as 'ap-northeast-2' },
    ];
    for (const patch of invalid) expect(() => createStorageSignerHandler({ ...base, ...patch })).toThrow('storage_signer_config_invalid');
  });

  it('rejects non-JSON, browser, query, malformed auth, unknown-field and oversized requests before any network call', async () => {
    let calls = 0;
    const handler = createStorageSignerHandler(config(async () => {
      calls += 1;
      throw new Error('network must not be called');
    }));
    const cases: Array<{ request: Request; status: number; code: string }> = [
      { request: new Request(SIGNER_URL, { method: 'GET', headers: { authorization: `Bearer ${CALLER_BEARER}` } }), status: 405, code: 'METHOD_NOT_ALLOWED' },
      { request: new Request(`${SIGNER_URL}?callback=https://attacker.invalid`, { method: 'POST', headers: { authorization: `Bearer ${CALLER_BEARER}`, 'content-type': 'application/json' }, body: JSON.stringify(HEAD_REQUEST) }), status: 400, code: 'INVALID_REQUEST' },
      { request: signerRequest(HEAD_REQUEST, { headers: { origin: 'https://browser.example.test' } }), status: 403, code: 'FORBIDDEN' },
      { request: signerRequest(undefined, { headers: { 'content-type': 'audio/mpeg' }, body: 'raw-audio-secret' }), status: 415, code: 'AUDIO_BODY_FORBIDDEN' },
      { request: signerRequest(undefined, { headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: '--x\r\nraw-audio-secret' }), status: 415, code: 'AUDIO_BODY_FORBIDDEN' },
      { request: signerRequest(undefined, { headers: { 'content-type': 'text/plain' }, body: JSON.stringify(HEAD_REQUEST) }), status: 415, code: 'INVALID_REQUEST' },
      { request: new Request(SIGNER_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(HEAD_REQUEST) }), status: 401, code: 'UNAUTHORIZED' },
      { request: signerRequest(HEAD_REQUEST, { headers: { authorization: 'Bearer two words' } }), status: 401, code: 'UNAUTHORIZED' },
      { request: signerRequest({ ...HEAD_REQUEST, callbackUrl: 'https://attacker.invalid' }), status: 400, code: 'INVALID_REQUEST' },
      { request: signerRequest(undefined, { body: '{' }), status: 400, code: 'INVALID_REQUEST' },
      { request: signerRequest(undefined, { body: `{"padding":"${'x'.repeat(65_536)}"}` }), status: 413, code: 'INVALID_REQUEST' },
    ];
    for (const item of cases) {
      const response = await handler(item.request);
      expect(response.status).toBe(item.status);
      expect(await fixedError(response)).toEqual({ code: item.code });
    }
    expect(calls).toBe(0);
  });

  it('authorizes every invocation online and never reuses an earlier allow after denial or outage', async () => {
    let callbackCalls = 0;
    let providerCalls = 0;
    const observed: Array<{ url: string; init?: RequestInit | undefined }> = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      observed.push({ url, init });
      if (url === CALLBACK_URL) {
        callbackCalls += 1;
        if (callbackCalls === 2) return callbackResponse({ code: 'forbidden' }, { status: 403 });
        if (callbackCalls === 3) throw new Error('private callback outage token=secret');
        return callbackResponse(decision(HEAD_HASH, null));
      }
      providerCalls += 1;
      return new Response(JSON.stringify({
        id: 'provider-private-id', name: OBJECT_KEY, version: GENERATION_ID, bucket_id: 'ccc-audio',
        size: 321, content_type: 'audio/webm', cache_control: '3600', etag: '"etag-1"',
        metadata: { private: 'must-not-leak' }, last_modified: '2026-09-10T23:59:00.000Z',
        created_at: '2026-09-10T23:58:00.000Z', archived_at: null, is_delete_marker: false, is_versioned: true,
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const handler = createStorageSignerHandler(config(fetchImpl));

    const first = await handler(signerRequest());
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('no-store');
    expect(first.headers.get('x-ccc-installation-id')).toBe(INSTALLATION_ID);
    expect(await first.json()).toEqual({
      action: 'head', exists: true, generationId: GENERATION_ID, contentLength: 321,
      contentType: 'audio/webm', etag: '"etag-1"', lastModified: '2026-09-10T23:59:00.000Z',
    });
    const denied = await handler(signerRequest());
    expect(denied.status).toBe(403);
    expect(await fixedError(denied)).toEqual({ code: 'AUTHORIZATION_DENIED' });
    const outage = await handler(signerRequest());
    expect(outage.status).toBe(503);
    expect(await fixedError(outage)).toEqual({ code: 'AUTHORIZATION_UNAVAILABLE' });
    expect(callbackCalls).toBe(3);
    expect(providerCalls).toBe(1);

    const callback = observed[0]!;
    expect(callback.url).toBe(CALLBACK_URL);
    expect(callback.init?.method).toBe('POST');
    expect(callback.init?.redirect).toBe('error');
    expect(JSON.parse(String(callback.init?.body))).toEqual(HEAD_REQUEST);
    expect(headersOf(callback.init).get('authorization')).toBe(`Bearer ${CALLER_BEARER}`);
    expect(headersOf(callback.init).get('apikey')).toBeNull();
    expect(headersOf(callback.init).get('cookie')).toBeNull();
    expect(headersOf(callback.init).get('x-region')).toBe('ap-northeast-2');

    const provider = observed[1]!;
    expect(provider.url).toBe(`${STORAGE_BASE}/object/info/ccc-audio/${OBJECT_KEY}?versionId=${GENERATION_ID}`);
    expect(provider.init?.method).toBe('GET');
    expect(provider.init?.redirect).toBe('error');
    expect(headersOf(provider.init).get('authorization')).toBe(`Bearer ${SERVICE_ROLE_KEY}`);
    expect(headersOf(provider.init).get('apikey')).toBe(SERVICE_ROLE_KEY);
    expect(headersOf(provider.init).get('authorization')).not.toContain(CALLER_BEARER);
  });

  it('rejects malformed, mismatched, stale or redirected authorization evidence before storage', async () => {
    let clock = NOW;
    let providerCalls = 0;
    const cases: Array<() => Response> = [
      () => callbackResponse(decision(HEAD_HASH, null), { headers: { 'x-ccc-installation-id': 'other-installation' } }),
      () => callbackResponse(decision('b'.repeat(64), null)),
      () => callbackResponse({ ...decision(HEAD_HASH, null), unexpected: true }),
      () => callbackResponse(decision(HEAD_HASH, null, { generationId: 'other-version' })),
      () => callbackResponse(decision(HEAD_HASH, null, { authorizationExpiresAt: '2026-09-11T00:00:06.000Z' })),
      () => callbackResponse(decision(HEAD_HASH, '2026-09-11T00:10:00.000Z')),
      () => new Response(null, { status: 302, headers: { location: 'https://attacker.invalid' } }),
      () => callbackResponse({ padding: 'x'.repeat(65_536) }),
      () => {
        clock = Date.parse(AUTHORIZATION_EXPIRES_AT);
        return callbackResponse(decision(HEAD_HASH, null));
      },
    ];
    let index = 0;
    const handler = createStorageSignerHandler(config((async (input) => {
      if (String(input) === CALLBACK_URL) return cases[index++]!();
      providerCalls += 1;
      throw new Error('storage must not be reached');
    }) as typeof fetch, () => clock));

    for (let caseIndex = 0; caseIndex < cases.length; caseIndex++) {
      clock = NOW;
      const response = await handler(signerRequest());
      expect(response.status).toBe(503);
      expect(await fixedError(response)).toEqual({ code: 'AUTHORIZATION_INVALID' });
    }
    expect(providerCalls).toBe(0);
  });

  it('releases an Agent read URL only with the expiry the provider actually signed', async () => {
    const expiresAt = '2026-09-11T00:09:59.500Z';
    const tokenExpiry = Math.floor(Date.parse('2026-09-11T00:05:00.000Z') / 1_000);
    const token = downloadToken({ url: `ccc-audio/${OBJECT_KEY}`, scope: 'download', versionId: GENERATION_ID, exp: tokenExpiry });
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    const handler = createStorageSignerHandler(config((async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === CALLBACK_URL) return callbackResponse(decision(READ_HASH, expiresAt));
      return new Response(JSON.stringify({ signedURL: `/object/sign/ccc-audio/${OBJECT_KEY}?token=${token}` }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch));

    const response = await handler(signerRequest(READ_REQUEST));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      action: 'agent_read',
      url: `${STORAGE_BASE}/object/sign/ccc-audio/${OBJECT_KEY}?token=${token}`,
      expiresAt: '2026-09-11T00:05:00.000Z',
      generationId: GENERATION_ID,
    });
    const provider = calls[1]!;
    expect(provider.url).toBe(`${STORAGE_BASE}/object/sign/ccc-audio/${OBJECT_KEY}`);
    expect(provider.init?.method).toBe('POST');
    expect(JSON.parse(String(provider.init?.body))).toEqual({ expiresIn: 599, versionId: GENERATION_ID });
    expect(headersOf(provider.init).get('authorization')).toBe(`Bearer ${SERVICE_ROLE_KEY}`);
    expect(headersOf(provider.init).get('content-type')).toBe('application/json');
  });

  it('reports only generation-bound provider delete acceptance, not terminal deletion proof', async () => {
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    const handler = createStorageSignerHandler(config((async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === CALLBACK_URL) return callbackResponse(decision(DELETE_HASH, null));
      return new Response(JSON.stringify({ message: 'Successfully deleted' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch));

    const response = await handler(signerRequest(DELETE_REQUEST));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ action: 'delete', accepted: true, generationId: GENERATION_ID });
    const provider = calls[1]!;
    expect(provider.url).toBe(`${STORAGE_BASE}/object/ccc-audio/${OBJECT_KEY}?versionId=${GENERATION_ID}`);
    expect(provider.init?.method).toBe('DELETE');
    expect(provider.init?.body).toBeUndefined();
  });

  it('deletes an abandoned upload intent unbound and counts a key that never existed as accepted', async () => {
    for (const [status, body] of [[200, { message: 'Successfully deleted' }], [404, { message: 'Object not found' }]] as const) {
      const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
      const handler = createStorageSignerHandler(config((async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url === CALLBACK_URL) {
          return callbackResponse(decision(PENDING_DELETE_HASH, null, { generationId: PENDING_GENERATION_ID }));
        }
        return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      }) as typeof fetch));

      const response = await handler(signerRequest(PENDING_DELETE_REQUEST));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ action: 'delete', accepted: true, generationId: null });
      // No versionId: an upload intent that was never completed has no generation to bind to.
      expect(calls[1]?.url).toBe(UNBOUND_DELETE_URL);
      expect(calls[1]?.init?.method).toBe('DELETE');
    }
  });

  it('keeps a provider 404 a failure for a generation-bound delete', async () => {
    const handler = createStorageSignerHandler(config((async (input) => {
      const url = String(input);
      if (url === CALLBACK_URL) return callbackResponse(decision(DELETE_HASH, null));
      return new Response(JSON.stringify({ message: 'Object not found' }), {
        status: 404, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch));

    const response = await handler(signerRequest(DELETE_REQUEST));
    expect(response.status).toBe(502);
    expect(await fixedError(response)).toEqual({ code: 'STORAGE_UNAVAILABLE' });
  });

  it('mints one signed upload without upsert and releases the expiry the provider signed', async () => {
    const token = downloadToken({
      url: `ccc-audio/${OBJECT_KEY}`,
      scope: 'upload',
      upsert: false,
      exp: Math.floor(Date.parse('2026-09-11T01:00:00.000Z') / 1_000),
    });
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    const handler = createStorageSignerHandler(config((async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === CALLBACK_URL) {
        return callbackResponse(decision(UPLOAD_HASH, '2026-09-11T02:00:00.000Z', { generationId: PENDING_GENERATION_ID }));
      }
      return new Response(JSON.stringify({ url: `/object/upload/sign/ccc-audio/${OBJECT_KEY}?token=${token}`, token }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch));

    const response = await handler(signerRequest(UPLOAD_REQUEST));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      action: 'upload',
      url: `${STORAGE_BASE}/object/upload/sign/ccc-audio/${OBJECT_KEY}?token=${token}`,
      expiresAt: '2026-09-11T01:00:00.000Z',
      generationId: PENDING_GENERATION_ID,
    });
    expect(calls.length).toBe(2);
    const provider = calls[1]!;
    expect(provider.url).toBe(`${STORAGE_BASE}/object/upload/sign/ccc-audio/${OBJECT_KEY}`);
    expect(provider.init?.method).toBe('POST');
    expect(provider.init?.redirect).toBe('error');
    expect(provider.init?.body).toBeUndefined();
    expect(headersOf(provider.init).get('x-upsert')).toBeNull();
    expect(headersOf(provider.init).get('authorization')).toBe(`Bearer ${SERVICE_ROLE_KEY}`);
    expect(headersOf(provider.init).get('authorization')).not.toContain(CALLER_BEARER);
  });

  it('withholds the upload URL when the provider token outlives the ceiling, upserts, or points elsewhere', async () => {
    const insideCeiling = Math.floor(Date.parse('2026-09-11T01:00:00.000Z') / 1_000);
    const objectPath = `ccc-audio/${OBJECT_KEY}`;
    const providerUrls = [
      `/object/upload/sign/ccc-audio/${OBJECT_KEY}?token=${downloadToken({ url: objectPath, scope: 'upload', upsert: false, exp: Math.floor(Date.parse('2026-09-11T02:00:01.000Z') / 1_000) })}`,
      `/object/upload/sign/ccc-audio/${OBJECT_KEY}?token=${downloadToken({ url: objectPath, scope: 'upload', upsert: true, exp: insideCeiling })}`,
      `/object/upload/sign/ccc-audio/${OBJECT_KEY}?token=${downloadToken({ url: 'ccc-audio/audio/other/550e8400-e29b-41d4-a716-446655440000', scope: 'upload', upsert: false, exp: insideCeiling })}`,
      `https://attacker.invalid/object/upload/sign/ccc-audio/${OBJECT_KEY}?token=${downloadToken({ url: objectPath, scope: 'upload', upsert: false, exp: insideCeiling })}`,
    ];
    let providerIndex = 0;
    const handler = createStorageSignerHandler(config((async (input) => {
      if (String(input) === CALLBACK_URL) {
        return callbackResponse(decision(UPLOAD_HASH, '2026-09-11T02:00:00.000Z', { generationId: PENDING_GENERATION_ID }));
      }
      const url = providerUrls[providerIndex++]!;
      return new Response(JSON.stringify({ url }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch));

    for (let index = 0; index < providerUrls.length; index++) {
      const response = await handler(signerRequest(UPLOAD_REQUEST));
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(text).toBe('{"code":"STORAGE_UNAVAILABLE"}');
      expect(text).not.toContain('token=');
      expect(text).not.toContain('attacker');
    }
    expect(providerIndex).toBe(providerUrls.length);
  });

  it('pins the upload ceiling to the authorization expiry plus exactly two hours', async () => {
    const atCeiling = '2026-09-11T02:00:05.000Z';
    const token = downloadToken({
      url: `ccc-audio/${OBJECT_KEY}`, scope: 'upload', upsert: false, exp: Math.floor(Date.parse(atCeiling) / 1_000),
    });
    let decisionExpiresAt = atCeiling;
    let providerCalls = 0;
    const handler = createStorageSignerHandler(config((async (input) => {
      if (String(input) === CALLBACK_URL) {
        return callbackResponse(decision(UPLOAD_HASH, decisionExpiresAt, { generationId: PENDING_GENERATION_ID }));
      }
      providerCalls += 1;
      return new Response(JSON.stringify({ url: `/object/upload/sign/ccc-audio/${OBJECT_KEY}?token=${token}`, token }), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch));

    const accepted = await handler(signerRequest(UPLOAD_REQUEST));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({
      action: 'upload',
      url: `${STORAGE_BASE}/object/upload/sign/ccc-audio/${OBJECT_KEY}?token=${token}`,
      expiresAt: atCeiling,
      generationId: PENDING_GENERATION_ID,
    });

    decisionExpiresAt = '2026-09-11T02:00:06.000Z';
    const refused = await handler(signerRequest(UPLOAD_REQUEST));
    expect(refused.status).toBe(503);
    expect(await fixedError(refused)).toEqual({ code: 'AUTHORIZATION_INVALID' });
    expect(providerCalls).toBe(1);
  });

  it('rejects provider redirects, hostile signed URLs and raw provider errors without leaking them', async () => {
    const providerResponses = [
      new Response(null, { status: 302, headers: { location: 'https://attacker.invalid' } }),
      new Response(JSON.stringify({ signedURL: 'https://attacker.invalid/raw-audio?token=stolen' }), { status: 200, headers: { 'content-type': 'application/json' } }),
      new Response('provider-secret raw-audio-secret', { status: 500, headers: { 'content-type': 'text/plain' } }),
      signedUrlResponse({ url: `ccc-audio/${OBJECT_KEY}`, scope: 'download', versionId: GENERATION_ID, exp: Math.floor(Date.parse('2026-09-11T00:10:01.000Z') / 1_000) }),
      signedUrlResponse({ url: `ccc-audio/${OBJECT_KEY}`, scope: 'upload', versionId: GENERATION_ID, exp: Math.floor(Date.parse('2026-09-11T00:05:00.000Z') / 1_000) }),
      signedUrlResponse({ url: 'ccc-audio/audio/other/550e8400-e29b-41d4-a716-446655440000', scope: 'download', versionId: GENERATION_ID, exp: Math.floor(Date.parse('2026-09-11T00:05:00.000Z') / 1_000) }),
      signedUrlResponse({ url: `ccc-audio/${OBJECT_KEY}`, scope: 'download', versionId: 'other-version', exp: Math.floor(Date.parse('2026-09-11T00:05:00.000Z') / 1_000) }),
    ];
    let providerIndex = 0;
    const handler = createStorageSignerHandler(config((async (input) => {
      if (String(input) === CALLBACK_URL) return callbackResponse(decision(READ_HASH, '2026-09-11T00:10:00.000Z'));
      return providerResponses[providerIndex++]!;
    }) as typeof fetch));

    for (let index = 0; index < providerResponses.length; index++) {
      const response = await handler(signerRequest(READ_REQUEST));
      expect(response.status).toBe(502);
      const text = await response.text();
      expect(text).toBe('{"code":"STORAGE_UNAVAILABLE"}');
      expect(text).not.toContain('attacker');
      expect(text).not.toContain('provider-secret');
      expect(text).not.toContain('raw-audio-secret');
    }
  });

  it('proves absence from three fresh provider reads and one authorization', async () => {
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    const handler = createStorageSignerHandler(config((async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === CALLBACK_URL) return callbackResponse(decision(ABSENCE_HASH, null));
      if (url === LIST_URL) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ message: 'Object not found' }), {
        status: 404, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch));

    const response = await handler(signerRequest(ABSENCE_REQUEST));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      action: 'absence',
      generationId: GENERATION_ID,
      absentFromList: true,
      absentFromMetadata: true,
      directReadAbsent: true,
      verifiedAt: AUTHORIZED_AT,
    });
    expect(calls.map((call) => call.url)).toEqual([CALLBACK_URL, LIST_URL, INFO_URL, READ_URL]);
    expect(calls[1]?.init?.method).toBe('POST');
    expect(calls[1]?.init?.body).toBe(JSON.stringify({
      prefix: 'audio/session_01', search: '550e8400-e29b-41d4-a716-446655440000', limit: 10,
    }));
    expect(headersOf(calls[1]?.init).get('apikey')).toBe(SERVICE_ROLE_KEY);
    expect(headersOf(calls[3]?.init).get('range')).toBe('bytes=0-0');
    expect(calls[3]?.init?.redirect).toBe('error');
  });

  it('reports a live object of the same generation without reading one audio byte', async () => {
    const stream = countingBody();
    const handler = createStorageSignerHandler(config((async (input) => {
      const url = String(input);
      if (url === CALLBACK_URL) return callbackResponse(decision(ABSENCE_HASH, null));
      if (url === LIST_URL) {
        return new Response(JSON.stringify([{ name: '550e8400-e29b-41d4-a716-446655440000', version: GENERATION_ID }]), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (url === INFO_URL) {
        return new Response(JSON.stringify({ version: GENERATION_ID, size: 128, content_type: 'audio/wav' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(stream.body, { status: 206, headers: { 'content-type': 'audio/wav', 'content-range': 'bytes 0-0/128' } });
    }) as typeof fetch));

    const response = await handler(signerRequest(ABSENCE_REQUEST));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      absentFromList: false, absentFromMetadata: false, directReadAbsent: false,
    });
    expect(stream.reads()).toBe(0);
    expect(stream.cancelled()).toBe(true);
  });

  it('treats a listed object of another generation as absent for this generation', async () => {
    const handler = createStorageSignerHandler(config((async (input) => {
      const url = String(input);
      if (url === CALLBACK_URL) return callbackResponse(decision(ABSENCE_HASH, null));
      if (url === LIST_URL) {
        return new Response(JSON.stringify([{ name: '550e8400-e29b-41d4-a716-446655440000', version: 'version-9' }]), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (url === INFO_URL) {
        return new Response(JSON.stringify({ version: 'version-9', size: 128, content_type: 'audio/wav' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ message: 'Object not found' }), {
        status: 404, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch));

    expect(await (await handler(signerRequest(ABSENCE_REQUEST))).json()).toEqual({
      action: 'absence',
      generationId: GENERATION_ID,
      absentFromList: true,
      absentFromMetadata: true,
      directReadAbsent: true,
      verifiedAt: AUTHORIZED_AT,
    });
  });

  it('fails absence closed on a provider outage instead of answering with a boolean', async () => {
    const handler = createStorageSignerHandler(config((async (input) => {
      const url = String(input);
      if (url === CALLBACK_URL) return callbackResponse(decision(ABSENCE_HASH, null));
      if (url === LIST_URL) {
        return new Response('provider-secret raw-audio-secret', { status: 503, headers: { 'content-type': 'text/plain' } });
      }
      throw new Error('absence must stop at the first unavailable read');
    }) as typeof fetch));

    const response = await handler(signerRequest(ABSENCE_REQUEST));
    expect(response.status).toBe(502);
    const text = await response.text();
    expect(text).toBe('{"code":"STORAGE_UNAVAILABLE"}');
    expect(text).not.toContain('provider-secret');
  });

  it('proves an abandoned upload intent absent from an unbound key', async () => {
    const calls: Array<{ url: string; init?: RequestInit | undefined }> = [];
    const handler = createStorageSignerHandler(config((async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url === CALLBACK_URL) {
        return callbackResponse(decision(PENDING_ABSENCE_HASH, null, { generationId: PENDING_GENERATION_ID }));
      }
      if (url === LIST_URL) return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response(JSON.stringify({ message: 'Object not found' }), {
        status: 404, headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch));

    expect(await (await handler(signerRequest(PENDING_ABSENCE_REQUEST))).json()).toEqual({
      action: 'absence',
      generationId: null,
      absentFromList: true,
      absentFromMetadata: true,
      directReadAbsent: true,
      verifiedAt: AUTHORIZED_AT,
    });
    expect(calls.map((call) => call.url)).toEqual([CALLBACK_URL, LIST_URL, UNBOUND_INFO_URL, UNBOUND_READ_URL]);
  });

  it('refuses absence for an abandoned upload intent while any generation sits at the key', async () => {
    const handler = createStorageSignerHandler(config((async (input) => {
      const url = String(input);
      if (url === CALLBACK_URL) {
        return callbackResponse(decision(PENDING_ABSENCE_HASH, null, { generationId: PENDING_GENERATION_ID }));
      }
      if (url === LIST_URL) {
        return new Response(JSON.stringify([{ name: '550e8400-e29b-41d4-a716-446655440000' }]), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      if (url === UNBOUND_INFO_URL) {
        return new Response(JSON.stringify({ version: 'version-9', size: 128, content_type: 'audio/wav' }), {
          status: 200, headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(new Uint8Array([0x00]), { status: 206, headers: { 'content-type': 'audio/wav' } });
    }) as typeof fetch));

    expect(await (await handler(signerRequest(PENDING_ABSENCE_REQUEST))).json()).toMatchObject({
      generationId: null,
      absentFromList: false,
      absentFromMetadata: false,
      directReadAbsent: false,
    });
  });
});
