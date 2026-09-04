import { describe, expect, it } from 'vitest';
import { Miniflare } from 'miniflare';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { createD1Database } from '@ccc/db-d1';
import { setupD1, SQLITE_MIGRATIONS_PATH, testActors } from './support/d1';

const t = setupD1();

async function applyThroughIdentityMigration() {
  const miniflare = new Miniflare({
    compatibilityDate: '2026-07-06',
    d1Databases: ['DB'],
    modules: true,
    script: 'export default { fetch() { return new Response("ok"); } };',
  });
  const rawDb = await miniflare.getD1Database('DB');
  const db = createD1Database(rawDb);
  const migrations = await readD1Migrations(SQLITE_MIGRATIONS_PATH);
  const identityIndex = migrations.findIndex((migration) => migration.queries.some((query) => query.includes('CREATE TABLE auth_revocations')));
  if (identityIndex < 0) throw new Error('expected migration 0045 identity revocation contract');
  for (const migration of migrations.slice(0, identityIndex)) {
    await db.batch(migration.queries.map((query) => db.prepare(query)));
  }
  return { miniflare, db, migration: migrations[identityIndex]! };
}

describe('0045 identity and revocation schema', () => {
  it('preserves users, role triggers and foreign keys while making email nullable', async () => {
    const { miniflare, db, migration } = await applyThroughIdentityMigration();
    try {
      await db.prepare(
        "INSERT INTO users (id, org_id, email, role, active) VALUES ('identity-admin', 'org-identity', 'admin@identity.invalid', 'admin', 1)",
      ).run();
      await db.prepare(
        "INSERT INTO users (id, org_id, email, role, active) VALUES ('identity-worker', 'org-identity', 'worker@identity.invalid', 'counselor', 1)",
      ).run();
      await db.prepare(
        "INSERT INTO teams (id, org_id, name, created_by) VALUES ('identity-team', 'org-identity', 'Identity', 'identity-admin')",
      ).run();
      await db.prepare(
        `INSERT INTO team_memberships (id, org_id, team_id, user_id, added_by)
         VALUES ('identity-membership', 'org-identity', 'identity-team', 'identity-worker', 'identity-admin')`,
      ).run();
      await db.prepare(
        `INSERT INTO team_supervisor_grants (id, org_id, team_id, supervisor_user_id, granted_by)
         VALUES ('identity-supervisor', 'org-identity', 'identity-team', 'identity-worker', 'identity-admin')`,
      ).run();


      const triggersBefore = await db.prepare(
        `SELECT name, sql FROM sqlite_schema
         WHERE type = 'trigger' AND (
           instr(sql, 'users') > 0 OR instr(sql, 'user_role_assignments') > 0
           OR instr(sql, 'teams') > 0 OR instr(sql, 'team_memberships') > 0
           OR instr(sql, 'team_supervisor_grants') > 0
         )
         ORDER BY name`,
      ).all<{ name: string; sql: string }>();
      expect(triggersBefore.results).toHaveLength(36);
      const indexesBefore = await db.prepare(
        `SELECT name, sql FROM sqlite_schema
         WHERE type = 'index' AND sql IS NOT NULL
           AND tbl_name IN ('users', 'user_role_assignments', 'teams', 'team_memberships', 'team_supervisor_grants')
         ORDER BY name`,
      ).all<{ name: string; sql: string }>();
      expect(indexesBefore.results).toHaveLength(8);

      await db.batch(migration.queries.map((query) => db.prepare(query)));
      const triggerNames = new Set(triggersBefore.results.map((trigger) => trigger.name));
      const triggersAfter = await db.prepare(
        "SELECT name, sql FROM sqlite_schema WHERE type = 'trigger' ORDER BY name",
      ).all<{ name: string; sql: string }>();
      expect(triggersAfter.results.filter((trigger) => triggerNames.has(trigger.name))).toEqual(triggersBefore.results);
      const indexNames = new Set(indexesBefore.results.map((index) => index.name));
      const indexesAfter = await db.prepare(
        `SELECT name, sql FROM sqlite_schema
         WHERE type = 'index' AND sql IS NOT NULL
           AND tbl_name IN ('users', 'user_role_assignments', 'teams', 'team_memberships', 'team_supervisor_grants')
         ORDER BY name`,
      ).all<{ name: string; sql: string }>();
      expect(indexesAfter.results.filter((index) => indexNames.has(index.name))).toEqual(indexesBefore.results);
      expect(indexesAfter.results.map((index) => index.name)).toEqual(expect.arrayContaining([
        'uq_users_email',
        'uq_users_auth_subject',
      ]));


      const columns = await db.prepare('PRAGMA table_info(users)').all<{ name: string; notnull: number }>();
      expect(columns.results.find((column) => column.name === 'email')).toMatchObject({ notnull: 0 });
      expect(columns.results.find((column) => column.name === 'auth_subject')).toMatchObject({ notnull: 0 });
      await expect(db.prepare(
        "INSERT INTO users (id, org_id, email, auth_subject, role, active) VALUES ('local-no-email', 'org-identity', NULL, 'subject-local-1', 'counselor', 1)",
      ).run()).resolves.toMatchObject({ success: true });
      await expect(db.prepare(
        "INSERT INTO users (id, org_id, email, auth_subject, role, active) VALUES ('local-no-email-2', 'org-identity', NULL, NULL, 'counselor', 1)",
      ).run()).resolves.toMatchObject({ success: true });
      await expect(db.prepare(
        "UPDATE users SET auth_subject = 'subject-local-1' WHERE id = 'local-no-email-2'",
      ).run()).rejects.toMatchObject({ kind: 'constraint', constraintSubtype: 'unique' });

      const roles = await db.prepare(
        "SELECT role FROM user_role_assignments WHERE user_id = 'local-no-email' ORDER BY role",
      ).all<{ role: string }>();
      expect(roles.results).toEqual([{ role: 'practitioner' }]);
      const preserved = await db.prepare(
        "SELECT u.id, t.created_by FROM users AS u LEFT JOIN teams AS t ON t.created_by = u.id WHERE u.id = 'identity-admin'",
      ).first<{ id: string; created_by: string }>();
      expect(preserved).toEqual({ id: 'identity-admin', created_by: 'identity-admin' });
      const component = await db.prepare(
        `SELECT
           (SELECT COUNT(*) FROM user_role_assignments WHERE org_id = 'org-identity') AS roles,
           (SELECT COUNT(*) FROM teams WHERE org_id = 'org-identity') AS teams,
           (SELECT COUNT(*) FROM team_memberships WHERE org_id = 'org-identity') AS memberships,
           (SELECT COUNT(*) FROM team_supervisor_grants WHERE org_id = 'org-identity') AS supervisors`,
      ).first<{ roles: number; teams: number; memberships: number; supervisors: number }>();
      // 기존 3개 + migration 뒤 새 local 사용자 두 명의 practitioner trigger 2개.
      expect(component).toEqual({ roles: 5, teams: 1, memberships: 1, supervisors: 1 });
      const foreignKeys = await db.prepare('PRAGMA foreign_key_check').all();
      expect(foreignKeys.results).toEqual([]);
    } finally {
      await miniflare.dispose();
    }
  });

  it('keeps revocations append-only and Agent installations bound to an active same-org service user', async () => {
    await t.reset();
    await t.db.prepare(
      "INSERT INTO auth_revocations (id, kind, subject, revoked_at, reason) VALUES ('rev-1', 'actor', ?, ?, 'security-event')",
    ).bind(testActors.counselor.userId, '2026-09-04T00:00:00.000Z').run();
    await expect(t.db.prepare("UPDATE auth_revocations SET reason = 'logout' WHERE id = 'rev-1'").run())
      .rejects.toThrow(/auth_revocations_are_append_only/);
    await expect(t.db.prepare("DELETE FROM auth_revocations WHERE id = 'rev-1'").run())
      .rejects.toThrow(/auth_revocations_are_append_only/);
    await expect(t.db.prepare(
      "INSERT INTO auth_revocations (id, kind, subject, revoked_at, reason) VALUES ('rev-bad', 'actor', 'x', ?, 'other')",
    ).bind('2026-09-04T00:00:00.000Z').run()).rejects.toThrow();

    await t.db.prepare(
      'INSERT INTO users (id, org_id, email, role, active) VALUES (?, ?, ?, ?, 1)',
    ).bind(testActors.service.userId, testActors.service.orgId, testActors.service.userId, testActors.service.role).run();

    await t.db.prepare(
      `INSERT INTO agent_installations (installation_id, org_id, actor_user_id, paired_at)
       VALUES ('install-agent-1', ?, ?, ?)`,
    ).bind(testActors.service.orgId, testActors.service.userId, '2026-09-04T00:00:00.000Z').run();
    await expect(t.db.prepare(
      `INSERT INTO agent_installations (installation_id, org_id, actor_user_id, paired_at)
       VALUES ('install-human', ?, ?, ?)`,
    ).bind(testActors.counselor.orgId, testActors.counselor.userId, '2026-09-04T00:00:00.000Z').run())
      .rejects.toThrow(/agent_installation_identity_mismatch/);
    await expect(t.db.prepare(
      "UPDATE agent_installations SET actor_user_id = ? WHERE installation_id = 'install-agent-1'",
    ).bind(testActors.counselor.userId).run()).rejects.toThrow(/agent_installation_identity_immutable/);
    await t.db.prepare(
      "UPDATE agent_installations SET revoked_at = ? WHERE installation_id = 'install-agent-1'",
    ).bind('2026-09-04T01:00:00.000Z').run();
    await expect(t.db.prepare(
      "UPDATE agent_installations SET revoked_at = ? WHERE installation_id = 'install-agent-1'",
    ).bind('2026-09-04T02:00:00.000Z').run()).rejects.toThrow(/agent_installation_revocation_immutable/);
    await expect(t.db.prepare("DELETE FROM agent_installations WHERE installation_id = 'install-agent-1'").run())
      .rejects.toThrow(/agent_installations_are_append_only/);
  });
});
