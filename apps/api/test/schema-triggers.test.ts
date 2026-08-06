import { describe, expect, it } from 'vitest';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { Miniflare } from 'miniflare';
import {
  createBeneficiaryWithInitialSupportCase,
  createSupportCase,
  purgeParticipantPii,
  reRegisterParticipantPii,
  updateParticipantPii,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

const counselor = testActors.counselor;
const t = setupD1();
const SHA256 = 'a'.repeat(64);
const MASKED_SOURCE_TEXT = 'MASKED_SOURCE_QUOTE';
const CREATED_AT = '2026-07-14 09:00:00';
const admin = testActors.admin;

async function seedCanonicalDirectory(): Promise<void> {
  await t.db.prepare(
    `INSERT OR IGNORE INTO organization_settings (
       org_id, time_zone, pii_purge_grace_days, version, created_at, updated_at
     ) VALUES (?, 'Asia/Seoul', 180, 1, ?, ?)`,
  ).bind(counselor.orgId, CREATED_AT, CREATED_AT).run();
  await t.db.prepare(
    `INSERT OR IGNORE INTO users (id, org_id, email, role, active) VALUES
       (?, ?, 'counselor@example.invalid', 'counselor', 1),
       (?, ?, 'admin@example.invalid', 'admin', 1)`,
  ).bind(counselor.userId, counselor.orgId, admin.userId, admin.orgId).run();
}

async function createCanonicalParticipant(): Promise<{ beneficiaryId: string; supportCaseId: string }> {
  await seedCanonicalDirectory();
  return createBeneficiaryWithInitialSupportCase(t.env, counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-14T09:00:00.000Z',
  });
}

interface Phase1Provenance {
  supportCaseId: string;
  sessionId: string;
  consentEvidenceId: string;
  providerConfigId: string;
  providerActivationId: string;
  sourceSnapshotId: string;
  sourceEvidenceItemId: string;
  workItemId: string;
  draftId: string;
  evidenceLinkId: string;
  reviewEventId: string;
}

async function rowById(table: string, id: string): Promise<Record<string, unknown>> {
  const row = await t.db.prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (row === null) throw new Error(`expected ${table} row ${id}`);
  return row;
}

