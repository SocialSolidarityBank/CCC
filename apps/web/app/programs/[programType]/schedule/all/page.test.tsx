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

function cards(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.participant-card'));
}

function cellTexts(card: HTMLElement): (string | null)[] {
  return Array.from(card.querySelectorAll('.participant-card-cell')).map((el) => el.textContent);
}

function badgeTexts(card: HTMLElement): (string | null)[] {
  return Array.from(card.querySelectorAll('.wire-badge')).map((el) => el.textContent);
}

beforeEach(() => {
  getMonthSchedules.mockReset();
});

// 2026-08-06 Q 카드 통일: 날짜 묶음이 사라지고 다가오는 일정과 같은 당사자 카드가 됐다.
// 2026-08-07 행 순서 교체: 이름 행이 위, 날짜·시간·종류 뱃지(지난 일정은 상태 뱃지 추가)는
// 가로선 아래다.
describe('전체 일정 화면 (CCC-19)', () => {
  it('일정마다 당사자 카드 한 장 — 이름 행 위, 날짜·시간·종류 뱃지는 가로선 아래', async () => {
    getMonthSchedules.mockResolvedValue(board([
      schedule(),
      schedule({ id: 's2', scheduledAt: '2026-02-15T05:00:00.000Z', participantName: '이영희', beneficiaryId: 'crane-001' }),
      schedule({ id: 's3', scheduledAt: '2026-02-20T01:00:00.000Z', sessionKind: 'intake' }),
    ]));

    const { container } = await renderPage('2026-02');

    const rendered = cards(container);
    expect(rendered).toHaveLength(3);

    // 서버가 준 시간순 그대로다.
    const first = cellTexts(rendered[0]!);
    expect(first).toContain('2026년 2월 15일');
    expect(first).toContain('오전 10:00');
    expect(first).toContain('김철수');
    expect(first).toContain('swallow-003'); // 가명 ID 칸(2026-08-06 복귀)
    expect(first).toContain('010-1234-5678');
    expect(cellTexts(rendered[1]!)).toContain('오후 2:00');
    expect(cellTexts(rendered[2]!)).toContain('2026년 2월 20일');

    // 상담 종류 뱃지 — 블루 계열(일정 축, D34).
    expect(badgeTexts(rendered[0]!)).toContain('기본 상담');
    expect(badgeTexts(rendered[2]!)).toContain('인테이크');
  });

  it('완료된 회차는 그 회차가 펼쳐진 상담 기록으로, 나머지는 브리핑으로 보낸다', async () => {
    getMonthSchedules.mockResolvedValue(board([
      schedule({ id: 's1', status: 'completed', completedSessionId: 'sess-9' }),
      schedule({ id: 's2', scheduledAt: '2026-02-16T01:00:00.000Z' }),
    ]));

    const { container } = await renderPage('2026-02');

    const hrefs = Array.from(container.querySelectorAll('.card-grid > a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/participants/swallow-003/programs/case-1/records#record-sess-9',
      '/participants/swallow-003/programs/case-1/briefing',
    ]);
  });

  it('상태 뱃지는 지난 일정에만 붙는다 — 예정에는 붙이지 않는다', async () => {
    getMonthSchedules.mockResolvedValue(board([
      schedule({ id: 's1', status: 'scheduled' }),
      schedule({ id: 's2', scheduledAt: '2026-02-16T01:00:00.000Z', status: 'cancelled' }),
      schedule({ id: 's3', scheduledAt: '2026-02-17T01:00:00.000Z', status: 'no_show' }),
      schedule({ id: 's4', scheduledAt: '2026-02-18T01:00:00.000Z', status: 'completed', completedSessionId: 'sess-4' }),
    ]));

    const { container } = await renderPage('2026-02');

    // 카드마다 첫 뱃지는 상담 종류다 — 상태는 그 다음 뱃지로만 온다.
    const statuses = cards(container).map((card) => badgeTexts(card)[1] ?? null);
    expect(statuses).toEqual([null, '취소', '불참', '완료']);
  });

  it('다른 사업의 일정은 이 화면에 오지 않는다 (D35 — 범위는 워크스페이스가 정한다)', async () => {
    getMonthSchedules.mockResolvedValue(board([
      schedule({ id: 's1' }),
      schedule({ id: 's2', programType: 'other_program_v1' }),
    ]));

    const { container } = await renderPage('2026-02');

    expect(cards(container)).toHaveLength(1);
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
