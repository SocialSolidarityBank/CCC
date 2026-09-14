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

  it('숨긴 기억 설정은 관리자에게도 GET과 PUT 모두 404이며 설정을 바꾸지 않는다', async () => {
    const path = '/settings/counseling-memory';
    const before = await t.db.prepare(
      'SELECT enabled,version FROM counseling_memory_settings WHERE org_id=?',
    ).bind(testActors.admin.orgId).first();
    for (const actor of [testActors.counselor, testActors.admin]) {
      expect((await worker.fetch(request(path, actor), t.env)).status).toBe(404);
    }
    const put = await worker.fetch(request(path, testActors.admin, 'PUT', {
      enabled: false, expectedVersion: 1,
    }), t.env);
    expect(put.status).toBe(404);
    expect(await t.db.prepare(
      'SELECT enabled,version FROM counseling_memory_settings WHERE org_id=?',
    ).bind(testActors.admin.orgId).first()).toEqual(before);
  }, 30_000);

  it('숨긴 기억 설정과 Agent 기억 파이프라인은 입력 형태와 무관하게 404다', async () => {
    expect((await worker.fetch(
      request('/settings/counseling-memory?memory=private', testActors.admin),
      t.env,
    )).status).toBe(404);
    expect((await worker.fetch(request('/settings/counseling-memory', testActors.admin, 'PUT', {
      enabled: false, expectedVersion: 1, prompt: 'override',
    }), t.env)).status).toBe(404);
    const routes: Array<[string, string]> = [
      ['/pipeline/memory/claim', 'POST'],
      ['/pipeline/memory/00000000-0000-4000-8000-000000000001/source', 'GET'],
      ['/pipeline/memory/00000000-0000-4000-8000-000000000001/result', 'POST'],
    ];
    for (const [path, method] of routes) {
      expect((await worker.fetch(request(path, testActors.service, method, method === 'GET' ? undefined : {}), t.env)).status).toBe(404);
    }
  }, 30_000);
});
