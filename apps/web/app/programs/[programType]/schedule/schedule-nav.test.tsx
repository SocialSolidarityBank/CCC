import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ScheduleNav } from './schedule-view';

// 뷰 select 의 onChange 내비게이션은 next/navigation 을 쓴다. 테스트는 호출만 확인한다.
const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

afterEach(cleanup);

// CCC-133 내비 셸 회귀 잠금(2026-08-24 Q 개정 4건).
//
// 높이 같은 계산값은 jsdom 이 내지 않으므로, 렌더 결과로 잡을 수 있는 것은 DOM 으로 잡고
// 계산이 필요한 계약은 CSS 원문을 읽어 잠근다(wire-badge-palette 와 같은 방법).

const layoutSource = readFileSync(resolve(process.cwd(), 'app/layout.tsx'), 'utf8');
const wireSource = readFileSync(resolve(process.cwd(), 'app/components/wire/wire-styles.ts'), 'utf8');

/**
 * 일정 CSS 는 layout.tsx 안의 `scheduleStyles` 템플릿 리터럴 하나에 모여 있다. layout.tsx
 * 전체에는 `@media(max-width:767px)` 블록이 여럿이라, 먼저 이 스타일시트로 범위를
 * 좁힌 뒤에 데스크톱과 767 이하를 가른다.
 */
const SCHEDULE_CSS = (() => {
  const start = layoutSource.indexOf('const scheduleStyles = `');
  if (start === -1) throw new Error('scheduleStyles 블록을 찾지 못했다');
  const open = layoutSource.indexOf('`', start);
  const close = layoutSource.indexOf('`;', open + 1);
  return layoutSource.slice(open + 1, close);
})();

const MOBILE_AT = (() => {
  const at = SCHEDULE_CSS.indexOf('@media(max-width:767px)');
  if (at === -1) throw new Error('일정 CSS 의 767 이하 블록을 찾지 못했다');
  return at;
})();

/** `선택자{...}` 한 벌을 원문에서 꺼낸다. from 을 주면 그 뒤에서 찾는다(모바일 블록용). */
/** layout.tsx 전체에서 찾는다. 일정 CSS 밖에 사는 공유 규칙용이다. */
function baseRule(selector: string): string {
  for (const source of [layoutSource, wireSource]) {
    const start = source.indexOf(`\n${selector}{`);
    if (start === -1) continue;
    const open = source.indexOf('{', start);
    const close = source.indexOf('}', open);
    return source.slice(open + 1, close);
  }
  throw new Error(`공유 CSS 규칙을 찾지 못했다: ${selector}`);
}

function rule(selector: string, from = 0): string {
  // 데스크톱은 모바일 블록 앞에서만 찾아야 두 번째 선언을 잘못 집지 않는다.
  const haystack = from === 0 ? SCHEDULE_CSS.slice(0, MOBILE_AT) : SCHEDULE_CSS.slice(from);
  const start = haystack.indexOf(`${selector}{`);
  if (start === -1) throw new Error(`CSS 규칙을 찾지 못했다: ${selector}`);
  const open = haystack.indexOf('{', start);
  const close = haystack.indexOf('}', open);
  return haystack.slice(open + 1, close);
}

const basePath = '/programs/financial_support_v1/schedule';

function renderNav(view: 'day' | 'week' | 'month', anchor: string) {
  return render(<ScheduleNav basePath={basePath} view={view} anchor={anchor} />);
}

