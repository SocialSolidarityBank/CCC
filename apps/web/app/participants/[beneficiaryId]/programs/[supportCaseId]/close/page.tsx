import { Suspense } from 'react';
import {
  ApiError,
  getParticipantBriefing,
  getParticipantGoalTree,
  getSupportCaseClosureInfo,
  type SupportCaseClosureInfo,
} from '../../../../../lib/api';
import { closeSupportCaseAction } from '../../../../../actions';
import { isBeneficiaryId } from '@ccc/contracts/animal-slugs';
import { GridContainer } from '../../../../../components/wire/grid-container';
import { PageError } from '../../../../../components/wire/page-error';
import { PageLoading } from '../../../../../components/wire/page-loading';
import { PageTitle } from '../../../../../components/wire/page-title';
import { WireBadge } from '../../../../../components/wire/wire-badge';
import { WireButton } from '../../../../../components/wire/wire-button';
import { ActiveGoalsCard, CaseCloseForm, ClosedCaseSummary, OpenActionItemsCard } from './close-cards';

// 케이스 종결 확인 화면 (CCC-107). 플로우맵 정의: "지원 기록을 닫고 보관 기간을 세기 시작한다".
//
// 종결 전에는 남은 일(미해결 액션 아이템·활성 세부 목표)을 보여주고, 필수 사유 + 확인
// 체크를 받아 서버 액션(closeSupportCaseAction)으로 실행한다. 이미 종결된 케이스면
// 종결일·사유·파기 예정일(purge_due)을 읽기 전용으로 보여준다.
//
// 권한·감사는 전부 서버 몫이다(R1): 조회는 getSupportCaseClosureInfo(read 감사),
// 실행은 gateway closeSupportCase(close 감사 1행, 성공과 원자적). purge_due 는 DB
// 트리거가 정하고(D10) 파기 실행은 CCC-113 소관이라 이 화면은 아무것도 파기하지 않는다.

const supportCaseIdPattern = /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

type ErrorKind = 'authentication_required' | 'access_or_not_found' | 'service_unavailable';

