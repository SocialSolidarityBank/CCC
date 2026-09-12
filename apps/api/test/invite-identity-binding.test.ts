import { beforeAll, describe, expect, it } from 'vitest';
import { handleRequest } from '@ccc/http-api';
import { createStaffInvite } from '@ccc/core/gateway';
import { createSupabaseIdentity } from '../../../adapters/identity-supabase/src/index';
import { setupD1, testActors, type TestApiEnv } from './support/d1';

/**
 * D90 초대 결속. 수락자가 만든 Auth 계정의 검증된 subject 를 등재와 같은 배치에서 채운다.
 * 연결 근거는 일회용 초대 토큰과 서명으로 검증된 subject 이고, 이메일 claim 은 대조에만 쓴다.
 * 결속되지 않은 users 행을 남기지 않으므로 나중에 다른 계정이 가로챌 자리가 없다.
 */
const t = setupD1();
const issuer = 'https://abcdefghijklmnopqrst.supabase.co/auth/v1';
const jwksUri = `${issuer}/.well-known/jwks.json`;
const epoch = 1_800_000_000;
const subject = '2ffb2dd4-6d0b-4b3f-9a9e-8c95cd7d3d21';
const invitedEmail = 'invited@example.invalid';
type SigningKey = { pair: CryptoKeyPair; jwk: JsonWebKey & { kid: string; alg: string } };
let ec: SigningKey;

function encoded(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

async function token(claims: Record<string, unknown> = {}): Promise<string> {
  const input = `${encoded({ alg: 'ES256', kid: ec.jwk.kid, typ: 'JWT' })}.${encoded({
    iss: issuer, aud: 'authenticated', sub: subject, session_id: 'session-one', role: 'authenticated',
    is_anonymous: false, aal: 'aal1', email: invitedEmail,
    iat: epoch, exp: epoch + 3600, ...claims,
  })}`;
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, ec.pair.privateKey, new TextEncoder().encode(input),
  );
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}

function withVerifier(env: TestApiEnv): TestApiEnv {
  const identity = createSupabaseIdentity(env, {
    issuer, jwksUri, now: () => epoch * 1000,
    fetch: async () => new Response(JSON.stringify({ keys: [ec.jwk] })),
  });
  return { ...env, verifyIdentityLinkClaims: (request) => identity.verifyLinkClaims(request) };
}

async function invited(): Promise<{ env: TestApiEnv; token: string }> {
  await t.reset();
  const env = withVerifier({ ...t.env, installationOrgId: 'org_demo' });
  const { token: inviteToken } = await createStaffInvite(env, testActors.admin, {
    email: invitedEmail, roles: ['practitioner'],
  });
  return { env, token: inviteToken };
}

function acceptRequest(inviteToken: string, credential: string | null, email = invitedEmail): Request {
  return new Request(`https://api.example.invalid/staff-invites/token/${inviteToken}/accept`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(credential === null ? {} : { authorization: `Bearer ${credential}` }),
    },
    body: JSON.stringify({ name: '수락한 실무자', email }),
  });
}

/** 공개 수락 route 는 신원 해석 앞에 있다. 해석기가 불리면 그 자체가 실패다. */
const noActor = async (): Promise<never> => {
  throw new Error('public accept route must not resolve an actor');
};

async function subjectFor(email: string): Promise<string | null> {
  const row = await t.db.prepare('SELECT auth_subject FROM users WHERE lower(trim(email)) = ?')
    .bind(email).first<{ auth_subject: string | null }>();
  return row?.auth_subject ?? null;
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  ec = { pair, jwk: { ...jwk, kid: 'ec-key', alg: 'ES256' } };
});

describe('초대 수락이 계정을 결속한다', () => {
  it('검증된 자격으로 수락하면 등재와 같은 배치에서 subject 가 채워진다', async () => {
    const { env, token: inviteToken } = await invited();
    const response = await handleRequest(acceptRequest(inviteToken, await token()), env, noActor);
    expect(response.status).toBe(201);
    expect(await subjectFor(invitedEmail)).toBe(subject);
  });

  it('자격의 이메일이 초대와 다르면 결속하지 않는다', async () => {
    const { env, token: inviteToken } = await invited();
    const response = await handleRequest(
      acceptRequest(inviteToken, await token({ email: 'someone.else@example.invalid' })), env, noActor,
    );
    expect(response.status).toBe(201);
    expect(await subjectFor(invitedEmail)).toBeNull();
  });

  it('자격 없이 수락하면 등재만 하고 결속하지 않는다', async () => {
    const { env, token: inviteToken } = await invited();
    const response = await handleRequest(acceptRequest(inviteToken, null), env, noActor);
    expect(response.status).toBe(201);
    expect(await subjectFor(invitedEmail)).toBeNull();
  });

  it('서명이 깨진 자격은 수락 자체를 막고 계정도 만들지 않는다', async () => {
    const { env, token: inviteToken } = await invited();
    const forged = `${(await token()).slice(0, -4)}AAAA`;
    const response = await handleRequest(acceptRequest(inviteToken, forged), env, noActor);
    expect(response.status).toBe(401);
    expect(await subjectFor(invitedEmail)).toBeNull();
    const row = await t.db.prepare('SELECT count(*) AS n FROM users WHERE lower(trim(email)) = ?')
      .bind(invitedEmail).first<{ n: number }>();
    expect(row?.n).toBe(0);
  });
});
