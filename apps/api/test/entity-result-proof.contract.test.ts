import { beforeEach, describe, expect, it } from 'vitest';
import type { PreparedStatement } from '@ccc/contracts/database';
import type { ResultRequest } from '@ccc/contracts/agent-jobs';
import {
  acceptAgentJobResult,
  claimAgentJobs,
  createCase,
  createCounselingRecord,
  enqueueTextWorkItem,
  getAgentJobSource,
  listSupportCasesForBeneficiary,
} from '@ccc/core/gateway';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import { seedTestProgramWithRuntimeModes, setupD1, testActors, testProgramId } from './support/d1';
import { registrationInput } from './support/registration';
import {
  agentResultRequest,
  claimRequest,
  seedCanonicalSttConsent,
  seedNerQualification,
  sha256Hex,
  TEXT_ONLY_RUNTIME,
} from './support/agent-jobs';

const t = setupD1();
const { counselor, service } = testActors;

beforeEach(async () => { await t.reset(); });

async function fixture() {
  await seedTestProgramWithRuntimeModes(t.db, counselor.orgId, counselor.userId, { sttMode: 'off', llmMode: 'openai' });
  t.env.CCC_STT_MODE = 'off';
  t.env.CCC_LLM_MODE = 'openai';
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  // The fixture deliberately configures one exact version/hash pair only.
  t.env.MEMORY_MASKING_PIPELINES = JSON.stringify({ 'ner-mask-v1-addr-cond-dict': 'd'.repeat(64) });
  const beneficiary = await createCase(t.env, counselor, await registrationInput(t.env, counselor, {
    programId: testProgramId(counselor.orgId),
  }));
  const supportCaseId = (await listSupportCasesForBeneficiary(t.env, counselor, beneficiary.id)).programs[0]!.supportCase.id;
  await seedCanonicalSttConsent(t.env, counselor, supportCaseId);
  const session = await createCounselingRecord(t.env, counselor, supportCaseId, {
    schemaVersion: 2,
    submissionId: crypto.randomUUID(),
    heldAt: '2026-09-01T00:00:00.000Z',
    channel: 'in_person',
    memo: 'proof fixture source',
    gasScores: [],
    actionItems: [],
    flags: [],
  });
  await enqueueTextWorkItem(t.env, counselor, session.record.id, 'manual_record');
  const qualification = await seedNerQualification(t.db, { orgId: service.orgId });
  const claimed = (await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(qualification))).jobs[0];
  if (claimed === undefined) throw new Error('expected a claimed text job');
  const source = await getAgentJobSource(t.env, service, claimed.jobId, claimed.claimToken, claimed.attempt);
  const request = await agentResultRequest({
    kind: 'text',
    claimToken: claimed.claimToken,
    attempt: claimed.attempt,
    maskedText: 'MASKED proof fixture',
    qualification,
    checkedSource: {
      sourceRevision: source.sourceRevision,
      sourceSha256: source.sourceSha256,
      sourceStart: 0,
      sourceEnd: source.sourceLength,
    },
  });
  return { supportCaseId, sessionId: session.record.id, claimed, source, request };
}

async function snapshotRows(sessionId: string) {
  return t.db.prepare(
    `SELECT snapshot.id, snapshot.proof_json, snapshot.entity_source_binding,
            item.source_ref, item.source_sha256, item.evidence_quote, item.source_start, item.source_end
     FROM ai_masked_source_snapshots AS snapshot
     LEFT JOIN ai_masked_source_evidence_items AS item ON item.snapshot_id = snapshot.id
     WHERE snapshot.session_id = ? ORDER BY item.source_start, item.id`,
  ).bind(sessionId).all<{
    id: string;
    proof_json: string | null;
    entity_source_binding: string | null;
    source_ref: string | null;
    source_sha256: string | null;
    evidence_quote: string | null;
    source_start: number | null;
    source_end: number | null;
  }>();
}

async function jobState(jobId: string) {
  return t.db.prepare(
    'SELECT state, result_id, result_payload_sha256, entity_source_binding FROM agent_jobs WHERE id=?',
  ).bind(jobId).first<{ state: string; result_id: string | null; result_payload_sha256: string | null; entity_source_binding: string | null }>();
}

