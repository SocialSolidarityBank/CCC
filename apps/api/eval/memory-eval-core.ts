import {
  validateMemoryGenerationOutput,
} from '@ccc/ai-runtime';
import { reconcileMemory } from '@ccc/core/counseling-memory';
import type {
  MemoryGenerationOutput,
  MemoryGenerationRequest,
  MemoryItemUpdate,
} from '@ccc/contracts/counseling-memory';
import type {
  MemoryEvalCase,
  MemoryEvalReferenceExpectation,
  MemoryEvalTransitionExpectation,
} from './memory-eval-cases';

/** Machine-checkable result codes; report output intentionally contains no prose. */
export type MemoryEvalCode =
  | 'safety_valid'
  | 'safety_output_invalid'
  | 'invalid_evidence_reference'
  | 'invalid_evidence_quote'
  | 'invalid_item_reference'
  | 'cross_source_reference'
  | 'same_session_observation'
  | 'evidence_coverage_incomplete'
  | 'state_transition_incomplete'
  | 'correction_not_preserved'
  | 'retained_item_not_preserved'
  | 'reference_expectation_incomplete'
  | 'deterministic_checks_valid'
  | 'deterministic_checks_incomplete'
  | 'semantic_quality_unmeasured';

export interface MemoryEvalOutcome {
  caseId: string;
  safety: {
    verdict: 'pass' | 'fail';
    codes: readonly MemoryEvalCode[];
  };
  deterministic: {
    verdict: 'pass' | 'fail';
    codes: readonly MemoryEvalCode[];
    evidenceCovered: number;
    evidenceRequired: number;
    transitionsCovered: number;
    transitionsRequired: number;
    preservedItems: number;
    preservedItemsRequired: number;
    referencesCovered: number;
    referencesRequired: number;
  };
  /** Semantic usefulness and wording remain a human-review question. */
  semanticQuality: {
    verdict: 'unmeasured';
    codes: readonly ['semantic_quality_unmeasured'];
  };
}

export interface MemoryEvalReport {
  totalCases: number;
  caseResults: readonly { caseId: string; codes: readonly MemoryEvalCode[] }[];
  codeCounts: Partial<Record<MemoryEvalCode, number>>;
  safety: { passed: number; failed: number };
  deterministic: { passed: number; failed: number };
  semanticQuality: { verdict: 'unmeasured'; cases: number };
}

type OutputRecord = Record<string, unknown>;

function outputUpdates(value: unknown): readonly OutputRecord[] {
  const candidate = typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as { updates?: unknown }
    : undefined;
  if (!Array.isArray(candidate?.updates)) return [];
  return candidate.updates.filter((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry)) as OutputRecord[];
}

function updateCitations(update: OutputRecord): readonly OutputRecord[] {
  const citations = update.citations;
  if (!Array.isArray(citations)) return [];
  return citations.filter((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry)) as OutputRecord[];
}

function updateReferences(update: OutputRecord): readonly OutputRecord[] {
  const references = update.references;
  if (!Array.isArray(references)) return [];
  return references.filter((entry) => typeof entry === 'object' && entry !== null && !Array.isArray(entry)) as OutputRecord[];
}

function structuralCodes(value: unknown, request: MemoryGenerationRequest): MemoryEvalCode[] {
  const codes: MemoryEvalCode[] = [];
  const materials = new Map(request.materials.map((material) => [material.id, material]));
  const existingIds = new Set(request.existingItems.map((item) => item.id));
  for (const update of outputUpdates(value)) {
    if (typeof update.itemId === 'string' && !existingIds.has(update.itemId)) codes.push('invalid_item_reference');
    const citedIds = new Set<string>();
    for (const citation of updateCitations(update)) {
      const materialId = typeof citation.materialId === 'string' ? citation.materialId : '';
      const quote = typeof citation.quote === 'string' ? citation.quote : '';
      const source = materials.get(materialId);
      if (!source) {
        codes.push('invalid_evidence_reference');
      } else {
        citedIds.add(materialId);
        if (!source.maskedText.includes(quote)) codes.push('invalid_evidence_quote');
      }
    }
    const previous = typeof update.itemId === 'string'
      ? request.existingItems.find((item) => item.id === update.itemId)
      : undefined;
    for (const reference of updateReferences(update)) {
      const kind = reference.kind;
      const id = reference.id;
      const preservesExistingReference = previous?.references.some((prior) => prior.kind === kind && prior.id === id) ?? false;
      const hasCitedSource = typeof id === 'string'
        && (kind === 'goal' || kind === 'action')
        && request.materials.some((material) => material.sourceKind === kind && material.sourceId === id && citedIds.has(material.id));
      if (!hasCitedSource && !preservesExistingReference) codes.push('cross_source_reference');
    }
    if (update.kind === 'observation') {
      const sessions = new Set(updateCitations(update).flatMap((citation) => {
        const material = materials.get(typeof citation.materialId === 'string' ? citation.materialId : '');
        return material?.sourceKind === 'session' && material.sessionId !== null ? [material.sessionId] : [];
      }));
      if (sessions.size < 2) codes.push('same_session_observation');
    }
  }
  return [...new Set(codes)];
}

function transitionMatches(update: MemoryItemUpdate, expected: MemoryEvalTransitionExpectation): boolean {
  if (update.itemId !== expected.itemId || update.state !== expected.state) return false;
  if (expected.kind !== undefined && update.kind !== expected.kind) return false;
  if (expected.materialIds?.some((id) => !update.citations.some((citation) => citation.materialId === id))) return false;
  return true;
}

function referenceMatches(update: MemoryItemUpdate, expected: MemoryEvalReferenceExpectation): boolean {
  return update.itemId === expected.itemId
    && update.references.some((reference) => reference.kind === expected.kind && reference.id === expected.id);
}

