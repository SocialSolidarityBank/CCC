import { beforeAll, describe, expect, it } from 'vitest';
import { handleRequest } from '@ccc/http-api';
import { ForbiddenError, linkAuthenticatedIdentity } from '@ccc/core/gateway';
import { IdentityStoreUnavailableError } from '@ccc/contracts/runtime';
import { createSupabaseIdentity, type SupabaseIdentity } from '../../../adapters/identity-supabase/src/index';
import { setupD1, testActors, type TestApiEnv } from './support/d1';

/**
 * D80 첫 로그인 신원 연결. 초대로 등재됐지만 auth_subject 가 빈 행에만 검증된 subject 를
 * 붙인다. 자격은 Supabase access token 하나이고 요청 body 에는 이메일·subject·org 가 없다.
 */
const t = setupD1();
const issuer = 'https://abcdefghijklmnopqrst.supabase.co/auth/v1';
const jwksUri = `${issuer}/.well-known/jwks.json`;
const epoch = 1_800_000_000;
const subject = '2ffb2dd4-6d0b-4b3f-9a9e-8c95cd7d3d21';
const otherSubject = '7c4b4e31-2f2c-4a4a-9a37-c0f3f6c8e0aa';
const invitedId = 'user-invited';
const invitedEmail = 'invited@example.invalid';
type SigningKey = { pair: CryptoKeyPair; jwk: JsonWebKey & { kid: string; alg: string } };
let ec: SigningKey;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function token(claims: Record<string, unknown> = {}): Promise<string> {
  const input = `${encoded({ alg: 'ES256', kid: ec.jwk.kid, typ: 'JWT' })}.${encoded({
    iss: issuer, aud: 'authenticated', sub: subject, session_id: 'session-one', role: 'authenticated',
    is_anonymous: false, aal: 'aal1', email: invitedEmail, email_verified: true,
    iat: epoch, exp: epoch + 3600, ...claims,
  })}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, ec.pair.privateKey, new TextEncoder().encode(input),
  );
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}

/** 초대 수락 직후 상태: users 행은 있고 auth_subject 는 비어 있다. 저장된 이메일은 정규화 전 형태다. */
async function provision(options: { email?: string; role?: string; active?: number } = {}): Promise<TestApiEnv> {
  await t.reset();
  await t.db.prepare(
    'INSERT INTO users (id, org_id, email, role, active, time_zone) VALUES (?, ?, ?, ?, ?, NULL)',
  ).bind(invitedId, 'org_demo', options.email ?? ` Invited@Example.Invalid `, options.role ?? 'counselor', options.active ?? 1).run();
  return { ...t.env, installationOrgId: 'org_demo' };
}

function fixture(env: TestApiEnv): { identity: SupabaseIdentity; env: TestApiEnv } {
  const identity = createSupabaseIdentity(env, {
    issuer, jwksUri, now: () => epoch * 1000,
    fetch: async () => new Response(JSON.stringify({ keys: [ec.jwk] })),
  });
  return { identity, env: { ...env, verifyIdentityLinkClaims: (request) => identity.verifyLinkClaims(request) } };
}

function linkRequest(credential: string, init: { method?: string; path?: string; body?: string } = {}): Request {
  const headers: Record<string, string> = { Authorization: `Bearer ${credential}` };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  return new Request(`https://api.example.invalid${init.path ?? '/identity/link'}`, {
    method: init.method ?? 'POST', headers, ...(init.body === undefined ? {} : { body: init.body }),
  });
}

/** 연결 route 는 신원 해석 앞단이다. resolver 가 불리면 그 자체가 실패다. */
function link(env: TestApiEnv, request: Request): Promise<Response> {
  return handleRequest(request, env, async () => {
    throw new Error('identity resolution must not run for the link route');
  });
}

async function auditRows(): Promise<Record<string, unknown>[]> {
  const rows = await t.db.prepare(
    `SELECT org_id, actor_id, actor_role, action, target_table, target_id, case_id, detail
     FROM audit_log WHERE action = 'identity_link' ORDER BY id`,
  ).all<Record<string, unknown>>();
  return rows.results;
}

async function linkedSubject(): Promise<string | null> {
  const row = await t.db.prepare('SELECT auth_subject FROM users WHERE id = ?')
    .bind(invitedId).first<{ auth_subject: string | null }>();
  return row?.auth_subject ?? null;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  ec = { pair, jwk: { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid: 'ec-one', alg: 'ES256', use: 'sig' } };
});

