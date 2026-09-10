import { beforeEach, describe, expect, it } from 'vitest';
import { createBeneficiaryWithInitialSupportCase, type Actor } from '@ccc/core/gateway';
import worker from './support/local-worker';
import { setupD1, testActors, testProgramId } from './support/d1';
import { registrationInput } from './support/registration';

const t = setupD1();
beforeEach(async () => { await t.reset(); });

function request(path: string, actor: Actor, method = 'GET', body?: unknown): Request {
  return new Request(`http://localhost${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'X-CCC-User-Id': actor.userId,
      'X-CCC-Org-Id': actor.orgId,
      'X-CCC-Role': actor.role,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe('케이스 기억의 HTTP 접근 경계', () => {
  it('담당자는 자기 케이스 기억을 읽고 비담당자와 다른 기관은 읽지 못한다', async () => {
    // 녹음·AI 도메인은 decline 으로 남긴다 — 접근 경계 자체는 동의와 무관함을 그대로 본다.
    const created = await createBeneficiaryWithInitialSupportCase(
      t.env, testActors.counselor,
      await registrationInput(
        t.env,
        testActors.counselor,
        { programId: testProgramId(testActors.counselor.orgId), intakeAt: '2026-09-01T09:00:00.000Z' },
        {
          counseling_recording: 'decline',
          external_stt_processing: 'decline',
          external_llm_cross_border_processing: 'decline',
          voice_original_retention_period: 'decline',
        },
      ),
    );
    const path = `/support-cases/${created.supportCaseId}/memory`;
    const own = await worker.fetch(request(path, testActors.counselor), t.env);
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ supportCaseId: created.supportCaseId });
    const unassigned = await worker.fetch(request(path, testActors.unassignedCounselor), t.env);
    expect(unassigned.status).toBe(403);
    const outside = await worker.fetch(request(path, testActors.otherOrgAdmin), t.env);
    expect(outside.status).toBe(403);
  }, 30_000);

  it('기관 설정은 관리자만 바꾸며 뒤늦은 저장은 최신 선택을 덮어쓰지 못한다', async () => {
    const path = '/settings/counseling-memory';
    const denied = await worker.fetch(request(path, testActors.counselor), t.env);
    expect(denied.status).toBe(403);
    const initial = await worker.fetch(request(path, testActors.admin), t.env);
    expect(initial.status).toBe(200);
    const initialBody = await initial.json() as { version: number };
    const disabled = await worker.fetch(request(path, testActors.admin, 'PUT', {
      enabled: false, expectedVersion: initialBody.version,
    }), t.env);
    expect(disabled.status).toBe(200);
    const stale = await worker.fetch(request(path, testActors.admin, 'PUT', {
      enabled: true, expectedVersion: initialBody.version,
    }), t.env);
    expect(stale.status).toBe(409);
    const current = await worker.fetch(request(path, testActors.admin), t.env);
    expect(await current.json()).toMatchObject({ enabled: false });
  }, 30_000);

  it('기억 내용은 URL 입력으로 받지 않고 설정의 알 수 없는 입력도 거부한다', async () => {
    const path = '/settings/counseling-memory';
    const query = await worker.fetch(request(`${path}?memory=private`, testActors.admin), t.env);
    expect(query.status).toBe(400);
    const initial = await worker.fetch(request(path, testActors.admin), t.env);
    const initialBody = await initial.json() as { version: number };
    const unknownField = await worker.fetch(request(path, testActors.admin, 'PUT', {
      enabled: false, expectedVersion: initialBody.version, prompt: 'override',
    }), t.env);
    expect(unknownField.status).toBe(400);
    const after = await worker.fetch(request(path, testActors.admin), t.env);
    expect(await after.json()).toEqual(initialBody);
  }, 30_000);
});
