import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { RecordOnepage, type RecordOnepageProps } from './record-onepage';

// CCC-10 정기 기록지 원페이지: 고정 헤더(이번 상담 목표·전체 목표 N), 우측 필수 채움 레일,
// 6영역 '위기' 선택 시 위기·안전 아코디언 자동 펼침+강조를 검증한다.

function props(overrides: Partial<RecordOnepageProps> = {}): RecordOnepageProps {
  return {
    schedules: [],
    openActionItems: [],
    latestLifeAreaSnapshot: [],
    sessionGoals: [],
    customQuestions: [],
    lastRecordSummary: null,
    briefingPath: '/participants/swallow-003/programs/case-1/briefing',
    actions: <><button type="button">상담 기록으로 돌아가기</button><button type="submit">저장</button></>,
    ...overrides,
  };
}

// vitest globals 를 쓰지 않는 설정이라 자동 정리가 걸리지 않는다. 한 파일에서 여러 번
// 렌더하므로 테스트마다 DOM 을 비운다(같은 testid 중복 방지).
afterEach(cleanup);

describe('RecordOnepage', () => {
  it('고정 헤더에 이번 상담 목표를 항상 표시한다', () => {
    const { container, getByTestId } = render(<RecordOnepage {...props({
      sessionGoals: [{ body: '임대차 계약 확인', caseGoalTitle: '월세 체납 해소' }],
    })} />);

    const header = getByTestId('record-sticky-header');
    expect(header.className).toContain('record-sticky');
    expect(header.textContent).toContain('이번 상담 목표');
    expect(header.textContent).toContain('임대차 계약 확인');
    // 일정에 세션 목표가 있으면 헤더에서 따로 입력받지 않는다.
    expect(container.querySelector('input[name="sessionGoalNote"]')).toBeNull();
  });

  // 2026-07-31 Q: 나가기·저장이 화면 양 끝에 흩어져 있던 것을 고정 헤더로 모았다.
  // 저장이 폼 아래에 하나도 남아 있지 않으므로, 이 자리가 비면 저장할 길이 사라진다.
  it('고정 헤더가 나가기·저장 버튼을 갖는다', () => {
    const { getByTestId } = render(<RecordOnepage {...props()} />);

    const header = getByTestId('record-sticky-header');
    expect(header.textContent).toContain('상담 기록으로 돌아가기');
    expect(header.querySelector('button[type="submit"]')?.textContent).toBe('저장');
  });

  it('세션 목표가 미연결이면 헤더에서 바로 이번 상담 목표를 추가할 수 있다', () => {
    const { container, getByTestId } = render(<RecordOnepage {...props()} />);

    expect(getByTestId('record-sticky-header').textContent).toContain('미연결');
    expect(container.querySelector('input[name="sessionGoalNote"]')).not.toBeNull();
  });

  it('우측 레일에 필수 채움 카운트를 표시하고 수기 메모를 채우면 올라간다', () => {
    const { container, getByTestId } = render(<RecordOnepage {...props()} />);

    // 미해결 액션 0건·6영역 기본값은 충족, 수기 메모만 남은 상태.
    expect(getByTestId('record-required-count').textContent).toBe('필수 2/3');

    const memo = container.querySelector('textarea[name="memo"]');
    expect(memo).not.toBeNull();
    fireEvent.change(memo as HTMLTextAreaElement, { target: { value: '오늘 상담 내용' } });
    expect(getByTestId('record-required-count').textContent).toBe('필수 3/3');
  });

  it('미해결 액션은 처리 상태를 고르기 전까지 필수 채움에서 빠진다', () => {
    const { container, getByTestId } = render(<RecordOnepage {...props({
      openActionItems: [{ id: 'action-1', description: '서류 제출', owner: 'beneficiary', dueDate: null }],
    })} />);

    expect(getByTestId('record-required-count').textContent).toBe('필수 1/3');
    const done = container.querySelector('input[name="resolutionStatus_action-1"][value="done"]');
    fireEvent.click(done as HTMLInputElement);
    expect(getByTestId('record-required-count').textContent).toBe('필수 2/3');
  });

  it("6영역에서 '위기'를 고르면 위기·안전 아코디언이 자동으로 펼쳐지고 강조된다", () => {
    const { container, getByTestId } = render(<RecordOnepage {...props()} />);

    const safety = getByTestId('safety-accordion') as HTMLDetailsElement;
    expect(safety.open).toBe(false);
    expect(safety.className).not.toContain('is-crisis');

    const economy = container.querySelector('select[name="lifeAreaStatus_economy"]');
    fireEvent.change(economy as HTMLSelectElement, { target: { value: 'crisis' } });

    expect(safety.open).toBe(true);
    expect(safety.className).toContain('is-crisis');
    expect(safety.textContent).toContain('확인 필요');
  });

  it("'위기'를 되돌리면 강조를 거두되 실무자가 연 상태는 유지한다", () => {
    const { container, getByTestId } = render(<RecordOnepage {...props()} />);
    const economy = container.querySelector('select[name="lifeAreaStatus_economy"]');
    fireEvent.change(economy as HTMLSelectElement, { target: { value: 'crisis' } });
    fireEvent.change(economy as HTMLSelectElement, { target: { value: 'okay' } });

    const safety = getByTestId('safety-accordion') as HTMLDetailsElement;
    expect(safety.className).not.toContain('is-crisis');
    expect(safety.open).toBe(true);
  });

  // D47 §6 · ADR-0019 — GAS 점수와 '목표 종료+신설'은 화면에서 내렸다. D43 이 보류한 것은
  // 'GAS 와 세부 목표 층' 둘 다인데 브리핑만 정리되고 이 화면에는 남아 있었다(UI 훑기 R1).
  // 이 테스트는 그것들이 조용히 되살아나는 것을 막는다 — 되살릴 때는 D43 해제가 먼저다.
  it('보류된 세부 목표 층 UI(GAS 점수·목표 종료+신설)를 어디에도 그리지 않는다', () => {
    const { container } = render(<RecordOnepage {...props()} />);

    expect(container.querySelector('select[name="gasScore"]')).toBeNull();
    expect(container.querySelector('select[name="closeGoalId"]')).toBeNull();
    expect(container.querySelector('input[name="goalClosedReason"]')).toBeNull();
    expect(container.querySelector('input[name="newGoalTitle"]')).toBeNull();
    // 라벨로도 남아 있으면 안 된다 — 입력칸만 지우고 제목이 남으면 기능이 있는 것처럼 읽힌다.
    expect(container.textContent).not.toContain('GAS');
    expect(container.textContent).not.toContain('목표 종료');
  });

  it('전체 열기/닫기가 아코디언을 일괄 조작하고 기본은 접힘이다 (CCC-24)', () => {
    const { container, getByText } = render(<RecordOnepage {...props()} />);
    const allDetails = () => Array.from(container.querySelectorAll('details'));

    // 기본은 접힘 — CCC-5 결정. 위기·안전 자동 펼침이 없는 상태에서는 전부 닫혀 있다.
    expect(allDetails().every((details) => !details.open)).toBe(true);

    fireEvent.click(getByText('전체 열기'));
    expect(allDetails().every((details) => details.open)).toBe(true);

    fireEvent.click(getByText('전체 접기'));
    expect(allDetails().every((details) => !details.open)).toBe(true);
  });

  it('위기 선택 중에는 전체 접기도 위기·안전 칸을 닫지 못한다 (CCC-24)', () => {
    const { container, getByText } = render(<RecordOnepage {...props()} />);

    // 6영역에서 '위기'를 골라 위기·안전 칸을 자동 펼친다.
    const economy = container.querySelector('select[name="lifeAreaStatus_economy"]');
    fireEvent.change(economy as HTMLSelectElement, { target: { value: 'crisis' } });
    const safety = container.querySelector('[data-testid="safety-accordion"]') as HTMLDetailsElement;
    expect(safety.open).toBe(true);

    // 전부 연 뒤 접어도 위기 칸은 열린 채로 남는다.
    fireEvent.click(getByText('전체 열기'));
    fireEvent.click(getByText('전체 접기'));
    expect(safety.open).toBe(true);
    // 위기 칸을 제외한 나머지는 접힌다.
    const others = Array.from(container.querySelectorAll('details')).filter((d) => d !== safety);
    expect(others.every((details) => !details.open)).toBe(true);
  });
});
