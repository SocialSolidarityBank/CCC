import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { WireBadge, type WireBadgeTone } from './wire-badge';

afterEach(cleanup);

const BADGE_PALETTE = [
  { tone: 'blue', light: '#67A9F0', dark: '#93C1F5' },
  { tone: 'mint', light: '#56CC99', dark: '#8ED9B8' },
  { tone: 'lavender', light: '#C890F0', dark: '#CBA8E2' },
  { tone: 'coral', light: '#F48978', dark: '#F2A99C' },
  { tone: 'amber', light: '#D7A137', dark: '#DDB87B' },
  { tone: 'lime', light: '#A1B84E', dark: '#B7C786' },
  { tone: 'cyan', light: '#02C1D4', dark: '#74CFDB' },
] as const satisfies readonly {
  readonly tone: WireBadgeTone;
  readonly light: string;
  readonly dark: string;
}[];

const tokensSource = readFileSync(resolve(process.cwd(), '../../design/tokens.css'), 'utf8');
const stylesSource = readFileSync(
  resolve(process.cwd(), 'app/components/wire/wire-styles.ts'),
  'utf8',
);

function readBlock(selector: string): string {
  const start = tokensSource.indexOf(selector);
  const open = tokensSource.indexOf('{', start);
  const close = tokensSource.indexOf('\n}', open);
  return tokensSource.slice(open, close);
}

function readToken(block: string, name: string): string | undefined {
  return block.match(new RegExp(`^\\s*${name}:\\s*([^;]+)`, 'm'))?.[1]?.trim();
}

describe('WireBadge palette', () => {
  it('승인된 7색 tone을 data-tone으로 렌더한다', () => {
    const { container } = render(
      <>
        {BADGE_PALETTE.map(({ tone }) => (
          <WireBadge key={tone} tone={tone}>{tone}</WireBadge>
        ))}
      </>,
    );

    expect([...container.querySelectorAll('.wire-badge')].map((badge) => (
      badge.getAttribute('data-tone')
    ))).toEqual(BADGE_PALETTE.map(({ tone }) => tone));
  });

  it('라이트는 Pen deep, 다크는 base 배지 토큰을 쓴다', () => {
    const light = readBlock(':root {');
    const dark = readBlock(':root[data-theme="dark"]');

    for (const { tone, light: lightValue, dark: darkValue } of BADGE_PALETTE) {
      expect(readToken(light, `--badge-${tone}`)).toBe(lightValue);
      expect(readToken(dark, `--badge-${tone}`)).toBe(darkValue);
    }
  });

  it('모든 색상 배지는 전용 surface 토큰과 on-badge 전경을 쓴다', () => {
    for (const { tone } of BADGE_PALETTE) {
      expect(stylesSource).toContain(
        `.wire-badge[data-tone="${tone}"]{border-color:var(--badge-${tone});background:var(--badge-${tone});color:var(--on-badge)}`,
      );
    }
  });
});
