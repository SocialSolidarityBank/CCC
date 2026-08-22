import { describe, expect, it } from 'vitest';

import {
  AI_DRAFT_PROMPT_VERSION,
  AI_DRAFT_SCHEMA_VERSION,
  AiProviderProhibitedOutputError,
  validateAiProviderOutput,
  validateAiProviderRequest,
} from '../src/ai-provider';

const TRANSCRIPT = '당사자는 이자를 석 달째 못 냈고 가족이 지원금을 가져간다고 말했다.';
const TEXT_CONTEXT = [
  '[회기 목표] 이자 연체 상황 확인하기',
  '수기 메모: 다음 회차에 상환 계획을 다시 확인하기로 했다.',
].join('\n');

function requestWithTranscript() {
  return validateAiProviderRequest({
    materials: [
      {
        kind: 'transcript',
        sourceRef: 'snapshot-transcript-v4',
        maskedText: TRANSCRIPT,
        evidence: [{
          evidenceId: 'evidence-transcript-v4',
          sourceRef: 'transcript-span-v4',
          sourceSha256: 'a'.repeat(64),
          evidenceQuote: TRANSCRIPT,
          sourceStart: 0,
          sourceEnd: Array.from(TRANSCRIPT).length,
        }],
      },
      {
        kind: 'text_context',
        sourceRef: 'snapshot-text-v4',
        maskedText: TEXT_CONTEXT,
        evidence: [{
          evidenceId: 'evidence-text-v4',
          sourceRef: 'text-span-v4',
          sourceSha256: 'b'.repeat(64),
          evidenceQuote: TEXT_CONTEXT,
          sourceStart: 0,
          sourceEnd: Array.from(TEXT_CONTEXT).length,
        }],
      },
    ],
    contrastAxes: {
      missing_from_memo: 'applied',
      missing_from_transcript: 'applied',
      undiscussed_session_goal: 'applied',
    },
  });
}

function validOutput() {
  const request = requestWithTranscript();
  const evidence = request.materials.flatMap((material) => material.evidence);
  return {
    request,
    output: {
      claims: [
        {
          claimKey: 'goal-debt',
          section: 'session_goal_discussion',
          text: '이자 연체 상황을 확인했다.',
          evidence: [evidence[0]],
        },
        {
          claimKey: 'commitment-recheck',
          section: 'next_session_commitments',
          text: '다음 회차에 상환 계획을 다시 확인하기로 했다.',
          evidence: [evidence[1]],
        },
      ],
      questions: [
        {
          title: '상환 계획 확인',
          reason: '구체적인 상환 계획이 아직 정해지지 않았습니다.',
          evidence: [evidence[0]],
        },
        {
          title: '지원금 사용 확인',
          reason: '지원금이 당사자 의사와 다르게 사용되는지 확인이 필요합니다.',
          evidence: [evidence[0]],
        },
      ],
      oneLiner: '이자 연체와 지원금 사용 문제를 확인했다.',
      contrast: {
        missing_from_memo: [],
        missing_from_transcript: [],
        undiscussed_session_goal: [],
      },
      flagSuggestions: [
        {
          type: 'debt_deterioration',
          sourceRef: 'snapshot-transcript-v4',
          quote: '이자를 석 달째 못 냈고',
        },
        {
          type: 'violence_exploitation',
          sourceRef: 'snapshot-transcript-v4',
          quote: '가족이 지원금을 가져간다고',
        },
      ],
    },
  };
}

describe('호출 ① v4 요약 구획과 리스크 플래그 제안 (D70, D72)', () => {
  it('프롬프트와 스키마 버전이 v4 로 올라간다', () => {
    expect(AI_DRAFT_PROMPT_VERSION).toBe('phase1.grounded.v4');
    expect(AI_DRAFT_SCHEMA_VERSION).toBe('phase1.grounded-draft.v4');
  });

  it('구획 라벨과 전사 인용 플래그 제안을 검증한다', () => {
    const { request, output } = validOutput();
    const validated = validateAiProviderOutput(output, request);

    expect(validated.claims.map((claim) => claim.section)).toEqual([
      'session_goal_discussion',
      'next_session_commitments',
    ]);
    expect(validated.flagSuggestions.map((flag) => flag.type)).toEqual([
      'debt_deterioration',
      'violence_exploitation',
    ]);
  });

  it('정해진 세 구획 밖의 라벨은 거부한다', () => {
    const { request, output } = validOutput();
    const claim = output.claims[0]!;
    output.claims[0] = { ...claim, section: 'previous_session_change' };

    expect(() => validateAiProviderOutput(output, request))
      .toThrow(AiProviderProhibitedOutputError);
  });

  it('확정 6종 밖의 플래그 유형은 거부한다', () => {
    const { request, output } = validOutput();
    const suggestion = output.flagSuggestions[0]!;
    output.flagSuggestions[0] = { ...suggestion, type: 'addiction' };

    expect(() => validateAiProviderOutput(output, request))
      .toThrow(AiProviderProhibitedOutputError);
  });

  it('플래그 인용이 전사 원문에 없거나 메모를 가리키면 거부한다', () => {
    const { request, output } = validOutput();
    const suggestion = output.flagSuggestions[0]!;
    output.flagSuggestions[0] = {
      ...suggestion,
      sourceRef: 'snapshot-text-v4',
      quote: '상환 계획을 다시 확인하기로 했다.',
    };

    expect(() => validateAiProviderOutput(output, request))
      .toThrow(AiProviderProhibitedOutputError);
  });

  it('전사 재료가 없는 회차는 플래그 제안을 허용하지 않는다', () => {
    const { request: withTranscript, output } = validOutput();
    const textMaterial = withTranscript.materials[1];
    if (textMaterial === undefined) throw new Error('text material is required');
    const request = validateAiProviderRequest({
      materials: [textMaterial],
      contrastAxes: {
        missing_from_memo: 'no_transcript',
        missing_from_transcript: 'no_transcript',
        undiscussed_session_goal: 'applied',
      },
    });
    output.claims = output.claims.map((claim) => ({
      ...claim,
      evidence: [textMaterial.evidence[0]],
    }));
    output.questions = output.questions.map((question) => ({
      ...question,
      evidence: [textMaterial.evidence[0]],
    }));

    expect(() => validateAiProviderOutput(output, request))
      .toThrow(AiProviderProhibitedOutputError);
  });
});
