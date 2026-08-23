import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import {
  ForbiddenError,
  assignSupportCase,
  createBeneficiaryWithInitialSupportCase,
  listCounselorAssignments,
  listSupportCaseAssignees,
  updateParticipantPii,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

// 관리자 영역(재개편 T8, #38): 실무자별 활성 배정 당사자 조회(실명·감사)와 공동 담당 추가(D7).
// 담당 실무자 중심 접근(ADR-0002)·역할 기준 실명 표시(D24·ADR-0005)를 게이트웨이·라우트 두 층에서 검증한다.

const t = setupD1();

function headersFor(actor: { userId: string; orgId: string; role: string }): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

const pii = { name: '김한나', phone: '010-1234-5678', account: '110-123-456789' };

// counselor 가 담당(초기 배정=primary)하는 케이스 하나를 심고 실명을 등록한다.
async function seedAssignedParticipant(): Promise<{ beneficiaryId: string; supportCaseId: string }> {
  await t.reset();
  const created = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-01T00:00:00.000Z',
  });
  await updateParticipantPii(t.env, testActors.admin, created.beneficiaryId, {
    supportCaseContextId: created.supportCaseId,
    expectedVersion: 1,
    ...pii,
  });
  return created;
}

describe('listCounselorAssignments (gateway)', () => {
  it('returns the counselor active assignments with realname/phone for an admin, never the account', async () => {
    const seeded = await seedAssignedParticipant();

    const assignments = await listCounselorAssignments(t.env, testActors.admin, testActors.counselor.userId);
    expect(assignments.userId).toBe(testActors.counselor.userId);
    expect(assignments.participants).toHaveLength(1);
    expect(assignments.participants[0]).toEqual({
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      programType: 'financial_support_v1',
      status: 'active',
      assignmentRole: 'primary',
      name: pii.name,
      phone: pii.phone,
    });
    // 계좌는 어떤 필드로도 실리지 않는다(실명·연락처만, D24·ADR-0005).
    expect(JSON.stringify(assignments)).not.toContain(pii.account);

    // PII 가 실린 화면 조회당 read_participant_pii 감사 1건(케이스 대상 목록을 detail 에).
    const piiRead = await t.db.prepare(
      `SELECT actor_id AS actorId, actor_role AS actorRole, action, target_table AS targetTable, detail
       FROM audit_log WHERE action = 'read_participant_pii' AND actor_id = ?
       ORDER BY id DESC LIMIT 1`,
    ).bind(testActors.admin.userId).first();
    expect(piiRead).toEqual({
      actorId: testActors.admin.userId,
      actorRole: 'admin',
      action: 'read_participant_pii',
      targetTable: 'participant_pii_vault',
      detail: `{"fields":["name","phone"],"beneficiaryIds":["${seeded.beneficiaryId}"],"count":1}`,
    });
  });

  it('rejects a non-admin actor before any read (assertAdmin)', async () => {
    await seedAssignedParticipant();
    await expect(
      listCounselorAssignments(t.env, testActors.counselor, testActors.counselor.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // 비관리자 호출은 실명 감사를 남기지 않는다.
    const count = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action = 'read_participant_pii' AND actor_id = ?",
    ).bind(testActors.counselor.userId).first<{ count: number }>();
    expect(count?.count).toBe(0);
  });

  it('does not cross organization boundaries', async () => {
    await seedAssignedParticipant();
    // 다른 기관 관리자에게는 이 기관 실무자가 존재하지 않는다(ForbiddenError).
    await expect(
      listCounselorAssignments(t.env, testActors.otherOrgAdmin, testActors.counselor.userId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('assignSupportCase co-assignment (gateway, D7)', () => {
  it('adds a secondary assignee for an admin and keeps the primary', async () => {
    const seeded = await seedAssignedParticipant();

    const assignee = await assignSupportCase(
      t.env,
      testActors.admin,
      seeded.supportCaseId,
      testActors.unassignedCounselor.userId,
      'secondary',
    );
    expect(assignee.role).toBe('secondary');
    expect(assignee.userId).toBe(testActors.unassignedCounselor.userId);

    const assignees = await listSupportCaseAssignees(t.env, testActors.admin, seeded.supportCaseId);
    expect(assignees).toHaveLength(2);
    expect(assignees.map((a) => a.role).sort()).toEqual(['primary', 'secondary']);

    const assignAudit = await t.db.prepare(
      `SELECT action, target_table AS targetTable FROM audit_log
       WHERE action = 'assign' AND actor_id = ? ORDER BY id DESC LIMIT 1`,
    ).bind(testActors.admin.userId).first();
    expect(assignAudit).toEqual({ action: 'assign', targetTable: 'support_case_assignees' });
  });

  it('rejects co-assignment by a non-admin actor', async () => {
    const seeded = await seedAssignedParticipant();
    await expect(
      assignSupportCase(t.env, testActors.counselor, seeded.supportCaseId, testActors.unassignedCounselor.userId, 'secondary'),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('GET /users/:id/assignments (route)', () => {
  it('serves the counselor assignments with realname to an admin', async () => {
    const seeded = await seedAssignedParticipant();
    // id 는 이메일 형식이며 경로 세그먼트로 그대로 실린다(@ 는 path 에서 유효).
    const response = await worker.fetch(new Request(
      `http://localhost/users/${testActors.counselor.userId}/assignments`,
      { headers: headersFor(testActors.admin) },
    ), t.env);
    expect(response.status).toBe(200);
    const body = await response.text();
    const payload = JSON.parse(body) as { userId: string; participants: Array<Record<string, unknown>> };
    expect(payload.userId).toBe(testActors.counselor.userId);
    expect(payload.participants).toHaveLength(1);
    expect(payload.participants[0]).toMatchObject({
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      status: 'active',
      assignmentRole: 'primary',
      participantName: pii.name,
      participantPhone: pii.phone,
    });
    // 계좌는 응답 어디에도 실리지 않는다.
    expect(body).not.toContain(pii.account);
  });

  it('denies a non-admin actor (403) without leaking the realname', async () => {
    await seedAssignedParticipant();
    const response = await worker.fetch(new Request(
      `http://localhost/users/${testActors.counselor.userId}/assignments`,
      { headers: headersFor(testActors.counselor) },
    ), t.env);
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).not.toContain(pii.name);
    expect(body).not.toContain(pii.phone);
  });
});

describe('POST /support-cases/:id/assignees (route, D74 assignment request)', () => {
  it('creates a requested assignment, hides it from active listings, and activates it only after assignee acceptance', async () => {
    const seeded = await seedAssignedParticipant();
    const response = await worker.fetch(new Request(
      `http://localhost/support-cases/${seeded.supportCaseId}/assignees`,
      {
        method: 'POST',
        headers: headersFor(testActors.admin),
        body: JSON.stringify({ userId: testActors.unassignedCounselor.userId }),
      },
    ), t.env);
    expect(response.status).toBe(201);
    const payload = await response.json() as {
      id: string;
      userId: string;
      role: string;
      status: string;
    };
    expect(payload.userId).toBe(testActors.unassignedCounselor.userId);
    expect(payload.role).toBe('secondary');
    expect(payload.status).toBe('requested');

    const pendingResponse = await worker.fetch(new Request(
      'http://localhost/assignment-requests',
      { headers: headersFor(testActors.unassignedCounselor) },
    ), t.env);
    expect(pendingResponse.status).toBe(200);
    const pendingPayload = await pendingResponse.json() as {
      requests: Array<{ id: string; status: string; participantName: string | null }>;
    };
    expect(pendingPayload.requests).toEqual([
      expect.objectContaining({
        id: payload.id,
        status: 'requested',
        participantName: pii.name,
      }),
    ]);

    const listResponse = await worker.fetch(new Request(
      `http://localhost/support-cases/${seeded.supportCaseId}/assignees`,
      { headers: headersFor(testActors.admin) },
    ), t.env);
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json() as { assignees: Array<{ role: string }> };
    expect(list.assignees).toHaveLength(1);

    const accepted = await worker.fetch(new Request(
      `http://localhost/support-cases/${seeded.supportCaseId}/assignees/${payload.id}/accept`,
      {
        method: 'POST',
        headers: headersFor(testActors.unassignedCounselor),
      },
    ), t.env);
    expect(accepted.status).toBe(200);

    const after = await worker.fetch(new Request(
      `http://localhost/support-cases/${seeded.supportCaseId}/assignees`,
      { headers: headersFor(testActors.admin) },
    ), t.env);
    expect(after.status).toBe(200);
    const afterPayload = await after.json() as { assignees: Array<{ role: string }> };
    expect(afterPayload.assignees).toHaveLength(2);

    const noPending = await worker.fetch(new Request(
      'http://localhost/assignment-requests',
      { headers: headersFor(testActors.unassignedCounselor) },
    ), t.env);
    expect(noPending.status).toBe(200);
    await expect(noPending.json()).resolves.toEqual({ requests: [] });
  });

  it('denies co-assignment by a non-admin actor (403)', async () => {
    const seeded = await seedAssignedParticipant();
    const response = await worker.fetch(new Request(
      `http://localhost/support-cases/${seeded.supportCaseId}/assignees`,
      {
        method: 'POST',
        headers: headersFor(testActors.counselor),
        body: JSON.stringify({ userId: testActors.unassignedCounselor.userId }),
      },
    ), t.env);
    expect(response.status).toBe(403);
  });
});

describe('POST /support-cases/:id/force-transfer (route, D74)', () => {
  it('requires an admin and records participant notification confirmation using the actor identity', async () => {
    const seeded = await seedAssignedParticipant();
    const response = await worker.fetch(new Request(
      `http://localhost/support-cases/${seeded.supportCaseId}/force-transfer`,
      {
        method: 'POST',
        headers: headersFor(testActors.admin),
        body: JSON.stringify({
          toUserId: testActors.unassignedCounselor.userId,
          reason: '장기 부재',
          participantNotified: true,
        }),
      },
    ), t.env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ transferred: true });

    const row = await t.db.prepare(
      `SELECT status, notified_by AS notifiedBy, notified_at AS notifiedAt
       FROM support_case_assignees
       WHERE support_case_id = ? AND user_id = ? AND unassigned_at IS NULL`,
    ).bind(seeded.supportCaseId, testActors.unassignedCounselor.userId).first();
    expect(row).toMatchObject({
      status: 'active',
      notifiedBy: testActors.admin.userId,
      notifiedAt: expect.any(String),
    });
  });
});
