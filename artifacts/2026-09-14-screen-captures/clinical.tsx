// 캡처 전용 합성 화면 — 상담 기록 축 (15초 페이지 · 상담 기록하기 · AI 초안 검토 · 케이스 종결 · 상담 기록 확인하기).
// 모든 인물·상담 내용은 가상이다. 서버 액션·API·localStorage·네트워크는 쓰지 않는다.
// 원본: apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/{briefing,records,close}
import React, { type ReactNode } from 'react';
import {
  DisclosureChevron,
  Icon,
  ParticipantHeroCard,
  WireBadge,
  WireButton,
  WireCallout,
  WireCard,
  WireCardSection,
  WireChoice,
  WireEmpty,
  WireFormField,
  WireItem,
  WireSourceQuotes,
  type ParticipantHeroDetail,
  type WireBadgeTone,
} from '../../packages/wire/src/index';
import { BriefingCards } from '../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/briefing/briefing-cards';
import { RecordOnepage } from '../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/new/record-onepage';
import { GoalSection } from '../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/new/goal-section';
import { RecordAccordionToggle } from '../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/new/record-accordion-toggle';
import {
  ActiveGoalsCard,
  CaseCloseForm,
  OpenActionItemsCard,
} from '../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/close/close-cards';
import { RecordList } from '../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/records/record-list';
import type {
  AiClaimSection,
  AiContrastAxis,
  AiContrastAxisStatus,
  AiDraftContrastAxis,
  AiMaterialKind,
  CounselingSchedule,
  LifeAreaSnapshotEntry,
  OpenActionItem,
  ParticipantBriefingSection,
  RecordFormOpenActionItem,
  RecordSessionGoal,
  SupportCaseRecord,
  SupportCaseRecordGoal,
} from '../../apps/web/app/lib/api';
import type { RiskBannerFlag } from '../../apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]/briefing/risk-banner';

// ── 공용 합성 값 ────────────────────────────────────────────────────────────
const beneficiaryId = 'crane-001';
const supportCaseId = 'case-001';
const participantPath = `/participants/${beneficiaryId}`;
const programPath = `${participantPath}/programs/${supportCaseId}`;
const recordsPath = `${programPath}/records`;
const briefingPath = `${programPath}/briefing`;
const programLabel = '함께온기금 울타리대출';
const participant = { name: '김하늘', phone: '010-0000-1042' };
const overallGoal = '소액 대출을 연체 없이 갚아 나가며 첫 독립 생활을 안정시킨다.';

// 폼 action·서버 액션 슬롯은 정적 렌더에서 호출되지 않는다 — 자리만 채운다.
const noopFormAction = async (_formData: FormData): Promise<void> => {};
const unreachableAction = async (): Promise<never> => {
  throw new Error('capture-only');
};

// ── 15초 페이지 (briefing/page.tsx + briefing-cards.tsx) ────────────────────
const sessionRows: ParticipantBriefingSection['sessionRows'] = [
  {
    sessionId: 'sess-005',
    heldAt: '2026-09-11T05:00:00.000Z',
    kind: 'regular',
    aiOneLiner: null,
    memoExcerpt: '울타리대출 심사 결과를 함께 확인하고 카드 대금 상환 계획을 다시 점검했다.',
  },
  {
    sessionId: 'sess-004',
    heldAt: '2026-09-08T05:00:00.000Z',
    kind: 'regular',
    aiOneLiner: '카드 대금 연체 우려를 확인하고 울타리대출 신청을 진행하기로 했다.',
    memoExcerpt: '카드사의 연체 독촉 연락 이후 불안이 커진 상태였다.',
  },
  {
    sessionId: 'sess-003',
    heldAt: '2026-09-04T05:00:00.000Z',
    kind: 'regular',
    aiOneLiner: '월 지출 구조를 함께 정리하고 상환용 통장 분리를 시도하기로 했다.',
    memoExcerpt: '월 지출 구조를 함께 정리했다.',
  },
  {
    sessionId: 'sess-002',
    heldAt: '2026-08-28T05:00:00.000Z',
    kind: 'regular',
    aiOneLiner: '대출 목적과 상환 계획을 세부 목표로 합의했다.',
    memoExcerpt: '보증금 마련과 상환 계획을 이야기했다.',
  },
  {
    sessionId: 'sess-001',
    heldAt: '2026-08-21T05:00:00.000Z',
    kind: 'intake',
    aiOneLiner: null,
    memoExcerpt: null,
  },
];

const discrepancies: ParticipantBriefingSection['discrepancies'] = [
  {
    id: 'disc-1',
    kind: 'cross_session',
    left: {
      sessionId: 'sess-002',
      heldAt: '2026-08-28T05:00:00.000Z',
      quote: '카드 대금은 밀린 적이 없어요.',
    },
    right: {
      sessionId: 'sess-004',
      heldAt: '2026-09-08T05:00:00.000Z',
      quote: '지난달 카드 대금을 아직 못 냈어요.',
    },
    detectedAt: '2026-09-08T09:00:00.000Z',
    resolution: null,
  },
  {
    id: 'disc-2',
    kind: 'within_session',
    left: {
      sessionId: 'sess-003',
      heldAt: '2026-09-04T05:00:00.000Z',
      quote: '보증금은 300만 원이에요.',
    },
    right: {
      sessionId: 'sess-003',
      heldAt: '2026-09-04T05:00:00.000Z',
      quote: '보증금은 500만 원이었어요.',
    },
    detectedAt: '2026-09-04T09:00:00.000Z',
    resolution: { status: 'record_error', resolvedAt: '2026-09-05T02:00:00.000Z' },
  },
];

