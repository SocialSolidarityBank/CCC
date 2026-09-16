import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다(admin/page.test.tsx 와 같은 이유).
afterEach(cleanup);

const createStaffInviteAction = vi.fn();

vi.mock('../../actions', () => ({
  createStaffInviteAction: (formData: FormData) => createStaffInviteAction(formData),
}));

const { WorkerInviteIssue } = await import('./worker-invite-issue');

beforeEach(() => {
  createStaffInviteAction.mockReset();
});

function fillEmail(container: HTMLElement, value: string): void {
  fireEvent.change(container.querySelector('input[name="invite-email"]') as HTMLInputElement, {
    target: { value },
  });
}

describe('실무자 초대 링크 발급 (D86, 관리자 화면)', () => {
  it('이메일을 적고 발급하면 /join/worker/ 링크와 만료를 복사용으로 보여준다', async () => {
    createStaffInviteAction.mockResolvedValue({
      status: 'created', token: 'a'.repeat(64), email: 'worker@example.org',
      expiresAt: '2026-09-23T00:00:00.000Z',
    });

    const { container, getByText } = render(<WorkerInviteIssue />);
    fillEmail(container, 'worker@example.org');
    fireEvent.click(getByText('초대 링크 만들기'));

    await waitFor(() => {
      expect(container.querySelector('#worker-invite-url')).not.toBeNull();
    });
    const url = (container.querySelector('#worker-invite-url') as HTMLTextAreaElement).value;
    expect(url).toContain(`/join/worker/${'a'.repeat(64)}`);
    expect(getByText('링크 복사')).not.toBeNull();
    // 1회용·만료·일회성 노출이 화면에 알려진다.
    expect(container.textContent).toContain('한 번만 쓸 수 있고');
    expect(container.textContent).toContain('만료');
    expect(container.textContent).toContain('한 번만 보입니다');
    // 서버에 이메일을 실어 보냈다 — 초대는 수신 이메일에 묶인다.
    const sent = createStaffInviteAction.mock.calls[0]?.[0] as FormData;
    expect(sent.get('email')).toBe('worker@example.org');
  });

  it('이메일이 비어 있으면 발급 버튼이 비활성이다', () => {
    const { getByRole } = render(<WorkerInviteIssue />);
    expect((getByRole('button', { name: '초대 링크 만들기' }) as HTMLButtonElement).disabled).toBe(true);
    expect(createStaffInviteAction).not.toHaveBeenCalled();
  });

  it('발급이 실패하면 인라인 오류를 보여준다', async () => {
    createStaffInviteAction.mockResolvedValue({ status: 'service_unavailable' });

    const { container, getByText } = render(<WorkerInviteIssue />);
    fillEmail(container, 'worker@example.org');
    fireEvent.click(getByText('초대 링크 만들기'));

    await waitFor(() => {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('링크를 만들지 못했습니다');
    });
  });
});
