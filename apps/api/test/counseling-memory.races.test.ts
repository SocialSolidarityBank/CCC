import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupD1, seedTestProgramWithRuntimeModes, testActors, testProgramId } from './support/d1';
import { seedCanonicalSttConsent, seedNerQualification, claimRequest, agentResultRequest, type NerQualification } from './support/agent-jobs';
import type { MemoryMaskJob } from '@ccc/contracts/agent-jobs';
import worker from './support/local-worker';
import { agentManifestEnv, AGENT_SERVICE_HEADERS } from './support/agent-jobs';
import { runCounselingMemory } from '@ccc/http-api/counseling-memory-runner';
import { AI_PROVIDER_REGISTRY_VERSION, CODEX_PROVIDER_ID, CODEX_PROVIDER_ADAPTER_VERSION, canonicalAiProviderConfigHash, type AiProviderTestAdapter } from '@ccc/ai-runtime';
import { activateAiProviderConfiguration, appendSupportCaseConsentEvent, beginCounselingMemoryEgress, claimCounselingMemorySources, commitCounselingMemoryWork, correctCounselingMemory, createActionItem, createCase, createManualSession, getCounselingMemory, getCounselingMemorySource, getSupportCaseConsent, issueSupportCaseConsentDisclosures, listSupportCasesForBeneficiary, loadCounselingMemoryContext, prepareCounselingMemoryWork, registerAiProviderConfiguration, resolveActionItem, acceptCounselingMemorySource, type ActionItem } from '@ccc/core/gateway';
import { ProgramAdmissionRequiredError, releaseCounselingMemorySource } from '@ccc/core/gateway';
import { registrationInput } from './support/registration';
vi.setConfig({ testTimeout: 30000 });
const t = setupD1();
const { counselor, admin, service } = testActors;
beforeEach(async () => { await t.reset(); });
interface MemoryFixture { id: string; action: ActionItem; qualification: NerQualification; jobs: MemoryMaskJob[] }
async function fixture(claim = true, expiresAt?: string, configHash = 'b'.repeat(64)): Promise<MemoryFixture> {
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  t.env.CCC_LLM_MODE = 'openai';
  t.env.installationMode = 'local-single';
  t.env.MEMORY_MASKING_PIPELINES = JSON.stringify({ 'ner-mask-v1-addr-cond-dict': 'd'.repeat(64) });
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, admin.userId, {
    deploymentMode: 'local-single', sttMode: 'off', llmMode: 'openai',
  });
  const c = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));
  const { programs } = await listSupportCasesForBeneficiary(t.env, counselor, c.id);
  const id = programs[0]!.supportCase.id;
  await seedCanonicalSttConsent(t.env, counselor, id);
  const config = await registerAiProviderConfiguration(t.env, admin, { adapterId: 'codex', adapterVersion: 'v1', configHash, approvalRefs: ['synthetic-approval'] });
  await activateAiProviderConfiguration(t.env, admin, config.id);
  const action = await createActionItem(t.env, counselor, c.id, { description: '다음 상담 전에 서류 준비', owner: 'beneficiary' });
  const qualification = await seedNerQualification(t.db, expiresAt === undefined ? {} : { expiresAt });
  await t.db.prepare("UPDATE counseling_memory_cases SET not_before = '2000-01-01T00:00:00.000Z'").run();
  await prepareCounselingMemoryWork(t.env);
  const jobs = claim ? await claimCounselingMemorySources(t.env, service, claimRequest(qualification)) : [];
  return { id, action, qualification, jobs };
}

