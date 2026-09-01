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

  it('아코디언 슬롯도 공용 아래 꺽쇠만 품는다', () => {
    const { container } = render(<DisclosureChevron frame="none" size="sm" />);
    const slot = container.querySelector('.wire-disclosure-chevron');
    const glyph = slot?.querySelector('svg.wire-chevron');

    expect(slot?.getAttribute('data-frame')).toBe('none');
    expect(slot?.getAttribute('data-size')).toBe('sm');
    expect(glyph?.getAttribute('data-dir')).toBe('down');
  });
});