const aiSuggestions: ParticipantBriefingSection['aiSuggestions'] = [
  {
    title: '카드 대금 연체가 실제로 있는지 다시 확인',
    reason: '2회차와 4회차 기록에서 카드 대금 납부 여부가 다르게 기록되어 있습니다.',
    sessionId: 'sess-004',
    heldAt: '2026-09-08T05:00:00.000Z',
    sourceQuotes: [],
  },
  {
    title: '울타리대출 심사 결과 확인',
    reason: '지난 상담에서 신청을 진행하기로 했고 결과가 나올 시기입니다.',
    sessionId: 'sess-005',
    heldAt: '2026-09-11T05:00:00.000Z',
    sourceQuotes: [],
  },
  {
    title: '상환용 통장 분리 후 지출 변화 물어보기',
    reason: '3회차에 합의한 지출 관리 방법의 이행 여부를 확인할 시점입니다.',
    sessionId: 'sess-003',
    heldAt: '2026-09-04T05:00:00.000Z',
    sourceQuotes: [],
  },
];

const briefingOpenActions: ParticipantBriefingSection['openActionItems'] = [
  {
    id: 'act-1',
    description: '울타리대출 심사 결과 확인',
    owner: 'counselor',
    dueDate: '2026-09-15',
    sessionId: 'sess-004',
  },
  {
    id: 'act-2',
    description: '카드 대금 연체액과 잔액 정리',
    owner: 'beneficiary',
    dueDate: '2026-09-19',
    sessionId: 'sess-004',
  },
  {
    id: 'act-3',
    description: '자립정착금 잔액 확인',
    owner: 'org',
    dueDate: '2026-09-22',
    sessionId: 'sess-002',
  },
];

const briefingFlags: RiskBannerFlag[] = [
  {
    id: 'flag-1',
    flagType: 'housing_livelihood_shock',
    source: 'counselor',
    reviewStatus: 'confirmed',
    sessionId: 'sess-004',
    quote: '카드사에서 연체 독촉 연락이 왔어요.',
  },
];

const briefingPage = (
  <BriefingCards
    beneficiaryId={beneficiaryId}
    supportCaseId={supportCaseId}
    overallGoal={overallGoal}
    activeGoals={[
      { id: 'goal-1', title: '연체 없이 대출을 상환하며 지출 흐름을 안정시킨다' },
      { id: 'goal-2', title: '첫 직장에서 6개월 이상 근속한다' },
    ]}
    canEditOverallGoal={true}
    overallGoalAction={noopFormAction}
    participantHref={participantPath}
    recordsHref={recordsPath}
    recordNewHref={`${recordsPath}/new`}
    programLabel={programLabel}
    participant={participant}
    sessionRows={sessionRows}
    discrepancies={discrepancies}
    discrepancyAction={noopFormAction}
    pendingApprovalCount={1}
    pendingReviewSessionIds={['sess-005']}
    aiSuggestions={aiSuggestions}
    openActionItems={briefingOpenActions}
    flags={briefingFlags}
    upcomingSchedule={{
      id: 'sched-006',
      scheduledAt: '2026-09-18T05:00:00.000Z',
      sessionGoals: [
        {
          body: '울타리대출 심사 결과와 카드 대금 상환 계획을 함께 확인한다.',
          caseGoalId: 'goal-1',
          caseGoalTitle: '연체 없이 대출을 상환하며 지출 흐름을 안정시킨다',
          caseGoalStatus: 'active',
        },
        {
          body: '카드 대금 연체액 정리 여부를 점검한다.',
          caseGoalId: null,
          caseGoalTitle: null,
          caseGoalStatus: null,
        },
      ],
      customQuestions: [
        '지난주에 신청한 울타리대출 심사 결과가 나왔나요?',
        '상환용 통장을 나눈 뒤 지출 관리가 조금 나아졌나요?',
      ],
    }}
  />
);

// ── 상담 기록하기 (records/new/page.tsx + record-onepage.tsx) ───────────────
const recordGoals: SupportCaseRecordGoal[] = [
  { id: 'goal-1', title: '연체 없이 대출을 상환하며 지출 흐름을 안정시킨다', status: 'active', closedReason: null },
  { id: 'goal-2', title: '첫 직장에서 6개월 이상 근속한다', status: 'active', closedReason: null },
  { id: 'goal-0', title: '울타리대출 신청 자격을 확인한다', status: 'closed', closedReason: 'achieved' },
];

const recordSchedules: CounselingSchedule[] = [
  {
    id: 'sched-006',
    beneficiaryId,
    supportCaseId,
    scheduledAt: '2026-09-18T05:00:00.000Z',
    status: 'scheduled',
    version: 2,
  },
];

const recordOpenActions: RecordFormOpenActionItem[] = briefingOpenActions.map((item) => ({
  id: item.id,
  description: item.description,
  owner: item.owner,
  dueDate: item.dueDate,
  sourceHeldAt: item.sessionId === 'sess-002' ? '2026-08-28T05:00:00.000Z' : '2026-09-08T05:00:00.000Z',
}));

const recordLifeAreas: LifeAreaSnapshotEntry[] = [
  { areaKey: 'economy', status: 'strained', note: '카드 독촉 연락 이후 지출 압박' },
  { areaKey: 'housing', status: 'okay', note: null },
  { areaKey: 'employment', status: 'okay', note: null },
  { areaKey: 'health', status: 'okay', note: null },
  { areaKey: 'mental_health', status: 'strained', note: '불면 호소' },
  { areaKey: 'family', status: 'okay', note: null },
];

const recordSessionGoals: RecordSessionGoal[] = [
  {
    body: '울타리대출 심사 결과와 카드 대금 상환 계획을 함께 확인한다.',
    caseGoalTitle: '연체 없이 대출을 상환하며 지출 흐름을 안정시킨다',
  },
  { body: '카드 대금 연체액 정리 여부를 점검한다.', caseGoalTitle: null },
];

const recordHeroDetails: ParticipantHeroDetail[] = [
  { label: '이번 상담', value: '기본 상담 6회차' },
  { label: '지난 상담', value: '2026년 9월 11일', tone: 'blue' },
  { label: '미해결 액션', value: '3건' },
];

