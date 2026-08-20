import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다(admin/page.test.tsx 와 같은 이유).
afterEach(cleanup);

const createWorkerInviteAction = vi.fn();

vi.mock('../../actions', () => ({
  createWorkerInviteAction: () => createWorkerInviteAction(),
}));

const { WorkerInviteIssue } = await import('./worker-invite-issue');

beforeEach(() => {
  createWorkerInviteAction.mockReset();
});

describe('실무자 초대 링크 발급 (CCC-108, 관리자 화면)', () => {
  it('발급 버튼을 누르면 /join/worker/ 링크를 복사용으로 보여준다', async () => {
    createWorkerInviteAction.mockResolvedValue({ status: 'created', token: 'a'.repeat(64) });

    const { container, getByText } = render(<WorkerInviteIssue />);
    fireEvent.click(getByText('초대 링크 만들기'));

    await waitFor(() => {
      expect(container.querySelector('#worker-invite-url')).not.toBeNull();
    });
    const url = (container.querySelector('#worker-invite-url') as HTMLTextAreaElement).value;
    expect(url).toContain(`/join/worker/${'a'.repeat(64)}`);
    expect(getByText('링크 복사')).not.toBeNull();
  });

  it('발급이 실패하면 인라인 오류를 보여준다', async () => {
    createWorkerInviteAction.mockResolvedValue({ status: 'service_unavailable' });

    const { container, getByText } = render(<WorkerInviteIssue />);
    fireEvent.click(getByText('초대 링크 만들기'));

    await waitFor(() => {
      expect(container.querySelector('[role="alert"]')?.textContent).toContain('링크를 만들지 못했습니다');
    });
  });
});
