import { ApiError, listScheduleCandidates } from '../../lib/api';
import { createSchedulePlanAction, loadScheduleContextAction } from '../../actions';
import { PROGRAM_LABELS } from '../../lib/labels';
import { ScheduleWizard, type ScheduleWizardCandidate } from './schedule-wizard';

type SearchParams = Record<string, string | string[] | undefined>;

function queryValue(params: SearchParams, name: string): string | undefined {
  const value = params[name];
  return typeof value === 'string' ? value : undefined;
}

// 상담 일정 등록 3단계 플로우(#35, Figma 7:945·7:1183·7:1228). 서버는 담당 활성 참여사업
// 후보만 실어 보내고(티켓 #19 콜드스타트 해소), 스텝 전환은 클라이언트 위저드가 맡는다.
// 담당 검사·감사·세션 목표 연결 검증은 어떤 경우든 API 게이트웨이가 강제한다(R1).
export default async function NewCounselingSchedulePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = await searchParams;
  const preselectTarget = queryValue(query, 'target');

  let candidates: ScheduleWizardCandidate[] = [];
  let loadError: string | null = null;
  try {
    const results = await listScheduleCandidates();
    candidates = results.map((candidate) => ({
      value: `${candidate.beneficiaryId}|${candidate.supportCaseId}`,
      beneficiaryId: candidate.beneficiaryId,
      supportCaseId: candidate.supportCaseId,
      programLabel: PROGRAM_LABELS[candidate.programType],
      participantName: candidate.participantName,
      participantPhone: candidate.participantPhone,
      participantEmail: candidate.participantEmail,
      intakeAt: candidate.intakeAt,
    }));
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    loadError = '담당 당사자 목록을 불러올 수 없습니다. 접근 권한을 확인하세요.';
  }

  if (loadError !== null) {
    return (
      <main className="page-content narrow">
        <p className="empty" role="alert">{loadError}</p>
      </main>
    );
  }

  return (
    <ScheduleWizard
      candidates={candidates}
      loadContext={loadScheduleContextAction}
      submit={createSchedulePlanAction}
      {...(preselectTarget === undefined ? {} : { preselectValue: preselectTarget })}
    />
  );
}
