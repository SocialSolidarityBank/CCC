/**
 * `reschedule-upcoming.mjs` 의 타입 선언.
 *
 * 본체를 `.mjs` 로 둔 이유: `node scripts/seed/reschedule-upcoming.mjs` 로 플래그 없이
 * 바로 돌아가야 한다(이 레포에 TS 실행기가 없다). 그 대신 테스트가 TS 에서 import 할 수
 * 있도록 선언만 따로 둔다.
 */

export interface RescheduleOptions {
  /** 기관 ID(시드는 `bss`, 테스트는 `org_demo`). */
  orgId: string;
  /** 첫 슬롯이 놓일 날짜(`YYYY-MM-DD`, 기관 시간대 기준). */
  from: string;
  /** `updated_at` 에 찍을 ISO 시각. */
  updatedAt: string;
  /** 분산 기간(일). 기본 21. */
  spreadDays?: number;
}

export interface RescheduleSql {
  /** 검토·적용용 전체 SQL 파일 내용. */
  sql: string;
  /** 순서대로 실행할 문장 배열(세미콜론 없음). */
  statements: string[];
}

export function buildRescheduleSql(options: RescheduleOptions): RescheduleSql;

export function todayInTimeZone(now: Date, timeZone?: string): string;
