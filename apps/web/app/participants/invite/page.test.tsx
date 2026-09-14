import { afterEach, describe, expect, it, vi } from 'vitest';

import ParticipantInvitePage from './page';
const { notFound } = vi.hoisted(() => ({
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));

vi.mock('next/navigation', () => ({ notFound }));
vi.mock('./invite-issue', () => ({ InviteIssue: () => null }));
vi.mock('../../lib/display-labels', () => ({
  getDisplayLabels: vi.fn(async () => ({
    orgLabel: '기관',
    programLabels: { financial_support_v1: '사업' },
  })),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  notFound.mockClear();
});


describe('첫 출고 당사자 직접 접점', () => {
  it('기존 공개 가입 capability가 꺼져 있으면 요청 링크 발급 화면도 열지 않는다', async () => {
    vi.stubEnv('PUBLIC_SIGNUP_ENABLED', undefined);

    await expect(ParticipantInvitePage()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(notFound).toHaveBeenCalledTimes(1);
  });
});
