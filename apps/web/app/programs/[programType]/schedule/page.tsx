import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatKoreanDate, formatKoreanTime } from '../../../lib/format-korean-date';
import {
  ApiError,
  getMonthSchedules,
  getUpcomingSchedules,
  rememberLastProgramType,
  type TodaySchedule,
} from '../../../lib/api';
import { GridContainer } from '../../../components/wire/grid-container';
import { PageTitle } from '../../../components/wire/page-title';
import { ParticipantCard } from '../../../components/wire/participant-card';
import { WireBadge } from '../../../components/wire/wire-badge';
import { WireButton } from '../../../components/wire/wire-button';
import { WireError } from '../../../components/wire/wire-state';
import { isKnownProgramType } from '../../../lib/labels';

// 통합 일정 화면 (D75 · ADR-0039, 2026-08-23 그릴링). '다가오는 일정'과 '전체 일정' 두 화면을
// `일정` 하나로 합쳤다 — 범위 전환 `다가오는 7일 | 월 전체`(?range=)가 두 창을 오간다.
//
//   · 기본(week)은 오늘 + 7일 창(getUpcomingSchedules). 첫 답은 "오늘과 다음 상담"이다.
//   · month 는 한 달 창(getMonthSchedules)을 1일→말일 날짜순으로 되돌아본다(D54 목적 유지).
//   · 둘 다 **일정이 있는 날짜만** 날짜별로 펼친다 — 빈 날짜는 그리지 않는다.
//   · 가장 가까운 예정 상담 카드 한 장만 그라데이션 아웃라인(선택 어휘)이다. 배지는 없다.
//   · 시간순 정렬 토글은 뺐다 — 날짜 묶음 제목이 순서를 이미 말한다.
//
// 상태 규칙은 기존 결정 그대로다: 오늘 묶음은 끝난 상담도 배지와 함께 남고(CCC-66),
// 내일 이후 묶음은 예정만 남는다(CCC-57). 월 범위는 지난 일정의 상태를 전부 보여 준다(D54).

/** 상담 종류 뱃지 문구 — 상담 기록 화면(D47)의 접힌 줄과 같은 어휘. */
const sessionKindLabels: Record<TodaySchedule['sessionKind'], string> = {
  regular: '기본 상담',
  intake: '인테이크',
};

/** 상태 배지 문구. 예정에는 붙이지 않는다 — 대부분이 예정이라 전부 붙으면 소음이다. */
const statusLabels: Record<TodaySchedule['status'], string | null> = {
  scheduled: null,
  completed: '완료',
  cancelled: '취소',
  no_show: '불참',
};

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

/** "2026년 8월" — 월 이동 줄의 라벨. */
function formatMonthLabel(month: string): string {
  const [year, monthIndex] = month.split('-').map(Number);
  return `${year}년 ${monthIndex}월`;
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, monthIndex! - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 카드를 누르면 가는 곳(D47 ① · D54). 완료 회차는 **그 회차가 펼쳐진 상담 기록**으로,
 * 그 밖(예정·취소·불참)은 브리핑으로 — 지난 것은 읽으러, 앞으로의 것은 준비하러 가는
 * 자리가 다르다.
 */
function rowHref(schedule: TodaySchedule): string {
  const base = `/participants/${encodeURIComponent(schedule.beneficiaryId)}`
    + `/programs/${encodeURIComponent(schedule.supportCaseId)}`;
  return schedule.completedSessionId === null
    ? `${base}/briefing`
    : `${base}/records#record-${encodeURIComponent(schedule.completedSessionId)}`;
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

interface DayGroup {
  readonly key: string;
  readonly isToday: boolean;
  readonly schedules: TodaySchedule[];
}

/** 서버가 시간순으로 내려준 일정을 날짜별로 묶는다 — 순서는 그대로 보존된다. */
function groupByDay(schedules: TodaySchedule[], timeZone: string, todayKey: string): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const schedule of schedules) {
    const key = orgDateKey(schedule.scheduledAt, timeZone);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.schedules.push(schedule);
    else groups.push({ key, isToday: key === todayKey, schedules: [schedule] });
  }
  return groups;
}

/** "8월 23일" — 날짜 묶음 제목. 연도는 페이지 맥락(이번 주·이번 달)이 이미 말해 준다. */
function formatDayHeading(key: string): string {
  const [, month, day] = key.split('-').map(Number);
  return `${month}월 ${day}일`;
}

