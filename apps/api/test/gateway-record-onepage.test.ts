import { describe, expect, it } from 'vitest';
import {
  ValidationError,
  type CreateCounselingRecordInput,
  createBeneficiaryWithInitialSupportCase,
  createCounselingRecord,
  createIntakeRecord,
} from '../../../db/gateway';
import { setupD1 } from './support/d1';

// CCC-10 정기 기록지 원페이지: 서술형 항목(record_details · 0016)이 createCounselingRecord
// 한 번의 호출로 원자 저장되는지 검증한다. 구 목표 종료+신설(goalTransition)은 D62 §5 로
// 폐지됐고, 여기서는 그 키가 거부되는 것만 고정한다(CCC-73).

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

  it('담당 실무자 의견·위기 서술·지난 이후 변화·이번 상담 목표를 record_details 에 저장한다', async () => {
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

  it('구 종료+신설(goalTransition) 키는 저장 경로가 거부한다 (D62 §5)', async () => {
    await t.reset();
    const { supportCaseId, goals } = await seedCaseWithGoals(['목표 하나']);

    // 대조군: 같은 입력이 goalTransition 없이는 저장된다. 거부가 다른 이유면 안 된다.
    await createCounselingRecord(t.env, actor, supportCaseId, recordInput());

    await expect(createCounselingRecord(t.env, actor, supportCaseId, recordInput({
      submissionId: '01000000-0000-4000-8000-00000000bb02',
      goalTransition: { closeGoalId: goalAt(goals, 0).id, closedReason: '달성해서 종료' },
    } as never))).rejects.toBeInstanceOf(ValidationError);

    // 목표는 그대로다. 닫기는 closeGoal 단일 관문만 남는다.
    const goal = await t.db.prepare(
      'SELECT status FROM goals WHERE id = ?',
    ).bind(goalAt(goals, 0).id).first<{ status: string }>();
    expect(goal?.status).toBe('active');
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
