import type {
  MemoryGenerationOutput,
  MemoryGenerationRequest,
  MemoryItem,
  MemoryItemState,
  MemoryKind,
  MemoryMaterial,
} from '@ccc/contracts/counseling-memory';

/**
 * Synthetic fixture identity only. These snapshots are not Agent snapshots and
 * cannot qualify production egress, attestation, consent, or privacy gates.
 */
const FIXTURE_HASH = 'f'.repeat(64);

function material(
  id: string,
  maskedText: string,
  options: Partial<Pick<MemoryMaterial, 'sourceKind' | 'sourceId' | 'sourceRevision' | 'sessionId' | 'occurredAt'>> = {},
): MemoryMaterial {
  const sourceKind = options.sourceKind ?? 'session';
  const sourceId = options.sourceId ?? id;
  const sessionId = options.sessionId === undefined
    ? sourceKind === 'session' ? sourceId : null
    : options.sessionId;
  return {
    id,
    sourceKind,
    sourceId,
    sourceRevision: options.sourceRevision ?? '1',
    sessionId,
    occurredAt: options.occurredAt ?? '2026-08-01T00:00:00Z',
    snapshotId: `fixture-snapshot-${id}`,
    sha256: FIXTURE_HASH,
    maskedText,
  };
}

function existingItem(
  id: string,
  title: string,
  body: string,
  source: MemoryMaterial,
  proof: MemoryMaterial,
  options: Partial<Pick<MemoryItem, 'state' | 'revision' | 'correctedAt' | 'kind'>> = {},
): MemoryItem {
  const revision = options.revision ?? 1;
  return {
    id,
    kind: options.kind ?? 'fact',
    title,
    body,
    state: options.state ?? 'current',
    revision,
    updatedAt: options.correctedAt ?? '2026-08-02T00:00:00Z',
    correctedAt: options.correctedAt ?? null,
    sources: [{
      materialId: source.id,
      quote: source.maskedText,
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
      sourceRevision: source.sourceRevision,
      sessionId: source.sessionId,
      occurredAt: source.occurredAt,
    }],
    references: [],
  };
}

function proofFor(id: string, revision: number, title: string, body: string, at = '2026-08-02T00:00:00Z'): MemoryMaterial {
  return material(`fixture-proof-${id}`, `${title}\n${body}`, {
    sourceKind: 'derived_summary',
    sourceId: id,
    sourceRevision: String(revision),
    occurredAt: at,
  });
}

function request(
  supportCaseId: string,
  materials: MemoryMaterial[],
  existingItems: MemoryItem[] = [],
): MemoryGenerationRequest {
  return { supportCaseId, generation: 1, materials, existingItems };
}

export interface MemoryEvalEvidenceExpectation {
  materialIds: readonly string[];
}

export interface MemoryEvalTransitionExpectation {
  itemId: string | null;
  state: MemoryItemState;
  kind?: MemoryKind;
  materialIds?: readonly string[];
}

export interface MemoryEvalReferenceExpectation {
  itemId: string | null;
  kind: 'goal' | 'action';
  id: string;
}

export interface MemoryEvalExpectations {
  evidence: MemoryEvalEvidenceExpectation;
  transitions: readonly MemoryEvalTransitionExpectation[];
  preservedItemIds: readonly string[];
  references: readonly MemoryEvalReferenceExpectation[];
}

export interface MemoryEvalMutation {
  code: 'fixture_invalid_quote' | 'fixture_cross_source_reference' | 'fixture_same_session_observation' | 'fixture_old_correction_reversal';
  mutate: (output: MemoryGenerationOutput) => unknown;
}

export interface MemoryEvalCase {
  id: string;
  request: MemoryGenerationRequest;
  /** A validator-approved fixture; scoring never compares exact generated prose. */
  expectedOutput: MemoryGenerationOutput;
  expectations: MemoryEvalExpectations;
  /** Invalid-output examples used by deterministic tests only, never a live fallback. */
  invalidMutations: readonly MemoryEvalMutation[];
}

function cloneOutput(output: MemoryGenerationOutput): MemoryGenerationOutput {
  return {
    updates: output.updates.map((update) => ({
      ...update,
      citations: update.citations.map((citation) => ({ ...citation })),
      references: update.references.map((reference) => ({ ...reference })),
    })),
    summary: output.summary.map((line) => ({ ...line, itemKeys: [...line.itemKeys] })),
  };
}

