import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다(admin-sidebar.test.tsx 와 같은 이유).
afterEach(cleanup);

const listOrgUsers = vi.fn();
const listCounselorAssignments = vi.fn();

vi.mock('../../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  listOrgUsers: () => listOrgUsers(),
  listCounselorAssignments: (id: string) => listCounselorAssignments(id),
}));

const { default: AdminUsersPage } = await import('./page');

const COUNSELOR = { id: 'c1', orgId: 'org_demo', email: 'c1@example.test', role: 'counselor', active: true, name: '김실무' };

async function renderPage(selected?: string) {
  const element = await AdminUsersPage({
    searchParams: Promise.resolve(selected === undefined ? {} : { selected }),
  });
  return render(element);
}

beforeEach(() => {
  listOrgUsers.mockReset();
  listCounselorAssignments.mockReset();
  listOrgUsers.mockResolvedValue([COUNSELOR]);
  listCounselorAssignments.mockResolvedValue({ participants: [] });
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

  // 이 화면은 읽기 전용이다. 배정을 바꾸는 폼이 여기 생기면 진입점이 다시 둘이 된다.
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
