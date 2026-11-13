// CCC-201 variant probe — invite/signup and role-scope surfaces that runtime.test.ts
// does not cover. Synthetic D1 only; every behavior observation traverses the real
// request handler or the real Worker entry. Output rows carry key/type/variant/status
// only — no token, signing-key, or PII values.
//
// Evidence labeling:
//   'worker-public'   — worker.fetch on token-credential routes that never resolve an
//                       actor (the invite token itself is the credential).
//   'injected-actor'  — handleRequest with a test-supplied Actor. Proves route/scope
//                       behavior, NOT real authentication (no Access JWT, no
//                       directory-backed identity resolution).
import { expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { handleRequest } from '../../packages/http-api/src/request-handler';
import worker from '../../apps/api/src/index';
import { createD1TestContext, testActors, testProgramId, type TestApiEnv } from '../../apps/api/test/support/d1';
import { seedProviderRegistry, signupConsentEvents } from '../../apps/api/test/support/registration';
import { intakeInput } from '../../apps/api/test/support/intake';
import { createTestSigner, signedManifest } from '../../apps/api/test/support/install-manifest';
import type { Actor } from '@ccc/core/gateway';
import { CONSENT_DOMAINS } from '@ccc/contracts/consent';

type EvidenceType = 'worker-public' | 'injected-actor';
const events: Array<{ key: string; type: EvidenceType; variant: string; status: number; shape: unknown }> = [];

function responseShape(value: unknown): unknown {
  if (value === null) return 'null';
  if (Array.isArray(value)) return { array: [...new Set(value.map(item => JSON.stringify(responseShape(item))))].map(item => JSON.parse(item)) };
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,responseShape(item)]));
  return typeof value;
}

