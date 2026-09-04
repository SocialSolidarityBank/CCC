import { describe, expect, it } from 'vitest';

import {
  AiProviderInputError,
  validateAiDraftSummary,
  validateAiEvidenceIds,
} from '@ccc/ai-runtime';

/**
 * 이슈 #47 회귀 방지.
 *
 * 이 시스템이 발급하는 식별자는 정규 UUID 다. UUID 는 하이픈으로 끊긴 16진 그룹이라
 * 계좌·전화번호를 겨냥한 PII 패턴(`\d{2,6}-\d{2,6}-\d{2,8}`)에 우연히 걸렸고, 그 결과
 * API 가 자기가 발급한 ID 를 자기 검증기로 거부해 실무자의 초안 편집이 ~4.3% 확률로
 * 400 invalid_request 로 실패했다. CI 에서는 이것이 "간헐적으로 실패하는 테스트"로
 * 보였을 뿐, 실체는 제품 결함이었다.
 *
 * 아래 테스트는 두 방향을 함께 고정한다 — UUID 는 통과해야 하고(회귀 방지),
 * 진짜 PII 는 계속 막혀야 한다(R3 불변).
 */
describe('AI 근거 ID 검증 (이슈 #47)', () => {
  // 수정 전 실제로 거부됐던 UUID 들. 각 주석은 PII 패턴이 잡아채던 구간이다.
  const previouslyRejected = [
    '006ec309-6253-498c-8bfe-4dd22ddfe344', // 309-6253-498
    'e039075e-d8ab-4f83-8284-961a52f36520', // 83-8284-961
    'd7612b43-4982-484a-a8f7-e6fb2fc2bef6', // 43-4982-484
    'a71aed85-3924-45ec-b2ae-3df511f44a4d', // 85-3924-45
    'ac8abcfd-1b52-4905-951c-886e2476275b', // 52-4905-951
    '85ebbc84-3259-4369-96d2-2d09d630732d', // 84-3259-4369-96
    '082a3dd9-c866-4587-85fd-b4cf23a4dafc', // 결정론 재현에 쓰인 값
  ];

  it.each(previouslyRejected)('PII 패턴에 걸리던 UUID 를 받아들인다: %s', (id) => {
    expect(validateAiEvidenceIds([id])).toEqual([id]);
  });

  it('무작위 UUID 2만 개를 하나도 거부하지 않는다 (수정 전 ~4.3% 거부)', () => {
    const rejected: string[] = [];
    for (let i = 0; i < 20_000; i += 1) {
      const id = crypto.randomUUID();
      try {
        validateAiEvidenceIds([id]);
      } catch {
        rejected.push(id);
      }
    }
    expect(rejected).toEqual([]);
  });

  it('대문자 UUID 도 받아들인다 (형태만 정규면 된다)', () => {
    const upper = '006EC309-6253-498C-8BFE-4DD22DDFE344';
    expect(validateAiEvidenceIds([upper])).toEqual([upper]);
  });

  // --- R3 불변: 면제는 "정규 UUID 형태"에만 적용된다 ---

  it.each([
    ['계좌번호형', '110-234-567890'],
    ['전화번호형', '010-1234-5678'],
    ['주민번호형', '900101-1234567'],
    ['이메일형', 'hong@example.com'],
    ['UUID 를 닮았지만 길이가 다른 값', '006ec309-6253-498c-8bfe-4dd22ddfe3'],
    ['UUID 를 닮았지만 16진이 아닌 값', '006ec309-6253-498c-8bfe-4dd22ddfz344'],
    ['UUID 앞뒤에 다른 값이 붙은 것', 'x006ec309-6253-498c-8bfe-4dd22ddfe344'],
  ])('%s 은 계속 거부한다', (_label, value) => {
    expect(() => validateAiEvidenceIds([value])).toThrow(AiProviderInputError);
  });

  it('자유 텍스트의 PII 검사는 면제되지 않는다 (R3 — 면제 범위가 식별자에 한정됨을 고정)', () => {
    // 요약 본문에 계좌번호가 있으면 당연히 거부된다.
    expect(() => validateAiDraftSummary('계좌 110-234-567890 확인'))
      .toThrow(AiProviderInputError);

    // 그리고 **본문에 UUID 가 섞인 경우도 여전히 거부된다** — 이번 면제는 식별자 필드
    // (validateAiEvidenceIds 등)에만 적용되고 assertSafeText 는 손대지 않았기 때문이다.
    // 이 동작은 수정 전과 같다. 요약 본문에 내부 식별자를 실을 일이 없으므로 그대로 둔다.
    expect(() => validateAiDraftSummary('근거 006ec309-6253-498c-8bfe-4dd22ddfe344 를 확인했다.'))
      .toThrow(AiProviderInputError);
  });
});