/**
 * Scores deterministic grounding and transition invariants. A passing validator
 * is only a safety result; semantic usefulness is deliberately never inferred.
 */
function protectedItemMatches(left: MemoryGenerationRequest['existingItems'][number], right: MemoryGenerationRequest['existingItems'][number]): boolean {
  return left.kind === right.kind
    && left.title === right.title
    && left.body === right.body
    && left.state === right.state
    && left.correctedAt === right.correctedAt
    && JSON.stringify(left.sources) === JSON.stringify(right.sources)
    && JSON.stringify(left.references) === JSON.stringify(right.references);
}

export function scoreMemoryEvalCase(case_: MemoryEvalCase, output: unknown): MemoryEvalOutcome {
  const safetyCodes = structuralCodes(output, case_.request);
  let validated: MemoryGenerationOutput | null = null;
  let reconciledItems = case_.request.existingItems;
  let coreValid = false;
  try {
    validated = validateMemoryGenerationOutput(output, case_.request);
    const usedIds = new Set(case_.request.existingItems.map(item => item.id));
    let sequence = 0;
    const nextId = () => {
      let id: string;
      do { id = `fixture-eval-created-${sequence++}`; } while (usedIds.has(id));
      usedIds.add(id);
      return id;
    };
    const reconciliation = reconcileMemory(case_.request, validated, nextId, '2026-09-08T00:00:00Z');
    reconciledItems = reconciliation.items;
    coreValid = true;
  } catch {
    safetyCodes.push('safety_output_invalid');
  }
  if (validated !== null && coreValid && safetyCodes.length === 0) safetyCodes.push('safety_valid');
  const uniqueSafetyCodes = [...new Set(safetyCodes)];
  const updates = validated?.updates ?? [];
  const expectedEvidence = case_.expectations.evidence.materialIds;
  const citedMaterialIds = new Set(updates.flatMap((update) => update.citations.map((citation) => citation.materialId)));
  const evidenceCovered = expectedEvidence.filter((id) => citedMaterialIds.has(id)).length;
  const transitions = case_.expectations.transitions;
  const transitionsCovered = transitions.filter((expected) => updates.some((update) => transitionMatches(update, expected))).length;
  const preservedItems = case_.expectations.preservedItemIds.filter((id) => {
    const before = case_.request.existingItems.find((item) => item.id === id);
    const after = reconciledItems.find((item) => item.id === id);
    return before !== undefined && after !== undefined && protectedItemMatches(before, after);
  }).length;
  const references = case_.expectations.references;
  const referencesCovered = references.filter((expected) => updates.some((update) => referenceMatches(update, expected))).length;

  const deterministicCodes: MemoryEvalCode[] = [];
  if (evidenceCovered < expectedEvidence.length) deterministicCodes.push('evidence_coverage_incomplete');
  if (transitionsCovered < transitions.length) deterministicCodes.push('state_transition_incomplete');
  if (preservedItems < case_.expectations.preservedItemIds.length) {
    deterministicCodes.push(case_.id === 'correction-preserved' ? 'correction_not_preserved' : 'retained_item_not_preserved');
  }
  if (referencesCovered < references.length) deterministicCodes.push('reference_expectation_incomplete');
  if (deterministicCodes.length === 0 && validated !== null && coreValid && uniqueSafetyCodes.length === 1 && uniqueSafetyCodes[0] === 'safety_valid') {
    deterministicCodes.push('deterministic_checks_valid');
  } else {
    deterministicCodes.push('deterministic_checks_incomplete');
  }

  const allSafetyCodes = [...new Set(uniqueSafetyCodes)];
  const allDeterministicCodes = [...new Set(deterministicCodes)];
  return {
    caseId: case_.id,
    safety: {
      verdict: validated !== null && coreValid && allSafetyCodes.includes('safety_valid') ? 'pass' : 'fail',
      codes: allSafetyCodes,
    },
    deterministic: {
      verdict: validated !== null && coreValid && deterministicCodes.length === 1 ? 'pass' : 'fail',
      codes: allDeterministicCodes,
      evidenceCovered,
      evidenceRequired: expectedEvidence.length,
      transitionsCovered,
      transitionsRequired: transitions.length,
      preservedItems,
      preservedItemsRequired: case_.expectations.preservedItemIds.length,
      referencesCovered,
      referencesRequired: references.length,
    },
    semanticQuality: { verdict: 'unmeasured', codes: ['semantic_quality_unmeasured'] },
  };
}

export function aggregateMemoryEvalOutcomes(outcomes: readonly MemoryEvalOutcome[]): MemoryEvalReport {
  const codeCounts: Partial<Record<MemoryEvalCode, number>> = {};
  for (const outcome of outcomes) {
    for (const code of [...outcome.safety.codes, ...outcome.deterministic.codes, ...outcome.semanticQuality.codes]) {
      codeCounts[code] = (codeCounts[code] ?? 0) + 1;
    }
  }
  return {
    totalCases: outcomes.length,
    caseResults: outcomes.map((outcome) => ({
      caseId: outcome.caseId,
      codes: [...new Set([...outcome.safety.codes, ...outcome.deterministic.codes, ...outcome.semanticQuality.codes])],
    })),
    codeCounts,
    safety: {
      passed: outcomes.filter((outcome) => outcome.safety.verdict === 'pass').length,
      failed: outcomes.filter((outcome) => outcome.safety.verdict === 'fail').length,
    },
    deterministic: {
      passed: outcomes.filter((outcome) => outcome.deterministic.verdict === 'pass').length,
      failed: outcomes.filter((outcome) => outcome.deterministic.verdict === 'fail').length,
    },
    semanticQuality: { verdict: 'unmeasured', cases: outcomes.length },
  };
}