async function expectAppendOnlyMutations(
  table: string,
  id: string,
  column: string,
  updateDiagnostic: string,
  deleteDiagnostic: string,
): Promise<void> {
  const before = await rowById(table, id);

  await expect(t.db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`)
    .bind('tampered', id)
    .run()).rejects.toThrow(updateDiagnostic);
  expect(await rowById(table, id)).toEqual(before);

  await expect(t.db.prepare(`DELETE FROM ${table} WHERE id = ?`)
    .bind(id)
    .run()).rejects.toThrow(deleteDiagnostic);
  expect(await rowById(table, id)).toEqual(before);
}
async function createPreCutoverD1() {
  const miniflare = new Miniflare({
    compatibilityDate: '2026-07-06',
    d1Databases: ['DB'],
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } };',
  });
  const db = await miniflare.getD1Database('DB');
  const migrationsUrl = new URL(['..', '..', '..', 'migrations'].join('/'), import.meta.url);
  const migrations = await readD1Migrations(migrationsUrl.pathname);
  const expandMigration = migrations[4];
  const cutoverMigration = migrations[5];
  if (expandMigration === undefined || cutoverMigration === undefined) {
    throw new Error('expected participant expand and cutover migrations');
  }
  for (const migration of migrations.slice(0, 4)) {
    await db.batch(migration.queries.map((query) => db.prepare(query)));
  }
  return { miniflare, db, expandMigration, cutoverMigration };
}

async function createApprovedGeneratedProvenance(
  options: { includeSummaryEvidence?: boolean; approve?: boolean } = {},
): Promise<Phase1Provenance> {
  const participant = await createCanonicalParticipant();
  const sessionId = 'phase1-generated-session';
  const consentEvidenceId = 'phase1-consent-evidence';
  const providerConfigId = 'phase1-codex-config';
  const providerActivationId = 'phase1-codex-activation';
  const sourceSnapshotId = 'phase1-masked-source-snapshot';
  const sourceEvidenceItemId = 'phase1-masked-source-evidence';
  const workItemId = 'phase1-generated-work';
  const draftId = 'phase1-generated-draft';
  const evidenceLinkId = 'phase1-generated-evidence-link';
  const reviewEventId = 'phase1-generated-approval';
  const includeSummaryEvidence = options.includeSummaryEvidence ?? true;
  const approve = options.approve ?? true;

  await t.db.prepare(
    `INSERT INTO sessions (
       id, org_id, support_case_id, counselor_id, held_at, channel, memo,
       submission_id, submission_hash, submitted_by, ai_status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, 'in_person', ?, ?, ?, ?, 'none', ?, ?)`,
  ).bind(
    sessionId,
    counselor.orgId,
    participant.supportCaseId,
    counselor.userId,
    CREATED_AT,
    'Manual record remains official.',
    '11111111-1111-4111-8111-111111111111',
    SHA256,
    counselor.userId,
    CREATED_AT,
    CREATED_AT,
  ).run();

  await t.db.prepare(
    `INSERT INTO pilot_text_ai_consent_evidence (
      id, org_id, support_case_id, notice_version, notice_sha256, evidence_ref, evidence_sha256, captured_by, effective_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    consentEvidenceId,
    counselor.orgId,
    participant.supportCaseId,
    'pilot-text-ai-v1',
    SHA256,
    'opaque-evidence-reference',
    'b'.repeat(64),
    counselor.userId,
    CREATED_AT,
    CREATED_AT,
  ).run();

  await t.db.prepare(
    `INSERT INTO ai_provider_configs (
      id, org_id, adapter_id, adapter_version, config_hash, approval_refs_json, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    providerConfigId,
    counselor.orgId,
    'codex',
    'v1',
    'c'.repeat(64),
    '["privacy-security-approval"]',
    counselor.userId,
    CREATED_AT,
  ).run();

  await t.db.prepare(
    `INSERT INTO ai_provider_activations (
      id, org_id, config_id, previous_activation_id, activated_by, activated_at
    ) VALUES (?, ?, ?, NULL, ?, ?)`,
  ).bind(
    providerActivationId,
    counselor.orgId,
    providerConfigId,
    counselor.userId,
    CREATED_AT,
  ).run();

  await t.db.prepare(
    `INSERT INTO ai_masked_source_snapshots (
      id, org_id, support_case_id, session_id, masked_text, sha256, masking_pipeline_version, created_by, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    sourceSnapshotId,
    counselor.orgId,
    participant.supportCaseId,
    sessionId,
    MASKED_SOURCE_TEXT,
    SHA256,
    'ner-mask-v1',
    counselor.userId,
    CREATED_AT,
  ).run();

  await t.db.prepare(
    `INSERT INTO ai_masked_source_evidence_items (
      id, snapshot_id, org_id, support_case_id, session_id, source_ref, source_sha256, evidence_quote, source_start, source_end, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    sourceEvidenceItemId,
    sourceSnapshotId,
    counselor.orgId,
    participant.supportCaseId,
    sessionId,
    'memo:masked-source-1',
    SHA256,
    MASKED_SOURCE_TEXT,
    0,
    MASKED_SOURCE_TEXT.length,
    CREATED_AT,
  ).run();

  await t.db.prepare(
    'INSERT INTO ai_work_items (id, org_id, support_case_id, session_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(
    workItemId,
    counselor.orgId,
    participant.supportCaseId,
    sessionId,
    'text_ai_briefing',
    CREATED_AT,
  ).run();

  await t.db.prepare(
    `INSERT INTO ai_draft_versions (
      id, work_item_id, version, parent_version_id, summary_text, questions_json,
      source_snapshot_id, source_snapshot_hash, consent_evidence_id, provider_config_id, model_id, prompt_version, schema_version,
      origin, creation_mode, grounding_status, created_by, created_at
    ) VALUES (?, ?, 1, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', 'provider_generated', 'grounded', ?, ?)`,
  ).bind(
    draftId,
    workItemId,
    'Grounded briefing',
    JSON.stringify(['상황 일정에 변동이 있었나요?', '주거비 변화가 있었나요?']),
    sourceSnapshotId,
    SHA256,
    consentEvidenceId,
    providerConfigId,
    'codex-default',
    'prompt-v1',
    'schema-v1',
    counselor.userId,
    CREATED_AT,
  ).run();

  if (includeSummaryEvidence) {
    await t.db.prepare(
      `INSERT INTO ai_evidence_links (
        id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote, source_ref, source_start, source_end, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      evidenceLinkId,
      draftId,
      sourceEvidenceItemId,
      'claim-1',
      MASKED_SOURCE_TEXT,
      'memo:masked-source-1',
      0,
      MASKED_SOURCE_TEXT.length,
      CREATED_AT,
    ).run();
  }
  await t.db.prepare(
    `INSERT INTO ai_evidence_links (
      id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote, source_ref, source_start, source_end, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    'phase1-question-evidence-link-1',
    draftId,
    sourceEvidenceItemId,
    'question_1',
    MASKED_SOURCE_TEXT,
    'memo:masked-source-1',
    0,
    MASKED_SOURCE_TEXT.length,
    CREATED_AT,
    'phase1-question-evidence-link-2',
    draftId,
    sourceEvidenceItemId,
    'question_2',
    MASKED_SOURCE_TEXT,
    'memo:masked-source-1',
    0,
    MASKED_SOURCE_TEXT.length,
    CREATED_AT,
  ).run();

  if (approve) {
    await t.db.prepare(
      `INSERT INTO ai_review_events (
        id, work_item_id, draft_version_id, decision, replacement_draft_id, actor_id, created_at
      ) VALUES (?, ?, ?, 'approved', NULL, ?, ?)`,
    ).bind(
      reviewEventId,
      workItemId,
      draftId,
      counselor.userId,
      CREATED_AT,
    ).run();
  }

  return {
    supportCaseId: participant.supportCaseId,
    sessionId,
    consentEvidenceId,
    providerConfigId,
    providerActivationId,
    sourceSnapshotId,
    sourceEvidenceItemId,
    workItemId,
    draftId,
    evidenceLinkId,
    reviewEventId,
  };
}

describe('schema triggers', () => {
  it('matches core trigger diagnostics and preserves rows after rejected mutations', async () => {
    await t.reset();
    const participant = await createCanonicalParticipant();
    const goalId = 'immutable-goal';
    await t.db.prepare(
      `INSERT INTO goals (id, org_id, support_case_id, title, status, created_at)
       VALUES (?, ?, ?, ?, 'active', ?)`,
    ).bind(goalId, counselor.orgId, participant.supportCaseId, 'Immutable goal', CREATED_AT).run();
    const goalBefore = await rowById('goals', goalId);

    await expect(t.db.prepare('UPDATE goals SET title = ? WHERE id = ?')
      .bind('Changed goal', goalId)
      .run()).rejects.toThrow('D12: goal title is immutable');
    expect(await rowById('goals', goalId)).toEqual(goalBefore);

    await expect(t.db.prepare(
      "INSERT INTO flags (id, org_id, support_case_id, flag_type, source, review_status, created_at) VALUES (?, ?, ?, 'crisis_utterance', 'ai', 'pending', ?)",
    ).bind(
      'flag-trigger-demo',
      counselor.orgId,
      participant.supportCaseId,
      CREATED_AT,
    ).run()).rejects.toThrow("CHECK constraint failed: source = 'counselor' OR quote IS NOT NULL");
    const unquotedFlag = await t.db.prepare('SELECT id FROM flags WHERE id = ?')
      .bind('flag-trigger-demo')
      .first<{ id: string }>();
    expect(unquotedFlag).toBeNull();

    const auditBefore = await t.db.prepare(
      `SELECT id, action, target_table, target_id, beneficiary_id, support_case_id, detail
       FROM audit_log WHERE support_case_id = ? ORDER BY id LIMIT 1`,
    ).bind(participant.supportCaseId).first<{
      id: number;
      action: string;
      target_table: string;
      target_id: string | null;
      beneficiary_id: string | null;
      support_case_id: string | null;
      detail: string | null;
    }>();
    if (auditBefore === null) throw new Error('expected case creation audit row');

    await expect(t.db.prepare('UPDATE audit_log SET action = ? WHERE id = ?')
      .bind('tamper', auditBefore.id)
      .run()).rejects.toThrow('D14: audit_log is append-only');
    const auditAfterUpdate = await t.db.prepare(
      'SELECT id, action, target_table, target_id, beneficiary_id, support_case_id, detail FROM audit_log WHERE id = ?',
    ).bind(auditBefore.id).first<typeof auditBefore>();
    expect(auditAfterUpdate).toEqual(auditBefore);

    await expect(t.db.prepare('DELETE FROM audit_log WHERE id = ?')
      .bind(auditBefore.id)
      .run()).rejects.toThrow('D14: audit_log is append-only');
    const auditAfterDelete = await t.db.prepare(
      'SELECT id, action, target_table, target_id, beneficiary_id, support_case_id, detail FROM audit_log WHERE id = ?',
    ).bind(auditBefore.id).first<typeof auditBefore>();
    expect(auditAfterDelete).toEqual(auditBefore);
  });
  it('requires a caller-stable manual submission ID and creates exactly one trigger audit', async () => {
    await t.reset();
    const participant = await createCanonicalParticipant();
    const submissionId = 'manual-submission-audit';
    const insertManualSession = (sessionId: string, id: string | null) => t.db.prepare(
      `INSERT INTO sessions (
         id, org_id, support_case_id, counselor_id, held_at, channel, memo,
         submission_id, submission_hash, submitted_by, ai_status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'in_person', ?, ?, ?, ?, 'none', ?, ?)`,
    ).bind(
      sessionId,
      counselor.orgId,
      participant.supportCaseId,
      counselor.userId,
      CREATED_AT,
      'Manual record.',
      id,
      id === null ? null : SHA256,
      id === null ? null : counselor.userId,
      CREATED_AT,
      CREATED_AT,
    ).run();

    await expect(insertManualSession('manual-submission-missing-id', null))
      .rejects.toThrow('participant_schema_violation');
    await expect(t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'submit_manual_record'",
    ).first<{ count: number }>()).resolves.toEqual({ count: 0 });

    await insertManualSession('manual-submission-session', submissionId);
    await expect(insertManualSession('manual-submission-replay', submissionId)).rejects.toThrow();

    const audits = await t.db.prepare(
      `SELECT actor_id, actor_role, action, target_table, target_id,
              beneficiary_id, support_case_id, detail
       FROM audit_log WHERE action = 'submit_manual_record'`,
    ).all<{
      actor_id: string;
      actor_role: string;
      action: string;
      target_table: string;
      target_id: string;
      beneficiary_id: string;
      support_case_id: string;
      detail: string | null;
    }>();
    expect(audits.results).toEqual([{
      actor_id: counselor.userId,
      actor_role: counselor.role,
      action: 'submit_manual_record',
      target_table: 'sessions',
      target_id: 'manual-submission-session',
      beneficiary_id: participant.beneficiaryId,
      support_case_id: participant.supportCaseId,
      detail: null,
    }]);
  });

  it('projects valid generated provenance and rejects direct unreviewed session approval', async () => {
    await t.reset();
    const provenance = await createApprovedGeneratedProvenance();
    const schemaObjects = await t.db.prepare(
      `SELECT name FROM sqlite_master
       WHERE name IN (
         'pilot_text_ai_consent_evidence',
         'ai_provider_configs',
         'ai_provider_activations',
         'ai_masked_source_snapshots',
         'ai_masked_source_evidence_items',
         'ai_work_items',
         'ai_draft_versions',
         'ai_evidence_links',
         'ai_review_events',
         'approved_ai_briefing_v1',
         'grounded_ai_quality_v1',
         'sessions_direct_ai_approval_update_guard'
       )`,
    ).all<{ name: string }>();
    expect(schemaObjects.results.map((row) => row.name).sort()).toEqual([
      'ai_draft_versions',
      'ai_evidence_links',
      'ai_masked_source_evidence_items',
      'ai_masked_source_snapshots',
      'ai_provider_activations',
      'ai_provider_configs',
      'ai_review_events',
      'ai_work_items',
      'approved_ai_briefing_v1',
      'grounded_ai_quality_v1',
      'pilot_text_ai_consent_evidence',
      'sessions_direct_ai_approval_update_guard',
    ]);

    const generatedBriefing = await t.db.prepare(
      `SELECT summary_text, origin, grounding_status, provider_config_id, approved_by, approved_at, case_id, support_case_id
       FROM approved_ai_briefing_v1 WHERE session_id = ?`,
    ).bind(provenance.sessionId).first<{
      summary_text: string;
      origin: string;
      grounding_status: string;
      provider_config_id: string;
      approved_by: string;
      approved_at: string;
      case_id: string;
      support_case_id: string;
    }>();
    if (generatedBriefing === null) throw new Error('expected approved generated briefing');
    expect(generatedBriefing).toEqual({
      summary_text: 'Grounded briefing',
      origin: 'generated',
      grounding_status: 'grounded',
      provider_config_id: provenance.providerConfigId,
      approved_by: counselor.userId,
      approved_at: CREATED_AT,
      case_id: provenance.supportCaseId,
      support_case_id: provenance.supportCaseId,
    });

    const generatedQuality = await t.db.prepare(
      'SELECT summary_text FROM grounded_ai_quality_v1 WHERE session_id = ?',
    ).bind(provenance.sessionId).all<{ summary_text: string }>();
    expect(generatedQuality.results).toEqual([{ summary_text: 'Grounded briefing' }]);

    const directSessionId = 'phase1-direct-session';
    await t.db.prepare(
      `INSERT INTO sessions (
         id, org_id, support_case_id, counselor_id, held_at, channel, memo,
         submission_id, submission_hash, submitted_by, ai_status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'in_person', ?, ?, ?, ?, 'none', ?, ?)`,
    ).bind(
      directSessionId,
      counselor.orgId,
      provenance.supportCaseId,
      counselor.userId,
      CREATED_AT,
      'Direct mutation must fail.',
      '22222222-2222-4222-8222-222222222222',
      SHA256,
      counselor.userId,
      CREATED_AT,
      CREATED_AT,
    ).run();
    const directBefore = await t.db.prepare(
      'SELECT ai_status, ai_summary, approved_at, approved_by FROM sessions WHERE id = ?',
    ).bind(directSessionId).first<{
      ai_status: string;
      ai_summary: string | null;
      approved_at: string | null;
      approved_by: string | null;
    }>();
    if (directBefore === null) throw new Error('expected direct approval test session');

    await expect(t.db.prepare(
      `UPDATE sessions
       SET ai_status = 'approved', ai_summary = ?, approved_at = ?, approved_by = ?
       WHERE id = ?`,
    ).bind(
      'Unreviewed briefing',
      CREATED_AT,
      counselor.userId,
      directSessionId,
    ).run()).rejects.toThrow('phase1: session AI approval requires an immutable approved review');
    const directAfter = await t.db.prepare(
      'SELECT ai_status, ai_summary, approved_at, approved_by FROM sessions WHERE id = ?',
    ).bind(directSessionId).first<typeof directBefore>();
    expect(directAfter).toEqual(directBefore);
  });

  it('rejects approval when question evidence exists but summary evidence is absent', async () => {
    await t.reset();
    const provenance = await createApprovedGeneratedProvenance({
      includeSummaryEvidence: false,
      approve: false,
    });

    await expect(t.db.prepare(
      `INSERT INTO ai_review_events (
        id, work_item_id, draft_version_id, decision, replacement_draft_id, actor_id, created_at
      ) VALUES (?, ?, ?, 'approved', NULL, ?, ?)`,
    ).bind(
      provenance.reviewEventId,
      provenance.workItemId,
      provenance.draftId,
      counselor.userId,
      CREATED_AT,
    ).run()).rejects.toThrow('phase1: generated approval requires grounded summary evidence');

    await expect(t.db.prepare(
      'SELECT COUNT(*) AS count FROM ai_review_events WHERE work_item_id = ?',
    ).bind(provenance.workItemId).first<{ count: number }>()).resolves.toEqual({ count: 0 });
  });
  it('blocks UPDATE and DELETE for every immutable Phase-1 provenance row without changing it', async () => {
    await t.reset();
    const provenance = await createApprovedGeneratedProvenance();
    const approvedBefore = (await t.db.prepare(
      `SELECT summary_text, draft_version_id, provider_config_id, approved_by, approved_at
       FROM approved_ai_briefing_v1 WHERE session_id = ?`,
    ).bind(provenance.sessionId).all<{
      summary_text: string;
      draft_version_id: string;
      provider_config_id: string;
      approved_by: string;
      approved_at: string;
    }>()).results;

    const mutations = [
      {
        table: 'pilot_text_ai_consent_evidence',
        id: provenance.consentEvidenceId,
        column: 'notice_version',
        updateDiagnostic: 'phase1: pilot text-AI consent evidence is append-only',
        deleteDiagnostic: 'phase1: pilot text-AI consent evidence is append-only',
      },
      {
        table: 'ai_work_items',
        id: provenance.workItemId,
        column: 'kind',
        updateDiagnostic: 'phase1: AI work items are append-only',
        deleteDiagnostic: 'phase1: AI work items are append-only',
      },
      {
        table: 'ai_masked_source_snapshots',
        id: provenance.sourceSnapshotId,
        column: 'masked_text',
        updateDiagnostic: 'phase1: masked source snapshots are append-only',
        deleteDiagnostic: 'phase1: masked source snapshots are append-only',
      },
      {
        table: 'ai_masked_source_evidence_items',
        id: provenance.sourceEvidenceItemId,
        column: 'evidence_quote',
        updateDiagnostic: 'phase1: masked source evidence items are append-only',
        deleteDiagnostic: 'phase1: masked source evidence items are append-only',
      },
      {
        table: 'ai_draft_versions',
        id: provenance.draftId,
        column: 'summary_text',
        updateDiagnostic: 'phase1: AI draft versions are append-only',
        deleteDiagnostic: 'phase1: AI draft versions are append-only',
      },
      {
        table: 'ai_evidence_links',
        id: provenance.evidenceLinkId,
        column: 'claim_key',
        updateDiagnostic: 'phase1: AI evidence links are append-only',
        deleteDiagnostic: 'phase1: AI evidence links are append-only',
      },
      {
        table: 'ai_review_events',
        id: provenance.reviewEventId,
        column: 'decision',
        updateDiagnostic: 'phase1: AI review events are append-only',
        deleteDiagnostic: 'phase1: AI review events are append-only',
      },
      {
        table: 'ai_provider_configs',
        id: provenance.providerConfigId,
        column: 'config_hash',
        updateDiagnostic: 'phase1: AI provider configurations are append-only',
        deleteDiagnostic: 'phase1: AI provider configurations are append-only',
      },
      {
        table: 'ai_provider_activations',
        id: provenance.providerActivationId,
        column: 'activated_by',
        updateDiagnostic: 'phase1: provider activation is immutable except retirement',
        deleteDiagnostic: 'phase1: provider activations are append-only',
      },
    ] as const;

    for (const mutation of mutations) {
      await expectAppendOnlyMutations(
        mutation.table,
        mutation.id,
        mutation.column,
        mutation.updateDiagnostic,
        mutation.deleteDiagnostic,
      );
    }

    const approvedAfter = await t.db.prepare(
      `SELECT summary_text, draft_version_id, provider_config_id, approved_by, approved_at
       FROM approved_ai_briefing_v1 WHERE session_id = ?`,
    ).bind(provenance.sessionId).all<{
      summary_text: string;
      draft_version_id: string;
      provider_config_id: string;
      approved_by: string;
      approved_at: string;
    }>();
    expect(approvedAfter.results).toEqual(approvedBefore);
  });
  it('allows exactly one provider activation retirement before appending a linked replacement', async () => {
    await t.reset();
    const provenance = await createApprovedGeneratedProvenance();
    const retiredAt = '2026-07-14 09:01:00';
    const retiredBefore = await rowById('ai_provider_activations', provenance.providerActivationId);

    for (const mutation of [
      { column: 'config_id', value: 'tampered-config' },
      { column: 'previous_activation_id', value: 'tampered-activation' },
      { column: 'activated_by', value: 'tampered-actor' },
      { column: 'activated_at', value: '2026-07-14 09:00:30' },
    ] as const) {
      await expect(t.db.prepare(
        `UPDATE ai_provider_activations SET deactivated_at = ?, ${mutation.column} = ? WHERE id = ?`,
      ).bind(retiredAt, mutation.value, provenance.providerActivationId).run())
        .rejects.toThrow('phase1: provider activation is immutable except retirement');
      expect(await rowById('ai_provider_activations', provenance.providerActivationId)).toEqual(retiredBefore);
    }

    await t.db.prepare('UPDATE ai_provider_activations SET deactivated_at = ? WHERE id = ?')
      .bind(retiredAt, provenance.providerActivationId)
      .run();
    const retired = await rowById('ai_provider_activations', provenance.providerActivationId);
    expect(retired).toEqual({ ...retiredBefore, deactivated_at: retiredAt });

    await expect(t.db.prepare('UPDATE ai_provider_activations SET deactivated_at = ? WHERE id = ?')
      .bind('2026-07-14 09:02:00', provenance.providerActivationId)
      .run()).rejects.toThrow('phase1: provider activation is immutable except retirement');
    expect(await rowById('ai_provider_activations', provenance.providerActivationId)).toEqual(retired);

    const replacementConfigId = 'phase1-codex-replacement-config';
    const replacementActivationId = 'phase1-codex-replacement-activation';
    const replacementActivatedAt = '2026-07-14 09:03:00';
    await t.db.prepare(
      `INSERT INTO ai_provider_configs (
        id, org_id, adapter_id, adapter_version, config_hash, approval_refs_json, created_by, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      replacementConfigId,
      counselor.orgId,
      'codex',
      'v2',
      'd'.repeat(64),
      '["privacy-security-approval"]',
      counselor.userId,
      replacementActivatedAt,
    ).run();
    await t.db.prepare(
      `INSERT INTO ai_provider_activations (
        id, org_id, config_id, previous_activation_id, activated_by, activated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      replacementActivationId,
      counselor.orgId,
      replacementConfigId,
      provenance.providerActivationId,
      counselor.userId,
      replacementActivatedAt,
    ).run();
    const replacement = await rowById('ai_provider_activations', replacementActivationId);
    expect(replacement).toEqual({
      id: replacementActivationId,
      org_id: counselor.orgId,
      config_id: replacementConfigId,
      previous_activation_id: provenance.providerActivationId,
      activated_by: counselor.userId,
      activated_at: replacementActivatedAt,
      deactivated_at: null,
    });

    for (const mutation of [
      { column: 'config_id', value: replacementConfigId },
      { column: 'previous_activation_id', value: replacementActivationId },
      { column: 'activated_at', value: '2026-07-14 09:04:00' },
    ] as const) {
      await expect(t.db.prepare(`UPDATE ai_provider_activations SET ${mutation.column} = ? WHERE id = ?`)
        .bind(mutation.value, provenance.providerActivationId)
        .run()).rejects.toThrow('phase1: provider activation is immutable except retirement');
      expect(await rowById('ai_provider_activations', provenance.providerActivationId)).toEqual(retired);
    }

    await expectAppendOnlyMutations(
      'ai_provider_activations',
      provenance.providerActivationId,
      'activated_by',
      'phase1: provider activation is immutable except retirement',
      'phase1: provider activations are append-only',
    );
    await expectAppendOnlyMutations(
      'ai_provider_activations',
      replacementActivationId,
      'activated_by',
      'phase1: provider activation is immutable except retirement',
      'phase1: provider activations are append-only',
    );

    const activations = await t.db.prepare(
      `SELECT id, config_id, previous_activation_id, activated_by, activated_at, deactivated_at
       FROM ai_provider_activations
       WHERE org_id = ?
       ORDER BY activated_at, id`,
    ).bind(counselor.orgId).all<{
      id: string;
      config_id: string;
      previous_activation_id: string | null;
      activated_by: string;
      activated_at: string;
      deactivated_at: string | null;
    }>();
    expect(activations.results).toEqual([
      {
        id: provenance.providerActivationId,
        config_id: provenance.providerConfigId,
        previous_activation_id: null,
        activated_by: counselor.userId,
        activated_at: CREATED_AT,
        deactivated_at: retiredAt,
      },
      {
        id: replacementActivationId,
        config_id: replacementConfigId,
        previous_activation_id: provenance.providerActivationId,
        activated_by: counselor.userId,
        activated_at: replacementActivatedAt,
        deactivated_at: null,
      },
    ]);
  });

  it('preserves participant ciphertext, records, AI provenance, and audit ownership across the 0005→0006 cutover', async () => {
    const miniflare = new Miniflare({
      compatibilityDate: '2026-07-06',
      d1Databases: ['DB'],
      modules: true,
      script: 'export default { fetch() { return new Response("ok"); } };',
    });
    try {
      const db = await miniflare.getD1Database('DB');
      const migrationsUrl = new URL(['..', '..', '..', 'migrations'].join('/'), import.meta.url);
      const migrations = await readD1Migrations(migrationsUrl.pathname);
      const firstMigration = migrations[0];
      const expandMigration = migrations[4];
      const cutoverMigration = migrations[5];
      if (firstMigration === undefined || expandMigration === undefined || cutoverMigration === undefined) {
        throw new Error('expected initial, participant expand, and participant cutover migrations');
      }
      await db.batch(firstMigration.queries.map((query) => db.prepare(query)));

      const legacyCaseId = 'A017';
      const supportCaseId = 'legacy-support-case:A017';
      const sessionId = 'cutover-session';
      const goalId = 'cutover-goal';
      const actionItemId = 'cutover-action-item';
      const flagId = 'cutover-flag';
      const auditId = 9001;
      const createdAt = '2026-07-01T00:00:00.000Z';
      const updatedAt = '2026-07-14T09:00:00.000Z';
      const summary = 'Legacy briefing: 한글 ✓';
      const expectedSummaryHex = Array.from(
        new TextEncoder().encode(summary),
        (byte) => byte.toString(16).padStart(2, '0'),
      ).join('').toUpperCase();
      const nameCiphertext = 'N3:00ff:alpha';
      const phoneCiphertext = 'P4:a1b2:bravo';
      const accountCiphertext = 'K9:dead:charlie';

      await db.prepare(
        `INSERT INTO cases (
           id, org_id, program_type, status, intake_at, consent_recording_at,
           consent_text_ai_at, extra, created_at, updated_at
         ) VALUES (?, 'org_demo', 'financial_support_v1', 'active', ?, ?, ?, ?, ?, ?)`,
      ).bind(
        legacyCaseId,
        '2026-06-30T09:00:00.000Z',
        '2026-06-30T09:01:00.000Z',
        '2026-06-30T09:02:00.000Z',
        '{"legacy":"record"}',
        createdAt,
        updatedAt,
      ).run();
      await db.prepare(
        `INSERT INTO pii_vault (
           case_id, org_id, enc_name, enc_phone, enc_account, key_version, created_at, updated_at
         ) VALUES (?, 'org_demo', ?, ?, ?, 7, ?, ?)`,
      ).bind(
        legacyCaseId,
        nameCiphertext,
        phoneCiphertext,
        accountCiphertext,
        createdAt,
        updatedAt,
      ).run();
      await db.prepare(
        `INSERT INTO case_assignees (id, org_id, case_id, user_id, role, assigned_at)
         VALUES ('cutover-primary-assignment', 'org_demo', ?, 'legacy-counselor', 'primary', ?)`,
      ).bind(legacyCaseId, createdAt).run();
      await db.prepare(
        `INSERT INTO sessions (
           id, org_id, case_id, counselor_id, held_at, channel, memo, ai_status,
           transcript, audio_r2_key, ai_summary, ai_schema, ai_contrast, emotion_scores,
           speaker_mapping_confirmed_at, approved_at, approved_by, extra, created_at, updated_at
         ) VALUES (?, 'org_demo', ?, 'legacy-counselor', ?, 'in_person', ?, 'approved',
                   ?, ?, ?, ?, ?, ?, ?, ?, 'legacy-counselor', ?, ?, ?)`,
      ).bind(
        sessionId,
        legacyCaseId,
        updatedAt,
        'Manual record: retain this byte sequence.',
        '[PERSON_1] asked for housing support.',
        'legacy-audio/opaque-key',
        summary,
        '{"financial_support_v1":{"verified":true}}',
        '{"missing_from_memo":[],"missing_from_audio":[],"unaddressed_goals":[]}',
        '{"beneficiary":{"score":0.25}}',
        '2026-07-14T09:05:00.000Z',
        '2026-07-14T09:10:00.000Z',
        '{"legacy_session":true}',
        createdAt,
        updatedAt,
      ).run();
      await db.prepare(
        `INSERT INTO goals (
           id, org_id, case_id, title, scale_criteria, status, created_at
         ) VALUES (?, 'org_demo', ?, ?, ?, 'active', ?)`,
      ).bind(
        goalId,
        legacyCaseId,
        'Maintain stable housing for the next month',
        '{"-2":"lost housing","2":"stable housing"}',
        createdAt,
      ).run();
      await db.prepare(
        `INSERT INTO action_items (
           id, org_id, case_id, session_id, description, owner, due_date, created_at
         ) VALUES (?, 'org_demo', ?, ?, ?, 'beneficiary', ?, ?)`,
      ).bind(
        actionItemId,
        legacyCaseId,
        sessionId,
        'Bring the housing payment receipt.',
        '2026-07-21',
        updatedAt,
      ).run();
      await db.prepare(
        `INSERT INTO flags (
           id, org_id, case_id, session_id, flag_type, quote, source, review_status,
           reviewed_by, reviewed_at, created_at
         ) VALUES (?, 'org_demo', ?, ?, 'debt_deterioration', ?, 'ai', 'confirmed',
                   'legacy-counselor', ?, ?)`,
      ).bind(
        flagId,
        legacyCaseId,
        sessionId,
        '[PERSON_1] needs debt follow-up.',
        '2026-07-14T09:15:00.000Z',
        updatedAt,
      ).run();
      await db.prepare(
        `INSERT INTO audit_log (
           id, org_id, actor_id, actor_role, action, target_table, target_id, case_id, detail, created_at
         ) VALUES (?, 'org_demo', 'legacy-counselor', 'counselor', 'approve', 'sessions', ?, ?, ?, ?)`,
      ).bind(
        auditId,
        sessionId,
        legacyCaseId,
        '{"source":"legacy_cutover_fixture"}',
        updatedAt,
      ).run();

      for (const migration of migrations.slice(1, 4)) {
        await db.batch(migration.queries.map((query) => db.prepare(query)));
      }
      await db.batch(expandMigration.queries.map((query) => db.prepare(query)));
      await db.batch(cutoverMigration.queries.map((query) => db.prepare(query)));

      await expect(db.prepare(
        `SELECT id, org_id, beneficiary_id, legacy_case_id, program_type, status,
                intake_at, consent_recording_at, consent_text_ai_at, extra, created_at, updated_at
         FROM support_cases WHERE id = ?`,
      ).bind(supportCaseId).first()).resolves.toEqual({
        id: supportCaseId,
        org_id: 'org_demo',
        beneficiary_id: legacyCaseId,
        legacy_case_id: legacyCaseId,
        program_type: 'financial_support_v1',
        status: 'active',
        intake_at: '2026-06-30T09:00:00.000Z',
        consent_recording_at: '2026-06-30T09:01:00.000Z',
        consent_text_ai_at: '2026-06-30T09:02:00.000Z',
        extra: '{"legacy":"record"}',
        created_at: createdAt,
        updated_at: updatedAt,
      });
      await expect(db.prepare(
        `SELECT beneficiary_id, org_id, enc_name, enc_phone, enc_account, key_version,
                hex(CAST(enc_name AS BLOB)) AS enc_name_hex,
                hex(CAST(enc_phone AS BLOB)) AS enc_phone_hex,
                hex(CAST(enc_account AS BLOB)) AS enc_account_hex
         FROM participant_pii_vault WHERE beneficiary_id = ?`,
      ).bind(legacyCaseId).first()).resolves.toEqual({
        beneficiary_id: legacyCaseId,
        org_id: 'org_demo',
        enc_name: nameCiphertext,
        enc_phone: phoneCiphertext,
        enc_account: accountCiphertext,
        key_version: 7,
        enc_name_hex: '4E333A303066663A616C706861',
        enc_phone_hex: '50343A613162323A627261766F',
        enc_account_hex: '4B393A646561643A636861726C6965',
      });
      await expect(db.prepare(
        `SELECT id, org_id, support_case_id, user_id, role, assigned_at, unassigned_at
         FROM support_case_assignees WHERE id = 'cutover-primary-assignment'`,
      ).first()).resolves.toEqual({
        id: 'cutover-primary-assignment',
        org_id: 'org_demo',
        support_case_id: supportCaseId,
        user_id: 'legacy-counselor',
        role: 'primary',
        assigned_at: createdAt,
        unassigned_at: null,
      });
      await expect(db.prepare(
        `SELECT id, org_id, support_case_id, title, scale_criteria, status, created_at
         FROM goals WHERE id = ?`,
      ).bind(goalId).first()).resolves.toEqual({
        id: goalId,
        org_id: 'org_demo',
        support_case_id: supportCaseId,
        title: 'Maintain stable housing for the next month',
        scale_criteria: '{"-2":"lost housing","2":"stable housing"}',
        status: 'active',
        created_at: createdAt,
      });
      await expect(db.prepare(
        `SELECT id, org_id, support_case_id, counselor_id, memo, transcript, audio_r2_key,
                ai_status, ai_summary, hex(CAST(ai_summary AS BLOB)) AS ai_summary_hex,
                ai_schema, ai_contrast, emotion_scores, approved_at, approved_by, extra
         FROM sessions WHERE id = ?`,
      ).bind(sessionId).first()).resolves.toEqual({
        id: sessionId,
        org_id: 'org_demo',
        support_case_id: supportCaseId,
        counselor_id: 'legacy-counselor',
        memo: 'Manual record: retain this byte sequence.',
        transcript: '[PERSON_1] asked for housing support.',
        audio_r2_key: 'legacy-audio/opaque-key',
        ai_status: 'approved',
        ai_summary: summary,
        ai_summary_hex: expectedSummaryHex,
        ai_schema: '{"financial_support_v1":{"verified":true}}',
        ai_contrast: '{"missing_from_memo":[],"missing_from_audio":[],"unaddressed_goals":[]}',
        emotion_scores: '{"beneficiary":{"score":0.25}}',
        approved_at: '2026-07-14T09:10:00.000Z',
        approved_by: 'legacy-counselor',
        extra: '{"legacy_session":true}',
      });
      await expect(db.prepare(
        `SELECT id, org_id, support_case_id, session_id, description, owner, due_date, created_at
         FROM action_items WHERE id = ?`,
      ).bind(actionItemId).first()).resolves.toEqual({
        id: actionItemId,
        org_id: 'org_demo',
        support_case_id: supportCaseId,
        session_id: sessionId,
        description: 'Bring the housing payment receipt.',
        owner: 'beneficiary',
        due_date: '2026-07-21',
        created_at: updatedAt,
      });
      await expect(db.prepare(
        `SELECT id, org_id, support_case_id, session_id, flag_type, quote, source,
                review_status, reviewed_by, reviewed_at, created_at
         FROM flags WHERE id = ?`,
      ).bind(flagId).first()).resolves.toEqual({
        id: flagId,
        org_id: 'org_demo',
        support_case_id: supportCaseId,
        session_id: sessionId,
        flag_type: 'debt_deterioration',
        quote: '[PERSON_1] needs debt follow-up.',
        source: 'ai',
        review_status: 'confirmed',
        reviewed_by: 'legacy-counselor',
        reviewed_at: '2026-07-14T09:15:00.000Z',
        created_at: updatedAt,
      });
      await expect(db.prepare(
        `SELECT id, org_id, support_case_id, session_id, kind, created_at
         FROM ai_work_items WHERE id = ?`,
      ).bind(`legacy-import-work:${sessionId}`).first()).resolves.toEqual({
        id: `legacy-import-work:${sessionId}`,
        org_id: 'org_demo',
        support_case_id: supportCaseId,
        session_id: sessionId,
        kind: 'text_ai_briefing',
        created_at: '2026-07-14T09:10:00.000Z',
      });
      await expect(db.prepare(
        `SELECT work_item_id, draft_version_id, review_event_id, support_case_id, beneficiary_id,
                case_id, session_id, summary_text, questions_json,
                hex(CAST(summary_text AS BLOB)) AS summary_hex, origin, grounding_status
         FROM approved_ai_briefing_v1 WHERE session_id = ?`,
      ).bind(sessionId).first()).resolves.toEqual({
        work_item_id: `legacy-import-work:${sessionId}`,
        draft_version_id: `legacy-import-draft:${sessionId}`,
        review_event_id: `legacy-import-review:${sessionId}`,
        support_case_id: supportCaseId,
        beneficiary_id: legacyCaseId,
        case_id: legacyCaseId,
        session_id: sessionId,
        summary_text: summary,
        questions_json: '[]',
        summary_hex: expectedSummaryHex,
        origin: 'legacy_import',
        grounding_status: 'legacy_unverified',
      });
      await expect(db.prepare(
        'SELECT COUNT(*) AS count FROM grounded_ai_quality_v1 WHERE session_id = ?',
      ).bind(sessionId).first()).resolves.toEqual({ count: 0 });
      await expect(db.prepare(
        `SELECT id, org_id, actor_id, actor_role, action, target_table, target_id,
                beneficiary_id, support_case_id, case_id, detail, created_at
         FROM audit_log WHERE id = ?`,
      ).bind(auditId).first()).resolves.toEqual({
        id: auditId,
        org_id: 'org_demo',
        actor_id: 'legacy-counselor',
        actor_role: 'counselor',
        action: 'approve',
        target_table: 'sessions',
        target_id: sessionId,
        beneficiary_id: legacyCaseId,
        support_case_id: supportCaseId,
        case_id: legacyCaseId,
        detail: '{"source":"legacy_cutover_fixture"}',
        created_at: updatedAt,
      });
      await expect(db.prepare(
        'SELECT id, org_id, status, purge_due FROM cases WHERE id = ?',
      ).bind(legacyCaseId).first()).resolves.toEqual({
        id: legacyCaseId,
        org_id: 'org_demo',
        status: 'active',
        purge_due: null,
      });
      await expect(db.prepare(
        "INSERT INTO cases (id, org_id) VALUES ('A1000', 'org_demo')",
      ).run()).rejects.toThrow('legacy_case_write_unsupported');
    } finally {
      await miniflare.dispose();
    }
  });
  it('aborts 0006 atomically when reverse support-case reconciliation finds post-expand drift', async () => {
    const { miniflare, db, expandMigration, cutoverMigration } = await createPreCutoverD1();
    try {
      await db.prepare(
        `INSERT INTO cases (id, org_id, intake_at, extra, created_at, updated_at)
         VALUES ('A017', 'org_demo', '2026-07-01T00:00:00.000Z', '{"legacy":"source"}', ?, ?)`,
      ).bind(CREATED_AT, CREATED_AT).run();
      await db.prepare(
        `INSERT INTO case_assignees (id, org_id, case_id, user_id, role, assigned_at)
         VALUES ('support-drift-primary', 'org_demo', 'A017', 'legacy-counselor', 'primary', ?)`,
      ).bind(CREATED_AT).run();
      await db.batch(expandMigration.queries.map((query) => db.prepare(query)));
      await db.prepare(
        `INSERT INTO support_cases (
           id, org_id, beneficiary_id, legacy_case_id, creation_kind, created_at, updated_at
         ) VALUES ('post-expand-extra-support-case', 'org_demo', 'A017', 'A018',
                   'legacy_import', ?, ?)`,
      ).bind(CREATED_AT, CREATED_AT).run();

      await expect(db.batch(cutoverMigration.queries.map((query) => db.prepare(query))))
        .rejects.toThrow('CHECK constraint failed: ok = 1');
      await expect(db.prepare(
        'SELECT id, org_id, intake_at, extra, created_at, updated_at FROM cases WHERE id = ?',
      ).bind('A017').first()).resolves.toEqual({
        id: 'A017',
        org_id: 'org_demo',
        intake_at: '2026-07-01T00:00:00.000Z',
        extra: '{"legacy":"source"}',
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      });
      await expect(db.prepare(
        'SELECT id, case_id, user_id, role, unassigned_at FROM case_assignees WHERE id = ?',
      ).bind('support-drift-primary').first()).resolves.toEqual({
        id: 'support-drift-primary',
        case_id: 'A017',
        user_id: 'legacy-counselor',
        role: 'primary',
        unassigned_at: null,
      });
      await expect(db.prepare(
        `SELECT id, beneficiary_id, legacy_case_id, creation_kind
         FROM support_cases WHERE id = 'post-expand-extra-support-case'`,
      ).first()).resolves.toEqual({
        id: 'post-expand-extra-support-case',
        beneficiary_id: 'A017',
        legacy_case_id: 'A018',
        creation_kind: 'legacy_import',
      });
      await expect(db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'support_cases_next'",
      ).first()).resolves.toBeNull();
    } finally {
      await miniflare.dispose();
    }
  });
  it('aborts 0006 atomically when forward PII-vault reconciliation finds post-expand drift', async () => {
    const { miniflare, db, expandMigration, cutoverMigration } = await createPreCutoverD1();
    try {
      await db.prepare("INSERT INTO cases (id, org_id) VALUES ('A017', 'org_demo')").run();
      await db.prepare(
        `INSERT INTO case_assignees (id, org_id, case_id, user_id, role, assigned_at)
         VALUES ('pii-drift-primary', 'org_demo', 'A017', 'legacy-counselor', 'primary', ?)`,
      ).bind(CREATED_AT).run();
      await db.prepare(
        `INSERT INTO pii_vault (
           case_id, org_id, enc_name, enc_phone, enc_account, key_version, created_at, updated_at
         ) VALUES ('A017', 'org_demo', 'N3:legacy', 'P4:legacy', 'K9:legacy', 4, ?, ?)`,
      ).bind(CREATED_AT, CREATED_AT).run();
      await db.batch(expandMigration.queries.map((query) => db.prepare(query)));
      await db.prepare(
        "UPDATE participant_pii_vault SET enc_name = 'N3:post-expand-drift' WHERE beneficiary_id = 'A017'",
      ).run();

      await expect(db.batch(cutoverMigration.queries.map((query) => db.prepare(query))))
        .rejects.toThrow('CHECK constraint failed: ok = 1');
      await expect(db.prepare(
        `SELECT case_id, org_id, enc_name, enc_phone, enc_account, key_version, created_at, updated_at
         FROM pii_vault WHERE case_id = ?`,
      ).bind('A017').first()).resolves.toEqual({
        case_id: 'A017',
        org_id: 'org_demo',
        enc_name: 'N3:legacy',
        enc_phone: 'P4:legacy',
        enc_account: 'K9:legacy',
        key_version: 4,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      });
      await expect(db.prepare(
        "SELECT enc_name FROM participant_pii_vault WHERE beneficiary_id = 'A017'",
      ).first()).resolves.toEqual({ enc_name: 'N3:post-expand-drift' });
      await expect(db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'participant_pii_vault_next'",
      ).first()).resolves.toBeNull();
    } finally {
      await miniflare.dispose();
    }
  });
  it('aborts 0006 atomically when reverse assignment reconciliation finds post-expand drift', async () => {
    const { miniflare, db, expandMigration, cutoverMigration } = await createPreCutoverD1();
    try {
      await db.prepare(
        `INSERT INTO users (id, org_id, email, role, active)
         VALUES ('post-expand-secondary', 'org_demo', 'post-expand-secondary@example.invalid', 'counselor', 1)`,
      ).run();
      await db.prepare("INSERT INTO cases (id, org_id) VALUES ('A017', 'org_demo')").run();
      await db.prepare(
        `INSERT INTO case_assignees (id, org_id, case_id, user_id, role, assigned_at)
         VALUES ('assignment-drift-primary', 'org_demo', 'A017', 'legacy-counselor', 'primary', ?)`,
      ).bind(CREATED_AT).run();
      await db.batch(expandMigration.queries.map((query) => db.prepare(query)));
      await db.prepare(
        `INSERT INTO support_case_assignees (
           id, org_id, support_case_id, user_id, role, assigned_at
         ) VALUES ('assignment-drift-secondary', 'org_demo', 'legacy-support-case:A017',
                   'post-expand-secondary', 'secondary', ?)`,
      ).bind('2026-07-15T00:00:00.000Z').run();

      await expect(db.batch(cutoverMigration.queries.map((query) => db.prepare(query))))
        .rejects.toThrow('CHECK constraint failed: ok = 1');
      await expect(db.prepare(
        'SELECT id, org_id, case_id, user_id, role, assigned_at, unassigned_at FROM case_assignees WHERE id = ?',
      ).bind('assignment-drift-primary').first()).resolves.toEqual({
        id: 'assignment-drift-primary',
        org_id: 'org_demo',
        case_id: 'A017',
        user_id: 'legacy-counselor',
        role: 'primary',
        assigned_at: CREATED_AT,
        unassigned_at: null,
      });
      await expect(db.prepare(
        `SELECT id, support_case_id, user_id, role, assigned_at, unassigned_at
         FROM support_case_assignees WHERE id = 'assignment-drift-secondary'`,
      ).first()).resolves.toEqual({
        id: 'assignment-drift-secondary',
        support_case_id: 'legacy-support-case:A017',
        user_id: 'post-expand-secondary',
        role: 'secondary',
        assigned_at: '2026-07-15T00:00:00.000Z',
        unassigned_at: null,
      });
      await expect(db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'support_case_assignees_next'",
      ).first()).resolves.toBeNull();
    } finally {
      await miniflare.dispose();
    }
  });
  it('fails the cutover closed when a SupportCase has zero active primary assignments', async () => {
    const { miniflare, db, expandMigration, cutoverMigration } = await createPreCutoverD1();
    try {
      await db.prepare("INSERT INTO cases (id, org_id) VALUES ('A017', 'org_demo')").run();
      await db.batch(expandMigration.queries.map((query) => db.prepare(query)));

      await expect(db.batch(cutoverMigration.queries.map((query) => db.prepare(query))))
        .rejects.toThrow('CHECK constraint failed: ok = 1');
      await expect(db.prepare('SELECT COUNT(*) AS count FROM cases').first<{ count: number }>())
        .resolves.toEqual({ count: 1 });
    } finally {
      await miniflare.dispose();
    }
  });
  it('fails the cutover closed when an orphaned rebuilt-table row would be omitted', async () => {
    const { miniflare, db, expandMigration, cutoverMigration } = await createPreCutoverD1();
    try {
      await db.prepare("INSERT INTO cases (id, org_id) VALUES ('A017', 'org_demo')").run();
      await db.prepare(
        `INSERT INTO case_assignees (id, org_id, case_id, user_id, role, assigned_at)
         VALUES ('legacy-assignment', 'org_demo', 'A017', 'legacy-counselor', 'primary', ?)`,
      ).bind(CREATED_AT).run();
      await db.prepare('CREATE TABLE action_items_without_fk AS SELECT * FROM action_items WHERE 0').run();
      await db.prepare('DROP TABLE action_items').run();
      await db.prepare('ALTER TABLE action_items_without_fk RENAME TO action_items').run();
      await db.prepare(
        `INSERT INTO action_items (id, org_id, case_id, description, owner, created_at)
         VALUES ('orphan-action-item', 'org_demo', 'A999', 'Must not disappear', 'counselor', ?)`,
      ).bind(CREATED_AT).run();
      await db.batch(expandMigration.queries.map((query) => db.prepare(query)));

      await expect(db.batch(cutoverMigration.queries.map((query) => db.prepare(query))))
        .rejects.toThrow('CHECK constraint failed: ok = 1');
      await expect(db.prepare(
        "SELECT id, case_id FROM action_items WHERE id = 'orphan-action-item'",
      ).first()).resolves.toEqual({ id: 'orphan-action-item', case_id: 'A999' });
    } finally {
      await miniflare.dispose();
    }
  });
  it('rejects runtime legacy imports after cutover', async () => {
    await t.reset();
    const participant = await createCanonicalParticipant();
    const sessionId = 'phase1-runtime-legacy-session';
    const workItemId = 'phase1-runtime-legacy-work';

    await t.db.prepare(
      `INSERT INTO sessions (
         id, org_id, support_case_id, counselor_id, held_at, channel, memo,
         submission_id, submission_hash, submitted_by, ai_status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'in_person', ?, ?, ?, ?, 'none', ?, ?)`,
    ).bind(
      sessionId,
      counselor.orgId,
      participant.supportCaseId,
      counselor.userId,
      CREATED_AT,
      'Manual record.',
      '33333333-3333-4333-8333-333333333333',
      SHA256,
      counselor.userId,
      CREATED_AT,
      CREATED_AT,
    ).run();
    await t.db.prepare(
      'INSERT INTO ai_work_items (id, org_id, support_case_id, session_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(workItemId, counselor.orgId, participant.supportCaseId, sessionId, 'text_ai_briefing', CREATED_AT).run();

    await expect(t.db.prepare(
      `INSERT INTO ai_draft_versions (
        id, work_item_id, version, parent_version_id, summary_text, source_snapshot_id, source_snapshot_hash,
        consent_evidence_id, provider_config_id, model_id, prompt_version, schema_version,
        origin, creation_mode, grounding_status, created_by, created_at
      ) VALUES (?, ?, 1, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'legacy_import', 'legacy_import', 'legacy_unverified', NULL, ?)`,
    ).bind('phase1-runtime-legacy-draft', workItemId, 'Untrusted runtime legacy summary', CREATED_AT).run())
      .rejects.toThrow('phase1: runtime legacy AI import is prohibited');

    const drafts = await t.db.prepare(
      'SELECT COUNT(*) AS count FROM ai_draft_versions WHERE work_item_id = ?',
    ).bind(workItemId).first<{ count: number }>();
    expect(drafts?.count).toBe(0);
  });
  it('enforces participant status, identifier, purge, and re-registration guards', async () => {
    await t.reset();
    const participant = await createCanonicalParticipant();
    await updateParticipantPii(t.env, admin, participant.beneficiaryId, {
      supportCaseContextId: participant.supportCaseId,
      expectedVersion: 1,
      name: 'PURGE_CIPHERTEXT_MUST_CLEAR',
    });

    for (const beneficiaryId of ['A017', 'A1000']) {
      await t.db.prepare(
        "INSERT INTO beneficiaries (id, org_id, initialization_state) VALUES (?, ?, 'pending')",
      ).bind(beneficiaryId, counselor.orgId).run();
    }
    for (const beneficiaryId of ['a017', 'A01', 'A01x', 'B017']) {
      await expect(t.db.prepare(
        "INSERT INTO beneficiaries (id, org_id, initialization_state) VALUES (?, ?, 'pending')",
      ).bind(beneficiaryId, counselor.orgId).run()).rejects.toThrow('CHECK constraint failed');
    }

    await t.db.prepare(
      `INSERT INTO counseling_schedules (
         id, org_id, beneficiary_id, support_case_id, scheduled_at, status, version,
         created_by_actor_id, updated_by_actor_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'no_show', 1, ?, ?, ?, ?)`,
    ).bind(
      'no-show-schedule',
      counselor.orgId,
      participant.beneficiaryId,
      participant.supportCaseId,
      CREATED_AT,
      counselor.userId,
      counselor.userId,
      CREATED_AT,
      CREATED_AT,
    ).run();
    await expect(t.db.prepare(
      'SELECT status, completed_session_id FROM counseling_schedules WHERE id = ?',
    ).bind('no-show-schedule').first()).resolves.toEqual({
      status: 'no_show',
      completed_session_id: null,
    });

    await t.db.prepare(
      `UPDATE support_cases
       SET status = 'closed', closed_at = ?, closed_reason = ?, closed_by_actor_id = ?
       WHERE id = ?`,
    ).bind('2020-01-01 00:00:00', 'program complete', counselor.userId, participant.supportCaseId).run();
    const unassignedSource = await createSupportCase(t.env, admin, participant.beneficiaryId, {
      consentPrivacy: true,
      schemaVersion: 1,
      submissionId: '77777777-7777-4777-8777-777777777777',
      programType: 'financial_support_v1',
      intakeAt: '2026-07-14T10:00:00.000Z',
      initialAssigneeUserId: admin.userId,
    });
    await expect(t.db.prepare(
      `INSERT INTO support_cases (
         id, org_id, beneficiary_id, program_type, status, intake_at, creation_kind,
         creation_submission_id, creation_payload_hash, created_by_actor_id,
         source_support_case_id, initial_assignee_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, 'financial_support_v1', 'active', ?, 'subsequent', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      'unassigned-counselor-subsequent-case',
      counselor.orgId,
      participant.beneficiaryId,
      '2026-07-14T10:00:00.000Z',
      '88888888-8888-4888-8888-888888888888',
      SHA256,
      counselor.userId,
      unassignedSource.supportCaseId,
      counselor.userId,
      CREATED_AT,
      CREATED_AT,
    ).run()).rejects.toThrow('participant_schema_violation');
    await t.db.prepare(
      `UPDATE support_cases
       SET status = 'closed', closed_at = ?, closed_reason = ?, closed_by_actor_id = ?
       WHERE id = ?`,
    ).bind(
      '2020-01-01 00:00:00',
      'program complete',
      admin.userId,
      unassignedSource.supportCaseId,
    ).run();
    await expect(t.db.prepare(
      `INSERT INTO sessions (
         id, org_id, support_case_id, counselor_id, held_at, channel, memo,
         submission_id, submission_hash, submitted_by, ai_status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'in_person', ?, ?, ?, ?, 'none', ?, ?)`,
    ).bind(
      'closed-support-case-manual-record',
      counselor.orgId,
      participant.supportCaseId,
      counselor.userId,
      CREATED_AT,
      'Closed SupportCase must reject manual records.',
      '55555555-5555-4555-8555-555555555555',
      SHA256,
      counselor.userId,
      CREATED_AT,
      CREATED_AT,
    ).run()).rejects.toThrow('participant_schema_violation');
    await expect(t.db.prepare(
      `INSERT INTO support_cases (
         id, org_id, beneficiary_id, program_type, status, intake_at, creation_kind,
         creation_submission_id, creation_payload_hash, created_by_actor_id,
         source_support_case_id, initial_assignee_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, 'financial_support_v1', 'active', ?, 'subsequent', ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      'closed-source-subsequent-case',
      counselor.orgId,
      participant.beneficiaryId,
      '2026-07-14T10:00:00.000Z',
      '66666666-6666-4666-8666-666666666666',
      SHA256,
      counselor.userId,
      participant.supportCaseId,
      counselor.userId,
      CREATED_AT,
      CREATED_AT,
    ).run()).rejects.toThrow('participant_schema_violation');

    const beforeMalformedPurge = await t.db.prepare(
      `SELECT purged_at, purged_by, purged_by_role, version
       FROM participant_pii_vault WHERE beneficiary_id = ?`,
    ).bind(participant.beneficiaryId).first();
    await expect(t.db.prepare(
      `UPDATE participant_pii_vault
       SET purged_at = ?, purged_by = ?, purged_by_role = 'admin',
           retention_changed_by = ?, retention_change_kind = 'purge_pii',
           retention_changed_at = ?, version = version + 1
       WHERE beneficiary_id = ?`,
    ).bind(
      '2026-07-14 10:00:00',
      admin.userId,
      admin.userId,
      '2026-07-14 10:00:00',
      participant.beneficiaryId,
    ).run()).rejects.toThrow('participant_schema_violation');
    await expect(t.db.prepare(
      `SELECT purged_at, purged_by, purged_by_role, version
       FROM participant_pii_vault WHERE beneficiary_id = ?`,
    ).bind(participant.beneficiaryId).first()).resolves.toEqual(beforeMalformedPurge);

    await expect(purgeParticipantPii(t.env, admin, participant.beneficiaryId))
      .resolves.toEqual({ beneficiaryId: participant.beneficiaryId, purged: true });
    await expect(t.db.prepare(
      `SELECT actor_id, actor_role, action FROM audit_log
       WHERE action = 'purge_pii' AND beneficiary_id = ?`,
    ).bind(participant.beneficiaryId).all()
      .then((result) => result.results)).resolves.toEqual([
        { actor_id: admin.userId, actor_role: 'admin', action: 'purge_pii' },
      ]);
    await expect(t.db.prepare(
      `SELECT enc_name, enc_phone, enc_account, purge_due, purged_at, purged_by,
              purged_by_role, retention_change_kind, version
       FROM participant_pii_vault WHERE beneficiary_id = ?`,
    ).bind(participant.beneficiaryId).first()).resolves.toMatchObject({
      enc_name: null,
      enc_phone: null,
      enc_account: null,
      purge_due: null,
      purged_at: expect.any(String),
      purged_by: admin.userId,
      purged_by_role: 'admin',
      retention_change_kind: 'purge_pii',
      version: 6,
    });

    await expect(t.db.prepare(
      "UPDATE participant_pii_vault SET enc_name = 'revived', purged_at = NULL WHERE beneficiary_id = ?",
    ).bind(participant.beneficiaryId).run()).rejects.toThrow('participant_schema_violation');

    const reRegistrationSupportCaseId = 're-registration-support-case';
    await t.db.prepare(
      `INSERT INTO support_cases (
         id, org_id, beneficiary_id, program_type, status, intake_at, creation_kind,
         creation_submission_id, creation_payload_hash, created_by_actor_id,
         source_support_case_id, initial_assignee_user_id, created_at, updated_at
       ) VALUES (?, ?, ?, 'financial_support_v1', 'active', ?, 'subsequent', ?, ?, ?, NULL, ?, ?, ?)`,
    ).bind(
      reRegistrationSupportCaseId,
      counselor.orgId,
      participant.beneficiaryId,
      '2026-07-14T10:00:00.000Z',
      '44444444-4444-4444-8444-444444444444',
      SHA256,
      admin.userId,
      counselor.userId,
      CREATED_AT,
      CREATED_AT,
    ).run();

    const purgedVault = await t.db.prepare(
      'SELECT version FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first<{ version: number }>();
    if (purgedVault === null) throw new Error('expected purged participant vault');
    await expect(updateParticipantPii(t.env, admin, participant.beneficiaryId, {
      supportCaseContextId: reRegistrationSupportCaseId,
      expectedVersion: purgedVault.version,
      name: 'ORDINARY_UPDATE_MUST_NOT_REVIVE',
    })).rejects.toThrow('participant data is unavailable');
    // 일반 update 는 파기된 금고를 되살리지 못한다 — 값은 비어 있고 purged 상태 그대로다.
    await expect(t.db.prepare(
      `SELECT enc_name, enc_phone, enc_account, enc_email, purged_at IS NOT NULL AS purged
       FROM participant_pii_vault WHERE beneficiary_id = ?`,
    ).bind(participant.beneficiaryId).first()).resolves.toMatchObject({
      enc_name: null,
      enc_phone: null,
      enc_account: null,
      enc_email: null,
      purged: 1,
    });

    await expect(reRegisterParticipantPii(t.env, admin, participant.beneficiaryId, {
      supportCaseContextId: reRegistrationSupportCaseId,
      expectedVersion: purgedVault.version,
      reason: 'new participation',
      name: 'RE_REGISTERED_NAME',
      phone: '010-1111-1111',
      account: 'RE_REGISTERED_ACCOUNT',
    })).resolves.toMatchObject({
      beneficiaryId: participant.beneficiaryId,
      version: purgedVault.version + 1,
      purgedAt: null,
    });
    await expect(t.db.prepare(
      `SELECT enc_name, enc_phone, enc_account, key_version, purge_due, purged_at, purged_by,
              purged_by_role, retention_change_kind, version
       FROM participant_pii_vault WHERE beneficiary_id = ?`,
    ).bind(participant.beneficiaryId).first()).resolves.toMatchObject({
      enc_name: expect.any(String),
      enc_phone: expect.any(String),
      enc_account: expect.any(String),
      key_version: 1,
      purge_due: null,
      purged_at: null,
      purged_by: null,
      purged_by_role: null,
      retention_change_kind: 're_register_pii',
      version: purgedVault.version + 1,
    });
    await expect(t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE action = 're_register_pii' AND beneficiary_id = ?`,
    ).bind(participant.beneficiaryId).first<{ count: number }>()).resolves.toEqual({ count: 1 });
  });
});
