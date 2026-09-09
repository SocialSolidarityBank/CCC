import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { InviteIssue } from './invite-issue';

afterEach(cleanup);

const createParticipantInviteAction = vi.fn();
vi.mock('../../actions', () => ({
  createParticipantInviteAction: (programId: string) => createParticipantInviteAction(programId),
}));

async function issue() {
  const view = render(
    <InviteIssue programOptions={[{ id: 'program-ready', displayName: '희망키움', programType: 'financial_support_v1', admissionState: 'ready' }]} />,
  );
  fireEvent.change(view.getByRole('combobox', { name: '참여 사업' }), { target: { value: 'program-ready' } });
  fireEvent.click(view.getByRole('button', { name: '가입 링크 만들기' }));
  await waitFor(() => expect(view.container.querySelector('#invite-url')).toHaveProperty('value', `${window.location.origin}/join/participant/tok-1`));
  return view;
}
it('disables creation when no program is available', () => {
  const view = render(<InviteIssue programOptions={[]} />);
  const button = view.getByRole('button', { name: '가입 링크 만들기' });
  expect(button).toHaveProperty('disabled', true);
  fireEvent.click(button);
  expect(createParticipantInviteAction).not.toHaveBeenCalled();
});
it('shows a safe refusal without creating a link after an admission race', async () => {
  createParticipantInviteAction.mockResolvedValue({ status: 'program_admission_required' });
  const view = render(
    <InviteIssue programOptions={[{ id: 'program-ready', displayName: '희망키움', programType: 'financial_support_v1', admissionState: 'ready' }]} />,
  );
  fireEvent.change(view.getByRole('combobox', { name: '참여 사업' }), { target: { value: 'program-ready' } });
  fireEvent.click(view.getByRole('button', { name: '가입 링크 만들기' }));
  const alert = await waitFor(() => view.getByRole('alert'));
  expect(alert.textContent).not.toContain('program_admission_required');
  expect(view.container.querySelector('#invite-url')).toBeNull();
});

beforeEach(() => {
  createParticipantInviteAction.mockReset();
  createParticipantInviteAction.mockResolvedValue({ status: 'created', token: 'tok-1' });
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true });
});

describe('요청 링크 공유 버튼 (D86 ④, OS 공유 시트)', () => {
  it('공유 시트가 없는 브라우저에서는 버튼을 렌더하지 않는다', async () => {
    const view = await issue();
    expect(view.queryByText('공유하기')).toBeNull();
    expect(view.getByText('링크 복사')).not.toBeNull();
  });

  it('공유 시트에 발급한 링크와 전달 문안을 넘긴다', async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    const view = await issue();
    // 버튼은 마운트 뒤 useEffect 감지로 켜지므로 링크 칸보다 한 틱 늦다(CI 에서 실제로 늦었다).
    const button = await waitFor(() => view.getByRole('button', { name: '공유하기' }));
    fireEvent.click(button);
    const url = `${window.location.origin}/join/participant/tok-1`;
    expect(share).toHaveBeenCalledWith({ text: expect.stringContaining(url), url });
  });
});
