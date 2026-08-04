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
      .toEqual(['다가오는 일정', '전체 일정', '당사자', '설정', '다크 모드', '로그아웃']);
  });

  it('기관명이 홈 버튼이다 — 목적지는 마지막 선택 사업을 서버가 정하는 /', () => {
    // 2026-07-31 Q 요청. /programs/:type/schedule 로 직접 링크하면 경로가 사업을 안 알려주는
    // 화면(당사자·설정)에서 폴백(첫 사업)으로 새어, 방금 보던 사업과 달라진다.
    const { container } = render(<AppSidebar activePath="/participants" />);
    const brand = container.querySelector('a.brand');
    expect(brand).not.toBeNull();
    expect(brand?.getAttribute('href')).toBe('/');
    expect(brand?.textContent).toContain(ORG_LABEL);
  });

  it('로그아웃은 서버 액션 폼이다 — HttpOnly 쿠키는 클라이언트가 못 지운다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    // 테마 전환도 같은 클래스의 폼이라(D56) 첫 폼을 집으면 그쪽이 걸린다 — 라벨로 고른다.
    const submits = Array.from(container.querySelectorAll('.sidebar-logout-form button[type="submit"]'));
    const submit = submits.find((el) => el.textContent?.includes('로그아웃'));
    expect(submit).not.toBeUndefined();
    // 링크가 아니어야 한다 — GET 으로 로그아웃되면 프리페치·크롤러가 세션을 끊을 수 있다.
    expect(container.querySelector('a[href="/preview"]')).toBeNull();
  });

  it('사업이 1개뿐이어도 전환기는 선택창이다 (2026-08-03 Q — 구 "1개면 글자" 대체)', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    // 늘 같은 자리가 같은 컨트롤이어야 사업이 늘었을 때 조작법이 바뀌지 않는다.
    const trigger = container.querySelector('.program-switcher-trigger');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.program-switcher-name')?.textContent)
      .toBe(PROGRAM_LABELS[DEFAULT_PROGRAM_TYPE]);
  });

  it('등록 2개는 사이드바에 넣지 않는다 — 사이드바=장소 / 우상단=행동', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    const hrefs = sidebarLinks(container).map((link) => link.href);
    expect(hrefs).not.toContain('/schedules/new');
    expect(hrefs).not.toContain('/participants/new');
  });

  it('온보딩 저장 이름을 넘기면 기관·사업 라벨이 그 값으로 바뀐다 (CCC-32)', () => {
    const { container } = render(
      <AppSidebar
        activePath="/participants"
        orgLabel="연대은행"
        programLabels={{ financial_support_v1: '금융지원 사업' }}
      />,
    );
    expect(container.querySelector('.brand')?.textContent).toContain('연대은행');
    expect(container.querySelector('.program-switcher-name')?.textContent).toContain('금융지원 사업');
    // 프롭 없이 렌더하면 하드코딩 폴백 — 온보딩 전 환경이 지금까지처럼 보인다.
    cleanup();
    const fallback = render(<AppSidebar activePath="/participants" />).container;
    expect(fallback.querySelector('.brand')?.textContent).toContain(ORG_LABEL);
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

  // 구 CCC-23 은 '전체 일정에만 준비 중 배지가 붙는다'를 고정했다. CCC-19 로 그 화면이
  // 생기면서 배지를 뗐으므로 단정을 그 메뉴에 대해서만 뒤집는다 — 배지가 남으면 있는 화면이
  // 없는 것으로 읽힌다. `soon` 기구 자체는 남겨 두므로 "어느 메뉴에도 없다"까지 고정하지
  // 않는다(나중에 다른 메뉴가 정당하게 붙일 때 이 테스트가 엉뚱하게 터진다).
  it("전체 일정에는 '준비 중' 배지가 없다 (CCC-19 — 화면이 생겼다)", () => {
    const { container } = render(<AppSidebar />);
    const allLink = container.querySelector('a[href$="/schedule/all"]');
    // 메뉴 자체는 그대로 있다 — 사라진 것이 아니라 배지만 뗀 것이다.
    expect(allLink).not.toBeNull();
    expect(allLink!.querySelector('.navigation-soon')).toBeNull();
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
    fireEvent.click(container.querySelector('.drawer-dismiss')!);
    expect(isOpen()).toBe(false);

    // 스크림을 누를 수 없는 상황(키보드·보조기기)의 유일한 탈출구다.
    fireEvent.click(handle(container));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(isOpen()).toBe(false);
  });

  it('손잡이에는 메뉴만 있다 — 사업명 표기는 2026-08-05 Q 지시로 뺐다', () => {
    // 구 계약("드로어를 열지 않고도 워크스페이스가 보여야 한다")을 Q ④가 대체:
    // "모바일에선 헤더에 메뉴만 두고 전부 사이드바로". 사업 확인·전환은 드로어 안 전환기 몫이다.
    const { container } = render(<AppSidebar activePath="/participants" />);
    expect(container.querySelector('.drawer-handle-program')).toBeNull();
    expect(handle(container).textContent).toContain('메뉴');
    expect(handle(container).textContent).not.toContain(PROGRAM_LABELS[DEFAULT_PROGRAM_TYPE]);
  });

  it('드로어 안에 기관·사업 전환기·메뉴가 모두 있다', () => {
    // 구 모바일 내비는 메뉴만 렌더해서 **좁은 화면에서는 지금 어느 사업인지 볼 수도 바꿀 수도
    // 없었다.** 마크업을 한 벌로 합쳐 해소했고, 갈라지면 이 테스트가 잡는다.
    const { container } = render(<AppSidebar activePath="/participants" />);
    const drawer = container.querySelector('.sidebar')!;
    expect(drawer.querySelector('.brand')?.textContent).toContain(ORG_LABEL);
    expect(drawer.querySelector('.program-switcher')).not.toBeNull();
    expect(sidebarLinks(container).map((link) => link.label))
      .toEqual(['다가오는 일정', '전체 일정', '당사자', '설정', '다크 모드', '로그아웃']);
  });

  it('아이콘이 aria-hidden 이므로 링크 텍스트는 DOM 에 남는다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    const labels = Array.from(container.querySelectorAll('.sidebar .navigation-link'))
      .map((el) => el.querySelector('span:not(.navigation-soon)')?.textContent?.trim());
    expect(labels).toEqual(['다가오는 일정', '전체 일정', '당사자', '설정', '다크 모드', '로그아웃']);
  });
});

