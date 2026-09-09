'use client';

// 월간 격자 (D88 ①, 2026-09-10). 브라우저 중립 — next/link, API 타입 없음.
// apps/web 과 apps/client 두 앱이 같은 부품과 격자 빌더를 공유한다.
// buildMonthWeeks 로 격자를 미리 만들어 넘기고, WireLinkProvider 컨텍스트로 SPA 이동을 주입한다.
// 요일 행은 --gradient-brand 연속 면 + 두 테마 고정 --on-action 글자(D88).
// 날짜·일정 이름은 --text-badge 12px(D88 ⑥ 예외, .month-date · .calendar-event-title).
//
// 의미론: <table>/<thead>/<tbody>/<tr>/<th>/<td> 네이티브 계층으로 row·cell 역할을 부여한다.
// role="grid" 와 키보드 내비게이션은 구현하지 않는다(비대화형 달력 표시 전용).

import { useWireLink } from './wire-button';

const MAX_VISIBLE = 3;
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 'YYYY-MM' 형식 검증 — 빌더에서 유일한 입력 검증 지점이다. */
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// ── 공개 타입 ──────────────────────────────────────────────────────────────────

/** D88 ② display_color: 승인된 5가지 variation 색상. 백엔드 마이그레이션 선행 조건. */
export type WireMonthCalendarEventColor =
  'mint' | 'lavender' | 'coral' | 'cyan' | 'light-magenta';

export interface WireMonthCalendarEvent {
  id: string;
  label: string;
  /** 있으면 WireLinkProvider 컨텍스트로 SPA 이동. 없으면 클릭 대상 없음. */
  href?: string;
  /** D88 ② display_color — 5가지 variation 색상. 없으면 무채색 이벤트. */
  color?: WireMonthCalendarEventColor;
}

/**
 * 월간 격자 셀 하나. buildMonthWeeks 가 만들고, WireMonthCalendar 가 렌더한다.
 * inMonth=false 인 셀은 이전·다음 달 채움이며 events 는 항상 빈 배열이다.
 */
export interface WireMonthCalendarCell {
  /** 'YYYY-MM-DD'. inMonth=false 여도 정확한 날짜를 갖는다. */
  dateKey: string;
  dayOfMonth: number;
  inMonth: boolean;
  temporal: 'past' | 'today' | 'future';
  events: readonly WireMonthCalendarEvent[];
  /** maxVisible 초과 건수. 0이거나 없으면 넘침 없음. */
  overflowCount?: number;
  /** overflowCount > 0 이고 dayHref 콜백이 있을 때만 채워진다. */
  overflowHref?: string;
}

export type WireMonthCalendarWeek = readonly WireMonthCalendarCell[];

export interface WireMonthCalendarProps {
  /** 'YYYY-MM'. aria-label 에 쓴다. */
  month: string;
  /** buildMonthWeeks 가 만든 5~6행 격자. */
  weeks: readonly WireMonthCalendarWeek[];
}

// ── 내부 이벤트 렌더러 ──────────────────────────────────────────────────────────

function EventRow({ event }: { readonly event: WireMonthCalendarEvent }) {
  const renderLink = useWireLink();
  const cls = event.color !== undefined
    ? `calendar-event calendar-event--${event.color}`
    : 'calendar-event';
  const inner = <span className="calendar-event-title">{event.label}</span>;

  if (event.href !== undefined) {
    return renderLink !== null
      ? renderLink({ href: event.href, className: cls, 'data-variant': 'neutral', 'data-justify': 'left', children: inner })
      : <a href={event.href} className={cls}>{inner}</a>;
  }
  return <span className={cls}>{inner}</span>;
}

// ── 내부 셀 렌더러 ──────────────────────────────────────────────────────────────

function MonthCell({ cell }: { readonly cell: WireMonthCalendarCell }) {
  const renderLink = useWireLink();

  let overflowEl = null;
  if ((cell.overflowCount ?? 0) > 0 && cell.overflowHref !== undefined) {
    const label = `+${cell.overflowCount}건`;
    overflowEl = renderLink !== null
      ? renderLink({ href: cell.overflowHref, className: 'month-overflow-link', 'data-variant': 'neutral', 'data-justify': 'left', children: label })
      : <a href={cell.overflowHref} className="month-overflow-link">{label}</a>;
  }

  return (
    <td
      className="month-cell"
      data-temporal={cell.inMonth ? cell.temporal : undefined}
      data-out-of-month={cell.inMonth ? undefined : 'true'}
    >
      <span className="month-date">{cell.dayOfMonth}</span>
      {cell.events.map((ev) => <EventRow key={ev.id} event={ev} />)}
      {overflowEl}
    </td>
  );
}

// ── 공개 컴포넌트 ───────────────────────────────────────────────────────────────

/**
 * D88 월간 7열 달력 격자.
 *
 * 브라우저 중립 — next/link 없음. WireLinkProvider 로 SPA 이동을 주입한다.
 * 의미론: 네이티브 <table> 계층으로 row/cell 역할을 자동 부여한다(role="grid" 미사용).
 */
