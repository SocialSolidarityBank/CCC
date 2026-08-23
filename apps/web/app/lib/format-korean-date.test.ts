import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatKoreanDateTime, formatKoreanTime } from './format-korean-date';

afterEach(() => {
  vi.unstubAllGlobals();
});

class EnglishDayPeriodDateTimeFormat {
  readonly #options: Intl.DateTimeFormatOptions;

  constructor(
    _locales?: Intl.LocalesArgument,
    options: Intl.DateTimeFormatOptions = {},
  ) {
    this.#options = options;
  }

  format(): string {
    if (this.#options.dateStyle !== undefined && this.#options.timeStyle !== undefined) {
      return '2026년 8월 7일 PM 1:00';
    }
    if (this.#options.dateStyle !== undefined) return '2026년 8월 7일';
    return 'PM 1:00';
  }

  formatToParts(): Intl.DateTimeFormatPart[] {
    const timeParts: Intl.DateTimeFormatPart[] = [
      { type: 'dayPeriod', value: 'PM' },
      { type: 'hour', value: '1' },
      { type: 'literal', value: ':' },
      { type: 'minute', value: '00' },
    ];
    if (this.#options.dateStyle === undefined) return timeParts;
    return [
      { type: 'year', value: '2026' },
      { type: 'literal', value: '년 ' },
      { type: 'month', value: '8' },
      { type: 'literal', value: '월 ' },
      { type: 'day', value: '7' },
      { type: 'literal', value: '일 ' },
      ...timeParts,
    ];
  }
}

describe('한국어 날짜·시각 공용 포맷', () => {
  it('런타임이 영문 dayPeriod를 돌려줘도 한국어로 고정한다', () => {
    vi.stubGlobal('Intl', {
      ...Intl,
      DateTimeFormat: EnglishDayPeriodDateTimeFormat,
    });

    expect(formatKoreanTime('2026-08-07T04:00:00.000Z')).toBe('오후 1:00');
    expect(formatKoreanDateTime('2026-08-07T04:00:00.000Z')).toBe('2026년 8월 7일 오후 1:00');
  });
});
