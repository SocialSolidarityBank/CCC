import { ApiError, getIntakeRecordContext, getMyIdentity, type IntakeRecordContext } from '../../../../../../lib/api';
import { createIntakeRecordAction, updateIntakeRecordAction } from '../../../../../../actions';
import { IntakeWizard } from './intake-wizard';

type LoadError = 'access_denied' | 'authentication_required' | 'forbidden' | 'not_found' | 'service_unavailable';

const messages: Record<LoadError, string> = {
  access_denied: '이 참여 사업에 인테이크를 남길 권한이 없습니다.',
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 시도하세요.',
  forbidden: '이 참여 사업에 인테이크를 남길 권한이 없습니다.',
  not_found: '요청한 당사자 ID 또는 참여 사업을 찾을 수 없습니다.',
  service_unavailable: '인테이크 서비스를 지금 사용할 수 없습니다. 잠시 후 다시 시도하세요.',
};

function safeId(value: string): string | null {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value) ? value : null;
}

async function load(supportCaseId: string): Promise<{ data: IntakeRecordContext; error: null } | { data: null; error: LoadError }> {
  try {
    return { data: await getIntakeRecordContext(supportCaseId), error: null };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    switch (error.code) {
      case 'access_denied':
      case 'authentication_required':
      case 'forbidden':
      case 'not_found':
      case 'service_unavailable':
        return { data: null, error: error.code };
      default:
        throw error;
    }
  }
}

export default async function NewIntakePage({
  params,
}: {
  params: Promise<{ beneficiaryId: string; supportCaseId: string }>;
}) {
  const { beneficiaryId: rawBeneficiaryId, supportCaseId: rawSupportCaseId } = await params;
  const beneficiaryId = safeId(rawBeneficiaryId);
  const supportCaseId = safeId(rawSupportCaseId);
  const programPath = beneficiaryId === null || supportCaseId === null
    ? '/'
    : `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}`;
  const recordsHref = programPath === '/' ? '/' : `${programPath}/records`;
  // 저장 직후 브리핑 직행 + 1회성 안내줄(스펙 #78 US 17·18 · CCC-31). 파라미터가
  // 안내줄의 1회성 보장을 만든다 — 브리핑이 이 값으로 게이트하고 마운트 직후 URL에서 지운다.
  const briefingHref = programPath === '/' ? '/' : `${programPath}/briefing?notice=intake_saved`;

  if (beneficiaryId === null || supportCaseId === null) {
    return <main className="page-content"><p className="wire-badge" data-tone="risk" role="alert">{messages.not_found}</p></main>;
  }

  const [context, identity] = await Promise.all([load(supportCaseId), getMyIdentity().catch(() => null)]);

  if (context.error !== null) {
    return <main className="page-content"><p className="wire-badge" data-tone="risk" role="alert">{messages[context.error]}</p></main>;
  }

  // 인테이크가 이미 있으면 같은 위저드를 **수정 모드**로 연다(2026-08-08 Q "확인/수정" —
  // 구 "이미 있습니다" 차단 화면 대체). 작성 1회 규칙은 그대로다: 만들기는 한 번, 그 뒤는 수정.
  if (context.data.hasIntake && context.data.saved !== null) {
    const saved = context.data.saved;
    return (
      <IntakeWizard
        mode="edit"
        beneficiaryId={beneficiaryId}
        supportCaseId={supportCaseId}
        submissionId={crypto.randomUUID()}
        participant={context.data.participant}
        extendedPii={context.data.extendedPii}
        consent={context.data.consent}
        participantHref={`/participants/${encodeURIComponent(beneficiaryId)}`}
        basicInfoHref={`/participants/${encodeURIComponent(beneficiaryId)}/edit`}
        sessionSequence={context.data.sessionSequence}
        recorderLabel={identity?.name ?? identity?.email ?? '로그인 사용자'}
        briefingHref={recordsHref}
        initial={{
          heldAt: saved.heldAt,
          answers: saved.answers,
          debts: saved.debts,
          linkedOrgs: saved.linkedOrgs,
          additionalItems: saved.additionalItems,
          managerOpinion: saved.managerOpinion,
        }}
        submit={updateIntakeRecordAction}
      />
    );
  }

  return (
    <IntakeWizard
      beneficiaryId={beneficiaryId}
      supportCaseId={supportCaseId}
      submissionId={crypto.randomUUID()}
      participant={context.data.participant}
      extendedPii={context.data.extendedPii}
      consent={context.data.consent}
      participantHref={`/participants/${encodeURIComponent(beneficiaryId)}`}
      basicInfoHref={`/participants/${encodeURIComponent(beneficiaryId)}/edit`}
      sessionSequence={context.data.sessionSequence}
      recorderLabel={identity?.name ?? identity?.email ?? '로그인 사용자'}
      briefingHref={briefingHref}
      submit={createIntakeRecordAction}
    />
  );
}