const recordEntryPage = (
  <>
    <ParticipantHeroCard
      name={participant.name}
      beneficiaryId={beneficiaryId}
      details={recordHeroDetails}
      actions={<RecordAccordionToggle />}
    />
    <form autoComplete="off" className="record-form" aria-labelledby="record-form-title">
      <input type="hidden" name="beneficiaryId" value={beneficiaryId} />
      <input type="hidden" name="supportCaseId" value={supportCaseId} />
      <input type="hidden" name="submissionId" value="00000000-0000-4000-8000-000000000000" />
      <RecordOnepage
        schedules={recordSchedules}
        openActionItems={recordOpenActions}
        latestLifeAreaSnapshot={recordLifeAreas}
        sessionGoals={recordSessionGoals}
        customQuestions={[
          '지난주에 신청한 울타리대출 심사 결과가 나왔나요?',
          '상환용 통장을 나눈 뒤 지출 관리가 조금 나아졌나요?',
        ]}
        briefingPath={briefingPath}
        actions={<>
          <WireButton variant="secondary" href={recordsPath}>상담 기록 확인</WireButton>
          <WireButton variant="primary" type="submit" icon={<Icon name="check" />}>저장</WireButton>
        </>}
        goalSection={(
          <GoalSection
            beneficiaryId={beneficiaryId}
            supportCaseId={supportCaseId}
            goals={recordGoals}
            createAction={unreachableAction}
            renameAction={unreachableAction}
            closeAction={unreachableAction}
            upcomingLinksAction={unreachableAction}
          />
        )}
        supportCaseId={supportCaseId}
        unsavedNotice={(
          <WireCallout tone="lavender" role="status" testId="record-unsaved-notice" title="아직 서버에 저장되지 않았습니다">
            <span className="record-writing-help">저장을 누르기 전까지 이 화면의 내용은 서버에 남지 않습니다.</span>
          </WireCallout>
        )}
      />
    </form>
  </>
);

// ── AI 초안 검토 (records/[sessionId]/review/page.tsx + fixture-draft-view.tsx)
// DraftReviewView 는 자체 main·PageTitle 을 포함하므로 캡처 프레임과 겹친다.
// 여기서는 같은 부품·클래스로 본문만 재현한다.
const contrastAxisOrder: AiContrastAxis[] = ['missing_from_memo', 'missing_from_transcript', 'undiscussed_session_goal'];
const contrastAxisLabels: Record<AiContrastAxis, string> = {
  missing_from_memo: '메모에 없는 내용',
  missing_from_transcript: '음성에 없는 내용',
  undiscussed_session_goal: '미논의 목표',
};
const contrastAxisUnavailableNotices: Record<Exclude<AiContrastAxisStatus, 'applied'>, string> = {
  no_transcript: '녹음 전사가 없어 이 대조는 만들지 않았습니다.',
  no_text: '수기 메모나 목표 같은 텍스트 재료가 없어 이 대조는 만들지 않았습니다.',
  no_session_goal: '이번 회기의 세션 목표가 없어 이 대조는 만들지 않았습니다.',
};
const materialKindLabels: Record<AiMaterialKind, string> = {
  transcript: '전사',
  text_context: '텍스트',
};
const transcriptWarningReasonLabels: Record<string, string> = {
  repetition: '같은 문장 반복(전사 붕괴)',
};
function transcriptClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
const REVIEW_FORM_ID = 'ai-draft-review-form';
const claimSectionOrder: AiClaimSection[] = [
  'session_goal_discussion',
  'other_topics',
  'next_session_commitments',
];
const claimSectionLabels: Record<AiClaimSection, string> = {
  session_goal_discussion: '회기 목표별 논의 내용',
  other_topics: '목표 밖 주요 내용',
  next_session_commitments: '다음 회차까지의 약속과 할 일',
};
function axisBadge(data: AiDraftContrastAxis | undefined): { tone: WireBadgeTone; label: string } {
  if (data === undefined) return { tone: 'neutral', label: '정보 없음' };
  if (data.status !== 'applied') return { tone: 'neutral', label: '돌리지 못함' };
  return data.findings.length === 0
    ? { tone: 'mint', label: '차이 없음' }
    : { tone: 'lavender', label: '차이 있음' };
}
function ContrastAxisSection({ axis, data, sourceHref }: {
  axis: AiContrastAxis;
  data: AiDraftContrastAxis | undefined;
  sourceHref: string;
}) {
  const badge = axisBadge(data);
  return (
    <WireCardSection
      title={(
        <span className="wire-card-head">
          <span>{contrastAxisLabels[axis]}</span>
          <WireBadge tone={badge.tone}>{badge.label}</WireBadge>
        </span>
      )}
      tone="lavender"
      testId={`ai-draft-contrast-${axis}`}
    >
      {data === undefined
        ? <WireEmpty>이 초안에는 대조 결과가 없습니다.</WireEmpty>
        : data.status !== 'applied'
          ? <WireEmpty>{contrastAxisUnavailableNotices[data.status]}</WireEmpty>
          : data.findings.length === 0
            ? <WireEmpty>확인된 차이가 없습니다.</WireEmpty>
            : (
              <ul className="briefing-suggestions clinical-material-grid">
                {data.findings.map((finding, index) => (
                  <li key={`${axis}-${index}-${finding.quote}`}>
                    <WireItem
                      tone="lavender"
                      title={finding.description}
                      status={<WireBadge>{materialKindLabels[finding.materialKind]}</WireBadge>}
                    />
                    <WireSourceQuotes quotes={[finding.quote]} sourceHref={sourceHref} />
                  </li>
                ))}
              </ul>
            )}
    </WireCardSection>
  );
}

