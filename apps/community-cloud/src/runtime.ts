import { assertPostgresIdentityBoundary, type PostgresDatabase } from '@ccc/db-postgres';
import { createSupabaseIdentity } from '@ccc/identity-supabase';
import type { SecretStore } from '@ccc/contracts/runtime';
import { ForbiddenError } from '@ccc/core/gateway';
import { handleRequest } from '@ccc/http-api';
import { verifiedInstallManifest } from '@ccc/http-api/capabilities';
import type { ApiEnv } from '@ccc/http-api/identity';

export interface CommunityCloudRuntimeConfig {
  database: PostgresDatabase;
  secretStore: SecretStore;
  organizationId: string;
  installManifest: string;
  signingKeys: string;
  fetch?: typeof globalThis.fetch;
  /** Container ingress terminates HTTPS; accept HTTP only for the exact signed host. */
  allowHttpIngress?: boolean;
  settings?: Pick<ApiEnv,
    'CCC_STT_MODE' | 'CCC_LLM_MODE' | 'TEXT_AI_PILOT_ENABLED'
    | 'EXTERNAL_AI_CALLS_ENABLED' | 'PUBLIC_SIGNUP_ENABLED' | 'PII_PURGE_ENABLED' | 'PII_KEY_VERSION'>;
}

const METHODS: Record<string, true> = { GET: true, POST: true, PUT: true, PATCH: true, DELETE: true };
const REQUEST_HEADERS: Record<string, true> = {
  authorization: true, 'content-type': true, 'idempotency-key': true, 'x-request-id': true, 'x-region': true,
};
const ALLOWED_REQUEST_HEADERS = Object.keys(REQUEST_HEADERS).join(', ');

/** Independent business runtime; no business request passes through the static client host. */
export async function createCommunityCloudRuntime(config: CommunityCloudRuntimeConfig): Promise<(request: Request) => Promise<Response>> {
  if (config.organizationId.trim().length === 0) throw new Error('installation_invalid');
  // S11 permits this credential only in StorageSigner, never the business runtime.
  if (await config.secretStore.get('SUPABASE_SERVICE_ROLE_KEY') !== null) {
    throw new Error('storage_signer_required');
  }
  const installation = {
    CCC_INSTALL_MANIFEST: config.installManifest,
    CCC_INSTALL_SIGNING_KEYS: config.signingKeys,
  };
  const manifest = await verifiedInstallManifest(installation);
  if (manifest.mode !== 'community-cloud' || manifest.supabaseAuthOrigin === null) {
    throw new Error('installation_invalid');
  }
  const apiBase = new URL(manifest.apiBase);
  const routePrefix = apiBase.pathname;
  const prefixWithSlash = routePrefix.endsWith('/') ? routePrefix : `${routePrefix}/`;
  const expiresAt = Date.parse(manifest.expiresAt);
  const allowedOrigins = new Set(manifest.allowedOrigins);
  await assertPostgresIdentityBoundary(config.database);
  const baseEnvironment: ApiEnv = {
    ...config.settings,
    ...installation,
    installationMode: manifest.mode,
    DB: config.database.forActor({ orgId: config.organizationId, actorId: 'identity-directory' }),
    secretStore: config.secretStore,
    audioStore: null,
  };
  const identity = createSupabaseIdentity(baseEnvironment, {
    issuer: `${manifest.supabaseAuthOrigin}/auth/v1`,
    ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    jwksUri: `${manifest.supabaseAuthOrigin}/auth/v1/.well-known/jwks.json`,
    databaseForSession: (subject, sessionId) => config.database.forActor({
      orgId: config.organizationId, actorId: subject, sessionId,
    }),
  });

  return async (request) => {
    const url = new URL(request.url);
    // Reserved transport probe: no identity/configuration headers and no DB access.
    if (url.pathname === '/readyz') {
      const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, { status: 405, headers: { ...headers, allow: 'GET, HEAD' } });
      }
      const ready = Date.now() < expiresAt;
      return new Response(request.method === 'HEAD' ? null : JSON.stringify({ status: ready ? 'ready' : 'unavailable' }), {
        status: ready ? 200 : 503, headers,
      });
    }
    if (config.allowHttpIngress === true && url.protocol === 'http:' && url.host === apiBase.host) {
      url.protocol = apiBase.protocol;
    }
    const origin = request.headers.get('origin');
    const permittedOrigin = origin !== null && allowedOrigins.has(origin);
    const headers = new Headers({
      'cache-control': 'no-store',
      'vary': 'Origin',
      'x-ccc-installation-id': manifest.installationId,
      ...(permittedOrigin ? {
        'access-control-allow-origin': origin,
        'access-control-expose-headers': 'X-CCC-Installation-Id',
      } : {}),
    });
    const failure = (status: number, error: string) => {
      headers.set('content-type', 'application/json; charset=utf-8');
      return new Response(JSON.stringify({ error }), { status, headers });
    };
    if (Date.now() >= expiresAt) return failure(503, 'service_unavailable');
    if (origin !== null && !permittedOrigin) return failure(403, 'forbidden');
    if (url.origin !== apiBase.origin) return failure(403, 'forbidden');
    if (url.pathname !== routePrefix && !url.pathname.startsWith(prefixWithSlash)) {
      return failure(404, 'not_found');
    }
    if (request.method === 'OPTIONS') {
      const method = request.headers.get('access-control-request-method');
      const requestedHeaders = (request.headers.get('access-control-request-headers') ?? '')
        .split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
      if (!permittedOrigin || method === null || !Object.hasOwn(METHODS, method)
        || requestedHeaders.some((value) => !Object.hasOwn(REQUEST_HEADERS, value))) return failure(403, 'forbidden');
      headers.set('access-control-allow-methods', Object.keys(METHODS).join(', '));
      headers.set('access-control-allow-headers', ALLOWED_REQUEST_HEADERS);
      return new Response(null, { status: 204, headers });
    }
    if (!Object.hasOwn(METHODS, request.method)) return failure(405, 'method_not_allowed');
    url.pathname = url.pathname === routePrefix ? '/' : `/${url.pathname.slice(prefixWithSlash.length)}`;
    const mediaType = (request.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase() ?? '';
    if (mediaType.startsWith('audio/') || mediaType.startsWith('multipart/')
      || mediaType === 'application/octet-stream'
      || request.method === 'PUT' && /^\/sessions\/[^/]+\/audio$/.test(url.pathname)) {
      await request.body?.cancel().catch(() => undefined);
      return failure(415, 'AUDIO_BODY_FORBIDDEN');
    }
    const environment = { ...baseEnvironment };
    const response = await handleRequest(new Request(url, request), environment, async (credentialRequest) => {
      const actor = await identity.resolve(credentialRequest);
      if (actor.orgId !== config.organizationId) throw new ForbiddenError('identity is outside this installation');
      environment.DB = config.database.forActor({
        orgId: actor.orgId, actorId: actor.userId,
        ...(actor.authn.sessionId === null ? {} : { sessionId: actor.authn.sessionId }),
      });
      return actor;
    });
    for (const [name, value] of headers) response.headers.set(name, value);
    return response;
  };
}
