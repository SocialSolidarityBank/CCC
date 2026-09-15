import { beforeEach, describe, expect, it } from 'vitest';
import type { PreparedStatement } from '@ccc/contracts/database';
import type { ResultRequest } from '@ccc/contracts/agent-jobs';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import type { Actor } from '@ccc/core/gateway';
import {
  acceptAgentJobResult,
  activateAiProviderConfiguration,
  appendSupportCaseConsentEvent,
  claimAgentJobs,
  createCase,
  createCounselingRecord,
  enqueueTextWorkItem,
  getAgentJobSource,
  getSupportCaseConsent,
  issueSupportCaseConsentDisclosures,
  listSupportCasesForBeneficiary,
  recordMaskedSourceSnapshot,
  registerAiProviderConfiguration,
} from '@ccc/core/gateway';
import {
  AI_PROVIDER_REGISTRY_VERSION,
  CODEX_PROVIDER_ADAPTER_VERSION,
  CODEX_PROVIDER_ID,
  canonicalAiProviderConfigHash,
  generatePreviewFixtureAiDraft,
  type AiProviderConfig,
  type AiProviderOutput,
  type AiProviderRequest,
  type AiProviderTestAdapter,
} from '@ccc/ai-runtime';
import worker from './support/local-worker';
import { seedTestProgramWithRuntimeModes, setupD1, testActors, testProgramId } from './support/d1';
import { agentResultRequest, claimRequest, seedCanonicalSttConsent, seedNerQualification, testMaskingPipelineRegistry, TEXT_ONLY_RUNTIME } from './support/agent-jobs';
import { registrationInput } from './support/registration';

const t = setupD1();
const { counselor, admin, service } = testActors;
const TEST_CONFIG = {
  registryVersion: AI_PROVIDER_REGISTRY_VERSION,
  providerId: CODEX_PROVIDER_ID,
  adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
  configVersion: 'entity-provider-proof-v1',
  model: 'gpt-5-codex-test',
} satisfies AiProviderConfig;

class ProofAdapter implements AiProviderTestAdapter {
  readonly providerId = CODEX_PROVIDER_ID;
  readonly adapterVersion = CODEX_PROVIDER_ADAPTER_VERSION;
  readonly testOnly = true as const;
  readonly config = TEST_CONFIG;
  calls = 0;
  beforeReturn: (() => Promise<void>) | null = null;

  async generate(request: AiProviderRequest): Promise<AiProviderOutput> {
    this.calls += 1;
    if (this.beforeReturn !== null) await this.beforeReturn();
    return generatePreviewFixtureAiDraft(request);
  }
}

