import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActorAuthenticationError, type Actor as IdentityActor, type JobReport } from '@ccc/contracts/runtime';
import type { StorageSignerRequest } from '@ccc/contracts/audio';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import {
  admitRecordingUpload,
  appendSupportCaseConsentEvent,
  beginRecordingUploadIntent,
  createCase,
  createManualSession,
  getSupportCaseConsent,
  issueSupportCaseConsentDisclosures,
  recordSttReadiness,
  type AgentRuntime,
} from '@ccc/core/gateway';
import { dueScheduledJobKinds } from '@ccc/core/scheduled-job-runner';
import { handleRequest, type ActorResolver } from '@ccc/http-api';
import { createSchedulerSecretResolver } from '@ccc/http-api/scheduler-identity';
import {
  seedTestProgramWithRuntimeModes,
  setupD1,
  testActors,
  testProgramId,
  TEST_PII_KEY,
  type TestApiEnv,
} from './support/d1';
import { agentManifestEnv, seedCanonicalSttConsent } from './support/agent-jobs';
import { registrationInput } from './support/registration';

const { counselor, service } = testActors;
const SCHEDULER_SECRET = 'scheduler-shared-secret-0123456789abcdef';
const CLOUD_RUNTIME: AgentRuntime = {
  route: 'community-cloud-agent',
  sttEngine: 'local',
  sttEngineId: 'qwen3-asr',
  audioDelivery: 'protected-get',
};
const t = setupD1();
let env: TestApiEnv;
/** 안쪽 resolver 가 불렸는지는 401 로 관찰한다 — 위임과 scheduler 발급은 응답이 달라야 한다. */
let innerCalls = 0;

function inner(): ActorResolver {
  return async () => {
    innerCalls += 1;
    throw new ActorAuthenticationError();
  };
}

function schedulerResolver(secretEnv: Partial<Record<'SCHEDULER_SECRET', string>> = { SCHEDULER_SECRET }): ActorResolver {
  return createSchedulerSecretResolver({
    secretStore: createEnvironmentSecretStore({ PII_ENC_KEY: TEST_PII_KEY, ...secretEnv }),
    organizationId: counselor.orgId,
    inner: inner(),
  });
}

async function post(
  path: string,
  init: { bearer?: string | null; origin?: string; body?: string | null; method?: string } = {},
  resolveActor: ActorResolver = schedulerResolver(),
): Promise<Response> {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (init.bearer !== null) headers.set('authorization', `Bearer ${init.bearer ?? SCHEDULER_SECRET}`);
  if (init.origin !== undefined) headers.set('origin', init.origin);
  return handleRequest(new Request(`https://api.example.invalid${path}`, {
    method: init.method ?? 'POST',
    headers,
    ...(init.body === null ? {} : { body: init.body ?? '{}' }),
  }), env, resolveActor);
}

