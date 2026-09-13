import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { PreparedStatement } from '@ccc/contracts/database';
import type { ApiEnv } from '@ccc/http-api/identity';
import worker from './support/local-worker';
import {
  abandonRecordingUpload,
  admitRecordingUpload,
  appendSupportCaseConsentEvent,
  authorizeRecordingUploadStream,
  beginRecordingUploadIntent,
  completeRecordingUploadStorageWrite,
  ConflictError,
  createCase,
  createManualSession,
  getSupportCaseConsent,
  issueSupportCaseConsentDisclosures,
  recordSttReadiness,
  registerRecording,
  reconcileAudioObjectDeletion,
  type Actor,
} from '@ccc/core/gateway';
import { setupD1, seedTestProgramWithRuntimeModes, testActors, testProgramId, type TestApiEnv } from './support/d1';
import {
  agentManifestEnv,
  claimOverHttp,
  LOCAL_SINGLE_RUNTIME,
  registerFixtureRecording,
  seedCanonicalSttConsent,
} from './support/agent-jobs';
import { registrationInput } from './support/registration';

const counselor: Actor = testActors.counselor;
const admin: Actor = testActors.admin;
const service: Actor = testActors.service;
const unassignedCounselor: Actor = testActors.unassignedCounselor;
const otherOrgCounselor: Actor = {
  userId: 'counselor.other@example.invalid',
  orgId: 'org_other',
  role: 'counselor',
};
const otherOrgService: Actor = {
  userId: 'service.other@example.invalid',
  orgId: 'org_other',
  role: 'service',
};

const counselorHeaders = {
  'content-type': 'audio/mpeg',
  'X-CCC-User-Id': counselor.userId,
  'X-CCC-Org-Id': counselor.orgId,
  'X-CCC-Role': 'counselor',
};

const adminHeaders = {
  ...counselorHeaders,
  'X-CCC-User-Id': admin.userId,
  'X-CCC-Org-Id': admin.orgId,
  'X-CCC-Role': 'admin',
};

const serviceHeaders = {
  'X-CCC-User-Id': service.userId,
  'X-CCC-Org-Id': service.orgId,
  'X-CCC-Role': 'service',
};
const serviceUploadHeaders = {
  ...serviceHeaders,
  'content-type': 'audio/mpeg',
};
const unassignedCounselorHeaders = {
  ...counselorHeaders,
  'X-CCC-User-Id': unassignedCounselor.userId,
};
const otherOrgCounselorHeaders = {
  ...counselorHeaders,
  'X-CCC-User-Id': otherOrgCounselor.userId,
  'X-CCC-Org-Id': otherOrgCounselor.orgId,
};
const otherOrgServiceHeaders = {
  ...serviceHeaders,
  'X-CCC-User-Id': otherOrgService.userId,
  'X-CCC-Org-Id': otherOrgService.orgId,
};

const AUDIO_BYTES = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x11, 0x22, 0x33]);

const t = setupD1();
let configuredEnv: TestApiEnv;
beforeAll(async () => {
  await t.reset();
  configuredEnv = await agentManifestEnv(t.env, { stt: 'local' });
});

function localEnv(): TestApiEnv {
  Object.assign(configuredEnv, t.env);
  return configuredEnv;
}

