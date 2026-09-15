import { describe, expect, it } from 'vitest';
import type { PreparedStatement } from '@ccc/contracts/database';
import {
  ConflictError,
  ForbiddenError,
  ValidationError,
  updateProgram,
  createBeneficiaryWithInitialSupportCase,
  createCounselingSchedule,
  createIntakeRecord,
  updateIntakeRecord,
  getIntakeRecordContext,
  getManualRecordContext,
  getNextCounselingScheduleForSupportCase,
  getParticipantBasicInfo,
  updateParticipantPii,
  listCounselingRecords,
  listGoals,
  getSupportCaseConsent,
} from '@ccc/core/gateway';
import { CONSENT_DOMAINS, type ConsentDomain } from '@ccc/contracts/consent';
import { setupD1, testProgramId } from './support/d1';
import { registrationInput } from './support/registration';
import { INTAKE_AREAS, parseIntakeQuestionLifecycle, parseIntakeQuestionnaire, parseIntakeCreateRequest, parseIntakeUpdateRequest, IntakeContractError, type IntakeUpdateRequest } from '@ccc/contracts/intake';
import { intakeInput, intakeQuestionnaire, newIntakeQuestionRefs, legacyIntakeQuestionRefs, seedLegacyIntake } from './support/intake';

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


async function seedCase() {
  await seedCanonicalDirectory();
  return createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, await registrationInput(t.env, canonicalActors.counselor, {
    programId: testProgramId(canonicalActors.counselor.orgId),
    intakeAt: '2026-07-15T09:00:00.000Z',
  }));
}

