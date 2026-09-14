import { beforeEach, describe, expect, it } from 'vitest';
import { createBeneficiaryWithInitialSupportCase, type Actor } from '@ccc/core/gateway';
import worker from './support/local-worker';
import { setupD1, testActors, testProgramId } from './support/d1';
import { registrationInput } from './support/registration';

const t = setupD1();
/** 옛 `recordingAi: false` 와 같은 뜻 — 녹음·STT·국외·보유기간을 등록에서 거절한다. */
const DECLINED_AI_DOMAINS = {
  counseling_recording: 'decline',
  external_stt_processing: 'decline',
  external_llm_cross_border_processing: 'decline',
  voice_original_retention_period: 'decline',
} as const;
beforeEach(async () => { await t.reset(); });
async function supportCase() {
  // 옛 4번째 인자(privacy/recordingAi)는 없다 — 결정은 등록 6종 동의 이벤트로만 들어간다.
  const created = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor,
    await registrationInput(
      t.env,
      testActors.counselor,
      { programId: testProgramId(testActors.counselor.orgId), intakeAt: '2026-09-01T09:00:00.000Z' },
      DECLINED_AI_DOMAINS,
    ));
  return created.supportCaseId;
}
function request(id: string, actor: Actor, method = 'GET', body?: unknown) {
  return new Request(`http://localhost/support-cases/${id}/memory/trial`, {
    method, headers: { 'content-type': 'application/json', 'X-CCC-User-Id': actor.userId,
      'X-CCC-Org-Id': actor.orgId, 'X-CCC-Role': actor.role },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('memory real-trial release boundary', () => {
  it('keeps GET and POST hidden in preview, local header mode, and production', async () => {
    const id = await supportCase();
    const before = await t.db.prepare(
      'SELECT generation,status,reason FROM counseling_memory_cases WHERE support_case_id=?',
    ).bind(id).first();
    const environments = [
      { ...t.env },
      { ...t.env, LOCAL_ACTOR_HEADER_MODE: 'true' },
      {
        ...t.env,
        LOCAL_ACTOR_HEADER_MODE: 'true',
        ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
        ACCESS_AUD: 'production-audience',
      },
    ];
    for (const env of environments) {
      expect((await worker.fetch(request(id, testActors.admin), env)).status).toBe(404);
      expect((await worker.fetch(request(
        id,
        testActors.admin,
        'POST',
        { confirmExternalAi: true },
      ), env)).status).toBe(404);
    }
    expect(await t.db.prepare(
      'SELECT generation,status,reason FROM counseling_memory_cases WHERE support_case_id=?',
    ).bind(id).first()).toEqual(before);
  }, 30_000);
});