describe('AppSidebar — 테마 전환 (D56 · ADR-0026)', () => {
  it('서버 액션 폼이다 — 쿠키를 서버가 써야 다음 렌더의 첫 페인트부터 테마가 맞는다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    const submit = Array.from(container.querySelectorAll('.sidebar-logout-form button[type="submit"]'))
      .find((el) => el.textContent?.includes('모드'));
    expect(submit).not.toBeUndefined();
    // GET 링크로 두면 프리페치가 테마를 제멋대로 바꾼다.
    expect(container.querySelector('a[href*="theme"]')).toBeNull();
  });

  it('라벨은 **가는 곳**을 말하고, 현재 상태는 aria-pressed 가 알린다', () => {
    // 라벨이 현재 상태를 말하면 누를 때마다 무엇이 될지 한 번 더 생각해야 한다.
    const light = render(<AppSidebar activePath="/participants" theme="light" />);
    const lightBtn = Array.from(light.container.querySelectorAll('button[type="submit"]'))
      .find((el) => el.textContent?.includes('모드'));
    expect(lightBtn?.textContent).toContain('다크 모드');
    expect(lightBtn?.getAttribute('aria-pressed')).toBe('false');

    const dark = render(<AppSidebar activePath="/participants" theme="dark" />);
    const darkBtn = Array.from(dark.container.querySelectorAll('button[type="submit"]'))
      .find((el) => el.textContent?.includes('모드'));
    expect(darkBtn?.textContent).toContain('라이트 모드');
    expect(darkBtn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('theme 을 안 주면 라이트다 — 다크는 명시적으로 켠 사람만 본다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    const btn = Array.from(container.querySelectorAll('button[type="submit"]'))
      .find((el) => el.textContent?.includes('모드'));
    expect(btn?.getAttribute('aria-pressed')).toBe('false');
  });
});
