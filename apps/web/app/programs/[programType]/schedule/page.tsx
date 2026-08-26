import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import {
  ApiError,
  getMonthSchedules,
  getTodaySchedules,
  getUpcomingSchedules,
  rememberLastProgramType,
  type TodaySchedule,
} from '../../../lib/api';
import { GridContainer } from '../../../components/wire/grid-container';
import { PageTitle } from '../../../components/wire/page-title';
import { WireError } from '../../../components/wire/wire-state';
import { isKnownProgramType } from '../../../lib/labels';
import { ScheduleBody, ScheduleNav } from './schedule-view';
import {
  dayPeriodLabel,
  formatMonthLabel,
  isoWeekOf,
  parseScheduleQuery,
  type ScheduleView,
} from './schedule-calendar';

// 통합 일정 화면. D75(ADR-0039)가 두 화면을 하나로 합쳤고, CCC-133 이 그 위에 뷰 3종을 올렸다.
//
//   · 일간은 하루(getTodaySchedules), 주간은 ISO 월요일부터 7일, 월간은 한 달이다.
//   · 범위는 URL 이 갖는다(?view= 와 기간 파라미터). 어긋난 값은 조용히 서버 기본으로 떨어진다.
//   · 주간은 8일 창(getUpcomingSchedules)을 받아 끝의 다음 월요일 하루를 잘라 월-일로 맞춘다.
//     새 엔드포인트도 새 SQL 도 만들지 않는다.
//
// 상태 규칙은 기존 결정 그대로다: 오늘 묶음은 끝난 상담도 배지와 함께 남고(CCC-66),
// 내일 이후 묶음은 예정만 남는다(CCC-57). 지난 날짜는 상태를 전부 보여 준다(D54).

/**
 * 기관 시간대 기준 달력 날짜(YYYY-MM-DD). 서버가 준 board.date 와 같은 모양이라 그대로
 * 비교한다. 'en-CA' 로케일이 이 형식을 준다. 문자열을 직접 자르면 UTC 기준이 되어 자정
 * 근처 일정이 하루씩 어긋난다.
 */
function orgDateKey(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function scheduleErrorMessage(error: ApiError): string | null {
  switch (error.code) {
    case 'authentication_required':
      return '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 일정을 확인하세요.';
    case 'access_denied':
    case 'forbidden':
    case 'not_found':
      return '일정 정보를 확인할 수 없습니다. 접근 권한을 확인하세요.';
    case 'service_unavailable':
      return '일정을 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.';
    default:
      return null;
  }
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="wire-empty">
      <svg
        className="wire-empty-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <rect x="3" y="5" width="18" height="16" rx="3" />
        <path d="M3 10h18M8 2v4M16 2v4" />
      </svg>
      <p className="wire-empty-title">{title}</p>
      <p className="wire-empty-desc">{description}</p>
    </div>
  );
}

type SearchParams = Record<string, string | string[] | undefined>;

interface ScheduleBoard {
  readonly view: ScheduleView;
  /** 내비가 가리키는 기간의 기준값. day·week 는 날짜, month 는 달이다. */
  readonly anchor: string;
  readonly timeZone: string;
  readonly todayKey: string;
  readonly schedules: readonly TodaySchedule[];
}

function emptyStateFor(view: ScheduleView, anchor: string): { title: string; description: string } {
  if (view === 'day') {
    return {
      title: `${dayPeriodLabel(anchor)}에는 상담이 없습니다`,
      description: '다른 날짜로 옮겨 보거나 새 상담을 등록하세요.',
    };
  }
  if (view === 'month') {
    return {
      title: `${formatMonthLabel(anchor)}에는 상담이 없습니다`,
      description: '이전 달과 다음 달로 옮겨 보거나 새 상담을 등록하세요.',
    };
  }
  return {
    title: '이 주에는 상담이 없습니다',
    description: '다른 주로 옮겨 보거나 새 상담을 등록하세요.',
  };
}

