import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다. 없으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 종료코드가 1 이 된다.
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const getTodaySchedules = vi.fn();
const getUpcomingSchedules = vi.fn();
const getMonthSchedules = vi.fn();
const push = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
}));

vi.mock('../../../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  getTodaySchedules: (date?: string) => getTodaySchedules(date),
  getUpcomingSchedules: (date?: string) => getUpcomingSchedules(date),
  getMonthSchedules: (month?: string) => getMonthSchedules(month),
  rememberLastProgramType: () => undefined,
}));

const { default: ProgramSchedulePage } = await import('./page');
// 시각 기대값은 공용 포매터로 만든다 — '오전'과 시각 사이 공백 문자가 러너의 ICU 버전에
// 따라 달라(NBSP 등) 리터럴 비교가 CI 에서 깨진다.
const { formatKoreanTime } = await import('../../../lib/format-korean-date');

const basePath = '/programs/financial_support_v1/schedule';

// 2026-02-15 는 일요일이라 그 ISO 주간의 월요일은 2026-02-09 다.
const todayKey = '2026-02-15';
const mondayKey = '2026-02-09';

function schedule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 's1',
    supportCaseId: 'case-1',
    beneficiaryId: 'swallow-003',
    scheduledAt: '2026-02-15T01:00:00.000Z', // KST 02-15 10:00
    programType: 'financial_support_v1',
    status: 'scheduled',
    sessionKind: 'regular',
    participantName: '김철수',
    participantPhone: '010-1234-5678',
    completedSessionId: null,
    ...overrides,
  };
}

function board(date: string, schedules: Array<Record<string, unknown>>): Record<string, unknown> {
  return { date, timeZone: 'Asia/Seoul', schedules };
}

async function renderPage(query: Record<string, string> = {}) {
  const element = await ProgramSchedulePage({
    params: Promise.resolve({ programType: 'financial_support_v1' }),
    searchParams: Promise.resolve(query),
  });
  return render(element);
}

function cards(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.participant-card'));
}

function dayHeadings(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('.schedule-day-heading')).map((el) => el.textContent);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-02-15T03:00:00.000Z'));
  getTodaySchedules.mockReset();
  getUpcomingSchedules.mockReset();
  getMonthSchedules.mockReset();
  // 주간 뷰가 기관 시간대의 오늘을 알아내는 첫 호출.
  getTodaySchedules.mockResolvedValue(board(todayKey, []));
});

