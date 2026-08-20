import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import {
  completeOrganizationOnboarding,
  createCounselorInvite,
  createParticipantInvite,
  listUsers,
} from '../../../db/gateway';
import type { ApiEnv } from '../src/identity';
import { setupD1, testActors } from './support/d1';

// 실무자 초대 가입 (CCC-108 · CCC-33). 공개 라우트 둘(GET /invites/worker/:token ·
// POST /invites/worker)과 관리자 발급 라우트(POST /invites/counselor)를 검증한다.
// 공개 가입 표면 전체가 CCC-112 스위치(PUBLIC_SIGNUP_ENABLED='1') 안에 있다.

const { admin, counselor } = testActors;

const adminHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': admin.userId,
  'X-CCC-Org-Id': admin.orgId,
  'X-CCC-Role': 'admin',
};

const counselorHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': counselor.userId,
  'X-CCC-Org-Id': counselor.orgId,
  'X-CCC-Role': 'counselor',
};

const t = setupD1();

/** 스위치가 열린 환경. 라우트 테스트는 명시적으로 이걸 쓴다(기본 t.env 는 닫힘). */
function openEnv(): ApiEnv {
  return { ...t.env, PUBLIC_SIGNUP_ENABLED: '1' };
}

async function issueWorkerToken(): Promise<string> {
  await t.reset();
  const invite = await createCounselorInvite(t.env, admin);
  return invite.token;
}

describe('POST /invites/counselor (관리자 발급)', () => {
  it('관리자가 발급하면 201 + counselor 종류 토큰', async () => {
    await t.reset();
    const res = await worker.fetch(
      new Request('http://localhost/invites/counselor', { method: 'POST', headers: adminHeaders }),
      openEnv(),
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { token: string; kind: string; status: string };
    expect(body.kind).toBe('counselor');
    expect(body.status).toBe('issued');
    expect(body.token).toHaveLength(64);
  });

  it('실무자는 발급할 수 없다(403)', async () => {
    await t.reset();
    const res = await worker.fetch(
      new Request('http://localhost/invites/counselor', { method: 'POST', headers: counselorHeaders }),
      openEnv(),
    );
    expect(res.status).toBe(403);
  });

  it('스위치가 닫혀 있으면 404(fail closed, CCC-112)', async () => {
    await t.reset();
    const res = await worker.fetch(
      new Request('http://localhost/invites/counselor', { method: 'POST', headers: adminHeaders }),
      t.env,
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /invites/worker/:token (공개 유효성 조회)', () => {
  it('유효한 토큰이면 기관 표시 이름을 돌려준다', async () => {
    const token = await issueWorkerToken();
    await completeOrganizationOnboarding(t.env, admin, {
      orgName: '사회연대은행',
      programDisplayName: '마이크로크레딧',
    });
    const res = await worker.fetch(
      new Request(`http://localhost/invites/worker/${token}`),
      openEnv(),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ orgName: '사회연대은행' });
  });

  it('기관 이름 설정 전이면 orgName null 로 돌려준다(화면 폴백)', async () => {
    const token = await issueWorkerToken();
    const res = await worker.fetch(
      new Request(`http://localhost/invites/worker/${token}`),
      openEnv(),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ orgName: null });
  });

  it('없는 토큰은 404', async () => {
    await t.reset();
    const res = await worker.fetch(
      new Request(`http://localhost/invites/worker/${'0'.repeat(64)}`),
      openEnv(),
    );
    expect(res.status).toBe(404);
  });

  it('participant 종류 토큰은 worker 경로에서 404(종류 불일치도 구분 불가)', async () => {
    await t.reset();
    const invite = await createParticipantInvite(t.env, counselor, { programType: 'financial_support_v1' });
    const res = await worker.fetch(
      new Request(`http://localhost/invites/worker/${invite.token}`),
      openEnv(),
    );
    expect(res.status).toBe(404);
  });

  it('스위치가 닫혀 있으면 유효한 토큰도 404(fail closed, CCC-112)', async () => {
    const token = await issueWorkerToken();
    const res = await worker.fetch(
      new Request(`http://localhost/invites/worker/${token}`),
      t.env,
    );
    expect(res.status).toBe(404);
  });
});

describe('POST /invites/worker (공개 가입 완료)', () => {
  function signupRequest(body: Record<string, unknown>): Request {
    return new Request('http://localhost/invites/worker', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('가입하면 201 + users 에 role=counselor 로 등재돼 관리자 목록에 보인다', async () => {
    const token = await issueWorkerToken();
    const res = await worker.fetch(
      signupRequest({ token, name: '새 실무자', email: 'new.worker@example.invalid' }),
      openEnv(),
    );
    expect(res.status).toBe(201);
    const body = await res.json() as { userId: string; email: string };
    expect(body.userId).toBeTruthy();
    expect(body.email).toBe('new.worker@example.invalid');

    // admin 사용자 목록(listUsers — /users 화면의 데이터원)에 활성 counselor 로 나타난다.
    const users = await listUsers(t.env, admin);
    const created = users.find((user) => user.id === body.userId);
    expect(created).toMatchObject({
      email: 'new.worker@example.invalid',
      role: 'counselor',
      active: true,
      name: '새 실무자',
    });
  });

  it('토큰은 1회성 — 재사용하면 404', async () => {
    const token = await issueWorkerToken();
    const first = await worker.fetch(
      signupRequest({ token, name: '첫 가입', email: 'first.worker@example.invalid' }),
      openEnv(),
    );
    expect(first.status).toBe(201);
    const second = await worker.fetch(
      signupRequest({ token, name: '재사용 시도', email: 'second.worker@example.invalid' }),
      openEnv(),
    );
    expect(second.status).toBe(404);
    // 진 쪽 계정은 만들어지지 않았다.
    const users = await listUsers(t.env, admin);
    expect(users.some((user) => user.email === 'second.worker@example.invalid')).toBe(false);
  });

  it('이미 등재된 이메일이면 409 — 토큰은 소비되지 않아 다른 이메일로 다시 쓸 수 있다', async () => {
    const token = await issueWorkerToken();
    const dup = await worker.fetch(
      signupRequest({ token, name: '중복 이메일', email: counselor.userId }),
      openEnv(),
    );
    expect(dup.status).toBe(409);
    const retry = await worker.fetch(
      signupRequest({ token, name: '정상 가입', email: 'fresh.worker@example.invalid' }),
      openEnv(),
    );
    expect(retry.status).toBe(201);
  });

  it('이메일이 없으면 400(Access 신원 키라 필수)', async () => {
    const token = await issueWorkerToken();
    const res = await worker.fetch(
      signupRequest({ token, name: '이메일 없음' }),
      openEnv(),
    );
    expect(res.status).toBe(400);
  });

  it('스위치가 닫혀 있으면 404(fail closed, CCC-112)', async () => {
    const token = await issueWorkerToken();
    const res = await worker.fetch(
      signupRequest({ token, name: '스위치 닫힘', email: 'closed.worker@example.invalid' }),
      t.env,
    );
    expect(res.status).toBe(404);
  });
});
