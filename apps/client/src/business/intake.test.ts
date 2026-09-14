import { describe, expect, it } from 'vitest';
import { CONSENT_DOMAINS } from '@ccc/contracts/consent';
import {
  INTAKE_WRITE_SCHEMA_VERSION, requiredIntakeQuestionKeys, type IntakeQuestionLifecycle, type IntakeSavedRecord,
} from '@ccc/contracts/intake';
import {
  buildIntakeMutationMetadata, buildIntakeQuestionnaire, intakeDraft, intakeDraftFromSaved, newIntakeTableRow,
} from './intake-form';
import { decodeIntakeContext, IntakeApi } from './intake';
import { BusinessError } from './errors';
import { intakeModule, intakeQuestionnaire } from './test-support';
// @ts-expect-error The synthetic server is an executable JavaScript harness without declarations.
import { createSyntheticState, handleApi, seedSyntheticLegacyIntake, SYNTHETIC_IDS } from '../../tools/synthetic-api.mjs';

const caseId = 'case-1';
const heldAt = '2026-09-01T01:00:00.000Z';
const lifecycle = (sourceRevision = 1): IntakeQuestionLifecycle => ({
  version: 1,
  items: [{
    id: 'question-a', revision: 1, sourceRevision, sourceRowIndex: 0,
    createdBy: 'user-1', createdAt: heldAt, withdrawn: null, origin: null,
  }],
  conversion: null,
});
const context = (saved: IntakeSavedRecord | null = null) => ({
  beneficiaryId: 'swallow-003', supportCaseId: caseId, participant: { name: null, phone: null, email: null },
  sessionSequence: 1, hasIntake: saved !== null, canWrite: false,
  writeSchemaVersion: INTAKE_WRITE_SCHEMA_VERSION, moduleSnapshot: intakeModule,
  extendedPii: {}, overallGoal: null, schedule: null, saved,
  consent: CONSENT_DOMAINS.map((domain) => ({ domain, state: 'unconfirmed', provider: null, providerLegalRecipient: null,
    providerCountry: null, purpose: null, retentionDuration: null, effectiveAt: null, eventId: null, revision: null, eventSequence: null })),
});