function serviceHeaders(actor: Actor = service): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** S5 text result acceptance creates a complete persisted proof and F3 source binding. */
async function fixture(adapter = new ProofAdapter(), reversedEvidence = false) {
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, admin.userId, {
    deploymentMode: 'local-single', sttMode: 'off', llmMode: 'openai',
  });
  t.env.installationMode = 'local-single';
  t.env.CCC_STT_MODE = 'off';
  t.env.CCC_LLM_MODE = 'openai';
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  t.env.MEMORY_MASKING_PIPELINES = await testMaskingPipelineRegistry();
  t.env.AI_PROVIDER_CONFIG = JSON.stringify(TEST_CONFIG);
  t.env.AI_PROVIDER_ADAPTER = adapter;

  const beneficiary = await createCase(t.env, counselor, await registrationInput(t.env, counselor, {
    programId: testProgramId(counselor.orgId),
  }));
  const supportCaseId = (await listSupportCasesForBeneficiary(t.env, counselor, beneficiary.id)).programs[0]!.supportCase.id;
  await seedCanonicalSttConsent(t.env, counselor, supportCaseId);
  const config = await registerAiProviderConfiguration(t.env, admin, {
    adapterId: CODEX_PROVIDER_ID,
    adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
    configHash: await canonicalAiProviderConfigHash(TEST_CONFIG),
    approvalRefs: ['entity-provider-proof-approval'],
  });
  await activateAiProviderConfiguration(t.env, admin, config.id);
  const session = await createCounselingRecord(t.env, counselor, supportCaseId, {
    schemaVersion: 2,
    submissionId: crypto.randomUUID(),
    heldAt: '2026-09-01T00:00:00.000Z',
    channel: 'in_person',
    memo: 'entity proof fixture source',
    gasScores: [], actionItems: [], flags: [],
  });
  await enqueueTextWorkItem(t.env, counselor, session.record.id, 'manual_record');
  const qualification = await seedNerQualification(t.db, { orgId: service.orgId });
  const claimed = (await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(qualification))).jobs[0];
  if (claimed === undefined) throw new Error('expected a claimed text job');
  const source = await getAgentJobSource(t.env, service, claimed.jobId, claimed.claimToken, claimed.attempt);
  const request = await agentResultRequest({
    kind: 'text', claimToken: claimed.claimToken, attempt: claimed.attempt,
    maskedText: 'MASKED entity proof fixture', qualification,
    checkedSource: {
      sourceRevision: source.sourceRevision,
      sourceSha256: source.sourceSha256,
      sourceStart: 0,
      sourceEnd: source.sourceLength,
    },
  });
  if (reversedEvidence) {
    const evidence = request.result.evidence[0]!;
    const text = Array.from(request.result.maskedText);
    request.result.evidence = [
      { ...evidence, id: crypto.randomUUID(), sourceStart: 7, sourceEnd: text.length, evidenceQuote: text.slice(7).join('') },
      { ...evidence, id: crypto.randomUUID(), sourceStart: 0, sourceEnd: 7, evidenceQuote: text.slice(0, 7).join('') },
    ];
    request.result.evidenceHash = await sha256Hex(canonicalizeJcs(request.result.evidence));
    request.payloadSha256 = await sha256Hex(canonicalizeJcs({
      schemaVersion: request.schemaVersion, attempt: request.attempt, result: request.result,
    }));
  }
  await acceptAgentJobResult(t.env, service, claimed.jobId, request);
  const snapshot = await t.db.prepare(
    'SELECT id, proof_json FROM ai_masked_source_snapshots WHERE session_id=? ORDER BY created_at DESC, id DESC LIMIT 1',
  ).bind(session.record.id).first<{ id: string; proof_json: string | null }>();
  if (snapshot === null) throw new Error('expected accepted source snapshot');

  return { adapter, supportCaseId, sessionId: session.record.id, snapshotId: snapshot.id, proof: snapshot.proof_json };
}

async function generate(env: typeof t.env, sessionId: string, snapshotId: string): Promise<Response> {
  return worker.fetch(new Request(`http://localhost/sessions/${sessionId}/ai/generate`, {
    method: 'POST', headers: serviceHeaders(), body: JSON.stringify({ sourceSnapshotId: snapshotId }),
  }), env);
}

async function draftCount(): Promise<number> {
  const row = await t.db.prepare('SELECT COUNT(*) AS count FROM ai_draft_versions').first<{ count: number }>();
  return Number(row?.count ?? 0);
}

async function dropSnapshotImmutability(): Promise<void> {
  await t.db.prepare('DROP TRIGGER IF EXISTS ai_masked_source_snapshots_no_update').run();
}

