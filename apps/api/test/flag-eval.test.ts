import { describe, expect, it } from 'vitest';

import {
  AI_FLAG_TYPES,
  validateAiProviderOutput,
  validateAiProviderRequest,
  type AiProviderRequest,
} from '@ccc/ai-runtime';
import {
  FLAG_EVAL_CASES,
  buildFlagEvalRequest,
  type FlagEvalCase,
} from '../eval/flag-eval-cases';
import {
  FLAG_EVAL_TYPES,
  buildFlagEvalReport,
  evaluateFlagEvalCase,
  formatFlagEvalReport,
  parseFlagEvalArgs,
} from '../eval/flag-eval-core';

const SAFETY_FLAG_TYPES = new Set(['crisis_utterance', 'violence_exploitation']);

describe('리스크 플래그 평가 데이터셋 (CCC-130 · D72)', () => {
  it('정확히 30건 — 유형 6종 × (clear 2 · ambiguous 2 · trap 1)', () => {
    expect(FLAG_EVAL_TYPES).toEqual([...AI_FLAG_TYPES]);
    expect(FLAG_EVAL_CASES).toHaveLength(30);
    for (const flagType of AI_FLAG_TYPES) {
      const ofType = FLAG_EVAL_CASES.filter((case_) => case_.flagType === flagType);
      expect(ofType).toHaveLength(5);
      expect(ofType.filter((case_) => case_.category === 'clear')).toHaveLength(2);
      expect(ofType.filter((case_) => case_.category === 'ambiguous')).toHaveLength(2);
      expect(ofType.filter((case_) => case_.category === 'trap')).toHaveLength(1);
    }
  });

  it('기대 플래그는 안전 2종의 애매한 사례까지 제안한다', () => {
    for (const case_ of FLAG_EVAL_CASES) {
      const expectsFlag = case_.category === 'clear'
        || (case_.category === 'ambiguous' && SAFETY_FLAG_TYPES.has(case_.flagType));
      if (expectsFlag) {
        expect(case_.expectedFlagTypes).toEqual([case_.flagType]);
      } else {
        expect(case_.expectedFlagTypes).toEqual([]);
      }
    }
  });

  it('사례 id 는 유일하고 전사·메모는 비어 있지 않다', () => {
    const ids = FLAG_EVAL_CASES.map((case_) => case_.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const case_ of FLAG_EVAL_CASES) {
      expect(case_.transcript.trim().length).toBeGreaterThan(0);
      expect(case_.textContext.trim().length).toBeGreaterThan(0);
      expect(case_.note.trim().length).toBeGreaterThan(0);
    }
  });

  it('모든 사례의 요청이 validateAiProviderRequest 를 통과한다 (마스킹·근거 구간 포함)', () => {
    for (const case_ of FLAG_EVAL_CASES) {
      expect(() => validateAiProviderRequest(buildFlagEvalRequest(case_)), case_.id).not.toThrow();
    }
  });

  it('모든 사례가 전사 인용 플래그 제안을 실은 출력으로 검증을 통과한다', () => {
    // trap 사례도 검증은 통과한다 — 기대 판정(무플래그)은 평가기가 잡는 몫이다.
    for (const case_ of FLAG_EVAL_CASES) {
      const request = validateAiProviderRequest(buildFlagEvalRequest(case_));
      const output = validOutputWithFlag(request, case_.flagType);
      expect(() => validateAiProviderOutput(output, request), case_.id).not.toThrow();
    }
  });
});

