/**
 * ccc-api 운영 경로의 Supabase Auth 사람 신원 레인(앱 직접 로그인) 계약 시험.
 *
 * 증명하는 것:
 *   - 검증된 Supabase Bearer JWT 가 users 디렉터리의 auth_subject 와 연결된 사람 Actor 가 된다.
 *   - 디렉터리에 없는 subject·비활성·해지된 신원은 전부 거부된다(Supabase 계정 존재만으로는 안 됨).
 *   - verifyIdentityLinkClaims 배선으로 초대 수락이 404 가 아니고, 이메일 불일치는 거부된다.
 *   - SUPABASE_AUTH_ORIGIN 이 없으면 이 레인 자체가 없다(Bearer JWT 도 401, 수락도 404).
 *   - Access 레인(Cf-Access-Jwt-Assertion)은 Supabase 레인이 켜져 있어도 그대로 동작한다.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import worker from '../src/index';
import { __setSupabaseJwksFetchForTests } from '../src/supabase-identity';
import { __setAccessJwksFetcherForTests, type Jwks } from '@ccc/identity-access';
import { revokeActorSessions, revokeIdentitySession } from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';

const t = setupD1();

// ── Supabase JWT 픽스처 (identity-supabase.test.ts 와 같은 형태) ──────────────

const SUPABASE_ORIGIN = 'https://abcdefghijklmnopqrst.supabase.co';
const ISSUER = `${SUPABASE_ORIGIN}/auth/v1`;
const JWKS_URI = `${ISSUER}/.well-known/jwks.json`;
const ADMIN_SUB = '61f8457d-470d-4853-a681-1135027a523d';
const WORKER_SUB = '7b2c9e10-aaaa-4bbb-8ccc-ddddeeeeffff';

let ecPair: CryptoKeyPair;
let ecJwk: JsonWebKey & { kid: string };
let roguePair: CryptoKeyPair;

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function supabaseToken(claims: Record<string, unknown> = {}, pair: CryptoKeyPair = ecPair, kid = 'ec-one'): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const input = `${encoded({ alg: 'ES256', kid, typ: 'JWT' })}.${encoded({
    iss: ISSUER, aud: 'authenticated', sub: WORKER_SUB, session_id: 'session-one', role: 'authenticated',
    is_anonymous: false, aal: 'aal1', email: 'worker.invited@example.invalid',
    iat: now, exp: now + 3600, ...claims,
  })}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}

function bearer(path: string, token: string, init: RequestInit = {}): Request {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
}

// ── Access JWT 픽스처 (공존 증명용 최소 형태) ─────────────────────────────────

let accessPair: CryptoKeyPair;
let accessJwks: Jwks;

async function accessToken(email: string): Promise<string> {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'access-kid', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: 'https://ggbss.cloudflareaccess.com', aud: 'test-aud', email,
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' }, accessPair.privateKey, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${Buffer.from(signature).toString('base64url')}`;
}

// ── env ─────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  [ecPair, roguePair, accessPair] = await Promise.all([
    crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']),
    crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']),
    crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['sign', 'verify']),
  ]);
  ecJwk = { ...await crypto.subtle.exportKey('jwk', ecPair.publicKey), kid: 'ec-one', alg: 'ES256', use: 'sig' };
  accessJwks = { keys: [{ ...await crypto.subtle.exportKey('jwk', accessPair.publicKey), kid: 'access-kid', alg: 'RS256', use: 'sig' }] };
});

function supabaseEnv() {
  __setSupabaseJwksFetchForTests(async (input) => {
    if (String(input) !== JWKS_URI) return new Response('not found', { status: 404 });
    return new Response(JSON.stringify({ keys: [ecJwk] }), { status: 200 });
  });
  return { ...t.env, SUPABASE_AUTH_ORIGIN: SUPABASE_ORIGIN };
}

afterEach(() => {
  __setSupabaseJwksFetchForTests(undefined);
  __setAccessJwksFetcherForTests(null);
});

/** users 디렉터리에 auth_subject 를 연결한다(초대 수락·수기 등재가 하는 일의 시드). */
async function linkSubject(userId: string, subject: string): Promise<void> {
  await t.db.prepare('UPDATE users SET auth_subject = ? WHERE id = ?').bind(subject, userId).run();
}

