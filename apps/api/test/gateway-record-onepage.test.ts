import { describe, expect, it } from 'vitest';
import {
  ForbiddenError,
  ValidationError,
  type CreateCounselingRecordInput,
  createBeneficiaryWithInitialSupportCase,
  createCounselingRecord,
  createIntakeRecord,
} from '../../../db/gateway';
import { setupD1 } from './support/d1';

// CCC-10 정기 기록지 원페이지: 서술형 항목(record_details · 0016)과 목표 종료+신설(D12)이
// 기존 createCounselingRecord 한 번의 호출로 원자 저장되는지 검증한다.

const t = setupD1();

const actor = { userId: 'user-counselor-10', orgId: 'org_demo', role: 'counselor' as const };

async function seedCaseWithGoals(titles: string[]) {
  await t.db.prepare(
    "INSERT INTO users (id, org_id, email, role, active, time_zone) VALUES (?, ?, 'record-onepage@example.invalid', 'counselor', 1, NULL)",
  ).bind(actor.userId, actor.orgId).run();
  const initial = await createBeneficiaryWithInitialSupportCase(t.env, actor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-20T09:00:00.000Z',
  });
  await createIntakeRecord(t.env, actor, initial.supportCaseId, {
    submissionId: '01000000-0000-4000-8000-00000000ba01',
    heldAt: '2026-07-20T10:00:00.000Z',
    channel: 'in_person',
    consent: { privacy: true, recordingAi: true },
    helpNarrative: { todayHelp: '월세 상담', hardestPoint: '체납', desiredChange: '안정' },
    lifeAreas: [
      { areaKey: 'economy', status: 'strained' },
      { areaKey: 'housing', status: 'okay' },
      { areaKey: 'employment', status: 'okay' },
      { areaKey: 'health', status: 'okay' },
      { areaKey: 'mental_health', status: 'okay' },
      { areaKey: 'family', status: 'okay' },
    ],
    goals: titles.map((title) => ({ title })),
    actionItems: [{ description: '서류 준비', owner: 'beneficiary' }],
  });
  const goals = await t.db.prepare(
    "SELECT id, title FROM goals WHERE org_id = ? AND support_case_id = ? AND status = 'active' ORDER BY created_at, id",
  ).bind(actor.orgId, initial.supportCaseId).all<{ id: string; title: string }>();
  return { supportCaseId: initial.supportCaseId, goals: goals.results };
}

/** 픽스처 목표 하나를 꺼낸다. 없으면 시드가 깨진 것이므로 바로 실패시킨다. */
function goalAt(goals: Array<{ id: string; title: string }>, index: number): { id: string; title: string } {
  const goal = goals[index];
  if (goal === undefined) throw new Error(`goal fixture ${index} is missing`);
  return goal;
}

function recordInput(overrides: Partial<CreateCounselingRecordInput> = {}): CreateCounselingRecordInput {
  return {
    submissionId: '01000000-0000-4000-8000-00000000bb01',
    heldAt: '2026-07-24T10:00:00.000Z',
    channel: 'in_person',
    memo: '오늘 상담 내용을 수기로 남긴다',
    gasScores: [],
    actionItems: [],
    flags: [],
    ...overrides,
  };
}