const errorMessages: Record<ErrorKind, string> = {
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 시도하세요.',
  access_or_not_found: '요청한 케이스 정보를 확인할 수 없습니다. 접근 권한과 주소를 확인하세요.',
  service_unavailable: '케이스 정보를 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.',
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

/** 종결 결과 안내. 성공 코드는 case_closed 하나다 — PII 는 주소에 싣지 않는다(R3). */
const NOTICES: Record<string, string> = {
  case_closed: '케이스를 종결했습니다. 지원 기록이 닫히고 보관 기간이 시작됩니다.',
};

const ERRORS: Record<string, string> = {
  invalid_request: '종결 사유를 입력하고 확인란에 체크했는지 확인하세요.',
  validation_error: '종결 사유를 입력하고 확인란에 체크했는지 확인하세요.',
  conflict: '이미 종결됐거나 지금은 종결할 수 없는 케이스입니다. 화면을 새로 고쳐 확인하세요.',
  access_denied: '이 케이스를 종결할 권한이 없습니다.',
  forbidden: '이 케이스를 종결할 권한이 없습니다.',
  not_found: '요청한 케이스를 찾을 수 없습니다.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 시도하세요.',
  service_unavailable: '지금은 종결할 수 없습니다. 잠시 후 다시 시도하세요.',
};

function LoadingState() {
  return <PageLoading title="케이스 종결" message="케이스 정보를 불러오는 중입니다." />;
}

function ErrorState({ beneficiaryId, kind }: { beneficiaryId: string; kind: ErrorKind }) {
  return (
    <PageError
      title="케이스 종결"
      action={<WireButton variant="secondary" href={participantHref(beneficiaryId)}>당사자 정보로 돌아가기</WireButton>}
    >
      {errorMessages[kind]}
    </PageError>
  );
}

/** 테스트가 Suspense 없이 직접 렌더할 수 있게 내보낸다(consent-editor 패턴). */
export async function CloseContent({ beneficiaryId, supportCaseId, notice, error }: {
  beneficiaryId: string;
  supportCaseId: string;
  notice: string | undefined;
  error: string | undefined;
}) {
  if (!isBeneficiaryId(beneficiaryId) || !supportCaseIdPattern.test(supportCaseId)) {
    return <ErrorState beneficiaryId={beneficiaryId} kind="access_or_not_found" />;
  }

  try {
    const closure: SupportCaseClosureInfo = await getSupportCaseClosureInfo(supportCaseId);
    if (closure.beneficiaryId !== beneficiaryId || closure.supportCaseId !== supportCaseId) {
      // 주소의 당사자와 케이스가 어긋난 접근은 없는 주소와 같게 다룬다.
      return <ErrorState beneficiaryId={beneficiaryId} kind="access_or_not_found" />;
    }

    const noticeText = notice === undefined ? undefined : NOTICES[notice];

    if (closure.status === 'closed') {
      return (
        <GridContainer as="main" className="page-content">
          <div className="page-header"><PageTitle>케이스 종결</PageTitle></div>
          {noticeText !== undefined && (
          <WireBadge role="status" aria-live="polite">{noticeText}</WireBadge>
          )}
          <ClosedCaseSummary info={closure} />
          <div>
            <WireButton variant="secondary" href={participantHref(beneficiaryId)}>당사자 정보로 돌아가기</WireButton>
          </div>
        </GridContainer>
      );
    }

    // 종결 전 확인 재료: 브리핑의 미해결 액션 아이템(포커스 케이스 구획) + 목표 트리의
    // 활성 세부 목표 전량(브리핑 activeGoals 는 3줄로 끊겨 확인 목록으로는 모자라다).
    const [briefing, goalTree] = await Promise.all([
      getParticipantBriefing(beneficiaryId, supportCaseId),
      getParticipantGoalTree(beneficiaryId),
    ]);
    const focused = briefing.sections.find((section) => section.sourceSupportCase.id === supportCaseId);
    const openActionItems = focused?.openActionItems ?? [];
    const activeGoals = (goalTree.find((entry) => entry.sourceSupportCase.id === supportCaseId)?.goals ?? [])
      .filter((goal) => goal.status === 'active')
      .map((goal) => ({ id: goal.id, title: goal.title }));

    const errorText = error === undefined ? undefined : ERRORS[error] ?? ERRORS.service_unavailable;

    return (
      <GridContainer as="main" className="page-content">
        <div className="page-header"><PageTitle>케이스 종결</PageTitle></div>
        <OpenActionItemsCard items={openActionItems} />
        <ActiveGoalsCard goals={activeGoals} />
        <CaseCloseForm
          beneficiaryId={beneficiaryId}
          supportCaseId={supportCaseId}
          action={closeSupportCaseAction}
          errorText={errorText}
        />
        <div>
          <WireButton variant="secondary" href={participantHref(beneficiaryId)}>당사자 정보로 돌아가기</WireButton>
        </div>
      </GridContainer>
    );
  } catch (error) {
    const kind = error instanceof ApiError ? expectedApiErrorKind(error) : null;
    if (kind === null) throw error;
    return <ErrorState beneficiaryId={beneficiaryId} kind={kind} />;
  }
}

export default async function SupportCaseClosePage({
  params,
  searchParams,
}: {
  params: Promise<{ beneficiaryId: string; supportCaseId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ beneficiaryId, supportCaseId }, query] = await Promise.all([params, searchParams]);
  return (
    <Suspense fallback={<LoadingState />}>
      <CloseContent
        beneficiaryId={beneficiaryId}
        supportCaseId={supportCaseId}
        notice={queryValue(query, 'notice')}
        error={queryValue(query, 'error')}
      />
    </Suspense>
  );
}
