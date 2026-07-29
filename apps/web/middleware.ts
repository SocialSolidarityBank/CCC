import { NextResponse, type NextRequest } from 'next/server';

const PREVIEW_COOKIE_NAME = 'ccc_preview';

/**
 * 미리보기 코드 게이트 유도(CCC-6). CCC_PREVIEW='true' 인 미리보기 워커에서만 동작한다 —
 * 그 외(운영·로컬)에서는 즉시 통과해 아무 동작도 하지 않는다.
 *
 * 미리보기에서 세션 쿠키가 없으면 진입 화면(/preview)으로 되돌린다. /preview 자체와
 * 서버 액션 처리(POST /preview)는 통과시켜 코드 입력·검증이 가능하게 한다. 쿠키의
 * 실제 서명 검증은 API(preview-gate.ts)가 하므로, 여기서는 존재 여부만 본다(값 위조는
 * API 에서 401 로 걸러진다).
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // 공개 당사자 가입 경로(CCC-28 · D39): 운영에서는 Access 없이 열려야 한다(당사자는
  // users 미등재라 토큰이 곧 자격이다). 다만 **미리보기에서는 코드 게이트를 앞에 둔다**.
  // 루트 레이아웃이 이 **요청** 헤더로 셸(사이드바) 제외 여부를 판별한다 — 응답 헤더를
  // 만지면 서버 컴포넌트의 headers() 가 못 본다. 미리보기 게이트보다 먼저 태그한다:
  // 운영·로컬(CCC_PREVIEW!='true')에서도 /join 에는 셸이 빠져야 하기 때문이다.
  //
  // 헤더는 **모든 경로에서 미들웨어가 저작한다** — 공개면 세우고 아니면 지운다.
  // 공개 경로에서만 세우면 나머지 경로에서는 클라이언트가 보낸 `x-ccc-public: 1` 이
  // 그대로 서버 컴포넌트까지 흘러간다. 지금은 셸이 빠지는 정도지만, 이 헤더에 판단을
  // 하나라도 더 걸면 그 순간 조용한 인증 우회가 된다.
  //
  // 경로 매칭이 정확 일치 + '/join/' 접두인 이유: startsWith('/join') 은 '/joinX' 같은
  // 남의 경로까지 공개로 만든다.
  const isPublic = pathname === '/join' || pathname.startsWith('/join/');
  const requestHeaders = new Headers(request.headers);
  if (isPublic) requestHeaders.set('x-ccc-public', '1');
  else requestHeaders.delete('x-ccc-public');
  const forward = { request: { headers: requestHeaders } };

  // **미리보기에는 공개 표면을 두지 않는다**(2026-07-28 Q 결정, ADR-0016 개정).
  // /join 도 지정 코드 뒤에 둔다 — 미리보기는 팀원 피드백용이고 팀원은 코드를 갖고
  // 있으므로 가입 흐름 검수에는 지장이 없다. 셸 제외용 헤더 저작은 위에서 이미 끝났으니
  // 여기서 빠져나가지 않아도 /join 의 화면 구성은 그대로다.
  if (process.env.CCC_PREVIEW !== 'true') return NextResponse.next(forward);

  if (pathname === '/preview') return NextResponse.next(forward);
  if (request.cookies.get(PREVIEW_COOKIE_NAME) !== undefined) return NextResponse.next(forward);

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = '/preview';
  redirectUrl.search = '';
  return NextResponse.redirect(redirectUrl);
}

// 정적 자산·Next 내부 경로는 게이트에서 제외한다(진입 화면 자체가 렌더되도록).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
