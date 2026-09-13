// S5 Agent 작업 계약 v2 (E5-1a) — claim, 공정성, 임대, 동의 철회, 멱등 결과, 재시도 상한,
// NER fail-closed 를 고정한다. 전달 방식·자격 경계는 agent-job-contract.modes.test.ts 가 맡는다.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_JOB_ERROR_CODES,
  AGENT_JOB_STATES,
  CLAIM_LIMIT_DEFAULT,
  CLAIM_LIMIT_MAX,
  CLAIM_LIMIT_MIN,
  jobErrorHttpStatus,
  normalizeClaimLimit,
} from '@ccc/contracts/agent-jobs';
import {
  acceptAgentJobResult,
  abandonRecordingUpload,
  admitRecordingUpload,
  acknowledgeAudioManualNoteFallback,
  appendSupportCaseConsentEvent,
  authorizeAgentJobEgress,
  authorizeRecordingUploadTarget,
  beginAgentJobAudioTargetMint,
  beginRecordingUploadIntent,
  completeAgentJobAudioTargetMint,
  failAgentJobAudioTargetMint,
  ConflictError,
  AgentJobContractError,
  claimAgentJobs,
  closeAgentJobAudioObjectMissing,
  createCase,
  createCounselingRecord,
  enqueueTextWorkItem,
  issueSupportCaseConsentDisclosures,
  getAgentJobSource,
  heartbeatAgentJob,
  interleaveAgentJobQueues,
  issueAgentJobMaskDictionary,
  markAgentJobEgressInFlight,
  listAudioManualNoteFallbacks,
  listSupportCasesForBeneficiary,
  recordSttReadiness,
  registerRecording,
  reconcileAudioObjectDeletion,
  releaseAgentJob,
  verifyAgentJobAudio,
  runAudioExpiry,
  getSupportCaseConsent,
  type Actor,
  type AgentRuntime,
} from '@ccc/core/gateway';
import type { AudioDeletionEvidence, AudioStore } from '@ccc/contracts/runtime';
import type { ConsentDomain } from '@ccc/contracts/consent';
import type { PreparedStatement } from '@ccc/contracts/database';
import { deliverAudioLifecycleIncidents } from '@ccc/core/scheduled-job-runner';
import { seedTestProgramWithRuntimeModes, setupD1, testActors, testProgramId } from './support/d1';
import {
  agentResultRequest,
  claimRequest,
  LOCAL_SINGLE_RUNTIME,
  TEXT_ONLY_RUNTIME,
  registerFixtureRecording,
  seedCanonicalSttConsent,
  seedNerQualification,
} from './support/agent-jobs';
import { registrationInput } from './support/registration';

vi.setConfig({ testTimeout: 60_000 });

const { counselor, service } = testActors;
const secondAgent: Actor = { userId: 'service.second@example.invalid', orgId: 'org_demo', role: 'service' };

async function readySecondAgent(): Promise<void> {
  await recordSttReadiness(t.env, secondAgent, {
    schemaVersion: 1,
    sttMode: 'local',
    sttEngineId: 'qwen3-asr',
    state: 'ready',
    capacity: 1,
  });
}

const t = setupD1();

beforeEach(async () => {
  await t.reset();
});

async function fixtureSupportCase(): Promise<{ caseId: string; supportCaseId: string }> {
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, { sttMode: 'local', llmMode: 'openai' });
  t.env.CCC_STT_MODE = 'local';
  t.env.CCC_LLM_MODE = 'openai';
  // 등록이 남긴 6종 동의 이벤트가 텍스트 AI 권한의 유일한 근거다(파일럿 증빙 기록기는 폐지).
  const beneficiary = await createCase(t.env, counselor, await registrationInput(t.env, counselor, {
    programId: testProgramId(counselor.orgId),
  }));
  const { programs } = await listSupportCasesForBeneficiary(t.env, counselor, beneficiary.id);
  const supportCaseId = programs[0]?.supportCase.id;
  if (supportCaseId === undefined) throw new Error('expected an initial support case');
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  return { caseId: beneficiary.id, supportCaseId };
}

/**
 * 취소의 유일한 근거는 append-only 철회 이벤트다(옛 불리언·증빙이 아니다). 현재 리비전과
 * 지금 발급한 고지에 묶어 넣으므로, 계약이 어긋나면 테스트가 아니라 게이트웨이가 거부한다.
 */