export function WireMonthCalendar({ month, weeks }: WireMonthCalendarProps) {
  return (
    <table className="month-calendar" aria-label={`${month} 월간 일정`}>
      <thead className="month-weekday-header">
        <tr>
          {WEEKDAY_LABELS.map((label) => (
            <th key={label} scope="col" className="month-weekday-cell">{label}</th>
          ))}
        </tr>
      </thead>
      <tbody className="month-grid">
        {weeks.map((week, wi) => (
          /* key on row is week index — stable since grid rows don't reorder */
          <tr key={wi} className="month-week-row">
            {week.map((cell, di) => (
              <MonthCell key={`${wi}-${di}`} cell={cell} />
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── 격자 빌더 ──────────────────────────────────────────────────────────────────
// 순수 JS. 프레임워크 없음, API 타입 없음. 두 앱에서 동일하게 사용한다.
// 날짜 계산은 전부 UTC 기반이라 실행 환경 시스템 시간대에 영향받지 않는다.

function toDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** UTC 기반: 특정 연·월의 마지막 날(= 그 달 일 수). */
function daysInMonthUtc(y: number, m: number): number {
  // Date.UTC(y, m, 0): month m (1-indexed) 의 전 날 = (m-1)월의 마지막 날
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function temporalOf(key: string, todayKey: string): 'past' | 'today' | 'future' {
  return key < todayKey ? 'past' : key > todayKey ? 'future' : 'today';
}

/**
 * buildMonthWeeks — 월간 격자를 만든다.
 *
 * @param month      'YYYY-MM' 형식. 형식 위반(비정규 문자열, 월 범위 밖) 시 빈 배열 반환.
 * @param events     날짜 키('YYYY-MM-DD') → 이벤트 목록.
 *
 *   ⚠️  같은 날 이벤트가 여럿일 때 Map 생성자 단순 배열 변환은 덮어쓴다.
 *   반드시 먼저 그룹화한 뒤 Map 을 구성한다:
 *
 *   ```ts
 *   const byDate = new Map<string, WireMonthCalendarEvent[]>();
 *   for (const s of schedules) {
 *     const list = byDate.get(s.date) ?? [];
 *     list.push({ id: s.id, label: s.participantName ?? s.beneficiaryId });
 *     byDate.set(s.date, list);
 *   }
 *   buildMonthWeeks('2026-09', byDate, todayKey, 3, (d) => `/schedule?view=day&date=${d}`);
 *   ```
 *
 * @param todayKey   'YYYY-MM-DD' 오늘 날짜(기관 시간대 기준).
 * @param maxVisible 셀 안에 표시할 최대 이벤트 수. 양의 정수가 아니면 기본값(3)을 쓴다.
 * @param dayHref    일간 뷰 링크 생성 함수. 있으면 overflow 셀의 overflowHref 를 채운다.
 */
export function buildMonthWeeks(
  month: string,
  events: ReadonlyMap<string, readonly WireMonthCalendarEvent[]>,
  todayKey: string,
  maxVisible = MAX_VISIBLE,
  dayHref?: (dateKey: string) => string,
): readonly WireMonthCalendarWeek[] {
  // ── 입력 검증 ────────────────────────────────────────────────────────────
  if (!MONTH_RE.test(month)) return [];
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  // maxVisible: 양의 정수로 제한. 소수, 0, 음수, NaN, Infinity → 기본값
  const limit = Number.isInteger(maxVisible) && maxVisible >= 1 ? maxVisible : MAX_VISIBLE;

  // ── UTC 기반 달력 계산 ───────────────────────────────────────────────────
  // 브라우저 시스템 시간대 영향 없음.
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = 일요일
  const totalDays = daysInMonthUtc(y, m);

  const cells: WireMonthCalendarCell[] = [];

  // 앞 달 채움 (일요일 시작이 아닌 날)
  if (firstDow > 0) {
    const prevY = m === 1 ? y - 1 : y;
    const prevM = m === 1 ? 12 : m - 1;
    const prevDays = daysInMonthUtc(prevY, prevM);
    for (let d = prevDays - firstDow + 1; d <= prevDays; d++) {
      const key = toDateKey(prevY, prevM, d);
      cells.push({ dateKey: key, dayOfMonth: d, inMonth: false, temporal: temporalOf(key, todayKey), events: [] });
    }
  }

  // 이번 달
  for (let d = 1; d <= totalDays; d++) {
    const key = toDateKey(y, m, d);
    const allEvs = events.get(key) ?? [];
    const overflowCount = allEvs.length > limit ? allEvs.length - limit : 0;
    cells.push({
      dateKey: key,
      dayOfMonth: d,
      inMonth: true,
      temporal: temporalOf(key, todayKey),
      events: allEvs.slice(0, limit),
      ...(overflowCount > 0
        ? { overflowCount, ...(dayHref !== undefined ? { overflowHref: dayHref(key) } : {}) }
        : {}),
    });
  }

  // 뒷 달 채움 (주 끝까지)
  const remainder = (7 - (cells.length % 7)) % 7;
  if (remainder > 0) {
    const nextY = m === 12 ? y + 1 : y;
    const nextM = m === 12 ? 1 : m + 1;
    for (let d = 1; d <= remainder; d++) {
      const key = toDateKey(nextY, nextM, d);
      cells.push({ dateKey: key, dayOfMonth: d, inMonth: false, temporal: temporalOf(key, todayKey), events: [] });
    }
  }

  // 7개씩 주로 묶기
  const weeks: WireMonthCalendarWeek[] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}
