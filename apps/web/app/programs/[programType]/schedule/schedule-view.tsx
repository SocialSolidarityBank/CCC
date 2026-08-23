import Link from 'next/link';
import { formatKoreanDate, formatKoreanTime } from '../../../lib/format-korean-date';
import type { TodaySchedule } from '../../../lib/api';
import { ParticipantCard } from '../../../components/wire/participant-card';
import { WireBadge } from '../../../components/wire/wire-badge';
import { WireCardDetails } from '../../../components/wire/wire-card';
import {
  dayHeading,
  formatMonthLabel,
  groupSchedulesByWeek,
  isoWeekOf,
  shiftMonth,
  weekRangeLabel,
  type DayGroup,
} from './schedule-calendar';

const sessionKindLabels: Record<TodaySchedule['sessionKind'], string> = {
  regular: '기본 상담',
  intake: '인테이크',
};

const statusLabels: Record<TodaySchedule['status'], string | null> = {
  scheduled: null,
  completed: '완료',
  cancelled: '취소',
  no_show: '불참',
};

function rowHref(schedule: TodaySchedule): string {
  const base = `/participants/${encodeURIComponent(schedule.beneficiaryId)}`
    + `/programs/${encodeURIComponent(schedule.supportCaseId)}`;
  return schedule.completedSessionId === null
    ? `${base}/briefing`
    : `${base}/records#record-${encodeURIComponent(schedule.completedSessionId)}`;
}

function ScheduleCard({
  schedule,
  selected,
  muted,
  timeZone,
}: {
  readonly schedule: TodaySchedule;
  readonly selected: boolean;
  readonly muted: boolean;
  readonly timeZone: string;
}) {
  const statusLabel = statusLabels[schedule.status];
  return (
    <ParticipantCard
      href={rowHref(schedule)}
      selected={selected}
      muted={muted}
      schedule={{
        date: formatKoreanDate(schedule.scheduledAt, timeZone),
        time: formatKoreanTime(schedule.scheduledAt, timeZone),
        kindLabel: sessionKindLabels[schedule.sessionKind],
        ...(statusLabel === null ? {} : { statusLabel }),
      }}
      name={schedule.participantName}
      beneficiaryId={schedule.beneficiaryId}
      phone={schedule.participantPhone}
    />
  );
}

function PastDay({ day, timeZone }: { readonly day: DayGroup; readonly timeZone: string }) {
  const names = day.schedules.map((schedule) => {
    const name = schedule.participantName;
    return name === null || name.length === 0 ? schedule.beneficiaryId : name;
  }).join(', ');
  return (
    <WireCardDetails
      className="schedule-past-day"
      title={(
        <span className="schedule-past-summary-title">
          <span className="schedule-day-heading">{dayHeading(day.key)}</span>
          <span className="schedule-past-names">{names}</span>
        </span>
      )}
      badge={<span className="schedule-day-count">{day.schedules.length}건</span>}
    >
      <div className="card-grid schedule-card-grid">
        {day.schedules.map((schedule) => (
          <ScheduleCard key={schedule.id} schedule={schedule} selected={false} muted timeZone={timeZone} />
        ))}
      </div>
    </WireCardDetails>
  );
}

function OpenDay({ day, timeZone }: { readonly day: DayGroup; readonly timeZone: string }) {
  return (
    <section
      className="schedule-section schedule-day"
      data-temporal={day.temporal}
      aria-label={dayHeading(day.key)}
    >
      <h3 className="record-section-title schedule-day-heading">
        {dayHeading(day.key)}
        {day.temporal === 'today' && <WireBadge tone="blue">오늘</WireBadge>}
        <span className="schedule-day-count">{day.schedules.length}건</span>
      </h3>
      <div className="card-grid schedule-card-grid">
        {day.schedules.map((schedule) => (
          <ScheduleCard
            key={schedule.id}
            schedule={schedule}
            selected={day.temporal === 'today'}
            muted={schedule.status === 'completed'}
            timeZone={timeZone}
          />
        ))}
      </div>
    </section>
  );
}

export function ScheduleGroups({
  schedules,
  timeZone,
  todayKey,
}: {
  readonly schedules: readonly TodaySchedule[];
  readonly timeZone: string;
  readonly todayKey: string;
}) {
  const weeks = groupSchedulesByWeek(schedules, timeZone, todayKey);
  return (
    <>
      {weeks.map((week) => (
        <section key={week.startKey} className="schedule-week" aria-label={weekRangeLabel(week)}>
          <h2 className="schedule-week-title">
            <WireBadge tone="blue">{week.isoYear}년 {week.isoWeek}주</WireBadge>
            <span>{weekRangeLabel(week)}</span>
          </h2>
          <div className="schedule-week-days">
            {week.days.map((day) => (
              day.temporal === 'past'
                ? <PastDay key={day.key} day={day} timeZone={timeZone} />
                : <OpenDay key={day.key} day={day} timeZone={timeZone} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

export function ScheduleControls({
  basePath,
  range,
  todayKey,
  month,
}: {
  readonly basePath: string;
  readonly range: 'week' | 'month';
  readonly todayKey: string;
  readonly month: string;
}) {
  const currentWeek = isoWeekOf(todayKey);
  const monthHref = `${basePath}?range=month&month=${month}`;
  return (
    <nav className="schedule-period-controls" aria-label="일정 기간">
      <Link
        className="schedule-range-seg schedule-week-control"
        href={basePath}
        data-selected={range === 'week' ? 'true' : undefined}
        aria-current={range === 'week' ? 'true' : undefined}
      >
        <span>{currentWeek.isoYear}년 {currentWeek.isoWeek}주</span>
        <span>{weekRangeLabel(currentWeek)}</span>
      </Link>
      <div className="month-nav">
        <div className="month-nav-group">
          <Link className="month-nav-seg" href={`${basePath}?range=month&month=${shiftMonth(month, -1)}`}>
            <span aria-hidden="true" className="wire-chevron" data-dir="left" />
            이전 달
          </Link>
          <Link
            className="month-nav-label"
            href={monthHref}
            data-selected={range === 'month' ? 'true' : undefined}
            aria-current={range === 'month' ? 'true' : undefined}
          >
            {formatMonthLabel(month)}
          </Link>
          <Link className="month-nav-seg" href={`${basePath}?range=month&month=${shiftMonth(month, 1)}`}>
            다음 달
            <span aria-hidden="true" className="wire-chevron" data-dir="right" />
          </Link>
        </div>
      </div>
    </nav>
  );
}
