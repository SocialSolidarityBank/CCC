import { beforeEach, describe, expect, it } from 'vitest';
import { handleRequest } from '@ccc/http-api';
import {
  claimAgentJobs,
  createCase,
  createCounselingRecord,
  enqueueTextWorkItem,
  getAgentJobSource,
  listSupportCasesForBeneficiary,
  readCaseEntityMapping,
  registerCaseEntities,
  type Actor,
} from '@ccc/core/gateway';
import type { AgentJob, SourceResponse } from '@ccc/contracts/agent-jobs';
import type { EntityRegistrationRequest } from '@ccc/contracts/entity-registration';
import { seedTestProgramWithRuntimeModes, setupD1, testActors, testProgramId } from './support/d1';
import { registrationInput } from './support/registration';
import { claimRequest, seedCanonicalSttConsent, seedNerQualification, TEXT_ONLY_RUNTIME, type NerQualification } from './support/agent-jobs';

const t = setupD1();
const { counselor, service, otherOrgCounselor, admin } = testActors;

beforeEach(async () => { await t.reset(); });

function http(actor: Actor, path: string, body?: unknown) {
  return handleRequest(new Request(`http://localhost${path}`, body === undefined ? undefined : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), t.env, async () => actor);
}

function codePointOffset(text: string, utf16Offset: number): number {
  return [...text.slice(0, utf16Offset)].length;
}

/** Build a witness from the server-issued ordered source descriptors, never by re-creating source metadata. */
function occurrence(source: SourceResponse, value: string, nth = 0): { sourceId: string; sourceRevision: string; start: number; end: number } {
  const offsets: number[] = [];
  let from = 0;
  while (true) {
    const at = source.text.indexOf(value, from);
    if (at < 0) break;
    offsets.push(at);
    from = at + value.length;
  }
  const utf16Start = offsets[nth];
  if (utf16Start === undefined) throw new Error(`missing source occurrence: ${value}#${nth}`);
  const start = codePointOffset(source.text, utf16Start);
  const end = start + [...value].length;
  const descriptor = source.sources.find(candidate => candidate.start <= start && candidate.end >= end);
  if (descriptor === undefined) throw new Error(`missing source descriptor: ${value}`);
  return { sourceId: descriptor.sourceId, sourceRevision: descriptor.sourceRevision, start, end };
}

interface FixtureSeed {
  supportCaseId: string;
  sessionId: string;
  qualification: NerQualification;
  job: AgentJob | undefined;
}

interface RegistrationFixture extends FixtureSeed {
  job: AgentJob;
  source: SourceResponse;
}

async function fixture(options: { consent?: boolean } = {}): Promise<FixtureSeed> {
  await seedTestProgramWithRuntimeModes(
    t.db, counselor.orgId, counselor.userId, { sttMode: 'off', llmMode: 'openai' },
  );
  t.env.CCC_STT_MODE = 'off';
  t.env.CCC_LLM_MODE = 'openai';
  t.env.TEXT_AI_PILOT_ENABLED = '1';
  const created = await createCase(t.env, counselor, await registrationInput(t.env, counselor, {
    programId: testProgramId(counselor.orgId),
  }, options.consent === false ? { external_llm_cross_border_processing: 'decline' } : undefined));
  const supportCaseId = (await listSupportCasesForBeneficiary(t.env, counselor, created.id)).programs[0]!.supportCase.id;
  if (options.consent !== false) await seedCanonicalSttConsent(t.env, counselor, supportCaseId);
  const record = await createCounselingRecord(t.env, counselor, supportCaseId, {
    schemaVersion: 2,
    submissionId: crypto.randomUUID(),
    heldAt: '2026-09-01T00:00:00.000Z',
    channel: 'in_person',
    memo: '가상인물은 별칭 가상별칭으로 불립니다. 가상인물과 가상인물의 기록. 공통이름과 공통이름을 별도로 적습니다. 무관한별칭만 단독으로 적습니다.\n𠀀 다른 줄의 가상인물 기록.',
    gasScores: [], actionItems: [], flags: [],
  });
  await enqueueTextWorkItem(t.env, counselor, record.record.id, 'manual_record');
  const qualification = await seedNerQualification(t.db, { orgId: service.orgId });
  const claimed = await claimAgentJobs(t.env, service, TEXT_ONLY_RUNTIME, claimRequest(qualification));
  return { supportCaseId, sessionId: record.record.id, qualification, job: claimed.jobs[0] };
}

