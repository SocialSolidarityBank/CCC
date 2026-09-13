import { createSignerAudioStore } from '@ccc/audio-signer';
import { assertPostgresIdentityBoundary, type PostgresDatabase } from '@ccc/db-postgres';
import { createSupabaseIdentity } from '@ccc/identity-supabase';
import type { SecretStore } from '@ccc/contracts/runtime';
import { ForbiddenError } from '@ccc/core/gateway';
import { handleRequest } from '@ccc/http-api';
import { verifiedInstallManifest } from '@ccc/http-api/capabilities';
import type { ApiEnv } from '@ccc/http-api/identity';
import { createSchedulerSecretResolver } from '@ccc/http-api/scheduler-identity';
import { createAgentBearerResolver } from '@ccc/http-api/agent-identity';

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
  // S11 §2.7: the Signer address comes from the signed manifest alone, never from unsigned env.
  const signerUrl = `${manifest.supabaseAuthOrigin}/functions/v1/ccc-storage-signer`;
  await assertPostgresIdentityBoundary(config.database);
  const baseEnvironment: ApiEnv = {
    ...config.settings,
    ...installation,
    installationMode: manifest.mode,
    installationOrgId: config.organizationId,
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
  // D80 첫 로그인 연결은 사람 신원 해석 앞단에서 이 포트만 쓴다(MFA 관문·디렉터리 조회 없음).
  baseEnvironment.verifyIdentityLinkClaims = (linkRequest) => identity.verifyLinkClaims(linkRequest);
  const resolveBusinessActor = createAgentBearerResolver({
    inner: (credentialRequest) => identity.resolve(credentialRequest),
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
    // S11 §2.7: the caller's own Bearer travels to the Signer, which asks this API back.
    const environment: ApiEnv = {
      ...baseEnvironment,
      audioStore: createSignerAudioStore({
        signerUrl,
        authorization: request.headers.get('authorization'),
        installationId: manifest.installationId,
        ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
      }),
    };
    // S2 §2.6 scheduler lane 은 사람 신원 앞단에 온다. 비밀이 없거나 다르면 그대로 아래로 흐른다.
    // 그 다음이 S2 §2.2 L64 의 agent-bearer 레인이고, 사람 신원은 마지막이다. 세 레인이
    // 같은 자리에서 요청별 DB 범위를 정하므로 Agent 도 사람과 같은 경계를 지난다.
    const response = await handleRequest(new Request(url, request), environment, createSchedulerSecretResolver({
      secretStore: config.secretStore,
      organizationId: config.organizationId,
      inner: async (credentialRequest, credentialEnv) => {
        const actor = await resolveBusinessActor(credentialRequest, credentialEnv);
        if (actor.orgId !== config.organizationId) throw new ForbiddenError('identity is outside this installation');
        const sessionId = 'kind' in actor ? actor.authn.sessionId : null;
        environment.DB = config.database.forActor({
          orgId: config.organizationId, actorId: actor.userId,
          ...(sessionId === null ? {} : { sessionId }),
        });
        return actor;
      },
    }));
    for (const [name, value] of headers) response.headers.set(name, value);
    return response;
  };
}