/** 뷰마다 창이 다르다. 주간만 8일 창을 받아 월요일부터 7일로 잘라 쓴다. */
async function loadBoard(
  view: ScheduleView,
  date: string | undefined,
  month: string | undefined,
): Promise<ScheduleBoard> {
  if (view === 'month') {
    const board = await getMonthSchedules(month);
    return {
      view,
      anchor: board.date.slice(0, 7),
      timeZone: board.timeZone,
      todayKey: orgDateKey(new Date().toISOString(), board.timeZone),
      schedules: board.schedules,
    };
  }
  if (view === 'day') {
    const board = await getTodaySchedules(date);
    return {
      view,
      anchor: board.date,
      timeZone: board.timeZone,
      todayKey: orgDateKey(new Date().toISOString(), board.timeZone),
      schedules: board.schedules,
    };
  }
  // 주간은 기준 날짜가 속한 ISO 주의 월요일부터 연다. date 가 없으면 서버가 정한 오늘로
  // 먼저 기관 시간대의 '오늘'을 알아낸 뒤 그 주의 월요일로 다시 부른다.
  const monday = date === undefined
    ? isoWeekOf((await getTodaySchedules()).date).startKey
    : isoWeekOf(date).startKey;
  const board = await getUpcomingSchedules(monday);
  const sunday = isoWeekOf(monday).endKey;
  return {
    view,
    anchor: monday,
    timeZone: board.timeZone,
    todayKey: orgDateKey(new Date().toISOString(), board.timeZone),
    // 8일 창의 마지막 하루(다음 월요일)를 잘라 월-일 7일로 맞춘다.
    schedules: board.schedules.filter(
      (schedule) => orgDateKey(schedule.scheduledAt, board.timeZone) <= sunday,
    ),
  };
}

export default async function ProgramSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ programType: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { programType } = await params;
  if (!isKnownProgramType(programType)) notFound();
  const query = parseScheduleQuery(await searchParams);

  // 이 화면에 온 것이 곧 "이 사업을 골랐다"이다(ADR-0014 §2). 기억에 실패해도 화면은 뜬다.
  try {
    await rememberLastProgramType(programType);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }

  const basePath = `/programs/${encodeURIComponent(programType)}/schedule`;
  const frame = (view: ScheduleView, anchor: string, body: ReactNode) => (
    <main className="page-content">
      <GridContainer>
        <div className="page-header">
          <PageTitle>일정</PageTitle>
        </div>
        <ScheduleNav basePath={basePath} view={view} anchor={anchor} />
        {body}
      </GridContainer>
    </main>
  );

  let board: ScheduleBoard;
  try {
    board = await loadBoard(query.view, query.date, query.month);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const message = scheduleErrorMessage(error);
    if (message === null) throw error;
    const todayKey = new Date().toISOString().slice(0, 10);
    const anchor = query.view === 'month'
      ? query.month ?? todayKey.slice(0, 7)
      : query.date ?? todayKey;
    return frame(query.view, anchor, <WireError>{message}</WireError>);
  }

  const mine = board.schedules.filter((schedule) => schedule.programType === programType);
  // 오늘 묶음은 상태를 거르지 않고(CCC-66 "3건 중 1건 끝"을 보는 자리), 내일 이후는 예정만
  // 남긴다(CCC-57 끝난 건이 서 있으면 유령 예정 일정이다). 지난 날짜는 전부 보여 준다(D54).
  const visible = mine.filter((schedule) => {
    const key = orgDateKey(schedule.scheduledAt, board.timeZone);
    return key <= board.todayKey || schedule.status === 'scheduled';
  });

  if (visible.length === 0) {
    const { title, description } = emptyStateFor(board.view, board.anchor);
    return frame(board.view, board.anchor, <EmptyState title={title} description={description} />);
  }

  return frame(board.view, board.anchor, (
    <ScheduleBody
      view={board.view}
      schedules={visible}
      timeZone={board.timeZone}
      todayKey={board.todayKey}
    />
  ));
}
