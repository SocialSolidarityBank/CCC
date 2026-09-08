import { describe, expect, it } from 'vitest';
import { validateMemoryGenerationOutput } from '@ccc/ai-runtime';
import {
  MEMORY_EVAL_CASES,
  type MemoryEvalCase,
} from '../eval/memory-eval-cases';
import {
  aggregateMemoryEvalOutcomes,
  scoreMemoryEvalCase,
  type MemoryEvalOutcome,
} from '../eval/memory-eval-core';

function caseById(id: string): MemoryEvalCase {
  const found = MEMORY_EVAL_CASES.find((case_) => case_.id === id);
  if (!found) throw new Error(`missing fixture: ${id}`);
  return found;
}

describe('counseling memory evaluation corpus', () => {

  it('includes deterministic invalid fixtures for evidence, references, session boundaries and corrections', () => {
    const mutationCodes = new Set<string>();
    for (const case_ of MEMORY_EVAL_CASES) {
      expect(case_.invalidMutations.length, case_.id).toBeGreaterThan(0);
      for (const mutation of case_.invalidMutations) {
        mutationCodes.add(mutation.code);
        const output = mutation.mutate(case_.expectedOutput);
        expect(() => validateMemoryGenerationOutput(output, case_.request), `${case_.id}:${mutation.code}`).toThrow();
      }
    }
    expect(mutationCodes).toEqual(new Set([
      'fixture_invalid_quote',
      'fixture_cross_source_reference',
      'fixture_same_session_observation',
      'fixture_old_correction_reversal',
    ]));
  });
});

describe('counseling memory deterministic evaluation', () => {
  it.each([
    { historicalFirst: true, summaryKey: 'past', verdict: 'fail' },
    { historicalFirst: false, summaryKey: 'spending-plan', verdict: 'pass' },
  ])('keeps distinct new item identities when summary references $summaryKey', ({ historicalFirst, summaryKey, verdict }) => {
    const case_ = caseById('initial-fact');
    const current = case_.expectedOutput.updates[0]!;
    const past = { ...current, key: 'past', state: 'historical' as const };
    const output = {
      updates: historicalFirst ? [past, current] : [current, past],
      summary: [{ text: '기록을 확인한다.', itemKeys: [summaryKey] }],
    };
    expect(scoreMemoryEvalCase(case_, output).safety.verdict).toBe(verdict);
  });
  it('passes safety and deterministic checks without claiming semantic quality', () => {
    const outcomes = MEMORY_EVAL_CASES.map((case_) => scoreMemoryEvalCase(case_, case_.expectedOutput));
    expect(outcomes.every((outcome) => outcome.safety.verdict === 'pass')).toBe(true);
    expect(outcomes.every((outcome) => outcome.deterministic.verdict === 'pass')).toBe(true);
    expect(outcomes.every((outcome) => outcome.semanticQuality.verdict === 'unmeasured')).toBe(true);
    expect(outcomes.every((outcome) => outcome.semanticQuality.codes.includes('semantic_quality_unmeasured'))).toBe(true);
  });

  it('does not reject paraphrased wording when evidence and state are unchanged', () => {
    const case_ = caseById('fulfilled-promise');
    const output = {
      updates: case_.expectedOutput.updates.map((update) => ({
        ...update,
        title: '서류 준비 기록',
        body: '서류가 준비되었다.',
        citations: update.citations.map((citation) => ({ ...citation })),
        references: update.references.map((reference) => ({ ...reference })),
      })),
      summary: [],
    };
    const outcome = scoreMemoryEvalCase(case_, output);
    expect(outcome.safety.verdict).toBe('pass');
    expect(outcome.deterministic.verdict).toBe('pass');
    const changedState = { ...output, updates: output.updates.map(update => ({ ...update, state: 'historical' as const })) };
    expect(scoreMemoryEvalCase(case_, changedState).deterministic.codes).toContain('state_transition_incomplete');
  });

  it('marks old human correction reversal unsafe and identifies cross-source references', () => {
    const correction = caseById('correction-preserved');
    const correctionMutation = correction.invalidMutations.find((mutation) => mutation.code === 'fixture_old_correction_reversal');
    expect(correctionMutation).toBeDefined();
    const correctionOutcome = scoreMemoryEvalCase(correction, correctionMutation!.mutate(correction.expectedOutput));
    expect(correctionOutcome.safety.verdict).toBe('fail');
    expect(correctionOutcome.safety.codes).toContain('safety_output_invalid');

    const goal = caseById('current-goal-context');
    const goalMutation = goal.invalidMutations.find((mutation) => mutation.code === 'fixture_cross_source_reference');
    expect(goalMutation).toBeDefined();
    const goalOutcome = scoreMemoryEvalCase(goal, goalMutation!.mutate(goal.expectedOutput));
    expect(goalOutcome.safety.codes).toContain('cross_source_reference');
    expect(goalOutcome.safety.codes).toContain('safety_output_invalid');
  });

  it('requires distinct original sessions for repeated observations', () => {
    const case_ = caseById('observation-distinct-sessions');
    const mutation = case_.invalidMutations.find((candidate) => candidate.code === 'fixture_same_session_observation');
    expect(mutation).toBeDefined();
    const outcome = scoreMemoryEvalCase(case_, mutation!.mutate(case_.expectedOutput));
    expect(outcome.safety.verdict).toBe('fail');
    expect(outcome.safety.codes).toContain('same_session_observation');
    expect(outcome.safety.codes).toContain('safety_output_invalid');
  });

  it('reports only case identifiers, codes and counts while preserving unmeasured status', () => {
    const outcomes: MemoryEvalOutcome[] = MEMORY_EVAL_CASES.map((case_) => scoreMemoryEvalCase(case_, case_.expectedOutput));
    const report = aggregateMemoryEvalOutcomes(outcomes);
    expect(report.totalCases).toBe(MEMORY_EVAL_CASES.length);
    expect(report.caseResults.every((result) => Object.keys(result).sort().join(',') === 'caseId,codes')).toBe(true);
    expect(report.caseResults.every((result) => result.codes.includes('semantic_quality_unmeasured'))).toBe(true);
    expect(report.safety).toEqual({ passed: 8, failed: 0 });
    expect(report.deterministic).toEqual({ passed: 8, failed: 0 });
    expect(report.semanticQuality).toEqual({ verdict: 'unmeasured', cases: 8 });
    expect(report.codeCounts.semantic_quality_unmeasured).toBe(8);
  });
});
