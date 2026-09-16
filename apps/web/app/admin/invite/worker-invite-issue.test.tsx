import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor, type RenderResult } from '@testing-library/react';
import { WorkerInviteIssue } from './worker-invite-issue';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다(admin/page.test.tsx 와 같은 이유).
afterEach(cleanup);

const createStaffInviteAction = vi.fn();

vi.mock('../../actions', () => ({
  createStaffInviteAction: (formData: FormData) => createStaffInviteAction(formData),
}));

beforeEach(() => {
  createStaffInviteAction.mockReset();
  createStaffInviteAction.mockResolvedValue({
    status: 'created',
    token: 'a'.repeat(64),
    email: 'worker@example.org',
    expiresAt: '2026-09-23T00:00:00.000Z',
  });
});

function fillEmail(view: RenderResult) {
  fireEvent.change(view.container.querySelector('input[name="invite-email"]') as HTMLInputElement, {
    target: { value: 'worker@example.org' },
  });
}

describe('실무자 초대 링크 발급 (D86, 관리자 화면)', () => {
  it('이메일을 적고 발급하면 /join/worker/ 링크와 만료를 복사용으로 보여준다', async () => {
    const view = render(<WorkerInviteIssue canGrantRoles={true} />);
    fillEmail(view);
    fireEvent.click(view.getByText('초대 링크 만들기'));

    await waitFor(() => {
      expect(view.container.querySelector('#worker-invite-url')).not.toBeNull();
    });
    const url = (view.container.querySelector('#worker-invite-url') as HTMLTextAreaElement).value;
    expect(url).toContain(`/join/worker/${'a'.repeat(64)}`);
    expect(view.getByText('링크 복사')).not.toBeNull();
    // 1회용·만료·일회성 노출이 화면에 알려진다.
    expect(view.container.textContent).toContain('한 번만 쓸 수 있고');
    expect(view.container.textContent).toContain('만료');
    expect(view.container.textContent).toContain('한 번만 보입니다');
    // 서버에 이메일을 실어 보냈다 — 초대는 수신 이메일에 묶인다.
    const sent = createStaffInviteAction.mock.calls[0]?.[0] as FormData;
    expect(sent.get('email')).toBe('worker@example.org');
  });

  it('이메일이 비어 있으면 발급 버튼이 비활성이다', () => {
    const { getByRole } = render(<WorkerInviteIssue canGrantRoles={true} />);
    expect((getByRole('button', { name: '초대 링크 만들기' }) as HTMLButtonElement).disabled).toBe(true);
    expect(createStaffInviteAction).not.toHaveBeenCalled();
  });

  it('발급이 실패하면 인라인 오류를 보여준다', async () => {
    createStaffInviteAction.mockResolvedValue({ status: 'service_unavailable' });

    const view = render(<WorkerInviteIssue canGrantRoles={true} />);
    fillEmail(view);
    fireEvent.click(view.getByText('초대 링크 만들기'));

    await waitFor(() => {
      expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('링크를 만들지 못했습니다');
    });
  });
});

describe('실무자 초대 링크의 역할 선택 (D86 결정 3)', () => {
  it('기관 관리자는 초대에 담을 역할을 고른다 — 실무자가 기본으로 켜져 있다', () => {
    const view = render(<WorkerInviteIssue canGrantRoles={true} />);
    const boxes = Array.from(view.container.querySelectorAll('input[type="checkbox"]'));
    const labels = boxes.map((box) => box.closest('label')?.textContent ?? '');
    expect(labels.some((text) => text.includes('실무자'))).toBe(true);
    expect(labels.some((text) => text.includes('기관 관리자'))).toBe(true);
    expect(labels.some((text) => text.includes('기관 기술 관리자'))).toBe(true);
    const worker = boxes.find((box) => box.closest('label')?.textContent?.includes('실무자'))!;
    expect((worker as HTMLInputElement).checked).toBe(true);
  });

  it('고른 역할이 발급 요청에 실린다', async () => {
    const view = render(<WorkerInviteIssue canGrantRoles={true} />);
    fillEmail(view);
    // 기관 기술 관리자를 추가로 켠다.
    const technical = Array.from(view.container.querySelectorAll('input[type="checkbox"]'))
      .find((box) => box.closest('label')?.textContent?.includes('기관 기술 관리자'))!;
    fireEvent.click(technical);
    fireEvent.click(view.getByText('초대 링크 만들기'));

    await waitFor(() => expect(createStaffInviteAction).toHaveBeenCalledTimes(1));
    const formData = createStaffInviteAction.mock.calls[0]![0] as FormData;
    expect(formData.get('email')).toBe('worker@example.org');
    expect(formData.getAll('roles').sort()).toEqual(['institution_technical_admin', 'practitioner']);
  });

  it('역할을 모두 끄면 발급 버튼이 잠긴다 — 기관 관리자는 업무 역할을 반드시 골라야 한다', () => {
    const view = render(<WorkerInviteIssue canGrantRoles={true} />);
    fillEmail(view);
    const worker = Array.from(view.container.querySelectorAll('input[type="checkbox"]'))
      .find((box) => box.closest('label')?.textContent?.includes('실무자'))!;
    fireEvent.click(worker);
    const button = view.getByText('초대 링크 만들기').closest('button')!;
    expect(button.disabled).toBe(true);
  });

  it('기술 관리자만 있는 사람에게는 역할 칸이 없고 빈 roles 로 보낸다', async () => {
    const view = render(<WorkerInviteIssue canGrantRoles={false} />);
    expect(view.container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(view.container.textContent).toContain('역할 대기');
    fillEmail(view);
    fireEvent.click(view.getByText('초대 링크 만들기'));

    await waitFor(() => expect(createStaffInviteAction).toHaveBeenCalledTimes(1));
    const formData = createStaffInviteAction.mock.calls[0]![0] as FormData;
    expect(formData.getAll('roles')).toEqual([]);
  });
});
