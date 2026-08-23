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

export interface WeekGroup extends IsoWeek {
  readonly days: readonly DayGroup[];
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

export function weekRangeLabel(week: IsoWeek): string {
  const start = parseDateKey(week.startKey);
  const end = parseDateKey(week.endKey);
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  if (sameMonth) {
    return `${dateLabel(week.startKey, true)}-${end.getUTCDate()}일(${weekdayLabels[end.getUTCDay()]})`;
  }
  return `${dateLabel(week.startKey, true)}-${dateLabel(week.endKey, !sameYear)}`;
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

function groupByWeek(days: readonly DayGroup[], todayKey: string): readonly WeekGroup[] {
  // Builder only: collect immutable DayGroup values before returning readonly week values.
  const grouped = new Map<string, { isoYear: number; isoWeek: number; endKey: string; days: DayGroup[] }>();
  for (const day of days) {
    const week = isoWeekOf(day.key);
    const existing = grouped.get(week.startKey);
    if (existing === undefined) {
      grouped.set(week.startKey, {
        isoYear: week.isoYear,
        isoWeek: week.isoWeek,
        endKey: week.endKey,
        days: [day],
      });
    } else {
      existing.days.push(day);
    }
  }

  const currentWeekStart = isoWeekOf(todayKey).startKey;
  const rank = (startKey: string): number => {
    if (startKey === currentWeekStart) return 0;
    return startKey > currentWeekStart ? 1 : 2;
  };
  return [...grouped.entries()]
    .map(([startKey, week]) => ({
      startKey,
      endKey: week.endKey,
      isoYear: week.isoYear,
      isoWeek: week.isoWeek,
      days: [...week.days].sort((left, right) => {
        const leftRank = left.temporal === 'today' ? 0 : left.temporal === 'future' ? 1 : 2;
        const rightRank = right.temporal === 'today' ? 0 : right.temporal === 'future' ? 1 : 2;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.temporal === 'past'
          ? right.key.localeCompare(left.key)
          : left.key.localeCompare(right.key);
      }),
    }))
    .sort((left, right) => {
      const leftRank = rank(left.startKey);
      const rightRank = rank(right.startKey);
      if (leftRank !== rightRank) return leftRank - rightRank;
      return leftRank === 2
        ? right.startKey.localeCompare(left.startKey)
        : left.startKey.localeCompare(right.startKey);
    });
}

export function groupSchedulesByWeek(
  schedules: readonly TodaySchedule[],
  timeZone: string,
  todayKey: string,
): readonly WeekGroup[] {
  return groupByWeek(groupByDay(schedules, timeZone, todayKey), todayKey);
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
