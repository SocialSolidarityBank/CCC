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
  if (process.env.CCC_PREVIEW !== 'true') return NextResponse.next();

  const { pathname } = request.nextUrl;
  if (pathname === '/preview') return NextResponse.next();

  if (request.cookies.get(PREVIEW_COOKIE_NAME) !== undefined) return NextResponse.next();

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = '/preview';
  redirectUrl.search = '';
  return NextResponse.redirect(redirectUrl);
}

// 정적 자산·Next 내부 경로는 게이트에서 제외한다(진입 화면 자체가 렌더되도록).
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
