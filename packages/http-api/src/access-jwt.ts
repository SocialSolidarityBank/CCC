/**
 * access-jwt.ts — Cloudflare Access JWT(RS256) 검증 (WebCrypto 전용).
 *
 * identity.ts의 운영 인증 경로가 이 모듈만 호출하도록 얇게 분리했다. 하는 일:
 *   1. `Cf-Access-Jwt-Assertion` 헤더의 JWT를 파싱하고 alg=RS256을 강제한다.
 *   2. 팀 도메인 JWKS(`https://<team>/cdn-cgi/access/certs`)로 서명을 검증한다.
 *      JWKS는 모듈 스코프에 TTL(~1h)로 캐시하고, 캐시에 없는 kid(키 회전)면 재조회한다.
 *   3. claim을 검증한다: iss = https://<team>, aud에 ACCESS_AUD 포함, exp/nbf(±60s skew).
 *
 * PII·시크릿을 로그·에러에 남기지 않는다(R3). 검증 실패는 전부 AccessJwtError로 던지고,
 * 호출부가 이를 401(ActorAuthenticationError)로 매핑한다.
 *
 * 테스트 주입: JWKS 조회는 (a) verifyAccessJwt options.fetchJwks 또는
 * (b) __setAccessJwksFetcherForTests 모듈 훅으로 오버라이드할 수 있어, 실제 네트워크 없이
 * 라우트 레벨까지 구동할 수 있다.
 */

/** JWKS 응답의 개별 키(JWK). importKey('jwk')로 그대로 넘긴다. */
export interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  [key: string]: unknown;
}

export interface Jwks {
  keys: Jwk[];
}

/** Access JWT의 payload claim. Access는 사람 로그인에 email, 서비스 토큰에 common_name을 싣는다. */
export interface AccessClaims {
  iss: string;
  aud: string | string[];
  exp: number;
  nbf?: number;
  iat?: number;
  sub?: string;
  email?: string;
  common_name?: string;
  [key: string]: unknown;
}

export interface VerifyAccessJwtOptions {
  /** 예: "ggbss.cloudflareaccess.com". iss 검증과 JWKS 출처를 함께 결정한다. */
  teamDomain: string;
  /** 허용할 Access 애플리케이션 AUD 태그. claims.aud와 하나 이상 일치해야 한다. */
  aud: string | readonly string[];
  /** 현재 시각(ms) 공급자. 테스트 주입용, 기본 Date.now. */
  now?: () => number;
  /** exp/nbf 허용 오차(초). 기본 60. */
  clockSkewSec?: number;
  /** JWKS 조회 오버라이드(테스트). 기본은 전역 fetch. */
  fetchJwks?: (url: string) => Promise<Jwks>;
}

/** JWT 검증 실패(서명·claim·형식). 호출부가 401로 매핑한다. */
export class AccessJwtError extends Error {}

const JWKS_TTL_MS = 60 * 60 * 1000; // 1시간

interface CachedJwks {
  importedAt: number;
  keys: Map<string, CryptoKey>;
}

/** teamDomain → 임포트된 검증 키 캐시. 모듈 스코프(요청 간 공유). */
const jwksCache = new Map<string, CachedJwks>();

/** 테스트에서만 설정하는 JWKS 조회 오버라이드. 설정 시 캐시를 비운다. */
let testFetchOverride: ((url: string) => Promise<Jwks>) | null = null;

/** 테스트 전용: JWKS 조회를 오버라이드하고 캐시를 초기화한다. null로 원복. */
export function __setAccessJwksFetcherForTests(fetcher: ((url: string) => Promise<Jwks>) | null): void {
  testFetchOverride = fetcher;
  jwksCache.clear();
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function decodeJson<T>(segment: string): T {
  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment))) as T;
  } catch {
    throw new AccessJwtError('token segment is not valid base64url JSON');
  }
}

async function defaultFetchJwks(url: string): Promise<Jwks> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new AccessJwtError(`JWKS fetch failed with status ${response.status}`);
  }
  return (await response.json()) as Jwks;
}

