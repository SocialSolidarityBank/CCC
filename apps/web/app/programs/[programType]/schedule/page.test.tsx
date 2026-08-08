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

function section(container: HTMLElement, name: 'today' | 'upcoming'): HTMLElement {
  return container.querySelector(`[data-testid="schedule-${name}"]`) as HTMLElement;
}

describe('다가오는 일정 화면', () => {
  // CCC-57: 서버는 창 안의 일정을 상태 구분 없이 전부 내려 준다. 이 화면의 카드에는 상태
  // 표시가 없어서, 거르지 않으면 끝난 상담이 예정 건과 똑같은 모습으로 남는다. 그것이
  // 티켓이 없애려는 '유령 예정 일정'이다. 지난 일정은 '전체 일정' 화면 몫이다(D54).
  //
  // CCC-66 으로 이 규칙은 **다가오는 칸에만** 걸린다. 오늘 칸은 아래 별도 테스트가 본다.
  it('앞으로 올 날짜에서 완료·취소·불참을 내리고 예정만 남긴다', async () => {
    // 전부 board.date(2026-02-15) 이후 날짜다. 오늘 칸은 상태를 거르지 않으므로,
    // 거르기를 보려면 앞으로 올 날짜여야 한다.
    const later = '2026-02-18T01:00:00.000Z';
    getUpcomingSchedules.mockResolvedValue(board([
      schedule({ id: 'done', status: 'completed', completedSessionId: 'session-1', participantName: '완료된사람', scheduledAt: later }),
      schedule({ id: 'live', status: 'scheduled', participantName: '예정인사람', scheduledAt: later }),
      schedule({ id: 'off', status: 'cancelled', participantName: '취소된사람', scheduledAt: later }),
      schedule({ id: 'absent', status: 'no_show', participantName: '불참한사람', scheduledAt: later }),
    ]));

    const { container } = await renderPage();

    const upcoming = section(container, 'upcoming');
    expect(cards(upcoming)).toHaveLength(1);
    expect(upcoming.textContent).toContain('예정인사람');
    expect(upcoming.textContent).not.toContain('완료된사람');
    expect(upcoming.textContent).not.toContain('취소된사람');
    expect(upcoming.textContent).not.toContain('불참한사람');
  });

  /**
   * CCC-66(2026-08-08 Q 결정): 오늘 칸은 상태를 거르지 않는다. "오늘 3건 중 1건 끝"을 보는
   * 자리라, 끝난 건도 완료 배지를 달고 남아야 한다. 이 예외가 사라지면 오늘 상담을 마치는
   * 순간 카드가 오늘 칸에서 증발한다.
   */
  it('오늘 칸은 끝난 상담도 배지와 함께 남긴다', async () => {
    getUpcomingSchedules.mockResolvedValue(board([
      // board.date 는 2026-02-15, 시간대는 Asia/Seoul 이다.
      schedule({ id: 'today-done', status: 'completed', participantName: '오늘끝난사람' }),
      schedule({ id: 'today-live', status: 'scheduled', participantName: '오늘남은사람', scheduledAt: '2026-02-15T05:00:00.000Z' }),
      schedule({ id: 'later', status: 'scheduled', participantName: '나중사람', scheduledAt: '2026-02-18T01:00:00.000Z' }),
    ]));

    const { container } = await renderPage();

    const today = section(container, 'today');
    expect(today.textContent).toContain('오늘끝난사람');
    expect(today.textContent).toContain('오늘남은사람');
    expect(Array.from(today.querySelectorAll('.wire-badge')).map((el) => el.textContent)).toContain('완료');
    // 다른 날짜는 오늘 칸에 섞이지 않는다.
    expect(today.textContent).not.toContain('나중사람');
    expect(section(container, 'upcoming').textContent).toContain('나중사람');
  });

  /**
   * '오늘'은 기관 시간대로 정한다. UTC 로 자르면 한국 시간 아침 9시(00:00Z)가 전날로 밀려
   * 오늘 상담이 '다가오는' 칸에 떨어진다. 서버가 준 board.date 와 같은 기준을 써야 한다.
   */
  it('자정 근처 일정도 기관 시간대 기준으로 오늘에 넣는다', async () => {
    getUpcomingSchedules.mockResolvedValue(board([
      // 2026-02-15T00:30Z = 서울 2026-02-15 09:30 → 오늘.
      schedule({ id: 'morning', scheduledAt: '2026-02-15T00:30:00.000Z', participantName: '아침사람' }),
      // 2026-02-15T15:30Z = 서울 2026-02-16 00:30 → 내일.
      schedule({ id: 'past-midnight', scheduledAt: '2026-02-15T15:30:00.000Z', participantName: '자정넘긴사람' }),
    ]));

    const { container } = await renderPage();

    expect(section(container, 'today').textContent).toContain('아침사람');
    expect(section(container, 'today').textContent).not.toContain('자정넘긴사람');
    expect(section(container, 'upcoming').textContent).toContain('자정넘긴사람');
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
