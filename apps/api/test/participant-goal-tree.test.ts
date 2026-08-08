import { describe, expect, it } from 'vitest';
import worker from './support/local-worker';
import {
  ForbiddenError,
  closeGoal,
  createBeneficiaryWithInitialSupportCase,
  createCounselingSchedule,
  createGoal,
  getParticipantGoalTree,
  setSupportCaseOverallGoal,
  updateGoalTitle,
} from '../../../db/gateway';
import { setupD1, testActors } from './support/d1';

// 당사자 허브 목표 트리 (D62 §8 · CCC-69) — 전체 > 세부 > 세션 위계, 닫힌 목표 보존,
// 문구 이력('이력 보기' 재료), D36 접근 범위(목표는 상담 내용 — 담당 케이스만)를 검증한다.

const t = setupD1();

function headersFor(actor: { userId: string; orgId: string; role: string }): Record<string, string> {
  return {
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

async function seedTree() {
  const owned = await createBeneficiaryWithInitialSupportCase(t.env, testActors.counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-01T00:00:00.000Z',
  });
  // 수정자 표시 이름 — 이력 줄이 users.name 을 조인해 싣는 것을 검증한다.
  await t.db.prepare('UPDATE users SET name = ? WHERE id = ?')
    .bind('김담당', testActors.counselor.userId).run();

  await setSupportCaseOverallGoal(t.env, testActors.counselor, owned.supportCaseId, '주거 안정');
  await setSupportCaseOverallGoal(t.env, testActors.counselor, owned.supportCaseId, '주거 안정과 채무 상환 계획 실행');

  const active = await createGoal(t.env, testActors.counselor, owned.supportCaseId, { title: '저축 습관 만들기' });
  await updateGoalTitle(t.env, testActors.counselor, active.id, '주 1회 3만원 저축하기');
  const closed = await createGoal(t.env, testActors.counselor, owned.supportCaseId, { title: '이력서 월 2회 제출' });
  await closeGoal(t.env, testActors.counselor, closed.id, 'achieved');

  // 세션 목표 — 활성 목표에 두 회기, 연결 없는 한 줄은 트리 밖이다.
  await createCounselingSchedule(t.env, testActors.counselor, {
    beneficiaryId: owned.beneficiaryId,
    supportCaseId: owned.supportCaseId,
    scheduledAt: '2026-07-16T01:00:00.000Z',
    sessionGoals: [
      { body: '가계부 확인', caseGoalId: active.id },
      { body: '연결 없는 계획' },
    ],
  });
  await createCounselingSchedule(t.env, testActors.counselor, {
    beneficiaryId: owned.beneficiaryId,
    supportCaseId: owned.supportCaseId,
    scheduledAt: '2026-07-23T01:00:00.000Z',
    sessionGoals: [{ body: '지출 항목 정리', caseGoalId: active.id }],
  });

  return { ...owned, activeGoalId: active.id, closedGoalId: closed.id };
}

describe('getParticipantGoalTree (D62 §8 · CCC-69)', () => {
  it('전체 > 세부 > 세션 위계와 문구 이력을 케이스 구획으로 내린다', async () => {
    await t.reset();
    const seeded = await seedTree();

    const tree = await getParticipantGoalTree(t.env, testActors.counselor, seeded.beneficiaryId);
    expect(tree).toHaveLength(1);
    const entry = tree[0]!;
    expect(entry.sourceSupportCase.id).toBe(seeded.supportCaseId);
    expect(entry.overallGoal).toBe('주거 안정과 채무 상환 계획 실행');
    // 이력은 최신부터 — 최초 작성이 마지막 줄로 남는다(D62 §4). 수정자 이름·시각 포함.
    expect(entry.overallGoalRevisions.map((revision) => revision.title))
      .toEqual(['주거 안정과 채무 상환 계획 실행', '주거 안정']);
    expect(entry.overallGoalRevisions[0]?.editedByName).toBe('김담당');
    expect(entry.overallGoalRevisions[0]?.editedAt).toBeTruthy();

    expect(entry.goals).toHaveLength(2);
    const active = entry.goals.find((goal) => goal.id === seeded.activeGoalId)!;
    expect(active.status).toBe('active');
    expect(active.revisions.map((revision) => revision.title))
      .toEqual(['주 1회 3만원 저축하기', '저축 습관 만들기']);
    // 세션 목표는 연결된 것만, 회기 시각 최신부터. 연결 없는 줄은 트리 밖이다.
    expect(active.sessionGoals.map((sessionGoal) => sessionGoal.body))
      .toEqual(['지출 항목 정리', '가계부 확인']);
    expect(active.sessionGoals[0]?.scheduledAt).toBe('2026-07-23T01:00:00.000Z');
    expect(active.sessionGoals[0]?.scheduleStatus).toBe('scheduled');
    expect(entry.goals.flatMap((goal) => goal.sessionGoals.map((sessionGoal) => sessionGoal.body)))
      .not.toContain('연결 없는 계획');

    // 닫힌 목표는 사유·시각과 함께 남는다 — 지우지 않는다(D62 §5).
    const closed = entry.goals.find((goal) => goal.id === seeded.closedGoalId)!;
    expect(closed.status).toBe('closed');
    expect(closed.closedReason).toBe('achieved');
    expect(closed.closedAt).not.toBeNull();

    // 화면 조회 감사 1건 (D14).
    const audit = await t.db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE target_table = 'participant_goal_tree' AND target_id = ?",
    ).bind(seeded.beneficiaryId).first<{ count: number }>();
    expect(audit?.count).toBe(1);
  });

  it('담당 케이스가 없으면 페이지 판정 그대로 막는다 (D36 — 목표는 상담 내용)', async () => {
    await t.reset();
    const seeded = await seedTree();
    await expect(getParticipantGoalTree(t.env, testActors.unassignedCounselor, seeded.beneficiaryId))
      .rejects.toBeInstanceOf(ForbiddenError);
    // admin 은 기관 범위 — 담당 배정 없이도 본다.
    const asAdmin = await getParticipantGoalTree(t.env, testActors.admin, seeded.beneficiaryId);
    expect(asAdmin).toHaveLength(1);
  });

  it('goal-tree 라우트가 cases 로 감싸 내리고, 비담당은 403 이다', async () => {
    await t.reset();
    const seeded = await seedTree();

    const response = await worker.fetch(new Request(
      `http://localhost/participants/${seeded.beneficiaryId}/goal-tree`,
      { headers: headersFor(testActors.counselor) },
    ), t.env);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      cases: Array<{
        sourceSupportCase: { id: string };
        overallGoal: string | null;
        overallGoalRevisions: Array<{ title: string | null; editedByName: string | null; editedAt: string }>;
        goals: Array<{ id: string; status: string; sessionGoals: unknown[] }>;
      }>;
    };
    expect(body.cases).toHaveLength(1);
    expect(body.cases[0]?.overallGoal).toBe('주거 안정과 채무 상환 계획 실행');
    expect(body.cases[0]?.goals).toHaveLength(2);

    const forbidden = await worker.fetch(new Request(
      `http://localhost/participants/${seeded.beneficiaryId}/goal-tree`,
      { headers: headersFor(testActors.unassignedCounselor) },
    ), t.env);
    expect(forbidden.status).toBe(403);
  });
});
