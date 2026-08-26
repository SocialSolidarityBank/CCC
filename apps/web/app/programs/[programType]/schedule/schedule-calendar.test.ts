import { describe, expect, it } from 'vitest';
import type { TodaySchedule } from '../../../lib/api';
import {
  dayPeriodLabel,
  groupSchedulesByDay,
  isoWeekOf,
  parseScheduleQuery,
  scheduleTodayHref,
  schedulePeriodHref,
  scheduleViewHref,
  shiftSchedulePeriod,
  weekPeriodLabel,
} from './schedule-calendar';

function schedule(scheduledAt: string, id: string): TodaySchedule {
  return {
    id,
    supportCaseId: 'case-1',
    beneficiaryId: 'swallow-003',
    scheduledAt,
    programType: 'financial_support_v1',
    status: 'scheduled',
    sessionKind: 'regular',
    participantName: '김철수',
    participantPhone: '010-1234-5678',
    completedSessionId: null,
  };
}

// CCC-133 다중 뷰 계약. 뷰 3종(day·week·month)과 기간 파라미터를 URL 이 갖고,
// 어긋난 값은 조용히 버려 서버가 기관 시간대로 정한 기본값으로 떨어진다.

const basePath = '/programs/financial_support_v1/schedule';

describe('parseScheduleQuery, 뷰와 기간 파라미터', () => {
  it('빈 쿼리는 주간이 기본이고 기간 파라미터가 없다', () => {
    expect(parseScheduleQuery({})).toEqual({ view: 'week' });
  });

  it('세 뷰와 각자의 기간 파라미터를 읽는다', () => {
    expect(parseScheduleQuery({ view: 'day', date: '2026-08-24' }))
      .toEqual({ view: 'day', date: '2026-08-24' });
    expect(parseScheduleQuery({ view: 'week', date: '2026-08-26' }))
      .toEqual({ view: 'week', date: '2026-08-26' });
    expect(parseScheduleQuery({ view: 'month', month: '2026-08' }))
      .toEqual({ view: 'month', month: '2026-08' });
  });

  it('어긋난 뷰 값은 주간으로 떨어진다', () => {
    expect(parseScheduleQuery({ view: 'timeline' })).toEqual({ view: 'week' });
    expect(parseScheduleQuery({ view: '' })).toEqual({ view: 'week' });
  });

  it('어긋난 날짜와 달은 조용히 버린다, 서버가 기본값을 정한다', () => {
    expect(parseScheduleQuery({ view: 'day', date: '2026-13-45' })).toEqual({ view: 'day' });
    expect(parseScheduleQuery({ view: 'day', date: '20260824' })).toEqual({ view: 'day' });
    expect(parseScheduleQuery({ view: 'week', date: '2026-02-30' })).toEqual({ view: 'week' });
    expect(parseScheduleQuery({ view: 'month', month: '2026-13' })).toEqual({ view: 'month' });
  });

  it('기간 파라미터는 자기 뷰에서만 읽는다', () => {
    expect(parseScheduleQuery({ view: 'day', month: '2026-08' })).toEqual({ view: 'day' });
    expect(parseScheduleQuery({ view: 'month', date: '2026-08-24' })).toEqual({ view: 'month' });
  });

  // 구 링크·북마크 보존. D75 가 남긴 ?range= 를 새 계약으로 옮긴다.
  it('구 range=month 는 월 뷰로 옮기고 month 를 살린다', () => {
    expect(parseScheduleQuery({ range: 'month', month: '2026-08' }))
      .toEqual({ view: 'month', month: '2026-08' });
    expect(parseScheduleQuery({ range: 'month' })).toEqual({ view: 'month' });
  });

  it('그 밖의 구 range 값은 주간으로 옮긴다', () => {
    expect(parseScheduleQuery({ range: 'week' })).toEqual({ view: 'week' });
    expect(parseScheduleQuery({ range: 'quarter' })).toEqual({ view: 'week' });
  });

  it('새 view 가 있으면 구 range 보다 우선한다', () => {
    expect(parseScheduleQuery({ view: 'day', date: '2026-08-24', range: 'month' }))
      .toEqual({ view: 'day', date: '2026-08-24' });
  });

  it('배열로 온 쿼리 값은 버린다', () => {
    expect(parseScheduleQuery({ view: ['day', 'week'] })).toEqual({ view: 'week' });
    expect(parseScheduleQuery({ view: 'day', date: ['2026-08-24'] })).toEqual({ view: 'day' });
  });
});

