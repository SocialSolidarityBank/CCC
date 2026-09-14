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

async function seedOwnedExtendedGraph(
  participant: Awaited<ReturnType<typeof makeDueParticipant>>,
  deletionEvidence: string | null = '{}',
) {
  const stamp = '2026-09-14T00:00:00.000Z';
  const ids = {
    goal: crypto.randomUUID(),
    action: crypto.randomUUID(),
    flag: crypto.randomUUID(),
    schedule: crypto.randomUUID(),
    scheduleGoal: crypto.randomUUID(),
    scheduleQuestion: crypto.randomUUID(),
    snapshot: crypto.randomUUID(),
    evidence: crypto.randomUUID(),
    work: crypto.randomUUID(),
    recordingResult: participant.sessionId,
    consentEvidence: crypto.randomUUID(),
    discrepancy: crypto.randomUUID(),
    audio: crypto.randomUUID(),
    audioAttempt: crypto.randomUUID(),
    audioOutbox: crypto.randomUUID(),
  };
  await t.db.batch([
    t.db.prepare(
      `INSERT INTO goals(id,org_id,support_case_id,title,status,created_at)
       VALUES(?,?,?,'파기할 목표','active',?)`,
    ).bind(ids.goal, admin.orgId, participant.supportCaseId, stamp),
    t.db.prepare(
      `INSERT INTO goal_revisions(org_id,support_case_id,goal_id,title,edited_by,edited_at)
       VALUES(?,?,?,'파기할 목표',?,?)`,
    ).bind(admin.orgId, participant.supportCaseId, ids.goal, counselor.userId, stamp),
    t.db.prepare(
      `INSERT INTO action_items(id,org_id,support_case_id,session_id,description,owner,created_at)
       VALUES(?,?,?,?,'파기할 액션','counselor',?)`,
    ).bind(ids.action, admin.orgId, participant.supportCaseId, participant.sessionId, stamp),
    t.db.prepare(
      `INSERT INTO flags(id,org_id,support_case_id,session_id,flag_type,source,review_status,created_at)
       VALUES(?,?,?,?,'crisis_utterance','counselor','confirmed',?)`,
    ).bind(ids.flag, admin.orgId, participant.supportCaseId, participant.sessionId, stamp),
    t.db.prepare(
      `INSERT INTO counseling_schedules(
         id,org_id,beneficiary_id,support_case_id,scheduled_at,status,version,
         created_by_actor_id,created_at,updated_at)
       VALUES(?,?,?,?,?,'scheduled',1,?,?,?)`,
    ).bind(
      ids.schedule, admin.orgId, participant.beneficiaryId, participant.supportCaseId,
      '2026-09-20T10:00:00.000Z', counselor.userId, stamp, stamp,
    ),
    t.db.prepare(
      `INSERT INTO schedule_session_goals(
         id,org_id,schedule_id,support_case_id,case_goal_id,body,ordinal,created_by,created_at)
       VALUES(?,?,?,?,?,'파기할 회기 목표',1,?,?)`,
    ).bind(
      ids.scheduleGoal, admin.orgId, ids.schedule, participant.supportCaseId,
      ids.goal, counselor.userId, stamp,
    ),
    t.db.prepare(
      `INSERT INTO schedule_custom_questions(
         id,org_id,schedule_id,support_case_id,body,ordinal,created_by,created_at)
       VALUES(?,?,?,?,'파기할 질문',1,?,?)`,
    ).bind(
      ids.scheduleQuestion, admin.orgId, ids.schedule, participant.supportCaseId,
      counselor.userId, stamp,
    ),
    t.db.prepare(
      `INSERT INTO ai_masked_source_snapshots(
         id,org_id,support_case_id,session_id,masked_text,sha256,
         masking_pipeline_version,created_by,created_at)
       VALUES(?,?,?,?,'가림',?,'mask-v1',?,?)`,
    ).bind(
      ids.snapshot, admin.orgId, participant.supportCaseId, participant.sessionId,
      'a'.repeat(64), counselor.userId, stamp,
    ),
    t.db.prepare(
      `INSERT INTO ai_masked_source_evidence_items(
         id,snapshot_id,org_id,support_case_id,session_id,source_ref,source_sha256,
         evidence_quote,source_start,source_end,created_at)
       VALUES(?,?,?,?,?,'source',?,'가림',0,2,?)`,
    ).bind(
      ids.evidence, ids.snapshot, admin.orgId, participant.supportCaseId,
      participant.sessionId, 'a'.repeat(64), stamp,
    ),
    t.db.prepare(
      `INSERT INTO ai_work_items(id,org_id,support_case_id,session_id,kind,created_at)
       VALUES(?,?,?,?,'text_ai_briefing',?)`,
    ).bind(ids.work, admin.orgId, participant.supportCaseId, participant.sessionId, stamp),
    t.db.prepare(
      `INSERT INTO recording_result_commits(
         session_id,org_id,support_case_id,snapshot_id,result_sha256,
         emotion_scores,created_by,created_at)
       VALUES(?,?,?,?,?,'{}',?,?)`,
    ).bind(
      ids.recordingResult, admin.orgId, participant.supportCaseId, ids.snapshot,
      'b'.repeat(64), counselor.userId, stamp,
    ),
    t.db.prepare(
      `INSERT INTO pilot_text_ai_consent_evidence(
         id,org_id,support_case_id,notice_version,notice_sha256,evidence_ref,
         evidence_sha256,captured_by,effective_at,created_at)
       VALUES(?,?,?,'v1',?,'synthetic',?,?,?,?)`,
    ).bind(
      ids.consentEvidence, admin.orgId, participant.supportCaseId, 'c'.repeat(64),
      'd'.repeat(64), counselor.userId, stamp, stamp,
    ),
    t.db.prepare(
      `INSERT INTO session_discrepancies(
         id,org_id,support_case_id,kind,trigger_session_id,left_session_id,left_quote,
         right_session_id,right_quote,detected_at,resolution_status,resolved_by,resolved_at,created_at)
       VALUES(?,?,?,'within_session',?,?,'왼쪽',?,'오른쪽',?,'confirmed',?,?,?)`,
    ).bind(
      ids.discrepancy, admin.orgId, participant.supportCaseId, participant.sessionId,
      participant.sessionId, participant.sessionId, stamp, counselor.userId, stamp, stamp,
    ),
    t.db.prepare(
      `INSERT INTO audio_objects(
         id,org_id,session_id,support_case_id,key,key_hash,state,generation_id,stt_route,stt_engine_id,
         audio_delivery,content_length,content_type,consent_gate_receipt_revision,
         consent_gate_receipt_json,eligible_after,upload_expires_at,retention_hard_cap_at,
         deletion_reason,deletion_attempt_id,deleted_at,deletion_evidence,created_at,updated_at)
       VALUES(?,?,?,?,?,?,'processed_deleted',?,'local','qwen3-asr','api-stream',1,'audio/wav',
         'receipt','{}',?,?,?,'processed',?,?,?,?,?)`,
    ).bind(
      ids.audio, admin.orgId, participant.sessionId, participant.supportCaseId,
      `privacy-test/${ids.audio}`, 'e'.repeat(64), crypto.randomUUID(),
      stamp, '2026-09-15T00:00:00.000Z', '2026-09-16T00:00:00.000Z',
      ids.audioAttempt, stamp, deletionEvidence, stamp, stamp,
    ),
    t.db.prepare(
      `INSERT INTO audio_deletion_attempts(
         id,deletion_attempt_id,phase,org_id,audio_object_id,generation_id,reason,requested_at,
         delete_succeeded,absent_from_list,absent_from_metadata,direct_read_absent,
         verification_method,verified_at,evidence_json,created_at)
       VALUES(?,?,'verification',?,?,?,'processed',?,1,1,1,1,'filesystem-stat-enoent',?,'{}',?)`,
    ).bind(
      crypto.randomUUID(), ids.audioAttempt, admin.orgId, ids.audio,
      crypto.randomUUID(), stamp, stamp, stamp,
    ),
    t.db.prepare(
      `INSERT INTO audio_lifecycle_outbox(id,org_id,audio_object_id,kind,reason,created_at)
       VALUES(?,?,?,'manual_note','processed',?)`,
    ).bind(ids.audioOutbox, admin.orgId, ids.audio, stamp),
  ]);
  return ids;
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
  it('deletes every proven-owned F5B graph row before appending complete', async () => {
    await t.reset();
    const participant = await makeDueParticipant('확장그래프이름');
    const ids = await seedOwnedExtendedGraph(participant);
    await expect(t.db.prepare(
      'DELETE FROM goal_revisions WHERE org_id=? AND goal_id=?',
    ).bind(admin.orgId, ids.goal).run()).rejects.toThrow('D62: goal_revisions is append-only');

    await expect(purge(participant.beneficiaryId)).resolves.toMatchObject({status: 'purged'});
    const phases = await t.db.prepare(
      'SELECT phase,source_ids_json FROM privacy_purge_events WHERE beneficiary_id=? ORDER BY sequence',
    ).bind(participant.beneficiaryId).all<{phase: string; source_ids_json: string}>();
    expect(phases.results.map(row => row.phase)).toEqual(['intent', 'complete']);
    const sources = JSON.parse(phases.results[0]!.source_ids_json) as string[];
    expect(sources).toEqual(expect.arrayContaining([
      `audio:${ids.audio}`, `goal:${ids.goal}`, `action-item:${ids.action}`,
      `flag:${ids.flag}`, `schedule:${ids.schedule}`, `snapshot:${ids.snapshot}`,
      `ai-work:${ids.work}`, `discrepancy:${ids.discrepancy}`,
    ]));
    for (const [table, id] of [
      ['audio_objects', ids.audio],
      ['goals', ids.goal],
      ['action_items', ids.action],
      ['flags', ids.flag],
      ['counseling_schedules', ids.schedule],
      ['ai_masked_source_snapshots', ids.snapshot],
      ['ai_work_items', ids.work],
      ['session_discrepancies', ids.discrepancy],
    ] as const) {
      expect(await t.db.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(id).first()).toBeNull();
    }
    for (const [table, column, id] of [
      ['action_item_revisions', 'action_item_id', ids.action],
      ['schedule_question_revisions', 'question_id', ids.scheduleQuestion],
      ['schedule_session_goals', 'id', ids.scheduleGoal],
      ['schedule_custom_questions', 'id', ids.scheduleQuestion],
      ['ai_masked_source_evidence_items', 'id', ids.evidence],
      ['recording_result_commits', 'session_id', ids.recordingResult],
      ['pilot_text_ai_consent_evidence', 'id', ids.consentEvidence],
      ['audio_deletion_attempts', 'audio_object_id', ids.audio],
      ['audio_lifecycle_outbox', 'id', ids.audioOutbox],
    ] as const) {
      expect(await t.db.prepare(`SELECT 1 AS present FROM ${table} WHERE ${column}=?`)
        .bind(id).first()).toBeNull();
    }
  });
  it('rejects terminal audio without an actual deletion proof before intent', async () => {
    await t.reset();
    const participant = await makeDueParticipant('삭제증명없음');
    await seedOwnedExtendedGraph(participant, null);

    await expect(purge(participant.beneficiaryId))
      .rejects.toThrow('privacy purge residual scope is not supported');
    expect(await t.db.prepare('SELECT COUNT(*) AS total FROM privacy_purge_events').first())
      .toEqual({total: 0});
  });


  it('fails closed before intent when a discrepancy points at another case session', async () => {
    await t.reset();
    const target = await makeDueParticipant('직접귀속검증이름');
    const other = await createBeneficiaryWithInitialSupportCase(
      t.env,
      counselor,
      await registrationInput(t.env, counselor, {programId: testProgramId(counselor.orgId)}),
    );
    const otherRecord = await createCounselingRecord(t.env, counselor, other.supportCaseId, {
      schemaVersion: 2, submissionId: crypto.randomUUID(), heldAt: '2026-09-14T10:00:00.000Z',
      channel: 'in_person', memo: '다른 사례 원문', gasScores: [], actionItems: [], flags: [],
    });
    const discrepancyId = crypto.randomUUID();
    await t.db.prepare(
      `INSERT INTO session_discrepancies(
         id,org_id,support_case_id,kind,trigger_session_id,left_session_id,left_quote,
         right_session_id,right_quote,detected_at,created_at)
       VALUES(?,?,?,'cross_session',?,?,'대상 사례',?,'다른 사례',
         '2026-09-14T00:00:00.000Z','2026-09-14T00:00:00.000Z')`,
    ).bind(
      discrepancyId, admin.orgId, target.supportCaseId, target.sessionId,
      target.sessionId, otherRecord.record.id,
    ).run();

    await expect(purge(target.beneficiaryId)).rejects.toThrow('privacy purge scope ownership is ambiguous');
    expect(await t.db.prepare('SELECT COUNT(*) AS total FROM privacy_purge_events').first())
      .toEqual({total: 0});
    expect(await t.db.prepare('SELECT id FROM session_discrepancies WHERE id=?')
      .bind(discrepancyId).first()).toEqual({id: discrepancyId});
  });

  it('keeps only intent when a proven-owned residual refuses deletion', async () => {
    await t.reset();
    const participant = await makeDueParticipant('잔존검증이름');
    const flagId = crypto.randomUUID();
    await t.db.prepare(
      `INSERT INTO flags(id,org_id,support_case_id,session_id,flag_type,source,review_status,created_at)
       VALUES(?,?,?,?,'crisis_utterance','counselor','confirmed','2026-09-14T00:00:00.000Z')`,
    ).bind(flagId, admin.orgId, participant.supportCaseId, participant.sessionId).run();
    await t.db.prepare(
      `CREATE TRIGGER f5b_synthetic_delete_failure BEFORE DELETE ON flags
       WHEN OLD.id='${flagId}' BEGIN SELECT RAISE(ABORT,'synthetic_f5b_delete_failure'); END`,
    ).run();

    await expect(purge(participant.beneficiaryId)).rejects.toThrow();
    expect(await t.db.prepare(
      'SELECT phase FROM privacy_purge_events WHERE beneficiary_id=? ORDER BY sequence',
    ).bind(participant.beneficiaryId).all()).toMatchObject({results: [{phase: 'intent'}]});
    expect(await t.db.prepare('SELECT id FROM flags WHERE id=?').bind(flagId).first())
      .toEqual({id: flagId});
  });

});