describe('평가 점수 계산 (CCC-130 · D72)', () => {
  it('완벽한 예측 — 전 유형 precision·recall 1.00, 실패 0건', () => {
    const outcomes = FLAG_EVAL_CASES.map((case_) => evaluateFlagEvalCase(case_, case_.expectedFlagTypes));
    const report = buildFlagEvalReport(outcomes);
    expect(report.passed).toBe(true);
    expect(report.failedCaseIds).toEqual([]);
    expect(report.byType).toHaveLength(AI_FLAG_TYPES.length);
    for (const score of report.byType) {
      expect(score.precision).toBe(1);
      expect(score.recall).toBe(1);
      expect(score.truePositives).toBe(SAFETY_FLAG_TYPES.has(score.flagType) ? 4 : 2);
      expect(score.falsePositives).toBe(0);
      expect(score.falseNegatives).toBe(0);
    }
  });

  it('clear 사례를 빼먹으면 해당 유형 recall 이 내려가고 실패 id 로 잡힌다', () => {
    const outcomes = FLAG_EVAL_CASES.map((case_) =>
      evaluateFlagEvalCase(
        case_,
        case_.id === 'crisis-utterance-clear-1' ? [] : case_.expectedFlagTypes,
      ),
    );
    const report = buildFlagEvalReport(outcomes);
    const crisis = report.byType.find((score) => score.flagType === 'crisis_utterance');
    expect(crisis?.recall).toBe(0.75);
    expect(crisis?.falseNegatives).toBe(1);
    expect(crisis?.precision).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.failedCaseIds).toContain('crisis-utterance-clear-1');
    expect(report.failedCaseIds).not.toContain('crisis-utterance-clear-2');
  });

  it('trap 에 플래그를 예측하면 해당 유형 precision 이 내려가고 실패로 잡힌다', () => {
    const outcomes = FLAG_EVAL_CASES.map((case_) =>
      evaluateFlagEvalCase(
        case_,
        case_.id === 'debt-deterioration-trap-1' ? ['debt_deterioration'] : case_.expectedFlagTypes,
      ),
    );
    const report = buildFlagEvalReport(outcomes);
    const debt = report.byType.find((score) => score.flagType === 'debt_deterioration');
    expect(debt?.falsePositives).toBe(1);
    expect(debt?.precision).toBeCloseTo(2 / 3);
    expect(debt?.recall).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.failedCaseIds).toContain('debt-deterioration-trap-1');
  });

  it('ambiguous 사례에 플래그를 예측하면 오탐으로 집계된다', () => {
    const outcomes = FLAG_EVAL_CASES.map((case_) =>
      evaluateFlagEvalCase(
        case_,
        case_.id === 'contact-loss-risk-ambiguous-1' ? ['contact_loss_risk'] : case_.expectedFlagTypes,
      ),
    );
    const report = buildFlagEvalReport(outcomes);
    const contact = report.byType.find((score) => score.flagType === 'contact_loss_risk');
    expect(contact?.falsePositives).toBe(1);
    expect(contact?.precision).toBeCloseTo(2 / 3);
    expect(contact?.recall).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.failedCaseIds).toContain('contact-loss-risk-ambiguous-1');
  });

  it('호출·검증 오류 사례는 지표에서 제외되지만 실패로 남는다', () => {
    const outcomes = FLAG_EVAL_CASES.map((case_) =>
      case_.id === 'debt-deterioration-trap-1'
        ? evaluateFlagEvalCase(case_, [], '호출/검증 실패: AiProviderUnavailableError')
        : evaluateFlagEvalCase(case_, case_.expectedFlagTypes),
    );
    const report = buildFlagEvalReport(outcomes);
    const debt = report.byType.find((score) => score.flagType === 'debt_deterioration');
    expect(debt?.truePositives).toBe(2);
    expect(debt?.falsePositives).toBe(0);
    expect(debt?.precision).toBe(1);
    expect(debt?.recall).toBe(1);
    expect(report.passed).toBe(false);
    expect(report.failedCaseIds).toContain('debt-deterioration-trap-1');
  });

  it('예측이 전혀 없으면 precision 은 null, recall 은 0 으로 보고된다', () => {
    const outcomes = FLAG_EVAL_CASES.map((case_) => evaluateFlagEvalCase(case_, []));
    const report = buildFlagEvalReport(outcomes);
    expect(report.passed).toBe(false);
    expect(report.failedCaseIds).toHaveLength(16); // clear 12건 + 안전 2종 ambiguous 4건
    for (const score of report.byType) {
      expect(score.precision).toBeNull();
      expect(score.recall).toBe(0);
    }
  });

  it('실패 사유에 누락·초과 유형이 들어간다', () => {
    const outcome = evaluateFlagEvalCase(
      { id: 'probe', category: 'clear', flagType: 'crisis_utterance', expectedFlagTypes: ['crisis_utterance'] },
      ['violence_exploitation'],
    );
    expect(outcome.failed).toBe(true);
    expect(outcome.failureReason).toContain('crisis_utterance');
    expect(outcome.failureReason).toContain('violence_exploitation');
  });

  it('보고서에 유형별 정밀도·재현율과 실패 사례 id 가 들어간다', () => {
    const outcomes = FLAG_EVAL_CASES.map((case_) =>
      evaluateFlagEvalCase(
        case_,
        case_.id === 'crisis-utterance-clear-1' ? [] : case_.expectedFlagTypes,
      ),
    );
    const report = buildFlagEvalReport(outcomes);
    const text = formatFlagEvalReport(report, '테스트 어댑터');
    expect(text).toContain('crisis_utterance');
    expect(text).toContain('0.75');
    expect(text).toContain('crisis-utterance-clear-1');
    expect(text).toContain('결과: 실패');
  });

  it('보고서 비율 분모는 정밀도와 재현율 정의에 맞는다', () => {
    const outcomes = FLAG_EVAL_CASES.map((case_) => evaluateFlagEvalCase(case_, case_.expectedFlagTypes));
    const report = buildFlagEvalReport(outcomes);
    const text = formatFlagEvalReport(report, '테스트 어댑터');
    expect(text).toContain('1.00 (2/2)');
    expect(text).not.toContain('1.00 (2/0)');
  });
});

