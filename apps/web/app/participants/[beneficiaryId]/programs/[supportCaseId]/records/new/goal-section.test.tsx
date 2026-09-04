import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FormEvent } from 'react';
import { GoalSection } from './goal-section';
import type { SupportCaseRecordGoal } from '../../../../../../lib/api';
import type { GoalActionResult } from '../../../../../../actions';

afterEach(cleanup);

// 세부 목표 구획(D62 · CCC-68). 액션은 가짜로 갈아 끼운다 — 이 테스트가 보는 것은
// 입력·수정·닫기의 화면 계약과 활성 상한 3개의 반영이다(상한 최종 강제는 게이트웨이).

const IDS = { beneficiaryId: 'swallow-003', supportCaseId: '11111111-1111-4111-8111-111111111111' };

function goal(id: string, title: string, overrides: Partial<SupportCaseRecordGoal> = {}): SupportCaseRecordGoal {
  return { id, title, status: 'active', closedReason: null, ...overrides };
}

/** '저장됨' 응답을 만드는 가짜 액션 — 입력의 goalId·title 을 그대로 되비춘다. */
function savedResult() {
  return async (input: Record<string, unknown>): Promise<GoalActionResult> => ({
    status: 'saved',
    goal: {
      id: (input.goalId ?? 'goal-new') as string,
      caseId: IDS.supportCaseId,
      title: (input.title ?? '제목') as string,
      status: 'active',
      closedAt: null,
      closedReason: null,
    },
  });
}

type GoalActionImpl = (input: Record<string, unknown>) => Promise<GoalActionResult>;

function renderSection(goals: SupportCaseRecordGoal[], impls: {
  create?: GoalActionImpl;
  rename?: GoalActionImpl;
  close?: GoalActionImpl;
} = {}) {
  const createAction = vi.fn(impls.create ?? savedResult());
  const renameAction = vi.fn(impls.rename ?? savedResult());
  const closeAction = vi.fn(impls.close ?? savedResult());
  const utils = render(
    <GoalSection
      beneficiaryId={IDS.beneficiaryId}
      supportCaseId={IDS.supportCaseId}
      goals={goals}
      createAction={createAction}
      renameAction={renameAction}
      closeAction={closeAction}
    />,
  );
  return { ...utils, createAction, renameAction, closeAction };
}

