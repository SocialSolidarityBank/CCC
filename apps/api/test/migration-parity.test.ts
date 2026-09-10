import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { startPostgresHarness, type PostgresHarness } from './support/postgres';
import {
  PARITY_MANIFEST_PATH, assertFingerprint, assertLogicalParity, canonical, checkpointSources,
  collectCatalog, dialectSemantics, fingerprint, hash, identifier, openParityDatabase,
  physicalRules, timestampInventory, type Catalog, type ParityDatabase, type TimestampColumn,
  seedScheduleDisplaySchema, proveScheduleDisplaySchema,
  seedPreregistrationConsentSchema, provePreregistrationConsentSchema,
  proveStaffInvitesSchema, proveParticipantRequestLinksSchema,
  proveCanonicalCompatibilityViews,
} from './support/migration-parity';

let harness: PostgresHarness;
// From repository root: CCC_UPDATE_MIGRATION_PARITY=1 pnpm exec vitest run --config apps/api/vitest.config.ts apps/api/test/migration-parity.test.ts --maxWorkers 1
beforeAll(async () => { harness = await startPostgresHarness(); }, 240_000);
afterAll(async () => { await harness?.dispose(); }, 150_000);
const legacy = '2026-01-01 09:00:00';
const normalizedLegacy = '2026-01-01T09:00:00.000Z';
const modern = '2026-01-01T09:00:00.500Z';
const iso = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
interface TimestampProof {
  table: string; column: string; rewritten: string; orderedIds: string[];
  output: 'default' | 'trigger' | 'bound';
  strategy: 'independent-legal-snapshots';
}
interface TimestampWitness {
  table: string; column: string; where: Record<string, string | number>;
  output: TimestampProof['output'];
}

/**
 * A complete legal graph, not shadow timestamp tables. Mutually exclusive archive
 * states use different beneficiaries. The cutover singleton always has one row.
 * Legacy and modern graphs live in independently migrated databases.
 */
