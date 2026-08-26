import { beforeEach, describe, expect, it, vi } from 'vitest';

// 구 '전체 일정' 경로는 D75(ADR-0039)로 통합 일정 화면으로 넘어가고, CCC-133 이
// 범위를 ?view= 로 바꿔 그 목적지가 월 뷰가 됐다.
// 이 테스트는 북마크·과거 링크가 깨지지 않는 것(리다이렉트 목적지)만 고정한다.

const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});
const notFound = vi.fn(() => {
  throw new Error('NEXT_NOT_FOUND');
});

vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirect(url),
  notFound: () => notFound(),
}));

const { default: ProgramScheduleAllPage } = await import('./page');

async function run(programType: string, query: Record<string, string> = {}) {
  return ProgramScheduleAllPage({
    params: Promise.resolve({ programType }),
    searchParams: Promise.resolve(query),
  });
}

beforeEach(() => {
  redirect.mockClear();
  notFound.mockClear();
});

describe('구 전체 일정 경로 (D75 · CCC-133 리다이렉트)', () => {
  it('일정 화면의 월 뷰로 보낸다', async () => {
    await expect(run('financial_support_v1')).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/programs/financial_support_v1/schedule?view=month');
  });

  it('month 쿼리를 그대로 넘긴다, 검증은 일정 화면 몫이다', async () => {
    await expect(run('financial_support_v1', { month: '2026-01' })).rejects.toThrow('NEXT_REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/programs/financial_support_v1/schedule?view=month&month=2026-01');
  });

  it('모르는 사업 유형은 리다이렉트 대신 404 다', async () => {
    await expect(run('unknown_program')).rejects.toThrow('NEXT_NOT_FOUND');
    expect(redirect).not.toHaveBeenCalled();
  });
});
