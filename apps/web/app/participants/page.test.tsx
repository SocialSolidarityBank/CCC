import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  redirect.mockClear();
  listAssignedParticipants.mockReset();
});

describe('ParticipantsPage preview session recovery', () => {
  it('만료된 미리보기 세션은 코드 입력 화면으로 보낸다', async () => {
    listAssignedParticipants.mockRejectedValue(new FakeApiError('authentication_required'));

    await expect(ParticipantsPage()).rejects.toThrow('NEXT_REDIRECT:/preview');
    expect(redirect).toHaveBeenCalledWith('/preview');
  });
});
