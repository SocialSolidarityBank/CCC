import { describe, expect, it, vi } from 'vitest';
import type { PreparedStatement } from '@ccc/contracts/database';
import type { CreateManualRecordInput, ManualRecordContext } from '@ccc/contracts/manual-record';
import { ConflictError, ForbiddenError, FLAG_TYPES, createBeneficiaryWithInitialSupportCase, createCounselingRecord,
  createCounselingSchedule, getManualRecordContext, listCounselingRecords, type Actor } from '@ccc/core/gateway';
import { handleRequest } from '@ccc/http-api';
import { setupD1, testActors, testProgramId } from './support/d1';
import { registrationInput } from './support/registration';
import { seedLegacyManualRecord } from './support/manual-record';
import { createIntakeRecord, updateIntakeRecord, getIntakeRecordContext } from '@ccc/core/gateway';
import { intakeInput, newIntakeQuestionRefs } from './support/intake';

const t = setupD1();
const writer = testActors.counselor;
function input(overrides: Partial<CreateManualRecordInput> = {}): CreateManualRecordInput {
  return { schemaVersion: 2, submissionId: crypto.randomUUID(), heldAt: '2026-09-12T09:00:00.000Z', channel: 'in_person', memo: '합성 수기 기록', ...overrides };
}
async function seed() {
  await t.reset();
  t.env.CCC_LLM_MODE = 'off';
  return createBeneficiaryWithInitialSupportCase(t.env, writer, await registrationInput(t.env, writer, { programId: testProgramId(writer.orgId) }));
}
function http(actor: Actor, path: string, body?: object) {
  return handleRequest(new Request(`http://localhost${path}`, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), t.env, async () => actor);
}
function beforeBatch(change: () => Promise<unknown>) {
  let intercepted = false;
  return new Proxy(t.env.DB, { get(target, property, receiver) {
    if (property === 'batch') return async (statements: PreparedStatement[]) => {
      if (!intercepted) { intercepted = true; await change(); }
      return target.batch(statements);
    };
    const value: unknown = Reflect.get(target, property, receiver);
    return typeof value === 'function' ? value.bind(target) : value;
  } });
}

