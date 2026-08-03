import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

// 사업 전환기는 **사업이 2개 이상일 때만** 드롭다운이 된다. 지금 레포에는 사업이 1개뿐이라
// 그 경로가 실제로 도는 것을 볼 방법이 없어, 라벨 모듈을 갈아끼워 2개인 세상에서 렌더한다.
// 파일을 따로 두는 이유는 vi.mock 이 파일 단위로 끌어올려지기 때문이다 — 같은 파일에서
// 1개인 경우와 2개인 경우를 함께 볼 수 없다.
vi.mock('../../lib/labels', () => ({
  PROGRAM_TYPES: ['financial_support_v1', 'mentoring_v1'],
  PROGRAM_LABELS: { financial_support_v1: '금융지원', mentoring_v1: '멘토링' },
  DEFAULT_PROGRAM_TYPE: 'financial_support_v1',
  ORG_LABEL: '사회연대은행',
  ORG_ID: 'bss',
  ORG_LABELS: { bss: '사회연대은행' },
  isKnownProgramType: (value: string) => value === 'financial_support_v1' || value === 'mentoring_v1',
}));

const pathname = vi.hoisted(() => ({ current: '/programs/financial_support_v1/schedule' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

const { AppSidebar } = await import('./app-sidebar');

afterEach(cleanup);

describe('사업 전환기 — 사업이 2개 이상일 때 (2026-07-31)', () => {
  it('닫혀 있을 때는 현재 사업만 보이고 목록은 없다', () => {
    const { container } = render(<AppSidebar activePath="/programs/financial_support_v1/schedule" />);
    const trigger = container.querySelector('.program-switcher-trigger');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(trigger?.textContent).toContain('금융지원');
    expect(container.querySelector('.program-switcher-menu')).toBeNull();
  });

  it('누르면 사업 전부가 뜨고 현재 사업에 선택 표시가 붙는다', () => {
    const { container } = render(<AppSidebar activePath="/programs/financial_support_v1/schedule" />);
    fireEvent.click(container.querySelector('.program-switcher-trigger') as HTMLElement);

    const options = Array.from(container.querySelectorAll('.program-switcher-option'));
    expect(options.map((el) => el.textContent?.trim())).toEqual(['금융지원', '멘토링']);
    // 선택 표시는 두 곳에 있어야 한다 — 눈으로 보는 표시(data-selected)와 보조기기가 읽는 값.
    expect(options[0]?.getAttribute('data-selected')).toBe('true');
    expect(options[1]?.getAttribute('data-selected')).toBeNull();
    expect(container.querySelectorAll('.program-switcher-option[aria-current="true"]')).toHaveLength(1);
  });

  it('listbox 역할을 참칭하지 않는다 — 화살표 이동을 구현하지 않았으므로', () => {
    // role="listbox"/"option" 은 ① option 안에 링크(조작 가능한 자식)를 두는 것을 ARIA 가 금지하고
    // ② 화살표 키 이동을 기대하게 만든다. 여기서 필요한 것은 링크 목록뿐이라 역할을 붙이지 않는다.
    const { container } = render(<AppSidebar activePath="/programs/financial_support_v1/schedule" />);
    fireEvent.click(container.querySelector('.program-switcher-trigger') as HTMLElement);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.querySelector('[role="option"]')).toBeNull();
    expect(container.querySelector('.program-switcher-trigger')?.getAttribute('aria-haspopup')).toBeNull();
  });

  it('사업을 바꾸면 그 사업의 일정으로 간다 — 워크스페이스를 옮기는 것이므로', () => {
    const { container } = render(<AppSidebar activePath="/programs/financial_support_v1/schedule" />);
    fireEvent.click(container.querySelector('.program-switcher-trigger') as HTMLElement);
    const hrefs = Array.from(container.querySelectorAll('.program-switcher-option'))
      .map((el) => el.getAttribute('href'));
    expect(hrefs).toEqual(['/programs/financial_support_v1/schedule', '/programs/mentoring_v1/schedule']);
  });

  it('Escape 로 닫힌다 — 스크림이 없으므로 키보드 탈출구가 있어야 한다', () => {
    const { container } = render(<AppSidebar activePath="/programs/financial_support_v1/schedule" />);
    fireEvent.click(container.querySelector('.program-switcher-trigger') as HTMLElement);
    expect(container.querySelector('.program-switcher-menu')).not.toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('.program-switcher-menu')).toBeNull();
  });
});
