import type { TodaySchedule } from '../../../lib/api';

const weekdayLabels = ['일', '월', '화', '수', '목', '금', '토'] as const;
const dayMilliseconds = 24 * 60 * 60 * 1000;

export type TemporalPosition = 'past' | 'today' | 'future';

export interface IsoWeek {
  readonly isoYear: number;
  readonly isoWeek: number;
  readonly startKey: string;
  readonly endKey: string;
}

export interface DayGroup {
  readonly key: string;
  readonly temporal: TemporalPosition;
  readonly schedules: readonly TodaySchedule[];
}

function parseDateKey(key: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (match === null) throw new RangeError(`Invalid calendar date key: ${key}`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateKey(date: Date): string {
  return [
    String(date.getUTCFullYear()).padStart(4, '0'),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(key: string, days: number): string {
  const date = parseDateKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateKey(date);
}

export function isoWeekOf(key: string): IsoWeek {
  const date = parseDateKey(key);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const monday = new Date(date.getTime() - mondayOffset * dayMilliseconds);
  const thursday = new Date(monday.getTime() + 3 * dayMilliseconds);
  const isoYear = thursday.getUTCFullYear();
  const januaryFourth = new Date(Date.UTC(isoYear, 0, 4));
  const firstMondayOffset = (januaryFourth.getUTCDay() + 6) % 7;
  const firstMonday = new Date(januaryFourth.getTime() - firstMondayOffset * dayMilliseconds);
  const isoWeek = Math.floor((monday.getTime() - firstMonday.getTime()) / (7 * dayMilliseconds)) + 1;
  const startKey = formatDateKey(monday);
  return { isoYear, isoWeek, startKey, endKey: addDays(startKey, 6) };
}

function dateLabel(key: string, includeYear: boolean): string {
  const date = parseDateKey(key);
  const prefix = includeYear ? `${date.getUTCFullYear()}년 ` : '';
  return `${prefix}${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일(${weekdayLabels[date.getUTCDay()]})`;
}

export function dayHeading(key: string): string {
  return dateLabel(key, false);
}

function temporalPosition(key: string, todayKey: string): TemporalPosition {
  if (key === todayKey) return 'today';
  return key < todayKey ? 'past' : 'future';
}

function orgDateKey(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function groupByDay(
  schedules: readonly TodaySchedule[],
  timeZone: string,
  todayKey: string,
): readonly DayGroup[] {
  const grouped = new Map<string, TodaySchedule[]>();
  for (const schedule of schedules) {
    const key = orgDateKey(schedule.scheduledAt, timeZone);
    const existing = grouped.get(key);
    if (existing === undefined) grouped.set(key, [schedule]);
    else existing.push(schedule);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, rows]) => ({ key, temporal: temporalPosition(key, todayKey), schedules: rows }));
}

/**
 * CCC-133 본문의 묶음 단위. 일정이 있는 날짜만 시간순(달력 순)으로 묶어 돌려주고,
 * 뷰별 재배열(월간 오늘 최상단, 2026-08-28 Q)은 ScheduleBody 가 한다.
 * 주차 제목은 내비가 갖으므로 본문은 주차로 묶지 않는다(D75 본문 묶음 대체).
 */
export function groupSchedulesByDay(
  schedules: readonly TodaySchedule[],
  timeZone: string,
  todayKey: string,
): readonly DayGroup[] {
  return groupByDay(schedules, timeZone, todayKey);
}

export function formatMonthLabel(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number);
  return `${year}년 ${monthIndex}월`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (monthIndex ?? 1) - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

// CCC-133 다중 뷰. 뷰 3종과 기간 파라미터를 URL 이 갖고, 어긋난 값은 조용히 버려
// 서버가 기관 시간대로 정한 기본값(오늘, 이번 달)으로 떨어진다.

export type ScheduleView = 'day' | 'week' | 'month';

export interface ScheduleQuery {
  readonly view: ScheduleView;
  /** day·week 전용 기준 날짜(YYYY-MM-DD). week 는 이 날짜가 속한 ISO 주간을 고른다. */
  readonly date?: string;
  /** month 전용 기준 달(YYYY-MM). */
  readonly month?: string;
}

type ScheduleSearchParams = Record<string, string | readonly string[] | undefined>;

const scheduleViews = ['day', 'week', 'month'] as const;

/** 같은 이름이 여러 번 온 쿼리는 배열이 된다. 고를 근거가 없으므로 버린다. */
function singleValue(value: string | readonly string[] | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** 실재하는 날짜만 통과시킨다. 2026-02-30 처럼 모양만 맞는 값은 버린다. */
function validDateKey(value: string | undefined): string | undefined {
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf())) return undefined;
  return date.toISOString().slice(0, 10) === value ? value : undefined;
}

function validMonth(value: string | undefined): string | undefined {
  return value !== undefined && /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : undefined;
}

/** 기간 파라미터는 자기 뷰에서만 읽는다. 남의 뷰 것이 섞여 와도 무시한다. */
function periodQuery(view: ScheduleView, query: ScheduleSearchParams): ScheduleQuery {
  if (view === 'month') {
    const month = validMonth(singleValue(query.month));
    return month === undefined ? { view } : { view, month };
  }
  const date = validDateKey(singleValue(query.date));
  return date === undefined ? { view } : { view, date };
}

export function parseScheduleQuery(query: ScheduleSearchParams): ScheduleQuery {
  const requested = singleValue(query.view);
  const view = scheduleViews.find((candidate) => candidate === requested);
  if (view !== undefined) return periodQuery(view, query);
  // 구 ?range= 계약(D75). month 만 월 뷰로 옮기고 나머지 값은 주간으로 떨어진다.
  return singleValue(query.range) === 'month' ? periodQuery('month', query) : { view: 'week' };
}

/** 이전·다음 이동. 일간은 하루, 주간은 7일, 월간은 한 달이다. */
export function shiftSchedulePeriod(view: ScheduleView, anchor: string, delta: number): string {
  if (view === 'month') return shiftMonth(anchor, delta);
  return addDays(anchor, view === 'week' ? delta * 7 : delta);
}

export function dayPeriodLabel(key: string): string {
  return dateLabel(key, true);
}

/**
 * 주간 기간 이름. 주차 번호는 적지 않는다. 실무자에게는 몇째 주인지보다 어느 날짜인지가
 * 중요하다. 일간·월간과 같이 한 줄이고, 시작에는 연도를 붙이며 끝에는 달부터 적되
 * 해가 바뀔 때만 연도를 다시 붙인다.
 */
export function weekPeriodLabel(week: IsoWeek): string {
  const sameYear = parseDateKey(week.startKey).getUTCFullYear()
    === parseDateKey(week.endKey).getUTCFullYear();
  return `${dateLabel(week.startKey, true)}-${dateLabel(week.endKey, !sameYear)}`;
}

export function schedulePeriodHref(basePath: string, view: ScheduleView, anchor: string): string {
  const period = view === 'month' ? `month=${anchor}` : `date=${anchor}`;
  return `${basePath}?view=${view}&${period}`;
}

/** [오늘]. 보던 뷰는 유지하고 기간 파라미터만 뗀다. */
export function scheduleTodayHref(basePath: string, view: ScheduleView): string {
  return `${basePath}?view=${view}`;
}

/**
 * 보기 선택창 이동. 보던 자리를 잡은 채 기간 크기만 바꾼다.
 * 월간에서 주간·일간으로 갈 때는 그 달 1일을 기준으로 잡는다.
 */
export function scheduleViewHref(
  basePath: string,
  from: ScheduleView,
  anchor: string,
  to: ScheduleView,
): string {
  if (to === from) return schedulePeriodHref(basePath, to, anchor);
  if (to === 'month') return schedulePeriodHref(basePath, 'month', anchor.slice(0, 7));
  return schedulePeriodHref(basePath, to, from === 'month' ? `${anchor}-01` : anchor);
}
