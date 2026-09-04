import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import { createBeneficiaryWithInitialSupportCase, createGoal, listGoals } from '@ccc/core/gateway';
import { setupD1, testActors } from './support/d1';

// 인테이크 분기(티켓 #36): 상담 유형(intake)·방법(in_person) 저장, 세션 목표 거부,
// 케이스 목표(D12) 1~3개 제한, 인테이크→일반 등록의 케이스 목표 연결 E2E 를 검증한다.

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
}

async function seedOwnedCase(): Promise<SeededCase> {
  const owned = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-01T00:00:00.000Z',
  });
  return { beneficiaryId: owned.beneficiaryId, supportCaseId: owned.supportCaseId };
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

async function scheduleRow(supportCaseId: string): Promise<{ session_kind: string; channel: string } | null> {
  return t.db.prepare(
    'SELECT session_kind, channel FROM counseling_schedules WHERE support_case_id = ?',
  ).bind(supportCaseId).first<{ session_kind: string; channel: string }>();
}

async function countSchedules(supportCaseId: string): Promise<number> {
  const row = await t.db.prepare(
    'SELECT COUNT(*) AS count FROM counseling_schedules WHERE support_case_id = ?',
  ).bind(supportCaseId).first<{ count: number }>();
  return row?.count ?? 0;
}

async function countActiveGoals(supportCaseId: string): Promise<number> {
  const row = await t.db.prepare(
    "SELECT COUNT(*) AS count FROM goals WHERE support_case_id = ? AND status = 'active'",
  ).bind(supportCaseId).first<{ count: number }>();
  return row?.count ?? 0;
}

