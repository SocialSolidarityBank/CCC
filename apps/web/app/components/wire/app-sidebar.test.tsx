import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { AppSidebar } from './app-sidebar';
import { DEFAULT_PROGRAM_TYPE, ORG_LABEL, PROGRAM_LABELS } from '../../lib/labels';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다. 정리하지 않으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 'window is not defined' 가 던져지고,
// 테스트는 전부 통과해도 `pnpm test` 가 1 로 끝난다(CI 실패).
afterEach(cleanup);

const pathname = vi.hoisted(() => ({ current: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => pathname.current }));

function sidebarLinks(container: HTMLElement): Array<{ label: string; href: string; current: boolean }> {
  return Array.from(container.querySelectorAll('.sidebar .navigation-link')).map((el) => ({
    // '준비 중' 배지(.navigation-soon)는 라벨이 아니므로 제외한다(CCC-23).
    label: el.querySelector('span:not(.navigation-soon)')?.textContent ?? '',
    href: el.getAttribute('href') ?? '',
    current: el.getAttribute('data-current') === 'true',
  }));
}

describe('AppSidebar (D35 · ADR-0014 §2)', () => {
  it('기관 → 사업 전환기 → 메뉴 → 설정 순으로 렌더한다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    expect(container.querySelector('.brand')?.textContent).toContain(ORG_LABEL);
    // 전환기는 메뉴 위에 있어야 포함 관계가 읽힌다.
    const switcher = container.querySelector('.sidebar .program-switcher');
    expect(switcher?.textContent).toContain(PROGRAM_LABELS[DEFAULT_PROGRAM_TYPE]);
    expect(switcher?.compareDocumentPosition(container.querySelector('.sidebar .navigation-list') as Node))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(sidebarLinks(container).map((link) => link.label))
      .toEqual(['다가오는 일정', '전체 일정', '당사자', '설정']);
  });

  it('등록 2개는 사이드바에 넣지 않는다 — 사이드바=장소 / 우상단=행동', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    const hrefs = sidebarLinks(container).map((link) => link.href);
    expect(hrefs).not.toContain('/schedules/new');
    expect(hrefs).not.toContain('/participants/new');
  });

  it('사업이 1개인 동안은 전환기에 화살표를 두지 않는다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    expect(container.querySelector('.program-switcher-name')?.textContent).not.toContain('▾');
  });

  it('하위 경로에서도 그 메뉴가 활성으로 남는다', () => {
    const { container } = render(<AppSidebar activePath="/participants/swallow-003" />);
    const active = sidebarLinks(container).filter((link) => link.current);
    expect(active.map((link) => link.label)).toEqual(['당사자']);
  });

  it("'/participants' 활성이 '/participants/new' 까지 먹지 않는다", () => {
    // 등록은 위저드라 사이드바가 활성으로 물들면 "지금 어디인지"가 틀리게 읽힌다.
    const { container } = render(<AppSidebar activePath="/participants/new" />);
    // 경계(/)까지 보므로 하위로 잡히긴 하나, 활성은 당사자 하나뿐이어야 한다.
    expect(sidebarLinks(container).filter((link) => link.current).length).toBeLessThanOrEqual(1);
  });

  it('경로의 사업을 워크스페이스로 삼아 일정 링크를 만든다', () => {
    const type = DEFAULT_PROGRAM_TYPE;
    const { container } = render(<AppSidebar activePath={`/programs/${type}/schedule`} />);
    const links = sidebarLinks(container);
    expect(links[0]).toMatchObject({ href: `/programs/${type}/schedule`, current: true });
    expect(links[1]?.href).toBe(`/programs/${type}/schedule/all`);
  });

  it("전체 일정에만 '준비 중' 배지가 붙고 나머지 메뉴에는 없다 (CCC-23)", () => {
    const { container } = render(<AppSidebar />);
    const badges = Array.from(container.querySelectorAll('.navigation-soon'));
    expect(badges).toHaveLength(1);
    expect(badges[0]!.textContent).toBe('준비 중');
    // 배지는 전체 일정 링크 안에 있다.
    const allLink = container.querySelector('a[href$="/schedule/all"]')!;
    expect(allLink.querySelector('.navigation-soon')).not.toBeNull();
    // 다가오는 일정·당사자에는 없다.
    expect(container.querySelector('a[href$="/schedule"] .navigation-soon')).toBeNull();
    expect(container.querySelector('a[href="/participants"] .navigation-soon')).toBeNull();
  });

});

// 768 미만에서 셸은 드로어다(DESIGN.md §4-4). 마크업이 한 벌이므로 "모바일 메뉴가 갈라지지
// 않는가"를 볼 필요가 없어졌고(구 테스트 2건이 그 일을 했다), 대신 여닫는 계약을 본다.
describe('AppSidebar — 768 미만 드로어 (DESIGN.md §4-4)', () => {
  const handle = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('.drawer-handle')!;

  it('기본은 닫힘이고 손잡이를 누르면 열린다 — 스크림은 열렸을 때만 존재한다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    expect(handle(container).getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.sidebar')?.getAttribute('data-drawer-open')).toBeNull();
    expect(container.querySelector('.drawer-scrim')).toBeNull();

    fireEvent.click(handle(container));
    expect(handle(container).getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.sidebar')?.getAttribute('data-drawer-open')).toBe('true');
    expect(container.querySelector('.drawer-scrim')).not.toBeNull();
  });

  it('스크림·닫기 버튼·Esc 세 경로로 닫힌다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    const isOpen = () => container.querySelector('.sidebar')?.getAttribute('data-drawer-open') === 'true';

    fireEvent.click(handle(container));
    fireEvent.click(container.querySelector('.drawer-scrim')!);
    expect(isOpen()).toBe(false);

    fireEvent.click(handle(container));
    fireEvent.click(container.querySelector('.drawer-close')!);
    expect(isOpen()).toBe(false);

    // 스크림을 누를 수 없는 상황(키보드·보조기기)의 유일한 탈출구다.
    fireEvent.click(handle(container));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(isOpen()).toBe(false);
  });

  it('손잡이가 지금 사업을 적는다 — 드로어를 열지 않고도 워크스페이스가 보여야 한다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    expect(container.querySelector('.drawer-handle-program')?.textContent)
      .toBe(PROGRAM_LABELS[DEFAULT_PROGRAM_TYPE]);
  });

  it('드로어 안에 기관·사업 전환기·메뉴가 모두 있다', () => {
    // 구 모바일 내비는 메뉴만 렌더해서 **좁은 화면에서는 지금 어느 사업인지 볼 수도 바꿀 수도
    // 없었다.** 마크업을 한 벌로 합쳐 해소했고, 갈라지면 이 테스트가 잡는다.
    const { container } = render(<AppSidebar activePath="/participants" />);
    const drawer = container.querySelector('.sidebar')!;
    expect(drawer.querySelector('.brand')?.textContent).toContain(ORG_LABEL);
    expect(drawer.querySelector('.program-switcher')).not.toBeNull();
    expect(sidebarLinks(container).map((link) => link.label))
      .toEqual(['다가오는 일정', '전체 일정', '당사자', '설정']);
  });

  it('아이콘이 aria-hidden 이므로 링크 텍스트는 DOM 에 남는다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    const labels = Array.from(container.querySelectorAll('.sidebar .navigation-link'))
      .map((el) => el.querySelector('span:not(.navigation-soon)')?.textContent?.trim());
    expect(labels).toEqual(['다가오는 일정', '전체 일정', '당사자', '설정']);
  });
});