function DayGroups({
  groups,
  nearestId,
  timeZone,
}: {
  groups: DayGroup[];
  nearestId: string | null;
  timeZone: string;
}) {
  return (
    <>
      {groups.map((group) => (
        <section key={group.key} className="schedule-section" aria-label={formatDayHeading(group.key)}>
          <h2 className="record-section-title">
            {formatDayHeading(group.key)}
            {/* '오늘'은 상태 낱말이라 배지로 올린다(§2-2 규칙 4). 시간 축이라 블루다. */}
            {group.isToday && <WireBadge tone="blue">오늘</WireBadge>}
            <span className="schedule-day-count">{group.schedules.length}건</span>
          </h2>
          <div className="card-grid">
            {group.schedules.map((schedule) => (
              <ParticipantCard
                key={schedule.id}
                href={rowHref(schedule)}
                selected={schedule.id === nearestId}
                schedule={{
                  date: formatKoreanDate(schedule.scheduledAt, timeZone),
                  time: formatKoreanTime(schedule.scheduledAt, timeZone),
                  kindLabel: sessionKindLabels[schedule.sessionKind],
                  ...(statusLabels[schedule.status] === null
                    ? {}
                    : { statusLabel: statusLabels[schedule.status] as string }),
                }}
                name={schedule.participantName}
                beneficiaryId={schedule.beneficiaryId}
                phone={schedule.participantPhone}
              />
            ))}
          </div>
        </section>
      ))}
    </>
  );
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
  const frame = (month: string | null, body: ReactNode) => (
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
        {/* 범위 전환. 고른 쪽은 '지금 정한 것' 어휘(--gradient-action 면, D58 ③)를 입는다. */}
        <nav className="schedule-range" aria-label="일정 범위">
          <Link
            className="schedule-range-seg"
            href={basePath}
            data-selected={range === 'week' ? 'true' : undefined}
            aria-current={range === 'week' ? 'true' : undefined}
          >
            다가오는 7일
          </Link>
          <Link
            className="schedule-range-seg"
            href={`${basePath}?range=month`}
            data-selected={range === 'month' ? 'true' : undefined}
            aria-current={range === 'month' ? 'true' : undefined}
          >
            월 전체
          </Link>
        </nav>
        {month !== null && (
          // 월 이동은 month 범위에서만 선다. 시안 ①(상자 하나)로 확정 — ?nav=2 스위치는 걷었다.
          <div className="month-nav">
            <div className="month-nav-group">
              <Link className="month-nav-seg" href={`${basePath}?range=month&month=${shiftMonth(month, -1)}`}>
                <span aria-hidden="true" className="wire-chevron" data-dir="left" />
                이전 달
              </Link>
              <span className="month-nav-label" aria-live="polite"><span>{formatMonthLabel(month)}</span></span>
              <Link className="month-nav-seg" href={`${basePath}?range=month&month=${shiftMonth(month, 1)}`}>
                다음 달
                <span aria-hidden="true" className="wire-chevron" data-dir="right" />
              </Link>
            </div>
          </div>
        )}
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
      return frame(requested ?? null, <WireError>{message}</WireError>);
    }

    // 응답의 date 는 그 달의 1일이다 — 기본 달은 서버가 기관 시간대로 정한다.
    const month = board.date.slice(0, 7);
    const mine = board.schedules.filter((schedule) => schedule.programType === programType);
    if (mine.length === 0) {
      return frame(month, (
        <EmptyState
          title={`${formatMonthLabel(month)}에는 상담이 없습니다`}
          description="이전 달·다음 달로 옮겨 보거나 새 상담을 등록하세요."
        />
      ));
    }

    // 오늘 강조는 이 달 안에 오늘이 있을 때만 붙는다 — '오늘'은 렌더 시점의 기관 시간대다.
    const todayKey = orgDateKey(new Date().toISOString(), board.timeZone);
    // 월 범위에서는 가장 가까운 카드 강조를 두지 않는다 — 되돌아보는 창이라 '다음'이 주인공이
    // 아니고, 지난 달로 옮기면 강조할 대상 자체가 없다. 강조는 기본 범위(week)의 몫이다.
    return frame(month, (
      <DayGroups groups={groupByDay(mine, board.timeZone, todayKey)} nearestId={null} timeZone={board.timeZone} />
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
      return frame(null, (
        <EmptyState
          title="앞으로 7일 안에 잡힌 상담이 없습니다"
          description="월 전체로 지난 일정을 훑거나 새 상담을 등록하세요."
        />
      ));
    }

    // 가장 가까운 예정 상담 = 시간순 첫 scheduled 건. 이 카드 한 장만 그라데이션 아웃라인.
    const nearestId = visible.find((schedule) => schedule.status === 'scheduled')?.id ?? null;
    return frame(null, (
      <DayGroups groups={groupByDay(visible, board.timeZone, board.date)} nearestId={nearestId} timeZone={board.timeZone} />
    ));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const message = scheduleErrorMessage(error);
    if (message === null) throw error;
    return frame(null, <WireError>{message}</WireError>);
  }
}
