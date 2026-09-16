import { beforeEach, describe, expect, it, vi } from 'vitest';

const createCounselingRecord = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((destination: string) => {
  throw Object.assign(new Error(`NEXT_REDIRECT:${destination}`), { digest: 'NEXT_REDIRECT' });
});

class MockApiError extends Error {
  constructor(readonly code: string) { super(code); }
}

vi.mock('./lib/api', () => ({
  PREVIEW_COOKIE_NAME: 'ccc-preview',
  requestPreviewUnlock: vi.fn(),
  ApiError: MockApiError,
  addSupportCaseAssignee: vi.fn(),
  closeGoal: vi.fn(),
  closeSupportCase: vi.fn(),
  createCounselingRecord: (...args: unknown[]) => createCounselingRecord(...args),
  createGoal: vi.fn(),
  createIntakeRecord: vi.fn(),
  getGoalUpcomingLinkCount: vi.fn(),
  updateGoalTitle: vi.fn(),
  updateIntakeRecord: vi.fn(),
  goalCloseReasons: ['achieved', 'stopped', 'reset'],
  intakeAnswerKeys: [],
  intakeAnswerResponses: [],
  completeOrganizationOnboarding: vi.fn(),
  createCounselingSchedule: vi.fn(),
  createInitialParticipantProgram: vi.fn(),
  createParticipantInvite: vi.fn(),
  getPublicInviteInfo: vi.fn(),
  signupParticipant: vi.fn(),
  createStaffInvite: vi.fn(),
  acceptStaffInvite: vi.fn(),
  createSubsequentParticipantProgram: vi.fn(),
  editAiDraft: vi.fn(),
  generateAiDraft: vi.fn(),
  getMyIdentity: vi.fn(),
  getParticipantBriefing: vi.fn(),
  getSession: vi.fn(),
  getParticipantProgram: vi.fn(),
  listGoals: vi.fn(),
  listProgramOptions: vi.fn(),
  recordPilotTextAiConsent: vi.fn(),
  registerCounselor: vi.fn(),
  reviewAiDraft: vi.fn(),
  updateParticipantConsent: vi.fn(),
  updateParticipantBasicInfo: vi.fn(),
  updateProgramAdmission: vi.fn(),
  updateScheduleSessionGoals: vi.fn(),
  updateSupportCaseOverallGoal: vi.fn(),
  resolveDiscrepancy: vi.fn(),
  actionItemResolutionStatuses: ['done', 'in_progress', 'not_done', 'hold'],
  lifeAreaKeys: ['economy', 'housing', 'employment', 'health', 'mental_health', 'family'],
  lifeAreaStatuses: ['okay', 'strained', 'crisis', 'not_applicable', 'declined'],
}));
vi.mock('./lib/supabase-auth', () => ({
  signInWithPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
  signInOrSignUpWithPassword: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (destination: string) => redirect(destination) }));

const { createCounselingRecordAction } = await import('./actions');

const BENEFICIARY_ID = 'swallow-003';
const SUPPORT_CASE_ID = '11111111-1111-4111-8111-111111111111';
const SUBMISSION_ID = '22222222-2222-4222-8222-222222222222';
const ACTION_ITEM_ID = 'action-001';