describe('인테이크 분기 — 상담 유형·방법 + 케이스 목표 (#36)', () => {
  it('인테이크 일정을 유형·방법과 함께 저장하고 케이스 목표를 신설한다', async () => {
    await t.reset();
    const seeded = await seedOwnedCase();

    const created = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
      sessionKind: 'intake',
      channel: 'in_person',
      caseGoals: ['월 5만원 저축을 3개월 유지한다', '주 3회 구직 활동을 기록한다'],
      customQuestions: ['이번 달 지출 계획은'],
    });
    expect(created.status).toBe(201);
    const createdBody = await created.json() as { id: string };

    // DB 에 상담 유형·방법이 그대로 저장된다.
    expect(await scheduleRow(seeded.supportCaseId)).toEqual({ session_kind: 'intake', channel: 'in_person' });

    // 케이스 목표(D12)가 활성 상태로 신설된다.
    const goals = await listGoals(t.env, testActors.counselor, seeded.supportCaseId);
    const activeTitles = goals.filter((goal) => goal.status === 'active').map((goal) => goal.title).sort();
    expect(activeTitles).toEqual(['월 5만원 저축을 3개월 유지한다', '주 3회 구직 활동을 기록한다']);

    // plan 은 인테이크에 세션 목표가 없고 유형·방법·맞춤형 질문을 싣는다.
    const plan = await getPlan(testActors.counselor, createdBody.id);
    expect(plan.status).toBe(200);
    const planBody = await plan.json() as {
      sessionKind: string;
      channel: string;
      sessionGoals: unknown[];
      customQuestions: Array<{ body: string }>;
    };
    expect(planBody.sessionKind).toBe('intake');
    expect(planBody.channel).toBe('in_person');
    expect(planBody.sessionGoals).toEqual([]);
    expect(planBody.customQuestions.map((question) => question.body)).toEqual(['이번 달 지출 계획은']);
  });

  it('오늘/다가오는 일정 카드에 상담 유형·방법을 실어 준다', async () => {
    await t.reset();
    const seeded = await seedOwnedCase();
    await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z', // Asia/Seoul 2026-07-16 10:00
      sessionKind: 'intake',
      caseGoals: ['월 5만원 저축을 3개월 유지한다'],
    });

    const today = await worker.fetch(new Request('http://localhost/schedules/today?date=2026-07-16', {
      headers: headersFor(testActors.counselor),
    }), t.env);
    expect(today.status).toBe(200);
    const todayBody = await today.json() as {
      schedules: Array<{ supportCaseId: string; sessionKind: string; channel: string }>;
    };
    const card = todayBody.schedules.find((item) => item.supportCaseId === seeded.supportCaseId);
    expect(card).toMatchObject({ sessionKind: 'intake', channel: 'in_person' });
  });

  it('인테이크 일정에 세션 목표를 주면 400 으로 거부하고 아무것도 저장하지 않는다', async () => {
    await t.reset();
    const seeded = await seedOwnedCase();

    const response = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
      sessionKind: 'intake',
      caseGoals: ['월 5만원 저축을 3개월 유지한다'],
      sessionGoals: [{ body: '이번 회차에서 다룰 것' }],
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(await countSchedules(seeded.supportCaseId)).toBe(0);
    expect(await countActiveGoals(seeded.supportCaseId)).toBe(0);
  });

  /**
   * CCC-64(2026-08-08 Q 결정): 목표 없이도 인테이크 일정을 만든다. 구 계약은 최소 1개를
   * 강제했는데, 그 목표는 goals 표(D43 이 보류한 세부 목표 층)로 들어가 어느 화면에도
   * 보이지 않았다. 그런데도 필수라 실무자가 **당사자를 만나기 전에** 목표를 지어내야 했다.
   * 목표는 첫 상담에서 대화로 정해 브리핑의 '전체 목표'에 적는다(D45, 저장소가 다르다).
   */
  it('인테이크는 케이스 목표 없이도 등록된다 (CCC-64)', async () => {
    await t.reset();
    const seeded = await seedOwnedCase();

    // 빈 배열도, 키 자체가 없는 것도 통과한다. 화면은 이제 키를 보내지 않는다.
    const empty = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
      sessionKind: 'intake',
      caseGoals: [],
    });
    expect(empty.status).toBe(201);

    const omitted = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-17T01:00:00.000Z',
      sessionKind: 'intake',
    });
    expect(omitted.status).toBe(201);

    expect(await countSchedules(seeded.supportCaseId)).toBe(2);
    // 목표를 안 보냈으니 goals 표에도 아무것도 안 생긴다.
    expect(await countActiveGoals(seeded.supportCaseId)).toBe(0);
  });

  it('케이스 목표는 4개 이상이면 거부한다(케이스당 활성 최대 3개, D12)', async () => {
    await t.reset();
    const seeded = await seedOwnedCase();

    const response = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
      sessionKind: 'intake',
      caseGoals: ['목표 하나', '목표 둘', '목표 셋', '목표 넷'],
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(await countSchedules(seeded.supportCaseId)).toBe(0);
    expect(await countActiveGoals(seeded.supportCaseId)).toBe(0);
  });

  it('기존 활성 목표와 합산해 3개를 넘으면 거부한다', async () => {
    await t.reset();
    const seeded = await seedOwnedCase();
    await createGoal(t.env, testActors.counselor, seeded.supportCaseId, { title: '기존 목표 1' });
    await createGoal(t.env, testActors.counselor, seeded.supportCaseId, { title: '기존 목표 2' });

    const response = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
      sessionKind: 'intake',
      caseGoals: ['신규 목표 1', '신규 목표 2'], // 2 + 2 = 4 > 3
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(await countSchedules(seeded.supportCaseId)).toBe(0);
    expect(await countActiveGoals(seeded.supportCaseId)).toBe(2);
  });

  it('기본 상담(regular)에 케이스 목표를 주면 400 으로 거부한다', async () => {
    await t.reset();
    const seeded = await seedOwnedCase();

    const response = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
      caseGoals: ['일반 상담에는 못 만드는 목표'],
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    expect(await countSchedules(seeded.supportCaseId)).toBe(0);
    expect(await countActiveGoals(seeded.supportCaseId)).toBe(0);
  });

  it('E2E: 인테이크로 만든 케이스 목표를 이후 일반 상담의 세션 목표에 연결한다', async () => {
    await t.reset();
    const seeded = await seedOwnedCase();

    // 1) 인테이크 등록 → 케이스 목표 신설
    const intake = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-16T01:00:00.000Z',
      sessionKind: 'intake',
      caseGoals: ['월 5만원 저축을 3개월 유지한다'],
    });
    expect(intake.status).toBe(201);

    // 2) 신설된 케이스 목표 id 확보 (T5 로직이 자동으로 연결 후보에 노출)
    const goals = await listGoals(t.env, testActors.counselor, seeded.supportCaseId);
    const caseGoal = goals.find((goal) => goal.status === 'active' && goal.title === '월 5만원 저축을 3개월 유지한다');
    expect(caseGoal).toBeDefined();

    // 3) 일반 상담 등록에서 그 목표에 세션 목표를 연결
    const regular = await postSchedule(testActors.counselor, {
      beneficiaryId: seeded.beneficiaryId,
      supportCaseId: seeded.supportCaseId,
      scheduledAt: '2026-07-23T01:00:00.000Z',
      sessionGoals: [{ body: '저축 진행 상황 점검', caseGoalId: caseGoal!.id }],
    });
    expect(regular.status).toBe(201);
    const regularBody = await regular.json() as { id: string };

    // 4) plan 이 인테이크 목표와의 연결(제목 병기)을 보여 준다
    const plan = await getPlan(testActors.counselor, regularBody.id);
    expect(plan.status).toBe(200);
    const planBody = await plan.json() as {
      sessionKind: string;
      sessionGoals: Array<{ body: string; caseGoalId: string | null; caseGoalTitle: string | null }>;
    };
    expect(planBody.sessionKind).toBe('regular');
    expect(planBody.sessionGoals).toEqual([
      { id: expect.any(String), body: '저축 진행 상황 점검', caseGoalId: caseGoal!.id, caseGoalTitle: '월 5만원 저축을 3개월 유지한다', ordinal: 0 },
    ]);
  });
});
