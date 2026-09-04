import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import { createBeneficiaryWithInitialSupportCase } from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';

// org_demo 는 setupD1 가 Asia/Seoul(UTC+9)로 프로비저닝한다. 앵커 07-16 기준
// 다가오는 창은 UTC [2026-07-15T15:00Z, 2026-07-23T15:00Z) 이다.
const ANCHOR_DATE = '2026-07-16';

const t = setupD1();

function headersFor(actor: { userId: string; orgId: string; role: string }): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

interface SeededCase {
  beneficiaryId: string;
  supportCaseId: string;
}

async function seedOwnedCase(): Promise<SeededCase> {
  await t.reset();
  const owned = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-01T00:00:00.000Z',
  });
  return { beneficiaryId: owned.beneficiaryId, supportCaseId: owned.supportCaseId };
}

function postSchedule(
  actor: { userId: string; orgId: string; role: string },
  body: Record<string, unknown>,
): Promise<Response> {
  return worker.fetch(new Request('http://localhost/schedules', {
    method: 'POST',
    headers: headersFor(actor),
    body: JSON.stringify(body),
  }), t.env);
}

describe('POST /schedules', () => {
  it('creates a schedule for an assigned counselor and writes a create audit row', async () => {
    const seeded = await seedOwnedCase();

    const response = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
    });

    expect(response.status).toBe(201);
    const body = await response.json() as {
      id: string;
      beneficiaryId: string;
      supportCaseId: string;
      scheduledAt: string;
      status: string;
      version: number;
    };
    expect(body).toEqual({
      id: expect.any(String),
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
      status: 'scheduled',
      version: 1,
    });

    // R1: 게이트웨이가 create 감사를 원자적으로 기록한다(D14). 정확히 한 건이어야 한다.
    const audit = await t.db.prepare(
      `SELECT actor_id AS actorId, actor_role AS actorRole, action,
              target_table AS targetTable, beneficiary_id AS beneficiaryId,
              support_case_id AS supportCaseId
       FROM audit_log
       WHERE target_table = 'counseling_schedules' AND target_id = ?`,
    ).bind(body.id).all();
    expect(audit.results).toEqual([
      {
        actorId: testActors.counselor.userId,
        actorRole: 'counselor',
        action: 'create',
        targetTable: 'counseling_schedules',
        beneficiaryId: seeded.beneficiaryId,
        supportCaseId: seeded.supportCaseId,
      },
    ]);
  });

  it('rejects a counselor who is not assigned to the case with 403 and stores no schedule', async () => {
    const seeded = await seedOwnedCase();

    const response = await postSchedule(testActors.unassignedCounselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });

    const count = await t.db.prepare(
      'SELECT COUNT(*) AS count FROM counseling_schedules WHERE support_case_id = ?',
    ).bind(seeded.supportCaseId).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it('rejects a malformed schedule time with 400', async () => {
    const seeded = await seedOwnedCase();

    const response = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T09:00:00Z', // milliseconds 없는 비정규 UTC
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });

    const count = await t.db.prepare(
      'SELECT COUNT(*) AS count FROM counseling_schedules WHERE support_case_id = ?',
    ).bind(seeded.supportCaseId).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it('creates a schedule beyond the 7-day window that stays out of the upcoming board', async () => {
    const seeded = await seedOwnedCase();
    const farOutUtc = '2026-08-20T01:00:00.000Z'; // 창(오늘 + 향후 7일) 밖

    const created = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: farOutUtc,
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { id: string };

    const board = await worker.fetch(new Request(
      `http://localhost/schedules/upcoming?date=${ANCHOR_DATE}`,
      { headers: headersFor(testActors.counselor) },
    ), t.env);
    expect(board.status).toBe(200);
    const boardBody = await board.json() as { schedules: Array<{ id: string }> };
    expect(boardBody.schedules.map((schedule) => schedule.id)).not.toContain(createdBody.id);
  });
});
