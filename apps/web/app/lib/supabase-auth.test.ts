import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { signInOrSignUpWithPassword } = await import('./supabase-auth');
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv('CCC_SUPABASE_AUTH_ORIGIN', 'https://project.supabase.co');
  vi.stubEnv('CCC_SUPABASE_PUBLISHABLE_KEY', 'publishable-key');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('signInOrSignUpWithPassword', () => {
  it('기존 확인 완료 계정은 가입을 시도하지 않고 로그인 세션을 쓴다', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ access_token: 'existing-token', expires_in: 3600 })));

    await expect(signInOrSignUpWithPassword('worker@example.org', 'pw')).resolves.toEqual({
      status: 'ok',
      session: { accessToken: 'existing-token', expiresIn: 3600 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/token?grant_type=password');
  });

  it('로그인 자격이 없을 때만 새 계정을 만든다', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error_code: 'invalid_credentials' }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-token', expires_in: 1800 })));

    await expect(signInOrSignUpWithPassword('new@example.org', 'pw')).resolves.toEqual({
      status: 'ok',
      session: { accessToken: 'new-token', expiresIn: 1800 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/signup');
  });
});
