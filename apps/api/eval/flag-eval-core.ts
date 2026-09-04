/**
 * 리스크 플래그 제안 평가 — 점수·보고 계산 (CCC-130 · D72).
 *
 * 순수 함수만 두는 모듈이다. 네트워크·파일·환경변수를 읽지 않아 결정적 테스트
 * (apps/api/test/flag-eval.test.ts)가 그대로 검증한다. 실제 호출 오케스트레이션은
 * apps/api/eval/run-flag-eval.ts 가 한다.
 *
 * 점수 규칙:
 * - clear 사례(기대 [유형])에 그 유형을 예측하면 true positive, 빼먹으면 false negative.
 * - ambiguous·trap 사례(기대 [])에 유형을 예측하면 false positive (오탐 — 정밀도 감점).
 * - 호출·검증 오류 사례는 지표에서 제외하되 실패로 남긴다 (모델이 무엇을 냈을지 알 수 없다).
 * - 사례 실패 = 예측 집합이 기대 집합과 정확히 다르거나 오류가 있는 경우.
 *   유형별 precision/recall 은 실패 사례 id 와 함께 보고되고, 실패가 하나라도 있으면
 *   평가 전체가 실패(0 아닌 종료 코드)다.
 */
import type { AiFlagType } from '@ccc/ai-runtime';
import type { FlagEvalCase, FlagEvalCategory } from './flag-eval-cases';

/** 평가가 다루는 플래그 유형 — ai-provider 의 AI_FLAG_TYPES 와 같아야 한다(테스트가 대조). */
export const FLAG_EVAL_TYPES: readonly AiFlagType[] = [
  'crisis_utterance',
  'contact_loss_risk',
  'housing_livelihood_shock',
  'debt_deterioration',
  'repeated_noncompliance',
  'violence_exploitation',
];

export type { FlagEvalCategory };

export interface FlagEvalCaseOutcome {
  caseId: string;
  category: FlagEvalCategory;
  flagType: AiFlagType;
  expectedFlagTypes: readonly AiFlagType[];
  predictedFlagTypes: readonly AiFlagType[];
  /** 호출·검증 오류 이름. 있으면 이 사례는 지표에서 빠지고 실패로만 남는다. */
  error: string | null;
  failed: boolean;
  /** 사람이 읽는 실패 사유 (없으면 null). */
  failureReason: string | null;
}

export interface FlagTypeScore {
  flagType: AiFlagType;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  /** TP/(TP+FP). 예측이 하나도 없으면 null. */
  precision: number | null;
  /** TP/(TP+FN). 기대가 하나도 없으면 null. */
  recall: number | null;
}

export interface FlagEvalReport {
  outcomes: readonly FlagEvalCaseOutcome[];
  byType: readonly FlagTypeScore[];
  failedCaseIds: readonly string[];
  passed: boolean;
}

export type FlagEvalArgs =
  | { kind: 'help' }
  | { kind: 'run'; preview: boolean };

export function parseFlagEvalArgs(args: readonly string[]): FlagEvalArgs {
  const normalized = args[0] === '--' ? args.slice(1) : args;
  if (normalized.length === 0) return { kind: 'run', preview: false };
  if (normalized.length === 1 && normalized[0] === '--preview') return { kind: 'run', preview: true };
  if (normalized.length === 1 && (normalized[0] === '--help' || normalized[0] === '-h')) return { kind: 'help' };
  throw new Error(`unknown flag evaluation argument: ${normalized.join(' ')}`);
}

function uniqueTypes(types: readonly AiFlagType[]): AiFlagType[] {
  return [...new Set(types)];
}

/**
 * 사례 하나의 예측을 기대와 견줘 실패 여부를 판정한다. 예측은 유형 목록
 * (플래그 제안의 type)이고 중복은 접어서 집합으로 본다.
 */