describe('다중 뷰 일정 화면 (CCC-133), 주간', () => {
  it('기본은 주간이고 그 주 월요일부터 여는 창을 부른다', async () => {
    getUpcomingSchedules.mockResolvedValue(board(mondayKey, [schedule()]));

    const { container } = await renderPage();

    expect(getUpcomingSchedules).toHaveBeenCalledWith(mondayKey);
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="기간 단위"]')?.value)
      .toBe('week');
  });

  // upcoming 은 8일 창이라 월요일부터 부르면 다음 월요일이 딸려 온다. 월-일로 잘라 쓴다.
  it('8일 창에서 다음 월요일 하루를 잘라 낸다', async () => {
    getUpcomingSchedules.mockResolvedValue(board(mondayKey, [
      schedule({ id: 'sun', scheduledAt: '2026-02-15T01:00:00.000Z', participantName: '일요일사람' }),
      schedule({ id: 'next-mon', scheduledAt: '2026-02-16T01:00:00.000Z', participantName: '다음월요일사람' }),
    ]));

    const { container } = await renderPage();

    expect(container.textContent).toContain('일요일사람');
    expect(container.textContent).not.toContain('다음월요일사람');
  });

  it('지난 날짜는 접힌 카드, 오늘과 미래는 펼친 카드다 — 셋 다 같은 날짜 묶음이다', async () => {
    // 기관 오늘을 주 중간(수)으로 옮긴다 — 기본 오늘(일요일)은 주의 마지막 날이라
    // 같은 주에 미래 날짜가 성립할 수 없다. todayKey 는 시스템 시계에서 파생된다.
    vi.setSystemTime(new Date('2026-02-11T03:00:00.000Z'));
    getUpcomingSchedules.mockResolvedValue(board(mondayKey, [
      schedule({ id: 'past', scheduledAt: '2026-02-10T01:00:00.000Z', status: 'completed', completedSessionId: 'sess-1', participantName: '지난사람' }),
      schedule({ id: 'today', scheduledAt: '2026-02-11T01:00:00.000Z', participantName: '오늘사람' }),
      schedule({ id: 'future', scheduledAt: '2026-02-14T01:00:00.000Z', participantName: '미래사람' }),
    ]));

    const { container } = await renderPage({ view: 'week', date: '2026-02-11' });

    const past = container.querySelector<HTMLDetailsElement>('.schedule-past-day');
    expect(past?.open).toBe(false);
    expect(past?.querySelector('summary')?.textContent).toContain('지난사람');
    // 2026-08-28 Q: 오늘·미래도 플랫 구획이 아니라 날짜 묶음 카드 안이고, 둘 다 펼침이다.
    const openDays = Array.from(container.querySelectorAll<HTMLDetailsElement>('details.schedule-day-accordion'));
    expect(openDays).toHaveLength(2);
    expect(openDays.every((day) => day.open)).toBe(true);
    expect(openDays[0]?.textContent).toContain('오늘사람');
    expect(openDays[1]?.textContent).toContain('미래사람');
  });

  it('오늘 상담은 상태와 관계없이 모두 선택 아웃라인을 입고 완료 카드만 흐려진다', async () => {
    getUpcomingSchedules.mockResolvedValue(board(mondayKey, [
      schedule({ id: 'done', status: 'completed', completedSessionId: 'sess-1', participantName: '오늘끝난사람' }),
      schedule({ id: 'live', scheduledAt: '2026-02-15T05:00:00.000Z', participantName: '오늘남은사람' }),
    ]));

    const { container } = await renderPage();

    const selected = Array.from(container.querySelectorAll('.participant-card[data-selected="true"]'));
    expect(selected).toHaveLength(2);
    expect(selected[0]?.getAttribute('data-muted')).toBe('true');
    expect(selected[1]?.getAttribute('data-muted')).toBeNull();
  });

  // CCC-66: 오늘 묶음은 "3건 중 1건 끝"을 보는 자리라 끝난 건도 배지와 함께 남는다.
  it('오늘 묶음은 끝난 상담도 배지와 함께 남긴다', async () => {
    getUpcomingSchedules.mockResolvedValue(board(mondayKey, [
      schedule({ id: 'done', status: 'completed', completedSessionId: 'sess-1', participantName: '오늘끝난사람' }),
    ]));

    const { container } = await renderPage();

    expect(container.textContent).toContain('오늘끝난사람');
    expect(Array.from(container.querySelectorAll('.participant-card .wire-badge')).map((el) => el.textContent))
      .toContain('완료');
  });

  // CCC-57: 앞으로 올 날짜에서 끝난 건이 서 있으면 유령 예정 일정이다.
  it('앞으로 올 날짜는 예정만 남기고 지난 날짜는 상태를 전부 보여 준다', async () => {
    getUpcomingSchedules.mockResolvedValue(board(mondayKey, [
      schedule({ id: 'past-cancel', scheduledAt: '2026-02-10T01:00:00.000Z', status: 'cancelled', participantName: '지난취소사람' }),
      schedule({ id: 'future-cancel', scheduledAt: '2026-02-16T01:00:00.000Z', status: 'cancelled', participantName: '미래취소사람' }),
    ]));

    const { container } = await renderPage({ view: 'week', date: '2026-02-11' });

    expect(container.textContent).toContain('지난취소사람');
    expect(container.textContent).not.toContain('미래취소사람');
  });

  it('그 주에 상담이 없으면 빈 상태를 보여 준다', async () => {
    getUpcomingSchedules.mockResolvedValue(board(mondayKey, []));

    const { container } = await renderPage();

    expect(container.querySelector('.wire-empty-title')?.textContent).toBe('이 주에는 상담이 없습니다');
  });
});

