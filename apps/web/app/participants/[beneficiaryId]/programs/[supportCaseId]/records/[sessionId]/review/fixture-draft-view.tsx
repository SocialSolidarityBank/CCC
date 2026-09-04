import type { ReactNode } from 'react';
import type {
  AiContrastAxis,
  AiContrastAxisStatus,
  AiDraftContrastAxis,
  AiClaimSection,
  AiDraftCreationMode,
  AiDraftOrigin,
  AiDraftReviewDecision,
  AiMaterialKind,
  TranscriptQuality,
} from '../../../../../../../lib/api';
import { GridContainer } from '../../../../../../../components/wire/grid-container';
import { MetaRow } from '../../../../../../../components/wire/meta-row';
import { PageTitle } from '../../../../../../../components/wire/page-title';
import { ParticipantHeroCard } from '../../../../../../../components/wire/participant-hero-card';
import { WireCallout, WireSourceQuotes } from '../../../../../../../components/wire/wire-callout';
import { WireCard } from '../../../../../../../components/wire/wire-card';
import { WireBadge, type WireBadgeTone } from '../../../../../../../components/wire/wire-badge';
import { WireButton } from '../../../../../../../components/wire/wire-button';
import { WireCardSection, WireItem } from '../../../../../../../components/wire/wire-section';
import { WireChoice, WireFormField } from '../../../../../../../components/wire/wire-form-field';
import { WireEmpty, WireError } from '../../../../../../../components/wire/wire-state';

// 대조 3종 축 표시 순서 + 한글 라벨(D69 · ADR-0036 결정 1·3, CCC-100).
const contrastAxisOrder: AiContrastAxis[] = ['missing_from_memo', 'missing_from_transcript', 'undiscussed_session_goal'];
const contrastAxisLabels: Record<AiContrastAxis, string> = {
  missing_from_memo: '메모에 없는 내용',
  missing_from_transcript: '음성에 없는 내용',
  undiscussed_session_goal: '미논의 목표',
};

// 비적용 축 안내 한 줄(축마다 재료 부재 사유가 다르다, 결정 2·3).
const contrastAxisUnavailableNotices: Record<Exclude<AiContrastAxisStatus, 'applied'>, string> = {
  no_transcript: '녹음 전사가 없어 이 대조는 만들지 않았습니다.',
  no_text: '수기 메모나 목표 같은 텍스트 재료가 없어 이 대조는 만들지 않았습니다.',
  no_session_goal: '이번 회기의 세션 목표가 없어 이 대조는 만들지 않았습니다.',
};

const materialKindLabels: Record<AiMaterialKind, string> = {
  transcript: '전사',
  text_context: '텍스트',
};

// 전사 경고 사유 코드 → 안내 문구 (CCC-124). 모르는 코드는 코드 그대로 보여준다 —
// 화면이 원인 불명 경고를 숨기지 않는다.
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

// 축 상태 배지(검수 지적 8 — "돌리지 못함"과 "돌렸는데 차이 없음"을 옷으로 가른다).
// v3 이전 초안(빈 배열)은 이유를 알 수 없으니 '돌리지 못함'과 다른 낱말을 쓴다(지적 7).
function axisBadge(data: AiDraftContrastAxis | undefined): { tone: WireBadgeTone; label: string } {
  if (data === undefined) return { tone: 'neutral', label: '정보 없음' };
  if (data.status !== 'applied') return { tone: 'neutral', label: '돌리지 못함' };
  return data.findings.length === 0
    ? { tone: 'mint', label: '차이 없음' }
    : { tone: 'lavender', label: '차이 있음' };
}

export interface DraftReviewViewModel {
  origin: AiDraftOrigin;
  creationMode: AiDraftCreationMode;
  version: number;
  summaryText: string;
  claims: Array<{ claimKey: string; section: AiClaimSection; text: string }>;
  oneLiner: string | null;
  questions: Array<{ title: string; reason: string }>;
  evidence: Array<{ id: string; claimKey: string; quote: string }>;
  /** 승인·반려 사실(R2). null = 검토 대기 — 처리 카드는 이 값이 null 일 때만 선다(지적 5). */
  reviewDecision: AiDraftReviewDecision;
  /** 대조 3종(D69 · ADR-0036). v3 이전 초안은 빈 배열이다. */
  contrast: AiDraftContrastAxis[];
  /** 재생성 노출 조건은 서버가 판정한다(R1) — 화면은 이 값만 읽는다. */
  regenerateAvailable: boolean;
  regenerateSourceSnapshotId: string | null;
  /** 전사 품질 (CCC-124). null = 녹음 결과 없음 또는 레거시 결과(품질 미상). */
  transcriptQuality: TranscriptQuality | null;
}

