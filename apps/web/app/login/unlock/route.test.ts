import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
}));

vi.mock('../../lib/supabase-auth', () => ({
  signInWithPassword: mocks.signInWithPassword,
}));

function request(fields: Record<string, string>, origin: string | null = 'https://ccc.test'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (origin !== null) headers.origin = origin;
  return new NextRequest('https://ccc.test/login/unlock', {
    method: 'POST',
    headers,
    body: new URLSearchParams(fields),
  });
}

beforeEach(() => {
  mocks.signInWithPassword.mockReset();
});

describe('POST /login/unlock', () => {
  it('다른 출처와 Origin 없는 POST는 자격을 처리하지 않는다', async () => {
    for (const origin of ['https://evil.example', null]) {
      const response = await POST(request({ email: 'a@b.org', password: 'pw' }, origin));
      expect(response.status).toBe(403);
      expect(response.headers.get('set-cookie')).toBeNull();
    }
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it('로그인에 성공하면 ccc_auth HttpOnly 쿠키를 심고 next 로 303 이동한다', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      status: 'ok',
      session: { accessToken: 'supabase-access-token', expiresIn: 3600 },
    });

    const response = await POST(request({ email: 'worker@example.org', password: 'pw', next: '/settings' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://ccc.test/settings');
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('ccc_auth=supabase-access-token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie?.toLowerCase()).toContain('samesite=strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=3600');
  });

  it('next 가 없으면 홈으로 간다', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      status: 'ok',
      session: { accessToken: 'tok', expiresIn: 3600 },
    });

    const response = await POST(request({ email: 'a@b.org', password: 'pw' }));
    expect(response.headers.get('location')).toBe('https://ccc.test/');
  });

  it('외부 주소 next 는 홈으로 눌러 담는다 — 열린 리다이렉트 방지', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      status: 'ok',
      session: { accessToken: 'tok', expiresIn: 3600 },
    });

    const response = await POST(request({ email: 'a@b.org', password: 'pw', next: 'https://evil.example/' }));
    expect(response.headers.get('location')).toBe('https://ccc.test/');
  });

  it('백슬래시로 호스트를 우회하는 next 도 홈으로 눌러 담는다', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      status: 'ok',
      session: { accessToken: 'tok', expiresIn: 3600 },
    });

    const response = await POST(request({ email: 'a@b.org', password: 'pw', next: '/\\evil.example/path' }));
    expect(response.headers.get('location')).toBe('https://ccc.test/');
  });

  it('제어 문자 정규화로 호스트를 우회하는 next 도 홈으로 눌러 담는다', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      status: 'ok',
      session: { accessToken: 'tok', expiresIn: 3600 },
    });

    const response = await POST(request({ email: 'a@b.org', password: 'pw', next: '/\t/evil.example/path' }));
    expect(response.headers.get('location')).toBe('https://ccc.test/');
  });

  it('없는 이메일과 틀린 비밀번호는 같은 실패다 — 계정 존재 여부를 가르지 않는다', async () => {
    // 공급자가 무엇을 돌려주든 화면으로 가는 코드는 login_failed 하나다.
    mocks.signInWithPassword.mockResolvedValue({ status: 'invalid_credentials' });

    const response = await POST(request({ email: 'nobody@example.org', password: 'pw' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://ccc.test/login?error=login_failed');
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('이메일 미확인 계정은 확인 안내로 보낸다', async () => {
    mocks.signInWithPassword.mockResolvedValue({ status: 'confirm_email' });

    const response = await POST(request({ email: 'a@b.org', password: 'pw' }));
    expect(response.headers.get('location')).toBe('https://ccc.test/login?error=confirm_email');
  });

  it('공급자 장애는 service_unavailable 로 보낸다', async () => {
    mocks.signInWithPassword.mockResolvedValue({ status: 'unavailable' });

    const response = await POST(request({ email: 'a@b.org', password: 'pw' }));
    expect(response.headers.get('location')).toBe('https://ccc.test/login?error=service_unavailable');
  });

  it('빈 칸은 공급자를 부르지 않고 실패로 돌아간다', async () => {
    const response = await POST(request({ email: '', password: '' }));
    expect(response.headers.get('location')).toBe('https://ccc.test/login?error=login_failed');
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });
});
