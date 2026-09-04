import { Suspense } from 'react';
import {
  ApiError,
  getAiDraft,
  getParticipantDetail,
  listSupportCaseRecords,
  type ApiErrorCode,
  type AiDraftReviewDecision,
  type SupportCaseRecord,
} from '../../../../../../../lib/api';
import {
  createActionItemFromAiClaimAction,
  generateAiDraftAction,
  reviewAiDraftAction,
} from '../../../../../../../actions';
import { formatKoreanDate } from '../../../../../../../lib/format-korean-date';
import { PageError } from '../../../../../../../components/wire/page-error';
import { PageLoading } from '../../../../../../../components/wire/page-loading';
import { WireButton } from '../../../../../../../components/wire/wire-button';
import { DraftReviewView } from './fixture-draft-view';

type ErrorKind = 'authentication_required' | 'access_or_not_found' | 'service_unavailable';

const errorMessages: Record<ErrorKind, string> = {
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 확인하세요.',
  access_or_not_found: '요청한 AI 초안을 확인할 수 없습니다. 접근 권한과 주소를 확인하세요.',
  service_unavailable: 'AI 초안을 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.',
};

// 처리(승인·반려) 실패 안내(리다이렉트 뒤 ?error= 파라미터, R2·D69·ADR-0036).
// 알려지지 않은 코드는 마지막 항목으로 뭉친다 — 화면이 원인 불명 오류를 숨기지 않는다.
const actionErrorMessages: Partial<Record<ApiErrorCode, string>> = {
  stale_draft_version: '다른 곳에서 이 초안이 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.',
  fixture_draft_approval_forbidden: '테스트 산출물은 승인할 수 없습니다.',
  grounded_evidence_required: '근거 인용이 모두 붙어야 승인할 수 있습니다.',
  speaker_confirmation_required: '녹음이 있는 회차는 화자 구분 확인을 마쳐야 승인할 수 있습니다.',
  access_denied: '담당 실무자와 기관 관리자만 처리할 수 있습니다.',
  forbidden: '담당 실무자와 기관 관리자만 처리할 수 있습니다.',
};
const actionErrorFallback = '처리하지 못했습니다. 잠시 후 다시 시도하세요.';

// 재생성 실패 안내(검수 지적 6) — 처리 실패와 같은 기본 문구를 쓰면 승인·반려가 실패한
// 것인지 재생성이 실패한 것인지 구분이 안 된다. generateAiDraftAction 이 실패 리다이렉트에
// 함께 심는 errorSource=regenerate 로만 이 표를 골라 쓴다(안내가 서는 자리는 그대로다).
const regenerateErrorMessages: Partial<Record<ApiErrorCode, string>> = {
  stale_draft_version: '이 초안은 이미 처리되어 다시 만들 수 없습니다. 새로고침한 뒤 확인하세요.',
  access_denied: '담당 실무자와 기관 관리자만 다시 만들 수 있습니다.',
  forbidden: '담당 실무자와 기관 관리자만 다시 만들 수 있습니다.',
  pilot_text_ai_consent_required: 'AI 정리 동의가 필요해 다시 만들지 못했습니다. 당사자 정보에서 동의를 먼저 확인하세요.',
  text_ai_pilot_disabled: '지금은 텍스트 AI 파일럿이 꺼져 있어 다시 만들지 못했습니다.',
  ai_provider_not_configured: 'AI 사업자 설정이 없어 다시 만들지 못했습니다.',
  ai_provider_unavailable: 'AI 사업자를 지금 부를 수 없어 다시 만들지 못했습니다. 잠시 후 다시 시도하세요.',
  ai_prohibited_output: 'AI 산출물이 금지된 내용을 포함해 다시 만들지 못했습니다.',
};
const regenerateErrorFallback = '다시 만들지 못했습니다. 잠시 후 다시 시도하세요.';

// 처리 사실을 HERO 상태 태그에 반영한다(검수 지적 5) — 승인·반려가 끝난 초안은 '검토 대기'라는
// 거짓을 말하지 않는다. superseded 는 "현재" 초안(getCurrentAiDraftForSession)에는 오지 않는
// 상태라 실질적으로 도달하지 않지만, 타입을 다 채워 둔다.
const stageTagByReviewDecision: Record<'approved' | 'rejected' | 'superseded', string> = {
  approved: '승인됨',
  rejected: '반려됨',
  superseded: '검토 대기',
};
function stageTagFor(reviewDecision: AiDraftReviewDecision): string {
  return reviewDecision === null ? '검토 대기' : stageTagByReviewDecision[reviewDecision];
}

const sessionChannelLabels: Record<SupportCaseRecord['channel'], string> = {
  in_person: '대면',
  phone: '전화',
  video: '화상',
};

function safeId(value: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null;
}

function expectedApiErrorKind(error: ApiError): ErrorKind {
  if (error.code === 'authentication_required') return 'authentication_required';
  if (error.code === 'service_unavailable') return 'service_unavailable';
  return 'access_or_not_found';
}

function recordsHref(beneficiaryId: string, supportCaseId: string): string {
  return `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}/records`;
}