describe('F4 accepted result proof persistence', () => {
  it('persists the complete result packet and F3 binding, and preserves evidence roundtrip', async () => {
    const f = await fixture();
    const beforeBinding = await jobState(f.claimed.jobId);
    const accepted = await acceptAgentJobResult(t.env, service, f.claimed.jobId, f.request);
    expect(accepted).toMatchObject({ replayed: false, recording: null });

    const rows = await snapshotRows(f.sessionId);
    expect(rows.results).toHaveLength(1);
    const row = rows.results[0]!;
    expect(row.proof_json).not.toBeNull();
    expect(row.entity_source_binding).toBe(canonicalizeJcs(JSON.parse(beforeBinding!.entity_source_binding!)));
    expect(JSON.parse(row.proof_json!)).toEqual({
      schemaVersion: 2,
      attempt: f.request.attempt,
      payloadSha256: f.request.payloadSha256,
      result: f.request.result,
    });
    expect(JSON.parse(row.proof_json!)).not.toHaveProperty('claimToken');
    expect(JSON.parse(row.proof_json!)).not.toHaveProperty('resultId');
    expect(JSON.parse(row.entity_source_binding!)).toEqual(JSON.parse(beforeBinding?.entity_source_binding ?? 'null'));
    const stored = JSON.parse(row.proof_json!) as Pick<ResultRequest, 'schemaVersion' | 'attempt' | 'payloadSha256' | 'result'>;
    expect(await sha256Hex(canonicalizeJcs({
      schemaVersion: stored.schemaVersion, attempt: stored.attempt, result: stored.result,
    }))).toBe(stored.payloadSha256);
    expect(await sha256Hex(stored.result.maskedText)).toBe(stored.result.sha256);
    expect(await sha256Hex(canonicalizeJcs(stored.result.evidence))).toBe(stored.result.evidenceHash);
    expect(row).toMatchObject({
      source_ref: f.request.result.evidence[0]!.sourceRef,
      source_sha256: f.request.result.evidence[0]!.sourceSha256,
      evidence_quote: f.request.result.evidence[0]!.evidenceQuote,
      source_start: f.request.result.evidence[0]!.sourceStart,
      source_end: f.request.result.evidence[0]!.sourceEnd,
    });

    await expect(t.db.prepare('UPDATE ai_masked_source_snapshots SET proof_json=? WHERE id=?')
      .bind('{}', row.id).run()).rejects.toThrow();
    await expect(t.db.prepare('UPDATE ai_masked_source_snapshots SET entity_source_binding=? WHERE id=?')
      .bind('{}', row.id).run()).rejects.toThrow();
  });

  it.each(['invalid-pair', 'unregistered-version', 'missing-binding'] as const)('rejects %s without writing proof or terminal acceptance rows', async mode => {
    const f = await fixture();
    let request = f.request;
    if (mode === 'invalid-pair') {
      const result = { ...request.result, maskingPipelineHash: 'e'.repeat(64) };
      t.env.MEMORY_MASKING_PIPELINES = JSON.stringify({
        'ner-mask-v1-addr-cond-dict': 'd'.repeat(64), 'other-mask-v1': 'e'.repeat(64),
      });
      request = {
        ...request,
        result,
        payloadSha256: await sha256Hex(canonicalizeJcs({ schemaVersion: 2, attempt: request.attempt, result })),
      };
    } else if (mode === 'unregistered-version') {
      const result = { ...request.result, maskingPipelineVersion: 'unregistered-mask-v1' };
      request = {
        ...request, result,
        payloadSha256: await sha256Hex(canonicalizeJcs({ schemaVersion: 2, attempt: request.attempt, result })),
      };
    } else {
      await t.db.prepare('UPDATE agent_jobs SET entity_source_binding=NULL WHERE id=?').bind(f.claimed.jobId).run();
    }
    await expect(acceptAgentJobResult(t.env, service, f.claimed.jobId, request)).rejects.toThrow();
    expect((await snapshotRows(f.sessionId)).results).toHaveLength(0);
    expect(await t.db.prepare('SELECT COUNT(*) AS count FROM agent_job_result_acceptances WHERE job_id=?')
      .bind(f.claimed.jobId).first()).toEqual({ count: 0 });
    expect((await jobState(f.claimed.jobId))?.state).not.toBe('succeeded');
  });

  it.each(['source', 'map', 'vault'] as const)('rolls back proof and terminal acceptance when the %s binding drifts', async drift => {
    const f = await fixture();
    if (drift === 'source') {
      await t.db.prepare('UPDATE sessions SET memo=? WHERE id=?').bind('changed proof source', f.sessionId).run();
    } else if (drift === 'map') {
      await t.db.prepare("UPDATE support_cases SET enc_entity_map='changed-map',entity_map_revision=1,entity_map_key_version=1 WHERE id=?")
        .bind(f.supportCaseId).run();
    } else {
      await t.db.prepare(
        'UPDATE participant_pii_vault SET version=version+1 WHERE beneficiary_id=(SELECT beneficiary_id FROM support_cases WHERE id=?)',
      ).bind(f.supportCaseId).run();
    }
    await expect(acceptAgentJobResult(t.env, service, f.claimed.jobId, f.request)).rejects.toThrow();
    expect((await snapshotRows(f.sessionId)).results).toHaveLength(0);
    expect(await t.db.prepare('SELECT COUNT(*) AS count FROM agent_job_result_acceptances WHERE job_id=?')
      .bind(f.claimed.jobId).first()).toEqual({ count: 0 });
  });

  it('aborts the entire acceptance batch when a map race wins after preflight', async () => {
    const f = await fixture();
    let injected = false;
    const raceDb = {
      prepare: t.env.DB.prepare.bind(t.env.DB),
      async batch<T>(statements: PreparedStatement[]) {
        if (!injected) {
          injected = true;
          await t.db.prepare("UPDATE support_cases SET enc_entity_map='racing-map',entity_map_revision=1,entity_map_key_version=1 WHERE id=?")
            .bind(f.supportCaseId).run();
        }
        return t.env.DB.batch<T>(statements);
      },
    };
    await expect(acceptAgentJobResult({ ...t.env, DB: raceDb }, service, f.claimed.jobId, f.request)).rejects.toThrow();
    expect(injected).toBe(true);
    expect((await snapshotRows(f.sessionId)).results).toHaveLength(0);
    expect(await t.db.prepare('SELECT COUNT(*) AS count FROM agent_job_result_acceptances WHERE job_id=?')
      .bind(f.claimed.jobId).first()).toEqual({ count: 0 });
    expect((await jobState(f.claimed.jobId))?.state).not.toBe('succeeded');
  });

  it('replays the same payload hash without extra snapshot or acceptance writes, then conflicts on a new payload', async () => {
    const f = await fixture();
    await expect(acceptAgentJobResult(t.env, service, f.claimed.jobId, f.request)).resolves.toMatchObject({ replayed: false, recording: null });
    const before = await snapshotRows(f.sessionId);
    await t.db.prepare('UPDATE sessions SET memo=? WHERE id=?').bind('changed after accepted result', f.sessionId).run();
    const replayed = await acceptAgentJobResult(t.env, service, f.claimed.jobId, {
      ...f.request,
      resultId: `different-result-${crypto.randomUUID()}`,
    });
    expect(replayed).toMatchObject({ replayed: true, recording: null });
    expect((await snapshotRows(f.sessionId)).results).toEqual(before.results);
    await expect(acceptAgentJobResult(t.env, service, f.claimed.jobId, await agentResultRequest({
      kind: 'text',
      claimToken: f.claimed.claimToken,
      attempt: f.claimed.attempt,
      maskedText: 'MASKED different proof payload',
      qualification: await seedNerQualification(t.db, { orgId: service.orgId }),
      checkedSource: {
        sourceRevision: f.source.sourceRevision,
        sourceSha256: f.source.sourceSha256,
        sourceStart: 0,
        sourceEnd: f.source.sourceLength,
      },
    }))).rejects.toMatchObject({ code: 'result_conflict' });
    expect(await t.db.prepare('SELECT COUNT(*) AS count FROM ai_masked_source_snapshots WHERE session_id=?')
      .bind(f.sessionId).first()).toEqual({ count: 1 });
  });
});
