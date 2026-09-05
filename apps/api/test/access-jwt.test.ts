import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index';
import {
  AccessJwtError,
  createAccessIdentity,
  __setAccessJwksFetcherForTests,
  verifyAccessJwt,
  type Jwks,
} from '@ccc/identity-access';
import { deactivateUser, ForbiddenError, upsertUser } from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';
import { agentManifestEnv, claimRequest, seedNerQualification } from './support/agent-jobs';
import { IdentityStoreUnavailableError } from '@ccc/contracts/runtime';
import { gatewayActorFromIdentity } from '@ccc/http-api/identity';

const TEAM = 'ggbss.cloudflareaccess.com';
const AUD = 'test-aud-tag';
const ISS = `https://${TEAM}`;
const KID = 'test-kid-1';
const KID2 = 'test-kid-2';

// ── in-test RSA 키·서명 헬퍼 (WebCrypto) ────────────────────────────────────

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jsonToBase64Url(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
}

async function jwkFor(publicKey: CryptoKey, kid: string): Promise<Jwks['keys'][number]> {
  const jwk = await crypto.subtle.exportKey('jwk', publicKey);
  return { ...jwk, kid, alg: 'RS256', use: 'sig' };
}

async function sign(privateKey: CryptoKey, kid: string, payload: Record<string, unknown>): Promise<string> {
  const signingInput = `${jsonToBase64Url({ alg: 'RS256', kid, typ: 'JWT' })}.${jsonToBase64Url(payload)}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, privateKey, new TextEncoder().encode(signingInput)),
  );
  return `${signingInput}.${bytesToBase64Url(signature)}`;
}

function futureExp(): number {
  return Math.floor(Date.now() / 1000) + 3600;
}

function humanPayload(email: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { iss: ISS, aud: AUD, exp: futureExp(), email, ...overrides };
}

let mainKeys: CryptoKeyPair;
let rogueKeys: CryptoKeyPair;
let rotatedKeys: CryptoKeyPair;
let jwks: Jwks;
let jwksAfterRotation: Jwks;

beforeAll(async () => {
  mainKeys = await generateKeyPair();
  rogueKeys = await generateKeyPair();
  rotatedKeys = await generateKeyPair();
  jwks = { keys: [await jwkFor(mainKeys.publicKey, KID)] };
  jwksAfterRotation = { keys: [await jwkFor(mainKeys.publicKey, KID), await jwkFor(rotatedKeys.publicKey, KID2)] };
});

afterEach(() => {
  __setAccessJwksFetcherForTests(null);
});

// ── 단위: verifyAccessJwt (fetchJwks 주입) ──────────────────────────────────

describe('verifyAccessJwt', () => {
  const opts = () => ({ teamDomain: TEAM, aud: AUD, fetchJwks: async () => jwks });

  it('accepts a valid human JWT and returns its claims', async () => {
    const token = await sign(mainKeys.privateKey, KID, humanPayload('user@example.invalid'));
    const claims = await verifyAccessJwt(token, opts());
    expect(claims.email).toBe('user@example.invalid');
  });
  it('accepts a token matching any configured audience', async () => {
    const token = await sign(mainKeys.privateKey, KID, humanPayload('user@example.invalid', { aud: 'web-aud' }));
    await expect(verifyAccessJwt(token, { ...opts(), aud: [AUD, 'web-aud'] })).resolves.toBeTruthy();
  });


  it('rejects a wrong audience', async () => {
    const token = await sign(mainKeys.privateKey, KID, humanPayload('user@example.invalid', { aud: 'other-aud' }));
    await expect(verifyAccessJwt(token, opts())).rejects.toBeInstanceOf(AccessJwtError);
  });

  it('rejects an expired token', async () => {
    const token = await sign(mainKeys.privateKey, KID, humanPayload('user@example.invalid', { exp: Math.floor(Date.now() / 1000) - 3600 }));
    await expect(verifyAccessJwt(token, opts())).rejects.toBeInstanceOf(AccessJwtError);
  });

  it('rejects a bad signature', async () => {
    // 서명은 rogue 키로, JWKS에는 정상 키만 → 서명 검증 실패.
    const token = await sign(rogueKeys.privateKey, KID, humanPayload('user@example.invalid'));
    await expect(verifyAccessJwt(token, opts())).rejects.toBeInstanceOf(AccessJwtError);
  });

  it('rejects a wrong issuer', async () => {
    const token = await sign(mainKeys.privateKey, KID, humanPayload('user@example.invalid', { iss: 'https://evil.example.invalid' }));
    await expect(verifyAccessJwt(token, opts())).rejects.toBeInstanceOf(AccessJwtError);
  });

  it('refetches JWKS on an unknown kid (key rotation)', async () => {
    let served: Jwks = jwks;
    let calls = 0;
    const fetchJwks = async (): Promise<Jwks> => {
      calls += 1;
      return served;
    };
    // 1) 기존 kid로 성공 → 캐시 채움.
    const token1 = await sign(mainKeys.privateKey, KID, humanPayload('user@example.invalid'));
    await expect(verifyAccessJwt(token1, { teamDomain: TEAM, aud: AUD, fetchJwks })).resolves.toBeTruthy();
    const callsAfterFirst = calls;
    // 2) 회전된 새 kid → 캐시에 없어 재조회, 갱신된 JWKS로 성공.
    served = jwksAfterRotation;
    const token2 = await sign(rotatedKeys.privateKey, KID2, humanPayload('user@example.invalid'));
    await expect(verifyAccessJwt(token2, { teamDomain: TEAM, aud: AUD, fetchJwks })).resolves.toBeTruthy();
    expect(calls).toBeGreaterThan(callsAfterFirst);
  });
});

// ── 라우트: identity.ts 전체 경로 (모듈 훅으로 JWKS 주입) ─────────────────────

const t = setupD1();

function accessEnv() {
  return { ...t.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
}

function jwtRequest(path: string, token: string): Request {
  return new Request(`http://localhost${path}`, { headers: { 'Cf-Access-Jwt-Assertion': token } });
}

