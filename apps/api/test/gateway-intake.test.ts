import { describe, expect, it } from 'vitest';
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
  type CreateIntakeRecordInput,
  createBeneficiaryWithInitialSupportCase,
  createIntakeRecord,
  getIntakeRecordContext,
  listCounselingRecords,
  listGoals,
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

const FULL_LIFE_AREAS: CreateIntakeRecordInput['lifeAreas'] = [
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

    // Consent row: privacy + recording + textAi all bound to recorded_at.
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
    await expect(purgeParticipantPii(t.env, canonicalActors.admin, initial.beneficiaryId))
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
