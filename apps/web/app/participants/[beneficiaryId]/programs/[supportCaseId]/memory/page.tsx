import { getCounselingMemory, getParticipantProgram, getParticipantDetail } from '../../../../../lib/api';
import { getDisplayLabels } from '../../../../../lib/display-labels';
import { correctCounselingMemoryAction, refreshCounselingMemoryAction } from '../../../../../actions';
import { PageTitle } from '../../../../../components/wire/page-title';
import { ParticipantHeroCard } from '../../../../../components/wire/participant-hero-card';
import { WireButton } from '../../../../../components/wire/wire-button';
import { WireError } from '../../../../../components/wire/wire-state';
import { CaseMemoryView } from './memory-view';

export default async function MemoryPage({ params }: { params: Promise<{ beneficiaryId: string; supportCaseId: string }> }) {
  const { beneficiaryId, supportCaseId } = await params;
  const path = `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}`;
  try {
    const program = await getParticipantProgram(beneficiaryId, supportCaseId);
    const [participant, labels, memory] = await Promise.all([
      getParticipantDetail(beneficiaryId), getDisplayLabels(), getCounselingMemory(supportCaseId).catch(() => null),
    ]);
    return <main className="page-content memory-page-stack">
      <PageTitle>상담 기억</PageTitle>
      <ParticipantHeroCard name={participant.name} beneficiaryId={beneficiaryId} details={[{ label: '사업', value: labels.programLabels[program.programType] }, { label: '진행 상태', value: program.status === 'closed' ? '종결' : '진행 중' }]} actions={<><WireButton variant="neutral" href={`${path}/briefing`}>15초 페이지</WireButton><WireButton variant="neutral" href={`${path}/records`}>상담 기록 확인하기</WireButton></>} />
      {memory === null ? <WireError>상담 기억을 불러오지 못했습니다. 상담 기록은 계속 확인할 수 있습니다.</WireError> : <CaseMemoryView key={supportCaseId} memory={memory} supportCaseId={supportCaseId} programLabel={labels.programLabels[program.programType]} recordsHref={`${path}/records`} goalsHref={`/participants/${encodeURIComponent(beneficiaryId)}`} actionsHref={`${path}/records`} onCorrect={correctCounselingMemoryAction.bind(null, beneficiaryId, supportCaseId)} onRefresh={refreshCounselingMemoryAction.bind(null, beneficiaryId, supportCaseId)} />}
    </main>;
  } catch {
    return <main className="page-content"><PageTitle>상담 기억</PageTitle><WireError>케이스를 확인할 수 없습니다. 접근 권한과 연결 상태를 확인해 주세요.</WireError></main>;
  }
}
