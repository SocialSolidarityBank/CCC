import { Suspense } from 'react';
import {
  ApiError,
  getAiDraft,
  getParticipantDetail,
  listSupportCaseRecords,
  type SupportCaseRecord,
} from '../../../../../../../lib/api';
import { formatKoreanDate } from '../../../../../../../lib/format-korean-date';
import { PageError } from '../../../../../../../components/wire/page-error';
import { PageLoading } from '../../../../../../../components/wire/page-loading';
import { WireButton } from '../../../../../../../components/wire/wire-button';
import { FixtureDraftView } from './fixture-draft-view';

type ErrorKind = 'authentication_required' | 'access_or_not_found' | 'service_unavailable';

const errorMessages: Record<ErrorKind, string> = {
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 확인하세요.',
  access_or_not_found: '요청한 테스트 산출물을 확인할 수 없습니다. 접근 권한과 주소를 확인하세요.',
  service_unavailable: '테스트 산출물을 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.',
};

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
  return <PageLoading title="테스트 산출물 검수" message="검수할 테스트 산출물을 불러오는 중입니다." />;
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
      title="테스트 산출물 검수"
      action={(
        <WireButton variant="secondary" href={recordsHref(beneficiaryId, supportCaseId)}>
          전체 상담 기록으로 돌아가기
        </WireButton>
      )}
    >
      {errorMessages[kind]}
    </PageError>
  );
}

export async function ReviewContent({
  beneficiaryId,
  supportCaseId,
  sessionId,
}: {
  beneficiaryId: string;
  supportCaseId: string;
  sessionId: string;
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
    if (draft === null || draft.origin !== 'fixture_generated' || draft.creationMode !== 'fixture_generated') {
      return <ErrorState beneficiaryId={beneficiaryId} supportCaseId={supportCaseId} kind="access_or_not_found" />;
    }

    return (
      <FixtureDraftView
        beneficiaryId={beneficiaryId}
        participantName={participant.name}
        stageTag="검토 대기"
        metaItems={[formatKoreanDate(session.heldAt), sessionChannelLabels[session.channel]]}
        recordsHref={recordsHref(beneficiaryId, supportCaseId)}
        draft={{
          origin: draft.origin,
          creationMode: draft.creationMode,
          summaryText: draft.summaryText,
          oneLiner: draft.oneLiner,
          questions: draft.questions,
          evidence: draft.evidence,
        }}
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
}: {
  params: Promise<{ beneficiaryId: string; supportCaseId: string; sessionId: string }>;
}) {
  const { beneficiaryId, supportCaseId, sessionId } = await params;
  return (
    <Suspense fallback={<LoadingState />}>
      <ReviewContent
        beneficiaryId={beneficiaryId}
        supportCaseId={supportCaseId}
        sessionId={sessionId}
      />
    </Suspense>
  );
}