describe('versioned intake applicability and payloads', () => {
  it('requires common questions and selected modules even when there are no visible controls', () => {
    const basic = intakeDraft(intakeQuestionnaire());
    expect(buildIntakeQuestionnaire(basic, intakeModule).answers.map((answer) => answer.key)).toEqual(requiredIntakeQuestionKeys([]));
    basic.answers.difficulty_areas = { response: 'answered', choices: ['care_parenting'], text: '', amount: '' };
    expect(() => buildIntakeQuestionnaire(basic, intakeModule)).toThrow(BusinessError);
    const selected = intakeDraft(intakeQuestionnaire(intakeModule, ['care_parenting']));
    expect(buildIntakeQuestionnaire(selected, intakeModule).answers.some((answer) => answer.key === 'care_burden')).toBe(true);
    delete selected.answers.managerOpinion;
    expect(() => buildIntakeQuestionnaire(selected, intakeModule)).toThrow(BusinessError);
  });

  it('preserves explicit nonanswers without attaching stale values or table rows', () => {
    const draft = intakeDraft(intakeQuestionnaire(intakeModule, [], [
      { key: 'contact_caution', response: 'declined' }, { key: 'need_primary', response: 'not_applicable' },
    ]));
    draft.answers.contact_caution!.text = 'do not send';
    draft.tables.linkedOrgs = { response: 'declined', rows: [newIntakeTableRow({ orgName: 'do not send' })], lifecycleRows: [] };
    const result = buildIntakeQuestionnaire(draft, intakeModule);
    expect(result.answers.find((answer) => answer.key === 'contact_caution')).toEqual({ key: 'contact_caution', response: 'declined' });
    expect(result.answers.find((answer) => answer.key === 'need_primary')).toEqual({ key: 'need_primary', response: 'not_applicable' });
    expect(result.linkedOrgs).toEqual({ response: 'declined' });
    expect(result.additionalItems).toEqual({ response: 'unknown' });
  });

  it('gates debt tables by the context module and selected economy, and validates integer money', () => {
    const enabled = { ...intakeModule, financialSupportEnabled: true };
    const draft = intakeDraft(intakeQuestionnaire(enabled, ['economy']));
    draft.answers.economy_monthly_income = { response: 'answered', amount: '0', text: '', choices: [] };
    draft.tables.debts = { response: 'answered', rows: [newIntakeTableRow({ creditor: '합성 기관' })], lifecycleRows: [] };
    expect(buildIntakeQuestionnaire(draft, enabled).answers).toContainEqual({ key: 'economy_monthly_income', response: 'answered', amount: 0 });
    expect(buildIntakeQuestionnaire(draft, enabled).debts).toEqual({ response: 'answered', rows: [{ creditor: '합성 기관' }] });
    expect(buildIntakeQuestionnaire(draft, intakeModule).debts).toBeNull();
    for (const amount of ['', '-1', '1.5', '9007199254740992']) {
      draft.answers.economy_monthly_income.amount = amount;
      expect(() => buildIntakeQuestionnaire(draft, enabled)).toThrow(BusinessError);
    }
    draft.answers.difficulty_areas = { response: 'unknown', text: '', choices: [], amount: '' };
    expect(buildIntakeQuestionnaire(draft, enabled).debts).toBeNull();
  });

  it('keeps stable question references through reorder, omission, withdrawal and explicit conversion', () => {
    const questionnaire = intakeQuestionnaire();
    questionnaire.additionalItems = { response: 'answered', rows: [{ item: '첫 질문' }, { item: '둘째 질문' }] };
    const saved: IntakeSavedRecord = {
      sessionId: 'intake-1', heldAt, channel: 'in_person', revision: 1, schemaVersion: 2,
      questionnaire, legacyDetailsJson: null, history: [],
      questionLifecycle: {
        version: 1,
        items: [
          { id: 'question-a', revision: 2, sourceRevision: 1, sourceRowIndex: 0, createdBy: 'user-1', createdAt: heldAt, withdrawn: null, origin: null },
          { id: 'question-b', revision: 1, sourceRevision: 1, sourceRowIndex: 1, createdBy: 'user-1', createdAt: heldAt, withdrawn: null, origin: null },
        ],
        conversion: null,
      },
    };
    const draft = intakeDraftFromSaved(saved);
    draft.tables.additionalItems.rows = [draft.tables.additionalItems.rows[1]!, draft.tables.additionalItems.rows[0]!];
    draft.tables.additionalItems.rows[0]!.withdrawalRequested = true;
    expect(buildIntakeMutationMetadata(draft)).toEqual({
      additionalItemRefs: [
        { rowIndex: 0, questionId: 'question-b', expectedRevision: 1 },
        { rowIndex: 1, questionId: 'question-a', expectedRevision: 2 },
      ],
      questionWithdrawals: [{ questionId: 'question-b', expectedRevision: 1 }],
    });

    draft.tables.additionalItems.response = 'unknown';
    draft.tables.additionalItems.rows[0]!.withdrawalRequested = false;
    expect(buildIntakeMutationMetadata(draft)).toEqual({ additionalItemRefs: [], questionWithdrawals: [] });

    const converting = intakeDraftFromSaved({ ...saved, questionLifecycle: null });
    expect(buildIntakeMutationMetadata(converting).additionalItemRefs).toEqual([
      { rowIndex: 0, questionId: null, expectedRevision: null, legacySourceRowIndex: 0 },
      { rowIndex: 1, questionId: null, expectedRevision: null, legacySourceRowIndex: 1 },
    ]);

    const omittedQuestionnaire = { ...questionnaire, additionalItems: { response: 'unknown' as const } };
    const omitted = intakeDraftFromSaved({
      ...saved, revision: 2, questionnaire: omittedQuestionnaire,
      questionLifecycle: saved.questionLifecycle,
      history: [{
        revision: 1, schemaVersion: 2, heldAt, channel: 'in_person', actorId: 'user-1', recordedAt: heldAt,
        convertedFromRevision: null, detailsJson: JSON.stringify(questionnaire), questionLifecycle: saved.questionLifecycle,
      }],
    });
    expect(omitted.tables.additionalItems.rows).toEqual([]);
    expect(omitted.tables.additionalItems.lifecycleRows.map((row) => ({
      item: row.values.item, questionId: row.questionId, expectedRevision: row.expectedRevision, status: row.status,
    }))).toEqual([
      { item: '첫 질문', questionId: 'question-a', expectedRevision: 2, status: 'retained' },
      { item: '둘째 질문', questionId: 'question-b', expectedRevision: 1, status: 'retained' },
    ]);
    expect(buildIntakeMutationMetadata(omitted)).toEqual({ additionalItemRefs: [], questionWithdrawals: [] });
    omitted.tables.additionalItems.lifecycleRows[0]!.withdrawalRequested = true;
    expect(buildIntakeMutationMetadata(omitted)).toEqual({
      additionalItemRefs: [],
      questionWithdrawals: [{ questionId: 'question-a', expectedRevision: 2 }],
    });
  });
});