export function evaluateFlagEvalCase(
  case_: Pick<FlagEvalCase, 'id' | 'category' | 'flagType' | 'expectedFlagTypes'>,
  predictedFlagTypes: readonly AiFlagType[],
  error: string | null = null,
): FlagEvalCaseOutcome {
  const predicted = uniqueTypes(predictedFlagTypes);
  const expected = uniqueTypes(case_.expectedFlagTypes);
  if (error !== null) {
    return {
      caseId: case_.id,
      category: case_.category,
      flagType: case_.flagType,
      expectedFlagTypes: expected,
      predictedFlagTypes: predicted,
      error,
      failed: true,
      failureReason: error,
    };
  }
  const missing = expected.filter((type) => !predicted.includes(type));
  const extra = predicted.filter((type) => !expected.includes(type));
  const failed = missing.length > 0 || extra.length > 0;
  let failureReason: string | null = null;
  if (failed) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`기대 플래그 누락: ${missing.join(', ')}`);
    if (extra.length > 0) parts.push(`예상 밖 플래그: ${extra.join(', ')}`);
    failureReason = parts.join(' / ');
  }
  return {
    caseId: case_.id,
    category: case_.category,
    flagType: case_.flagType,
    expectedFlagTypes: expected,
    predictedFlagTypes: predicted,
    error: null,
    failed,
    failureReason,
  };
}

/** 사례 결과들을 유형별 precision/recall 과 실패 목록으로 모은다. */
export function buildFlagEvalReport(outcomes: readonly FlagEvalCaseOutcome[]): FlagEvalReport {
  const byType = FLAG_EVAL_TYPES.map((flagType) => {
    const relevant = outcomes.filter((outcome) => outcome.flagType === flagType && outcome.error === null);
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    for (const outcome of relevant) {
      const expected = new Set(outcome.expectedFlagTypes);
      const predicted = new Set(outcome.predictedFlagTypes);
      if (expected.has(flagType) && predicted.has(flagType)) truePositives += 1;
      else if (!expected.has(flagType) && predicted.has(flagType)) falsePositives += 1;
      else if (expected.has(flagType) && !predicted.has(flagType)) falseNegatives += 1;
    }
    return {
      flagType,
      truePositives,
      falsePositives,
      falseNegatives,
      precision: truePositives + falsePositives === 0 ? null : truePositives / (truePositives + falsePositives),
      recall: truePositives + falseNegatives === 0 ? null : truePositives / (truePositives + falseNegatives),
    };
  });
  const failedCaseIds = outcomes.filter((outcome) => outcome.failed).map((outcome) => outcome.caseId);
  return { outcomes, byType, failedCaseIds, passed: failedCaseIds.length === 0 };
}

function formatRatio(value: number | null, numerator: number, denominator: number): string {
  if (value === null) return '   -  ';
  return `${value.toFixed(2)} (${numerator}/${denominator})`;
}

/** 사람이 읽는 평가 보고서를 만든다. 한국어 문단 + 기계 판독 가능한 수치. */
export function formatFlagEvalReport(report: FlagEvalReport, adapterLabel: string): string {
  const lines: string[] = [];
  lines.push('리스크 플래그 제안 평가 (CCC-130 · D72)');
  lines.push(`어댑터: ${adapterLabel}`);
  lines.push(`사례: ${report.outcomes.length}건 (유형 6종 × clear 2 · ambiguous 2 · trap 1)`);
  lines.push('');
  lines.push('유형별 정밀도/재현율');
  lines.push('  유형                     precision (TP/(TP+FP))   recall (TP/(TP+FN))');
  for (const score of report.byType) {
    const name = score.flagType.padEnd(24);
    lines.push(
      `  ${name}  ${formatRatio(score.precision, score.truePositives, score.truePositives + score.falsePositives)}   ${formatRatio(score.recall, score.truePositives, score.truePositives + score.falseNegatives)}`,
    );
  }
  lines.push('');
  if (report.failedCaseIds.length === 0) {
    lines.push('실패 사례: 없음 — 모든 기대 판정이 일치했습니다.');
  } else {
    lines.push(`실패 사례 ${report.failedCaseIds.length}건:`);
    const byId = new Map(report.outcomes.map((outcome) => [outcome.caseId, outcome] as const));
    for (const caseId of report.failedCaseIds) {
      const outcome = byId.get(caseId);
      if (outcome === undefined) continue;
      const expected = outcome.expectedFlagTypes.length === 0 ? '(없음)' : outcome.expectedFlagTypes.join(', ');
      const predicted = outcome.predictedFlagTypes.length === 0 ? '(없음)' : outcome.predictedFlagTypes.join(', ');
      lines.push(`  - ${caseId} [${outcome.category}]`);
      lines.push(`      기대: ${expected} / 예측: ${predicted}`);
      if (outcome.failureReason !== null) lines.push(`      사유: ${outcome.failureReason}`);
    }
  }
  lines.push('');
  lines.push(report.passed ? '결과: 통과' : `결과: 실패 (${report.failedCaseIds.length}건) — 0 아닌 종료 코드`);
  return lines.join('\n');
}
