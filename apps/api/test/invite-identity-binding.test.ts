import { beforeAll, describe, expect, it } from 'vitest';
import { handleRequest } from '@ccc/http-api';
import { acceptStaffInvite, createStaffInvite, ValidationError } from '@ccc/core/gateway';
import { createSupabaseIdentity } from '../../../adapters/identity-supabase/src/index';
import { setupD1, testActors, type TestApiEnv } from './support/d1';

/**
 * D90 초대 결속. 초대로 받은 Auth 계정의 검증된 subject 를 등재와 같은 배치에서 채운다.
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

async function registrationState() {
  const [users, roles, invites] = await Promise.all([
    t.db.prepare('SELECT * FROM users ORDER BY id').all(),
    t.db.prepare('SELECT * FROM user_role_assignments ORDER BY id').all(),
    t.db.prepare('SELECT * FROM staff_invites ORDER BY id').all(),
  ]);
  return { users: users.results, roles: roles.results, invites: invites.results };
}

async function expectRefusal(request: Request, env: TestApiEnv, status: 401 | 404) {
  const before = await registrationState();
  const response = await handleRequest(request, env, noActor);
  expect(response.status).toBe(status);
  expect(await response.json()).toEqual({ error: status === 404 ? 'not_found' : 'actor_authentication_required' });
  expect(await registrationState()).toEqual(before);
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  ec = { pair, jwk: { ...jwk, kid: 'ec-key', alg: 'ES256' } };
});

describe('초대 수락이 계정을 결속한다', () => {
  it('검증된 subject와 정규화한 이메일이 맞으면 한 번만 등재하고 초대 역할만 부여한다', async () => {
    const { env, token: inviteToken } = await invited();
    const credential = await token({ email: 'INVITED@Example.Invalid' });
    const response = await handleRequest(acceptRequest(inviteToken, credential, '  Invited@Example.Invalid  '), env, noActor);
    expect(response.status).toBe(201);
    const body = await response.json() as { userId: string; email: string; roleWaiting: boolean };
    expect(body).toEqual({ userId: expect.any(String), email: invitedEmail, roleWaiting: false });
    const user = await t.db.prepare('SELECT id, active, auth_subject FROM users WHERE email = ?')
      .bind(invitedEmail).all();
    expect(user.results).toEqual([{ id: body.userId, active: 1, auth_subject: subject }]);
    const roles = await t.db.prepare(
      'SELECT role, source, granted_by FROM user_role_assignments WHERE user_id = ? AND revoked_at IS NULL ORDER BY role',
    ).bind(body.userId).all();
    expect(roles.results).toEqual([{ role: 'practitioner', source: 'manual', granted_by: testActors.admin.userId }]);
    const invite = await t.db.prepare('SELECT status, used_by_user_id, used_at, consumption_id FROM staff_invites').all();
    expect(invite.results).toEqual([{
      status: 'used', used_by_user_id: body.userId, used_at: expect.any(String), consumption_id: expect.any(String),
    }]);
    await expectRefusal(acceptRequest(inviteToken, credential), env, 404);
  });

  it('검증된 이메일이 요청 이메일과 다르면 사용자와 역할을 만들거나 초대를 소비하지 않는다', async () => {
    const { env, token: inviteToken } = await invited();
    await expectRefusal(acceptRequest(inviteToken, await token({ email: 'someone.else@example.invalid' })), env, 404);
  });

  it('검증된 이메일과 요청 이메일이 같아도 초대 이메일이 다르면 모두 그대로 둔다', async () => {
    const { env, token: inviteToken } = await invited();
    const otherEmail = 'someone.else@example.invalid';
    await expectRefusal(acceptRequest(inviteToken, await token({ email: otherEmail }), otherEmail), env, 404);
  });

  it('자격이 없으면 사용자와 역할을 만들거나 초대를 소비하지 않는다', async () => {
    const { env, token: inviteToken } = await invited();
    await expectRefusal(acceptRequest(inviteToken, null), env, 404);
  });

  it('검증 포트가 없으면 Bearer가 있어도 등록하지 않는다', async () => {
    const { token: inviteToken } = await invited();
    await expectRefusal(acceptRequest(inviteToken, await token()), t.env, 404);
  });

  it('검증 포트가 빈 subject를 반환해도 미존재 응답만 보낸다', async () => {
    const { env, token: inviteToken } = await invited();
    env.verifyIdentityLinkClaims = async () => ({ subject: ' \t ', email: invitedEmail, issuedAt: new Date(epoch * 1000).toISOString() });
    await expectRefusal(acceptRequest(inviteToken, await token()), env, 404);
  });

  it('gateway도 누락되거나 비어 있거나 불투명 식별자가 아닌 subject를 등록하지 않는다', async () => {
    const { env, token: inviteToken } = await invited();
    const before = await registrationState();
    for (const invalidSubject of [undefined, null, ' \t ', 'invalid subject']) {
      await expect(Reflect.apply(acceptStaffInvite, undefined, [
        env, { token: inviteToken, name: '수락한 실무자', email: invitedEmail }, invalidSubject,
      ])).rejects.toBeInstanceOf(ValidationError);
      expect(await registrationState()).toEqual(before);
    }
  });

  it('서명이 깨진 자격은 인증 실패로 거부하고 등록 상태를 바꾸지 않는다', async () => {
    const { env, token: inviteToken } = await invited();
    const valid = await token();
    const signatureStart = valid.lastIndexOf('.') + 1;
    const replacement = valid[signatureStart] === 'A' ? 'B' : 'A';
    const forged = valid.slice(0, signatureStart) + replacement + valid.slice(signatureStart + 1);
    await expectRefusal(acceptRequest(inviteToken, forged), env, 401);
  });

  it('서명된 자격에 이메일 claim이 없어도 검증기의 인증 실패를 그대로 반환한다', async () => {
    const { env, token: inviteToken } = await invited();
    await expectRefusal(acceptRequest(inviteToken, await token({ email: undefined })), env, 401);
  });
});
