import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openEncryptedSqlite } from '@ccc/db-sqlite';
import { checkpointSources, seedScheduleDisplaySchema, proveScheduleDisplaySchema } from './support/migration-parity';
import worker from './support/local-worker';
import { createBeneficiaryWithInitialSupportCase, createCounselingSchedule, getNextCounselingScheduleForSupportCase, listSupportCasesForBeneficiary, getParticipantBriefing } from '@ccc/core/gateway';
import { setupD1, testActors, testProgramId } from './support/d1';

const t = setupD1();
const actor = testActors.counselor;
const at = '2026-07-16T04:30:00.000Z';
function request(path: string, method = 'GET', body?: Record<string, unknown>, as = actor) {
  return worker.fetch(new Request(`http://localhost${path}`, {
    method, headers: { 'content-type': 'application/json', 'X-CCC-User-Id': as.userId, 'X-CCC-Org-Id': as.orgId, 'X-CCC-Role': as.role },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), t.env);
}
async function seed() {
  await t.reset();
  const owned = await createBeneficiaryWithInitialSupportCase(t.env, actor, { programId: testProgramId(actor.orgId), intakeAt: '2026-07-01T00:00:00.000Z' });
  return { beneficiaryId: owned.beneficiaryId, supportCaseId: owned.supportCaseId };
}

describe('D88 explicit schedule display contract', () => {
  it('keeps all-day independent of midnight through creation, boards, plan and nested schedule reads', async () => {
    const owned = await seed();
    const created = await request('/schedules', 'POST', { ...owned, scheduledAt: at, allDay: true, displayColor: 'light-magenta' });
    expect(created.status).toBe(201);
    const schedule = await created.json() as { id: string };
    const expected = { allDay: true, displayColor: 'light-magenta', scheduledAt: at };
    expect(schedule).toMatchObject(expected);
    for (const path of ['/schedules/today?date=2026-07-16', '/schedules/upcoming?date=2026-07-16', '/schedules/month?month=2026-07']) {
      const response = await request(path); expect(response.status).toBe(200);
      const body = await response.json() as { schedules: unknown[] };
      expect(body.schedules).toEqual([expect.objectContaining({ id: schedule.id, ...expected })]);
    }
    const plan = await request(`/schedules/${schedule.id}/plan`); expect(plan.status).toBe(200);
    expect(await plan.json()).toMatchObject(expected);
    expect(await getNextCounselingScheduleForSupportCase(t.env, actor, owned.supportCaseId)).toMatchObject(expected);
    const programs = await listSupportCasesForBeneficiary(t.env, actor, owned.beneficiaryId);
    expect(programs.programs).toEqual([expect.objectContaining({ upcomingSchedule: expect.objectContaining(expected) })]);
    const briefing = await getParticipantBriefing(t.env, actor, owned.beneficiaryId, owned.supportCaseId);
    expect(briefing.focusUpcomingSchedule).toMatchObject(expected);
    const midnight = await request('/schedules', 'POST', { ...owned, scheduledAt: '2026-07-16T00:00:00.000Z' });
    expect(midnight.status).toBe(201);
    expect(await midnight.json()).toMatchObject({ scheduledAt: '2026-07-16T00:00:00.000Z', allDay: false, displayColor: null });
  });

  it('preserves omitted display fields, supports explicit clearing and retains permission/version/audit guards', async () => {
    const owned = await seed();
    const created = await createCounselingSchedule(t.env, actor, { ...owned, scheduledAt: at, allDay: true, displayColor: 'cyan' });
    const path = `/schedules/${created.id}/reschedule`;
    const movedAt = '2026-07-17T04:30:00.000Z';
    const moved = await request(path, 'PATCH', { expectedVersion: 1, scheduledAt: movedAt });
    expect(moved.status).toBe(200); expect(await moved.json()).toMatchObject({ version: 2, allDay: true, displayColor: 'cyan' });
    expect((await request(path, 'PATCH', { expectedVersion: 2, scheduledAt: movedAt, allDay: false, displayColor: null }, testActors.unassignedCounselor)).status).toBe(403);
    expect((await request(path, 'PATCH', { expectedVersion: 1, scheduledAt: movedAt, allDay: false, displayColor: null })).status).toBe(409);
    expect(await getNextCounselingScheduleForSupportCase(t.env, actor, owned.supportCaseId)).toMatchObject({ version: 2, allDay: true, displayColor: 'cyan' });
    const cleared = await request(path, 'PATCH', { expectedVersion: 2, scheduledAt: movedAt, allDay: false, displayColor: null });
    expect(cleared.status).toBe(200); expect(await cleared.json()).toMatchObject({ version: 3, allDay: false, displayColor: null });
    const audit = await t.db.prepare("SELECT detail FROM audit_log WHERE target_id = ? AND action = 'reschedule' ORDER BY rowid").bind(created.id).all<{ detail: string }>();
    expect(audit.results.map(row => JSON.parse(row.detail))).toEqual([
      { status: 'scheduled', allDay: true, displayColor: 'cyan' },
      { status: 'scheduled', allDay: false, displayColor: null },
    ]);
    const cancelled = await request(`/schedules/${created.id}/cancel`, 'POST', { expectedVersion: 3 });
    expect(cancelled.status).toBe(200); expect(await cancelled.json()).toMatchObject({ status: 'cancelled', allDay: false, displayColor: null });
  });

  it('accepts exactly the approved colors for intake too and rejects invalid values before storing', async () => {
    const owned = await seed();
    for (const displayColor of ['mint', 'lavender', 'coral', 'cyan', 'light-magenta']) {
      const response = await request('/schedules', 'POST', { ...owned, scheduledAt: at, sessionKind: 'intake', allDay: true, displayColor });
      expect(response.status).toBe(201); expect(await response.json()).toMatchObject({ allDay: true, displayColor });
    }
    for (const invalid of [{ allDay: 1 }, { allDay: 'true' }, { allDay: null }, { displayColor: 'blue' }, { displayColor: '' }, { displayColor: 1 }]) {
      expect((await request('/schedules', 'POST', { ...owned, scheduledAt: at, ...invalid })).status).toBe(400);
    }
    const rows = await t.db.prepare('SELECT all_day, display_color FROM counseling_schedules ORDER BY display_color').all();
    expect(rows.results).toEqual(['coral', 'cyan', 'lavender', 'light-magenta', 'mint'].map(display_color => ({ all_day: 1, display_color })));
  });
});

describe('D88 forward SQLite upgrade', () => {
  it('replays the registered checkpoint through the shared live semantic proof', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ccc-schedule-checkpoint-'));
    const db = openEncryptedSqlite({ filename: join(directory, 'proof.db'), key: new Uint8Array(32).fill(19) });
    try {
      const sources = checkpointSources();
      for (const checkpoint of sources) {
        if (checkpoint.id === 'schedule-display') await seedScheduleDisplaySchema(db);
        await db.applyMigrations(checkpoint.sqlite);
      }
      await proveScheduleDisplaySchema(db);
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
  it('preserves preexisting midnight appointments and enforces storage domains', () => {
    const db = new DatabaseSync(':memory:');
    try {
      db.exec("CREATE TABLE counseling_schedules (id TEXT PRIMARY KEY, scheduled_at TEXT NOT NULL); INSERT INTO counseling_schedules VALUES ('old', '2026-07-16T00:00:00.000Z');");
      db.exec(readFileSync(new URL('../../../migrations/sqlite/0056_schedule_display.sql', import.meta.url), 'utf8'));
      expect({ ...db.prepare('SELECT * FROM counseling_schedules').get() }).toEqual({ id: 'old', scheduled_at: '2026-07-16T00:00:00.000Z', all_day: 0, display_color: null });
      expect(() => db.exec('UPDATE counseling_schedules SET all_day = 2')).toThrow();
      expect(() => db.exec("UPDATE counseling_schedules SET display_color = 'blue'")).toThrow();
    } finally { db.close(); }
  });
});
