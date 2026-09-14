import {
  INTAKE_AREAS, INTAKE_QUESTIONS, INTAKE_SCHEMA_VERSION, parseIntakeQuestionnaire, requiredIntakeQuestionKeys,
  type IntakeAdditionalItemRef, type IntakeAnswer, type IntakeArea, type IntakeQuestion, type IntakeQuestionKey,
  type IntakeModuleSnapshot, type IntakeQuestionnaire, type IntakeQuestionWithdrawalInput, type IntakeResponseCode,
  type IntakeSavedRecord,
} from '@ccc/contracts/intake';
import { BusinessError } from './errors';

// Display-only labels. Questions, area vocabulary and applicability live in @ccc/contracts/intake.
export const INTAKE_RESPONSE_LABELS: Record<IntakeResponseCode, string> = {
  answered: '답변함', declined: '답변 거부', unknown: '모름', not_applicable: '해당 없음',
};
export const INTAKE_TABLE_FIELDS = {
  linkedOrgs: { title: '연계 기관과 서비스', columns: [
    ['orgName', '기관명'], ['serviceName', '서비스명'], ['supportDetail', '지원 내용'], ['usagePeriod', '이용 기간'], ['progressStatus', '진행 상태'],
  ] },
  additionalItems: { title: '다음에 물어볼 것', columns: [['item', '물어볼 내용'], ['dueNote', '확인할 시점']] },
  debts: { title: '금융지원 채무 현황', columns: [
    ['creditor', '기관 또는 채권자'], ['kind', '구분'], ['balance', '잔액'], ['monthlyPayment', '월 상환액'], ['arrearsStatus', '연체 상태'],
  ] },
} as const;
export type IntakeTableName = keyof typeof INTAKE_TABLE_FIELDS;
export interface AnswerDraft { response: IntakeResponseCode | ''; text: string; choices: string[]; amount: string }
export type IntakeRowStatus = 'new' | 'retained' | 'withdrawn' | 'confirmed' | 'confirmation_required';
export interface TableRowDraft {
  values: Record<string, string>;
  originalValues: Record<string, string> | null;
  questionId: string | null;
  expectedRevision: number | null;
  legacySourceRowIndex?: number;
  withdrawalRequested: boolean;
  status: IntakeRowStatus;
}
export interface TableDraft { response: IntakeResponseCode | ''; rows: TableRowDraft[]; lifecycleRows: TableRowDraft[] }
export interface IntakeDraft {
  answers: Partial<Record<IntakeQuestionKey, AnswerDraft>>;
  tables: Record<IntakeTableName, TableDraft>;
  lifecycleCounts: { retained: number; withdrawn: number; confirmed: number };
}
export const emptyAnswer = (): AnswerDraft => ({ response: '', text: '', choices: [], amount: '' });
export const newIntakeTableRow = (values: Record<string, string> = {}): TableRowDraft => ({
  values, originalValues: null, questionId: null, expectedRevision: null, withdrawalRequested: false, status: 'new',
});

export function intakeDraft(questionnaire: IntakeQuestionnaire | null): IntakeDraft {
  const answers: IntakeDraft['answers'] = {};
  for (const answer of questionnaire?.answers ?? []) {
    answers[answer.key] = { ...emptyAnswer(), response: answer.response,
      text: 'text' in answer ? answer.text : '', choices: 'choices' in answer ? [...answer.choices] : [],
      amount: 'amount' in answer ? String(answer.amount) : '' };
  }
  const table = (name: IntakeTableName): TableDraft => {
    const source = questionnaire?.[name];
    return { response: source?.response ?? '', rows: source?.response === 'answered'
      ? source.rows.map((row) => newIntakeTableRow({ ...row } as Record<string, string>)) : [], lifecycleRows: [] };
  };
  return {
    answers,
    tables: { linkedOrgs: table('linkedOrgs'), additionalItems: table('additionalItems'), debts: table('debts') },
    lifecycleCounts: { retained: 0, withdrawn: 0, confirmed: 0 },
  };
}