describe('디자인 레인, 이전·다음 원형 버튼', () => {
  it('이전·다음은 공용 원형 아이콘 버튼 면을 쓴다', () => {
    const step = rule('.schedule-nav-step');
    expect(step).not.toContain('background:none');
    expect(step).not.toContain('border:0');
    expect(step).not.toContain('border-radius:0');
    const iconButton = baseRule('.header-icon-button');
    expect(iconButton).toContain('border-radius:var(--radius-pill)');
    expect(iconButton).toContain('var(--gradient-brand) border-box');
  });

  it('32px 원형 버튼과 초점 링을 유지한다', () => {
    const step = rule('.schedule-nav-step');
    expect(step).toContain('width:var(--pill-height)');
    expect(step).toContain('height:var(--pill-height)');
    expect(layoutSource).toMatch(/\.header-icon-button:focus-visible\{/);
  });

  it('세 뷰는 기간 글자 너비만큼만 쓰고 화살표 간격을 같은 값으로 맞춘다', () => {
    const period = rule('.schedule-nav-period');
    expect(period).toContain('display:grid');
    expect(period).toContain('grid-template-columns:');
    expect(period).toContain('gap:var(--space-3)');
    expect(rule('.schedule-period-label')).toContain('width:max-content');
    expect(rule('.schedule-period-label')).not.toContain('width:22ch');
  });

  it('주간 기준 기존 8px의 1.5배인 12px을 세 뷰에 함께 쓴다', () => {
    expect(rule('.schedule-nav-period')).toContain('gap:var(--space-3)');
    expect(rule('.schedule-nav-step')).toContain('font-size:var(--text-md)');
    expect(rule('.schedule-nav-step')).toContain('font-weight:600');
  });
});

describe('리파인먼트 3, 뷰 선택 select', () => {
  beforeEach(() => {
    push.mockClear();
  });

  function renderSelect(view: 'day' | 'week' | 'month', anchor: string) {
    return renderNav(view, anchor);
  }

  it('세그먼트 버튼 대신 현재 뷰를 보여 주는 select 가 하나 선다', () => {
    const { container } = renderSelect('week', '2026-02-09');

    const select = container.querySelector('select');
    expect(select).not.toBeNull();
    expect(container.querySelectorAll('.schedule-range-seg')).toHaveLength(0);
    const options = Array.from(select?.querySelectorAll('option') ?? []).map((o) => o.textContent);
    expect(options).toEqual(['일간', '주간', '월간']);
    expect(select?.value).toBe('week');
  });

  it('바꾸면 즉시 이동하고 뷰별 기간 계약을 지킨다', async () => {
    const { container } = renderSelect('week', '2026-02-09');

    const select = container.querySelector('select');
    fireEvent.change(select!, { target: { value: 'month' } });

    // week(date) 에서 month 로 바꾸면 달 계약으로 옮겨 간다.
    expect(push).toHaveBeenCalledWith(`${basePath}?view=month&month=2026-02`);
  });
});

describe('리파인먼트 4, 공유 입력 타이포', () => {
  it('공유 입력칸과 select 의 글자는 14 다', () => {
    expect(baseRule('.field input,.field select,.field textarea'))
      .toContain('font-size:var(--text-sm)');
    expect(baseRule('.wire-search-box input,.wire-search-box select'))
      .toContain('font-size:var(--text-sm)');
    expect(baseRule('.wire-input-box>input,.wire-input-box>select,.wire-input-box>textarea'))
      .toContain('font-size:var(--text-sm)');
    expect(baseRule('.wire-datetime-fields>input')).toContain('font-size:var(--text-sm)');
    expect(layoutSource).toMatch(
      /\.briefing-goal-input\{[^}]*font-size:var\(--text-sm\);font-weight:400;line-height:normal/,
    );
  });

  it('본문은 16 을 유지한다 — 입력만 줄인다', () => {
    expect(rule('.record-section-title.schedule-day-heading'))
      .not.toContain('var(--text-sm)');
  });
});

describe('CCC-133 내비 회귀, 주차 번호', () => {
  it('주간 기간 이름에 주차 번호가 없고 날짜 범위만 선다', () => {
    const { container } = renderNav('week', '2026-02-09');

    const label = container.querySelector('.schedule-period-label');
    expect(label?.textContent).toBe('2026년 2월 9일(월)-2월 15일(일)');
    // 구 `N째 주` 두 줄 라벨이 되살아나면 여기서 걸린다.
    expect(container.textContent).not.toMatch(/\d+\s*째\s*주/);
    expect(container.textContent).not.toMatch(/\d+\s*주\b/);
  });

  it('세 뷰의 기간 이름이 모두 한 줄짜리 노드 하나다', () => {
    for (const [view, anchor, text] of [
      ['day', '2026-02-15', '2026년 2월 15일(일)'],
      ['week', '2026-02-09', '2026년 2월 9일(월)-2월 15일(일)'],
      ['month', '2026-02', '2026년 2월'],
    ] as const) {
      const { container, unmount } = renderNav(view, anchor);
      const labels = container.querySelectorAll('.schedule-period-label');
      expect(labels).toHaveLength(1);
      expect(labels[0]?.textContent).toBe(text);
      // 두 줄 라벨은 안쪽에 자식 span 을 두 개 갖고 있었다.
      expect(labels[0]?.children).toHaveLength(0);
      unmount();
    }
  });
});

describe('CCC-133 타이포 정제(2026-08-25 Q)', () => {
  it('기간 이름은 14/500 이고 자간은 0이다', () => {
    const label = rule('.schedule-period-label');
    expect(label).toContain('font-size:var(--text-sm)');
    expect(label).toContain('font-weight:500');
    expect(label).toContain('letter-spacing:0');
  });

  it('767 이하가 기간 이름의 글자를 다시 정하지 않는다', () => {
    // 한 계약을 세 뷰와 두 폭이 같이 쓴다. 덮어쓰면 캐스케이드 결과가 표 밖으로 샌다.
    const mobile = rule('.schedule-period-label', MOBILE_AT);
    expect(mobile).not.toContain('font-size');
    expect(mobile).not.toContain('font-weight');
  });

  it('날짜 묶음 제목은 16 이고 공유 섹션 제목은 18 그대로다', () => {
    expect(rule('.record-section-title.schedule-day-heading'))
      .toContain('font-size:var(--text-md)');
    // 공유 클래스를 건드렸으면 회차별 기록과 브리핑 제목까지 같이 줄어든다.
    expect(baseRule('.record-section-title')).toContain('font-size:var(--text-lg)');
  });
});

describe('CCC-133 지난 일정 대비 정제(2026-08-25 Q)', () => {
  it('지난 날짜는 글자까지 흐리지 않고 중립 muted 면으로 활성 날짜와 갈린다', () => {
    const past = rule('.schedule-past-day');
    expect(past).toContain('--surface-fill:var(--muted)');
    expect(past).not.toContain('opacity:.7');
    expect(past).not.toContain('var(--badge-amber)');
    expect(past).not.toContain('var(--badge-lime)');
  });

  it('접힌 날짜 제목은 카드 본문 시작선에 맞춰 왼쪽 정렬한다', () => {
    const title = rule('.schedule-past-summary-title');
    expect(title).toContain('justify-content:flex-start');
    expect(title).toContain('text-align:left');
    expect(baseRule('.record-section-title')).toContain('padding-inline:var(--space-6)');
    expect(baseRule('.briefing-toolbar')).not.toContain('padding-inline');
  });

  it('접힌 날짜는 원 안의 아래 화살표이고 열리면 위 화살표가 된다', () => {
    const circle = baseRule(
      '.wire-card-details.schedule-past-day>.wire-card-summary .wire-card-arrow,.wire-card-details.schedule-day-accordion>.wire-card-summary .wire-card-arrow',
    );
    expect(circle).toContain('width:var(--pill-height)');
    expect(circle).toContain('height:var(--pill-height)');
    expect(circle).toContain('border-radius:var(--radius-pill)');
    const closed = baseRule(
      '.wire-card-details.schedule-past-day>.wire-card-summary .wire-card-arrow::before,.wire-card-details.schedule-day-accordion>.wire-card-summary .wire-card-arrow::before',
    );
    expect(closed).toContain('rotate(45deg)');
    const open = baseRule(
      '.wire-card-details.schedule-past-day[open]>.wire-card-summary .wire-card-arrow::before,.wire-card-details.schedule-day-accordion[open]>.wire-card-summary .wire-card-arrow::before',
    );
    expect(open).toContain('rotate(-135deg)');
  });

  it('보이는 select와 접힌 카드 면 전체가 실제 클릭 영역이다', () => {
    expect(baseRule('.schedule-nav .schedule-view-select>select'))
      .toContain('align-self:stretch');
    const collapsed = baseRule('.wire-card-details:not([open])>.wire-card-summary');
    expect(collapsed).toContain('margin:calc(var(--card-pad, var(--space-6)) * -1)');
    expect(collapsed).toContain('padding:var(--card-pad, var(--space-6))');
  });

  it('details 포커스 링은 clip 안쪽으로 들어가 좌우가 잘리지 않는다', () => {
    expect(baseRule('details.surface-card>.wire-card-summary:focus-visible'))
      .toContain('outline-offset:-2px');
  });

  it('모바일 셸 이름은 마스크 대신 글리프 안전 말줄임표를 쓴다', () => {
    expect(layoutSource).toMatch(
      /\.drawer-bar \.program-switcher-name\{[^}]*-webkit-mask-image:none;[^}]*text-overflow:ellipsis/,
    );
  });
});

