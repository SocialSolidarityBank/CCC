'use client';

import { useEffect, useRef, useState } from 'react';
import type { CaseMemoryView as MemoryView, MemoryCorrectionInput, MemoryItem, MemoryStatus } from '@ccc/contracts/counseling-memory';
import { WireBullets, WireCard, WireCardDetails } from '../../../../../components/wire/wire-card';
import { WireCardSection, WireItem } from '../../../../../components/wire/wire-section';
import { WireBadge } from '../../../../../components/wire/wire-badge';
import { WireButton } from '../../../../../components/wire/wire-button';
import { WireEmpty, WireError } from '../../../../../components/wire/wire-state';
import { WireQuote, WireSourceQuotes } from '../../../../../components/wire/wire-callout';
import { WireDataRow, WireDataRows } from '../../../../../components/wire/wire-data-rows';
import { WireActionMenu } from '../../../../../components/wire/wire-action-menu';
import { formatKoreanDateTime } from '../../../../../lib/format-korean-date';
import { MemoryCorrection } from './memory-correction';

import { DisclosureChevron } from '../../../../../components/wire/chevron';
export type MemoryMutationResult<T> = { ok: true; data: T } | { ok: false; error: string };
export type MemoryCorrect = (input: MemoryCorrectionInput) => Promise<MemoryMutationResult<MemoryView>>;

const statusLabels: Record<MemoryStatus, string> = {
  empty: '기록 없음', backfill: '첫 기억 생성 중', updating: '반영 중', ready: '최신 상태', off: '자동 갱신 꺼짐', blocked: '처리 대기', failed: '처리 실패', closed: '종결', unavailable: '이용 중단',
};
const statusDescriptions: Record<MemoryStatus, string> = {
  empty: '기억할 공식 상담 기록이 아직 없습니다.',
  backfill: '기존 상담 기록을 정리하고 있습니다. 상담 기록과 조회는 계속할 수 있습니다.',
  updating: '최근 기록을 반영하고 있습니다. 아래 내용은 마지막으로 반영된 유효한 기억입니다.',
  ready: '공식 상담 기록을 바탕으로 자동 정리한 보조 기억입니다.',
  off: '기관에서 자동 갱신을 껐습니다. 기존 기억은 마지막 반영 시점의 내용입니다.',
  blocked: 'AI 연결이나 동의, 가림 처리 조건이 준비될 때까지 기다립니다.',
  failed: '최근 기록을 반영하지 못했습니다. 아래 기억은 최신 기록을 반영하지 않았을 수 있습니다.',
  closed: '종결된 케이스의 기억입니다. 자동 갱신하지 않습니다.',
  unavailable: '현재 동의 또는 보존 상태에서는 상담 기억을 이용할 수 없습니다.',
};
const reasonLabels: Record<string, string> = {
  masking_snapshot_missing: '가림 처리 결과를 기다리고 있습니다.',
  local_ner_unavailable: '이름과 주소 가림 기능을 사용할 수 없어 기다리고 있습니다.',
  consent_not_effective: '현재 동의 상태로는 기억을 처리할 수 없습니다.',
  ai_provider_not_configured: '기관의 AI 연결이 준비되지 않았습니다.',
  ai_provider_unavailable: 'AI 연결을 사용할 수 없습니다.',
  registered_pii_detected: '개인정보 가림 확인을 통과하지 못했습니다.',
  unmasked_identifier_detected: '개인정보 가림 확인을 통과하지 못했습니다.',
  evidence_hash_mismatch: '근거 확인을 통과하지 못했습니다.',
  masking_pipeline_version_mismatch: '가림 처리 버전을 확인해야 합니다.',
};

export function MemorySummarySection({ memory, memoryHref }: { memory: MemoryView | null; memoryHref: string }) {
  return <WireCardSection tone="lavender" title={<span className="wire-title-with-badge">현재 맥락 요약{memory && <WireBadge tone="lavender">{statusLabels[memory.status]}</WireBadge>}</span>} action={<WireButton variant="neutral" href={memoryHref}>기억과 근거 보기</WireButton>}>
    {memory === null ? <WireError>상담 기억을 불러오지 못했습니다. 다른 상담 기록은 계속 확인할 수 있습니다.</WireError> : <MemorySummaryBody memory={memory} />}
  </WireCardSection>;
}

function MemorySummaryBody({ memory }: { memory: MemoryView }) {
  return <>
    {memory.summary.length > 0 ? <WireBullets items={memory.summary.map((line) => line.text)} /> : <WireEmpty>{memory.status === 'ready' ? '현재 표시할 기억이 없습니다.' : statusLabels[memory.status]}</WireEmpty>}
    {memory.updatedAt !== null && <p className="panel-meta">마지막 갱신 {formatKoreanDateTime(memory.updatedAt)}</p>}
    <p className="panel-meta">{memory.reason !== null && reasonLabels[memory.reason] ? reasonLabels[memory.reason] : statusDescriptions[memory.status]}</p>
  </>;
}

