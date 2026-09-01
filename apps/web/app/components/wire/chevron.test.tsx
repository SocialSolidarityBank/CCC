import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Chevron, DisclosureChevron, type ChevronDir } from './chevron';

afterEach(cleanup);

describe('Chevron', () => {
  it.each<ChevronDir>(['up', 'down', 'left', 'right'])('%s 방향도 같은 중앙 SVG 경로를 쓴다', (dir) => {
    const { container } = render(<Chevron dir={dir} />);
    const svg = container.querySelector('svg.wire-chevron');
    const path = svg?.querySelector('path');

    expect(svg?.getAttribute('data-dir')).toBe(dir);
    expect(svg?.getAttribute('viewBox')).toBe('0 0 12 12');
    expect(path?.getAttribute('d')).toBe('M3.3 4.65 6 7.35 8.7 4.65');
    expect(path?.getAttribute('stroke')).toBe('var(--chevron-color, var(--sub))');
    expect(path?.getAttribute('stroke-width')).toBe('1.5');
    expect(path?.getAttribute('stroke-linecap')).toBe('round');
    expect(path?.getAttribute('stroke-linejoin')).toBe('round');
    expect(path?.getAttribute('vector-effect')).toBe('non-scaling-stroke');
  });

  it('버튼형은 일정 이동과 같은 공용 원형 면을 쓴다', () => {
    const { container } = render(<DisclosureChevron />);
    const slot = container.querySelector('.wire-disclosure-chevron');
    const glyph = slot?.querySelector('svg.wire-chevron');

    expect(slot?.classList.contains('wire-chevron-button')).toBe(true);
    expect(slot?.getAttribute('data-variant')).toBe('button');
    expect(glyph?.getAttribute('data-dir')).toBe('down');
  });

  it('일반형은 12px 슬롯만 남기고 버튼 면을 쓰지 않는다', () => {
    const { container } = render(<DisclosureChevron variant="plain" />);
    const slot = container.querySelector('.wire-disclosure-chevron');
    const glyph = slot?.querySelector('svg.wire-chevron');

    expect(slot?.classList.contains('wire-chevron-button')).toBe(false);
    expect(slot?.getAttribute('data-variant')).toBe('plain');
    expect(glyph?.getAttribute('data-dir')).toBe('down');
  });
});
