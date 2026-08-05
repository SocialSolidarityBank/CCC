import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ApiError, getMonthSchedules, type TodaySchedule } from '../../../../lib/api';
import { GridContainer } from '../../../../components/wire/grid-container';
import { PageTitle } from '../../../../components/wire/page-title';
import { WireButton } from '../../../../components/wire/wire-button';
import { WireCard } from '../../../../components/wire/wire-card';
import { isKnownProgramType } from '../../../../lib/labels';

// 사이드바 '전체 일정'(D35 · ADR-0014 §2)의 도착지 — CCC-19.
//
// 이 자리는 CCC-18 이 사이드바에 메뉴만 잡고 화면을 만들지 않아 한동안 '준비 중' 빈 화면이었다.
// 2026-07-31 그릴링에서 Q 가 CCC-19 의 열린 질문 중 둘을 닫아 화면이 정해졌다:
//
//   ① 무엇하러 여나 → **지난·앞으로 둘 다**. 한 달을 통으로 보며 앞으로의 약속과 지난 상담을
//      함께 훑는다. '다가오는 일정'(8일 창)은 "다음에 뭐 하나", 이 화면은 "전체를 되돌아본다"로
//      경계가 갈린다(티켓 질문 10).
//   ② 모양 → **날짜별 목록**(달력 격자 아님). DESIGN.md §5 의 리스트 행 계약이 이미 있고,
//      상담이 하루 1~2건이라 격자는 대부분 빈칸이 된다.
//
// 나머지 질문은 기존 결정이 닫는다 — 사업 범위는 워크스페이스가 정하고(D35), 담당 범위는
// 게이트웨이가 이미 강제하며(D7: 실무자는 담당만·관리자는 기관 전체), 가로축은 날짜,
// 분량은 달 단위 이동이라 페이지네이션이 필요 없다. 필터는 두지 않는다 — 달 창 자체가
// 필터이고, 무엇을 거르고 싶은지는 써 보기 전에 알 수 없다.

const weekdayNames = ['일', '월', '화', '수', '목', '금', '토'] as const;

/** 유형 칩 문구. 상담 기록 화면(D47)의 접힌 줄과 같은 어휘를 쓴다. */
const sessionKindLabels: Record<TodaySchedule['sessionKind'], string> = {
  intake: '인테이크',
  regular: '기본 상담',
};

/** 상태 배지 문구. 예정에는 붙이지 않는다 — 대부분이 예정이라 전부 붙으면 소음이다. */
const statusLabels: Record<TodaySchedule['status'], string | null> = {
  scheduled: null,
  completed: '완료',
  cancelled: '취소',
  no_show: '불참',
};

function zonedParts(instant: string, timeZone: string): { date: string; time: string } {
  const value = new Date(instant);
  if (Number.isNaN(value.valueOf())) throw new Error('Invalid schedule timestamp');
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
  const time = new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(value);
  return { date, time };
}

