import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { MemoryMaskJob, ResultRequest } from '@ccc/contracts/agent-jobs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { MemoryGenerationOutput, MemoryGenerationRequest } from '@ccc/contracts/counseling-memory';
import {
  acceptCounselingMemorySource,
  activateAiProviderConfiguration,
  beginCounselingMemoryEgress,
  claimCounselingMemorySources,
  commitCounselingMemoryWork,
  createCase,
  createManualSession,
  getCounselingMemorySource,
  listSupportCasesForBeneficiary,
  prepareCounselingMemoryWork,
  registerAiProviderConfiguration,
} from '@ccc/core/gateway';
import {
  AI_PROVIDER_REGISTRY_VERSION,
  CODEX_PROVIDER_ADAPTER_VERSION,
  CODEX_PROVIDER_ID,
  canonicalAiProviderConfigHash,
  type AiProviderConfig,
  type AiProviderRequest,
  type AiProviderTestAdapter,
} from '@ccc/ai-runtime';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import { runCounselingMemory } from '@ccc/http-api/counseling-memory-runner';
import { setupD1, seedTestProgramWithRuntimeModes, testActors, testProgramId } from './support/d1';
import { claimRequest, seedNerQualification, type NerQualification } from './support/agent-jobs';
import { registrationInput } from './support/registration';

const t = setupD1();
const { counselor, admin, service } = testActors;
const MEMORY_CONFIG = {
  registryVersion: AI_PROVIDER_REGISTRY_VERSION,
  providerId: CODEX_PROVIDER_ID,
  adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
  configVersion: 'entity-memory-proof-v1',
  model: 'gpt-5-codex-test',
} satisfies AiProviderConfig;

class MemoryProofAdapter implements AiProviderTestAdapter {
  readonly providerId = CODEX_PROVIDER_ID;
  readonly adapterVersion = CODEX_PROVIDER_ADAPTER_VERSION;
  readonly testOnly = true as const;
  readonly config = MEMORY_CONFIG;
  calls = 0;
  readonly requests: MemoryGenerationRequest[] = [];

  async generate(_request: AiProviderRequest): Promise<never> {
    throw new Error('memory tests must not use generate');
  }

  async updateMemory(request: MemoryGenerationRequest): Promise<MemoryGenerationOutput> {
    this.calls += 1;
    this.requests.push(request);
    return { updates: [], summary: [] };
  }
}
interface MemoryFixture {
  adapter: MemoryProofAdapter;
  supportCaseId: string;
  firstSessionId: string;
  qualification: NerQualification;
  configHash: string;
  derivedId: string;
  accepted: AcceptedMemorySource[];
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function preparePending(): Promise<void> {
  await t.db.prepare("UPDATE counseling_memory_cases SET not_before='2000-01-01T00:00:00.000Z'").run();
  await prepareCounselingMemoryWork(t.env);
}

interface AcceptedMemorySource {
  job: MemoryMaskJob;
  source: Awaited<ReturnType<typeof getCounselingMemorySource>>;
  request: ResultRequest;
}

/** Execute the real Agent coordinate/hash/result builder with local synthetic masking. */
function agentMemoryResult(
  job: MemoryMaskJob, source: AcceptedMemorySource['source'], maskedText: string, qualification: NerQualification,
): ResultRequest {
  return JSON.parse(execFileSync('python3', ['-c', `
import json, sys
from types import SimpleNamespace
from unittest.mock import patch
from ccc_pipeline.worker import process_text_job
payload = json.load(sys.stdin)
class Client:
    def get_source_bundle(self, *args):
        return payload['source']
    def post_result(self, job_id, result):
        self.result = result
client = Client()
config = SimpleNamespace(ner_attestation=payload['qualification']['attestation'],
    ner_release_receipt_id=payload['qualification']['receiptId'])
runtime = SimpleNamespace(layers=SimpleNamespace(person_ner=lambda text: []))
report = SimpleNamespace(total=0, as_mapping=lambda: {})
with patch('ccc_pipeline.worker.masking_pipeline_version', return_value='ner-mask-v1-addr-cond-dict'), \\
     patch('ccc_pipeline.worker.masking_pipeline_hash', return_value='d' * 64), \\
     patch('ccc_pipeline.worker._mask_with_dictionary', return_value=(payload['maskedText'], report)):
    process_text_job(client, config, payload['job'], runtime=runtime)
print(json.dumps(client.result, ensure_ascii=False))
`], {
    cwd: fileURLToPath(new URL('../../pipeline/', import.meta.url)),
    input: JSON.stringify({job, source, maskedText, qualification}), encoding: 'utf8',
  }));
}

/** Accept every pending memory material through the actual lease/result interface. */
async function acceptPending(qualification: NerQualification): Promise<AcceptedMemorySource[]> {
  const accepted: AcceptedMemorySource[] = [];
  for (let round = 0; round < 8; round += 1) {
    const jobs = await claimCounselingMemorySources(t.env, service, claimRequest(qualification, 20));
    if (jobs.length === 0) return accepted;
    for (const job of jobs) {
      const source = await getCounselingMemorySource(t.env, service, job.jobId, job.claimToken, job.attempt);
      const maskedText = source.text.replace(
        /(?<![\d-])\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{2,8})?(?![\d-])/gu,
        '[가림]',
      );
      const request = agentMemoryResult(job, source, maskedText, qualification);
      await acceptCounselingMemorySource(t.env, service, job.jobId, request);
      accepted.push({job, source, request});
    }
  }
  throw new Error('memory fixture exceeded bounded material drain');
}

