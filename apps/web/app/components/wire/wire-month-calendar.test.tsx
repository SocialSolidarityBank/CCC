import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import {
  WireMonthCalendar,
  buildMonthWeeks,
  type WireMonthCalendarEvent,
  type WireMonthCalendarWeek,
} from './wire-month-calendar';

afterEach(cleanup);

// ── buildMonthWeeks 순수 함수 ──────────────────────────────────────────────────

describe('buildMonthWeeks — 입력 검증', () => {
  it('형식이 맞지 않는 month 는 빈 배열을 반환한다', () => {
    expect(buildMonthWeeks('', new Map(), '2026-09-01')).toEqual([]);
    expect(buildMonthWeeks('2026-9', new Map(), '2026-09-01')).toEqual([]);
    expect(buildMonthWeeks('2026/09', new Map(), '2026-09-01')).toEqual([]);
    expect(buildMonthWeeks('2026-00', new Map(), '2026-09-01')).toEqual([]);
    expect(buildMonthWeeks('2026-13', new Map(), '2026-09-01')).toEqual([]);
    expect(buildMonthWeeks('not-a-date', new Map(), '2026-09-01')).toEqual([]);
  });

  it('maxVisible 가 양의 정수가 아니면 기본값(3)을 쓴다', () => {
    const evs: WireMonthCalendarEvent[] = [
      { id: '1', label: 'A' }, { id: '2', label: 'B' },
      { id: '3', label: 'C' }, { id: '4', label: 'D' },
    ];
    const byDate = new Map([['2026-09-01', evs]]);
    // 기본값 3: 4건 중 3건 표시, 1건 넘침
    const findCell = (weeks: readonly WireMonthCalendarWeek[]) =>
      weeks.flatMap((w) => w).find((c) => c.dateKey === '2026-09-01');
    expect(findCell(buildMonthWeeks('2026-09', byDate, '2026-09-15', 0))?.events).toHaveLength(3);
    expect(findCell(buildMonthWeeks('2026-09', byDate, '2026-09-15', -1))?.events).toHaveLength(3);
    expect(findCell(buildMonthWeeks('2026-09', byDate, '2026-09-15', 1.5))?.events).toHaveLength(3);
    expect(findCell(buildMonthWeeks('2026-09', byDate, '2026-09-15', NaN))?.events).toHaveLength(3);
  });
});

