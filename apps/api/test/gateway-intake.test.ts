import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
  type CreateIntakeRecordInput,
  createBeneficiaryWithInitialSupportCase,
  createCounselingSchedule,
  createIntakeRecord,
  updateIntakeRecord,
  getIntakeRecordContext,
  getNextCounselingScheduleForSupportCase,
  getParticipantBasicInfo,
  updateParticipantPii,
  listCounselingRecords,
  listGoals,
  processParticipantPiiRetention,
  purgeParticipantPii,
} from '../../../db/gateway';
import { setupD1 } from './support/d1';

const t = setupD1();

const canonicalActors = {
  counselor: { userId: 'user-counselor-1', orgId: 'org_demo', role: 'counselor' as const },
  secondCounselor: { userId: 'user-counselor-2', orgId: 'org_demo', role: 'counselor' as const },
  admin: { userId: 'user-admin-1', orgId: 'org_demo', role: 'admin' as const },
};

async function seedCanonicalDirectory(): Promise<void> {
  await t.db.prepare(
    `INSERT INTO users (id, org_id, email, role, active, time_zone) VALUES
       (?, ?, 'canonical-counselor-1@example.invalid', 'counselor', 1, NULL),
       (?, ?, 'canonical-counselor-2@example.invalid', 'counselor', 1, NULL),
       (?, ?, 'canonical-admin-1@example.invalid', 'admin', 1, NULL)`,
  ).bind(
    canonicalActors.counselor.userId,
    canonicalActors.counselor.orgId,
    canonicalActors.secondCounselor.userId,
    canonicalActors.secondCounselor.orgId,
    canonicalActors.admin.userId,
    canonicalActors.admin.orgId,
  ).run();
}

const FULL_LIFE_AREAS: NonNullable<CreateIntakeRecordInput['lifeAreas']> = [
  { areaKey: 'economy', status: 'crisis', note: 'DEBT_SPIKE' },
  { areaKey: 'housing', status: 'okay' },
  { areaKey: 'employment', status: 'strained' },
  { areaKey: 'health', status: 'okay' },
  { areaKey: 'mental_health', status: 'declined' },
  { areaKey: 'family', status: 'not_applicable' },
];

function intakeInput(overrides: Partial<CreateIntakeRecordInput> = {}): CreateIntakeRecordInput {
  return {
    submissionId: '01000000-0000-4000-8000-0000000000a1',
    heldAt: '2026-07-15T10:00:00.000Z',
    channel: 'in_person',
    consent: { privacy: true, recordingAi: true },
    helpNarrative: {
      todayHelp: '생계비 지원 상담을 받고 싶어요',
      hardestPoint: '이번 달 월세가 밀렸습니다',
      desiredChange: '안정적으로 지낼 수 있으면 좋겠어요',
    },
    lifeAreas: FULL_LIFE_AREAS,
    goals: [{ title: '3개월 내 월세 체납 해소', scaleCriteria: { minus2: '체납 증가', plus2: '완납' } }],
    actionItems: [{ description: '주거 급여 신청 서류 준비', owner: 'beneficiary' }],
    ...overrides,
  };
}

async function seedCase() {
  await seedCanonicalDirectory();
  return createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
    programType: 'financial_support_v1',
    intakeAt: '2026-07-15T09:00:00.000Z',
  });
}