async function makeInPersonSession(consent: boolean) {
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, admin.userId, { sttMode: 'local', llmMode: 'off' });
  t.env.CCC_STT_MODE = 'local';
  t.env.CCC_LLM_MODE = 'off';
  // 녹음 권한의 유일한 근거는 등록 6종 동의다 — 미동의 경로는 녹음·STT·국외·보유기간을 decline 으로 남긴다.
  const caseRecord = await createCase(t.env, counselor, await registrationInput(
    t.env,
    counselor,
    { programId: testProgramId(counselor.orgId) },
    consent ? undefined : {
      counseling_recording: 'decline',
      external_stt_processing: 'decline',
      external_llm_cross_border_processing: 'decline',
      voice_original_retention_period: 'decline',
    },
  ));
  const session = await createManualSession(t.env, counselor, caseRecord.id, {
    submissionId: '03000000-0000-4000-8000-000000000001',
    heldAt: '2026-01-02T10:00:00.000Z',
    channel: 'in_person',
    memo: 'MEMO_AUDIO_DEMO',
    gasScores: [],
  });
  await recordSttReadiness(localEnv(), service, {
    schemaVersion: 1,
    sttMode: 'local',
    sttEngineId: 'qwen3-asr',
    state: 'ready',
    capacity: 1,
  });
  if (consent) {
    const scope = await t.db.prepare('SELECT support_case_id FROM sessions WHERE id=?')
      .bind(session.id).first<{ support_case_id: string }>();
    if (scope === null) throw new Error('expected support case scope');
    // 동의는 등록이 이미 남겼다. 이 호출이 여기 남는 이유는 녹음 허가가 요구하는
    // 영업일 달력(CCC_KR_BUSINESS_CALENDAR)을 env 에 세워 주기 때문이다.
    await seedCanonicalSttConsent(localEnv(), counselor, scope.support_case_id);
  }
  return { caseRecord, session };
}

async function putAudio(
  sessionId: string,
  env: ApiEnv,
  headers: HeadersInit = counselorHeaders,
  body: BodyInit = AUDIO_BYTES,
) {
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has('content-length') && body instanceof Uint8Array) {
    requestHeaders.set('content-length', String(body.byteLength));
  }
  const response = await worker.fetch(new Request('http://localhost/sessions/' + sessionId + '/audio', {
    method: 'PUT',
    headers: requestHeaders,
    body,
  }), env);
  if (response.status === 200) {
    await env.DB.prepare('UPDATE audio_objects SET eligible_after=? WHERE session_id=?')
      .bind(new Date(Date.now() - 1000).toISOString(), sessionId).run();
  }
  return response;
}

async function bucketCount(): Promise<number> {
  return (await t.bucket.list()).objects.length;
}
async function recordingState(sessionId: string): Promise<{ audio_r2_key: string | null; ai_status: string }> {
  const session = await t.db.prepare(
    'SELECT audio_r2_key, ai_status FROM sessions WHERE id = ?',
  ).bind(sessionId).first<{ audio_r2_key: string | null; ai_status: string }>();
  if (session === null) throw new Error('expected session recording state');
  return session;
}

/** v2 는 작업 ID 로 감사를 남긴다 — 회차의 오디오 작업을 거쳐 센다(S5). */
async function downloadAuditCount(sessionId: string): Promise<number> {
  const audit = await t.db.prepare(
    `SELECT COUNT(*) AS count FROM audit_log
     WHERE action = 'download_audio'
       AND target_id IN (SELECT id FROM agent_jobs WHERE session_id = ? AND kind = 'audio')`,
  ).bind(sessionId).first<{ count: number }>();
  if (audit === null) throw new Error('expected download audit count');
  return audit.count;
}

/**
 * 원음 전달은 claim 에 묶인다 (S5). 서비스 자격으로 claim 한 뒤 그 토큰으로 GET 하고,
 * 자격 거부 표는 같은 endpoint 를 다른 actor 로 두드린다.
 */
async function relayAudio(
  env: ApiEnv,
  sessionId: string,
  headers: Record<string, string> | null = serviceHeaders,
): Promise<{ response: Response; jobId: string }> {
  const agentEnv = await agentManifestEnv(env, { stt: 'local' });
  const { jobs } = await claimOverHttp(agentEnv, t.db, {
    'content-type': 'application/json',
    'X-CCC-User-Id': service.userId,
    'X-CCC-Org-Id': service.orgId,
    'X-CCC-Role': 'service',
  });
  const job = jobs.find((candidate) => candidate.kind === 'audio' && candidate.sessionId === sessionId);
  if (job === undefined) throw new Error('expected a claimable audio job');
  const request = headers === null
    ? new Request(`http://localhost/pipeline/jobs/${job.jobId}/audio`)
    : new Request(`http://localhost/pipeline/jobs/${job.jobId}/audio`, {
      headers: { ...headers, 'X-CCC-Job-Claim': job.claimToken, 'X-CCC-Job-Attempt': String(job.attempt) },
    });
  const response = await worker.fetch(request, agentEnv);
  return { response, jobId: job.jobId };
}