describe('versioned intake writes', () => {
  it('rejects nonstring intake channels without coercion on create and update', () => {
    const questionnaire = intakeQuestionnaire({
      programId: testProgramId(canonicalActors.counselor.orgId), programVersion: 1, financialSupportEnabled: false,
    });
    const common = { schemaVersion: 3, heldAt: '2026-07-15T09:30:00.000Z', questionnaire, additionalItemRefs: [], questionWithdrawals: [] };
    for (const channel of [['phone'], { toString: () => 'phone' }, { toString: 'phone' }, 42, false, null, undefined]) {
      expect(() => parseIntakeCreateRequest({ ...common, submissionId: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', channel }))
        .toThrow(IntakeContractError);
      expect(() => parseIntakeUpdateRequest({ ...common, expectedRevision: 1, channel }))
        .toThrow(IntakeContractError);
    }
  });

  it('stores manual answers immediately without creating goals, actions, consent or legacy baselines', async () => {
    await t.reset();
    const initial = await seedCase();
    const input = await intakeInput(t.env, canonicalActors.counselor, initial.supportCaseId);
    input.questionnaire = intakeQuestionnaire(input.questionnaire.moduleSnapshot, [
      { key: 'summary_urgency', response: 'answered', text: '주의' },
      { key: 'managerOpinion', response: 'answered', text: '함께 확인한 수기 의견' },
      { key: 'need_detail', response: 'declined' },
      { key: 'contact_caution', response: 'not_applicable' },
    ]);
    const beforeConsent = await getSupportCaseConsent(t.env, canonicalActors.counselor, initial.supportCaseId);
    const result = await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, input);
    const records = await listCounselingRecords(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(records).toMatchObject([{ id: result.record.id, kind: 'intake', approvedAt: null }]);
    const context = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(context.saved).toMatchObject({ schemaVersion: 2, revision: 1, questionnaire: input.questionnaire });
    expect(await listGoals(t.env, canonicalActors.counselor, initial.supportCaseId)).toEqual([]);
    expect(await getSupportCaseConsent(t.env, canonicalActors.counselor, initial.supportCaseId)).toEqual(beforeConsent);
    for (const table of ['action_items', 'session_life_area_snapshots']) {
      expect(await t.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE session_id = ?`).bind(result.record.id).first()).toEqual({ n: 0 });
    }
    expect(await t.db.prepare('SELECT intake_at FROM support_cases WHERE id = ?').bind(initial.supportCaseId).first()).toEqual({ intake_at: input.heldAt });
  });

  it('replays identical submissions but rejects changed answers, tables and second intakes', async () => {
    await t.reset();
    const initial = await seedCase();
    const input = await intakeInput(t.env, canonicalActors.counselor, initial.supportCaseId);
    const first = await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, input);
    expect(await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, input)).toMatchObject({ replayed: true, record: { id: first.record.id } });
    const changed = structuredClone(input);
    changed.questionnaire.additionalItems = { response: 'answered', rows: [{ item: '임대차 계약서', dueNote: '다음 상담 전' }] };
    changed.additionalItemRefs = newIntakeQuestionRefs(changed.questionnaire);
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, changed)).rejects.toBeInstanceOf(ConflictError);
    changed.questionnaire = intakeQuestionnaire(input.questionnaire.moduleSnapshot, [{ key: 'managerOpinion', response: 'answered', text: '다른 내용' }]);
    changed.additionalItemRefs = [];
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, changed)).rejects.toBeInstanceOf(ConflictError);
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, { ...input, submissionId: crypto.randomUUID() })).rejects.toBeInstanceOf(ConflictError);
    expect(await t.db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE support_case_id = ? AND kind = 'intake'").bind(initial.supportCaseId).first()).toEqual({ n: 1 });
  });

  it('requires explicit version and applicable responses, independent of UI collapse state', async () => {
    await t.reset();
    const initial = await seedCase();
    const input = await intakeInput(t.env, canonicalActors.counselor, initial.supportCaseId);
    const { schemaVersion: _version, ...unversioned } = input;
    expect(() => parseIntakeCreateRequest(unversioned)).toThrow(IntakeContractError);
    expect(() => parseIntakeCreateRequest({ ...input, schemaVersion: 1 })).toThrow(IntakeContractError);
    expect(() => parseIntakeCreateRequest({ ...input, schemaVersion: 2 })).toThrow(IntakeContractError);
    const selected = intakeQuestionnaire(input.questionnaire.moduleSnapshot, [{ key: 'difficulty_areas', response: 'answered', choices: [...INTAKE_AREAS] }]);
    const missingArea = { ...selected, answers: selected.answers.filter(answer => answer.key !== 'care_burden') };
    expect(() => parseIntakeQuestionnaire(missingArea)).toThrow(IntakeContractError);
    expect(() => parseIntakeQuestionnaire({ ...missingArea, collapsedAreas: ['care_parenting'] })).toThrow(IntakeContractError);
    expect(() => parseIntakeQuestionnaire({ ...input.questionnaire, answers: input.questionnaire.answers.filter(answer => answer.key !== 'managerOpinion') })).toThrow(IntakeContractError);
    const result = await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, { ...input, questionnaire: selected });
    expect((await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId)).saved)
      .toMatchObject({ sessionId: result.record.id, questionnaire: { answers: expect.arrayContaining([
        { key: 'care_burden', response: 'unknown' }, { key: 'family_relationship_conflict', response: 'unknown' },
        { key: 'health_physical', response: 'unknown' }, { key: 'health_stress', response: 'unknown' },
        { key: 'legal_progress', response: 'unknown' }, { key: 'other_detail', response: 'unknown' },
      ]) } });
  });

  it('rejects unknown keys, duplicate answers, response payload collisions and malformed table rows', async () => {
    await t.reset();
    const initial = await seedCase();
    const input = await intakeInput(t.env, canonicalActors.counselor, initial.supportCaseId);
    const form = input.questionnaire;
    for (const extra of [
      { key: 'not_a_question', response: 'unknown' },
      { key: 'managerOpinion', response: 'unknown' },
      { key: 'care_burden', response: 'declined', text: 'must not survive' },
      { key: 'economy_monthly_income', response: 'answered', amount: -1 },
    ]) {
      expect(() => parseIntakeQuestionnaire({ ...form, answers: [...form.answers, extra] })).toThrow(IntakeContractError);
    }
    expect(() => parseIntakeQuestionnaire({ ...form, linkedOrgs: { response: 'answered', rows: [{ orgName: '  ' }] } })).toThrow(IntakeContractError);
    expect(() => parseIntakeQuestionnaire(intakeQuestionnaire(form.moduleSnapshot, [{ key: 'public_benefits', response: 'answered', choices: ['주거급여', '주거급여'] }]))).toThrow(IntakeContractError);
    expect(() => parseIntakeQuestionnaire(intakeQuestionnaire(form.moduleSnapshot, [{ key: 'summary_urgency', response: 'answered', text: '즉시 개입 필요' }]))).toThrow(IntakeContractError);
    expect(() => parseIntakeQuestionnaire({ ...form, additionalItems: { response: 'answered', rows: [{ item: '자료', reason: '구 양식 열' }] } })).toThrow(IntakeContractError);
    for (const forbidden of [{ extendedPii: { birthDate: '1984-03-11' } }, { consent: { privacy: true } }, { goals: [{ title: '자동 목표' }] }, { actionItems: [{ description: '자동 행동' }] }]) {
      expect(() => parseIntakeCreateRequest({ ...input, ...forbidden })).toThrow(IntakeContractError);
    }
  });

  it('requires the program financial module and selected economy area together, rejecting stale snapshots', async () => {
    await t.reset();
    const initial = await seedCase();
    const input = await intakeInput(t.env, canonicalActors.counselor, initial.supportCaseId);
    const snapshot = input.questionnaire.moduleSnapshot;
    const secondCase = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, await registrationInput(t.env, canonicalActors.counselor, { programId: snapshot.programId }));
    const staleBeforeToggle = await intakeInput(t.env, canonicalActors.counselor, secondCase.supportCaseId);
    const debt = { response: 'answered' as const, rows: [{ creditor: '합성 은행', balance: '120만원' }] };
    expect(() => parseIntakeQuestionnaire({ ...input.questionnaire, debts: debt })).toThrow(IntakeContractError);
    const enabled = await updateProgram(t.env, canonicalActors.admin, snapshot.programId, { expectedVersion: snapshot.programVersion, financialSupportEnabled: true });
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, input)).rejects.toBeInstanceOf(ConflictError);
    const fresh = await intakeInput(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(() => parseIntakeQuestionnaire({ ...fresh.questionnaire, debts: debt })).toThrow(IntakeContractError);
    fresh.questionnaire = intakeQuestionnaire(fresh.questionnaire.moduleSnapshot, [
      { key: 'difficulty_areas', response: 'answered', choices: ['economy'] },
      { key: 'economy_monthly_income', response: 'answered', amount: 1200000 },
      { key: 'economy_monthly_expense', response: 'answered', amount: 900000 },
      { key: 'economy_debt_types', response: 'answered', choices: ['금융기관 대출', '카드대금'] },
    ]);
    expect(() => parseIntakeQuestionnaire({ ...fresh.questionnaire, debts: null })).toThrow(IntakeContractError);
    fresh.questionnaire.debts = debt;
    const result = await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, fresh);
    await updateProgram(t.env, canonicalActors.admin, snapshot.programId, { expectedVersion: enabled.version, financialSupportEnabled: false });
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, secondCase.supportCaseId, staleBeforeToggle)).rejects.toBeInstanceOf(ConflictError);
    const saved = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(saved.moduleSnapshot.financialSupportEnabled).toBe(false);
    expect(saved.saved).toMatchObject({ sessionId: result.record.id, questionnaire: { moduleSnapshot: { financialSupportEnabled: true }, debts: debt } });
    await expect(updateIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, {
      schemaVersion: 3, expectedRevision: 1, heldAt: fresh.heldAt, channel: fresh.channel, questionnaire: fresh.questionnaire,
      additionalItemRefs: [], questionWithdrawals: [],
    })).rejects.toBeInstanceOf(ConflictError);
  });

  it('rechecks module state inside the mutation transaction', async () => {
    await t.reset();
    const initial = await seedCase();
    const input = await intakeInput(t.env, canonicalActors.counselor, initial.supportCaseId);
    let intercepted = false;
    const raceDb = new Proxy(t.env.DB, { get(target, property, receiver) {
      if (property === 'batch') return async (statements: PreparedStatement[]) => {
        if (!intercepted) {
          intercepted = true;
          await updateProgram(t.env, canonicalActors.admin, input.questionnaire.moduleSnapshot.programId, {
            expectedVersion: input.questionnaire.moduleSnapshot.programVersion, financialSupportEnabled: true,
          });
        }
        return target.batch(statements);
      };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(createIntakeRecord({ ...t.env, DB: raceDb }, canonicalActors.counselor, initial.supportCaseId, input)).rejects.toBeInstanceOf(ConflictError);
    expect((await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId)).saved).toBeNull();
    expect(await t.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE support_case_id = ? AND action = 'submit_manual_record'").bind(initial.supportCaseId).first()).toEqual({ n: 0 });
  });

  it('requires human confirmation to convert legacy values and retains exact prior records', async () => {
    await t.reset();
    const initial = await seedCase();
    const legacy = await seedLegacyIntake(t.env, canonicalActors.counselor, initial.supportCaseId, {
      submissionId: crypto.randomUUID(), heldAt: '2026-07-15T10:00:00.000Z', channel: 'in_person',
      answers: [
        { key: 'summary_urgency', response: 'answered', text: '즉시 개입 필요' },
        { key: 'family_care_burden', response: 'answered', text: '복수 돌봄' },
        { key: 'employment_education', response: 'answered', text: '구 교육 값' },
      ],
      additionalItems: [{ item: '원자료', reason: '구 사유', dueNote: '구 기한' }],
    });
    const before = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(before.saved).toMatchObject({ schemaVersion: 1, questionnaire: null });
    if (before.saved?.schemaVersion !== 1) throw new Error('legacy fixture missing');
    const oldJson = before.saved.legacyDetailsJson;
    const input = await intakeInput(t.env, canonicalActors.counselor, initial.supportCaseId);
    input.questionnaire.additionalItems = { response: 'answered', rows: [{ item: '확인한 원자료', dueNote: '확인한 기한' }] };
    const edit: IntakeUpdateRequest = { schemaVersion: 3, expectedRevision: 1, heldAt: '2026-07-20T14:00:00.000Z', channel: 'phone',
      questionnaire: input.questionnaire, additionalItemRefs: newIntakeQuestionRefs(input.questionnaire), questionWithdrawals: [] };
    await expect(updateIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, edit)).rejects.toBeInstanceOf(ConflictError);
    await updateIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, { ...edit,
      additionalItemRefs: legacyIntakeQuestionRefs([{ rowIndex: 0, legacySourceRowIndex: 0 }]), conversion: { confirmed: true, sourceRevision: 1 } });
    const converted = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(converted.saved).toMatchObject({
      schemaVersion: 2, revision: 2, questionnaire: input.questionnaire,
      history: [{ revision: 1, schemaVersion: 1, actorId: canonicalActors.counselor.userId, detailsJson: oldJson }],
    });
    expect(JSON.stringify(converted.saved?.questionnaire)).not.toContain('즉시 개입 필요');
    expect(await t.db.prepare('SELECT intake_at FROM support_cases WHERE id = ?').bind(initial.supportCaseId).first()).toEqual({ intake_at: edit.heldAt });
    await expect(updateIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, { ...edit, conversion: { confirmed: true, sourceRevision: 1 } })).rejects.toBeInstanceOf(ConflictError);
    await expect(updateIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, { ...edit, expectedRevision: 2, conversion: { confirmed: true, sourceRevision: 2 } })).rejects.toBeInstanceOf(ConflictError);
    await expect(t.db.prepare("UPDATE intake_record_revisions SET details = '{}' WHERE session_id = ?").bind(legacy.record.id).run()).rejects.toThrow();
    await expect(t.db.prepare('DELETE FROM intake_record_revisions WHERE session_id = ?').bind(legacy.record.id).run()).rejects.toThrow();
    await expect(t.db.prepare(`INSERT INTO intake_record_revisions (session_id, org_id, revision, schema_version, held_at, channel, details, actor_id, recorded_at)
      VALUES (?, 'org_other', 3, 2, ?, 'phone', '{}', ?, ?)`).bind(legacy.record.id, edit.heldAt, canonicalActors.counselor.userId, edit.heldAt).run()).rejects.toThrow();
    const audit = await t.db.prepare("SELECT detail FROM audit_log WHERE action = 'update' AND target_table = 'sessions' AND target_id = ? ORDER BY id DESC LIMIT 1").bind(legacy.record.id).first<{ detail: string }>();
    expect(JSON.parse(audit!.detail)).toMatchObject({ schemaVersion: 2, revision: 2, convertedFromRevision: 1 });
    expect(audit!.detail).not.toContain('복수 돌봄');
  });

  it.each(['practitioner-role', 'active-assignment'] as const)('rechecks %s before updating and preserves the previous date on denial', async (boundary) => {
    await t.reset();
    const initial = await seedCase();
    const input = await intakeInput(t.env, canonicalActors.counselor, initial.supportCaseId);
    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, input);
    let intercepted = false;
    const raceDb = new Proxy(t.env.DB, { get(target, property, receiver) {
      if (property === 'batch') return async (statements: PreparedStatement[]) => {
        if (!intercepted) {
          intercepted = true;
          if (boundary === 'practitioner-role') {
            await target.prepare("UPDATE user_role_assignments SET revoked_at = datetime('now') WHERE org_id = ? AND user_id = ? AND role = 'practitioner' AND revoked_at IS NULL")
              .bind(canonicalActors.counselor.orgId, canonicalActors.counselor.userId).run();
          } else {
            await target.prepare("UPDATE support_case_assignees SET status = 'ended', unassigned_at = datetime('now') WHERE org_id = ? AND support_case_id = ? AND user_id = ? AND status = 'active'")
              .bind(canonicalActors.counselor.orgId, initial.supportCaseId, canonicalActors.counselor.userId).run();
            await target.prepare("INSERT INTO support_case_assignees (id, org_id, support_case_id, user_id, role, status, acceptance_requested_by, assigned_at) VALUES (?, ?, ?, ?, 'primary', 'requested', ?, datetime('now'))")
              .bind(crypto.randomUUID(), canonicalActors.counselor.orgId, initial.supportCaseId, canonicalActors.counselor.userId, canonicalActors.admin.userId).run();
          }
        }
        return target.batch(statements);
      };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    await expect(updateIntakeRecord({ ...t.env, DB: raceDb }, canonicalActors.counselor, initial.supportCaseId, {
      schemaVersion: 3, expectedRevision: 1, heldAt: '2026-07-22T14:00:00.000Z', channel: 'phone', questionnaire: input.questionnaire,
      additionalItemRefs: [], questionWithdrawals: [],
    })).rejects.toBeInstanceOf(ConflictError);
    expect(await t.db.prepare('SELECT held_at, intake_revision FROM sessions WHERE support_case_id = ?').bind(initial.supportCaseId).first()).toEqual({ held_at: input.heldAt, intake_revision: 1 });
    expect(await t.db.prepare('SELECT intake_at FROM support_cases WHERE id = ?').bind(initial.supportCaseId).first()).toEqual({ intake_at: input.heldAt });
  });

  it('atomically completes a linked appointment and rejects its stale version', async () => {
    await t.reset();
    const initial = await seedCase();
    const schedule = await createCounselingSchedule(t.env, canonicalActors.counselor, {
      beneficiaryId: initial.beneficiaryId, supportCaseId: initial.supportCaseId, scheduledAt: '2026-07-15T10:00:00.000Z',
    });
    const input = await intakeInput(t.env, canonicalActors.counselor, initial.supportCaseId, { scheduleId: schedule.id, expectedScheduleVersion: schedule.version + 1 });
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, input)).rejects.toBeInstanceOf(ConflictError);
    expect((await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId)).saved).toBeNull();
    const result = await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, { ...input, expectedScheduleVersion: schedule.version });
    expect(await t.db.prepare('SELECT status, completed_session_id FROM counseling_schedules WHERE id = ?').bind(schedule.id).first()).toEqual({ status: 'completed', completed_session_id: result.record.id });
    await expect(getNextCounselingScheduleForSupportCase(t.env, canonicalActors.counselor, initial.supportCaseId)).resolves.toBeNull();
  });
});

describe('getIntakeRecordContext', () => {
  it('reports hasIntake and increments the session sequence', async () => {
    await t.reset();
    const initial = await seedCase();
    const before = await getIntakeRecordContext(t.env, canonicalActors.counselor, initial.supportCaseId);
    expect(before.hasIntake).toBe(false);
    expect(before.sessionSequence).toBe(1);

    await createIntakeRecord(t.env, canonicalActors.counselor, initial.supportCaseId, await intakeInput(t.env, canonicalActors.counselor, initial.supportCaseId));
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

describe('participant registration stores the 1-1 basic information (D41 · D42)', () => {
  it('encrypts birth date, region, and gender at registration and shows them on the intake screen', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, await registrationInput(t.env, canonicalActors.counselor, {
    programId: testProgramId(canonicalActors.counselor.orgId),
      intakeAt: '2026-07-15T09:00:00.000Z',
      name: '홍서희',
      phone: '010-1234-5678',
      birthDate: '1984-03-11',
      region: '서울시 은평구',
      gender: '여성',
    }));

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

  it('reports the six canonical consent states for the read-only first step', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const programId = testProgramId(canonicalActors.counselor.orgId);
    const states = async (supportCaseId: string): Promise<Record<ConsentDomain, string>> => {
      const context = await getIntakeRecordContext(t.env, canonicalActors.counselor, supportCaseId);
      return Object.fromEntries(context.consent.map((state) => [state.domain, state.state])) as Record<ConsentDomain, string>;
    };
    const declineAll = Object.fromEntries(
      CONSENT_DOMAINS.map((domain) => [domain, 'decline' as const]),
    ) as Partial<Record<ConsentDomain, 'decline'>>;

    // ① 이 비어 있는 케이스는 이제 긴급 등록으로만 생긴다(G1) — 인테이크 1단계는 그 상태도 읽어야 한다.
    const withoutConsent = await createBeneficiaryWithInitialSupportCase(
      t.env,
      canonicalActors.counselor,
      await registrationInput(
        t.env,
        canonicalActors.counselor,
        { programId, intakeAt: '2026-07-15T09:00:00.000Z', emergencyReason: '위기 개입' },
        declineAll,
      ),
    );
    expect(await states(withoutConsent.supportCaseId))
      .toEqual(Object.fromEntries(CONSENT_DOMAINS.map((domain) => [domain, 'not_granted'])));

    const withConsent = await createBeneficiaryWithInitialSupportCase(
      t.env,
      canonicalActors.counselor,
      await registrationInput(t.env, canonicalActors.counselor, { programId, intakeAt: '2026-07-15T09:00:00.000Z' }),
    );
    expect(await states(withConsent.supportCaseId))
      .toEqual(Object.fromEntries(CONSENT_DOMAINS.map((domain) => [domain, 'granted'])));

    // 도메인마다 갈린다 — 녹음·외부 처리 계열만 거절해도 개인정보·민감정보는 동의로 남는다.
    const partial = await createBeneficiaryWithInitialSupportCase(
      t.env,
      canonicalActors.counselor,
      await registrationInput(
        t.env,
        canonicalActors.counselor,
        { programId, intakeAt: '2026-07-15T09:00:00.000Z' },
        {
          counseling_recording: 'decline',
          external_stt_processing: 'decline',
          external_llm_cross_border_processing: 'decline',
          voice_original_retention_period: 'decline',
        },
      ),
    );
    expect(await states(partial.supportCaseId)).toEqual({
      personal_data_collection_use: 'granted',
      sensitive_information_processing: 'granted',
      counseling_recording: 'not_granted',
      external_stt_processing: 'not_granted',
      external_llm_cross_border_processing: 'not_granted',
      voice_original_retention_period: 'not_granted',
    });
  });
});

describe('updateParticipantPii covers the 1-1 basic information (D42 ①)', () => {
  it('lets an admin fix birth date, region, and gender after registration', async () => {
    await t.reset();
    await seedCanonicalDirectory();
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, await registrationInput(t.env, canonicalActors.counselor, {
      programId: testProgramId(canonicalActors.counselor.orgId),
      intakeAt: '2026-07-15T09:00:00.000Z',
    }));

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
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, await registrationInput(t.env, canonicalActors.counselor, {
      programId: testProgramId(canonicalActors.counselor.orgId),
      intakeAt: '2026-07-15T09:00:00.000Z',
    }));

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
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, await registrationInput(t.env, canonicalActors.counselor, {
      programId: testProgramId(canonicalActors.counselor.orgId),
      intakeAt: '2026-07-15T09:00:00.000Z',
    }));

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
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, await registrationInput(t.env, canonicalActors.counselor, {
      programId: testProgramId(canonicalActors.counselor.orgId),
      intakeAt: '2026-07-15T09:00:00.000Z',
    }));
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
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, await registrationInput(t.env, canonicalActors.counselor, {
      programId: testProgramId(canonicalActors.counselor.orgId),
      intakeAt: '2026-07-15T09:00:00.000Z',
    }));
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
    const initial = await createBeneficiaryWithInitialSupportCase(t.env, canonicalActors.counselor, await registrationInput(t.env, canonicalActors.counselor, {
      programId: testProgramId(canonicalActors.counselor.orgId),
      intakeAt: '2026-07-15T09:00:00.000Z',
    }));
    await expect(
      getParticipantBasicInfo(t.env, canonicalActors.secondCounselor, initial.beneficiaryId),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('intake question lifecycle', () => {
  const saved = async (supportCaseId: string) => (await getIntakeRecordContext(t.env, canonicalActors.counselor, supportCaseId)).saved!;
  const state = async (supportCaseId: string) => ({
    sources: (await t.db.prepare('SELECT * FROM sessions WHERE support_case_id=? ORDER BY id').bind(supportCaseId).all()).results,
    history: (await t.db.prepare('SELECT h.* FROM intake_record_revisions h JOIN sessions s ON s.id=h.session_id WHERE s.support_case_id=? ORDER BY h.revision').bind(supportCaseId).all()).results,
    outcomes: (await t.db.prepare('SELECT * FROM manual_question_outcomes WHERE support_case_id=? ORDER BY id').bind(supportCaseId).all()).results,
    audit: (await t.db.prepare('SELECT * FROM audit_log WHERE support_case_id=? ORDER BY id').bind(supportCaseId).all()).results,
  });

  it('keeps UUID identity through editing, reordering, omission, last-row withdrawal and later create replay', async () => {
    await t.reset();
    const initial = await seedCase(), caseId = initial.supportCaseId;
    const input = await intakeInput(t.env, canonicalActors.counselor, caseId);
    input.questionnaire.additionalItems = { response: 'answered', rows: [{ item: '같은 질문' }, { item: '같은 질문', dueNote: '두 번째' }] };
    input.additionalItemRefs = newIntakeQuestionRefs(input.questionnaire);
    const created = await createIntakeRecord(t.env, canonicalActors.counselor, caseId, input);
    const first = await saved(caseId);
    const a = first.questionLifecycle!.items.find(item => item.sourceRevision === 1 && item.sourceRowIndex === 0)!;
    const b = first.questionLifecycle!.items.find(item => item.sourceRevision === 1 && item.sourceRowIndex === 1)!;
    expect(a.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.id).not.toBe(b.id);
    const edit: IntakeUpdateRequest = {
      schemaVersion: 3, expectedRevision: 1, heldAt: input.heldAt, channel: input.channel,
      questionnaire: { ...input.questionnaire, additionalItems: { response: 'answered', rows: [{ item: '수정한 질문', dueNote: '새 기한' }, { item: '같은 질문', dueNote: '두 번째' }] } },
      additionalItemRefs: [{ rowIndex: 0, questionId: a.id, expectedRevision: 1 }, { rowIndex: 1, questionId: b.id, expectedRevision: 1 }],
      questionWithdrawals: [],
    };
    await updateIntakeRecord(t.env, canonicalActors.counselor, caseId, edit);
    const edited = await saved(caseId);
    expect(edited.questionLifecycle!.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: a.id, revision: 2, sourceRevision: 2, sourceRowIndex: 0 }),
      expect.objectContaining({ id: b.id, revision: 1, sourceRevision: 2, sourceRowIndex: 1 }),
    ]));
    const reordered: IntakeUpdateRequest = { ...edit, expectedRevision: 2,
      questionnaire: { ...edit.questionnaire, additionalItems: { response: 'answered', rows: [{ item: '같은 질문', dueNote: '두 번째' }, { item: '수정한 질문', dueNote: '새 기한' }] } },
      additionalItemRefs: [{ rowIndex: 0, questionId: b.id, expectedRevision: 1 }, { rowIndex: 1, questionId: a.id, expectedRevision: 2 }],
    };
    await updateIntakeRecord(t.env, canonicalActors.counselor, caseId, reordered);
    const rebased = await saved(caseId);
    expect(rebased.questionLifecycle!.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: a.id, revision: 2, sourceRevision: 3, sourceRowIndex: 1 }),
      expect.objectContaining({ id: b.id, revision: 1, sourceRevision: 3, sourceRowIndex: 0 }),
    ]));
    expect(rebased.history.find(row => row.revision === 1)?.questionLifecycle).toEqual(first.questionLifecycle);
    const beforeConflict = await state(caseId);
    await expect(updateIntakeRecord(t.env, canonicalActors.counselor, caseId, {
      ...edit, expectedRevision: 3, questionWithdrawals: [{ questionId: a.id, expectedRevision: 2 }],
      additionalItemRefs: [{ rowIndex: 0, questionId: a.id, expectedRevision: 2 }, { rowIndex: 1, questionId: b.id, expectedRevision: 1 }],
      questionnaire: { ...edit.questionnaire, additionalItems: { response: 'answered', rows: [{ item: '충돌하는 수정' }, { item: '같은 질문', dueNote: '두 번째' }] } },
    })).rejects.toBeInstanceOf(ConflictError);
    expect(await state(caseId)).toEqual(beforeConflict);
    const omission: IntakeUpdateRequest = { ...edit, expectedRevision: 3,
      questionnaire: { ...edit.questionnaire, additionalItems: { response: 'unknown' } }, additionalItemRefs: [] };
    await updateIntakeRecord(t.env, canonicalActors.counselor, caseId, omission);
    expect((await saved(caseId)).questionLifecycle).toEqual(rebased.questionLifecycle);
    expect((await getManualRecordContext(t.env, canonicalActors.counselor, caseId)).questions.map(question => question.id).sort())
      .toEqual([a.id, b.id].sort());
    await updateIntakeRecord(t.env, canonicalActors.counselor, caseId, {
      ...omission, expectedRevision: 4, questionWithdrawals: [{ questionId: b.id, expectedRevision: 1 }],
    });
    await updateIntakeRecord(t.env, canonicalActors.counselor, caseId, {
      ...edit, expectedRevision: 5,
      questionnaire: { ...edit.questionnaire, additionalItems: { response: 'answered', rows: [{ item: '수정한 질문', dueNote: '새 기한' }] } },
      additionalItemRefs: [{ rowIndex: 0, questionId: a.id, expectedRevision: 2 }],
      questionWithdrawals: [{ questionId: a.id, expectedRevision: 2 }],
    });
    const withdrawn = await saved(caseId);
    expect(withdrawn.questionnaire?.additionalItems.response).toBe('answered');
    expect(withdrawn.questionLifecycle!.items.find(item => item.id === a.id)).toMatchObject({
      revision: 3, sourceRevision: 6, sourceRowIndex: 0, withdrawn: { fromRevision: 2, actorId: canonicalActors.counselor.userId },
    });
    const context = await getManualRecordContext(t.env, canonicalActors.counselor, caseId);
    expect(context).toMatchObject({ schemaVersion: 3, questions: [], confirmedQuestions: [] });
    expect(context.withdrawnQuestions.map(question => question.id).sort()).toEqual([a.id, b.id].sort());
    const beforeReplay = await state(caseId);
    expect(await createIntakeRecord(t.env, canonicalActors.counselor, caseId, input))
      .toMatchObject({ schemaVersion: 3, revision: 6, replayed: true, record: { id: created.record.id } });
    await expect(createIntakeRecord(t.env, canonicalActors.counselor, caseId, { ...input, additionalItemRefs: [...input.additionalItemRefs].reverse() }))
      .rejects.toBeInstanceOf(ConflictError);
    await expect(updateIntakeRecord(t.env, canonicalActors.counselor, caseId, {
      ...omission, expectedRevision: 6, questionWithdrawals: [{ questionId: a.id, expectedRevision: 3 }],
    })).rejects.toBeInstanceOf(ConflictError);
    expect(await state(caseId)).toEqual(beforeReplay);
  });

  it.each([1, 2] as const)('requires explicit one-to-one adoption of unbound schema %s without rewriting historical bytes', async (schemaVersion) => {
    await t.reset();
    const initial = await seedCase(), caseId = initial.supportCaseId;
    const input = await intakeInput(t.env, canonicalActors.counselor, caseId);
    input.questionnaire.additionalItems = { response: 'answered', rows: [{ item: '동일 문구' }, { item: '동일 문구' }] };
    const original = JSON.stringify({ ...(schemaVersion === 1 ? { additionalItems: [{ item: '동일 문구', reason: '옛 첫째' }, { item: '동일 문구', reason: '옛 둘째' }] } : input.questionnaire),
      unknownHistoricalField: { text: '원문 그대로' } });
    const id = crypto.randomUUID();
    await t.db.prepare(`INSERT INTO sessions (id,org_id,support_case_id,counselor_id,held_at,channel,kind,intake_details,intake_schema_version,
      submission_id,submission_hash,submitted_by,ai_status,created_at,updated_at)
      VALUES (?,?,?,?,?,'in_person','intake',?,?,?,?,?,'none',?,?)`)
      .bind(id, canonicalActors.counselor.orgId, caseId, canonicalActors.counselor.userId, input.heldAt, original, schemaVersion,
        crypto.randomUUID(), 'a'.repeat(64), canonicalActors.counselor.userId, input.heldAt, input.heldAt).run();
    expect((await saved(caseId)).questionLifecycle).toBeNull();
    expect((await getManualRecordContext(t.env, canonicalActors.counselor, caseId)).questions).toEqual([]);
    const edit: IntakeUpdateRequest = { schemaVersion: 3, expectedRevision: 1, heldAt: input.heldAt, channel: input.channel,
      questionnaire: input.questionnaire, additionalItemRefs: newIntakeQuestionRefs(input.questionnaire), questionWithdrawals: [] };
    const before = await state(caseId);
    await expect(updateIntakeRecord(t.env, canonicalActors.counselor, caseId, edit)).rejects.toBeInstanceOf(ConflictError);
    await expect(updateIntakeRecord(t.env, canonicalActors.counselor, caseId, { ...edit, conversion: { confirmed: true, sourceRevision: 1 },
      additionalItemRefs: [{ rowIndex: 0, questionId: null, expectedRevision: null, legacySourceRowIndex: 0 }, { rowIndex: 1, questionId: null, expectedRevision: null }],
    })).rejects.toBeInstanceOf(ConflictError);
    await expect(updateIntakeRecord(t.env, canonicalActors.counselor, caseId, { ...edit, conversion: { confirmed: true, sourceRevision: 1 },
      additionalItemRefs: legacyIntakeQuestionRefs([{ rowIndex: 0, legacySourceRowIndex: 0 }, { rowIndex: 1, legacySourceRowIndex: 0 }]),
    })).rejects.toBeInstanceOf(ValidationError);
    expect(await state(caseId)).toEqual(before);
    await updateIntakeRecord(t.env, canonicalActors.counselor, caseId, { ...edit, conversion: { confirmed: true, sourceRevision: 1 },
      additionalItemRefs: legacyIntakeQuestionRefs([{ rowIndex: 0, legacySourceRowIndex: 1 }, { rowIndex: 1, legacySourceRowIndex: 0 }]),
    });
    const converted = await saved(caseId);
    expect(converted.history).toMatchObject([{ revision: 1, schemaVersion, detailsJson: original, questionLifecycle: null }]);
    const first = converted.questionLifecycle!.items.find(item => item.sourceRevision === 2 && item.sourceRowIndex === 0)!;
    expect(first.origin).toEqual({ schemaVersion, sourceRevision: 1, sourceRowIndex: 1 });
    expect(converted.questionLifecycle!.conversion).toMatchObject({
      sourceSchemaVersion: schemaVersion, sourceRevision: 1,
      mechanical: { mappings: expect.arrayContaining([{ questionId: first.id, sourceRowIndex: 1 }]) },
      confirmation: { actorId: canonicalActors.counselor.userId },
    });
  });
  it('requires human conversion even when the legacy source has zero eligible rows', async () => {
    await t.reset();
    const initial = await seedCase(), caseId = initial.supportCaseId;
    await seedLegacyIntake(t.env, canonicalActors.counselor, caseId, {
      submissionId: crypto.randomUUID(), heldAt: '2026-09-01T09:00:00.000Z', channel: 'in_person', unknownField: '원문',
    });
    const input = await intakeInput(t.env, canonicalActors.counselor, caseId);
    const edit: IntakeUpdateRequest = { schemaVersion: 3, expectedRevision: 1, heldAt: input.heldAt, channel: input.channel,
      questionnaire: input.questionnaire, additionalItemRefs: [], questionWithdrawals: [] };
    await expect(updateIntakeRecord(t.env, canonicalActors.counselor, caseId, edit)).rejects.toBeInstanceOf(ConflictError);
    expect((await saved(caseId)).questionLifecycle).toBeNull();
    await updateIntakeRecord(t.env, canonicalActors.counselor, caseId, { ...edit, conversion: { confirmed: true, sourceRevision: 1 } });
    expect((await saved(caseId)).questionLifecycle).toMatchObject({ version: 1, items: [], conversion: { mechanical: { mappings: [] } } });
  });


  it('rejects unknown nested metadata and malformed row identity without coercion', () => {
    const questionnaire = intakeQuestionnaire({ programId: 'program', programVersion: 1, financialSupportEnabled: false });
    questionnaire.additionalItems = { response: 'answered', rows: [{ item: '질문' }] };
    const request = { schemaVersion: 3, submissionId: crypto.randomUUID(), heldAt: '2026-09-01T09:00:00.000Z', channel: 'phone',
      questionnaire, additionalItemRefs: newIntakeQuestionRefs(questionnaire), questionWithdrawals: [] };
    for (const refs of [[], [{ rowIndex: -1, questionId: null, expectedRevision: null }],
      [{ rowIndex: 0, questionId: null, expectedRevision: 1 }], [{ rowIndex: 0, questionId: null, expectedRevision: null, unknown: true }]]) {
      expect(() => parseIntakeCreateRequest({ ...request, additionalItemRefs: refs })).toThrow(IntakeContractError);
    }
    const id = crypto.randomUUID(), at = request.heldAt;
    const lifecycle = { version: 1, items: [{ id, revision: 2, sourceRevision: 3, sourceRowIndex: 0, createdBy: 'writer', createdAt: at,
      withdrawn: { actorId: 'writer', recordedAt: at, fromRevision: 1 }, origin: { schemaVersion: 1, sourceRevision: 1, sourceRowIndex: 0 } }],
      conversion: { sourceSchemaVersion: 1, sourceRevision: 1, mechanical: { recordedAt: at, mappings: [{ questionId: id, sourceRowIndex: 0 }] },
        confirmation: { actorId: 'writer', recordedAt: at } } };
    expect(parseIntakeQuestionLifecycle(lifecycle).items[0]?.id).toBe(id);
    const boundaries = [lifecycle, lifecycle.items[0]!, lifecycle.items[0]!.withdrawn, lifecycle.items[0]!.origin,
      lifecycle.conversion, lifecycle.conversion.mechanical, lifecycle.conversion.mechanical.mappings[0]!, lifecycle.conversion.confirmation];
    for (const boundary of boundaries) {
      Object.assign(boundary, { unknown: true });
      expect(() => parseIntakeQuestionLifecycle(lifecycle)).toThrow(IntakeContractError);
      Reflect.deleteProperty(boundary, 'unknown');
    }
  });
});
