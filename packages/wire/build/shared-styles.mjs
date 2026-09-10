// Node 전용 빌드 진입점. 브라우저와 공개 페이지에는 파일 접근 코드를 싣지 않는다.
// 값은 tokens.css와 wire 패키지에서만 읽고 기존 캐스케이드 추출 계약을 재사용한다.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeRuntimeCss } from '../../../scripts/design/hierarchy-audit.mjs';

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const tokensPath = join(repoRoot, 'design/tokens.css');
export const shellStylesPath = join(repoRoot, 'packages/wire/src/shell-styles.ts');

/** 토큰 다음에 기존 화면 CSS를 같은 순서와 개행으로 조립한다. */
export function composeSharedCss(wireStyles) {
  const tokens = readFileSync(tokensPath, 'utf8');
  return `${tokens}\n${composeRuntimeCss(shellStylesPath, wireStyles)}`;
}
