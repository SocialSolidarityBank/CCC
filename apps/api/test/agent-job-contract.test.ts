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
  AgentJobContractError,
  claimAgentJobs,
  createCase,
  createCounselingRecord,
  enqueueTextWorkItem,
  getAgentJobSource,
  heartbeatAgentJob,
  interleaveAgentJobQueues,
  issueAgentJobMaskDictionary,
  listSupportCasesForBeneficiary,
  recordPilotTextAiConsentEvidence,
  registerRecording,
  releaseAgentJob,
  updateParticipantConsent,
  type Actor,
} from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';
import { agentResultRequest, claimRequest, LOCAL_SINGLE_RUNTIME, seedNerQualification } from './support/agent-jobs';

vi.setConfig({ testTimeout: 60_000 });

const { counselor, service } = testActors;
const secondAgent: Actor = { userId: 'service.second@example.invalid', orgId: 'org_demo', role: 'service' };

const t = setupD1();

beforeEach(async () => {
  await t.reset();
});

async function fixtureSupportCase(): Promise<{ caseId: string; supportCaseId: string }> {
  const beneficiary = await createCase(t.env, counselor, {});
  const { programs } = await listSupportCasesForBeneficiary(t.env, counselor, beneficiary.id);
  const supportCaseId = programs[0]?.supportCase.id;
  if (supportCaseId === undefined) throw new Error('expected an initial support case');
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  await updateParticipantConsent(t.env, counselor, supportCaseId, { privacy: true, recordingAi: true });
  await recordPilotTextAiConsentEvidence(t.env, counselor, beneficiary.id, {
    noticeVersion: 'pilot-text-ai-v1',
    noticeSha256: 'a'.repeat(64),
    evidenceRef: `r2://pilot-evidence/${beneficiary.id}`,
    evidenceSha256: 'f'.repeat(64),
    effectiveAt: '2026-01-01T00:00:00.000Z',
  });
  return { caseId: beneficiary.id, supportCaseId };
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
  const sessionId = await fixtureSession(supportCaseId);
  await enqueueTextWorkItem(t.env, counselor, sessionId, 'manual_record');
  return sessionId;
}

/** 원음이 등록된 오디오 일감 1건. */
async function fixtureAudioJob(supportCaseId: string): Promise<string> {
  const sessionId = await fixtureSession(supportCaseId);
  await registerRecording(t.env, counselor, sessionId, `audio/${sessionId}/${crypto.randomUUID()}`);
  return sessionId;
}

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

    const first = await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification));
    const second = await claimAgentJobs(t.env, secondAgent, LOCAL_SINGLE_RUNTIME, claimRequest(qualification));

    expect(first.schemaVersion).toBe(2);
    expect(first.jobs).toHaveLength(2);
    expect(second.jobs).toEqual([]);
    expect(first.jobs.map((job) => job.kind).sort()).toEqual(['audio', 'text']);
    for (const job of first.jobs) {
      expect(job.attempt).toBe(1);
      expect(job.maxAttempts).toBe(3);
      expect(job.state).toBe('leased');
      expect(job.claimToken).toMatch(/^[0-9a-f]{64}$/);
      expect(job.route).toBe('local-single-agent');
      expect(job.maskDictionaryEndpoint).toBe(`/pipeline/jobs/${job.jobId}/mask-dictionary`);
    }
    // 오디오만 원음 묶음을 갖고, 텍스트는 null 이다.
    const audioJob = first.jobs.find((job) => job.kind === 'audio');
    const textJob = first.jobs.find((job) => job.kind === 'text');
    expect(audioJob?.audio?.delivery).toBe('api-stream');
    expect(audioJob?.audio?.retentionHardCapAt).toMatch(/Z$/);
    expect(audioJob?.sttEngine).toBe('local');
    expect(textJob?.audio).toBeNull();
    expect(textJob?.sttEngine).toBeNull();
    // 원문은 임대 주인만 받는다.
    if (textJob === undefined) throw new Error('expected a text job');
    await expect(getAgentJobSource(t.env, service, textJob.jobId, textJob.claimToken, 1))
      .resolves.toMatchObject({ sessionId: textSession });
    await expect(getAgentJobSource(t.env, secondAgent, textJob.jobId, textJob.claimToken, 1))
      .rejects.toMatchObject({ code: 'stale_claim' });
    expect(await jobRow(audioSession)).toMatchObject({ state: 'leased', lease_owner: service.userId });
  });

  it('F3 heartbeat는 임대를 연장하고, 만료된 임대는 재분배 뒤 옛 토큰을 거부한다', async () => {
    const { supportCaseId } = await fixtureSupportCase();
    const sessionId = await fixtureTextJob(supportCaseId);
    const qualification = await seedNerQualification(t.db);
    const [claimed] = (await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(qualification))).jobs;
    if (claimed === undefined) throw new Error('expected a claimed job');

    const beat = await heartbeatAgentJob(t.env, service, claimed.jobId, {
      claimToken: claimed.claimToken,
      attempt: 1,
    });
    expect(beat.state).toBe('leased');
    expect(beat.leaseExpiresAt > new Date().toISOString()).toBe(true);

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

    await updateParticipantConsent(t.env, counselor, supportCaseId, { privacy: true, recordingAi: false });

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

  it('사람 역할은 claim endpoint를 쓸 수 없다', async () => {
    const qualification = await seedNerQualification(t.db);
    await expect(claimAgentJobs(t.env, counselor, LOCAL_SINGLE_RUNTIME, claimRequest(qualification)))
      .rejects.toMatchObject({ code: 'forbidden' });
    await expect(claimAgentJobs(t.env, testActors.admin, LOCAL_SINGLE_RUNTIME, claimRequest(qualification)))
      .rejects.toMatchObject({ code: 'forbidden' });
  });
});
