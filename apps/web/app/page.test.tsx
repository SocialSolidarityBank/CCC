import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DEFAULT_PROGRAM_TYPE } from './lib/labels';

// `/`는 화면이 아니라 리다이렉트다 (D35 · ADR-0014 §2 — 구 조직 아코디언 폐기).
// next/navigation 의 redirect 는 예외를 던져 렌더를 중단하므로, 렌더 결과가 아니라
// **어디로 보냈는지**를 검증한다.
const redirect = vi.fn((path: string) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});
vi.mock('next/navigation', () => ({ redirect: (path: string) => redirect(path) }));

const getLastProgramType = vi.hoisted(() => vi.fn());
class FakeApiError extends Error {}
vi.mock('./lib/api', () => ({
  ApiError: FakeApiError,
  getLastProgramType: () => getLastProgramType(),
}));

async function go(): Promise<string> {
  const { default: HomePage } = await import('./page');
  await expect(HomePage()).rejects.toThrow(/NEXT_REDIRECT/);
  return redirect.mock.calls.at(-1)?.[0] ?? '';
}

beforeEach(() => {
  redirect.mockClear();
  getLastProgramType.mockReset();
});

describe('HomePage (마지막에 보던 사업으로 직행)', () => {
  it('계정에 저장된 사업의 일정으로 보낸다', async () => {
    getLastProgramType.mockResolvedValue(DEFAULT_PROGRAM_TYPE);
    expect(await go()).toBe(`/programs/${DEFAULT_PROGRAM_TYPE}/schedule`);
  });

  it('아직 고른 적이 없으면 첫 사업으로 폴백한다', async () => {
    getLastProgramType.mockResolvedValue(null);
    expect(await go()).toBe(`/programs/${DEFAULT_PROGRAM_TYPE}/schedule`);
  });

  it('저장된 사업이 사라졌으면 첫 사업으로 폴백한다 — 404 를 내지 않는다', async () => {
    getLastProgramType.mockResolvedValue('retired_program_v0');
    expect(await go()).toBe(`/programs/${DEFAULT_PROGRAM_TYPE}/schedule`);
  });

  it('신원 조회가 실패해도 홈은 열린다', async () => {
    // 홈이 막히면 앱 전체가 막힌다. 접근 권한 문제라면 목적지 화면이 다시 판정한다.
    getLastProgramType.mockRejectedValue(new FakeApiError('service_unavailable'));
    expect(await go()).toBe(`/programs/${DEFAULT_PROGRAM_TYPE}/schedule`);
  });
});