describe('createIntakeRecord', () => {
  it('atomically stores the intake session, goals, actions, six-area baseline, and consent', async () => {
    await t.reset();
    const initial = await seedCase();

    const result = await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput());
    expect(result.replayed).toBe(false);
    expect(result.record.kind).toBe('intake');

    // Session row is kind='intake' with the help narrative isolated in intake_details (not memo).
    const session = await t.db.prepare(
      'SELECT kind, memo, intake_details FROM sessions WHERE id = ?',
    ).bind(result.record.id).first<{ kind: string; memo: string | null; intake_details: string | null }>();
    expect(session?.kind).toBe('intake');
    expect(session?.memo).toBeNull();
    expect(JSON.parse(session?.intake_details ?? '{}').helpNarrative.todayHelp).toBe('생계비 지원 상담을 받고 싶어요');

    // One goal created with GAS baseline.
    const goals = await listGoals(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(goals).toHaveLength(1);
    expect(goals[0]?.title).toBe('3개월 내 월세 체납 해소');

    // Six-area baseline snapshot: all six recorded directly (no copy).
    await expect(t.db.prepare(
      'SELECT COUNT(*) AS count FROM session_life_area_snapshots WHERE session_id = ?',
    ).bind(result.record.id).first<{ count: number }>()).resolves.toEqual({ count: 6 });

    // Action item persisted and open.
    await expect(t.db.prepare(
      'SELECT COUNT(*) AS count FROM action_items WHERE session_id = ? AND resolved_at IS NULL',
    ).bind(result.record.id).first<{ count: number }>()).resolves.toEqual({ count: 1 });

    // Consent row: privacy + recordingAi(두 컬럼 동시, D49) all bound to recorded_at.
    const consent = await t.db.prepare(
      `SELECT consent_privacy_at, consent_recording_at, consent_text_ai_at, recorded_at
       FROM participant_consent_records WHERE support_case_id = ?
       ORDER BY recorded_at DESC LIMIT 1`,
    ).bind(initial.supportCaseId).first<{
      consent_privacy_at: string; consent_recording_at: string; consent_text_ai_at: string; recorded_at: string;
    }>();
    expect(consent?.consent_privacy_at).toBe(consent?.recorded_at);
    expect(consent?.consent_recording_at).toBe(consent?.recorded_at);
    expect(consent?.consent_text_ai_at).toBe(consent?.recorded_at);
  });

  it('exposes kind=intake in the records list', async () => {
    await t.reset();
    const initial = await seedCase();
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput());
    const records = await listCounselingRecords(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(records).toHaveLength(1);
    expect(records[0]?.kind).toBe('intake');
  });

  // CCC-56: intake_at 은 "인테이크 완료 시각"이다 — 등록이 아니라 인테이크 기록 저장이 채우고,
  // 상담일을 고치면 따라간다.
  it('registration leaves intake_at NULL until the intake record fills it with held_at (CCC-56)', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
    });
    const beforeIntake = await t.db.prepare(
      'SELECT intake_at FROM support_cases WHERE id = ?',
    ).bind(initial.supportCaseId).first<{ intake_at: string | null }>();
    expect(beforeIntake?.intake_at).toBeNull();

    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput());
    const afterIntake = await t.db.prepare(
      'SELECT intake_at FROM support_cases WHERE id = ?',
    ).bind(initial.supportCaseId).first<{ intake_at: string | null }>();
    expect(afterIntake?.intake_at).toBe('2026-07-15T10:00:00.000Z');
  });

  it('overrides a harness-provided creation intakeAt with the real held_at (CCC-56)', async () => {
    await t.reset();
    const initial = await seedCase(); // 하네스가 등록 시점에 09:00 을 싣는다(선택 인자).
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput());
    const row = await t.db.prepare(
      'SELECT intake_at FROM support_cases WHERE id = ?',
    ).bind(initial.supportCaseId).first<{ intake_at: string | null }>();
    expect(row?.intake_at).toBe('2026-07-15T10:00:00.000Z');
  });

  it('keeps intake_at in sync when the intake edit changes the held date (CCC-56)', async () => {
    await t.reset();
    const initial = await seedCase();
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput());

    await updateIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, {
      heldAt: '2026-07-20T14:00:00.000Z',
      channel: 'phone',
    });
    const row = await t.db.prepare(
      'SELECT intake_at FROM support_cases WHERE id = ?',
    ).bind(initial.supportCaseId).first<{ intake_at: string | null }>();
    expect(row?.intake_at).toBe('2026-07-20T14:00:00.000Z');
  });

  it('rechecks the practitioner role inside the intake mutation batch', async () => {
    await t.reset();
    const initial = await seedCase();
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput());
    let intercepted = false;
    const raceDb = new Proxy(t.db, {
      get(target, property, receiver) {
        if (property === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            if (!intercepted) {
              intercepted = true;
              await target.prepare(
                `UPDATE user_role_assignments SET revoked_at = datetime('now')
                 WHERE org_id = ? AND user_id = ? AND role = 'practitioner' AND revoked_at IS NULL`,
              ).bind(
                canonicalActors.counselor.orgId,
                canonicalActors.counselor.userId,
              ).run();
            }
            return target.batch(statements);
          };
        }
        const value: unknown = Reflect.get(target, property, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1Database;

    await expect(updateIntakeRecord(
      { ...t.env, DB: raceDb },
      canonicalActors.counselor,
      initial.supportCaseId,
      {
        heldAt: '2026-07-22T14:00:00.000Z',
        channel: 'phone',
      },
    )).rejects.toBeInstanceOf(ConflictError);
    await expect(t.db.prepare(
      'SELECT held_at FROM sessions WHERE support_case_id = ? AND kind = ?',
    ).bind(initial.supportCaseId, 'intake').first<{ held_at: string }>())
      .resolves.toEqual({ held_at: '2026-07-15T10:00:00.000Z' });
  });

  it('does not accept a requested assignment in the intake mutation batch', async () => {
    await t.reset();
    const initial = await seedCase();
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput());
    let intercepted = false;
    const raceDb = new Proxy(t.db, {
      get(target, property, receiver) {
        if (property === 'batch') {
          return async (statements: D1PreparedStatement[]) => {
            if (!intercepted) {
              intercepted = true;
              await target.prepare(
                `UPDATE support_case_assignees
                 SET status = 'ended', unassigned_at = datetime('now')
                 WHERE org_id = ? AND support_case_id = ? AND user_id = ? AND status = 'active'`,
              ).bind(
                canonicalActors.counselor.orgId,
                initial.supportCaseId,
                canonicalActors.counselor.userId,
              ).run();
              await target.prepare(
                `INSERT INTO support_case_assignees (
                   id, org_id, support_case_id, user_id, role, status,
                   acceptance_requested_by, assigned_at
                 ) VALUES (?, ?, ?, ?, 'primary', 'requested', ?, datetime('now'))`,
              ).bind(
                'requested-assignment-intake-race',
                canonicalActors.counselor.orgId,
                initial.supportCaseId,
                canonicalActors.counselor.userId,
                canonicalActors.admin.userId,
              ).run();
            }
            return target.batch(statements);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    }) as D1Database;

    await expect(updateIntakeRecord(
      { ...t.env, DB: raceDb },
      canonicalActors.counselor,
      initial.supportCaseId,
      {
        heldAt: '2026-07-22T14:00:00.000Z',
        channel: 'phone',
      },
    )).rejects.toBeInstanceOf(ConflictError);
    await expect(t.db.prepare(
      'SELECT held_at FROM sessions WHERE support_case_id = ? AND kind = ?',
    ).bind(initial.supportCaseId, 'intake').first<{ held_at: string }>())
      .resolves.toEqual({ held_at: '2026-07-15T10:00:00.000Z' });
  });

  it('does not move intake_at when an unassigned counselor attempts the edit (CCC-56)', async () => {
    await t.reset();
    const initial = await seedCase();
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput());

    await expect(updateIntakeRecord(t.env, canonicalActors.secondCounselor, initial.supportCaseId, {
      heldAt: '2026-07-21T09:00:00.000Z',
      channel: 'in_person',
    })).rejects.toBeInstanceOf(ForbiddenError);
    const row = await t.db.prepare(
      'SELECT intake_at FROM support_cases WHERE id = ?',
    ).bind(initial.supportCaseId).first<{ intake_at: string | null }>();
    expect(row?.intake_at).toBe('2026-07-15T10:00:00.000Z');
  });

  it('records audit rows for the session, each goal, and the consent', async () => {
    await t.reset();
    const initial = await seedCase();
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      goals: [{ title: '목표 A' }, { title: '목표 B' }],
    }));
    const audits = await t.db.prepare(
      `SELECT action, target_table FROM audit_log
       WHERE support_case_id = ? AND action IN ('submit_manual_record', 'create', 'record_consent')`,
    ).bind(initial.supportCaseId).all<{ action: string; target_table: string }>();
    const actions = audits.results.map((row) => `${row.action}:${row.target_table}`);
    expect(actions).toContain('submit_manual_record:sessions');
    expect(actions).toContain('record_consent:participant_consent_records');
    expect(actions.filter((entry) => entry === 'create:goals')).toHaveLength(2);
  });

  it('replays an identical resubmission without duplicating rows', async () => {
    await t.reset();
    const initial = await seedCase();
    const first = await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput());
    const replay = await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput());
    expect(replay).toMatchObject({ replayed: true, record: { id: first.record.id } });
    await expect(t.db.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE support_case_id = ? AND kind = 'intake'",
    ).bind(initial.supportCaseId).first<{ count: number }>()).resolves.toEqual({ count: 1 });
    await expect(t.db.prepare(
      'SELECT COUNT(*) AS count FROM goals WHERE support_case_id = ?',
    ).bind(initial.supportCaseId).first<{ count: number }>()).resolves.toEqual({ count: 1 });
  });

  it('rejects a second intake with a new submission id (one intake per case)', async () => {
    await t.reset();
    const initial = await seedCase();
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput());
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      submissionId: '01000000-0000-4000-8000-0000000000b2',
    }))).rejects.toBeInstanceOf(ConflictError);
    // Atomicity: the rejected second attempt left nothing behind.
    await expect(t.db.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE support_case_id = ? AND kind = 'intake'",
    ).bind(initial.supportCaseId).first<{ count: number }>()).resolves.toEqual({ count: 1 });
  });

  it('rejects when either consent check is unchecked', async () => {
    await t.reset();
    const initial = await seedCase();
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      consent: { privacy: false, recordingAi: true },
    }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      consent: { privacy: true, recordingAi: false },
    }))).rejects.toBeInstanceOf(ValidationError);
    await expect(t.db.prepare(
      'SELECT COUNT(*) AS count FROM sessions WHERE support_case_id = ?',
    ).bind(initial.supportCaseId).first<{ count: number }>()).resolves.toEqual({ count: 0 });
  });

  it('rejects missing P1: no goal, no action, blank narrative, or an omitted life area', async () => {
    await t.reset();
    const initial = await seedCase();
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      goals: [],
    }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      actionItems: [],
    }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      helpNarrative: { todayHelp: '  ', hardestPoint: 'x', desiredChange: 'y' },
    }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      lifeAreas: FULL_LIFE_AREAS.slice(0, 5),
    }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects more than three goals (D12 active-goal cap)', async () => {
    await t.reset();
    const initial = await seedCase();
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      goals: [{ title: 'g1' }, { title: 'g2' }, { title: 'g3' }, { title: 'g4' }],
    }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('denies a counselor who is not assigned to the case', async () => {
    await t.reset();
    const initial = await seedCase();
    await expect(createIntakeRecord(t.env, canonicalActors.secondCounselor, initial.supportCaseId, intakeInput()))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  // CCC-57 완료 기준: 인테이크를 저장하면 그 약속이 예정 목록에서 실제로 내려가야 한다.
  // 페이로드가 id 를 실었는지가 아니라 일정 행이 완료로 바뀌었는지를 본다.
  it('completes the linked appointment and takes it off the scheduled list', async () => {
    await t.reset();
    const initial = await seedCase();
    const schedule = await createCounselingSchedule(t.env, canonicalActors.counselor, {
      beneficiaryId: initial.beneficiaryId,
      supportCaseId: initial.supportCaseId,
      scheduledAt: '2026-07-15T10:00:00.000Z',
    });

    const result = await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      scheduleId: schedule.id,
      expectedScheduleVersion: schedule.version,
    }));

    const row = await t.db.prepare(
      'SELECT status, completed_session_id FROM counseling_schedules WHERE id = ?',
    ).bind(schedule.id).first<{ status: string; completed_session_id: string | null }>();
    expect(row?.status).toBe('completed');
    expect(row?.completed_session_id).toBe(result.record.id);
    // 예정 목록에서 사라진다. '유령 예정 일정'이 남지 않는 것이 이 티켓의 목적이다.
    await expect(getNextCounselingScheduleForSupportCase(
      t.env,
      canonicalActors.counselor,
      initial.supportCaseId,
    )).resolves.toBeNull();
  });

  // 버전 검사 유지(티켓 지시). 어긋나면 기록 자체가 서지 않는다. 일정만 조용히 넘어가거나
  // 기록만 남는 반쪽 상태를 막으려는 설계다.
  it('refuses the whole save when the appointment version moved', async () => {
    await t.reset();
    const initial = await seedCase();
    const schedule = await createCounselingSchedule(t.env, canonicalActors.counselor, {
      beneficiaryId: initial.beneficiaryId,
      supportCaseId: initial.supportCaseId,
      scheduledAt: '2026-07-15T10:00:00.000Z',
    });

    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      scheduleId: schedule.id,
      expectedScheduleVersion: schedule.version + 1,
    }))).rejects.toBeInstanceOf(ConflictError);

    await expect(t.db.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE support_case_id = ? AND kind = 'intake'",
    ).bind(initial.supportCaseId).first<{ count: number }>()).resolves.toEqual({ count: 0 });
  });
});

