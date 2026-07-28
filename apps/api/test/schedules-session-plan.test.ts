import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import { closeGoal, createBeneficiaryWithInitialSupportCase, createGoal } from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

// 세션 목표(D28)·맞춤형 질문 저장·조회, 잘못된 케이스 목표 연결 거부, 비담당 접근 차단,
// 브리핑 병기(데이터)를 검증한다 (티켓 #35).

const t = setupD1();

function headersFor(actor: { userId: string; orgId: string; role: string }): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

interface SeededCase {
  beneficiaryId: string;
  supportCaseId: string;
  goalId: string;
}

async function seedOwnedCaseWithGoal(): Promise<SeededCase> {
  const owned = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-01T00:00:00.000Z',
  });
  const goal = await createGoal(t.env, testActors.counselor, owned.supportCaseId, { title: '생활비 계획 유지' });
  return { beneficiaryId: owned.beneficiaryId, supportCaseId: owned.supportCaseId, goalId: goal.id };
}

function postSchedule(
  actor: { userId: string; orgId: string; role: string },
  body: Record<string, unknown>,
): Promise<Response> {
  return worker.fetch(new Request('http://localhost/schedules', {
    method: 'POST',
    headers: headersFor(actor),
    body: JSON.stringify(body),
  }), t.env);
}

function getPlan(
  actor: { userId: string; orgId: string; role: string },
  scheduleId: string,
): Promise<Response> {
  return worker.fetch(new Request(`http://localhost/schedules/${scheduleId}/plan`, {
    headers: headersFor(actor),
  }), t.env);
}

async function countSchedules(supportCaseId: string): Promise<number> {
  const row = await t.db.prepare(
    'SELECT COUNT(*) AS count FROM counseling_schedules WHERE support_case_id = ?',
  ).bind(supportCaseId).first<{ count: number }>();
  return row?.count ?? 0;
}

describe('상담 일정의 세션 목표·맞춤형 질문 (#35)', () => {
  it('세션 목표(케이스 목표 연결 포함)·맞춤형 질문을 저장하고 plan 라우트로 조회한다', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();

    const created = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
      sessionGoals: [
        { body: '구직 활동 점검', caseGoalId: seeded.goalId },
        { body: '주거 상황 확인' },
      ],
      customQuestions: ['이번 주 지원 신청은 했는지', '건강 상태는 어떤지'],
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as {
      id: string; sessionGoals?: unknown; customQuestions?: unknown;
    };
    // 생성 응답 형태는 그대로 6필드만 — plan 은 분리 조회한다.
    expect(createdBody.sessionGoals).toBeUndefined();
    expect(createdBody.customQuestions).toBeUndefined();

    const plan = await getPlan(testActors.counselor, createdBody.id);
    expect(plan.status).toBe(200);
    const planBody = await plan.json() as {
      scheduleId: string;
      sessionGoals: Array<{ body: string; caseGoalId: string | null; caseGoalTitle: string | null; ordinal: number }>;
      customQuestions: Array<{ body: string; ordinal: number }>;
    };
    expect(planBody.scheduleId).toBe(createdBody.id);
    expect(planBody.sessionGoals).toEqual([
      { id: expect.any(String), body: '구직 활동 점검', caseGoalId: seeded.goalId, caseGoalTitle: '생활비 계획 유지', ordinal: 0 },
      { id: expect.any(String), body: '주거 상황 확인', caseGoalId: null, caseGoalTitle: null, ordinal: 1 },
    ]);
    expect(planBody.customQuestions).toEqual([
      { id: expect.any(String), body: '이번 주 지원 신청은 했는지', ordinal: 0 },
      { id: expect.any(String), body: '건강 상태는 어떤지', ordinal: 1 },
    ]);
  });

  it('일정 없이 세션 목표만으로도 등록되고 plan 은 빈 배열을 반환한다(선택 필드)', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();

    const created = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { id: string };

    const plan = await getPlan(testActors.counselor, createdBody.id);
    expect(plan.status).toBe(200);
    const planBody = await plan.json() as { sessionGoals: unknown[]; customQuestions: unknown[] };
    expect(planBody.sessionGoals).toEqual([]);
    expect(planBody.customQuestions).toEqual([]);
  });

  it('타 케이스의 목표를 연결하면 400 으로 거부하고 일정을 저장하지 않는다', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();
    // 같은 실무자가 소유한 다른 케이스의 목표
    const otherCase = await seedOwnedCaseWithGoal();

    const response = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
      sessionGoals: [{ body: '엉뚱한 연결', caseGoalId: otherCase.goalId }],
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(await countSchedules(seeded.supportCaseId)).toBe(0);
  });

  it('종료된 케이스 목표를 연결하면 400 으로 거부하고 일정을 저장하지 않는다', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();
    await closeGoal(t.env, testActors.counselor, seeded.goalId, '상황 변화로 재설정');

    const response = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
      sessionGoals: [{ body: '종료 목표 연결 시도', caseGoalId: seeded.goalId }],
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(await countSchedules(seeded.supportCaseId)).toBe(0);
  });

  it('담당이 아닌 실무자는 plan 을 조회할 수 없다(403)', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();
    const created = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
      sessionGoals: [{ body: '구직 활동 점검' }],
    });
    const createdBody = await created.json() as { id: string };

    const response = await getPlan(testActors.unassignedCounselor, createdBody.id);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('브리핑은 포커스 참여사업의 다가오는 일정의 세션 목표·맞춤형 질문을 병기한다', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();
    await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-20T01:00:00.000Z',
      sessionGoals: [{ body: '구직 활동 점검', caseGoalId: seeded.goalId }],
      customQuestions: ['이번 주 지원 신청은 했는지'],
    });

    const briefing = await worker.fetch(new Request(
      `http://localhost/participants/${seeded.beneficiaryId}/programs/${seeded.supportCaseId}/briefing`,
      { headers: headersFor(testActors.counselor) },
    ), t.env);
    expect(briefing.status).toBe(200);
    const briefingBody = await briefing.json() as {
      focusUpcomingSchedule: {
        id: string;
        scheduledAt: string;
        sessionGoals: Array<{ body: string; caseGoalId: string | null; caseGoalTitle: string | null }>;
        customQuestions: string[];
      } | null;
    };
    expect(briefingBody.focusUpcomingSchedule).not.toBeNull();
    expect(briefingBody.focusUpcomingSchedule?.scheduledAt).toBe('2026-07-20T01:00:00.000Z');
    expect(briefingBody.focusUpcomingSchedule?.sessionGoals).toEqual([
      { body: '구직 활동 점검', caseGoalId: seeded.goalId, caseGoalTitle: '생활비 계획 유지' },
    ]);
    expect(briefingBody.focusUpcomingSchedule?.customQuestions).toEqual(['이번 주 지원 신청은 했는지']);
  });
});
