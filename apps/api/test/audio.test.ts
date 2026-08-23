import { describe, expect, it, vi } from 'vitest';
import worker from './support/local-worker';
import {
  ConflictError,
  createCase,
  createManualSession,
  registerRecording,
  type Actor,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

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

function localEnv() {
  return t.env;
}

async function makeInPersonSession(consent: boolean) {
  const caseRecord = await createCase(t.env, counselor, consent ? { consentRecordingAt: '2026-01-01T00:00:00.000Z' } : {});
  const session = await createManualSession(t.env, counselor, caseRecord.id, {
    submissionId: '03000000-0000-4000-8000-000000000001',
    heldAt: '2026-01-02T10:00:00.000Z',
    channel: 'in_person',
    memo: 'MEMO_AUDIO_DEMO',
    gasScores: [],
  });
  return { caseRecord, session };
}

async function putAudio(
  sessionId: string,
  env: ReturnType<typeof localEnv>,
  headers: HeadersInit = counselorHeaders,
  body: BodyInit = AUDIO_BYTES,
) {
  return worker.fetch(new Request('http://localhost/sessions/' + sessionId + '/audio', {
    method: 'PUT',
    headers,
    body,
  }), env);
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

async function downloadAuditCount(sessionId: string): Promise<number> {
  const audit = await t.db.prepare(
    "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'download_audio' AND target_id = ?",
  ).bind(sessionId).first<{ count: number }>();
  if (audit === null) throw new Error('expected download audit count');
  return audit.count;
}

async function expectDeniedAudioRequest(
  response: Response,
  sessionId: string,
  expected: { status: number; body: { error: string } },
  expectedObjectCount: number,
  expectedRecording: { audio_r2_key: string | null; ai_status: string },
): Promise<void> {
  expect(response.status).toBe(expected.status);
  await expect(response.json()).resolves.toEqual(expected.body);
  expect(await bucketCount()).toBe(expectedObjectCount);
  expect(await recordingState(sessionId)).toEqual(expectedRecording);
  expect(await downloadAuditCount(sessionId)).toBe(0);
}

describe('audio upload and relay', () => {
  it('uploads audio to R2 and links it through registerRecording', async () => {
    await t.reset();
    const env = localEnv();
    const { session } = await makeInPersonSession(true);

    const response = await putAudio(session.id, env);
    expect(response.status).toBe(200);
    expect(await response.json()).not.toHaveProperty('audioR2Key');

    expect(await bucketCount()).toBe(1);

    const sessionResponse = await worker.fetch(new Request('http://localhost/sessions/' + session.id, { headers: counselorHeaders }), env);
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({ aiStatus: 'uploaded' });
  });

  it('다운로드가 원본 바이트를 그대로 돌려주고 감사를 남긴다 (CCC-94 녹음 보관함 왕복)', async () => {
    await t.reset();
    const env = localEnv();
    const { session } = await makeInPersonSession(true);
    const upload = await putAudio(session.id, env);
    expect(upload.status).toBe(200);
    await expect(recordingState(session.id)).resolves.toEqual({
      audio_r2_key: expect.stringMatching(/^audio\/.+/),
      ai_status: 'uploaded',
    });

    const download = await worker.fetch(new Request(`http://localhost/pipeline/jobs/${session.id}/audio`, {
      headers: serviceHeaders,
    }), env);
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
    const { session } = await makeInPersonSession(true);
    let intercepted = false;
    const raceDb = new Proxy(t.db, {
      get(target, property, receiver) {
        if (property === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
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
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1Database;

    await expect(registerRecording(
      { ...t.env, DB: raceDb },
      counselor,
      session.id,
      'audio/race/revoked-practitioner',
    )).rejects.toBeInstanceOf(ConflictError);
    await expect(recordingState(session.id)).resolves.toEqual({
      audio_r2_key: null,
      ai_status: 'none',
    });
  });
  it('rejects raw audio key registration so human actors cannot link arbitrary objects', async () => {
    await t.reset();
    const env = localEnv();
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
    const env = localEnv();
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
    const env = localEnv();
    const { session } = await makeInPersonSession(true);
    const before = await recordingState(session.id);

    const response = await putAudio(session.id, env, serviceUploadHeaders);
    await expectDeniedAudioRequest(response, session.id, { status: 403, body: { error: 'forbidden' } }, 0, before);
  });

  it('rejects an unassigned institution administrator upload without mutating the recording', async () => {
    await t.reset();
    const env = localEnv();
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
    const env = localEnv();
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
    const env = localEnv();
    const { session } = await makeInPersonSession(true);
    const before = await recordingState(session.id);

    const response = await putAudio(session.id, env, otherOrgCounselorHeaders);
    await expectDeniedAudioRequest(response, session.id, { status: 403, body: { error: 'forbidden' } }, 0, before);
  });

  it('rejects upload without recording consent before writing to R2', async () => {
    await t.reset();
    const env = localEnv();
    const { session } = await makeInPersonSession(false);

    const before = await recordingState(session.id);
    const putSpy = vi.spyOn(t.bucket, 'put');
    const response = await putAudio(session.id, env);
    await expectDeniedAudioRequest(response, session.id, { status: 400, body: { error: 'invalid_request' } }, 0, before);
    expect(putSpy).not.toHaveBeenCalled();
    putSpy.mockRestore();
  });


  it('rejects an unsupported content type before touching R2', async () => {
    await t.reset();
    const env = localEnv();
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
    const env = localEnv();
    const { session } = await makeInPersonSession(true);
    expect((await putAudio(session.id, env)).status).toBe(200);

    const relay = await worker.fetch(new Request('http://localhost/pipeline/jobs/' + session.id + '/audio', { headers: serviceHeaders }), env);
    expect(relay.status).toBe(200);
    expect(relay.headers.get('content-type')).toBe('audio/mpeg');
    expect(relay.headers.get('cache-control')).toBe('no-store');
    const bytes = new Uint8Array(await relay.arrayBuffer());
    expect([...bytes]).toEqual([...AUDIO_BYTES]);

    expect(await downloadAuditCount(session.id)).toBe(1);
  });

  it('rejects an unauthenticated relay without a download audit or recording mutation', async () => {
    await t.reset();
    const env = localEnv();
    const { session } = await makeInPersonSession(true);
    expect((await putAudio(session.id, env)).status).toBe(200);
    const before = await recordingState(session.id);

    const relay = await worker.fetch(new Request('http://localhost/pipeline/jobs/' + session.id + '/audio'), env);
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
    const env = localEnv();
    const { session } = await makeInPersonSession(true);
    expect((await putAudio(session.id, env)).status).toBe(200);

    const before = await recordingState(session.id);
    const relay = await worker.fetch(new Request('http://localhost/pipeline/jobs/' + session.id + '/audio', { headers: counselorHeaders }), env);
    await expectDeniedAudioRequest(relay, session.id, { status: 403, body: { error: 'forbidden' } }, 1, before);
  });
  it('rejects a same-org admin from the service-only audio relay without a download audit or recording mutation', async () => {
    await t.reset();
    const env = localEnv();
    const { session } = await makeInPersonSession(true);
    expect((await putAudio(session.id, env)).status).toBe(200);
    const before = await recordingState(session.id);

    const relay = await worker.fetch(new Request('http://localhost/pipeline/jobs/' + session.id + '/audio', {
      headers: adminHeaders,
    }), env);
    await expectDeniedAudioRequest(relay, session.id, { status: 403, body: { error: 'forbidden' } }, 1, before);
  });
  it('rejects a cross-org service relay without a download audit or recording mutation', async () => {
    await t.reset();
    const env = localEnv();
    const { session } = await makeInPersonSession(true);
    expect((await putAudio(session.id, env)).status).toBe(200);
    const before = await recordingState(session.id);

    const relay = await worker.fetch(new Request('http://localhost/pipeline/jobs/' + session.id + '/audio', {
      headers: otherOrgServiceHeaders,
    }), env);
    await expectDeniedAudioRequest(relay, session.id, { status: 403, body: { error: 'forbidden' } }, 1, before);
  });

  it('returns 404 when the registered audio object is missing from R2', async () => {
    await t.reset();
    const env = localEnv();
    const { session } = await makeInPersonSession(true);
    // /recording은 D1 키만 등록하고 R2에는 아무것도 올리지 않는다.
    await registerRecording(t.env, counselor, session.id, 'audio/missing/object-key');

    const relay = await worker.fetch(new Request('http://localhost/pipeline/jobs/' + session.id + '/audio', { headers: serviceHeaders }), env);
    expect(relay.status).toBe(404);
    await expect(relay.json()).resolves.toEqual({ error: 'audio_object_missing', jobId: session.id });
  });
});
