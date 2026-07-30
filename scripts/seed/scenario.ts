/**
 * content → 게이트웨이 호출 시퀀스. db/gateway.ts 공개 함수만 import 한다(R1).
 *
 * 이 파일은 raw D1 을 절대 만지지 않는다(guard allowlist 대상 아님) — 모든 쓰기는 게이트웨이
 * 공개 함수를 거친다. 참여자당 순서는 스펙을 엄수한다:
 *   1) createBeneficiaryWithInitialSupportCase(admin actor, initialAssigneeUserId 필수)
 *   2) createCounselingSchedule(intake, caseGoals → 케이스 목표 생성)
 *   3) listGoals 로 목표 id 부트스트랩(인테이크 목표는 created_at 동률이라 title 로 매핑)
 *   4) createCounselingRecord(intake 일정 완료, 활성 목표 전부 채점)
 *   5) 정기 회차 반복(regular schedule → record). 중간 이벤트: closeGoal 교체, 액션 해결, 독립 플래그
 *   6) 향후 일정(scheduled 로 남김, record 없음)
 *
 * 활성 목표 집합을 엔진이 직접 추적한다(assertActiveGoalsAreScored 하드 게이트) — 부트스트랩 이후엔
 * closeGoal successor 로만 변한다. 시나리오는 엄격히 순차 실행한다(Promise.all 금지).
 */
import {
  createBeneficiaryWithInitialSupportCase,
  createCounselingSchedule,
  createCounselingRecord,
  listGoals,
  closeGoal,
  createActionItem,
  resolveActionItem,
  createFlag,
  upsertUser,
  type Env,
  type Actor,
  type CounselingRecordGasScoreInput,
  type CounselingRecordActionItemInput,
  type CounselingRecordFlagInput,
  type CreateScheduleSessionGoalInput,
} from '../../db/gateway';
import type { D1Capture } from './capture';
import { ADMIN_ACTOR_ID, ORG_ID } from './preload-data';
import {
  PARTICIPANTS,
  VIRTUAL_COUNSELORS,
  type SeedParticipant,
  type SeedActionSpec,
  type SeedFlag,
  type Trajectory,
} from './content';

const FINANCIAL_SUPPORT_V1 = 'financial_support_v1' as const;

const TRAJECTORY_SEQUENCES: Record<Trajectory, number[]> = {
  improving: [-1, 0, 1, 2, 2],
  plateau: [0, 0, 1, 0, 1],
  decline: [1, 0, -1, -2, -1],
  mixed: [0, 1, -1, 1, 0],
};

interface ActiveGoal {
  key: string;
  id: string;
  title: string;
}

function clampScore(value: number): -2 | -1 | 0 | 1 | 2 {
  const clamped = Math.max(-2, Math.min(2, value));
  return clamped as -2 | -1 | 0 | 1 | 2;
}

/** 세션 index(0=인테이크) 기준으로 현재 활성 목표 전부에 점수를 매긴다(추이 + 슬롯별 변주). */
function scoreActiveGoals(
  active: readonly ActiveGoal[],
  trajectory: Trajectory,
  sessionIndex: number,
): CounselingRecordGasScoreInput[] {
  const sequence = TRAJECTORY_SEQUENCES[trajectory];
  const base = sequence[Math.min(sessionIndex, sequence.length - 1)]!;
  return active.map((goal, slot) => {
    const offset = slot === 1 ? -1 : slot === 2 ? 1 : 0;
    return { goalId: goal.id, score: clampScore(base + offset) };
  });
}

function toRecordActionItems(specs: readonly SeedActionSpec[] | undefined): CounselingRecordActionItemInput[] {
  return (specs ?? []).map((spec) => (
    spec.dueDate === undefined
      ? { description: spec.description, owner: spec.owner }
      : { description: spec.description, owner: spec.owner, dueDate: spec.dueDate }
  ));
}

function toRecordFlags(flags: readonly SeedFlag[] | undefined): CounselingRecordFlagInput[] {
  return (flags ?? []).map((flag) => ({ flagType: flag.flagType, quote: flag.quote }));
}