describe('getIntakeRecordContext', () => {
  it('reports hasIntake and increments the session sequence', async () => {
    await t.reset();
    const initial = await seedCase();
    const before = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(before.hasIntake).toBe(false);
    expect(before.sessionSequence).toBe(1);

    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput());
    const after = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(after.hasIntake).toBe(true);
    expect(after.sessionSequence).toBe(2);
  });

  // CCC-57: 위저드가 연결 일정을 완료로 넘기려면 이 컨텍스트가 id·version 을 실어 줘야 한다.
  // 그 배선이 없어서 인테이크를 마쳐도 약속이 계속 '예정'으로 남아 있었다.
  it('carries the next scheduled appointment, and null when there is none', async () => {
    await t.reset();
    const initial = await seedCase();

    const withoutSchedule = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(withoutSchedule.schedule).toBeNull();

    const schedule = await createCounselingSchedule(t.env, canonicalActors.counselor, {
      beneficiaryId: initial.beneficiaryId,
      supportCaseId: initial.supportCaseId,
      scheduledAt: '2026-07-20T01:00:00.000Z',
    });
    const context = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(context.schedule).toMatchObject({
      id: schedule.id,
      version: schedule.version,
      status: 'scheduled',
      supportCaseId: initial.supportCaseId,
    });
  });

  // 예정 건이 여럿이면 getNextCounselingScheduleForSupportCase 와 같은 것을 고른다
  // (scheduled_at 이 이른 순). 두 함수가 다른 일정을 가리키면 화면마다 말이 갈린다.
  it('picks the same appointment as getNextCounselingScheduleForSupportCase', async () => {
    await t.reset();
    const initial = await seedCase();
    const later = await createCounselingSchedule(t.env, canonicalActors.counselor, {
      beneficiaryId: initial.beneficiaryId,
      supportCaseId: initial.supportCaseId,
      scheduledAt: '2026-08-01T01:00:00.000Z',
    });
    const earlier = await createCounselingSchedule(t.env, canonicalActors.counselor, {
      beneficiaryId: initial.beneficiaryId,
      supportCaseId: initial.supportCaseId,
      scheduledAt: '2026-07-20T01:00:00.000Z',
    });

    const context = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    const next = await getNextCounselingScheduleForSupportCase(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(context.schedule?.id).toBe(earlier.id);
    expect(context.schedule?.id).toBe(next?.id);
    expect(context.schedule?.id).not.toBe(later.id);
  });

  it('denies an unassigned counselor', async () => {
    await t.reset();
    const initial = await seedCase();
    await expect(getIntakeRecordContext(t.env, canonicalActors.secondCounselor, initial.supportCaseId))
      .rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ============================================================================
// CCC-9 — 설계 v0.3 나머지 항목(P2~P4)
// ============================================================================

const EXTENDED_PII: NonNullable<CreateIntakeRecordInput['extendedPii']> = {
  birthDate: '1984-03-11',
  region: '서울특별시 관악구',
  emergencyContact: '010-2222-3333',
  gender: '여성',
};

describe('intake extended PII (migration 0015)', () => {
  it('round-trips every extended field through the vault: ciphertext at rest, plaintext on read', async () => {
    await t.reset();
    const initial = await seedCase();
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      extendedPii: EXTENDED_PII,
    }));

    // (a) 저장된 컬럼은 평문이 아니다 — 암호화가 통째로 우회되면 여기서 걸린다.
    const stored = await t.db.prepare(
      `SELECT enc_birth_date, enc_region, enc_emergency_contact, enc_gender
       FROM participant_pii_vault WHERE beneficiary_id = ?`,
    ).bind(initial.beneficiaryId).first<{
      enc_birth_date: string | null; enc_region: string | null;
      enc_emergency_contact: string | null; enc_gender: string | null;
    }>();
    expect(stored?.enc_birth_date).not.toBeNull();
    expect(stored?.enc_birth_date).not.toBe(EXTENDED_PII.birthDate);
    expect(stored?.enc_region).not.toBe(EXTENDED_PII.region);
    expect(stored?.enc_emergency_contact).not.toBe(EXTENDED_PII.emergencyContact);
    expect(stored?.enc_gender).not.toBe(EXTENDED_PII.gender);

    // (b) 복호화 조회는 평문 원본과 정확히 같다.
    const context = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(context.extendedPii).toEqual({
      birthDate: '1984-03-11',
      region: '서울특별시 관악구',
      emergencyContact: '010-2222-3333',
      gender: '여성',
    });

    // (c) 화면 조회 1회 = 감사 1행(D24·ADR-0005). 추가 금고 항목을 함께 실었어도 행을
    //     나누지 않고 같은 read_participant_pii 행의 fields 에 합친다(2026-07-25 Q 결정).
    //     detail 에는 필드 이름만 담긴다 — 값 금지.
    const rows = await t.db.prepare(
      `SELECT action, detail FROM audit_log
       WHERE target_table = 'participant_pii_vault' AND beneficiary_id = ?
         AND action IN ('read_participant_pii', 'decrypt_pii')
       ORDER BY id DESC LIMIT 2`,
    ).bind(initial.beneficiaryId).all<{ action: string; detail: string | null }>();
    const latest = rows.results[0];
    expect(latest?.action).toBe('read_participant_pii');
    const detail = JSON.parse(latest?.detail ?? '{}');
    expect(detail.fields).toEqual(['name', 'phone', 'birthDate', 'region', 'emergencyContact', 'gender']);
    expect(latest?.detail).not.toContain('1984-03-11');
    expect(latest?.detail).not.toContain('010-2222-3333');
    // 이 당사자에 대해 decrypt_pii 행이 아예 생기지 않는다 — 생기면 열람 횟수를 셀 수 없다.
    const split = await t.db.prepare(
      `SELECT COUNT(*) AS n FROM audit_log
       WHERE action = 'decrypt_pii' AND target_table = 'participant_pii_vault' AND beneficiary_id = ?`,
    ).bind(initial.beneficiaryId).first<{ n: number }>();
    expect(Number(split?.n ?? 0)).toBe(0);
  });

  it('never writes name, phone, account, or email through the intake path', async () => {
    await t.reset();
    const initial = await seedCase();
    const before = await t.db.prepare(
      'SELECT enc_name, enc_phone, enc_account, enc_email FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(initial.beneficiaryId).first<Record<string, string | null>>();
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      extendedPii: EXTENDED_PII,
    }));
    const after = await t.db.prepare(
      'SELECT enc_name, enc_phone, enc_account, enc_email FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(initial.beneficiaryId).first<Record<string, string | null>>();
    expect(after).toEqual(before);
  });

  it('writes an update audit naming only the supplied fields', async () => {
    await t.reset();
    const initial = await seedCase();
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      extendedPii: { birthDate: '1990-01-02' },
    }));
    const audit = await t.db.prepare(
      `SELECT detail FROM audit_log
       WHERE action = 'update' AND target_table = 'participant_pii_vault' AND beneficiary_id = ?
       ORDER BY id DESC LIMIT 1`,
    ).bind(initial.beneficiaryId).first<{ detail: string | null }>();
    expect(JSON.parse(audit?.detail ?? '{}')).toMatchObject({ fields: ['birthDate'], kind: 'intake' });
    const context = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(context.extendedPii).toEqual({
      birthDate: '1990-01-02', region: null, emergencyContact: null, gender: null,
    });
  });

  it('clears the extended columns when the vault is purged (D10)', async () => {
    await t.reset();
    const initial = await seedCase();
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      extendedPii: EXTENDED_PII,
    }));
    await t.db.prepare(
      `UPDATE support_cases
       SET status = 'closed', closed_at = ?, closed_reason = ?, closed_by_actor_id = ?, updated_at = ?
       WHERE id = ? AND status = 'active'`,
    ).bind(
      '2020-01-01 00:00:00',
      'program complete',
      canonicalActors.counselor.userId,
      '2020-01-01 00:00:00',
      initial.supportCaseId,
    ).run();
    await processParticipantPiiRetention(t.env);
    await expect(purgeParticipantPii(
      { ...t.env, PII_PURGE_ENABLED: '1' },
      canonicalActors.admin,
      initial.beneficiaryId,
    ))
      .resolves.toEqual({ beneficiaryId: initial.beneficiaryId, purged: true });
    await expect(t.db.prepare(
      `SELECT enc_birth_date, enc_region, enc_emergency_contact, enc_gender
       FROM participant_pii_vault WHERE beneficiary_id = ?`,
    ).bind(initial.beneficiaryId).first()).resolves.toEqual({
      enc_birth_date: null, enc_region: null, enc_emergency_contact: null, enc_gender: null,
    });
  });

  it('rejects an empty patch and a malformed birth date', async () => {
    await t.reset();
    const initial = await seedCase();
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      extendedPii: {},
    }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      extendedPii: { birthDate: '1984/03/11' },
    }))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('intake P3/P4 answers, additional items, and next meeting', () => {
  it('stores answers with declined/unknown/not_applicable distinguishable from blank text', async () => {
    await t.reset();
    const initial = await seedCase();
    const result = await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      answers: [
        { key: 'more_since', response: 'answered', text: '작년 겨울부터' },
        { key: 'crisis_immediate_risk', response: 'declined' },
        { key: 'strength_personal', response: 'unknown' },
        { key: 'participation_transport', response: 'not_applicable' },
        { key: 'life_detail_economy', response: 'answered', text: '카드 대금 연체 2개월' },
      ],
      additionalItems: [{ item: '임대차 계약서 사본', owner: '당사자', dueDate: '2026-08-01' }],
      nextMeeting: { heldAt: '2026-08-05T01:00:00.000Z', channel: 'in_person' },
    }));

    const session = await t.db.prepare('SELECT intake_details FROM sessions WHERE id = ?')
      .bind(result.record.id).first<{ intake_details: string | null }>();
    const details = JSON.parse(session?.intake_details ?? '{}');
    expect(details.answers).toHaveLength(5);
    expect(details.answers).toContainEqual({ key: 'crisis_immediate_risk', response: 'declined' });
    expect(details.answers).toContainEqual({ key: 'more_since', response: 'answered', text: '작년 겨울부터' });
    expect(details.additionalItems).toEqual([
      { item: '임대차 계약서 사본', owner: '당사자', dueDate: '2026-08-01' },
    ]);
    expect(details.nextMeeting).toEqual({ heldAt: '2026-08-05T01:00:00.000Z', channel: 'in_person' });
  });

  it('rejects unknown keys, duplicates, and text on a non-answered response', async () => {
    await t.reset();
    const initial = await seedCase();
    for (const answers of [
      [{ key: 'not_a_real_question', response: 'answered', text: 'x' }],
      [{ key: 'more_since', response: 'answered', text: 'a' }, { key: 'more_since', response: 'declined' }],
      [{ key: 'more_since', response: 'declined', text: '적으면 안 됨' }],
      [{ key: 'more_since', response: 'answered' }],
    ] as unknown as Array<NonNullable<CreateIntakeRecordInput['answers']>>) {
      await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
        answers,
      }))).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('gives different submission hashes to submissions that differ only in P3/P4 content', async () => {
    await t.reset();
    const initial = await seedCase();
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      answers: [{ key: 'more_since', response: 'answered', text: '첫 번째 내용' }],
    }));
    // 같은 submissionId 인데 내용이 다르면 재현이 아니라 충돌이어야 한다 — 조용히 버려지면 안 된다.
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, intakeInput({
      answers: [{ key: 'more_since', response: 'answered', text: '다른 내용' }],
    }))).rejects.toBeInstanceOf(ConflictError);
  });
});