describe('CCC-133 내비 회귀, 셸과 구분선', () => {
  it('내비가 테두리 있는 면 하나로 서고 안에 카드를 중첩하지 않는다', () => {
    const { container } = renderNav('week', '2026-02-09');

    const nav = container.querySelector('nav.schedule-nav');
    expect(nav).not.toBeNull();
    expect(nav?.querySelector('.surface-card')).toBeNull();
    expect(nav?.querySelector('.wire-card')).toBeNull();
  });

  it('셸 계약이 CSS 에 살아 있다', () => {
    const shell = baseRule('.work-toolbar');
    expect(shell).toContain('border:1px solid var(--line)');
    expect(shell).toContain('border-radius:var(--radius-card)');
    expect(shell).toContain('background:var(--panel)');
    // 그림자는 떠 있는 층 전용이다(D60 ①).
    expect(shell).not.toContain('box-shadow');
  });

  it('구 전폭 구분선 두 줄이 DOM 에도 CSS 에도 없다', () => {
    const { container } = renderNav('month', '2026-02');

    expect(container.querySelectorAll('.schedule-rule')).toHaveLength(0);
    expect(container.querySelectorAll('hr')).toHaveLength(0);
    expect(SCHEDULE_CSS).not.toContain('.schedule-rule{');
  });
});

