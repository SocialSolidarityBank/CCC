import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다 — 없으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 종료코드가 1 이 된다(schedule-cards.test 참조).
afterEach(cleanup);

const getMonthSchedules = vi.fn();

vi.mock('../../../../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  getMonthSchedules: (month?: string) => getMonthSchedules(month),
}));

const { default: ProgramScheduleAllPage } = await import('./page');

function schedule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    supportCaseId: 'case-1',
    beneficiaryId: 'swallow-003',
    scheduledAt: '2026-02-15T01:00:00.000Z', // KST 02-15 10:00
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
    date: '2026-02-01',
    timeZone: 'Asia/Seoul',
    startUtc: '2026-01-31T15:00:00.000Z',
    endUtc: '2026-02-28T15:00:00.000Z',
    schedules,
  };
}

async function renderPage(month?: string) {
  const element = await ProgramScheduleAllPage({
    params: Promise.resolve({ programType: 'financial_support_v1' }),
    searchParams: Promise.resolve(month === undefined ? {} : { month }),
  });
  return render(element);
}

beforeEach(() => {
  getMonthSchedules.mockReset();
});

describe('전체 일정 화면 (CCC-19)', () => {
  it('일정을 날짜별로 묶고 시간·이름·유형을 한 줄에 보여준다', async () => {
    getMonthSchedules.mockResolvedValue(board([
      schedule(),
      schedule({ id: 's2', scheduledAt: '2026-02-15T05:00:00.000Z', participantName: '이영희', beneficiaryId: 'crane-001' }),
      schedule({ id: 's3', scheduledAt: '2026-02-20T01:00:00.000Z', sessionKind: 'intake' }),
    ]));

    const { container } = await renderPage('2026-02');

    const days = container.querySelectorAll('.month-day');
    expect(days).toHaveLength(2);
    expect(days[0]!.querySelector('.month-day-title')?.textContent).toBe('2월 15일 (일)');
    expect(days[1]!.querySelector('.month-day-title')?.textContent).toBe('2월 20일 (금)');

    // 같은 날 두 건은 서버가 준 시간순 그대로 한 묶음 안에 앉는다.
    const firstDayRows = days[0]!.querySelectorAll('.month-row');
    expect(firstDayRows).toHaveLength(2);
    expect(firstDayRows[0]!.querySelector('.month-row-time')?.textContent).toBe('10:00');
    expect(firstDayRows[1]!.querySelector('.month-row-time')?.textContent).toBe('14:00');

    // 이름 표기(§5): 실명과 가명 ID 는 별도 노드이고 띄어쓰기는 간격이 만든다.
    expect(firstDayRows[0]!.querySelector('.month-row-name b')?.textContent).toBe('김철수');
    expect(firstDayRows[0]!.querySelector('.month-row-name span')?.textContent).toBe('(swallow-003)');

    expect(days[1]!.querySelector('.month-row-kind')?.textContent).toBe('인테이크');
    expect(firstDayRows[0]!.querySelector('.month-row-kind')?.textContent).toBe('기본 상담');
  });

  it('완료된 회차는 그 회차가 펼쳐진 상담 기록으로, 나머지는 브리핑으로 보낸다', async () => {
    getMonthSchedules.mockResolvedValue(board([
      schedule({ id: 's1', status: 'completed', completedSessionId: 'sess-9' }),
      schedule({ id: 's2', scheduledAt: '2026-02-16T01:00:00.000Z' }),
    ]));

    const { container } = await renderPage('2026-02');

    const hrefs = Array.from(container.querySelectorAll('.month-row')).map((row) => row.getAttribute('href'));
    expect(hrefs).toEqual([
      '/participants/swallow-003/programs/case-1/records#record-sess-9',
      '/participants/swallow-003/programs/case-1/briefing',
    ]);
  });

  it('상태 배지는 지난 일정에만 붙는다 — 예정에는 붙이지 않는다', async () => {
    getMonthSchedules.mockResolvedValue(board([
      schedule({ id: 's1', status: 'scheduled' }),
      schedule({ id: 's2', scheduledAt: '2026-02-16T01:00:00.000Z', status: 'cancelled' }),
      schedule({ id: 's3', scheduledAt: '2026-02-17T01:00:00.000Z', status: 'no_show' }),
      schedule({ id: 's4', scheduledAt: '2026-02-18T01:00:00.000Z', status: 'completed', completedSessionId: 'sess-4' }),
    ]));

    const { container } = await renderPage('2026-02');

    const statuses = Array.from(container.querySelectorAll('.month-row')).map(
      (row) => row.querySelector('.month-row-status')?.textContent ?? null,
    );
    expect(statuses).toEqual([null, '취소', '불참', '완료']);
  });

  it('다른 사업의 일정은 이 화면에 오지 않는다 (D35 — 범위는 워크스페이스가 정한다)', async () => {
    getMonthSchedules.mockResolvedValue(board([
      schedule({ id: 's1' }),
      schedule({ id: 's2', programType: 'other_program_v1' }),
    ]));

    const { container } = await renderPage('2026-02');

    expect(container.querySelectorAll('.month-row')).toHaveLength(1);
  });

  it('월 이동 링크가 앞뒤 달을 가리키고 해가 바뀌는 경계를 넘는다', async () => {
    getMonthSchedules.mockResolvedValue({ ...board([schedule()]), date: '2026-01-01' });

    const { container } = await renderPage('2026-01');

    const navHrefs = Array.from(container.querySelectorAll('.month-nav a')).map((a) => a.getAttribute('href'));
    expect(navHrefs).toEqual([
      '/programs/financial_support_v1/schedule/all?month=2025-12',
      '/programs/financial_support_v1/schedule/all?month=2026-02',
    ]);
    expect(container.querySelector('.month-nav-label')?.textContent).toBe('2026년 1월');
  });

  it('형식이 어긋난 month 는 버리고 서버가 정한 달로 떨어진다', async () => {
    getMonthSchedules.mockResolvedValue(board([schedule()]));

    await renderPage('2026-13');

    // undefined 로 넘어가야 게이트웨이가 기관 시간대의 이번 달을 고른다.
    expect(getMonthSchedules).toHaveBeenCalledWith(undefined);
  });

  it('그 달에 상담이 없으면 빈 상태 계약대로 보여준다', async () => {
    getMonthSchedules.mockResolvedValue(board([]));

    const { container } = await renderPage('2026-02');

    expect(container.querySelector('.wire-empty-title')?.textContent).toBe('2026년 2월에는 상담이 없습니다');
    // 빈 달에서도 앞뒤로 옮겨갈 수 있어야 한다 — 없으면 빈 화면에 갇힌다.
    expect(container.querySelectorAll('.month-nav a')).toHaveLength(2);
  });
});