describe('다중 뷰 일정 화면 (CCC-133), 일간', () => {
  it('그 날 하루만 부르고 카드만 세운다', async () => {
    getTodaySchedules.mockResolvedValue(board('2026-02-15', [schedule()]));

    const { container } = await renderPage({ view: 'day', date: '2026-02-15' });

    expect(getTodaySchedules).toHaveBeenCalledWith('2026-02-15');
    expect(cards(container)).toHaveLength(1);
    // 날짜 이름은 내비가 갖는다. 본문에 날짜 제목과 아코디언을 두지 않는다.
    expect(dayHeadings(container)).toHaveLength(0);
    expect(container.querySelector('.schedule-past-day')).toBeNull();
    expect(container.textContent).toContain(formatKoreanTime('2026-02-15T01:00:00.000Z'));
  });

  it('어긋난 날짜는 버리고 서버가 정한 오늘로 떨어진다', async () => {
    getTodaySchedules.mockResolvedValue(board('2026-02-15', [schedule()]));

    await renderPage({ view: 'day', date: '2026-02-31' });

    expect(getTodaySchedules).toHaveBeenCalledWith(undefined);
  });

  it('그 날에 상담이 없으면 날짜를 적은 빈 상태를 보여 준다', async () => {
    getTodaySchedules.mockResolvedValue(board('2026-02-15', []));

    const { container } = await renderPage({ view: 'day', date: '2026-02-15' });

    expect(container.querySelector('.wire-empty-title')?.textContent)
      .toBe('2026년 2월 15일(일)에는 상담이 없습니다');
  });
});

