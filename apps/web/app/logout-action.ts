'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AUTH_COOKIE_NAME } from './lib/auth-cookie';
import { PREVIEW_COOKIE_NAME } from './lib/preview-cookie';

async function revokeDirectSession(accessToken: string): Promise<void> {
  const apiOrigin = process.env.CCC_API_ORIGIN;
  if (apiOrigin === undefined || apiOrigin.length === 0) return;
  try {
    await fetch(new URL('/auth/logout', apiOrigin), {
      method: 'POST',
      headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    // 해지 API 장애가 브라우저의 로컬 로그아웃까지 막으면 안 된다.
  }
}

/**
 * 로그아웃 (2026-07-31 Q 요청).
 *
 * **actions.ts 가 아니라 파일을 따로 두는 이유**: 이 액션은 사이드바(클라이언트 컴포넌트)가
 * 직접 import 한다. actions.ts 는 `app/lib/api.ts` 를 끌어오고 그 파일은 `server-only` 이라,
 * 클라이언트 모듈에서 이어지는 순간 그 경계가 깨진다(테스트 환경에서 먼저 터진다). 이 파일은
 * next/headers·next/navigation 과 의존성 없는 상수 둘만 쓴다 — 경계를 넘지 않는 가장 작은 단위다.
 *
 * **신원 경로가 셋이다** — 미리보기 코드 게이트(CCC-6), Cloudflare Access, 그리고 직접
 * 로그인(ccc_auth 쿠키). 로그아웃은 "세션을 지우고 신원을 다시 묻는 화면으로 보낸다"
 * 한 가지 뜻이고, 어디로 보낼지는 어떤 세션을 갖고 있었는지가 정한다:
 *
 *   미리보기(CCC_PREVIEW='true'): ccc_preview 쿠키를 지우고 코드 입력 화면(/preview)으로.
 *   Access 세션(CF_Authorization 쿠키가 있음): ccc_auth 도 함께 지우고 Access 의
 *   로그아웃 엔드포인트로 — 그쪽 세션까지 끝내야 다음 방문이 다시 신원을 묻는다.
 *   그 외(직접 로그인): ccc_auth 를 지우고 /login 으로.
 *
 * 로컬 임시본(form-draft)은 여기서 지울 수 없다 — 서버 액션은 localStorage 에 손이 닿지
 * 않는다. 그래서 이 액션을 부르는 두 로그아웃 폼(app-header·app-sidebar)이 제출 직전에
 * clearAllDrafts() 로 지운다(P0-9 · CCC-111). 로그아웃 경로를 새로 만들면 같은 정리를 달 것.
 *
 * 쿠키는 set(maxAge:0) 이 아니라 delete 로 지운다 — 같은 이름·경로로 정확히 만료시키는 것이
 * Next 의 계약이고, 경로가 어긋나면 지워진 것처럼 보이고 실제로는 남는다.
 */
export async function logoutAction(): Promise<void> {
  const store = await cookies();
  if (process.env.CCC_PREVIEW === 'true') {
    store.delete(PREVIEW_COOKIE_NAME);
    redirect('/preview');
  }
  // 직접 로그인 세션은 어느 경로로 나가든 먼저 해지하고 지운다. 쿠키만 지우면 복사된
  // access token 이 만료될 때까지 살아 있고, 남겨 두면 다음 요청도 Bearer 로 다시 싣는다.
  const directSession = store.get(AUTH_COOKIE_NAME)?.value;
  if (directSession !== undefined) await revokeDirectSession(directSession);
  store.delete(AUTH_COOKIE_NAME);
  if (store.get('CF_Authorization') !== undefined) {
    redirect('/cdn-cgi/access/logout');
  }
  redirect('/login');
}