const reviewSessionId = 'sess-005';
const reviewSourceHref = `${recordsPath}#record-${reviewSessionId}`;
const reviewDraft = {
  origin: 'generated' as const,
  creationMode: 'provider_generated' as const,
  version: 3,
  summaryText: '울타리대출 심사 결과를 확인하고 카드 대금 상환 계획을 다시 점검한 회차.',
  claims: [
    { claimKey: 'goal_1', section: 'session_goal_discussion' as const, text: '카드 대금 연체 여부를 다시 확인했고, 울타리대출 심사 결과를 기다리는 중이다.' },
    { claimKey: 'goal_2', section: 'session_goal_discussion' as const, text: '상환용 통장 분리 후 식비와 교통비 지출이 줄었다고 당사자가 보고했다.' },
    { claimKey: 'topic_1', section: 'other_topics' as const, text: '첫 직장 적응 스트레스로 불면이 이어져 수면 위생과 병원 상담 필요성을 이야기했다.' },
    { claimKey: 'commit_1', section: 'next_session_commitments' as const, text: '카드 대금 연체액과 잔액을 다음 상담 전까지 정리한다.' },
    { claimKey: 'commit_2', section: 'next_session_commitments' as const, text: '실무자는 울타리대출 심사 결과를 확인해 다음 회차에 공유한다.' },
  ],
  oneLiner: '울타리대출 심사 결과를 확인하고 카드 대금 상환 계획을 다시 점검했다.',
  questions: [
    { title: '카드 대금 연체가 실제로 있는지 다시 확인', reason: '이전 회차 기록과 이번 상담 발언이 다르게 정리되었습니다.' },
    { title: '불면 증상의 지속 기간 확인', reason: '수면 문제가 처음 언급되어 경과 파악이 필요합니다.' },
  ],
  evidence: [
    { id: 'ev-1', claimKey: 'goal_1', quote: '지난달 카드 대금을 아직 못 냈어요.' },
    { id: 'ev-2', claimKey: 'goal_2', quote: '통장을 나누고 나서 카드 쓰는 게 줄었어요.' },
    { id: 'ev-3', claimKey: 'topic_1', quote: '요즘은 새벽 세 시쯤까지 잠을 못 자요.' },
    { id: 'ev-4', claimKey: 'commit_1', quote: '연체액이랑 잔액은 이번 주 안으로 정리해 올게요.' },
    { id: 'ev-5', claimKey: 'question_1', quote: '카드 대금은 밀린 적이 없어요.' },
  ],
  reviewDecision: null,
  contrast: [
    {
      axis: 'missing_from_memo' as const,
      status: 'applied' as const,
      findings: [
        {
          description: '불면 증상 호소가 수기 메모에 없습니다.',
          materialKind: 'transcript' as const,
          quote: '요즘은 새벽 세 시쯤까지 잠을 못 자요.',
        },
      ],
    },
    { axis: 'missing_from_transcript' as const, status: 'applied' as const, findings: [] },
    {
      axis: 'undiscussed_session_goal' as const,
      status: 'applied' as const,
      findings: [
        {
          description: '세션 목표 “첫 직장에서 6개월 이상 근속한다”가 이번 상담에서 논의되지 않았습니다.',
          materialKind: 'text_context' as const,
          quote: '첫 직장에서 6개월 이상 근속한다',
        },
      ],
    },
  ],
  transcriptQuality: {
    transcriptReliable: false,
    warnings: [{ startSeconds: 612, endSeconds: 748, reason: 'repetition' }],
  },
};

const reviewClaimsBySection = new Map(claimSectionOrder.map((section) => [
  section,
  reviewDraft.claims.filter((claim) => claim.section === section),
] as const));
const reviewQuotesByClaim = new Map<string, string[]>();
for (const evidence of reviewDraft.evidence) {
  const quotes = reviewQuotesByClaim.get(evidence.claimKey) ?? [];
  if (!quotes.includes(evidence.quote)) quotes.push(evidence.quote);
  reviewQuotesByClaim.set(evidence.claimKey, quotes);
}
const reviewContrastByAxis = new Map(reviewDraft.contrast.map((axis) => [axis.axis, axis]));
// 전사 기반 대조 축이 적용됐으므로 화자 확인 체크가 선다(CCC-114 · D11).
const reviewRequiresSpeakerConfirmation = reviewDraft.contrast.some((axisData) => axisData.status === 'applied'
  && (axisData.axis === 'missing_from_memo' || axisData.axis === 'missing_from_transcript'));

