// S5 F8 — 세 모드의 route·오디오 전달, 사람과 service 자격 경계, v1 경로 제거,
// 구조화 v2 결과에 대한 generic 400 이 legacy payload 재전송을 만들지 않는지 고정한다.
import { describe, expect, it, vi } from 'vitest';
import worker from './support/local-worker';
import type { DeploymentMode } from '@ccc/contracts/runtime';
import type { ApiEnv } from '@ccc/http-api/identity';
import {
  createCase,
  createCounselingRecord,
  enqueueTextWorkItem,
  listSupportCasesForBeneficiary,
  recordPilotTextAiConsentEvidence,
  updateParticipantConsent,
} from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';
import { claimRequest, seedNerQualification } from './support/agent-jobs';
import { createTestSigner, signedManifest, SYNTHETIC_LOCAL_REGISTRY } from './support/install-manifest';

vi.setConfig({ testTimeout: 60_000 });

const t = setupD1();
const { counselor } = testActors;

const serviceHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': 'service@example.invalid',
  'X-CCC-Org-Id': 'org_demo',
  'X-CCC-Role': 'service',
};
const counselorHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': counselor.userId,
  'X-CCC-Org-Id': counselor.orgId,
  'X-CCC-Role': 'counselor',
};

async function envForMode(mode: DeploymentMode): Promise<ApiEnv> {
  const signer = await createTestSigner();
  const manifest = await signedManifest(signer, mode, { approvedSttEngineIds: SYNTHETIC_LOCAL_REGISTRY });
  return {
    ...t.env,
    TEXT_AI_PILOT_ENABLED: '1',
    CCC_INSTALL_MANIFEST: JSON.stringify(manifest),
    CCC_INSTALL_SIGNING_KEYS: JSON.stringify(signer.publicKeys),
    CCC_STT_MODE: 'local',
  };
}

/** 텍스트 일감 1건과 오디오 1건을 만든다. 오디오 바이트는 업로드 경로로 넣는다. */
async function seedJobs(env: ApiEnv) {
  const beneficiary = await createCase(env, counselor, {});
  const { programs } = await listSupportCasesForBeneficiary(env, counselor, beneficiary.id);
  const supportCaseId = programs[0]?.supportCase.id;
  if (supportCaseId === undefined) throw new Error('expected an initial support case');
  await updateParticipantConsent(env, counselor, supportCaseId, { privacy: true, recordingAi: true });
  await recordPilotTextAiConsentEvidence(env, counselor, beneficiary.id, {
    noticeVersion: 'pilot-text-ai-v1',
    noticeSha256: 'a'.repeat(64),
    evidenceRef: `r2://pilot-evidence/${beneficiary.id}`,
    evidenceSha256: 'f'.repeat(64),
    effectiveAt: '2026-01-01T00:00:00.000Z',
  });

  const textRecord = await createCounselingRecord(env, counselor, supportCaseId, {
    submissionId: crypto.randomUUID(),
    heldAt: '2026-07-08T10:00:00.000Z',
    channel: 'in_person',
    memo: 'Mode fixture memo for the text queue.',
    gasScores: [],
    actionItems: [],
    flags: [],
  });
  await enqueueTextWorkItem(env, counselor, textRecord.record.id, 'manual_record');

  const audioRecord = await createCounselingRecord(env, counselor, supportCaseId, {
    submissionId: crypto.randomUUID(),
    heldAt: '2026-07-09T10:00:00.000Z',
    channel: 'in_person',
    memo: 'Mode fixture memo for the audio queue.',
    gasScores: [],
    actionItems: [],
    flags: [],
  });
  const body = new Uint8Array(64).fill(7);
  const upload = await worker.fetch(new Request(`http://localhost/sessions/${audioRecord.record.id}/audio`, {
    method: 'PUT',
    headers: { ...counselorHeaders, 'content-type': 'audio/mpeg', 'content-length': String(body.byteLength) },
    body,
  }), env);
  expect(upload.status).toBe(200);
  return { supportCaseId, textSessionId: textRecord.record.id, audioSessionId: audioRecord.record.id };
}

async function claim(env: ApiEnv) {
  const qualification = await seedNerQualification(t.db);
  const response = await worker.fetch(new Request('http://localhost/pipeline/jobs/claim', {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify(claimRequest(qualification)),
  }), env);
  return { response, qualification };
}

