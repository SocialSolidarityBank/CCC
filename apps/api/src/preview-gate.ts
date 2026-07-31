/**
 * preview-gate.ts — 미리보기 전용 코드 게이트 (CCC-6, 운영 무영향 — 이중 잠금).
 *
 * 배경: 팀원이 Cloudflare Access 없이 링크+지정 코드만으로 개발 중 서비스를 보는
 * 미리보기 환경(전용 워커 env.preview + 가상 시드 D1)이 필요하다. Access JWT 검증
 * 대신 코드 게이트로 신원을 공급하되, 운영 워커에는 절대 열리면 안 된다.
 *
 * 이중 잠금(local-actor.ts 와 동일 패턴):
 *   ① PREVIEW_MODE === 'true' — wrangler.toml [env.preview.vars] 에만 있고 운영 env 에는 없다.
 *   ② Access 설정(ACCESS_TEAM_DOMAIN·ACCESS_AUD)이 하나라도 있으면 무조건 비활성 —
 *      운영에 ①이 실수로 새어 들어가도 코드 게이트가 열리지 않는다.
 * 추가로 PREVIEW_ACCESS_CODE 가 비어 있으면 활성화하지 않는다(코드 없는 게이트 방지).
 *
 * 흐름:
 *   POST /preview/unlock { code } → PREVIEW_ACCESS_CODE 와 상수시간 비교 →
 *   서명 토큰(HMAC-SHA256, exp 7일) 발급(HttpOnly·Secure·SameSite=Strict 쿠키 + 응답 본문).
 *   이후 요청은 쿠키의 토큰을 검증하고, 통과 시 고정 데모 실무자(PREVIEW_ACTOR_EMAIL)
 *   신원으로 동작한다 — 신원 자체는 users 디렉터리 조회로 정하므로 권한 모델은 그대로다.
 *
 * PREVIEW_ACCESS_CODE 값은 로그·에러·응답에 절대 싣지 않는다(이름만 커밋).
 */
import { findUserByEmail, ForbiddenError, type Actor } from '../../../db/gateway';
import { ActorAuthenticationError, type ApiEnv } from './identity';
import type { ActorResolver } from './request-handler';

/** 미리보기 세션 토큰 쿠키 이름. 웹 도메인·API 양쪽에서 이 이름으로만 오간다. */
export const PREVIEW_COOKIE_NAME = 'ccc_preview';

/** 토큰(그리고 쿠키) 수명: 7일. */
const PREVIEW_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const PREVIEW_TOKEN_TTL_MS = PREVIEW_TOKEN_TTL_SECONDS * 1000;

/** 서명 대상 접두사(버전 태그). 형식이 바뀌면 v2 로 올려 기존 토큰을 무효화한다. */
const SIGNED_PREFIX = 'preview.v1.';

function accessConfigured(env: ApiEnv): boolean {
  return (env.ACCESS_TEAM_DOMAIN?.trim().length ?? 0) > 0
    || (env.ACCESS_AUD?.trim().length ?? 0) > 0;
}

/**
 * 미리보기 코드 게이트가 활성인가. 이중 잠금 + 코드 존재를 모두 만족해야 true.
 * 운영(Access 설정됨)에서는 PREVIEW_MODE 가 새어 들어와도 항상 false.
 */
export function previewModeEnabled(env: ApiEnv): boolean {
  if (env.PREVIEW_MODE !== 'true') return false;
  if (accessConfigured(env)) return false;
  return (env.PREVIEW_ACCESS_CODE?.length ?? 0) > 0;
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

/** 길이가 같은 두 바이트열의 상수시간 동등 비교. 길이가 다르면 즉시 false. */
function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let index = 0; index < a.byteLength; index += 1) diff |= a[index]! ^ b[index]!;
  return diff === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', toArrayBuffer(new TextEncoder().encode(value)));
  return new Uint8Array(digest);
}

/**
 * 제출 코드와 지정 코드를 상수시간으로 비교한다. 값 자체 대신 SHA-256 다이제스트를
 * 비교해 길이·내용 노출 없이 항상 32바이트 고정 길이로 대조한다.
 */
