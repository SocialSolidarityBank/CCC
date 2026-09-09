import { EventEmitter, once } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { PreparedStatement } from '@ccc/contracts/database';
import {
  closeSupportCase,
  createBeneficiaryWithInitialSupportCase,
  type Actor,
} from '@ccc/core/gateway';
import worker from './support/local-worker';
import { setupD1, testActors, testProgramId } from './support/d1';

const t = setupD1();
const admin: Actor = testActors.admin;
const counselor: Actor = testActors.counselor;

function headers(actor: Actor): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

function policyRequest(
  method: 'GET' | 'PUT',
  body?: unknown,
  actor: Actor = admin,
  env = t.env,
): Promise<Response> {
  return worker.fetch(new Request('http://localhost/settings/retention-policy', {
    method,
    headers: headers(actor),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), env);
}

describe('retention policy settings', () => {
  it('reads the stored grace period and writes it back with a version CAS', async () => {
    await t.reset();
    await expect((await policyRequest('GET')).json()).resolves.toEqual({
      orgId: admin.orgId,
      piiPurgeGraceDays: 180,
      version: 1,
    });

    const saved = await policyRequest('PUT', { expectedVersion: 1, piiPurgeGraceDays: 30 });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toEqual({
      orgId: admin.orgId,
      piiPurgeGraceDays: 30,
      version: 2,
    });
    await expect((await policyRequest('GET')).json()).resolves.toEqual(expect.objectContaining({
      piiPurgeGraceDays: 30,
      version: 2,
    }));
    expect(await t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE org_id = ? AND target_table = 'organization_settings' AND action = 'update'`,
    ).bind(admin.orgId).first<{ count: number }>()).toEqual({ count: 1 });
  });

  it('allows only one successful audited transition for concurrent same-value writers', async () => {
    await t.reset();
    const barrier = new EventEmitter();
    const ready = once(barrier, 'ready');
    const database = t.env.DB;
    let arrivals = 0;
    const env = {
      ...t.env,
      DB: {
        prepare: database.prepare.bind(database),
        async batch<T>(statements: PreparedStatement[]) {
          if (++arrivals === 2) barrier.emit('ready');
          await ready;
          return database.batch<T>(statements);
        },
      },
    };
    const results = await Promise.all([
      policyRequest('PUT', { expectedVersion: 1, piiPurgeGraceDays: 30 }, admin, env),
      policyRequest('PUT', { expectedVersion: 1, piiPurgeGraceDays: 30 }, admin, env),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    expect(await t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE org_id = ? AND target_table = 'organization_settings' AND action = 'update'`,
    ).bind(admin.orgId).first<{ count: number }>()).toEqual({ count: 1 });
  });

  it('rejects stale and out-of-bound writes without changing the saved policy', async () => {
    await t.reset();
    expect((await policyRequest('PUT', { expectedVersion: 1, piiPurgeGraceDays: 30 })).status).toBe(200);
    expect((await policyRequest('PUT', { expectedVersion: 1, piiPurgeGraceDays: 31 })).status).toBe(409);
    expect((await policyRequest('PUT', { expectedVersion: 2, piiPurgeGraceDays: 1827 })).status).toBe(400);
    await expect((await policyRequest('GET')).json()).resolves.toEqual(expect.objectContaining({
      piiPurgeGraceDays: 30,
      version: 2,
    }));
    expect(await t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE org_id = ? AND target_table = 'organization_settings' AND action = 'update'`,
    ).bind(admin.orgId).first<{ count: number }>()).toEqual({ count: 1 });
  });

  it('displays historical larger values but does not accept them as new policy values', async () => {
    await t.reset();
    await t.db.prepare(
      `UPDATE organization_settings SET pii_purge_grace_days = 2000 WHERE org_id = ?`,
    ).bind(admin.orgId).run();
    await expect((await policyRequest('GET')).json()).resolves.toEqual(expect.objectContaining({
      piiPurgeGraceDays: 2000,
    }));
    expect((await policyRequest('PUT', { expectedVersion: 1, piiPurgeGraceDays: 2001 })).status).toBe(400);
  });

  it('allows only an active institution admin and never recreates a missing row', async () => {
    await t.reset();
    expect((await policyRequest('GET', undefined, counselor)).status).toBe(403);
    expect((await policyRequest('PUT', { expectedVersion: 1, piiPurgeGraceDays: 30 }, counselor)).status).toBe(403);
    expect((await policyRequest('GET', undefined, testActors.service)).status).toBe(403);
    // A technical-admin/legacy-admin identity is not enough without the
    // canonical institution_admin assignment.
    await t.db.prepare(
      `UPDATE user_role_assignments SET revoked_at = '2026-09-09T00:00:00Z'
       WHERE user_id = ? AND org_id = ? AND role = 'institution_admin'`,
    ).bind(admin.userId, admin.orgId).run();
    expect((await policyRequest('GET')).status).toBe(403);
    expect((await policyRequest('PUT', { expectedVersion: 1, piiPurgeGraceDays: 30 })).status).toBe(403);
    // Client-supplied organization scope is not an accepted write field.
    expect((await policyRequest('PUT', {
      expectedVersion: 1, piiPurgeGraceDays: 30, orgId: 'org_other',
    })).status).toBe(400);
    await t.db.prepare('DELETE FROM organization_settings WHERE org_id = ?').bind(admin.orgId).run();
    expect(await t.db.prepare('SELECT org_id FROM organization_settings WHERE org_id = ?').bind(admin.orgId).first()).toBeNull();
  });

  it('rolls back the policy update when its success audit fails', async () => {
    await t.reset();
    await t.db.prepare(`CREATE TRIGGER reject_retention_policy_audit BEFORE INSERT ON audit_log
      WHEN NEW.target_table = 'organization_settings' AND NEW.action = 'update'
      BEGIN SELECT RAISE(ABORT, 'retention policy audit unavailable'); END`).run();
    expect((await policyRequest('PUT', { expectedVersion: 1, piiPurgeGraceDays: 30 })).status).toBe(500);
    expect(await t.db.prepare(
      'SELECT pii_purge_grace_days, version FROM organization_settings WHERE org_id = ?',
    ).bind(admin.orgId).first()).toEqual({ pii_purge_grace_days: 180, version: 1 });
    expect(await t.db.prepare(
      `SELECT COUNT(*) AS count FROM audit_log
       WHERE org_id = ? AND target_table = 'organization_settings' AND action = 'update'`,
    ).bind(admin.orgId).first<{ count: number }>()).toEqual({ count: 0 });
  });

  it('feeds the saved value into the native future-case closure clock', async () => {
    await t.reset();
    expect((await policyRequest('PUT', { expectedVersion: 1, piiPurgeGraceDays: 20 })).status).toBe(200);
    const created = await createBeneficiaryWithInitialSupportCase(t.env, counselor, {
      programId: testProgramId(counselor.orgId),
      intakeAt: '2026-01-01T09:00:00.000Z',
    });
    await closeSupportCase(t.env, counselor, created.supportCaseId, 'native retention setting scenario');
    const due = await t.db.prepare(
      `SELECT vault.purge_due AS purgeDue, cases.closed_at AS closedAt
       FROM participant_pii_vault AS vault
       JOIN support_cases AS cases ON cases.id = vault.retention_context_support_case_id
       WHERE vault.beneficiary_id = ? AND vault.org_id = ?`,
    ).bind(created.beneficiaryId, counselor.orgId).first<{ purgeDue: string; closedAt: string }>();
    if (due === null) throw new Error('expected the closed case retention clock');
    expect(due.purgeDue).toBe(new Date(Date.parse(due.closedAt) + 20 * 86_400_000).toISOString());
  });
});
