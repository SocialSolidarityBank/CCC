import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
  cancelCounselingSchedule,
  closeGoal,
  createBeneficiaryWithInitialSupportCase,
  createGoal,
  rescheduleCounselingSchedule,
  updateScheduleSessionGoals,
} from '../../../db/gateway';
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
    await closeGoal(t.env, testActors.counselor, seeded.goalId, 'reset');

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

// 시작 전에만 고칠 수 있는 미래 일정. 테스트 고정 날짜라 넉넉히 먼 미래를 쓴다.
const FUTURE_AT = '2036-01-05T01:00:00.000Z';
const PAST_AT = '2026-07-16T01:00:00.000Z';

async function postScheduleId(seeded: SeededCase, scheduledAt: string, body?: Record<string, unknown>): Promise<string> {
  const created = await postSchedule(testActors.counselor, {
    beneficiaryId: seeded.beneficiaryId,
    supportCaseId: seeded.supportCaseId,
    scheduledAt,
    ...body,
  });
  expect(created.status).toBe(201);
  return ((await created.json()) as { id: string }).id;
}

describe('세션 목표 수정 (D62 §6 · CCC-71)', () => {
  it('시작 전 일정의 묶음을 통째로 바꾸고, 연결은 활성 목표만, 낡은 version 은 충돌로 거부한다', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();
    const scheduleId = await postScheduleId(seeded, FUTURE_AT, {
      sessionGoals: [{ body: '처음 계획' }],
    });

    const result = await updateScheduleSessionGoals(t.env, testActors.counselor, scheduleId, {
      expectedVersion: 1,
      sessionGoals: [
        { body: '다듬은 계획', caseGoalId: seeded.goalId },
        { body: '추가 확인' },
      ],
    });
    expect(result.version).toBe(2);
    expect(result.sessionGoals).toEqual([
      { id: expect.any(String), body: '다듬은 계획', caseGoalId: seeded.goalId, caseGoalTitle: '생활비 계획 유지', ordinal: 0 },
      { id: expect.any(String), body: '추가 확인', caseGoalId: null, caseGoalTitle: null, ordinal: 1 },
    ]);

    // 닫힌 목표는 다시 저장하는 묶음에 넣을 수 없다(기존 연결 보존과 별개 — D62 §5).
    await closeGoal(t.env, testActors.counselor, seeded.goalId, 'reset');
    await expect(updateScheduleSessionGoals(t.env, testActors.counselor, scheduleId, {
      expectedVersion: 2,
      sessionGoals: [{ body: '닫힌 목표 연결 시도', caseGoalId: seeded.goalId }],
    })).rejects.toBeInstanceOf(ValidationError);

    // 낡은 version 은 충돌 — 저장된 묶음은 그대로다.
    await expect(updateScheduleSessionGoals(t.env, testActors.counselor, scheduleId, {
      expectedVersion: 1,
      sessionGoals: [],
    })).rejects.toBeInstanceOf(ConflictError);
    const rows = await t.db.prepare(
      'SELECT body FROM schedule_session_goals WHERE schedule_id = ? ORDER BY ordinal',
    ).bind(scheduleId).all<{ body: string }>();
    expect(rows.results.map((row) => row.body)).toEqual(['다듬은 계획', '추가 확인']);
  });

  it('일정 시작 시각이 지나면 잠기고, 미루면 새 시각까지 다시 열린다', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();
    const scheduleId = await postScheduleId(seeded, PAST_AT, {
      sessionGoals: [{ body: '그날의 계획' }],
    });

    await expect(updateScheduleSessionGoals(t.env, testActors.counselor, scheduleId, {
      expectedVersion: 1,
      sessionGoals: [{ body: '지난 회기 사후 수정 시도' }],
    })).rejects.toBeInstanceOf(ValidationError);

    await rescheduleCounselingSchedule(t.env, testActors.counselor, scheduleId, {
      expectedVersion: 1,
      scheduledAt: FUTURE_AT,
    });
    const result = await updateScheduleSessionGoals(t.env, testActors.counselor, scheduleId, {
      expectedVersion: 2,
      sessionGoals: [{ body: '미룬 뒤 다듬은 계획' }],
    });
    expect(result.version).toBe(3);
    expect(result.sessionGoals.map((goal) => goal.body)).toEqual(['미룬 뒤 다듬은 계획']);
  });

  it('취소된 일정은 잠긴 기록이고, 인테이크 일정과 비담당 실무자는 거부한다', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();
    const scheduleId = await postScheduleId(seeded, FUTURE_AT, {
      sessionGoals: [{ body: '취소 전 계획' }],
    });

    await expect(updateScheduleSessionGoals(t.env, testActors.unassignedCounselor, scheduleId, {
      expectedVersion: 1,
      sessionGoals: [],
    })).rejects.toBeInstanceOf(ForbiddenError);

    await cancelCounselingSchedule(t.env, testActors.counselor, scheduleId, { expectedVersion: 1 });
    await expect(updateScheduleSessionGoals(t.env, testActors.counselor, scheduleId, {
      expectedVersion: 2,
      sessionGoals: [],
    })).rejects.toBeInstanceOf(ConflictError);
    // 취소돼도 세션 목표는 그날의 계획 기록으로 남는다.
    const rows = await t.db.prepare(
      'SELECT body FROM schedule_session_goals WHERE schedule_id = ?',
    ).bind(scheduleId).all<{ body: string }>();
    expect(rows.results.map((row) => row.body)).toEqual(['취소 전 계획']);

    const intakeScheduleId = await postScheduleId(seeded, FUTURE_AT, { sessionKind: 'intake' });
    await expect(updateScheduleSessionGoals(t.env, testActors.counselor, intakeScheduleId, {
      expectedVersion: 1,
      sessionGoals: [{ body: '인테이크에 세션 목표 시도' }],
    })).rejects.toBeInstanceOf(ValidationError);
  });
});