async function expectDeniedAudioRequest(
  response: Response,
  sessionId: string,
  expected: { status: number; body: { error: string; jobId?: string | null; retryable?: boolean } },
  expectedObjectCount: number,
  expectedRecording: { audio_r2_key: string | null; ai_status: string },
): Promise<void> {
  expect(response.status).toBe(expected.status);
  // 본문 전체를 못박는다 - 예상 밖 필드가 섞이면 실패해야 한다(S5 §2.6).
  await expect(response.json()).resolves.toEqual(expected.body);
  expect(await bucketCount()).toBe(expectedObjectCount);
  expect(await recordingState(sessionId)).toEqual(expectedRecording);
  expect(await downloadAuditCount(sessionId)).toBe(0);
}

describe('audio upload and relay', () => {
  it('uploads audio to R2 and links it through registerRecording', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);

    const response = await putAudio(session.id, env);
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await response.json()).not.toHaveProperty('audioR2Key');

    expect(await bucketCount()).toBe(1);

    const sessionResponse = await worker.fetch(new Request('http://localhost/sessions/' + session.id, { headers: counselorHeaders }), env);
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({ aiStatus: 'uploaded' });
  });

  it('keeps a durable deletion record when local audio storage fails after admission', async () => {
    await t.reset();
    const env = localEnv();
    const { session } = await makeInPersonSession(true);
    const putFailure = vi.spyOn(env.audioStore, 'put')
      .mockRejectedValueOnce(new Error('synthetic storage failure'));

    const response = await putAudio(session.id, env);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'internal_error' });
    await expect(t.db.prepare(
      `SELECT state,deletion_reason FROM audio_objects
       WHERE org_id=? AND session_id=?`,
    ).bind(counselor.orgId, session.id).all()).resolves.toMatchObject({
      results: [{
        state: 'upload_abandoned',
        deletion_reason: 'rejected_upload',
      }],
    });
    expect(await bucketCount()).toBe(0);
    putFailure.mockRestore();
  });

  it('deletes a stream that commits after consent withdrawal already proved the key absent', async () => {
    await t.reset();
    const env = localEnv();
    const { session } = await makeInPersonSession(true);
    const scope = await t.db.prepare(
      'SELECT support_case_id FROM sessions WHERE id=? AND org_id=?',
    ).bind(session.id, counselor.orgId).first<{ support_case_id: string }>();
    if (scope === null) throw new Error('expected support case scope');
    const admission = await admitRecordingUpload(env, counselor, session.id, LOCAL_SINGLE_RUNTIME);
    const uploadExpiresAt = new Date(Date.now() + 60_000).toISOString();
    const intent = await beginRecordingUploadIntent(
      env, counselor, session.id, admission, 'api-stream', {
        contentLength: AUDIO_BYTES.byteLength,
        contentType: 'audio/mpeg',
        clientAssertedSha256: null,
        storageSha256: null,
        uploadExpiresAt,
      },
    );
    await authorizeRecordingUploadStream(env, counselor, session.id, intent.audioObjectId, admission);
    const current = (await getSupportCaseConsent(env, counselor, scope.support_case_id))
      .find((item) => item.domain === 'counseling_recording');
    const disclosure = (await issueSupportCaseConsentDisclosures(env, counselor, scope.support_case_id))
      .find((item) => item.domain === 'counseling_recording');
    if (current?.state !== 'granted' || current.revision === null || disclosure === undefined) {
      throw new Error('expected current recording consent');
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
    await expect(reconcileAudioObjectDeletion(env, env.audioStore, intent.audioObjectId))
      .resolves.toBe(false);
    await expect(t.db.prepare(
      'SELECT state,generation_id FROM audio_objects WHERE id=?',
    ).bind(intent.audioObjectId).first()).resolves.toMatchObject({
      state: 'deletion_pending',
      generation_id: expect.stringMatching(/^pending:/),
    });

    const stored = await env.audioStore.put(intent.key, new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(AUDIO_BYTES);
        controller.close();
      },
    }), {
      contentLength: AUDIO_BYTES.byteLength,
      contentType: 'audio/mpeg',
      expiresAt: uploadExpiresAt,
    });
    await t.db.prepare(
      'UPDATE audio_objects SET upload_expires_at=?,next_attempt_at=? WHERE id=?',
    ).bind(
      new Date(Date.now() - 120_000).toISOString(),
      new Date(Date.now() - 1000).toISOString(),
      intent.audioObjectId,
    ).run();
    await expect(reconcileAudioObjectDeletion(env, env.audioStore, intent.audioObjectId))
      .resolves.toBe(false);
    expect(await bucketCount()).toBe(0);
    await expect(t.db.prepare(
      'SELECT state,generation_id FROM audio_objects WHERE id=?',
    ).bind(intent.audioObjectId).first()).resolves.toMatchObject({
      state: 'deletion_pending',
      generation_id: expect.stringMatching(/^pending:/),
    });
    await completeRecordingUploadStorageWrite(
      env, counselor, session.id, intent.audioObjectId, stored.generationId, stored.sha256,
    );
    await expect(registerRecording(env, counselor, session.id, intent.key, admission, {
      contentLength: AUDIO_BYTES.byteLength,
      contentType: 'audio/mpeg',
      clientAssertedSha256: null,
      storageSha256: stored.sha256,
      generationId: stored.generationId,
      uploadExpiresAt,
    }, intent.audioObjectId)).rejects.toThrow();
    await abandonRecordingUpload(env, counselor, intent.audioObjectId, 'consent_withdrawal');
    await expect(reconcileAudioObjectDeletion(env, env.audioStore, intent.audioObjectId))
      .resolves.toBe(true);
    expect(await bucketCount()).toBe(0);
    await expect(t.db.prepare(
      'SELECT state,generation_id,deletion_reason FROM audio_objects WHERE id=?',
    ).bind(intent.audioObjectId).first()).resolves.toMatchObject({
      state: 'unprocessed_expired',
      generation_id: stored.generationId,
      deletion_reason: 'consent_withdrawal',
    });
  });

  it('다운로드가 원본 바이트를 그대로 돌려주고 감사를 남긴다 (CCC-94 녹음 보관함 왕복)', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);
    const upload = await putAudio(session.id, env);
    expect(upload.status).toBe(200);
    await expect(recordingState(session.id)).resolves.toEqual({
      audio_r2_key: expect.stringMatching(/^audio\/.+/),
      ai_status: 'uploaded',
    });

    const { response: download } = await relayAudio(env, session.id);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('audio/mpeg');
    // 원본 보존 — 바이트 단위로 같아야 보관함이 손을 대지 않은 증거다(CCC-94).
    expect(Array.from(new Uint8Array(await download.arrayBuffer()))).toEqual(Array.from(AUDIO_BYTES));
    // 열람(다운로드)은 감사에 남는다(D14).
    await expect(downloadAuditCount(session.id)).resolves.toBeGreaterThan(0);
    // 프리뷰 보관함만 쓴다 — 프로덕션 바인딩은 프리뷰 환경에 없다(운영 D1·R2 변경 0).
    expect(await bucketCount()).toBe(1);
  });
  it('rechecks the practitioner role inside the recording mutation batch', async () => {
    await t.reset();
    await localEnv();
    const { session } = await makeInPersonSession(true);
    const scope = await t.db.prepare(
      'SELECT support_case_id FROM sessions WHERE id = ? AND org_id = ?',
    ).bind(session.id, counselor.orgId).first<{ support_case_id: string }>();
    if (scope === null) throw new Error('expected support case scope');
    await seedCanonicalSttConsent(t.env, counselor, scope.support_case_id);
    await recordSttReadiness(t.env, service, {
      schemaVersion: 1,
      sttMode: 'local',
      sttEngineId: 'qwen3-asr',
      state: 'ready',
      capacity: 1,
    });
    const admission = await admitRecordingUpload(t.env, counselor, session.id, LOCAL_SINGLE_RUNTIME);
    let intercepted = false;
    const raceDb = new Proxy(t.env.DB, {
      get(target, property, receiver) {
        if (property === 'batch') {
          return async (statements: PreparedStatement[]) => {
            if (!intercepted) {
              intercepted = true;
              await target.prepare(
                `UPDATE user_role_assignments SET revoked_at = datetime('now')
                 WHERE org_id = ? AND user_id = ? AND role = 'practitioner' AND revoked_at IS NULL`,
              ).bind(counselor.orgId, counselor.userId).run();
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });

    await expect(registerRecording(
      { ...t.env, DB: raceDb },
      counselor,
      session.id,
      `audio/${session.id}/${crypto.randomUUID()}`,
      admission,
      {
        contentLength: 1,
        contentType: 'audio/wav',
        clientAssertedSha256: null,
        storageSha256: null,
        generationId: crypto.randomUUID(),
        uploadExpiresAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString(),
      },
      null,
    )).rejects.toBeInstanceOf(ConflictError);
    await expect(recordingState(session.id)).resolves.toEqual({
      audio_r2_key: null,
      ai_status: 'none',
    });
  });
  it('rejects raw audio key registration so human actors cannot link arbitrary objects', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);
    const before = await recordingState(session.id);

    const response = await worker.fetch(new Request(`http://localhost/sessions/${session.id}/recording`, {
      method: 'POST',
      headers: { ...counselorHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ audioR2Key: 'audio/missing/arbitrary-key' }),
    }), env);
    await expectDeniedAudioRequest(
      response,
      session.id,
      { status: 404, body: { error: 'not_found' } },
      0,
      before,
    );
  });
  it('rejects an unauthenticated upload without creating audio or mutating the recording', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);
    const before = await recordingState(session.id);

    const response = await putAudio(session.id, env, {});
    await expectDeniedAudioRequest(
      response,
      session.id,
      { status: 401, body: { error: 'actor_authentication_required' } },
      0,
      before,
    );
  });

  it('rejects a service upload without creating audio or mutating the recording', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);
    const before = await recordingState(session.id);

    const response = await putAudio(session.id, env, serviceUploadHeaders);
    await expectDeniedAudioRequest(response, session.id, { status: 403, body: { error: 'forbidden' } }, 0, before);
  });

  it('rejects an unassigned institution administrator upload without mutating the recording', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);
    const before = await recordingState(session.id);

    const response = await putAudio(session.id, env, adminHeaders);

    await expectDeniedAudioRequest(
      response,
      session.id,
      { status: 403, body: { error: 'forbidden' } },
      0,
      before,
    );
  });

  it('rejects an unassigned counselor upload without creating audio or mutating the recording', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);
    const before = await recordingState(session.id);
    const putSpy = vi.spyOn(t.bucket, 'put');

    const response = await putAudio(session.id, env, unassignedCounselorHeaders);
    await expectDeniedAudioRequest(response, session.id, { status: 403, body: { error: 'forbidden' } }, 0, before);
    expect(putSpy).not.toHaveBeenCalled();
    putSpy.mockRestore();
  });

  it('rejects a cross-org counselor upload without creating audio or mutating the recording', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);
    const before = await recordingState(session.id);

    const response = await putAudio(session.id, env, otherOrgCounselorHeaders);
    await expectDeniedAudioRequest(response, session.id, { status: 403, body: { error: 'forbidden' } }, 0, before);
  });

  it('rejects upload without recording consent before writing to R2', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(false);

    const before = await recordingState(session.id);
    const putSpy = vi.spyOn(t.bucket, 'put');
    const response = await putAudio(session.id, env);
    await expectDeniedAudioRequest(response, session.id, {
      status: 409,
      body: { error: 'consent_not_effective' },
    }, 0, before);
    expect(putSpy).not.toHaveBeenCalled();
    putSpy.mockRestore();
  });


  it('rejects an unsupported content type before touching R2', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);

    const before = await recordingState(session.id);
    const putSpy = vi.spyOn(t.bucket, 'put');
    const response = await putAudio(session.id, env, { ...counselorHeaders, 'content-type': 'text/plain' });
    await expectDeniedAudioRequest(response, session.id, { status: 400, body: { error: 'invalid_request' } }, 0, before);
    expect(putSpy).not.toHaveBeenCalled();
    putSpy.mockRestore();
  });

  it('streams audio bytes to the service role and audits the download', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);
    expect((await putAudio(session.id, env)).status).toBe(200);

    const { response: relay } = await relayAudio(env, session.id);
    expect(relay.status).toBe(200);
    expect(relay.headers.get('content-type')).toBe('audio/mpeg');
    expect(relay.headers.get('cache-control')).toBe('no-store');
    const bytes = new Uint8Array(await relay.arrayBuffer());
    expect([...bytes]).toEqual([...AUDIO_BYTES]);

    expect(await downloadAuditCount(session.id)).toBe(1);
  });

  it('rejects an unauthenticated relay without a download audit or recording mutation', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);
    expect((await putAudio(session.id, env)).status).toBe(200);
    const before = await recordingState(session.id);

    const { response: relay } = await relayAudio(env, session.id, null);
    await expectDeniedAudioRequest(
      relay,
      session.id,
      { status: 401, body: { error: 'actor_authentication_required' } },
      1,
      before,
    );
  });

  it('forbids the audio relay for a counselor actor', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);
    expect((await putAudio(session.id, env)).status).toBe(200);

    const before = await recordingState(session.id);
    const { response: relay } = await relayAudio(env, session.id, counselorHeaders);
    await expectDeniedAudioRequest(
      relay,
      session.id,
      // 역할 거부는 작업을 찾기 전에 나므로 jobId 는 비어 있다.
      { status: 403, body: { error: 'forbidden', jobId: null, retryable: false } },
      1,
      before,
    );
  });
  it('rejects a same-org admin from the service-only audio relay without a download audit or recording mutation', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);
    expect((await putAudio(session.id, env)).status).toBe(200);
    const before = await recordingState(session.id);

    const { response: relay } = await relayAudio(env, session.id, adminHeaders);
    await expectDeniedAudioRequest(
      relay,
      session.id,
      { status: 403, body: { error: 'forbidden', jobId: null, retryable: false } },
      1,
      before,
    );
  });
  it('rejects a cross-org service relay without a download audit or recording mutation', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);
    expect((await putAudio(session.id, env)).status).toBe(200);
    const before = await recordingState(session.id);

    // 다른 기관의 service 에게 이 작업은 존재하지 않는다(org 경계, S5 §2.6).
    const { response: relay, jobId } = await relayAudio(env, session.id, otherOrgServiceHeaders);
    await expectDeniedAudioRequest(
      relay,
      session.id,
      { status: 404, body: { error: 'job_not_found', jobId, retryable: false } },
      1,
      before,
    );
  });

  it('returns 404 when the registered audio object is missing from R2', async () => {
    await t.reset();
    const env = await localEnv();
    const { session } = await makeInPersonSession(true);
    const recording = await registerFixtureRecording(t.env, counselor, service, session.id);
    // 정상 등록된 합성 객체를 저장소에서만 지워 DB와 원음 저장소의 불일치를 재현한다.
    await t.bucket.delete(recording.key);

    const { response: relay, jobId } = await relayAudio(env, session.id);
    expect(relay.status).toBe(404);
    await expect(relay.json()).resolves.toEqual({ error: 'audio_object_missing', jobId, retryable: false });
    // 객체가 없는 작업은 열어 두지 않는다 - 그 코드로 닫힌다(S5 §2.6).
    const closed = await t.db.prepare('SELECT state, terminal_failure_code FROM agent_jobs WHERE id = ?')
      .bind(jobId).first<{ state: string; terminal_failure_code: string | null }>();
    expect(closed).toMatchObject({ state: 'failed', terminal_failure_code: 'audio_object_missing' });
  });
});
