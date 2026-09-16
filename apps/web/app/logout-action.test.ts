import { beforeEach, describe, expect, it, vi } from 'vitest';
import { logoutAction } from './logout-action';

const mocks = vi.hoisted(() => ({
  deleteCookie: vi.fn(),
  getCookie: vi.fn(),
  fetch: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({ delete: mocks.deleteCookie, get: mocks.getCookie }),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('CCC_API_ORIGIN', 'https://api.ccc.test');
  mocks.deleteCookie.mockReset();
  mocks.getCookie.mockReset();
  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.redirect.mockClear();
});

describe('logoutAction', () => {
  it('직접 로그인 세션을 해지하고 쿠키를 지운 뒤 /login 으로 보낸다', async () => {
    mocks.getCookie.mockImplementation((name: string) => (
      name === 'ccc_auth' ? { name, value: 'supabase-token' } : undefined
    ));

    await expect(logoutAction()).rejects.toThrow('REDIRECT:/login');

    expect(mocks.fetch).toHaveBeenCalledWith(
      new URL('https://api.ccc.test/auth/logout'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ authorization: 'Bearer supabase-token' }),
      }),
    );
    expect(mocks.deleteCookie).toHaveBeenCalledWith('ccc_auth');
  });

  it('Access 세션은 직접 로그인 쿠키를 지운 뒤 Access 로그아웃으로 보낸다', async () => {
    mocks.getCookie.mockImplementation((name: string) => (
      name === 'CF_Authorization' ? { name, value: 'access-token' } : undefined
    ));

    await expect(logoutAction()).rejects.toThrow('REDIRECT:/cdn-cgi/access/logout');

    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.deleteCookie).toHaveBeenCalledWith('ccc_auth');
  });

  it('미리보기에서는 미리보기 쿠키만 지우고 기존 입구로 보낸다', async () => {
    vi.stubEnv('CCC_PREVIEW', 'true');

    await expect(logoutAction()).rejects.toThrow('REDIRECT:/preview');

    expect(mocks.deleteCookie).toHaveBeenCalledWith('ccc_preview');
    expect(mocks.deleteCookie).not.toHaveBeenCalledWith('ccc_auth');
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