async function withdrawConsent(supportCaseId: string, domain: ConsentDomain): Promise<void> {
  const current = (await getSupportCaseConsent(t.env, counselor, supportCaseId))
    .find((item) => item.domain === domain);
  const disclosure = (await issueSupportCaseConsentDisclosures(t.env, counselor, supportCaseId))
    .find((item) => item.domain === domain);
  if (current?.state !== 'granted' || current.revision === null || disclosure === undefined) {
    throw new Error(`expected a granted ${domain} consent`);
  }
  await appendSupportCaseConsentEvent(t.env, counselor, supportCaseId, {
    domain,
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
}

let sequence = 0;

async function fixtureSession(supportCaseId: string): Promise<string> {
  sequence += 1;
  const created = await createCounselingRecord(t.env, counselor, supportCaseId, {
    submissionId: crypto.randomUUID(),
    heldAt: `2026-07-0${sequence % 9 + 1}T10:00:00.000Z`,
    channel: 'in_person',
    memo: `Agent job fixture memo ${sequence}.`,
    gasScores: [],
    actionItems: [],
    flags: [],
  });
  return created.record.id;
}

/** 마스킹까지 끝난 텍스트 일감 1건. */
async function fixtureTextJob(supportCaseId: string): Promise<string> {
  await seedCanonicalSttConsent(t.env, counselor, supportCaseId);
  const sessionId = await fixtureSession(supportCaseId);
  await enqueueTextWorkItem(t.env, counselor, sessionId, 'manual_record');
  return sessionId;
}

/** 원음이 등록된 오디오 일감 1건. */
async function fixtureAudioJob(supportCaseId: string): Promise<string> {
  const sessionId = await fixtureSession(supportCaseId);
  await registerFixtureRecording(t.env, counselor, service, sessionId);
  return sessionId;
}


const AZURE_RUNTIME: AgentRuntime = {
  route: 'local-single-agent',
  sttEngine: 'azure',
  sttEngineId: 'azure-speech-koreacentral',
  audioDelivery: 'api-stream',
};
async function jobRow(sessionId: string): Promise<Record<string, unknown>> {
  const row = await t.db.prepare(
    `SELECT id, kind, state, attempt, lease_owner, lease_expires_at, terminal_failure_code,
            result_payload_sha256
     FROM agent_jobs WHERE session_id = ?`,
  ).bind(sessionId).first<Record<string, unknown>>();
  if (row === null) throw new Error('expected an agent job row');
  return row;
}

describe('S5 Agent 작업 계약 v2', () => {
  it('상태와 오류 literal을 고정한다', () => {
    expect(AGENT_JOB_STATES).toEqual([
      'pending',
      'leased',
      'blocked',
      'succeeded',
      'cancelled',
      'expired',
      'failed',
    ]);
    expect(AGENT_JOB_ERROR_CODES).toContain('stale_claim');
    expect(AGENT_JOB_ERROR_CODES).toContain('result_conflict');
    expect(AGENT_JOB_ERROR_CODES).toContain('local_ner_unavailable');
  });

  it('claim limit 생략값과 2..50 경계를 고정한다', () => {
    expect(CLAIM_LIMIT_DEFAULT).toBe(10);
    expect(CLAIM_LIMIT_MIN).toBe(2);
    expect(CLAIM_LIMIT_MAX).toBe(50);
    expect(normalizeClaimLimit(undefined)).toBe(10);
    expect(normalizeClaimLimit(2)).toBe(2);
    expect(normalizeClaimLimit(50)).toBe(50);
    for (const invalid of [null, 1, 51, 2.5, '10']) {
      expect(() => normalizeClaimLimit(invalid)).toThrow('claim limit is invalid');
    }
  });

  it('오류 literal을 고정 HTTP 상태로 매핑한다', () => {
    expect(jobErrorHttpStatus('authentication_required')).toBe(401);
    expect(jobErrorHttpStatus('forbidden')).toBe(403);
    expect(jobErrorHttpStatus('job_not_found')).toBe(404);
    expect(jobErrorHttpStatus('stale_claim')).toBe(409);
    expect(jobErrorHttpStatus('engine_unavailable')).toBe(422);
  });

  it('통합 상태 표, NER 영수증 표와 Azure egress 표를 같은 migration에서 만든다', async () => {
    const tables = await t.db.prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('agent_jobs', 'agent_job_egress_records', 'ner_release_qualification_receipts') ORDER BY name",
    ).all<{ name: string }>();
    expect(tables.results.map((row) => row.name)).toEqual([
      'agent_job_egress_records',
      'agent_jobs',
      'ner_release_qualification_receipts',
    ]);
  });

  // F2: 두 큐 중 어느 쪽도 굶지 않는다. audio head 가 더 오래되면 audio 가 먼저다.
  it('F2 오디오 50건과 텍스트 1건을 엄격히 교대로 섞는다', () => {
    const audio = Array.from({ length: 50 }, (_, index) => ({
      id: `audio-${String(index + 1).padStart(3, '0')}`,
      enqueuedAt: `2026-07-01T00:00:${String(index).padStart(2, '0')}.000Z`,
    }));
    const text = [{ id: 'text-001', enqueuedAt: '2026-07-01T01:00:00.000Z' }];
    const picked = interleaveAgentJobQueues(audio, text, 10).map((job) => job.id);
    expect(picked[0]).toBe('audio-001');
    expect(picked[1]).toBe('text-001');
    expect(picked.slice(2)).toEqual(audio.slice(1, 9).map((job) => job.id));
    // 한 큐만 남으면 그 큐의 순서를 그대로 잇는다.
    expect(interleaveAgentJobQueues(audio, [], 3).map((job) => job.id))
      .toEqual(['audio-001', 'audio-002', 'audio-003']);
  });

  it('F1 동시 claim에서 같은 작업이 두 Agent에 나가지 않는다', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const textSession = await fixtureTextJob(supportCaseId);
    const audioSession = await fixtureAudioJob(supportCaseId);
    const qualification = await seedNerQualification(t.db);
    await readySecondAgent();

    // 두 Agent 가 동시에 claim 한다 — 순차 호출이면 "중복 임대 없음" 을 증명하지 못한다.
    const [first, second] = await Promise.all([
      claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification)),
      claimAgentJobs(t.env, secondAgent, LOCAL_SINGLE_RUNTIME, claimRequest(qualification)),
    ]);

    expect(first.schemaVersion).toBe(2);
    // 작업 2건이 두 응답에 걸쳐 정확히 한 번씩만 나간다.
    const claimedJobs = [...first.jobs, ...second.jobs];
    expect(claimedJobs.map((job) => job.kind).sort()).toEqual(['audio', 'text']);
    expect(claimedJobs).toHaveLength(2);
    expect(new Set(claimedJobs.map((job) => job.jobId)).size).toBe(2);
    for (const job of claimedJobs) {
      expect(job.attempt).toBe(1);
      expect(job.maxAttempts).toBe(3);
      expect(job.state).toBe('leased');
      expect(job.claimToken).toMatch(/^[0-9a-f]{64}$/);
      expect(job.route).toBe('local-single-agent');
      expect(job.maskDictionaryEndpoint).toBe(`/pipeline/jobs/${job.jobId}/mask-dictionary`);
    }
    // 오디오만 원음 묶음을 갖고, 텍스트는 null 이다.
    const audioJob = claimedJobs.find((job) => job.kind === 'audio');
    const textJob = claimedJobs.find((job) => job.kind === 'text');
    expect(audioJob?.audio?.delivery).toBe('api-stream');
    expect(audioJob?.audio?.retentionHardCapAt).toMatch(/Z$/);
    expect(audioJob?.sttEngine).toBe('local');
    expect(textJob?.audio).toBeNull();
    expect(textJob?.sttEngine).toBeNull();
    // 원문은 임대 주인만 받는다.
    if (textJob === undefined) throw new Error('expected a text job');
    const textOwner = first.jobs.includes(textJob) ? service : secondAgent;
    const textIntruder = textOwner === service ? secondAgent : service;
    await expect(getAgentJobSource(t.env, textOwner, textJob.jobId, textJob.claimToken, 1))
      .resolves.toMatchObject({ sessionId: textSession });
    await expect(getAgentJobSource(t.env, textIntruder, textJob.jobId, textJob.claimToken, 1))
      .rejects.toMatchObject({ code: 'stale_claim' });
    expect(await jobRow(audioSession)).toMatchObject({ state: 'leased' });
  });

  async function leaseExpiry(jobId: string): Promise<string> {
    const row = await t.db.prepare('SELECT lease_expires_at FROM agent_jobs WHERE id = ?').bind(jobId).first();
    return String((row as { lease_expires_at: string }).lease_expires_at);
  }

  it('F3 heartbeat는 임대를 연장하고, 만료된 임대는 재분배 뒤 옛 토큰을 거부한다', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureTextJob(supportCaseId);
    const qualification = await seedNerQualification(t.db);
    const [claimed] = (await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification))).jobs;
    if (claimed === undefined) throw new Error('expected a claimed job');

    // 임대를 곧 만료로 당긴 뒤 heartbeat 가 실제로 연장하는지 본다. "미래인가" 만 보면
    // 아무것도 갱신하지 않는 구현도 통과한다.
    const nearExpiry = new Date(Date.now() + 60_000).toISOString();
    await t.db.prepare('UPDATE agent_jobs SET lease_expires_at = ? WHERE id = ?')
      .bind(nearExpiry, claimed.jobId).run();
    const beat = await heartbeatAgentJob(t.env, service, claimed.jobId, {
      claimToken: claimed.claimToken,
      attempt: 1,
    });
    expect(beat.state).toBe('leased');
    expect(beat.leaseExpiresAt > nearExpiry).toBe(true);
    // 연장은 claimedAt+2시간 총 상한을 넘지 않는다(S5 §2.2).
    const totalCap = new Date(new Date(claimed.claimedAt).getTime() + 2 * 60 * 60_000).toISOString();
    expect(beat.leaseExpiresAt <= totalCap).toBe(true);
    expect(await leaseExpiry(claimed.jobId)).toBe(beat.leaseExpiresAt);

    // 자연 만료: 현재 토큰은 정확히 lease_expired 다.
    await t.db.prepare("UPDATE agent_jobs SET lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(claimed.jobId).run();
    await expect(heartbeatAgentJob(t.env, service, claimed.jobId, { claimToken: claimed.claimToken, attempt: 1 }))
      .rejects.toMatchObject({ code: 'lease_expired' });

    // 다른 Agent 의 claim 이 복구와 재임대를 끝내면 옛 토큰은 stale_claim 이다.
    const [reclaimed] = (await claimAgentJobs(t.env, secondAgent, LOCAL_SINGLE_RUNTIME, claimRequest(qualification))).jobs;
    expect(reclaimed?.attempt).toBe(2);
    await expect(heartbeatAgentJob(t.env, service, claimed.jobId, { claimToken: claimed.claimToken, attempt: 1 }))
      .rejects.toMatchObject({ code: 'stale_claim' });
    await expect(acceptAgentJobResult(t.env, service, claimed.jobId, await agentResultRequest({
      kind: 'text',
      claimToken: claimed.claimToken,
      attempt: 1,
      maskedText: 'MASKED stale text',
      qualification,
    }))).rejects.toMatchObject({ code: 'stale_claim' });
    expect(await jobRow(sessionId)).toMatchObject({ state: 'leased', lease_owner: secondAgent.userId });
  });

  it('F4 동의 철회는 열린 작업을 취소하고 결과를 저장하지 않는다', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureTextJob(supportCaseId);
    const qualification = await seedNerQualification(t.db);
    const [claimed] = (await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification))).jobs;
    if (claimed === undefined) throw new Error('expected a claimed job');

    await withdrawConsent(supportCaseId, 'external_llm_cross_border_processing');

    expect(await jobRow(sessionId)).toMatchObject({ state: 'cancelled', lease_owner: null });
    await expect(acceptAgentJobResult(t.env, service, claimed.jobId, await agentResultRequest({
      kind: 'text',
      claimToken: claimed.claimToken,
      attempt: 1,
      maskedText: 'MASKED withdrawn text',
      qualification,
    }))).rejects.toMatchObject({ code: 'consent_not_effective' });
    const snapshots = await t.db.prepare('SELECT COUNT(*) AS count FROM ai_masked_source_snapshots WHERE session_id = ?')
      .bind(sessionId).first<{ count: number }>();
    expect(snapshots?.count).toBe(0);
  });

  it('F5 같은 payload hash 재전송은 멱등이고 다른 hash는 충돌이다', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureTextJob(supportCaseId);
    const qualification = await seedNerQualification(t.db);
    const [claimed] = (await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification))).jobs;
    if (claimed === undefined) throw new Error('expected a claimed job');

    const maskedText = 'MASKED idempotent result text';
    const first = await agentResultRequest({
      kind: 'text',
      claimToken: claimed.claimToken,
      attempt: 1,
      maskedText,
      qualification,
    });
    const accepted = await acceptAgentJobResult(t.env, service, claimed.jobId, first);
    expect(accepted.replayed).toBe(false);
    expect(accepted.recording).toBeNull();
    expect(await jobRow(sessionId)).toMatchObject({ state: 'succeeded', lease_owner: null });

    // resultId 만 다른 같은 hash: 멱등이고 스냅샷은 늘지 않는다.
    const replayed = await acceptAgentJobResult(t.env, service, claimed.jobId, {
      ...first,
      resultId: `result-${crypto.randomUUID()}`,
    });
    expect(replayed.replayed).toBe(true);
    // 다른 hash: 충돌이다.
    await expect(acceptAgentJobResult(t.env, service, claimed.jobId, await agentResultRequest({
      kind: 'text',
      claimToken: claimed.claimToken,
      attempt: 1,
      maskedText: 'MASKED different result text',
      qualification,
    }))).rejects.toMatchObject({ code: 'result_conflict' });

    const snapshots = await t.db.prepare('SELECT COUNT(*) AS count FROM ai_masked_source_snapshots WHERE session_id = ?')
      .bind(sessionId).first<{ count: number }>();
    expect(snapshots?.count).toBe(1);
    // 원본 텍스트 큐 행도 같은 스냅샷으로 닫힌다.
    const queue = await t.db.prepare('SELECT status, completed_snapshot_id FROM ai_text_work_queue WHERE session_id = ?')
      .bind(sessionId).first<Record<string, unknown>>();
    expect(queue?.status).toBe('done');
    expect(queue?.completed_snapshot_id).not.toBeNull();
  });

  it('F6 transient release는 3회까지만 재시도하고 그 뒤 retry_exhausted로 닫는다', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureTextJob(supportCaseId);
    const qualification = await seedNerQualification(t.db);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const [claimed] = (await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification))).jobs;
      if (claimed === undefined) throw new Error(`expected a claim on attempt ${attempt}`);
      expect(claimed.attempt).toBe(attempt);
      await releaseAgentJob(t.env, service, claimed.jobId, {
        claimToken: claimed.claimToken,
        attempt,
        outcome: 'transient',
        reason: 'engine_unavailable',
      });
    }

    expect(await jobRow(sessionId)).toMatchObject({
      state: 'failed',
      attempt: 3,
      terminal_failure_code: 'retry_exhausted',
    });
    // 4회째 claim 은 없다.
    await expect(claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification)))
      .resolves.toMatchObject({ jobs: [] });
  });

  it('살아 있는 claim 없이는 결과 수락 행이 batch 안에서도 들어가지 않는다', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureTextJob(supportCaseId);
    const qualification = await seedNerQualification(t.db);
    const [claimed] = (await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification))).jobs;
    if (claimed === undefined) throw new Error('expected a claimed job');
    const row = await jobRow(sessionId);

    const acceptance = (attempt: number, claimTokenHash: string) => t.db.prepare(
      `INSERT INTO agent_job_result_acceptances (job_id, attempt, claim_token_hash, payload_sha256, accepted_at)
       VALUES (?, ?, ?, ?, '2026-09-05T00:00:00.000Z')`,
    ).bind(String(row.id), attempt, claimTokenHash, 'a'.repeat(64)).run();

    // 다른 claim 토큰·다른 attempt 는 거부된다 — 검증과 batch 사이의 임대 인수 경로다.
    await expect(acceptance(1, 'b'.repeat(64))).rejects.toThrow();
    await expect(acceptance(2, String(row.claim_token_hash))).rejects.toThrow();

    // 임대가 회수되면(동의 철회·만료 복구) 같은 토큰으로도 들어가지 못한다.
    await t.db.prepare("UPDATE agent_jobs SET state = 'cancelled', claim_token_hash = NULL, lease_owner = NULL, claimed_at = NULL, lease_expires_at = NULL WHERE id = ?")
      .bind(String(row.id)).run();
    await expect(acceptance(1, String(row.claim_token_hash))).rejects.toThrow();
  });

  it('attempt를 다 쓴 뒤 차단된 작업도 NER 회복 뒤 같은 attempt로 다시 임대된다', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureTextJob(supportCaseId);
    const qualification = await seedNerQualification(t.db);

    // transient 두 번으로 attempt 를 3까지 올리고 마지막 claim 을 blocked 로 닫는다.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const [claimed] = (await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification))).jobs;
      if (claimed === undefined) throw new Error(`expected a claim on attempt ${attempt}`);
      await releaseAgentJob(t.env, service, claimed.jobId, {
        claimToken: claimed.claimToken,
        attempt,
        ...(attempt === 3
          ? { outcome: 'blocked' as const, reason: 'local_ner_unavailable' as const }
          : { outcome: 'transient' as const, reason: 'engine_unavailable' as const }),
      });
    }
    expect(await jobRow(sessionId)).toMatchObject({ state: 'blocked', attempt: 3 });

    // blocked 는 attempt 를 소모하지 않으므로 상한에 걸려 굶으면 안 된다.
    const resumed = await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification));
    expect(resumed.jobs.map((job) => job.attempt)).toEqual([3]);
    expect(await jobRow(sessionId)).toMatchObject({ state: 'leased', attempt: 3 });
  });

  it('F7 NER 자격이 없으면 claim도 결과도 없고 blocked는 attempt를 소모하지 않는다', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureTextJob(supportCaseId);
    const expired = await seedNerQualification(t.db, { expiresAt: '2000-01-01T00:00:00.000Z' });

    await expect(claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(expired)))
      .rejects.toMatchObject({ code: 'local_ner_unavailable' });
    expect(await jobRow(sessionId)).toMatchObject({ state: 'pending', attempt: 0 });

    const qualification = await seedNerQualification(t.db);
    const [claimed] = (await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification))).jobs;
    if (claimed === undefined) throw new Error('expected a claimed job');
    await releaseAgentJob(t.env, service, claimed.jobId, {
      claimToken: claimed.claimToken,
      attempt: 1,
      outcome: 'blocked',
      reason: 'local_ner_unavailable',
    });
    expect(await jobRow(sessionId)).toMatchObject({ state: 'blocked', attempt: 1, lease_owner: null });

    // 회복 뒤 재임대는 attempt 를 올리지 않는다.
    const [resumed] = (await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification))).jobs;
    expect(resumed?.attempt).toBe(1);
    expect(await jobRow(sessionId)).toMatchObject({ state: 'leased', attempt: 1 });
  });

  it('claim 뒤 attestation이 만료되면 결과를 받지 않는다', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureTextJob(supportCaseId);
    const qualification = await seedNerQualification(t.db);
    const [claimed] = (await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification))).jobs;
    if (claimed === undefined) throw new Error('expected a claimed job');

    // 처리 중 attestation 이 만료된 상황 — claim 시점 통과만으로는 결과를 받을 수 없다.
    await t.db.prepare("UPDATE agent_jobs SET ner_attestation_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(claimed.jobId).run();

    await expect(acceptAgentJobResult(t.env, service, claimed.jobId, await agentResultRequest({
      kind: 'text',
      claimToken: claimed.claimToken,
      attempt: 1,
      maskedText: 'MASKED expired attestation text',
      qualification,
    }))).rejects.toMatchObject({ code: 'local_ner_unavailable' });
    const snapshots = await t.db.prepare('SELECT COUNT(*) AS count FROM ai_masked_source_snapshots WHERE session_id = ?')
      .bind(sessionId).first<{ count: number }>();
    expect(snapshots?.count).toBe(0);
    // 거부는 작업을 열어 두지 않는다 - 코어가 그 자리에서 닫는다(S5 §2.6). 열어 두면 Agent 가
    // 사유를 추측해 release 하고, 임대 만료 복구가 attempt 를 태워 retry_exhausted 로 끝난다.
    // NER 부재만 재처리 가능이고 텍스트는 provider 0회라 attempt 를 소모하지 않는다(S6 §4).
    expect(await jobRow(sessionId)).toMatchObject({
      state: 'blocked',
      terminal_failure_code: null,
      attempt: 1,
    });
    // 자격이 회복되면 같은 attempt 로 다시 임대된다.
    const revived = await seedNerQualification(t.db);
    const { jobs: resumed } = await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(revived));
    expect(resumed.map((job) => job.attempt)).toEqual([1]);
  });

  it('근거 해시가 어긋난 결과는 그 코드로 닫힌다', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureTextJob(supportCaseId);
    const qualification = await seedNerQualification(t.db);
    const [claimed] = (await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification))).jobs;
    if (claimed === undefined) throw new Error('expected a claimed job');

    const request = await agentResultRequest({
      kind: 'text',
      claimToken: claimed.claimToken,
      attempt: 1,
      maskedText: 'MASKED evidence mismatch text',
      qualification,
    });
    await expect(acceptAgentJobResult(t.env, service, claimed.jobId, {
      ...request,
      result: { ...request.result, evidenceHash: 'f'.repeat(64) },
    })).rejects.toMatchObject({ code: 'evidence_hash_mismatch' });
    expect(await jobRow(sessionId)).toMatchObject({
      state: 'failed',
      terminal_failure_code: 'evidence_hash_mismatch',
    });
  });

  it('mask dictionary는 같은 claim에서만 재생되고 새 claim은 새 dictionary를 받는다', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    await fixtureTextJob(supportCaseId);
    const qualification = await seedNerQualification(t.db);
    const [claimed] = (await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification))).jobs;
    if (claimed === undefined) throw new Error('expected a claimed job');

    const credentials = { claimToken: claimed.claimToken, attempt: 1 };
    const issued = await issueAgentJobMaskDictionary(t.env, service, claimed.jobId, credentials);
    expect(issued.oneTime).toBe(true);
    expect(issued.jobId).toBe(claimed.jobId);
    // 응답 유실 뒤 같은 tuple 재전송은 같은 dictionary 다.
    const replayed = await issueAgentJobMaskDictionary(t.env, service, claimed.jobId, credentials);
    expect(replayed.dictionaryId).toBe(issued.dictionaryId);
    expect(replayed.expiresAt).toBe(issued.expiresAt);

    // 만료된 dictionary 는 재사용할 수 없다.
    await t.db.prepare("UPDATE agent_jobs SET mask_dictionary_expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?")
      .bind(claimed.jobId).run();
    await expect(issueAgentJobMaskDictionary(t.env, service, claimed.jobId, credentials))
      .rejects.toBeInstanceOf(AgentJobContractError);
  });

  it('Agent re-hash is trusted when provider SHA is absent, while the copied client assertion can still reject it', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const mismatchSession = await fixtureSession(supportCaseId);
    const mismatchAudio = await registerFixtureRecording(
      t.env,
      counselor,
      service,
      mismatchSession,
      LOCAL_SINGLE_RUNTIME,
      `audio/${mismatchSession}/${crypto.randomUUID()}`,
      { clientAssertedSha256: 'f'.repeat(64), storageSha256: null },
    );
    const qualification = await seedNerQualification(t.db);
    const [mismatchClaim] = (await claimAgentJobs(
      t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification),
    )).jobs;
    if (mismatchClaim === undefined || mismatchClaim.audio === null) throw new Error('expected audio claim');
    expect(mismatchClaim.audio.clientAssertedSha256).toBe('f'.repeat(64));
    await expect(verifyAgentJobAudio(t.env, service, mismatchClaim.jobId, {
      claimToken: mismatchClaim.claimToken,
      attempt: mismatchClaim.attempt,
      generationId: mismatchAudio.generationId,
      agentComputedSha256: mismatchAudio.sha256,
    })).rejects.toMatchObject({ code: 'audio_hash_mismatch' });
    await expect(t.db.prepare(
      `SELECT audio.state,audio.object_sha256,job.client_asserted_sha256,job.agent_computed_sha256
       FROM audio_objects AS audio JOIN agent_jobs AS job ON job.audio_object_id=audio.id
       WHERE audio.session_id=?`,
    ).bind(mismatchSession).first()).resolves.toMatchObject({
      state: 'deletion_pending',
      object_sha256: null,
      client_asserted_sha256: 'f'.repeat(64),
      agent_computed_sha256: mismatchAudio.sha256,
    });

    const successSession = await fixtureSession(supportCaseId);
    const successAudio = await registerFixtureRecording(
      t.env,
      counselor,
      service,
      successSession,
      LOCAL_SINGLE_RUNTIME,
      `audio/${successSession}/${crypto.randomUUID()}`,
      { storageSha256: null },
    );
    const [successClaim] = (await claimAgentJobs(
      t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification),
    )).jobs;
    if (successClaim === undefined) throw new Error('expected second audio claim');
    await expect(verifyAgentJobAudio(t.env, service, successClaim.jobId, {
      claimToken: successClaim.claimToken,
      attempt: successClaim.attempt,
      generationId: successAudio.generationId,
      agentComputedSha256: successAudio.sha256,
    })).resolves.toMatchObject({ rawAudioSha256: successAudio.sha256 });
    await expect(t.db.prepare(
      'SELECT state,object_sha256 FROM audio_objects WHERE session_id=?',
    ).bind(successSession).first()).resolves.toMatchObject({
      state: 'processing',
      object_sha256: successAudio.sha256,
    });
  });

  it('a verify request that loses its claim CAS cannot mutate the replacement attempt', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureSession(supportCaseId);
    const audio = await registerFixtureRecording(t.env, counselor, service, sessionId);
    const qualification = await seedNerQualification(t.db);
    await readySecondAgent();
    const [first] = (await claimAgentJobs(
      t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification),
    )).jobs;
    if (first === undefined) throw new Error('expected first audio claim');
    let replacement: { jobId: string; claimToken: string; attempt: number } | undefined;
    let intercepted = false;
    const raceDb = new Proxy(t.env.DB, {
      get(target, property, receiver) {
        if (property === 'batch') {
          return async (statements: PreparedStatement[]) => {
            if (!intercepted) {
              intercepted = true;
              await releaseAgentJob(t.env, service, first.jobId, {
                claimToken: first.claimToken,
                attempt: first.attempt,
                outcome: 'transient',
                reason: 'engine_unavailable',
              });
              [replacement] = (await claimAgentJobs(
                t.env, secondAgent, LOCAL_SINGLE_RUNTIME, claimRequest(qualification),
              )).jobs;
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(verifyAgentJobAudio(
      { ...t.env, DB: raceDb },
      service,
      first.jobId,
      {
        claimToken: first.claimToken,
        attempt: first.attempt,
        generationId: audio.generationId,
        agentComputedSha256: 'f'.repeat(64),
      },
    )).rejects.toMatchObject({ code: 'stale_claim' });
    expect(replacement?.attempt).toBe(2);
    await expect(t.db.prepare(
      `SELECT state,claim_agent_id,deletion_reason,object_sha256
       FROM audio_objects WHERE session_id=?`,
    ).bind(sessionId).first()).resolves.toMatchObject({
      state: 'claimed',
      claim_agent_id: secondAgent.userId,
      deletion_reason: null,
      object_sha256: null,
    });
  });

  it('reclaim returns the immutable first-opportunity deadline stored on the audio object', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureAudioJob(supportCaseId);
    const qualification = await seedNerQualification(t.db);
    await readySecondAgent();
    const [first] = (await claimAgentJobs(
      t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification),
    )).jobs;
    if (first === undefined || first.audio === null) throw new Error('expected first audio claim');
    await releaseAgentJob(t.env, service, first.jobId, {
      claimToken: first.claimToken,
      attempt: first.attempt,
      outcome: 'transient',
      reason: 'engine_unavailable',
    });
    await t.db.prepare(
      "UPDATE agent_jobs SET processing_deadline_at='2098-01-02T03:04:05.000Z' WHERE id=?",
    ).bind(first.jobId).run();
    await t.db.prepare(
      "UPDATE audio_objects SET processing_deadline_at='2098-01-01T03:04:05.000Z' WHERE session_id=?",
    ).bind(sessionId).run();
    const [second] = (await claimAgentJobs(
      t.env, secondAgent, LOCAL_SINGLE_RUNTIME, claimRequest(qualification),
    )).jobs;
    expect(second?.audio?.processingDeadlineAt).toBe('2098-01-01T03:04:05.000Z');
    await expect(t.db.prepare(
      'SELECT processing_deadline_at FROM agent_jobs WHERE id=?',
    ).bind(first.jobId).first()).resolves.toMatchObject({
      processing_deadline_at: '2098-01-01T03:04:05.000Z',
    });
  });

  it('permanent audio result validation closes the exact attempt and persists both obligations', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureSession(supportCaseId);
    const audio = await registerFixtureRecording(t.env, counselor, service, sessionId);
    const qualification = await seedNerQualification(t.db);
    const [claimed] = (await claimAgentJobs(
      t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification),
    )).jobs;
    if (claimed === undefined) throw new Error('expected audio claim');
    await verifyAgentJobAudio(t.env, service, claimed.jobId, {
      claimToken: claimed.claimToken,
      attempt: claimed.attempt,
      generationId: audio.generationId,
      agentComputedSha256: audio.sha256,
    });
    const request = await agentResultRequest({
      kind: 'audio',
      claimToken: claimed.claimToken,
      attempt: claimed.attempt,
      maskedText: 'MASKED invalid evidence audio',
      qualification,
    });
    await expect(acceptAgentJobResult(t.env, service, claimed.jobId, {
      ...request,
      result: { ...request.result, evidenceHash: 'f'.repeat(64) },
    })).rejects.toMatchObject({ code: 'evidence_hash_mismatch' });
    await expect(t.db.prepare(
      `SELECT job.state AS job_state,job.terminal_failure_code,audio.state AS audio_state,
              audio.deletion_reason,audio.processing_attempt_id
       FROM agent_jobs AS job JOIN audio_objects AS audio ON audio.id=job.audio_object_id
       WHERE job.id=?`,
    ).bind(claimed.jobId).first()).resolves.toMatchObject({
      job_state: 'failed',
      terminal_failure_code: 'evidence_hash_mismatch',
      audio_state: 'deletion_pending',
      deletion_reason: 'processing_failed',
      processing_attempt_id: `${claimed.jobId}:${claimed.attempt}`,
    });
    await expect(t.db.prepare(
      `SELECT kind FROM audio_lifecycle_outbox
       WHERE audio_object_id=(SELECT audio_object_id FROM agent_jobs WHERE id=?)
       ORDER BY kind`,
    ).bind(claimed.jobId).all<{ kind: string }>()).resolves.toMatchObject({
      results: [{ kind: 'incident' }, { kind: 'manual_note' }],
    });
  });

  it('permanent release and missing storage each persist incident plus manual-note obligations', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const qualification = await seedNerQualification(t.db);
    for (const close of ['release', 'missing'] as const) {
      const sessionId = await fixtureAudioJob(supportCaseId);
      const [claimed] = (await claimAgentJobs(
        t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification),
      )).jobs;
      if (claimed === undefined) throw new Error('expected audio claim');
      if (close === 'release') {
        await releaseAgentJob(t.env, service, claimed.jobId, {
          claimToken: claimed.claimToken,
          attempt: claimed.attempt,
          outcome: 'permanent',
          reason: 'permanent_failure',
        });
      } else {
        await closeAgentJobAudioObjectMissing(
          t.env, service, claimed.jobId, claimed.claimToken, claimed.attempt,
        );
      }
      await expect(t.db.prepare(
        `SELECT audio.state AS audio_state,audio.deletion_reason,
                job.state AS job_state,job.terminal_failure_code
         FROM audio_objects AS audio JOIN agent_jobs AS job ON job.audio_object_id=audio.id
         WHERE audio.session_id=?`,
      ).bind(sessionId).first()).resolves.toMatchObject({
        job_state: 'failed',
        audio_state: 'deletion_pending',
        terminal_failure_code: close === 'release' ? 'permanent_failure' : 'audio_object_missing',
        deletion_reason: 'processing_failed',
      });
      await expect(t.db.prepare(
        `SELECT kind FROM audio_lifecycle_outbox
         WHERE audio_object_id=(SELECT id FROM audio_objects WHERE session_id=?) ORDER BY kind`,
      ).bind(sessionId).all<{ kind: string }>()).resolves.toMatchObject({
        results: [{ kind: 'incident' }, { kind: 'manual_note' }],
      });
    }
  });

  function deletionEvidence(
    generationId: string | null,
    complete: boolean,
  ): AudioDeletionEvidence {
    const at = new Date().toISOString();
    return {
      keyHash: 'a'.repeat(64),
      generationId,
      objectSha256: null,
      deletionAttemptId: crypto.randomUUID(),
      deletionRequestedAt: at,
      providerDeleteAcceptedAt: at,
      deletedAt: at,
      deleteSucceeded: true,
      absentFromList: complete,
      absentFromMetadata: complete,
      directReadAbsent: complete,
      verificationMethod: 'r2-head-absent',
      verifiedAt: at,
    };
  }

  function deletionStore(
    remove: (key: string) => Promise<AudioDeletionEvidence>,
  ): AudioStore {
    return { delete: remove } as unknown as AudioStore;
  }

  it('a durable generation-bound deletion request recovers when a retry sees an already absent object', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureAudioJob(supportCaseId);
    const row = await t.db.prepare(
      'SELECT id,generation_id FROM audio_objects WHERE session_id=?',
    ).bind(sessionId).first<{ id: string; generation_id: string }>();
    if (row === null) throw new Error('expected audio object');
    await t.db.prepare(
      `UPDATE audio_objects SET state='deletion_pending',deletion_reason='processed',
       deletion_attempt_id='attempt-recover',next_attempt_at=?,updated_at=? WHERE id=?`,
    ).bind(new Date().toISOString(), new Date().toISOString(), row.id).run();
    let calls = 0;
    const store = deletionStore(async () => {
      calls += 1;
      return deletionEvidence(calls === 1 ? row.generation_id : null, calls > 1);
    });
    await expect(reconcileAudioObjectDeletion(t.env, store, row.id)).resolves.toBe(false);
    await expect(reconcileAudioObjectDeletion(t.env, store, row.id)).resolves.toBe(true);
    await expect(t.db.prepare(
      'SELECT state,generation_id FROM audio_objects WHERE id=?',
    ).bind(row.id).first()).resolves.toMatchObject({
      state: 'processed_deleted',
      generation_id: row.generation_id,
    });
    await expect(t.db.prepare(
      'SELECT phase,generation_id FROM audio_deletion_attempts WHERE audio_object_id=? ORDER BY created_at,id',
    ).bind(row.id).all()).resolves.toMatchObject({
      results: [
        { phase: 'requested', generation_id: row.generation_id },
        { phase: 'verification', generation_id: row.generation_id },
        { phase: 'verification', generation_id: row.generation_id },
      ],
    });
  });

  it('Cloud deletion happens immediately but cannot terminalize until upload expiry plus propagation', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureAudioJob(supportCaseId);
    const row = await t.db.prepare(
      'SELECT id,generation_id FROM audio_objects WHERE session_id=?',
    ).bind(sessionId).first<{ id: string; generation_id: string }>();
    if (row === null) throw new Error('expected audio object');
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    await t.db.prepare(
      `UPDATE audio_objects SET state='deletion_pending',deletion_reason='processed',
       deletion_attempt_id='attempt-cloud',next_attempt_at=?,audio_delivery='protected-get',
       upload_expires_at=?,updated_at=? WHERE id=?`,
    ).bind(new Date().toISOString(), future, new Date().toISOString(), row.id).run();
    let calls = 0;
    const store = deletionStore(async () => {
      calls += 1;
      return deletionEvidence(row.generation_id, true);
    });
    await expect(reconcileAudioObjectDeletion(t.env, store, row.id)).resolves.toBe(false);
    expect(calls).toBe(1);
    await expect(t.db.prepare('SELECT state,next_attempt_at FROM audio_objects WHERE id=?')
      .bind(row.id).first()).resolves.toMatchObject({
      state: 'deletion_pending',
      next_attempt_at: new Date(Date.parse(future) + 60_000).toISOString(),
    });
    await t.db.prepare(
      "UPDATE audio_objects SET upload_expires_at='2000-01-01T00:00:00.000Z',next_attempt_at=? WHERE id=?",
    ).bind(new Date().toISOString(), row.id).run();
    await expect(reconcileAudioObjectDeletion(t.env, store, row.id)).resolves.toBe(true);
    expect(calls).toBe(2);
  });

  it('reconciliation expires abandoned upload intents at upload expiry rather than the seven-day cap', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureAudioJob(supportCaseId);
    const row = await t.db.prepare(
      'SELECT id,generation_id FROM audio_objects WHERE session_id=?',
    ).bind(sessionId).first<{ id: string; generation_id: string }>();
    if (row === null) throw new Error('expected audio object');
    await t.db.prepare(
      `UPDATE audio_objects SET state='pending_upload',uploaded_at=NULL,audio_delivery='protected-get',
       upload_expires_at='2000-01-01T00:00:00.000Z',retention_hard_cap_at='2099-01-01T00:00:00.000Z',
       deletion_reason=NULL,deletion_attempt_id=NULL,next_attempt_at=NULL WHERE id=?`,
    ).bind(row.id).run();
    let calls = 0;
    const store = deletionStore(async () => {
      calls += 1;
      return deletionEvidence(row.generation_id, true);
    });
    const report = await runAudioExpiry(t.env, store, new Date().toISOString());
    expect(report).toEqual({ scanned: 1, deleted: 1 });
    expect(calls).toBe(1);
    await expect(t.db.prepare('SELECT state,deletion_reason FROM audio_objects WHERE id=?')
      .bind(row.id).first()).resolves.toMatchObject({
      state: 'upload_abandoned',
      deletion_reason: 'upload_abandoned',
    });
  });

  it('a hard-cap transition gets a new epoch so stale processed proof cannot terminalize it', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureAudioJob(supportCaseId);
    const row = await t.db.prepare(
      'SELECT id,generation_id FROM audio_objects WHERE session_id=?',
    ).bind(sessionId).first<{ id: string; generation_id: string }>();
    if (row === null) throw new Error('expected audio object');
    const at = new Date().toISOString();
    await t.db.prepare(
      `UPDATE audio_objects SET state='deletion_pending',deletion_reason='processed',
       deletion_attempt_id='processed-epoch',next_attempt_at=?,retention_hard_cap_at=?,updated_at=? WHERE id=?`,
    ).bind(at, at, at, row.id).run();
    let raced = false;
    const inner = deletionStore(async () => deletionEvidence(row.generation_id, false));
    const outer = deletionStore(async () => {
      if (!raced) {
        raced = true;
        await runAudioExpiry(t.env, inner, at);
      }
      return deletionEvidence(row.generation_id, true);
    });
    await expect(reconcileAudioObjectDeletion(t.env, outer, row.id)).resolves.toBe(false);
    const pending = await t.db.prepare(
      'SELECT state,deletion_reason,deletion_attempt_id FROM audio_objects WHERE id=?',
    ).bind(row.id).first<Record<string, unknown>>();
    expect(pending).toMatchObject({ state: 'deletion_pending', deletion_reason: 'retention_hard_cap' });
    expect(pending?.deletion_attempt_id).not.toBe('processed-epoch');
    await expect(reconcileAudioObjectDeletion(
      t.env,
      deletionStore(async () => deletionEvidence(row.generation_id, true)),
      row.id,
    )).resolves.toBe(true);
    await expect(t.db.prepare('SELECT state FROM audio_objects WHERE id=?')
      .bind(row.id).first()).resolves.toMatchObject({ state: 'retention_capped' });
  });

  it('a losing upload completion cannot cancel the winner claim or enqueue a duplicate job', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureSession(supportCaseId);
    await seedCanonicalSttConsent(t.env, counselor, supportCaseId);
    await recordSttReadiness(t.env, service, {
      schemaVersion: 1,
      sttMode: 'local',
      sttEngineId: 'qwen3-asr',
      state: 'ready',
      capacity: 1,
    });
    const admission = await admitRecordingUpload(t.env, counselor, sessionId, LOCAL_SINGLE_RUNTIME);
    const uploadExpiresAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    const intent = await beginRecordingUploadIntent(
      t.env, counselor, sessionId, admission, 'protected-get', {
      contentLength: 364,
      contentType: 'audio/wav',
      clientAssertedSha256: null,
      storageSha256: null,
      uploadExpiresAt,
      },
    );
    const generationId = crypto.randomUUID();
    await registerRecording(t.env, counselor, sessionId, intent.key, admission, {
      contentLength: 364,
      contentType: 'audio/wav',
      clientAssertedSha256: null,
      storageSha256: null,
      generationId,
      uploadExpiresAt,
    }, intent.audioObjectId);
    await t.db.prepare(
      'UPDATE audio_objects SET eligible_after=? WHERE id=?',
    ).bind(new Date(Date.now() - 1000).toISOString(), intent.audioObjectId).run();
    const qualification = await seedNerQualification(t.db);
    const [winner] = (await claimAgentJobs(
      t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification),
    )).jobs;
    if (winner === undefined) throw new Error('expected completion winner claim');

    await expect(registerRecording(t.env, counselor, sessionId, intent.key, admission, {
      contentLength: 364,
      contentType: 'audio/wav',
      clientAssertedSha256: null,
      storageSha256: null,
      generationId,
      uploadExpiresAt,
    }, intent.audioObjectId)).rejects.toBeInstanceOf(ConflictError);
    await expect(t.db.prepare(
      `SELECT state,lease_owner,attempt FROM agent_jobs WHERE audio_object_id=?`,
    ).bind(intent.audioObjectId).all()).resolves.toMatchObject({
      results: [{ state: 'leased', lease_owner: service.userId, attempt: 1 }],
    });
    await expect(t.db.prepare(
      'SELECT state,claim_id,claim_agent_id FROM audio_objects WHERE id=?',
    ).bind(intent.audioObjectId).first()).resolves.toMatchObject({
      state: 'claimed',
      claim_id: winner.jobId,
      claim_agent_id: service.userId,
    });
  });
  it('declining external STT deletes only audio whose immutable receipt requires that domain', async () => {
    const { supportCaseId } = await fixtureSupportCase();

    const localSession = await fixtureSession(supportCaseId);
    await registerFixtureRecording(t.env, counselor, service, localSession);
    const azureSession = await fixtureSession(supportCaseId);
    await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, {
      sttMode: 'azure', llmMode: 'openai',
    });
    await registerFixtureRecording(t.env, counselor, service, azureSession, AZURE_RUNTIME);

    const disclosure = (await issueSupportCaseConsentDisclosures(
      t.env, counselor, supportCaseId,
    )).find((item) => item.domain === 'external_stt_processing');
    if (disclosure === undefined) throw new Error('expected external STT disclosure');
    await appendSupportCaseConsentEvent(t.env, counselor, supportCaseId, {
      domain: 'external_stt_processing',
      decision: 'decline',
      provider: null,
      providerLegalRecipient: null,
      providerCountry: null,
      purpose: null,
      retentionDuration: null,
      copyVersion: disclosure.copyVersion,
      copyHash: disclosure.copyHash,
      disclosureSnapshotId: disclosure.snapshotId,
      effectiveAt: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
      correctionOfEventId: null,
      expectedRevision: null,
    });

    await expect(t.db.prepare(
      `SELECT audio.state AS audio_state,job.state AS job_state
       FROM audio_objects AS audio JOIN agent_jobs AS job ON job.audio_object_id=audio.id
       WHERE audio.session_id=?`,
    ).bind(localSession).first()).resolves.toMatchObject({
      audio_state: 'available',
      job_state: 'pending',
    });
    await expect(t.db.prepare(
      `SELECT audio.state AS audio_state,audio.deletion_reason,job.state AS job_state
       FROM audio_objects AS audio JOIN agent_jobs AS job ON job.audio_object_id=audio.id
       WHERE audio.session_id=?`,
    ).bind(azureSession).first()).resolves.toMatchObject({
      audio_state: 'deletion_pending',
      deletion_reason: 'consent_withdrawal',
      job_state: 'cancelled',
    });
  });

  it('signed target completion records only a still-current claim and rejects a released lease', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const qualification = await seedNerQualification(t.db);

    const successfulSession = await fixtureAudioJob(supportCaseId);
    const [successfulClaim] = (await claimAgentJobs(
      t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification),
    )).jobs;
    if (successfulClaim === undefined) throw new Error('expected signed-target claim');
    const successfulMint = await beginAgentJobAudioTargetMint(
      t.env,
      service,
      successfulClaim.jobId,
      successfulClaim.claimToken,
      successfulClaim.attempt,
    );
    const expiresAt = new Date(Date.now() + 600_000).toISOString();
    await completeAgentJobAudioTargetMint(
      t.env,
      service,
      successfulClaim.jobId,
      successfulClaim.claimToken,
      successfulClaim.attempt,
      successfulMint,
      expiresAt,
    );
    await expect(t.db.prepare(
      `SELECT mint.status,audio.download_target_agent_id,audio.download_target_expires_at
       FROM audio_download_target_mints AS mint
       JOIN audio_objects AS audio ON audio.id=mint.audio_object_id
       WHERE mint.id=?`,
    ).bind(successfulMint.mintId).first()).resolves.toMatchObject({
      status: 'issued',
      download_target_agent_id: service.userId,
      download_target_expires_at: expiresAt,
    });

    const losingSession = await fixtureAudioJob(supportCaseId);
    const [losingClaim] = (await claimAgentJobs(
      t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification),
    )).jobs;
    if (losingClaim === undefined) throw new Error('expected losing signed-target claim');
    const losingMint = await beginAgentJobAudioTargetMint(
      t.env,
      service,
      losingClaim.jobId,
      losingClaim.claimToken,
      losingClaim.attempt,
    );
    await releaseAgentJob(t.env, service, losingClaim.jobId, {
      claimToken: losingClaim.claimToken,
      attempt: losingClaim.attempt,
      outcome: 'transient',
      reason: 'engine_unavailable',
    });
    await expect(completeAgentJobAudioTargetMint(
      t.env,
      service,
      losingClaim.jobId,
      losingClaim.claimToken,
      losingClaim.attempt,
      losingMint,
      new Date(Date.now() + 600_000).toISOString(),
    )).rejects.toMatchObject({ code: 'stale_claim' });
    await failAgentJobAudioTargetMint(t.env, service, losingMint.mintId);
    await expect(t.db.prepare(
      `SELECT mint.status,audio.state,audio.download_target_issued_at
       FROM audio_download_target_mints AS mint
       JOIN audio_objects AS audio ON audio.id=mint.audio_object_id
       WHERE mint.id=? AND audio.session_id=?`,
    ).bind(losingMint.mintId, losingSession).first()).resolves.toMatchObject({
      status: 'failed',
      state: 'available',
      download_target_issued_at: null,
    });
    expect(successfulSession).not.toBe(losingSession);
  });

  it('lifecycle incidents reach the existing notifier and manual-note obligations remain observable until ack', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureAudioJob(supportCaseId);
    const qualification = await seedNerQualification(t.db);
    const [claimed] = (await claimAgentJobs(
      t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification),
    )).jobs;
    if (claimed === undefined) throw new Error('expected audio claim');
    await releaseAgentJob(t.env, service, claimed.jobId, {
      claimToken: claimed.claimToken,
      attempt: claimed.attempt,
      outcome: 'permanent',
      reason: 'permanent_failure',
    });

    const manualNotes = await listAudioManualNoteFallbacks(t.env, testActors.admin);
    expect(manualNotes).toEqual([
      expect.objectContaining({
        sessionId,
        supportCaseId,
        reason: 'processing_failed',
      }),
    ]);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(deliverAudioLifecycleIncidents(t.env)).resolves.toBe(1);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('audio lifecycle incident'));
    consoleError.mockRestore();
    await expect(t.db.prepare(
      `SELECT delivered_at FROM audio_lifecycle_outbox
       WHERE audio_object_id=? AND kind='incident'`,
    ).bind(manualNotes[0]?.audioObjectId).first()).resolves.toMatchObject({
      delivered_at: expect.any(String),
    });
    const acknowledged = await acknowledgeAudioManualNoteFallback(
      t.env, testActors.admin, manualNotes[0]?.id ?? '',
    );
    expect(acknowledged).toBe(true);
    await expect(listAudioManualNoteFallbacks(t.env, testActors.admin)).resolves.toEqual([]);
    const replayed = await acknowledgeAudioManualNoteFallback(
      t.env, testActors.admin, manualNotes[0]?.id ?? '',
    );
    expect(replayed).toBe(true);
  });



  it('skips an earlier stale audio receipt and claims the next consent-valid recording', async () => {
    const first = await fixtureSupportCase();
    const firstSession = await fixtureSession(first.supportCaseId);
    await registerFixtureRecording(t.env, counselor, service, firstSession);
    const firstDisclosure = (await issueSupportCaseConsentDisclosures(
      t.env, counselor, first.supportCaseId,
    )).find((item) => item.domain === 'counseling_recording');
    if (firstDisclosure === undefined) throw new Error('expected recording disclosure');
    await appendSupportCaseConsentEvent(t.env, counselor, first.supportCaseId, {
      domain: 'counseling_recording',
      decision: 'grant',
      provider: firstDisclosure.provider,
      providerLegalRecipient: firstDisclosure.providerLegalRecipient,
      providerCountry: firstDisclosure.country,
      purpose: firstDisclosure.purpose,
      retentionDuration: null,
      copyVersion: firstDisclosure.copyVersion,
      copyHash: firstDisclosure.copyHash,
      disclosureSnapshotId: firstDisclosure.snapshotId,
      effectiveAt: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
      correctionOfEventId: null,
      expectedRevision: null,
    });

    const second = await fixtureSupportCase();
    const secondSession = await fixtureSession(second.supportCaseId);
    await registerFixtureRecording(t.env, counselor, service, secondSession);
    const qualification = await seedNerQualification(t.db);
    const result = await claimAgentJobs(
      t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification),
    );
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({ kind: 'audio', sessionId: secondSession });
  });

  it('pages past a full requested batch of stale text receipts', async () => {
    const createStaleTextJob = async (enqueuedAt: string): Promise<void> => {
      const fixture = await fixtureSupportCase();
      const sessionId = await fixtureSession(fixture.supportCaseId);
      await seedCanonicalSttConsent(t.env, counselor, fixture.supportCaseId);
      await enqueueTextWorkItem(t.env, counselor, sessionId, 'manual_record');
      const disclosure = (await issueSupportCaseConsentDisclosures(
        t.env, counselor, fixture.supportCaseId,
      )).find((item) => item.domain === 'external_llm_cross_border_processing');
      if (disclosure === undefined) throw new Error('expected external LLM disclosure');
      await appendSupportCaseConsentEvent(t.env, counselor, fixture.supportCaseId, {
        domain: 'external_llm_cross_border_processing',
        decision: 'grant',
        provider: disclosure.provider,
        providerLegalRecipient: disclosure.providerLegalRecipient,
        providerCountry: disclosure.country,
        purpose: disclosure.purpose,
        retentionDuration: null,
        copyVersion: disclosure.copyVersion,
        copyHash: disclosure.copyHash,
        disclosureSnapshotId: disclosure.snapshotId,
        effectiveAt: new Date().toISOString(),
        idempotencyKey: crypto.randomUUID(),
        correctionOfEventId: null,
        expectedRevision: null,
      });
      await t.db.prepare(
        `UPDATE agent_jobs SET state='pending',terminal_failure_code=NULL,enqueued_at=?
         WHERE org_id=? AND session_id=? AND kind='text'`,
      ).bind(enqueuedAt, counselor.orgId, sessionId).run();
    };
    await createStaleTextJob('2000-01-01T00:00:00.000Z');
    await createStaleTextJob('2000-01-02T00:00:00.000Z');

    const valid = await fixtureSupportCase();
    const validSession = await fixtureSession(valid.supportCaseId);
    await seedCanonicalSttConsent(t.env, counselor, valid.supportCaseId);
    await enqueueTextWorkItem(t.env, counselor, validSession, 'manual_record');
    const qualification = await seedNerQualification(t.db);
    const result = await claimAgentJobs(
      t.env, service, TEXT_ONLY_RUNTIME, claimRequest(qualification, 2),
    );
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0]).toMatchObject({ kind: 'text', sessionId: validSession });
  });

  it('rebinds a pending provider generation to a fresh deletion attempt before confirming absence', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureSession(supportCaseId);
    await seedCanonicalSttConsent(t.env, counselor, supportCaseId);
    await recordSttReadiness(t.env, service, {
      schemaVersion: 1,
      sttMode: 'local',
      sttEngineId: 'qwen3-asr',
      state: 'ready',
      capacity: 1,
    });
    const admission = await admitRecordingUpload(t.env, counselor, sessionId, LOCAL_SINGLE_RUNTIME);
    const uploadExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const intent = await beginRecordingUploadIntent(
      t.env, counselor, sessionId, admission, 'protected-get', {
        contentLength: 364,
        contentType: 'audio/wav',
        clientAssertedSha256: null,
        storageSha256: null,
        uploadExpiresAt,
      },
    );
    const row = { id: intent.audioObjectId };
    await abandonRecordingUpload(t.env, counselor, row.id, 'upload_abandoned');
    const initial = await t.db.prepare(
      'SELECT deletion_attempt_id FROM audio_objects WHERE id=?',
    ).bind(row.id).first<{ deletion_attempt_id: string }>();
    if (initial === null) throw new Error('expected deletion attempt');

    const observedGeneration = 'provider-generation-2';
    let calls = 0;
    const store = deletionStore(async () => {
      calls += 1;
      return deletionEvidence(observedGeneration, true);
    });
    await expect(reconcileAudioObjectDeletion(t.env, store, row.id)).resolves.toBe(false);
    await expect(t.db.prepare(
      'SELECT generation_id,deletion_attempt_id,state FROM audio_objects WHERE id=?',
    ).bind(row.id).first()).resolves.toMatchObject({
      generation_id: observedGeneration,
      deletion_attempt_id: expect.not.stringMatching(initial.deletion_attempt_id),
      state: 'deletion_pending',
    });

    await t.db.prepare(
      'UPDATE audio_objects SET upload_expires_at=?,next_attempt_at=?,updated_at=? WHERE id=?',
    ).bind(
      new Date(Date.now() - 120_000).toISOString(),
      new Date(Date.now() - 1000).toISOString(),
      new Date().toISOString(),
      row.id,
    ).run();
    await expect(reconcileAudioObjectDeletion(t.env, store, row.id)).resolves.toBe(true);
    expect(calls).toBe(2);
  });

  it('refuses an upload target after recording consent changes during provider target creation', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureSession(supportCaseId);
    await seedCanonicalSttConsent(t.env, counselor, supportCaseId);
    await recordSttReadiness(t.env, service, {
      schemaVersion: 1,
      sttMode: 'local',
      sttEngineId: 'qwen3-asr',
      state: 'ready',
      capacity: 1,
    });
    const admission = await admitRecordingUpload(
      t.env, counselor, sessionId, LOCAL_SINGLE_RUNTIME,
    );
    const uploadExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const intent = await beginRecordingUploadIntent(
      t.env, counselor, sessionId, admission, 'protected-get', {
        contentLength: 364,
        contentType: 'audio/wav',
        clientAssertedSha256: null,
        storageSha256: null,
        uploadExpiresAt,
      },
    );
    const disclosure = (await issueSupportCaseConsentDisclosures(
      t.env, counselor, supportCaseId,
    )).find((item) => item.domain === 'counseling_recording');
    if (disclosure === undefined) throw new Error('expected recording disclosure');
    await appendSupportCaseConsentEvent(t.env, counselor, supportCaseId, {
      domain: 'counseling_recording',
      decision: 'decline',
      provider: null,
      providerLegalRecipient: null,
      providerCountry: null,
      purpose: null,
      retentionDuration: null,
      copyVersion: disclosure.copyVersion,
      copyHash: disclosure.copyHash,
      disclosureSnapshotId: disclosure.snapshotId,
      effectiveAt: new Date().toISOString(),
      idempotencyKey: crypto.randomUUID(),
      correctionOfEventId: null,
      expectedRevision: null,
    });
    await expect(authorizeRecordingUploadTarget(
      t.env, counselor, sessionId, intent.audioObjectId, admission,
    )).rejects.toBeInstanceOf(ConflictError);
    await expect(t.db.prepare(
      'SELECT state,deletion_reason FROM audio_objects WHERE id=?',
    ).bind(intent.audioObjectId).first()).resolves.toMatchObject({
      state: 'deletion_pending',
      deletion_reason: 'consent_withdrawal',
    });
  });

  it('rechecks signed runtime and current NER qualification at Azure egress boundaries', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureSession(supportCaseId);
    await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, {
      sttMode: 'azure', llmMode: 'openai',
    });
    const audio = await registerFixtureRecording(
      t.env, counselor, service, sessionId, AZURE_RUNTIME,
    );
    const qualification = await seedNerQualification(t.db, {
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const [job] = (await claimAgentJobs(
      t.env, service, AZURE_RUNTIME, claimRequest(qualification),
    )).jobs;
    if (job === undefined || job.kind !== 'audio') throw new Error('expected Azure audio job');
    const verification = await verifyAgentJobAudio(t.env, service, job.jobId, {
      claimToken: job.claimToken,
      attempt: job.attempt,
      generationId: audio.generationId,
      agentComputedSha256: audio.sha256,
    });
    expect(verification.rawAudioSha256).toBe(audio.sha256);
    await expect(authorizeAgentJobEgress(t.env, service, job.jobId, {
      claimToken: job.claimToken,
      attempt: job.attempt,
      rawAudioSha256: audio.sha256,
      provider: 'azure',
    }, {
      ...AZURE_RUNTIME,
      sttEngine: null,
      sttEngineId: null,
    })).rejects.toMatchObject({ code: 'route_mismatch' });
    const authorization = await authorizeAgentJobEgress(t.env, service, job.jobId, {
      claimToken: job.claimToken,
      attempt: job.attempt,
      rawAudioSha256: audio.sha256,
      provider: 'azure',
    }, AZURE_RUNTIME);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 2 * 60_000);
    try {
      await expect(markAgentJobEgressInFlight(t.env, service, job.jobId, {
        egressAuthorizationId: authorization.egressAuthorizationId,
        claimToken: job.claimToken,
        attempt: job.attempt,
      }, AZURE_RUNTIME)).rejects.toMatchObject({ code: 'local_ner_unavailable' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('loses the Azure in-flight CAS when consent is superseded after its preflight read', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureSession(supportCaseId);
    await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, {
      sttMode: 'azure', llmMode: 'openai',
    });
    const audio = await registerFixtureRecording(
      t.env, counselor, service, sessionId, AZURE_RUNTIME,
    );
    const qualification = await seedNerQualification(t.db);
    const [job] = (await claimAgentJobs(
      t.env, service, AZURE_RUNTIME, claimRequest(qualification),
    )).jobs;
    if (job === undefined || job.kind !== 'audio') throw new Error('expected Azure audio job');
    await verifyAgentJobAudio(t.env, service, job.jobId, {
      claimToken: job.claimToken,
      attempt: job.attempt,
      generationId: audio.generationId,
      agentComputedSha256: audio.sha256,
    });
    const authorization = await authorizeAgentJobEgress(t.env, service, job.jobId, {
      claimToken: job.claimToken,
      attempt: job.attempt,
      rawAudioSha256: audio.sha256,
      provider: 'azure',
    }, AZURE_RUNTIME);
    const disclosure = (await issueSupportCaseConsentDisclosures(
      t.env, counselor, supportCaseId,
    )).find((item) => item.domain === 'counseling_recording');
    if (disclosure === undefined) throw new Error('expected recording disclosure');
    let injected = false;
    const raceDb = {
      prepare: t.env.DB.prepare.bind(t.env.DB),
      async batch<T>(statements: PreparedStatement[]) {
        if (!injected) {
          injected = true;
          await appendSupportCaseConsentEvent(t.env, counselor, supportCaseId, {
            domain: 'counseling_recording',
            decision: 'grant',
            provider: disclosure.provider,
            providerLegalRecipient: disclosure.providerLegalRecipient,
            providerCountry: disclosure.country,
            purpose: disclosure.purpose,
            retentionDuration: null,
            copyVersion: disclosure.copyVersion,
            copyHash: disclosure.copyHash,
            disclosureSnapshotId: disclosure.snapshotId,
            effectiveAt: new Date().toISOString(),
            idempotencyKey: crypto.randomUUID(),
            correctionOfEventId: null,
            expectedRevision: null,
          });
        }
        return t.env.DB.batch<T>(statements);
      },
    };
    await expect(markAgentJobEgressInFlight(
      { ...t.env, DB: raceDb },
      service,
      job.jobId,
      {
        egressAuthorizationId: authorization.egressAuthorizationId,
        claimToken: job.claimToken,
        attempt: job.attempt,
      },
      AZURE_RUNTIME,
    )).rejects.toMatchObject({ code: 'stale_claim' });
    expect(injected).toBe(true);
    await expect(t.db.prepare(
      'SELECT status FROM agent_job_egress_records WHERE id=?',
    ).bind(authorization.egressAuthorizationId).first()).resolves.toMatchObject({
      status: 'revoked',
    });
  });

  it('사람 역할은 claim endpoint를 쓸 수 없다', async () => {
    const qualification = await seedNerQualification(t.db);
    await expect(claimAgentJobs(t.env, counselor, LOCAL_SINGLE_RUNTIME, claimRequest(qualification)))
      .rejects.toMatchObject({ code: 'forbidden' });
    await expect(claimAgentJobs(t.env, testActors.admin, LOCAL_SINGLE_RUNTIME, claimRequest(qualification)))
      .rejects.toMatchObject({ code: 'forbidden' });
  });
});
