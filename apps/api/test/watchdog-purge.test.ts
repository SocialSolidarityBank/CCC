import { afterEach, describe, expect, it, vi } from 'vitest';
import apiWorker, { runPurge, runWatchdog } from '../src/index';
import { PURGE_CRON, WATCHDOG_CRON } from '../src/cron-schedule';
import worker from './support/local-worker';
import {
  createBeneficiaryWithInitialSupportCase,
  createCase,
  createCounselingRecord,
  createManualSession,
  enqueueTextWorkItem,
  getPipelineHealth,
  listPipelineJobs,
  registerRecording,
  closeSupportCase,
  updateParticipantPii,
  type Actor,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

const counselor: Actor = testActors.counselor;
const admin: Actor = testActors.admin;
const service: Actor = testActors.service;

const counselorHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': counselor.userId,
  'X-CCC-Org-Id': counselor.orgId,
  'X-CCC-Role': 'counselor',
};
const adminHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': admin.userId,
  'X-CCC-Org-Id': admin.orgId,
  'X-CCC-Role': 'admin',
};

const t = setupD1();

function localEnv() {
  return t.env;
}

/** CCC-113: 파기 스위치가 켜진 환경 — '켜짐 = 기존(즉시 파기) 동작' 검증용. */
function purgeEnabledEnv() {
  return { ...t.env, PII_PURGE_ENABLED: '1' };
}

/** SQLite DEFAULT (datetime('now')) 형식으로 포맷: 'YYYY-MM-DD HH:MM:SS' (UTC, 공백 구분). */
function sqliteUtc(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
}

/** poll_pipeline 감사 행을 지정 시각으로 직접 삽입한다(테스트 셋업 — 직접 DB 허용). */
async function insertPoll(orgId: string, atMs: number): Promise<void> {
  await t.db.prepare(
    "INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, created_at) VALUES (?, 'service@example.invalid', 'service', 'poll_pipeline', 'sessions', ?)",
  ).bind(orgId, sqliteUtc(atMs)).run();
}

/** ms를 게이트웨이 now()와 같은 ISO(UTC) 문자열로 포맷한다. */
function isoUtc(ms: number): string {
  return new Date(ms).toISOString();
}

/** 대기 작업(uploaded + audio_r2_key) 1건이 있는 케이스를 만든다. */
async function makePendingJob(): Promise<string> {
  const caseRecord = await createCase(t.env, counselor, { consentRecordingAt: '2026-01-01T00:00:00.000Z' });
  const session = await createManualSession(t.env, counselor, caseRecord.id, {
    submissionId: '04000000-0000-4000-8000-000000000001',
    heldAt: '2026-01-02T10:00:00.000Z',
    channel: 'in_person',
    memo: 'MEMO',
    gasScores: [],
  });
  await registerRecording(t.env, counselor, session.id, 'audio/seed/pending-key');
  return caseRecord.id;
}

/** 텍스트 일감 큐에 대기 1건이 있는 회차를 만들고, 대기 시작 시각을 지정 시각으로 묵힌다. */
async function makePendingTextWork(enqueuedAtMs: number): Promise<string> {
  const caseRecord = await createCase(t.env, counselor, { consentRecordingAt: '2026-01-01T00:00:00.000Z' });
  const session = await createManualSession(t.env, counselor, caseRecord.id, {
    submissionId: '04000000-0000-4000-8000-000000000002',
    heldAt: '2026-01-02T10:00:00.000Z',
    channel: 'in_person',
    memo: 'MEMO',
    gasScores: [],
  });
  await enqueueTextWorkItem(t.env, counselor, session.id, 'manual_record');
  // pending 행의 enqueued_at 조정은 트리거가 막지 않는다(done 행만 불변) — 테스트 셋업 직접 DB 허용.
  await t.db.prepare(
    "UPDATE ai_text_work_queue SET enqueued_at = ? WHERE session_id = ? AND status = 'pending'",
  ).bind(isoUtc(enqueuedAtMs), session.id).run();
  return session.id;
}

