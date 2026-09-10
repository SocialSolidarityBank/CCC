// 공유 화면 CSS 의 참조 지점. **이 파일은 CSS 를 한 줄도 갖지 않는다.**
//
// 정본 둘을 빌드 시점에 읽는다.
//   1. 색 토큰: design/tokens.css. 운영 RootLayout 이 import 하는 바로 그 파일이다.
//   2. 화면 CSS: apps/web 의 문자열 8묶음(layout.tsx 의 7개 + wireStyles).
// 이어붙이는 순서는 scripts/design/hierarchy-audit.mjs 의 composeRuntimeCss 가 이미 계약으로
// 갖고 있다. 그래서 순서를 여기서 다시 적지 않고 그 함수를 부른다. shellStyles 순서가 바뀌면
// composeRuntimeCss 가 먼저 던진다.
//
// **값 사본을 두지 않는다.** 여기 있는 것은 경로뿐이고, 두 정본은 읽기만 한다. 즉 이 앱의
// 스타일은 빌드 자원 의존이다. 정본이 바뀌면 다음 빌드에서 그대로 따라온다.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeRuntimeCss } from '../../../scripts/design/hierarchy-audit.mjs';

const here = dirname(fileURLToPath(import.meta.url));

/** 레포 루트. apps/client/build 에서 세 단계 위다. */
export const repoRoot = join(here, '..', '..', '..');

/** 색 토큰 정본. 운영 RootLayout 과 같은 파일이다. */
export const tokensPath = join(repoRoot, 'design/tokens.css');

/** CSS 문자열 7묶음이 사는 파일. wireStyles 만 호출부가 넣어 준다. */
export const layoutPath = join(repoRoot, 'apps/web/app/layout.tsx');

/**
 * 토큰 + 운영과 같은 순서의 화면 CSS.
 * 토큰이 먼저다. 운영도 tokens.css 를 layout 문자열보다 먼저 싣는다.
 * @param {string} wireStyles `@ccc/web/wire-styles` 의 export 값
 * @returns {string}
 */
export function composeSharedCss(wireStyles) {
  const tokens = readFileSync(tokensPath, 'utf8');
  return `${tokens}\n${composeRuntimeCss(layoutPath, wireStyles)}`;
}
