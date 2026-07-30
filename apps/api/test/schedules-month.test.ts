import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import { createBeneficiaryWithInitialSupportCase, createCounselingSchedule } from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

// 전체 일정(CCC-19). org_demo 는 setupD1 가 Asia/Seoul(UTC+9, DST 없음)로 프로비저닝한다.
// 2026-02 는 윤년의 29일 달이라 창 길이 파생이 맞는지 함께 본다 —
// KST 02-01 00:00 ~ 03-01 00:00, UTC 로는 [2026-01-31T15:00Z, 2026-02-28T15:00Z).
const MONTH = '2026-02';
const WINDOW_START_UTC = '2026-01-31T15:00:00.000Z';
const WINDOW_END_UTC = '2026-02-28T15:00:00.000Z';

const t = setupD1();

function headersFor(actor: { userId: string; orgId: string; role: string }): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

interface SeededMonth {
  hiddenBeneficiaryId: string;
  firstInstantScheduleId: string;
  midMonthScheduleId: string;
  lastInstantScheduleId: string;
  hiddenScheduleId: string;
}

async function seedMonth(): Promise<SeededMonth> {
  await t.reset();

  const owned = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-01-05T00:00:00.000Z',
  });

  // KST 02-01 00:00 정각 = 창 시작 (포함)
  const firstInstant = await createCounselingSchedule(t.env, testActors.counselor, {
    beneficiaryId: owned.beneficiaryId,
    supportCaseId: owned.supportCaseId,
    scheduledAt: WINDOW_START_UTC,
  });
  // KST 01-31 23:59:59 = 창 시작 1초 전 (제외 — 앞 달)
  await createCounselingSchedule(t.env, testActors.counselor, {
    beneficiaryId: owned.beneficiaryId,
    supportCaseId: owned.supportCaseId,
    scheduledAt: '2026-01-31T14:59:59.000Z',
  });
  // KST 02-15 10:00 = 달 한가운데 (포함)
  const midMonth = await createCounselingSchedule(t.env, testActors.counselor, {
    beneficiaryId: owned.beneficiaryId,
    supportCaseId: owned.supportCaseId,
    scheduledAt: '2026-02-15T01:00:00.000Z',
  });
  // KST 02-28 23:59:59 = 윤년 2월의 마지막 순간 (포함) — 창 길이가 29 로 파생됐는지가 여기서 갈린다
  const lastInstant = await createCounselingSchedule(t.env, testActors.counselor, {
    beneficiaryId: owned.beneficiaryId,
    supportCaseId: owned.supportCaseId,
    scheduledAt: '2026-02-28T14:59:59.000Z',
  });
  // KST 03-01 00:00 정각 = 창 끝 (제외 — 다음 달)
  await createCounselingSchedule(t.env, testActors.counselor, {
    beneficiaryId: owned.beneficiaryId,
    supportCaseId: owned.supportCaseId,
    scheduledAt: WINDOW_END_UTC,
  });

  const hidden = await createBeneficiaryWithInitialSupportCase(t.env, testActors.unassignedCounselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-01-05T00:00:00.000Z',
  });
  const hiddenSchedule = await createCounselingSchedule(t.env, testActors.unassignedCounselor, {
    beneficiaryId: hidden.beneficiaryId,
    supportCaseId: hidden.supportCaseId,
    scheduledAt: '2026-02-10T01:00:00.000Z',
  });

  return {
    hiddenBeneficiaryId: hidden.beneficiaryId,
    firstInstantScheduleId: firstInstant.id,
    midMonthScheduleId: midMonth.id,
    lastInstantScheduleId: lastInstant.id,
    hiddenScheduleId: hiddenSchedule.id,
  };
}