describe('Supabase Bearer 사람 신원 레인', () => {
  it('검증된 토큰이 디렉터리에 연결된 사람 Actor 를 만든다', async () => {
    await t.reset();
    await linkSubject(testActors.counselor.userId, WORKER_SUB);
    const response = await worker.fetch(bearer('/me', await supabaseToken()), supabaseEnv());
    expect(response.status).toBe(200);
    const me = await response.json() as { id: string; orgId: string };
    expect(me.id).toBe(testActors.counselor.userId);
    expect(me.orgId).toBe('org_demo');
  });

  it('디렉터리에 없는 subject 는 유효한 토큰이어도 거부된다', async () => {
    await t.reset();
    const response = await worker.fetch(bearer('/me', await supabaseToken()), supabaseEnv());
    expect(response.status).toBe(403);
  });

  it('비활성 사용자의 subject 는 거부된다', async () => {
    await t.reset();
    await linkSubject(testActors.counselor.userId, WORKER_SUB);
    await t.db.prepare('UPDATE users SET active = 0 WHERE auth_subject = ?').bind(WORKER_SUB).run();
    const response = await worker.fetch(bearer('/me', await supabaseToken()), supabaseEnv());
    expect(response.status).toBe(403);
  });

  it('위조 서명·다른 issuer 의 토큰은 401 이다', async () => {
    await t.reset();
    await linkSubject(testActors.counselor.userId, WORKER_SUB);
    const env = supabaseEnv();
    const forged = await worker.fetch(bearer('/me', await supabaseToken({}, roguePair, 'ec-one')), env);
    expect(forged.status).toBe(401);
    const wrongIssuer = await worker.fetch(
      bearer('/me', await supabaseToken({ iss: 'https://evil.supabase.co/auth/v1' })), env);
    expect(wrongIssuer.status).toBe(401);
  });

  it('해지된 세션과 해지된 계정은 새 경로로 통과하지 않는다', async () => {
    await t.reset();
    await linkSubject(testActors.counselor.userId, WORKER_SUB);
    const env = supabaseEnv();
    // 세션 해지: 같은 session_id 를 쓰는 토큰은 즉시 죽는다.
    await revokeIdentitySession(t.env, 'session-one', 'logout');
    expect((await worker.fetch(bearer('/me', await supabaseToken()), env)).status).toBe(403);
    // 계정 해지: 해지 시각 이전에 발급된 토큰은 다른 세션이어도 죽는다.
    // 토큰을 해지 **전에** 발급해 iat < revoked_at 을 보장한다 — iat 는 초 단위라
    // 해지 뒤 발급은 초 경계를 넘으면 iat > revoked_at 이 되어 설계상 정상 통과
    // (재로그인)가 되고, 이 테스트가 시간에 따라 갈렸다.
    const staleToken = await supabaseToken({ session_id: 'session-two' });
    await revokeActorSessions(t.env, testActors.counselor.userId, 'admin-disable');
    expect((await worker.fetch(bearer('/me', staleToken), env)).status).toBe(403);
  });

  it('계정 해지 뒤 새로 발급된 토큰은 다시 통과한다 — 재로그인이 회수를 이긴다', async () => {
    await t.reset();
    await linkSubject(testActors.counselor.userId, WORKER_SUB);
    const env = supabaseEnv();
    await revokeActorSessions(t.env, testActors.counselor.userId, 'admin-disable');
    // 해지 **뒤** 발급을 결정적으로 표현한다. iat 는 초 단위라 같은 초에 발급하면
    // revoked_at(밀리초)보다 앞서 보이므로, 검증기의 60초 여유 안에서 iat 를
    // 명시적으로 미래로 둔다.
    const fresh = await supabaseToken({
      session_id: 'session-two',
      iat: Math.floor(Date.now() / 1000) + 2,
    });
    expect((await worker.fetch(bearer('/me', fresh), env)).status).toBe(200);
  });

  it('로그아웃이 Supabase 세션을 해지하고 이후 요청은 403 이다', async () => {
    await t.reset();
    await linkSubject(testActors.counselor.userId, WORKER_SUB);
    const env = supabaseEnv();
    const jwt = await supabaseToken();
    const logout = await worker.fetch(bearer('/auth/logout', jwt, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }), env);
    expect(logout.status).toBe(204);
    expect((await worker.fetch(bearer('/me', jwt), env)).status).toBe(403);
  });

  it('SUPABASE_AUTH_ORIGIN 이 없으면 이 레인 자체가 없다 — Bearer JWT 도 401 로 닫힌다', async () => {
    await t.reset();
    await linkSubject(testActors.counselor.userId, WORKER_SUB);
    const response = await worker.fetch(bearer('/me', await supabaseToken()), t.env);
    expect(response.status).toBe(401);
  });

  it('Access 레인은 Supabase 레인이 켜져 있어도 그대로 동작한다', async () => {
    await t.reset();
    __setAccessJwksFetcherForTests(async () => accessJwks);
    const env = { ...supabaseEnv(), ACCESS_TEAM_DOMAIN: 'ggbss.cloudflareaccess.com', ACCESS_AUD: 'test-aud' };
    const token = await accessToken(testActors.counselor.userId);
    const response = await worker.fetch(new Request('http://localhost/me', {
      headers: { 'Cf-Access-Jwt-Assertion': token },
    }), env);
    expect(response.status).toBe(200);
  });
});