async function createMemoryFixture(
  adapter: MemoryProofAdapter, options: {name?: string; memo?: string} = {},
): Promise<MemoryFixture> {
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, admin.userId, {
    deploymentMode: 'local-single', sttMode: 'off', llmMode: 'openai',
  });
  t.env.installationMode = 'local-single';
  t.env.CCC_STT_MODE = 'off';
  t.env.CCC_LLM_MODE = 'openai';
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  t.env.MEMORY_MASKING_PIPELINES = JSON.stringify({ 'ner-mask-v1-addr-cond-dict': 'd'.repeat(64) });
  t.env.AI_PROVIDER_ADAPTER = adapter;

  const beneficiary = await createCase(t.env, counselor, await registrationInput(t.env, counselor, {
    programId: testProgramId(counselor.orgId),
    ...(options.name === undefined ? {} : {name: options.name}),
  }));
  const supportCaseId = (await listSupportCasesForBeneficiary(t.env, counselor, beneficiary.id)).programs[0]!.supportCase.id;
  const configHash = await canonicalAiProviderConfigHash(MEMORY_CONFIG);
  const config = await registerAiProviderConfiguration(t.env, admin, {
    adapterId: CODEX_PROVIDER_ID, adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
    configHash, approvalRefs: ['entity-memory-proof-approval'],
  });
  await activateAiProviderConfiguration(t.env, admin, config.id);

  const firstSession = await createManualSession(t.env, counselor, supportCaseId, {
    submissionId: crypto.randomUUID(), heldAt: '2026-09-01T09:00:00.000Z',
    channel: 'in_person', memo: options.memo ?? '첫 상담에서 상환 계획을 확인했다.', gasScores: [],
  });
  const qualification = await seedNerQualification(t.db, { orgId: service.orgId });
  await preparePending();
  const accepted = await acceptPending(qualification);
  await t.db.prepare("UPDATE counseling_memory_cases SET not_before='2000-01-01T00:00:00.000Z'").run();
  const firstWork = (await prepareCounselingMemoryWork(t.env))[0];
  if (firstWork === undefined) throw new Error('expected first memory work');
  const firstRequest = await beginCounselingMemoryEgress(t.env, firstWork, configHash);
  const firstMaterial = firstRequest.materials.find(material => material.sourceKind === 'session');
  if (firstMaterial === undefined) throw new Error('expected first session material');
  const output: MemoryGenerationOutput = {
    updates: [{
      key: 'repayment-plan', itemId: null, kind: 'fact', title: '상환 계획', body: '상환 계획을 확인했다.',
      state: 'current', citations: [{ materialId: firstMaterial.id, quote: Array.from(firstMaterial.maskedText).slice(0, 80).join('') }], references: [],
    }],
    summary: [{ text: '상환 계획을 확인했다.', itemKeys: ['repayment-plan'] }],
  };
  await commitCounselingMemoryWork(t.env, firstWork, output);

  // Commit creates a derived-summary source. Materialize and accept it through S5.
  await preparePending();
  await acceptPending(qualification);
  const derived = await t.db.prepare(
    `SELECT id FROM counseling_memory_materials
     WHERE org_id=? AND support_case_id=? AND kind='derived_summary' AND valid=1 AND status='ready' LIMIT 1`,
  ).bind(counselor.orgId, supportCaseId).first<{ id: string }>();
  if (derived === null) throw new Error('expected accepted derived material');
  return { adapter, supportCaseId, firstSessionId: firstSession.id, qualification, configHash, derivedId: derived.id, accepted };
}

