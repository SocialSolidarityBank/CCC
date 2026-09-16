/**
 * 직접 로그인 세션 쿠키 이름 하나만 두는 파일.
 *
 * **의존성이 없어야 하는 것이 이 파일의 요점이다** — preview-cookie.ts 와 같은 이유다.
 * 이 값을 쓰는 곳이 서로 다른 실행 환경에 있다: `middleware.ts`(엣지) ·
 * `login/unlock/route.ts`(라우트 핸들러) · `actions.ts`(서버 액션) · `lib/api.ts`(server-only).
 * api.ts 에서 가져오면 `server-only` 경계를 넘는다.
 *
 * 값은 Supabase 가 발급한 access token 이다. 서버가 읽어 API 호출의
 * `Authorization: Bearer` 로 싣고(lib/api.ts accessHeaders), 브라우저 자바스크립트는
 * 읽지 못한다(HttpOnly).
 */
export const AUTH_COOKIE_NAME = 'ccc_auth';