describe('shiftSchedulePeriod, 이전·다음 이동', () => {
  it('일간은 하루씩 움직이고 달 경계를 넘는다', () => {
    expect(shiftSchedulePeriod('day', '2026-08-24', 1)).toBe('2026-08-25');
    expect(shiftSchedulePeriod('day', '2026-08-24', -1)).toBe('2026-08-23');
    expect(shiftSchedulePeriod('day', '2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftSchedulePeriod('day', '2026-01-01', -1)).toBe('2025-12-31');
  });

  it('주간은 7일씩 움직인다', () => {
    expect(shiftSchedulePeriod('week', '2026-08-24', 1)).toBe('2026-08-31');
    expect(shiftSchedulePeriod('week', '2026-08-24', -1)).toBe('2026-08-17');
    expect(shiftSchedulePeriod('week', '2026-12-28', 1)).toBe('2027-01-04');
  });

  it('월간은 한 달씩 움직이고 해 경계를 넘는다', () => {
    expect(shiftSchedulePeriod('month', '2026-08', 1)).toBe('2026-09');
    expect(shiftSchedulePeriod('month', '2026-01', -1)).toBe('2025-12');
    expect(shiftSchedulePeriod('month', '2026-12', 1)).toBe('2027-01');
  });
});

describe('기간 이름', () => {
  it('일간은 연·월·일과 요일을 적는다', () => {
    expect(dayPeriodLabel('2026-08-24')).toBe('2026년 8월 24일(월)');
  });

  // 주차 번호는 적지 않는다. 날짜가 더 중요해 날짜 범위 한 줄로만 낸다.
  it('주간은 날짜 범위를 한 줄로 적고 시작에만 연도를 붙인다', () => {
    expect(weekPeriodLabel(isoWeekOf('2026-08-24'))).toBe('2026년 8월 24일(월)-8월 30일(일)');
  });

  it('달을 넘는 주간도 끝에 달을 적는다', () => {
    expect(weekPeriodLabel(isoWeekOf('2026-08-31'))).toBe('2026년 8월 31일(월)-9월 6일(일)');
  });

  it('해를 넘는 주간은 끝에도 연도를 적는다', () => {
    expect(weekPeriodLabel(isoWeekOf('2026-12-28'))).toBe('2026년 12월 28일(월)-2027년 1월 3일(일)');
  });
});

describe('groupSchedulesByDay, 본문 묶음', () => {
  const timeZone = 'Asia/Seoul';

  it('일정이 있는 날짜만 시간순으로 묶는다', () => {
    const groups = groupSchedulesByDay([
      schedule('2026-08-26T01:00:00.000Z', 'c'),
      schedule('2026-08-24T01:00:00.000Z', 'a'),
      schedule('2026-08-24T05:00:00.000Z', 'b'),
    ], timeZone, '2026-08-25');

    expect(groups.map((group) => group.key)).toEqual(['2026-08-24', '2026-08-26']);
    expect(groups[0]?.schedules.map((row) => row.id)).toEqual(['a', 'b']);
    // 2026-08-25 는 일정이 없으므로 묶음 자체가 없다.
    expect(groups).toHaveLength(2);
  });

  it('기관 시간대 기준으로 지난·오늘·미래를 가른다', () => {
    const groups = groupSchedulesByDay([
      schedule('2026-08-23T01:00:00.000Z', 'past'),
      schedule('2026-08-24T01:00:00.000Z', 'today'),
      schedule('2026-08-25T01:00:00.000Z', 'future'),
    ], timeZone, '2026-08-24');

    expect(groups.map((group) => group.temporal)).toEqual(['past', 'today', 'future']);
  });

  it('자정 근처는 UTC 가 아니라 기관 시간대로 나누어 넣는다', () => {
    // 2026-08-24T15:30Z = 서울 2026-08-25 00:30.
    const groups = groupSchedulesByDay([
      schedule('2026-08-24T15:30:00.000Z', 'after-midnight'),
    ], timeZone, '2026-08-24');

    expect(groups.map((group) => group.key)).toEqual(['2026-08-25']);
  });
});

describe('이동 링크', () => {
  it('기간 링크는 뷰와 자기 기간 파라미터만 싣는다', () => {
    expect(schedulePeriodHref(basePath, 'day', '2026-08-24'))
      .toBe(`${basePath}?view=day&date=2026-08-24`);
    expect(schedulePeriodHref(basePath, 'week', '2026-08-24'))
      .toBe(`${basePath}?view=week&date=2026-08-24`);
    expect(schedulePeriodHref(basePath, 'month', '2026-08'))
      .toBe(`${basePath}?view=month&month=2026-08`);
  });

  // [오늘]은 보고 있던 뷰를 유지한 채 기간 파라미터만 뗀다. 서버가 기관 시간대로 다시 정한다.
  it('오늘 링크는 뷰를 유지하고 기간 파라미터를 뗀다', () => {
    expect(scheduleTodayHref(basePath, 'day')).toBe(`${basePath}?view=day`);
    expect(scheduleTodayHref(basePath, 'week')).toBe(`${basePath}?view=week`);
    expect(scheduleTodayHref(basePath, 'month')).toBe(`${basePath}?view=month`);
  });

  it('보기 선택창은 보던 자리를 잡은 채 기간 크기만 바꿔 준다', () => {
    expect(scheduleViewHref(basePath, 'week', '2026-08-24', 'day'))
      .toBe(`${basePath}?view=day&date=2026-08-24`);
    expect(scheduleViewHref(basePath, 'day', '2026-08-26', 'week'))
      .toBe(`${basePath}?view=week&date=2026-08-26`);
    expect(scheduleViewHref(basePath, 'week', '2026-08-24', 'month'))
      .toBe(`${basePath}?view=month&month=2026-08`);
  });

  it('월간에서 더 작은 기간으로 갈 때는 그 달 1일을 잡는다', () => {
    expect(scheduleViewHref(basePath, 'month', '2026-03', 'week'))
      .toBe(`${basePath}?view=week&date=2026-03-01`);
    expect(scheduleViewHref(basePath, 'month', '2026-03', 'day'))
      .toBe(`${basePath}?view=day&date=2026-03-01`);
  });

  it('같은 뷰를 다시 누르면 제자리다', () => {
    expect(scheduleViewHref(basePath, 'month', '2026-03', 'month'))
      .toBe(`${basePath}?view=month&month=2026-03`);
    expect(scheduleViewHref(basePath, 'day', '2026-08-24', 'day'))
      .toBe(`${basePath}?view=day&date=2026-08-24`);
  });
});
