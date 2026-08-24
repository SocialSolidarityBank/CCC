import { describe, it, expect, afterEach } from 'vitest';
import { render, within, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { SessionPlanEditor } from './session-plan-editor';
import { draftKey, readDraft, writeDraft, type FieldValues } from '../../../lib/form-draft';
import type { UpdateSessionGoalsActionInput, UpdateSessionGoalsActionResult } from '../../../actions';

// 세션 목표 수정 화면 (D62 §6 · CCC-70 · CCC-75 개편). 잠금·연결 규칙의 정본은 API 테스트
// (apps/api/test/schedules-session-plan.test.ts), 임시본 공통 규칙(배너 보호·uncertain 판정)의
// 정본은 record-draft.test 다. 여기는 화면 배선만 고정한다: 초기값·선택지 렌더, 제출 페이로드
// (빈 연결은 null), 저장 후 version 갈아타기, 실패 안내, 제목 줄 저장 버튼, 접이식 카드 구조,
// 이 화면 고유의 임시본 배선(칸 이름·카드 수 복원·저장 성공 시 삭제).
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const SCHEDULE_ID = '33333333-3333-4333-8333-333333333333';
const GOAL_ID = '44444444-4444-4444-8444-444444444444';
const KEY = draftKey('session-plan', SCHEDULE_ID);

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
        scheduledAtLabel="2026년 8월 20일 오후 2:00"
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
    const savedStatus = scoped.getAllByRole('status')
      .find((node) => node.textContent?.includes('저장했습니다'));
    expect(savedStatus).not.toBeUndefined();
    expect(savedStatus?.getAttribute('data-tone')).toBeNull();
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

describe('SessionPlanEditor 화면 골격 (CCC-75)', () => {
  it('저장은 페이지 제목 줄 오른쪽이고 폼 밖에서 form 속성으로 잇는다', () => {
    const { container } = renderEditor();

    const header = container.querySelector('.page-header');
    expect(header).not.toBeNull();
    expect(header?.querySelector('h1')?.textContent).toBe('세션 목표 수정');

    const button = header?.querySelector('.page-actions button[type="submit"]') as HTMLButtonElement;
    expect(button.textContent).toContain('저장');
    expect(button.getAttribute('form')).toBe('session-plan-form');
    // 버튼은 폼 바깥 제목 줄에 서 있어도 같은 폼을 제출해야 한다.
    expect(button.form).toBe(container.querySelector('form#session-plan-form'));
    // 자동 저장 상태는 저장 버튼 옆 상시 표시다.
    expect(header?.querySelector('[data-testid="draft-status"]')).not.toBeNull();
  });

  it('목표 한 묶음은 기본 펼침 접이식 카드이고 본문은 2열이다', () => {
    const { container } = renderEditor({
      initialGoals: [
        { body: '첫 계획', caseGoalId: GOAL_ID },
        { body: '둘째 계획', caseGoalId: '' },
      ],
    });

    const cards = container.querySelectorAll('details.wire-card-details');
    expect(cards.length).toBe(2);
    for (const card of Array.from(cards)) {
      expect((card as HTMLDetailsElement).open).toBe(true);
      // 카드 안 본문 간격 20 은 .wire-form-card 가 갖는다(§3-4).
      expect(card.classList.contains('wire-form-card')).toBe(true);
      // 기본 전부 펼침이라 제목 줄 활성 채움에서 제외된다(브리핑 3영역과 같은 이유).
      expect(card.classList.contains('session-plan-card')).toBe(true);
      expect(card.querySelector('.wire-card-body .wire-form-grid')).not.toBeNull();
    }
    const titles = Array.from(cards).map((card) => card.querySelector('.wire-card-title')?.textContent);
    expect(titles).toEqual(['세션 목표 1', '세션 목표 2']);
    // 구 720 제한 래퍼는 쓰지 않는다 — 카드가 본문 폭을 가득 쓴다(CCC-75).
    expect(container.querySelector('.wizard-row')).toBeNull();
  });
});

describe('SessionPlanEditor 임시본 (CCC-75)', () => {
  it('입력하면 이 일정의 키로 자동 저장하고 상태를 표시한다', async () => {
    const { container, getByTestId } = renderEditor();
    expect(getByTestId('draft-status').textContent).toBe('자동 저장 대기');

    fireEvent.change(container.querySelector('textarea[name="sessionGoalBody"]') as HTMLTextAreaElement, {
      target: { value: '다듬는 중인 계획' },
    });

    await waitFor(() => {
      expect(readDraft<FieldValues>(KEY)?.values['sessionGoalBody#0']).toBe('다듬는 중인 계획');
    }, { timeout: 3000 });
    expect(getByTestId('draft-status').textContent).toContain('자동 저장됨');
  });

  it('이어쓰기는 임시본의 묶음 수까지 되돌린다 — 카드가 모자라면 늘려서 채운다', async () => {
    writeDraft<FieldValues>(KEY, {
      'sessionGoalBody#0': '끊기기 전 첫 계획',
      'sessionGoalCase#0': GOAL_ID,
      'sessionGoalBody#1': '끊기기 전 둘째 계획',
    }, 'editing');

    const { container, getByTestId, getByRole } = renderEditor({
      initialGoals: [{ body: '서버에 있던 계획', caseGoalId: '' }],
    });
    expect(getByTestId('draft-restore-prompt')).not.toBeNull();
    // 고르기 전에는 아무것도 덮어쓰지 않는다.
    expect((container.querySelector('textarea[name="sessionGoalBody"]') as HTMLTextAreaElement).value)
      .toBe('서버에 있던 계획');

    fireEvent.click(getByRole('button', { name: '이어쓰기' }));

    await waitFor(() => {
      const bodies = Array.from(
        container.querySelectorAll<HTMLTextAreaElement>('textarea[name="sessionGoalBody"]'),
      ).map((node) => node.value);
      expect(bodies).toEqual(['끊기기 전 첫 계획', '끊기기 전 둘째 계획']);
    });
    const links = Array.from(
      container.querySelectorAll<HTMLSelectElement>('select[name="sessionGoalCase"]'),
    ).map((node) => node.value);
    expect(links).toEqual([GOAL_ID, '']);
  });

  it('저장에 성공하면 임시본을 즉시 지운다', async () => {
    const { container, inputs } = renderEditor();
    const scoped = within(container);

    fireEvent.change(container.querySelector('textarea[name="sessionGoalBody"]') as HTMLTextAreaElement, {
      target: { value: '저장할 계획' },
    });
    await waitFor(() => {
      expect(readDraft<FieldValues>(KEY)).not.toBeNull();
    }, { timeout: 3000 });

    fireEvent.click(scoped.getByRole('button', { name: /저장/ }));
    await waitFor(() => expect(inputs.length).toBe(1));
    expect(readDraft(KEY)).toBeNull();
  });
});
