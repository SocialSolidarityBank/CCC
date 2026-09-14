import { describe, expect, it } from 'vitest';

import {
  createBeneficiaryWithInitialSupportCase,
  createCounselingRecord,
  processParticipantPiiRetention,
  reviewParticipantPiiRetention,
  updateParticipantPii,
} from '@ccc/core/gateway';
import { setupD1, testActors, testProgramId } from './support/d1';
import { registrationInput } from './support/registration';

const t = setupD1();
const counselor = testActors.counselor;
const admin = testActors.admin;

async function makeDueParticipant(name = '파기검증이름') {
  const participant = await createBeneficiaryWithInitialSupportCase(
    t.env,
    counselor,
    await registrationInput(t.env, counselor, {
      programId: testProgramId(counselor.orgId),
      intakeAt: '2025-01-01T09:00:00.000Z',
    }),
  );
  const record = await createCounselingRecord(t.env, counselor, participant.supportCaseId, {
    schemaVersion: 2,
    submissionId: crypto.randomUUID(),
    heldAt: '2025-01-01T10:00:00.000Z',
    channel: 'in_person',
    memo: '파기해야 하는 상담 원문',
    gasScores: [],
    actionItems: [],
    flags: [],
  });
  await updateParticipantPii(t.env, admin, participant.beneficiaryId, {
    supportCaseContextId: participant.supportCaseId,
    expectedVersion: 1,
    name,
    phone: '010-7777-7777',
    account: '777-777',
  });
  await t.db.prepare(
    `UPDATE support_cases SET status='closed',closed_at='2025-01-01T00:00:00.000Z',
       closed_reason='completed',closed_by_actor_id=?,updated_at='2025-01-01T00:00:00.000Z'
     WHERE id=? AND org_id=?`,
  ).bind(counselor.userId, participant.supportCaseId, counselor.orgId).run();
  await processParticipantPiiRetention(t.env, {at: '2026-09-14T00:00:00.000Z'});
  return {...participant, sessionId: record.record.id};
}

async function purge(beneficiaryId: string) {
  return reviewParticipantPiiRetention(
    {...t.env, PII_PURGE_ENABLED: '1'}, admin, beneficiaryId, {decision: 'purge'},
  );
}

