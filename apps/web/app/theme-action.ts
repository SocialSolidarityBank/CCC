'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { THEME_COOKIE_NAME, parseTheme } from './lib/theme-cookie';

/**
 * 테마 전환 (D56 · ADR-0026).
 *
 * **`logout-action.ts` 와 같은 이유로 파일을 따로 둔다**: 사이드바(클라이언트 컴포넌트)가
 * 직접 import 하는데, `actions.ts` 는 `app/lib/api.ts`(server-only)를 끌어오므로 그 순간
 * 클라이언트 경계가 깨진다. 이 파일이 쓰는 것은 next 내장 두 개와 의존성 없는 상수뿐이다.
 *
 * **localStorage 가 아니라 쿠키인 이유**: 테마는 `<html data-theme>` 이라 **첫 페인트 전에**
 * 정해져 있어야 한다. localStorage 는 자바스크립트가 돈 뒤에야 읽히므로 어두운 화면을 기대한
 * 사람에게 흰 화면이 한 번 번쩍인다. 그걸 막으려면 `<head>` 에 블로킹 인라인 스크립트를
 * 넣어야 하는데, PII 앱에 인라인 스크립트를 들이는 것보다 서버가 쿠키를 읽어 속성을 박는
 * 편이 낫다 — 레이아웃은 이미 `headers()` 를 써서 동적이라 비용도 새로 생기지 않는다.
 *
 * 값은 HttpOnly 가 아니다 — 비밀이 아니고 화면 표시 설정일 뿐이다. 다만 `sameSite:'lax'` 로
 * 두어 외부 사이트의 요청에 실려 나가지 않게 한다.
 *
 * `revalidatePath('/', 'layout')` 이 필요한 이유: 쿠키만 바꾸면 이미 렌더된 레이아웃이
 * 그대로 남아 **다음 이동 전까지 화면이 안 바뀐다**. 테마는 레이아웃(`<html>`)이 들고 있으므로
 * 무효화 범위도 레이아웃이다.
 */
export async function toggleThemeAction(): Promise<void> {
  const store = await cookies();
  const next = parseTheme(store.get(THEME_COOKIE_NAME)?.value) === 'dark' ? 'light' : 'dark';
  store.set(THEME_COOKIE_NAME, next, {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/', 'layout');
}