beforeEach(async () => {
  await t.reset();
  innerCalls = 0;
  env = await agentManifestEnv(t.env, { mode: 'community-cloud', stt: 'local' });
  env.secretStore = createEnvironmentSecretStore({ PII_ENC_KEY: TEST_PII_KEY });
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, {
    deploymentMode: 'community-cloud',
    sttMode: 'local',
    llmMode: 'off',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

function freezeUtc(iso: string): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

describe('dueScheduledJobKinds', () => {
  it('matches the Workers cron cadence on the UTC minute', () => {
    expect(dueScheduledJobKinds('2026-09-12T03:00:00.000Z'))
      .toEqual(['audio_expiry', 'counseling_memory', 'pipeline_watchdog', 'pii_retention']);
    expect(dueScheduledJobKinds('2026-09-12T03:01:00.000Z')).toEqual([]);
    expect(dueScheduledJobKinds('2026-09-12T11:05:30.000Z')).toEqual(['audio_expiry']);
    expect(dueScheduledJobKinds('2026-09-12T11:30:00.000Z'))
      .toEqual(['audio_expiry', 'counseling_memory', 'pipeline_watchdog']);
    expect(dueScheduledJobKinds('2026-09-12T11:02:00.000Z')).toEqual(['counseling_memory']);
    // 03:00 은 UTC 기준이다. 같은 분이라도 다른 시각이면 보존 작업은 due 가 아니다.
    expect(dueScheduledJobKinds('2026-09-12T04:00:00.000Z')).not.toContain('pii_retention');
    expect(() => dueScheduledJobKinds('not-a-time')).toThrow();
  });
});

describe('scheduler shared secret identity', () => {
  it('mints the system actor and runs exactly the due jobs', async () => {
    freezeUtc('2026-09-12T11:05:00.000Z');
    const response = await post('/internal/scheduler/run');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json() as { ranAt: string; jobs: JobReport[] };
    expect(body.ranAt).toBe('2026-09-12T11:05:00.000Z');
    expect(body.jobs.map((job) => job.kind)).toEqual(['audio_expiry']);
    expect(body.jobs[0]?.nowIso).toBe(body.ranAt);
    expect(innerCalls).toBe(0);
  });

  it('runs the memory drain on its own even-minute cadence', async () => {
    freezeUtc('2026-09-12T11:02:00.000Z');
    const body = await (await post('/internal/scheduler/run')).json() as { jobs: JobReport[] };
    expect(body.jobs.map((job) => job.kind)).toEqual(['counseling_memory']);
  });

  it('delegates a mismatched bearer and an installation without the secret', async () => {
    const mismatch = await post('/internal/scheduler/run', { bearer: 'scheduler-shared-secret-0123456789abcdeg' });
    expect(mismatch.status).toBe(401);
    const absent = await post('/internal/scheduler/run', {}, schedulerResolver({}));
    expect(absent.status).toBe(401);
    const noBearer = await post('/internal/scheduler/run', { bearer: null });
    expect(noBearer.status).toBe(401);
    expect(innerCalls).toBe(3);
  });

  it('refuses browser origins, wrong methods and any body but an empty object', async () => {
    expect((await post('/internal/scheduler/run', { origin: 'https://client.invalid' })).status).toBe(403);
    expect((await post('/internal/scheduler/run', { method: 'GET', body: null })).status).toBe(404);
    expect((await post('/internal/scheduler/run', { body: '{"at":"2026-09-12T03:00:00.000Z"}' })).status).toBe(400);
    expect((await post('/internal/scheduler/run', { body: '[]' })).status).toBe(400);
    expect(innerCalls).toBe(0);
  });

  it('requires the scheduler:run scope on this route', async () => {
    const weak: IdentityActor = {
      kind: 'system',
      userId: 'system:scheduler',
      orgId: counselor.orgId,
      roles: ['service'],
      scopes: ['/internal/storage/authorize'],
      authn: { source: 'scheduler-secret', assurance: 'none', sessionId: null },
    };
    expect((await post('/internal/scheduler/run', {}, async () => weak)).status).toBe(403);
  });

  it('keeps the scheduler actor off every business route', async () => {
    expect((await post('/me', { method: 'GET', body: null })).status).toBe(403);
    expect((await post('/capabilities', { method: 'GET', body: null })).status).toBe(403);
    expect((await post('/participants', { method: 'GET', body: null })).status).toBe(403);
    expect((await post('/auth/logout', {})).status).toBe(403);
    expect(innerCalls).toBe(0);
  });

  it('returns 503 while the runtime has no audio store', async () => {
    freezeUtc('2026-09-12T11:05:00.000Z');
    env = { ...env, audioStore: null } as TestApiEnv;
    const response = await post('/internal/scheduler/run');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'service_unavailable' });
  });

  it('passes the real storage authorize scheduler lane for a pending deletion', async () => {
    const participant = await createCase(env, counselor, await registrationInput(env, counselor, {
      programId: testProgramId(counselor.orgId),
    }));
    const session = await createManualSession(env, counselor, participant.id, {
      submissionId: crypto.randomUUID(),
      heldAt: '2026-09-10T10:00:00.000Z',
      channel: 'in_person',
      memo: 'Synthetic scheduler deletion fixture.',
      gasScores: [],
    });
    const scope = await t.db.prepare('SELECT support_case_id FROM sessions WHERE id=? AND org_id=?')
      .bind(session.id, counselor.orgId).first<{ support_case_id: string }>();
    if (scope === null) throw new Error('missing support case fixture');
    await seedCanonicalSttConsent(env, counselor, scope.support_case_id);
    await recordSttReadiness(env, service, {
      schemaVersion: 1, sttMode: 'local', sttEngineId: 'qwen3-asr', state: 'ready', capacity: 1,
    });
    const admission = await admitRecordingUpload(env, counselor, session.id, CLOUD_RUNTIME);
    await beginRecordingUploadIntent(env, counselor, session.id, admission, 'protected-get', {
      contentLength: 128,
      contentType: 'audio/wav',
      clientAssertedSha256: null,
      storageSha256: null,
      uploadExpiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
    });
    // 동의 철회가 삭제 의도를 만든다 — 철회 뒤에도 삭제는 막히지 않아야 한다.
    const current = (await getSupportCaseConsent(env, counselor, scope.support_case_id))
      .find((item) => item.domain === 'counseling_recording');
    const disclosure = (await issueSupportCaseConsentDisclosures(env, counselor, scope.support_case_id))
      .find((item) => item.domain === 'counseling_recording');
    if (current?.state !== 'granted' || current.revision === null || disclosure === undefined) {
      throw new Error('missing recording consent fixture');
    }
    await appendSupportCaseConsentEvent(env, counselor, scope.support_case_id, {
      domain: 'counseling_recording',
      decision: 'withdraw',
      provider: current.provider,
      providerLegalRecipient: current.providerLegalRecipient,
      providerCountry: current.providerCountry,
      purpose: current.purpose,
      retentionDuration: current.retentionDuration,
      copyVersion: disclosure.copyVersion,
      copyHash: disclosure.copyHash,
      disclosureSnapshotId: disclosure.snapshotId,
      effectiveAt: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
      correctionOfEventId: null,
      expectedRevision: current.revision,
    });
    const row = await t.db.prepare(
      `SELECT id,key,generation_id,deletion_attempt_id,deletion_reason,object_sha256
       FROM audio_objects WHERE org_id=?`,
    ).bind(counselor.orgId).first<{
      id: string; key: string; generation_id: string; deletion_attempt_id: string;
      deletion_reason: string; object_sha256: string | null;
    }>();
    if (row === null || row.deletion_attempt_id === null) throw new Error('missing deletion intent fixture');
    const requestedAt = new Date().toISOString();
    await t.db.prepare(
      `INSERT INTO audio_deletion_attempts(
         id,deletion_attempt_id,phase,org_id,audio_object_id,generation_id,reason,requested_at,created_at
       ) VALUES(?,?,'requested',?,?,?,?,?,?)`,
    ).bind(
      `${row.deletion_attempt_id}:requested`, row.deletion_attempt_id, counselor.orgId,
      row.id, row.generation_id, row.deletion_reason, requestedAt, requestedAt,
    ).run();
    const authorization: StorageSignerRequest = {
      bucket: 'ccc-audio',
      objectKey: row.key,
      action: 'delete',
      principal: 'scheduler',
      objectSha256: row.object_sha256,
      context: {
        kind: 'deletion',
        audioObjectId: row.id,
        generationId: row.generation_id,
        deletionAttemptId: row.deletion_attempt_id,
      },
    };
    const response = await post('/internal/storage/authorize', { body: JSON.stringify(authorization) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ allowed: true, generationId: row.generation_id, expiresAt: null });
    expect(innerCalls).toBe(0);
  });
});
