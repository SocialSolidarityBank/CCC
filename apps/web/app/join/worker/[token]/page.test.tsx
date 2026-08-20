import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다(admin/page.test.tsx 와 같은 이유).
afterEach(cleanup);

const getPublicWorkerInviteInfo = vi.fn();
const signupWorkerAction = vi.fn();

vi.mock('../../../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  getPublicWorkerInviteInfo: (token: string) => getPublicWorkerInviteInfo(token),
}));

vi.mock('../../../actions', () => ({
  signupWorkerAction: (formData: FormData) => signupWorkerAction(formData),
}));

// notFound() 는 렌더를 끊는 throw — 테스트에서는 표식 오류로 대신한다.
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));

const { default: JoinWorkerPage } = await import('./page');
const { WorkerSignupForm } = await import('./signup-form');

beforeEach(() => {
  getPublicWorkerInviteInfo.mockReset();
  signupWorkerAction.mockReset();
});

describe('실무자 초대 수락 화면 (CCC-108)', () => {
  it('유효한 토큰이면 기관 이름과 이름·이메일 입력 폼을 보여준다', async () => {
    getPublicWorkerInviteInfo.mockResolvedValue({ orgName: '사회연대은행' });

    const { container } = render(await JoinWorkerPage({ params: Promise.resolve({ token: 'tok1' }) }));

    expect(getPublicWorkerInviteInfo).toHaveBeenCalledWith('tok1');
    expect(container.textContent).toContain('실무자 초대');
    expect(container.textContent).toContain('사회연대은행');
    expect(container.querySelector('input[name="name"]')).not.toBeNull();
    expect(container.querySelector('input[name="email"]')).not.toBeNull();
    expect(container.querySelector('button[type="submit"]')?.textContent).toContain('가입 완료');
  });

  it('기관 이름 설정 전(null)이면 일반 문안으로 폴백한다', async () => {
    getPublicWorkerInviteInfo.mockResolvedValue({ orgName: null });

    const { container } = render(await JoinWorkerPage({ params: Promise.resolve({ token: 'tok1' }) }));
    expect(container.textContent).toContain('기관의 실무자로 초대받았습니다');
  });

  it('무효·이미 소비된 토큰이면 notFound 로 끊는다', async () => {
    const { ApiError } = await import('../../../lib/api') as unknown as { ApiError: new (code: string) => Error };
    getPublicWorkerInviteInfo.mockRejectedValue(new ApiError('not_found'));

    await expect(JoinWorkerPage({ params: Promise.resolve({ token: 'used' }) }))
      .rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('WorkerSignupForm (CCC-108)', () => {
  function fillAndSubmit(container: HTMLElement): void {
    fireEvent.change(container.querySelector('input[name="name"]') as HTMLInputElement, {
      target: { value: '새 실무자' },
    });
    fireEvent.change(container.querySelector('input[name="email"]') as HTMLInputElement, {
      target: { value: 'worker@example.org' },
    });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
  }

  it('가입이 완료되면 Cloudflare Access 로그인 안내를 보여준다', async () => {
    signupWorkerAction.mockResolvedValue({ status: 'created', email: 'worker@example.org' });

    const { container } = render(<WorkerSignupForm token="tok1" />);
    fillAndSubmit(container);

    await waitFor(() => {
      expect(container.textContent).toContain('가입이 완료되었습니다');
    });
    expect(container.textContent).toContain('Cloudflare Access');
    expect(container.textContent).toContain('worker@example.org');
    // 폼이 토큰을 실어 보냈다.
    const sent = signupWorkerAction.mock.calls[0]?.[0] as FormData;
    expect(sent.get('token')).toBe('tok1');
    expect(sent.get('email')).toBe('worker@example.org');
  });

  it('이미 등록된 이메일(conflict)은 구분된 안내를 보여준다', async () => {
    signupWorkerAction.mockResolvedValue({ status: 'conflict' });

    const { container } = render(<WorkerSignupForm token="tok1" />);
    fillAndSubmit(container);

    await waitFor(() => {
      expect(container.textContent).toContain('이미 등록된 이메일입니다');
    });
    // 완료 패널로 넘어가지 않았다.
    expect(container.textContent).not.toContain('가입이 완료되었습니다');
  });

  it('사용할 수 없는 링크(not_found)는 재시도 대신 링크 안내를 보여준다', async () => {
    signupWorkerAction.mockResolvedValue({ status: 'not_found' });

    const { container } = render(<WorkerSignupForm token="tok1" />);
    fillAndSubmit(container);

    await waitFor(() => {
      expect(container.textContent).toContain('이 링크는 사용할 수 없거나 이미 완료되었습니다');
    });
  });
});
