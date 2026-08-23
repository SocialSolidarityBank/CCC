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
  it('드로어 = 계정 행동(상단 줄) + 메뉴다 — 기관·사업 맥락은 바가 전담한다 (2026-08-06 Q)', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    // 상단 줄: 드로어 버튼(좌) + 계정 행동 3개(우) — 2026-08-06 2차 반전. 닫기는 X 가 아니라
    // 여는 버튼과 같은 사이드바 아이콘 원형이다(토글로 읽힌다).
    const actions = Array.from(container.querySelectorAll('.sidebar .sidebar-actions .header-icon-button'));
    expect(actions.map((el) => el.getAttribute('aria-label'))).toEqual(['설정', '다크 모드', '로그아웃']);
    const head = container.querySelector('.sidebar .sidebar-head')!;
    const dismiss = head.querySelector('.drawer-dismiss')!;
    expect(dismiss).not.toBeNull();
    // 순서: 드로어 버튼이 계정 행동 묶음보다 앞(왼쪽)이다.
    expect(dismiss.compareDocumentPosition(head.querySelector('.sidebar-actions') as Node))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // 상단 줄이 메뉴보다 위다.
    expect(head.compareDocumentPosition(container.querySelector('.sidebar .navigation-list') as Node))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // 메뉴는 장소 2개뿐이다 — 일정 두 메뉴는 D75 로 `일정` 하나가 됐다.
    expect(sidebarLinks(container).map((link) => link.label))
      .toEqual(['일정', '당사자']);
    // 드로어에는 기관명·사업 전환기가 없다 — 두 벌 두면 다시 갈라진다.
    expect(container.querySelector('.sidebar .program-switcher')).toBeNull();
    expect(container.querySelector('.sidebar .brand')).toBeNull();
  });

  it('홈 배선은 바의 기관 선택창 목록 안에 있다 — 기관을 고르면 /', () => {
    // 2026-07-31 Q "기관명=홈" → 2026-08-05 2차에 선택창 목록 안으로, 2026-08-06 에
    // 드로어 기관명 줄 자체가 빠져 바의 기관 선택창이 유일한 자리가 됐다.
    const { container } = render(<AppSidebar activePath="/participants" />);
    fireEvent.click(container.querySelector('.drawer-bar .org-switcher .program-switcher-trigger')!);
    const option = container.querySelector('.drawer-bar .org-switcher .program-switcher-option');
    expect(option?.getAttribute('href')).toBe('/');
    expect(option?.textContent).toContain(ORG_LABEL);
  });

  it('로그아웃은 서버 액션 폼이다 — HttpOnly 쿠키는 클라이언트가 못 지운다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    // 아이콘 버튼이라 라벨은 aria-label 이 갖는다(2026-08-05 Q 2차 — 구 텍스트 항목 대체).
    const submit = container.querySelector('.sidebar-actions form button[aria-label="로그아웃"]');
    expect(submit).not.toBeNull();
    expect(submit?.getAttribute('type')).toBe('submit');
    // 링크가 아니어야 한다 — GET 으로 로그아웃되면 프리페치·크롤러가 세션을 끊을 수 있다.
    expect(container.querySelector('a[href="/preview"]')).toBeNull();
  });

  it('사업이 1개뿐이어도 전환기는 선택창이다 (2026-08-03 Q — 구 "1개면 글자" 대체)', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    // 늘 같은 자리가 같은 컨트롤이어야 사업이 늘었을 때 조작법이 바뀌지 않는다.
    // 전환기의 유일한 자리는 바다(2026-08-06 — 드로어 블록 제거).
    const trigger = container.querySelector('.drawer-bar .program-switcher:not(.org-switcher) .program-switcher-trigger');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.drawer-bar .program-switcher:not(.org-switcher) .program-switcher-name')?.textContent)
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
    expect(container.querySelector('.drawer-bar .org-switcher')?.textContent).toContain('연대은행');
    expect(container.querySelector('.drawer-bar .program-switcher:not(.org-switcher) .program-switcher-name')?.textContent)
      .toContain('금융지원 사업');
    // 프롭 없이 렌더하면 하드코딩 폴백 — 온보딩 전 환경이 지금까지처럼 보인다.
    cleanup();
    const fallback = render(<AppSidebar activePath="/participants" />).container;
    expect(fallback.querySelector('.drawer-bar .org-switcher')?.textContent).toContain(ORG_LABEL);
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
  });

  // D75(ADR-0039): '전체 일정' 메뉴는 통합으로 사라졌다 — 두 창의 경계는 화면 안 범위
  // 전환이 말한다. 메뉴가 되살아나면 같은 화면으로 가는 문이 둘이 된다.
  it("'전체 일정' 메뉴는 없다 — 일정 하나로 통합 (D75)", () => {
    const { container } = render(<AppSidebar />);
    expect(container.querySelector('a[href$="/schedule/all"]')).toBeNull();
    expect(sidebarLinks(container).map((link) => link.label)).not.toContain('전체 일정');
  });

});