function form(entries: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set('beneficiaryId', BENEFICIARY_ID);
  formData.set('supportCaseId', SUPPORT_CASE_ID);
  formData.set('submissionId', SUBMISSION_ID);
  formData.set('heldAt', '2026-09-16T16:30');
  formData.set('channel', 'in_person');
  formData.set('memo', '가상 상담 메모');
  formData.set('gasScoresJson', '[]');
  formData.set('actionItemsJson', '[]');
  formData.set('flagsJson', '[]');
  formData.set('actionResolutionsJson', '[]');
  formData.set('lifeAreasJson', '[]');
  formData.set('detailsJson', '');
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

function sentBody(): Record<string, unknown> {
  expect(createCounselingRecord).toHaveBeenCalledTimes(1);
  const [caseId, body] = createCounselingRecord.mock.calls[0] as [string, Record<string, unknown>];
  expect(caseId).toBe(SUPPORT_CASE_ID);
  return body;
}

beforeEach(() => {
  createCounselingRecord.mockReset();
  createCounselingRecord.mockResolvedValue({ record: { id: 's-1' }, replayed: false });
  revalidatePath.mockReset();
  redirect.mockClear();
});

describe('createCounselingRecordAction', () => {
  it('manual-record v2 봉투로 보낸다 — schemaVersion 2 와 v2 필드 이름만 실린다', async () => {
    const result = await createCounselingRecordAction(form({
      actionItemsJson: JSON.stringify([{ description: '다음까지 할 일', owner: 'beneficiary', dueDate: '2026-09-20' }]),
      flagsJson: JSON.stringify([{ flagType: 'crisis_utterance' }]),
      detailsJson: JSON.stringify({ counselorOpinion: '가상 의견' }),
    }));

    expect(result).toEqual({ status: 'saved' });
    const body = sentBody();
    expect(body.schemaVersion).toBe(2);
    expect(body.submissionId).toBe(SUBMISSION_ID);
    expect(typeof body.heldAt).toBe('string');
    expect((body.heldAt as string).endsWith('Z')).toBe(true);
    expect(body.channel).toBe('in_person');
    expect(body.memo).toBe('가상 상담 메모');
    expect(body.actionItems).toEqual([{ description: '다음까지 할 일', owner: 'beneficiary', dueDate: '2026-09-20' }]);
    expect(body.flags).toEqual([{ flagType: 'crisis_utterance' }]);
    expect(body.gasScores).toEqual([]);
    expect(body.actionOutcomes).toEqual([]);
    expect(body.counselorOpinion).toBe('가상 의견');
    // v1 전용 키가 섞이면 parser 가 전체를 거부한다 — 하나도 없어야 한다.
    for (const legacy of ['actions', 'actionResolutions', 'lifeAreas', 'details']) {
      expect(body).not.toHaveProperty(legacy);
    }
  });

  it('미해결 액션 처리는 화면이 본 revision 을 expectedRevision 으로 싣는다', async () => {
    await createCounselingRecordAction(form({
      actionResolutionsJson: JSON.stringify([
        { actionItemId: ACTION_ITEM_ID, status: 'done', expectedRevision: 3 },
        { actionItemId: 'action-002', status: 'not_done', expectedRevision: 1 },
      ]),
    }));

    expect(sentBody().actionOutcomes).toEqual([
      { actionItemId: ACTION_ITEM_ID, expectedRevision: 3, outcome: 'done' },
      { actionItemId: 'action-002', expectedRevision: 1, outcome: 'not_done', continuation: 'continue' },
    ]);
  });

  it('expectedRevision 없는 처리 선택은 저장하지 않고 invalid_request 로 멈춘다', async () => {
    const result = await createCounselingRecordAction(form({
      actionResolutionsJson: JSON.stringify([{ actionItemId: ACTION_ITEM_ID, status: 'done' }]),
    }));

    expect(result).toEqual({ status: 'invalid_request' });
    expect(createCounselingRecord).not.toHaveBeenCalled();
  });

  it('v2 에 대응 항목이 없는 입력은 조용히 버리지 않고 invalid_request 로 멈춘다', async () => {
    // hold 상태와 처리 메모는 v2 계약에 자리가 없다.
    const held = await createCounselingRecordAction(form({
      actionResolutionsJson: JSON.stringify([{ actionItemId: ACTION_ITEM_ID, status: 'hold', expectedRevision: 1 }]),
    }));
    expect(held).toEqual({ status: 'invalid_request' });

    const noted = await createCounselingRecordAction(form({
      actionResolutionsJson: JSON.stringify([{ actionItemId: ACTION_ITEM_ID, status: 'done', expectedRevision: 1, note: '메모' }]),
    }));
    expect(noted).toEqual({ status: 'invalid_request' });

    // sessionGoalNote·changeSinceLast·safetyNote 는 v2 details 에 없다.
    const detail = await createCounselingRecordAction(form({
      detailsJson: JSON.stringify({ safetyNote: '안전 확인 내용' }),
    }));
    expect(detail).toEqual({ status: 'invalid_request' });

    // 6영역 상태 선택은 v2 changes(자유 텍스트)로 옮길 수 없다.
    const areas = await createCounselingRecordAction(form({
      lifeAreasJson: JSON.stringify([{ areaKey: 'economy', changed: true, status: 'strained' }]),
    }));
    expect(areas).toEqual({ status: 'invalid_request' });

    expect(createCounselingRecord).not.toHaveBeenCalled();
  });
});