const initialMaterial = material('fixture-initial-session', '다음 상담 전까지 지출 기록을 정리하기로 했다.');
const initialOutput: MemoryGenerationOutput = {
  updates: [{
    key: 'spending-plan', itemId: null, kind: 'fact', title: '지출 기록 정리',
    body: initialMaterial.maskedText, state: 'current',
    citations: [{ materialId: initialMaterial.id, quote: initialMaterial.maskedText }], references: [],
  }],
  summary: [{ text: '지출 기록 정리 계획이 현재 기록으로 남아 있다.', itemKeys: ['spending-plan'] }],
};

const changeOld = material('fixture-change-old', '다음 상담에 계획안을 가져오기로 했다.', { occurredAt: '2026-08-01T00:00:00Z' });
const changeNew = material('fixture-change-new', '계획안을 제출했다.', { occurredAt: '2026-08-08T00:00:00Z' });
const changeProof = proofFor('item-plan', 1, '계획안 제출 약속', changeOld.maskedText);
const changeItem = existingItem('item-plan', '계획안 제출 약속', changeOld.maskedText, changeOld, changeProof);
const changeOutput: MemoryGenerationOutput = {
  updates: [
    {
      key: 'plan-commitment-history', itemId: 'item-plan', kind: 'fact', title: '계획안 제출 약속',
      body: changeOld.maskedText, state: 'historical',
      citations: [{ materialId: changeNew.id, quote: changeNew.maskedText }], references: [],
    },
    {
      key: 'plan-submitted', itemId: null, kind: 'fact', title: '계획안 제출',
      body: changeNew.maskedText, state: 'current',
      citations: [{ materialId: changeNew.id, quote: changeNew.maskedText }], references: [],
    },
  ],
  summary: [{ text: '계획안 제출이 현재 기록으로 남아 있다.', itemKeys: ['plan-submitted'] }],
};

const promiseOld = material('fixture-promise-old', '다음 상담에 서류를 가져오기로 했다.', { occurredAt: '2026-08-01T00:00:00Z' });
const promiseProof = proofFor('item-promise', 1, '서류 준비 약속', promiseOld.maskedText);
const promiseItem = existingItem('item-promise', '서류 준비 약속', promiseOld.maskedText, promiseOld, promiseProof);
const promiseFulfilled = material('fixture-promise-fulfilled', '서류를 가져왔다.', { occurredAt: '2026-08-08T00:00:00Z' });
const promiseOutput: MemoryGenerationOutput = {
  updates: [{
    key: 'promise-fulfilled', itemId: 'item-promise', kind: 'fact', title: '서류 준비 약속',
    body: promiseFulfilled.maskedText, state: 'current',
    citations: [{ materialId: promiseFulfilled.id, quote: promiseFulfilled.maskedText }], references: [],
  }],
  summary: [{ text: '서류 준비 약속의 이행 기록이 현재 상태다.', itemKeys: ['promise-fulfilled'] }],
};

const conflictA = material('fixture-conflict-a', '첫 상담일에 서류를 제출했다.', { occurredAt: '2026-08-01T00:00:00Z' });
const conflictB = material('fixture-conflict-b', '첫 상담일에 서류를 제출하지 않았다.', { occurredAt: '2026-08-08T00:00:00Z' });
const conflictOutput: MemoryGenerationOutput = {
  updates: [{
    key: 'submission-conflict', itemId: null, kind: 'fact', title: '서류 제출 기록',
    body: '첫 상담일의 서류 제출 여부에 대해 서로 다른 기록이 있다.', state: 'conflicting',
    citations: [
      { materialId: conflictA.id, quote: conflictA.maskedText },
      { materialId: conflictB.id, quote: conflictB.maskedText },
    ], references: [],
  }],
  summary: [],
};

const observationA = material('fixture-observation-a', '상담에서 계획을 구체적으로 설명했다.', { occurredAt: '2026-08-01T00:00:00Z' });
const observationB = material('fixture-observation-b', '다음 상담에서도 계획을 구체적으로 설명했다.', { occurredAt: '2026-08-08T00:00:00Z' });
const observationRepeat = material('fixture-observation-repeat', '같은 상담에서 계획을 다시 설명했다.', {
  occurredAt: '2026-08-01T01:00:00Z',
  sourceId: 'fixture-observation-a', sessionId: 'fixture-observation-a',
});
const observationOutput: MemoryGenerationOutput = {
  updates: [{
    key: 'repeated-planning', itemId: null, kind: 'observation', title: '계획 설명 반복',
    body: '서로 다른 상담에서 계획을 구체적으로 설명한 모습이 관찰되었다.', state: 'current',
    citations: [
      { materialId: observationA.id, quote: observationA.maskedText },
      { materialId: observationB.id, quote: observationB.maskedText },
    ], references: [],
  }],
  summary: [],
};

