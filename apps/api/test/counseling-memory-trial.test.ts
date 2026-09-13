import { beforeEach, describe, expect, it } from 'vitest';
import { createBeneficiaryWithInitialSupportCase, type Actor } from '@ccc/core/gateway';
import worker from './support/local-worker';
import { setupD1, testActors, testProgramId } from './support/d1';
import { seedNerQualification } from './support/agent-jobs';
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

describe('memory real-trial control', () => {
  it('reports an expired qualification from a recently seen Agent as a blocker', async () => {
    const id = await supportCase();
    const qualification = await seedNerQualification(t.db, { expiresAt: new Date(Date.now() - 60000).toISOString() });
    await t.db.prepare(`INSERT INTO counseling_memory_agents(org_id,actor_id,attestation_json,receipt_id,seen_at)
      VALUES(?,?,?,?,?)`).bind(testActors.service.orgId, testActors.service.userId,
      JSON.stringify(qualification.attestation), qualification.receiptId, new Date().toISOString()).run();
    const env = { ...t.env, LOCAL_ACTOR_HEADER_MODE: 'true' };
    const response = await worker.fetch(request(id, testActors.admin), env);
    expect(response.status).toBe(200);
    const state = await response.json();
    expect(state).toMatchObject({ ready: false, blockers: expect.arrayContaining(['local_ner_unavailable']) });
    const step = await worker.fetch(request(id, testActors.admin, 'POST', { confirmExternalAi: true }), env);
    expect(step.status).toBe(409);
    expect(await step.json()).toEqual(state);
  }, 30_000);
  it('reports missing prerequisites without returning memory prose or changing generation', async () => {
    const id = await supportCase();
    const response = await worker.fetch(request(id, testActors.admin), { ...t.env, LOCAL_ACTOR_HEADER_MODE: 'true' });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const state = await response.json() as { blockers: string[]; ready: boolean; generation: number; revision: number };
    expect(state.ready).toBe(false);
    expect(state.blockers).toContain('memory_disabled');
    expect(state.blockers).toContain('agent_unavailable');
    expect(state.blockers).toContain('masking_pipeline_version_mismatch');
    expect(state).not.toHaveProperty('items');
    expect(state).not.toHaveProperty('summary');
    const again = await worker.fetch(request(id, testActors.admin), { ...t.env, LOCAL_ACTOR_HEADER_MODE: 'true' });
    expect(await again.json()).toEqual(state);
  }, 30_000);

  it('keeps the trial control unavailable in production even with a local flag', async () => {
    const id = await supportCase();
    const response = await worker.fetch(request(id, testActors.admin), {
      ...t.env, LOCAL_ACTOR_HEADER_MODE: 'true', ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com', ACCESS_AUD: 'production-audience',
    });
    expect(response.status).toBe(404);
  }, 30_000);

  it('denies non-administrators and administrators from another institution', async () => {
    const id = await supportCase();
    const env = { ...t.env, LOCAL_ACTOR_HEADER_MODE: 'true' };
    expect((await worker.fetch(request(id, testActors.counselor), env)).status).toBe(403);
    expect((await worker.fetch(request(id, testActors.otherOrgAdmin), env)).status).toBe(403);
  }, 30_000);

  it('requires explicit external-call confirmation and rejects control-field injection', async () => {
    const id = await supportCase();
    const env = { ...t.env, LOCAL_ACTOR_HEADER_MODE: 'true' };
    expect((await worker.fetch(request(id, testActors.admin, 'POST', { confirmExternalAi: false }), env)).status).toBe(400);
    expect((await worker.fetch(request(id, testActors.admin, 'POST', { confirmExternalAi: true, bypassMasking: true }), env)).status).toBe(400);
  }, 30_000);

  it('does not enable settings or fabricate missing qualification when a trial is requested', async () => {
    const id = await supportCase();
    const env = { ...t.env, LOCAL_ACTOR_HEADER_MODE: 'true' };
    const before = await worker.fetch(request(id, testActors.admin), env);
    const response = await worker.fetch(request(id, testActors.admin, 'POST', { confirmExternalAi: true }), env);
    expect(response.status).toBe(409);
    const state = await response.json();
    expect(state).toEqual(await before.json());
    const after = await worker.fetch(request(id, testActors.admin), env);
    expect(await after.json()).toEqual(state);
  }, 30_000);
});
