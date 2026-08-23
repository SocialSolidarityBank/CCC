import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다. 없으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 종료코드가 1 이 된다.
afterEach(cleanup);

const getUpcomingSchedules = vi.fn();
const getMonthSchedules = vi.fn();

vi.mock('../../../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  getUpcomingSchedules: () => getUpcomingSchedules(),
  getMonthSchedules: (month?: string) => getMonthSchedules(month),
  rememberLastProgramType: () => undefined,
}));

const { default: ProgramSchedulePage } = await import('./page');
// 시각 기대값은 공용 포매터로 만든다 — '오전'과 시각 사이 공백 문자가 러너의 ICU 버전에
// 따라 달라(NBSP 등) 리터럴 비교가 CI 에서 깨진다.
const { formatKoreanTime } = await import('../../../lib/format-korean-date');

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

function weekBoard(schedules: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    date: '2026-02-15',
    timeZone: 'Asia/Seoul',
    startUtc: '2026-02-14T15:00:00.000Z',
    endUtc: '2026-02-22T15:00:00.000Z',
    schedules,
  };
}

function monthBoard(schedules: Array<Record<string, unknown>>): Record<string, unknown> {
  return {
    date: '2026-02-01',
    timeZone: 'Asia/Seoul',
    startUtc: '2026-01-31T15:00:00.000Z',
    endUtc: '2026-02-28T15:00:00.000Z',
    schedules,
  };
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
  return Array.from(container.querySelectorAll('.schedule-section > .record-section-title'))
    .map((el) => el.textContent);
}

beforeEach(() => {
  getUpcomingSchedules.mockReset();
  getMonthSchedules.mockReset();
});

