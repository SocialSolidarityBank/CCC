import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  claimAgentJobs, claimCounselingMemorySources, createActionItem, createCase,
  createCounselingRecord, enqueueTextWorkItem, getAgentJobSource,
  getCounselingMemorySource, listSupportCasesForBeneficiary,
  prepareCounselingMemoryWork, registerCaseEntities, verifyAgentJobAudio,
} from '@ccc/core/gateway';
import type { EntityRegistrationRequest } from '@ccc/contracts/entity-registration';
import { setupD1, seedTestProgramWithRuntimeModes, testActors, testProgramId } from './support/d1';
import { registrationInput } from './support/registration';
import { claimRequest, seedCanonicalSttConsent, seedNerQualification, sha256Hex, TEXT_ONLY_RUNTIME, LOCAL_SINGLE_RUNTIME, registerFixtureRecording } from './support/agent-jobs';

const t = setupD1();
const { counselor, service } = testActors;
const heldAt = '2026-09-01T15:30:00.000Z';
beforeEach(async () => { await t.reset(); });

async function fixture(memo = '가상타인과 상담했습니다.', sttMode: 'off' | 'local' = 'off') {
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, { sttMode, llmMode: 'openai' });
  t.env.CCC_STT_MODE = sttMode;
  t.env.CCC_LLM_MODE = 'openai';
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  t.env.MEMORY_MASKING_PIPELINES = JSON.stringify({ 'ner-mask-v1-addr-cond-dict': 'd'.repeat(64) });
  const participant = await createCase(t.env, counselor, await registrationInput(t.env, counselor, {
    programId: testProgramId(counselor.orgId), name: '가상본인',
  }));
  const supportCaseId = (await listSupportCasesForBeneficiary(t.env, counselor, participant.id)).programs[0]!.supportCase.id;
  await seedCanonicalSttConsent(t.env, counselor, supportCaseId);
  await t.db.prepare('UPDATE organization_settings SET time_zone=? WHERE org_id=?').bind('Asia/Seoul', counselor.orgId).run();
  const { record } = await createCounselingRecord(t.env, counselor, supportCaseId, {
    schemaVersion: 2, submissionId: crypto.randomUUID(), heldAt, channel: 'in_person',
    memo, gasScores: [], actionItems: [], flags: [],
  });
  const qualification = await seedNerQualification(t.db, { orgId: service.orgId });
  return { supportCaseId, sessionId: record.id, qualification };
}

async function prepareMemory() {
  await t.db.prepare("UPDATE counseling_memory_cases SET not_before='2000-01-01T00:00:00.000Z'").run();
  await prepareCounselingMemoryWork(t.env);
}