// ============================================================================
// D41·D42 — 정본 질문지 4단계 화면이 보내는 모양
// 화면은 동의·원하는 도움 3문·6영역·목표·다음 행동을 보내지 않는다. 게이트웨이가 그 5종을
// 선택으로 받는지, 그리고 안 보냈을 때 목표·동의 기록이 만들어지지 않는지 고정한다.
// ============================================================================

/** 4단계 위저드가 실제로 보내는 최소 페이로드(질문지 답변 + 반복 행 표). */
function questionnaireInput(overrides: Partial<CreateIntakeRecordInput> = {}): CreateIntakeRecordInput {
  return {
    submissionId: '01000000-0000-4000-8000-0000000000b1',
    heldAt: '2026-07-15T10:00:00.000Z',
    channel: 'in_person',
    answers: [
      { key: 'welfare_basic_livelihood', response: 'answered', text: '수급 중' },
      // 정본의 '무응답'은 새 코드가 아니라 기존 어휘 재사용이다(빈칸과 구분되어 저장).
      { key: 'welfare_benefit_type', response: 'unknown' },
      { key: 'summary_urgency', response: 'answered', text: '즉시 개입 필요' },
    ],
    debts: [{ creditor: 'OO은행', balance: '1,200만원' }],
    linkedOrgs: [{ orgName: 'OO구 주민센터', progressStatus: '심사 중' }],
    additionalItems: [{ item: '전체 채무 잔액', reason: '채무조정 가능성 판단', dueNote: '다음 상담 전' }],
    managerOpinion: '채무 연체와 주거불안이 동시에 있어 우선순위가 높음',
    ...overrides,
  };
}

