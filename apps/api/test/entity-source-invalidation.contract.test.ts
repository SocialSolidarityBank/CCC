import { beforeEach, describe, expect, it } from 'vitest';
import {
  claimAgentJobs, createCase, createCounselingRecord, enqueueTextWorkItem,
  getAgentJobSource, listSupportCasesForBeneficiary, registerCaseEntities,
} from '@ccc/core/gateway';
import { setupD1, testActors, testProgramId, seedTestProgramWithRuntimeModes } from './support/d1';
import { registrationInput } from './support/registration';
import { claimRequest, seedCanonicalSttConsent, seedNerQualification, TEXT_ONLY_RUNTIME } from './support/agent-jobs';

const t = setupD1();
const { counselor, service } = testActors;
beforeEach(async () => { await t.reset(); });


async function fixture() {
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, { sttMode: 'off', llmMode: 'openai' });
  t.env.CCC_STT_MODE = 'off';
  t.env.CCC_LLM_MODE = 'openai';
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  const created = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));
  const supportCaseId = (await listSupportCasesForBeneficiary(t.env, counselor, created.id)).programs[0]!.supportCase.id;
  await seedCanonicalSttConsent(t.env, counselor, supportCaseId);
  const record = await createCounselingRecord(t.env, counselor, supportCaseId, {
    schemaVersion: 2, submissionId: crypto.randomUUID(), heldAt: '2026-09-01T00:00:00.000Z',
    channel: 'in_person', memo: '원본 수기 내용', gasScores: [], actionItems: [], flags: [],
  });
  const sessionId = record.record.id;
  await enqueueTextWorkItem(t.env, counselor, sessionId, 'manual_record');
  const qualification = await seedNerQualification(t.db, { orgId: service.orgId });
  const job = (await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(qualification))).jobs[0]!;
  const source = await getAgentJobSource(t.env, service, job.jobId, job.claimToken, job.attempt);
  return { sessionId, supportCaseId, job, source, qualification };
}