async function corruptProof(snapshotId: string, change: 'hash' | 'evidence' | 'codepoint'): Promise<void> {
  await dropSnapshotImmutability();
  const row = await t.db.prepare('SELECT proof_json,entity_source_binding FROM ai_masked_source_snapshots WHERE id=?')
    .bind(snapshotId).first<{ proof_json: string; entity_source_binding: string }>();
  if (row === null) throw new Error('expected persisted proof');
  const proof: Pick<ResultRequest, 'schemaVersion' | 'attempt' | 'payloadSha256' | 'result'> = JSON.parse(row.proof_json);
  if (change === 'hash') {
    await t.db.prepare('UPDATE ai_masked_source_snapshots SET masked_text=? WHERE id=?')
      .bind('tampered stored body', snapshotId).run();
    return;
  }
  if (change === 'evidence') proof.result.evidenceHash = 'e'.repeat(64);
  if (change === 'codepoint') {
    proof.result.evidence[0]!.sourceEnd += 1;
    proof.result.evidenceHash = await sha256Hex(canonicalizeJcs(proof.result.evidence));
    await t.db.prepare('DROP TRIGGER ai_masked_source_evidence_items_no_update').run();
    await t.db.prepare('UPDATE ai_masked_source_evidence_items SET source_end=source_end+1 WHERE snapshot_id=?')
      .bind(snapshotId).run();
  }
  proof.payloadSha256 = await sha256Hex(canonicalizeJcs({
    schemaVersion: proof.schemaVersion, attempt: proof.attempt, result: proof.result,
  }));
  await t.db.prepare('UPDATE ai_masked_source_snapshots SET proof_json=? WHERE id=?')
    .bind(canonicalizeJcs(proof), snapshotId).run();
  const binding: { jobId: string } = JSON.parse(row.entity_source_binding);
  await t.db.prepare('UPDATE agent_jobs SET result_payload_sha256=? WHERE id=?')
    .bind(proof.payloadSha256, binding.jobId).run();
}
async function corruptPipelinePair(snapshotId: string): Promise<void> {
  await dropSnapshotImmutability();
  const row = await t.db.prepare('SELECT proof_json FROM ai_masked_source_snapshots WHERE id=?').bind(snapshotId).first<{ proof_json: string | null }>();
  if (row?.proof_json === null || row?.proof_json === undefined) throw new Error('expected persisted proof');
  const proof: Pick<ResultRequest, 'schemaVersion' | 'attempt' | 'payloadSha256' | 'result'> = JSON.parse(row.proof_json);
  proof.result.maskingPipelineHash = 'e'.repeat(64);
  proof.payloadSha256 = await sha256Hex(canonicalizeJcs({
    schemaVersion: proof.schemaVersion, attempt: proof.attempt, result: proof.result,
  }));
  await t.db.prepare('UPDATE ai_masked_source_snapshots SET proof_json=? WHERE id=?')
    .bind(JSON.stringify(proof), snapshotId).run();
}

async function expireQualification(snapshotId: string): Promise<void> {
  const row = await t.db.prepare('SELECT proof_json FROM ai_masked_source_snapshots WHERE id=?').bind(snapshotId).first<{ proof_json: string | null }>();
  if (row?.proof_json === null || row?.proof_json === undefined) throw new Error('expected persisted proof');
  const proof = JSON.parse(row.proof_json) as { result: { releaseQualificationReceiptId: string } };
  await t.db.prepare('DROP TRIGGER IF EXISTS ner_release_receipts_immutable').run();
  await t.db.prepare('UPDATE ner_release_qualification_receipts SET expires_at=? WHERE id=?')
    .bind('2000-01-01T00:00:00.000Z', proof.result.releaseQualificationReceiptId).run();
}

async function withdrawExternalLlm(supportCaseId: string): Promise<void> {
  const current = (await getSupportCaseConsent(t.env, counselor, supportCaseId))
    .find(item => item.domain === 'external_llm_cross_border_processing');
  const disclosure = (await issueSupportCaseConsentDisclosures(t.env, counselor, supportCaseId))
    .find(item => item.domain === 'external_llm_cross_border_processing');
  if (current?.state !== 'granted' || current.revision === null || disclosure === undefined) {
    throw new Error('expected current canonical LLM consent');
  }
  await appendSupportCaseConsentEvent(t.env, counselor, supportCaseId, {
    domain: current.domain, decision: 'withdraw', provider: current.provider,
    providerLegalRecipient: current.providerLegalRecipient, providerCountry: current.providerCountry,
    purpose: current.purpose, retentionDuration: current.retentionDuration,
    copyVersion: disclosure.copyVersion, copyHash: disclosure.copyHash,
    disclosureSnapshotId: disclosure.snapshotId, effectiveAt: new Date().toISOString(),
    idempotencyKey: crypto.randomUUID(), correctionOfEventId: null,
    expectedRevision: current.revision,
  });
}

