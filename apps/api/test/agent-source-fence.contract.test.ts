import { beforeEach, describe, expect, it } from 'vitest';
import { handleRequest } from '@ccc/http-api';
import { claimAgentJobs, createCase, createCounselingRecord, enqueueTextWorkItem,
  getAgentJobSource, listSupportCasesForBeneficiary, type Actor,
  activateAiProviderConfiguration, registerAiProviderConfiguration, getActiveAiProviderRuntimeMetadataForService,
  createGeneratedAiDraft, reviewGeneratedAiDraft, loadMaskedSourceSnapshotForService,
} from '@ccc/core/gateway';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import { setupD1, testActors, testProgramId, seedTestProgramWithRuntimeModes } from './support/d1';
import { registrationInput } from './support/registration';
import { agentResultRequest, claimRequest, seedCanonicalSttConsent, seedNerQualification,
  sha256Hex, TEXT_ONLY_RUNTIME } from './support/agent-jobs';

const t = setupD1();
const { counselor, service, otherOrgAdmin } = testActors;
beforeEach(async () => { await t.reset(); });

function http(actor: Actor, path: string, body?: unknown) {
  return handleRequest(new Request(`http://localhost${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), t.env, async () => actor);
}
async function fixture() {
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, { sttMode: 'off', llmMode: 'openai' });
  t.env.CCC_STT_MODE = 'off'; t.env.CCC_LLM_MODE = 'openai'; t.env.TEXT_AI_PILOT_ENABLED = '1';
  t.env.MEMORY_MASKING_PIPELINES = JSON.stringify({ 'ner-mask-v1-addr-cond-dict': 'd'.repeat(64) });
  const created = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));
  const supportCaseId = (await listSupportCasesForBeneficiary(t.env, counselor, created.id)).programs[0]!.supportCase.id;
  await seedCanonicalSttConsent(t.env, counselor, supportCaseId);
  const record = await createCounselingRecord(t.env, counselor, supportCaseId, {
    schemaVersion: 2, submissionId: crypto.randomUUID(), heldAt: '2026-09-01T00:00:00.000Z',
    channel: 'in_person', memo: '첫 부분 𠀀 나머지 공식 수기 내용', gasScores: [], actionItems: [], flags: [],
  });
  const sessionId = record.record.id;
  await enqueueTextWorkItem(t.env, counselor, sessionId, 'manual_record');
  const qualification = await seedNerQualification(t.db, { orgId: service.orgId });
  const job = (await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(qualification))).jobs[0]!;
  const source = await getAgentJobSource(t.env, service, job.jobId, job.claimToken, job.attempt);
  expect(source.sourceRevision).toEqual(expect.any(String));
  expect(source.sourceLength).toBe([...source.text].length);
  const request = async (end = [...source.text].length) => {
    const base = await agentResultRequest({ kind: 'text', claimToken: job.claimToken, attempt: job.attempt,
      qualification, maskedText: '마스킹을 마친 합성 내용' });
    const result = { ...base.result, checkedSource: {
      sourceRevision: source.sourceRevision, sourceSha256: source.sourceSha256, sourceStart: 0, sourceEnd: end,
    } };
    return { ...base, result, payloadSha256: await sha256Hex(canonicalizeJcs({ schemaVersion: 2, attempt: job.attempt, result })) };
  };
  return { sessionId, supportCaseId, qualification, job, source, request };
}
async function status(sessionId: string) {
  const response = await http(counselor, `/sessions/${sessionId}/processing`);
  expect(response.status).toBe(200);
  return response.json();
}

describe('generic text source fence', () => {
  it('rejects a result from a changed leased source and permits explicit regeneration', async () => {
    const f = await fixture();
    const request = await f.request();
    await t.db.prepare('UPDATE sessions SET memo=? WHERE id=?').bind('수정된 공식 수기 내용', f.sessionId).run();
    await enqueueTextWorkItem(t.env, counselor, f.sessionId, 'manual_record');
    const rejected = await http(service, `/pipeline/jobs/${f.job.jobId}/result`, request);
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ error: 'stale_claim' });
    expect(await status(f.sessionId)).toMatchObject({ state: 'pending', sourceChanged: false, checkedRange: null });
    expect(await t.db.prepare('SELECT COUNT(*) AS count FROM ai_masked_source_snapshots WHERE session_id=?').bind(f.sessionId).first()).toEqual({ count: 0 });
    expect((await http(counselor, `/sessions/${f.sessionId}/processing`, {})).status).toBe(202);
    const fresh = (await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(f.qualification))).jobs[0]!;
    expect(fresh.jobId).not.toBe(f.job.jobId);
    const next = await getAgentJobSource(t.env, service, fresh.jobId, fresh.claimToken, fresh.attempt);
    expect(next.sourceRevision).not.toBe(f.source.sourceRevision);
    expect(next.sourceSha256).not.toBe(f.source.sourceSha256);
    expect(next.text).toContain('수정된 공식 수기 내용');
  });

  it('reports actual checked code-point range as partial, then exposes later staleness', async () => {
    const f = await fixture();
    expect(f.source.sourceSha256).toBe(await sha256Hex(f.source.text));
    expect(f.source.sourceLength).toBe([...f.source.text].length);
    const accepted = await http(service, `/pipeline/jobs/${f.job.jobId}/result`, await f.request(7));
    expect(accepted.status).toBe(204);
    expect(await status(f.sessionId)).toMatchObject({ state: 'partial', sourceRevision: f.source.sourceRevision,
      sourceChanged: false, sourceLength: f.source.sourceLength, checkedRange: { start: 0, end: 7 } });
    await t.db.prepare('UPDATE support_cases SET overall_goal=? WHERE id=?').bind('바뀐 전체 목표', f.supportCaseId).run();
    expect(await status(f.sessionId)).toMatchObject({ state: 'stale', sourceChanged: true, checkedRange: { start: 0, end: 7 } });
    expect((await http(otherOrgAdmin, `/sessions/${f.sessionId}/processing`)).status).toBe(403);
    expect((await http(otherOrgAdmin, `/sessions/${f.sessionId}/processing`, {})).status).toBe(403);
  });

  it('does not treat out-of-bounds checked coverage as a successful inspection', async () => {
    const f = await fixture();
    const rejected = await http(service, `/pipeline/jobs/${f.job.jobId}/result`, await f.request(f.source.sourceLength + 1));
    expect(rejected.status).toBe(422);
    expect(await status(f.sessionId)).toMatchObject({ state: 'failed', checkedRange: null });
  });

  it('rejects a formerly valid draft at approval after its source changes', async () => {
    const f = await fixture();
    const config = await registerAiProviderConfiguration(t.env, testActors.admin, {
      adapterId: 'codex', adapterVersion: 'v1', configHash: 'b'.repeat(64), approvalRefs: ['synthetic-source-fence-proof'],
    });
    await activateAiProviderConfiguration(t.env, testActors.admin, config.id);
    expect((await http(service, `/pipeline/jobs/${f.job.jobId}/result`, await f.request())).status).toBe(204);
    const row = await t.db.prepare('SELECT completed_snapshot_id AS id FROM ai_text_work_queue WHERE session_id=?')
      .bind(f.sessionId).first<{ id: string }>();
    const source = await loadMaskedSourceSnapshotForService(t.env, service, f.sessionId, row!.id);
    const selection = await getActiveAiProviderRuntimeMetadataForService(t.env, service, f.sessionId);
    const quote = source.evidence[0]!;
    const draft = await createGeneratedAiDraft(t.env, service, f.sessionId, {
      summaryText: '합성 기록 요약', oneLiner: '합성 기록 한 줄',
      claims: [{ claimKey: 'source-proof', section: 'other_topics', text: '합성 기록 요약' }],
      questions: [
        { title: '합성 기록에 변화가 있나요?', reason: '이전 합성 기록을 확인합니다.' },
        { title: '다음 확인은 언제 하나요?', reason: '합성 일정 근거를 확인합니다.' },
      ], flagSuggestions: [],
      sourceSnapshotId: source.id, sourceSnapshotHash: source.sha256,
      materials: [{ kind: 'text_context', snapshotId: source.id, snapshotSha256: source.sha256 }],
      contrast: [
        { axis: 'missing_from_memo', status: 'no_transcript', findings: [] },
        { axis: 'missing_from_transcript', status: 'no_transcript', findings: [] },
        { axis: 'undiscussed_session_goal', status: 'no_session_goal', findings: [] },
      ],
      providerConfigId: selection.providerConfigId, consentEvidenceId: selection.consentEvidenceId,
      consentRevision: selection.consentRevision, consentReceipt: selection.consentReceipt,
      modelId: 'gpt-5-codex', promptVersion: 'prompt-v1', schemaVersion: 'schema-v1',
      evidence: ['source-proof', 'question_1', 'question_2'].map((claimKey) => ({
        claimKey, sourceEvidenceItemId: quote.id, sourceRef: quote.sourceRef, evidenceQuote: quote.evidenceQuote,
        sourceStart: quote.sourceStart, sourceEnd: quote.sourceEnd,
      })),
    });
    await t.db.prepare('UPDATE support_cases SET overall_goal=? WHERE id=?').bind('새 공식 목표', f.supportCaseId).run();
    await expect(reviewGeneratedAiDraft(t.env, counselor, draft.workItemId, {
      expectedVersion: draft.version, decision: 'approved',
    })).rejects.toMatchObject({ code: 'stale_draft_version' });
    expect(await t.db.prepare('SELECT approved_at FROM sessions WHERE id=?').bind(f.sessionId).first()).toEqual({ approved_at: null });
    await expect(loadMaskedSourceSnapshotForService(t.env, service, f.sessionId, source.id)).rejects.toThrow();
  });

  it('requires explicit coverage rather than treating absent metadata as a complete check', async () => {
    const f = await fixture();
    const request = await agentResultRequest({ kind: 'text', claimToken: f.job.claimToken, attempt: f.job.attempt,
      qualification: f.qualification, maskedText: '합성 가림 결과' });
    expect((await http(service, `/pipeline/jobs/${f.job.jobId}/result`, request)).status).toBe(422);
    expect(await status(f.sessionId)).toMatchObject({ state: 'failed', checkedRange: null });
  });

  it('persists an immutable source binding and serializes one map consumer per case', async () => {
    const f = await fixture();
    const binding = await t.db.prepare(
      'SELECT entity_map_lease_family,entity_map_lease_job_id,entity_map_lease_attempt,entity_source_binding FROM support_cases JOIN agent_jobs ON agent_jobs.id=entity_map_lease_job_id WHERE support_cases.id=?',
    ).bind(f.supportCaseId).first<{ entity_map_lease_family: string; entity_map_lease_job_id: string; entity_map_lease_attempt: number; entity_source_binding: string | null }>();
    expect(binding?.entity_map_lease_family).toBe('generic');
    expect(binding?.entity_map_lease_job_id).toBe(f.job.jobId);
    expect(binding?.entity_map_lease_attempt).toBe(f.job.attempt);
    expect(JSON.parse(binding?.entity_source_binding ?? 'null')).toMatchObject({
      version: 1, supportCaseId: f.supportCaseId, jobId: f.job.jobId, attempt: f.job.attempt,
      sourceBundleRevision: f.source.sourceBundleRevision, mapRevision: f.source.expectedMapRevision,
      sources: expect.any(Array),
    });
    expect((await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(f.qualification))).jobs).toEqual([]);
  });

  it('reopens one current successor when a leased source generation changes', async () => {
    const f = await fixture();
    await t.db.prepare('UPDATE support_cases SET overall_goal=? WHERE id=?').bind('새 목표', f.supportCaseId).run();
    const jobs = await t.db.prepare(
      `SELECT state,attempt,source_generation,claim_token_hash,lease_owner
       FROM agent_jobs WHERE session_id=? ORDER BY enqueued_at,id`,
    ).bind(f.sessionId).all();
    expect(jobs.results.filter((row) => row.state === 'failed')).toHaveLength(1);
    expect(jobs.results.filter((row) => row.state === 'pending')).toHaveLength(1);
    expect(jobs.results.find((row) => row.state === 'pending')).toMatchObject({ attempt: 0, claim_token_hash: null, lease_owner: null });
  });
});
