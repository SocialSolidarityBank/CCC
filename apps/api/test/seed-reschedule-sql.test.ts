/**
 * `scripts/seed/reschedule-upcoming.mjs` 가 만드는 SQL 을 **실제 마이그레이션이 적용된 D1**
 * 에 돌려 검증한다.
 *
 * 왜 API 테스트 자리에 있나: 이 SQL 의 위험은 문자열이 아니라 **스키마와의 상호작용**이다 —
 * `counseling_schedules_update_guard` 트리거(`version + 1` 강제)와, 순위를 매기는 열을 같은
 * 문장에서 고칠 때 생기는 뒤엉킴. 둘 다 진짜 트리거·진짜 SQLite 없이는 확인할 수 없고,
 * 그 발판(`support/d1.ts`)이 여기 있다. 시드 전용 vitest 설정은 `generate.ts` 하나만
 * include 하고 `PII_ENC_KEY` 를 요구하므로 이 검증을 담을 수 없다.
 */
import { describe, expect, it } from 'vitest';
import { unstable_splitSqlQuery } from 'wrangler';
import {
  cancelCounselingSchedule,
  createBeneficiaryWithInitialSupportCase,
  createCounselingSchedule,
  getUpcomingSchedules,
} from '../../../db/gateway';
import { buildRescheduleSql } from '../../../scripts/seed/reschedule-upcoming.mjs';
import { setupD1, testActors } from './support/d1';

const t = setupD1();

/** 재배치 기준일. 아래 심는 일정(2026-05~06)보다 뒤라 '재배치 전에는 창이 빈다'가 성립한다. */
const FROM = '2026-09-01';
const SPREAD_DAYS = 21;
const UPDATED_AT = '2026-09-01T00:30:00.000Z';

/** 과거 예정 일정 6건 + 취소 1건(움직이지 않아야 하는 대조군)을 심는다. */
async function seedPastSchedules(): Promise<{ scheduledIds: string[]; cancelled: { id: string; at: string } }> {
  await t.reset();

  const owned = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-04-01T00:00:00.000Z',
  });

  const pastTimes = [
    '2026-05-04T01:00:00.000Z',
    '2026-05-18T01:00:00.000Z',
    '2026-06-01T01:00:00.000Z',
    '2026-06-08T04:00:00.000Z',
    '2026-06-22T01:00:00.000Z',
    '2026-06-30T04:00:00.000Z',
  ];
  const scheduledIds: string[] = [];
  for (const scheduledAt of pastTimes) {
    const created = await createCounselingSchedule(t.env, testActors.counselor, {
      beneficiaryId: owned.beneficiaryId,
      supportCaseId: owned.supportCaseId,
      scheduledAt,
    });
    scheduledIds.push(created.id);
  }

  const toCancel = await createCounselingSchedule(t.env, testActors.counselor, {
    beneficiaryId: owned.beneficiaryId,
    supportCaseId: owned.supportCaseId,
    scheduledAt: '2026-06-15T01:00:00.000Z',
  });
  const cancelled = await cancelCounselingSchedule(t.env, testActors.counselor, toCancel.id, {
    expectedVersion: toCancel.version,
  });

  return { scheduledIds, cancelled: { id: cancelled.id, at: '2026-06-15T01:00:00.000Z' } };
}

/** wrangler `--file` 이 하듯 문장을 순서대로 실행한다. */
async function applyReschedule(orgId: string): Promise<void> {
  const { statements } = buildRescheduleSql({ orgId, from: FROM, updatedAt: UPDATED_AT, spreadDays: SPREAD_DAYS });
  for (const statement of statements) {
    await t.db.prepare(statement).run();
  }
}

interface ScheduleRow {
  id: string;
  scheduled_at: string;
  status: string;
  version: number;
  updated_at: string;
}

async function readSchedules(orgId: string): Promise<ScheduleRow[]> {
  const result = await t.db
    .prepare('SELECT id, scheduled_at, status, version, updated_at FROM counseling_schedules WHERE org_id = ? ORDER BY scheduled_at, id')
    .bind(orgId)
    .all<ScheduleRow>();
  return result.results;
}