function LoadingState() {
  return <PageLoading title="AI 초안 검토" message="검토할 AI 초안을 불러오는 중입니다." />;
}

function ErrorState({
  beneficiaryId,
  supportCaseId,
  kind,
}: {
  beneficiaryId: string;
  supportCaseId: string;
  kind: ErrorKind;
}) {
  return (
    <PageError
      title="AI 초안 검토"
      action={(
        <WireButton variant="secondary" href={recordsHref(beneficiaryId, supportCaseId)}>
          상담 기록 확인하기
        </WireButton>
      )}
    >
      {errorMessages[kind]}
    </PageError>
  );
}

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

function errorMessageFor(error: string | undefined, source: string | undefined): string | undefined {
  if (error === undefined) return undefined;
  if (source === 'regenerate') {
    return regenerateErrorMessages[error as ApiErrorCode] ?? regenerateErrorFallback;
  }
  return actionErrorMessages[error as ApiErrorCode] ?? actionErrorFallback;
}

function successMessageFor(notice: string | undefined): string | undefined {
  return notice === 'action_item_created' ? '액션 아이템을 등록했습니다.' : undefined;
}

export async function ReviewContent({
  beneficiaryId,
  supportCaseId,
  sessionId,
  errorCode,
  errorSource,
  noticeCode,
}: {
  beneficiaryId: string;
  supportCaseId: string;
  sessionId: string;
  errorCode: string | undefined;
  errorSource: string | undefined;
  noticeCode?: string | undefined;
}) {
  if (safeId(beneficiaryId) === null || safeId(supportCaseId) === null || safeId(sessionId) === null) {
    return <ErrorState beneficiaryId={beneficiaryId} supportCaseId={supportCaseId} kind="access_or_not_found" />;
  }

  try {
    const [caseRecords, participant] = await Promise.all([
      listSupportCaseRecords(beneficiaryId, supportCaseId),
      getParticipantDetail(beneficiaryId),
    ]);
    const session = caseRecords.records.find((record) => record.id === sessionId);
    const program = participant.programs.find((candidate) => candidate.id === supportCaseId);
    if (
      session === undefined
      || participant.beneficiaryId !== beneficiaryId
      || program === undefined
      || !program.authorized
    ) {
      return <ErrorState beneficiaryId={beneficiaryId} supportCaseId={supportCaseId} kind="access_or_not_found" />;
    }

    const draft = await getAiDraft(sessionId);
    // 프리뷰 fixture 검수뿐 아니라 실제 생성 초안도 이 화면에서 검토·승인한다(D69 · ADR-0036
    // · CCC-100 — CCC-67 이 지적한 "뒷단만 있고 화면 없음" 간극을 여기서 덮는다). legacy_import
    // 초안(v0 시절 데이터)만 이 화면 밖이다 — 승인·재생성 흐름이 전제하는 재료·대조가 없다.
    if (draft === null || draft.origin === 'legacy_import') {
      return <ErrorState beneficiaryId={beneficiaryId} supportCaseId={supportCaseId} kind="access_or_not_found" />;
    }

    return (
      <DraftReviewView
        beneficiaryId={beneficiaryId}
        supportCaseId={supportCaseId}
        sessionId={sessionId}
        participantName={participant.name}
        stageTag={stageTagFor(draft.reviewDecision)}
        stageTagTone="lavender"
        metaItems={[formatKoreanDate(session.heldAt), sessionChannelLabels[session.channel]]}
        recordsHref={recordsHref(beneficiaryId, supportCaseId)}
        draft={{
          origin: draft.origin,
          creationMode: draft.creationMode,
          version: draft.version,
          summaryText: draft.summaryText,
          claims: draft.claims,
          oneLiner: draft.oneLiner,
          questions: draft.questions,
          evidence: draft.evidence,
          reviewDecision: draft.reviewDecision,
          contrast: draft.contrast,
          regenerateAvailable: draft.regenerateAvailable,
          regenerateSourceSnapshotId: draft.regenerateSourceSnapshotId,
          transcriptQuality: draft.transcriptQuality ?? null,
        }}
        errorMessage={errorMessageFor(errorCode, errorSource)}
        successMessage={successMessageFor(noticeCode)}
        reviewAction={reviewAiDraftAction}
        generateAction={generateAiDraftAction}
        actionItemAction={createActionItemFromAiClaimAction}
      />
    );
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return (
      <ErrorState
        beneficiaryId={beneficiaryId}
        supportCaseId={supportCaseId}
        kind={expectedApiErrorKind(error)}
      />
    );
  }
}

export default async function FixtureDraftReviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ beneficiaryId: string; supportCaseId: string; sessionId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const [{ beneficiaryId, supportCaseId, sessionId }, query] = await Promise.all([params, searchParams]);
  return (
    <Suspense fallback={<LoadingState />}>
      <ReviewContent
        beneficiaryId={beneficiaryId}
        supportCaseId={supportCaseId}
        sessionId={sessionId}
        errorCode={queryValue(query, 'error')}
        errorSource={queryValue(query, 'errorSource')}
        noticeCode={queryValue(query, 'notice')}
      />
    </Suspense>
  );
}
