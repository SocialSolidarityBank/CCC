import { describe, expect, it } from 'vitest';
import { handleRequest } from '@ccc/http-api';
import {
  resolveDirectoryActorByAuthSubject,
  revokeActorSessions,
  revokeIdentitySession,
} from '@ccc/core/gateway';
import type { Actor } from '@ccc/contracts/runtime';
import { setupD1, testActors } from './support/d1';

const t = setupD1();
const subject = 'e34cb320-9d2b-4ce4-8bb5-48d78ba72678';
const authn: Actor['authn'] = {
  source: 'supabase-jwt', assurance: 'aal2', sessionId: '77811e67-0385-44d8-a234-cd0044134026',
};

async function bindSubject(userId = testActors.counselor.userId) {
  await t.db.prepare('UPDATE users SET auth_subject = ? WHERE id = ?').bind(subject, userId).run();
}

function resolve(issuedAt = new Date().toISOString(), session = authn) {
  return resolveDirectoryActorByAuthSubject(t.env, subject, session, issuedAt);
}

describe('verified Supabase subjects and directory authorization', () => {
  it('uses the opaque auth subject, never email, and rejects inactive users', async () => {
    await t.reset();
    await bindSubject();
    expect(await resolve()).toMatchObject({
      kind: 'human', userId: testActors.counselor.userId, orgId: 'org_demo', roles: ['worker'],
    });
    expect(await resolveDirectoryActorByAuthSubject(
      t.env, testActors.counselor.userId, authn, new Date().toISOString(),
    )).toBeNull();
    expect(await resolveDirectoryActorByAuthSubject(
      t.env, ` ${subject}`, authn, new Date().toISOString(),
    )).toBeNull();
    await t.db.prepare('UPDATE users SET active = 0 WHERE id = ?').bind(testActors.counselor.userId).run();
    expect(await resolve()).toBeNull();
  });

  it('keeps a revoked session closed even when a refreshed credential was issued later', async () => {
    await t.reset();
    await bindSubject();
    await revokeIdentitySession(t.env, authn.sessionId!, 'logout');
    const later = new Date(Date.now() + 60_000).toISOString();
    expect(await resolve(later)).toBeNull();
    expect(await resolve(later, { ...authn, sessionId: '8d85d6f1-6e49-4935-83e6-ef87828697bb' }))
      .toMatchObject({ userId: testActors.counselor.userId });
  });

  it('rejects credentials predating actor-wide revocation without disabling a subsequent login', async () => {
    await t.reset();
    await bindSubject();
    await revokeActorSessions(t.env, testActors.counselor.userId, 'security-event');
    expect(await resolve('2000-01-01T00:00:00.000Z')).toBeNull();
    expect(await resolve(new Date(Date.now() + 60_000).toISOString()))
      .toMatchObject({ userId: testActors.counselor.userId });
  });

  it('allows technical-only self-account reads without granting institution administrator writes', async () => {
    await t.reset();
    await bindSubject();
    await t.db.prepare('UPDATE user_role_assignments SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .bind(new Date().toISOString(), testActors.counselor.userId).run();
    await t.db.prepare(
      `INSERT INTO user_role_assignments (id, org_id, user_id, role, source, granted_by)
       VALUES ('technical-grant', 'org_demo', ?, 'institution_technical_admin', 'manual', ?)`,
    ).bind(testActors.counselor.userId, testActors.admin.userId).run();
    const actor = await resolve();
    if (actor === null) throw new Error('expected an active technical identity');
    const me = await handleRequest(new Request('https://api.example.invalid/me'), t.env, async () => actor);
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ id: testActors.counselor.userId, roles: ['technical-admin'] });
    const denied = await handleRequest(new Request('https://api.example.invalid/organization/profile', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orgName: 'Unauthorized change', expectedOrgName: null }),
    }), t.env, async () => actor);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({ error: 'forbidden' });
  });
});
