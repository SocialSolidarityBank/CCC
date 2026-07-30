'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PREVIEW_COOKIE_NAME } from './lib/preview-cookie';

/**
 * 로그아웃 (2026-07-31 Q 요청).
 *
 * **actions.ts 가 아니라 파일을 따로 두는 이유**: 이 액션은 사이드바(클라이언트 컴포넌트)가
 * 직접 import 한다. actions.ts 는 `app/lib/api.ts` 를 끌어오고 그 파일은 `server-only` 이라,
 * 클라이언트 모듈에서 이어지는 순간 그 경계가 깨진다(테스트 환경에서 먼저 터진다). 이 파일은
 * next/headers·next/navigation 과 의존성 없는 상수 하나만 쓴다 — 경계를 넘지 않는 가장 작은 단위다.
 *
 * **지금 이 서비스에는 자체 로그인이 없다** — 신원은 미리보기 코드 게이트(CCC-6) 또는 운영의
 * Cloudflare Access 가 정한다. 그래서 로그아웃은 "세션을 지우고 신원을 다시 묻는 화면으로
 * 보낸다" 한 가지 뜻이고, 어디로 보낼지는 환경이 정한다:
 *
 *   미리보기(CCC_PREVIEW='true'): ccc_preview 쿠키를 지우고 코드 입력 화면(/preview)으로.
 *   그 외: Cloudflare Access 의 로그아웃 엔드포인트로. Access 는 계정 개설 전이라 아직
 *   지나갈 일이 없지만, 붙는 순간 이 경로가 맞게 동작하도록 지금 갈라 둔다.
 *
 * 쿠키는 set(maxAge:0) 이 아니라 delete 로 지운다 — 같은 이름·경로로 정확히 만료시키는 것이
 * Next 의 계약이고, 경로가 어긋나면 지워진 것처럼 보이고 실제로는 남는다.
 */
export async function logoutAction(): Promise<void> {
  if (process.env.CCC_PREVIEW === 'true') {
    const store = await cookies();
    store.delete(PREVIEW_COOKIE_NAME);
    redirect('/preview');
  }
  redirect('/cdn-cgi/access/logout');
}