const reviewPage = (
  <div className="capture-stack" data-testid="ai-draft-review">
    <ParticipantHeroCard
      name={participant.name}
      beneficiaryId={beneficiaryId}
      details={[
        { label: '상담일', value: '2026년 9월 11일', tone: 'blue' },
        { label: '상담 방식', value: '대면' },
        { label: 'AI 검토 상태', value: '검토 대기', tone: 'lavender' },
      ]}
      actions={<WireButton href={recordsPath} variant="secondary">상담 기록 확인</WireButton>}
    />

    {/* 전사 신뢰 불가 구간 표시 (CCC-124) — 표시만 한다. */}
    <WireCallout
      title="전사를 신뢰할 수 없는 구간이 있습니다"
      role="alert"
      testId="transcript-quality-warning"
    >
      <p className="panel-meta">
        아래 시간대는 전사가 붕괴해 내용이 정확하지 않을 수 있습니다. 녹음을 직접
        확인하거나 수기 메모와 대조한 뒤 검토하세요.
      </p>
      <ul className="briefing-suggestions" data-testid="transcript-quality-warning-spans">
        {reviewDraft.transcriptQuality.warnings.map((warning, index) => (
          <li key={`${warning.startSeconds}-${warning.endSeconds}-${warning.reason}-${index}`}>
            {transcriptClock(warning.startSeconds)}~{transcriptClock(warning.endSeconds)}
            {': '}
            {transcriptWarningReasonLabels[warning.reason] ?? warning.reason}
          </li>
        ))}
      </ul>
    </WireCallout>

    <WireCard
      as="section"
      testId="ai-draft-card"
      title={(
        <div className="wire-card-head">
          <span>AI 초안</span>
        </div>
      )}
    >
      <WireCardSection title="핵심 한 줄" tone="lavender" testId="ai-draft-section-one-liner">
        <p className="wire-section-value">{reviewDraft.oneLiner}</p>
      </WireCardSection>

      {claimSectionOrder.map((section) => {
        const claims = reviewClaimsBySection.get(section) ?? [];
        return (
          <WireCardSection
            key={section}
            title={claimSectionLabels[section]}
            tone="lavender"
            testId={`ai-draft-claims-${section}`}
          >
            {claims.length === 0
              ? <WireEmpty>이 구획에 정리된 내용이 없습니다.</WireEmpty>
              : (
                <ul className="briefing-suggestions">
                  {claims.map((claim) => (
                    <li key={claim.claimKey}>
                      <WireItem tone="lavender" title={claim.text} />
                      <WireSourceQuotes
                        quotes={reviewQuotesByClaim.get(claim.claimKey) ?? []}
                        sourceHref={reviewSourceHref}
                      />
                      {section === 'next_session_commitments' && (
                        <form data-testid={`ai-commitment-action-${claim.claimKey}`}>
                          <input type="hidden" name="beneficiaryId" value={beneficiaryId} />
                          <input type="hidden" name="supportCaseId" value={supportCaseId} />
                          <input type="hidden" name="sessionId" value={reviewSessionId} />
                          <WireFormField
                            label="할 일 문구"
                            control="input"
                            htmlFor={`action-description-${claim.claimKey}`}
                          >
                            <input
                              id={`action-description-${claim.claimKey}`}
                              name="description"
                              defaultValue={claim.text}
                              required
                            />
                          </WireFormField>
                          <WireFormField
                            label="담당"
                            control="select"
                            htmlFor={`action-owner-${claim.claimKey}`}
                          >
                            <select
                              id={`action-owner-${claim.claimKey}`}
                              name="owner"
                              defaultValue={claim.text.startsWith('실무자') ? 'counselor' : 'beneficiary'}
                              required
                            >
                              <option value="" disabled>담당 선택</option>
                              <option value="counselor">실무자</option>
                              <option value="beneficiary">당사자</option>
                              <option value="org">기관</option>
                            </select>
                          </WireFormField>
                          <WireFormField
                            label="기한"
                            control="input"
                            htmlFor={`action-due-${claim.claimKey}`}
                            hint="기한이 없으면 비워 두세요."
                          >
                            <input id={`action-due-${claim.claimKey}`} name="dueDate" type="date" defaultValue="2026-09-18" />
                          </WireFormField>
                          <WireButton type="submit" variant="secondary">액션으로 등록</WireButton>
                        </form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
          </WireCardSection>
        );
      })}

      <WireCardSection title="확인할 질문" tone="lavender" testId="ai-draft-section-questions">
        <ul className="briefing-suggestions">
          {reviewDraft.questions.map((question, index) => (
            <li key={`${question.title} ${question.reason}`}>
              <WireItem tone="lavender" title={question.title} description={question.reason} />
              <WireSourceQuotes
                quotes={reviewQuotesByClaim.get(`question_${index + 1}`) ?? []}
                sourceHref={reviewSourceHref}
              />
            </li>
          ))}
        </ul>
      </WireCardSection>

      <WireCardSection title="근거 인용" tone="lavender" testId="ai-draft-section-evidence">
        <ul className="briefing-suggestions">
          {reviewDraft.evidence.map((evidence) => (
            <li key={evidence.id}>
              <WireSourceQuotes quotes={[evidence.quote]} sourceHref={reviewSourceHref} />
            </li>
          ))}
        </ul>
      </WireCardSection>
    </WireCard>

    {/* 대조 3종(D69 · ADR-0036) — 수기 기록과 녹취 기반 AI 정리의 대조가 곧 정합성 검증이다. */}
    <WireCard
      as="section"
      labelledBy="ai-draft-contrast-title"
      testId="ai-draft-contrast-card"
      title={<h2 id="ai-draft-contrast-title">대조 3종</h2>}
    >
      {contrastAxisOrder.map((axis) => (
        <ContrastAxisSection
          key={axis}
          axis={axis}
          data={reviewContrastByAxis.get(axis)}
          sourceHref={reviewSourceHref}
        />
      ))}
    </WireCard>

    <WireCard as="section" testId="ai-draft-review-actions" title="처리">
      <p className="panel-meta">
        대조 3종을 모두 확인한 뒤 승인하거나 반려하세요. 승인하면 이 초안이 공식 기록이 됩니다.
      </p>
      <form id={REVIEW_FORM_ID}>
        <input type="hidden" name="beneficiaryId" value={beneficiaryId} />
        <input type="hidden" name="supportCaseId" value={supportCaseId} />
        <input type="hidden" name="sessionId" value={reviewSessionId} />
        <input type="hidden" name="expectedVersion" value={reviewDraft.version} />
        {reviewRequiresSpeakerConfirmation && (
          <WireChoice
            type="checkbox"
            name="speakerMappingConfirmed"
            value="true"
            label="화자 구분(어느 발언이 실무자·당사자의 것인지)을 확인했습니다"
            desc="녹음 재료가 있는 회차는 이 확인이 있어야 승인할 수 있습니다."
          />
        )}
        <div className="wizard-actions">
          <WireButton type="submit" name="decision" value="approved" variant="primary">승인</WireButton>
          <WireButton type="submit" name="decision" value="rejected" variant="danger">반려</WireButton>
        </div>
      </form>
    </WireCard>
  </div>
);

// ── 케이스 종결 (close/page.tsx + close-cards.tsx) ──────────────────────────
const closeOpenItems: OpenActionItem[] = briefingOpenActions.map(({ id, description, owner, dueDate }) => ({
  id,
  description,
  owner,
  dueDate,
}));

const closePage = (
  <>
    <ParticipantHeroCard
      name={participant.name}
      beneficiaryId={beneficiaryId}
      details={[
        { label: '사업', value: programLabel },
        { label: '진행 상태', value: '진행 중' },
      ]}
    />
    <OpenActionItemsCard items={closeOpenItems} />
    <ActiveGoalsCard goals={[
      { id: 'goal-1', title: '연체 없이 대출을 상환하며 지출 흐름을 안정시킨다' },
      { id: 'goal-2', title: '첫 직장에서 6개월 이상 근속한다' },
    ]} />
    <CaseCloseForm
      beneficiaryId={beneficiaryId}
      supportCaseId={supportCaseId}
      action={noopFormAction}
    />
    <div>
      <WireButton variant="secondary" href={participantPath}>당사자 정보로 돌아가기</WireButton>
    </div>
  </>
);

// ── 상담 기록 확인하기 (records/page.tsx + record-list.tsx) ─────────────────
const lifeAreaSnapshot = (overrides: Partial<Record<string, { status: LifeAreaSnapshotEntry['status']; note: string | null }>>): LifeAreaSnapshotEntry[] =>
  (['economy', 'housing', 'employment', 'health', 'mental_health', 'family'] as const).map((areaKey) => ({
    areaKey,
    status: overrides[areaKey]?.status ?? 'okay',
    note: overrides[areaKey]?.note ?? null,
  }));

const records: SupportCaseRecord[] = [
  {
    id: 'sess-005',
    heldAt: '2026-09-11T05:00:00.000Z',
    channel: 'in_person',
    memo: '울타리대출 심사 결과를 함께 확인했다. 카드 대금 연체 여부를 다시 물었고 당사자는 지난달분이 아직 미납이라고 답했다. 연체액과 잔액 정리를 다음 상담 전까지 약속했다. 최근 불면을 호소해 수면 위생과 병원 상담 필요성을 이야기했다.',
    managerOpinion: '카드 대금 연체가 확인되어 상환 계획 목표의 우선순위를 유지한다. 불면 호소는 다음 회차에서 경과를 확인한다.',
    gasScores: [],
    actionItems: [
      { id: 'act-4', description: '카드 대금 연체액과 잔액 정리', owner: 'beneficiary', dueDate: '2026-09-17', resolved: false },
      { id: 'act-5', description: '울타리대출 심사 결과 확인 후 공유', owner: 'counselor', dueDate: '2026-09-18', resolved: false },
    ],
    flags: [],
    lifeAreaSnapshot: lifeAreaSnapshot({
      economy: { status: 'strained', note: '카드 대금 미납 확인' },
      mental_health: { status: 'strained', note: '불면 호소' },
    }),
    kind: 'regular',
    createdAt: '2026-09-11T08:30:00.000Z',
    aiOneLiner: null,
    memoExcerpt: '울타리대출 심사 결과를 함께 확인하고 카드 대금 상환 계획을 다시 점검했다.',
    sessionGoals: ['울타리대출 심사 결과와 카드 대금 상환 계획을 함께 확인한다.'],
    discrepancies: [],
  },
  {
    id: 'sess-004',
    heldAt: '2026-09-08T05:00:00.000Z',
    channel: 'in_person',
    memo: '카드사의 연체 독촉 연락 이후 불안이 커진 상태였다. 울타리대출 신청을 함께 진행하기로 하고 필요 서류를 정리했다.',
    managerOpinion: '카드 대금 연체 확인. 울타리대출 심사 결과를 다음 회차에서 반드시 확인한다.',
    gasScores: [],
    actionItems: [
      { id: 'act-1', description: '울타리대출 심사 결과 확인', owner: 'counselor', dueDate: '2026-09-15', resolved: false },
      { id: 'act-2', description: '카드 대금 연체액과 잔액 정리', owner: 'beneficiary', dueDate: '2026-09-19', resolved: false },
    ],
    flags: [
      {
        id: 'flag-1',
        flagType: 'housing_livelihood_shock',
        source: 'counselor',
        reviewStatus: 'confirmed',
        quote: '카드사에서 연체 독촉 연락이 왔어요.',
      },
    ],
    lifeAreaSnapshot: lifeAreaSnapshot({
      economy: { status: 'strained', note: '카드 연체 독촉 연락' },
    }),
    kind: 'regular',
    createdAt: '2026-09-08T08:30:00.000Z',
    aiOneLiner: '카드 대금 연체 우려를 확인하고 울타리대출 신청을 진행하기로 했다.',
    memoExcerpt: '카드사의 연체 독촉 연락 이후 불안이 커진 상태였다.',
    sessionGoals: ['카드 대금 연체 여부와 지출 구조를 확인한다.'],
    discrepancies: [
      { id: 'disc-1', kind: 'cross_session', leftSessionId: 'sess-002', rightSessionId: 'sess-004', resolutionStatus: null },
    ],
  },
  {
    id: 'sess-003',
    heldAt: '2026-09-04T05:00:00.000Z',
    channel: 'phone',
    memo: '월 지출 구조를 함께 정리하고 상환용 통장 분리를 시도하기로 했다. 보증금 액수는 이전 기록과 다르게 말해 추후 확인이 필요하다.',
    managerOpinion: null,
    gasScores: [],
    actionItems: [
      { id: 'act-0', description: '상환용 통장 분리', owner: 'beneficiary', dueDate: null, resolved: true },
    ],
    flags: [],
    lifeAreaSnapshot: lifeAreaSnapshot({}),
    kind: 'regular',
    createdAt: '2026-09-04T08:30:00.000Z',
    aiOneLiner: '월 지출 구조를 함께 정리하고 상환용 통장 분리를 시도하기로 했다.',
    memoExcerpt: '월 지출 구조를 함께 정리했다.',
    sessionGoals: [],
    discrepancies: [
      { id: 'disc-2', kind: 'within_session', leftSessionId: 'sess-003', rightSessionId: 'sess-003', resolutionStatus: 'record_error' },
    ],
  },
  {
    id: 'sess-002',
    heldAt: '2026-08-28T05:00:00.000Z',
    channel: 'in_person',
    memo: '대출 목적과 상환 계획을 세부 목표로 합의했다. 당사자는 카드 대금 연체가 없다고 답했다.',
    managerOpinion: '세부 목표 두 건을 합의했다. 다음 회차에서 이행 여부를 확인한다.',
    gasScores: [],
    actionItems: [
      { id: 'act-3', description: '자립정착금 잔액 확인', owner: 'org', dueDate: null, resolved: false },
    ],
    flags: [],
    lifeAreaSnapshot: lifeAreaSnapshot({}),
    kind: 'regular',
    createdAt: '2026-08-28T08:30:00.000Z',
    aiOneLiner: '대출 목적과 상환 계획을 세부 목표로 합의했다.',
    memoExcerpt: '보증금 마련과 상환 계획을 이야기했다.',
    sessionGoals: [],
    discrepancies: [
      { id: 'disc-1', kind: 'cross_session', leftSessionId: 'sess-002', rightSessionId: 'sess-004', resolutionStatus: null },
    ],
  },
  {
    id: 'sess-001',
    heldAt: '2026-08-21T05:00:00.000Z',
    channel: 'in_person',
    memo: '',
    managerOpinion: null,
    gasScores: [],
    actionItems: [],
    flags: [],
    lifeAreaSnapshot: [],
    kind: 'intake',
    createdAt: '2026-08-21T09:00:00.000Z',
    aiOneLiner: null,
    memoExcerpt: null,
    sessionGoals: [],
    discrepancies: [],
  },
];

const recordsPage = (
  <>
    <ParticipantHeroCard
      name={participant.name}
      beneficiaryId={beneficiaryId}
      details={[
        { label: '사업', value: programLabel },
        { label: '기록 현황', value: '5회차까지 기록됨' },
        { label: '최근 상담', value: '2026년 9월 11일', tone: 'blue' },
        { label: '진행 상태', value: '진행 중' },
      ]}
      actions={<>
        <WireButton variant="secondary" href={participantPath}>당사자 정보</WireButton>
        <WireButton variant="primary" href={`${recordsPath}/new`}>상담 기록</WireButton>
      </>}
    />
    {/* OverallGoalRow — records/page.tsx 의 읽기 전용 전체 목표 한 줄과 같은 마크업. */}
    <WireCard as="section" className="record-goal" labelledBy="record-goal-label">
      <div className="record-goal-row">
        <span className="record-goal-label" id="record-goal-label">전체 목표</span>
        <p className="record-goal-text">{overallGoal}</p>
      </div>
    </WireCard>
    {/* 상담 일정 카드 — records/page.tsx 의 schedulePresentations['scheduled'] 와 같은 마크업. */}
    <WireCard
      as="section"
      labelledBy="schedule-status-title"
      title={<div className="wire-card-head">
        <h2 id="schedule-status-title">상담 일정</h2>
        <span className="wire-badge">예정</span>
      </div>}
    >
      <p className="record-schedule-note">2026년 9월 18일 오후 2:00 상담 기록하기에서만 명시적으로 완료 처리할 수 있습니다.</p>
    </WireCard>
    <section className="record-section">
      <h2 className="record-section-title">회차별 기록</h2>
      <RecordList
        records={records}
        recordErrorSessionIds={new Set(['sess-003'])}
        unavailable={false}
        recordsHref={recordsPath}
        briefingHref={briefingPath}
        intakeHref={`${recordsPath}/intake`}
      />
    </section>
  </>
);

// ── pages 계약 ──────────────────────────────────────────────────────────────
interface CapturePage {
  slug: string;
  title: string;
  group: string;
  source: string;
  content: ReactNode;
  public?: boolean;
}

const group = '상담 기록';
const sourceBase = 'apps/web/app/participants/[beneficiaryId]/programs/[supportCaseId]';

export const pages: CapturePage[] = [
  {
    slug: 'briefing',
    title: '15초 다시보기',
    group,
    source: `${sourceBase}/briefing/page.tsx + briefing-cards.tsx`,
    content: briefingPage,
    public: false,
  },
  {
    slug: 'record-entry',
    title: '상담 기록하기',
    group,
    source: `${sourceBase}/records/new/page.tsx + record-onepage.tsx`,
    content: recordEntryPage,
    public: false,
  },
  {
    slug: 'record-review',
    title: 'AI가 정리한 내용 검토하기',
    group,
    source: `${sourceBase}/records/[sessionId]/review/page.tsx + fixture-draft-view.tsx`,
    content: reviewPage,
    public: false,
  },
  {
    slug: 'case-close',
    title: '상담 종결',
    group,
    source: `${sourceBase}/close/page.tsx + close-cards.tsx`,
    content: closePage,
    public: false,
  },
  {
    slug: 'records',
    title: '상담 기록 확인하기',
    group,
    source: `${sourceBase}/records/page.tsx + record-list.tsx`,
    content: recordsPage,
    public: false,
  },
];

// ── record-entry 정적 채움 ──────────────────────────────────────────────────
// RecordOnepage 의 입력칸은 전부 비제어/빈 초기값이라 SSR 만으로는 채울 수 없다.
// 생성된 본문 HTML 에 합성 값을 심는다 — 캡처 전용 후처리이며 제품 코드는 건드리지 않는다.
declare const HTMLRewriter: {
  new (): {
    on(selector: string, handlers: {
      element?: (element: {
        getAttribute(name: string): string | null;
        setAttribute(name: string, value: string): void;
        removeAttribute(name: string): void;
        setInnerContent(content: string): void;
      }) => void;
    }): unknown;
    transform(input: unknown): { text(): Promise<string> };
  };
};

export async function populateRecordHtml(html: string): Promise<string> {
  const rewriter = new HTMLRewriter();

  const setValue = (selector: string, value: string) =>
    rewriter.on(selector, { element: (el) => el.setAttribute('value', value) });
  const setText = (selector: string, text: string) =>
    rewriter.on(selector, { element: (el) => el.setInnerContent(text) });
  const check = (selector: string) =>
    rewriter.on(selector, { element: (el) => el.setAttribute('checked', '') });
  const uncheck = (selector: string) =>
    rewriter.on(selector, { element: (el) => el.removeAttribute('checked') });
  const select = (selector: string, value: string) =>
    rewriter.on(`${selector} option`, {
      element: (el) => {
        if (el.getAttribute('value') === value) el.setAttribute('selected', '');
        else el.removeAttribute('selected');
      },
    });

  // 체크리스트 채움 표시 — 채워진 입력과 같은 상태로 맞춘다(필수 3/3).
  rewriter.on('.record-rail-list > li:nth-child(1)', {
    element: (el) => el.setAttribute('data-done', 'true'),
  });
  rewriter.on('.record-rail-list > li:nth-child(1) .wire-checkbox', {
    element: (el) => el.setAttribute('data-checked', 'true'),
  });
  rewriter.on('.record-rail-list > li:nth-child(1) .record-rail-state', {
    element: (el) => el.setInnerContent(' 채움'),
  });
  rewriter.on('.record-rail-list > li:nth-child(2)', {
    element: (el) => el.setAttribute('data-done', 'true'),
  });
  rewriter.on('.record-rail-list > li:nth-child(2) .wire-checkbox', {
    element: (el) => el.setAttribute('data-checked', 'true'),
  });
  rewriter.on('.record-rail-list > li:nth-child(2) .record-rail-state', {
    element: (el) => el.setInnerContent(' 채움'),
  });
  rewriter.on('[data-testid="record-required-count"]', {
    element: (el) => el.setInnerContent('필수 3/3'),
  });

  // 오늘 확인할 질문 — 첫 질문은 확인한 것으로 표시(진행 표시용 체크).
  check('.record-questions-card .wire-choice:first-child input');

  // 이번 상담에서 확인할 것 — 첫 행 입력.
  setValue('#session-goal-note-0', '울타리대출 심사 결과와 카드 대금 상환 계획을 함께 확인한다.');

  // 오늘 상담 내용 — 수기 메모 + 상담 일시(날짜·시각 두 칸).
  setText('#record-memo', '울타리대출 심사 결과를 함께 확인했다. 카드 대금 연체 여부를 다시 물었고 당사자는 지난달분이 아직 미납이라고 답했다. 연체액과 잔액 정리를 다음 상담 전까지 약속했다. 최근 불면을 호소해 수면 위생과 병원 상담 필요성을 이야기했다.');
  setValue('#record-held-at', '2026-09-14');
  setValue('input[name="heldAtTime"]', '14:00');

  // 세부 목표 — 새 목표 입력칸.
  setValue('#record-goal-new', '매달 10만 원씩 비상금 통장에 저축한다');

  // 미해결 액션 처리 — act-1 진행 중, act-2 진행 중, act-3 완료.
  check('input[name="resolutionStatus_act-1"][value="in_progress"]');
  uncheck('input[name="resolutionStatus_act-1"][value=""]');
  setValue('#resolutionNote_act-1', '신청은 접수됐고 심사 결과 통보를 기다리는 중');
  check('input[name="resolutionStatus_act-2"][value="in_progress"]');
  uncheck('input[name="resolutionStatus_act-2"][value=""]');
  setValue('#resolutionNote_act-2', '연체액과 잔액을 이번 주 안으로 정리하기로 함');
  check('input[name="resolutionStatus_act-3"][value="done"]');
  uncheck('input[name="resolutionStatus_act-3"][value=""]');
  setValue('#resolutionNote_act-3', '자립정착금 잔액 40만 원을 확인하고 보증금에 보태기로 함');

  // 생활 6영역의 현재 상태와 확인 내용을 채운다.
  select('#lifeAreaStatus_economy', 'strained');
  setValue('#lifeAreaNote_economy', '카드 대금 미납 확인, 지출 압박 지속');
  select('#lifeAreaStatus_mental_health', 'strained');
  setValue('#lifeAreaNote_mental_health', '불면 호소, 수면 위생 안내');
  for (const [area, note] of [
    ['housing', '첫 독립 거주지의 임대차 계약을 마치고 보증금 대출을 준비하고 있다.'],
    ['employment', '첫 직장에서 3개월째 근무하며 근속을 이어가고 있다.'],
    ['health', '정기 진료 일정을 확인하고 복약을 이어가고 있다.'],
    ['family', '원가정과의 연락 빈도를 스스로 조절하고 있다.'],
  ]) {
    select(`#lifeAreaStatus_${area}`, 'okay');
    setValue(`#lifeAreaNote_${area}`, note);
  }

  // 새 액션과 다음 만남의 계획을 세 행 모두 채운다.
  setValue('#action-description-0', '카드 대금 연체액과 잔액 정리');
  select('#action-owner-0', 'beneficiary');
  setValue('#action-due-date-0', '2026-09-17');
  setValue('#action-description-1', '울타리대출 심사 결과 확인 후 공유');
  select('#action-owner-1', 'counselor');
  setValue('#action-due-date-1', '2026-09-18');
  setValue('#action-description-2', '일주일간 수면 시간과 지출 내역 기록');
  select('#action-owner-2', 'beneficiary');
  setValue('#action-due-date-2', '2026-09-21');
  setText('#safety-note', '이번 상담에서 새로운 긴급 안전 문제는 확인되지 않았다. 카드 대금 연체의 변화는 다음 상담에서 다시 확인한다.');
  setValue('#change-since-last', '통장을 나눈 뒤 카드 지출이 줄었다고 함');

  // 담당 실무자 의견.
  setText('#counselor-opinion', '카드 대금 연체가 확인되어 상환 계획 목표의 우선순위를 유지한다. 불면 호소는 다음 회차에서 경과를 확인한다.');

  const response = rewriter.transform(new Response(html));
  return response.text();
}

// 대조 재료 행은 같은 종류의 반복이다 — 짧은 항목을 768+ 에서 3열, 그 아래 1열로 묶는다(§4-9).
// .briefing-suggestions 가 display:grid 를 이미 갖고 있어 이 클래스는 열 정의만 덧붙인다.
export const css = `
.clinical-material-grid{grid-template-columns:minmax(0,1fr)}
@media(min-width:768px){.clinical-material-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
`;
