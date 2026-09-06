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
    expect(view.queryByText('공유하기')).toBeNull();
    expect(view.getByText('링크 복사')).not.toBeNull();
  });

  it('공유 시트가 있으면 링크 복사 옆 아이콘+글자 버튼으로 이메일 문안과 링크를 넘긴다', async () => {
    const share = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    const view = await issue();
    // 버튼은 마운트 뒤 useEffect 감지로 켜지므로 링크 칸보다 한 틱 늦다(CI 에서 실제로 늦었다).
    const button = await waitFor(() => view.getByText('공유하기').closest('button')!);
    expect(button.querySelector('svg')).not.toBeNull();
    expect(button.parentElement?.querySelector('.wire-button-text')?.textContent).toBe('링크 복사');
    fireEvent.click(button);
    const url = `${window.location.origin}/join/participant/tok-1`;
    expect(share).toHaveBeenCalledWith({ text: expect.stringContaining(url), url });
    // 문안에는 당사자 이름이 없다 — 링크는 발급 시점에 당사자를 모른다.
    const text = (share.mock.calls[0] as unknown as [{ text: string }])[0].text;
    expect(text).not.toMatch(/님/);
  });
});