describe('다중 뷰 일정 화면 (CCC-133), 월간', () => {
  it('오늘이 최상단이고 미래·지난 순으로 이어지며 오늘만 펼쳐 둔다 (2026-08-28 Q)', async () => {
    getMonthSchedules.mockResolvedValue(board('2026-02-01', [
      schedule({ id: 'past', scheduledAt: '2026-02-03T01:00:00.000Z', status: 'completed', completedSessionId: 'sess-3', participantName: '지난사람' }),
      schedule({ id: 'today', participantName: '오늘사람' }),
      schedule({ id: 'future', scheduledAt: '2026-02-20T01:00:00.000Z', participantName: '미래사람' }),
    ]));

    const { container } = await renderPage({ view: 'month', month: '2026-02' });

    expect(getMonthSchedules).toHaveBeenCalledWith('2026-02');
    const rows = Array.from(container.querySelectorAll<HTMLDetailsElement>('details'));
    expect(rows).toHaveLength(3);
    // 예약이 많은 달에서 오늘이 시간순에 묻히지 않는다 — D75 '오늘 최상단' 계약의 월간 적용.
    expect(rows.map((row) => row.open)).toEqual([true, false, false]);
    expect(dayHeadings(container)).toEqual([
      expect.stringContaining('2월 15일'),
      expect.stringContaining('2월 20일'),
      expect.stringContaining('2월 3일'),
    ]);
    expect(container.querySelector('.schedule-week-title')).toBeNull();
  });

  it('오늘이 없는 달은 전부 닫힌 채로 연다', async () => {
    getMonthSchedules.mockResolvedValue(board('2026-03-01', [
      schedule({ id: 'a', scheduledAt: '2026-03-03T01:00:00.000Z' }),
      schedule({ id: 'b', scheduledAt: '2026-03-10T01:00:00.000Z' }),
    ]));

    const { container } = await renderPage({ view: 'month', month: '2026-03' });

    expect(Array.from(container.querySelectorAll<HTMLDetailsElement>('details')).map((row) => row.open))
      .toEqual([false, false]);
  });

  it('펼친 오늘 줄은 조회일 뿐이라 선택 표면을 입지 않는다', async () => {
    getMonthSchedules.mockResolvedValue(board('2026-02-01', [schedule({ id: 'today' })]));

    const { container } = await renderPage({ view: 'month', month: '2026-02' });

    const openRow = container.querySelector<HTMLDetailsElement>('details[open]');
    expect(openRow?.className).toContain('schedule-day-accordion');
    // 2026-08-28 채움 전면 적용 후에도 지난 날짜 흐림(.schedule-past-day)과는 갈려야 한다.
    expect(openRow?.className).not.toContain('schedule-past-day');
  });

  it('지난 줄만 흐려지고 미래 줄은 흐려지지 않는다', async () => {
    getMonthSchedules.mockResolvedValue(board('2026-02-01', [
      schedule({ id: 'past', scheduledAt: '2026-02-03T01:00:00.000Z' }),
      schedule({ id: 'future', scheduledAt: '2026-02-20T01:00:00.000Z' }),
    ]));

    const { container } = await renderPage({ view: 'month', month: '2026-02' });

    expect(container.querySelectorAll('.schedule-past-day')).toHaveLength(1);
    expect(container.querySelectorAll('.schedule-day-accordion')).toHaveLength(1);
  });

  it('완료된 회차는 그 회차가 펼쳐진 상담 기록으로, 나머지는 브리핑으로 보낸다', async () => {
    getMonthSchedules.mockResolvedValue(board('2026-02-01', [
      schedule({ id: 's1', scheduledAt: '2026-02-03T01:00:00.000Z', status: 'completed', completedSessionId: 'sess-9' }),
      schedule({ id: 's2', scheduledAt: '2026-02-20T01:00:00.000Z' }),
    ]));

    const { container } = await renderPage({ view: 'month', month: '2026-02' });

    const hrefs = Array.from(container.querySelectorAll('.card-grid a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('/participants/swallow-003/programs/case-1/records#record-sess-9');
    expect(hrefs).toContain('/participants/swallow-003/programs/case-1/briefing');
  });

  it('구 range=month 링크는 월 뷰로 이어지고 month 를 살린다', async () => {
    getMonthSchedules.mockResolvedValue(board('2026-02-01', [schedule()]));

    const { container } = await renderPage({ range: 'month', month: '2026-02' });

    expect(getMonthSchedules).toHaveBeenCalledWith('2026-02');
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="기간 단위"]')?.value)
      .toBe('month');
  });

  it('그 달에 상담이 없으면 달을 적은 빈 상태를 보여 준다', async () => {
    getMonthSchedules.mockResolvedValue(board('2026-02-01', []));

    const { container } = await renderPage({ view: 'month', month: '2026-02' });

    expect(container.querySelector('.wire-empty-title')?.textContent).toBe('2026년 2월에는 상담이 없습니다');
  });
});

describe('다중 뷰 일정 화면 (CCC-133), 내비', () => {
  it('기간 단위 선택창 하나에 일간·주간·월간이 선다', async () => {
    getUpcomingSchedules.mockResolvedValue(board(mondayKey, [schedule()]));

    const { container } = await renderPage();

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="기간 단위"]');
    expect(select?.value).toBe('week');
    expect(Array.from(select?.options ?? []).map((option) => option.text))
      .toEqual(['일간', '주간', '월간']);
  });

  it('오늘 버튼은 뷰를 유지하고 기간 파라미터를 뗀다', async () => {
    getMonthSchedules.mockResolvedValue(board('2026-02-01', [schedule()]));

    const { container } = await renderPage({ view: 'month', month: '2026-02' });

    expect(container.querySelector('.schedule-nav-controls a')?.getAttribute('href'))
      .toBe(`${basePath}?view=month`);
  });

  it('이전과 다음 이동은 뷰마다 한 칸씩 움직인다', async () => {
    getMonthSchedules.mockResolvedValue(board('2026-01-01', [schedule({ scheduledAt: '2026-01-15T01:00:00.000Z' })]));

    const { container } = await renderPage({ view: 'month', month: '2026-01' });

    const navHrefs = Array.from(container.querySelectorAll('.schedule-nav-period a')).map((a) => a.getAttribute('href'));
    expect(navHrefs).toEqual([
      `${basePath}?view=month&month=2025-12`,
      `${basePath}?view=month&month=2026-02`,
    ]);
    // 이전·다음은 묶인 사각 컨트롤이 아니라 각각 독립 원형 버튼으로 선다.
    const steps = container.querySelectorAll('.schedule-nav-period a.schedule-nav-step');
    expect(steps).toHaveLength(2);
    expect(Array.from(steps).every((el) => el.classList.contains('wire-chevron-button'))).toBe(true);
    expect(container.querySelector('.month-nav-group')).toBeNull();
  });

  // 주차 번호는 적지 않는다. 세 뷰가 같은 모양의 날짜 한 줄을 쓴다.
  it('주간 기간 이름은 날짜 범위 한 줄이고 주차 번호가 없다', async () => {
    getUpcomingSchedules.mockResolvedValue(board(mondayKey, [schedule()]));

    const { container } = await renderPage();

    const label = container.querySelector('.schedule-period-label');
    expect(label?.textContent).toBe('2026년 2월 9일(월)-2월 15일(일)');
    expect(container.textContent).not.toContain('째 주');
    expect(container.querySelectorAll('.schedule-period-label')).toHaveLength(1);
  });

  it('일간과 월간 기간 이름은 한 줄이다', async () => {
    getTodaySchedules.mockResolvedValue(board('2026-02-15', [schedule()]));

    const { container } = await renderPage({ view: 'day', date: '2026-02-15' });

    expect(container.querySelector('.schedule-period-label')?.textContent).toBe('2026년 2월 15일(일)');
  });

  // 양쪽 1fr 이 가운데 칸을 페이지 정중앙에 묶는다. 왼·오른 폭과 무관하게 기간 네비가 서야 한다.
  it('내비는 양쪽 1fr 사이에 기간 묶음을 둔 세 칸 격자다', async () => {
    getUpcomingSchedules.mockResolvedValue(board(mondayKey, [schedule()]));

    const { container } = await renderPage();

    const nav = container.querySelector('.schedule-nav');
    const children = Array.from(nav?.children ?? []).map((el) => el.className);
    expect(children).toEqual([
      'schedule-nav-controls',
      'schedule-nav-period',
      'schedule-nav-actions',
    ]);
    // 데스크톱에서 가운데 기간 묶음 양쪽을 같은 1fr 이 감싼다.
    expect(nav?.children[1]?.className).toBe('schedule-nav-period');
  });

  // 구분선 두 줄은 없앴다. 내비 한 줄을 테두리 있는 면 하나로 묶는다.
  it('내비는 구분선 없이 테두리 면 하나로 서고 카드를 중첩하지 않는다', async () => {
    getUpcomingSchedules.mockResolvedValue(board(mondayKey, [schedule()]));

    const { container } = await renderPage();

    expect(container.querySelectorAll('.schedule-rule')).toHaveLength(0);
    const nav = container.querySelector('.schedule-nav');
    expect(nav).not.toBeNull();
    // 면은 내비 자신이 갖는다. 안에 카드를 다시 깔지 않는다(D59 카드 안 카드 금지).
    expect(nav?.querySelector('.surface-card')).toBeNull();
  });

  it('페이지 헤더 행동은 사라지고 등록 버튼 둘이 내비 안에 선다', async () => {
    getUpcomingSchedules.mockResolvedValue(board(mondayKey, [schedule()]));

    const { container } = await renderPage();

    expect(container.querySelector('.page-header .page-actions')).toBeNull();
    expect(container.querySelectorAll('.schedule-nav-actions a')).toHaveLength(2);
  });
});