async function addCurrentSession(f: MemoryFixture): Promise<void> {
  await createManualSession(t.env, counselor, f.supportCaseId, {
    submissionId: crypto.randomUUID(), heldAt: '2026-09-02T09:00:00.000Z',
    channel: 'in_person', memo: '둘째 상담에서 새 상환 일정을 확인했다.', gasScores: [],
  });
  await preparePending();
  await acceptPending(f.qualification);
  await t.db.prepare("UPDATE counseling_memory_cases SET not_before='2000-01-01T00:00:00.000Z'").run();
}

async function corruptMaterialProof(materialId: string, change: 'hash' | 'codepoint'): Promise<void> {
  const row = await t.db.prepare(
    'SELECT proof_json, attempt FROM counseling_memory_materials WHERE id=?',
  ).bind(materialId).first<{ proof_json: string | null; attempt: number }>();
  if (row?.proof_json === null || row?.proof_json === undefined) throw new Error('expected persisted memory proof');
  const proof = JSON.parse(row.proof_json) as {
    sha256: string;
    evidenceHash: string;
    evidence: Array<{ sourceEnd: number }>;
  };
  if (change === 'hash') {
    proof.sha256 = 'f'.repeat(64);
  } else {
    proof.evidence[0]!.sourceEnd += 1;
    proof.evidenceHash = await sha256Hex(canonicalizeJcs(proof.evidence));
  }
  const payloadHash = await sha256Hex(canonicalizeJcs({
    schemaVersion: 2, attempt: row.attempt, result: proof,
  }));
  await t.db.prepare('UPDATE counseling_memory_materials SET proof_json=?, payload_hash=? WHERE id=?')
    .bind(JSON.stringify(proof), payloadHash, materialId).run();
}

beforeEach(async () => { await t.reset(); });