function counselorActor(userId: string): Actor {
  return { userId, orgId: ORG_ID, role: 'counselor' };
}

export interface ScenarioSummary {
  participants: number;
  sessions: number;
  virtualCounselors: number;
}

/** 가상 상담사 3명을 한 번만 프로비저닝한다(admin actor, 고정 UUID). */
async function provisionVirtualCounselors(env: Env, adminActor: Actor, capture: D1Capture): Promise<void> {
  let step = 0;
  for (const counselor of VIRTUAL_COUNSELORS) {
    step += 1;
    capture.mark('setup', step);
    await upsertUser(env, adminActor, { email: counselor.email, role: 'counselor', userId: counselor.userId, name: counselor.displayName });
  }
}

async function runParticipant(
  env: Env,
  adminActor: Actor,
  capture: D1Capture,
  participant: SeedParticipant,
  index: number,
): Promise<number> {
  const participantId = `p${String(index + 1).padStart(2, '0')}`;
  let step = 0;
  const mark = (): void => {
    step += 1;
    capture.mark(participantId, step);
  };

  const primaryActor = counselorActor(participant.assigneeUserId);

  // 1) 참여자 + 초기 참여사업 등록(admin actor).
  mark();
  const creation = await createBeneficiaryWithInitialSupportCase(
    env,
    adminActor,
    {
      programType: FINANCIAL_SUPPORT_V1,
      intakeAt: participant.intakeAt,
      initialAssigneeUserId: participant.assigneeUserId,
      name: participant.name,
      phone: participant.phone,
      email: participant.email,
    },
    undefined,
    // G1: ① 개인정보 동의는 등록의 하드 게이트다. 시드는 가상 데이터라 동의를 받은 것으로 둔다.
    { privacy: true, recordingAi: participant.consent.recordingAi },
  );
  const { beneficiaryId, supportCaseId } = creation;

  // 2) 인테이크 일정 — 케이스 목표를 신설한다.
  mark();
  const intakeSchedule = await createCounselingSchedule(env, primaryActor, {
    beneficiaryId,
    supportCaseId,
    scheduledAt: participant.intakeAt,
    sessionKind: 'intake',
    channel: 'in_person',
    caseGoals: participant.goals.map((goal) => goal.title),
  });

  // 3) 목표 id 부트스트랩(title 매핑 — 동률 created_at 순서에 의존하지 않는다).
  mark();
  const goalRows = await listGoals(env, primaryActor, supportCaseId);
  const active: ActiveGoal[] = participant.goals.map((goal) => {
    const row = goalRows.find((candidate) => candidate.title === goal.title);
    if (row === undefined) {
      throw new Error(`[seed] ${participantId}: intake goal not found after creation: ${goal.title}`);
    }
    return { key: goal.key, id: row.id, title: goal.title };
  });

  const activeById = (key: string): string => {
    const found = active.find((goal) => goal.key === key);
    if (found === undefined) {
      throw new Error(`[seed] ${participantId}: goal link references inactive/unknown goal key: ${key}`);
    }
    return found.id;
  };

  const buildSessionGoals = (keys: readonly string[] | undefined): CreateScheduleSessionGoalInput[] | undefined => {
    if (keys === undefined || keys.length === 0) return undefined;
    return keys.map((key) => {
      const goal = active.find((candidate) => candidate.key === key);
      if (goal === undefined) {
        throw new Error(`[seed] ${participantId}: session goal link references inactive goal key: ${key}`);
      }
      return { body: `'${goal.title}' 진행 상황을 점검한다`, caseGoalId: goal.id };
    });
  };

  const applyReplacementAfter = async (sessionIndex: number): Promise<void> => {
    const replacement = participant.goalReplacement;
    if (replacement === undefined || replacement.afterSession !== sessionIndex) return;
    const target = active.find((goal) => goal.key === replacement.closeGoalKey);
    if (target === undefined) {
      throw new Error(`[seed] ${participantId}: replacement target not active: ${replacement.closeGoalKey}`);
    }
    mark();
    const result = await closeGoal(env, primaryActor, target.id, replacement.reason, {
      title: replacement.newGoal.title,
      scaleCriteria: replacement.newGoal.scaleCriteria,
    });
    if (result.successor === null) {
      throw new Error(`[seed] ${participantId}: closeGoal returned no successor`);
    }
    const successorId = result.successor.id;
    const slot = active.findIndex((goal) => goal.key === replacement.closeGoalKey);
    active[slot] = { key: replacement.newGoal.key, id: successorId, title: replacement.newGoal.title };
  };

  // 4) 인테이크 기록 — 인테이크 일정 완료 + 활성 목표 전부 채점.
  mark();
  await createCounselingRecord(env, primaryActor, supportCaseId, {
    submissionId: crypto.randomUUID(),
    heldAt: participant.intakeAt,
    channel: 'in_person',
    memo: participant.intakeMemo,
    gasScores: scoreActiveGoals(active, participant.trajectory, 0),
    actionItems: [],
    flags: [],
    scheduleId: intakeSchedule.id,
    expectedScheduleVersion: 1,
  });
  await applyReplacementAfter(0);

  // 5) 정기 회차.
  let sessions = 1; // 인테이크 1회 포함
  for (let r = 0; r < participant.regulars.length; r += 1) {
    const regular = participant.regulars[r]!;
    const sessionIndex = r + 1;

    mark();
    const schedule = await createCounselingSchedule(env, primaryActor, {
      beneficiaryId,
      supportCaseId,
      scheduledAt: regular.heldAt,
      sessionKind: 'regular',
      channel: 'in_person',
      sessionGoals: buildSessionGoals(regular.goalLinks),
      customQuestions: regular.customQuestions,
    });

    mark();
    await createCounselingRecord(env, primaryActor, supportCaseId, {
      submissionId: crypto.randomUUID(),
      heldAt: regular.heldAt,
      channel: 'in_person',
      memo: regular.memo,
      gasScores: scoreActiveGoals(active, participant.trajectory, sessionIndex),
      actionItems: toRecordActionItems(regular.actionItems),
      flags: toRecordFlags(regular.flags),
      scheduleId: schedule.id,
      expectedScheduleVersion: 1,
    });
    sessions += 1;

    await applyReplacementAfter(sessionIndex);
  }

  // 해결된 액션(createActionItem → resolveActionItem).
  for (const spec of participant.resolvedActions ?? []) {
    mark();
    const item = await createActionItem(env, primaryActor, supportCaseId, {
      description: spec.description,
      owner: spec.owner,
      dueDate: spec.dueDate,
    });
    mark();
    await resolveActionItem(env, primaryActor, item.id);
  }

  // 독립 confirmed 플래그(createFlag).
  if (participant.standaloneFlag !== undefined) {
    mark();
    await createFlag(env, primaryActor, supportCaseId, {
      flagType: participant.standaloneFlag.flagType,
      quote: participant.standaloneFlag.quote,
    });
  }

  // 6) 향후 일정(scheduled 로 남김).
  for (const future of participant.futureSchedules ?? []) {
    mark();
    await createCounselingSchedule(env, primaryActor, {
      beneficiaryId,
      supportCaseId,
      scheduledAt: future.scheduledAt,
      sessionKind: 'regular',
      channel: 'in_person',
      sessionGoals: buildSessionGoals(future.goalLinks),
      customQuestions: future.customQuestions,
    });
  }

  return sessions;
}

/** 전체 시드 시나리오를 순차 실행한다. */
export async function runScenario(env: Env, capture: D1Capture): Promise<ScenarioSummary> {
  const adminActor: Actor = { userId: ADMIN_ACTOR_ID, orgId: ORG_ID, role: 'admin' };
  await provisionVirtualCounselors(env, adminActor, capture);

  let sessions = 0;
  for (let index = 0; index < PARTICIPANTS.length; index += 1) {
    sessions += await runParticipant(env, adminActor, capture, PARTICIPANTS[index]!, index);
  }

  return {
    participants: PARTICIPANTS.length,
    sessions,
    virtualCounselors: VIRTUAL_COUNSELORS.length,
  };
}