export function MemoryItemView({ item, recordsHref, goalsHref, actionsHref }: { item: MemoryItem; recordsHref: string; goalsHref: string; actionsHref: string }) {
  const sessions = new Map<string, typeof item.sources>();
  const otherSources = item.sources.filter((source) => source.sessionId === null);
  for (const source of item.sources) {
    if (source.sessionId === null) continue;
    const group = sessions.get(source.sessionId) ?? [];
    group.push(source); sessions.set(source.sessionId, group);
  }
  return <div className="memory-item" id={`memory-${item.id}-${item.revision}`}>
    <WireItem title={<span className="wire-title-with-badge">{item.title}<WireBadge tone={item.kind === 'observation' ? 'lavender' : 'neutral'}>{item.kind === 'observation' ? '기억 관찰' : '명시된 내용'}</WireBadge>{item.state === 'conflicting' && <WireBadge tone="coral">근거 차이</WireBadge>}{item.correctedAt !== null && <WireBadge>정정됨</WireBadge>}</span>} />
    <WireBullets items={[item.body]} />
    <p className="panel-meta">변경 {formatKoreanDateTime(item.updatedAt)}</p>
    {Array.from(sessions, ([sessionId, sources]) => <div key={sessionId}>
      <p className="panel-meta">근거 상담 {formatKoreanDateTime(sources[0]!.occurredAt)}</p>
      <WireSourceQuotes quotes={sources.map((source) => source.quote)} sourceHref={`${recordsHref}#record-${encodeURIComponent(sessionId)}`} />
    </div>)}
    {otherSources.map((source) => <details className="wire-source-quotes" key={source.materialId}>
      <summary>{source.sourceKind === 'correction' ? '정정 근거' : source.sourceKind === 'goal' ? '목표 근거' : source.sourceKind === 'action' ? '액션 근거' : '이전 맥락 근거'} <DisclosureChevron variant="plain" /></summary>
      <WireQuote>{source.quote}</WireQuote>
      {(source.sourceKind === 'goal' || source.sourceKind === 'action') && <WireButton variant="neutral" href={source.sourceKind === 'goal' ? `${goalsHref}#goal-${encodeURIComponent(source.sourceId)}` : `${actionsHref}#action-${encodeURIComponent(source.sourceId)}`}>{source.sourceKind === 'goal' ? '목표 보기' : '액션 보기'}</WireButton>}
    </details>)}
    {item.references.length > 0 && <div className="memory-reference-actions">{item.references.map((reference) => <WireButton key={`${reference.kind}-${reference.id}`} variant="neutral" href={reference.kind === 'goal' ? `${goalsHref}#goal-${encodeURIComponent(reference.id)}` : `${actionsHref}#action-${encodeURIComponent(reference.id)}`}>{reference.kind === 'goal' ? '연결된 목표 보기' : '연결된 액션 보기'}</WireButton>)}</div>}
  </div>;
}

export function CaseMemoryView({ memory: initial, supportCaseId, programLabel, recordsHref, goalsHref, actionsHref, onCorrect, onRefresh }: {
  memory: MemoryView; supportCaseId: string; programLabel: string; recordsHref: string; goalsHref: string; actionsHref: string; onCorrect: MemoryCorrect; onRefresh: () => Promise<MemoryMutationResult<MemoryView>>;
}) {
  const [memory, setMemory] = useState(initial);
  const [correcting, setCorrecting] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { setMemory(initial); }, [initial]);
  if (memory.supportCaseId !== supportCaseId) return <WireError>요청한 케이스의 기억을 확인할 수 없습니다.</WireError>;
  const itemProps = { recordsHref, goalsHref, actionsHref };
  return <div className="memory-page-stack">
    <WireCard title={<span className="wire-title-with-badge">현재 맥락 요약<WireBadge tone="lavender">{statusLabels[memory.status]}</WireBadge></span>}>
      <MemorySummaryBody memory={memory} />
      <WireDataRows><WireDataRow label="현재 사업" value={programLabel} /></WireDataRows>
    </WireCard>
    <WireCard title={<div className="memory-card-heading"><span>현재 기억</span>{memory.canCorrect && memory.items.length > 0 && <WireActionMenu triggerRef={menuTrigger} items={[{ label: '기억 정정', onSelect: () => setCorrecting(true) }]} />}</div>}>
      {(['fact', 'observation'] as const).map((kind) => <WireCardSection key={kind} title={kind === 'fact' ? '기록에 명시된 내용' : '기억 관찰'} tone={kind === 'fact' ? 'sub' : 'lavender'}>
        {memory.items.filter((item) => item.kind === kind).length === 0 ? <WireEmpty>표시할 항목이 없습니다.</WireEmpty> : memory.items.filter((item) => item.kind === kind).map((item) => <MemoryItemView key={`${item.id}-${item.revision}`} item={item} {...itemProps} />)}
      </WireCardSection>)}
    </WireCard>
    {correcting && memory.canCorrect && <MemoryCorrection items={memory.items} onCorrect={onCorrect} onRefresh={onRefresh} onSaved={(next) => { if (next.supportCaseId === supportCaseId) { setMemory(next); setCorrecting(false); menuTrigger.current?.focus(); } }} onCancel={() => { setCorrecting(false); menuTrigger.current?.focus(); }} {...itemProps} />}
    <WireCardDetails title="과거 기억과 변경 이력" badge={<WireBadge>{memory.history.length}건</WireBadge>}>
      {memory.history.length === 0 ? <WireEmpty>표시할 이력이 없습니다.</WireEmpty> : memory.history.map((item) => <MemoryItemView key={`${item.id}-${item.revision}`} item={item} {...itemProps} />)}
    </WireCardDetails>
  </div>;
}