describe('F4B counseling-memory persisted material proof', () => {
  it('reaches the provider with current, historical, and derived materials when every proof is valid', async () => {
    const adapter = new MemoryProofAdapter();
    const f = await createMemoryFixture(adapter);
    await addCurrentSession(f);

    const counters = await runCounselingMemory(t.env);
    expect(counters).toMatchObject({ claimed: 1, updated: 1, failed: 0 });
    expect(adapter.calls).toBe(1);
    const request = adapter.requests[0];
    expect(request).toBeDefined();
    expect(request?.materials.some(material => material.sourceKind === 'derived_summary')).toBe(true);
    expect(request?.materials.filter(material => material.sourceKind === 'session')
      .some(material => material.sessionId === f.firstSessionId)).toBe(true);
    expect(request?.materials.filter(material => material.sourceKind === 'session')
      .some(material => material.sessionId !== f.firstSessionId)).toBe(true);
  });

  it.each(['가상본인', '가'.repeat(37)])(
    'accepts Agent proof for a nonzero raw chunk after replacing registered PII: %s',
    async name => {
      const f = await createMemoryFixture(new MemoryProofAdapter(), {
        name, memo: '앞'.repeat(23940) + `𠀀 ${name} 뒤의 상환 계획`,
      });
      const packet = f.accepted.find(({job, source}) => job.sourceStart > 0 && source.text.includes(f.supportCaseId));
      if (!packet) throw new Error('expected a delivered second chunk containing replaced PII');
      expect(packet.source.text).not.toContain(name);
      expect(packet.source.sourceLength).not.toBe(packet.job.sourceEnd - packet.job.sourceStart);
      expect(packet.source.sourceLength).toBe(Array.from(packet.source.text).length);
      expect(packet.source.sourceSha256).toBe(await sha256Hex(packet.source.text));
      if (packet.request.result.kind !== 'text') throw new Error('expected text result');
      expect(packet.request.result.checkedSource).toEqual({
        sourceRevision: packet.source.sourceRevision, sourceSha256: packet.source.sourceSha256,
        sourceStart: 0, sourceEnd: Array.from(packet.source.text).length,
      });
      expect(packet.source.sources).toEqual([expect.objectContaining({
        start: 0, end: packet.source.sourceLength, sha256: packet.source.sourceSha256,
      })]);
      await addCurrentSession(f);
      expect(await runCounselingMemory(t.env)).toMatchObject({updated: 1, failed: 0});
      expect(f.adapter.calls).toBe(1);
    },
  );

  it('rejects a stored raw-chunk range instead of repairing it into delivered coordinates', async () => {
    const f = await createMemoryFixture(new MemoryProofAdapter(), {
      name: '가상본인', memo: '𠀀 가상본인과 상환 계획을 확인했다.',
    });
    const packet = f.accepted.find(({job}) => job.sourceKind === 'session')!;
    const proof = structuredClone(packet.request.result);
    if (proof.kind !== 'text' || !proof.checkedSource) throw new Error('expected Agent checkedSource');
    proof.checkedSource.sourceEnd = packet.job.sourceEnd - packet.job.sourceStart;
    const proofJson = JSON.stringify(proof);
    const payloadHash = await sha256Hex(canonicalizeJcs({schemaVersion: 2, attempt: packet.job.attempt, result: proof}));
    await t.db.prepare('UPDATE counseling_memory_materials SET proof_json=?,payload_hash=? WHERE id=?')
      .bind(proofJson, payloadHash, packet.job.jobId).run();
    await addCurrentSession(f);
    expect(await runCounselingMemory(t.env)).toMatchObject({updated: 0, failed: 1});
    expect(f.adapter.calls).toBe(0);
    expect(await t.db.prepare('SELECT reason FROM counseling_memory_cases WHERE support_case_id=?')
      .bind(f.supportCaseId).first()).toEqual({reason: 'evidence_hash_mismatch'});
    expect(await t.db.prepare('SELECT proof_json,payload_hash,status FROM counseling_memory_materials WHERE id=?')
      .bind(packet.job.jobId).first()).toEqual({proof_json: proofJson, payload_hash: payloadHash, status: 'ready'});
  });

  it.each(['proof_json', 'entity_source_binding'] as const)('rejects an invocation with missing historical %s instead of skipping or repairing it', async column => {
    const f = await createMemoryFixture(new MemoryProofAdapter());
    await addCurrentSession(f);
    await t.db.prepare(
      `UPDATE counseling_memory_materials SET ${column}=NULL WHERE id=(SELECT id FROM counseling_memory_materials WHERE org_id=? AND support_case_id=? AND kind='session' AND session_id=? AND valid=1 AND status='ready' LIMIT 1)`,
    ).bind(counselor.orgId, f.supportCaseId, f.firstSessionId).run();

    const counters = await runCounselingMemory(t.env);
    expect(counters).toMatchObject({ claimed: 1, updated: 0, failed: 1 });
    expect(f.adapter.calls).toBe(0);
    expect(await t.db.prepare('SELECT reason FROM counseling_memory_cases WHERE org_id=? AND support_case_id=?')
      .bind(counselor.orgId, f.supportCaseId).first()).toEqual({ reason: 'masking_snapshot_missing' });
    expect(await t.db.prepare(`SELECT ${column} AS proof FROM counseling_memory_materials WHERE id=?`)
      .bind(f.accepted[0]!.job.jobId).first()).toEqual({proof: null});
  });

  it('rejects persisted payload-hash drift before any provider call', async () => {
    const f = await createMemoryFixture(new MemoryProofAdapter());
    await addCurrentSession(f);
    await t.db.prepare('UPDATE counseling_memory_materials SET payload_hash=? WHERE id=?')
      .bind('0'.repeat(64), f.derivedId).run();
    expect(await runCounselingMemory(t.env)).toMatchObject({updated: 0, failed: 1});
    expect(f.adapter.calls).toBe(0);
    expect(await t.db.prepare('SELECT reason FROM counseling_memory_cases WHERE support_case_id=?')
      .bind(f.supportCaseId).first()).toEqual({reason: 'evidence_hash_mismatch'});
  });

  it.each(['hash', 'codepoint'] as const)(
    'rejects an invocation when derived-summary %s proof is corrupt instead of silently dropping the item',
    async change => {
      const f = await createMemoryFixture(new MemoryProofAdapter());
      await addCurrentSession(f);
      await corruptMaterialProof(f.derivedId, change);

      const counters = await runCounselingMemory(t.env);
      expect(counters).toMatchObject({ claimed: 1, updated: 0, failed: 1 });
      expect(f.adapter.calls).toBe(0);
      expect(await t.db.prepare('SELECT reason FROM counseling_memory_cases WHERE org_id=? AND support_case_id=?')
        .bind(counselor.orgId, f.supportCaseId).first()).toEqual({ reason: 'evidence_hash_mismatch' });
    },
  );
});