describe('F3 source dates and delivered memory coordinates', () => {
  it('uses the institution calendar date and revises an unchanged calendar day when its time changes', async () => {
    const f = await fixture();
    await enqueueTextWorkItem(t.env, counselor, f.sessionId, 'manual_record');
    const job = (await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(f.qualification))).jobs[0]!;
    const source = await getAgentJobSource(t.env, service, job.jobId, job.claimToken, job.attempt);
    expect(source.sources[0]!.consultationDate).toBe('2026-09-02');
    await t.db.prepare('UPDATE sessions SET held_at=? WHERE id=?').bind('2026-09-01T16:30:00.000Z', f.sessionId).run();
    await expect(getAgentJobSource(t.env, service, job.jobId, job.claimToken, job.attempt)).rejects.toMatchObject({ code: 'stale_claim' });
    const successor = (await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(f.qualification))).jobs[0]!;
    const revised = await getAgentJobSource(t.env, service, successor.jobId, successor.claimToken, successor.attempt);
    expect(revised.sources[0]!.consultationDate).toBe('2026-09-02');
    expect(revised.sources[0]!.dateRevision).not.toBe(source.sources[0]!.dateRevision);
    expect(revised.sourceBundleRevision).not.toBe(source.sourceBundleRevision);
  });

  it('accepts real Python Agent witnesses over a nonzero raw chunk after length-changing PII replacement', async () => {
    const f = await fixture('앞'.repeat(23960) + '𠀀 가상본인 뒤의 가상타인 기록');
    await prepareMemory();
    // A historical material timestamp is not authoritative consultation ancestry.
    await t.db.prepare("UPDATE counseling_memory_materials SET occurred_at='2001-01-01T00:00:00.000Z' WHERE support_case_id=? AND start_offset>0")
      .bind(f.supportCaseId).run();
    const job = (await claimCounselingMemorySources(t.env, service, claimRequest(f.qualification)))[0]!;
    expect(job.sourceStart).toBe(24000);
    const source = await getCounselingMemorySource(t.env, service, job.jobId, job.claimToken, job.attempt);
    expect(source.sessionId).toBe(f.sessionId);
    expect(source.text).toContain(`${f.supportCaseId} 뒤의 가상타인`);
    expect(source.text).not.toContain('가상본인');
    expect(source.sourceLength).toBe([...source.text].length);
    expect(source.sourceLength).not.toBe(job.sourceEnd - job.sourceStart);
    expect(source.sourceSha256).toBe(await sha256Hex(source.text));
    expect(source.sources).toEqual([expect.objectContaining({
      sourceId: f.sessionId, start: 0, end: [...source.text].length,
      sha256: source.sourceSha256, consultationDate: '2026-09-02',
    })]);
    const body: EntityRegistrationRequest = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
from types import SimpleNamespace
from ccc_pipeline.worker import _build_entity_registration_request
payload = json.load(sys.stdin)
text = payload['source']['text']
value = '가상타인'
def spans(delivered):
    start = delivered.index(value)
    return [(start, start + len(value))]
print(json.dumps(_build_entity_registration_request(payload['job'], text, payload['source'], SimpleNamespace(person_ner=spans))))
`], { cwd: fileURLToPath(new URL('../../pipeline/', import.meta.url)), input: JSON.stringify({ job, source }), encoding: 'utf8' }));
    const witness = body.entries[0]!.occurrences[0]!;
    expect([...source.text].slice(witness.start, witness.end).join('')).toBe('가상타인');
    expect(witness.start).toBeLessThan(source.text.indexOf('가상타인'));
    await expect(registerCaseEntities(t.env, service, body)).resolves.toMatchObject({
      outcome: 'applied', entries: [{ number: 1, reason: null }],
    });
    // Registration advances its own binding without superseding its memory lease.
    await expect(getCounselingMemorySource(t.env, service, job.jobId, job.claimToken, job.attempt))
      .resolves.toMatchObject({ text: source.text, sourceBundleRevision: source.sourceBundleRevision, expectedMapRevision: 1 });
    await expect(registerCaseEntities(t.env, service, body)).resolves.toMatchObject({ outcome: 'applied', entries: [{ number: 1 }] });
  });

  it('binds the original audio date and hash only after verified processing begins', async () => {
    const f = await fixture(undefined, 'local');
    const audio = await registerFixtureRecording(t.env, counselor, service, f.sessionId, LOCAL_SINGLE_RUNTIME);
    const job = (await claimAgentJobs(t.env, service, LOCAL_SINGLE_RUNTIME, claimRequest(f.qualification))).jobs.find(item => item.kind === 'audio')!;
    await expect(getAgentJobSource(t.env, service, job.jobId, job.claimToken, job.attempt)).rejects.toMatchObject({ code: 'stale_claim' });
    await verifyAgentJobAudio(t.env, service, job.jobId, {
      claimToken: job.claimToken, attempt: job.attempt,
      generationId: audio.generationId, agentComputedSha256: audio.sha256,
    });
    const source = await getAgentJobSource(t.env, service, job.jobId, job.claimToken, job.attempt);
    expect(source.audio).toEqual({ generationId: audio.generationId, rawSha256: audio.sha256 });
    expect(source.sources).toEqual([expect.objectContaining({
      sourceId: f.sessionId, sourceRevision: audio.generationId, consultationDate: '2026-09-02', sha256: audio.sha256,
    })]);
  });

  it.each(['source', 'date', 'map'] as const)('revokes the old memory token and reopens its queue on %s change', async change => {
    const f = await fixture();
    await prepareMemory();
    const job = (await claimCounselingMemorySources(t.env, service, claimRequest(f.qualification)))[0]!;
    await getCounselingMemorySource(t.env, service, job.jobId, job.claimToken, job.attempt);
    if (change === 'source') {
      await t.db.prepare('UPDATE sessions SET memo=? WHERE id=?').bind('바뀐 원본 기록', f.sessionId).run();
    } else if (change === 'date') {
      await t.db.prepare('UPDATE sessions SET held_at=? WHERE id=?').bind('2026-09-02T16:00:00.000Z', f.sessionId).run();
    } else {
      await t.db.prepare("UPDATE support_cases SET enc_entity_map='ciphertext',entity_map_revision=1,entity_map_key_version=1 WHERE id=?").bind(f.supportCaseId).run();
    }
    await expect(getCounselingMemorySource(t.env, service, job.jobId, job.claimToken, job.attempt)).rejects.toMatchObject({ code: 'stale_claim' });
    await prepareMemory();
    const successor = (await claimCounselingMemorySources(t.env, service, claimRequest(f.qualification)))[0]!;
    expect(successor.claimToken).not.toBe(job.claimToken);
    expect(successor.attempt).toBe(1);
    const source = await getCounselingMemorySource(t.env, service, successor.jobId, successor.claimToken, successor.attempt);
    expect(source.sources[0]!.consultationDate).toBe(change === 'date' ? '2026-09-03' : '2026-09-02');
    if (change === 'source') expect(source.text).toContain('바뀐 원본 기록');
    if (change === 'map') expect(source.expectedMapRevision).toBe(1);
  });

  it.each(['generic', 'memory'] as const)('requeues an explicitly superseded %s registration without exhausting attempts', async family => {
    const f = await fixture();
    if (family === 'generic') await enqueueTextWorkItem(t.env, counselor, f.sessionId, 'manual_record');
    else await prepareMemory();
    const jobs = family === 'generic'
      ? (await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(f.qualification))).jobs
      : await claimCounselingMemorySources(t.env, service, claimRequest(f.qualification));
    const job = jobs[0]!;
    const source = family === 'generic'
      ? await getAgentJobSource(t.env, service, job.jobId, job.claimToken, job.attempt)
      : await getCounselingMemorySource(t.env, service, job.jobId, job.claimToken, job.attempt);
    const start = source.text.indexOf('가상타인');
    await expect(registerCaseEntities(t.env, service, {
      family, jobId: job.jobId, claimToken: job.claimToken, attempt: job.attempt,
      sourceBundleRevision: source.sourceBundleRevision, expectedMapRevision: 99,
      entries: [{ kind: 'person', sourceValue: '가상타인', entityReference: null,
        occurrences: [{ sourceId: f.sessionId, sourceRevision: source.sourceRevision, start, end: start + 4 }] }],
    })).resolves.toEqual({ outcome: 'superseded' });
    if (family === 'memory') await prepareMemory();
    const successors = family === 'generic'
      ? (await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(f.qualification))).jobs
      : await claimCounselingMemorySources(t.env, service, claimRequest(f.qualification));
    expect(successors).toHaveLength(1);
    expect(successors[0]!.jobId).not.toBe(job.jobId);
    expect(successors[0]!.attempt).toBe(1);
  });

  it('does not invent a consultation date for an action without original-session ancestry', async () => {
    const f = await fixture();
    const action = await createActionItem(t.env, counselor, f.supportCaseId, { description: '가상타인에게 확인', owner: 'beneficiary' });
    await prepareMemory();
    await t.db.prepare("UPDATE counseling_memory_materials SET occurred_at='2001-01-01T00:00:00.000Z' WHERE source_id=?").bind(action.id).run();
    const job = (await claimCounselingMemorySources(t.env, service, claimRequest(f.qualification)))[0]!;
    expect(job.sourceId).toBe(action.id);
    const source = await getCounselingMemorySource(t.env, service, job.jobId, job.claimToken, job.attempt);
    expect(source.text).toContain('가상타인에게 확인');
    expect(source.sessionId).toBeNull();
    expect(source.sources).toEqual([]);
  });
});
