import {
  INTAKE_AREAS, INTAKE_QUESTIONS, INTAKE_SCHEMA_VERSION, parseIntakeQuestionnaire, requiredIntakeQuestionKeys,
  type IntakeAnswer, type IntakeArea, type IntakeQuestion, type IntakeQuestionKey,
  type IntakeModuleSnapshot, type IntakeQuestionnaire, type IntakeResponseCode,
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
export interface TableDraft { response: IntakeResponseCode | ''; rows: Record<string, string>[] }
export interface IntakeDraft {
  answers: Partial<Record<IntakeQuestionKey, AnswerDraft>>;
  tables: Record<IntakeTableName, TableDraft>;
}
export const emptyAnswer = (): AnswerDraft => ({ response: '', text: '', choices: [], amount: '' });

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
      ? source.rows.map((row) => ({ ...row } as Record<string, string>)) : [] };
  };
  return { answers, tables: { linkedOrgs: table('linkedOrgs'), additionalItems: table('additionalItems'), debts: table('debts') } };
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
      INTAKE_TABLE_FIELDS[name].columns.filter(([key]) => row[key]?.trim()).map(([key]) => [key, row[key]]),
    )) };
  };
  try {
    return parseIntakeQuestionnaire({ schemaVersion: INTAKE_SCHEMA_VERSION, moduleSnapshot, answers,
      linkedOrgs: table('linkedOrgs'), additionalItems: table('additionalItems'),
      debts: moduleSnapshot.financialSupportEnabled && areas.includes('economy') ? table('debts') : null });
  } catch { throw new BusinessError('invalid_request', 400); }
}