describe('평가 CLI 인자', () => {
  it('기본 실행, 미리보기, 도움말을 구분한다', () => {
    expect(parseFlagEvalArgs([])).toEqual({ kind: 'run', preview: false });
    expect(parseFlagEvalArgs(['--preview'])).toEqual({ kind: 'run', preview: true });
    expect(parseFlagEvalArgs(['--', '--preview'])).toEqual({ kind: 'run', preview: true });
    expect(parseFlagEvalArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseFlagEvalArgs(['--', '--help'])).toEqual({ kind: 'help' });
  });

  it('알 수 없는 인자를 거부한다', () => {
    expect(() => parseFlagEvalArgs(['--unknown'])).toThrow('unknown flag evaluation argument');
  });
});

/** 전사 첫 줄을 플래그 인용으로 실은, 검증을 통과하는 최소 출력을 만든다. */
function validOutputWithFlag(request: AiProviderRequest, flagType: FlagEvalCase['flagType']): unknown {
  const transcript = request.materials.find((material) => material.kind === 'transcript');
  const memo = request.materials.find((material) => material.kind === 'text_context');
  if (transcript === undefined || memo === undefined) throw new Error('materials are required');
  const transcriptEvidence = transcript.evidence[0];
  const memoEvidence = memo.evidence[0];
  if (transcriptEvidence === undefined || memoEvidence === undefined) throw new Error('evidence is required');
  return {
    claims: [
      {
        claimKey: 'eval-claim-1',
        section: 'other_topics',
        text: '상담에서 당사자의 상황을 확인했다.',
        evidence: [transcriptEvidence],
      },
    ],
    questions: [
      {
        title: '다음 회차 일정 확인',
        reason: '다음 회차 일정을 확인할 필요가 있다.',
        evidence: [transcriptEvidence],
      },
      {
        title: '상태 변화 확인',
        reason: '상태 변화를 확인할 필요가 있다.',
        evidence: [memoEvidence],
      },
    ],
    oneLiner: '당사자의 상황을 확인하고 다음 회차 일정을 논의했다.',
    contrast: {
      missing_from_memo: [],
      missing_from_transcript: [],
      undiscussed_session_goal: [],
    },
    flagSuggestions: [
      {
        type: flagType,
        sourceRef: transcript.sourceRef,
        quote: transcriptEvidence.evidenceQuote,
      },
    ],
  };
}