describe('통합 일정 화면 (D75) — 다가오는 7일', () => {
  it('일정이 있는 날짜만 날짜별로 묶고, 빈 날짜는 그리지 않는다', async () => {
    getUpcomingSchedules.mockResolvedValue(weekBoard([
      schedule({ id: 'today-1', participantName: '오늘사람' }),
      // 2026-02-18 — 16·17 은 일정이 없어 묶음 자체가 없어야 한다.
      schedule({ id: 'later-1', scheduledAt: '2026-02-18T01:00:00.000Z', participantName: '나중사람' }),
    ]));

    const { container } = await renderPage();

    const headings = dayHeadings(container);
    expect(headings).toHaveLength(2);
    expect(headings[0]).toContain('2월 15일');
    expect(headings[0]).toContain('오늘');
    expect(headings[0]).toContain('1건');
    expect(headings[1]).toContain('2월 18일');
    expect(headings[1]).not.toContain('오늘');
    expect(cards(container)).toHaveLength(2);
  });

  // CCC-57: 앞으로 올 날짜에서 끝난 건이 서 있으면 유령 예정 일정이다.
  it('앞으로 올 날짜는 예정만 남긴다', async () => {
    const later = '2026-02-18T01:00:00.000Z';
    getUpcomingSchedules.mockResolvedValue(weekBoard([
      schedule({ id: 'done', status: 'completed', completedSessionId: 'session-1', participantName: '완료된사람', scheduledAt: later }),
      schedule({ id: 'live', status: 'scheduled', participantName: '예정인사람', scheduledAt: later }),
      schedule({ id: 'off', status: 'cancelled', participantName: '취소된사람', scheduledAt: later }),
      schedule({ id: 'absent', status: 'no_show', participantName: '불참한사람', scheduledAt: later }),
    ]));

    const { container } = await renderPage();

    expect(cards(container)).toHaveLength(1);
    expect(container.textContent).toContain('예정인사람');
    expect(container.textContent).not.toContain('완료된사람');
    expect(container.textContent).not.toContain('취소된사람');
    expect(container.textContent).not.toContain('불참한사람');
  });

  // CCC-66: 오늘 묶음은 "3건 중 1건 끝"을 보는 자리라 끝난 건도 배지와 함께 남는다.
  it('오늘 묶음은 끝난 상담도 배지와 함께 남긴다', async () => {
    getUpcomingSchedules.mockResolvedValue(weekBoard([
      schedule({ id: 'today-done', status: 'completed', completedSessionId: 'sess-1', participantName: '오늘끝난사람' }),
      schedule({ id: 'today-live', status: 'scheduled', participantName: '오늘남은사람', scheduledAt: '2026-02-15T05:00:00.000Z' }),
    ]));

    const { container } = await renderPage();

    expect(container.textContent).toContain('오늘끝난사람');
    expect(container.textContent).toContain('오늘남은사람');
    expect(Array.from(container.querySelectorAll('.participant-card .wire-badge')).map((el) => el.textContent))
      .toContain('완료');
  });

  // D75 그릴링 5: 가장 가까운 예정 상담 카드 한 장만 선택 어휘(그라데이션 아웃라인). 배지 없음.
  it('가장 가까운 예정 상담 카드 한 장만 선택 아웃라인을 입는다', async () => {
    getUpcomingSchedules.mockResolvedValue(weekBoard([
      schedule({ id: 'today-done', status: 'completed', completedSessionId: 'sess-1', participantName: '오늘끝난사람' }),
      schedule({ id: 'next', status: 'scheduled', participantName: '다음사람', scheduledAt: '2026-02-15T05:00:00.000Z' }),
      schedule({ id: 'after', status: 'scheduled', participantName: '그다음사람', scheduledAt: '2026-02-18T01:00:00.000Z' }),
    ]));

    const { container } = await renderPage();

    const selected = Array.from(container.querySelectorAll('.participant-card[data-selected="true"]'));
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toContain('다음사람');
    // 강조는 테두리뿐이다 — '다음 상담' 같은 추가 배지를 만들지 않는다.
    expect(container.textContent).not.toContain('다음 상담');
  });

  // '오늘'은 기관 시간대로 정한다. UTC 로 자르면 자정 근처 일정이 하루씩 밀린다.
  it('자정 근처 일정도 기관 시간대 기준으로 오늘 묶음에 넣는다', async () => {
    getUpcomingSchedules.mockResolvedValue(weekBoard([
      // 2026-02-15T00:30Z = 서울 09:30 → 오늘.
      schedule({ id: 'morning', scheduledAt: '2026-02-15T00:30:00.000Z', participantName: '아침사람' }),
      // 2026-02-15T15:30Z = 서울 2026-02-16 00:30 → 내일.
      schedule({ id: 'past-midnight', scheduledAt: '2026-02-15T15:30:00.000Z', participantName: '자정넘긴사람' }),
    ]));

    const { container } = await renderPage();

    const headings = dayHeadings(container);
    expect(headings[0]).toContain('2월 15일');
    expect(headings[0]).toContain('오늘');
    expect(headings[1]).toContain('2월 16일');
    const sections = Array.from(container.querySelectorAll('.schedule-section'));
    expect(sections[0]?.textContent).toContain('아침사람');
    expect(sections[1]?.textContent).toContain('자정넘긴사람');
  });

  it('다른 사업 유형은 걸러 낸다', async () => {
    getUpcomingSchedules.mockResolvedValue(weekBoard([
      schedule({ id: 'mine', participantName: '이사업사람' }),
      schedule({ id: 'other', programType: 'other_program_v1', participantName: '다른사업사람' }),
    ]));

    const { container } = await renderPage();

    expect(cards(container)).toHaveLength(1);
    expect(container.textContent).not.toContain('다른사업사람');
  });

  it('범위 전환 두 개가 서고 기본 범위는 다가오는 7일이다', async () => {
    getUpcomingSchedules.mockResolvedValue(weekBoard([schedule()]));

    const { container } = await renderPage();

    const segs = Array.from(container.querySelectorAll<HTMLAnchorElement>('.schedule-range-seg'));
    expect(segs.map((seg) => seg.textContent)).toEqual(['다가오는 7일', '월 전체']);
    expect(segs.map((seg) => seg.getAttribute('href'))).toEqual([
      '/programs/financial_support_v1/schedule',
      '/programs/financial_support_v1/schedule?range=month',
    ]);
    expect(segs[0]?.getAttribute('data-selected')).toBe('true');
    expect(segs[1]?.getAttribute('data-selected')).toBeNull();
    // 정렬 토글은 D75 로 뺐다 — 날짜 묶음 제목이 순서를 이미 말한다.
    expect(container.textContent).not.toContain('시간순');
  });

  it('7일 안에 일정이 없으면 빈 상태 계약대로 보여준다', async () => {
    getUpcomingSchedules.mockResolvedValue(weekBoard([]));

    const { container } = await renderPage();

    expect(container.querySelector('.wire-empty-title')?.textContent)
      .toBe('앞으로 7일 안에 잡힌 상담이 없습니다');
  });
});