describe('CCC-133 내비 회귀, 이전과 다음', () => {
  it('묶인 컨트롤 없이 각각 독립 원형 버튼으로 선다', () => {
    const { container } = renderNav('week', '2026-02-09');

    const steps = container.querySelectorAll('a.schedule-nav-step');
    expect(steps).toHaveLength(2);
    for (const step of steps) {
      expect(step.classList.contains('header-icon-button')).toBe(true);
      expect(step.querySelector('.wire-chevron')).not.toBeNull();
    }
    expect(steps[0]?.getAttribute('aria-label')).toBe('이전 기간');
    expect(steps[1]?.getAttribute('aria-label')).toBe('다음 기간');
    // 구 묶음 컨트롤이 되살아나면 걸린다.
    expect(container.querySelector('.month-nav-group')).toBeNull();
    expect(container.querySelector('.month-nav-seg')).toBeNull();
  });

  it('고정 슬롯과 원형 외관을 함께 유지한다', () => {
    const step = rule('.schedule-nav-step');
    expect(step).toContain('width:var(--pill-height)');
    expect(step).toContain('height:var(--pill-height)');
    expect(step).not.toContain('border-radius:0');
    expect(baseRule('.header-icon-button')).toContain('border-radius:var(--radius-pill)');
  });
});

