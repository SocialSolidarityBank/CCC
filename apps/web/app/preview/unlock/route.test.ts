import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

const mocks = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return {
    FakeApiError,
    requestPreviewUnlock: vi.fn(),
  };
});

vi.mock('../../lib/api', () => ({
  ApiError: mocks.FakeApiError,
  requestPreviewUnlock: mocks.requestPreviewUnlock,
}));

function request(fields: Record<string, string>): NextRequest {
  return new NextRequest('https://preview.test/preview/unlock', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields),
  });
}

beforeEach(() => {
  mocks.requestPreviewUnlock.mockReset();
});

describe('POST /preview/unlock', () => {
  it('실무자 코드를 검증하고 쿠키와 함께 홈으로 303 이동한다', async () => {
    mocks.requestPreviewUnlock.mockResolvedValue({
      token: 'signed-preview-token',
      maxAgeSeconds: 604_800,
    });

    const response = await POST(request({ mode: 'counselor', code: 'regular-code' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://preview.test/');
    const cookie = response.headers.get('set-cookie');
    expect(cookie).toContain('ccc_preview=signed-preview-token');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie?.toLowerCase()).toContain('samesite=strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=604800');
  });

  it('기관 관리자 코드는 설정 화면으로 303 이동한다', async () => {
    mocks.requestPreviewUnlock.mockResolvedValue({
      token: 'signed-admin-token',
      maxAgeSeconds: 604_800,
    });

    const response = await POST(request({ mode: 'admin', code: 'admin-code' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('https://preview.test/settings');
    expect(response.headers.get('set-cookie')).toContain('ccc_preview=signed-admin-token');
  });

  it('틀린 기관 관리자 코드는 기관 관리자 입력 화면으로 돌려보낸다', async () => {
    mocks.requestPreviewUnlock.mockRejectedValue(
      new mocks.FakeApiError('authentication_required'),
    );

    const response = await POST(request({ mode: 'admin', code: 'wrong-code' }));

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(
      'https://preview.test/preview/admin?error=invalid_request',
    );
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