function httpRequest(path: string, method: string, body?: unknown): Request {
  return new Request(`http://127.0.0.1${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

/** Response bodies are untrusted JSON — narrow before reading fields. */
function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('expected a JSON object response body');
  }
  return value as Record<string, unknown>;
}
function asString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('expected a non-empty string field');
  return value;
}
function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('expected an array field');
  return value;
}

it('probes invite/signup and role-scope variants through the real handler and worker', async () => {
  const context = await createD1TestContext();
  const signer = await createTestSigner();
  const env: TestApiEnv = {
    ...context.env,
    CCC_LLM_MODE: 'off',
    CCC_STT_MODE: 'off',
    CCC_INSTALL_MANIFEST: JSON.stringify(await signedManifest(signer, 'community-cloud')),
    CCC_INSTALL_SIGNING_KEYS: JSON.stringify(signer.publicKeys),
  };
  // Participant public surface exists only when the switch is exactly '1' (CCC-112).
  const signupEnv: TestApiEnv = { ...env, PUBLIC_SIGNUP_ENABLED: '1' };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
      throw new Error('ccc201_external_egress_forbidden');
    }
    return originalFetch(input, init);
  };

  const { admin, counselor, unassignedCounselor } = testActors;
  // Seeded in the template directory (d1.ts testHumanDirectory): active counselor with
  // a practitioner grant and no assignment/supervision — the "nonassigned" actor.
  const nonassigned: Actor = { userId: 'counselor.routes@example.invalid', orgId: 'org_demo', role: 'counselor' };
  const nullEmailUserId = crypto.randomUUID();
  const nullEmailActor: Actor = { userId: nullEmailUserId, orgId: 'org_demo', role: 'counselor' };
  const techAdminId = 'tech.admin@example.invalid';
  const techAdmin: Actor = { userId: techAdminId, orgId: 'org_demo', role: 'admin' };
  const programId = testProgramId('org_demo');

  interface Observed { status: number; body: unknown }
  async function api(
    key: string,
    variant: string,
    path: string,
    opts: { method?: string; body?: unknown; actor: Actor; env?: TestApiEnv },
  ): Promise<Observed> {
    const response = await handleRequest(httpRequest(path, opts.method ?? 'GET', opts.body), opts.env ?? env, async () => opts.actor);
    const body: unknown = await response.json().catch(() => null);
    events.push({ key, type: 'injected-actor', variant, status: response.status, shape: responseShape(body) });
    return { status: response.status, body };
  }
  async function pub(
    key: string,
    variant: string,
    path: string,
    opts: { method?: string; body?: unknown; env?: TestApiEnv } = {},
  ): Promise<Observed> {
    const response = await worker.fetch(httpRequest(path, opts.method ?? 'GET', opts.body), opts.env ?? env);
    const body: unknown = await response.json().catch(() => null);
    events.push({ key, type: 'worker-public', variant, status: response.status, shape: responseShape(body) });
    return { status: response.status, body };
  }

  try {
    // Raw synthetic directory fixtures (allowed inside this owned harness):
    //  - a counselor with NULL email/name (post-0045 local-account shape); the users
    //    insert trigger seeds its practitioner grant.
    //  - an institution_technical_admin-only account: users.role='admin' seeds both
    //    institution grants, then institution_admin is revoked. org_demo keeps other
    //    institution_admin holders, so the last-required-role guard passes.
    //  - a team where unassignedCounselor supervises counselor (the caseB assignee).
    await context.db.prepare(
      "INSERT INTO users (id, org_id, email, role, active, name) VALUES (?, ?, NULL, 'counselor', 1, NULL)",
    ).bind(nullEmailUserId, 'org_demo').run();
    await context.db.prepare(
      "INSERT INTO users (id, org_id, email, role, active) VALUES (?, ?, ?, 'admin', 1)",
    ).bind(techAdminId, 'org_demo', techAdminId).run();
    await context.db.prepare(
      `UPDATE user_role_assignments SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE org_id = ? AND user_id = ? AND role = 'institution_admin' AND revoked_at IS NULL`,
    ).bind('org_demo', techAdminId).run();
    await context.db.batch([
      context.db.prepare('INSERT INTO teams (id, org_id, name, created_by) VALUES (?, ?, ?, ?)')
        .bind('ccc201-team', 'org_demo', '합성 감독 팀', admin.userId),
      context.db.prepare('INSERT INTO team_memberships (id, org_id, team_id, user_id, added_by) VALUES (?, ?, ?, ?, ?)')
        .bind('ccc201-member', 'org_demo', 'ccc201-team', counselor.userId, admin.userId),
      context.db.prepare('INSERT INTO team_supervisor_grants (id, org_id, team_id, supervisor_user_id, granted_by) VALUES (?, ?, ?, ?, ?)')
        .bind('ccc201-supervisor', 'org_demo', 'ccc201-team', unassignedCounselor.userId, admin.userId),
    ]);
    // Disclosure issuance reads the approved provider registry — seed it before the
    // public disclosures route runs (signupConsentEvents would seed it too late).
    await seedProviderRegistry(env.DB, 'org_demo');

    // ── participant request link: issue → disclosures → legacy-body 400 → signup → used link ──
    const inviteA = await api('participant.issue.null-email-issuer', 'POST /invites/participant', '/invites/participant',
      { method: 'POST', body: { programId }, actor: nullEmailActor, env: signupEnv });
    expect(inviteA.status).toBe(201);
    const tokenA = asString(asRecord(inviteA.body).token);

    const disclosuresA = await pub('participant.disclosures', 'GET /invites/participant/:token/consent/disclosures',
      `/invites/participant/${tokenA}/consent/disclosures`, { env: signupEnv });
    expect(disclosuresA.status).toBe(200);
    expect(asArray(asRecord(disclosuresA.body).disclosures)).toHaveLength(CONSENT_DOMAINS.length);

    const issuedA = await pub('participant.link.issued', 'GET /invites/participant/:token',
      `/invites/participant/${tokenA}`, { env: signupEnv });
    expect(issuedA.status).toBe(200);
    expect(issuedA.body).toMatchObject({ status: 'issued', programId, programType: 'financial_support_v1' });
    expect(Object.keys(asRecord(issuedA.body)).sort()).toEqual(['expiresAt', 'orgName', 'programId', 'programType', 'status']);

    // Old web consent shape {privacy, recordingAi} is rejected at the boundary (400)
    // and must not consume the token — the link stays usable.
    const legacy = await pub('participant.signup.legacy-consent-rejected', 'POST /signup/participant', '/signup/participant',
      { method: 'POST', body: { token: tokenA, name: '합성 당사자', consent: { privacy: true, recordingAi: true } }, env: signupEnv });
    expect(legacy.status).toBe(400);
    const stillIssued = await pub('participant.link.still-issued-after-400', 'GET /invites/participant/:token',
      `/invites/participant/${tokenA}`, { env: signupEnv });
    expect(stillIssued.status).toBe(200);
    expect(asRecord(stillIssued.body).status).toBe('issued');

    const consentA = await signupConsentEvents(env, tokenA);
    const signupA = await pub('participant.signup', 'POST /signup/participant', '/signup/participant',
      { method: 'POST', body: { token: tokenA, name: '합성 당사자', consentEvents: consentA }, env: signupEnv });
    expect(signupA.status).toBe(201);
    expect(Object.keys(asRecord(signupA.body)).sort()).toEqual(['beneficiaryId', 'supportCaseId']);

    // Issuer has neither name nor email → counselorName is null; message is present.
    const usedA = await pub('participant.link.used.null-counselor-name', 'GET /invites/participant/:token',
      `/invites/participant/${tokenA}`, { env: signupEnv });
    expect(usedA.status).toBe(200);
    expect(usedA.body).toMatchObject({ status: 'used', counselorName: null });
    expect(Object.keys(asRecord(usedA.body)).sort()).toEqual(['counselorName', 'message', 'status']);
    expect(typeof asRecord(usedA.body).message).toBe('string');

    // Second link issued by the seeded counselor (name null → counselorName falls back to email).
    const inviteB = await api('participant.issue.counselor', 'POST /invites/participant', '/invites/participant',
      { method: 'POST', body: { programId }, actor: counselor, env: signupEnv });
    expect(inviteB.status).toBe(201);
    const tokenB = asString(asRecord(inviteB.body).token);
    const consentB = await signupConsentEvents(env, tokenB);
    const signupB = await pub('participant.signup.second', 'POST /signup/participant', '/signup/participant',
      { method: 'POST', body: { token: tokenB, name: '합성 당사자', consentEvents: consentB }, env: signupEnv });
    expect(signupB.status).toBe(201);
    const beneficiaryB = asString(asRecord(signupB.body).beneficiaryId);
    const caseB = asString(asRecord(signupB.body).supportCaseId);
    const usedB = await pub('participant.link.used.named-counselor', 'GET /invites/participant/:token',
      `/invites/participant/${tokenB}`, { env: signupEnv });
    expect(usedB.status).toBe(200);
    expect(asRecord(usedB.body).status).toBe('used');
    expect(asRecord(usedB.body).counselorName).toBe(counselor.userId);

    // ── staff invites: independent of PUBLIC_SIGNUP_ENABLED — env carries no switch ──
    // The invite contract stores raw directory literals; the public 'worker' vocabulary
    // is rejected (400), 'practitioner' is the real literal.
    for (const role of ['worker', 'supervisor']) {
      const badRole = await api(`staff.issue.unsupported-${role}`, `POST /staff-invites role=${role}`, '/staff-invites',
        { method: 'POST', body: { email: 'bad.role@example.invalid', roles: [role] }, actor: admin });
      expect(badRole.status).toBe(400);
    }

    const issued = await api('staff.issue', 'POST /staff-invites', '/staff-invites',
      { method: 'POST', body: { email: 'Invited.Staff@Example.Invalid', roles: ['practitioner'] }, actor: admin });
    expect(issued.status).toBe(201);
    expect(Object.keys(asRecord(issued.body)).sort()).toEqual(['invite', 'token']);
    const staffInvite = asRecord(asRecord(issued.body).invite);
    const staffInviteId = asString(staffInvite.id);
    const staffToken = asString(asRecord(issued.body).token);
    expect(staffInvite).toMatchObject({ email: 'invited.staff@example.invalid', roles: ['practitioner'], status: 'issued' });

    const list = await api('staff.list.token-free', 'GET /staff-invites', '/staff-invites', { actor: admin });
    expect(list.status).toBe(200);
    const listed = asArray(asRecord(list.body).invites).map(asRecord).find((row) => row.id === staffInviteId);
    expect(listed).toMatchObject({ status: 'issued' });
    expect(JSON.stringify(list.body)).not.toContain(staffToken);

    const publicInfo = await pub('staff.public-info', 'GET /staff-invites/token/:token', `/staff-invites/token/${staffToken}`);
    expect(publicInfo.status).toBe(200);
    expect(asRecord(publicInfo.body).roles).toEqual(['practitioner']);
    expect(Object.keys(asRecord(publicInfo.body)).sort()).toEqual(['expiresAt', 'orgName', 'roles']);

    const accept = await pub('staff.accept', 'POST /staff-invites/token/:token/accept', `/staff-invites/token/${staffToken}/accept`,
      { method: 'POST', body: { name: '합성 직원', email: 'invited.staff@example.invalid' } });
    expect(accept.status).toBe(201);
    expect(accept.body).toMatchObject({ email: 'invited.staff@example.invalid', roleWaiting: false });

    const issued2 = await api('staff.issue.for-revoke', 'POST /staff-invites', '/staff-invites',
      { method: 'POST', body: { email: 'revoke.me@example.invalid', roles: ['practitioner'] }, actor: admin });
    expect(issued2.status).toBe(201);
    const invite2Id = asString(asRecord(asRecord(issued2.body).invite).id);
    const token2 = asString(asRecord(issued2.body).token);
    const revoke = await api('staff.revoke.token-free', 'POST /staff-invites/:id/revoke', `/staff-invites/${invite2Id}/revoke`,
      { method: 'POST', actor: admin });
    expect(revoke.status).toBe(200);
    expect(asRecord(asRecord(revoke.body).invite).status).toBe('revoked');
    expect(JSON.stringify(revoke.body)).not.toContain(token2);
    const revokedInfo = await pub('staff.public-info.revoked-404', 'GET /staff-invites/token/:token', `/staff-invites/token/${token2}`);
    expect(revokedInfo.status).toBe(404);

    // ── nullable-email account: /me and the admin directory ──
    const me = await api('me.null-email', 'GET /me', '/me', { actor: nullEmailActor });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({ id: nullEmailUserId, email: null, role: 'counselor', active: true });
    expect(asRecord(me.body).roles).toEqual(['worker']);

    const directory = await api('directory.contains-null-email', 'GET /settings/accounts', '/settings/accounts', { actor: admin });
    expect(directory.status).toBe(200);
    const nullEmailAccount = asArray(asRecord(directory.body).accounts).map(asRecord)
      .find((row) => row.id === nullEmailUserId);
    expect(nullEmailAccount).toMatchObject({ email: null, active: true, roles: ['worker'] });

    // ── hub: restricted identification vs full ──
    const restrictedHub = await api('hub.restricted.nonassigned', 'GET /participants/:id/hub', `/participants/${beneficiaryB}/hub`,
      { actor: nonassigned });
    expect(restrictedHub.status).toBe(200);
    expect(asRecord(restrictedHub.body).restricted).toBe(true);
    expect(asRecord(asArray(asRecord(restrictedHub.body).programs)[0]).authorized).toBe(false);
    expect(asRecord(restrictedHub.body)).not.toHaveProperty('participantBirthDate');

    const fullHub = await api('hub.full.assignee', 'GET /participants/:id/hub', `/participants/${beneficiaryB}/hub`,
      { actor: counselor });
    expect(fullHub.status).toBe(200);
    expect(asRecord(fullHub.body).restricted).toBe(false);
    expect(asRecord(asArray(asRecord(fullHub.body).programs)[0]).authorized).toBe(true);

    // ── case scope: supervisor read-only, nonassigned denied, technical-admin denied ──
    const intakeB = await intakeInput(env, counselor, caseB);
    const intakeCreated = await api('intake.create.by-assignee', 'POST /support-cases/:id/records/intake',
      `/support-cases/${caseB}/records/intake`, { method: 'POST', body: intakeB, actor: counselor });
    expect(intakeCreated.status).toBe(201);

    const supervisorRead = await api('intake.read.supervisor', 'GET /support-cases/:id/records/intake',
      `/support-cases/${caseB}/records/intake`, { actor: unassignedCounselor });
    expect(supervisorRead.status).toBe(200);
    expect(supervisorRead.body).toMatchObject({ canWrite: false, hasIntake: true });

    const intakeUpdate = {
      schemaVersion: 2, expectedRevision: 1, heldAt: intakeB.heldAt, channel: 'in_person',
      questionnaire: intakeB.questionnaire,
    };
    const supervisorWrite = await api('intake.write.supervisor-denied', 'PUT /support-cases/:id/records/intake',
      `/support-cases/${caseB}/records/intake`, { method: 'PUT', body: intakeUpdate, actor: unassignedCounselor });
    expect(supervisorWrite.status).toBe(403);

    const nonassignedRead = await api('intake.read.nonassigned-denied', 'GET /support-cases/:id/records/intake',
      `/support-cases/${caseB}/records/intake`, { actor: nonassigned });
    expect(nonassignedRead.status).toBe(403);
    const nonassignedWrite = await api('intake.write.nonassigned-denied', 'PUT /support-cases/:id/records/intake',
      `/support-cases/${caseB}/records/intake`, { method: 'PUT', body: intakeUpdate, actor: nonassigned });
    expect(nonassignedWrite.status).toBe(403);

    const techRead = await api('records.read.technical-admin-denied', 'GET /support-cases/:id/records',
      `/support-cases/${caseB}/records?official=true`, { actor: techAdmin });
    expect(techRead.status).toBe(403);
    const techHub = await api('hub.technical-admin-denied', 'GET /participants/:id/hub', `/participants/${beneficiaryB}/hub`,
      { actor: techAdmin });
    expect(techHub.status).toBe(403);
  } finally {
    globalThis.fetch = originalFetch;
    try {
      writeFileSync(process.env.CCC201_VARIANTS_OUTPUT!, JSON.stringify({
        evidenceKind: 'actual_http_responses_synthetic_d1',
        note: "type 'worker-public' traversed the real Worker entry on token-credential routes that never resolve an actor; type 'injected-actor' traversed handleRequest with a test-supplied Actor and does not prove real authentication",
        events,
      }, null, 2) + '\n');
    } finally {
      await context.dispose();
    }
  }
}, 300_000);
