import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  assertSupportCaseAccess,
  createActionItem,
  createBeneficiaryWithInitialSupportCase,
  createCounselingSchedule,
  getParticipantBasicInfo,
  getParticipantBriefing,
  getTodaySchedules,
  listAssignedParticipants,
  updateScheduleSessionGoals,
  updateParticipantPii,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

const { counselor, unassignedCounselor, admin } = testActors;

const t = setupD1();

describe('assertSupportCaseAccess deny audit (CCC-116)', () => {
  it('rejects an unassigned counselor and records a deny_access audit row', async () => {
    await t.reset();

    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });

    await expect(assertSupportCaseAccess(t.env, unassignedCounselor, created.supportCaseId))
      .rejects.toBeInstanceOf(ForbiddenError);

    const rows = await t.db.prepare(
      `SELECT actor_id, actor_role, target_table, target_id, detail, created_at
       FROM audit_log WHERE action = 'deny_access'`,
    ).all<{
      actor_id: string;
      actor_role: string;
      target_table: string;
      target_id: string;
      detail: string | null;
      created_at: string;
    }>();

    expect(rows.results).toHaveLength(1);
    const denial = rows.results[0];
    expect(denial?.actor_id).toBe(unassignedCounselor.userId);
    expect(denial?.actor_role).toBe('counselor');
    expect(denial?.target_table).toBe('support_cases');
    expect(denial?.target_id).toBe(created.supportCaseId);
    // 행위자·역할·대상 케이스·시각만 남긴다 — 내용(detail)은 비어 있어야 한다.
    expect(denial?.detail).toBeNull();
    expect(denial?.created_at).toBeTruthy();
  });

  it('does not record deny_access when access is granted', async () => {
    await t.reset();

    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });

    await expect(assertSupportCaseAccess(t.env, counselor, created.supportCaseId))
      .resolves.toMatchObject({ id: created.supportCaseId });

    const row = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'deny_access'",
    ).first<{ count: number }>();
    expect(row).toEqual({ count: 0 });
  });

  it('allows an institution administrator to read an unassigned case', async () => {
    await t.reset();

    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });

    await expect(assertSupportCaseAccess(t.env, admin, created.supportCaseId))
      .resolves.toMatchObject({ id: created.supportCaseId });

    const row = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'deny_access' AND actor_id = ?",
    ).bind(admin.userId).first<{ count: number }>();
    expect(row).toEqual({ count: 0 });
  });

  it('does not let an administrator without a practitioner role mutate case content even when assigned', async () => {
    await t.reset();

    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });
    await createCounselingSchedule(t.env, counselor, {
      beneficiaryId: created.beneficiaryId,
      supportCaseId: created.supportCaseId,
      scheduledAt: '2099-01-01T09:00:00.000Z',
      sessionKind: 'regular',
      channel: 'in_person',
    });
    await t.db.batch([
      t.db.prepare(
        `INSERT INTO user_role_assignments (
           id, org_id, user_id, role, source, granted_by
         ) VALUES (?, ?, ?, 'practitioner', 'manual', ?)`,
      ).bind(
        'admin-practitioner-for-write-boundary',
        admin.orgId,
        admin.userId,
        admin.userId,
      ),
      t.db.prepare(
        `INSERT INTO support_case_assignees (
           id, org_id, support_case_id, user_id, role, assigned_at
         ) VALUES (?, ?, ?, ?, 'secondary', datetime('now'))`,
      ).bind(
        'assigned-admin-without-practitioner',
        admin.orgId,
        created.supportCaseId,
        admin.userId,
      ),
    ]);
    await t.db.prepare(
      `UPDATE user_role_assignments SET revoked_at = datetime('now')
       WHERE id = ? AND revoked_at IS NULL`,
    ).bind('admin-practitioner-for-write-boundary').run();

    await expect(createActionItem(
      t.env,
      admin,
      created.supportCaseId,
      { description: 'must remain unavailable', owner: 'counselor' },
    )).rejects.toBeInstanceOf(ForbiddenError);

    const denial = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'deny_access' AND actor_id = ?",
    ).bind(admin.userId).first<{ count: number }>();
    expect(denial).toEqual({ count: 1 });
  });

  it('rejects assigning a case to a user without an active practitioner role at the database boundary', async () => {
    await t.reset();

    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });

    await expect(t.db.prepare(
      `INSERT INTO support_case_assignees (
         id, org_id, support_case_id, user_id, role, assigned_at
       ) VALUES (?, ?, ?, ?, 'secondary', datetime('now'))`,
    ).bind(
      'invalid-admin-assignment',
      admin.orgId,
      created.supportCaseId,
      admin.userId,
    ).run()).rejects.toThrow(/participant_schema_violation/);
  });

  it('denies counseling reads after the institution administrator role is revoked', async () => {
    await t.reset();

    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });
    await t.db.prepare(
      `UPDATE user_role_assignments SET revoked_at = datetime('now')
       WHERE org_id = ? AND user_id = ? AND role = 'institution_admin' AND revoked_at IS NULL`,
    ).bind(admin.orgId, admin.userId).run();

    await expect(assertSupportCaseAccess(t.env, admin, created.supportCaseId))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(listAssignedParticipants(t.env, admin))
      .rejects.toBeInstanceOf(ForbiddenError);
    await expect(getTodaySchedules(t.env, admin, { date: '2099-01-01' }))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('does not let an unassigned institution administrator rewrite session goals', async () => {
    await t.reset();

    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });
    const schedule = await createCounselingSchedule(t.env, counselor, {
      beneficiaryId: created.beneficiaryId,
      supportCaseId: created.supportCaseId,
      scheduledAt: '2099-01-01T09:00:00.000Z',
      sessionKind: 'regular',
      channel: 'in_person',
    });

    await expect(updateScheduleSessionGoals(t.env, admin, schedule.id, {
      expectedVersion: schedule.version,
      sessionGoals: [{ body: '다음 회기에서 확인할 목표' }],
    })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('allows a supervisor to read a case assigned to an active team member', async () => {
    await t.reset();

    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });
    await t.db.batch([
      t.db.prepare(
        'INSERT INTO teams (id, org_id, name, created_by) VALUES (?, ?, ?, ?)',
      ).bind('team-a', counselor.orgId, 'A', admin.userId),
      t.db.prepare(
        'INSERT INTO team_memberships (id, org_id, team_id, user_id, added_by) VALUES (?, ?, ?, ?, ?)',
      ).bind('team-member-a', counselor.orgId, 'team-a', counselor.userId, admin.userId),
      t.db.prepare(
        `INSERT INTO team_supervisor_grants (
           id, org_id, team_id, supervisor_user_id, granted_by
         ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        'team-supervisor-a',
        counselor.orgId,
        'team-a',
        unassignedCounselor.userId,
        admin.userId,
      ),
    ]);

    await expect(assertSupportCaseAccess(t.env, unassignedCounselor, created.supportCaseId))
      .resolves.toMatchObject({ id: created.supportCaseId });

    await updateParticipantPii(t.env, admin, created.beneficiaryId, {
      supportCaseContextId: created.supportCaseId,
      expectedVersion: 1,
      name: 'SUPERVISED_NAME',
      phone: 'SUPERVISED_PHONE',
      account: 'SUPERVISED_ACCOUNT',
    });
    await expect(getParticipantBasicInfo(
      t.env,
      unassignedCounselor,
      created.beneficiaryId,
    )).resolves.toMatchObject({
      name: 'SUPERVISED_NAME',
      phone: 'SUPERVISED_PHONE',
      account: 'SUPERVISED_ACCOUNT',
    });
    await expect(getParticipantBriefing(
      t.env,
      unassignedCounselor,
      created.beneficiaryId,
      created.supportCaseId,
    )).resolves.toMatchObject({
      participant: {
        name: 'SUPERVISED_NAME',
        phone: 'SUPERVISED_PHONE',
      },
    });
  });

  it('rejects a supervisor after the team grant is revoked', async () => {
    await t.reset();

    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });
    await t.db.batch([
      t.db.prepare(
        'INSERT INTO teams (id, org_id, name, created_by) VALUES (?, ?, ?, ?)',
      ).bind('team-b', counselor.orgId, 'B', admin.userId),
      t.db.prepare(
        'INSERT INTO team_memberships (id, org_id, team_id, user_id, added_by) VALUES (?, ?, ?, ?, ?)',
      ).bind('team-member-b', counselor.orgId, 'team-b', counselor.userId, admin.userId),
      t.db.prepare(
        `INSERT INTO team_supervisor_grants (
           id, org_id, team_id, supervisor_user_id, granted_by, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(
        'team-supervisor-b',
        counselor.orgId,
        'team-b',
        unassignedCounselor.userId,
        admin.userId,
        '2026-08-22T00:00:00.000Z',
      ),
    ]);

    await expect(assertSupportCaseAccess(t.env, unassignedCounselor, created.supportCaseId))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it('does not let a supervisor mutate content in a supervised case', async () => {
    await t.reset();

    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programType: 'financial_support_v1',
    });
    await t.db.batch([
      t.db.prepare(
        'INSERT INTO teams (id, org_id, name, created_by) VALUES (?, ?, ?, ?)',
      ).bind('team-read-only', counselor.orgId, 'Read only', admin.userId),
      t.db.prepare(
        'INSERT INTO team_memberships (id, org_id, team_id, user_id, added_by) VALUES (?, ?, ?, ?, ?)',
      ).bind(
        'team-member-read-only',
        counselor.orgId,
        'team-read-only',
        counselor.userId,
        admin.userId,
      ),
      t.db.prepare(
        `INSERT INTO team_supervisor_grants (
           id, org_id, team_id, supervisor_user_id, granted_by
         ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        'team-supervisor-read-only',
        counselor.orgId,
        'team-read-only',
        unassignedCounselor.userId,
        admin.userId,
      ),
    ]);

    await expect(createActionItem(
      t.env,
      unassignedCounselor,
      created.supportCaseId,
      { description: 'must remain unavailable', owner: 'counselor' },
    )).rejects.toBeInstanceOf(ForbiddenError);
  });
});