describe('intake questionnaire form (D41 · D42)', () => {
  it('saves without consent, help narrative, life areas, goals, or action items', async () => {
    await t.reset();
    const initial = await seedCase();

    const result = await createIntakeRecord(
      t.env, canonicalActors.counselor, initial.supportCaseId, questionnaireInput(),
    );
    expect(result.replayed).toBe(false);
    expect(result.record.kind).toBe('intake');

    // 목표 입력이 없으므로 목표가 생기지 않는다(D42 ③ · D43 GAS 보류).
    expect(await listGoals(t.env, canonicalActors.counselor, initial.supportCaseId)).toHaveLength(0);

    // 동의를 받지 않았으므로 인테이크가 동의 기록을 대신 남기지 않는다(D42 ②).
    const consentRows = await t.db.prepare(
      'SELECT COUNT(*) AS n FROM participant_consent_records WHERE support_case_id = ?',
    ).bind(initial.supportCaseId).first<{ n: number }>();
    expect(Number(consentRows?.n ?? 0)).toBe(0);

    // 6영역 스냅샷·액션도 만들어지지 않는다.
    const snapshots = await t.db.prepare(
      'SELECT COUNT(*) AS n FROM session_life_area_snapshots WHERE session_id = ?',
    ).bind(result.record.id).first<{ n: number }>();
    expect(Number(snapshots?.n ?? 0)).toBe(0);
    const actions = await t.db.prepare(
      'SELECT COUNT(*) AS n FROM action_items WHERE session_id = ?',
    ).bind(result.record.id).first<{ n: number }>();
    expect(Number(actions?.n ?? 0)).toBe(0);
  });

  it('keeps questionnaire answers and both row tables in the isolated intake JSON', async () => {
    await t.reset();
    const initial = await seedCase();
    const result = await createIntakeRecord(
      t.env, canonicalActors.counselor, initial.supportCaseId, questionnaireInput(),
    );

    const row = await t.db.prepare('SELECT intake_details FROM sessions WHERE id = ?')
      .bind(result.record.id).first<{ intake_details: string }>();
    const details = JSON.parse(row?.intake_details ?? '{}');
    expect(details.answers).toContainEqual({ key: 'welfare_benefit_type', response: 'unknown' });
    // 긴급도는 실무자가 고른 값 그대로다 — AI 제안·자동값이 아니다(R5).
    expect(details.answers).toContainEqual({ key: 'summary_urgency', response: 'answered', text: '즉시 개입 필요' });
    expect(details.debts).toEqual([{ creditor: 'OO은행', balance: '1,200만원' }]);
    expect(details.linkedOrgs).toEqual([{ orgName: 'OO구 주민센터', progressStatus: '심사 중' }]);
    expect(details.additionalItems).toEqual([
      { item: '전체 채무 잔액', reason: '채무조정 가능성 판단', dueNote: '다음 상담 전' },
    ]);
    expect(details.helpNarrative).toBeNull();
  });

  it('gives different submission hashes to submissions that differ only in the row tables', async () => {
    await t.reset();
    const initial = await seedCase();
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, questionnaireInput());
    // 해시가 새 필드를 덮지 않으면 두 번째 제출이 재현으로 조용히 버려진다.
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, questionnaireInput({
      debts: [{ creditor: '다른 은행' }],
    }))).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects a row whose required first column is blank', async () => {
    await t.reset();
    const initial = await seedCase();
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, questionnaireInput({
      debts: [{ creditor: '   ' }],
    }))).rejects.toBeInstanceOf(ValidationError);
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, questionnaireInput({
      linkedOrgs: [{ orgName: 'OO센터', serviceName: '' }],
    }))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('participant registration stores the 1-1 basic information (D41 · D42)', () => {
  it('encrypts birth date, region, and gender at registration and shows them on the intake screen', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
      name: '홍서희',
      phone: '010-1234-5678',
      birthDate: '1984-03-11',
      region: '서울시 은평구',
      gender: '여성',
    });

    const stored = await t.db.prepare(
      'SELECT enc_birth_date, enc_region, enc_gender FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(initial.beneficiaryId).first<{
      enc_birth_date: string | null; enc_region: string | null; enc_gender: string | null;
    }>();
    expect(stored?.enc_birth_date).not.toBeNull();
    expect(stored?.enc_birth_date).not.toBe('1984-03-11');
    expect(stored?.enc_region).not.toBe('서울시 은평구');
    expect(stored?.enc_gender).not.toBe('여성');

    const context = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(context.extendedPii.birthDate).toBe('1984-03-11');
    expect(context.extendedPii.region).toBe('서울시 은평구');
    expect(context.extendedPii.gender).toBe('여성');
    expect(context.participant.name).toBe('홍서희');
  });

  it('reports consent status for the read-only first step', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    // ① 이 비어 있는 케이스는 이제 긴급 등록으로만 생긴다(G1) — 인테이크 1단계는 그 상태도 읽어야 한다.
    const withoutConsent = await createBeneficiaryWithInitialSupportCase(
      t.env,
      canonicalActors.counselor,
      { programType: 'financial_support_v1', intakeAt: '2026-07-15T09:00:00.000Z' },
      undefined,
      { privacy: false, recordingAi: false, emergency: { reason: '위기 개입' } },
    );
    const before = await getIntakeRecordContext(t.env, canonicalActors.counselor, withoutConsent.supportCaseId);
    expect(before.consent).toEqual({ privacy: false, recordingAi: false });

    const withConsent = await createBeneficiaryWithInitialSupportCase(
      t.env,
      canonicalActors.counselor,
      { programType: 'financial_support_v1', intakeAt: '2026-07-15T09:00:00.000Z' },
      undefined,
      { privacy: true, recordingAi: true },
    );
    const after = await getIntakeRecordContext(t.env, canonicalActors.counselor, withConsent.supportCaseId);
    expect(after.consent.recordingAi).toBe(true);
    expect(after.consent.privacy).toBe(true);

    const withPrivacy = await createBeneficiaryWithInitialSupportCase(
      t.env,
      canonicalActors.counselor,
      { programType: 'financial_support_v1', intakeAt: '2026-07-15T09:00:00.000Z' },
      undefined,
      { privacy: true, recordingAi: false },
    );
    const privacyContext = await getIntakeRecordContext(t.env, canonicalActors.counselor, withPrivacy.supportCaseId);
    expect(privacyContext.consent).toEqual({ privacy: true, recordingAi: false });
  });
});

