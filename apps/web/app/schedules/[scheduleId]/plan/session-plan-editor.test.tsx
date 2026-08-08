import { describe, it, expect, afterEach } from 'vitest';
import { render, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SessionPlanEditor } from './session-plan-editor';
import type { UpdateSessionGoalsActionInput, UpdateSessionGoalsActionResult } from '../../../actions';

// 세션 목표 수정 화면 (D62 §6 · CCC-70). 잠금·연결 규칙의 정본은 API 테스트
// (apps/api/test/schedules-session-plan.test.ts)다. 여기는 화면 배선만 고정한다:
// 초기값·선택지 렌더, 제출 페이로드(빈 연결은 null), 저장 후 version 갈아타기, 실패 안내.
afterEach(cleanup);

const SCHEDULE_ID = '33333333-3333-4333-8333-333333333333';
const GOAL_ID = '44444444-4444-4444-8444-444444444444';

function renderEditor(overrides: {
  result?: UpdateSessionGoalsActionResult;
  initialGoals?: Array<{ body: string; caseGoalId: string }>;
  goalOptions?: Array<{ id: string; title: string; closed: boolean }>;
} = {}) {
  const inputs: UpdateSessionGoalsActionInput[] = [];
  const submit = async (input: UpdateSessionGoalsActionInput): Promise<UpdateSessionGoalsActionResult> => {
    inputs.push(input);
    return overrides.result ?? { status: 'saved', version: input.expectedVersion + 1 };
  };
  return {
    inputs,
    ...render(
      <SessionPlanEditor
        scheduleId={SCHEDULE_ID}
        beneficiaryId="swallow-003"
        supportCaseId="11111111-1111-1111-8111-111111111111"
        version={1}
        initialGoals={overrides.initialGoals ?? [{ body: '처음 계획', caseGoalId: GOAL_ID }]}
        goalOptions={overrides.goalOptions ?? [{ id: GOAL_ID, title: '생활비 계획 유지', closed: false }]}
        submit={submit}
      />,
    ),
  };
}

describe('SessionPlanEditor (CCC-70)', () => {
  it('초기 목표·연결을 채워 렌더하고, 저장은 빈 연결을 null 로 보낸다', async () => {
    const { container, inputs } = renderEditor();
    const scoped = within(container);

    const body = scoped.getByLabelText('세션 목표 1') as HTMLTextAreaElement;
    expect(body.value).toBe('처음 계획');
    const link = scoped.getByLabelText('세부 목표 연결') as HTMLSelectElement;
    expect(link.value).toBe(GOAL_ID);

    fireEvent.change(body, { target: { value: '다듬은 계획' } });
    fireEvent.change(link, { target: { value: '' } });
    fireEvent.click(scoped.getByRole('button', { name: /저장/ }));

    await waitFor(() => expect(inputs.length).toBe(1));
    expect(inputs[0]).toMatchObject({
      scheduleId: SCHEDULE_ID,
      expectedVersion: 1,
      sessionGoals: [{ body: '다듬은 계획', caseGoalId: null }],
    });
    expect(scoped.getByRole('status').textContent).toContain('저장했습니다');
  });

  it('저장 성공 후 다음 저장은 서버가 돌려준 새 version 으로 제출한다', async () => {
    const { container, inputs } = renderEditor();
    const scoped = within(container);

    fireEvent.click(scoped.getByRole('button', { name: /저장/ }));
    await waitFor(() => expect(inputs.length).toBe(1));
    fireEvent.click(scoped.getByRole('button', { name: /저장/ }));
    await waitFor(() => expect(inputs.length).toBe(2));

    expect(inputs[0]?.expectedVersion).toBe(1);
    expect(inputs[1]?.expectedVersion).toBe(2);
  });

  it('충돌·잠금 실패는 안내 한 줄로 보여준다', async () => {
    const { container } = renderEditor({ result: { status: 'conflict' } });
    const scoped = within(container);

    fireEvent.click(scoped.getByRole('button', { name: /저장/ }));
    await waitFor(() => expect(scoped.getByRole('alert')).not.toBeNull());
    expect(scoped.getByRole('alert').textContent).toContain('다른 곳에서 일정이 먼저 바뀌었습니다');
  });

  it('종료된 세부 목표는 기존 연결일 때만 "(종료됨)" 표기로 남는다', () => {
    const closedId = '55555555-5555-4555-8555-555555555555';
    const { container } = renderEditor({
      initialGoals: [{ body: '옛 계획', caseGoalId: closedId }],
      goalOptions: [
        { id: GOAL_ID, title: '생활비 계획 유지', closed: false },
        { id: closedId, title: '옛 목표', closed: true },
      ],
    });
    const scoped = within(container);

    const link = scoped.getByLabelText('세부 목표 연결') as HTMLSelectElement;
    expect(link.value).toBe(closedId);
    const labels = Array.from(link.options).map((option) => option.textContent);
    expect(labels).toEqual(['연결 안 함', '생활비 계획 유지', '옛 목표 (종료됨)']);
  });
});