describe('POST /identity/link', () => {
  it('links an invited but unlinked practitioner from an aal1 credential and audits it once', async () => {
    const f = fixture(await provision());
    const response = await link(f.env, linkRequest(await token()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ linked: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await linkedSubject()).toBe(subject);
    expect(await auditRows()).toEqual([{
      org_id: 'org_demo', actor_id: invitedId, actor_role: 'counselor', action: 'identity_link',
      target_table: 'users', target_id: invitedId, case_id: null,
      detail: JSON.stringify({
        schemaVersion: 1, via: 'first_login',
        emailSha256: await sha256Hex(invitedEmail), authSubjectSha256: await sha256Hex(subject),
      }),
    }]);
    // R3: 감사 detail 에 이메일·subject 원문은 없다.
    expect(String((await auditRows())[0]?.detail)).not.toContain('invited');
  });

  it('is idempotent for the same subject and writes nothing the second time', async () => {
    const f = fixture(await provision());
    expect((await link(f.env, linkRequest(await token()))).status).toBe(200);
    const repeated = await link(f.env, linkRequest(await token(), { body: '{}' }));
    expect(repeated.status).toBe(200);
    expect(await repeated.json()).toEqual({ linked: true });
    expect(await auditRows()).toHaveLength(1);
    expect(await linkedSubject()).toBe(subject);
  });

  it('refuses to move an email already held by another subject', async () => {
    const f = fixture(await provision());
    await t.db.prepare('UPDATE users SET auth_subject = ? WHERE id = ?').bind(otherSubject, invitedId).run();
    const response = await link(f.env, linkRequest(await token()));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'identity_already_linked' });
    expect(await linkedSubject()).toBe(otherSubject);
    expect(await auditRows()).toEqual([]);
  });

  it('reports an uninvited email as not invited without saying whether it exists elsewhere', async () => {
    const f = fixture(await provision());
    const response = await link(f.env, linkRequest(await token({ email: 'stranger@example.invalid' })));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'identity_not_invited' });
    expect(await linkedSubject()).toBeNull();
    expect(await auditRows()).toEqual([]);
  });

  it.each([
    { email_verified: false },
    { email_verified: 'true' },
    { email: undefined },
    { email: '' },
  ])('rejects a credential that does not assert a verified email: %j', async (claims) => {
    const f = fixture(await provision());
    const response = await link(f.env, linkRequest(await token(claims)));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'actor_authentication_required' });
    expect(await linkedSubject()).toBeNull();
  });

  it('never links a service-role row and never links an inactive row', async () => {
    for (const row of [{ role: 'service' }, { active: 0 }]) {
      const f = fixture(await provision(row));
      const response = await link(f.env, linkRequest(await token()));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'identity_not_invited' });
      expect(await linkedSubject()).toBeNull();
      expect(await auditRows()).toEqual([]);
    }
  });

  it('takes no email, subject or org from the request, and closes the surface without a verifier', async () => {
    const f = fixture(await provision());
    const credential = await token({ email: 'stranger@example.invalid' });
    const forged = await link(f.env, linkRequest(credential, {
      body: JSON.stringify({ email: invitedEmail, subject, orgId: 'org_demo' }),
    }));
    expect(forged.status).toBe(400);
    expect(await forged.json()).toEqual({ error: 'invalid_request' });
    expect(await linkedSubject()).toBeNull();
    const { verifyIdentityLinkClaims: _absent, ...withoutVerifier } = f.env;
    const closed = await link(withoutVerifier, linkRequest(await token()));
    expect(closed.status).toBe(404);
    expect(await linkedSubject()).toBeNull();
  });

  it('accepts POST only, on the exact path, with no query string', async () => {
    const f = fixture(await provision());
    const credential = await token();
    for (const method of ['GET', 'PATCH']) {
      expect((await link(f.env, linkRequest(credential, { method }))).status).toBe(404);
    }
    // 정확히 이 경로만 연결 route 다. 하위 경로는 연결 없이 일반 신원 해석으로 흘러간다.
    let resolved = 0;
    const extra = await handleRequest(linkRequest(credential, { path: '/identity/link/extra' }), f.env, async () => {
      resolved += 1;
      throw new ForbiddenError('unlinked identity');
    });
    expect([extra.status, resolved]).toEqual([403, 1]);
    const queried = await link(f.env, linkRequest(credential, { path: '/identity/link?email=invited' }));
    expect(queried.status).toBe(400);
    expect(await queried.json()).toEqual({ error: 'invalid_request' });
    expect(await linkedSubject()).toBeNull();
  });

  it('lets a linked practitioner resolve through the normal aal2 identity path', async () => {
    const f = fixture(await provision());
    expect((await link(f.env, linkRequest(await token()))).status).toBe(200);
    const actor = await f.identity.resolve(new Request('https://api.example.invalid/me', {
      headers: { Authorization: `Bearer ${await token({ aal: 'aal2' })}` },
    }));
    expect(actor).toMatchObject({
      kind: 'human', userId: invitedId, orgId: 'org_demo',
      authn: { source: 'supabase-jwt', assurance: 'aal2', sessionId: 'session-one' },
    });
  });

  it('fails closed in the gateway when the installation organization or the claim set is wrong', async () => {
    const env = await provision();
    const claims = { subject, email: invitedEmail, emailVerified: true, issuedAt: new Date(epoch * 1000).toISOString() };
    const { installationOrgId: _unconfigured, ...withoutOrg } = env;
    await expect(linkAuthenticatedIdentity(withoutOrg, claims))
      .rejects.toBeInstanceOf(IdentityStoreUnavailableError);
    await expect(linkAuthenticatedIdentity(env, { ...claims, emailVerified: false }))
      .rejects.toBeInstanceOf(ForbiddenError);
    // 다른 기관의 설치는 이 행을 보지 못한다.
    await expect(linkAuthenticatedIdentity({ ...env, installationOrgId: testActors.otherOrgAdmin.orgId }, claims))
      .rejects.toBeInstanceOf(ForbiddenError);
    expect(await linkedSubject()).toBeNull();
    await expect(linkAuthenticatedIdentity(env, claims)).resolves.toEqual({ linked: true });
    expect(await linkedSubject()).toBe(subject);
  });
});