describe('CCC-133 내비 회귀, 컨트롤 높이 계약', () => {
  // 실제 계산 높이는 브라우저 실측이 본다. 여기서는 네 컨트롤이 모두 같은 높이 토큰을
  // 근거로 삼는지를 잠가, 한 자리만 조용히 다른 값으로 갈라지는 것을 막는다.
  it('오늘 · 기간 이름 · 화살표 슬롯 · 보기 선택창이 모두 32px 단을 쓴다', () => {
    expect(rule('.schedule-period-label')).toContain('height:var(--pill-height)');
    expect(rule('.schedule-nav-step')).toContain('height:var(--pill-height)');
    expect(rule('.schedule-nav .schedule-view-select')).toContain('min-height:var(--pill-height)');
  });

  it('세 칸 격자가 기간 묶음을 가운데 칸에 둔다', () => {
    const { container } = renderNav('day', '2026-02-15');
    const children = Array.from(container.querySelector('.schedule-nav')?.children ?? [])
      .map((el) => el.className);
    expect(children).toHaveLength(3);
    expect(children[0]).toContain('schedule-nav-controls');
    expect(children[1]).toContain('schedule-nav-period');
    expect(children[2]).toContain('schedule-nav-actions');
    expect(rule('.schedule-nav'))
      .toContain('grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)');
  });

  it('좁은 본문에서는 같은 바 안에서 조작·기간·행동을 세 줄로 쌓는다', () => {
    expect(MOBILE_AT).toBeGreaterThan(0);
    expect(layoutSource).toMatch(
      /@container \(max-width:760px\)\{[\s\S]*?\.schedule-nav\{grid-template-columns:minmax\(0,1fr\)/,
    );
    expect(layoutSource).toMatch(
      /@container \(max-width:760px\)\{[\s\S]*?\.schedule-nav-controls\{justify-content:center;flex-wrap:wrap/,
    );
    expect(layoutSource).toMatch(
      /@container \(max-width:760px\)\{[\s\S]*?\.schedule-nav-actions\{width:auto;justify-content:center;flex-wrap:wrap/,
    );
    // 날짜는 어떤 폭에서도 자르지 않는다.
    expect(rule('.schedule-period-label', MOBILE_AT)).not.toContain('text-overflow');
  });
});

describe('CCC-133 통합 업무 바', () => {
  it('768px 데스크톱 경계는 실제 본문 폭 기준으로 세 줄 전환한다', () => {
    expect(layoutSource).toMatch(
      /@container \(max-width:760px\)\{[\s\S]*?\.schedule-nav\{grid-template-columns:minmax\(0,1fr\)/,
    );
  });

  it('글자 버튼과 일정 아이콘 버튼이 각각 알약과 원형 계약을 쓴다', () => {
    expect(baseRule('.wire-button'))
      .toContain('border-radius:var(--radius-pill)');
    expect(baseRule('.header-icon-button'))
      .toContain('border-radius:var(--radius-pill)');
    expect(rule('.schedule-nav-step')).not.toContain('border-radius:0');
  });

  it('카드·배지는 중립 1px, 버튼은 그라데이션 아웃라인이나 면으로 선다 (2026-08-26 Q 최종)', () => {
    // 표면(카드)과 읽기 전용 알약(배지)은 --line 1px 그대로다. 버튼은 그레이 아웃라인을
    // 쓰지 않는다: 아웃라인 버튼은 --gradient-brand 1px, 무아웃라인 버튼은 면 채움이다.
    for (const selector of ['.surface-card', '.wire-badge']) {
      const shared = baseRule(selector);
      expect(shared).toContain('--wire-outline-color:var(--line)');
      expect(shared).toContain('--wire-outline-width:1px');
    }
    const button = baseRule('.wire-button');
    expect(button).toContain('--wire-outline-width:1px');
    expect(button).toContain('border:var(--wire-outline-width) solid transparent');
    expect(button).toContain('var(--gradient-brand) border-box');
    expect(button).toContain('padding:0 var(--space-4)');
    expect(button).not.toContain('--line-control');
    const ghost = baseRule('.wire-button[data-variant="ghost"]');
    expect(ghost).toContain('background:var(--muted)');
    expect(ghost).not.toContain('min-height');
    // 일반(neutral)은 색이 세컨더리와 같아 규칙 자체가 없다. 크기는 크기 축만 정한다.
    expect(wireSource).not.toContain('.wire-button[data-variant="neutral"]{');
    expect(wireSource).not.toContain('.participant-hub-page .surface-card{border-color:');
  });

  it('오늘과 보기 선택창이 같은 왼쪽 묶음에 바로 붙는다', () => {
    const { container } = renderNav('week', '2026-02-09');
    const controls = container.querySelector('.schedule-nav-controls');
    expect(controls?.children).toHaveLength(2);
    expect(controls?.querySelector('a')?.textContent).toContain('오늘');
    expect(controls?.querySelector('.wire-toolbar-label')?.textContent).toBe('기간 단위');
    expect(controls?.querySelector('select')).not.toBeNull();
    const compact = rule('.schedule-nav .schedule-view-select');
    expect(compact).toContain('width:84px');
    expect(compact).toContain('flex:0 0 84px');
    expect(compact).toContain('padding-left:var(--space-2)');
  });

  it('당사자 등록과 상담 등록이 업무 바 오른쪽 안에 선다', () => {
    const { container } = renderNav('week', '2026-02-09');
    const actions = container.querySelector('.schedule-nav-actions');
    const links = Array.from(actions?.querySelectorAll('a') ?? []);
    expect(links.map((link) => link.textContent)).toEqual(['당사자 등록', '상담 등록']);
    expect(links.map((link) => link.getAttribute('href')))
      .toEqual(['/participants/new', '/schedules/new']);
    // 업무 바는 전부 32 다(2026-08-26 Q "버튼 모양 다르다" — 주 행동도 sm).
    expect(links.every((link) => link.getAttribute('data-height') === 'sm')).toBe(true);
    expect(layoutSource).not.toContain('.schedule-nav-actions>.wire-button{flex:1 1 0');
  });
});
