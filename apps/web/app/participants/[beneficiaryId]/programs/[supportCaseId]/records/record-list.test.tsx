import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { RecordList } from './record-list';
import type { SupportCaseRecord } from '../../../../../lib/api';

// D47 · ADR-0019 — 상담 기록 회차 목록. 고정하는 것은 네 가지다:
//  ① 최신 1개만 펼침 + 나머지는 접힘 (§1)
//  ② GAS 가 있던 자리의 세션 목표, 재료 없으면 블록 자체가 없음 (§2)
//  ③ 회차 번호는 오름차순 표시값, 인테이크가 1회차 (§4)
//  ④ 리스크 레드는 확인된 플래그에만, 배너는 없음 (§5)
// 파일이 끝난 뒤 jsdom 이 내려가는 동안 React 가 남은 작업을 돌면 `window is not defined`
// 로 종료코드가 1 이 된다(테스트는 다 통과해도). vitest.config 에 globals 가 없어
// 자동 정리가 안 걸리므로 파일마다 이 한 줄이 필요하다.
afterEach(cleanup);

function record(overrides: Partial<SupportCaseRecord> = {}): SupportCaseRecord {
  return {
    id: 'session-1',
    heldAt: '2026-07-28T05:00:00.000Z',
    channel: 'in_person',
    memo: '주거 계약 연장 구두 합의',
    gasScores: [],
    actionItems: [],
    flags: [],
    lifeAreaSnapshot: [],
    kind: 'regular',
    createdAt: '2026-07-28T07:12:00.000Z',
    aiOneLiner: null,
    memoExcerpt: '주거 계약 연장 구두 합의',
    sessionGoals: [],
    ...overrides,
  };
}

function renderList(records: SupportCaseRecord[], errorIds: string[] = []) {
  return render(<RecordList
    records={records}
    recordErrorSessionIds={new Set(errorIds)}
    unavailable={false}
  />);
}