describe('GET /schedules/month', () => {
  it('derives the window from the month, including the leap-year last day', async () => {
    const seeded = await seedMonth();

    const response = await worker.fetch(new Request(
      `http://localhost/schedules/month?month=${MONTH}`,
      { headers: headersFor(testActors.counselor) },
    ), t.env);

    expect(response.status).toBe(200);
    const body = await response.json() as {
      date: string;
      timeZone: string;
      startUtc: string;
      endUtc: string;
      schedules: Array<{ id: string }>;
    };
    // 화면은 이 date 에서 달을 읽는다 — 그 달의 1일이어야 한다.
    expect(body.date).toBe(`${MONTH}-01`);
    expect(body.timeZone).toBe('Asia/Seoul');
    expect(body.startUtc).toBe(WINDOW_START_UTC);
    expect(body.endUtc).toBe(WINDOW_END_UTC);
    expect(body.schedules.map((schedule) => schedule.id)).toEqual([
      seeded.firstInstantScheduleId,
      seeded.midMonthScheduleId,
      seeded.lastInstantScheduleId,
    ]);
  });

  it('scopes the month to assigned cases for counselors and org-wide for admins', async () => {
    const seeded = await seedMonth();

    const counselorResponse = await worker.fetch(new Request(
      `http://localhost/schedules/month?month=${MONTH}`,
      { headers: headersFor(testActors.counselor) },
    ), t.env);
    expect(counselorResponse.status).toBe(200);
    const counselorText = await counselorResponse.text();
    const counselorBody = JSON.parse(counselorText) as { schedules: Array<{ id: string }> };
    expect(counselorBody.schedules.map((schedule) => schedule.id)).not.toContain(seeded.hiddenScheduleId);
    expect(counselorText).not.toContain(seeded.hiddenBeneficiaryId);

    const adminResponse = await worker.fetch(new Request(
      `http://localhost/schedules/month?month=${MONTH}`,
      { headers: headersFor(testActors.admin) },
    ), t.env);
    expect(adminResponse.status).toBe(200);
    const adminBody = await adminResponse.json() as { schedules: Array<{ id: string }> };
    expect(adminBody.schedules.map((schedule) => schedule.id)).toEqual([
      seeded.firstInstantScheduleId,
      seeded.hiddenScheduleId,
      seeded.midMonthScheduleId,
      seeded.lastInstantScheduleId,
    ]);
  });

  it('falls back to the org-local current month when month is omitted', async () => {
    await seedMonth();

    const response = await worker.fetch(new Request(
      'http://localhost/schedules/month',
      { headers: headersFor(testActors.counselor) },
    ), t.env);

    expect(response.status).toBe(200);
    const body = await response.json() as { date: string };
    // 기본 달을 정하는 것은 서버다 — 화면은 기관 시간대를 모른다.
    expect(body.date).toMatch(/^\d{4}-\d{2}-01$/);
  });

  it('rejects a malformed month', async () => {
    await seedMonth();

    for (const month of ['2026-2', '2026-13', '2026', 'oops']) {
      const response = await worker.fetch(new Request(
        `http://localhost/schedules/month?month=${month}`,
        { headers: headersFor(testActors.counselor) },
      ), t.env);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    }
  });

  it('carries the completed session id so the screen can link to that record', async () => {
    await t.reset();
    const owned = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-01-05T00:00:00.000Z',
    });
    await createCounselingSchedule(t.env, testActors.counselor, {
      beneficiaryId: owned.beneficiaryId,
      supportCaseId: owned.supportCaseId,
      scheduledAt: '2026-02-15T01:00:00.000Z',
    });

    const response = await worker.fetch(new Request(
      `http://localhost/schedules/month?month=${MONTH}`,
      { headers: headersFor(testActors.counselor) },
    ), t.env);

    expect(response.status).toBe(200);
    const body = await response.json() as { schedules: Array<{ status: string; completedSessionId: string | null }> };
    // 예정 일정은 스키마 CHECK 상 completed_session_id 가 없다.
    expect(body.schedules).toHaveLength(1);
    expect(body.schedules[0]!.status).toBe('scheduled');
    expect(body.schedules[0]!.completedSessionId).toBeNull();
  });
});