async function codeMatches(submitted: string, expected: string): Promise<boolean> {
  const [submittedDigest, expectedDigest] = await Promise.all([sha256(submitted), sha256(expected)]);
  return constantTimeEqual(submittedDigest, expectedDigest);
}

/**
 * 관리자 시점이 설정돼 있는가. 코드와 이메일이 **둘 다** 있어야 한다 — 하나만 있으면
 * 설정을 하다 만 상태이고, 그 상태에서 열어 주면 의도하지 않은 권한이 생긴다.
 */
function adminPreviewConfigured(env: ApiEnv): boolean {
  return (env.PREVIEW_ADMIN_ACCESS_CODE?.length ?? 0) > 0
    && (env.PREVIEW_ADMIN_ACTOR_EMAIL?.trim().length ?? 0) > 0;
}

/**
 * 제출 코드가 어느 지정 코드와 맞는지 찾아 **그 코드 자체**를 돌려준다(서명 키가 된다).
 * 맞는 것이 없으면 null. 어느 쪽이 틀렸는지는 호출부에도 알리지 않는다 — 응답이 하나여야
 * 코드의 존재 여부가 새지 않는다.
 *
 * 두 코드를 **항상 둘 다** 비교한다. 첫 번째에서 일찍 빠져나오면 응답 시간이 갈려
 * "관리자 코드가 있다"는 사실이 드러난다.
 */
/**
 * 종단 점검(E2E) 시점이 설정돼 있는가. 코드와 **장비 신원 이메일**이 둘 다 있어야 한다.
 *
 * 왜 필요한가: 처리 장비용 엔드포인트는 `service` 역할 전용인데, 미리보기는 Access 를
 * 쓰지 않아 서비스 토큰이 없다. 그래서 이 환경에서는 "수기 저장 → 장비 마스킹 →
 * 불일치 검출" 종단 경로를 한 번도 실물로 확인할 수 없었다(ADR-0027 를 만든 뒤 실측 불가).
 * 이 코드는 그 구간을 미리보기에서 돌리기 위한 것이다.
 */
function e2ePreviewConfigured(env: ApiEnv): boolean {
  return (env.PREVIEW_E2E_ACCESS_CODE?.length ?? 0) > 0
    && (env.PREVIEW_SERVICE_ACTOR_EMAIL?.trim().length ?? 0) > 0;
}

/**
 * E2E 코드로 들어왔을 때 쓸 수 있는 신원 목록. **환경 변수에 적힌 이메일만** 허용한다 —
 * 임의 이메일을 헤더로 받으면 디렉터리의 아무 사용자나 될 수 있어 게이트의 의미가 없어진다.
 * 기본값은 장비(service)다.
 */
function e2eActorAllowList(env: ApiEnv): string[] {
  return [
    env.PREVIEW_SERVICE_ACTOR_EMAIL,
    env.PREVIEW_ACTOR_EMAIL,
    env.PREVIEW_ADMIN_ACTOR_EMAIL,
  ]
    .map((value) => value?.trim() ?? '')
    .filter((value) => value.length > 0);
}

/**
 * E2E 코드로 들어온 요청의 신원 이메일을 정한다. 허용 목록 밖이거나 헤더가 없으면
 * 장비(service)로 떨어진다 — 이 함수가 미리보기에서 신원이 넓어지는 유일한 지점이라
 * 테스트로 직접 고정한다.
 */
export function resolvePreviewE2eActorEmail(env: ApiEnv, requested: string | null): string | undefined {
  const wanted = requested?.trim() ?? '';
  if (wanted.length > 0 && e2eActorAllowList(env).includes(wanted)) return wanted;
  return env.PREVIEW_SERVICE_ACTOR_EMAIL?.trim();
}

