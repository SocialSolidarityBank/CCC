import Link from 'next/link';
import { Suspense } from 'react';
import { ApiError, getParticipantBriefing } from '../../../../../lib/api';
import { updateOverallGoalAction } from '../../../../../actions';
import { isBeneficiaryId } from '../../../../../../../../db/animal-slugs';
import { GridContainer } from '../../../../../components/wire/grid-container';
import { getDisplayLabels } from '../../../../../lib/display-labels';
import { BriefingCards } from './briefing-cards';
import { IntakeSavedNotice } from './intake-saved-notice';

const supportCaseIdPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

type ErrorKind = 'authentication_required' | 'access_or_not_found' | 'service_unavailable';

const errorMessages: Record<ErrorKind, string> = {
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 상담 준비를 확인하세요.',
  access_or_not_found: '요청한 상담 준비 정보를 확인할 수 없습니다. 접근 권한과 주소를 확인하세요.',
  service_unavailable: '상담 준비를 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.',
};

function expectedApiErrorKind(error: ApiError): ErrorKind | null {
  switch (error.code) {
    case 'authentication_required':
      return 'authentication_required';
    case 'access_denied':
    case 'forbidden':
    case 'not_found':
      return 'access_or_not_found';
    case 'service_unavailable':
      return 'service_unavailable';
    default:
      return null;
  }
}

function participantHref(beneficiaryId: string): string {
  return `/participants/${encodeURIComponent(beneficiaryId)}`;
}

// 상담 준비를 본 다음의 주 동선은 기록 작성이다. 이 링크가 없으면 당사자 페이지까지
// 되돌아 나와야 해서 브리핑이 막다른 길이 된다(2026-07-26 Q 실사용 지적).
function recordsHref(beneficiaryId: string, supportCaseId: string): string {
  return `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}/records`;
}

// HERO 우상단 프라이머리 `상담 시작`(D22·D35)의 목적지. 이 앱에서 상담을 시작한다는 것은
// **기록을 여는 것**이다 — 별도의 '세션 시작' 상태가 없고, 상담 중 입력이 곧 기록지다.
function recordNewHref(beneficiaryId: string, supportCaseId: string): string {
  return `${recordsHref(beneficiaryId, supportCaseId)}/new`;
}

// 상담 일정(홈)으로 돌아가는 상단 '목록으로' 링크의 목적지.

function LoadingState() {
  return <main className="page-content" aria-busy="true"><header className="page-header"><div><h1>상담 준비</h1><p>승인된 상담 기록을 불러오는 중입니다.</p></div></header><div className="empty" role="status" aria-live="polite">상담 준비를 불러오는 중입니다.</div></main>;
}

function ErrorState({ beneficiaryId, kind }: { beneficiaryId: string; kind: ErrorKind }) {
  return <main className="page-content"><header className="page-header"><div><h1>상담 준비</h1><p>요청한 참여 사업을 표시할 수 없습니다.</p></div></header><p className="status risk" role="alert">{errorMessages[kind]}</p><Link className="detail-link" href={participantHref(beneficiaryId)}><span>참여 사업 목록으로 돌아가기</span></Link></main>;
}

function EmptyState({ beneficiaryId }: { beneficiaryId: string }) {
  return <main className="page-content"><header className="page-header"><div><h1>상담 준비</h1><p>표시할 승인된 상담 기록이 없습니다.</p></div></header><section className="panel"><div className="empty" role="status">상담 기록이 준비되면 이 화면에 표시합니다.</div></section><Link className="detail-link" href={participantHref(beneficiaryId)}><span>참여 사업 목록으로 돌아가기</span></Link></main>;
}

async function BriefingContent({ beneficiaryId, supportCaseId, notice }: { beneficiaryId: string; supportCaseId: string; notice: string | undefined }) {
  if (!isBeneficiaryId(beneficiaryId) || !supportCaseIdPattern.test(supportCaseId)) {
    return <ErrorState beneficiaryId={beneficiaryId} kind="access_or_not_found" />;
  }

  try {
    const briefing = await getParticipantBriefing(beneficiaryId, supportCaseId);
    const { programLabels } = await getDisplayLabels();
    const focused = briefing.sections[0];
    if (focused === undefined) return <EmptyState beneficiaryId={beneficiaryId} />;
    if (briefing.beneficiaryId !== beneficiaryId || briefing.focusSupportCaseId !== supportCaseId || focused.sourceSupportCase.id !== supportCaseId) {
      throw new Error('Briefing response did not match the requested scope.');
    }

    // 서버는 fetch·스코프 검증만 하고, 표현·폴백·전체 열기/닫기는 BriefingCards(클라이언트)가
    // 순수 데이터로 처리한다. 감사·접근은 getParticipantBriefing(게이트웨이)에서 이미 끝났다.
    // 셸(장폭·여백)은 .page-content 가 갖는다 — 컨테이너를 main 으로 쓰면 이 화면만
    // 여백 없이 1200 으로 벌어진다(2026-07-26 실측으로 확인).
    return (
      <GridContainer as="main" className="page-content">
        <IntakeSavedNotice notice={notice} beneficiaryId={beneficiaryId} supportCaseId={supportCaseId} />
        <BriefingCards
          beneficiaryId={beneficiaryId}
          supportCaseId={supportCaseId}
          overallGoal={briefing.overallGoal}
          canEditOverallGoal={briefing.canEditOverallGoal}
          overallGoalError={notice === 'overall_goal_error'}
          overallGoalAction={updateOverallGoalAction}
          participantHref={participantHref(beneficiaryId)}
          recordsHref={recordsHref(beneficiaryId, supportCaseId)}
          recordNewHref={recordNewHref(beneficiaryId, supportCaseId)}
          programLabel={programLabels[focused.sourceSupportCase.programType]}
          participant={briefing.participant}
          sessionRows={focused.sessionRows}
          discrepancies={focused.discrepancies}
          pendingApprovalCount={focused.lastSessionSummary?.pendingApprovalCount ?? 0}
          aiSuggestions={focused.aiSuggestions}
          openActionItems={focused.openActionItems}
          flags={focused.flags}
          upcomingSchedule={briefing.focusUpcomingSchedule}
        />
      </GridContainer>
    );
  } catch (error) {
    const kind = error instanceof ApiError ? expectedApiErrorKind(error) : null;
    if (kind === null) throw error;
    return <ErrorState beneficiaryId={beneficiaryId} kind={kind} />;
  }
}

export default async function ParticipantBriefingPage({
  params,
  searchParams,
}: {
  params: Promise<{ beneficiaryId: string; supportCaseId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ beneficiaryId, supportCaseId }, query] = await Promise.all([params, searchParams]);
  return (
    <Suspense fallback={<LoadingState />}>
      <BriefingContent beneficiaryId={beneficiaryId} supportCaseId={supportCaseId} notice={queryValue(query, 'notice')} />
    </Suspense>
  );
}
