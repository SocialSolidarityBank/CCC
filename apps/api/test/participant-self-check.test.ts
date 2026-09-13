import { describe, expect, it } from 'vitest';
import { completeParticipantSignup, createParticipantInvite } from '@ccc/core/gateway';
import { setupD1, testActors, testProgramId } from './support/d1';
import worker from './support/local-worker';
import { signupConsentEvents } from './support/registration';

const { counselor } = testActors;
const t = setupD1();

function signupOpenEnv() {
  return { ...t.env, PUBLIC_SIGNUP_ENABLED: '1' };
}

async function seedJoinedParticipant() {
  const invite = await createParticipantInvite(t.env, counselor, {
    programId: testProgramId(counselor.orgId),
  });
  await completeParticipantSignup(t.env, {
    token: invite.token,
    name: '홍길동',
    phone: '010-1234-5678',
    email: 'hong@example.invalid',
    consentEvents: await signupConsentEvents(t.env, invite.token),
  });
  return invite.token;
}

describe('retired participant self-check surface (D86)', () => {
  it('가입 뒤에도 GET /invites/participant/:token/me 는 404다', async () => {
    await t.reset();
    const token = await seedJoinedParticipant();

    const res = await worker.fetch(
      new Request(`http://localhost/invites/participant/${token}/me`),
      signupOpenEnv(),
    );

    expect(res.status).toBe(404);
  });

  it('사용한 요청 링크는 담당 실무자 안내만 반환한다', async () => {
    await t.reset();
    const token = await seedJoinedParticipant();

    const res = await worker.fetch(
      new Request(`http://localhost/invites/participant/${token}`),
      signupOpenEnv(),
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      status: 'used',
      counselorName: expect.any(String),
      message: '이 링크는 이미 사용되었습니다. 담당 실무자에게 문의해 주세요.',
    });
  });
});