describe('F5 privacy purge event writer', () => {
  it('exposes only the frozen non-content event columns and enforces append-only unique history', async () => {
    await t.reset();
    const columns = await t.db.prepare("PRAGMA table_info('privacy_purge_events')").all<{name: string}>();
    expect(columns.results.map(column => column.name)).toEqual([
      'event_id', 'org_id', 'sequence', 'approval_id', 'phase', 'actor_id', 'occurred_at',
      'beneficiary_id', 'lifecycle_id', 'support_case_ids_json', 'namespace_ids_json',
      'source_ids_json', 'previous_event_digest', 'metadata_digest', 'scope_envelope', 'key_version',
    ]);
    expect(columns.results.map(column => column.name)).not.toEqual(expect.arrayContaining([
      'name', 'alias', 'raw_hash', 'body', 'quote', 'free_text',
    ]));
    const tableSql = await t.db.prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='privacy_purge_events'",
    ).first<{sql: string}>();
    expect(tableSql?.sql).toContain('UNIQUE (org_id, sequence)');
    expect(tableSql?.sql).toContain('UNIQUE (approval_id, phase)');
    expect((await t.db.prepare("PRAGMA foreign_key_list('privacy_purge_events')").all()).results).toEqual([]);

    const participant = await makeDueParticipant();
    await purge(participant.beneficiaryId);
    const events = await t.db.prepare(
      'SELECT * FROM privacy_purge_events WHERE org_id=? ORDER BY sequence',
    ).bind(admin.orgId).all<Record<string, unknown>>();
    expect(events.results).toHaveLength(2);
    const intent = events.results[0]!;
    const complete = events.results[1]!;
    expect([intent.phase, complete.phase]).toEqual(['intent', 'complete']);
    expect([intent.sequence, complete.sequence]).toEqual([1, 2]);
    expect(complete.approval_id).toBe(intent.approval_id);
    expect(complete.previous_event_digest).toBe(intent.metadata_digest);
    expect(String(intent.scope_envelope)).not.toContain(participant.beneficiaryId);

    await expect(t.db.prepare('UPDATE privacy_purge_events SET occurred_at=occurred_at WHERE event_id=?')
      .bind(intent.event_id).run()).rejects.toThrow('privacy_purge_events_append_only');
    await expect(t.db.prepare('DELETE FROM privacy_purge_events WHERE event_id=?')
      .bind(intent.event_id).run()).rejects.toThrow('privacy_purge_events_append_only');
    await expect(t.db.prepare(
      `INSERT INTO privacy_purge_events(
         event_id,org_id,sequence,approval_id,phase,actor_id,occurred_at,beneficiary_id,lifecycle_id,
         support_case_ids_json,namespace_ids_json,source_ids_json,previous_event_digest,metadata_digest,
         scope_envelope,key_version)
       SELECT ?,org_id,sequence,approval_id,phase,actor_id,occurred_at,beneficiary_id,lifecycle_id,
         support_case_ids_json,namespace_ids_json,source_ids_json,previous_event_digest,metadata_digest,
         scope_envelope,key_version FROM privacy_purge_events WHERE event_id=?`,
    ).bind(crypto.randomUUID(), intent.event_id).run()).rejects.toThrow();
  });

  it('appends intent then complete only after claims, authorizations, plaintext and encrypted scope are erased', async () => {
    await t.reset();
    const participant = await makeDueParticipant('완료검증이름');
    await t.db.prepare(
      `UPDATE support_cases SET enc_entity_map=?,entity_map_revision=1,entity_map_key_version=1,
       entity_map_lease_family='generic',entity_map_lease_job_id='purge-claim',entity_map_lease_attempt=1,
       entity_map_lease_expires_at='2099-01-01T00:00:00.000Z' WHERE id=?`,
    ).bind('encrypted-map-canary', participant.supportCaseId).run();
    const authorizationId = crypto.randomUUID();
    await t.db.prepare(
      `INSERT INTO agent_job_egress_records(
         id,org_id,consent_revision,provider,status,authorized_at,expires_at,
         support_case_id,session_id,actor_id,operation,config_hash,
         material_refs_json,material_proof_fingerprints_json,binding_fingerprints_json)
       VALUES(?,?,'consent-r1','openai','authorized',?,?,?,?,?,'generate',?,'[]','[]','[]')`,
    ).bind(
      authorizationId, admin.orgId, '2026-09-14T00:00:00.000Z', '2026-09-15T00:00:00.000Z',
      participant.supportCaseId, participant.sessionId, admin.userId, 'a'.repeat(64),
    ).run();

    await expect(purge(participant.beneficiaryId)).resolves.toMatchObject({status: 'purged'});
    const events = await t.db.prepare(
      'SELECT phase FROM privacy_purge_events WHERE beneficiary_id=? ORDER BY sequence',
    ).bind(participant.beneficiaryId).all<{phase: string}>();
    expect(events.results).toEqual([{phase: 'intent'}, {phase: 'complete'}]);
    expect(await t.db.prepare('SELECT memo FROM sessions WHERE id=?').bind(participant.sessionId).first()).toBeNull();
    const erasedCase = await t.db.prepare(
      `SELECT enc_entity_map,entity_map_lease_family,entity_map_lease_job_id,intake_at
       FROM support_cases WHERE id=?`,
    ).bind(participant.supportCaseId).first<Record<string, unknown>>();
    expect(erasedCase).toMatchObject({
      entity_map_lease_family: null,
      entity_map_lease_job_id: null,
      intake_at: null,
    });
    expect(erasedCase?.enc_entity_map).not.toBe('encrypted-map-canary');
    expect(await t.db.prepare(
      'SELECT id FROM agent_job_egress_records WHERE id=?',
    ).bind(authorizationId).first()).toBeNull();
    expect(await t.db.prepare(
      'SELECT enc_name,enc_phone,enc_account,purged_at FROM participant_pii_vault WHERE beneficiary_id=?',
    ).bind(participant.beneficiaryId).first()).toMatchObject({
      enc_name: null, enc_phone: null, enc_account: null, purged_at: expect.any(String),
    });
    expect(await t.db.prepare(
      'SELECT enc_name,review_status FROM participant_pii_archives WHERE beneficiary_id=?',
    ).bind(participant.beneficiaryId).first()).toEqual({enc_name: null, review_status: 'purged'});
  });

  it('fails closed before intent when an audio object has cross-case ownership', async () => {
    await t.reset();
    const target = await makeDueParticipant('범위검증이름');
    const other = await createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      await registrationInput(t.env, counselor, {programId: testProgramId(counselor.orgId)}),
    );
    const otherRecord = await createCounselingRecord(t.env, counselor, other.supportCaseId, {
      schemaVersion: 2, submissionId: crypto.randomUUID(), heldAt: '2026-09-14T10:00:00.000Z',
      channel: 'in_person', memo: '다른 사례 원문', gasScores: [], actionItems: [], flags: [],
    });
    await t.db.prepare(
      `INSERT INTO audio_objects(
         id,org_id,session_id,support_case_id,key,key_hash,state,generation_id,stt_route,stt_engine_id,
         audio_delivery,content_length,content_type,consent_gate_receipt_revision,consent_gate_receipt_json,
         eligible_after,upload_expires_at,retention_hard_cap_at,created_at,updated_at)
       VALUES(?,?,?,?,?,?,'processed_deleted',?,'local','qwen3-asr','api-stream',1,'audio/wav',?,'{}',?,?,?,?,?)`,
    ).bind(
      crypto.randomUUID(), admin.orgId, otherRecord.record.id, target.supportCaseId,
      `privacy-test/${crypto.randomUUID()}`, 'a'.repeat(64), crypto.randomUUID(), 'receipt',
      '2026-09-14T00:00:00.000Z', '2026-09-15T00:00:00.000Z', '2026-09-16T00:00:00.000Z',
      '2026-09-14T00:00:00.000Z', '2026-09-14T00:00:00.000Z',
    ).run();

    await expect(purge(target.beneficiaryId)).rejects.toThrow('privacy purge scope ownership is ambiguous');
    expect(await t.db.prepare('SELECT COUNT(*) AS total FROM privacy_purge_events').first()).toEqual({total: 0});
    expect(await t.db.prepare(
      'SELECT review_status FROM participant_pii_archives WHERE beneficiary_id=?',
    ).bind(target.beneficiaryId).first()).toEqual({review_status: 'pending'});
    expect(await t.db.prepare('SELECT memo FROM sessions WHERE id=?').bind(target.sessionId).first())
      .toEqual({memo: '파기해야 하는 상담 원문'});
  });
});
