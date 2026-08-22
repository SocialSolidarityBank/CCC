import { describe, expect, it } from 'vitest';
import { setupD1, testActors } from './support/d1';

const { admin, counselor, otherOrgCounselor } = testActors;

const t = setupD1();

describe('D74 role and team access schema', () => {
  it('backfills independent institution roles from legacy human directory roles', async () => {
    await t.reset();

    const rows = await t.db.prepare(
      `SELECT user_id, role
       FROM user_role_assignments
       WHERE org_id = ? AND user_id IN (?, ?)
       ORDER BY user_id, role`,
    ).bind(admin.orgId, admin.userId, counselor.userId).all<{
      user_id: string;
      role: string;
    }>();

    expect(rows.results).toEqual([
      { user_id: admin.userId, role: 'institution_admin' },
      { user_id: admin.userId, role: 'institution_technical_admin' },
      { user_id: counselor.userId, role: 'practitioner' },
    ]);
  });

  it('rejects a team membership that crosses organization boundaries', async () => {
    await t.reset();

    await t.db.prepare(
      'INSERT INTO teams (id, org_id, name, created_by) VALUES (?, ?, ?, ?)',
    ).bind('team-scope', admin.orgId, 'Scope', admin.userId).run();

    await expect(t.db.prepare(
      'INSERT INTO team_memberships (id, org_id, team_id, user_id, added_by) VALUES (?, ?, ?, ?, ?)',
    ).bind(
      'membership-cross-org',
      admin.orgId,
      'team-scope',
      otherOrgCounselor.userId,
      admin.userId,
    ).run()).rejects.toThrow(/authorization_scope_violation/);
  });

  it('rejects a supervisor grant that crosses organization boundaries', async () => {
    await t.reset();

    await t.db.prepare(
      'INSERT INTO teams (id, org_id, name, created_by) VALUES (?, ?, ?, ?)',
    ).bind('team-supervisor-scope', admin.orgId, 'Supervisor scope', admin.userId).run();

    await expect(t.db.prepare(
      `INSERT INTO team_supervisor_grants (
         id, org_id, team_id, supervisor_user_id, granted_by
       ) VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      'supervisor-cross-org',
      admin.orgId,
      'team-supervisor-scope',
      otherOrgCounselor.userId,
      admin.userId,
    ).run()).rejects.toThrow(/authorization_scope_violation/);
  });

  it('does not deactivate the last institution administrator and technical administrator', async () => {
    await t.reset();

    await t.db.prepare(
      'UPDATE users SET active = 0 WHERE id = ? AND org_id = ?',
    ).bind('admin.routes@example.invalid', admin.orgId).run();
    await expect(t.db.prepare(
      'UPDATE users SET active = 0 WHERE id = ? AND org_id = ?',
    ).bind(admin.userId, admin.orgId).run()).rejects.toThrow(/last_required_institution_role/);
  });
});
