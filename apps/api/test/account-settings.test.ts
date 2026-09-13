import { describe, expect, it } from 'vitest';
import type { Actor } from '@ccc/core/gateway';
import type { Actor as IdentityActor } from '@ccc/contracts/runtime';
import { handleRequest } from '@ccc/http-api';
import worker from './support/local-worker';
import { setupD1, testActors } from './support/d1';

const t = setupD1();
const { admin, counselor, otherOrgAdmin } = testActors;
function request(path: string, method = 'GET', body?: unknown, actor: Actor = admin): Promise<Response> {
  return worker.fetch(new Request(`http://localhost/settings/accounts${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'X-CCC-User-Id': actor.userId,
      'X-CCC-Org-Id': actor.orgId, 'X-CCC-Role': actor.role },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), t.env);
}

describe('account settings mutation boundaries', () => {
  it('allows only one of two conflicting role replacements and audits only that replacement', async () => {
    await t.reset();
    const replies = await Promise.all([
      request(`/${counselor.userId}/roles`, 'PATCH', { expectedRoles: ['worker'], roles: ['worker', 'institution-admin'] }),
      request(`/${counselor.userId}/roles`, 'PATCH', { expectedRoles: ['worker'], roles: ['worker', 'technical-admin'] }),
    ]);
    expect(replies.map((response) => response.status).sort()).toEqual([200, 409]);
    const roles = await t.db.prepare(
      `SELECT role FROM user_role_assignments WHERE org_id = ? AND user_id = ? AND revoked_at IS NULL ORDER BY role`,
    ).bind(admin.orgId, counselor.userId).all<{ role: string }>();
    expect(roles.results.map((row) => row.role)).toEqual(expect.arrayContaining(['practitioner']));
    expect(roles.results.filter((row) => row.role !== 'practitioner')).toHaveLength(1);
    expect(await t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log WHERE org_id = ? AND target_table = 'user_role_assignments' AND target_id = ? AND action = 'update'`,
    ).bind(admin.orgId, counselor.userId).first<{ count: number }>()).toEqual({ count: 1 });
  });

  it('rejects worker and cross-organization role mutations', async () => {
    await t.reset();
    const body = { expectedRoles: ['worker'], roles: ['worker', 'institution-admin'] };
    expect((await request(`/${counselor.userId}/roles`, 'PATCH', body, counselor)).status).toBe(403);
    expect((await request(`/${counselor.userId}/roles`, 'PATCH', body, otherOrgAdmin)).status).toBe(403);
  });

  it('keeps a technical administrator when two accounts concurrently drop that role', async () => {
    await t.reset();
    await t.db.batch(['institution_admin', 'institution_technical_admin'].map((role) => t.db.prepare(
      `INSERT INTO user_role_assignments (id, org_id, user_id, role, source, granted_by) VALUES (?, ?, ?, ?, 'manual', ?)`,
    ).bind(crypto.randomUUID(), admin.orgId, counselor.userId, role, admin.userId)));
    await t.db.prepare(`UPDATE user_role_assignments SET revoked_at = ?
      WHERE org_id = ? AND role = 'institution_technical_admin' AND user_id NOT IN (?, ?) AND revoked_at IS NULL`)
      .bind(new Date().toISOString(), admin.orgId, admin.userId, counselor.userId).run();
    const responses = await Promise.all([
      request(`/${admin.userId}/roles`, 'PATCH', { roles: ['institution-admin'], expectedRoles: ['institution-admin', 'technical-admin'] }),
      request(`/${counselor.userId}/roles`, 'PATCH', { roles: ['institution-admin', 'worker'], expectedRoles: ['institution-admin', 'technical-admin', 'worker'] }, counselor),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await t.db.prepare(`SELECT COUNT(DISTINCT role.user_id) AS count FROM user_role_assignments AS role
      JOIN users AS account ON account.id = role.user_id AND account.org_id = role.org_id
      WHERE role.org_id = ? AND role.role = 'institution_technical_admin' AND role.revoked_at IS NULL AND account.active = 1`)
      .bind(admin.orgId).first<{ count: number }>()).toEqual({ count: 1 });
  });

  it('denies an existing identity after successful account offboarding', async () => {
    await t.reset();
    const me = () => worker.fetch(new Request('http://localhost/me', {
      headers: { 'X-CCC-User-Id': counselor.userId, 'X-CCC-Org-Id': counselor.orgId, 'X-CCC-Role': counselor.role },
    }), t.env);
    expect((await me()).status).toBe(200);
    expect((await request(`/${counselor.userId}/deactivate`, 'POST', { reason: 'synthetic offboarding' })).status).toBe(200);
    expect((await me()).status).toBe(403);
  });

  it('lets a technical-only identity inspect and deactivate accounts without granting roles', async () => {
    await t.reset();
    const userId = testActors.unassignedCounselor.userId;
    await t.db.prepare(`INSERT INTO user_role_assignments (id, org_id, user_id, role, source, granted_by)
      VALUES (?, ?, ?, 'institution_technical_admin', 'manual', ?)`).bind(crypto.randomUUID(), admin.orgId, userId, admin.userId).run();
    await t.db.prepare(`UPDATE user_role_assignments SET revoked_at = ? WHERE org_id = ? AND user_id = ? AND role = 'practitioner' AND revoked_at IS NULL`)
      .bind(new Date().toISOString(), admin.orgId, userId).run();
    const identity: IdentityActor = { kind: 'human', userId, orgId: admin.orgId, roles: ['technical-admin'], scopes: [],
      authn: { source: 'supabase-jwt', assurance: 'aal2', sessionId: 'synthetic-technical-session' } };
    const call = (path: string, method = 'GET', body?: unknown) => handleRequest(new Request(`http://localhost/settings/accounts${path}`, {
      method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), t.env, async () => identity);
    const directory = await call('');
    expect(directory.status).toBe(200);
    expect(await directory.json()).toMatchObject({ permissions: { canManageRoles: false, canManageAccounts: true } });
    expect((await call(`/${counselor.userId}/roles`, 'PATCH', { roles: ['institution-admin'], expectedRoles: ['worker'] })).status).toBe(403);
    expect((await call(`/${counselor.userId}/deactivate`, 'POST', { reason: 'synthetic technical offboarding' })).status).toBe(200);
  });

  it('rolls back account deactivation and credential revocation if its audit fails', async () => {
    await t.reset();
    await t.db.exec(`CREATE TRIGGER account_settings_audit_failure BEFORE INSERT ON audit_log WHEN NEW.action = 'update' AND NEW.target_table = 'users' BEGIN SELECT RAISE(ABORT, 'account_settings_audit_failure'); END;`);
    expect((await request(`/${counselor.userId}/deactivate`, 'POST', { reason: 'synthetic offboarding' })).status).toBe(500);
    expect(await t.db.prepare('SELECT active FROM users WHERE org_id = ? AND id = ?')
      .bind(admin.orgId, counselor.userId).first<{ active: number }>()).toEqual({ active: 1 });
    expect(await t.db.prepare("SELECT COUNT(*) AS count FROM auth_revocations WHERE kind = 'actor' AND subject = ?")
      .bind(counselor.userId).first<{ count: number }>()).toEqual({ count: 0 });
  });
});