async function advanceEntityMap(supportCaseId: string): Promise<void> {
  await t.db.prepare(
    "UPDATE support_cases SET enc_entity_map='ciphertext',entity_map_revision=entity_map_revision+1,entity_map_key_version=1 WHERE id=?",
  ).bind(supportCaseId).run();
}

beforeEach(async () => { await t.reset(); });

describe('F4B persisted generic material proof', () => {
  it('reaches the injected provider and writes one draft when accepted proof is unchanged', async () => {
    const f = await fixture();
    const response = await generate(t.env, f.sessionId, f.snapshotId);
    expect(response.status).toBe(201);
    expect(f.adapter.calls).toBe(1);
    expect(await draftCount()).toBe(1);
  });

  it('preserves valid evidence submitted in a different order from stored rows', async () => {
    const f = await fixture(new ProofAdapter(), true);
    const response = await generate(t.env, f.sessionId, f.snapshotId);
    expect(response.status).toBe(201);
    expect(f.adapter.calls).toBe(1);
    expect(await draftCount()).toBe(1);
  });

  it.each(['hash', 'evidence', 'codepoint'] as const)(
    'rejects requested material %s proof before provider egress',
    async change => {
      const f = await fixture();
      await corruptProof(f.snapshotId, change);

      const response = await generate(t.env, f.sessionId, f.snapshotId);
      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({ error: 'evidence_hash_mismatch' });
      expect(f.adapter.calls).toBe(0);
      expect(await draftCount()).toBe(0);
    },
  );
  it('rejects a requested material whose persisted pipeline version/hash pair is not exact', async () => {
    const f = await fixture();
    await corruptPipelinePair(f.snapshotId);
    const response = await generate(t.env, f.sessionId, f.snapshotId);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: 'masking_pipeline_version_mismatch' });
    expect(f.adapter.calls).toBe(0);
    expect(await draftCount()).toBe(0);
  });

  it('rejects a persisted material whose release qualification has expired', async () => {
    const f = await fixture();
    await expireQualification(f.snapshotId);
    const response = await generate(t.env, f.sessionId, f.snapshotId);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: 'local_ner_unavailable' });
    expect(f.adapter.calls).toBe(0);
    expect(await draftCount()).toBe(0);
  });

  it('rejects a requested material whose persisted full proof is missing', async () => {
    const f = await fixture();
    await dropSnapshotImmutability();
    await t.db.prepare('UPDATE ai_masked_source_snapshots SET proof_json=NULL WHERE id=?').bind(f.snapshotId).run();
    const response = await generate(t.env, f.sessionId, f.snapshotId);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: 'masking_snapshot_missing' });
    expect(f.adapter.calls).toBe(0);
    expect(await draftCount()).toBe(0);
  });

  it('rejects the whole provider request when a counterpart snapshot lacks proof', async () => {
    const f = await fixture();
    const text = 'MASKED counterpart fixture';
    const hash = await sha256Hex(text);
    const counterpart = await recordMaskedSourceSnapshot(t.env, service, f.sessionId, {
      maskedText: text, sha256: hash, maskingPipelineVersion: 'ner-mask-v1',
      evidence: [{ id: crypto.randomUUID(), sourceRef: f.sessionId, sourceSha256: hash, evidenceQuote: text, sourceStart: 0, sourceEnd: [...text].length }],
    });
    await t.db.prepare(
      `INSERT INTO recording_result_commits(session_id,org_id,support_case_id,snapshot_id,result_sha256,emotion_scores,created_by,created_at)
       VALUES(?,?,?,?,?,?,?,?)`,
    ).bind(f.sessionId, counselor.orgId, f.supportCaseId, counterpart.id, hash, '{}', service.userId, new Date().toISOString()).run();
    const response = await generate(t.env, f.sessionId, f.snapshotId);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: 'masking_snapshot_missing' });
    expect(f.adapter.calls).toBe(0);
    expect(await draftCount()).toBe(0);
  });

  it.each(['source', 'map'] as const)('rejects %s drift after provider return before output commit', async drift => {
    const f = await fixture();
    let providerReturned = false;
    let injected = false;
    const raceDb = {
      prepare: t.env.DB.prepare.bind(t.env.DB),
      async batch<T>(statements: PreparedStatement[]) {
        if (providerReturned && !injected) {
          injected = true;
          if (drift === 'source') {
            await t.db.prepare('UPDATE sessions SET memo=? WHERE id=?').bind('drift after provider', f.sessionId).run();
          } else {
            await advanceEntityMap(f.supportCaseId);
          }
        }
        return t.env.DB.batch<T>(statements);
      },
    };
    const adapter = f.adapter;
    adapter.beforeReturn = async () => { providerReturned = true; };
    const response = await generate({ ...t.env, DB: raceDb }, f.sessionId, f.snapshotId);
    expect(injected).toBe(true);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'stale_claim' });
    expect(adapter.calls).toBe(1);
    expect(await draftCount()).toBe(0);
  });

  it('does not start the provider when consent withdrawal wins before begin CAS', async () => {
    const f = await fixture();
    let injected = false;
    const raceDb = {
      prepare: t.env.DB.prepare.bind(t.env.DB),
      async batch<T>(statements: PreparedStatement[]) {
        const authorized = await t.db.prepare("SELECT id FROM agent_job_egress_records WHERE provider='openai' AND status='authorized'").first();
        if (authorized !== null && !injected) {
          injected = true;
          await withdrawExternalLlm(f.supportCaseId);
        }
        return t.env.DB.batch<T>(statements);
      },
    };
    const response = await generate({ ...t.env, DB: raceDb }, f.sessionId, f.snapshotId);
    expect(injected).toBe(true);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'consent_not_effective' });
    expect(f.adapter.calls).toBe(0);
    expect(await draftCount()).toBe(0);
    await expect(t.db.prepare(
      "SELECT status,started_at FROM agent_job_egress_records WHERE provider='openai'",
    ).first()).resolves.toEqual({ status: 'revoked', started_at: null });
  });
  it('rejects a changed map at the final pre-call CAS', async () => {
    const f = await fixture();
    let injected = false;
    const raceDb = {
      prepare: t.env.DB.prepare.bind(t.env.DB),
      async batch<T>(statements: PreparedStatement[]) {
        const authorization = await t.db.prepare(
          "SELECT id FROM agent_job_egress_records WHERE provider='openai' AND status='authorized'",
        ).first();
        if (authorization !== null && !injected) {
          injected = true;
          await advanceEntityMap(f.supportCaseId);
        }
        return t.env.DB.batch<T>(statements);
      },
    };
    const response = await generate({ ...t.env, DB: raceDb }, f.sessionId, f.snapshotId);
    expect(injected).toBe(true);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'stale_claim' });
    expect(f.adapter.calls).toBe(0);
    expect(await draftCount()).toBe(0);
  });

  it('records one started-and-finished egress when withdrawal follows begin, without committing output', async () => {
    const f = await fixture();
    f.adapter.beforeReturn = async () => { await withdrawExternalLlm(f.supportCaseId); };
    const first = await generate(t.env, f.sessionId, f.snapshotId);
    expect(first.status).toBe(409);
    await expect(first.json()).resolves.toMatchObject({ error: 'consent_not_effective' });
    expect(f.adapter.calls).toBe(1);
    expect(await draftCount()).toBe(0);
    const ledger = await t.db.prepare(
      `SELECT status, started_at, completed_at FROM agent_job_egress_records
       WHERE org_id=? AND provider='openai' ORDER BY authorized_at DESC LIMIT 1`,
    ).bind(service.orgId).first<{ status: string; started_at: string | null; completed_at: string | null }>();
    expect(ledger).toMatchObject({ status: 'completed' });
    expect(ledger?.started_at).not.toBeNull();
    expect(ledger?.completed_at).not.toBeNull();
    const second = await generate(t.env, f.sessionId, f.snapshotId);
    expect(second.status).toBe(409);
    await expect(second.json()).resolves.toMatchObject({ error: 'consent_not_effective' });
    expect(f.adapter.calls).toBe(1);
    expect(await draftCount()).toBe(0);
  });
});