const correctionOld = material('fixture-correction-old', '주 3회 운동을 하기로 했다.', { occurredAt: '2026-08-01T00:00:00Z' });
const correctionProof = material('fixture-correction-proof', '운동 계획\n주 1회 운동을 하기로 했다.\n주 3회 운동을 하기로 했다.', {
  sourceKind: 'correction', sourceId: 'item-corrected', sourceRevision: '2', occurredAt: '2026-08-04T00:00:00Z',
});
const correctionItem = existingItem(
  'item-corrected', '운동 계획', '주 1회 운동을 하기로 했다.', correctionOld, correctionProof,
  { revision: 2, correctedAt: '2026-08-04T00:00:00Z' },
);
const correctionUnrelated = material('fixture-correction-unrelated', '오늘은 책을 읽었다.', { occurredAt: '2026-08-08T00:00:00Z' });
const correctionOutput: MemoryGenerationOutput = { updates: [], summary: [] };

const retainedSource = material('fixture-retained-source', '주간 기록을 계속 남기기로 했다.', { occurredAt: '2026-08-01T00:00:00Z' });
const retainedProof = proofFor('item-retained', 1, '주간 기록', retainedSource.maskedText);
const retainedItem = existingItem('item-retained', '주간 기록', retainedSource.maskedText, retainedSource, retainedProof);
const selectiveSource = material('fixture-selective-source', '이번 주 기록 방식을 바꾸기로 했다.', { occurredAt: '2026-08-08T00:00:00Z' });
const selectiveProof = proofFor('item-selective', 1, '기록 방식', '이전 기록 방식을 유지한다.');
const selectiveItem = existingItem('item-selective', '기록 방식', '이전 기록 방식을 유지한다.', selectiveSource, selectiveProof);
const selectiveOutput: MemoryGenerationOutput = {
  updates: [{
    key: 'item-selective-update', itemId: 'item-selective', kind: 'fact', title: '기록 방식',
    body: selectiveSource.maskedText, state: 'current',
    citations: [{ materialId: selectiveSource.id, quote: selectiveSource.maskedText }], references: [],
  }],
  summary: [{ text: '기록 방식 변경이 현재 기록이다.', itemKeys: ['item-selective-update'] }],
};

const goalMaterial = material('fixture-goal-weekly', '이번 주 목표는 매일 기록을 남기는 것이다.', {
  sourceKind: 'goal', sourceId: 'goal-weekly', sessionId: null,
});
const goalSession = material('fixture-goal-session', '이번 주 기록을 매일 남기기로 했다.', { occurredAt: '2026-08-08T00:00:00Z' });
const goalOutput: MemoryGenerationOutput = {
  updates: [{
    key: 'goal-linked-record', itemId: null, kind: 'fact', title: '주간 기록 목표',
    body: goalSession.maskedText, state: 'current',
    citations: [
      { materialId: goalSession.id, quote: goalSession.maskedText },
      { materialId: goalMaterial.id, quote: goalMaterial.maskedText },
    ], references: [{ kind: 'goal', id: 'goal-weekly' }],
  }],
  summary: [{ text: '주간 기록 목표와 현재 계획이 연결되어 있다.', itemKeys: ['goal-linked-record'] }],
};