describe('updateParticipantPii covers the 1-1 basic information (D42 ①)', () => {
  it('lets an admin fix birth date, region, and gender after registration', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });

    // 인테이크 화면이 표시 전용이 된 뒤로 이미 등록된 당사자를 고칠 길은 이 함수뿐이다.
    await updateParticipantPii(t.env, canonicalActors.admin, initial.beneficiaryId, {
      supportCaseContextId: initial.supportCaseId,
      expectedVersion: 1,
      birthDate: '1984-03-11',
      region: '서울시 은평구',
      gender: '여성',
    });

    const context = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(context.extendedPii.birthDate).toBe('1984-03-11');
    expect(context.extendedPii.region).toBe('서울시 은평구');
    expect(context.extendedPii.gender).toBe('여성');

    // 감사 detail 에는 필드 이름만 남는다 — 값 금지(D14).
    const audit = await t.db.prepare(
      `SELECT detail FROM audit_log
       WHERE target_table = 'participant_pii_vault' AND action = 'update' AND beneficiary_id = ?
       ORDER BY id DESC LIMIT 1`,
    ).bind(initial.beneficiaryId).first<{ detail: string | null }>();
    expect(JSON.parse(audit?.detail ?? '{}').fields).toEqual(['birthDate', 'region', 'gender']);
    expect(audit?.detail).not.toContain('1984-03-11');
  });

  // CCC-37: 권한 층을 admin 에서 "담당 실무자 또는 기관 관리자"로 열었다. 근거는 등록
  // (createBeneficiaryWithInitialSupportCase)이 이미 counselor 에게 같은 금고를 열어 준다는 것이다.
  it('lets the assigned counselor edit the vault and the intake screen shows it', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });

    await updateParticipantPii(t.env, canonicalActors.counselor, initial.beneficiaryId, {
      supportCaseContextId: initial.supportCaseId,
      expectedVersion: 1,
      name: '홍서희',
      phone: '010-1234-5678',
      birthDate: '1984-03-11',
      region: '서울시 은평구',
      gender: '여성',
    });

    const context = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(context.participant.name).toBe('홍서희');
    expect(context.participant.phone).toBe('010-1234-5678');
    expect(context.extendedPii.birthDate).toBe('1984-03-11');
    expect(context.extendedPii.region).toBe('서울시 은평구');
    expect(context.extendedPii.gender).toBe('여성');

    // 감사에는 필드 이름만 남는다 — 값 금지(D14 · R3).
    const audit = await t.db.prepare(
      `SELECT detail FROM audit_log
       WHERE target_table = 'participant_pii_vault' AND action = 'update' AND beneficiary_id = ?
       ORDER BY id DESC LIMIT 1`,
    ).bind(initial.beneficiaryId).first<{ detail: string | null }>();
    expect(audit?.detail).not.toContain('홍서희');
    expect(audit?.detail).not.toContain('010-1234-5678');
    expect(audit?.detail).not.toContain('1984-03-11');
  });

  it('rejects a counselor who does not hold the case', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });

    await expect(updateParticipantPii(t.env, canonicalActors.secondCounselor, initial.beneficiaryId, {
      supportCaseContextId: initial.supportCaseId,
      expectedVersion: 1,
      name: 'NOT_ALLOWED',
    })).rejects.toBeInstanceOf(ForbiddenError);

    // 값은 그대로다 — 거부된 쓰기는 금고에 닿지 않는다.
    await expect(t.db.prepare(
      'SELECT enc_name, version FROM participant_pii_vault WHERE beneficiary_id = ?',
    ).bind(initial.beneficiaryId).first()).resolves.toMatchObject({ enc_name: null, version: 1 });
  });

  it('rejects a malformed birth date', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    await expect(updateParticipantPii(t.env, canonicalActors.admin, initial.beneficiaryId, {
      supportCaseContextId: initial.supportCaseId,
      expectedVersion: 1,
      birthDate: '1984/03/11',
    })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('getParticipantBasicInfo is the edit screen read gate (CCC-37)', () => {
  it('returns the seven vault fields, the write context, and one audit row', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    await updateParticipantPii(t.env, canonicalActors.counselor, initial.beneficiaryId, {
      supportCaseContextId: initial.supportCaseId,
      expectedVersion: 1,
      name: '홍서희',
      phone: '010-1234-5678',
      email: 'hong@example.invalid',
      account: '국민 000-00-0000',
      birthDate: '1984-03-11',
      region: '서울시 은평구',
      gender: '여성',
    });

    const basicInfo = await getParticipantBasicInfo(t.env, canonicalActors.counselor, initial.beneficiaryId);
    expect(basicInfo).toMatchObject({
      beneficiaryId: initial.beneficiaryId,
      // 화면이 참여 사업을 고르지 않는다 — 게이트웨이가 활성 컨텍스트를 정해 돌려준다.
      supportCaseContextId: initial.supportCaseId,
      version: 2,
      name: '홍서희',
      phone: '010-1234-5678',
      email: 'hong@example.invalid',
      account: '국민 000-00-0000',
      birthDate: '1984-03-11',
      region: '서울시 은평구',
      gender: '여성',
    });

    // 화면 조회 1건 = 감사 1행(D24). 추가 항목은 행을 나누지 않고 같은 행의 fields 에 합친다.
    const reads = await t.db.prepare(
      `SELECT detail FROM audit_log
       WHERE action = 'read_participant_pii' AND beneficiary_id = ? AND actor_id = ?`,
    ).bind(initial.beneficiaryId, canonicalActors.counselor.userId).all<{ detail: string | null }>();
    expect(reads.results).toHaveLength(1);
    const fields = JSON.parse(reads.results[0]?.detail ?? '{}').fields;
    expect(fields).toEqual(['name', 'phone', 'email', 'account', 'birthDate', 'region', 'gender']);
    // 값은 감사에 남지 않는다(D14 · R3).
    expect(reads.results[0]?.detail).not.toContain('홍서희');
    expect(reads.results[0]?.detail).not.toContain('국민 000-00-0000');
  });

  it('refuses a counselor who does not hold any case for the participant', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, {
      programType: 'financial_support_v1',
      intakeAt: '2026-07-15T09:00:00.000Z',
    });
    await expect(
      getParticipantBasicInfo(t.env, canonicalActors.secondCounselor, initial.beneficiaryId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
