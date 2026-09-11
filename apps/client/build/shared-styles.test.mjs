import { describe, expect, it } from 'vitest';
import { composeSharedCss } from './shared-styles.mjs';

// 이 검사는 seam 하나만 지킨다: 운영 정본에서 CSS 가 실제로 오는가, 순서가 그대로인가.
// 값 자체(색·크기)는 guard:tokens 와 design:align 이 이미 본다.
describe('공유 CSS 참조', () => {
  const css = composeSharedCss('/* WIRE_SLOT */');

  it('wireStyles 자리에 호출부가 넘긴 값이 들어간다', () => {
    expect(css).toContain('/* WIRE_SLOT */');
  });

  it('전역 기본 규칙이 함께 온다', () => {
    // layout.tsx 의 styles 묶음. 이 화면이 따로 베껴 쓰지 않는 근거다.
    expect(css).toContain('box-sizing: border-box'.replace(/ /g, ''));
    expect(css).toContain('background:var(--canvas)');
  });

  it('전역 기본이 wireStyles 보다 앞에 온다', () => {
    expect(css.indexOf('background:var(--canvas)')).toBeLessThan(css.indexOf('/* WIRE_SLOT */'));
  });

  it('페이지 셸 클래스가 들어 있다', () => {
    expect(css).toContain('.page-content');
  });
});
