import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { PROGRAM_ADMISSION_COPY } from '@ccc/contracts/program-admission';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다(admin-sidebar.test.tsx 와 같은 이유).
afterEach(cleanup);

const getOrganizationProfile = vi.fn();
const listOrgUsers = vi.fn();
const listAssignedParticipants = vi.fn();
const listPrograms = vi.fn();
const updateProgramAdmissionAction = vi.fn();


vi.mock('../actions', () => ({
  updateProgramAdmissionAction: (formData: FormData) => updateProgramAdmissionAction(formData),
}));
vi.mock('../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  getOrganizationProfile: () => getOrganizationProfile(),
  listOrgUsers: () => listOrgUsers(),
  listAssignedParticipants: () => listAssignedParticipants(),
  listPrograms: () => listPrograms(),
}));

const { default: AdminOrganizationPage } = await import('./page');

function user(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: 'u1', orgId: 'org_demo', email: 'a@example.test', role: 'counselor', active: true, name: null, ...overrides };
}

beforeEach(() => {
  getOrganizationProfile.mockReset();
  listOrgUsers.mockReset();
  listAssignedParticipants.mockReset();
  listPrograms.mockReset();
  updateProgramAdmissionAction.mockReset();
  getOrganizationProfile.mockResolvedValue({ orgId: 'org_demo', orgName: '사회연대은행', programDisplayName: '마이크로크레딧' });
  listOrgUsers.mockResolvedValue([]);
  listPrograms.mockResolvedValue({
    programs: [{
      id: 'program-1',
      orgId: 'org_demo',
      displayName: '마이크로크레딧',
      status: 'active',
      programType: 'financial_support_v1',
      storageMode: 'undecided',
      processingMode: 'undecided',
      version: 1,
      financialSupportEnabled: true,
      confirmation: null,
      admissionState: 'undecided',
      staff: [],
    }],
    staffOptions: [],
    admissionCopy: {
      version: 'D87-v1',
      hash: 'a'.repeat(64),
      copy: PROGRAM_ADMISSION_COPY,
    },
    installation: {
      deploymentMode: 'community-cloud',
      sttMode: 'off',
      llmMode: 'off',
      policyVersion: 1,
      configHash: 'b'.repeat(64),
    },
  });
});

describe('관리자 기관 홈 (CCC-59)', () => {
  it('기관 이름과 역할별 계정 수를 보여준다', async () => {
    listOrgUsers.mockResolvedValue([
      user({ id: 'a1', role: 'admin' }),
      user({ id: 'c1' }),
      user({ id: 'c2' }),
      user({ id: 'c3', active: false }),
      // 처리 장비 계정은 사람이 아니라 내부 신원이라 세지 않는다.
      user({ id: 's1', role: 'service' }),
    ]);

    const { container } = render(await AdminOrganizationPage());

    expect(container.textContent).toContain('사회연대은행');
    expect(container.textContent).toContain('마이크로크레딧');
    const counts = container.querySelector('[data-testid="admin-user-counts"]')?.textContent ?? '';
    expect(counts).toContain('기관 관리자1명');
    expect(counts).toContain('담당 실무자2명');
    expect(counts).toContain('비활성 계정1명');
    // 서비스 계정이 어느 칸에도 섞이지 않았다(관리자 1 + 실무자 2 + 비활성 1 = 사람 4명).
    expect(counts).not.toContain('3명');
  });

  it('비활성 계정이 없으면 그 줄을 만들지 않는다', async () => {
    listOrgUsers.mockResolvedValue([user({ id: 'a1', role: 'admin' })]);

    const { container } = render(await AdminOrganizationPage());
    expect(container.querySelector('[data-testid="admin-user-counts"]')?.textContent).not.toContain('비활성');
  });

  /**
   * 이 화면은 당사자를 세지 않는다. 지금 당사자를 세는 유일한 조회가 전원의 이름·연락처를
   * 복호화하고 read_participant_pii 감사를 남기기 때문이다. 화면을 열 때마다 그 행이 쌓이면
   * "이 실무자가 이 당사자를 몇 번 열람했나"(D24 · ADR-0005)를 셀 수 없게 된다.
   * 나중에 숫자를 채우고 싶어질 때 이 조회를 그냥 갖다 붙이지 못하게 못박는다.
   */
  it('당사자 목록 조회를 부르지 않는다 — PII 열람 감사를 남기지 않는다', async () => {
    render(await AdminOrganizationPage());
    expect(listAssignedParticipants).not.toHaveBeenCalled();
  });

  it('이름이 설정 전이면 설정 화면으로 가라고 안내한다', async () => {
    getOrganizationProfile.mockResolvedValue({ orgId: 'org_demo', orgName: null, programDisplayName: null });

    const { container } = render(await AdminOrganizationPage());
    expect(container.querySelector('[data-testid="admin-org-naming"]')).not.toBeNull();
    expect(container.textContent).toContain('설정 전');
  });


  it('미결정 사업은 기본 선택 없이 두고 두 축을 고른 뒤에만 관리자 확인을 연다', async () => {
    const { container } = render(await AdminOrganizationPage());

    expect(screen.getByRole('heading', { name: '사업 도입 확인' })).not.toBeNull();
    const storage = screen.getByRole('radio', { name: /기본형/ }) as HTMLInputElement;
    const naver = screen.getByRole('radio', { name: /네이버 클라우드 공공형/ }) as HTMLInputElement;
    const processing = screen.getByRole('radio', { name: /기관 안에서만 처리/ }) as HTMLInputElement;
    expect(storage.checked).toBe(false);
    expect(screen.getAllByRole('radio').every((radio) => !(radio as HTMLInputElement).checked)).toBe(true);
    expect(naver.disabled).toBe(true);
    expect(screen.queryByRole('checkbox', { name: PROGRAM_ADMISSION_COPY.confirmation })).toBeNull();
    expect(screen.getAllByRole('link', { name: '확인하는 법' })).toHaveLength(2);
    expect(container.textContent).toContain('AI 정리(OpenAI');
    expect(container.textContent).toContain('음성 인식(Azure');

    fireEvent.click(storage);
    fireEvent.click(processing);
    expect(screen.getByRole('checkbox', { name: PROGRAM_ADMISSION_COPY.confirmation })).not.toBeNull();
  });
  it('조회가 실패하면 빈 화면 대신 안내를 남긴다', async () => {
    const { ApiError } = await import('../lib/api') as unknown as { ApiError: new (code: string) => Error };
    getOrganizationProfile.mockRejectedValue(new ApiError('service_unavailable'));

    const { container } = render(await AdminOrganizationPage());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('기관 정보를 확인할 수 없습니다');
  });
});