async function claimedFixture(): Promise<RegistrationFixture> {
  const f = await fixture();
  if (f.job === undefined) throw new Error('expected a live text claim');
  const source = await getAgentJobSource(t.env, service, f.job.jobId, f.job.claimToken, f.job.attempt);
  return { ...f, job: f.job, source };
}
function request(f: RegistrationFixture, entries: EntityRegistrationRequest['entries']): EntityRegistrationRequest {
  return {
    family: 'generic', jobId: f.job.jobId, claimToken: f.job.claimToken, attempt: f.job.attempt,
    sourceBundleRevision: f.source.sourceBundleRevision,
    expectedMapRevision: f.source.expectedMapRevision,
    entries,
  };
}

function entry(
  kind: 'person' | 'institution', sourceValue: string,
  occurrences: Array<{ sourceId: string; sourceRevision: string; start: number; end: number }>,
  entityReference: string | null = null,
): EntityRegistrationRequest['entries'][number] {
  return { kind, sourceValue, occurrences, entityReference };
}



async function httpRegister(f: RegistrationFixture, body: EntityRegistrationRequest) {
  const response = await http(service, '/pipeline/entity-registrations', body);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  return response.json();
}

async function mutationAuditCount(supportCaseId: string) {
  const row = await t.db.prepare(
    "SELECT COUNT(*) AS count FROM audit_log WHERE support_case_id=? AND action='update' AND target_table='support_cases'",
  ).bind(supportCaseId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}


describe('entity registration against the live source bundle', () => {
  it('assigns one number across repeated code-point occurrences and replays without a mutation audit', async () => {
    const f = await claimedFixture();
    const body = request(f, [entry('person', '가상인물', [
      occurrence(f.source, '가상인물', 0), occurrence(f.source, '가상인물', 1), occurrence(f.source, '가상인물', 2),
    ])]);
    const first = await httpRegister(f, body);
    expect(first).toMatchObject({ outcome: 'applied', entries: [{ index: 0, number: 1, reason: null }] });
    const map = await readCaseEntityMapping(t.env, service, f.supportCaseId);
    expect(map).toMatchObject({ revision: 1, personCounter: 1 });
    expect(map!.entities).toHaveLength(1);
    const audits = await mutationAuditCount(f.supportCaseId);
    await expect(httpRegister(f, body)).resolves.toEqual(first);
    expect(await mutationAuditCount(f.supportCaseId)).toBe(audits);
    expect(await readCaseEntityMapping(t.env, service, f.supportCaseId)).toMatchObject({ revision: 1, personCounter: 1 });
  });
  it('selects a later source line using code-point bounds rather than the first matching source ID', async () => {
    const f = await claimedFixture();
    const later = occurrence(f.source, '가상인물', 3);
    const result = await httpRegister(f, request(f, [
      entry('person', '가상인물', [later]),
      entry('person', '가상인물', [occurrence(f.source, '가상인물', 0)]),
    ]));
    expect(result).toMatchObject({ entries: [
      { index: 0, number: 1, reason: null }, { index: 1, number: 1, reason: null },
    ] });
    expect((await readCaseEntityMapping(t.env, service, f.supportCaseId))!.personCounter).toBe(1);
  });

  it.each(['quote', 'range'] as const)('rejects a well-formed mismatched %s as evidence_hash_mismatch and closes the claim', async mismatch => {
    const f = await claimedFixture();
    const witness = occurrence(f.source, '가상인물', 3);
    const body = request(f, [entry('person', mismatch === 'quote' ? '다른인물' : '가상인물', [
      mismatch === 'range' ? { ...witness, end: witness.end + 1 } : witness,
    ])]);
    const response = await http(service, '/pipeline/entity-registrations', body);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'evidence_hash_mismatch', jobId: f.job.jobId, retryable: false });
    expect(await readCaseEntityMapping(t.env, service, f.supportCaseId)).toBeNull();
    expect(await t.db.prepare('SELECT state,attempt,claim_token_hash,terminal_failure_code FROM agent_jobs WHERE id=?')
      .bind(f.job.jobId).first()).toMatchObject({
        state: 'failed', attempt: f.job.attempt, claim_token_hash: null, terminal_failure_code: 'evidence_hash_mismatch',
      });
  });
  it('allocates numbers by source order rather than request entry order', async () => {
    const f = await claimedFixture();
    const body = request(f, [
      entry('person', '공통이름', [occurrence(f.source, '공통이름', 0)]),
      entry('person', '가상인물', [occurrence(f.source, '가상인물', 0)]),
    ]);
    const result = await registerCaseEntities(t.env, service, body);
    expect(result).toMatchObject({
      outcome: 'applied', entries: [{ index: 0, number: 2 }, { index: 1, number: 1 }],
    });
    expect((await readCaseEntityMapping(t.env, service, f.supportCaseId))!.entities.map(entity => [entity.value, entity.number]))
      .toEqual([['가상인물', 1], ['공통이름', 2]]);
  });

  it('serializes simultaneous registration CAS and does not allocate twice', async () => {
    const f = await claimedFixture();
    const body = request(f, [entry('institution', '공통이름', [occurrence(f.source, '공통이름', 0)])]);
    const results = await Promise.all([registerCaseEntities(t.env, service, body), registerCaseEntities(t.env, service, body)]);
    expect(results[0]).toEqual(results[1]);
    expect(results[0]).toMatchObject({ outcome: 'applied', entries: [{ number: 1, reason: null }] });
    expect(await readCaseEntityMapping(t.env, service, f.supportCaseId)).toMatchObject({ revision: 1, institutionCounter: 1 });
  });

  it('returns ambiguous_identity for conflicting explicit references while preserving the live lease', async () => {
    const f = await claimedFixture();
    const initial = request(f, [
      entry('person', '가상인물', [occurrence(f.source, '가상인물', 0)]),
      entry('person', '무관한별칭', [occurrence(f.source, '무관한별칭', 0)]),
    ]);
    await expect(registerCaseEntities(t.env, service, initial)).resolves.toMatchObject({
      outcome: 'applied', entries: [{ number: 1 }, { number: 2 }],
    });
    const currentSource = await getAgentJobSource(t.env, service, f.job.jobId, f.job.claimToken, f.job.attempt);
    const current = { ...f, source: currentSource };
    const conflicting = request(current, [
      entry('person', '공통이름', [occurrence(currentSource, '공통이름', 0), occurrence(currentSource, '공통이름', 1)], `${f.supportCaseId}:person:1`),
      entry('person', '공통이름', [occurrence(currentSource, '공통이름', 0), occurrence(currentSource, '공통이름', 1)], `${f.supportCaseId}:person:2`),
    ]);
    const before = await readCaseEntityMapping(t.env, service, f.supportCaseId);
    const audits = await mutationAuditCount(f.supportCaseId);
    const first = await httpRegister(current, conflicting);
    expect(first).toMatchObject({
      outcome: 'applied', entries: [{ number: null, reason: 'ambiguous_identity' }, { number: null, reason: 'ambiguous_identity' }],
    });
    const after = await readCaseEntityMapping(t.env, service, f.supportCaseId);
    expect(after!.revision).toBeGreaterThan(before!.revision);
    expect(after).toMatchObject({ personCounter: 2, entities: before!.entities });
    await expect(httpRegister(current, conflicting)).resolves.toEqual(first);
    expect(await mutationAuditCount(f.supportCaseId)).toBe(audits + 1);
    expect(await t.db.prepare('SELECT state,attempt,lease_owner FROM agent_jobs WHERE id=?').bind(f.job.jobId).first())
      .toMatchObject({ state: 'leased', attempt: f.job.attempt, lease_owner: service.userId });
  });

  it('requires an explicit source-backed alias relation and never fuzzy-merges an unproved alias', async () => {
    const f = await claimedFixture();
    await expect(registerCaseEntities(t.env, service, request(f, [
      entry('person', '가상인물', [occurrence(f.source, '가상인물', 0)]),
    ]))).resolves.toMatchObject({ entries: [{ number: 1, reason: null }] });
    const source = await getAgentJobSource(t.env, service, f.job.jobId, f.job.claimToken, f.job.attempt);
    const alias = request({ ...f, source }, [entry('person', '가상별칭', [occurrence(source, '가상별칭', 0)], `${f.supportCaseId}:person:1`)]);
    await expect(registerCaseEntities(t.env, service, alias)).resolves.toMatchObject({ entries: [{ number: 1, reason: null }] });
    const withAlias = await readCaseEntityMapping(t.env, service, f.supportCaseId);
    expect(withAlias!.entities[0]!.aliases.map(item => item.value)).toContain('가상별칭');
    const current = await getAgentJobSource(t.env, service, f.job.jobId, f.job.claimToken, f.job.attempt);
    const noProof = request({ ...f, source: current }, [entry('person', '무관한별칭', [occurrence(current, '무관한별칭', 0)], `${f.supportCaseId}:person:1`)]);
    const beforeNoProof = await readCaseEntityMapping(t.env, service, f.supportCaseId);
    const noProofAudits = await mutationAuditCount(f.supportCaseId);
    const noProofResponse = await registerCaseEntities(t.env, service, noProof);
    expect(noProofResponse).toMatchObject({
      outcome: 'applied', entries: [{ number: null, reason: 'missing_identity_evidence' }],
    });
    const afterNoProof = await readCaseEntityMapping(t.env, service, f.supportCaseId);
    expect(afterNoProof!.revision).toBeGreaterThan(beforeNoProof!.revision);
    expect(afterNoProof).toMatchObject({ personCounter: 1, entities: beforeNoProof!.entities });
    expect(afterNoProof!.entities[0]!.aliases).toEqual(withAlias!.entities[0]!.aliases);
    await expect(registerCaseEntities(t.env, service, noProof)).resolves.toEqual(noProofResponse);
    expect(await mutationAuditCount(f.supportCaseId)).toBe(noProofAudits + 1);
  });
  it('does not allocate for invalid source witnesses or a reference bound to another case', async () => {
    const f = await claimedFixture();
    const valid = occurrence(f.source, '가상인물', 0);
    await expect(registerCaseEntities(t.env, service, request(f, [entry('person', '가상인물', [
      { ...valid, end: valid.end + 1 },
    ])]))).rejects.toThrow();
    await expect(registerCaseEntities(t.env, service, request(f, [entry('person', '가상인물', [
      { ...valid, sourceRevision: 'obsolete-source-revision' },
    ])]))).rejects.toThrow();
    const other = await createCase(t.env, counselor, await registrationInput(t.env, counselor, {
      programId: testProgramId(counselor.orgId),
    }));
    const otherCase = (await listSupportCasesForBeneficiary(t.env, counselor, other.id)).programs[0]!.supportCase.id;
    await expect(registerCaseEntities(t.env, service, request(f, [entry(
      'person', '가상인물', [valid], `${otherCase}:person:1`,
    )]))).rejects.toThrow();
    expect(await readCaseEntityMapping(t.env, service, f.supportCaseId)).toBeNull();
  });

  it('supersedes a stale claim after source mutation before registration', async () => {
    const f = await claimedFixture();
    const body = request(f, [entry('person', '가상인물', [occurrence(f.source, '가상인물', 0)])]);
    await t.db.prepare('UPDATE sessions SET memo=? WHERE id=?').bind('새 원천 텍스트 𠀀', f.sessionId).run();
    const response = await http(service, '/pipeline/entity-registrations', body);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'stale_claim' });
    expect(await t.db.prepare('SELECT state,lease_owner,claim_token_hash FROM agent_jobs WHERE id=?').bind(f.job.jobId).first())
      .toMatchObject({ state: 'failed', lease_owner: null, claim_token_hash: null });
    expect(await t.db.prepare(
      "SELECT COUNT(*) AS count FROM agent_jobs WHERE session_id=? AND id<>? AND state='pending'",
    ).bind(f.sessionId, f.job.jobId).first()).toEqual({ count: 1 });
    expect(await readCaseEntityMapping(t.env, service, f.supportCaseId)).toBeNull();
  });

  it('denies non-service, cross-organization, and consentless registration without map mutation', async () => {
    const f = await claimedFixture();
    const body = request(f, [entry('person', '가상인물', [occurrence(f.source, '가상인물', 0)])]);
    await expect(registerCaseEntities(t.env, counselor, body)).rejects.toThrow();
    await expect(registerCaseEntities(t.env, otherOrgCounselor, body)).rejects.toThrow();
    const response = await http(admin, '/pipeline/entity-registrations', body);
    expect(response.status).toBe(403);
    expect(await readCaseEntityMapping(t.env, service, f.supportCaseId)).toBeNull();

    await t.reset();
    const withoutConsent = await fixture({ consent: false });
    expect(withoutConsent.job).toBeUndefined();
    await expect(registerCaseEntities(t.env, service, {
      family: 'generic', jobId: 'unconsented-job', claimToken: 'unconsented-token', attempt: 1,
      sourceBundleRevision: 'none', expectedMapRevision: 0,
      entries: [],
    })).rejects.toThrow();
    expect(await readCaseEntityMapping(t.env, service, withoutConsent.supportCaseId)).toBeNull();
  });
});