const canonicalPurgeActors = {
  counselor: {
    userId: '77777777-7777-4777-8777-777777777777',
    orgId: 'org_canonical_purge',
    role: 'counselor' as const,
  },
  admin: {
    userId: '88888888-8888-4888-8888-888888888888',
    orgId: 'org_canonical_purge',
    role: 'admin' as const,
  },
};

async function makeClosedParticipant(opts: { overdue: boolean }) {
  const { counselor: canonicalCounselor, admin: canonicalAdmin } = canonicalPurgeActors;
  await t.db.batch([
    t.db.prepare(
      "INSERT INTO organization_settings (org_id, time_zone, pii_purge_grace_days) VALUES ('org_canonical_purge', 'UTC', 180)",
    ),
    t.db.prepare(
      'INSERT INTO users (id, org_id, email, role, active, time_zone) VALUES (?, ?, ?, ?, 1, ?)',
    ).bind(canonicalCounselor.userId, canonicalCounselor.orgId, 'purge.counselor@example.invalid', 'counselor', 'UTC'),
    t.db.prepare(
      'INSERT INTO users (id, org_id, email, role, active, time_zone) VALUES (?, ?, ?, ?, 1, ?)',
    ).bind(canonicalAdmin.userId, canonicalAdmin.orgId, 'purge.admin@example.invalid', 'admin', 'UTC'),
  ]);
  const creation = await createBeneficiaryWithInitialSupportCase(t.env, canonicalCounselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-15T09:00:00.000Z',
  });
  const record = await createCounselingRecord(t.env, canonicalCounselor, creation.supportCaseId, {
    submissionId: '99999999-9999-4999-8999-999999999999',
    heldAt: '2026-07-15T10:00:00.000Z',
    channel: 'in_person',
    memo: 'RECORD_RETAINED_AFTER_PURGE',
    gasScores: [],
    actionItems: [],
    flags: [],
  });
  await updateParticipantPii(t.env, canonicalAdmin, creation.beneficiaryId, {
    supportCaseContextId: creation.supportCaseId,
    expectedVersion: 1,
    name: 'PURGE_NAME_CANARY',
    phone: '010-0000-0000',
    account: '111-222',
  });
  if (opts.overdue) {
    await t.db.prepare(
      `UPDATE support_cases
       SET status = 'closed',
           closed_at = '2000-01-01 00:00:00',
           closed_reason = 'graduated',
           closed_by_actor_id = ?,
           updated_at = '2000-01-01 00:00:00'
       WHERE id = ? AND org_id = ? AND status = 'active'`,
    ).bind(
      canonicalCounselor.userId,
      creation.supportCaseId,
      canonicalCounselor.orgId,
    ).run();
  } else {
    await closeSupportCase(t.env, canonicalCounselor, creation.supportCaseId, 'graduated');
  }
  return { ...creation, recordId: record.record.id };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('pipeline watchdog (D8)', () => {
  it('reports stale when the last poll is older than the threshold', async () => {
    await t.reset();
    await makePendingJob();
    await insertPoll(counselor.orgId, Date.now() - 7 * 60 * 60 * 1000); // 7시간 전 (임계 6h 초과)

    const health = await getPipelineHealth(t.env, admin);
    expect(health.stale).toBe(true);
    expect(health.status).toBe('stale');
    expect(health.lastPolledAt).not.toBeNull();
    expect(health.pendingJobCount).toBe(1);
    expect(health.thresholdHours).toBe(6);
  });

  it('reports ok when a fresh poll exists within the threshold', async () => {
    await t.reset();
    await makePendingJob();
    // listPipelineJobs가 실제 datetime('now') 형식으로 poll_pipeline을 남긴다.
    await listPipelineJobs(t.env, service);

    const health = await getPipelineHealth(t.env, admin);
    expect(health.stale).toBe(false);
    expect(health.status).toBe('ok');
    expect(health.lastPolledAt).not.toBeNull();
  });

  it('is inactive when there is neither a poll history nor a pending job', async () => {
    await t.reset();
    const health = await getPipelineHealth(t.env, admin);
    expect(health.status).toBe('inactive');
    expect(health.stale).toBe(false);
    expect(health.lastPolledAt).toBeNull();
    expect(health.pendingJobCount).toBe(0);
  });

  it('is stale when a job waits but no poll was ever recorded', async () => {
    await t.reset();
    await makePendingJob();

    const health = await getPipelineHealth(t.env, admin);
    expect(health.status).toBe('stale');
    expect(health.stale).toBe(true);
    expect(health.lastPolledAt).toBeNull();
    expect(health.pendingJobCount).toBe(1);
  });

  it('is stale (queue_backlog) when polling is fresh but the oldest audio job outwaits the queue threshold', async () => {
    await t.reset();
    await makePendingJob();
    // 오디오 큐의 나이 기준은 sessions.updated_at — 7시간 전으로 묵힌다(임계 6h 초과).
    await t.db.prepare(
      "UPDATE sessions SET updated_at = ? WHERE ai_status = 'uploaded'",
    ).bind(isoUtc(Date.now() - 7 * 60 * 60 * 1000)).run();
    await listPipelineJobs(t.env, service); // 폴링은 최신

    const health = await getPipelineHealth(t.env, admin);
    expect(health.status).toBe('stale');
    expect(health.stale).toBe(true);
    expect(health.staleReasons).toEqual(['queue_backlog']);
    expect(health.lastPolledAt).not.toBeNull();
    expect(health.pendingJobCount).toBe(1);
    expect(health.oldestPendingSince).not.toBeNull();
    expect(health.oldestPendingHours ?? 0).toBeGreaterThan(6);
    expect(health.queueThresholdHours).toBe(6);
  });

  it('is stale (queue_backlog) when polling is fresh but a text work item outwaits the queue threshold', async () => {
    await t.reset();
    await makePendingTextWork(Date.now() - 7 * 60 * 60 * 1000); // 임계 6h 초과
    await listPipelineJobs(t.env, service); // 폴링은 최신

    const health = await getPipelineHealth(t.env, admin);
    expect(health.status).toBe('stale');
    expect(health.stale).toBe(true);
    expect(health.staleReasons).toEqual(['queue_backlog']);
    expect(health.pendingJobCount).toBe(0);
    expect(health.pendingTextWorkCount).toBe(1);
    expect(health.pendingTotalCount).toBe(1);
    expect(health.oldestPendingHours ?? 0).toBeGreaterThan(6);
  });

  it('stays ok for a fresh poll with only recent pending work, and sums both queues', async () => {
    await t.reset();
    await makePendingJob();
    await makePendingTextWork(Date.now() - 60 * 1000); // 1분 전 — 임계 안
    await listPipelineJobs(t.env, service);

    const health = await getPipelineHealth(t.env, admin);
    expect(health.status).toBe('ok');
    expect(health.stale).toBe(false);
    expect(health.staleReasons).toEqual([]);
    expect(health.pendingJobCount).toBe(1);
    expect(health.pendingTextWorkCount).toBe(1);
    expect(health.pendingTotalCount).toBe(2);
    expect(health.oldestPendingSince).not.toBeNull();
    expect(health.lastCompletedAt).toBeNull();
  });

  it('honors PIPELINE_QUEUE_STALE_HOURS separately from the poll threshold', async () => {
    await t.reset();
    await makePendingTextWork(Date.now() - 7 * 60 * 60 * 1000); // 폴링 임계(6h)는 넘지만
    await listPipelineJobs(t.env, service);

    const env = { ...t.env, PIPELINE_QUEUE_STALE_HOURS: '24' }; // 큐 임계(24h)는 안 넘는다
    const health = await getPipelineHealth(env, admin);
    expect(health.status).toBe('ok');
    expect(health.stale).toBe(false);
    expect(health.queueThresholdHours).toBe(24);
    expect(health.thresholdHours).toBe(6);
  });

  it('reports lastCompletedAt from the newest completed text work item', async () => {
    await t.reset();
    const sessionId = await makePendingTextWork(Date.now() - 60 * 1000);
    const completedAt = isoUtc(Date.now() - 30 * 60 * 1000);
    // pending → done 전환은 트리거가 허용한다(불변은 done 행뿐) — 테스트 셋업 직접 DB 허용.
    await t.db.prepare(
      "UPDATE ai_text_work_queue SET status = 'done', completed_at = ? WHERE session_id = ? AND status = 'pending'",
    ).bind(completedAt, sessionId).run();
    await listPipelineJobs(t.env, service);

    const health = await getPipelineHealth(t.env, admin);
    expect(health.status).toBe('ok');
    expect(health.pendingTextWorkCount).toBe(0);
    expect(health.pendingTotalCount).toBe(0);
    expect(health.oldestPendingSince).toBeNull();
    expect(health.oldestPendingHours).toBeNull();
    expect(health.lastCompletedAt).toBe(completedAt);
  });

  it('forbids the health route for a counselor and allows an admin', async () => {
    await t.reset();
    const env = localEnv();
    const forbidden = await worker.fetch(new Request('http://localhost/pipeline/health', { headers: counselorHeaders }), env);
    expect(forbidden.status).toBe(403);

    const ok = await worker.fetch(new Request('http://localhost/pipeline/health', { headers: adminHeaders }), env);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ status: 'inactive', orgId: 'org_demo' });
  });

  it('runWatchdog notifies admins for a stale org and audits the check', async () => {
    await t.reset();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await makePendingJob(); // 폴링 이력 없음 + 대기 작업 → stale

    const healths = await runWatchdog(t.env);
    expect(healths.some((health) => health.orgId === 'org_demo' && health.stale)).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[WATCHDOG ALERT]'));

    const audit = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'watchdog_check' AND actor_id = 'system:watchdog'",
    ).first<{ count: number }>();
    expect(audit?.count).toBe(1);
  });
  it('runs the watchdog only for its exact cron expression and fails closed for unknown schedules', async () => {
    await t.reset();
    await makePendingJob();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext;

    await apiWorker.scheduled({ cron: WATCHDOG_CRON } as ScheduledController, t.env, ctx);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[WATCHDOG ALERT]'));

    const unknownWaitUntil = vi.fn();
    await expect(apiWorker.scheduled(
      { cron: '17 17 * * *' } as ScheduledController,
      t.env,
      { waitUntil: unknownWaitUntil } as unknown as ExecutionContext,
    )).rejects.toThrow('unexpected_scheduled_trigger');
    expect(unknownWaitUntil).not.toHaveBeenCalled();
  });
});