describe('초대 수락 신원 연결 (verifyIdentityLinkClaims 배선)', () => {
  const INVITE_EMAIL = 'worker.invited@example.invalid';

  async function issueInvite(): Promise<string> {
    await linkSubject(testActors.admin.userId, ADMIN_SUB);
    const response = await worker.fetch(
      bearer('/staff-invites', await supabaseToken({ sub: ADMIN_SUB, email: testActors.admin.userId }), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: INVITE_EMAIL, roles: ['practitioner'] }),
      }),
      supabaseEnv(),
    );
    expect(response.status).toBe(201);
    const body = await response.json() as { token: string };
    return body.token;
  }

  function acceptRequest(token: string, email: string, jwt: string): Request {
    return bearer(`/staff-invites/token/${token}/accept`, jwt, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '초대 실무자', email }),
    });
  }

  it('공개 초대 정보 조회와 수락이 404 가 아니라 동작하고, 수락한 신원으로 로그인된다', async () => {
    await t.reset();
    const token = await issueInvite();
    const env = supabaseEnv();
    const info = await worker.fetch(new Request(`http://localhost/staff-invites/token/${token}`), env);
    expect(info.status).toBe(200);
    const accept = await worker.fetch(
      acceptRequest(token, INVITE_EMAIL, await supabaseToken({ email: INVITE_EMAIL })), env);
    expect(accept.status).toBe(201);
    // 수락이 만든 users 행의 auth_subject 로 바로 사람 신원이 된다.
    const me = await worker.fetch(bearer('/me', await supabaseToken({ email: INVITE_EMAIL })), env);
    expect(me.status).toBe(200);
  });

  it('토큰 claim 이메일과 요청 이메일이 다르면 거부하고 초대를 소비하지 않는다', async () => {
    await t.reset();
    const token = await issueInvite();
    const env = supabaseEnv();
    const accept = await worker.fetch(
      acceptRequest(token, INVITE_EMAIL, await supabaseToken({ email: 'other@example.invalid' })), env);
    expect(accept.status).toBe(404);
    const row = await t.db.prepare('SELECT status FROM staff_invites WHERE email_normalized = ?')
      .bind(INVITE_EMAIL).first<{ status: string }>();
    expect(row?.status).toBe('issued');
  });

  it('요청 이메일이 초대 이메일과 다르면 claim 이 맞아도 거부한다', async () => {
    await t.reset();
    const token = await issueInvite();
    const env = supabaseEnv();
    const accept = await worker.fetch(
      acceptRequest(token, 'intruder@example.invalid', await supabaseToken({ email: 'intruder@example.invalid' })), env);
    expect(accept.status).toBe(404);
    expect(await t.db.prepare('SELECT COUNT(*) AS n FROM users WHERE email = ?')
      .bind('intruder@example.invalid').first<{ n: number }>()).toEqual({ n: 0 });
  });

  it('자격 없는 수락과 origin 없는 수락은 404 다', async () => {
    await t.reset();
    const token = await issueInvite();
    const env = supabaseEnv();
    const noAuth = await worker.fetch(new Request(`http://localhost/staff-invites/token/${token}/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x', email: INVITE_EMAIL }),
    }), env);
    expect(noAuth.status).toBe(404);
    // SUPABASE_AUTH_ORIGIN 없는 env: 포트 부재 = 표면 없음.
    const noManifest = await worker.fetch(
      acceptRequest(token, INVITE_EMAIL, await supabaseToken({ email: INVITE_EMAIL })), t.env);
    expect(noManifest.status).toBe(404);
  });
});