describe('다중 뷰 일정 화면 (CCC-133), 공통', () => {
  it('다른 사업 유형은 걸러 낸다', async () => {
    getUpcomingSchedules.mockResolvedValue(board(mondayKey, [
      schedule({ id: 'mine', participantName: '이사업사람' }),
      schedule({ id: 'other', programType: 'other_program_v1', participantName: '다른사업사람' }),
    ]));

    const { container } = await renderPage();

    expect(cards(container)).toHaveLength(1);
    expect(container.textContent).not.toContain('다른사업사람');
  });

  it('자정 근처 일정도 기관 시간대 기준으로 날짜를 가른다', async () => {
    getMonthSchedules.mockResolvedValue(board('2026-02-01', [
      // 2026-02-15T15:30Z = 서울 2026-02-16 00:30.
      schedule({ id: 'after-midnight', scheduledAt: '2026-02-15T15:30:00.000Z' }),
    ]));

    const { container } = await renderPage({ view: 'month', month: '2026-02' });

    expect(dayHeadings(container)[0]).toContain('2월 16일');
  });

  it('불러오지 못하면 내비는 남기고 안내만 바꾼다', async () => {
    const { ApiError } = await import('../../../lib/api');
    getUpcomingSchedules.mockRejectedValue(new ApiError('service_unavailable'));

    const { container } = await renderPage();

    expect(container.querySelector('.wire-error')?.textContent)
      .toBe('일정을 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.');
    expect(container.querySelectorAll('select[aria-label="기간 단위"]')).toHaveLength(1);
  });
});
