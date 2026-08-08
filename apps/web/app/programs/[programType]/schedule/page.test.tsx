import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다. 없으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 종료코드가 1 이 된다(schedule-cards.test 참조).
afterEach(cleanup);

const getUpcomingSchedules = vi.fn();

vi.mock('../../../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  getUpcomingSchedules: () => getUpcomingSchedules(),
  rememberLastProgramType: () => undefined,
}));

const { default: ProgramSchedulePage } = await import('./page');

function schedule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    supportCaseId: 'case-1',
    beneficiaryId: 'swallow-003',
    scheduledAt: '2026-02-15T01:00:00.000Z',
    programType: 'financial_support_v1',
    status: 'scheduled',
    sessionKind: 'regular',
    channel: 'in_person',
    participantName: '김철수',
    participantPhone: '010-1234-5678',
    completedSessionId: null,
    ...overrides,
  };
}

function board(schedules: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    date: '2026-02-15',
    timeZone: 'Asia/Seoul',
    startUtc: '2026-02-14T15:00:00.000Z',
    endUtc: '2026-02-22T15:00:00.000Z',
    schedules,
  };
}

async function renderPage() {
  const element = await ProgramSchedulePage({
    params: Promise.resolve({ programType: 'financial_support_v1' }),
  });
  return render(element);
}

function cards(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.participant-card'));
}

beforeEach(() => {
  getUpcomingSchedules.mockReset();
});

describe('다가오는 일정 화면', () => {
  // CCC-57: 서버는 창 안의 일정을 상태 구분 없이 전부 내려 준다. 이 화면의 카드에는 상태
  // 표시가 없어서, 거르지 않으면 끝난 상담이 예정 건과 똑같은 모습으로 남는다. 그것이
  // 티켓이 없애려는 '유령 예정 일정'이다. 지난 일정은 '전체 일정' 화면 몫이다(D54).
  it('완료·취소·불참은 목록에서 내리고 예정만 남긴다', async () => {
    getUpcomingSchedules.mockResolvedValue(board([
      schedule({ id: 'done', status: 'completed', completedSessionId: 'session-1', participantName: '완료된사람' }),
      schedule({ id: 'live', status: 'scheduled', participantName: '예정인사람' }),
      schedule({ id: 'off', status: 'cancelled', participantName: '취소된사람' }),
      schedule({ id: 'absent', status: 'no_show', participantName: '불참한사람' }),
    ]));

    const { container } = await renderPage();

    expect(cards(container)).toHaveLength(1);
    expect(container.textContent).toContain('예정인사람');
    expect(container.textContent).not.toContain('완료된사람');
    expect(container.textContent).not.toContain('취소된사람');
    expect(container.textContent).not.toContain('불참한사람');
  });

  // 사업 유형 거르기는 원래 있던 규칙이다. 상태 거르기를 얹으면서 깨지지 않았는지 함께 본다.
  it('다른 사업 유형은 여전히 걸러 낸다', async () => {
    getUpcomingSchedules.mockResolvedValue(board([
      schedule({ id: 'mine', participantName: '이사업사람' }),
      schedule({ id: 'other', programType: 'other_program_v1', participantName: '다른사업사람' }),
    ]));

    const { container } = await renderPage();

    expect(cards(container)).toHaveLength(1);
    expect(container.textContent).toContain('이사업사람');
    expect(container.textContent).not.toContain('다른사업사람');
  });
});