function putPlan(
  actor: { userId: string; orgId: string; role: string },
  scheduleId: string,
  body: Record<string, unknown>,
): Promise<Response> {
  return worker.fetch(new Request(`http://localhost/schedules/${scheduleId}/plan`, {
    method: 'PUT',
    headers: headersFor(actor),
    body: JSON.stringify(body),
  }), t.env);
}

// 티켓 CCC-70: 수정 화면이 쓰는 HTTP 표면. 잠금·연결·낙관 잠금 규칙 자체는 위
// 게이트웨이 블록이 정본이고, 여기는 라우트 배선(상태 코드·응답 모양)을 고정한다.
describe('세션 목표 수정 HTTP 라우트 (D62 §6 · CCC-70)', () => {
  it('PUT /schedules/:id/plan 으로 묶음을 바꾸고, GET plan 은 일정 메타를 함께 싣는다', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();
    const scheduleId = await postScheduleId(seeded, FUTURE_AT, {
      sessionGoals: [{ body: '처음 계획' }],
    });

    const updated = await putPlan(testActors.counselor, scheduleId, {
      expectedVersion: 1,
      sessionGoals: [{ body: '다듬은 계획', caseGoalId: seeded.goalId }],
    });
    expect(updated.status).toBe(200);
    const updatedBody = await updated.json() as { scheduleId: string; version: number; sessionGoals: unknown };
    expect(updatedBody.scheduleId).toBe(scheduleId);
    expect(updatedBody.version).toBe(2);
    expect(updatedBody.sessionGoals).toEqual([
      { id: expect.any(String), body: '다듬은 계획', caseGoalId: seeded.goalId, caseGoalTitle: '생활비 계획 유지', ordinal: 0 },
    ]);

    // 수정 화면의 잠금 판정·낙관 잠금 제출 재료. GET plan 이 일정 메타를 함께 싣는다.
    const plan = await getPlan(testActors.counselor, scheduleId);
    expect(plan.status).toBe(200);
    const planBody = await plan.json() as {
      beneficiaryId: string; supportCaseId: string; scheduledAt: string; status: string; version: number;
    };
    expect(planBody.beneficiaryId).toBe(seeded.beneficiaryId);
    expect(planBody.supportCaseId).toBe(seeded.supportCaseId);
    expect(planBody.scheduledAt).toBe(FUTURE_AT);
    expect(planBody.status).toBe('scheduled');
    expect(planBody.version).toBe(2);
  });

  it('시작 시각이 지난 일정의 세션 목표 수정 요청은 400 으로 거부한다 (완료 기준)', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();
    const scheduleId = await postScheduleId(seeded, PAST_AT, {
      sessionGoals: [{ body: '그날의 계획' }],
    });

    const response = await putPlan(testActors.counselor, scheduleId, {
      expectedVersion: 1,
      sessionGoals: [{ body: '지난 회기 사후 수정 시도' }],
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    const rows = await t.db.prepare(
      'SELECT body FROM schedule_session_goals WHERE schedule_id = ?',
    ).bind(scheduleId).all<{ body: string }>();
    expect(rows.results.map((row) => row.body)).toEqual(['그날의 계획']);
  });

  it('낡은 version 은 409, 비담당 실무자는 403, sessionGoals 누락은 400', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();
    const scheduleId = await postScheduleId(seeded, FUTURE_AT, {
      sessionGoals: [{ body: '처음 계획' }],
    });

    const stale = await putPlan(testActors.counselor, scheduleId, { expectedVersion: 2, sessionGoals: [] });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toEqual({ error: 'conflict' });

    const forbidden = await putPlan(testActors.unassignedCounselor, scheduleId, { expectedVersion: 1, sessionGoals: [] });
    expect(forbidden.status).toBe(403);

    // 묶음 통째 교체 계약이라 sessionGoals 키 생략은 실수로 본다(빈 배열과 다르다).
    const missing = await putPlan(testActors.counselor, scheduleId, { expectedVersion: 1 });
    expect(missing.status).toBe(400);
  });
});

