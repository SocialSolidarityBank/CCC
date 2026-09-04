import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index';
import {
  AccessJwtError,
  __setAccessJwksFetcherForTests,
  verifyAccessJwt,
  type Jwks,
} from '@ccc/http-api/access-jwt';
import { deactivateUser, upsertUser } from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';

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
    const response = await worker.fetch(jwtRequest('/pipeline/jobs', token), accessEnv());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ jobs: [] });
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
