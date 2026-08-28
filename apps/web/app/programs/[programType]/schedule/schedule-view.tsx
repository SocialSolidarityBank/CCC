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

// CCC-133 다중 뷰 본문. 일정이 있는 날짜만 그리고, 세 상태(지난·오늘·미래)가 같은
// 날짜 묶음 카드(GroupedDay)를 쓴다(2026-08-28 Q — 구 오늘·미래 플랫 구획 폐지).
// 순서와 펼침만 뷰가 정한다.
//
//   · 일간: 날짜 이름은 내비가 가지므로 카드만 세운다.
//   · 주간: 시간순. 지난 날짜는 접힘, 오늘과 미래는 펼침(D75).
//   · 월간: 오늘 최상단 → 미래 → 지난(2026-08-28 Q), 오늘만 기본 펼침.
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

/** 날짜 묶음 카드 — 지난·오늘·미래가 같은 카드 어휘를 쓴다(2026-08-28 Q "오늘도 날짜
 *  묶음 안에" — 구 오늘·미래 플랫 구획(OpenDay) 폐지). 열림은 뷰가 정해 내려준다. */
function GroupedDay({ day, timeZone, open }: {
  readonly day: DayGroup;
  readonly timeZone: string;
  readonly open: boolean;
}) {
  const names = day.schedules.map((schedule) => {
    const name = schedule.participantName;
    return name === null || name.length === 0 ? schedule.beneficiaryId : name;
  }).join(', ');
  return (
    <WireCardDetails
      className={day.temporal === 'past' ? 'schedule-past-day' : 'schedule-day-accordion'}
      open={open}
      title={(
        <span className="schedule-day-summary-title">
          <span className="schedule-day-heading">{dayHeading(day.key)}</span>
          {day.temporal === 'today' && <TimeAxisBadge>오늘</TimeAxisBadge>}
          <span className="schedule-day-names">{names}</span>
        </span>
      )}
      badge={<span className="schedule-day-count">{day.schedules.length}건</span>}
    >
      <DayCards day={day} timeZone={timeZone} />
    </WireCardDetails>
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
  /* 월간은 오늘을 최상단에 꽂는다(2026-08-28 Q): 예약이 많은 달은 시간순만으로는 오늘이
     화면 밖으로 밀린다. 오늘 → 미래(가까운 순) → 지난(달력 순)이고, D75 의 '오늘 최상단,
     미래 다음, 지난 마지막' 계약을 월간 본문에 적용한 것이다. 주간은 한 주 7일이라
     시간순이 곧 훑는 순서다. */
  const ordered = view === 'month'
    ? (['today', 'future', 'past'] as const).flatMap((slot) => days.filter((day) => day.temporal === slot))
    : days;
  return (
    <div className="schedule-day-list">
      {ordered.map((day) => (
        <GroupedDay
          key={day.key}
          day={day}
          timeZone={timeZone}
          /* 주간은 오늘·미래 펼침(D75), 월간은 밀도가 높아 오늘만 펼친다. */
          open={view === 'month' ? day.temporal === 'today' : day.temporal !== 'past'}
        />
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
        <WireButton href={scheduleTodayHref(basePath, view)} variant="neutral">오늘</WireButton>
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
        {/* 업무 바는 전부 32 다(layout.tsx .schedule-nav 주석) — 주 행동도 sm 으로 같은 키에 선다. */}
        <WireButton href="/participants/new">당사자 등록</WireButton>
        <WireButton href="/schedules/new" variant="primary">상담 등록</WireButton>
      </div>
    </nav>
  );
}
