import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { RecordOnepage, type RecordOnepageProps } from './record-onepage';

// CCC-10 정기 기록지 원페이지: 고정 헤더(이번 상담 목표·전체 목표 N), 우측 필수 채움 레일,
// 6영역 '위기' 선택 시 위기·안전 아코디언 자동 펼침+강조를 검증한다.

function props(overrides: Partial<RecordOnepageProps> = {}): RecordOnepageProps {
  return {
    goals: [
      { id: 'goal-1', title: '월세 체납 해소', status: 'active' },
      { id: 'goal-2', title: '건강 회복', status: 'active' },
      { id: 'goal-3', title: '지난 목표', status: 'closed' },
    ],
    schedules: [],
    openActionItems: [],
    latestLifeAreaSnapshot: [],
    sessionGoals: [],
    customQuestions: [],
    lastRecordSummary: null,
    briefingPath: '/participants/swallow-003/programs/case-1/briefing',
    ...overrides,
  };
}

// vitest globals 를 쓰지 않는 설정이라 자동 정리가 걸리지 않는다. 한 파일에서 여러 번
// 렌더하므로 테스트마다 DOM 을 비운다(같은 testid 중복 방지).
afterEach(cleanup);

describe('RecordOnepage', () => {
  it('고정 헤더에 이번 상담 목표와 전체 목표 N 을 항상 표시한다', () => {
    const { container, getByTestId } = render(<RecordOnepage {...props({
      sessionGoals: [{ body: '임대차 계약 확인', caseGoalTitle: '월세 체납 해소' }],
    })} />);

    const header = getByTestId('record-sticky-header');
    expect(header.className).toContain('record-sticky');
    expect(header.textContent).toContain('이번 상담 목표');
    expect(header.textContent).toContain('임대차 계약 확인');
    // 활성 목표만 센다(종료 목표 제외).
    expect(header.textContent).toContain('전체 목표 2');
    // 일정에 세션 목표가 있으면 헤더에서 따로 입력받지 않는다.
    expect(container.querySelector('input[name="sessionGoalNote"]')).toBeNull();
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

  it('목표 종료를 고르기 전에는 종료 사유·새 목표 입력이 잠겨 있다', () => {
    const { container } = render(<RecordOnepage {...props()} />);

    const reason = container.querySelector('input[name="goalClosedReason"]') as HTMLInputElement;
    const newTitle = container.querySelector('input[name="newGoalTitle"]') as HTMLInputElement;
    expect(reason.disabled).toBe(true);
    expect(newTitle.disabled).toBe(true);

    fireEvent.change(container.querySelector('select[name="closeGoalId"]') as HTMLSelectElement, {
      target: { value: 'goal-1' },
    });
    expect(reason.disabled).toBe(false);
    expect(reason.required).toBe(true);
    expect(newTitle.disabled).toBe(false);
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
