/**
 * ccc-api 의 Supabase Auth 사람 신원 레인 (앱 직접 로그인).
 *
 * 신뢰 근거는 배포자가 넣은 `SUPABASE_AUTH_ORIGIN` 하나다 — issuer·JWKS 주소는 그
 * origin 에서만 파생하고, 요청이나 토큰 claim 에서는 절대 오지 않는다
 * (community-cloud runtime.ts 가 manifest 의 supabaseAuthOrigin 을 쓰는 것과 같은 모양).
 * 값이 없으면 이 레인 자체가 없다: 반환값 undefined 는 "Supabase 경로 없음" 이고
 * 호출자는 Access 레인만 둔다. 없음이 곧 닫힘이다.
 *
 * 레인 구분은 자격 형태 하나다. `Authorization: Bearer <header>.<payload>.<sig>` 형태의
 * JWT 만 이 레인이 받고, 그 외 요청(Cf-Access-Jwt-Assertion 만 있거나 Bearer 가 없는
 * 요청)은 Access 레인으로 흐른다. Agent bearer(43자 opaque)는 이 정규식에 걸리지 않아
 * agent-bearer 레인과 섞이지 않는다.
 */
import { createSupabaseIdentity, type SupabaseIdentity } from '@ccc/identity-supabase';
import type { ApiEnv } from '@ccc/http-api/identity';

/** Supabase access token 형태 — 세 구간 base64url JWT. 이것만 Supabase 레인이 본다. */
const SUPABASE_BEARER = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/i;

export function hasSupabaseBearerCredential(request: Request): boolean {
  return SUPABASE_BEARER.test(request.headers.get('authorization') ?? '');
}

/**
 * SUPABASE_AUTH_ORIGIN 이 있을 때만 Supabase 신원을 만든다. 형식이 잘못된 값은
 * createSupabaseIdentity 가 IdentityStoreUnavailableError 로 fail closed 한다.
 * databaseForSession 은 넘기지 않는다 — community-cloud 가 세션별 Postgres 범위를
 * 나누기 위해 쓰는 옵션이고, ccc-api 는 D1 바인딩 하나가 곧 디렉터리라 env 그대로다.
 */
export function createWorkerSupabaseIdentity(env: ApiEnv): SupabaseIdentity | undefined {
  const origin = env.SUPABASE_AUTH_ORIGIN?.trim();
  if (origin === undefined || origin.length === 0) return undefined;
  return createSupabaseIdentity(env, {
    issuer: `${origin}/auth/v1`,
    jwksUri: `${origin}/auth/v1/.well-known/jwks.json`,
    ...(testFetch === undefined ? {} : { fetch: testFetch }),
  });
}

// ── 테스트 전용 JWKS fetch 주입 (identity-access 의 __setAccessJwksFetcherForTests 와 같은 훅) ──
let testFetch: typeof globalThis.fetch | undefined;
export function __setSupabaseJwksFetchForTests(fetcher: typeof globalThis.fetch | undefined): void {
  testFetch = fetcher;
}
