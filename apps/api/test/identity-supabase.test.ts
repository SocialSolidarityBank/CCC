import { beforeAll, describe, expect, it } from 'vitest';
import { createSupabaseIdentity } from '../../../adapters/identity-supabase/src/index';
import { ActorAuthenticationError, IdentityStoreUnavailableError, MfaRequiredError } from '@ccc/contracts/runtime';
import { ForbiddenError, type Env } from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';

const t = setupD1();
const issuer = 'https://abcdefghijklmnopqrst.supabase.co/auth/v1';
const jwksUri = `${issuer}/.well-known/jwks.json`;
const epoch = 1_800_000_000;
const subject = '61f8457d-470d-4853-a681-1135027a523d';
type SigningKey = { pair: CryptoKeyPair; jwk: JsonWebKey & { kid: string; alg: string }; alg: 'ES256' | 'RS256' };
let ec: SigningKey;
let rsa: SigningKey;
let rotated: SigningKey;

async function key(alg: SigningKey['alg'], kid: string): Promise<SigningKey> {
  const pair = alg === 'ES256'
    ? await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
    : await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  return { pair, alg, jwk: { ...await crypto.subtle.exportKey('jwk', pair.publicKey), kid, alg, use: 'sig' } };
}
function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
async function token(signing = ec, claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}): Promise<string> {
  const input = `${encoded({ alg: signing.alg, kid: signing.jwk.kid, typ: 'JWT', ...header })}.${encoded({
    iss: issuer, aud: 'authenticated', sub: subject, session_id: 'session-one', role: 'authenticated',
    is_anonymous: false, aal: 'aal2', iat: epoch, exp: epoch + 3600, ...claims,
  })}`;
  const signature = await crypto.subtle.sign(signing.alg === 'ES256'
    ? { name: 'ECDSA', hash: 'SHA-256' } : { name: 'RSASSA-PKCS1-v1_5' }, signing.pair.privateKey, new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}
function request(value: string): Request {
  return new Request('https://api.example.invalid/me', { headers: { Authorization: `Bearer ${value}` } });
}
async function provision(): Promise<void> {
  await t.reset();
  await t.db.prepare('UPDATE users SET auth_subject = ? WHERE id = ?').bind(subject, testActors.counselor.userId).run();
}
function fixture(env: Env = t.env) {
  let milliseconds = epoch * 1000;
  let keys: unknown[] = [ec.jwk, rsa.jwk];
  let status = 200;
  const requests: Array<{ url: string; redirect: RequestRedirect | undefined }> = [];
  const identity = createSupabaseIdentity(env, {
    issuer, jwksUri, now: () => milliseconds,
    fetch: async (input, init) => {
      requests.push({ url: String(input), redirect: init?.redirect });
      return new Response(JSON.stringify({ keys }), { status });
    },
  });
  return { identity, requests, advance: (seconds: number) => { milliseconds += seconds * 1000; },
    publish: (value: unknown[]) => { keys = value; }, fail: () => { status = 503; } };
}

beforeAll(async () => {
  [ec, rsa, rotated] = await Promise.all([key('ES256', 'ec-one'), key('RS256', 'rsa-one'), key('ES256', 'ec-two')]);
});

describe('Supabase identity trust boundary', () => {
  it('verifies both asymmetric algorithms and takes identity/roles from the linked directory, never token email', async () => {
    await provision();
    const f = fixture();
    for (const signing of [ec, rsa]) {
      const actor = await f.identity.resolve(request(await token(signing, { email: testActors.admin.userId, app_metadata: { roles: ['institution-admin'] } })));
      expect(actor).toEqual({ kind: 'human', userId: testActors.counselor.userId, orgId: 'org_demo', roles: ['worker'], scopes: [],
        authn: { source: 'supabase-jwt', assurance: 'aal2', sessionId: 'session-one' } });
    }
    expect(f.requests).toEqual([{ url: jwksUri, redirect: 'error' }]);
  });

  it('requires a linked active human even when token email matches a provisioned administrator', async () => {
    await provision();
    const f = fixture();
    await expect(f.identity.resolve(request(await token(ec, { sub: 'unlinked', email: testActors.admin.userId })))).rejects.toBeInstanceOf(ForbiddenError);
    await t.db.prepare('UPDATE users SET active = 0 WHERE auth_subject = ?').bind(subject).run();
    await expect(f.identity.resolve(request(await token()))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('verifies the signature before reporting MFA or touching an unavailable directory', async () => {
    await provision();
    const broken: Env = { ...t.env, DB: { prepare() { throw new Error('private directory failure'); }, batch() { throw new Error('private directory failure'); } } };
    const f = fixture(broken);
    const aal1 = await token(ec, { aal: 'aal1' });
    await expect(f.identity.resolve(request(aal1))).rejects.toBeInstanceOf(MfaRequiredError);
    const forged = await token(rotated, { aal: 'aal1' }, { kid: ec.jwk.kid });
    await expect(f.identity.resolve(request(forged))).rejects.toBeInstanceOf(ActorAuthenticationError);
    await expect(f.identity.resolve(request(await token()))).rejects.toBeInstanceOf(IdentityStoreUnavailableError);
  });

  it.each([
    { iss: 'https://other.supabase.co/auth/v1' }, { aud: 'service_role' }, { role: 'service_role' },
    { is_anonymous: true }, { session_id: '' }, { sub: '' }, { exp: epoch - 60 },
    { iat: epoch + 61 }, { nbf: epoch + 61 }, { nbf: 'tomorrow' },
    { exp: epoch + 3601 }, { iat: null }, { exp: epoch }, { aal: null },
  ])('rejects invalid claims without admitting a business actor: %j', async (claims) => {
    await provision();
    await expect(fixture().identity.resolve(request(await token(ec, claims)))).rejects.toBeInstanceOf(ActorAuthenticationError);
  });

  it('allows optional nbf and exactly 60 seconds of future skew, but not an extended credential lifetime', async () => {
    await provision();
    const f = fixture();
    expect((await f.identity.resolve(request(await token(ec, { iat: epoch + 60, nbf: epoch + 60, exp: epoch + 3660 })))).userId).toBe(testActors.counselor.userId);
  });

  it('rejects absent/malformed Bearer, algorithm downgrade and critical JOSE extensions', async () => {
    await provision();
    const f = fixture();
    await expect(f.identity.resolve(new Request('https://api.example.invalid/me'))).rejects.toBeInstanceOf(ActorAuthenticationError);
    for (const value of ['Basic abc', 'Bearer a.b.c extra']) {
      await expect(f.identity.resolve(new Request('https://api.example.invalid/me', { headers: { Authorization: value } }))).rejects.toBeInstanceOf(ActorAuthenticationError);
    }
    for (const header of [{ alg: 'HS256' }, { crit: ['b64'], b64: false }]) {
      await expect(f.identity.resolve(request(await token(ec, {}, header)))).rejects.toBeInstanceOf(ActorAuthenticationError);
    }
    expect(f.requests).toEqual([]);
  });

  it('does not fetch token-provided jku and rejects mismatched JWK metadata', async () => {
    await provision();
    const f = fixture();
    f.publish([{ ...ec.jwk, alg: 'RS256' }]);
    await expect(f.identity.resolve(request(await token(ec, {}, { jku: 'https://attacker.invalid/jwks' })))).rejects.toBeInstanceOf(ActorAuthenticationError);
    expect(f.requests).toEqual([{ url: jwksUri, redirect: 'error' }]);
  });

  it.each([
    { issuer: issuer.replace('https:', 'http:'), jwksUri },
    { issuer, jwksUri: 'https://other.supabase.co/auth/v1/.well-known/jwks.json' },
    { issuer, jwksUri: `${jwksUri}?secret=value` },
    { issuer: issuer.replace('https://', 'https://user@'), jwksUri },
    { issuer, jwksUri: `${jwksUri}#fragment` },
  ])('rejects unsafe installation endpoints before making requests: %j', async (config) => {
    await t.reset();
    expect(() => createSupabaseIdentity(t.env, config)).toThrow(IdentityStoreUnavailableError);
  });
});

describe('Supabase key cache and revocation', () => {
  it('single-flights cold requests and unknown-key floods across distinct kids, then admits a rotated key', async () => {
    await provision();
    const f = fixture();
    const initial = request(await token());
    await Promise.all(Array.from({ length: 12 }, () => f.identity.resolve(initial)));
    expect(f.requests).toHaveLength(1);
    const flood = await Promise.all(Array.from({ length: 270 }, (_, i) => token(rotated, {}, { kid: `missing-${i}` })));
    const rejected = await Promise.allSettled(flood.map(value => f.identity.resolve(request(value))));
    expect(rejected.every(result => result.status === 'rejected' && result.reason instanceof ActorAuthenticationError)).toBe(true);
    expect(f.requests).toHaveLength(1);
    f.advance(60);
    f.publish([rotated.jwk]);
    const next = request(await token(rotated));
    expect((await f.identity.resolve(next)).userId).toBe(testActors.counselor.userId);
    expect((await f.identity.resolve(initial)).userId).toBe(testActors.counselor.userId);
    expect(f.requests).toHaveLength(2);
  });

  it('never extends an absent old key past its original one-hour cache lifetime', async () => {
    await provision();
    const f = fixture();
    await f.identity.resolve(request(await token()));
    f.advance(60);
    f.publish([rotated.jwk]);
    await f.identity.resolve(request(await token(rotated)));
    f.advance(3540);
    await expect(f.identity.resolve(request(await token(ec, { iat: epoch + 3600, exp: epoch + 7200 })))).rejects.toBeInstanceOf(ActorAuthenticationError);
  });

  it('fails closed as unavailable when expired keys cannot refresh, including requests during the failure cooldown', async () => {
    await provision();
    const f = fixture();
    await f.identity.resolve(request(await token()));
    f.advance(3600);
    f.fail();
    const fresh = request(await token(ec, { iat: epoch + 3600, exp: epoch + 7200 }));
    await expect(f.identity.resolve(fresh)).rejects.toBeInstanceOf(IdentityStoreUnavailableError);
    await expect(f.identity.resolve(fresh)).rejects.toBeInstanceOf(IdentityStoreUnavailableError);
    expect(f.requests).toHaveLength(2);
  });

  it('treats redirected, malformed and failing JWKS responses as unavailable, not invalid credentials', async () => {
    await provision();
    for (const response of [new Response(null, { status: 302, headers: { Location: 'https://attacker.invalid' } }), new Response('{'), new Response('private upstream failure', { status: 500 })]) {
      const identity = createSupabaseIdentity(t.env, { issuer, jwksUri, now: () => epoch * 1000, fetch: async () => response });
      await expect(identity.resolve(request(await token()))).rejects.toBeInstanceOf(IdentityStoreUnavailableError);
    }
  });

  it('consults session revocation even with cached signing keys and leaves unrelated sessions usable', async () => {
    await provision();
    const f = fixture();
    const first = request(await token());
    await f.identity.resolve(first);
    await f.identity.revokeSession('session-one', 'logout');
    await expect(f.identity.resolve(first)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await f.identity.resolve(request(await token(ec, { session_id: 'session-two' })))).userId).toBe(testActors.counselor.userId);
  });

  it('fails closed when the revocation store disappears after an authenticated request', async () => {
    await provision();
    const f = fixture();
    const credential = request(await token());
    await f.identity.resolve(credential);
    await t.db.prepare('DROP TABLE auth_revocations').run();
    await expect(f.identity.resolve(credential)).rejects.toBeInstanceOf(IdentityStoreUnavailableError);
    await expect(f.identity.revokeSession('session-one', 'logout')).rejects.toBeInstanceOf(IdentityStoreUnavailableError);
    await expect(f.identity.revokeAll(testActors.counselor.userId, 'admin-disable')).rejects.toBeInstanceOf(IdentityStoreUnavailableError);
  });

  it('revokes all credentials issued before the actor cutoff and permits a newly issued session', async () => {
    await provision();
    const milliseconds = Date.now();
    const issued = Math.floor(milliseconds / 1000) - 10;
    const identity = createSupabaseIdentity(t.env, { issuer, jwksUri, now: () => milliseconds,
      fetch: async () => new Response(JSON.stringify({ keys: [ec.jwk] })) });
    const old = request(await token(ec, { iat: issued, exp: issued + 3600 }));
    await identity.resolve(old);
    await identity.revokeAll(testActors.counselor.userId, 'password-reset');
    await expect(identity.resolve(old)).rejects.toBeInstanceOf(ForbiddenError);
    const row = await t.db.prepare("SELECT MAX(revoked_at) AS cutoff FROM auth_revocations WHERE kind = 'actor' AND subject = ?").bind(testActors.counselor.userId).first<{ cutoff: string }>();
    const freshIssued = Math.floor(Date.parse(row!.cutoff) / 1000) + 1;
    expect((await identity.resolve(request(await token(ec, { iat: freshIssued, exp: freshIssued + 3600, session_id: 'after-reset' })))).userId).toBe(testActors.counselor.userId);
  });
});
