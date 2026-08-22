import { describe, expect, it } from 'vitest';

import { createCase, createManualSession } from '../../../db/gateway';
import worker from './support/local-worker';
import { setupD1, testActors } from './support/d1';

const t = setupD1();
const counselor = testActors.counselor;
const headers = {
  'content-type': 'application/json',
  'X-CCC-User-Id': counselor.userId,
  'X-CCC-Org-Id': counselor.orgId,
  'X-CCC-Role': counselor.role,
};

describe('POST /cases/:caseId/action-items (CCC-128)', () => {
  it('creates an action with the source session while owner and due date come from the worker', async () => {
    await t.reset();
    const caseRecord = await createCase(t.env, counselor, {});
    const session = await createManualSession(t.env, counselor, caseRecord.id, {
      submissionId: crypto.randomUUID(),
      heldAt: '2026-08-21T09:00:00.000Z',
      channel: 'in_person',
      memo: '다음 회차 전까지 상환 계획을 적어 보기로 했다.',
      gasScores: [],
    });

    const response = await worker.fetch(new Request(
      `http://localhost/cases/${caseRecord.id}/action-items`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          description: '상환 계획 적기',
          owner: 'beneficiary',
          dueDate: '2026-08-28',
          sessionId: session.id,
        }),
      },
    ), t.env);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      caseId: caseRecord.id,
      sessionId: session.id,
      description: '상환 계획 적기',
      owner: 'beneficiary',
      dueDate: '2026-08-28',
    });
  });

  it('accepts the canonical support-case id for a migrated legacy session', async () => {
    await t.reset();
    const caseRecord = await createCase(t.env, counselor, {});
    const supportCase = await t.db.prepare(
      'SELECT id FROM support_cases WHERE org_id = ? AND legacy_case_id = ?',
    ).bind(counselor.orgId, caseRecord.id).first<{ id: string }>();
    if (supportCase === null) throw new Error('canonical support case is missing');
    const session = await createManualSession(t.env, counselor, caseRecord.id, {
      submissionId: crypto.randomUUID(),
      heldAt: '2026-08-21T09:00:00.000Z',
      channel: 'in_person',
      memo: '정본 참여사업 경로에서 출처 회차를 연결한다.',
      gasScores: [],
    });

    const response = await worker.fetch(new Request(
      `http://localhost/cases/${supportCase.id}/action-items`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          description: '정본 참여사업 액션',
          owner: 'counselor',
          sessionId: session.id,
        }),
      },
    ), t.env);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      caseId: supportCase.id,
      sessionId: session.id,
    });
  });

  it('rejects a source session from another case', async () => {
    await t.reset();
    const first = await createCase(t.env, counselor, {});
    const second = await createCase(t.env, counselor, {});
    const otherSession = await createManualSession(t.env, counselor, second.id, {
      submissionId: crypto.randomUUID(),
      heldAt: '2026-08-21T09:00:00.000Z',
      channel: 'in_person',
      memo: '다른 케이스 기록',
      gasScores: [],
    });

    const response = await worker.fetch(new Request(
      `http://localhost/cases/${first.id}/action-items`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          description: '잘못 연결된 할 일',
          owner: 'counselor',
          sessionId: otherSession.id,
        }),
      },
    ), t.env);

    expect(response.status).toBe(400);
  });
});
