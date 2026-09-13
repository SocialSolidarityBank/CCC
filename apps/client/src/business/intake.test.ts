import { describe, expect, it } from 'vitest';
import { CONSENT_DOMAINS } from '@ccc/contracts/consent';
import { requiredIntakeQuestionKeys, type IntakeSavedRecord } from '@ccc/contracts/intake';
import { buildIntakeQuestionnaire, intakeDraft } from './intake-form';
import { decodeIntakeContext, IntakeApi } from './intake';
import { BusinessError } from './errors';
import { intakeModule, intakeQuestionnaire } from './test-support';

const caseId = 'case-1';
const heldAt = '2026-09-01T01:00:00.000Z';
const context = (saved: IntakeSavedRecord | null = null) => ({
  beneficiaryId: 'swallow-003', supportCaseId: caseId, participant: { name: null, phone: null, email: null },
  sessionSequence: 1, hasIntake: saved !== null, canWrite: false, writeSchemaVersion: 2, moduleSnapshot: intakeModule,
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
    draft.tables.linkedOrgs = { response: 'declined', rows: [{ orgName: 'do not send' }] };
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
    draft.tables.debts = { response: 'answered', rows: [{ creditor: '합성 기관' }] };
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
});

describe('versioned intake HTTP decoder', () => {
  it('retains legacy JSON and prior revision provenance without reclassifying old values', () => {
    const legacyDetailsJson = '{ "answers": [{"key":"summary_urgency","response":"answered","text":"즉시 개입 필요"}], "family_care_burden":"복수 돌봄" }';
    const saved: IntakeSavedRecord = { sessionId: 'intake-1', heldAt, channel: 'phone', revision: 2,
      schemaVersion: 1, questionnaire: null, legacyDetailsJson,
      history: [{ revision: 1, schemaVersion: 1, heldAt, channel: 'video', actorId: null,
        recordedAt: heldAt, convertedFromRevision: null, detailsJson: '{"old":true}' }] };
    expect(decodeIntakeContext(context(saved), caseId).saved).toEqual(saved);
    expect(() => decodeIntakeContext({ ...context(saved), saved: { ...saved, history: [{ ...saved.history[0], revision: 2 }] } }, caseId)).toThrow(BusinessError);
    expect(() => decodeIntakeContext({ ...context(saved), writeSchemaVersion: 1 }, caseId)).toThrow(BusinessError);
  });

  it('reads a saved module snapshot independently of the current program setting', () => {
    const questionnaire = intakeQuestionnaire({ ...intakeModule, financialSupportEnabled: true }, ['economy']);
    const saved: IntakeSavedRecord = { sessionId: 'intake-1', heldAt, channel: 'video', revision: 1,
      schemaVersion: 2, questionnaire, legacyDetailsJson: null, history: [] };
    const decoded = decodeIntakeContext(context(saved), caseId);
    expect(decoded.moduleSnapshot.financialSupportEnabled).toBe(false);
    expect(decoded.saved).toEqual(saved);
  });

  it('uses only the v2 write contract, preserving channel/revision/conversion and propagating conflict', async () => {
    const sent: Array<{ method: string; body: unknown }> = [];
    const api = new IntakeApi({ request: async (_path: string, method: string, body: unknown) => {
      sent.push({ method, body });
      if (sent.length > 1) throw new BusinessError('conflict', 409);
      return { schemaVersion: 2, revision: 4, replayed: false, record: { id: 'intake-1', heldAt, channel: 'phone', kind: 'intake' } };
    } } as never);
    const input = { schemaVersion: 2 as const, expectedRevision: 3, heldAt, channel: 'phone' as const,
      questionnaire: intakeQuestionnaire(), conversion: { confirmed: true as const, sourceRevision: 3 } };
    expect((await api.update(caseId, input)).revision).toBe(4);
    expect(sent[0]).toEqual({ method: 'PUT', body: input });
    await expect(api.update(caseId, input)).rejects.toMatchObject({ code: 'conflict', status: 409 });
    expect(sent).toHaveLength(2);
    await expect(api.create(caseId, { schemaVersion: 1, answers: [] } as never)).rejects.toMatchObject({ code: 'invalid_request' });
    expect(sent).toHaveLength(2);
  });
});
