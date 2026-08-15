import type { ReactNode } from 'react';
import { GridContainer } from '../../../../../../../components/wire/grid-container';
import { MetaRow } from '../../../../../../../components/wire/meta-row';
import { PageTitle } from '../../../../../../../components/wire/page-title';
import { ParticipantHeroCard } from '../../../../../../../components/wire/participant-hero-card';
import { WireCallout, WireQuote } from '../../../../../../../components/wire/wire-callout';
import { WireCard } from '../../../../../../../components/wire/wire-card';
import { WireBadge } from '../../../../../../../components/wire/wire-badge';
import { WireButton } from '../../../../../../../components/wire/wire-button';
import { WireCardSection, WireItem } from '../../../../../../../components/wire/wire-section';
import { WireEmpty } from '../../../../../../../components/wire/wire-state';

export interface FixtureDraftViewModel {
  origin: 'fixture_generated';
  creationMode: 'fixture_generated';
  summaryText: string;
  oneLiner: string | null;
  questions: Array<{ title: string; reason: string }>;
  evidence: Array<{ id: string; claimKey: string; quote: string }>;
}

export interface FixtureDraftViewProps {
  beneficiaryId: string;
  participantName: string | null;
  stageTag: string;
  metaItems: ReactNode[];
  recordsHref: string;
  draft: FixtureDraftViewModel;
}

export function FixtureDraftView({
  beneficiaryId,
  participantName,
  stageTag,
  metaItems,
  recordsHref,
  draft,
}: FixtureDraftViewProps) {
  return (
    <div data-testid="fixture-review">
      <GridContainer as="main" className="page-content">
        <div className="page-header">
          <PageTitle>테스트 산출물 검수</PageTitle>
        </div>

        <ParticipantHeroCard
          name={participantName}
          beneficiaryId={beneficiaryId}
          stageTag={stageTag}
          meta={<MetaRow items={metaItems} />}
          actions={<WireButton href={recordsHref} variant="secondary">전체 상담 기록</WireButton>}
        />

        <WireCallout
          title="이 산출물은 승인할 수 없습니다"
          tone="lavender"
          role="status"
          testId="fixture-draft-notice"
        >
          Preview 검증용 결과이며 공식 상담 기록에는 반영되지 않습니다.
        </WireCallout>

        <WireCard
          as="section"
          labelledBy="fixture-draft-title"
          testId="fixture-draft"
          title={(
            <div className="wire-card-head">
              <h2 id="fixture-draft-title">AI 초안</h2>
              <WireBadge tone="lavender" testId="fixture-origin-badge">테스트 산출물</WireBadge>
            </div>
          )}
        >
          <WireCardSection
            title="핵심 한 줄"
            tone="lavender"
            testId="fixture-section-one-liner"
          >
            {draft.oneLiner === null
              ? <WireEmpty>핵심 한 줄이 없습니다.</WireEmpty>
              : <p>{draft.oneLiner}</p>}
          </WireCardSection>

          <WireCardSection
            title="요약"
            tone="lavender"
            testId="fixture-section-summary"
          >
            <p>{draft.summaryText}</p>
          </WireCardSection>

          <WireCardSection
            title="확인할 질문"
            tone="lavender"
            testId="fixture-section-questions"
          >
            {draft.questions.length === 0
              ? <WireEmpty>확인할 질문이 없습니다.</WireEmpty>
              : (
                <ul className="briefing-suggestions">
                  {draft.questions.map((question) => (
                    <li key={`${question.title}\u0000${question.reason}`}>
                    <WireItem
                      tone="lavender"
                      title={question.title}
                      description={question.reason}
                    />
                    </li>
                  ))}
                </ul>
              )}
          </WireCardSection>

          <WireCardSection
            title="근거 인용"
            tone="lavender"
            testId="fixture-section-evidence"
          >
            {draft.evidence.length === 0
              ? <WireEmpty>근거 인용이 없습니다.</WireEmpty>
              : (
                <ul className="briefing-suggestions">
                  {draft.evidence.map((evidence) => (
                    <li key={evidence.id}>
                      <WireQuote>{evidence.quote}</WireQuote>
                    </li>
                  ))}
                </ul>
              )}
          </WireCardSection>
        </WireCard>
      </GridContainer>
    </div>
  );
}