describe('GoalSection (D62 · CCC-68)', () => {
  it('활성 목표 목록과 활성 개수 배지, 수정·재설정 경계 도움말이 선다', () => {
    renderSection([goal('g1', '3개월 생활비 계획 지키기'), goal('g2', '채무조정 서류 준비')]);
    const section = screen.getByTestId('record-goal-section');
    expect(within(section).getByText('3개월 생활비 계획 지키기')).toBeTruthy();
    expect(section.textContent).toContain('활성 2/3');
    const heading = section.querySelector('.wire-card-title > .wire-card-head');
    expect(heading).not.toBeNull();
    expect(heading?.querySelector('h2')?.textContent).toBe('세부 목표');
    expect(heading?.querySelector('h2 .wire-badge')).toBeNull();
    expect(heading?.querySelector('h2')?.classList.contains('wire-title-with-badge')).toBe(false);
    expect(heading?.querySelector(':scope > .wire-badge')?.textContent).toBe('활성 2/3');
    const activeTitle = within(section).getByText('3개월 생활비 계획 지키기');
    expect(activeTitle.className).toContain('wire-field-value');
    expect(activeTitle.getAttribute('data-size')).toBe('sm');
    expect(activeTitle.closest('[data-testid="record-goal-row"]')?.classList.contains('wire-repeat-card')).toBe(true);
    // 경계 도움말(ADR-0032 §4): 수정 vs 재설정.
    expect(section.textContent).toContain('방향이 같고 표현만 다듬을 때는 수정하세요');
  });

  it('목표가 없으면 빈 상태와 입력칸이 선다', () => {
    renderSection([]);
    expect(screen.getByTestId('record-goal-empty')).toBeTruthy();
    expect(screen.getByLabelText('새 세부 목표')).toBeTruthy();
  });

  it('새 목표 추가는 입력 상자 밖 오른쪽의 아이콘 버튼으로 제공한다', () => {
    // 2026-09-04 Q "'+' 버튼은 Input Box 밖에 둘 것".
    renderSection([]);
    const input = screen.getByLabelText('새 세부 목표');
    const inputBox = input.closest('.wire-input-box');
    const add = screen.getByRole('button', { name: '목표 추가' });
    expect(inputBox?.contains(add)).toBe(false);
    expect(add.closest('.wire-field-with-action')).not.toBeNull();
    expect(inputBox?.closest('.wire-field-with-action')).toBe(add.closest('.wire-field-with-action'));
    expect(add.textContent).toBe('');
    expect(add.querySelector('svg')).not.toBeNull();
  });

  it('새 목표를 추가하면 액션이 불리고 목록·개수가 갱신된다', async () => {
    const { createAction } = renderSection([goal('g1', '기존 목표')]);
    fireEvent.change(screen.getByLabelText('새 세부 목표'), { target: { value: '  주 1회 가계부 기록  ' } });
    fireEvent.click(screen.getByRole('button', { name: '목표 추가' }));
    await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
    expect(createAction).toHaveBeenCalledWith({ ...IDS, title: '주 1회 가계부 기록' });
    await waitFor(() => expect(screen.getByText('주 1회 가계부 기록')).toBeTruthy());
    expect(screen.getByTestId('record-goal-section').textContent).toContain('활성 2/3');
  });

  it('활성 3개면 입력칸 대신 상한 안내가 선다 — 닫기 전에는 추가할 수 없다', () => {
    renderSection([goal('g1', '하나'), goal('g2', '둘'), goal('g3', '셋')]);
    expect(screen.queryByLabelText('새 세부 목표')).toBeNull();
    expect(screen.getByTestId('record-goal-cap').textContent).toContain('활성 세부 목표가 3개입니다');
  });

  it('수정을 누르면 현재 문구가 채워진 입력칸이 뜨고, 저장이 액션을 부른다', async () => {
    const { renameAction } = renderSection([goal('g1', '원래 문구')]);
    fireEvent.click(screen.getByRole('button', { name: '수정' }));
    const input = screen.getByLabelText('목표 문구 수정') as HTMLInputElement;
    expect(input.value).toBe('원래 문구');
    fireEvent.change(input, { target: { value: '다듬은 문구' } });
    fireEvent.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(renameAction).toHaveBeenCalledWith({ ...IDS, goalId: 'g1', title: '다듬은 문구' }));
    await waitFor(() => expect(screen.getByText('다듬은 문구')).toBeTruthy());
  });

  it('닫기는 사유 선택(한글 3종)을 거치고, 닫힌 목표는 사유 배지와 함께 접힌 목록으로 내려간다', async () => {
    const { closeAction } = renderSection([goal('g1', '닫을 목표'), goal('g2', '남을 목표')]);
    fireEvent.click(within(screen.getAllByTestId('record-goal-row')[0]!).getByRole('button', { name: '닫기' }));
    const select = screen.getByLabelText('닫는 사유') as HTMLSelectElement;
    // 저장 어휘는 영문 선택값, 화면은 한글이다(D62 §5).
    expect([...select.options].map((option) => option.textContent)).toEqual(['달성', '중단', '재설정']);
    // 재개 불가 안내(D62 §5 — 닫은 목표는 다시 열지 않는다).
    expect(screen.getByTestId('record-goal-section').textContent).toContain('닫은 목표는 다시 열 수 없습니다');
    fireEvent.change(select, { target: { value: 'reset' } });
    fireEvent.click(screen.getByRole('button', { name: '목표 닫기' }));
    await waitFor(() => expect(closeAction).toHaveBeenCalledWith({ ...IDS, goalId: 'g1', reason: 'reset' }));

    // 활성 목록에서 내려가고, 접힌 이력에 한글 사유 배지로 남는다.
    await waitFor(() => expect(screen.getByTestId('record-goal-closed').textContent).toContain('닫힌 목표 1건'));
    const historyChevron = screen.getByTestId('record-goal-closed').querySelector('.wire-disclosure-chevron');
    expect(historyChevron?.getAttribute('data-variant')).toBe('plain');
    expect(historyChevron?.classList.contains('wire-chevron-button')).toBe(false);
    expect(screen.getByTestId('record-goal-closed').textContent).toContain('재설정');
    expect(screen.getByTestId('record-goal-section').textContent).toContain('활성 1/3');
  });

  it('미래 회기가 연결된 목표의 닫기 패널에는 알림 한 줄이 뜬다 — 닫기는 막지 않는다', async () => {
    const upcomingLinksAction = vi.fn(async () => ({ status: 'ok' as const, upcomingCount: 2 }));
    const closeAction = vi.fn(savedResult());
    render(
      <GoalSection
        beneficiaryId={IDS.beneficiaryId}
        supportCaseId={IDS.supportCaseId}
        goals={[goal('g1', '미래 회기 연결 목표')]}
        createAction={vi.fn(savedResult())}
        renameAction={vi.fn(savedResult())}
        closeAction={closeAction}
        upcomingLinksAction={upcomingLinksAction}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    await waitFor(() => expect(upcomingLinksAction).toHaveBeenCalledWith({ ...IDS, goalId: 'g1' }));
    await waitFor(() => expect(screen.getByTestId('record-goal-upcoming').textContent)
      .toContain('아직 오지 않은 회기 2건'));
    // 알림일 뿐이다(D62 §5) — 닫기 버튼은 그대로 눌린다.
    fireEvent.click(screen.getByRole('button', { name: '목표 닫기' }));
    await waitFor(() => expect(closeAction).toHaveBeenCalledTimes(1));
  });

  it('액션이 실패하면 한 줄 안내가 뜨고 목록은 그대로다', async () => {
    renderSection([goal('g1', '기존 목표')], { create: async () => ({ status: 'validation_error' }) });
    fireEvent.change(screen.getByLabelText('새 세부 목표'), { target: { value: '네 번째 목표' } });
    fireEvent.click(screen.getByRole('button', { name: '목표 추가' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('저장하지 못했습니다'));
    expect(screen.getByTestId('record-goal-section').textContent).toContain('활성 1/3');
  });

  it('목표 저장 중에는 추가 버튼을 비활성으로 둔다', async () => {
    let resolveCreate: (result: GoalActionResult) => void = () => {};
    const create = () => new Promise<GoalActionResult>((resolve) => {
      resolveCreate = resolve;
    });
    renderSection([], { create });
    fireEvent.change(screen.getByLabelText('새 세부 목표'), { target: { value: '채무 서류 준비' } });
    const add = screen.getByRole('button', { name: '목표 추가' }) as HTMLButtonElement;

    fireEvent.click(add);
    await waitFor(() => expect(add.disabled).toBe(true));
    resolveCreate({ status: 'validation_error' });
    await waitFor(() => expect(add.disabled).toBe(false));
  });

  it('입력칸의 Enter 는 바깥 기록지 폼을 제출하지 않고 목표 추가를 부른다', async () => {
    const outerSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    const createAction = vi.fn(savedResult());
    render(
      <form onSubmit={outerSubmit}>
        <GoalSection
          beneficiaryId={IDS.beneficiaryId}
          supportCaseId={IDS.supportCaseId}
          goals={[]}
          createAction={createAction}
          renameAction={vi.fn(savedResult())}
          closeAction={vi.fn(savedResult())}
        />
      </form>,
    );
    const input = screen.getByLabelText('새 세부 목표');
    fireEvent.change(input, { target: { value: '엔터로 추가' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(createAction).toHaveBeenCalledTimes(1));
    expect(outerSubmit).not.toHaveBeenCalled();
  });
});
