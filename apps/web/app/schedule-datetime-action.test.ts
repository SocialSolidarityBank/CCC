import { beforeEach, describe, expect, it, vi } from 'vitest';

// 이 버그는 런타임 TZ 가 UTC 일 때만 드러난다(Workers). 개발 맥은 KST 라 naive 파싱이
// 우연히 맞아 떨어져 테스트가 못 잡는다 — UTC 로 고정해 서버 환경을 재현한다.
process.env.TZ = 'UTC';

// 상담 일시 경계 회귀(2026-09-16 preview 리허설): 화면의 DateTimePickerControl 은
// 오프셋 없는 `YYYY-MM-DDTHH:mm` 을 보낸다. 서버 액션이 그 값을 UTC 로 읽으면 저장이
// 9시간 당겨지고 표시(Asia/Seoul)에서 다시 +9시간 되어 하루가 밀린다 — 이 테스트는
// naive 입력이 기관 벽시계(Asia/Seoul)로 해석돼 API 에 ISO UTC 로 나가는지를 고정한다.
const createCounselingSchedule = vi.fn();
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
  acceptAssignmentRequest: vi.fn(),
  addSupportCaseAssignee: vi.fn(),
  closeGoal: vi.fn(),
  closeSupportCase: vi.fn(),
  createActionItem: vi.fn(),
  createCounselingRecord: vi.fn(),
  createGoal: vi.fn(),
  createIntakeRecord: vi.fn(),
  getGoalUpcomingLinkCount: vi.fn(),
  updateGoalTitle: vi.fn(),
  updateIntakeRecord: vi.fn(),
  goalCloseReasons: ['achieved', 'stopped', 'reset'],
  completeOrganizationOnboarding: vi.fn(),
  createCounselingSchedule: (input: unknown) => createCounselingSchedule(input),
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
  activateAiProviderRuntime: vi.fn(),
  getCounselingMemorySettings: vi.fn(),
  setCounselingMemorySettings: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: (path: string) => revalidatePath(path) }));
vi.mock('next/navigation', () => ({ redirect: (destination: string) => redirect(destination) }));

// vi.mock 이 먼저 세워진 뒤 모듈을 읽어야 하므로 동적 import 가 필요하다(테스트 경계 예외).
const { createCounselingScheduleAction } = await import('./actions');


const BENEFICIARY_ID = 'swallow-003';
const SUPPORT_CASE_ID = 'case-001';

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, entry] of Object.entries(entries)) data.set(key, entry);
  return data;
}

beforeEach(() => {
  createCounselingSchedule.mockReset();
  revalidatePath.mockReset();
  redirect.mockClear();
});

describe('createCounselingScheduleAction 상담 일시 경계', () => {
  it('naive datetime-local 입력을 기관 벽시계(Asia/Seoul)로 해석해 ISO UTC 로 보낸다', async () => {
    // 2026-09-16 16:30 KST = 2026-09-16 07:30 UTC. UTC 로 읽으면 16:30Z 가 되어
    // 표시에서 2026-09-17 01:30 KST 로 하루가 밀린다 — 재발하면 이 테스트가 실패한다.
    const data = form({
      target: `${BENEFICIARY_ID}|${SUPPORT_CASE_ID}`,
      scheduledAt: '2026-09-16T16:30',
    });
    await expect(createCounselingScheduleAction(data)).rejects.toMatchObject({ digest: 'NEXT_REDIRECT' });
    expect(createCounselingSchedule).toHaveBeenCalledWith({
      beneficiaryId: BENEFICIARY_ID,
      supportCaseId: SUPPORT_CASE_ID,
      scheduledAt: '2026-09-16T07:30:00.000Z',
    });
  });

  it('오프셋이 붙은 절대 시각 입력은 그대로 통과시킨다', async () => {
    const data = form({
      target: `${BENEFICIARY_ID}|${SUPPORT_CASE_ID}`,
      scheduledAt: '2026-09-16T16:30:00+09:00',
    });
    await expect(createCounselingScheduleAction(data)).rejects.toMatchObject({ digest: 'NEXT_REDIRECT' });
    expect(createCounselingSchedule).toHaveBeenCalledWith({
      beneficiaryId: BENEFICIARY_ID,
      supportCaseId: SUPPORT_CASE_ID,
      scheduledAt: '2026-09-16T07:30:00.000Z',
    });
  });
});
