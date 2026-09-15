import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const pageApiMocks = vi.hoisted(() => ({
  getNewRecordContext: vi.fn(),
  getParticipantDetail: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('../../../../../../actions', () => ({
  closeGoalAction: vi.fn(),
  countGoalUpcomingLinksAction: vi.fn(),
  createCounselingRecordAction: vi.fn(),
  createGoalAction: vi.fn(),
  updateGoalTitleAction: vi.fn(),
}));
vi.mock('../../../../../../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  ...pageApiMocks,
  lifeAreaKeys: ['economy', 'housing', 'employment', 'health', 'mental_health', 'family'],
  lifeAreaStatuses: ['okay', 'strained', 'crisis', 'not_applicable', 'declined'],
}));

import * as pageModule from './page';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function recordForm(): FormData {
  const form = new FormData();
  form.set('beneficiaryId', 'swallow-003');
  form.set('supportCaseId', 'case-1');
  form.set('submissionId', '11111111-1111-4111-8111-111111111111');
  form.set('heldAt', '2026-09-16T10:00:00+09:00');
  form.set('channel', 'in_person');
  form.set('memo', '수기 상담 기록');
  for (let index = 0; index < 3; index += 1) {
    form.set(`actionDescription${index}`, '');
    form.set(`actionOwner${index}`, 'counselor');
    form.set(`actionDueDate${index}`, '');
  }
  for (const area of ['economy', 'housing', 'employment', 'health', 'mental_health', 'family']) {
    form.set(`lifeAreaStatus_${area}`, '');
    form.set(`lifeAreaNote_${area}`, '');
  }
  form.set('openActionItemId', 'action-1');
  form.set('openActionItemExpectedRevision_action-1', '7');
  form.set('resolutionStatus_action-1', 'done');
  form.set('resolutionNote_action-1', '');
  return form;
}

describe('buildRecordFormData action CAS', () => {
  it('선택한 액션 처리에 화면이 본 expectedRevision을 그대로 싣는다', () => {
    const candidate: unknown = pageModule;
    if (candidate === null || typeof candidate !== 'object' || !('buildRecordFormData' in candidate)) {
      expect(candidate).toHaveProperty('buildRecordFormData');
      return;
    }
    const build = candidate.buildRecordFormData;
    if (typeof build !== 'function') {
      expect(build).toBeTypeOf('function');
      return;
    }

    const output: unknown = build(recordForm());
    expect(output).toBeInstanceOf(FormData);
    if (!(output instanceof FormData)) return;
    const resolutions = output.get('actionResolutionsJson');
    expect(typeof resolutions).toBe('string');
    if (typeof resolutions !== 'string') return;
    expect(JSON.parse(resolutions)).toEqual([
      { actionItemId: 'action-1', status: 'done', expectedRevision: 7 },
    ]);
  });
});

describe('NewRecordPage action CAS fields', () => {
  it('화면이 받은 openActionItems revision을 같은 액션의 숨은 필드로 보존한다', async () => {
    pageApiMocks.getNewRecordContext.mockResolvedValueOnce({
      goals: [],
      schedules: [],
      openActionItems: [{
        id: 'action-1',
        description: '서류 제출',
        owner: 'beneficiary',
        dueDate: null,
        sourceHeldAt: '2026-09-15T01:00:00.000Z',
        revision: 7,
      }],
      latestLifeAreaSnapshot: [],
      sessionGoals: [],
      customQuestions: [],
      lastRecordSummary: null,
      nextSessionSequence: 2,
    });
    pageApiMocks.getParticipantDetail.mockResolvedValueOnce({ name: '홍서희' });

    const page = await pageModule.default({
      params: Promise.resolve({ beneficiaryId: 'swallow-003', supportCaseId: 'case-1' }),
      searchParams: Promise.resolve({}),
    });
    const view = render(page);
    const revision = view.container.querySelector(
      'input[name="openActionItemExpectedRevision_action-1"]',
    );
    expect(revision).toBeInstanceOf(HTMLInputElement);
    if (!(revision instanceof HTMLInputElement)) return;
    expect(revision.value).toBe('7');
  });
});
