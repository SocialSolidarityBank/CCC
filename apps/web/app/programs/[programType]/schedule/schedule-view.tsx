import Link from 'next/link';
import { formatKoreanDate, formatKoreanTime } from '../../../lib/format-korean-date';
import type { TodaySchedule } from '../../../lib/api';
import { ParticipantCard } from '../../../components/wire/participant-card';
import { TimeAxisBadge } from '../../../components/wire/time-axis-badge';
import { WireButton } from '../../../components/wire/wire-button';
import { WireCardDetails } from '../../../components/wire/wire-card';
import {
  dayHeading,
  dayPeriodLabel,
  formatMonthLabel,
  groupSchedulesByDay,
  isoWeekOf,
  schedulePeriodHref,
  scheduleTodayHref,
  shiftSchedulePeriod,
  weekPeriodLabel,
  type DayGroup,
  type ScheduleView,
} from './schedule-calendar';
import { ScheduleViewSelect } from './schedule-view-select';

// CCC-133 다중 뷰 본문. 세 뷰 모두 일정이 있는 날짜만 시간순으로 그린다.
// 펼침 규칙만 뷰마다 다르다.
//
//   · 일간: 날짜 이름은 내비가 가지므로 카드만 세운다.
//   · 주간: 지난 날짜는 접힌 줄, 오늘과 미래는 펼친 구획이다.
//   · 월간: 모든 날짜가 접힘 줄이고 기관 시간대의 오늘만 기본 펼침이다.
//
// 흐림은 지난 줄과 완료 카드에만 걸고 미래 줄에는 걸지 않는다.

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
  timeZone,
}: {
  readonly schedule: TodaySchedule;
  readonly selected: boolean;
  readonly timeZone: string;
}) {
  const statusLabel = statusLabels[schedule.status];
  return (
    <ParticipantCard
      href={rowHref(schedule)}
      selected={selected}
      muted={schedule.status === 'completed'}
      schedule={{
        date: formatKoreanDate(schedule.scheduledAt, timeZone),
        time: formatKoreanTime(schedule.scheduledAt, timeZone),
        kind: schedule.sessionKind,
        ...(statusLabel === null ? {} : { statusLabel }),
      }}
      name={schedule.participantName}
      beneficiaryId={schedule.beneficiaryId}
      phone={schedule.participantPhone}
    />
  );
}

function DayCards({ day, timeZone }: { readonly day: DayGroup; readonly timeZone: string }) {
  return (
    <div className="card-grid schedule-card-grid">
      {day.schedules.map((schedule) => (
        <ScheduleCard
          key={schedule.id}
          schedule={schedule}
          selected={day.temporal === 'today'}
          timeZone={timeZone}
        />
      ))}
    </div>
  );
}

/** 접힌 날짜 줄. 요약에 날짜와 당사자 이름과 건수만 남는다. */
function CollapsedDay({ day, timeZone }: { readonly day: DayGroup; readonly timeZone: string }) {
  const names = day.schedules.map((schedule) => {
    const name = schedule.participantName;
    return name === null || name.length === 0 ? schedule.beneficiaryId : name;
  }).join(', ');
  return (
    <WireCardDetails
      className={day.temporal === 'past' ? 'schedule-past-day' : 'schedule-day-accordion'}
      open={day.temporal === 'today'}
      title={(
        <span className="schedule-past-summary-title">
          <span className="schedule-day-heading">{dayHeading(day.key)}</span>
          {day.temporal === 'today' && <TimeAxisBadge>오늘</TimeAxisBadge>}
          <span className="schedule-past-names">{names}</span>
        </span>
      )}
      badge={<span className="schedule-day-count">{day.schedules.length}건</span>}
    >
      <DayCards day={day} timeZone={timeZone} />
    </WireCardDetails>
  );
}

/** 펼친 날짜 구획. 주간의 오늘과 미래가 쓴다. */
function OpenDay({ day, timeZone }: { readonly day: DayGroup; readonly timeZone: string }) {
  return (
    <section
      className="schedule-section schedule-day"
      data-temporal={day.temporal}
      aria-label={dayHeading(day.key)}
    >
      <h3 className="record-section-title schedule-day-heading">
        {dayHeading(day.key)}
        {day.temporal === 'today' && <TimeAxisBadge>오늘</TimeAxisBadge>}
        <span className="schedule-day-count">{day.schedules.length}건</span>
      </h3>
      <DayCards day={day} timeZone={timeZone} />
    </section>
  );
}

export function ScheduleBody({
  view,
  schedules,
  timeZone,
  todayKey,
}: {
  readonly view: ScheduleView;
  readonly schedules: readonly TodaySchedule[];
  readonly timeZone: string;
  readonly todayKey: string;
}) {
  const days = groupSchedulesByDay(schedules, timeZone, todayKey);
  if (view === 'day') {
    return (
      <div className="schedule-day-list">
        {days.map((day) => <DayCards key={day.key} day={day} timeZone={timeZone} />)}
      </div>
    );
  }
  return (
    <div className="schedule-day-list">
      {days.map((day) => (
        view === 'month' || day.temporal === 'past'
          ? <CollapsedDay key={day.key} day={day} timeZone={timeZone} />
          : <OpenDay key={day.key} day={day} timeZone={timeZone} />
      ))}
    </div>
  );
}

/** 내비의 기간 이름. 세 뷰 모두 한 줄이고 날짜만 말한다. */
function periodLabelText(view: ScheduleView, anchor: string): string {
  if (view === 'month') return formatMonthLabel(anchor);
  if (view === 'day') return dayPeriodLabel(anchor);
  return weekPeriodLabel(isoWeekOf(anchor));
}

export function ScheduleNav({
  basePath,
  view,
  anchor,
}: {
  readonly basePath: string;
  readonly view: ScheduleView;
  /** day·week 는 날짜(YYYY-MM-DD), month 는 달(YYYY-MM). */
  readonly anchor: string;
}) {
  return (
    <nav className="schedule-nav work-toolbar" aria-label="일정 도구">
      {/* 양쪽 1fr 이 가운데 칸을 페이지 정중앙에 고정한다. 왼·오른 폭이 달라도 기간
          네비는 안 밀린다. */}
      <div className="schedule-nav-controls">
        <WireButton href={scheduleTodayHref(basePath, view)} variant="neutral" height="sm">오늘</WireButton>
        <ScheduleViewSelect basePath={basePath} view={view} anchor={anchor} />
      </div>
      <div className="schedule-nav-period">
        <Link
          className="header-icon-button schedule-nav-step"
          href={schedulePeriodHref(basePath, view, shiftSchedulePeriod(view, anchor, -1))}
          aria-label="이전 기간"
        >
          <span aria-hidden="true" className="wire-chevron" data-dir="left" />
        </Link>
        <span className="schedule-period-label">{periodLabelText(view, anchor)}</span>
        <Link
          className="header-icon-button schedule-nav-step"
          href={schedulePeriodHref(basePath, view, shiftSchedulePeriod(view, anchor, 1))}
          aria-label="다음 기간"
        >
          <span aria-hidden="true" className="wire-chevron" data-dir="right" />
        </Link>
      </div>
      <div className="schedule-nav-actions">
        <WireButton href="/participants/new" height="sm">당사자 등록</WireButton>
        <WireButton href="/schedules/new" variant="primary">상담 등록</WireButton>
      </div>
    </nav>
  );
}
