import { beforeEach, describe, expect, it, vi } from 'vitest';

// 케이스 종결 서버 액션 (CCC-107). actions.ts 는 lib/api 의 이름을 통째로 당기므로
// (server-only·next 런타임 의존) 값 export 전부를 목으로 세운다 — 이 테스트가 실제로
// 확인하는 것은 closeSupportCase 호출 계약과 성공·실패 리다이렉트뿐이다.
const closeSupportCase = vi.fn();
const revalidatePath = vi.fn();
const redirect = vi.fn((destination: string) => {
  // 실제 next redirect 처럼 흐름을 끊는다 — 액션의 catch 에 잡히지 않는 제어 흐름 오류다.
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
  closeSupportCase: (supportCaseId: string, reason: string) => closeSupportCase(supportCaseId, reason),
  createCounselingRecord: vi.fn(),
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
  createWorkerInvite: vi.fn(),
  signupWorker: vi.fn(),
  createSubsequentParticipantProgram: vi.fn(),
  editAiDraft: vi.fn(),
  generateAiDraft: vi.fn(),
  getMyIdentity: vi.fn(),
  getParticipantBriefing: vi.fn(),
  getSession: vi.fn(),
  getParticipantProgram: vi.fn(),
  listGoals: vi.fn(),
  recordPilotTextAiConsent: vi.fn(),
  registerCounselor: vi.fn(),
  reviewAiDraft: vi.fn(),
  updateParticipantConsent: vi.fn(),
  updateParticipantBasicInfo: vi.fn(),
  updateScheduleSessionGoals: vi.fn(),
  updateSupportCaseOverallGoal: vi.fn(),
  resolveDiscrepancy: vi.fn(),
  actionItemResolutionStatuses: ['done', 'in_progress', 'not_done', 'hold'],
  lifeAreaKeys: [],
  lifeAreaStatuses: [],
}));

vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (destination: string) => redirect(destination) }));

const { closeSupportCaseAction } = await import('./actions');

const BENEFICIARY_ID = 'swallow-003';
const SUPPORT_CASE_ID = '11111111-1111-4111-8111-111111111111';

function form(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

function validForm(): FormData {
  return form({
    beneficiaryId: BENEFICIARY_ID,
    supportCaseId: SUPPORT_CASE_ID,
    reason: '  지원 목표 달성으로 종결  ',
    confirmClose: 'on',
  });
}

beforeEach(() => {
  closeSupportCase.mockReset();
  revalidatePath.mockReset();
  redirect.mockClear();
});

describe('closeSupportCaseAction (CCC-107)', () => {
  it('사유를 다듬어 종결 API 를 부르고, 종결 화면으로 notice=case_closed 리다이렉트한다', async () => {
    closeSupportCase.mockResolvedValue({ id: SUPPORT_CASE_ID, status: 'closed', closedAt: '2026-08-20T00:00:00.000Z' });

    await expect(closeSupportCaseAction(validForm())).rejects.toThrow('NEXT_REDIRECT');

    expect(closeSupportCase).toHaveBeenCalledWith(SUPPORT_CASE_ID, '지원 목표 달성으로 종결');
    // 종결은 허브·브리핑·기록 화면의 상태를 바꾼다 — 캐시 갱신이 함께 간다.
    expect(revalidatePath).toHaveBeenCalledWith(`/participants/${BENEFICIARY_ID}`);
    expect(redirect).toHaveBeenCalledWith(
      `/participants/${BENEFICIARY_ID}/programs/${SUPPORT_CASE_ID}/close?notice=case_closed`,
    );
  });

  it('확인 체크 없이는 API 를 부르지 않고 invalid_request 로 되돌린다', async () => {
    const formData = validForm();
    formData.delete('confirmClose');

    await expect(closeSupportCaseAction(formData)).rejects.toThrow('NEXT_REDIRECT');

    expect(closeSupportCase).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(
      `/participants/${BENEFICIARY_ID}/programs/${SUPPORT_CASE_ID}/close?error=invalid_request`,
    );
  });

  it('사유가 비면 API 를 부르지 않는다 — 사유는 필수다', async () => {
    const formData = validForm();
    formData.set('reason', '   ');

    await expect(closeSupportCaseAction(formData)).rejects.toThrow('NEXT_REDIRECT');
    expect(closeSupportCase).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(
      `/participants/${BENEFICIARY_ID}/programs/${SUPPORT_CASE_ID}/close?error=invalid_request`,
    );
  });

  it('API 가 conflict(이미 종결)로 거절하면 error=conflict 로 되돌린다', async () => {
    closeSupportCase.mockRejectedValue(new MockApiError('conflict'));

    await expect(closeSupportCaseAction(validForm())).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith(
      `/participants/${BENEFICIARY_ID}/programs/${SUPPORT_CASE_ID}/close?error=conflict`,
    );
  });
});
