import { NextRequest, NextResponse } from 'next/server';
import { AUTH_COOKIE_NAME } from '../../lib/auth-cookie';
import { signInWithPassword } from '../../lib/supabase-auth';
import { safeNextPath } from '../../lib/safe-next';


function errorRedirect(request: NextRequest, code: string, next: string): NextResponse {
  const destination = new URL('/login', request.url);
  destination.searchParams.set('error', code);
  if (next !== '/') destination.searchParams.set('next', next);
  return NextResponse.redirect(destination, 303);
}

/**
 * 로그인 POST 수신점. 비밀번호는 Supabase token 엔드포인트로만 가고 우리 서버에는
 * 저장도 로그도 하지 않는다. 성공하면 access token 을 HttpOnly 쿠키로 심고 303 으로
 * 보낸다 — 서버 액션 redirect 가 아니라 일반 POST 인 이유는 /preview/unlock 주석과 같다.
 *
 * 실패 사유를 가르지 않는다: Supabase 가 돌려주는 자격 오류(없는 이메일·틀린 비밀번호)는
 * 전부 같은 login_failed 다. 응답이 갈라지면 계정 존재 여부가 샌다.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // 로그인 CSRF를 막는다. 다른 사이트가 공격자 계정의 자격을 자동 제출해 피해자 브라우저에
  // 공격자 세션을 심지 못하게, 일반 폼 POST가 보내는 Origin이 현재 앱과 정확히 같아야 한다.
  const origin = request.headers.get('origin');
  if (origin === null || origin !== new URL(request.url).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const form = await request.formData();
  const next = safeNextPath(form.get('next'));
  const emailValue = form.get('email');
  const passwordValue = form.get('password');
  const email = typeof emailValue === 'string' ? emailValue.trim() : '';
  const password = typeof passwordValue === 'string' ? passwordValue : '';

  if (email.length === 0 || password.length === 0) {
    return errorRedirect(request, 'login_failed', next);
  }

  const result = await signInWithPassword(email, password);
  if (result.status !== 'ok') {
    const code = result.status === 'unavailable' ? 'service_unavailable'
      : result.status === 'confirm_email' ? 'confirm_email' : 'login_failed';
    return errorRedirect(request, code, next);
  }

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(AUTH_COOKIE_NAME, result.session.accessToken, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: result.session.expiresIn,
  });
  return response;
}
