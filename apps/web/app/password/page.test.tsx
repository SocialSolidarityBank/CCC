import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다(admin/page.test.tsx 와 같은 이유).
afterEach(cleanup);

const { PasswordSetForm } = await import('./password-form');
const { default: PasswordPage } = await import('./page');

const AUTH = { authOrigin: 'https://supabase.test', publishableKey: 'pub-key' };

function landOn(fragment: string): void {
  window.history.replaceState(null, '', `/password${fragment}`);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubEnv('CCC_SUPABASE_AUTH_ORIGIN', AUTH.authOrigin);
  vi.stubEnv('CCC_SUPABASE_PUBLISHABLE_KEY', AUTH.publishableKey);
  landOn('');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('비밀번호 설정 화면 (/password)', () => {
  it('토큰 없이 열면 무엇을 해야 하는지 안내하고 폼을 보여주지 않는다', async () => {
    const { container } = render(<PasswordSetForm {...AUTH} />);

    await waitFor(() => {
      expect(container.textContent).toContain('메일의 링크로 다시 들어오세요');
    });
    expect(container.querySelector('input[name="password"]')).toBeNull();
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('만료되거나 이미 쓴 링크(error_code)면 재요청 안내를 보여주고 멈추지 않는다', async () => {
    landOn('#error=access_denied&error_code=otp_expired&error_description=expired');
    const { container } = render(<PasswordSetForm {...AUTH} />);

    await waitFor(() => {
      expect(container.textContent).toContain('만료되었거나 이미 사용되었습니다');
    });
    expect(container.querySelector('input[name="password"]')).toBeNull();
    expect(container.textContent).toContain('재설정 메일을 다시 요청');
  });

  it('recovery 가 아닌 type(invite 등)이면 처리할 수 없다는 안내를 보여준다', async () => {
    landOn('#access_token=tok&type=invite');
    const { container } = render(<PasswordSetForm {...AUTH} />);

    await waitFor(() => {
      expect(container.textContent).toContain('처리할 수 없는 종류');
    });
    expect(container.querySelector('input[name="password"]')).toBeNull();
  });

  it('recovery fragment 면 폼을 열고 자격을 URL 에서 지운다', async () => {
    landOn('#access_token=recovery-token&type=recovery');
    const { container } = render(<PasswordSetForm {...AUTH} />);

    await waitFor(() => {
      expect(container.querySelector('input[name="password"]')).not.toBeNull();
    });
    // 토큰이 주소창·히스토리에 남지 않는다.
    expect(window.location.hash).toBe('');
  });

  it('설정에 성공하면 토큰을 Bearer 로 PUT /auth/v1/user 에 보내고 로그인 안내를 보여준다', async () => {
    landOn('#access_token=recovery-token&type=recovery');
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }));

    const { container } = render(<PasswordSetForm {...AUTH} />);
    await waitFor(() => {
      expect(container.querySelector('input[name="password"]')).not.toBeNull();
    });

    fireEvent.change(container.querySelector('input[name="password"]') as HTMLInputElement, {
      target: { value: 'new-password-123' },
    });
    fireEvent.change(container.querySelector('input[name="password_confirm"]') as HTMLInputElement, {
      target: { value: 'new-password-123' },
    });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => {
      expect(container.textContent).toContain('새 비밀번호로 다시 로그인하세요');
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://supabase.test/auth/v1/user');
    expect(init.method).toBe('PUT');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer recovery-token');
    expect(JSON.parse(init.body as string)).toEqual({ password: 'new-password-123' });
    expect(container.querySelector('a[href="/login"]')).not.toBeNull();
  });

  it('두 입력이 다르면 Supabase 를 호출하지 않고 화면에서 알린다', async () => {
    landOn('#access_token=recovery-token&type=recovery');
    const fetchMock = vi.mocked(fetch);
    const { container } = render(<PasswordSetForm {...AUTH} />);
    await waitFor(() => {
      expect(container.querySelector('input[name="password"]')).not.toBeNull();
    });

    fireEvent.change(container.querySelector('input[name="password"]') as HTMLInputElement, {
      target: { value: 'new-password-123' },
    });
    fireEvent.change(container.querySelector('input[name="password_confirm"]') as HTMLInputElement, {
      target: { value: 'different-456' },
    });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => {
      expect(container.textContent).toContain('서로 다릅니다');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('토큰이 거절(401)되면 만료 안내로 바뀌고 폼이 닫힌다', async () => {
    landOn('#access_token=dead-token&type=recovery');
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{"error_code":"bad_jwt"}', { status: 401 }));

    const { container } = render(<PasswordSetForm {...AUTH} />);
    await waitFor(() => {
      expect(container.querySelector('input[name="password"]')).not.toBeNull();
    });
    fireEvent.change(container.querySelector('input[name="password"]') as HTMLInputElement, {
      target: { value: 'new-password-123' },
    });
    fireEvent.change(container.querySelector('input[name="password_confirm"]') as HTMLInputElement, {
      target: { value: 'new-password-123' },
    });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => {
      expect(container.textContent).toContain('만료되었거나 이미 사용되었습니다');
    });
    expect(container.querySelector('input[name="password"]')).toBeNull();
  });

  it('약한 비밀번호 거부(weak_password)는 사람 문구로 바꿔 보여주고 폼을 유지한다', async () => {
    landOn('#access_token=recovery-token&type=recovery');
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue(new Response('{"error_code":"weak_password"}', { status: 422 }));

    const { container } = render(<PasswordSetForm {...AUTH} />);
    await waitFor(() => {
      expect(container.querySelector('input[name="password"]')).not.toBeNull();
    });
    fireEvent.change(container.querySelector('input[name="password"]') as HTMLInputElement, {
      target: { value: 'new-password-123' },
    });
    fireEvent.change(container.querySelector('input[name="password_confirm"]') as HTMLInputElement, {
      target: { value: 'new-password-123' },
    });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => {
      expect(container.textContent).toContain('추측하기 어려운 비밀번호');
    });
    expect(container.querySelector('input[name="password"]')).not.toBeNull();
  });
});

describe('비밀번호 설정 페이지 (서버)', () => {
  it('Supabase env 가 있으면 설정 폼을 렌더한다', () => {
    const { container } = render(<PasswordPage />);
    expect(container.querySelector('main.preview-gate')).not.toBeNull();
  });

  it('env 가 없으면 표면을 닫고 안내한다', () => {
    vi.stubEnv('CCC_SUPABASE_PUBLISHABLE_KEY', '');
    const { container } = render(<PasswordPage />);
    expect(container.textContent).toContain('설정할 수 없습니다');
  });
});