describe('createCounselingRecord — 정기 기록지 원페이지 (CCC-10)', () => {
  it('수기 메모 하나만 채워도 저장된다 (P1 유일 실질 필수)', async () => {
    await t.reset();
    const { supportCaseId } = await seedCaseWithGoals(['월세 체납 해소']);

    const result = await createCounselingRecord(t.env, actor, supportCaseId, recordInput());

    expect(result.replayed).toBe(false);
    const session = await t.db.prepare(
      'SELECT memo, kind, record_details FROM sessions WHERE id = ?',
    ).bind(result.record.id).first<{ memo: string; kind: string; record_details: string | null }>();
    expect(session?.memo).toBe('오늘 상담 내용을 수기로 남긴다');
    expect(session?.kind).toBe('regular');
    expect(session?.record_details).toBeNull();
  });

  it('담당자 의견·위기 서술·지난 이후 변화·이번 상담 목표를 record_details 에 저장한다', async () => {
    await t.reset();
    const { supportCaseId } = await seedCaseWithGoals(['월세 체납 해소']);

    const result = await createCounselingRecord(t.env, actor, supportCaseId, recordInput({
      details: {
        sessionGoalNote: '이번 상담 목표: 임대차 계약 확인',
        changeSinceLast: '지난주 아르바이트를 시작했다',
        safetyNote: '거주지 안전 확인함',
        counselorOpinion: '서류 준비 속도를 함께 맞출 필요가 있다',
      },
    }));

    const session = await t.db.prepare(
      'SELECT record_details FROM sessions WHERE id = ?',
    ).bind(result.record.id).first<{ record_details: string | null }>();
    const details = JSON.parse(session?.record_details ?? '{}');
    expect(details.sessionGoalNote).toBe('이번 상담 목표: 임대차 계약 확인');
    expect(details.changeSinceLast).toBe('지난주 아르바이트를 시작했다');
    expect(details.safetyNote).toBe('거주지 안전 확인함');
    expect(details.counselorOpinion).toBe('서류 준비 속도를 함께 맞출 필요가 있다');
  });

  it('빈 details 객체와 알 수 없는 키는 거부한다', async () => {
    await t.reset();
    const { supportCaseId } = await seedCaseWithGoals(['월세 체납 해소']);

    await expect(createCounselingRecord(t.env, actor, supportCaseId, recordInput({ details: {} })))
      .rejects.toBeInstanceOf(ValidationError);
    await expect(createCounselingRecord(
      t.env,
      actor,
      supportCaseId,
      recordInput({ details: { unknownField: '값' } as never }),
    )).rejects.toBeInstanceOf(ValidationError);
  });

  it('활성 목표 3개에서도 목표 1건 종료 + 1건 신설이 통과하고 replaced_by_goal_id 로 이어진다 (D12)', async () => {
    await t.reset();
    const { supportCaseId, goals } = await seedCaseWithGoals(['목표 하나', '목표 둘', '목표 셋']);
    expect(goals).toHaveLength(3);
    const closing = goalAt(goals, 0);

    await createCounselingRecord(t.env, actor, supportCaseId, recordInput({
      goalTransition: { closeGoalId: closing.id, closedReason: '달성해서 종료', newGoalTitle: '새 목표 문구' },
    }));

    const closed = await t.db.prepare(
      'SELECT title, status, closed_reason, closed_at, replaced_by_goal_id FROM goals WHERE id = ?',
    ).bind(closing.id).first<{
      title: string;
      status: string;
      closed_reason: string | null;
      closed_at: string | null;
      replaced_by_goal_id: string | null;
    }>();
    expect(closed?.status).toBe('closed');
    expect(closed?.closed_reason).toBe('달성해서 종료');
    expect(closed?.closed_at).not.toBeNull();
    // D12: 문구는 절대 수정하지 않는다.
    expect(closed?.title).toBe(closing.title);

    const replacement = await t.db.prepare(
      'SELECT id, title, status FROM goals WHERE id = ?',
    ).bind(closed?.replaced_by_goal_id).first<{ id: string; title: string; status: string }>();
    expect(replacement?.title).toBe('새 목표 문구');
    expect(replacement?.status).toBe('active');

    const active = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM goals WHERE org_id = ? AND support_case_id = ? AND status = 'active'",
    ).bind(actor.orgId, supportCaseId).first<{ count: number }>();
    expect(Number(active?.count)).toBe(3);

    // 목표 신설·종료는 세션 트리거 밖이라 명시 감사가 남는다(D14).
    const audits = await t.db.prepare(
      "SELECT action FROM audit_log WHERE target_table = 'goals' AND support_case_id = ? ORDER BY id",
    ).bind(supportCaseId).all<{ action: string }>();
    expect(audits.results.map((row) => row.action)).toContain('update');
  });

  it('종료만 하고 신설하지 않을 수도 있다', async () => {
    await t.reset();
    const { supportCaseId, goals } = await seedCaseWithGoals(['목표 하나', '목표 둘']);

    await createCounselingRecord(t.env, actor, supportCaseId, recordInput({
      goalTransition: { closeGoalId: goalAt(goals, 1).id, closedReason: '더는 맞지 않아 종료' },
    }));

    const closed = await t.db.prepare(
      'SELECT status, replaced_by_goal_id FROM goals WHERE id = ?',
    ).bind(goalAt(goals, 1).id).first<{ status: string; replaced_by_goal_id: string | null }>();
    expect(closed?.status).toBe('closed');
    expect(closed?.replaced_by_goal_id).toBeNull();
  });

  it('이미 종료된 목표나 다른 참여사업의 목표는 종료할 수 없다', async () => {
    await t.reset();
    const { supportCaseId, goals } = await seedCaseWithGoals(['목표 하나']);
    await createCounselingRecord(t.env, actor, supportCaseId, recordInput({
      goalTransition: { closeGoalId: goalAt(goals, 0).id, closedReason: '종료' },
    }));

    await expect(createCounselingRecord(t.env, actor, supportCaseId, recordInput({
      submissionId: '01000000-0000-4000-8000-00000000bb02',
      goalTransition: { closeGoalId: goalAt(goals, 0).id, closedReason: '두 번째 종료 시도' },
    }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('같은 제출 ID·같은 입력의 재시도는 재현으로 처리한다', async () => {
    await t.reset();
    const { supportCaseId } = await seedCaseWithGoals(['목표 하나']);
    const input = recordInput({ details: { counselorOpinion: '재시도 확인' } });

    const first = await createCounselingRecord(t.env, actor, supportCaseId, input);
    const second = await createCounselingRecord(t.env, actor, supportCaseId, input);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.record.id).toBe(first.record.id);
  });
});
