import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  assertSupportCaseAccess,
  createBeneficiaryWithInitialSupportCase,
  createCounselingSchedule,
  createSupportCase,
  getTodaySchedules,
  listCounselorAssignments,
  processParticipantPiiRetention,
  reviewParticipantPiiRetention,
  reRegisterParticipantPii,
  updateParticipantPii,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';
const t = setupD1();
const counselor = testActors.counselor;
const admin = testActors.admin;
async function makeClosedParticipant(closedAt = '2025-01-01 00:00:00') {
  const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2024-01-01T09:00:00.000Z',
  });
  await updateParticipantPii(t.env, admin, created.beneficiaryId, {
    supportCaseContextId: created.supportCaseId,
    expectedVersion: 1,
    name: `RETENTION_${created.beneficiaryId}`,
  });
  await t.db.prepare(
    `UPDATE support_cases
     SET status = 'closed', closed_at = ?, closed_reason = 'retention invariant',
         closed_by_actor_id = ?, updated_at = ?
     WHERE id = ? AND org_id = ? AND status = 'active'`,
  ).bind(closedAt, counselor.userId, closedAt, created.supportCaseId, counselor.orgId).run();
  return created;
}
describe('participant PII retention invariants (CCC-121)', () => {
  it('uses a deterministic closed-case fallback for legacy rows with no retention context', async () => {
    await t.reset();
    const participant = await makeClosedParticipant('2020-01-01 00:00:00');
    const guard = await t.db.prepare(
      `SELECT sql FROM sqlite_master
       WHERE type = 'trigger' AND name = 'participant_pii_vault_retention_guard'`,
    ).first<{ sql: string }>();
    if (guard === null) throw new Error('expected retention guard');
    await t.db.prepare('DROP TRIGGER participant_pii_vault_retention_guard').run();
    await t.db.prepare(
      `UPDATE participant_pii_vault
       SET retention_context_support_case_id = NULL, purge_due = '2030-01-01 00:00:00'
       WHERE beneficiary_id = ?`,
    ).bind(participant.beneficiaryId).run();
    await t.db.prepare(guard.sql).run();
    await expect(processParticipantPiiRetention(t.env))
      .resolves.toEqual({ attempted: 1, archived: 1, requeued: 0 });
    const archive = await t.db.prepare(
      `SELECT retention_cap_due_at FROM participant_pii_archives
       WHERE beneficiary_id = ?`,
    ).bind(participant.beneficiaryId).first<{ retention_cap_due_at: string }>();
    expect(archive?.retention_cap_due_at).toBe('2025-01-01T00:00:00.000Z');
    await expect(reviewParticipantPiiRetention(
      { ...t.env, PII_PURGE_ENABLED: '1' },
      admin,
      participant.beneficiaryId,
      { decision: 'purge' },
    )).resolves.toMatchObject({ status: 'purged' });
  });
  it('clamps oversized organization grace periods to the five-year cap', async () => {
    await t.reset();
    await t.db.prepare(
      'UPDATE organization_settings SET pii_purge_grace_days = 3660 WHERE org_id = ?',
    ).bind(admin.orgId).run();
    const participant = await makeClosedParticipant('2024-02-29 00:00:00');
    const vault = await t.db.prepare(
      'SELECT purge_due FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first<{ purge_due: string }>();
    expect(vault?.purge_due).toBe('2029-02-28 00:00:00');
  });
  it('drains every due row even when one batch is smaller than the backlog', async () => {
    await t.reset();
    for (let index = 0; index < 3; index += 1) {
      await makeClosedParticipant(`2025-01-0${index + 1} 00:00:00`);
    }
    await expect(processParticipantPiiRetention(t.env, { limit: 2 }))
      .resolves.toEqual({ attempted: 3, archived: 3, requeued: 0 });
  });
  it('blocks ordinary case and schedule reads after archive', async () => {
    await t.reset();
    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2024-01-01T09:00:00.000Z',
    });
    await createCounselingSchedule(t.env, counselor, {
      beneficiaryId: created.beneficiaryId,
      supportCaseId: created.supportCaseId,
      scheduledAt: '2025-01-01T01:00:00.000Z',
    });
    await t.db.prepare(
      `UPDATE support_cases
       SET status = 'closed', closed_at = '2025-01-01 00:00:00',
           closed_reason = 'archive access', closed_by_actor_id = ?,
           updated_at = '2025-01-01 00:00:00'
       WHERE id = ? AND org_id = ? AND status = 'active'`,
    ).bind(counselor.userId, created.supportCaseId, counselor.orgId).run();
    await processParticipantPiiRetention(t.env);
    await expect(assertSupportCaseAccess(t.env, admin, created.supportCaseId)).rejects.toThrow();
    await expect(getTodaySchedules(t.env, admin, { date: '2025-01-01' }))
      .resolves.toMatchObject({ schedules: [] });
    await expect(listCounselorAssignments(t.env, admin, counselor.userId))
      .resolves.toMatchObject({ participants: [] });
  });
  it('allows only legal requirements to exceed the five-year cap', async () => {
    await t.reset();
    const participant = await makeClosedParticipant();
    await processParticipantPiiRetention(t.env);
    await expect(reviewParticipantPiiRetention(t.env, admin, participant.beneficiaryId, {
      decision: 'retain',
      reasonKind: 'active_work',
      reason: '상한을 넘길 수 없는 업무',
      retainUntil: '2031-01-01T00:00:00.000Z',
    })).rejects.toBeInstanceOf(ValidationError);
    await expect(reviewParticipantPiiRetention(t.env, admin, participant.beneficiaryId, {
      decision: 'retain',
      reasonKind: 'legal_requirement',
      reason: '법령상 보존 의무',
      retainUntil: '2031-01-01T00:00:00.000Z',
    })).resolves.toMatchObject({ status: 'retained', reasonKind: 'legal_requirement' });
  });
  it('allows a practitioner with an active institution-admin grant to approve purge', async () => {
    await t.reset();
    const participant = await makeClosedParticipant();
    await processParticipantPiiRetention(t.env);
    await t.db.prepare(
      `INSERT INTO user_role_assignments (
         id, org_id, user_id, role, source, granted_by, granted_at
       ) VALUES (?, ?, ?, 'institution_admin', 'manual', ?, datetime('now'))`,
    ).bind(
      'manual:retention:institution_admin',
      counselor.orgId,
      counselor.userId,
      admin.userId,
    ).run();
    await expect(reviewParticipantPiiRetention(
      { ...t.env, PII_PURGE_ENABLED: '1' },
      counselor,
      participant.beneficiaryId,
      { decision: 'purge' },
    )).resolves.toMatchObject({ status: 'purged' });
  });
  it('rejects state changes without an append-only administrator decision', async () => {
    await t.reset();
    const participant = await makeClosedParticipant();
    await processParticipantPiiRetention(t.env);
    await expect(t.db.prepare(
      `UPDATE participant_pii_archives
       SET review_status = 'retained', review_reason_kind = 'active_work',
           review_reason = 'bypass', review_due_at = '2027-01-01T00:00:00.000Z',
           reviewed_by = ?, reviewed_at = '2026-01-01T00:00:00.000Z',
           state_changed_by = ?, state_changed_by_role = 'admin',
           state_changed_at = '2026-01-01T00:00:00.000Z',
           updated_at = '2026-01-01T00:00:00.000Z'
       WHERE beneficiary_id = ?`,
    ).bind(admin.userId, admin.userId, participant.beneficiaryId).run())
      .rejects.toThrow('participant_schema_violation');
  });

  it('keeps retention decisions immutable after requeue', async () => {
    await t.reset();
    const participant = await makeClosedParticipant();
    await processParticipantPiiRetention(t.env);
    await reviewParticipantPiiRetention(t.env, admin, participant.beneficiaryId, {
      decision: 'retain',
      reasonKind: 'active_work',
      reason: '보존 결정 이력',
      retainUntil: '2027-01-01T00:00:00.000Z',
    });
    await processParticipantPiiRetention(t.env, { at: '2027-01-02T00:00:00.000Z' });
    const decision = await t.db.prepare(
      'SELECT id FROM participant_pii_retention_decisions WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first<{ id: string }>();
    expect(decision).not.toBeNull();
    await expect(t.db.prepare(
      'UPDATE participant_pii_retention_decisions SET reason = ? WHERE id = ?',
    ).bind('tampered', decision?.id).run()).rejects.toThrow('participant_schema_violation');
    await expect(t.db.prepare(
      'DELETE FROM participant_pii_retention_decisions WHERE id = ?',
    ).bind(decision?.id).run()).rejects.toThrow('participant_schema_violation');
  });

  it('restores retained archives without deleting decision history', async () => {
    await t.reset();
    const participant = await makeClosedParticipant();
    await processParticipantPiiRetention(t.env);
    await reviewParticipantPiiRetention(t.env, admin, participant.beneficiaryId, {
      decision: 'retain',
      reasonKind: 'active_work',
      reason: '재참여 전 보존',
      retainUntil: '2027-01-01T00:00:00.000Z',
    });
    await processParticipantPiiRetention(t.env, { at: '2027-01-02T00:00:00.000Z' });
    await createSupportCase(t.env, admin, participant.beneficiaryId, {
      schemaVersion: 1,
      submissionId: '74747474-7474-4747-8747-747474747474',
      programType: 'financial_support_v1',
      initialAssigneeUserId: counselor.userId,
      consentPrivacy: true,
    });
    const archive = await t.db.prepare(
      'SELECT 1 AS present FROM participant_pii_archives WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first();
    const decisions = await t.db.prepare(
      'SELECT COUNT(*) AS count FROM participant_pii_retention_decisions WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first<{ count: number }>();
    expect(archive).toBeNull();
    expect(decisions?.count).toBe(1);
  });

  it('keeps purge decisions after an explicitly re-registered vault', async () => {
    await t.reset();
    const participant = await makeClosedParticipant();
    await processParticipantPiiRetention(t.env);
    await reviewParticipantPiiRetention(
      { ...t.env, PII_PURGE_ENABLED: '1' },
      admin,
      participant.beneficiaryId,
      { decision: 'purge' },
    );
    const purged = await t.db.prepare(
      'SELECT version FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first<{ version: number }>();
    const later = await createSupportCase(t.env, admin, participant.beneficiaryId, {
      schemaVersion: 1,
      submissionId: '75757575-7575-4757-8757-757575757575',
      programType: 'financial_support_v1',
      initialAssigneeUserId: counselor.userId,
      consentPrivacy: true,
    });
    await reRegisterParticipantPii(t.env, admin, participant.beneficiaryId, {
      supportCaseContextId: later.supportCaseId,
      expectedVersion: purged?.version ?? 0,
      reason: 'new participation after reviewed purge',
      name: 'RE_REGISTERED_AFTER_REVIEW',
      phone: '010-5555-5555',
      account: 'RE-REGISTERED-ACCOUNT',
    });
    const decisions = await t.db.prepare(
      'SELECT COUNT(*) AS count FROM participant_pii_retention_decisions WHERE beneficiary_id = ?',
    ).bind(participant.beneficiaryId).first<{ count: number }>();
    expect(decisions?.count).toBe(1);
  });
});