describe('Access JWT identity (production path)', () => {
  it('resolves a provisioned human to their directory actor', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    await upsertUser(t.env, testActors.admin, { email: 'counselor.jwt@example.invalid', role: 'counselor' });

    const token = await sign(mainKeys.privateKey, KID, humanPayload('counselor.jwt@example.invalid'));
    const response = await worker.fetch(jwtRequest('/cases', token), accessEnv());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([]);
  });
  it('accepts a valid Access JWT forwarded through the web service binding header', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    await upsertUser(t.env, testActors.admin, { email: 'web-forwarded.jwt@example.invalid', role: 'counselor' });

    const token = await sign(mainKeys.privateKey, KID, humanPayload('web-forwarded.jwt@example.invalid'));
    const response = await worker.fetch(new Request('http://localhost/cases', {
      headers: { 'X-CCC-Access-Jwt': token },
    }), accessEnv());
    expect(response.status).toBe(200);
  });
  it('accepts a provisioned human from a secondary Access application audience', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    await upsertUser(t.env, testActors.admin, { email: 'web.jwt@example.invalid', role: 'counselor' });

    const token = await sign(mainKeys.privateKey, KID, humanPayload('web.jwt@example.invalid', { aud: 'web-aud' }));
    const response = await worker.fetch(jwtRequest('/cases', token), {
      ...accessEnv(),
      ACCESS_AUD: `${AUD}, web-aud`,
    });
    expect(response.status).toBe(200);
  });

  it('rejects a valid JWT whose email is not in the directory (403)', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    const token = await sign(mainKeys.privateKey, KID, humanPayload('ghost@example.invalid'));
    const response = await worker.fetch(jwtRequest('/cases', token), accessEnv());
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('rejects an inactive directory user (403)', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    const user = await upsertUser(t.env, testActors.admin, { email: 'inactive.jwt@example.invalid', role: 'counselor' });
    await deactivateUser(t.env, testActors.admin, user.id);

    const token = await sign(mainKeys.privateKey, KID, humanPayload('inactive.jwt@example.invalid'));
    const response = await worker.fetch(jwtRequest('/cases', token), accessEnv());
    expect(response.status).toBe(403);
  });

  it('maps a service token (common_name, no email) to a service actor', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    await upsertUser(t.env, testActors.admin, { email: 'mac-mini-token', role: 'service' });

    const token = await sign(mainKeys.privateKey, KID, { iss: ISS, aud: AUD, exp: futureExp(), common_name: 'mac-mini-token' });
    // v2 는 service 전용 claim 으로만 작업을 내보낸다 (S5).
    const qualification = await seedNerQualification(t.db);
    const env = await agentManifestEnv(accessEnv());
    const response = await worker.fetch(new Request('http://localhost/pipeline/jobs/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Cf-Access-Jwt-Assertion': token },
      body: JSON.stringify(claimRequest(qualification)),
    }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ schemaVersion: 2, jobs: [] });
  });

  it('rejects a wrong audience with 401', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    await upsertUser(t.env, testActors.admin, { email: 'counselor.jwt@example.invalid', role: 'counselor' });
    const token = await sign(mainKeys.privateKey, KID, humanPayload('counselor.jwt@example.invalid', { aud: 'nope' }));
    const response = await worker.fetch(jwtRequest('/cases', token), accessEnv());
    expect(response.status).toBe(401);
  });

  it('rejects an expired token with 401', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    await upsertUser(t.env, testActors.admin, { email: 'counselor.jwt@example.invalid', role: 'counselor' });
    const token = await sign(mainKeys.privateKey, KID, humanPayload('counselor.jwt@example.invalid', { exp: Math.floor(Date.now() / 1000) - 3600 }));
    const response = await worker.fetch(jwtRequest('/cases', token), accessEnv());
    expect(response.status).toBe(401);
  });

  it('rejects a bad signature with 401', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    await upsertUser(t.env, testActors.admin, { email: 'counselor.jwt@example.invalid', role: 'counselor' });
    const token = await sign(rogueKeys.privateKey, KID, humanPayload('counselor.jwt@example.invalid'));
    const response = await worker.fetch(jwtRequest('/cases', token), accessEnv());
    expect(response.status).toBe(401);
  });

  it('rejects a missing assertion header with 401', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    const response = await worker.fetch(new Request('http://localhost/cases'), accessEnv());
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'actor_authentication_required' });
  });

  it('fails closed with 401 when Access env vars are unset', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    const token = await sign(mainKeys.privateKey, KID, humanPayload('counselor.jwt@example.invalid'));
    // ACCESS_TEAM_DOMAIN/ACCESS_AUD 미설정(t.env 그대로) → 401.
    const response = await worker.fetch(jwtRequest('/cases', token), t.env);
    expect(response.status).toBe(401);
  });

  it('fails closed with 503 when the identity store cannot be read', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    const token = await sign(mainKeys.privateKey, KID, humanPayload('unreadable.identity@example.invalid'));
    const unavailableDb = {
      prepare() { throw new Error('store unavailable'); },
      batch() { throw new Error('store unavailable'); },
    };
    const response = await worker.fetch(jwtRequest('/cases', token), { ...accessEnv(), DB: unavailableDb });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'service_unavailable' });
  });
  it('fails closed with 503 when Access JWKS cannot be read', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => {
      throw new Error('JWKS unavailable');
    });
    const token = await sign(mainKeys.privateKey, KID, humanPayload('jwks.unavailable@example.invalid'));
    const response = await worker.fetch(jwtRequest('/cases', token), accessEnv());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'service_unavailable' });
  });


  it('does not enable local header authentication from a runtime binding', async () => {
    await t.reset();
    const env = { ...t.env, LOCAL_ACTOR_HEADER_MODE: 'true' };
    const response = await worker.fetch(new Request('http://localhost/cases', {
      headers: { 'X-CCC-User-Id': 'local@example.invalid', 'X-CCC-Org-Id': 'org_demo', 'X-CCC-Role': 'counselor' },
    }), env);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'actor_authentication_required' });
  });
});