async function importJwks(jwks: Jwks): Promise<Map<string, CryptoKey>> {
  const keys = new Map<string, CryptoKey>();
  for (const jwk of jwks.keys) {
    if (jwk.kid === undefined || jwk.kty !== 'RSA') {
      continue;
    }
    try {
      const key = await crypto.subtle.importKey(
        'jwk',
        jwk as unknown as JsonWebKey,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      keys.set(jwk.kid, key);
    } catch {
      // 개별 키 임포트 실패는 무시하고 다른 kid를 계속 시도한다.
    }
  }
  return keys;
}

/**
 * kid에 해당하는 검증 키를 캐시에서 찾거나 JWKS를 (재)조회해 얻는다.
 * 캐시 미스·TTL 만료·미지의 kid(키 회전) 중 하나면 재조회한다.
 */
async function resolveKey(
  teamDomain: string,
  kid: string,
  fetchJwks: (url: string) => Promise<Jwks>,
): Promise<CryptoKey> {
  const certsUrl = `https://${teamDomain}/cdn-cgi/access/certs`;
  const cached = jwksCache.get(teamDomain);
  const fresh = cached !== undefined && Date.now() - cached.importedAt <= JWKS_TTL_MS;

  if (cached !== undefined && fresh && cached.keys.has(kid)) {
    return cached.keys.get(kid) as CryptoKey;
  }

  const next: CachedJwks = { importedAt: Date.now(), keys: await importJwks(await fetchJwks(certsUrl)) };
  jwksCache.set(teamDomain, next);

  const key = next.keys.get(kid);
  if (key === undefined) {
    throw new AccessJwtError('no matching JWKS key for the token kid');
  }
  return key;
}

/**
 * Cloudflare Access JWT를 검증하고 claim을 돌려준다. 실패 시 AccessJwtError.
 * 검사 순서: 형식·alg → 서명(JWKS) → iss → aud → exp → nbf.
 */
export async function verifyAccessJwt(token: string, options: VerifyAccessJwtOptions): Promise<AccessClaims> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new AccessJwtError('token must have three segments');
  }
  const [headerSegment, payloadSegment, signatureSegment] = parts;
  if (headerSegment === undefined || payloadSegment === undefined || signatureSegment === undefined) {
    throw new AccessJwtError('token segments are missing');
  }

  const header = decodeJson<{ alg?: string; kid?: string }>(headerSegment);
  if (header.alg !== 'RS256') {
    throw new AccessJwtError('token alg must be RS256');
  }
  if (header.kid === undefined || header.kid.length === 0) {
    throw new AccessJwtError('token is missing a kid');
  }

  const fetchJwks = testFetchOverride ?? options.fetchJwks ?? defaultFetchJwks;
  const key = await resolveKey(options.teamDomain, header.kid, fetchJwks);

  const signingInput = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
  const valid = await crypto.subtle.verify(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    toArrayBuffer(base64UrlToBytes(signatureSegment)),
    toArrayBuffer(signingInput),
  );
  if (!valid) {
    throw new AccessJwtError('token signature verification failed');
  }

  const claims = decodeJson<AccessClaims>(payloadSegment);
  const nowSec = Math.floor((options.now ?? Date.now)() / 1000);
  const skew = options.clockSkewSec ?? 60;

  if (claims.iss !== `https://${options.teamDomain}`) {
    throw new AccessJwtError('token issuer mismatch');
  }
  // aud는 문자열 또는 문자열 배열이며, 위조·변형 토큰에선 누락될 수도 있으므로 방어적으로 정규화한다.
  const audClaim: unknown = claims.aud;
  const tokenAudiences = Array.isArray(audClaim) ? audClaim : typeof audClaim === 'string' ? [audClaim] : [];
  const acceptedAudiences = typeof options.aud === 'string' ? [options.aud] : options.aud;
  if (!acceptedAudiences.some((audience) => tokenAudiences.includes(audience))) {
    throw new AccessJwtError('token audience mismatch');
  }
  if (typeof claims.exp !== 'number') {
    throw new AccessJwtError('token is missing exp');
  }
  if (nowSec > claims.exp + skew) {
    throw new AccessJwtError('token has expired');
  }
  if (typeof claims.nbf === 'number' && nowSec + skew < claims.nbf) {
    throw new AccessJwtError('token is not yet valid');
  }

  return claims;
}