describe('entity source invalidation', () => {
  it('closes the old generic claim without consuming its attempt and creates one current successor', async () => {
    const f = await fixture();
    await t.db.prepare('UPDATE sessions SET memo=? WHERE id=?').bind('수정된 원본 수기', f.sessionId).run();
    await expect(getAgentJobSource(t.env, service, f.job.jobId, f.job.claimToken, f.job.attempt)).rejects.toMatchObject({ code: 'stale_claim' });
    const jobs = await t.db.prepare(
      'SELECT state,attempt,source_generation,terminal_failure_code FROM agent_jobs WHERE session_id=? ORDER BY enqueued_at,id',
    ).bind(f.sessionId).all();
    expect(jobs.results.filter((row) => row.state === 'failed')).toHaveLength(1);
    expect(jobs.results.find((row) => row.state === 'failed')).toMatchObject({ attempt: f.job.attempt, terminal_failure_code: 'stale_claim' });
    expect(jobs.results.filter((row) => row.state === 'pending')).toHaveLength(1);
    expect(jobs.results.find((row) => row.state === 'pending')).toMatchObject({ attempt: 0 });
  });

  it('invalidates a held-at date change and an institution timezone change through generation', async () => {
    const f = await fixture();
    const before = await t.db.prepare('SELECT generation FROM counseling_memory_cases WHERE support_case_id=?').bind(f.supportCaseId).first<{ generation: number }>();
    await t.db.prepare('UPDATE sessions SET held_at=? WHERE id=?').bind('2026-09-02T00:00:00.000Z', f.sessionId).run();
    const afterHeldAt = await t.db.prepare('SELECT generation FROM counseling_memory_cases WHERE support_case_id=?').bind(f.supportCaseId).first<{ generation: number }>();
    expect(afterHeldAt!.generation).toBe(before!.generation + 1);
    await t.db.prepare('UPDATE organization_settings SET time_zone=? WHERE org_id=?').bind('Pacific/Honolulu', counselor.orgId).run();
    const afterZone = await t.db.prepare('SELECT generation FROM counseling_memory_cases WHERE support_case_id=?').bind(f.supportCaseId).first<{ generation: number }>();
    expect(afterZone!.generation).toBe(afterHeldAt!.generation + 1);
    await expect(getAgentJobSource(t.env, service, f.job.jobId, f.job.claimToken, f.job.attempt)).rejects.toMatchObject({ code: 'stale_claim' });
    const successor = (await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(f.qualification))).jobs[0]!;
    const source = await getAgentJobSource(t.env, service, successor.jobId, successor.claimToken, successor.attempt);
    expect(source.sources[0]!.consultationDate).toBe('2026-09-01');
    expect(source.sources[0]!.dateRevision).not.toBe(f.source.sources[0]!.dateRevision);
  });

  it('keeps a correctly rebound generic registration lease and its running queue item on map change', async () => {
    const f = await fixture();
    await t.db.prepare("UPDATE ai_text_work_queue SET status='processing',lease_owner=?,lease_expires_at=? WHERE session_id=?")
      .bind(service.userId,f.job.leaseExpiresAt,f.sessionId).run();
    const start = f.source.text.indexOf('원본');
    await registerCaseEntities(t.env, service, {
      family: 'generic', jobId: f.job.jobId, claimToken: f.job.claimToken, attempt: f.job.attempt,
      sourceBundleRevision: f.source.sourceBundleRevision, expectedMapRevision: f.source.expectedMapRevision,
      entries: [{ kind: 'person', sourceValue: '원본', entityReference: null,
        occurrences: [{ sourceId: f.sessionId, sourceRevision: f.source.sourceRevision, start, end: start + 2 }] }],
    });
    expect(await t.db.prepare('SELECT entity_map_lease_family,entity_map_lease_job_id FROM support_cases WHERE id=?').bind(f.supportCaseId).first())
      .toEqual({ entity_map_lease_family: 'generic', entity_map_lease_job_id: f.job.jobId });
    expect(await t.db.prepare('SELECT state FROM agent_jobs WHERE id=?').bind(f.job.jobId).first()).toEqual({ state: 'leased' });
    expect(await t.db.prepare('SELECT status FROM ai_text_work_queue WHERE session_id=?').bind(f.sessionId).first()).toEqual({ status: 'processing' });
  });

  it('keeps only one claimable successor after repeated map changes with historical failures', async () => {
    const f = await fixture();
    await t.db.prepare("UPDATE support_cases SET enc_entity_map='ciphertext',entity_map_revision=1,entity_map_key_version=1 WHERE id=?").bind(f.supportCaseId).run();
    await t.db.prepare("UPDATE support_cases SET enc_entity_map='ciphertext-2',entity_map_revision=2 WHERE id=?").bind(f.supportCaseId).run();
    const rows = (await t.db.prepare('SELECT state,attempt FROM agent_jobs WHERE session_id=?').bind(f.sessionId).all()).results;
    expect(rows.filter(row => row.state === 'failed')).toHaveLength(2);
    expect(rows.filter(row => row.state === 'pending')).toEqual([{ state: 'pending', attempt: 0 }]);
    await expect(getAgentJobSource(t.env, service, f.job.jobId, f.job.claimToken, f.job.attempt)).rejects.toMatchObject({ code: 'stale_claim' });
    const successor = (await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(f.qualification))).jobs[0]!;
    const source = await getAgentJobSource(t.env, service, successor.jobId, successor.claimToken, successor.attempt);
    expect(source.expectedMapRevision).toBe(2);
  });

  it('rolls back invalidation and successor insertion when its source transaction fails', async () => {
    const f = await fixture();
    await expect(t.db.batch([
      t.db.prepare('UPDATE sessions SET memo=? WHERE id=?').bind('커밋되지 않는 원본', f.sessionId),
      t.db.prepare('INSERT INTO counseling_memory_guards(id,org_id,ok) VALUES(?,?,0)').bind('rollback-guard', counselor.orgId),
    ])).rejects.toThrow();
    await expect(getAgentJobSource(t.env, service, f.job.jobId, f.job.claimToken, f.job.attempt)).resolves.toMatchObject({
      text: f.source.text, sourceBundleRevision: f.source.sourceBundleRevision,
    });
    expect((await t.db.prepare('SELECT state FROM agent_jobs WHERE session_id=?').bind(f.sessionId).all()).results)
      .toEqual([{ state: 'leased' }]);
  });

});
