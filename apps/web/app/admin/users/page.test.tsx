import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다(admin-sidebar.test.tsx 와 같은 이유).
afterEach(cleanup);

const listDirectoryAccounts = vi.fn();
const getMyIdentity = vi.fn();
const listCounselorAssignments = vi.fn();
const updateAccountRolesAction = vi.fn();

vi.mock('../../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  listDirectoryAccounts: () => listDirectoryAccounts(),
  getMyIdentity: () => getMyIdentity(),
  listCounselorAssignments: (id: string) => listCounselorAssignments(id),
}));

vi.mock('../../actions', () => ({
  updateAccountRolesAction: (formData: FormData) => updateAccountRolesAction(formData),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const { default: AdminUsersPage } = await import('./page');

const ME = { id: 'me1', orgId: 'org_demo', email: 'me@example.test', role: 'admin', active: true, name: '관리자', roles: ['institution-admin'] };
const WORKER = { id: 'c1', email: 'c1@example.test', name: '김실무', active: true, roles: ['worker'] };
const WAITING = { id: 'w1', email: null, name: null, active: true, roles: [] };

async function renderPage(selected?: string) {
  const element = await AdminUsersPage({
    searchParams: Promise.resolve(selected === undefined ? {} : { selected }),
  });
  return render(element);
}

beforeEach(() => {
  listDirectoryAccounts.mockReset();
  getMyIdentity.mockReset();
  listCounselorAssignments.mockReset();
  updateAccountRolesAction.mockReset();
  listDirectoryAccounts.mockResolvedValue({ accounts: [WORKER], permissions: { canManageRoles: true } });
  getMyIdentity.mockResolvedValue(ME);
  listCounselorAssignments.mockResolvedValue({ participants: [] });
  updateAccountRolesAction.mockResolvedValue({ status: 'updated' });
});

describe('관리자 사용자 화면 (CCC-62)', () => {
  // 배정을 바꾸는 곳은 '배정' 화면 하나다. 이 화면은 같은 정보를 실무자 축으로 읽기만 하는데,
  // 그 사실을 말해 주지 않아 "여기서 바꾸는 건가"를 물을 곳이 없었다.
  it('실무자를 고르면 배정 화면으로 가는 안내를 보여준다', async () => {
    const { container } = await renderPage('c1');

    const hint = container.querySelector('[data-testid="admin-users-assign-hint"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toContain('담당을 바꾸려면');
    expect(hint?.querySelector('a')?.getAttribute('href')).toBe('/admin/assign');
  });

  it('실무자를 고르기 전에는 안내를 띄우지 않는다', async () => {
    const { container } = await renderPage();
    expect(container.querySelector('[data-testid="admin-users-assign-hint"]')).toBeNull();
  });

  // 이 화면은 배정을 읽기만 한다. 배정을 바꾸는 폼이 여기 생기면 진입점이 다시 둘이 된다.
  it('배정을 바꾸는 폼을 두지 않는다', async () => {
    const { container } = await renderPage('c1');
    expect(container.querySelector('form')).toBeNull();
  });

  it('담당 조회가 실패하면 안내 대신 오류만 보여준다', async () => {
    const { ApiError } = await import('../../lib/api') as unknown as { ApiError: new (code: string) => Error };
    listCounselorAssignments.mockRejectedValue(new ApiError('service_unavailable'));

    const { container } = await renderPage('c1');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('담당 당사자를 지금 불러올 수 없습니다');
    // 조회가 안 된 상태에서 "바꾸려면 저기로" 안내만 남기면 무엇을 바꾸는지 알 수 없다.
    expect(container.querySelector('[data-testid="admin-users-assign-hint"]')).toBeNull();
  });
});

describe('사용자·역할 화면의 역할 관리 (D74)', () => {
  // 구 GET /users 필터(admin·counselor 만)는 역할 대기 계정을 숨겼다 — 초대받아 가입한
  // 사람에게 역할을 줄 수 없었다. 목록은 디렉터리 전원을 보여 줘야 한다.
  it('역할이 없는 계정도 목록에 보이고 역할 대기로 표시한다', async () => {
    listDirectoryAccounts.mockResolvedValue({ accounts: [WORKER, WAITING], permissions: { canManageRoles: true } });
    const { container } = await renderPage();
    expect(container.textContent).toContain('역할 대기');
    expect(container.textContent).toContain('김실무');
  });

  it('역할 저장 요청이 현재 역할을 expectedRoles 로 싣는다', async () => {
    const { container } = await renderPage('c1');

    // 실무자(worker)는 이미 가지고 있다 — 기관 기술 관리자를 추가로 켠다.
    const technical = Array.from(container.querySelectorAll('input[type="checkbox"]'))
      .find((input) => input.closest('label')?.textContent?.includes('기관 기술 관리자'))!;
    fireEvent.click(technical);
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '역할 저장')!);

    await vi.waitFor(() => expect(updateAccountRolesAction).toHaveBeenCalledTimes(1));
    const formData = updateAccountRolesAction.mock.calls[0]![0] as FormData;
    expect(formData.get('userId')).toBe('c1');
    expect(formData.getAll('roles').sort()).toEqual(['technical-admin', 'worker']);
    // 낙관적 동시성: 화면이 읽어 둔 현재 역할을 그대로 싣는다.
    expect(formData.getAll('expectedRoles')).toEqual(['worker']);
  });

  it('서버가 거부하면 사람이 읽는 문구를 보여준다', async () => {
    updateAccountRolesAction.mockResolvedValue({ status: 'conflict' });
    const { container } = await renderPage('c1');

    const admin = Array.from(container.querySelectorAll('input[type="checkbox"]'))
      .find((input) => input.closest('label')?.textContent?.includes('기관 관리자'))!;
    fireEvent.click(admin);
    fireEvent.click(Array.from(container.querySelectorAll('button')).find((b) => b.textContent === '역할 저장')!);

    await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('마지막 남은 관리자 역할은 뺄 수 없습니다');
  });

  it('기관 관리자가 아니면 역할 칸 대신 안내를 보여준다', async () => {
    listDirectoryAccounts.mockResolvedValue({ accounts: [WORKER], permissions: { canManageRoles: false } });
    const { container } = await renderPage('c1');
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.textContent).toContain('역할 변경은 기관 관리자만 할 수 있습니다');
  });

  it('본인 행에서는 기관 관리자 체크칸이 잠기고 이유를 알린다', async () => {
    const self = { id: 'me1', email: 'me@example.test', name: '관리자', active: true, roles: ['institution-admin'] };
    listDirectoryAccounts.mockResolvedValue({ accounts: [self], permissions: { canManageRoles: true } });
    const { container } = await renderPage('me1');
    const admin = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
      .find((input) => input.closest('label')?.textContent?.includes('기관 관리자'))!;
    expect(admin.disabled).toBe(true);
    expect(container.textContent).toContain('자기 기관 관리자 역할은 스스로 뺄 수 없습니다');
  });

  it('실무자 역할이 없으면 상담 기록을 쓸 수 없다는 사실을 알린다', async () => {
    const { container } = await renderPage('c1');
    expect(container.textContent).toContain('실무자 역할이 없으면 상담 기록을 쓸 수 없습니다');
  });
});
