import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import { createBeneficiaryWithInitialSupportCase, createCounselingSchedule } from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

// org_demo 는 setupD1 가 Asia/Seoul(UTC+9, DST 없음)로 프로비저닝한다. 앵커 날짜 2026-07-16.
// 창(오늘 + 향후 7일 = 8일)은 KST 07-16 00:00 ~ 07-24 00:00, 즉 UTC 로는
// [2026-07-15T15:00:00.000Z, 2026-07-23T15:00:00.000Z). 경계·타임존을 함께 검증한다.
const ANCHOR_DATE = '2026-07-16';
const WINDOW_START_UTC = '2026-07-15T15:00:00.000Z';
const WINDOW_END_UTC = '2026-07-23T15:00:00.000Z';

const t = setupD1();

function headersFor(actor: { userId: string; orgId: string; role: string }): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

interface SeededWindow {
  ownedBeneficiaryId: string;
  hiddenBeneficiaryId: string;
  todayScheduleId: string;
  lastDayScheduleId: string;
  justBeforeEndScheduleId: string;
  hiddenScheduleId: string;
}

// counselor 가 담당하는 케이스에 창 경계 안팎의 일정을, 다른 counselor 가 담당하는
// 별도 케이스에 창 안의 일정을 각각 심는다.
async function seedScheduleWindow(): Promise<SeededWindow> {
  await t.reset();

  const owned = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-01T00:00:00.000Z',
  });

  // KST 07-16 00:00 정각 = 창 시작 (오늘, 포함)
  const todaySchedule = await createCounselingSchedule(t.env, testActors.counselor, {
    beneficiaryId: owned.beneficiaryId,
    supportCaseId: owned.supportCaseId,
    scheduledAt: WINDOW_START_UTC,
  });
  // KST 07-15 23:59:59 = 창 시작 1초 전 (어제, 제외)
  await createCounselingSchedule(t.env, testActors.counselor, {
    beneficiaryId: owned.beneficiaryId,
    supportCaseId: owned.supportCaseId,
    scheduledAt: '2026-07-15T14:59:59.000Z',
  });
  // KST 07-23 10:00 = 향후 7일째 (day+7, 포함)
  const lastDaySchedule = await createCounselingSchedule(t.env, testActors.counselor, {
    beneficiaryId: owned.beneficiaryId,
    supportCaseId: owned.supportCaseId,
    scheduledAt: '2026-07-23T01:00:00.000Z',
  });
  // KST 07-23 23:59:59 = 창 끝 1초 전 (day+7, 포함)
  const justBeforeEndSchedule = await createCounselingSchedule(t.env, testActors.counselor, {
    beneficiaryId: owned.beneficiaryId,
    supportCaseId: owned.supportCaseId,
    scheduledAt: '2026-07-23T14:59:59.000Z',
  });
  // KST 07-24 00:00 정각 = 창 끝 (day+8, 제외)
  await createCounselingSchedule(t.env, testActors.counselor, {
    beneficiaryId: owned.beneficiaryId,
    supportCaseId: owned.supportCaseId,
    scheduledAt: WINDOW_END_UTC,
  });

  const hidden = await createBeneficiaryWithInitialSupportCase(t.env, testActors.unassignedCounselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-01T00:00:00.000Z',
  });
  // 다른 담당자의 케이스에 창 안(KST 07-16 10:00) 일정
  const hiddenSchedule = await createCounselingSchedule(t.env, testActors.unassignedCounselor, {
    beneficiaryId: hidden.beneficiaryId,
    supportCaseId: hidden.supportCaseId,
    scheduledAt: '2026-07-16T01:00:00.000Z',
  });

  return {
    ownedBeneficiaryId: owned.beneficiaryId,
    hiddenBeneficiaryId: hidden.beneficiaryId,
    todayScheduleId: todaySchedule.id,
    lastDayScheduleId: lastDaySchedule.id,
    justBeforeEndScheduleId: justBeforeEndSchedule.id,
    hiddenScheduleId: hiddenSchedule.id,
  };
}

describe('GET /schedules/upcoming', () => {
  it('returns the today + next 7 day window with time-zone-correct boundaries', async () => {
    const seeded = await seedScheduleWindow();

    const response = await worker.fetch(new Request(
      `http://localhost/schedules/upcoming?date=${ANCHOR_DATE}`,
      { headers: headersFor(testActors.counselor) },
    ), t.env);

    expect(response.status).toBe(200);
    const body = await response.json() as {
      date: string;
      timeZone: string;
      startUtc: string;
      endUtc: string;
      schedules: Array<{ id: string; beneficiaryId: string }>;
    };
    expect(body.date).toBe(ANCHOR_DATE);
    expect(body.timeZone).toBe('Asia/Seoul');
    expect(body.startUtc).toBe(WINDOW_START_UTC);
    expect(body.endUtc).toBe(WINDOW_END_UTC);
    // 창 시작 정각은 포함, 시작 1초 전과 창 끝 정각(day+8)은 제외. 오름차순 정렬.
    expect(body.schedules.map((schedule) => schedule.id)).toEqual([
      seeded.todayScheduleId,
      seeded.lastDayScheduleId,
      seeded.justBeforeEndScheduleId,
    ]);
  });

  it('scopes the window to assigned cases for counselors and org-wide for admins', async () => {
    const seeded = await seedScheduleWindow();

    const counselorResponse = await worker.fetch(new Request(
      `http://localhost/schedules/upcoming?date=${ANCHOR_DATE}`,
      { headers: headersFor(testActors.counselor) },
    ), t.env);
    expect(counselorResponse.status).toBe(200);
    const counselorText = await counselorResponse.text();
    const counselorBody = JSON.parse(counselorText) as { schedules: Array<{ id: string }> };
    expect(counselorBody.schedules.map((schedule) => schedule.id)).not.toContain(seeded.hiddenScheduleId);
    expect(counselorText).not.toContain(seeded.hiddenBeneficiaryId);

    const adminResponse = await worker.fetch(new Request(
      `http://localhost/schedules/upcoming?date=${ANCHOR_DATE}`,
      { headers: headersFor(testActors.admin) },
    ), t.env);
    expect(adminResponse.status).toBe(200);
    const adminBody = await adminResponse.json() as { schedules: Array<{ id: string }> };
    // admin 은 org 전체를 보되 창 경계는 동일하게 적용된다: 담당 3건 + 숨은 담당자 1건.
    expect(adminBody.schedules.map((schedule) => schedule.id)).toEqual([
      seeded.todayScheduleId,
      seeded.hiddenScheduleId,
      seeded.lastDayScheduleId,
      seeded.justBeforeEndScheduleId,
    ]);
  });

  it('rejects a malformed date the same way the today route does', async () => {
    await seedScheduleWindow();

    const response = await worker.fetch(new Request(
      'http://localhost/schedules/upcoming?date=2026-7-16',
      { headers: headersFor(testActors.counselor) },
    ), t.env);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
  });
});
