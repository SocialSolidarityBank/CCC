import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AppHeader } from './app-header';
import { DEFAULT_PROGRAM_TYPE, ORG_LABEL, PROGRAM_LABELS } from '../../lib/labels';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다 — app-sidebar.test.tsx 와 같은 이유.
afterEach(cleanup);

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

describe('AppHeader (2026-08-05 상단 헤더 — Infisical 레퍼런스)', () => {
  it('기관(홈) → 사업 전환기 → 계정 행동(설정·테마·로그아웃) 순으로 렌더한다', () => {
    const { container } = render(<AppHeader activePath="/participants" />);
    // 기관명이 곧 홈 버튼이다(D50 — 자리만 사이드바 → 헤더).
    const brand = container.querySelector('a.brand');
    expect(brand?.getAttribute('href')).toBe('/');
    expect(brand?.textContent).toContain(ORG_LABEL);
    // 사업 전환기는 기관명 다음이다 — 헤더 왼쪽이 '기관 | 사업' 맥락 묶음이다.
    const switcher = container.querySelector('.app-header .program-switcher');
    expect(switcher?.textContent).toContain(PROGRAM_LABELS[DEFAULT_PROGRAM_TYPE]);
    expect(brand?.compareDocumentPosition(switcher as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // 계정 행동 3개 — 아이콘 버튼이라 라벨은 aria-label 이 갖는다.
    const actions = Array.from(container.querySelectorAll('.header-actions .header-icon-button'));
    expect(actions.map((el) => el.getAttribute('aria-label'))).toEqual(['설정', '다크 모드', '로그아웃']);
  });

  it('설정은 링크, 테마·로그아웃은 서버 액션 폼 버튼이다', () => {
    // 테마·로그아웃이 폼인 이유: 쿠키(테마·세션)를 서버가 써야 한다(HttpOnly · 첫 페인트 테마).
    const { container } = render(<AppHeader activePath="/participants" />);
    const settings = container.querySelector('.header-actions a.header-icon-button');
    expect(settings?.getAttribute('href')).toBe('/settings');
    const formButtons = container.querySelectorAll('.header-actions form button[type="submit"]');
    expect(formButtons).toHaveLength(2);
  });

  it('설정 화면에서는 설정 버튼이 활성 표시를 단다', () => {
    const { container } = render(<AppHeader activePath="/settings" />);
    const settings = container.querySelector('.header-actions a.header-icon-button');
    expect(settings?.getAttribute('data-current')).toBe('true');
    expect(settings?.getAttribute('aria-current')).toBe('page');
  });

  it('다크 테마에서는 테마 버튼이 가는 곳(라이트 모드)을 말하고 눌린 상태를 알린다', () => {
    // 라벨은 현재 상태가 아니라 **가는 곳**이다(§11) — aria-pressed 가 현재 상태를 따로 알린다.
    const { container } = render(<AppHeader activePath="/participants" theme="dark" />);
    const themeButton = container.querySelector('.header-actions button[aria-pressed]');
    expect(themeButton?.getAttribute('aria-label')).toBe('라이트 모드');
    expect(themeButton?.getAttribute('aria-pressed')).toBe('true');
  });

  it('경로가 사업을 알려주면 그 사업을, 아니면 폴백을 전환기에 표시한다', () => {
    // 헤더와 사이드바가 같은 헬퍼(resolveActiveProgram)를 쓰는지의 겉면 검증이다 —
    // 두 부품이 다른 사업을 가리키면 메뉴와 전환기가 어긋난다.
    const { container } = render(
      <AppHeader activePath={`/programs/${DEFAULT_PROGRAM_TYPE}/schedule`} />,
    );
    expect(container.querySelector('.program-switcher-name')?.textContent)
      .toBe(PROGRAM_LABELS[DEFAULT_PROGRAM_TYPE]);
  });
});