/** "8월 3일 (월)" — 날짜 묶음의 제목. */
function formatDayTitle(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const weekday = weekdayNames[new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay()];
  return `${month}월 ${day}일 (${weekday})`;
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
 * 줄을 누르면 가는 곳. 완료된 회차는 **그 회차가 펼쳐진 상담 기록**으로(D47 ① 앵커),
 * 그 밖(예정·취소·불참)은 브리핑으로 보낸다 — 지난 것은 읽으러, 앞으로의 것은 준비하러
 * 가는 자리가 다르다.
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
      return '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 전체 일정을 확인하세요.';
    case 'access_denied':
    case 'forbidden':
    case 'not_found':
      return '전체 일정을 확인할 수 없습니다. 접근 권한을 확인하세요.';
    case 'service_unavailable':
      return '전체 일정을 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.';
    default:
      return null;
  }
}

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ProgramScheduleAllPage({
  params,
  searchParams,
}: {
  params: Promise<{ programType: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { programType } = await params;
  if (!isKnownProgramType(programType)) notFound();
  const query = await searchParams;
  // 형식이 어긋난 month 는 조용히 버리고 서버가 정한 이번 달로 떨어진다 — 주소를 손으로
  // 고친 사람에게 오류 화면을 띄울 이유가 없다.
  const requested = typeof query.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(query.month)
    ? query.month
    : undefined;

  const frame = (month: string | null, body: ReactNode) => (
    <main className="page-content">
      <GridContainer>
        <div className="page-header">
          <PageTitle>전체 일정</PageTitle>
          <div className="page-actions">
            <WireButton href="/schedules/new" variant="primary">상담 등록</WireButton>
          </div>
        </div>
        {month !== null && (
          <div className="month-nav">
            <WireButton href={`/programs/${programType}/schedule/all?month=${shiftMonth(month, -1)}`}>
              ‹ 이전 달
            </WireButton>
            <span className="month-nav-label" aria-live="polite">{formatMonthLabel(month)}</span>
            <WireButton href={`/programs/${programType}/schedule/all?month=${shiftMonth(month, 1)}`}>
              다음 달 ›
            </WireButton>
          </div>
        )}
        {body}
      </GridContainer>
    </main>
  );

  let board;
  try {
    board = await getMonthSchedules(requested);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const message = scheduleErrorMessage(error);
    if (message === null) throw error;
    return frame(requested ?? null, <p role="alert" style={{ color: 'var(--ink)' }}>{message}</p>);
  }

  // 응답의 date 는 그 달의 1일이다 — 기본 달을 서버가 정하므로 화면은 여기서 달을 읽는다.
  const month = board.date.slice(0, 7);
  const today = zonedParts(new Date().toISOString(), board.timeZone).date;

  // 사업 범위는 워크스페이스가 정한다(D35) — 다른 사업의 일정은 이 화면에 오지 않는다.
  const rows = board.schedules
    .filter((schedule) => schedule.programType === programType)
    .map((schedule) => ({ schedule, ...zonedParts(schedule.scheduledAt, board.timeZone) }));

  // 서버가 scheduled_at 오름차순으로 내려주므로 삽입 순서가 곧 시간순이다.
  const days = new Map<string, typeof rows>();
  for (const row of rows) {
    const bucket = days.get(row.date);
    if (bucket === undefined) days.set(row.date, [row]);
    else bucket.push(row);
  }

  if (days.size === 0) {
    return frame(month, (
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
        <p className="wire-empty-title">{formatMonthLabel(month)}에는 상담이 없습니다</p>
        <p className="wire-empty-desc">이전 달·다음 달로 옮겨 보거나 새 상담을 등록하세요.</p>
        <WireButton href="/schedules/new">상담 등록</WireButton>
      </div>
    ));
  }

  return frame(month, (
    <>
      {[...days.entries()].map(([date, entries]) => (
        // 날짜 묶음은 카드다(2026-08-05 Q 카드화 · ADR-0030 — 구 D59 플랫 대체).
        // 안의 행은 붙어 있으므로 카드가 아니라 --line 구분선이다(§5 리스트 행 맥락 규칙).
        <WireCard
          as="section"
          className="month-day"
          key={date}
          labelledBy={`month-day-${date}`}
          title={<h2 className="month-day-title" id={`month-day-${date}`} data-today={date === today ? 'true' : undefined}>
            {formatDayTitle(date)}
          </h2>}
        >
          <div className="month-rows">
            {entries.map(({ schedule, time }) => {
              const status = statusLabels[schedule.status];
              return (
                <Link className="month-row" key={schedule.id} href={rowHref(schedule)}>
                  <span className="month-row-time">{time}</span>
                  {/* 이름 표기(D59): 가명 ID 는 화면에 없다 — 동명이인 구분은 연락처가 맡는다.
                      이름이 없으면 ID 폴백(그때만 화면에 나온다). */}
                  <span className="month-row-name">
                    <b>{schedule.participantName ?? schedule.beneficiaryId}</b>
                    {schedule.participantPhone !== null && <span>{schedule.participantPhone}</span>}
                  </span>
                  <span className="month-row-right">
                    <span className="month-row-kind">{sessionKindLabels[schedule.sessionKind]}</span>
                    {status !== null && <span className="month-row-status">{status}</span>}
                  </span>
                </Link>
              );
            })}
          </div>
        </WireCard>
      ))}
    </>
  ));
}
