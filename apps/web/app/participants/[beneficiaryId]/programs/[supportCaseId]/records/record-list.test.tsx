import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RecordList } from './record-list';
import type { SupportCaseRecord } from '../../../../../lib/api';

const wireStylesSource = readFileSync(
  resolve(process.cwd(), 'app/components/wire/wire-styles.ts'),
  'utf8',
);
const layoutSource = readFileSync(resolve(process.cwd(), 'app/layout.tsx'), 'utf8');

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
    managerOpinion: null,
    gasScores: [],
    actionItems: [],
    flags: [],
    lifeAreaSnapshot: [],
    kind: 'regular',
    createdAt: '2026-07-28T07:12:00.000Z',
    aiOneLiner: null,
    memoExcerpt: '주거 계약 연장 구두 합의',
    sessionGoals: [],
    discrepancies: [],
    ...overrides,
  };
}

function renderList(records: SupportCaseRecord[], errorIds: string[] = []) {
  return render(<RecordList
    records={records}
    recordErrorSessionIds={new Set(errorIds)}
    unavailable={false}
    recordsHref="/participants/swallow-003/programs/case-1/records"
    briefingHref="/participants/swallow-003/programs/case-1/briefing"
  />);
}

describe('RecordList', () => {
  it('펼친 회차의 유형 배지는 색 면과 글자를 접근 가능한 deep 색으로 반전한다', () => {
    // 2026-08-28 채움 전면 적용으로 :not(.briefing-card) 제외가 사라지고 카드 아코디언과
    // 셀렉터를 나눠 갖는다 — 규칙 머리만 고정하고 짝 셀렉터는 [^{]* 로 넘긴다.
    expect(wireStylesSource).toMatch(
      /details\.surface-card\[open\]>\.record-summary \.wire-badge\[data-tone="mint"\],[^{]*\{[^}]*background:var\(--on-badge\);color:var\(--mint-deep\)/,
    );
    expect(wireStylesSource).toMatch(
      /details\.surface-card\[open\]>\.record-summary \.wire-badge\[data-tone="lavender"\],[^{]*\{[^}]*background:var\(--on-badge\);color:var\(--lavender-deep\)/,
    );
    // '수기' 같은 톤 없는 배지도 채운 면 위에서 선다(2026-08-28 Q 버그 수정).
    expect(wireStylesSource).toMatch(
      /details\.surface-card\[open\]>\.record-summary \.wire-badge:not\(\[data-tone\]\),[^{]*\{[^}]*--wire-outline-color:var\(--line-on-action\);color:var\(--on-action\)/,
    );
  });

  it('좁은 회차 카드는 핵심 한 줄을 두 번째 행에 최대 두 줄로 둔다', () => {
    expect(layoutSource).toMatch(
      /\.record-list\{[^}]*container-type:inline-size/,
    );
    expect(layoutSource).toMatch(
      /@container \(max-width:600px\)\{[\s\S]*?\.record-one-liner\.wire-fade-clip\{[^}]*flex:1 0 100%;[^}]*white-space:normal;[^}]*-webkit-line-clamp:2/,
    );
    expect(layoutSource).not.toMatch(
      /\.record-one-liner\.wire-fade-clip\{[^}]*color:/,
    );
  });

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
    const kinds = Array.from(container.querySelectorAll('.record-summary')).map((summary) => {
      const badge = summary.querySelector('.wire-badge');
      return [badge?.textContent, badge?.getAttribute('data-tone')];
    });
    expect(kinds).toEqual([
      ['기본 상담', 'mint'],
      ['기본 상담', 'mint'],
      ['인테이크', 'lavender'],
    ]);
  });

  it('승인된 핵심 한 줄이 있으면 그대로 쓰고 수기 배지를 달지 않는다 (§4)', () => {
    const { container } = renderList([record({ aiOneLiner: '주거 계약 연장이 확인됐다' })]);

    const line = container.querySelector('.record-one-liner');
    expect(line?.textContent).toBe('주거 계약 연장이 확인됐다');
    expect(line?.className).not.toContain('is-memo');
    // 배지만 본다 — 본문에는 '수기 메모' 소제목이 언제나 있으므로 전체 텍스트로 재면 안 된다.
    expect(container.querySelector('.record-summary .wire-badge:not([data-tone])')).toBeNull();
  });

  it('승인 전이면 수기 발췌로 낮추고 수기 배지를 단다 (D5 폴백 · §4)', () => {
    const { container } = renderList([record({ aiOneLiner: null, memoExcerpt: '집을 알아봐야 한다' })]);

    const line = container.querySelector('.record-one-liner');
    expect(line?.textContent).toBe('집을 알아봐야 한다');
    expect(line?.className).toContain('is-memo');
    expect(container.querySelector('.record-summary .wire-badge:not([data-tone])')?.textContent).toBe('수기');
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
        { id: 'f1', flagType: 'housing_livelihood_shock', source: 'counselor', reviewStatus: 'confirmed', quote: null },
        { id: 'f2', flagType: 'debt_deterioration', source: 'ai', reviewStatus: 'rejected', quote: null },
      ],
    })]);

    const flags = Array.from(container.querySelectorAll('.record-flag'));
    const confirmed = flags.filter((node) => node.getAttribute('data-confirmed') === 'true');
    const plain = flags.filter((node) => node.getAttribute('data-confirmed') === 'false');
    // D73 '이 회차에서 나온 것'에는 확인된 플래그만 보인다.
    expect(confirmed).toHaveLength(2);
    expect(plain).toHaveLength(0);
    expect(container.textContent).not.toContain('부채 악화');
  });

  it('확인된 플래그가 없으면 접힌 줄에 리스크 표시가 없다 (§5)', () => {
    const { container } = renderList([record({
      flags: [{ id: 'f1', flagType: 'debt_deterioration', source: 'ai', reviewStatus: 'pending', quote: null }],
    })]);

    expect(container.querySelector('.record-summary .record-flag')).toBeNull();
  });

  it("펼친 카드의 '이 회차에서 나온 것'에 승인 한 줄, 확인 플래그, 관련 불일치를 모은다 (D73)", () => {
    const { container } = renderList([record({
      id: 'session-1',
      aiOneLiner: '상환 계획을 세우기로 했다.',
      flags: [{
        id: 'flag-1',
        flagType: 'debt_deterioration',
        source: 'ai',
        reviewStatus: 'confirmed',
        quote: '이자를 석 달째 내지 못했다.',
      }],
      discrepancies: [{
        id: 'discrepancy-1',
        kind: 'cross_session',
        leftSessionId: 'session-1',
        rightSessionId: 'session-2',
        resolutionStatus: null,
      }],
    })]);

    const section = [...container.querySelectorAll('.wire-card-section')]
      .find((candidate) => candidate.querySelector('h3')?.textContent === '이 회차에서 나온 것');
    expect(section).not.toBeUndefined();
    expect(section?.textContent).toContain('상환 계획을 세우기로 했다.');
    expect(section?.textContent).toContain('부채 악화');
    expect(section?.textContent).toContain('회차 간 불일치');
    const hrefs = [...(section?.querySelectorAll('a') ?? [])].map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('/participants/swallow-003/programs/case-1/briefing#discrepancy-discrepancy-1');
    expect(hrefs).toContain('#record-session-1');
    const quote = section?.querySelector('details[data-source-quotes]');
    expect(quote?.hasAttribute('open')).toBe(false);
    expect(quote?.textContent).toContain('이자를 석 달째 내지 못했다.');
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

  it('담당 실무자 의견은 값이 있을 때만 보인다 (CCC-11)', () => {
    const { container } = renderList([record({ managerOpinion: '상담 계속 진행. 주거 문제 우선' })]);
    const opinion = container.querySelector('.record-manager-opinion');
    expect(opinion).not.toBeNull();
    expect(opinion?.textContent).toContain('상담 계속 진행. 주거 문제 우선');
  });

  it('담당 실무자 의견이 없으면 블록을 그리지 않는다 (CCC-11)', () => {
    const { container } = renderList([record({ managerOpinion: null })]);
    expect(container.querySelector('.record-manager-opinion')).toBeNull();
  });

  it('생활 6영역 스냅샷은 라벨·상태·메모를 함께 보인다 (CCC-11)', () => {
    const { container } = renderList([record({
      lifeAreaSnapshot: [
        { areaKey: 'economy', status: 'strained', note: '월세 두 달 밀림' },
        { areaKey: 'housing', status: 'crisis', note: null },
      ],
    })]);
    const section = container.querySelector('.record-life-areas');
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain('경제·생계');
    expect(section?.textContent).toContain('긴장');
    expect(section?.textContent).toContain('월세 두 달 밀림');
    expect(section?.textContent).toContain('주거');
    expect(section?.textContent).toContain('위기');
  });

  it('생활 6영역 스냅샷이 없으면 블록을 그리지 않는다 (CCC-11)', () => {
    const { container } = renderList([record({ lifeAreaSnapshot: [] })]);
    expect(container.querySelector('.record-life-areas')).toBeNull();
  });
});