async function withdrawExternalLlm(supportCaseId: string): Promise<void> {
  const current = (await getSupportCaseConsent(t.env, counselor, supportCaseId))
    .find((item) => item.domain === 'external_llm_cross_border_processing');
  const disclosure = (await issueSupportCaseConsentDisclosures(t.env, counselor, supportCaseId))
    .find((item) => item.domain === 'external_llm_cross_border_processing');
  if (current?.state !== 'granted' || current.revision === null || disclosure === undefined) {
    throw new Error('expected current canonical LLM consent');
  }
  await appendSupportCaseConsentEvent(t.env, counselor, supportCaseId, {
    domain: current.domain,
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
// The synthetic Agent must mask numeric identifiers, including ISO dates in source metadata.
function maskedFixtureText(text: string): string {
  return text.replace(/(?<![\d-])\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{2,8})?(?![\d-])/gu, '[가림]');
}
async function maskJobs(f: MemoryFixture) {
  for (const job of f.jobs) {
    const source = await getCounselingMemorySource(t.env, service, job.jobId, job.claimToken, job.attempt);
    await acceptCounselingMemorySource(t.env, service, job.jobId, await agentResultRequest({ kind: 'text', claimToken: job.claimToken, attempt: job.attempt, maskedText: maskedFixtureText(source.text), qualification: f.qualification }));
  }
}
async function maskPending(f: MemoryFixture) {
  await t.db.prepare("UPDATE counseling_memory_cases SET not_before = '2000-01-01T00:00:00.000Z'").run();
  await prepareCounselingMemoryWork(t.env);
  await maskJobs({ ...f, jobs: await claimCounselingMemorySources(t.env, service, claimRequest(f.qualification, 20)) });
}
async function materialize(f: MemoryFixture) {
  await maskJobs(f);
  await t.db.prepare("UPDATE counseling_memory_cases SET not_before = '2000-01-01T00:00:00.000Z'").run();
  const work = (await prepareCounselingMemoryWork(t.env))[0]!;
  const request = await beginCounselingMemoryEgress(t.env, work, 'b'.repeat(64));
  const material = request.materials.find(m => m.sourceKind === 'action')!;
  const output = { updates: [{ key: 'document', itemId: null, kind: 'fact' as const, title: '서류', body: '서류 준비 예정', state: 'current' as const, citations: [{ materialId: material.id, quote: '서류 준비' }], references: [{ kind: 'action' as const, id: f.action.id }] }], summary: [{ text: '서류 준비 예정', itemKeys: ['document'] }] };
  return { work, output };
}
describe('durable memory races', () => {
  it('keeps Agent source work separate and publishes memory only after attested masking', async () => {
    const f = await fixture(false);
    // This valid UUID contains a numeric run resembling an account number.
    await t.db.prepare("UPDATE counseling_memory_materials SET id=? WHERE source_id=? AND kind='action'")
      .bind('006ec309-6253-498c-8bfe-4dd22ddfe344', f.action.id).run();
    let providerCalls = 0;
    const adapter: AiProviderTestAdapter = {
      providerId: CODEX_PROVIDER_ID, adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION, testOnly: true,
      config: { registryVersion: AI_PROVIDER_REGISTRY_VERSION, providerId: CODEX_PROVIDER_ID, adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION, configVersion: 'memory-http-smoke', model: 'gpt-5-codex-test' },
      async generate() { throw new Error('Unexpected session draft invocation'); },
      async updateMemory(request) {
        providerCalls += 1;
        const corrected = request.existingItems.find(item => item.correctedAt !== null);
        if (corrected) return { updates: [], summary: [{ text: corrected.body, itemKeys: [corrected.id] }] };
        const material = request.materials.find(item => item.sourceKind === 'correction') ?? request.materials.find(item => item.sourceKind === 'action')!;
        return { updates: [{ key: 'document', itemId: request.existingItems[0]?.id ?? null, kind: 'fact', title: '서류', body: request.existingItems[0]?.body ?? '서류 준비 예정', state: 'current', citations: [{ materialId: material.id, quote: '서류 준비' }], references: [{ kind: 'action', id: f.action.id }] }], summary: [{ text: '서류 준비 예정', itemKeys: ['document'] }] };
      },
    };
    t.env.AI_PROVIDER_ADAPTER = adapter;
    const config = await registerAiProviderConfiguration(t.env, admin, { adapterId: adapter.providerId, adapterVersion: adapter.adapterVersion, configHash: await canonicalAiProviderConfigHash(adapter.config), approvalRefs: ['synthetic-memory-approval'] });
    await activateAiProviderConfiguration(t.env, admin, config.id);
    const env = await agentManifestEnv(t.env);
    const call = (path: string, body?: unknown, claim?: MemoryMaskJob) => worker.fetch(new Request(`http://localhost${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...AGENT_SERVICE_HEADERS, ...(claim ? { 'X-CCC-Job-Claim': claim.claimToken, 'X-CCC-Job-Attempt': String(claim.attempt) } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env);
    await runCounselingMemory(env);
    expect(providerCalls).toBe(0);
    const claimed = await call('/pipeline/memory/claim', claimRequest(f.qualification));
    expect(claimed.status).toBe(200);
    const payload: { jobs: MemoryMaskJob[] } = await claimed.json();
    expect(payload.jobs.some(job => job.sourceId === f.action.id)).toBe(true);
    for (const job of payload.jobs) {
      const wrongNamespace = await call(`/pipeline/jobs/${job.jobId}/source`, undefined, job);
      expect(wrongNamespace.status).not.toBe(200);
      const sourceResponse = await call(`/pipeline/memory/${job.jobId}/source`, undefined, job);
      expect(sourceResponse.status).toBe(200);
      const source: { text: string } = await sourceResponse.json();
      const dictionary = await call(`/pipeline/memory/${job.jobId}/mask-dictionary`, { claimToken: job.claimToken, attempt: job.attempt });
      expect(dictionary.status).toBe(200);
      const accepted = await call(`/pipeline/memory/${job.jobId}/result`, await agentResultRequest({ kind: 'text', claimToken: job.claimToken, attempt: job.attempt, maskedText: maskedFixtureText(source.text), qualification: f.qualification }));
      expect(accepted.status).toBe(204);
    }
    expect((await getCounselingMemory(env, counselor, f.id)).items).toEqual([]);
    await t.db.prepare("UPDATE counseling_memory_cases SET not_before = '2000-01-01T00:00:00.000Z'").run();
    const result = await runCounselingMemory(env);
    const view = await getCounselingMemory(env, counselor, f.id);
    expect(result, view.reason ?? 'memory generation').toMatchObject({ updated: 1, failed: 0 });
    expect(view.items.map(item => item.body)).toEqual(['서류 준비 예정']);
    expect(view.summary.map(line => line.text)).toEqual(['서류 준비 예정']);
    await correctCounselingMemory(env, counselor, f.id, { itemId: view.items[0]!.id, expectedRevision: view.items[0]!.revision, body: '서류 준비를 마쳤습니다.' });
    await t.db.prepare("UPDATE counseling_memory_cases SET not_before = '2000-01-01T00:00:00.000Z'").run();
    await runCounselingMemory(env);
    const correctionClaim = await call('/pipeline/memory/claim', claimRequest(f.qualification));
    const correctionJobs: { jobs: MemoryMaskJob[] } = await correctionClaim.json();
    expect(correctionJobs.jobs.some(job => job.sourceKind === 'correction')).toBe(true);
    for (const job of correctionJobs.jobs) {
      const response = await call(`/pipeline/memory/${job.jobId}/source`, undefined, job);
      const source: { text: string } = await response.json();
      const accepted = await call(`/pipeline/memory/${job.jobId}/result`, await agentResultRequest({ kind: 'text', claimToken: job.claimToken, attempt: job.attempt, maskedText: maskedFixtureText(source.text), qualification: f.qualification }));
      expect(accepted.status).toBe(204);
    }
    await t.db.prepare("UPDATE counseling_memory_cases SET not_before = '2000-01-01T00:00:00.000Z'").run();
    const refreshed = await runCounselingMemory(env);
    const corrected = await getCounselingMemory(env, counselor, f.id);
    expect(refreshed, corrected.reason ?? 'corrected memory generation').toMatchObject({ updated: 1, failed: 0 });
    expect(corrected.items.map(item => item.body)).toEqual(['서류 준비를 마쳤습니다.']);
  });
  it('advances only the requested trial case even when another case has an earlier turn', async () => {
    const first = await fixture();
    const other = await fixture(true, undefined, 'c'.repeat(64));
    await maskJobs(first);
    await maskJobs(other);
    const adapter: AiProviderTestAdapter = {
      providerId: CODEX_PROVIDER_ID, adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION, testOnly: true,
      config: { registryVersion: AI_PROVIDER_REGISTRY_VERSION, providerId: CODEX_PROVIDER_ID,
        adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION, configVersion: 'memory-scoped-trial', model: 'synthetic-only' },
      async generate() { throw new Error('Unexpected draft invocation'); },
      async updateMemory(request) {
        const material = request.materials.find(item => item.sourceKind === 'action')!;
        return { updates: [{ key: 'document', itemId: null, kind: 'fact', title: '서류',
          body: '서류 준비 예정', state: 'current',
          citations: [{ materialId: material.id, quote: '서류 준비' }],
          references: [{ kind: 'action', id: material.sourceId }] }],
        summary: [{ text: '서류 준비 예정', itemKeys: ['document'] }] };
      },
    };
    t.env.AI_PROVIDER_ADAPTER = adapter;
    const config = await registerAiProviderConfiguration(t.env, admin, {
      adapterId: adapter.providerId, adapterVersion: adapter.adapterVersion,
      configHash: await canonicalAiProviderConfigHash(adapter.config), approvalRefs: ['synthetic-trial-approval'],
    });
    await activateAiProviderConfiguration(t.env, admin, config.id);
    await t.db.prepare(`UPDATE counseling_memory_cases SET not_before=CASE WHEN support_case_id=?
      THEN '2000-01-01T00:00:00.000Z' ELSE '2001-01-01T00:00:00.000Z' END`).bind(other.id).run();
    const response = await worker.fetch(new Request(`http://localhost/support-cases/${first.id}/memory/trial`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-CCC-User-Id': admin.userId,
        'X-CCC-Org-Id': admin.orgId, 'X-CCC-Role': admin.role },
      body: JSON.stringify({ confirmExternalAi: true }),
    }), { ...t.env, LOCAL_ACTOR_HEADER_MODE: 'true' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ providerMode: 'fixture', counters: { updated: 1, failed: 0 } });
    expect((await getCounselingMemory(t.env, counselor, first.id)).items.map(item => item.body)).toEqual(['서류 준비 예정']);
    expect((await getCounselingMemory(t.env, counselor, other.id)).items).toEqual([]);
  });
  it('stops in-flight memory when the installed LLM mode is off', async () => {
    const f = await fixture();
    const prepared = await materialize(f);
    await t.db.prepare("UPDATE program_admission_policies SET llm_mode='off',version=version+1 WHERE org_id=?").bind(counselor.orgId).run();
    await expect(commitCounselingMemoryWork(t.env, prepared.work, prepared.output)).rejects.toThrow('memory_disabled');
    expect(await prepareCounselingMemoryWork(t.env)).toEqual([]);
    expect(await claimCounselingMemorySources(t.env, service, claimRequest(f.qualification))).toEqual([]);
    expect((await getCounselingMemory(t.env, counselor, f.id)).items).toEqual([]);
  });
  it('rejects masking results after the source changes and preserves new pending work', async () => {
    const f = await fixture();
    const job = f.jobs.find(j => j.sourceKind === 'action')!;
    const source = await getCounselingMemorySource(t.env, service, job.jobId, job.claimToken, job.attempt);
    await resolveActionItem(t.env, counselor, f.action.id);
    await expect(acceptCounselingMemorySource(t.env, service, job.jobId, await agentResultRequest({ kind: 'text', claimToken: job.claimToken, attempt: job.attempt, maskedText: source.text, qualification: f.qualification }))).rejects.toThrow();
    expect((await getCounselingMemory(t.env, counselor, f.id)).status).not.toBe('ready');
  });
  it('rejects an in-flight result after consent withdrawal without exposing the old memory', async () => {
    const f = await fixture(); const prepared = await materialize(f);
    await withdrawExternalLlm(f.id);
    await expect(commitCounselingMemoryWork(t.env, prepared.work, prepared.output)).rejects.toThrow();
    const view = await getCounselingMemory(t.env, counselor, f.id);
    expect(view.items).toEqual([]); expect(view.summary).toEqual([]);
  });
  it('never revives pre-withdrawal memory after canonical LLM consent is granted again', async () => {
    const f = await fixture();
    const prepared = await materialize(f);
    await commitCounselingMemoryWork(t.env, prepared.work, prepared.output);
    expect((await getCounselingMemory(t.env, counselor, f.id)).items).toHaveLength(1);
    const before = await t.db.prepare(
      'SELECT generation FROM counseling_memory_cases WHERE org_id=? AND support_case_id=?',
    ).bind(counselor.orgId, f.id).first<{ generation: number }>();
    if (before === null) throw new Error('expected memory case');

    await withdrawExternalLlm(f.id);
    await seedCanonicalSttConsent(t.env, counselor, f.id);

    const view = await getCounselingMemory(t.env, counselor, f.id);
    expect(view.items).toEqual([]);
    expect(view.summary).toEqual([]);
    const state = await t.db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM counseling_memory_materials
          WHERE org_id=? AND support_case_id=? AND valid=1) AS valid_materials,
         (SELECT COUNT(*) FROM counseling_memory_items
          WHERE org_id=? AND support_case_id=? AND valid=1) AS valid_items,
         (SELECT COUNT(*) FROM counseling_memory_sources
          WHERE org_id=? AND support_case_id=? AND dirty=1) AS dirty_sources,
         generation,status
       FROM counseling_memory_cases WHERE org_id=? AND support_case_id=?`,
    ).bind(
      counselor.orgId, f.id,
      counselor.orgId, f.id,
      counselor.orgId, f.id,
      counselor.orgId, f.id,
    ).first<{
      valid_materials: number;
      valid_items: number;
      dirty_sources: number;
      generation: number;
      status: string;
    }>();
    expect(state).toMatchObject({
      valid_materials: 0,
      valid_items: 0,
      status: 'updating',
    });
    expect(state?.dirty_sources).toBeGreaterThan(0);
    const after = await t.db.prepare(
      'SELECT generation FROM counseling_memory_cases WHERE org_id=? AND support_case_id=?',
    ).bind(counselor.orgId, f.id).first<{ generation: number }>();
    expect(after?.generation).toBeGreaterThan(before.generation);
  });
  it('rejects an in-flight result after a human correction', async () => {
    const f = await fixture(); const first = await materialize(f);
    await commitCounselingMemoryWork(t.env, first.work, first.output);
    const view = await getCounselingMemory(t.env, counselor, f.id);
    const action = await createActionItem(t.env, counselor, f.action.caseId, { description: '서류 준비 확인', owner: 'beneficiary' });
    await t.db.prepare("UPDATE counseling_memory_cases SET not_before = '2000-01-01T00:00:00.000Z'").run();
    await prepareCounselingMemoryWork(t.env);
    const jobs = await claimCounselingMemorySources(t.env, service, claimRequest(f.qualification, 20));
    const second = await materialize({ ...f, action, jobs });
    await correctCounselingMemory(t.env, counselor, f.id, { itemId: view.items[0]!.id, expectedRevision: view.items[0]!.revision, body: '서류는 이미 준비됨' });
    await expect(commitCounselingMemoryWork(t.env, second.work, second.output)).rejects.toThrow();
    expect((await getCounselingMemory(t.env, counselor, f.id)).items[0]!.body).toBe('서류는 이미 준비됨');
  });
  // Thirty-six attested sources cross real gateway and drain batches; shared CI runners exceed 60s.
  // This checks complete consumption, not throughput. Preserve every source and the bounded pass count.
  it('drains histories larger than one request without consuming omitted sources', async () => {
    const f = await fixture();
    const addedIds = Array.from({ length: 35 }, () => crypto.randomUUID());
    const ids = [f.action.id, ...addedIds];
    const createdAt = new Date().toISOString();
    // Seed existing history atomically; action creation is covered by its own gateway tests.
    await t.db.batch(addedIds.map((id, index) =>
      t.db.prepare("INSERT INTO action_items(id,org_id,support_case_id,description,owner,created_at) VALUES(?,?,?,?,'beneficiary',?)")
        .bind(id, counselor.orgId, f.id, `서류 준비 ${index}`, createdAt)));
    for (let pass = 0; pass < 32; pass++) {
      await t.db.prepare("UPDATE counseling_memory_cases SET not_before = '2000-01-01T00:00:00.000Z'").run();
      const works = await prepareCounselingMemoryWork(t.env);
      for (const work of works) {
        await beginCounselingMemoryEgress(t.env, work, 'b'.repeat(64));
        await commitCounselingMemoryWork(t.env, work, { updates: [], summary: [] });
      }
      const jobs = pass === 0 ? [...f.jobs, ...await claimCounselingMemorySources(t.env, service, claimRequest(f.qualification, 20))] : await claimCounselingMemorySources(t.env, service, claimRequest(f.qualification, 20));
      for (const job of jobs) {
        const source = await getCounselingMemorySource(t.env, service, job.jobId, job.claimToken, job.attempt);
        await acceptCounselingMemorySource(t.env, service, job.jobId, await agentResultRequest({ kind: 'text', claimToken: job.claimToken, attempt: job.attempt, maskedText: maskedFixtureText(source.text), qualification: f.qualification }));
      }
      const processed = await t.db.prepare("SELECT count(*) AS total FROM counseling_memory_materials WHERE support_case_id=? AND kind='action' AND processed=1 AND valid=1")
        .bind(f.id).first<{ total: number }>();
      if (processed?.total === ids.length) break;
    }
    const consumed = await t.db.prepare("SELECT source_id FROM counseling_memory_materials WHERE support_case_id=? AND kind='action' AND processed=1 AND valid=1").bind(f.id).all<{source_id:string}>();
    expect(consumed.results.map(row => row.source_id).sort()).toEqual(ids.sort());
  }, 180000);
  it('lets ready work pass two earlier cases still waiting for masking', async () => {
    const f = await fixture();
    await maskJobs(f);
    const waitingIds: string[] = [];
    for (let index = 0; index < 2; index++) {
      const participant = await createCase(t.env, counselor, await registrationInput(t.env, counselor, { programId: testProgramId(counselor.orgId) }));
      const { programs } = await listSupportCasesForBeneficiary(t.env, counselor, participant.id);
      const id = programs[0]!.supportCase.id;
      waitingIds.push(id);
      await seedCanonicalSttConsent(t.env, counselor, id);
      await createActionItem(t.env, counselor, participant.id, { description: '다음 상담 준비', owner: 'beneficiary' });
      await t.db.prepare("UPDATE counseling_memory_cases SET not_before='1990-01-01T00:00:00.000Z' WHERE support_case_id=?").bind(id).run();
    }
    await t.db.prepare("UPDATE counseling_memory_cases SET not_before='2000-01-01T00:00:00.000Z' WHERE support_case_id=?").bind(f.id).run();
    const works = await prepareCounselingMemoryWork(t.env, 2);
    expect(works.map(work => work.supportCaseId)).toEqual([f.id]);
    for (const id of waitingIds) {
      const row = await t.db.prepare('SELECT not_before FROM counseling_memory_cases WHERE support_case_id=?').bind(id).first<{ not_before: string }>();
      expect(Date.parse(row!.not_before)).toBeGreaterThan(Date.now());
    }
  });
  it('closes the third expired masking lease instead of waiting forever', async () => {
    const f = await fixture();
    const job = f.jobs.find(candidate => candidate.sourceKind === 'action')!;
    await t.db.prepare("UPDATE counseling_memory_materials SET attempt=3,lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(job.jobId).run();
    expect(await claimCounselingMemorySources(t.env, service, claimRequest(f.qualification))).toEqual([]);
    await t.db.prepare("UPDATE counseling_memory_cases SET not_before='2000-01-01T00:00:00.000Z'").run();
    expect(await prepareCounselingMemoryWork(t.env)).toEqual([]);
    expect(await getCounselingMemory(t.env, counselor, f.id)).toMatchObject({ status: 'blocked', reason: 'masking_snapshot_missing' });
  });
  it('combines independent sessions and protects a correction after an old session edit', async () => {
    const f = await fixture(false);
    const firstSession = await createManualSession(t.env, counselor, f.action.caseId, { submissionId: crypto.randomUUID(), heldAt: '2026-08-01T09:00:00.000Z', channel: 'in_person', memo: '일정 확인은 오후에 연락하기로 했습니다.', gasScores: [] });
    await maskPending(f);
    await t.db.prepare("UPDATE counseling_memory_cases SET not_before='2000-01-01T00:00:00.000Z'").run();
    const firstWork = (await prepareCounselingMemoryWork(t.env))[0]!;
    const firstRequest = await beginCounselingMemoryEgress(t.env, firstWork, 'b'.repeat(64));
    const firstMaterial = firstRequest.materials.find(material => material.sessionId === firstSession.id)!;
    await commitCounselingMemoryWork(t.env, firstWork, { updates: [{ key: 'contact', itemId: null, kind: 'fact', title: '연락 시간', body: '오후 연락을 요청했습니다.', state: 'current', citations: [{ materialId: firstMaterial.id, quote: '오후에 연락' }], references: [] }], summary: [{ text: '오후 연락 요청', itemKeys: ['contact'] }] });
    const initial = (await getCounselingMemory(t.env, counselor, f.id)).items[0]!;
    const secondSession = await createManualSession(t.env, counselor, f.action.caseId, { submissionId: crypto.randomUUID(), heldAt: '2026-08-08T09:00:00.000Z', channel: 'in_person', memo: '서류 확인도 오후에 연락하기로 했습니다.', gasScores: [] });
    await maskPending(f);
    await t.db.prepare("UPDATE counseling_memory_cases SET not_before='2000-01-01T00:00:00.000Z'").run();
    const secondWork = (await prepareCounselingMemoryWork(t.env))[0]!;
    const secondRequest = await beginCounselingMemoryEgress(t.env, secondWork, 'b'.repeat(64));
    expect(secondRequest.existingItems.map(item => item.id)).toContain(initial.id);
    const originals = secondRequest.materials.filter(material => material.sourceKind === 'session');
    expect(new Set(originals.map(material => material.sessionId))).toEqual(new Set([firstSession.id, secondSession.id]));
    await commitCounselingMemoryWork(t.env, secondWork, { updates: [{ key: 'contact', itemId: initial.id, kind: 'observation', title: '연락 시간', body: '두 회차에서 오후 연락을 요청했습니다.', state: 'current', citations: originals.map(material => ({ materialId: material.id, quote: '오후에 연락' })), references: [] }], summary: [{ text: '두 회차에서 오후 연락 요청', itemKeys: ['contact'] }] });
    const observation = (await getCounselingMemory(t.env, counselor, f.id)).items[0]!;
    expect(observation.kind).toBe('observation');
    await correctCounselingMemory(t.env, counselor, f.id, { itemId: observation.id, expectedRevision: observation.revision, body: '현재는 오전 연락을 요청했습니다.' });
    await t.db.prepare('UPDATE sessions SET memo=? WHERE id=?').bind('일정 확인은 오후에 연락하기로 했습니다. 기존 메모의 다른 부분을 보완했습니다.', firstSession.id).run();
    expect((await getCounselingMemory(t.env, counselor, f.id)).items[0]!.body).toBe('현재는 오전 연락을 요청했습니다.');
    await maskPending(f);
    await t.db.prepare("UPDATE counseling_memory_cases SET not_before='2000-01-01T00:00:00.000Z'").run();
    const replayWork = (await prepareCounselingMemoryWork(t.env))[0]!;
    const replayRequest = await beginCounselingMemoryEgress(t.env, replayWork, 'b'.repeat(64));
    expect(replayRequest.existingItems.find(item => item.id === observation.id)?.body).toBe('현재는 오전 연락을 요청했습니다.');
    const replayMaterial = replayRequest.materials.find(material => material.sourceKind === 'session' && material.sessionId === firstSession.id)!;
    await expect(commitCounselingMemoryWork(t.env, replayWork, { updates: [{ key: 'replay', itemId: observation.id, kind: 'fact', title: '연락 시간', body: '오후 연락을 요청했습니다.', state: 'current', citations: [{ materialId: replayMaterial.id, quote: '오후에 연락' }], references: [] }], summary: [] })).rejects.toThrow('memory_correction_protected');
  });
  it('omits expired historical context and renews its proof without making a new fact', async () => {
    const f = await fixture(true, new Date(Date.now() + 3600000).toISOString());
    const first = await materialize(f);
    await commitCounselingMemoryWork(t.env, first.work, first.output);
    const session = await createManualSession(t.env, counselor, f.action.caseId, { submissionId: crypto.randomUUID(), heldAt: '2026-09-08T09:00:00.000Z', channel: 'in_person', memo: '이번 상담에서 새 일정을 확인했습니다.', gasScores: [] });
    await maskPending(f);
    const context = await loadCounselingMemoryContext(t.env, counselor, session.id);
    expect(context?.materials).toHaveLength(1);
    const material = context!.materials[0]!;
    const before = await t.db.prepare('SELECT source_revision,processed,snapshot_id FROM counseling_memory_materials WHERE id=?').bind(material.id).first<{ source_revision: number; processed: number; snapshot_id: string }>();
    const state = await t.db.prepare('SELECT generation FROM counseling_memory_cases WHERE support_case_id=?').bind(f.id).first<{ generation: number }>();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 7200000));
    try {
      expect(await loadCounselingMemoryContext(t.env, counselor, session.id)).toBeNull();
      const pending = await t.db.prepare('SELECT status,source_revision,processed,snapshot_id FROM counseling_memory_materials WHERE id=?').bind(material.id).first();
      expect(pending).toMatchObject({ status: 'pending', source_revision: before!.source_revision, processed: before!.processed, snapshot_id: null });
      const qualification = await seedNerQualification(t.db);
      const jobs = await claimCounselingMemorySources(t.env, service, claimRequest(qualification, 20));
      await maskJobs({ ...f, qualification, jobs });
      const renewed = await loadCounselingMemoryContext(t.env, counselor, session.id);
      expect(renewed?.materials.map(candidate => candidate.id)).toEqual([material.id]);
      expect(renewed!.materials[0]!.snapshotId).not.toBe(before!.snapshot_id);
      expect(await t.db.prepare('SELECT generation FROM counseling_memory_cases WHERE support_case_id=?').bind(f.id).first()).toEqual(state);
    } finally {
      vi.useRealTimers();
    }
  });
  it('rejects an oversized derived snapshot without publishing a partial memory batch', async () => {
    const f = await fixture(false);
    const quotes = Array.from({ length: 32 }, (_, index) => '가'.repeat(498) + String(index).padStart(2, '0'));
    const session = await createManualSession(t.env, counselor, f.action.caseId, { submissionId: crypto.randomUUID(), heldAt: '2026-08-01T09:00:00.000Z', channel: 'in_person', memo: quotes.join('\n'), gasScores: [] });
    await maskPending(f);
    await t.db.prepare("UPDATE counseling_memory_cases SET not_before='2000-01-01T00:00:00.000Z'").run();
    const work = (await prepareCounselingMemoryWork(t.env))[0]!;
    const request = await beginCounselingMemoryEgress(t.env, work, 'b'.repeat(64));
    const source = request.materials.find(material => material.sessionId === session.id)!;
    await expect(commitCounselingMemoryWork(t.env, work, {
      updates: [
        { key: 'short', itemId: null, kind: 'fact', title: '짧은 기억', body: '짧은 기억입니다.', state: 'current', citations: [{ materialId: source.id, quote: quotes[0]! }], references: [] },
        { key: 'long', itemId: null, kind: 'fact', title: '긴 기억', body: '가'.repeat(2000), state: 'current', citations: quotes.map(quote => ({ materialId: source.id, quote })), references: [] },
      ],
      summary: [],
    })).rejects.toThrow('memory_context_overflow');
    expect(await getCounselingMemory(t.env, counselor, f.id)).toMatchObject({ items: [], summary: [] });
    expect(await t.db.prepare('SELECT processed FROM counseling_memory_materials WHERE id=?').bind(source.id).first()).toEqual({ processed: 0 });
  });
  it('blocks memory source delivery after admission changes but still releases the lease', async () => {
    const f = await fixture();
    const job = f.jobs.find(entry => entry.sourceKind === 'action')!;
    await t.db.prepare('UPDATE program_admission_policies SET version=version+1 WHERE org_id=?').bind(counselor.orgId).run();
    await expect(getCounselingMemorySource(t.env, service, job.jobId, job.claimToken, job.attempt))
      .rejects.toBeInstanceOf(ProgramAdmissionRequiredError);
    await releaseCounselingMemorySource(t.env, service, job.jobId, {
      claimToken: job.claimToken, attempt: job.attempt, outcome: 'transient', reason: 'engine_unavailable',
    });
    expect(await t.db.prepare('SELECT lease_token FROM counseling_memory_materials WHERE id=?').bind(job.jobId).first())
      .toEqual({ lease_token: null });
  });

  it('rejects an in-flight memory result after program confirmation becomes stale', async () => {
    const f = await fixture();
    const prepared = await materialize(f);
    await t.db.prepare('UPDATE program_admission_policies SET version=version+1 WHERE org_id=?').bind(counselor.orgId).run();
    await expect(commitCounselingMemoryWork(t.env, prepared.work, prepared.output))
      .rejects.toBeInstanceOf(ProgramAdmissionRequiredError);
    expect((await getCounselingMemory(t.env, counselor, f.id)).items).toEqual([]);
  });

  it('retains the previous summary and correction access while program admission is blocked', async () => {
    const f = await fixture();
    const prepared = await materialize(f);
    await commitCounselingMemoryWork(t.env, prepared.work, prepared.output);
    await t.db.prepare('UPDATE program_admission_policies SET version=version+1 WHERE org_id=?').bind(counselor.orgId).run();
    const view = await getCounselingMemory(t.env, counselor, f.id);
    expect(view).toMatchObject({ status: 'blocked', reason: 'program_admission_required', canCorrect: true });
    expect(view.summary.map(line => line.text)).toEqual(['서류 준비 예정']);
  });
});
