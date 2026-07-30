/**
 * 테마 쿠키 이름과 값 하나만 두는 파일 (D56 · ADR-0026).
 *
 * `preview-cookie.ts` 와 **같은 이유로 의존성이 없다**: 이 값을 쓰는 곳이 서로 다른 실행
 * 환경에 있다 — `layout.tsx`(서버 컴포넌트) · `theme-action.ts`(서버 액션) · 사이드바
 * (클라이언트 컴포넌트). 한 곳이라도 `server-only` 모듈을 끌어오면 클라이언트 경계가 깨진다.
 */
export const THEME_COOKIE_NAME = 'ccc_theme';

export type Theme = 'light' | 'dark';

/** 쿠키 값이 없거나 이상하면 라이트다 — 다크는 명시적으로 켠 사람만 본다(ADR-0026). */
export function parseTheme(value: string | undefined): Theme {
  return value === 'dark' ? 'dark' : 'light';
}
