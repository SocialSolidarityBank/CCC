import type { ReactNode } from 'react';
import { formatKoreanDate, formatKoreanTime } from '../../../lib/format-korean-date';
import { notFound } from 'next/navigation';
import { ApiError, getUpcomingSchedules, rememberLastProgramType } from '../../../lib/api';
import { GridContainer } from '../../../components/wire/grid-container';
import { PageTitle } from '../../../components/wire/page-title';
import { WireButton } from '../../../components/wire/wire-button';
import { WireError } from '../../../components/wire/wire-state';
import { isKnownProgramType } from '../../../lib/labels';
import { ScheduleCards, type ScheduleCardItem } from './schedule-cards';

// 재개편 T3(#33): 선택된 참여 사업의 상담 카드 목록. 데이터는 오늘 + 향후 7일 일정
// (getUpcomingSchedules)을 사업 유형으로 거른 뒤 **오늘 / 앞으로 두 칸으로 가른 것**이다
// (CCC-66). 상태 거르기는 앞으로 칸에만 걸린다(CCC-57). 아래 today·upcoming 주석 참조.
// 실명·연락처는 T2(D24) 응답 필드
// participantName·participantPhone을 그대로 쓴다(담당 실무자·기관 관리자·admin에게만 값,
// 그 외 null → 가명 ID / '—' 폴백). 감사는 게이트웨이가 자동 처리한다.

// 날짜·시각 표기는 공용 계약이다(2026-08-07 Q 통일 — "2026년 7월 17일" + "오후 1:00",
// 요일 표기는 뺐다). 기관 시간대는 board.timeZone 을 그대로 넘긴다.

/** 상담 종류 뱃지 문구 — 전체 일정과 같은 어휘(D47). */
const sessionKindLabels: Record<'regular' | 'intake', string> = {
  regular: '기본 상담',
  intake: '인테이크',
};

/** 상태 배지 문구. 전체 일정과 같은 표(D54)이고 예정에는 붙이지 않는다. */
const statusLabels: Record<'scheduled' | 'completed' | 'cancelled' | 'no_show', string | null> = {
  scheduled: null,
  completed: '완료',
  cancelled: '취소',
  no_show: '불참',
};

/**
 * 기관 시간대 기준 달력 날짜(YYYY-MM-DD). 서버가 준 board.date 와 같은 모양이라 그대로 비교한다.
 * 'en-CA' 로케일이 이 형식을 준다. 문자열을 직접 자르면 UTC 기준이 되어 자정 근처 일정이
 * 하루씩 어긋난다.
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
      return '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 다가오는 일정을 확인하세요.';
    case 'access_denied':
    case 'forbidden':
    case 'not_found':
      return '다가오는 일정 정보를 확인할 수 없습니다. 접근 권한을 확인하세요.';
    case 'service_unavailable':
      return '다가오는 일정을 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.';
    default:
      return null;
  }
}

function briefingHref(beneficiaryId: string, supportCaseId: string): string {
  return `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}/briefing`;
}

export default async function ProgramSchedulePage({
  params,
}: {
  params: Promise<{ programType: string }>;
}) {
  const { programType } = await params;
  if (!isKnownProgramType(programType)) notFound();

  // 이 화면에 온 것이 곧 "이 사업을 골랐다"이다 — 사업 전환기는 사업이 1개인 동안
  // 라벨이라 누르는 사건이 없기 때문이다(ADR-0014 §2). 값이 이미 같으면 게이트웨이가
  // 쓰기를 건너뛰므로 화면 진입마다 DB 쓰기가 돌지 않는다.
  // 기억에 실패해도 화면은 그대로 뜬다 — 다음 `/` 진입이 첫 사업으로 떨어질 뿐이다.
  try {
    await rememberLastProgramType(programType);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }

  // D35 · ADR-0014 §2: 등록 2개는 사이드바에 넣지 않고 **페이지 우상단**에 둔다.
  // 상단 헤더가 사라지면서(CCC-18a) 두 진입점이 화면에서 통째로 없어졌으므로 여기서 잇는다.
  // 축은 사이드바=장소 / 우상단=행동이고, 등록은 행동이다.
  //
  // 사업명 ListRow(구 홈 아코디언으로 돌아가는 줄)는 삭제했다 — `/`가 이제 이 화면으로
  // 리다이렉트해서 자기 자신으로 돌아오는 고리였고, 지금 사업이 무엇인지는 사이드바
  // 전환기가 상시 보여준다.
  const frame = (body: ReactNode) => (
    <main className="page-content">
      <GridContainer>
        <div className="page-header">
          <PageTitle>다가오는 일정</PageTitle>
          <div className="page-actions">
            <WireButton href="/participants/new">당사자 등록</WireButton>
            <WireButton href="/schedules/new" variant="primary">상담 등록</WireButton>
          </div>
        </div>
        {body}
      </GridContainer>
    </main>
  );

  try {
    const board = await getUpcomingSchedules();
    // getUpcomingSchedules는 scheduled_at·id 오름차순(시간순)으로 내려온다.
    const mine = board.schedules.filter((schedule) => schedule.programType === programType);
    const toCard = (schedule: (typeof mine)[number]): ScheduleCardItem => ({
      id: schedule.id,
      href: briefingHref(schedule.beneficiaryId, schedule.supportCaseId),
      schedule: {
        date: formatKoreanDate(schedule.scheduledAt, board.timeZone),
        time: formatKoreanTime(schedule.scheduledAt, board.timeZone),
        kindLabel: sessionKindLabels[schedule.sessionKind],
        // 오늘 칸에만 붙는다(아래 today). 예정에는 배지를 달지 않는다. 대부분이 예정이라
        // 전부 붙으면 소음이다(D54 와 같은 규칙).
        ...(statusLabels[schedule.status] === null ? {} : { statusLabel: statusLabels[schedule.status] as string }),
      },
      participantName: schedule.participantName,
      beneficiaryId: schedule.beneficiaryId,
      participantPhone: schedule.participantPhone,
    });

    // 오늘 / 앞으로 가르기(CCC-66, 2026-08-08 Q 결정). 기준일은 서버가 정한 기관 시간대의
    // 오늘(board.date)이다. 브라우저 시간대로 가르면 사람마다 '오늘'이 달라진다.
    const today = mine.filter((schedule) => orgDateKey(schedule.scheduledAt, board.timeZone) === board.date);
    // 앞으로는 예정만 남긴다(CCC-57). 끝난 건이 서 있으면 유령 예정 일정이다.
    // 오늘 칸은 거르지 않는다: "3건 중 1건 끝"을 보는 자리라 끝난 건도 배지를 달고 남는다.
    const upcoming = mine.filter(
      (schedule) => orgDateKey(schedule.scheduledAt, board.timeZone) !== board.date && schedule.status === 'scheduled',
    );

    return frame(<ScheduleCards today={today.map(toCard)} upcoming={upcoming.map(toCard)} />);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    const message = scheduleErrorMessage(error);
    if (message === null) throw error;
    return frame(<WireError>{message}</WireError>);
  }
}