describe('Access Identity canonical Actor (E4-1)', () => {
  it('maps human roles losslessly without copying the Access principal', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    await upsertUser(t.env, testActors.admin, { email: 'worker.identity@example.invalid', role: 'counselor' });
    await upsertUser(t.env, testActors.admin, { email: 'admin.identity@example.invalid', role: 'admin' });
    const identity = createAccessIdentity(accessEnv());

    const worker = await identity.resolve(jwtRequest(
      '/cases',
      await sign(mainKeys.privateKey, KID, humanPayload('worker.identity@example.invalid')),
    ));
    expect(worker).toEqual({
      kind: 'human',
      userId: expect.any(String),
      orgId: 'org_demo',
      roles: ['worker'],
      scopes: [],
      authn: { source: 'cloudflare-access', assurance: 'none', sessionId: null },
    });
    expect(JSON.stringify(worker)).not.toContain('worker.identity@example.invalid');

    await t.db.prepare(
      'INSERT INTO teams (id, org_id, name, created_by) VALUES (?, ?, ?, ?)',
    ).bind('identity-team', testActors.admin.orgId, 'Identity', testActors.admin.userId).run();
    await t.db.prepare(
      `INSERT INTO team_supervisor_grants (id, org_id, team_id, supervisor_user_id, granted_by)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind('identity-supervisor', testActors.admin.orgId, 'identity-team', worker.userId, testActors.admin.userId).run();
    const supervisor = await identity.resolve(jwtRequest(
      '/cases',
      await sign(mainKeys.privateKey, KID, humanPayload('worker.identity@example.invalid')),
    ));
    expect(supervisor.roles).toEqual(['supervisor', 'worker']);

    const admin = await identity.resolve(jwtRequest(
      '/cases',
      await sign(mainKeys.privateKey, KID, humanPayload('admin.identity@example.invalid')),
    ));
    expect(admin.roles).toEqual(['institution-admin', 'technical-admin']);
    expect(admin.kind).toBe('human');
  });

  it('maps the transitional Access service principal to the six Agent scopes', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    await upsertUser(t.env, testActors.admin, { email: 'agent-access-principal', role: 'service' });
    const identity = createAccessIdentity(accessEnv());
    const actor = await identity.resolve(jwtRequest(
      '/pipeline/jobs',
      await sign(mainKeys.privateKey, KID, { iss: ISS, aud: AUD, exp: futureExp(), common_name: 'agent-access-principal' }),
    ));
    expect(actor).toEqual({
      kind: 'agent',
      userId: expect.any(String),
      orgId: 'org_demo',
      roles: ['service'],
      scopes: ['jobs:claim', 'jobs:heartbeat', 'jobs:result', 'jobs:release', 'audio:read', 'source:read'],
      authn: { source: 'cloudflare-access', assurance: 'none', sessionId: null },
    });
    expect(JSON.stringify(actor)).not.toContain('agent-access-principal');
  });

  it('writes append-only revocations through Identity and rejects a revoked actor', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    const user = await upsertUser(t.env, testActors.admin, { email: 'revoked.identity@example.invalid', role: 'counselor' });
    const identity = createAccessIdentity(accessEnv());
    const request = jwtRequest(
      '/cases',
      await sign(mainKeys.privateKey, KID, humanPayload('revoked.identity@example.invalid')),
    );
    await expect(identity.resolve(request)).resolves.toMatchObject({ userId: user.id });
    await identity.revokeSession('session-revoked-1', 'security-event');
    await identity.revokeAll(user.id, 'admin-disable');
    const issuedBeforeRevocation = jwtRequest(
      '/cases',
      await sign(mainKeys.privateKey, KID, humanPayload('revoked.identity@example.invalid', {
        iat: Math.floor(Date.now() / 1000) - 60,
      })),
    );
    await expect(identity.resolve(issuedBeforeRevocation)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(identity.resolve(request)).rejects.toBeInstanceOf(ForbiddenError);
    const refreshed = jwtRequest(
      '/cases',
      await sign(mainKeys.privateKey, KID, humanPayload('revoked.identity@example.invalid', {
        iat: Math.floor(Date.now() / 1000) + 1,
      })),
    );
    await expect(identity.resolve(refreshed)).resolves.toMatchObject({ userId: user.id });
    const implausiblyFuture = jwtRequest(
      '/cases',
      await sign(mainKeys.privateKey, KID, humanPayload('revoked.identity@example.invalid', {
        iat: Math.floor(Date.now() / 1000) + 3600,
      })),
    );
    await expect(identity.resolve(implausiblyFuture)).rejects.toBeInstanceOf(ForbiddenError);
    const rows = await t.db.prepare(
      'SELECT kind, subject, reason FROM auth_revocations ORDER BY kind, subject',
    ).all<{ kind: string; subject: string; reason: string }>();
    expect(rows.results).toEqual([
      { kind: 'actor', subject: user.id, reason: 'admin-disable' },
      { kind: 'session', subject: 'session-revoked-1', reason: 'security-event' },
    ]);
    await t.db.prepare(
      `INSERT INTO auth_revocations (id, kind, subject, revoked_at, reason)
       VALUES ('malformed-revocation-time', 'actor', ?, 'not-a-time', 'security-event')`,
    ).bind(user.id).run();
    await expect(identity.resolve(refreshed)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('separates an unreadable identity store from invalid credentials', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => jwks);
    const token = await sign(mainKeys.privateKey, KID, humanPayload('worker.identity@example.invalid'));
    const broken = {
      ...accessEnv(),
      DB: { prepare() { throw new Error('store unavailable'); }, batch() { throw new Error('store unavailable'); } },
    };
    await expect(createAccessIdentity(broken).resolve(jwtRequest('/cases', token)))
      .rejects.toBeInstanceOf(IdentityStoreUnavailableError);
  });
});

describe('canonical-to-gateway migration boundary', () => {
  const actor = {
    kind: 'human' as const,
    userId: 'technical-admin-only',
    orgId: 'org_demo',
    scopes: [],
    authn: { source: 'cloudflare-access' as const, assurance: 'none' as const, sessionId: null },
  };

  it('does not grant business access to a technical-admin-only identity', () => {
    expect(() => gatewayActorFromIdentity({ ...actor, roles: ['technical-admin'] })).toThrow(ForbiddenError);
  });

  it('preserves the current gateway role for institution admin, worker, supervisor and service', () => {
    expect(gatewayActorFromIdentity({ ...actor, roles: ['institution-admin'] }).role).toBe('admin');
    expect(gatewayActorFromIdentity({ ...actor, roles: ['worker'] }).role).toBe('counselor');
    expect(gatewayActorFromIdentity({ ...actor, roles: ['supervisor'] }).role).toBe('counselor');
    expect(gatewayActorFromIdentity({ ...actor, kind: 'agent', roles: ['service'] }).role).toBe('service');
  });
});