export const MEMORY_EVAL_CASES: readonly MemoryEvalCase[] = [
  {
    id: 'initial-fact', request: request('fixture-case-initial', [initialMaterial]), expectedOutput: initialOutput,
    expectations: { evidence: { materialIds: [initialMaterial.id] }, transitions: [{ itemId: null, state: 'current', kind: 'fact' }], preservedItemIds: [], references: [] },
    invalidMutations: [{ code: 'fixture_invalid_quote', mutate: (output) => { const copy = cloneOutput(output); copy.updates[0]!.citations[0]!.quote = '원문에 없는 내용'; return copy; } }],
  },
  {
    id: 'change-versus-history', request: request('fixture-case-change', [changeOld, changeProof, changeNew], [changeItem]), expectedOutput: changeOutput,
    expectations: { evidence: { materialIds: [changeNew.id] }, transitions: [{ itemId: 'item-plan', state: 'historical' }, { itemId: null, state: 'current' }], preservedItemIds: [], references: [] },
    invalidMutations: [{ code: 'fixture_invalid_quote', mutate: (output) => { const copy = cloneOutput(output); copy.updates[1]!.citations[0]!.materialId = 'missing-material'; return copy; } }],
  },
  {
    id: 'fulfilled-promise', request: request('fixture-case-promise', [promiseOld, promiseProof, promiseFulfilled], [promiseItem]), expectedOutput: promiseOutput,
    expectations: { evidence: { materialIds: [promiseFulfilled.id] }, transitions: [{ itemId: 'item-promise', state: 'current' }], preservedItemIds: [], references: [] },
    invalidMutations: [{ code: 'fixture_invalid_quote', mutate: (output) => { const copy = cloneOutput(output); copy.updates[0]!.citations[0]!.quote = '근거가 없는 이행'; return copy; } }],
  },
  {
    id: 'conflicting-evidence', request: request('fixture-case-conflict', [conflictA, conflictB]), expectedOutput: conflictOutput,
    expectations: { evidence: { materialIds: [conflictA.id, conflictB.id] }, transitions: [{ itemId: null, state: 'conflicting', kind: 'fact' }], preservedItemIds: [], references: [] },
    invalidMutations: [{ code: 'fixture_invalid_quote', mutate: (output) => { const copy = cloneOutput(output); copy.updates[0]!.citations[1]!.quote = '기록에 없는 내용'; return copy; } }],
  },
  {
    id: 'observation-distinct-sessions', request: request('fixture-case-observation', [observationA, observationB, observationRepeat]), expectedOutput: observationOutput,
    expectations: { evidence: { materialIds: [observationA.id, observationB.id] }, transitions: [{ itemId: null, state: 'current', kind: 'observation' }], preservedItemIds: [], references: [] },
    invalidMutations: [{ code: 'fixture_same_session_observation', mutate: (output) => { const copy = cloneOutput(output); copy.updates[0]!.citations[1] = { materialId: observationRepeat.id, quote: observationRepeat.maskedText }; return copy; } }],
  },
  {
    id: 'correction-preserved', request: request('fixture-case-correction', [correctionOld, correctionProof, correctionUnrelated], [correctionItem]), expectedOutput: correctionOutput,
    expectations: { evidence: { materialIds: [] }, transitions: [], preservedItemIds: ['item-corrected'], references: [] },
    invalidMutations: [{ code: 'fixture_old_correction_reversal', mutate: () => ({ updates: [{ key: 'reverse-correction', itemId: 'item-corrected', kind: 'fact', title: '운동 계획', body: correctionOld.maskedText, state: 'current', citations: [{ materialId: correctionOld.id, quote: correctionOld.maskedText }], references: [] }], summary: [] }) }],
  },
  {
    id: 'selective-omission-preserves', request: request('fixture-case-selective', [retainedSource, retainedProof, selectiveSource, selectiveProof], [retainedItem, selectiveItem]), expectedOutput: selectiveOutput,
    expectations: { evidence: { materialIds: [selectiveSource.id] }, transitions: [{ itemId: 'item-selective', state: 'current' }], preservedItemIds: ['item-retained'], references: [] },
    invalidMutations: [{ code: 'fixture_cross_source_reference', mutate: (output) => { const copy = cloneOutput(output); copy.updates[0]!.references = [{ kind: 'goal', id: 'goal-not-cited' }]; return copy; } }],
  },
  {
    id: 'current-goal-context', request: request('fixture-case-goal', [goalMaterial, goalSession]), expectedOutput: goalOutput,
    expectations: { evidence: { materialIds: [goalMaterial.id, goalSession.id] }, transitions: [{ itemId: null, state: 'current' }], preservedItemIds: [], references: [{ itemId: null, kind: 'goal', id: 'goal-weekly' }] },
    invalidMutations: [{ code: 'fixture_cross_source_reference', mutate: (output) => { const copy = cloneOutput(output); copy.updates[0]!.citations = [{ materialId: goalSession.id, quote: goalSession.maskedText }]; return copy; } }],
  },
];