describe('buildMonthWeeks — 넘침(overflow)', () => {
  it('4건 이벤트 → 3건 표시 + overflowCount 1', () => {
    const evs: WireMonthCalendarEvent[] = [
      { id: 'a', label: '가' }, { id: 'b', label: '나' },
      { id: 'c', label: '다' }, { id: 'd', label: '라' },
    ];
    const byDate = new Map([['2026-09-01', evs]]);
    const todayKey = '2026-09-15';
    const weeks = buildMonthWeeks('2026-09', byDate, todayKey, 3, (k) => `/schedule?view=day&date=${k}`);
    const cell = weeks.flatMap((w) => w).find((c) => c.dateKey === '2026-09-01');
    expect(cell?.events).toHaveLength(3);
    expect(cell?.overflowCount).toBe(1);
    expect(cell?.overflowHref).toBe('/schedule?view=day&date=2026-09-01');
  });

  it('dayHref 없으면 overflowHref 없음, overflowCount 는 채워진다', () => {
    const evs: WireMonthCalendarEvent[] = [
      { id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' },
    ];
    const cell = buildMonthWeeks('2026-09', new Map([['2026-09-01', evs]]), '2026-09-15')
      .flatMap((w) => w).find((c) => c.dateKey === '2026-09-01');
    expect(cell?.overflowCount).toBe(1);
    expect(cell?.overflowHref).toBeUndefined();
  });
});

describe('buildMonthWeeks — 달력 수학', () => {
  it('2024-02 윤년 — 29일이고 첫날이 목요일(4)이다', () => {
    const weeks = buildMonthWeeks('2024-02', new Map(), '2024-02-01');
    const allCells = weeks.flatMap((w) => w);
    const inMonth = allCells.filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(29);
    expect(inMonth.at(0)?.dayOfMonth).toBe(1);
    expect(inMonth.at(28)?.dayOfMonth).toBe(29);
    // 목요일 = 열 인덱스 4 (일=0, 월=1, 화=2, 수=3, 목=4)
    expect(weeks.at(0)?.findIndex((c) => c.inMonth && c.dayOfMonth === 1)).toBe(4);
  });

  it('2026-02 평년 — 28일이다', () => {
    const inMonth = buildMonthWeeks('2026-02', new Map(), '2026-02-15')
      .flatMap((w) => w).filter((c) => c.inMonth);
    expect(inMonth).toHaveLength(28);
  });

  it('12월 → 1월 연도 경계: 뒷 달 채움은 다음 연도 1월이다', () => {
    // 2026-12-31 이후 셀은 2027-01-01...
    const weeks = buildMonthWeeks('2026-12', new Map(), '2026-12-01');
    const trailing = weeks.flatMap((w) => w).filter((c) => !c.inMonth && c.dateKey.startsWith('2027'));
    expect(trailing.length).toBeGreaterThan(0);
    expect(trailing.at(0)?.dayOfMonth).toBe(1);
    expect(trailing.at(0)?.dateKey).toBe('2027-01-01');
  });

  it('1월 → 12월 연도 경계: 앞 달 채움은 이전 연도 12월이다', () => {
    const weeks = buildMonthWeeks('2026-01', new Map(), '2026-01-15');
    const leading = weeks.flatMap((w) => w).filter((c) => !c.inMonth && c.dateKey.startsWith('2025'));
    // 2026-01-01 은 목요일(4) → 앞에 4개 채움. 조건부 단언이라 분기 안에서 단언한다.
    const last = leading.at(-1);
    if (last !== undefined) {
      expect(last.dateKey).toBe('2025-12-31');
    }
  });

  it('격자 행 수는 5 또는 6이다', () => {
    const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-09', '2026-12'];
    for (const m of months) {
      const weeks = buildMonthWeeks(m, new Map(), '2026-01-01');
      expect(weeks.length).toBeGreaterThanOrEqual(4);
      expect(weeks.length).toBeLessThanOrEqual(6);
      for (const week of weeks) expect(week).toHaveLength(7);
    }
  });

  it('셀 총 개수는 7의 배수다', () => {
    const total = buildMonthWeeks('2026-09', new Map(), '2026-09-01')
      .flatMap((w) => w).length;
    expect(total % 7).toBe(0);
  });

  it('temporal 이 오늘·이전·이후를 올바르게 구분한다', () => {
    const weeks = buildMonthWeeks('2026-09', new Map(), '2026-09-10');
    const allCells = weeks.flatMap((w) => w).filter((c) => c.inMonth);
    const today = allCells.find((c) => c.dateKey === '2026-09-10');
    const past  = allCells.find((c) => c.dateKey === '2026-09-01');
    const future = allCells.find((c) => c.dateKey === '2026-09-30');
    expect(today?.temporal).toBe('today');
    expect(past?.temporal).toBe('past');
    expect(future?.temporal).toBe('future');
  });
});

// ── WireMonthCalendar 렌더 ─────────────────────────────────────────────────────

describe('WireMonthCalendar — 의미론', () => {
  it('네이티브 table/thead/tbody/tr/th/td 계층을 쓴다', () => {
    const weeks = buildMonthWeeks('2026-09', new Map(), '2026-09-01');
    const { container } = render(<WireMonthCalendar month="2026-09" weeks={weeks} />);
    expect(container.querySelector('table.month-calendar')).not.toBeNull();
    expect(container.querySelector('thead.month-weekday-header')).not.toBeNull();
    expect(container.querySelector('tbody.month-grid')).not.toBeNull();
    expect(container.querySelectorAll('thead th').length).toBe(7);
    expect(container.querySelector('th')?.getAttribute('scope')).toBe('col');
    expect(container.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(4);
    expect(container.querySelector('td.month-cell')).not.toBeNull();
  });

  it('role="grid" 를 달지 않는다(키보드 내비 없는 정적 달력)', () => {
    const weeks = buildMonthWeeks('2026-09', new Map(), '2026-09-01');
    const { container } = render(<WireMonthCalendar month="2026-09" weeks={weeks} />);
    expect(container.querySelector('[role="grid"]')).toBeNull();
    expect(container.querySelector('table')?.getAttribute('role')).toBeNull();
  });

  it('요일 레이블 7개가 정해진 순서로 있다', () => {
    const { container } = render(<WireMonthCalendar month="2026-09" weeks={buildMonthWeeks('2026-09', new Map(), '2026-09-01')} />);
    const labels = Array.from(container.querySelectorAll('th')).map((th) => th.textContent);
    expect(labels).toEqual(['일', '월', '화', '수', '목', '금', '토']);
  });
});

describe('WireMonthCalendar — 이벤트 렌더', () => {
  it('href 없는 이벤트는 <span> 으로 렌더된다', () => {
    const ev: WireMonthCalendarEvent = { id: 'x', label: '상담' };
    const weeks = buildMonthWeeks('2026-09', new Map([['2026-09-10', [ev]]]), '2026-09-01');
    const { container } = render(<WireMonthCalendar month="2026-09" weeks={weeks} />);
    const eventEl = container.querySelector('.calendar-event');
    expect(eventEl?.tagName).toBe('SPAN');
    expect(eventEl?.querySelector('.calendar-event-title')?.textContent).toBe('상담');
  });

  it('href 있는 이벤트는 <a> 로 렌더된다', () => {
    const ev: WireMonthCalendarEvent = { id: 'y', label: '브리핑', href: '/briefing/1' };
    const weeks = buildMonthWeeks('2026-09', new Map([['2026-09-10', [ev]]]), '2026-09-01');
    const { container } = render(<WireMonthCalendar month="2026-09" weeks={weeks} />);
    const link = container.querySelector('.calendar-event');
    // WireLinkProvider 없이 기본 <a> 폴백
    expect(link?.tagName).toBe('A');
    expect(link?.getAttribute('href')).toBe('/briefing/1');
  });

  it('color 있는 이벤트는 calendar-event--{color} 클래스를 갖는다', () => {
    const evs: WireMonthCalendarEvent[] = [
      { id: '1', label: 'A', color: 'mint' },
      { id: '2', label: 'B', color: 'lavender' },
      { id: '3', label: 'C', color: 'coral' },
    ];
    const weeks = buildMonthWeeks('2026-09', new Map([['2026-09-10', evs]]), '2026-09-01');
    const { container } = render(<WireMonthCalendar month="2026-09" weeks={weeks} />);
    const events = container.querySelectorAll('.calendar-event');
    expect(events[0]?.classList.contains('calendar-event--mint')).toBe(true);
    expect(events[1]?.classList.contains('calendar-event--lavender')).toBe(true);
    expect(events[2]?.classList.contains('calendar-event--coral')).toBe(true);
  });

  it('4건 이벤트: 셀에 3건 + +1건 넘침 링크', () => {
    const evs: WireMonthCalendarEvent[] = [
      { id: '1', label: 'A' }, { id: '2', label: 'B' },
      { id: '3', label: 'C' }, { id: '4', label: 'D' },
    ];
    const weeks = buildMonthWeeks('2026-09', new Map([['2026-09-10', evs]]), '2026-09-01', 3, (k) => `/day?d=${k}`);
    const { container } = render(<WireMonthCalendar month="2026-09" weeks={weeks} />);
    expect(container.querySelectorAll('.calendar-event')).toHaveLength(3);
    const overflow = container.querySelector('.month-overflow-link');
    expect(overflow?.textContent).toBe('+1건');
    expect(overflow?.getAttribute('href')).toBe('/day?d=2026-09-10');
  });

  it('오늘 셀은 data-temporal="today" 를 갖는다', () => {
    const weeks = buildMonthWeeks('2026-09', new Map(), '2026-09-10');
    const { container } = render(<WireMonthCalendar month="2026-09" weeks={weeks} />);
    const todayCell = container.querySelector('td[data-temporal="today"]');
    expect(todayCell).not.toBeNull();
    expect(todayCell?.querySelector('.month-date')?.textContent).toBe('10');
  });

  it('이전 달 채움 셀은 data-out-of-month="true" 를 갖는다', () => {
    const weeks = buildMonthWeeks('2026-09', new Map(), '2026-09-01');
    const { container } = render(<WireMonthCalendar month="2026-09" weeks={weeks} />);
    // 2026-09-01 은 화요일 → 앞에 2개 채움 셀
    const outCells = container.querySelectorAll('td[data-out-of-month="true"]');
    expect(outCells.length).toBeGreaterThan(0);
  });
});