function legacyAdditionalItems(detailsJson: string | null): Record<string, string>[] {
  if (detailsJson === null) return [];
  let value: unknown;
  try { value = JSON.parse(detailsJson); } catch { throw new BusinessError('invalid_response'); }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new BusinessError('invalid_response');
  if (!Object.hasOwn(value, 'additionalItems')) return [];
  const rows = (value as Record<string, unknown>).additionalItems;
  if (!Array.isArray(rows) || rows.some((row) => row === null || typeof row !== 'object' || Array.isArray(row)
    || typeof (row as Record<string, unknown>).item !== 'string' || String((row as Record<string, unknown>).item).trim() === ''
    || (Object.hasOwn(row, 'dueNote') && typeof (row as Record<string, unknown>).dueNote !== 'string'))) {
    throw new BusinessError('invalid_response');
  }
  return rows.map((row) => ({ ...(row as Record<string, string>) }));
}

function intakeSourceRows(saved: IntakeSavedRecord, revision: number): Record<string, string>[] {
  if (revision === saved.revision) {
    if (saved.schemaVersion === 1) return legacyAdditionalItems(saved.legacyDetailsJson);
    return saved.questionnaire.additionalItems.response === 'answered'
      ? saved.questionnaire.additionalItems.rows.map((row) => ({ ...row } as Record<string, string>)) : [];
  }
  const historical = saved.history.find((entry) => entry.revision === revision);
  if (historical === undefined) throw new BusinessError('invalid_response');
  if (historical.schemaVersion === 1) return legacyAdditionalItems(historical.detailsJson);
  let value: unknown;
  try { value = historical.detailsJson === null ? null : JSON.parse(historical.detailsJson); }
  catch { throw new BusinessError('invalid_response'); }
  try {
    const questionnaire = parseIntakeQuestionnaire(value);
    return questionnaire.additionalItems.response === 'answered'
      ? questionnaire.additionalItems.rows.map((row) => ({ ...row } as Record<string, string>)) : [];
  } catch { throw new BusinessError('invalid_response'); }
}

export function intakeDraftFromSaved(saved: IntakeSavedRecord): IntakeDraft {
  const draft = intakeDraft(saved.schemaVersion === 2 ? saved.questionnaire : null);
  const sourceRows = saved.schemaVersion === 2 && saved.questionnaire.additionalItems.response === 'answered'
    ? saved.questionnaire.additionalItems.rows.map((row) => ({ ...row } as Record<string, string>))
    : saved.schemaVersion === 1 ? legacyAdditionalItems(saved.legacyDetailsJson) : [];
  if (saved.schemaVersion === 1 && sourceRows.length > 0) {
    draft.tables.additionalItems = {
      response: 'answered', rows: sourceRows.map((values) => newIntakeTableRow(values)), lifecycleRows: [],
    };
  }
  if (saved.questionLifecycle === null) {
    draft.tables.additionalItems.rows = draft.tables.additionalItems.rows.map((row, legacySourceRowIndex) => ({
      ...row, legacySourceRowIndex, status: 'confirmation_required',
    }));
    return draft;
  }
  const current = new Map(saved.questionLifecycle.items
    .filter((item) => item.sourceRevision === saved.revision)
    .map((item) => [item.sourceRowIndex, item]));
  const rows: TableRowDraft[] = [];
  for (const [sourceRowIndex, values] of sourceRows.entries()) {
    const item = current.get(sourceRowIndex);
    if (item === undefined) throw new BusinessError('invalid_response');
    if (item.withdrawn === null) rows.push({
      values, originalValues: { ...values }, questionId: item.id, expectedRevision: item.revision, withdrawalRequested: false,
      status: item.origin === null ? 'retained' : 'confirmed',
    });
  }
  draft.tables.additionalItems.rows = rows;
  draft.tables.additionalItems.lifecycleRows = saved.questionLifecycle.items.map((item) => {
    const values = intakeSourceRows(saved, item.sourceRevision)[item.sourceRowIndex];
    if (values === undefined) throw new BusinessError('invalid_response');
    return {
      values, originalValues: { ...values }, questionId: item.id, expectedRevision: item.revision,
      withdrawalRequested: false,
      status: item.withdrawn !== null ? 'withdrawn' : item.origin === null ? 'retained' : 'confirmed',
    };
  });
  draft.lifecycleCounts = saved.questionLifecycle.items.reduce((counts, item) => {
    if (item.withdrawn !== null) counts.withdrawn += 1;
    else if (item.origin !== null) counts.confirmed += 1;
    else counts.retained += 1;
    return counts;
  }, { retained: 0, withdrawn: 0, confirmed: 0 });
  return draft;
}

