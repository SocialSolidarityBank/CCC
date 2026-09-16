import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CONSENT_DOMAINS } from '@ccc/contracts/consent';

const updateParticipantConsent = vi.fn();
const updateProgramAdmission = vi.fn();
const createInitialParticipantProgram = vi.fn();
const getMyIdentity = vi.fn();
const listProgramOptions = vi.fn();
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
  createParticipantInvite: vi.fn(),
  getPublicInviteInfo: vi.fn(),
  createInitialParticipantProgram: (...args: unknown[]) => createInitialParticipantProgram(...args),
  createStaffInvite: vi.fn(),
  acceptStaffInvite: vi.fn(),
  createSubsequentParticipantProgram: vi.fn(),
  editAiDraft: vi.fn(),
  generateAiDraft: vi.fn(),
  getParticipantBriefing: vi.fn(),
  getSession: vi.fn(),
  getMyIdentity: () => getMyIdentity(),
  listGoals: vi.fn(),
  recordPilotTextAiConsent: vi.fn(),
  registerCounselor: vi.fn(),
  listProgramOptions: () => listProgramOptions(),
  updateParticipantConsent: (...args: unknown[]) => updateParticipantConsent(...args),
  updateProgramAdmission: (...args: unknown[]) => updateProgramAdmission(...args),
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

const {
  createInitialParticipantProgramAction,
  updateParticipantConsentAction,
  updateProgramAdmissionAction,
} = await import('./actions');

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
  updateProgramAdmission.mockReset();
  createInitialParticipantProgram.mockReset();
  getMyIdentity.mockReset();
  listProgramOptions.mockReset();
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

describe('updateProgramAdmissionAction (D87)', () => {
  function admissionForm(confirmed: boolean): FormData {
    const formData = new FormData();
    formData.set('programId', 'program-1');
    formData.set('expectedVersion', '1');
    formData.set('deploymentMode', 'community-cloud');
    formData.set('storageMode', 'supabase_seoul');
    formData.set('processingMode', 'external_allowed');
    formData.set('copyVersion', 'D87-v1');
    formData.set('copyHash', 'a'.repeat(64));
    formData.set('installationPolicyVersion', '1');
    formData.set('installationConfigHash', 'b'.repeat(64));
    if (confirmed) formData.set('confirmed', 'yes');
    return formData;
  }

  it('두 축을 골라도 관리자 확인 체크 없이는 저장하지 않는다', async () => {
    await expect(updateProgramAdmissionAction(admissionForm(false))).rejects.toThrow('NEXT_REDIRECT');

    expect(updateProgramAdmission).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('/admin?error=invalid_request');
  });

  it('확인 체크와 화면의 문안·설치 해시를 한 payload로 저장한다', async () => {
    updateProgramAdmission.mockResolvedValue({ admissionState: 'ready' });

    await expect(updateProgramAdmissionAction(admissionForm(true))).rejects.toThrow('NEXT_REDIRECT');

    expect(updateProgramAdmission).toHaveBeenCalledWith('program-1', {
      expectedVersion: 1,
      storageMode: 'supabase_seoul',
      processingMode: 'external_allowed',
      confirmation: {
        copyVersion: 'D87-v1',
        copyHash: 'a'.repeat(64),
        installationPolicyVersion: 1,
        installationConfigHash: 'b'.repeat(64),
      },
    });
    expect(redirect).toHaveBeenCalledWith('/admin?notice=program_admission_saved');
  });
});

describe('createInitialParticipantProgramAction canonical role projection', () => {
  it('legacy counselor라도 기관 관리자 grant가 있으면 본인을 초기 담당자로 보낸다', async () => {
    getMyIdentity.mockResolvedValue({
      id: 'worker-1',
      role: 'counselor',
      roles: ['institution-admin', 'worker'],
    });
    listProgramOptions.mockResolvedValue([{
      id: 'program-1',
      displayName: '합성 사업',
      programType: 'financial_support_v1',
    }]);
    createInitialParticipantProgram.mockResolvedValue({
      beneficiaryId: 'swallow-004',
      supportCaseId: '11111111-1111-4111-8111-111111111112',
    });
    const formData = new FormData();
    for (const domain of CONSENT_DOMAINS) {
      formData.set(`consentDecision_${domain}`, 'grant');
      formData.set(`consentSnapshot_${domain}`, JSON.stringify({
        domain,
        snapshotId: `snapshot-${domain}`,
        provider: 'institution',
        providerLegalRecipient: '합성 기관',
        country: 'KR',
        purpose: 'case_management',
        retentionDuration: 'default',
        copyVersion: 'consent-v1',
        copyHash: 'c'.repeat(64),
      }));
    }

    await expect(createInitialParticipantProgramAction(formData)).rejects.toThrow('NEXT_REDIRECT');

    expect(createInitialParticipantProgram).toHaveBeenCalledWith(expect.objectContaining({
      programId: 'program-1',
      initialAssigneeUserId: 'worker-1',
    }));
  });
});