async function seedTimestampGraph(fixture: ParityDatabase, inventory: TimestampColumn[], stamp: string, defaults: boolean): Promise<TimestampWitness[]> {
  const db = fixture.db;
  const witnesses = new Map<string, TimestampWitness>();
  const remember = (table: string, column: string, where: TimestampWitness['where'], output: TimestampProof['output']) => {
    const key = `${table}.${column}`;
    if (!witnesses.has(key)) witnesses.set(key, { table, column, where, output });
  };
  const put = async (table: string, input: Record<string, string | number | null>, where: TimestampWitness['where'] = { id: input.id as string }) => {
    const row = { ...input };
    for (const target of inventory.filter((entry) => entry.table === table)) {
      if (row[target.column] !== stamp) continue;
      const generated = defaults && target.default !== null;
      if (generated) delete row[target.column];
      remember(table, target.column, where, generated ? 'default' : 'bound');
    }
    const columns = Object.keys(row);
    await db.prepare(`INSERT INTO ${identifier(table)} (${columns.map(identifier).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).bind(...columns.map((column) => row[column]!)).run();
  };
  const org = 'timestamp-org', admin = 'timestamp-admin', worker = 'timestamp-worker', service = 'timestamp-service';
  const beneficiary = 'A901', supportCase = 'timestamp-case', session = 'timestamp-session';
  const digest = 'a'.repeat(64);
  await put('organization_settings', { org_id: org, time_zone: 'UTC', pii_purge_grace_days: 180, created_at: stamp, updated_at: stamp }, { org_id: org });
  for (const [id, role] of [[admin, 'admin'], [worker, 'counselor'], [service, 'service']] as const) {
    await put('users', { id, org_id: org, email: `${id}@example.invalid`, role, active: 1, created_at: stamp });
  }
  remember('user_role_assignments', 'granted_at', { user_id: worker, role: 'practitioner' }, 'trigger');
  await put('beneficiaries', { id: beneficiary, org_id: org, initialization_state: 'pending', created_at: stamp, updated_at: stamp });
  await put('support_cases', {
    id: supportCase, org_id: org, beneficiary_id: beneficiary, legacy_case_id: beneficiary,
    status: 'active', creation_kind: 'initial', intake_at: stamp,
    consent_recording_at: stamp, consent_text_ai_at: stamp, consent_privacy_at: stamp, created_at: stamp, updated_at: stamp,
  });
  await put('support_case_assignees', { id: 'timestamp-assignment', org_id: org, support_case_id: supportCase,
    user_id: worker, role: 'primary', status: 'active', assigned_at: stamp, accepted_at: stamp,
    notified_by: admin, notified_at: stamp });
  for (const [action, table, id, caseId] of [
    ['create', 'beneficiaries', beneficiary, null],
    ['create', 'support_cases', supportCase, supportCase],
    ['assign', 'support_case_assignees', 'timestamp-assignment', supportCase],
  ] as const) {
    await put('audit_log', { org_id: org, actor_id: admin, actor_role: 'admin', action,
      target_table: table, target_id: id, beneficiary_id: beneficiary, support_case_id: caseId, created_at: stamp },
    { org_id: org, target_table: table, target_id: id, action });
  }
  await db.prepare(`UPDATE beneficiaries SET initialization_state='complete' WHERE id=?`).bind(beneficiary).run();
  await put('sessions', { id: session, org_id: org, support_case_id: supportCase, counselor_id: worker,
    held_at: stamp, channel: 'in_person', memo: 'Synthetic timestamp witness', submission_id: 'timestamp-submission',
    submission_hash: digest, submitted_by: worker, ai_status: 'none', speaker_mapping_confirmed_at: stamp,
    created_at: stamp, updated_at: stamp });
  await put('goals', { id: 'timestamp-goal', org_id: org, support_case_id: supportCase, title: 'Synthetic goal',
    status: 'closed', closed_reason: 'achieved', closed_at: stamp, created_at: stamp });
  await put('goal_revisions', { id: 9001, org_id: org, support_case_id: supportCase, goal_id: 'timestamp-goal',
    title: 'Synthetic goal', edited_by: worker, edited_at: stamp }, { id: 9001 });
  await put('counseling_schedules', { id: 'timestamp-schedule', org_id: org, beneficiary_id: beneficiary,
    support_case_id: supportCase, scheduled_at: stamp, status: 'completed', version: 1,
    completed_session_id: session, created_by_actor_id: worker, updated_by_actor_id: worker,
    completed_by_actor_id: worker, completed_at: stamp, created_at: stamp, updated_at: stamp });
  await put('schedule_custom_questions', { id: 'timestamp-question', org_id: org, schedule_id: 'timestamp-schedule',
    support_case_id: supportCase, body: 'Synthetic question', ordinal: 0, created_by: worker, created_at: stamp });
  await put('schedule_session_goals', { id: 'timestamp-session-goal', org_id: org, schedule_id: 'timestamp-schedule',
    support_case_id: supportCase, body: 'Synthetic session goal', ordinal: 0, created_by: worker, created_at: stamp });
  await put('action_items', { id: 'timestamp-action', org_id: org, support_case_id: supportCase, session_id: session,
    description: 'Synthetic action', owner: 'counselor', resolved_at: stamp, resolved_by: worker,
    resolution_status: 'done', resolution_at: stamp, resolution_session_id: session, created_at: stamp });
  await put('flags', { id: 'timestamp-flag', org_id: org, support_case_id: supportCase, session_id: session,
    flag_type: 'debt_deterioration', quote: 'Synthetic quotation', source: 'counselor', review_status: 'confirmed',
    reviewed_by: worker, reviewed_at: stamp, created_at: stamp });
  await put('session_goal_scores', { id: 'timestamp-score', org_id: org, session_id: session,
    goal_id: 'timestamp-goal', score: 0, scored_by: worker, created_at: stamp });
  await put('ai_gas_evidence', { id: 'timestamp-gas', org_id: org, session_id: session,
    goal_id: 'timestamp-goal', quote: 'Synthetic quotation', created_at: stamp });
  await put('session_life_area_snapshots', { id: 'timestamp-life', org_id: org, session_id: session,
    area_key: 'economy', status: 'okay', created_at: stamp });
  await put('session_discrepancies', { id: 'timestamp-discrepancy', org_id: org, support_case_id: supportCase,
    kind: 'within_session', trigger_session_id: session, left_session_id: session, left_quote: 'Synthetic left',
    right_session_id: session, right_quote: 'Synthetic right', detected_at: stamp, resolution_status: 'confirmed',
    resolved_by: worker, resolved_at: stamp, created_at: stamp });
  await put('invite_tokens', { token: 'timestamp-invite', org_id: org, kind: 'counselor', issued_by: admin,
    status: 'used', used_at: stamp, used_by_user_id: worker, revoked_at: stamp, issued_at: stamp }, { token: 'timestamp-invite' });
  // The three consent values must equal recorded_at; exercise its default on a
  // separate legal all-null consent row instead of breaking that invariant.
  await put('participant_consent_records', { id: 'timestamp-consent-default', org_id: org,
    beneficiary_id: beneficiary, support_case_id: supportCase, recorded_by: worker, recorded_at: stamp, created_at: stamp });
  await db.prepare(`INSERT INTO participant_consent_records(id,org_id,beneficiary_id,support_case_id,
    consent_recording_at,consent_text_ai_at,consent_privacy_at,recorded_by,recorded_at,created_at,
    privacy_notice_version,privacy_notice_sha256,privacy_evidence_ref) VALUES (?,?,?,?,?,?,?,?,?,?,'v1.0',?,'offline://synthetic')`)
    .bind('timestamp-consent', org, beneficiary, supportCase, stamp, stamp, stamp, worker, stamp, stamp, digest).run();
  for (const column of ['consent_recording_at', 'consent_text_ai_at', 'consent_privacy_at'])
    remember('participant_consent_records', column, { id: 'timestamp-consent' }, 'bound');
  await put('teams', { id: 'timestamp-team', org_id: org, name: 'Synthetic team', created_by: admin, created_at: stamp });
  await put('team_memberships', { id: 'timestamp-membership', org_id: org, team_id: 'timestamp-team',
    user_id: worker, added_by: admin, joined_at: stamp, ended_at: stamp });
  await put('team_supervisor_grants', { id: 'timestamp-supervisor', org_id: org, team_id: 'timestamp-team',
    supervisor_user_id: admin, granted_by: admin, granted_at: stamp, revoked_at: stamp });
  await db.prepare('UPDATE teams SET archived_at=? WHERE id=?').bind(stamp, 'timestamp-team').run();
  remember('teams', 'archived_at', { id: 'timestamp-team' }, 'bound');
  await put('agent_installations', { installation_id: 'timestamp-installation', org_id: org,
    actor_user_id: service, paired_at: stamp, revoked_at: stamp }, { installation_id: 'timestamp-installation' });
  await put('auth_revocations', { id: 'timestamp-revocation', kind: 'session', subject: 'synthetic-session',
    revoked_at: stamp, reason: 'logout' });
  await put('ai_provider_configs', { id: 'timestamp-provider', org_id: org, adapter_id: 'codex', adapter_version: 'v1',
    config_hash: digest, approval_refs_json: '["synthetic"]', created_by: admin, created_at: stamp });
  await put('ai_provider_activations', { id: 'timestamp-activation', org_id: org, config_id: 'timestamp-provider',
    activated_by: admin, activated_at: stamp });
  await put('pilot_text_ai_consent_evidence', { id: 'timestamp-ai-consent', org_id: org, support_case_id: supportCase,
    notice_version: 'v1.0', notice_sha256: digest, evidence_ref: 'offline://synthetic', evidence_sha256: digest,
    captured_by: worker, effective_at: stamp, created_at: stamp });
  await put('ai_masked_source_snapshots', { id: 'timestamp-snapshot', org_id: org, support_case_id: supportCase,
    session_id: session, masked_text: 'Synthetic', sha256: digest, masking_pipeline_version: 'v1',
    created_by: service, created_at: stamp });
  await put('ai_masked_source_evidence_items', { id: 'timestamp-evidence', snapshot_id: 'timestamp-snapshot',
    org_id: org, support_case_id: supportCase, session_id: session, source_ref: 'memo:timestamp-snapshot',
    source_sha256: digest, evidence_quote: 'Synthetic', source_start: 0, source_end: 9, created_at: stamp });
  await put('ai_work_items', { id: 'timestamp-work', org_id: org, support_case_id: supportCase,
    session_id: session, kind: 'text_ai_briefing', created_at: stamp });
  await put('ai_draft_versions', { id: 'timestamp-draft', work_item_id: 'timestamp-work', version: 1,
    summary_text: 'Synthetic', questions_json: '["Synthetic first?","Synthetic second?"]',
    source_snapshot_id: 'timestamp-snapshot', source_snapshot_hash: digest, consent_evidence_id: 'timestamp-ai-consent',
    provider_config_id: 'timestamp-provider', model_id: 'synthetic', prompt_version: 'v1', schema_version: 'v1',
    origin: 'generated', creation_mode: 'provider_generated', grounding_status: 'grounded', created_by: worker, created_at: stamp });
  await put('ai_draft_source_materials', { id: 'timestamp-material', draft_version_id: 'timestamp-draft',
    org_id: org, support_case_id: supportCase, session_id: session, kind: 'text_context',
    snapshot_id: 'timestamp-snapshot', snapshot_sha256: digest, created_at: stamp });
  await put('ai_draft_contrast_axes', { id: 'timestamp-contrast', draft_version_id: 'timestamp-draft',
    org_id: org, support_case_id: supportCase, axis: 'missing_from_transcript', status: 'no_transcript',
    findings_json: '[]', created_at: stamp });
  for (const claim of ['summary', 'question_1', 'question_2']) {
    await put('ai_evidence_links', { id: `timestamp-link-${claim}`, draft_version_id: 'timestamp-draft',
      source_evidence_item_id: 'timestamp-evidence', claim_key: claim, evidence_quote: 'Synthetic',
      source_ref: 'memo:timestamp-snapshot', source_start: 0, source_end: 9, created_at: stamp });
  }
  await put('ai_review_events', { id: 'timestamp-review', work_item_id: 'timestamp-work',
    draft_version_id: 'timestamp-draft', decision: 'approved', actor_id: worker, created_at: stamp });
  await db.prepare(`UPDATE sessions SET ai_status='approved',ai_summary='Synthetic',approved_by=?,
    approved_at=(SELECT created_at FROM ai_review_events WHERE id='timestamp-review') WHERE id=?`).bind(worker, session).run();
  remember('sessions', 'approved_at', { id: session }, 'bound');
  // A second inactive activation covers deactivation without invalidating the
  // provenance of the approved draft. Its bound timestamps satisfy the CHECK.
  await db.prepare(`INSERT INTO ai_provider_activations(id,org_id,config_id,activated_by,activated_at,deactivated_at)
    VALUES ('timestamp-inactive',?,'timestamp-provider',?,?,?)`).bind(org, admin, stamp, stamp).run();
  remember('ai_provider_activations', 'deactivated_at', { id: 'timestamp-inactive' }, 'bound');
  await put('ai_text_work_queue', { id: 'timestamp-queue', org_id: org, support_case_id: supportCase, session_id: session,
    reason: 'manual_record', status: 'done', enqueued_at: stamp, completed_at: stamp, lease_owner: service,
    lease_expires_at: stamp, attempt_count: 1, completed_snapshot_id: 'timestamp-snapshot' });
  await put('recording_result_commits', { session_id: session, org_id: org, support_case_id: supportCase,
    snapshot_id: 'timestamp-snapshot', result_sha256: digest, emotion_scores: '{}', created_by: service,
    created_at: stamp, downstream_claimed_at: stamp, finalized_at: stamp }, { session_id: session });
  // Emergency registration and privacy consent cannot coexist on one case.
  await put('beneficiaries', { id: 'A902', org_id: org, initialization_state: 'pending', created_at: stamp, updated_at: stamp });
  await put('support_cases', { id: 'timestamp-emergency', org_id: org, beneficiary_id: 'A902', status: 'active',
    creation_kind: 'initial', emergency_registration_at: stamp, emergency_registration_reason: 'Synthetic emergency',
    consent_privacy_due_at: stamp, created_at: stamp, updated_at: stamp });
  await db.prepare(`UPDATE support_case_assignees SET status='ended',unassigned_at=?,transfer_reason='Synthetic end' WHERE id='timestamp-assignment'`).bind(stamp).run();
  remember('support_case_assignees', 'unassigned_at', { id: 'timestamp-assignment' }, 'bound');
  await db.prepare(`UPDATE support_cases SET status='closed',closed_at=?,closed_reason='completed',closed_by_actor_id=? WHERE id=?`).bind(stamp, admin, supportCase).run();
  remember('support_cases', 'closed_at', { id: supportCase }, 'bound');
  for (const [index, state] of ['pending', 'retained', 'purged'].entries()) {
    const person = `A90${index + 3}`, archive = `timestamp-archive-${state}`;
    await put('beneficiaries', { id: person, org_id: org, initialization_state: 'pending', created_at: stamp, updated_at: stamp });
    await put('participant_pii_vault', { beneficiary_id: person, org_id: org, key_version: 1, version: 1,
      purge_due: stamp, retention_change_kind: 'create', retention_changed_by: admin, retention_changed_at: stamp,
      created_at: stamp, updated_at: stamp }, { beneficiary_id: person });
    await put('participant_pii_archives', { id: archive, beneficiary_id: person, org_id: org, key_version: 1,
      archived_at: stamp, archived_by: 'system:retention', retention_cap_due_at: stamp, review_status: 'pending',
      review_due_at: stamp, state_changed_by: 'system:retention', state_changed_by_role: 'service',
      state_changed_at: stamp, created_at: stamp, updated_at: stamp });
    if (state === 'pending') continue;
    await put('participant_pii_retention_decisions', { id: `timestamp-decision-${state}`, archive_id: archive,
      org_id: org, beneficiary_id: person, decision: state === 'retained' ? 'retain' : 'purge',
      reason_kind: state === 'retained' ? 'legal_requirement' : null,
      reason: state === 'retained' ? 'Synthetic legal retention' : null,
      retain_until: state === 'retained' ? '2027-01-01T09:00:00.000Z' : null, decided_by: admin, decided_at: stamp });
    if (state === 'retained') {
      await db.prepare(`UPDATE participant_pii_archives SET review_status='retained',review_reason_kind='legal_requirement',
        review_reason='Synthetic legal retention',reviewed_by=?,reviewed_at=?,review_due_at='2027-01-01T09:00:00.000Z',
        state_changed_by=?,state_changed_by_role='admin',state_changed_at=?,updated_at=? WHERE id=?`)
        .bind(admin, stamp, admin, stamp, stamp, archive).run();
      remember('participant_pii_archives', 'reviewed_at', { id: archive }, 'bound');
    } else {
      await db.prepare(`UPDATE participant_pii_archives SET review_status='approved',approved_by=?,approved_at=?,
        state_changed_by=?,state_changed_by_role='admin',state_changed_at=?,updated_at=? WHERE id=?`)
        .bind(admin, stamp, admin, stamp, stamp, archive).run();
      remember('participant_pii_archives', 'approved_at', { id: archive }, 'bound');
      remember('participant_pii_archives', 'purged_at', { id: archive }, 'trigger');
      remember('participant_pii_vault', 'purged_at', { beneficiary_id: person }, 'trigger');
    }
  }
  await db.prepare(`UPDATE user_role_assignments SET revoked_at=? WHERE user_id=? AND role='practitioner'`).bind(stamp, worker).run();
  remember('user_role_assignments', 'revoked_at', { user_id: worker, role: 'practitioner' }, 'bound');
  const singleton = 'participant_support_case_cutover_manifest';
  expect(await db.prepare(`SELECT count(*) AS count FROM ${singleton}`).first('count')).toBe(1);
  await db.prepare(`UPDATE ${singleton} SET completed_at=?`).bind(stamp).run();
  remember(singleton, 'completed_at', { migration_id: '0006_participant_support_case_cutover' }, 'bound');
  if (defaults) {
    // Recreate the one legal singleton row with its actual default; never insert
    // a second migration_id or remove its CHECK/primary key.
    await db.prepare(`DELETE FROM ${singleton}`).run();
    await db.prepare(`INSERT INTO ${singleton}(migration_id,beneficiary_count,support_case_count,session_count,approved_ai_count,pii_vault_count,legacy_case_map_count)
      VALUES ('0006_participant_support_case_cutover',0,0,0,0,0,0)`).run();
    witnesses.get(`${singleton}.completed_at`)!.output = 'default';
    expect(await db.prepare(`SELECT count(*) AS count FROM ${singleton}`).first('count')).toBe(1);
    await put('users', { id: 'timestamp-role-sync', org_id: org, email: 'timestamp-role-sync@example.invalid',
      role: 'counselor', active: 1, created_at: stamp });
    await db.prepare(`UPDATE users SET role='admin' WHERE id='timestamp-role-sync'`).run();
    const roleClocks = (await db.prepare(`SELECT granted_at,revoked_at FROM user_role_assignments WHERE user_id='timestamp-role-sync'`)
      .all<{ granted_at: string; revoked_at: string | null }>()).results;
    expect(roleClocks).toHaveLength(3);
    for (const row of roleClocks) {
      expect(row.granted_at).toMatch(iso);
      if (row.revoked_at !== null) expect(row.revoked_at).toMatch(iso);
    }
    await put('beneficiaries', { id: 'A906', org_id: org, initialization_state: 'pending', created_at: stamp, updated_at: stamp });
    await put('support_cases', { id: 'timestamp-retention-case', org_id: org, beneficiary_id: 'A906', status: 'active',
      creation_kind: 'initial', created_at: stamp, updated_at: stamp });
    await put('participant_pii_vault', { beneficiary_id: 'A906', org_id: org, key_version: 1, version: 1,
      retention_change_kind: 'create', retention_changed_by: admin, retention_changed_at: stamp, created_at: stamp, updated_at: stamp },
    { beneficiary_id: 'A906' });
    await db.prepare(`UPDATE support_cases SET status='closed',closed_at=?,closed_reason='completed',
      closed_by_actor_id=? WHERE id='timestamp-retention-case'`).bind(stamp, admin).run();
    const scheduled = await db.prepare(`SELECT purge_due,retention_changed_at,updated_at FROM participant_pii_vault WHERE beneficiary_id='A906'`)
      .first<{ purge_due: string; retention_changed_at: string; updated_at: string }>();
    expect(scheduled?.purge_due).toBe('2026-06-30T09:00:00.500Z');
    expect(scheduled?.retention_changed_at).toMatch(iso);
    expect(scheduled?.updated_at).toMatch(iso);
    // This includes database-produced submission, archive, review and purge
    // audit records, not just the explicitly inserted timestamp audit rows.
    const audits = (await db.prepare('SELECT created_at FROM audit_log').all<{ created_at: string }>()).results;
    for (const row of audits) expect(row.created_at).toMatch(iso);
  }
  expect([...witnesses.keys()].sort(), 'Every live timestamp needs a legal graph witness')
    .toEqual(inventory.map(({ table, column }) => `${table}.${column}`).sort());
  return [...witnesses.values()].sort((a, b) => `${a.table}.${a.column}`.localeCompare(`${b.table}.${b.column}`, 'en'));
}
async function recoverTimestamp(fixture: ParityDatabase, witness: TimestampWitness): Promise<string> {
  const keys = Object.keys(witness.where);
  const result = await fixture.db.prepare(`SELECT ${identifier(witness.column)} AS value FROM ${identifier(witness.table)}
    WHERE ${keys.map((key) => `${identifier(key)}=?`).join(' AND ')}`).bind(...keys.map((key) => witness.where[key]!)).all<{ value: string }>();
  expect(result.results, `${witness.table}.${witness.column} unique witness`).toHaveLength(1);
  return result.results[0]!.value;
}
async function timestampProofs(orderingFixture: ParityDatabase, inventory: TimestampColumn[]): Promise<TimestampProof[]> {
  const sources = checkpointSources().slice(0, 3);
  const recovered: Array<Map<string, { value: string; output: TimestampProof['output'] }>> = [];
  for (const mode of ['legacy', 'modern', 'output'] as const) {
    const snapshot = await openParityDatabase(orderingFixture.profile, harness);
    try {
      const engine = snapshot.profile === 'postgres' ? 'postgres' : 'sqlite';
      await snapshot.apply(sources[0]![engine]);
      if (mode === 'output') for (const checkpoint of sources.slice(1)) await snapshot.apply(checkpoint[engine]);
      const stamp = mode === 'legacy' ? legacy : modern;
      const witnesses = await seedTimestampGraph(snapshot, inventory, stamp, mode === 'output');
      if (mode !== 'output') {
        for (const witness of witnesses) expect(await recoverTimestamp(snapshot, witness), `${witness.table}.${witness.column} pre-migration`).toBe(stamp);
        for (const checkpoint of sources.slice(1)) {
          try {
            await snapshot.apply(checkpoint[engine]);
          } catch (error) {
            const subtype = error instanceof Error && 'constraintSubtype' in error ? error.constraintSubtype : 'unknown';
            throw new Error(`${engine} ${checkpoint.id} ${mode} timestamp replay failed (${subtype})`, { cause: error });
          }
        }
      }
      const values = new Map<string, { value: string; output: TimestampProof['output'] }>();
      for (const witness of witnesses) {
        const value = await recoverTimestamp(snapshot, witness);
        if (mode === 'output') expect(value, `${witness.table}.${witness.column} post-migration output`).toMatch(iso);
        else expect(value, `${witness.table}.${witness.column} migrated value`).toBe(mode === 'legacy' ? normalizedLegacy : modern);
        values.set(`${witness.table}.${witness.column}`, { value, output: witness.output });
      }
      recovered.push(values);
    } finally { await snapshot.dispose(); }
  }
  const proofs: TimestampProof[] = [];
  for (const { table, column } of inventory) {
    const key = `${table}.${column}`;
    // Values come from the two persisted, migrated snapshots. Cast to TEXT and
    // sort in this same database engine, not JavaScript or a timestamp cast.
    const orderedIds = (await orderingFixture.db.prepare(`SELECT id FROM (
      SELECT CAST(? AS TEXT) AS value,'legacy-0ms' AS id
      UNION ALL SELECT CAST(? AS TEXT),'new-500ms') AS recovered ORDER BY value,id`)
      .bind(recovered[0]!.get(key)!.value, recovered[1]!.get(key)!.value).all<{ id: string }>()).results.map(({ id }) => id);
    expect(orderedIds, key).toEqual(['legacy-0ms', 'new-500ms']);
    proofs.push({ table, column, rewritten: recovered[0]!.get(key)!.value, orderedIds,
      output: recovered[2]!.get(key)!.output, strategy: 'independent-legal-snapshots' });
  }
  return proofs;
}

async function proveProgramAdmissionSchema(fixture: ParityDatabase): Promise<void> {
  const db = fixture.db;
  const orgId = 'parity-admission-org';
  const id = `legacy-program:${orgId}`;
  expect(await db.prepare(
    `SELECT storage_mode, processing_mode, admission_confirmed_by, admission_confirmed_at
     FROM programs WHERE id = ? AND org_id = ?`,
  ).bind(id, orgId).first()).toEqual({
    storage_mode: 'undecided', processing_mode: 'undecided',
    admission_confirmed_by: null, admission_confirmed_at: null,
  });
  await db.prepare('INSERT INTO programs (id, org_id) VALUES (?, ?)')
    .bind('parity-foreign-program', 'parity-foreign-org').run();
  await expect(db.prepare('UPDATE organization_settings SET initial_program_id = ? WHERE org_id = ?')
    .bind('parity-foreign-program', orgId).run()).rejects.toThrow();
  await expect(db.prepare('UPDATE programs SET admission_confirmed_by = ? WHERE id = ?')
    .bind('partial-confirmation', id).run()).rejects.toThrow();
  await expect(db.batch([
    db.prepare('UPDATE programs SET display_name = ? WHERE id = ?').bind('Must roll back', id),
    db.prepare('INSERT INTO program_admission_guards (id, org_id, valid) VALUES (?, ?, 0)')
      .bind('parity-invalid-admission', orgId),
  ])).rejects.toThrow();
  expect(await db.prepare('SELECT display_name, admission_confirmed_by FROM programs WHERE id = ?')
    .bind(id).first()).toEqual({ display_name: null, admission_confirmed_by: null });
  expect(await db.prepare('SELECT initial_program_id FROM organization_settings WHERE org_id = ?')
    .bind(orgId).first()).toEqual({ initial_program_id: id });
}

async function proveDrift(fixture: ParityDatabase, original: Catalog): Promise<void> {
  const expected = fingerprint(original);
  const index = original.indexes.find((entry) => entry.name === 'idx_users_org');
  const trigger = original.triggers.find((entry) => entry.name === 'audit_log_no_update');
  if (!index || !trigger) throw new Error('Required mutation targets missing from live catalog.');
  await fixture.db.prepare(`DROP INDEX ${identifier(index.name)}`).run();
  const withoutIndex = await collectCatalog(fixture);
  expect(() => assertFingerprint(withoutIndex, expected)).toThrow();
  await fixture.db.prepare(index.definition).run();
  assertFingerprint(await collectCatalog(fixture), expected);
  await fixture.db.prepare(`DROP TRIGGER ${identifier(trigger.name)}${fixture.profile === 'postgres' ? ` ON ${identifier(trigger.table)}` : ''}`).run();
  const withoutTrigger = await collectCatalog(fixture);
  expect(() => assertFingerprint(withoutTrigger, expected)).toThrow();
  await fixture.db.prepare(trigger.definition).run();
  assertFingerprint(await collectCatalog(fixture), expected);
  if (fixture.profile === 'postgres') {
    async function securityDrift(mutation: string, restore: string): Promise<void> {
      await fixture.db.prepare(mutation).run();
      try {
        const changed = await collectCatalog(fixture);
        expect(() => assertFingerprint(changed, expected)).toThrow();
      } finally {
        await fixture.db.prepare(restore).run();
      }
      assertFingerprint(await collectCatalog(fixture), expected);
    }
    await securityDrift('ALTER TABLE users DISABLE ROW LEVEL SECURITY', 'ALTER TABLE users ENABLE ROW LEVEL SECURITY');
    await securityDrift('GRANT SELECT ON users TO PUBLIC', 'REVOKE SELECT ON users FROM PUBLIC');
    await securityDrift('ALTER ROLE ccc_api BYPASSRLS', 'ALTER ROLE ccc_api NOBYPASSRLS');
    await securityDrift('ALTER TABLE users OWNER TO ccc_contract', 'ALTER TABLE users OWNER TO ccc_schema_owner');
    const policy = await fixture.db.prepare(`SELECT policyname,qual,with_check FROM pg_policies
      WHERE schemaname='public' AND tablename='organization_settings' ORDER BY policyname LIMIT 1`)
      .first<{ policyname: string; qual: string; with_check: string }>();
    if (!policy?.qual || !policy.with_check) throw new Error('Required tenant policy mutation target missing.');
    await securityDrift(`ALTER POLICY ${identifier(policy.policyname)} ON organization_settings USING (true) WITH CHECK (true)`,
      `ALTER POLICY ${identifier(policy.policyname)} ON organization_settings USING (${policy.qual}) WITH CHECK (${policy.with_check})`);
    const view = original.views[0];
    if (!view) throw new Error('Required invoker view mutation target missing.');
    await securityDrift(`ALTER VIEW ${identifier(view.name)} SET (security_invoker=false)`,
      `ALTER VIEW ${identifier(view.name)} SET (security_invoker=true)`);
    const hadPrivateSchema = await fixture.db.prepare("SELECT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='private') AS present").first('present');
    if (!hadPrivateSchema) await fixture.db.prepare('CREATE SCHEMA private').run();
    try {
      await fixture.db.prepare('CREATE TABLE private.ccc_drift_probe(id integer)').run();
      try {
        const privateExpected = fingerprint(await collectCatalog(fixture));
        await fixture.db.prepare('GRANT SELECT ON private.ccc_drift_probe TO PUBLIC').run();
        const changed = await collectCatalog(fixture);
        expect(() => assertFingerprint(changed, privateExpected)).toThrow();
      } finally {
        await fixture.db.prepare('DROP TABLE private.ccc_drift_probe').run();
      }
    } finally {
      if (!hadPrivateSchema) await fixture.db.prepare('DROP SCHEMA private').run();
    }
    assertFingerprint(await collectCatalog(fixture), expected);
    const marked = await fixture.db.prepare(`SELECT k.conname AS name FROM pg_constraint k
      JOIN pg_class t ON t.oid=k.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
      WHERE n.nspname='public' AND t.relname='users' AND obj_description(k.oid,'pg_constraint')='ccc:sqlite-primary-key'`).first<string>('name');
    if (!marked) throw new Error('Required explicit SQLite-origin key marker missing.');
    await fixture.db.prepare(`COMMENT ON CONSTRAINT ${identifier(marked)} ON users IS NULL`).run();
    const withoutMarker = await collectCatalog(fixture);
    expect(() => assertFingerprint(withoutMarker, expected)).toThrow();
    expect(withoutMarker.tables.find(({ name }) => name === 'users')!.nullablePrimary).toEqual([]);
    await fixture.db.prepare(`COMMENT ON CONSTRAINT ${identifier(marked)} ON users IS 'ccc:sqlite-primary-key'`).run();
    assertFingerprint(await collectCatalog(fixture), expected);
    const constraint = await fixture.db.prepare(`SELECT k.conname AS name FROM pg_constraint k JOIN pg_class t ON t.oid=k.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' AND t.relname='organization_settings' AND k.contype='c' ORDER BY k.conname LIMIT 1`).first<string>('name');
    if (!constraint) throw new Error('Required live CHECK mutation target missing.');
    await fixture.db.prepare(`ALTER TABLE organization_settings DROP CONSTRAINT ${identifier(constraint)}`).run();
    const withoutConstraint = await collectCatalog(fixture);
    expect(() => assertFingerprint(withoutConstraint, expected)).toThrow();
  }
}

describe('S1 live migration parity', () => {
  it('verifies every checkpoint read-only, or explicitly generates only after semantic proofs pass', async () => {
    const update = process.env.CCC_UPDATE_MIGRATION_PARITY === '1';
    if (process.env.CCC_UPDATE_MIGRATION_PARITY !== undefined && !update) throw new Error('CCC_UPDATE_MIGRATION_PARITY must be absent or exactly 1.');
    const previousBytes = update ? null : readFileSync(PARITY_MANIFEST_PATH, 'utf8');
    const sources = checkpointSources();
    const sqlite = await openParityDatabase('sqlite', harness);
    let postgres: ParityDatabase | undefined;
    try {
      postgres = await openParityDatabase('postgres', harness);
      const entries = [];
      let inventory: TimestampColumn[] = [];
      let proofs: { sqlite: TimestampProof[]; postgres: TimestampProof[] } | undefined;
      let lastSqlite: Catalog | undefined;
      let lastPostgres: Catalog | undefined;
      for (const checkpoint of sources) {
        if (checkpoint.id === 'program-admission') {
          for (const fixture of [sqlite, postgres]) {
            await fixture.db.prepare(
              'INSERT INTO organization_settings (org_id, time_zone, pii_purge_grace_days) VALUES (?, ?, ?)',
            ).bind('parity-admission-org', 'UTC', 180).run();
          }
        }
        if (checkpoint.id === 'schedule-display') {
          for (const fixture of [sqlite, postgres]) await seedScheduleDisplaySchema(fixture.db);
        }
        if (checkpoint.id === 'preregistration-consent') {
          for (const fixture of [sqlite, postgres]) await seedPreregistrationConsentSchema(fixture.db);
        }
        await sqlite.apply(checkpoint.sqlite);
        await postgres.apply(checkpoint.postgres);
        const left = await collectCatalog(sqlite);
        const right = await collectCatalog(postgres);
        assertLogicalParity(left, right);
        const sqliteSemantics = await dialectSemantics(sqlite);
        expect(await dialectSemantics(postgres)).toEqual(sqliteSemantics);
        if (checkpoint.id === 'program-admission') {
          await proveProgramAdmissionSchema(sqlite);
          await proveProgramAdmissionSchema(postgres);
        }
        if (checkpoint.id === 'schedule-display') {
          for (const fixture of [sqlite, postgres]) await proveScheduleDisplaySchema(fixture.db);
        }
        if (checkpoint.id === 'preregistration-consent') {
          for (const fixture of [sqlite, postgres]) await provePreregistrationConsentSchema(fixture.db);
        }
        if (checkpoint.id === 'staff-invites') {
          for (const fixture of [sqlite, postgres]) await proveStaffInvitesSchema(fixture.db);
        }
        if (checkpoint.id === 'participant-request-links') {
          for (const fixture of [sqlite, postgres]) await proveParticipantRequestLinksSchema(fixture.db);
        }
        if (checkpoint.id === 'canonical-compatibility-views') {
          for (const fixture of [sqlite, postgres]) await proveCanonicalCompatibilityViews(fixture.db);
        }
        if (checkpoint.id === 'baseline-0045') {
          inventory = timestampInventory(left);
          expect(inventory.some((entry) => entry.table === 'audit_log' && entry.column === 'created_at')).toBe(true);
        }
        if (checkpoint.id === 'timestamp-normalization') {
          proofs = { sqlite: await timestampProofs(sqlite, inventory), postgres: await timestampProofs(postgres, inventory) };
          expect(proofs.postgres).toEqual(proofs.sqlite);
          const covered = proofs.sqlite.map(({ table, column }) => `${table}.${column}`).sort();
          expect(covered, 'Every live inventoried timestamp requires a real rewrite, output and ordering witness').toEqual(inventory.map(({ table, column }) => `${table}.${column}`).sort());
        }
        const markers = left.tables.flatMap((table) => table.columns.filter((column) => ['operation_marker', 'consumption_id'].includes(column.name)).map((column) => `${table.name}.${column.name}`));
        // 0058 adds staff_invites.consumption_id to the seven markers every checkpoint since 0046 carries.
        const staffInvitesIndex = sources.findIndex((source) => source.id === 'staff-invites');
        if (checkpoint.id !== 'baseline-0045') expect(markers).toHaveLength(sources.indexOf(checkpoint) >= staffInvitesIndex ? 8 : 7);
        entries.push({ id: checkpoint.id,
          sqlite: { sources: checkpoint.sqlite.map(({ name, sha256 }) => ({ name, sha256 })), catalogSha256: fingerprint(left) },
          postgres: { sources: checkpoint.postgres.map(({ name, sha256 }) => ({ name, sha256 })), catalogSha256: fingerprint(right) },
          semantics: { markers, timestamps: timestampInventory(left), timestampProofs: proofs ?? null, dialect: sqliteSemantics },
        });
        lastSqlite = left; lastPostgres = right;
      }
      if (!lastSqlite || !lastPostgres || !proofs) throw new Error('Migration replay did not reach every checkpoint.');
      const issuedDefault = lastPostgres.tables.find(({ name }) => name === 'invite_tokens')!
        .columns.find(({ name }) => name === 'status')!.default!;
      await postgres.db.prepare("ALTER TABLE invite_tokens ALTER COLUMN status SET DEFAULT 'used'").run();
      const consumedByDefault = await collectCatalog(postgres);
      expect(() => assertLogicalParity(lastSqlite, consumedByDefault)).toThrow();
      await postgres.db.prepare(`ALTER TABLE invite_tokens ALTER COLUMN status SET DEFAULT ${issuedDefault}`).run();
      await postgres.db.prepare('ALTER FUNCTION ccc_nullable_least(timestamp,timestamp) CALLED ON NULL INPUT').run();
      await expect(dialectSemantics(postgres)).rejects.toThrow();
      await postgres.db.prepare('ALTER FUNCTION ccc_nullable_least(timestamp,timestamp) RETURNS NULL ON NULL INPUT').run();
      await proveDrift(sqlite, lastSqlite);
      await proveDrift(postgres, lastPostgres);
      const manifest = { version: 1, physicalRules, checkpoints: entries };
      if (update) writeFileSync(PARITY_MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
      else {
        expect(canonical(JSON.parse(previousBytes!))).toBe(canonical(manifest));
        expect(hash(readFileSync(PARITY_MANIFEST_PATH, 'utf8'))).toBe(hash(previousBytes!));
      }
    } finally {
      try { await postgres?.dispose(); } finally { await sqlite.dispose(); }
    }
  }, 600_000);
});
