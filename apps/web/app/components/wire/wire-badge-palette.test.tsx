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
  // 라이트 마젠타는 승인 hex #D96BC8 하나만 쓰고 다크 별도 음영을 만들지 않는다(2026-08-24 Q 결정).
  // 그 대신 이 면 위 글자만 전용 --on-badge-light-magenta 를 써 두 테마 모두 AA 를 넘긴다.
  { tone: 'light-magenta', light: '#D96BC8', dark: '#D96BC8', foreground: '--on-badge-light-magenta' },
] as const satisfies readonly {
  readonly tone: WireBadgeTone;
  readonly light: string;
  readonly dark: string;
  readonly foreground?: string;
}[];

// 색상 배지의 기본 전경은 공용 --on-badge 이고, 예외는 팔레트 표가 명시한 토큰뿐이다.
const foregroundToken = (
  entry: { readonly tone: WireBadgeTone; readonly foreground?: string },
) => entry.foreground ?? '--on-badge';

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
  it('승인된 8색 tone을 data-tone으로 렌더한다', () => {
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

  it('배지 내용은 공용 라벨 상자 하나로 감싸 세로 여백을 잴 수 있다', () => {
    const { container } = render(<WireBadge tone="blue">오늘</WireBadge>);
    const badge = container.querySelector('.wire-badge');
    const label = badge?.querySelector('.wire-badge-label');

    expect(label?.textContent).toBe('오늘');
    expect(badge?.children).toHaveLength(1);
  });

  it('배지와 상태 태그의 높이는 모두 20px 계약을 쓴다', () => {
    expect(stylesSource).toContain(
      '.wire-badge{--wire-outline-color:var(--line);--wire-outline-width:1px;display:inline-flex;align-items:center;justify-content:center;vertical-align:middle;line-height:normal;height:var(--space-5);padding:0 var(--space-2);',
    );
    expect(stylesSource).toContain(
      '.wire-badge[data-size="sm"]{height:var(--space-5);padding:0 var(--space-2);font-size:var(--text-badge-compact)}',
    );
    expect(stylesSource).toContain(
      '.wire-status-tag{display:inline-flex;align-items:center;justify-content:center;line-height:normal;height:var(--space-5);padding:0 var(--space-2);',
    );
  });

  it('라이트는 Pen deep, 다크는 base 배지 토큰을 쓴다', () => {
    const light = readBlock(':root {');
    const dark = readBlock(':root[data-theme="dark"]');

    for (const { tone, light: lightValue, dark: darkValue } of BADGE_PALETTE) {
      expect(readToken(light, `--badge-${tone}`)).toBe(lightValue);
      expect(readToken(dark, `--badge-${tone}`)).toBe(darkValue);
    }
  });

  it('모든 색상 배지는 전용 surface 토큰과 지정된 전경을 쓴다', () => {
    for (const entry of BADGE_PALETTE) {
      expect(stylesSource).toContain(
        `.wire-badge[data-tone="${entry.tone}"]{--wire-outline-color:var(--badge-${entry.tone});background:var(--badge-${entry.tone});color:var(${foregroundToken(entry)})}`,
      );
    }
  });

  it('그라데이션 제목 줄의 모든 배지는 패널 면과 계열 아웃라인, 어두운 글자를 쓴다', () => {
    expect(stylesSource).toContain(
      '.wire-card-summary .wire-badge{height:var(--space-5);--wire-outline-color:var(--ink);background:var(--panel);color:var(--ink)}',
    );
    for (const { tone } of BADGE_PALETTE) {
      expect(stylesSource).toContain(
        `.wire-card-summary .wire-badge[data-tone="${tone}"]{--wire-outline-color:var(--badge-${tone})}`,
      );
    }
    expect(stylesSource).toContain(
      '.wire-card-summary .wire-badge[data-tone="risk"]{--wire-outline-color:var(--risk)}',
    );
  });

  it('라이트마젠타 전경은 두 테마와 고대비에서 같은 다크 중립색이다', () => {
    for (const selector of [
      ':root {',
      ':root[data-theme="dark"]',
      ':root[data-theme="dark"][data-contrast="high"]',
      ':root[data-contrast="high"]',
    ]) {
      expect(readToken(readBlock(selector), '--on-badge-light-magenta')).toBe('#100E13');
    }
  });
});