describe('W04 manual record lifecycle', () => {
  it('round-trips a memo and six human-confirmed flags with AI off and no assessment defaults', async () => {
    const created = await seed();
    const path = `/support-cases/${created.supportCaseId}/records`;
    const response = await http(writer, path, input({ channel: 'visit', reason: 'urgent', flags: FLAG_TYPES.map(flagType => ({ flagType })) }));
    expect(response.status).toBe(201);
    const saved = await response.json() as { record: { id: string } };
    const listed = await http(writer, path);
    expect(listed.status).toBe(200);
    const body = await listed.json() as { records: Array<{ flags: unknown[] }> };
    expect(body).toMatchObject({ records: [{ id: saved.record.id, memo: '합성 수기 기록', aiOneLiner: null,
      manual: { details: { method: 'visit', reason: 'urgent', urgency: null, changes: [] } },
      flags: expect.arrayContaining(FLAG_TYPES.map(flagType => expect.objectContaining({ flagType, source: 'counselor', reviewStatus: 'confirmed' }))),
    }] });
    expect(body.records[0]?.flags).toHaveLength(FLAG_TYPES.length);
    const context = await (await http(writer, `${path}/context`)).json() as ManualRecordContext;
    expect(context).toMatchObject({ canWrite: true, actions: [], questions: [], defaults: { heldAt: null, channel: null, reason: null } });
  });

  it('distinguishes human completion, stop, continuation and omission on the same original action IDs', async () => {
    const created = await seed();
    await createCounselingRecord(t.env, writer, created.supportCaseId, input({
      actionItems: ['complete', 'stop', 'continue', 'omit'].map(description => ({ description, owner: 'beneficiary' })),
    }));
    const before = await getManualRecordContext(t.env, writer, created.supportCaseId);
    const byName = new Map(before.actions.map(action => [action.description, action]));
    const continued = byName.get('continue')!;
    const saved = await createCounselingRecord(t.env, writer, created.supportCaseId, input({ heldAt: '2026-09-13T09:00:00.000Z', actionOutcomes: [
      { actionItemId: byName.get('complete')!.id, expectedRevision: 1, outcome: 'done' },
      { actionItemId: byName.get('stop')!.id, expectedRevision: 1, outcome: 'not_done', continuation: 'stop', reason: '당사자가 중단을 선택했다' },
      { actionItemId: continued.id, expectedRevision: 1, outcome: 'not_done', continuation: 'continue', update: { description: '수정된 할 일', dueDate: '2026-09-20' } },
    ] }));
    const after = await getManualRecordContext(t.env, writer, created.supportCaseId);
    expect(after.actions.map(action => action.id).sort()).toEqual([continued.id, byName.get('omit')!.id].sort());
    expect(after.closedActions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: byName.get('complete')!.id, state: 'done' }),
      expect.objectContaining({ id: byName.get('stop')!.id, state: 'stopped', history: expect.arrayContaining([
        expect.objectContaining({ stopReason: '당사자가 중단을 선택했다', sourceSessionId: saved.record.id }),
      ]) }),
    ]));
    const carried = after.actions.find(action => action.id === continued.id)!;
    expect(carried).toMatchObject({ revision: 2, description: '수정된 할 일', dueDate: '2026-09-20' });
    expect(carried.history.map(revision => revision.description)).toEqual(['continue', '수정된 할 일']);
    expect(after.actions.find(action => action.id === byName.get('omit')!.id)).toMatchObject({ revision: 1,
      outcomes: [{ outcome: 'unconfirmed', sessionId: saved.record.id, heldAt: '2026-09-13T09:00:00.000Z' }] });
    const record = (await listCounselingRecords(t.env, writer, created.supportCaseId)).find(record => record.id === saved.record.id)!;
    expect(record.manual!.actionOutcomes.map(outcome => outcome.outcome).sort()).toEqual(['done', 'not_done', 'not_done', 'unconfirmed']);
  });

  it('requires an explicit continuation choice and stop reason without recording a failed request', async () => {
    const created = await seed();
    await createCounselingRecord(t.env, writer, created.supportCaseId, input({ actionItems: [{ description: '확인할 일', owner: 'org' }] }));
    const action = (await getManualRecordContext(t.env, writer, created.supportCaseId)).actions[0]!;
    const path = `/support-cases/${created.supportCaseId}/records`;
    for (const invalid of [{ outcome: 'not_done' }, { outcome: 'not_done', continuation: 'stop' },
      { outcome: 'not_done', continuation: 'stop', reason: ' ' }, { outcome: 'hold' }]) {
      const response = await http(writer, path, { ...input(), actionOutcomes: [{ actionItemId: action.id, expectedRevision: action.revision, ...invalid }] });
      expect(response.status).toBe(400);
    }
    expect((await getManualRecordContext(t.env, writer, created.supportCaseId)).actions[0]).toMatchObject({ id: action.id, revision: 1, outcomes: [] });
    expect((await listCounselingRecords(t.env, writer, created.supportCaseId)).length).toBe(1);
  });

  it('retains old hold wording and version while omitted and then continued in new records', async () => {
    const created = await seed();
    await seedLegacyManualRecord(t.env, writer, created.supportCaseId, { heldAt: '2026-09-10T09:00:00.000Z', channel: 'phone', memo: 'old memo',
      actionItems: [{ description: 'old action', owner: 'counselor' }] });
    const original = (await getManualRecordContext(t.env, writer, created.supportCaseId)).actions[0]!;
    const hold = await seedLegacyManualRecord(t.env, writer, created.supportCaseId, { heldAt: '2026-09-11T09:00:00.000Z', channel: 'phone', memo: 'old hold memo',
      details: { safetyNote: 'old safety wording' }, actionItemResolutions: [{ actionItemId: original.id, status: 'hold', note: 'old hold reason' }] });
    await createCounselingRecord(t.env, writer, created.supportCaseId, input());
    const omitted = (await getManualRecordContext(t.env, writer, created.supportCaseId)).actions[0]!;
    expect(omitted).toMatchObject({ id: original.id, revision: 2, outcomes: [{ outcome: 'unconfirmed' }] });
    await createCounselingRecord(t.env, writer, created.supportCaseId, input({ actionOutcomes: [
      { actionItemId: original.id, expectedRevision: 2, outcome: 'not_done', continuation: 'continue' },
    ] }));
    const current = (await getManualRecordContext(t.env, writer, created.supportCaseId)).actions[0]!;
    expect(current.history).toContainEqual(expect.objectContaining({ revision: 2, resolutionStatus: 'hold', resolutionNote: 'old hold reason', sourceSessionId: hold.record.id }));
    expect((await listCounselingRecords(t.env, writer, created.supportCaseId)).find(record => record.id === hold.record.id)?.manual)
      .toMatchObject({ schemaVersion: 1, details: null, legacyDetailsJson: '{"safetyNote":"old safety wording"}' });
  });

  it('carries all unanswered questions oldest-first and confirms only the selected source identity', async () => {
    const created = await seed();
    const source = await createCounselingRecord(t.env, writer, created.supportCaseId, input({ heldAt: '2026-09-10T09:00:00.000Z', nextQuestions: ['같은 문구', '남은 질문'] }));
    const schedule = await createCounselingSchedule(t.env, writer, { beneficiaryId: created.beneficiaryId, supportCaseId: created.supportCaseId,
      scheduledAt: '2026-09-12T09:00:00.000Z', customQuestions: ['같은 문구'] });
    await createCounselingRecord(t.env, writer, created.supportCaseId, input());
    const before = await getManualRecordContext(t.env, writer, created.supportCaseId);
    expect(before.questions.map(question => question.kind)).toEqual(['record', 'record', 'schedule']);
    expect(before.defaults).toMatchObject({ heldAt: schedule.scheduledAt, channel: 'in_person', reason: null, scheduleId: schedule.id });
    const selected = before.questions.find(question => question.kind === 'record' && question.body === '같은 문구')!;
    const answered = await createCounselingRecord(t.env, writer, created.supportCaseId, input({ heldAt: '2026-09-13T09:00:00.000Z', questionAnswers: [
      { kind: selected.kind, questionId: selected.id, sourceId: selected.sourceId, expectedRevision: selected.sourceRevision, answer: '실무자가 확인한 답' },
    ] }));
    const after = await getManualRecordContext(t.env, writer, created.supportCaseId);
    expect(after.questions.map(question => question.id).sort()).toEqual(before.questions.filter(question => question.id !== selected.id).map(question => question.id).sort());
    expect(after.confirmedQuestions).toMatchObject([{ id: selected.id, sourceSessionId: source.record.id,
      outcomes: [{ outcome: 'unconfirmed' }, { outcome: 'confirmed', answer: '실무자가 확인한 답', sessionId: answered.record.id, heldAt: '2026-09-13T09:00:00.000Z', sourceRevision: 1 }] }]);
  });

  it('replays concurrent answers and action updates once without re-closing or duplicating their histories', async () => {
    const created = await seed();
    await createCounselingRecord(t.env, writer, created.supportCaseId, input({ nextQuestions: ['확인할 질문'], actionItems: [{ description: '확인할 일', owner: 'org' }] }));
    const context = await getManualRecordContext(t.env, writer, created.supportCaseId), question = context.questions[0]!, action = context.actions[0]!;
    const request = input({ actionOutcomes: [{ actionItemId: action.id, expectedRevision: action.revision, outcome: 'done' }],
      questionAnswers: [{ kind: question.kind, questionId: question.id, sourceId: question.sourceId, expectedRevision: question.sourceRevision, answer: '확인한 답' }] });
    const results = await Promise.all([createCounselingRecord(t.env, writer, created.supportCaseId, request), createCounselingRecord(t.env, writer, created.supportCaseId, request)]);
    expect(results.map(result => result.replayed).sort()).toEqual([false, true]);
    expect(results[0]!.record.id).toBe(results[1]!.record.id);
    const after = await getManualRecordContext(t.env, writer, created.supportCaseId);
    expect(after).toMatchObject({ actions: [], questions: [], closedActions: [{ revision: 2, outcomes: [{ outcome: 'done' }] }],
      confirmedQuestions: [{ outcomes: [{ outcome: 'confirmed', answer: '확인한 답' }] }] });
  });

  it('limits a backdated record to earlier business origins, including late-entered and rescheduled sources', async () => {
    const created = await seed();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-20T09:00:00.000Z'));
    try {
      const earlierSchedule = await createCounselingSchedule(t.env, writer, {
        beneficiaryId: created.beneficiaryId, supportCaseId: created.supportCaseId,
        scheduledAt: '2026-09-21T09:00:00.000Z', customQuestions: ['earlier actual meeting'],
      });
      const laterSchedule = await createCounselingSchedule(t.env, writer, {
        beneficiaryId: created.beneficiaryId, supportCaseId: created.supportCaseId,
        scheduledAt: '2026-09-09T09:00:00.000Z', customQuestions: ['later actual meeting'],
      });
      await createCounselingSchedule(t.env, writer, {
        beneficiaryId: created.beneficiaryId, supportCaseId: created.supportCaseId,
        scheduledAt: '2026-09-22T09:00:00.000Z', customQuestions: ['future planned meeting'],
      });
      const earlier = await createCounselingRecord(t.env, writer, created.supportCaseId, input({
        heldAt: '2026-09-10T09:00:00.000Z', scheduleId: earlierSchedule.id, expectedScheduleVersion: earlierSchedule.version,
        actionItems: ['earlier explicit', 'earlier omitted'].map(description => ({ description, owner: 'org' })),
        nextQuestions: ['earlier explicit', 'earlier omitted'],
      }));
      const later = await createCounselingRecord(t.env, writer, created.supportCaseId, input({
        heldAt: '2026-09-14T09:00:00.000Z', scheduleId: laterSchedule.id, expectedScheduleVersion: laterSchedule.version,
        actionItems: [{ description: 'future action', owner: 'org' }], nextQuestions: ['future record question'],
      }));
      const context = await getManualRecordContext(t.env, writer, created.supportCaseId);
      const earlierActions = context.actions.filter(action => action.sourceSessionId === earlier.record.id);
      const futureAction = context.actions.find(action => action.sourceSessionId === later.record.id)!;
      const explicitAction = earlierActions.find(action => action.description === 'earlier explicit')!;
      const earlierQuestions = context.questions.filter(question => question.sourceSessionId === earlier.record.id);
      const explicitQuestion = earlierQuestions.find(question => question.kind === 'record' && question.body === 'earlier explicit')!;
      const futureQuestions = context.questions.filter(question => question.sourceSessionId !== earlier.record.id);
      expect(explicitAction.createdAt).toBe('2026-09-20T09:00:00.000Z');
      expect(explicitQuestion.createdAt).toBe('2026-09-20T09:00:00.000Z');
      await expect(createCounselingRecord(t.env, writer, created.supportCaseId, input({ actionOutcomes: [
        { actionItemId: futureAction.id, expectedRevision: futureAction.revision, outcome: 'done' },
      ] }))).rejects.toBeInstanceOf(ForbiddenError);
      for (const question of futureQuestions) {
        await expect(createCounselingRecord(t.env, writer, created.supportCaseId, input({ questionAnswers: [
          { kind: question.kind, questionId: question.id, sourceId: question.sourceId, expectedRevision: question.sourceRevision, answer: 'future answer' },
        ] }))).rejects.toBeInstanceOf(ForbiddenError);
      }
      const saved = await createCounselingRecord(t.env, writer, created.supportCaseId, input({
        actionOutcomes: [{ actionItemId: explicitAction.id, expectedRevision: explicitAction.revision, outcome: 'done' }],
        questionAnswers: [{ kind: explicitQuestion.kind, questionId: explicitQuestion.id, sourceId: explicitQuestion.sourceId,
          expectedRevision: explicitQuestion.sourceRevision, answer: 'earlier answer' }],
      }));
      const records = await listCounselingRecords(t.env, writer, created.supportCaseId);
      expect(records.map(record => record.id).sort()).toEqual([earlier.record.id, later.record.id, saved.record.id].sort());
      const manual = records.find(record => record.id === saved.record.id)!.manual!;
      expect(manual.actionOutcomes.map(outcome => [outcome.actionItemId, outcome.outcome]).sort()).toEqual(
        earlierActions.map(action => [action.id, action.id === explicitAction.id ? 'done' : 'unconfirmed']).sort());
      expect(manual.questionOutcomes.map(outcome => [outcome.questionId, outcome.outcome]).sort()).toEqual(
        earlierQuestions.map(question => [question.id, question.id === explicitQuestion.id ? 'confirmed' : 'unconfirmed']).sort());
      const after = await getManualRecordContext(t.env, writer, created.supportCaseId);
      expect(after.actions.find(action => action.id === futureAction.id)).toMatchObject({ state: 'open', revision: futureAction.revision });
      expect(after.questions.filter(question => futureQuestions.some(source => source.id === question.id)).map(question => question.id).sort())
        .toEqual(futureQuestions.map(question => question.id).sort());
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns the selected record revisions during an interleaved create and sees new records on the next read', async () => {
    const created = await seed();
    const source = await createCounselingRecord(t.env, writer, created.supportCaseId, input({
      nextQuestions: ['original question'], actionItems: [{ description: 'original action', owner: 'org' }],
    }));
    const context = await getManualRecordContext(t.env, writer, created.supportCaseId);
    const action = context.actions[0]!, question = context.questions[0]!;
    let addedId: string | undefined;
    let intercepted = false;
    const db = new Proxy(t.env.DB, { get(target, property, receiver) {
      if (property === 'prepare') return (sql: string) => {
        const prepared = target.prepare(sql);
        if (sql.replace(/\s+/g, ' ').trim() !== 'SELECT * FROM sessions WHERE org_id = ? AND support_case_id = ? ORDER BY held_at DESC, id DESC') return prepared;
        const wrap = (statement: PreparedStatement): PreparedStatement => new Proxy(statement, { get(stmt, key, stmtReceiver) {
          if (key === 'bind') return (...values: Parameters<PreparedStatement['bind']>) => wrap(stmt.bind(...values));
          if (key === 'all') return async () => {
            const selected = await stmt.all();
            if (!intercepted) {
              intercepted = true;
              const added = await createCounselingRecord(t.env, writer, created.supportCaseId, input({
                heldAt: '2026-09-13T09:00:00.000Z',
                actionOutcomes: [{ actionItemId: action.id, expectedRevision: action.revision, outcome: 'done' }],
                questionAnswers: [{ kind: question.kind, questionId: question.id, sourceId: question.sourceId,
                  expectedRevision: question.sourceRevision, answer: 'newly confirmed' }],
              }));
              addedId = added.record.id;
              await t.db.prepare('UPDATE sessions SET memo=? WHERE id=?').bind('corrected source memo', source.record.id).run();
            }
            return selected;
          };
          const value: unknown = Reflect.get(stmt, key, stmtReceiver);
          return typeof value === 'function' ? value.bind(stmt) : value;
        } });
        return wrap(prepared);
      };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const selected = await listCounselingRecords({ ...t.env, DB: db }, writer, created.supportCaseId);
    expect(selected.map(record => record.id)).toEqual([source.record.id]);
    expect(selected[0]).toMatchObject({ memo: '합성 수기 기록',
      manual: { revision: 1, history: [{ revision: 1, memo: '합성 수기 기록' }], actionOutcomes: [], questionOutcomes: [] } });
    const fresh = await listCounselingRecords(t.env, writer, created.supportCaseId);
    expect(fresh.map(record => record.id)).toEqual([addedId, source.record.id]);
    expect(fresh.find(record => record.id === source.record.id)).toMatchObject({ memo: 'corrected source memo',
      manual: { revision: 2, history: [{ revision: 1, memo: '합성 수기 기록' }, { revision: 2, memo: 'corrected source memo' }] } });
    expect(fresh.find(record => record.id === addedId)?.manual).toMatchObject({
      actionOutcomes: [{ actionItemId: action.id, outcome: 'done' }],
      questionOutcomes: [{ questionId: question.id, outcome: 'confirmed', answer: 'newly confirmed' }],
    });
  });

  it('keeps manual context sources, histories and outcomes in the initial selection during an interleaved commit', async () => {
    const created = await seed();
    await createCounselingSchedule(t.env, writer, {
      beneficiaryId: created.beneficiaryId, supportCaseId: created.supportCaseId,
      scheduledAt: '2026-09-12T09:00:00.000Z', customQuestions: ['original schedule question'],
    });
    const source = await createCounselingRecord(t.env, writer, created.supportCaseId, input({
      nextQuestions: ['original record question'], actionItems: [{ description: 'original action', owner: 'org' }],
    }));
    const before = await getManualRecordContext(t.env, writer, created.supportCaseId);
    const action = before.actions[0]!;
    let addedId: string | undefined;
    let intercepted = false;
    let releaseFollowups!: () => void;
    const committed = new Promise<void>(resolve => { releaseFollowups = resolve; });
    const db = new Proxy(t.env.DB, { get(target, property, receiver) {
      if (property === 'prepare') return (sql: string) => {
        const primary = sql.includes('FROM action_items a');
        const followup = sql.includes('FROM action_item_revisions')
          || sql.includes('FROM manual_action_outcomes') || sql.includes('FROM manual_question_outcomes');
        const prepared = target.prepare(sql);
        if (!primary && !followup) return prepared;
        const wrap = (statement: PreparedStatement): PreparedStatement => new Proxy(statement, { get(stmt, key, stmtReceiver) {
          if (key === 'bind') return (...values: Parameters<PreparedStatement['bind']>) => wrap(stmt.bind(...values));
          if (key === 'all') return async () => {
            if (followup) await committed;
            const selected = await stmt.all();
            if (primary && !intercepted) {
              intercepted = true;
              try {
                await createCounselingSchedule(t.env, writer, {
                  beneficiaryId: created.beneficiaryId, supportCaseId: created.supportCaseId,
                  scheduledAt: '2026-09-12T09:30:00.000Z', customQuestions: ['new schedule question'],
                });
                const added = await createCounselingRecord(t.env, writer, created.supportCaseId, input({
                  heldAt: '2026-09-13T09:00:00.000Z',
                  actionItems: [{ description: 'new action', owner: 'org' }], nextQuestions: ['new record question'],
                  actionOutcomes: [{ actionItemId: action.id, expectedRevision: action.revision, outcome: 'done' }],
                  questionAnswers: before.questions.map(question => ({
                    kind: question.kind, questionId: question.id, sourceId: question.sourceId,
                    expectedRevision: question.sourceRevision, answer: 'newly confirmed',
                  })),
                }));
                addedId = added.record.id;
                await t.db.prepare('UPDATE sessions SET memo=? WHERE id=?').bind('corrected original memo', source.record.id).run();
              } finally {
                releaseFollowups();
              }
            }
            return selected;
          };
          const value: unknown = Reflect.get(stmt, key, stmtReceiver);
          return typeof value === 'function' ? value.bind(stmt) : value;
        } });
        return wrap(prepared);
      };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    const selected = await getManualRecordContext({ ...t.env, DB: db }, writer, created.supportCaseId);
    expect(selected).toEqual(before);
    const fresh = await getManualRecordContext(t.env, writer, created.supportCaseId);
    expect(fresh.actions.map(item => item.description)).toEqual(['new action']);
    expect(fresh.closedActions).toMatchObject([{
      id: action.id, revision: 2, state: 'done',
      history: [{ revision: 1, resolvedAt: null }, { revision: 2, sourceSessionId: addedId }],
      outcomes: [{ sessionId: addedId, outcome: 'done' }],
    }]);
    expect(fresh.questions.map(question => question.body)).toEqual(['new schedule question', 'new record question']);
    expect(fresh.questions.find(question => question.kind === 'schedule')?.outcomes)
      .toMatchObject([{ sessionId: addedId, outcome: 'unconfirmed' }]);
    expect(fresh.confirmedQuestions.map(question => question.id).sort()).toEqual(before.questions.map(question => question.id).sort());
    for (const question of fresh.confirmedQuestions) {
      expect(question.outcomes).toContainEqual(expect.objectContaining({ sessionId: addedId, outcome: 'confirmed', answer: 'newly confirmed' }));
    }
    expect(fresh.confirmedQuestions.find(question => question.kind === 'record')?.sourceRevision).toBe(2);
  });

  it.each(['action', 'schedule-question', 'record-source'] as const)('rejects a concurrent %s revision without partial officialization', async boundary => {
    const created = await seed();
    const source = await createCounselingRecord(t.env, writer, created.supportCaseId, input({ nextQuestions: ['원래 질문'], actionItems: [{ description: '원래 할 일', owner: 'org' }] }));
    await createCounselingSchedule(t.env, writer, { beneficiaryId: created.beneficiaryId, supportCaseId: created.supportCaseId,
      scheduledAt: '2026-09-13T09:00:00.000Z', customQuestions: ['일정 질문'] });
    const context = await getManualRecordContext(t.env, writer, created.supportCaseId);
    const db = beforeBatch(async () => {
      if (boundary === 'action') await t.db.prepare('UPDATE action_items SET description=? WHERE id=?').bind('다른 수정', context.actions[0]!.id).run();
      else if (boundary === 'schedule-question') await t.db.prepare('UPDATE schedule_custom_questions SET body=? WHERE id=?').bind('다른 일정 질문', context.questions.find(question => question.kind === 'schedule')!.id).run();
      else await t.db.prepare('UPDATE sessions SET memo=? WHERE id=?').bind('고친 원문', source.record.id).run();
    });
    await expect(createCounselingRecord({ ...t.env, DB: db }, writer, created.supportCaseId, input({
      heldAt: '2026-09-14T09:00:00.000Z',
      actionOutcomes: [{ actionItemId: context.actions[0]!.id, expectedRevision: 1, outcome: 'done' }],
      questionAnswers: context.questions.map(question => ({ kind: question.kind, questionId: question.id, sourceId: question.sourceId, expectedRevision: question.sourceRevision, answer: '확인한 답' })),
    }))).rejects.toBeInstanceOf(ConflictError);
    expect((await listCounselingRecords(t.env, writer, created.supportCaseId)).map(record => record.id)).toEqual([source.record.id]);
    const after = await getManualRecordContext(t.env, writer, created.supportCaseId);
    expect(after.closedActions).toEqual([]);
    expect(after.confirmedQuestions).toEqual([]);
    expect(after.actions[0]!.outcomes).toEqual([]);
  });

  it.each(['practitioner-role', 'active-assignment'] as const)('rechecks %s inside the atomic write boundary', async boundary => {
    const created = await seed();
    const db = beforeBatch(async () => {
      if (boundary === 'practitioner-role') await t.db.prepare("UPDATE user_role_assignments SET revoked_at=datetime('now') WHERE org_id=? AND user_id=? AND role='practitioner' AND revoked_at IS NULL").bind(writer.orgId, writer.userId).run();
      else await t.db.prepare("UPDATE support_case_assignees SET status='ended',unassigned_at=datetime('now') WHERE org_id=? AND support_case_id=? AND user_id=? AND status='active'").bind(writer.orgId, created.supportCaseId, writer.userId).run();
    });
    await expect(createCounselingRecord({ ...t.env, DB: db }, writer, created.supportCaseId, input())).rejects.toBeInstanceOf(ConflictError);
    expect(await listCounselingRecords(t.env, testActors.admin, created.supportCaseId)).toEqual([]);
    expect((await getManualRecordContext(t.env, testActors.admin, created.supportCaseId)).canWrite).toBe(false);
  });

  it('rejects a different case question even when its text and revision match', async () => {
    const created = await seed();
    const other = await createBeneficiaryWithInitialSupportCase(t.env, writer, await registrationInput(t.env, writer, { programId: testProgramId(writer.orgId) }));
    await createCounselingRecord(t.env, writer, other.supportCaseId, input({ nextQuestions: ['같은 질문'] }));
    const question = (await getManualRecordContext(t.env, writer, other.supportCaseId)).questions[0]!;
    await expect(createCounselingRecord(t.env, writer, created.supportCaseId, input({ questionAnswers: [
      { kind: question.kind, questionId: question.id, sourceId: question.sourceId, expectedRevision: question.sourceRevision, answer: '잘못 연결한 답' },
    ] }))).rejects.toBeInstanceOf(ForbiddenError);
    expect(await listCounselingRecords(t.env, writer, created.supportCaseId)).toEqual([]);
    expect((await getManualRecordContext(t.env, writer, other.supportCaseId)).questions.map(item => item.id)).toEqual([question.id]);
  });
});

describe('later confirmation of intake questions', () => {
  async function seedQuestion() {
    const created = await seed();
    const intake = await intakeInput(t.env, writer, created.supportCaseId);
    intake.questionnaire.additionalItems = { response: 'answered', rows: [{ item: '원래 질문', dueNote: '첫 기한' }] };
    intake.additionalItemRefs = newIntakeQuestionRefs(intake.questionnaire);
    const source = await createIntakeRecord(t.env, writer, created.supportCaseId, intake);
    const question = (await getManualRecordContext(t.env, writer, created.supportCaseId)).questions[0]!;
    return { created, intake, source, question };
  }
  const state = async (caseId: string) => ({
    sessions: (await t.db.prepare('SELECT * FROM sessions WHERE support_case_id=? ORDER BY id').bind(caseId).all()).results,
    outcomes: (await t.db.prepare('SELECT * FROM manual_question_outcomes WHERE support_case_id=? ORDER BY id').bind(caseId).all()).results,
    audits: (await t.db.prepare('SELECT * FROM audit_log WHERE support_case_id=? ORDER BY id').bind(caseId).all()).results,
  });

  it('keeps a confirmed answer readable after source editing and withdrawal without reopening it', async () => {
    const { created, intake, source, question } = await seedQuestion(), caseId = created.supportCaseId;
    const edit = { schemaVersion: 3 as const, expectedRevision: 1, heldAt: intake.heldAt, channel: intake.channel,
      questionnaire: intake.questionnaire, additionalItemRefs: [{ rowIndex: 0, questionId: question.id, expectedRevision: 1 }], questionWithdrawals: [] };
    await updateIntakeRecord(t.env, writer, caseId, edit);
    const answer = input({ questionAnswers: [{ kind: 'intake', questionId: question.id, sourceId: source.record.id, expectedRevision: 1, answer: '확인한 답' }] });
    const response = await http(writer, `/support-cases/${caseId}/records`, answer);
    expect(response.status).toBe(201);
    const record = await response.json() as { record: { id: string } };
    const changed = { ...edit, expectedRevision: 2,
      questionnaire: { ...intake.questionnaire, additionalItems: { response: 'answered' as const, rows: [{ item: '고친 질문', dueNote: '다른 기한' }] } } };
    await updateIntakeRecord(t.env, writer, caseId, changed);
    const confirmed = await getManualRecordContext(t.env, writer, caseId);
    expect(confirmed.confirmedQuestions).toMatchObject([{ id: question.id, body: '고친 질문', sourceRevision: 2,
      outcomes: [{ sourceRevision: 1, sourceText: '원래 질문', answer: '확인한 답' }] }]);
    await updateIntakeRecord(t.env, writer, caseId, { ...changed, expectedRevision: 3,
      additionalItemRefs: [{ rowIndex: 0, questionId: question.id, expectedRevision: 2 }],
      questionWithdrawals: [{ questionId: question.id, expectedRevision: 2 }] });
    const withdrawn = await getManualRecordContext(t.env, writer, caseId);
    expect(withdrawn).toMatchObject({ schemaVersion: 3, questions: [], confirmedQuestions: [] });
    expect(withdrawn.withdrawnQuestions).toMatchObject([{ kind: 'intake', id: question.id, state: 'withdrawn', sourceRevision: 3,
      outcomes: [{ sessionId: record.record.id, sourceRevision: 1, sourceText: '원래 질문', answer: '확인한 답' }] }]);
    const records = await listCounselingRecords(t.env, writer, caseId);
    expect(records.find(item => item.id === record.record.id)?.manual?.questionOutcomes).toMatchObject([{
      kind: 'intake', questionId: question.id, sourceId: source.record.id, sourceRevision: 1, sourceText: '원래 질문', answer: '확인한 답',
    }]);
    const before = await state(caseId);
    const denied = await http(writer, `/support-cases/${caseId}/records`, { ...answer, submissionId: crypto.randomUUID() });
    expect(denied.status).toBe(409);
    await expect(denied.json()).resolves.toEqual({ error: 'conflict' });
    expect(await state(caseId)).toEqual(before);
    const replay = await http(writer, `/support-cases/${caseId}/records`, answer);
    expect(replay.status).toBe(200);
    expect(await state(caseId)).toEqual(before);
  });

  it.each(['withdrawal', 'date-correction'] as const)('rolls back a late confirmation after concurrent intake %s', async (boundary) => {
    const { created, intake, source, question } = await seedQuestion(), caseId = created.supportCaseId;
    let committed: Awaited<ReturnType<typeof state>> | undefined;
    const db = beforeBatch(async () => {
      await updateIntakeRecord(t.env, writer, caseId, {
        schemaVersion: 3, expectedRevision: 1, heldAt: boundary === 'date-correction' ? '2026-09-14T09:00:00.000Z' : intake.heldAt,
        channel: intake.channel, questionnaire: intake.questionnaire,
        additionalItemRefs: [{ rowIndex: 0, questionId: question.id, expectedRevision: 1 }],
        questionWithdrawals: boundary === 'withdrawal' ? [{ questionId: question.id, expectedRevision: 1 }] : [],
      });
      committed = await state(caseId);
    });
    await expect(createCounselingRecord({ ...t.env, DB: db }, writer, caseId, input({
      questionAnswers: [{ kind: 'intake', questionId: question.id, sourceId: source.record.id, expectedRevision: 1, answer: '늦은 답' }],
    }))).rejects.toBeInstanceOf(ConflictError);
    expect(await state(caseId)).toEqual(committed);
    expect((await getIntakeRecordContext(t.env, writer, caseId)).saved?.revision).toBe(2);
  });

  it('does not replace the selected intake source or consume outcomes from later regular sessions', async () => {
    const { created, intake, source, question } = await seedQuestion(), caseId = created.supportCaseId;
    const before = await getManualRecordContext(t.env, writer, caseId);
    let changed = false;
    const db = new Proxy(t.env.DB, { get(target, property, receiver) {
      if (property === 'prepare') return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.includes('AS manual_work_sources')) return statement;
        return new Proxy(statement, { get(prepared, key, preparedReceiver) {
          if (key === 'bind') return (...values: Parameters<PreparedStatement['bind']>) => {
            const bound = prepared.bind(...values);
            return new Proxy(bound, { get(boundTarget, boundKey, boundReceiver) {
              if (boundKey === 'all') return async () => {
                const result = await boundTarget.all();
                if (!changed) {
                  changed = true;
                  await updateIntakeRecord(t.env, writer, caseId, { schemaVersion: 3, expectedRevision: 1, heldAt: intake.heldAt, channel: intake.channel,
                    questionnaire: { ...intake.questionnaire, additionalItems: { response: 'answered', rows: [{ item: '나중 질문' }] } },
                    additionalItemRefs: [{ rowIndex: 0, questionId: question.id, expectedRevision: 1 }], questionWithdrawals: [] });
                  await createCounselingRecord(t.env, writer, caseId, input({ questionAnswers: [
                    { kind: 'intake', questionId: question.id, sourceId: source.record.id, expectedRevision: 2, answer: '나중 답' },
                  ] }));
                }
                return result;
              };
              const value: unknown = Reflect.get(boundTarget, boundKey, boundReceiver);
              return typeof value === 'function' ? value.bind(boundTarget) : value;
            } });
          };
          const value: unknown = Reflect.get(prepared, key, preparedReceiver);
          return typeof value === 'function' ? value.bind(prepared) : value;
        } });
      };
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    } });
    expect(await getManualRecordContext({ ...t.env, DB: db }, writer, caseId)).toEqual(before);
    expect((await getManualRecordContext(t.env, writer, caseId)).confirmedQuestions).toMatchObject([{
      id: question.id, body: '나중 질문', sourceRevision: 2, outcomes: [{ answer: '나중 답', sourceText: '나중 질문' }],
    }]);
  });
});