// 768 미만에서 셸은 드로어다(DESIGN.md §4-4). 마크업이 한 벌이므로 "모바일 메뉴가 갈라지지
// 않는가"를 볼 필요가 없어졌고(구 테스트 2건이 그 일을 했다), 대신 여닫는 계약을 본다.
describe('AppSidebar — 768 미만 드로어 (DESIGN.md §4-4)', () => {
  const handle = (container: HTMLElement) => container.querySelector<HTMLButtonElement>('.drawer-handle')!;

  it('기본은 닫힘이고 손잡이를 누르면 열린다 — 스크림은 늘 있고 열림 상태만 오간다', () => {
    // 조건 마운트였다면 닫는 순간 어둠이 뚝 사라진다(2026-08-06 Q "부자연") — 늘 마운트하고
    // data-open 으로 페이드한다. 닫힘 상태는 CSS 가 pointer-events:none 으로 본문을 열어 둔다.
    const { container } = render(<AppSidebar activePath="/participants" />);
    expect(handle(container).getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('.sidebar')?.getAttribute('data-drawer-open')).toBeNull();
    expect(container.querySelector('.drawer-scrim')).not.toBeNull();
    expect(container.querySelector('.drawer-scrim')?.getAttribute('data-open')).toBeNull();

    fireEvent.click(handle(container));
    expect(handle(container).getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('.sidebar')?.getAttribute('data-drawer-open')).toBe('true');
    expect(container.querySelector('.drawer-scrim')?.getAttribute('data-open')).toBe('true');
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

  it('바 = 좌측 기관·사업 선택창 + 우측 원형 메뉴 버튼이다 (2026-08-05 Q 2차 — 구 "메뉴만" 대체)', () => {
    // 구 계약("헤더에 메뉴만")을 같은 날 2차 지시가 대체: Infisical·OpenAI 처럼 여러 기관·
    // 사업을 고르는 흐름이 전제라, 바에서도 기관·사업이 보이고 골라져야 한다.
    const { container } = render(<AppSidebar activePath="/participants" />);
    const bar = container.querySelector('.drawer-bar')!;
    const org = bar.querySelector('.org-switcher');
    const program = bar.querySelector('.program-switcher:not(.org-switcher)');
    expect(org?.textContent).toContain(ORG_LABEL);
    expect(program?.textContent).toContain(PROGRAM_LABELS[DEFAULT_PROGRAM_TYPE]);
    // 순서: 기관 → 사업 → 메뉴 버튼(오른쪽 끝).
    expect(org?.compareDocumentPosition(program as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(program?.compareDocumentPosition(handle(container))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // 메뉴 버튼은 아이콘 원형이라 라벨은 aria-label 이 갖는다 — 글자 '메뉴'는 화면에 없다.
    expect(handle(container).getAttribute('aria-label')).toBe('메뉴');
    expect(handle(container).textContent?.trim()).toBe('');
  });

  it('드로어에는 메뉴·계정 행동만 있다 — 기관·사업은 바 전담 (2026-08-06)', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    const drawer = container.querySelector('.sidebar')!;
    // 2026-08-06 Q: 드로어에서 기관명·사업 전환기를 뺐다 — 그 맥락은 바가 전담한다.
    expect(drawer.querySelector('.brand')).toBeNull();
    expect(drawer.querySelector('.program-switcher')).toBeNull();
    expect(sidebarLinks(container).map((link) => link.label))
      .toEqual(['일정', '당사자']);
    // 계정 행동은 상단 줄의 원형 아이콘 버튼 3개다(웹 헤더와 같은 옷).
    expect(Array.from(drawer.querySelectorAll('.sidebar-actions .header-icon-button'))
      .map((el) => el.getAttribute('aria-label'))).toEqual(['설정', '다크 모드', '로그아웃']);
  });

  it('아이콘이 aria-hidden 이므로 링크 텍스트는 DOM 에 남는다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    const labels = Array.from(container.querySelectorAll('.sidebar .navigation-link'))
      .map((el) => el.querySelector('span:not(.navigation-soon)')?.textContent?.trim());
    expect(labels).toEqual(['일정', '당사자']);
  });
});

describe('AppSidebar — 테마 전환 (D56 · ADR-0026)', () => {
  // 아이콘 버튼이라 라벨은 aria-label 이 갖는다(2026-08-05 Q 2차 — 구 텍스트 항목 대체).
  const themeButton = (container: HTMLElement) =>
    container.querySelector('.sidebar-actions form button[aria-pressed]');

  it('서버 액션 폼이다 — 쿠키를 서버가 써야 다음 렌더의 첫 페인트부터 테마가 맞는다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    const submit = themeButton(container);
    expect(submit).not.toBeNull();
    expect(submit?.getAttribute('type')).toBe('submit');
    // GET 링크로 두면 프리페치가 테마를 제멋대로 바꾼다.
    expect(container.querySelector('a[href*="theme"]')).toBeNull();
  });

  it('라벨은 **가는 곳**을 말하고, 현재 상태는 aria-pressed 가 알린다', () => {
    // 라벨이 현재 상태를 말하면 누를 때마다 무엇이 될지 한 번 더 생각해야 한다.
    const light = render(<AppSidebar activePath="/participants" theme="light" />);
    const lightBtn = themeButton(light.container);
    expect(lightBtn?.getAttribute('aria-label')).toBe('다크 모드');
    expect(lightBtn?.getAttribute('aria-pressed')).toBe('false');

    const dark = render(<AppSidebar activePath="/participants" theme="dark" />);
    const darkBtn = themeButton(dark.container);
    expect(darkBtn?.getAttribute('aria-label')).toBe('라이트 모드');
    expect(darkBtn?.getAttribute('aria-pressed')).toBe('true');
  });

  it('theme 을 안 주면 라이트다 — 다크는 명시적으로 켠 사람만 본다', () => {
    const { container } = render(<AppSidebar activePath="/participants" />);
    expect(themeButton(container)?.getAttribute('aria-pressed')).toBe('false');
  });
});
