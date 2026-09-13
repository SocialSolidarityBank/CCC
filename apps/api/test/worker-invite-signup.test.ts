import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import type { ApiEnv } from '@ccc/http-api/identity';
import { setupD1, testActors } from './support/d1';

// 실무자 초대 가입 라우트(CCC-108·CCC-33)가 폐지되었습니다.
// 공개 라우드 POST /invites/counselor, GET /invites/worker/:token, POST /invites/worker는
// 모두 404 { error: 'not_found' }를 반환한다. (fail closed — PUBLIC_SIGNUP_ENABLED 와 무관)

const { admin } = testActors;

const adminHeaders = {
  'content-type': 'application/json',
  'X-CCC-User-Id': admin.userId,
  'X-CCC-Org-Id': admin.orgId,
  'X-CCC-Role': 'admin',
};

const t = setupD1();

/** 스위치가 열린 환경. 라우트 테스트는 명시적으로 이걸 쓴다(기본 t.env 는 닫힘). */
function openEnv(): ApiEnv {
  return { ...t.env, PUBLIC_SIGNUP_ENABLED: '1' };
}

describe('retired counselor invite / worker signup routes (404)', () => {
  it('POST /invites/counselor returns 404 even with PUBLIC_SIGNUP_ENABLED', async () => {
    await t.reset();
    const res = await worker.fetch(
      new Request('http://localhost/invites/counselor', { method: 'POST', headers: adminHeaders }),
      openEnv(),
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('GET /invites/worker/<all-zeros> returns 404 even with PUBLIC_SIGNUP_ENABLED', async () => {
    await t.reset();
    const res = await worker.fetch(
      new Request(`http://localhost/invites/worker/${'0'.repeat(64)}`),
      openEnv(),
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });

  it('POST /invites/worker returns 404 even with PUBLIC_SIGNUP_ENABLED', async () => {
    await t.reset();
    const res = await worker.fetch(
      new Request('http://localhost/invites/worker', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: '0'.repeat(64), name: 'x', email: 'x@example.invalid' }),
      }),
      openEnv(),
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'not_found' });
  });
});
