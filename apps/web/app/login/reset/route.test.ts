import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const mocks = vi.hoisted(() => ({
  requestPasswordReset: vi.fn(),
}));

vi.mock('../../lib/supabase-auth', () => ({
  requestPasswordReset: mocks.requestPasswordReset,
}));

function request(fields: Record<string, string>, origin: string | null = 'https://ccc.test'): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/x-www-form-urlencoded' };
  if (origin !== null) headers.origin = origin;
  return new NextRequest('https://ccc.test/login/reset', {
    method: 'POST',
    headers,
    body: new URLSearchParams(fields),
  });
}

beforeEach(() => {
  mocks.requestPasswordReset.mockReset();
});

describe('POST /login/reset', () => {
  it('다른 출처와 Origin 없는 POST는 요청을 처리하지 않는다', async () => {
    for (const origin of ['https://evil.example', null]) {
      const response = await POST(request({ email: 'a@b.org' }, origin));
      expect(response.status).toBe(403);
    }
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('어떤 이메일이든 같은 안내로 돌아간다 — 계정 존재 여부를 가르지 않는다', async () => {
    mocks.requestPasswordReset.mockResolvedValue({ status: 'ok' });

    const response = await POST(request({ email: 'worker@example.org' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://ccc.test/login?notice=reset_sent');
    // 착지 경로는 요청 출처의 /password 다.
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith(
      'worker@example.org',
      'https://ccc.test/password',
    );
  });

  it('빈 이메일은 Supabase 를 호출하지 않고 조용히 로그인으로 돌아간다', async () => {
    const response = await POST(request({ email: '  ' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://ccc.test/login');
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('메일을 보낼 수 없으면(unavailable) 실패 문구로 돌아간다', async () => {
    mocks.requestPasswordReset.mockResolvedValue({ status: 'unavailable' });

    const response = await POST(request({ email: 'worker@example.org' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://ccc.test/login?error=reset_unavailable');
  });
});
