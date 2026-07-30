/**
 * 미리보기 세션 쿠키 이름 하나만 두는 파일 (CCC-6).
 *
 * **의존성이 없어야 하는 것이 이 파일의 요점이다.** 이 값을 쓰는 세 곳은 서로 다른 실행
 * 환경에 있다 — `middleware.ts`(엣지) · `logout-action.ts`(서버 액션) · `lib/api.ts`(server-only).
 * api.ts 에서 가져오면 `server-only` 경계를 넘게 되고, 그래서 지금까지는 세 곳이 같은 문자열을
 * 각자 적어 두고 있었다. 이름이 바뀌면 로그아웃이 조용히 깨지면서 테스트는 통과한다.
 */
export const PREVIEW_COOKIE_NAME = 'ccc_preview';