describe('예정 일정 재배치 SQL', () => {
  it('빈 창을 다시 채운다 — 재배치 전 0건, 후 1건 이상', async () => {
    await seedPastSchedules();

    const before = await getUpcomingSchedules(t.env, testActors.counselor, { date: FROM });
    expect(before.schedules).toHaveLength(0);

    await applyReschedule(testActors.counselor.orgId);

    const after = await getUpcomingSchedules(t.env, testActors.counselor, { date: FROM });
    expect(after.schedules.length).toBeGreaterThan(0);
    // 창 안에 들어온 것들은 정말 창 구간(기관 시간대 [오늘, 오늘+8일))에 있다.
    for (const schedule of after.schedules) {
      expect(schedule.scheduledAt >= after.startUtc).toBe(true);
      expect(schedule.scheduledAt < after.endUtc).toBe(true);
    }
  });

  it('예정 일정만 옮기고 취소된 일정은 그대로 둔다', async () => {
    const seeded = await seedPastSchedules();

    await applyReschedule(testActors.counselor.orgId);

    const rows = await readSchedules(testActors.counselor.orgId);
    const cancelledRow = rows.find((row) => row.id === seeded.cancelled.id);
    expect(cancelledRow?.status).toBe('cancelled');
    expect(cancelledRow?.scheduled_at).toBe(seeded.cancelled.at);

    const movedRows = rows.filter((row) => row.status === 'scheduled');
    expect(movedRows).toHaveLength(seeded.scheduledIds.length);
    for (const row of movedRows) {
      expect(row.scheduled_at >= `${FROM}T00:00:00.000Z`).toBe(true);
      expect(row.updated_at).toBe(UPDATED_AT);
    }
  });

  it('순위가 뒤엉키지 않는다 — 날짜가 서로 다르고 기존 순서가 보존된다', async () => {
    const seeded = await seedPastSchedules();

    await applyReschedule(testActors.counselor.orgId);

    const rows = await readSchedules(testActors.counselor.orgId);
    const moved = rows.filter((row) => row.status === 'scheduled');
    // 심은 순서(과거 오름차순)가 재배치 후에도 그대로여야 한다.
    expect(moved.map((row) => row.id)).toEqual(seeded.scheduledIds);

    const times = moved.map((row) => row.scheduled_at);
    expect(new Set(times).size).toBe(times.length);
    // 전부 [기준일, 기준일 + 분산기간) 안에 있다.
    const windowEnd = new Date(`${FROM}T00:00:00.000Z`);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + SPREAD_DAYS);
    for (const at of times) {
      expect(at < windowEnd.toISOString()).toBe(true);
    }
    // 한 주(8일 창)보다 넓게 퍼져 있어야 다음 주가 와도 남는다.
    expect(times[times.length - 1]! > `${FROM}T00:00:00.000Z`).toBe(true);
    const spanDays = (new Date(times[times.length - 1]!).getTime() - new Date(times[0]!).getTime()) / 86_400_000;
    expect(spanDays).toBeGreaterThan(8);
  });

  it('버전을 정확히 1 올린다 — 트리거가 거부하지 않는 유일한 방법이다', async () => {
    const seeded = await seedPastSchedules();
    const before = await readSchedules(testActors.counselor.orgId);
    const versionBefore = new Map(before.map((row) => [row.id, row.version]));

    await applyReschedule(testActors.counselor.orgId);

    const after = await readSchedules(testActors.counselor.orgId);
    for (const row of after) {
      const expected = versionBefore.get(row.id)! + (seeded.scheduledIds.includes(row.id) ? 1 : 0);
      expect(row.version).toBe(expected);
    }
  });

  it('다른 기관의 일정은 건드리지 않는다', async () => {
    await seedPastSchedules();
    const other = await createBeneficiaryWithInitialSupportCase(t.env, testActors.otherOrgCounselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-04-01T00:00:00.000Z',
    });
    const otherSchedule = await createCounselingSchedule(t.env, testActors.otherOrgCounselor, {
      beneficiaryId: other.beneficiaryId,
      supportCaseId: other.supportCaseId,
      scheduledAt: '2026-05-04T01:00:00.000Z',
    });

    await applyReschedule(testActors.counselor.orgId);

    const otherRows = await readSchedules(testActors.otherOrgCounselor.orgId);
    const untouched = otherRows.find((row) => row.id === otherSchedule.id);
    expect(untouched?.scheduled_at).toBe('2026-05-04T01:00:00.000Z');
    expect(untouched?.version).toBe(otherSchedule.version);
  });

  it('wrangler 가 파일을 쪼개도 문장 6개가 순서대로 남는다', () => {
    // 실제 적용 경로는 `wrangler d1 execute --file` 이고, wrangler 는 파일을 먼저 분할한다.
    // 위 테스트들은 문장 배열을 직접 실행하므로 이 분할을 거치지 않는다 — 여기서 닫는다.
    // 특히 DDL(CREATE/DROP)과 DML 이 섞인 순서가 유지돼야 임시 표 방식이 성립한다.
    const { sql, statements } = buildRescheduleSql({
      orgId: 'bss', from: FROM, updatedAt: UPDATED_AT, spreadDays: SPREAD_DAYS,
    });
    const split = unstable_splitSqlQuery(sql);
    expect(split).toHaveLength(statements.length);
    expect(split.map((part) => part.trim().split(/\s+/).slice(0, 2).join(' '))).toEqual([
      'DROP TABLE', 'CREATE TABLE', 'INSERT INTO', 'UPDATE counseling_schedules', 'DROP TABLE', 'SELECT \'rescheduled\'',
    ]);
  });

  it('예정 일정이 없으면 아무것도 바꾸지 않는다', async () => {
    await t.reset();
    await applyReschedule(testActors.counselor.orgId);
    expect(await readSchedules(testActors.counselor.orgId)).toHaveLength(0);
  });
});
