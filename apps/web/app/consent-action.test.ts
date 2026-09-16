import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateParticipantConsent = vi.fn();
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
  updateParticipantConsent: (...args: unknown[]) => updateParticipantConsent(...args),
  updateParticipantBasicInfo: vi.fn(),
  updateScheduleSessionGoals: vi.fn(),
  updateSupportCaseOverallGoal: vi.fn(),
  resolveDiscrepancy: vi.fn(),
  actionItemResolutionStatuses: ['done', 'in_progress', 'not_done', 'hold'],
  lifeAreaKeys: [],
  lifeAreaStatuses: [],
}));
vi.mock('./lib/supabase-auth', () => ({
  signInWithPassword: vi.fn(),
  signUpWithPassword: vi.fn(),
  signInOrSignUpWithPassword: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: (destination: string) => redirect(destination) }));

const { updateParticipantConsentAction } = await import('./actions');

const BENEFICIARY_ID = 'swallow-003';
const SUPPORT_CASE_ID = '11111111-1111-4111-8111-111111111111';
const DOMAIN = 'personal_data_collection_use';

function form(entries: Record<string, string> = {}): FormData {
  const formData = new FormData();
  formData.set('beneficiaryId', BENEFICIARY_ID);
  formData.set('supportCaseId', SUPPORT_CASE_ID);
  for (const [key, value] of Object.entries(entries)) formData.set(key, value);
  return formData;
}

beforeEach(() => {
  updateParticipantConsent.mockReset();
  revalidatePath.mockReset();
  redirect.mockClear();
});

describe('updateParticipantConsentAction', () => {
  it('결정과 고지 스냅샷 중 하나만 오면 저장하지 않고 invalid_request로 멈춘다', async () => {
    const formData = form({
      [`consentDecision_${DOMAIN}`]: 'decline',
      consentDecision_sensitive_information_processing: 'grant',
      consentSnapshot_sensitive_information_processing: JSON.stringify({
        domain: 'sensitive_information_processing',
      }),
    });

    await expect(updateParticipantConsentAction(formData)).rejects.toThrow('NEXT_REDIRECT');

    expect(updateParticipantConsent).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(`/participants/${BENEFICIARY_ID}?error=invalid_request`);
  });

  it('신계약 동의 입력이 하나도 없으면 성공으로 처리하지 않는다', async () => {
    await expect(updateParticipantConsentAction(form())).rejects.toThrow('NEXT_REDIRECT');

    expect(updateParticipantConsent).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(`/participants/${BENEFICIARY_ID}?error=invalid_request`);
  });
});