export function buildIntakeMutationMetadata(draft: IntakeDraft): {
  additionalItemRefs: IntakeAdditionalItemRef[];
  questionWithdrawals: IntakeQuestionWithdrawalInput[];
} {
  const rows = draft.tables.additionalItems.rows;
  const additionalItemRefs: IntakeAdditionalItemRef[] = draft.tables.additionalItems.response === 'answered'
    ? rows.map((row, rowIndex) => {
      if (row.questionId === null) {
        if (row.expectedRevision !== null) throw new BusinessError('invalid_request', 400);
        return { rowIndex, questionId: null, expectedRevision: null,
          ...(row.legacySourceRowIndex === undefined ? {} : { legacySourceRowIndex: row.legacySourceRowIndex }) };
      }
      if (row.expectedRevision === null || row.legacySourceRowIndex !== undefined) throw new BusinessError('invalid_request', 400);
      return { rowIndex, questionId: row.questionId, expectedRevision: row.expectedRevision };
    }) : [];
  const questionWithdrawals = [...rows, ...draft.tables.additionalItems.lifecycleRows]
    .flatMap((row) => row.withdrawalRequested && row.questionId !== null && row.expectedRevision !== null
      ? [{ questionId: row.questionId, expectedRevision: row.expectedRevision }] : []);
  return { additionalItemRefs, questionWithdrawals };
}

export function selectedIntakeAreas(draft: IntakeDraft): IntakeArea[] {
  const answer = draft.answers.difficulty_areas;
  return answer?.response === 'answered' ? INTAKE_AREAS.filter((area) => answer.choices.includes(area)) : [];
}

export function buildIntakeQuestionnaire(draft: IntakeDraft, moduleSnapshot: IntakeModuleSnapshot): IntakeQuestionnaire {
  const areas = selectedIntakeAreas(draft);
  const answers: IntakeAnswer[] = requiredIntakeQuestionKeys(areas).map((key): IntakeAnswer => {
    const answer = draft.answers[key];
    if (!answer || answer.response === '') throw new BusinessError('invalid_request', 400);
    if (answer.response !== 'answered') return { key, response: answer.response };
    const question: IntakeQuestion = INTAKE_QUESTIONS[key];
    if (question.kind === 'multiple') return { key, response: 'answered', choices: [...answer.choices] };
    if (question.kind === 'money') {
      if (!/^\d+$/.test(answer.amount)) throw new BusinessError('invalid_request', 400);
      return { key, response: 'answered', amount: Number(answer.amount) };
    }
    return { key, response: 'answered', text: answer.text };
  });
  const table = (name: IntakeTableName) => {
    const source = draft.tables[name];
    if (source.response === '') throw new BusinessError('invalid_request', 400);
    if (source.response !== 'answered') return { response: source.response };
    return { response: 'answered', rows: source.rows.map((row) => Object.fromEntries(
      INTAKE_TABLE_FIELDS[name].columns.filter(([key]) => row.values[key]?.trim()).map(([key]) => [key, row.values[key]]),
    )) };
  };
  try {
    return parseIntakeQuestionnaire({ schemaVersion: INTAKE_SCHEMA_VERSION, moduleSnapshot, answers,
      linkedOrgs: table('linkedOrgs'), additionalItems: table('additionalItems'),
      debts: moduleSnapshot.financialSupportEnabled && areas.includes('economy') ? table('debts') : null });
  } catch { throw new BusinessError('invalid_request', 400); }
}