describe('RecordList', () => {
  it('최신 1개만 펼치고 나머지는 접어 둔다 (§1)', () => {
    const { container } = renderList([
      record({ id: 'latest', heldAt: '2026-07-28T05:00:00.000Z' }),
      record({ id: 'older', heldAt: '2026-07-14T05:00:00.000Z' }),
      record({ id: 'oldest', heldAt: '2026-06-02T05:00:00.000Z', kind: 'intake' }),
    ]);

    const cards = Array.from(container.querySelectorAll('details'));
    expect(cards.map((card) => card.open)).toEqual([true, false, false]);
  });

  it('브리핑 앵커가 찾을 id 를 회차마다 단다 (§1)', () => {
    // 이 id 가 바뀌면 브리핑의 '기록 보기'·AI 제안 근거 링크가 조용히 끊긴다.
    const { container } = renderList([record({ id: 'session-abc' })]);
    expect(container.querySelector('#record-session-abc')).not.toBeNull();
  });

  it('회차 번호를 오름차순으로 매기고 인테이크를 1회차로 둔다 (§4)', () => {
    const { container } = renderList([
      record({ id: 'a', heldAt: '2026-07-28T05:00:00.000Z' }),
      record({ id: 'b', heldAt: '2026-07-14T05:00:00.000Z' }),
      record({ id: 'c', heldAt: '2026-06-02T05:00:00.000Z', kind: 'intake' }),
    ]);

    const ordinals = Array.from(container.querySelectorAll('.record-ordinal')).map((node) => node.textContent);
    expect(ordinals).toEqual(['3회차', '2회차', '1회차']);
    const kinds = Array.from(container.querySelectorAll('.record-kind')).map((node) => node.textContent);
    expect(kinds).toEqual(['기본 상담', '기본 상담', '인테이크']);
  });

  it('승인된 핵심 한 줄이 있으면 그대로 쓰고 수기 배지를 달지 않는다 (§4)', () => {
    const { container } = renderList([record({ aiOneLiner: '주거 계약 연장이 확인됐다' })]);

    const line = container.querySelector('.record-one-liner');
    expect(line?.textContent).toBe('주거 계약 연장이 확인됐다');
    expect(line?.className).not.toContain('is-memo');
    // 배지만 본다 — 본문에는 '수기 메모' 소제목이 언제나 있으므로 전체 텍스트로 재면 안 된다.
    expect(container.querySelector('.record-summary .briefing-badge')).toBeNull();
  });

  it('승인 전이면 수기 발췌로 낮추고 수기 배지를 단다 (D5 폴백 · §4)', () => {
    const { container } = renderList([record({ aiOneLiner: null, memoExcerpt: '집을 알아봐야 한다' })]);

    const line = container.querySelector('.record-one-liner');
    expect(line?.textContent).toBe('집을 알아봐야 한다');
    expect(line?.className).toContain('is-memo');
    expect(container.querySelector('.record-summary .briefing-badge')?.textContent).toBe('수기');
  });

  it('세션 목표가 있으면 GAS 가 있던 자리에 그린다 (§2)', () => {
    const { container } = renderList([record({ sessionGoals: ['주거 계약 연장 여부 확인'] })]);

    const block = container.querySelector('.record-session-goal');
    expect(block?.textContent).toContain('이번 상담의 목표');
    expect(block?.textContent).toContain('주거 계약 연장 여부 확인');
  });

  it('세션 목표가 없으면 블록 자체를 그리지 않는다 (§2)', () => {
    // 빈 블록을 두면 GAS 를 뺀 자리가 다시 빈칸으로 보인다.
    const { container } = renderList([record({ sessionGoals: [] })]);
    expect(container.querySelector('.record-session-goal')).toBeNull();
  });

  it('보류된 GAS 점수를 회차 카드에 표시하지 않는다 (D43 이행 · R1)', () => {
    const { container } = renderList([record({
      gasScores: [{ goalId: 'goal-1', goalTitle: '월세 체납 해소', score: 1 }],
    })]);

    expect(container.textContent).not.toContain('GAS');
    expect(container.textContent).not.toContain('월세 체납 해소');
  });

  it('리스크 레드는 확인된 플래그에만 쓴다 (§5 · D9)', () => {
    const { container } = renderList([record({
      flags: [
        { id: 'f1', flagType: 'housing_livelihood_shock', source: 'counselor', reviewStatus: 'confirmed' },
        { id: 'f2', flagType: 'debt_deterioration', source: 'ai', reviewStatus: 'rejected' },
      ],
    })]);

    const flags = Array.from(container.querySelectorAll('.record-flag'));
    const confirmed = flags.filter((node) => node.getAttribute('data-confirmed') === 'true');
    const plain = flags.filter((node) => node.getAttribute('data-confirmed') === 'false');
    // 확인된 것: 접힌 줄의 '⚠ 리스크' 표시 + 본문 항목 = 2곳. 제외됨은 무채색 1곳뿐이다.
    expect(confirmed).toHaveLength(2);
    expect(plain).toHaveLength(1);
    expect(plain[0]?.textContent).toContain('부채 악화');
    // AI 가 제안한 플래그는 출처 칩으로만 표시한다(라벤더 축).
    expect(container.querySelector('.record-ai-source')?.textContent).toBe('AI 제안');
  });

  it('확인된 플래그가 없으면 접힌 줄에 리스크 표시가 없다 (§5)', () => {
    const { container } = renderList([record({
      flags: [{ id: 'f1', flagType: 'debt_deterioration', source: 'ai', reviewStatus: 'pending' }],
    })]);

    expect(container.querySelector('.record-summary .record-flag')).toBeNull();
  });

  it("'기록 오류'로 처리된 회차에 표시만 붙이고 본문은 원본 그대로 둔다 (CCC-42)", () => {
    const { container } = renderList([record({ id: 'session-1', memo: '원본 메모' })], ['session-1']);

    expect(container.textContent).toContain('기록 오류');
    expect(container.textContent).toContain('원본 메모');
  });

  it('기록이 없으면 빈 상태를 보여준다', () => {
    const { container } = renderList([]);
    expect(container.textContent).toContain('아직 상담 기록이 없습니다');
    expect(container.querySelector('details')).toBeNull();
  });
});