describe('통합 일정 화면 (D75) — 월 전체', () => {
  it('?range=month 는 한 달 창을 1일부터 날짜순으로 묶어 보여준다', async () => {
    getMonthSchedules.mockResolvedValue(monthBoard([
      schedule({ id: 's1', scheduledAt: '2026-02-03T01:00:00.000Z', status: 'completed', completedSessionId: 'sess-3', participantName: '지난사람' }),
      schedule({ id: 's2', scheduledAt: '2026-02-15T01:00:00.000Z', participantName: '중간사람' }),
      schedule({ id: 's3', scheduledAt: '2026-02-20T01:00:00.000Z', sessionKind: 'intake', participantName: '나중사람' }),
    ]));

    const { container } = await renderPage({ range: 'month', month: '2026-02' });

    expect(getMonthSchedules).toHaveBeenCalledWith('2026-02');
    const headings = dayHeadings(container);
    expect(headings).toHaveLength(3);
    expect(headings[0]).toContain('2월 3일');
    expect(headings[1]).toContain('2월 15일');
    expect(headings[2]).toContain('2월 20일');
    // 시각은 카드 안에 공용 포매터 값으로 남는다.
    expect(container.textContent).toContain(formatKoreanTime('2026-02-15T01:00:00.000Z'));
  });

  it('상태 뱃지는 지난 일정에만 붙고 예정에는 붙지 않는다', async () => {
    getMonthSchedules.mockResolvedValue(monthBoard([
      schedule({ id: 's1', status: 'scheduled' }),
      schedule({ id: 's2', scheduledAt: '2026-02-16T01:00:00.000Z', status: 'cancelled' }),
      schedule({ id: 's3', scheduledAt: '2026-02-17T01:00:00.000Z', status: 'no_show' }),
      schedule({ id: 's4', scheduledAt: '2026-02-18T01:00:00.000Z', status: 'completed', completedSessionId: 'sess-4' }),
    ]));

    const { container } = await renderPage({ range: 'month', month: '2026-02' });

    const statuses = cards(container).map((card) => {
      const badges = Array.from(card.querySelectorAll('.wire-badge')).map((el) => el.textContent);
      return badges[1] ?? null;
    });
    expect(statuses).toEqual([null, '취소', '불참', '완료']);
  });

  it('완료된 회차는 그 회차가 펼쳐진 상담 기록으로, 나머지는 브리핑으로 보낸다', async () => {
    getMonthSchedules.mockResolvedValue(monthBoard([
      schedule({ id: 's1', scheduledAt: '2026-02-03T01:00:00.000Z', status: 'completed', completedSessionId: 'sess-9' }),
      schedule({ id: 's2', scheduledAt: '2026-02-16T01:00:00.000Z' }),
    ]));

    const { container } = await renderPage({ range: 'month', month: '2026-02' });

    const hrefs = Array.from(container.querySelectorAll('.card-grid a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      '/participants/swallow-003/programs/case-1/records#record-sess-9',
      '/participants/swallow-003/programs/case-1/briefing',
    ]);
  });

  it('월 이동 링크가 range 를 유지한 채 앞뒤 달을 가리키고 해 경계를 넘는다', async () => {
    getMonthSchedules.mockResolvedValue({ ...monthBoard([schedule({ scheduledAt: '2026-01-15T01:00:00.000Z' })]), date: '2026-01-01' });

    const { container } = await renderPage({ range: 'month', month: '2026-01' });

    const navHrefs = Array.from(container.querySelectorAll('.month-nav a')).map((a) => a.getAttribute('href'));
    expect(navHrefs).toEqual([
      '/programs/financial_support_v1/schedule?range=month&month=2025-12',
      '/programs/financial_support_v1/schedule?range=month&month=2026-02',
    ]);
    expect(container.querySelector('.month-nav-label')?.textContent).toBe('2026년 1월');
    // 월 이동은 month 범위 전용이다 — week 에는 안 선다(아래 기본 범위 테스트가 뒤집힌 단언).
  });

  it('형식이 어긋난 month 는 버리고 서버가 정한 달로 떨어진다', async () => {
    getMonthSchedules.mockResolvedValue(monthBoard([schedule()]));

    await renderPage({ range: 'month', month: '2026-13' });

    expect(getMonthSchedules).toHaveBeenCalledWith(undefined);
  });

  it('그 달에 상담이 없으면 빈 상태와 달 이동을 함께 보여준다', async () => {
    getMonthSchedules.mockResolvedValue(monthBoard([]));

    const { container } = await renderPage({ range: 'month', month: '2026-02' });

    expect(container.querySelector('.wire-empty-title')?.textContent).toBe('2026년 2월에는 상담이 없습니다');
    // 빈 달에서도 앞뒤로 옮겨갈 수 있어야 한다 — 없으면 빈 화면에 갇힌다.
    expect(container.querySelectorAll('.month-nav a')).toHaveLength(2);
  });

  it('week 범위에는 월 이동이 서지 않는다', async () => {
    getUpcomingSchedules.mockResolvedValue(weekBoard([schedule()]));

    const { container } = await renderPage();

    expect(container.querySelector('.month-nav')).toBeNull();
  });
});
