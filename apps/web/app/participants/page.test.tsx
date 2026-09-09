import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ParticipantsPage from './page';

const { redirect, listAssignedParticipants, FakeApiError } = vi.hoisted(() => {
  const redirect = vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
  const listAssignedParticipants = vi.fn();
  class FakeApiError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  }
  return { redirect, listAssignedParticipants, FakeApiError };
});
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }));
vi.mock('../lib/api', () => ({
  ApiError: FakeApiError,
  listAssignedParticipants: () => listAssignedParticipants(),
}));

beforeEach(() => {
  vi.stubEnv('CCC_PREVIEW', 'false');
  redirect.mockClear();
  listAssignedParticipants.mockReset();
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('ParticipantsPage preview session recovery', () => {
  it('만료된 미리보기 세션은 코드 입력 화면으로 보낸다', async () => {
    vi.stubEnv('CCC_PREVIEW', 'true');
    listAssignedParticipants.mockRejectedValue(new FakeApiError('authentication_required'));

    await expect(ParticipantsPage()).rejects.toThrow('NEXT_REDIRECT:/preview');
    expect(redirect).toHaveBeenCalledWith('/preview');
  });

  it('운영 인증 오류는 미리보기 화면으로 보내지 않는다', async () => {
    listAssignedParticipants.mockRejectedValue(new FakeApiError('authentication_required'));

    const markup = renderToStaticMarkup(await ParticipantsPage());
    expect(redirect).not.toHaveBeenCalled();
    expect(markup).toContain('role="alert"');
  });

  it('미리보기의 다른 API 오류는 기존 오류 안내를 유지한다', async () => {
    vi.stubEnv('CCC_PREVIEW', 'true');
    listAssignedParticipants.mockRejectedValue(new FakeApiError('access_denied'));

    const markup = renderToStaticMarkup(await ParticipantsPage());
    expect(redirect).not.toHaveBeenCalled();
    expect(markup).toContain('role="alert"');
  });
});
