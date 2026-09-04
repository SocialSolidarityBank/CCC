import { describe, expect, it } from 'vitest';

import {
  closeSupportCase,
  createBeneficiaryWithInitialSupportCase,
  createCounselingRecord,
  createSupportCase,
  listAssignedParticipants,
  processParticipantPiiRetention,
  updateParticipantPii,
  type Actor,
} from '../../../db/gateway';
import apiWorker from '../src/index';
import { PURGE_CRON } from '../src/cron-schedule';
import { createScheduledJobRunner } from '../src/scheduled-job-runner';
import worker from './support/local-worker';
import { setupD1, testActors } from './support/d1';
const t = setupD1();
const counselor: Actor = testActors.counselor;
const admin: Actor = testActors.admin;
const otherAdmin: Actor = testActors.otherOrgAdmin;
function actorHeaders(actor: Actor): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}
function purgeEnabledEnv() {
  return { ...t.env, PII_PURGE_ENABLED: '1' };
}
async function runRetentionCron(env = t.env): Promise<void> {
  const pending: Promise<unknown>[] = [];
  await apiWorker.scheduled(
    { cron: PURGE_CRON } as ScheduledController,
    env,
    { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext,
  );
  await Promise.all(pending);
}

async function makeDueParticipant() {
  const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2025-01-01T09:00:00.000Z',
  });
  const record = await createCounselingRecord(t.env, counselor, created.supportCaseId, {
    submissionId: '72727272-7272-4727-8727-727272727272',
    heldAt: '2025-01-01T10:00:00.000Z',
    channel: 'in_person',
    memo: 'PSEUDONYMOUS_RECORD_SURVIVES',
    gasScores: [],
    actionItems: [],
    flags: [],
  });
  await updateParticipantPii(t.env, admin, created.beneficiaryId, {
    supportCaseContextId: created.supportCaseId,
    expectedVersion: 1,
    name: 'ARCHIVE_NAME_CANARY',
    phone: '010-7777-7777',
    account: '777-777',
  });
  await t.db.prepare(
    `UPDATE support_cases
     SET status = 'closed', closed_at = '2025-01-01 00:00:00',
         closed_reason = 'graduated', closed_by_actor_id = ?,
         updated_at = '2025-01-01 00:00:00'
     WHERE id = ? AND org_id = ? AND status = 'active'`,
  ).bind(counselor.userId, created.supportCaseId, counselor.orgId).run();
  return { ...created, recordId: record.record.id };
}
describe('participant PII retention lifecycle (CCC-121)', () => {
  it('removes archived participants from ordinary lists', async () => {
    await t.reset();
    await makeDueParticipant();
    expect(await listAssignedParticipants(t.env, admin)).toHaveLength(1);
    await runRetentionCron();
    expect(await listAssignedParticipants(t.env, admin)).toEqual([]);
  });
  it('honors the scheduled instant end to end: runner nowIso and Workers scheduledTime both reach the retention clock (E1-4)', async () => {
    await t.reset();
    await makeDueParticipant(); // closed 2025-01-01, due one year later

    const early = await createScheduledJobRunner(t.env).run('pii_retention', '2025-06-01T03:00:00.000Z');
    expect(early).toMatchObject({ kind: 'pii_retention', nowIso: '2025-06-01T03:00:00.000Z', counters: { archived: 0 } });
    expect(await listAssignedParticipants(t.env, admin)).toHaveLength(1);

    const pending: Promise<unknown>[] = [];
    await apiWorker.scheduled(
      { cron: PURGE_CRON, scheduledTime: Date.parse('2026-09-04T03:00:00.000Z') } as ScheduledController,
      t.env,
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext,
    );
    await Promise.all(pending);
    expect(await listAssignedParticipants(t.env, admin)).toEqual([]);
  });
  it('archives due PII and queues review without purging', async () => {
    await t.reset();
    const participant = await makeDueParticipant();
    expect(await processParticipantPiiRetention(t.env))
      .toEqual({ attempted: 1, archived: 1, requeued: 0 });
    const vault = await t.db.prepare(
      `SELECT enc_name, enc_phone, enc_account, purged_at
       FROM participant_pii_vault WHERE beneficiary_id = ?`,
    ).bind(participant.beneficiaryId).first<{
      enc_name: string | null;
      enc_phone: string | null;
      enc_account: string | null;
      purged_at: string | null;
    }>();
    expect(vault).toEqual({ enc_name: null, enc_phone: null, enc_account: null, purged_at: null });
    const archive = await t.db.prepare(
      `SELECT enc_name, enc_phone, enc_account, review_status
       FROM participant_pii_archives WHERE beneficiary_id = ? AND org_id = ?`,
    ).bind(participant.beneficiaryId, admin.orgId).first<{
      enc_name: string | null;
      enc_phone: string | null;
      enc_account: string | null;
      review_status: string;
    }>();
    expect(archive).toEqual({
      enc_name: expect.any(String),
      enc_phone: expect.any(String),
      enc_account: expect.any(String),
      review_status: 'pending',
    });
    const record = await t.db.prepare(
      'SELECT memo FROM sessions WHERE id = ?',
    ).bind(participant.recordId).first<{ memo: string }>();
    expect(record?.memo).toBe('PSEUDONYMOUS_RECORD_SURVIVES');
  });
  it('records a retention reason and keeps another organization out of the queue', async () => {
    await t.reset();
    const participant = await makeDueParticipant();
    await runRetentionCron();
    const forbidden = await worker.fetch(new Request(
      'http://localhost/pii-retention/reviews',
      { headers: actorHeaders(counselor) },
    ), t.env);
    expect(forbidden.status).toBe(403);
    const hidden = await worker.fetch(new Request(
      'http://localhost/pii-retention/reviews',
      { headers: actorHeaders(otherAdmin) },
    ), t.env);
    expect(hidden.status).toBe(200);
    expect(await hidden.json()).toEqual({ reviews: [] });
    const retained = await worker.fetch(new Request(
      `http://localhost/pii-retention/reviews/${encodeURIComponent(participant.beneficiaryId)}`,
      {
        method: 'POST',
        headers: actorHeaders(admin),
        body: JSON.stringify({
          decision: 'retain',
          reasonKind: 'active_work',
          reason: '진행 중인 정산 업무',
          retainUntil: '2027-01-01T00:00:00.000Z',
        }),
      },
    ), t.env);
    expect(retained.status).toBe(200);
    expect(await retained.json()).toMatchObject({
      beneficiaryId: participant.beneficiaryId,
      status: 'retained',
      reasonKind: 'active_work',
    });
    await processParticipantPiiRetention(t.env, { at: '2027-01-02T00:00:00.000Z' });
    const requeued = await worker.fetch(new Request(
      'http://localhost/pii-retention/reviews',
      { headers: actorHeaders(admin) },
    ), t.env);
    expect(await requeued.json()).toMatchObject({
      reviews: [{ beneficiaryId: participant.beneficiaryId, status: 'pending' }],
    });
    const decision = await t.db.prepare(
      `SELECT reason_kind, reason, retain_until
       FROM participant_pii_retention_decisions
       WHERE beneficiary_id = ? AND decision = 'retain'`,
    ).bind(participant.beneficiaryId).first<{
      reason_kind: string;
      reason: string;
      retain_until: string;
    }>();
    expect(decision).toEqual({
      reason_kind: 'active_work',
      reason: '진행 중인 정산 업무',
      retain_until: '2027-01-01T00:00:00.000Z',
    });
  });
  it('rejects a legacy admin after the institution-admin grant is revoked', async () => {
    await t.reset();
    await makeDueParticipant();
    await runRetentionCron();
    await t.db.prepare(
      `UPDATE user_role_assignments SET revoked_at = datetime('now')
       WHERE user_id = ? AND org_id = ? AND role = 'institution_admin' AND revoked_at IS NULL`,
    ).bind(admin.userId, admin.orgId).run();
    const response = await worker.fetch(new Request(
      'http://localhost/pii-retention/reviews',
      { headers: actorHeaders(admin) },
    ), t.env);
    expect(response.status).toBe(403);
  });
  it('requires an enabled switch and admin approval before final purge', async () => {
    await t.reset();
    const participant = await makeDueParticipant();
    await runRetentionCron();
    const url = `http://localhost/pii-retention/reviews/${encodeURIComponent(participant.beneficiaryId)}`;

    const disabled = await worker.fetch(new Request(url, {
      method: 'POST',
      headers: actorHeaders(admin),
      body: JSON.stringify({ decision: 'purge' }),
    }), t.env);
    expect(disabled.status).toBe(409);
    expect(await disabled.json()).toEqual({ error: 'purge_disabled' });
    const approved = await worker.fetch(new Request(url, {
      method: 'POST',
      headers: actorHeaders(admin),
      body: JSON.stringify({ decision: 'purge' }),
    }), purgeEnabledEnv());
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({
      beneficiaryId: participant.beneficiaryId,
      status: 'purged',
    });
    const vault = await t.db.prepare(
      'SELECT enc_name, purged_at FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first<{ enc_name: string | null; purged_at: string | null }>();
    expect(vault).toEqual({ enc_name: null, purged_at: expect.any(String) });
    const archive = await t.db.prepare(
      'SELECT enc_name, review_status FROM participant_pii_archives WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first<{ enc_name: string | null; review_status: string }>();
    expect(archive).toEqual({ enc_name: null, review_status: 'purged' });
    const audit = await t.db.prepare(
      `SELECT action FROM audit_log
       WHERE beneficiary_id = ? ORDER BY id`,
    ).bind(participant.beneficiaryId).all<{ action: string }>();
    expect(audit.results.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      'schedule_pii_purge_due', 'archive_pii', 'approve_pii_purge', 'purge_pii',
    ]));
  });
  it('restores archived PII when a new support case starts', async () => {
    await t.reset();
    const participant = await makeDueParticipant();
    await runRetentionCron();
    const before = await t.db.prepare(
      'SELECT review_status FROM participant_pii_archives WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first<{ review_status: string }>();
    expect(before?.review_status).toBe('pending');
    await createSupportCase(t.env, admin, participant.beneficiaryId, {
      schemaVersion: 1,
      submissionId: '73737373-7373-4737-8737-737373737373',
      programType: 'financial_support_v1',
      initialAssigneeUserId: counselor.userId,
      consentPrivacy: true,
    });
    const vault = await t.db.prepare(
      'SELECT enc_name, purge_due FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first<{ enc_name: string | null; purge_due: string | null }>();
    expect(vault).toEqual({ enc_name: expect.any(String), purge_due: null });
    const archive = await t.db.prepare(
      'SELECT 1 AS present FROM participant_pii_archives WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first<{ present: number }>();
    expect(archive).toBeNull();
  });
});
