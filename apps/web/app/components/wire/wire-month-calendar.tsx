'use client';

// 월간 격자 (D88 ①, 2026-09-10). 브라우저 중립 — next/link, API 타입 없음.
// apps/web 과 apps/client 두 앱이 같은 부품과 격자 빌더를 공유한다.
// buildMonthWeeks 로 격자를 미리 만들어 넘기고, WireLinkProvider 컨텍스트로 SPA 이동을 주입한다.
// 요일 행은 --gradient-brand 연속 면 + 두 테마 고정 --on-action 글자(D88).
// 날짜·일정 이름은 --text-badge 12px(D88 ⑥ 예외, .month-date · .calendar-event-title).

import type { ReactNode } from 'react';
import { useWireLink } from './wire-button';

/** 셀 안에 표시할 최대 이벤트 수. 이 수를 넘으면 overflowCount 가 채워진다. */
const MAX_VISIBLE = 3;

/** 요일 행 레이블. 한국 달력은 일요일(0) 시작이다. */
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const;

// ── 공개 타입 ──────────────────────────────────────────────────────────────────

export interface WireMonthCalendarEvent {
  id: string;
  label: string;
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
  /** buildMonthWeeks 에서 dayHref 콜백이 있고 overflow 가 생길 때 채워진다. */
  overflowHref?: string;
  /** events.length > MAX_VISIBLE 일 때 숨긴 건수. */
  overflowCount?: number;
}

export type WireMonthCalendarWeek = readonly WireMonthCalendarCell[];

export interface WireMonthCalendarProps {
  /** 'YYYY-MM'. aria-label 에 쓴다. */
  month: string;
  /** buildMonthWeeks 가 만든 5~6행 격자. */
  weeks: readonly WireMonthCalendarWeek[];
}

// ── 내부 셀 렌더러 ──────────────────────────────────────────────────────────────

function MonthCell({ cell }: { readonly cell: WireMonthCalendarCell }) {
  const renderLink = useWireLink();

  let overflowNode: ReactNode = null;
  if (cell.overflowHref !== undefined && (cell.overflowCount ?? 0) > 0) {
    const label = `+${cell.overflowCount}건`;
    overflowNode = renderLink !== null
      ? renderLink({
          href: cell.overflowHref,
          className: 'month-overflow-link',
          'data-variant': 'neutral',
          'data-justify': 'left',
          children: label,
        })
      : <a href={cell.overflowHref} className="month-overflow-link">{label}</a>;
  }

  return (
    <div
      className="month-cell"
      data-temporal={cell.inMonth ? cell.temporal : undefined}
      data-out-of-month={cell.inMonth ? undefined : 'true'}
    >
      <span className="month-date">{cell.dayOfMonth}</span>
      {cell.events.map((ev) => (
        <span key={ev.id} className="calendar-event">
          <span className="calendar-event-title">{ev.label}</span>
        </span>
      ))}
      {overflowNode}
    </div>
  );
}

// ── 공개 컴포넌트 ───────────────────────────────────────────────────────────────

/** D88 월간 7열 격자. 브라우저 중립이며 WireLinkProvider 컨텍스트로 SPA 이동을 받는다. */
export function WireMonthCalendar({ month, weeks }: WireMonthCalendarProps) {
  return (
    <div className="month-calendar" role="grid" aria-label={`${month} 월간 일정`}>
      <div className="month-weekday-header" role="row">
        {WEEKDAY_LABELS.map((label) => (
          <div key={label} className="month-weekday-cell" role="columnheader" aria-label={label}>
            {label}
          </div>
        ))}
      </div>
      <div className="month-grid">
        {weeks.flatMap((week, wi) =>
          week.map((cell, di) => (
            <MonthCell key={`${wi}-${di}`} cell={cell} />
          ))
        )}
      </div>
    </div>
  );
}

// ── 격자 빌더 ──────────────────────────────────────────────────────────────────
// 순수 JS. 프레임워크 없음, API 타입 없음. 두 앱에서 동일하게 사용한다.

function toDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate(); // m 은 1-indexed; Date(y, m, 0) = 그 달 마지막 날
}

function temporalOf(key: string, todayKey: string): 'past' | 'today' | 'future' {
  return key < todayKey ? 'past' : key > todayKey ? 'future' : 'today';
}

/**
 * buildMonthWeeks — 월간 격자를 만든다.
 *
 * @param month     'YYYY-MM'
 * @param events    날짜 키('YYYY-MM-DD') → 이벤트 목록. 없는 날짜는 맵에 없어도 된다.
 * @param todayKey  'YYYY-MM-DD' 오늘 날짜(기관 시간대 기준)
 * @param maxVisible 셀 안에 표시할 최대 이벤트 수(기본 3). 넘으면 overflowCount 채움.
 * @param dayHref   일간 뷰 링크 생성 함수. 있으면 overflow 셀의 overflowHref 를 채운다.
 */
export function buildMonthWeeks(
  month: string,
  events: ReadonlyMap<string, readonly WireMonthCalendarEvent[]>,
  todayKey: string,
  maxVisible = MAX_VISIBLE,
  dayHref?: (dateKey: string) => string,
): readonly WireMonthCalendarWeek[] {
  const parts = month.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return [];

  const firstDow = new Date(y, m - 1, 1).getDay(); // 0 = 일요일
  const totalDays = daysInMonth(y, m);

  const cells: WireMonthCalendarCell[] = [];

  // 앞 달 채움 (일요일 시작이 아닌 날부터)
  if (firstDow > 0) {
    const prevY = m === 1 ? y - 1 : y;
    const prevM = m === 1 ? 12 : m - 1;
    const prevDays = daysInMonth(prevY, prevM);
    for (let d = prevDays - firstDow + 1; d <= prevDays; d++) {
      const key = toDateKey(prevY, prevM, d);
      cells.push({ dateKey: key, dayOfMonth: d, inMonth: false, temporal: temporalOf(key, todayKey), events: [] });
    }
  }

  // 이번 달
  for (let d = 1; d <= totalDays; d++) {
    const key = toDateKey(y, m, d);
    const allEvs = events.get(key) ?? [];
    const overflowCount = allEvs.length > maxVisible ? allEvs.length - maxVisible : 0;
    cells.push({
      dateKey: key,
      dayOfMonth: d,
      inMonth: true,
      temporal: temporalOf(key, todayKey),
      events: allEvs.slice(0, maxVisible),
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
