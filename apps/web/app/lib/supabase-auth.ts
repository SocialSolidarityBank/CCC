import 'server-only';

/**
 * Supabase Auth 비밀번호 교환(서버 전용).
 *
 * 비밀번호와 발급 토큰은 이 파일 안에서만 살고 로그·응답 본문에 싣지 않는다.
 * SDK 를 쓰지 않는 이유: 여기서 필요한 것은 token 엔드포인트 왕복 한 번뿐이고,
 * SDK 는 브라우저 세션 관리(저장·자동 갱신)까지 끌고 온다. 같은 호출 모양은
 * apps/client/src/business/auth.ts 의 CloudAuth.signIn(signInWithPassword)과
 * completeInvite(signUp → 세션)가 정본이다.
 *
 * 설정은 서버 env 둘이다 — 브라우저 번들에 싣는 NEXT_PUBLIC_ 이 아니다:
 *   CCC_SUPABASE_AUTH_ORIGIN       예: https://<ref>.supabase.co
 *   CCC_SUPABASE_PUBLISHABLE_KEY   공개 가능한 publishable(anon) 키
 * 둘 중 하나라도 없으면 로그인 표면은 닫힌다(없음이 곧 닫힘 — PUBLIC_SIGNUP_ENABLED 와 같은 규약).
 */

/** 세션 하나. refresh token 은 받지도 저장하지도 않는다 — 만료되면 다시 로그인한다. */
export interface PasswordSession {
  accessToken: string;
  /** 쿠키 수명으로 그대로 쓰는 초 단위 수명. */
  expiresIn: number;
}

export type SignInResult =
  | { status: 'ok'; session: PasswordSession }
  /** 자격이 맞지 않는다. 이메일 존재 여부와 비밀번호 오류를 가르지 않는다. */
  | { status: 'invalid_credentials' }
  /** 자격은 맞지만 이메일 확인이 끝나지 않았다(공급자가 확인 메일을 요구하는 설치). */
  | { status: 'confirm_email' }
  | { status: 'unavailable' };

export type SignUpResult =
  | { status: 'ok'; session: PasswordSession }
  /** 가입은 됐지만 이메일 확인 전이라 세션이 없다. 확인 뒤 같은 화면에서 다시 제출하면 된다. */
  | { status: 'confirm_email' }
  /** 같은 이메일의 계정이 이미 있다 — 호출자는 로그인으로 이어간다. */
  | { status: 'already_registered' }
  /** 비밀번호 규칙 등 입력 거부. */
  | { status: 'rejected' }
  | { status: 'unavailable' };

interface SupabaseConfig {
  origin: string;
  publishableKey: string;
}

function supabaseConfig(): SupabaseConfig | null {
  const origin = process.env.CCC_SUPABASE_AUTH_ORIGIN;
  const publishableKey = process.env.CCC_SUPABASE_PUBLISHABLE_KEY;
  if (origin === undefined || publishableKey === undefined
    || origin.trim().length === 0 || publishableKey.trim().length === 0) {
    return null;
  }
  return { origin: origin.trim().replace(/\/+$/, ''), publishableKey: publishableKey.trim() };
}

function errorCode(payload: unknown): string {
  if (payload === null || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const code = record.error_code ?? record.code ?? record.error;
  return typeof code === 'string' ? code : '';
}

function sessionFrom(payload: unknown): PasswordSession | null {
  if (payload === null || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.access_token !== 'string' || record.access_token.length === 0) return null;
  const expiresIn = typeof record.expires_in === 'number' && record.expires_in > 0
    ? Math.floor(record.expires_in)
    : 3600;
  return { accessToken: record.access_token, expiresIn };
}

async function authPost(config: SupabaseConfig, path: string, body: Record<string, string>): Promise<Response | null> {
  try {
    return await fetch(`${config.origin}/auth/v1${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json; charset=utf-8',
        apikey: config.publishableKey,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    return null;
  }
}

export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  const config = supabaseConfig();
  if (config === null) return { status: 'unavailable' };
  const response = await authPost(config, '/token?grant_type=password', { email, password });
  if (response === null) return { status: 'unavailable' };
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = errorCode(payload);
    if (code === 'email_not_confirmed') return { status: 'confirm_email' };
    // invalid_credentials·invalid_grant·user_not_found 등 4xx 는 전부 같은 실패다 —
    // 어느 쪽이 틀렸는지 응답이 갈라지면 계정 존재 여부가 샌다.
    return response.status >= 500 ? { status: 'unavailable' } : { status: 'invalid_credentials' };
  }
  const session = sessionFrom(payload);
  return session === null ? { status: 'unavailable' } : { status: 'ok', session };
}

export async function signUpWithPassword(email: string, password: string): Promise<SignUpResult> {
  const config = supabaseConfig();
  if (config === null) return { status: 'unavailable' };
  const response = await authPost(config, '/signup', { email, password });
  if (response === null) return { status: 'unavailable' };
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = errorCode(payload);
    if (code === 'user_already_exists' || code === 'email_exists') return { status: 'already_registered' };
    return response.status >= 500 ? { status: 'unavailable' } : { status: 'rejected' };
  }
  const session = sessionFrom(payload);
  // 이메일 확인을 켠 설치는 가입 응답에 세션을 싣지 않는다 — 확인 메일이 가는 상태다.
  return session === null ? { status: 'confirm_email' } : { status: 'ok', session };
}

/**
 * 초대 수락용 세션 확보. 기존 계정부터 로그인하고, 자격이 없는 경우에만 가입한다.
 * Supabase 는 계정 열거 방지를 위해 기존 이메일의 가입도 성공+무세션으로 응답할 수 있으므로
 * 가입부터 하면 확인을 마친 사용자가 영원히 confirm_email 에 머물 수 있다.
 */
export async function signInOrSignUpWithPassword(email: string, password: string): Promise<SignInResult> {
  const signIn = await signInWithPassword(email, password);
  if (signIn.status !== 'invalid_credentials') return signIn;

  const signUp = await signUpWithPassword(email, password);
  if (signUp.status === 'ok' || signUp.status === 'confirm_email' || signUp.status === 'unavailable') {
    return signUp;
  }
  if (signUp.status === 'already_registered') return signInWithPassword(email, password);
  return { status: 'invalid_credentials' };
}