describe('미래 회기 연결 수 조회 (D62 §5 · CCC-70)', () => {
  function getUpcomingLinks(
    actor: { userId: string; orgId: string; role: string },
    goalId: string,
  ): Promise<Response> {
    return worker.fetch(new Request(`http://localhost/goals/${goalId}/upcoming-links`, {
      headers: headersFor(actor),
    }), t.env);
  }

  it('아직 오지 않은 회기만 세고, 지난·취소 회기는 세지 않는다', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();
    // 미래 회기 1건(세는 대상) + 지난 회기 1건 + 취소한 미래 회기 1건(둘 다 제외).
    await postScheduleId(seeded, FUTURE_AT, {
      sessionGoals: [{ body: '미래 회기 계획', caseGoalId: seeded.goalId }],
    });
    await postScheduleId(seeded, PAST_AT, {
      sessionGoals: [{ body: '지난 회기 계획', caseGoalId: seeded.goalId }],
    });
    const cancelledId = await postScheduleId(seeded, FUTURE_AT, {
      sessionGoals: [{ body: '취소될 계획', caseGoalId: seeded.goalId }],
    });
    await cancelCounselingSchedule(t.env, testActors.counselor, cancelledId, { expectedVersion: 1 });

    const response = await getUpcomingLinks(testActors.counselor, seeded.goalId);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ upcomingCount: 1 });
  });

  it('연결이 없으면 0 이고, 비담당 실무자는 403 이다', async () => {
    await t.reset();
    const seeded = await seedOwnedCaseWithGoal();

    const empty = await getUpcomingLinks(testActors.counselor, seeded.goalId);
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toEqual({ upcomingCount: 0 });

    const forbidden = await getUpcomingLinks(testActors.unassignedCounselor, seeded.goalId);
    expect(forbidden.status).toBe(403);
  });
});