describe('versioned intake HTTP decoder', () => {
  it('retains legacy JSON and prior revision provenance without reclassifying old values', () => {
    const legacyDetailsJson = '{ "answers": [{"key":"summary_urgency","response":"answered","text":"즉시 개입 필요"}], "family_care_burden":"복수 돌봄" }';
    const saved: IntakeSavedRecord = { sessionId: 'intake-1', heldAt, channel: 'phone', revision: 2,
      schemaVersion: 1, questionnaire: null, legacyDetailsJson, questionLifecycle: null,
      history: [{ revision: 1, schemaVersion: 1, heldAt, channel: 'video', actorId: null,
        recordedAt: heldAt, convertedFromRevision: null, detailsJson: '{"old":true}', questionLifecycle: null }] };
    expect(decodeIntakeContext(context(saved), caseId).saved).toEqual(saved);
    expect(() => decodeIntakeContext({ ...context(saved), saved: { ...saved, history: [{ ...saved.history[0], revision: 2 }] } }, caseId)).toThrow(BusinessError);
    expect(() => decodeIntakeContext({ ...context(saved), writeSchemaVersion: 1 }, caseId)).toThrow(BusinessError);
  });

  it('reads saved and historical lifecycle without accepting missing or unknown lifecycle values', () => {
    const questionnaire = intakeQuestionnaire({ ...intakeModule, financialSupportEnabled: true }, ['economy']);
    const priorLifecycle = lifecycle(1);
    const saved: IntakeSavedRecord = { sessionId: 'intake-1', heldAt, channel: 'video', revision: 2,
      schemaVersion: 2, questionnaire, legacyDetailsJson: null, questionLifecycle: lifecycle(2),
      history: [{ revision: 1, schemaVersion: 2, heldAt, channel: 'video', actorId: 'user-1',
        recordedAt: heldAt, convertedFromRevision: null, detailsJson: JSON.stringify(questionnaire), questionLifecycle: priorLifecycle }] };
    const decoded = decodeIntakeContext(context(saved), caseId);
    expect(decoded.moduleSnapshot.financialSupportEnabled).toBe(false);
    expect(decoded.saved).toEqual(saved);
    expect(() => decodeIntakeContext({ ...context(saved), saved: { ...saved, questionLifecycle: { ...saved.questionLifecycle!, version: 2 } } }, caseId))
      .toThrow(BusinessError);
    const { questionLifecycle: _missing, ...missingLifecycle } = saved;
    expect(() => decodeIntakeContext({ ...context(saved), saved: missingLifecycle }, caseId)).toThrow(BusinessError);
    expect(() => decodeIntakeContext({ ...context(saved), saved: { ...saved,
      history: [{ ...saved.history[0]!, questionLifecycle: { ...priorLifecycle, version: 2 } }] } }, caseId)).toThrow(BusinessError);
    const { questionLifecycle: _historicalLifecycle, ...historyWithoutLifecycle } = saved.history[0]!;
    expect(() => decodeIntakeContext({ ...context(saved), saved: { ...saved, history: [historyWithoutLifecycle] } }, caseId)).toThrow(BusinessError);
    const { writeSchemaVersion: _writeSchemaVersion, ...missingWriteVersion } = context(saved);
    expect(() => decodeIntakeContext(missingWriteVersion, caseId)).toThrow(BusinessError);
  });

  it('uses only the v3 write contract, preserving references and propagating conflict', async () => {
    const sent: Array<{ method: string; body: unknown }> = [];
    const api = new IntakeApi({ request: async (_path: string, method: string, body: unknown) => {
      sent.push({ method, body });
      if (sent.length > 1) throw new BusinessError('conflict', 409);
      return { schemaVersion: 3, revision: 4, replayed: false, record: { id: 'intake-1', heldAt, channel: 'phone', kind: 'intake' } };
    } } as never);
    const input = { schemaVersion: 3 as const, expectedRevision: 3, heldAt, channel: 'phone' as const,
      questionnaire: intakeQuestionnaire(), additionalItemRefs: [], questionWithdrawals: [],
      conversion: { confirmed: true as const, sourceRevision: 3 } };
    expect((await api.update(caseId, input)).revision).toBe(4);
    expect(sent[0]).toEqual({ method: 'PUT', body: input });
    await expect(api.update(caseId, input)).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect(sent).toHaveLength(2);
    await expect(api.create(caseId, { schemaVersion: 2, answers: [] } as never)).rejects.toMatchObject({ code: 'invalid_request', status: 400 });
    expect(sent).toHaveLength(2);
  });
});

