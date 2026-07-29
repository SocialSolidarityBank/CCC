import { WireButton } from '../../../../../../components/wire/wire-button';
import { ApiError, getIntakeRecordContext, getMyIdentity, type IntakeRecordContext } from '../../../../../../lib/api';
import { createIntakeRecordAction } from '../../../../../../actions';
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
    return <main className="page-content narrow"><p className="status risk" role="alert">{messages.not_found}</p></main>;
  }

  const [context, identity] = await Promise.all([load(supportCaseId), getMyIdentity().catch(() => null)]);

  if (context.error !== null) {
    return <main className="page-content narrow"><p className="status risk" role="alert">{messages[context.error]}</p></main>;
  }

  if (context.data.hasIntake) {
    return (
      <main className="page-content narrow">
        <header className="page-header"><div><h1>인테이크 기록</h1><p>이 참여 사업에는 이미 인테이크 기록이 있습니다. 인테이크는 참여 사업당 한 번만 작성합니다.</p></div></header>
        <div className="wire-form-actions"><WireButton variant="primary" href={recordsHref}>상담 기록으로</WireButton></div>
      </main>
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