describe('canonical participant PII purge (D10)', () => {
  it('runs the canonical purge from the scheduled cron and retains pseudonymous support-case records', async () => {
    await t.reset();
    const participant = await makeClosedParticipant({ overdue: true });
    const pending: Promise<unknown>[] = [];
    // CCC-113: 파기는 PII_PURGE_ENABLED='1' 전제에서만 기존 동작이 나온다.
    await apiWorker.scheduled(
      { cron: PURGE_CRON } as ScheduledController,
      purgeEnabledEnv(),
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext,
    );
    await Promise.all(pending);

    const vault = await t.db.prepare(
      'SELECT enc_name, enc_phone, enc_account, purged_at FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first<{
      enc_name: string | null;
      enc_phone: string | null;
      enc_account: string | null;
      purged_at: string | null;
    }>();
    expect(vault).toEqual({
      enc_name: null,
      enc_phone: null,
      enc_account: null,
      purged_at: expect.any(String),
    });
    const supportCase = await t.db.prepare(
      'SELECT status FROM support_cases WHERE id = ?',
    ).bind(participant.supportCaseId).first<{ status: string }>();
    expect(supportCase?.status).toBe('closed');
    const record = await t.db.prepare(
      'SELECT memo FROM sessions WHERE id = ?',
    ).bind(participant.recordId).first<{ memo: string }>();
    expect(record?.memo).toBe('RECORD_RETAINED_AFTER_PURGE');
    const audit = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'purge_pii' AND actor_id = 'system:purge' AND target_id = ?",
    ).bind(participant.beneficiaryId).first<{ count: number }>();
    expect(audit?.count).toBe(1);
  });

  it('reports canonical purge counts and is idempotent for non-due and already-purged participants', async () => {
    await t.reset();
    const notDue = await makeClosedParticipant({ overdue: false });
    await expect(runPurge(purgeEnabledEnv())).resolves.toEqual({ attempted: 0, purged: 0, noops: 0 });
    const before = await t.db.prepare(
      'SELECT enc_name, purged_at FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(notDue.beneficiaryId).first<{ enc_name: string | null; purged_at: string | null }>();
    expect(before).toEqual({ enc_name: expect.any(String), purged_at: null });

    await t.reset();
    const overdue = await makeClosedParticipant({ overdue: true });
    await expect(runPurge(purgeEnabledEnv())).resolves.toEqual({ attempted: 1, purged: 1, noops: 0 });
    const firstPurge = await t.db.prepare(
      'SELECT purged_at FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(overdue.beneficiaryId).first<{ purged_at: string | null }>();
    expect(firstPurge?.purged_at).toEqual(expect.any(String));
    await expect(runPurge(purgeEnabledEnv())).resolves.toEqual({ attempted: 0, purged: 0, noops: 0 });
    const secondPurge = await t.db.prepare(
      'SELECT purged_at FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(overdue.beneficiaryId).first<{ purged_at: string | null }>();
    expect(secondPurge?.purged_at).toBe(firstPurge?.purged_at);
  });

  // CCC-113 (P0-3 1단계): 스위치 없이(기본 닫힘) 두 파기 경로 모두 파기하지 않는다.
  it('does not purge from the cron path when the switch is unset and logs the waiting count', async () => {
    await t.reset();
    const participant = await makeClosedParticipant({ overdue: true });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    // 경로 A: cron 진입점(scheduled → runPurge), 스위치 미설정.
    const pending: Promise<unknown>[] = [];
    await apiWorker.scheduled(
      { cron: PURGE_CRON } as ScheduledController,
      t.env,
      { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext,
    );
    await Promise.all(pending);
    await expect(runPurge(t.env)).resolves.toEqual({ attempted: 0, purged: 0, noops: 0 });
    // watchdog 알림(notifyAdmins → console.error)이 아니라 console.log 한 줄만 남는다.
    expect(consoleLog).toHaveBeenCalledWith('파기 스위치 꺼짐, 대상 1건 대기');

    const vault = await t.db.prepare(
      'SELECT enc_name, purged_at FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first<{ enc_name: string | null; purged_at: string | null }>();
    expect(vault).toEqual({ enc_name: expect.any(String), purged_at: null });
    const audit = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'purge_pii'",
    ).first<{ count: number }>();
    expect(audit?.count).toBe(0);
  });

  it('rejects the manual purge endpoint with 409 while the switch is off and keeps the read-only preview', async () => {
    await t.reset();
    const env = localEnv();

    // 경로 B: 수동 실행은 명시적 오류로 닫힌다.
    const rejected = await worker.fetch(
      new Request('http://localhost/pii-purge', { method: 'POST', headers: adminHeaders }),
      env,
    );
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toEqual({ error: 'purge_disabled' });

    // 미리보기(GET /pii-purge/due)는 읽기 전용이라 스위치와 무관하게 살아 있다.
    const preview = await worker.fetch(
      new Request('http://localhost/pii-purge/due', { headers: adminHeaders }),
      env,
    );
    expect(preview.status).toBe(200);
    expect(await preview.json()).toEqual({ due: [] });

    // 스위치가 켜지면 기존 동작(실행) 그대로다.
    const enabled = await worker.fetch(
      new Request('http://localhost/pii-purge', { method: 'POST', headers: adminHeaders }),
      purgeEnabledEnv(),
    );
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toEqual({ purgedCaseIds: [] });
  });
});
