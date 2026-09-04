import { expect, it } from 'vitest';

import {
  createBeneficiaryWithInitialSupportCase,
  createSupportCase,
  processParticipantPiiRetention,
  reRegisterParticipantPii,
  reviewParticipantPiiRetention,
  updateParticipantPii,
} from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';

const t = setupD1();
const counselor = testActors.counselor;
const admin = testActors.admin;

async function closeSupportCase(supportCaseId: string, closedAt: string): Promise<void> {
  await t.db.prepare(
    `UPDATE support_cases
     SET status = 'closed', closed_at = ?, closed_reason = 'replay test',
         closed_by_actor_id = ?, updated_at = ?
     WHERE id = ? AND org_id = ? AND status = 'active'`,
  ).bind(closedAt, counselor.userId, closedAt, supportCaseId, counselor.orgId).run();
}

it('rejects a prior archive decision replayed against a later archive cycle', async () => {
  await t.reset();
  const participant = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2020-01-01T09:00:00.000Z',
  });
  await updateParticipantPii(t.env, admin, participant.beneficiaryId, {
    supportCaseContextId: participant.supportCaseId,
    expectedVersion: 1,
    name: 'REPLAY_CYCLE_ONE',
  });
  await closeSupportCase(participant.supportCaseId, '2020-01-01 00:00:00');
  await processParticipantPiiRetention(t.env);
  await reviewParticipantPiiRetention(
    { ...t.env, PII_PURGE_ENABLED: '1' },
    admin,
    participant.beneficiaryId,
    { decision: 'purge' },
  );
  const oldDecision = await t.db.prepare(
    `SELECT archive_id, decided_by, decided_at
     FROM participant_pii_retention_decisions
     WHERE beneficiary_id = ? AND decision = 'purge'`,
  ).bind(participant.beneficiaryId).first<{
    archive_id: string;
    decided_by: string;
    decided_at: string;
  }>();
  if (oldDecision === null) throw new Error('expected first-cycle purge decision');

  const purgedVault = await t.db.prepare(
    'SELECT version FROM participant_pii_vault WHERE beneficiary_id = ?',
  ).bind(participant.beneficiaryId).first<{ version: number }>();
  const later = await createSupportCase(t.env, admin, participant.beneficiaryId, {
    schemaVersion: 1,
    submissionId: '76767676-7676-4767-8767-767676767676',
    programType: 'financial_support_v1',
    initialAssigneeUserId: counselor.userId,
    consentPrivacy: true,
  });
  await reRegisterParticipantPii(t.env, admin, participant.beneficiaryId, {
    supportCaseContextId: later.supportCaseId,
    expectedVersion: purgedVault?.version ?? 0,
    reason: 'second archive cycle',
    name: 'REPLAY_CYCLE_TWO',
    phone: '010-6666-6666',
    account: 'REPLAY-ACCOUNT',
  });
  await closeSupportCase(later.supportCaseId, '2021-01-01 00:00:00');
  await processParticipantPiiRetention(t.env);
  const currentArchive = await t.db.prepare(
    'SELECT id FROM participant_pii_archives WHERE beneficiary_id = ?',
  ).bind(participant.beneficiaryId).first<{ id: string }>();
  expect(currentArchive?.id).not.toBe(oldDecision.archive_id);

  await expect(t.db.prepare(
    `UPDATE participant_pii_archives
     SET review_status = 'approved', approved_by = ?, approved_at = ?,
         state_changed_by = ?, state_changed_by_role = 'admin',
         state_changed_at = ?, updated_at = ?
     WHERE id = ? AND beneficiary_id = ?`,
  ).bind(
    oldDecision.decided_by,
    oldDecision.decided_at,
    oldDecision.decided_by,
    oldDecision.decided_at,
    oldDecision.decided_at,
    currentArchive?.id,
    participant.beneficiaryId,
  ).run()).rejects.toThrow('participant_schema_violation');
  const after = await t.db.prepare(
    `SELECT archive.review_status, vault.purged_at
     FROM participant_pii_archives AS archive
     JOIN participant_pii_vault AS vault ON vault.beneficiary_id = archive.beneficiary_id
     WHERE archive.beneficiary_id = ?`,
  ).bind(participant.beneficiaryId).first<{ review_status: string; purged_at: string | null }>();
  expect(after).toEqual({ review_status: 'pending', purged_at: null });
});