describe('S5 F8 세 모드 전달과 자격 경계', () => {
  it('Local 두 모드는 API stream 으로 원음을 주고 route 를 모드별로 싣는다', async () => {
    for (const mode of ['local-single', 'local-office'] as const) {
      await t.reset();
      const env = await envForMode(mode);
      await seedJobs(env);
      const { response } = await claim(env);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const claimed = await response.json() as {
        schemaVersion: number;
        jobs: Array<{ jobId: string; kind: string; route: string; claimToken: string; audio: { delivery: string } | null }>;
      };
      expect(claimed.schemaVersion).toBe(2);
      expect(claimed.jobs.map((job) => job.route)).toEqual([`${mode}-agent`, `${mode}-agent`]);
      const audioJob = claimed.jobs.find((job) => job.kind === 'audio');
      if (audioJob === undefined) throw new Error('expected an audio job');
      expect(audioJob.audio?.delivery).toBe('api-stream');

      const stream = await worker.fetch(new Request(`http://localhost/pipeline/jobs/${audioJob.jobId}/audio`, {
        headers: {
          ...serviceHeaders,
          'X-CCC-Job-Claim': audioJob.claimToken,
          'X-CCC-Job-Attempt': '1',
        },
      }), env);
      expect(stream.status).toBe(200);
      expect(stream.headers.get('cache-control')).toBe('no-store');
      expect(new Uint8Array(await stream.arrayBuffer())).toHaveLength(64);
      // claim 자격이 없는 요청은 바이트를 못 받는다.
      const unclaimed = await worker.fetch(new Request(`http://localhost/pipeline/jobs/${audioJob.jobId}/audio`, {
        headers: { ...serviceHeaders, 'X-CCC-Job-Claim': 'f'.repeat(64), 'X-CCC-Job-Attempt': '1' },
      }), env);
      expect(unclaimed.status).toBe(409);
      await expect(unclaimed.json()).resolves.toMatchObject({ error: 'stale_claim', retryable: false });
    }
  });

  it('원음 해시는 서버가 저장된 바이트에서 계산한 값과 대조해야 trusted 가 된다', async () => {
    await t.reset();
    const env = await envForMode('local-single');
    await seedJobs(env);
    const { response } = await claim(env);
    const claimed = await response.json() as {
      jobs: Array<{ jobId: string; kind: string; claimToken: string; attempt: number; audio: { generationId: string } | null }>;
    };
    const audioJob = claimed.jobs.find((job) => job.kind === 'audio');
    if (audioJob === undefined || audioJob.audio === null) throw new Error('expected an audio job');
    const verify = (agentComputedSha256: string) => worker.fetch(new Request(
      `http://localhost/pipeline/jobs/${audioJob.jobId}/audio/verify`,
      {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({
          claimToken: audioJob.claimToken,
          attempt: audioJob.attempt,
          generationId: audioJob.audio?.generationId,
          agentComputedSha256,
        }),
      },
    ), env);

    // Agent 가 아무 hex64 를 보내도 서버 해시와 다르면 trusted hash 가 생기지 않는다.
    const mismatch = await verify('a'.repeat(64));
    expect(mismatch.status).toBe(422);
    await expect(mismatch.json()).resolves.toMatchObject({ error: 'audio_hash_mismatch' });
    const failed = await t.db.prepare(
      'SELECT state, terminal_failure_code, raw_audio_sha256 FROM agent_jobs WHERE id = ?',
    ).bind(audioJob.jobId).first<Record<string, unknown>>();
    expect(failed).toMatchObject({
      state: 'failed',
      terminal_failure_code: 'audio_hash_mismatch',
      raw_audio_sha256: null,
    });
  });

  it('Community Cloud 는 signed GET 발급기가 붙기 전까지 원음 전달을 열지 않는다', async () => {
    await t.reset();
    const env = await envForMode('community-cloud');
    await seedJobs(env);
    const { response } = await claim(env);
    const claimed = await response.json() as {
      jobs: Array<{ jobId: string; kind: string; route: string; claimToken: string; audio: { delivery: string } | null }>;
    };
    const audioJob = claimed.jobs.find((job) => job.kind === 'audio');
    if (audioJob === undefined) throw new Error('expected an audio job');
    expect(audioJob.route).toBe('community-cloud-agent');
    expect(audioJob.audio?.delivery).toBe('protected-get');
    const protectedGet = await worker.fetch(new Request(`http://localhost/pipeline/jobs/${audioJob.jobId}/audio`, {
      headers: { ...serviceHeaders, 'X-CCC-Job-Claim': audioJob.claimToken, 'X-CCC-Job-Attempt': '1' },
    }), env);
    expect(protectedGet.status).toBe(503);
    await expect(protectedGet.json()).resolves.toEqual({ error: 'service_unavailable' });
  });

  it('사람은 job endpoint 를, Agent 는 업무 API 를 쓸 수 없다', async () => {
    await t.reset();
    const env = await envForMode('local-single');
    await seedJobs(env);
    const qualification = await seedNerQualification(t.db);
    const humanClaim = await worker.fetch(new Request('http://localhost/pipeline/jobs/claim', {
      method: 'POST',
      headers: counselorHeaders,
      body: JSON.stringify(claimRequest(qualification)),
    }), env);
    expect(humanClaim.status).toBe(403);
    await expect(humanClaim.json()).resolves.toMatchObject({ error: 'forbidden' });

    const serviceBusiness = await worker.fetch(new Request('http://localhost/cases', { headers: serviceHeaders }), env);
    expect(serviceBusiness.status).toBe(403);
  });

  it('v1 service 경로는 남아 있지 않다', async () => {
    await t.reset();
    const env = await envForMode('local-single');
    const { textSessionId } = await seedJobs(env);
    const removed = [
      new Request('http://localhost/pipeline/text-jobs', { headers: serviceHeaders }),
      new Request('http://localhost/pipeline/text-jobs/item-1/source', { headers: serviceHeaders }),
      new Request('http://localhost/pipeline/text-jobs/item-1/complete', { method: 'POST', headers: serviceHeaders }),
      new Request('http://localhost/pipeline/jobs', { headers: serviceHeaders }),
      new Request(`http://localhost/sessions/${textSessionId}/ai/source`, {
        method: 'POST',
        headers: serviceHeaders,
        body: JSON.stringify({ maskedText: 'MASKED', sha256: 'a'.repeat(64), maskingPipelineVersion: 'ner-mask-v1', evidence: [] }),
      }),
    ];
    for (const request of removed) {
      const response = await worker.fetch(request, env);
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({ error: 'not_found' });
    }
  });

  it('v1 모양 결과 본문은 400 한 번으로 끝나고 작업은 임대 상태를 유지한다', async () => {
    await t.reset();
    const env = await envForMode('local-single');
    await seedJobs(env);
    const { response } = await claim(env);
    const claimed = await response.json() as { jobs: Array<{ jobId: string; kind: string; claimToken: string }> };
    const textJob = claimed.jobs.find((job) => job.kind === 'text');
    if (textJob === undefined) throw new Error('expected a text job');

    // v1 payload: schemaVersion·claim 자격·S6 metadata 가 없다.
    const legacy = await worker.fetch(new Request(`http://localhost/pipeline/jobs/${textJob.jobId}/result`, {
      method: 'POST',
      headers: serviceHeaders,
      body: JSON.stringify({
        maskedText: 'MASKED legacy body',
        sha256: 'a'.repeat(64),
        maskingPipelineVersion: 'ner-mask-v1',
        evidence: [],
        emotionScores: {},
      }),
    }), env);
    expect(legacy.status).toBe(400);
    const state = await t.db.prepare('SELECT state, result_payload_sha256 FROM agent_jobs WHERE id = ?')
      .bind(textJob.jobId).first<Record<string, unknown>>();
    expect(state).toMatchObject({ state: 'leased', result_payload_sha256: null });
    const snapshots = await t.db.prepare('SELECT COUNT(*) AS count FROM ai_masked_source_snapshots').first<{ count: number }>();
    expect(snapshots?.count).toBe(0);
  });

  it('승인 registry 에 없는 STT 는 오디오 작업을 claim 하지 않는다', async () => {
    await t.reset();
    const signer = await createTestSigner();
    const manifest = await signedManifest(signer, 'local-office', { approvedSttEngineIds: [] });
    const env = {
      ...t.env,
      TEXT_AI_PILOT_ENABLED: '1',
      CCC_INSTALL_MANIFEST: JSON.stringify(manifest),
      CCC_INSTALL_SIGNING_KEYS: JSON.stringify(signer.publicKeys),
      CCC_STT_MODE: 'local',
    };
    await seedJobs(env);
    const { response } = await claim(env);
    const claimed = await response.json() as { jobs: Array<{ kind: string; sttEngine: string | null }> };
    expect(claimed.jobs.map((job) => job.kind)).toEqual(['text']);
    expect(claimed.jobs[0]?.sttEngine).toBeNull();
  });
});
