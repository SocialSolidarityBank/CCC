import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import {
  ApiError,
  getMonthSchedules,
  getUpcomingSchedules,
  rememberLastProgramType,
} from '../../../lib/api';
import { GridContainer } from '../../../components/wire/grid-container';
import { PageTitle } from '../../../components/wire/page-title';
import { WireButton } from '../../../components/wire/wire-button';
import { WireError } from '../../../components/wire/wire-state';
import { isKnownProgramType } from '../../../lib/labels';
import {
  ScheduleControls,
  ScheduleGroups,
} from './schedule-view';
import { formatMonthLabel } from './schedule-calendar';

// 통합 일정 화면 (D75 · ADR-0039, 2026-08-23 결정 · 2026-08-24 후속 개정).
// `일정` 한 화면에서 현재 ISO 주간과 별도 월 선택이 상시 나란히 선다.
//
//   · 기본(week)은 오늘 + 7일 창(getUpcomingSchedules), month 는 선택한 한 달 창이다.
//   · 둘 다 ISO 주차(월요일-일요일) → 날짜 → 카드 순으로 묶고 빈 날짜는 그리지 않는다.
//   · 현재 주차와 오늘을 최상단에 두고, 오늘 카드는 전부 그라데이션 아웃라인을 입는다.
//   · 미래는 펼치고 지난 날짜는 이름만 남는 아코디언으로 접는다.
//
// 상태 규칙은 기존 결정 그대로다: 오늘 묶음은 끝난 상담도 배지와 함께 남고(CCC-66),
// 내일 이후 묶음은 예정만 남는다(CCC-57). 월 범위는 지난 일정의 상태를 전부 보여 준다(D54).

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
      <WireButton href="/schedules/new">상담 등록</WireButton>
    </div>
  );
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ProgramSchedulePage({
  params,
  searchParams,
}: {
  params: Promise<{ programType: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { programType } = await params;
  if (!isKnownProgramType(programType)) notFound();
  const query = await searchParams;
  // 범위는 URL 에 남는다 — 새로고침·공유에도 유지된다. week 외 값은 조용히 기본으로.
  const range: 'week' | 'month' = query.month !== undefined || query.range === 'month' ? 'month' : 'week';

  // 이 화면에 온 것이 곧 "이 사업을 골랐다"이다(ADR-0014 §2). 기억에 실패해도 화면은 뜬다.
  try {
    await rememberLastProgramType(programType);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }

  const basePath = `/programs/${encodeURIComponent(programType)}/schedule`;
  const fallbackTodayKey = new Date().toISOString().slice(0, 10);
  const frame = (month: string, todayKey: string, body: ReactNode) => (
    <main className="page-content">
      <GridContainer>
        <div className="page-header">
          <PageTitle>일정</PageTitle>
          {/* D35 축: 등록 2개는 사이드바가 아니라 페이지 우상단(행동 자리)이다. */}
          <div className="page-actions">
            <WireButton href="/participants/new">당사자 등록</WireButton>
            <WireButton href="/schedules/new" variant="primary">상담 등록</WireButton>
          </div>
        </div>
        <ScheduleControls basePath={basePath} range={range} todayKey={todayKey} month={month} />
        {body}
      </GridContainer>
    </main>
  );

  if (range === 'month') {
    // 형식이 어긋난 month 는 조용히 버리고 서버가 정한 이번 달로 떨어진다.
    const requested = typeof query.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)
      ? query.month
      : undefined;

    let board;
    try {
      board = await getMonthSchedules(requested);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      const message = scheduleErrorMessage(error);
      if (message === null) throw error;
      const month = requested ?? fallbackTodayKey.slice(0, 7);
      return frame(month, fallbackTodayKey, <WireError>{message}</WireError>);
    }

    // 응답의 date 는 그 달의 1일이다 — 기본 달은 서버가 기관 시간대로 정한다.
    const month = board.date.slice(0, 7);
    const mine = board.schedules.filter((schedule) => schedule.programType === programType);
    const todayKey = orgDateKey(new Date().toISOString(), board.timeZone);
    if (mine.length === 0) {
      return frame(month, todayKey, (
        <EmptyState
          title={`${formatMonthLabel(month)}에는 상담이 없습니다`}
          description="이전 달·다음 달로 옮겨 보거나 새 상담을 등록하세요."
        />
      ));
    }

    return frame(month, todayKey, (
      <ScheduleGroups schedules={mine} timeZone={board.timeZone} todayKey={todayKey} />
    ));
  }

  try {
    const board = await getUpcomingSchedules();
    const mine = board.schedules.filter((schedule) => schedule.programType === programType);
    // 오늘 묶음은 상태를 거르지 않고(CCC-66 — "3건 중 1건 끝"을 보는 자리), 내일 이후는
    // 예정만 남긴다(CCC-57 — 끝난 건이 서 있으면 유령 예정 일정이다).
    const visible = mine.filter((schedule) =>
      orgDateKey(schedule.scheduledAt, board.timeZone) === board.date || schedule.status === 'scheduled');
    if (visible.length === 0) {
      return frame(board.date.slice(0, 7), board.date, (
        <EmptyState
          title="앞으로 7일 안에 잡힌 상담이 없습니다"
          description="월 선택으로 지난 일정을 훑거나 새 상담을 등록하세요."
        />
      ));
    }

    return frame(board.date.slice(0, 7), board.date, (
      <ScheduleGroups schedules={visible} timeZone={board.timeZone} todayKey={board.date} />
    ));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const message = scheduleErrorMessage(error);
    if (message === null) throw error;
    return frame(
      fallbackTodayKey.slice(0, 7),
      fallbackTodayKey,
      <WireError>{message}</WireError>,
    );
  }
}