async function resolveSigningCode(env: ApiEnv, submitted: string): Promise<string | null> {
  const expected = env.PREVIEW_ACCESS_CODE ?? '';
  const adminExpected = adminPreviewConfigured(env) ? env.PREVIEW_ADMIN_ACCESS_CODE! : null;
  const e2eExpected = e2ePreviewConfigured(env) ? env.PREVIEW_E2E_ACCESS_CODE! : null;
  const [matchesUser, matchesAdmin, matchesE2e] = await Promise.all([
    expected.length > 0 ? codeMatches(submitted, expected) : Promise.resolve(false),
    adminExpected === null ? Promise.resolve(false) : codeMatches(submitted, adminExpected),
    e2eExpected === null ? Promise.resolve(false) : codeMatches(submitted, e2eExpected),
  ]);
  if (matchesUser) return expected;
  if (matchesAdmin) return adminExpected;
  if (matchesE2e) return e2eExpected;
  return null;
}

async function hmacKey(code: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    toArrayBuffer(new TextEncoder().encode(code)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function signExpiry(code: string, expMs: number): Promise<Uint8Array> {
  const key = await hmacKey(code);
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    toArrayBuffer(new TextEncoder().encode(`${SIGNED_PREFIX}${expMs}`)),
  );
  return new Uint8Array(signature);
}

/** `<expMs>.<sigBase64Url>` 형식의 서명 토큰을 만든다. */
async function mintToken(code: string, now: number): Promise<{ token: string; expMs: number }> {
  const expMs = now + PREVIEW_TOKEN_TTL_MS;
  const signature = await signExpiry(code, expMs);
  return { token: `${expMs}.${bytesToBase64Url(signature)}`, expMs };
}

/** 토큰의 서명·만료를 검증한다. 유효하면 true. 어떤 실패도 이유를 노출하지 않는다. */
async function verifyToken(code: string, token: string, now: number): Promise<boolean> {
  const separator = token.indexOf('.');
  if (separator <= 0) return false;
  const expPart = token.slice(0, separator);
  const sigPart = token.slice(separator + 1);
  if (!/^[0-9]{1,15}$/.test(expPart)) return false;
  const expMs = Number(expPart);
  if (!Number.isSafeInteger(expMs) || expMs <= now) return false;

  const providedSignature = base64UrlToBytes(sigPart);
  if (providedSignature === null) return false;
  const expectedSignature = await signExpiry(code, expMs);
  return constantTimeEqual(providedSignature, expectedSignature);
}

function previewCookie(token: string): string {
  return `${PREVIEW_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${PREVIEW_TOKEN_TTL_SECONDS}`;
}

function previewTokenFromCookies(request: Request): string | null {
  const header = request.headers.get('Cookie');
  if (header === null) return null;
  for (const segment of header.split(';')) {
    const cookie = segment.trim();
    const separator = cookie.indexOf('=');
    if (separator === -1 || cookie.slice(0, separator) !== PREVIEW_COOKIE_NAME) continue;
    const value = cookie.slice(separator + 1);
    if (value.length > 0) return value;
  }
  return null;
}

function jsonResponse(body: unknown, status: number, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

/**
 * POST /preview/unlock 처리. previewModeEnabled 가 true 일 때만 index.ts 가 호출한다.
 * 방어적으로 여기서도 재확인해 운영에서는 어떤 데이터도 반환하지 않는다(fail closed).
 * 성공: 200 + { token, maxAgeSeconds } + Set-Cookie. 실패(잘못된 코드·형식): 401, 본문·쿠키 없음.
 */
export async function handlePreviewUnlock(request: Request, env: ApiEnv, now: number = Date.now()): Promise<Response> {
  if (!previewModeEnabled(env)) return jsonResponse({ error: 'not_found' }, 404);

  const expectedCode = env.PREVIEW_ACCESS_CODE;
  if (expectedCode === undefined || expectedCode.length === 0) {
    return jsonResponse({ error: 'actor_authentication_required' }, 401);
  }

  let submittedCode: unknown;
  try {
    const body: unknown = await request.json();
    submittedCode = body !== null && typeof body === 'object' ? (body as Record<string, unknown>).code : undefined;
  } catch {
    submittedCode = undefined;
  }

  if (typeof submittedCode !== 'string' || submittedCode.length === 0) {
    return jsonResponse({ error: 'actor_authentication_required' }, 401);
  }

  // 어느 코드로 들어왔는지가 곧 신원이다 — 토큰은 그 코드를 HMAC 키로 서명하므로
  // 형식을 바꾸지 않고도 리졸버가 코드별로 갈라 검증할 수 있다(아래 previewActorResolver).
  const signingCode = await resolveSigningCode(env, submittedCode);
  if (signingCode === null) {
    return jsonResponse({ error: 'actor_authentication_required' }, 401);
  }

  const { token, expMs } = await mintToken(signingCode, now);
  return jsonResponse(
    { token, maxAgeSeconds: PREVIEW_TOKEN_TTL_SECONDS, expiresAt: new Date(expMs).toISOString() },
    200,
    { 'set-cookie': previewCookie(token) },
  );
}

/**
 * 미리보기 신원 리졸버. previewModeEnabled 가 아니면 undefined(운영·로컬 경로 불변).
 * 활성이면 쿠키의 서명 토큰을 검증하고, 통과 시 고정 데모 실무자(PREVIEW_ACTOR_EMAIL)를
 * users 디렉터리에서 조회해 신원을 정한다.
 *   401(ActorAuthenticationError): 쿠키 없음 / 토큰 서명·만료 실패 / 코드 미설정.
 *   403(ForbiddenError): 토큰은 유효하나 데모 실무자가 디렉터리에 없거나 비활성.
 */
export function previewActorResolver(env: ApiEnv): ActorResolver | undefined {
  if (!previewModeEnabled(env)) return undefined;

  return async (request: Request, runtimeEnv: ApiEnv): Promise<Actor> => {
    const expectedCode = runtimeEnv.PREVIEW_ACCESS_CODE;
    if (expectedCode === undefined || expectedCode.length === 0) {
      throw new ActorAuthenticationError('preview access code is not configured');
    }
    const token = previewTokenFromCookies(request);
    if (token === null) {
      throw new ActorAuthenticationError('a valid preview session cookie is required');
    }

    // 토큰은 발급에 쓰인 코드를 HMAC 키로 서명했다 — 어느 코드로 검증되는지가 곧 신원이다.
    // 실무자 코드를 먼저 본다: 관리자 코드는 있을 수도 없을 수도 있고, 없으면 그 경로 자체가 없다.
    const now = Date.now();
    let email = runtimeEnv.PREVIEW_ACTOR_EMAIL?.trim();
    if (!(await verifyToken(expectedCode, token, now))) {
      const adminCode = adminPreviewConfigured(runtimeEnv) ? runtimeEnv.PREVIEW_ADMIN_ACCESS_CODE! : null;
      const e2eCode = e2ePreviewConfigured(runtimeEnv) ? runtimeEnv.PREVIEW_E2E_ACCESS_CODE! : null;
      if (adminCode !== null && await verifyToken(adminCode, token, now)) {
        email = runtimeEnv.PREVIEW_ADMIN_ACTOR_EMAIL?.trim();
      } else if (e2eCode !== null && await verifyToken(e2eCode, token, now)) {
        // 종단 점검 시점: 헤더로 신원을 고르되 **환경 변수에 적힌 이메일만** 허용한다.
        // 헤더가 없거나 목록에 없으면 장비(service)로 떨어진다.
        email = resolvePreviewE2eActorEmail(runtimeEnv, request.headers.get('X-CCC-Preview-Actor'));
      } else {
        throw new ActorAuthenticationError('a valid preview session cookie is required');
      }
    }

    if (email === undefined || email.length === 0) {
      throw new ActorAuthenticationError('PREVIEW_ACTOR_EMAIL is required for preview identity');
    }
    const user = await findUserByEmail(runtimeEnv, email);
    if (user === null || !user.active) {
      throw new ForbiddenError('preview identity is not provisioned in the user directory');
    }
    return { userId: user.id, orgId: user.orgId, role: user.role };
  };
}
