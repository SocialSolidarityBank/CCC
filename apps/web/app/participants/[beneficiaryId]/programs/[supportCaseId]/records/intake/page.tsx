import { WireError } from '../../../../../../components/wire/wire-state';
import { ApiError, getIntakeRecordContext, getMyIdentity, type IntakeRecordContext } from '../../../../../../lib/api';
import { createIntakeRecordAction, updateIntakeRecordAction } from '../../../../../../actions';
import { IntakeReadView } from './intake-read-view';
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
  searchParams,
}: {
  params: Promise<{ beneficiaryId: string; supportCaseId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { beneficiaryId: rawBeneficiaryId, supportCaseId: rawSupportCaseId } = await params;
  const query = await searchParams;
  const beneficiaryId = safeId(rawBeneficiaryId);
  const supportCaseId = safeId(rawSupportCaseId);
  const programPath = beneficiaryId === null || supportCaseId === null
    ? '/'
    : `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}`;
  const recordsHref = programPath === '/' ? '/' : `${programPath}/records`;
  // 저장 직후 브리핑 직행 + 1회성 안내줄(스펙 #78 US 17·18 · CCC-31). 파라미터가
  // 안내줄의 1회성 보장을 만든다 — 브리핑이 이 값으로 게이트하고 마운트 직후 URL에서 지운다.
  const briefingHref = programPath === '/' ? '/' : `${programPath}/briefing?notice=intake_saved`;
  // 인테이크는 저장됐는데 전체 목표 별개 호출만 실패한 경우(D62 · CCC-68)의 목적지 —
  // 15초 페이지의 전체 목표 카드가 이 notice 로 오류 안내와 재시도 UI 를 그린다.
  const overallGoalErrorHref = programPath === '/' ? '/' : `${programPath}/briefing?notice=overall_goal_error`;

  if (beneficiaryId === null || supportCaseId === null) {
    return <main className="page-content"><WireError>{messages.not_found}</WireError></main>;
  }

  const [context, identity] = await Promise.all([load(supportCaseId), getMyIdentity().catch(() => null)]);

  if (context.error !== null) {
    return <main className="page-content"><WireError>{messages[context.error]}</WireError></main>;
  }

  // 인테이크가 이미 있으면 **조회가 기본**이다(CCC-58, 2026-08-08 Q "조회 기본 + 수정 버튼").
  // 고치기는 ?edit=1 로만 들어온다 — 같은 위저드의 수정 모드다(2026-08-08 Q "확인/수정").
  // 작성 1회 규칙은 그대로다: 만들기는 한 번, 그 뒤는 조회·수정.
  if (context.data.hasIntake && context.data.saved !== null) {
    const saved = context.data.saved;
    const intakeHref = `${programPath}/records/intake`;
    if (query.edit !== '1') {
      return (
        <IntakeReadView
          beneficiaryId={beneficiaryId}
          participant={context.data.participant}
          extendedPii={context.data.extendedPii}
          consent={context.data.consent}
          saved={saved}
          overallGoal={context.data.overallGoal}
          editHref={`${intakeHref}?edit=1`}
          recordsHref={recordsHref}
          participantHref={`/participants/${encodeURIComponent(beneficiaryId)}`}
          basicInfoHref={`/participants/${encodeURIComponent(beneficiaryId)}/edit`}
        />
      );
    }
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
        overallGoal={context.data.overallGoal}
        overallGoalErrorHref={overallGoalErrorHref}
        // 수정 저장 후에는 조회로 돌아온다(CCC-58) — 고친 결과를 바로 읽는 자리다.
        briefingHref={intakeHref}
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
      overallGoal={context.data.overallGoal}
      overallGoalErrorHref={overallGoalErrorHref}
      briefingHref={briefingHref}
      // 연결 일정 완료(CCC-57). 작성 경로에만 준다. 수정 경로(위 edit 분기)에는 서버에
      // 일정 연결 자리가 없으므로 넘기지 않는다.
      schedule={context.data.schedule}
      submit={createIntakeRecordAction}
    />
  );
}