export interface DraftReviewViewProps {
  beneficiaryId: string;
  supportCaseId: string;
  sessionId: string;
  participantName: string | null;
  stageTag: string;
  /** 검토 대기·승인됨·반려됨 3종 전부 AI 산출물 상태다(D58 ④) — 라벤더로 연다(CCC-106). */
  stageTagTone?: 'neutral' | 'lavender' | undefined;
  metaItems: ReactNode[];
  recordsHref: string;
  draft: DraftReviewViewModel;
  /** 처리(승인·반려) 실패 안내(리다이렉트 뒤 notice 파라미터). */
  errorMessage?: string | undefined;
  successMessage?: string | undefined;
  /** 서버 액션. 없으면(테스트 등) 처리·재생성 UI 를 그리지 않는다(R2 는 뒷단이 갖는다). */
  reviewAction?: ((formData: FormData) => Promise<void>) | undefined;
  generateAction?: ((formData: FormData) => Promise<void>) | undefined;
  actionItemAction?: ((formData: FormData) => Promise<void>) | undefined;
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
        // v3 이전 초안(빈 배열)은 재료가 없어서가 아니라 대조 자체를 만든 적이 없다 — 사유를
        // 아는 '돌리지 못함'과 같은 문구를 쓰면 없는 사실을 단정하게 된다(검수 지적 7).
        ? <WireEmpty>이 초안에는 대조 결과가 없습니다.</WireEmpty>
        : data.status !== 'applied'
          ? <WireEmpty>{contrastAxisUnavailableNotices[data.status]}</WireEmpty>
          : data.findings.length === 0
            ? <WireEmpty>확인된 차이가 없습니다.</WireEmpty>
            : (
              <ul className="briefing-suggestions">
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

export function DraftReviewView({
  beneficiaryId,
  supportCaseId,
  sessionId,
  participantName,
  stageTag,
  stageTagTone,
  metaItems,
  recordsHref,
  draft,
  errorMessage,
  successMessage,
  reviewAction,
  generateAction,
  actionItemAction,
}: DraftReviewViewProps) {
  const isFixture = draft.origin === 'fixture_generated';
  const contrastByAxis = new Map(draft.contrast.map((axis) => [axis.axis, axis]));
  // 처리 카드는 아직 검토 대기인 초안에만 선다(지적 5) — 승인·반려가 이미 확정된 초안을
  // 다시 처리하는 UI 를 보여주지 않는다. fixture 는 애초에 승인 UI 자체가 없다(R2 서버 게이트).
  const showReviewActions = !isFixture && reviewAction !== undefined && draft.reviewDecision === null;
  const regenerateVisible = draft.regenerateAvailable && draft.regenerateSourceSnapshotId !== null && generateAction !== undefined;
  // 화자 확인 체크(CCC-114 · D11): 전사 기반 대조 축이 적용된 초안 = 녹음 재료가 있는 회차.
  // 서버가 최종 판정하므로(R1) 여기서는 체크를 그릴지들만 정한다.
  const requiresSpeakerConfirmation = draft.contrast.some((axisData) => axisData.status === 'applied'
    && (axisData.axis === 'missing_from_memo' || axisData.axis === 'missing_from_transcript'));
  const claimsBySection = new Map(claimSectionOrder.map((section) => [
    section,
    draft.claims.filter((claim) => claim.section === section),
  ] as const));
  const sourceQuotesByClaim = new Map<string, string[]>();
  for (const evidence of draft.evidence) {
    const quotes = sourceQuotesByClaim.get(evidence.claimKey) ?? [];
    if (!quotes.includes(evidence.quote)) quotes.push(evidence.quote);
    sourceQuotesByClaim.set(evidence.claimKey, quotes);
  }
  const sourceHref = `${recordsHref}#record-${sessionId}`;

  return (
    <div data-testid="ai-draft-review">
      <GridContainer as="main" className="page-content">
        <div className="page-header">
          <PageTitle>AI 초안 검토</PageTitle>
        </div>

        <ParticipantHeroCard
          name={participantName}
          beneficiaryId={beneficiaryId}
          stageTag={stageTag}
          stageTagTone={stageTagTone}
          meta={<MetaRow items={metaItems} />}
          actions={<WireButton href={recordsHref} variant="secondary">상담 기록 확인</WireButton>}
        />

        {isFixture && (
          <WireCallout
            title="이 산출물은 승인할 수 없습니다"
            tone="lavender"
            role="status"
            testId="preview-fixture-notice"
          >
            Preview 검증용 결과이며 공식 상담 기록에는 반영되지 않습니다. 대조 3종과 요약은 그대로 확인할 수 있습니다.
          </WireCallout>
        )}

        {errorMessage !== undefined && <WireError>{errorMessage}</WireError>}
        {successMessage !== undefined && (
          <WireCallout title={successMessage} tone="mint" role="status" />
        )}

        {/* 전사 신뢰 불가 구간 표시 (CCC-124). 표시만 한다 — 승인 차단은 CCC-114 후속.
            어느 쪽이 맞는지 정하는 것은 사람 몫이다(R5). */}
        {draft.transcriptQuality !== null && !draft.transcriptQuality.transcriptReliable && (
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
              {draft.transcriptQuality.warnings.map((warning, index) => (
                <li key={`${warning.startSeconds}-${warning.endSeconds}-${warning.reason}-${index}`}>
                  {transcriptClock(warning.startSeconds)}~{transcriptClock(warning.endSeconds)}
                  {': '}
                  {transcriptWarningReasonLabels[warning.reason] ?? warning.reason}
                </li>
              ))}
            </ul>
          </WireCallout>
        )}

        <WireCard
          as="section"
          testId="ai-draft-card"
          title={(
            <div className="wire-card-head">
              <span>AI 초안</span>
              {isFixture && <WireBadge tone="lavender" testId="preview-fixture-badge">테스트 산출물</WireBadge>}
            </div>
          )}
        >
          <WireCardSection
            title="핵심 한 줄"
            tone="lavender"
            testId="ai-draft-section-one-liner"
          >
            {draft.oneLiner === null
              ? <WireEmpty>핵심 한 줄이 없습니다.</WireEmpty>
              : <p className="wire-section-value">{draft.oneLiner}</p>}
          </WireCardSection>

          {draft.claims.length === 0
            ? (
              <WireCardSection
                title="요약"
                tone="lavender"
                testId="ai-draft-section-summary"
              >
                <p className="wire-section-value">{draft.summaryText}</p>
              </WireCardSection>
            )
            : claimSectionOrder.map((section) => {
              const claims = claimsBySection.get(section) ?? [];
              return (
                <WireCardSection
                  key={section}
                  title={claimSectionLabels[section]}
                  tone="lavender"
                  testId={`ai-draft-claims-${section}`}
                >
                  {claims.length === 0
                    ? (
                      <WireEmpty>
                        {section === 'session_goal_discussion'
                          ? '이번 회기의 세션 목표가 없어 이 구획을 만들지 않았습니다.'
                          : '이 구획에 정리된 내용이 없습니다.'}
                      </WireEmpty>
                    )
                    : (
                      <ul className="briefing-suggestions">
                        {claims.map((claim) => (
                          <li key={claim.claimKey}>
                            <WireItem tone="lavender" title={claim.text} />
                            <WireSourceQuotes
                              quotes={sourceQuotesByClaim.get(claim.claimKey) ?? []}
                              sourceHref={sourceHref}
                            />
                            {section === 'next_session_commitments' && !isFixture && actionItemAction !== undefined && (
                              <form
                                action={actionItemAction}
                                data-testid={`ai-commitment-action-${claim.claimKey}`}
                              >
                                <input type="hidden" name="beneficiaryId" value={beneficiaryId} />
                                <input type="hidden" name="supportCaseId" value={supportCaseId} />
                                <input type="hidden" name="sessionId" value={sessionId} />
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
                                    defaultValue=""
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
                                  <input id={`action-due-${claim.claimKey}`} name="dueDate" type="date" />
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

          <WireCardSection
            title="확인할 질문"
            tone="lavender"
            testId="ai-draft-section-questions"
          >
            {draft.questions.length === 0
              ? <WireEmpty>확인할 질문이 없습니다.</WireEmpty>
              : (
                <ul className="briefing-suggestions">
                  {draft.questions.map((question, index) => (
                    <li key={`${question.title}\u0000${question.reason}`}>
                      <WireItem
                        tone="lavender"
                        title={question.title}
                        description={question.reason}
                      />
                      <WireSourceQuotes
                        quotes={sourceQuotesByClaim.get(`question_${index + 1}`) ?? []}
                        sourceHref={sourceHref}
                      />
                    </li>
                  ))}
                </ul>
              )}
          </WireCardSection>

          <WireCardSection
            title="근거 인용"
            tone="lavender"
            testId="ai-draft-section-evidence"
          >
            {draft.evidence.length === 0
              ? <WireEmpty>근거 인용이 없습니다.</WireEmpty>
              : (
                <ul className="briefing-suggestions">
                  {draft.evidence.map((evidence) => (
                    <li key={evidence.id}>
                      <WireSourceQuotes quotes={[evidence.quote]} sourceHref={sourceHref} />
                    </li>
                  ))}
                </ul>
              )}
          </WireCardSection>
        </WireCard>

        {/* 대조 3종(D69 · ADR-0036 결정 1) — R2 가 정의하는 승인의 핵심: 수기 기록과
            녹취 기반 AI 정리의 대조를 실무자가 확인하는 것이 곧 정합성 검증이다. */}
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
              data={contrastByAxis.get(axis)}
              sourceHref={sourceHref}
            />
          ))}
        </WireCard>

        {/* 재생성 가용 안내(지적 9) — 처리 카드보다 위의 안내줄이라 승인 버튼을 만나기 전에
            읽힌다. fixture 는 승인이 없어 처리 카드가 아예 안 서므로, 이 안내가 유일한
            재생성 맥락 설명이다 — 프리뷰에서 지킬 수 없는 약속을 하지 않는다(지적 11). */}
        {regenerateVisible && (
          <WireCallout
            title="더 새로운 재료가 도착했습니다"
            tone="lavender"
            role="status"
            testId="ai-draft-regenerate-notice"
          >
            {isFixture
              ? 'Preview 검증용 결과라 재생성해도 공식 기록에는 반영되지 않지만, 최신 전사·텍스트 재료로 다시 확인할 수 있습니다.'
              : '재생성하면 이 재료까지 반영한 새 초안을 만듭니다. 승인 전에 다시 확인하세요.'}
          </WireCallout>
        )}

        {showReviewActions && (
          <WireCard as="section" testId="ai-draft-review-actions" title="처리">
            <p className="panel-meta">
              대조 3종을 모두 확인한 뒤 승인하거나 반려하세요. 승인하면 이 초안이 공식 기록이 됩니다.
            </p>
            <form id={REVIEW_FORM_ID} action={reviewAction}>
              <input type="hidden" name="beneficiaryId" value={beneficiaryId} />
              <input type="hidden" name="supportCaseId" value={supportCaseId} />
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="expectedVersion" value={draft.version} />
              {requiresSpeakerConfirmation && (
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
        )}

        {/* regenerateVisible 이 이미 non-null 을 보장하지만, TS 는 별도 boolean 변수로는 그
            사실을 못 좁힌다 — hidden input 값에서만 원래 조건을 다시 짚어 좁힌다. */}
        {regenerateVisible && draft.regenerateSourceSnapshotId !== null && (
          <WireCard as="section" testId="ai-draft-regenerate" title="재생성">
            <form action={generateAction}>
              <input type="hidden" name="beneficiaryId" value={beneficiaryId} />
              <input type="hidden" name="supportCaseId" value={supportCaseId} />
              <input type="hidden" name="sessionId" value={sessionId} />
              <input type="hidden" name="sourceSnapshotId" value={draft.regenerateSourceSnapshotId} />
              <div className="wizard-actions">
                <WireButton type="submit" variant="secondary">재생성</WireButton>
              </div>
            </form>
          </WireCard>
        )}
      </GridContainer>
    </div>
  );
}
