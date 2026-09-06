import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { InviteIssue } from './invite-issue';

afterEach(cleanup);

const createParticipantInviteAction = vi.fn();
vi.mock('../../actions', () => ({
  createParticipantInviteAction: () => createParticipantInviteAction(),
}));
vi.mock('qrcode.react', () => ({ QRCodeSVG: () => null }));

async function issue() {
  const view = render(<InviteIssue />);
  fireEvent.click(view.getByText('가입 링크 만들기'));
  await waitFor(() => expect(view.container.querySelector('#invite-url')).not.toBeNull());
  return view;
}

beforeEach(() => {
  createParticipantInviteAction.mockReset();
  createParticipantInviteAction.mockResolvedValue({ status: 'created', token: 'tok-1' });
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true, writable: true });
});

describe('요청 링크 공유 버튼 (D86 ④, OS 공유 시트)', () => {
  it('공유 시트가 없는 브라우저에서는 버튼을 렌더하지 않는다', async () => {
    const view = await issue();
    expect(view.container.querySelector('.wire-field-with-action>.header-icon-button')).toBeNull();
    expect(view.getByText('링크 복사')).not.toBeNull();
  });

  it('공유 시트가 있으면 링크 칸 오른쪽 아이콘 원으로 이메일 문안과 링크를 넘긴다', async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    const view = await issue();
    const button = view.container.querySelector('.wire-field-with-action>.header-icon-button');
    expect(button?.getAttribute('aria-label')).toBe('공유');
    fireEvent.click(button!);
    const url = `${window.location.origin}/join/participant/tok-1`;
    expect(share).toHaveBeenCalledWith({ text: expect.stringContaining(url), url });
    // 문안에는 당사자 이름이 없다 — 링크는 발급 시점에 당사자를 모른다.
    const text = (share.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(text).not.toMatch(/님/);
  });
});