interface SyntheticLifecycleItem {
  id: string;
  revision: number;
  sourceRevision: number;
  sourceRowIndex: number;
  withdrawn: { fromRevision: number } | null;
  origin?: { schemaVersion: number; sourceRevision: number; sourceRowIndex: number } | null;
}
interface SyntheticLifecycle {
  items: SyntheticLifecycleItem[];
  conversion?: { sourceSchemaVersion: number; sourceRevision: number; mechanical: { mappings: Array<{ questionId: string; sourceRowIndex: number }> } } | null;
}
interface SyntheticBody {
  error?: string;
  writeSchemaVersion?: number;
  schemaVersion?: number;
  revision?: number;
  replayed?: boolean;
  saved?: { questionLifecycle: SyntheticLifecycle; history: Array<{ questionLifecycle: SyntheticLifecycle }> };
}
interface SyntheticState extends Record<string, unknown> {
  role: string;
}

describe('synthetic intake API lifecycle', () => {
  const options = {
    clientOrigin: 'https://client.example', installationId: 'synthetic-installation',
    basePath: '/functions/v1/ccc', admissionCopyHash: 'a'.repeat(64), admissionCopyVersion: 'synthetic-copy-v1',
  };
  const request = async (state: SyntheticState, method: string, body?: unknown) => {
    const response = await handleApi(new Request(
      `https://api.example/functions/v1/ccc/support-cases/${SYNTHETIC_IDS.CASE_ID}/records/intake`,
      { method, headers: { authorization: 'Bearer synthetic', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) },
    ), state, options);
    return { status: response.status, body: await response.json() as SyntheticBody };
  };

  it('mirrors v3 identity, reorder, omission, withdrawal and error boundaries', async () => {
    const state = createSyntheticState() as SyntheticState;
    const questionnaire = intakeQuestionnaire();
    questionnaire.additionalItems = { response: 'answered', rows: [{ item: '첫 질문' }, { item: '둘째 질문' }] };
    const create = {
      schemaVersion: 3, submissionId: 'submission-1', heldAt, channel: 'in_person',
      questionnaire,
      additionalItemRefs: [
        { rowIndex: 0, questionId: null, expectedRevision: null },
        { rowIndex: 1, questionId: null, expectedRevision: null },
      ],
      questionWithdrawals: [],
    };
    expect((await request(state, 'GET')).body.writeSchemaVersion).toBe(3);
    expect(await request(state, 'POST', { ...create, schemaVersion: 2 })).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    expect(await request(state, 'POST', create)).toMatchObject({ status: 201, body: { schemaVersion: 3, revision: 1, replayed: false } });

    const created = (await request(state, 'GET')).body.saved!;
    const first = created.questionLifecycle.items.find((item) => item.sourceRowIndex === 0)!;
    const second = created.questionLifecycle.items.find((item) => item.sourceRowIndex === 1)!;
    expect(created.history).toEqual([]);
    expect(await request(state, 'PUT', {
      schemaVersion: 3, expectedRevision: 1, heldAt, channel: 'in_person', questionnaire,
      additionalItemRefs: [
        { rowIndex: 0, questionId: null, expectedRevision: null, legacySourceRowIndex: 0 },
        { rowIndex: 1, questionId: null, expectedRevision: null, legacySourceRowIndex: 1 },
      ],
      questionWithdrawals: [], conversion: { confirmed: true, sourceRevision: 1 },
    })).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    const reorderedQuestionnaire = structuredClone(questionnaire);
    if (reorderedQuestionnaire.additionalItems.response !== 'answered') throw new Error('expected answered synthetic questions');
    reorderedQuestionnaire.additionalItems.rows = [{ item: '둘째 질문' }, { item: '첫 질문 수정' }];
    const edit = {
      schemaVersion: 3, expectedRevision: 1, heldAt, channel: 'in_person',
      questionnaire: reorderedQuestionnaire,
      additionalItemRefs: [
        { rowIndex: 0, questionId: second.id, expectedRevision: 1 },
        { rowIndex: 1, questionId: first.id, expectedRevision: 1 },
      ],
      questionWithdrawals: [],
    };
    expect(await request(state, 'PUT', edit)).toMatchObject({ status: 200, body: { schemaVersion: 3, revision: 2 } });
    const edited = (await request(state, 'GET')).body.saved!;
    expect(edited.questionLifecycle.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: first.id, revision: 2, sourceRevision: 2, sourceRowIndex: 1 }),
      expect.objectContaining({ id: second.id, revision: 1, sourceRevision: 2, sourceRowIndex: 0 }),
    ]));
    expect(edited.history[0]!.questionLifecycle).toEqual(created.questionLifecycle);

    const omitted = { ...edit, expectedRevision: 2,
      questionnaire: { ...reorderedQuestionnaire, additionalItems: { response: 'unknown' } },
      additionalItemRefs: [],
    };
    expect((await request(state, 'PUT', omitted)).body.revision).toBe(3);
    const crossScope = createSyntheticState() as SyntheticState;
    expect(await request(crossScope, 'POST', {
      ...create,
      questionnaire: { ...questionnaire, moduleSnapshot: { ...questionnaire.moduleSnapshot, programId: 'foreign-program' } },
    })).toMatchObject({ status: 403, body: { error: 'forbidden' } });
    const afterOmission = (await request(state, 'GET')).body.saved!.questionLifecycle;
    expect(afterOmission.items.every((item) => item.withdrawn === null)).toBe(true);
    expect((await request(state, 'PUT', { ...omitted, expectedRevision: 3,
      questionWithdrawals: [{ questionId: second.id, expectedRevision: 1 }] })).body.revision).toBe(4);
    const afterWithdrawal = (await request(state, 'GET')).body.saved!.questionLifecycle;
    expect(afterWithdrawal.items.find((item) => item.id === second.id)!.withdrawn).toMatchObject({ fromRevision: 1 });
    expect(afterWithdrawal.items.find((item) => item.id === first.id)!.withdrawn).toBeNull();

    expect(await request(state, 'PUT', { ...omitted, expectedRevision: 2 })).toMatchObject({ status: 409, body: { error: 'conflict' } });
    const forbidden = createSyntheticState() as SyntheticState;
    forbidden.role = 'institution-admin';
    expect(await request(forbidden, 'POST', create)).toMatchObject({ status: 403, body: { error: 'forbidden' } });
    expect(await request(forbidden, 'POST', { ...create, schemaVersion: 2 })).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
  });

  it('requires explicit one-to-one conversion for an unbound legacy intake', async () => {
    const state = createSyntheticState() as SyntheticState;
    seedSyntheticLegacyIntake(state, SYNTHETIC_IDS.CASE_ID, {
      sessionId: 'legacy-intake', heldAt, channel: 'phone', revision: 1, schemaVersion: 1,
      questionnaire: null, legacyDetailsJson: '{"additionalItems":[{"item":"이전 질문","dueNote":"다음 상담"}]}',
      history: [], questionLifecycle: null,
    }, heldAt);
    expect((await request(state, 'GET')).body.saved!.questionLifecycle).toBeNull();
    const questionnaire = intakeQuestionnaire();
    questionnaire.additionalItems = { response: 'answered', rows: [{ item: '확인한 이전 질문', dueNote: '다음 상담' }] };
    const update = {
      schemaVersion: 3, expectedRevision: 1, heldAt, channel: 'phone', questionnaire,
      additionalItemRefs: [{ rowIndex: 0, questionId: null, expectedRevision: null, legacySourceRowIndex: 0 }],
      questionWithdrawals: [], conversion: { confirmed: true, sourceRevision: 1 },
    };
    expect(await request(state, 'PUT', { ...update, conversion: undefined })).toMatchObject({ status: 400, body: { error: 'invalid_request' } });
    expect(await request(state, 'PUT', update)).toMatchObject({ status: 200, body: { schemaVersion: 3, revision: 2 } });
    const lifecycle = (await request(state, 'GET')).body.saved!.questionLifecycle;
    expect(lifecycle.conversion).toMatchObject({
      sourceSchemaVersion: 1, sourceRevision: 1,
      mechanical: { mappings: [{ sourceRowIndex: 0 }] },
    });
    expect(lifecycle.items[0]).toMatchObject({
      revision: 1, sourceRevision: 2, sourceRowIndex: 0,
      origin: { schemaVersion: 1, sourceRevision: 1, sourceRowIndex: 0 },
    });
  });
});
