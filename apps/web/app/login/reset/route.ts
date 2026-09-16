import { NextRequest, NextResponse } from 'next/server';
import { requestPasswordReset } from '../../lib/supabase-auth';

/**
 * 비밀번호 재설정 메일 요청 수신점. 이메일은 Supabase recover 엔드포인트로만 가고
 * 우리 서버에는 저장도 로그도 하지 않는다.
 *
 * 계정 존재 여부를 가르지 않는다: 등록된 이메일이든 아니든 같은 303 + 같은 문구로
 * 돌아간다. 응답이 갈라지면 누가 가입했는지 샌다.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // /login/unlock 과 같은 이유로 Origin 을 본다 — 남의 사이트가 임의 POST 를 못 보낸다.
  const origin = request.headers.get('origin');
  if (origin === null || origin !== new URL(request.url).origin) {
    return new NextResponse('Forbidden', { status: 403 });
  }
  const form = await request.formData();
  const emailValue = form.get('email');
  const email = typeof emailValue === 'string' ? emailValue.trim() : '';

  const destination = new URL('/login', request.url);
  if (email.length === 0) {
    // 빈 이메일은 요청을 보내지 않고 조용히 돌려보낸다 — 보낸 것처럼 안내하면 거짓말이다.
    return NextResponse.redirect(destination, 303);
  }

  // 메일 링크가 검증 뒤 착지할 우리 화면. 요청 출처를 쓰므로 운영·로컬이 각각 자기
  // 주소를 넣는다 — Supabase allow-list 에 없는 주소면 site_url 로 떨어진다.
  const redirectTo = new URL('/password', request.url).toString();
  const result = await requestPasswordReset(email, redirectTo);
  if (result.status === 'unavailable') {
    destination.searchParams.set('error', 'reset_unavailable');
  } else {
    destination.searchParams.set('notice', 'reset_sent');
  }
  return NextResponse.redirect(destination, 303);
}
