// 상담 기록 확인하기와 상담 기록하기의 API 경계 (P5 첫 묶음).
// 수기 기록은 저장 즉시 공식 기록이고(D5), AI 초안은 승인 전까지 이 화면에 오르지 않는다(R2).

import { INTAKE_AREAS } from '@ccc/contracts/intake';
import {
  MANUAL_RECORD_CONTEXT_SCHEMA_VERSION, MANUAL_RECORD_METHODS, MANUAL_RECORD_REASONS, MANUAL_RECORD_SCHEMA_VERSION,
  MANUAL_RECORD_URGENCIES, ManualRecordContractError, parseCreateManualRecord,
  type CreateManualRecordInput, type ManualActionOutcome, type ManualActionRevision, type ManualOpenAction,
  type ManualPendingQuestion, type ManualQuestionAnswerInput, type ManualQuestionOutcome,
  type ManualRecordContext as ContractManualRecordContext, type ManualRecordDetails, type ManualRecordProjection,
  type ManualRecordRevision,
} from '@ccc/contracts/manual-record';
import { isNullableString, isOpaqueIdentifier, record } from './api';
import { BusinessError } from './errors';
import type { BusinessTransport } from './transport';

/** D72 고정 유형 6종. 값은 서버 정본과 같은 식별자다. */
export const FLAG_TYPES = [
  'crisis_utterance', 'contact_loss_risk', 'housing_livelihood_shock',
  'debt_deterioration', 'repeated_noncompliance', 'violence_exploitation',
] as const;
export type FlagType = (typeof FLAG_TYPES)[number];
export const FLAG_LABELS: Record<FlagType, string> = {
  crisis_utterance: '위기 발언',
  contact_loss_risk: '연락 두절 위험',
  housing_livelihood_shock: '주거, 생계, 건강 급변',
  debt_deterioration: '부채 악화',
  repeated_noncompliance: '약속 불이행',
  violence_exploitation: '폭력, 착취 피해',
};

export const RECORD_DETAIL_KEYS = ['counselorOpinion'] as const;
export type RecordDetailKey = (typeof RECORD_DETAIL_KEYS)[number];
export const RECORD_DETAIL_LABELS: Record<RecordDetailKey, string> = {
  counselorOpinion: '담당 실무자 종합의견',
};

export type ActionOwner = 'counselor' | 'beneficiary' | 'org';
export const ACTION_OWNER_LABELS: Record<ActionOwner, string> = {
  counselor: '실무자', beneficiary: '당사자', org: '기관',
};

export interface RecordActionInput {
  description: string;
  owner: ActionOwner;
  dueDate?: string;
}

export type ManualRecordContext = ContractManualRecordContext;
export type { ManualPendingQuestion, ManualQuestionAnswerInput };

export interface CounselingRecordRow {
  id: string;
  heldAt: string;
  kind: 'regular' | 'intake';
  memo: string;
  /** 승인된 AI 한 줄만 온다. null이면 화면은 수기 발췌로 낮추고 수기 배지를 단다(R2·D5). */
  aiOneLiner: string | null;
  memoExcerpt: string | null;
  manual: ManualRecordProjection | null;
  actionItems: Array<{ id: string; description: string; owner: string; dueDate: string | null; resolved: boolean }>;
  flags: Array<{ id: string; flagType: string; reviewStatus: string; quote: string | null }>;
}

export interface CounselingRecordList {
  records: CounselingRecordRow[];
  goals: Array<{ id: string; title: string; status: string }>;
  overallGoal: string | null;
  caseStatus: 'active' | 'closed';
  /** '기록 오류'로 처리된 불일치가 가리키는 회차. 원본은 바뀌지 않고 표시만 붙는다(D45). */
  recordErrorSessionIds: string[];
  nextSchedule: { id: string; scheduledAt: string; version: number } | null;
}

function utcInstant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
const nullableInstant = (value: unknown): value is string | null => value === null || utcInstant(value);
const oneOf = <Values extends readonly string[]>(value: unknown, values: Values): value is Values[number] =>
  typeof value === 'string' && values.includes(value);

function decodeQuestionOutcome(value: unknown): ManualQuestionOutcome {
  const row = record(value);
  if (!isOpaqueIdentifier(row.sessionId) || !utcInstant(row.heldAt)
    || (row.outcome !== 'confirmed' && row.outcome !== 'unconfirmed') || !isNullableString(row.answer)
    || !positiveInteger(row.sourceRevision) || typeof row.sourceText !== 'string') throw new BusinessError('invalid_response');
  return {
    sessionId: row.sessionId, heldAt: row.heldAt, outcome: row.outcome, answer: row.answer,
    sourceRevision: row.sourceRevision, sourceText: row.sourceText,
  };
}

function decodeQuestion(value: unknown): ManualPendingQuestion {
  const row = record(value);
  if (!oneOf(row.kind, ['schedule', 'record', 'intake'] as const) || !isOpaqueIdentifier(row.id)
    || !isOpaqueIdentifier(row.sourceId) || !positiveInteger(row.sourceRevision)
    || !(row.sourceSessionId === null || isOpaqueIdentifier(row.sourceSessionId))
    || !nullableInstant(row.sourceHeldAt) || !nullableInstant(row.sourceScheduledAt) || !utcInstant(row.createdAt)
    || typeof row.body !== 'string' || !oneOf(row.state, ['open', 'confirmed', 'withdrawn'] as const)
    || !Array.isArray(row.outcomes)) throw new BusinessError('invalid_response');
  return {
    kind: row.kind, id: row.id, sourceId: row.sourceId, sourceRevision: row.sourceRevision,
    sourceSessionId: row.sourceSessionId, sourceHeldAt: row.sourceHeldAt, sourceScheduledAt: row.sourceScheduledAt,
    createdAt: row.createdAt, body: row.body, state: row.state, outcomes: row.outcomes.map(decodeQuestionOutcome),
  };
}

function decodeActionOutcome(value: unknown): ManualActionOutcome {
  const row = record(value);
  if (!isOpaqueIdentifier(row.actionItemId) || !isOpaqueIdentifier(row.sessionId) || !utcInstant(row.heldAt)
    || !positiveInteger(row.sourceRevision) || !oneOf(row.outcome, ['done', 'in_progress', 'not_done', 'unconfirmed'] as const)
    || !(row.continuation === null || oneOf(row.continuation, ['continue', 'stop'] as const)) || !isNullableString(row.reason)) {
    throw new BusinessError('invalid_response');
  }
  return {
    actionItemId: row.actionItemId, sessionId: row.sessionId, heldAt: row.heldAt, sourceRevision: row.sourceRevision,
    outcome: row.outcome, continuation: row.continuation, reason: row.reason,
  };
}

function decodeActionRevision(value: unknown): ManualActionRevision {
  const row = record(value);
  if (!positiveInteger(row.revision) || typeof row.description !== 'string'
    || !oneOf(row.owner, ['counselor', 'beneficiary', 'org'] as const) || !isNullableString(row.dueDate)
    || !(row.resolutionStatus === null || oneOf(row.resolutionStatus, ['done', 'in_progress', 'not_done', 'hold'] as const))
    || !isNullableString(row.resolutionNote) || !(row.sourceSessionId === null || isOpaqueIdentifier(row.sourceSessionId))
    || !nullableInstant(row.resolvedAt) || !isNullableString(row.stopReason)) throw new BusinessError('invalid_response');
  return {
    revision: row.revision, description: row.description, owner: row.owner, dueDate: row.dueDate,
    resolutionStatus: row.resolutionStatus, resolutionNote: row.resolutionNote,
    sourceSessionId: row.sourceSessionId, resolvedAt: row.resolvedAt, stopReason: row.stopReason,
  };
}

function decodeOpenAction(value: unknown): ManualOpenAction {
  const row = record(value);
  if (!isOpaqueIdentifier(row.id) || !positiveInteger(row.revision)
    || !(row.sourceSessionId === null || isOpaqueIdentifier(row.sourceSessionId))
    || !nullableInstant(row.sourceHeldAt) || !utcInstant(row.createdAt) || typeof row.description !== 'string'
    || !oneOf(row.owner, ['counselor', 'beneficiary', 'org'] as const) || !isNullableString(row.dueDate)
    || !oneOf(row.state, ['open', 'done', 'stopped'] as const) || !Array.isArray(row.history)
    || !Array.isArray(row.outcomes)) throw new BusinessError('invalid_response');
  return {
    id: row.id, revision: row.revision, sourceSessionId: row.sourceSessionId, sourceHeldAt: row.sourceHeldAt,
    createdAt: row.createdAt, description: row.description, owner: row.owner, dueDate: row.dueDate, state: row.state,
    history: row.history.map(decodeActionRevision), outcomes: row.outcomes.map(decodeActionOutcome),
  };
}

function decodeManualDetails(value: unknown): ManualRecordDetails {
  const row = record(value);
  if (row.schemaVersion !== MANUAL_RECORD_SCHEMA_VERSION || !oneOf(row.method, MANUAL_RECORD_METHODS)
    || !(row.reason === null || oneOf(row.reason, MANUAL_RECORD_REASONS))
    || !(row.urgency === null || oneOf(row.urgency, MANUAL_RECORD_URGENCIES))
    || !Array.isArray(row.changes) || !isNullableString(row.counselorOpinion) || !Array.isArray(row.nextQuestions)) {
    throw new BusinessError('invalid_response');
  }
  const changes = row.changes.map((entry) => {
    const change = record(entry);
    if (!oneOf(change.area, INTAKE_AREAS) || typeof change.text !== 'string') throw new BusinessError('invalid_response');
    return { area: change.area, text: change.text };
  });
  const nextQuestions = row.nextQuestions.map((entry) => {
    const question = record(entry);
    if (!isOpaqueIdentifier(question.id) || typeof question.body !== 'string') throw new BusinessError('invalid_response');
    return { id: question.id, body: question.body };
  });
  return {
    schemaVersion: MANUAL_RECORD_SCHEMA_VERSION, method: row.method, reason: row.reason, urgency: row.urgency,
    changes, counselorOpinion: row.counselorOpinion, nextQuestions,
  };
}

function decodeManualRevision(value: unknown): ManualRecordRevision {
  const row = record(value);
  if (!positiveInteger(row.revision) || (row.schemaVersion !== 1 && row.schemaVersion !== 2)
    || !utcInstant(row.heldAt) || !oneOf(row.channel, ['in_person', 'phone', 'video'] as const)
    || !isNullableString(row.memo) || !isNullableString(row.detailsJson) || !utcInstant(row.recordedAt)
    || !isNullableString(row.actorId)) throw new BusinessError('invalid_response');
  return {
    revision: row.revision, schemaVersion: row.schemaVersion, heldAt: row.heldAt, channel: row.channel,
    memo: row.memo, detailsJson: row.detailsJson, recordedAt: row.recordedAt, actorId: row.actorId,
  };
}

function decodeManualProjection(value: unknown): ManualRecordProjection {
  const row = record(value);
  if ((row.schemaVersion !== 1 && row.schemaVersion !== 2) || !positiveInteger(row.revision)
    || !Array.isArray(row.history) || !Array.isArray(row.actionOutcomes) || !Array.isArray(row.questionOutcomes)) {
    throw new BusinessError('invalid_response');
  }
  const details = row.details === null ? null : decodeManualDetails(row.details);
  if ((row.schemaVersion === 1 && details !== null) || (row.schemaVersion === 2 && details === null)
    || !isNullableString(row.legacyDetailsJson) || (row.schemaVersion === 2 && row.legacyDetailsJson !== null)) {
    throw new BusinessError('invalid_response');
  }
  return {
    schemaVersion: row.schemaVersion, revision: row.revision, details, legacyDetailsJson: row.legacyDetailsJson,
    history: row.history.map(decodeManualRevision), actionOutcomes: row.actionOutcomes.map(decodeActionOutcome),
    questionOutcomes: row.questionOutcomes.map((entry) => {
      const outcome = record(entry);
      if (!oneOf(outcome.kind, ['schedule', 'record', 'intake'] as const)
        || !isOpaqueIdentifier(outcome.questionId) || !isOpaqueIdentifier(outcome.sourceId)) {
        throw new BusinessError('invalid_response');
      }
      return { ...decodeQuestionOutcome(outcome), kind: outcome.kind, questionId: outcome.questionId, sourceId: outcome.sourceId };
    }),
  };
}

export function decodeManualRecordContext(value: unknown, supportCaseId: string): ManualRecordContext {
  const row = record(value);
  const defaults = record(row.defaults);
  if (row.schemaVersion !== MANUAL_RECORD_CONTEXT_SCHEMA_VERSION || row.supportCaseId !== supportCaseId
    || typeof row.canWrite !== 'boolean' || !Array.isArray(row.actions) || !Array.isArray(row.questions)
    || !Array.isArray(row.closedActions) || !Array.isArray(row.confirmedQuestions) || !Array.isArray(row.withdrawnQuestions)
    || !nullableInstant(defaults.heldAt) || !(defaults.channel === null || oneOf(defaults.channel, MANUAL_RECORD_METHODS))
    || defaults.reason !== null || !(defaults.scheduleId === null || isOpaqueIdentifier(defaults.scheduleId))
    || !(defaults.scheduleVersion === null || positiveInteger(defaults.scheduleVersion))
    || ((defaults.scheduleId === null) !== (defaults.scheduleVersion === null))) throw new BusinessError('invalid_response');
  const questions = row.questions.map(decodeQuestion);
  const confirmedQuestions = row.confirmedQuestions.map(decodeQuestion);
  const withdrawnQuestions = row.withdrawnQuestions.map(decodeQuestion);
  if (questions.some((question) => question.state !== 'open')
    || confirmedQuestions.some((question) => question.state !== 'confirmed')
    || withdrawnQuestions.some((question) => question.state !== 'withdrawn')
    || new Set([...questions, ...confirmedQuestions, ...withdrawnQuestions].map((question) => `${question.kind}:${question.id}`)).size
      !== questions.length + confirmedQuestions.length + withdrawnQuestions.length) throw new BusinessError('invalid_response');
  return {
    schemaVersion: MANUAL_RECORD_CONTEXT_SCHEMA_VERSION, supportCaseId, canWrite: row.canWrite,
    defaults: { heldAt: defaults.heldAt, channel: defaults.channel, reason: null,
      scheduleId: defaults.scheduleId, scheduleVersion: defaults.scheduleVersion },
    actions: row.actions.map(decodeOpenAction), questions, closedActions: row.closedActions.map(decodeOpenAction),
    confirmedQuestions, withdrawnQuestions,
  };
}

export function decodeRecordList(value: unknown): CounselingRecordList {
  const row = record(value);
  if (!Array.isArray(row.records) || !Array.isArray(row.goals) || !Array.isArray(row.recordErrorSessionIds)
    || !isNullableString(row.overallGoal)
    || (row.caseStatus !== 'active' && row.caseStatus !== 'closed')) throw new BusinessError('invalid_response');
  const schedule = row.schedule === null || row.schedule === undefined ? null : record(row.schedule);
  return {
    records: row.records.map((entry) => {
      const item = record(entry);
      if (!isOpaqueIdentifier(item.id) || !utcInstant(item.heldAt)
        || (item.kind !== 'regular' && item.kind !== 'intake')
        || typeof item.memo !== 'string' || !isNullableString(item.aiOneLiner)
        || !isNullableString(item.memoExcerpt) || !Array.isArray(item.actionItems)
        || !Array.isArray(item.flags)) throw new BusinessError('invalid_response');
      const manual = item.manual === null ? null : decodeManualProjection(item.manual);
      // 서버는 모든 기본 상담에 수기 projection을 싣고 첫 상담에만 null을 싣는다.
      if ((item.kind === 'regular') !== (manual !== null)) throw new BusinessError('invalid_response');
      return {
        id: item.id, heldAt: item.heldAt, kind: item.kind, memo: item.memo, manual,
        aiOneLiner: item.aiOneLiner, memoExcerpt: item.memoExcerpt,
        actionItems: item.actionItems.map((action) => {
          const value = record(action);
          if (!isOpaqueIdentifier(value.id) || typeof value.description !== 'string'
            || typeof value.owner !== 'string' || !isNullableString(value.dueDate)
            || typeof value.resolved !== 'boolean') throw new BusinessError('invalid_response');
          return {
            id: value.id, description: value.description, owner: value.owner,
            dueDate: value.dueDate, resolved: value.resolved,
          };
        }),
        flags: item.flags.map((flag) => {
          const value = record(flag);
          if (!isOpaqueIdentifier(value.id) || typeof value.flagType !== 'string'
            || typeof value.reviewStatus !== 'string' || !isNullableString(value.quote)) {
            throw new BusinessError('invalid_response');
          }
          return { id: value.id, flagType: value.flagType, reviewStatus: value.reviewStatus, quote: value.quote };
        }),
      };
    }),
    goals: row.goals.map((entry) => {
      const goal = record(entry);
      if (!isOpaqueIdentifier(goal.id) || typeof goal.title !== 'string' || typeof goal.status !== 'string') {
        throw new BusinessError('invalid_response');
      }
      return { id: goal.id, title: goal.title, status: goal.status };
    }),
    overallGoal: row.overallGoal,
    caseStatus: row.caseStatus,
    recordErrorSessionIds: row.recordErrorSessionIds.filter((entry): entry is string => typeof entry === 'string'),
    nextSchedule: schedule === null ? null : (() => {
      if (!isOpaqueIdentifier(schedule.id) || !utcInstant(schedule.scheduledAt)
        || typeof schedule.version !== 'number' || !Number.isSafeInteger(schedule.version)) {
        throw new BusinessError('invalid_response');
      }
      return { id: schedule.id, scheduledAt: schedule.scheduledAt, version: schedule.version };
    })(),
  };
}

export class RecordsApi {
  constructor(private readonly transport: BusinessTransport) {}

  /** 공식 기록만 읽는다. 승인 전 AI 초안은 이 목록에 오르지 않는다(R2). */
  async list(supportCaseId: string): Promise<CounselingRecordList> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    return decodeRecordList(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/records?official=true`,
    ));
  }

  async context(supportCaseId: string): Promise<ManualRecordContext> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    return decodeManualRecordContext(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/records/context`,
    ), supportCaseId);
  }

  /**
   * 저장은 `submissionId`로 재생 안전하다. 같은 값으로 다시 보내면 서버가 같은 회차를 돌려주고
   * 두 번 저장하지 않는다. 일정에 연결하면 `expectedScheduleVersion`으로 충돌을 잡는다.
   */
  async create(supportCaseId: string, input: {
    submissionId: string;
    heldAt: string;
    memo: string;
    details: Partial<Record<RecordDetailKey, string>>;
    actions: RecordActionInput[];
    flagTypes: FlagType[];
    questionAnswers: ManualQuestionAnswerInput[];
    schedule?: { id: string; expectedVersion: number };
  }): Promise<{ id: string; replayed: boolean }> {
    if (!isOpaqueIdentifier(supportCaseId) || !isOpaqueIdentifier(input.submissionId)
      || !utcInstant(input.heldAt) || input.memo.trim() === '') {
      throw new BusinessError('invalid_request', 400);
    }
    const counselorOpinion = input.details.counselorOpinion?.trim();
    const body: CreateManualRecordInput = {
      schemaVersion: MANUAL_RECORD_SCHEMA_VERSION,
      submissionId: input.submissionId,
      heldAt: input.heldAt,
      channel: 'in_person',
      memo: input.memo.trim(),
      gasScores: [],
      actionItems: input.actions.map((action) => ({
        description: action.description, owner: action.owner,
        ...(action.dueDate === undefined || action.dueDate === '' ? {} : { dueDate: action.dueDate }),
      })),
      questionAnswers: input.questionAnswers,
      flags: input.flagTypes.map((flagType) => ({ flagType })),
      ...(counselorOpinion === undefined || counselorOpinion === '' ? {} : { counselorOpinion }),
      ...(input.schedule === undefined ? {} : {
        scheduleId: input.schedule.id, expectedScheduleVersion: input.schedule.expectedVersion,
      }),
    };
    try { parseCreateManualRecord(body); }
    catch (error) {
      if (error instanceof ManualRecordContractError) throw new BusinessError('invalid_request', 400);
      throw error;
    }
    const response = record(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/records`, 'POST', body,
    ));
    const saved = record(response.record);
    if (!isOpaqueIdentifier(saved.id) || typeof response.replayed !== 'boolean') {
      throw new BusinessError('invalid_response');
    }
    return { id: saved.id, replayed: response.replayed };
  }
}

export const GOAL_CLOSE_REASONS = ['achieved', 'stopped', 'reset'] as const;
export type GoalCloseReason = (typeof GOAL_CLOSE_REASONS)[number];
export const GOAL_CLOSE_LABELS: Record<GoalCloseReason, string> = {
  achieved: '달성', stopped: '중단', reset: '재설정',
};

/** 불일치 종류 2종. 화면은 사람이 읽는 이름으로 옮기고 식별자를 그대로 보이지 않는다. */
export const DISCREPANCY_KIND_LABELS: Record<string, string> = {
  cross_session: '회차 간 불일치', within_session: '회차 안 모순',
};

export const DISCREPANCY_RESOLUTIONS = ['situation_changed', 'record_error', 'confirmed'] as const;
export type DiscrepancyResolution = (typeof DISCREPANCY_RESOLUTIONS)[number];
export const DISCREPANCY_RESOLUTION_LABELS: Record<DiscrepancyResolution, string> = {
  situation_changed: '상황 변경', record_error: '기록 오류', confirmed: '확인 완료',
};

export interface GoalRevision { title: string | null; editedByName: string | null; editedAt: string }
export interface GoalTreeGoal {
  id: string;
  title: string;
  status: 'active' | 'closed';
  closedReason: string | null;
  closedAt: string | null;
  /** 문구 이력, 최신부터. 최초 작성이 마지막 행이다(D62). */
  revisions: GoalRevision[];
  linkedSessions: Array<{ sessionId: string; heldAt: string; oneLiner: string | null }>;
}
export interface GoalTreeCase {
  supportCaseId: string;
  status: 'active' | 'closed';
  overallGoal: string | null;
  overallGoalRevisions: GoalRevision[];
  goals: GoalTreeGoal[];
}

export interface ClosureInfo {
  supportCaseId: string;
  status: 'active' | 'closed';
  closedAt: string | null;
  closedReason: string | null;
  purgeDue: string | null;
  purgedAt: string | null;
  hasOtherActiveSupportCase: boolean;
}

function decodeRevisions(value: unknown): GoalRevision[] {
  if (!Array.isArray(value)) throw new BusinessError('invalid_response');
  return value.map((entry) => {
    const row = record(entry);
    if (!isNullableString(row.title) || !isNullableString(row.editedByName)
      || typeof row.editedAt !== 'string') throw new BusinessError('invalid_response');
    return { title: row.title, editedByName: row.editedByName, editedAt: row.editedAt };
  });
}

export function decodeGoalTree(value: unknown): GoalTreeCase[] {
  const row = record(value);
  if (!Array.isArray(row.cases)) throw new BusinessError('invalid_response');
  return row.cases.map((entry) => {
    const item = record(entry);
    const source = record(item.sourceSupportCase);
    if (!isOpaqueIdentifier(source.id) || (source.status !== 'active' && source.status !== 'closed')
      || !isNullableString(item.overallGoal) || !Array.isArray(item.goals)) {
      throw new BusinessError('invalid_response');
    }
    return {
      supportCaseId: source.id, status: source.status, overallGoal: item.overallGoal,
      overallGoalRevisions: decodeRevisions(item.overallGoalRevisions),
      goals: item.goals.map((goalValue) => {
        const goal = record(goalValue);
        if (!isOpaqueIdentifier(goal.id) || typeof goal.title !== 'string'
          || (goal.status !== 'active' && goal.status !== 'closed')
          || !isNullableString(goal.closedReason) || !isNullableString(goal.closedAt)
          || !Array.isArray(goal.linkedSessions)) throw new BusinessError('invalid_response');
        return {
          id: goal.id, title: goal.title, status: goal.status, closedReason: goal.closedReason,
          closedAt: goal.closedAt, revisions: decodeRevisions(goal.revisions),
          linkedSessions: goal.linkedSessions.map((linked) => {
            const session = record(linked);
            if (!isOpaqueIdentifier(session.sessionId) || typeof session.heldAt !== 'string'
              || !isNullableString(session.oneLiner)) throw new BusinessError('invalid_response');
            return { sessionId: session.sessionId, heldAt: session.heldAt, oneLiner: session.oneLiner };
          }),
        };
      }),
    };
  });
}

export class CaseWorkApi {
  constructor(private readonly transport: BusinessTransport) {}

  /** 세부 목표 트리와 문구 이력. 담당 사업만 실린다(D62 §8). */
  async goalTree(beneficiaryId: string): Promise<GoalTreeCase[]> {
    if (!isOpaqueIdentifier(beneficiaryId)) throw new BusinessError('invalid_request', 400);
    return decodeGoalTree(await this.transport.request(
      `/participants/${encodeURIComponent(beneficiaryId)}/goal-tree`,
    ));
  }

  private goalId(value: unknown): string {
    const row = record(value);
    if (!isOpaqueIdentifier(row.id)) throw new BusinessError('invalid_response');
    return row.id;
  }

  /** 세부 목표 신설. GAS 채점 기준은 D43대로 보내지 않는다. */
  async createGoal(supportCaseId: string, title: string): Promise<string> {
    if (!isOpaqueIdentifier(supportCaseId) || title.trim() === '') throw new BusinessError('invalid_request', 400);
    return this.goalId(await this.transport.request(
      `/cases/${encodeURIComponent(supportCaseId)}/goals`, 'POST', { title: title.trim() },
    ));
  }

  /** 문구 수정. 이전 문구는 서버가 이력으로 남긴다(D62 §4). */
  async retitleGoal(goalId: string, title: string): Promise<string> {
    if (!isOpaqueIdentifier(goalId) || title.trim() === '') throw new BusinessError('invalid_request', 400);
    return this.goalId(await this.transport.request(
      `/goals/${encodeURIComponent(goalId)}/title`, 'PUT', { title: title.trim() },
    ));
  }

  /** 닫기 전 안내용. 미래 회기 연결 수는 닫기를 막지 않는다(D62 §5). */
  async goalUpcomingLinks(goalId: string): Promise<number> {
    if (!isOpaqueIdentifier(goalId)) throw new BusinessError('invalid_request', 400);
    const row = record(await this.transport.request(`/goals/${encodeURIComponent(goalId)}/upcoming-links`));
    if (typeof row.upcomingCount !== 'number' || !Number.isSafeInteger(row.upcomingCount)) {
      throw new BusinessError('invalid_response');
    }
    return row.upcomingCount;
  }

  /** 닫기는 활성과 종료 2종이고 재개는 없다(D62 §5). */
  async closeGoal(goalId: string, reason: GoalCloseReason): Promise<string> {
    if (!isOpaqueIdentifier(goalId)) throw new BusinessError('invalid_request', 400);
    return this.goalId(await this.transport.request(
      `/goals/${encodeURIComponent(goalId)}/close`, 'POST', { reason },
    ));
  }

  /** 액션 등록. 담당과 기한은 실무자가 정한다. AI가 추정하지 않는다(D70). */
  async createActionItem(supportCaseId: string, input:
    { description: string; owner: ActionOwner; dueDate?: string; sessionId?: string },
  ): Promise<string> {
    if (!isOpaqueIdentifier(supportCaseId) || input.description.trim() === '') {
      throw new BusinessError('invalid_request', 400);
    }
    const row = record(await this.transport.request(
      `/cases/${encodeURIComponent(supportCaseId)}/action-items`, 'POST',
      {
        description: input.description.trim(), owner: input.owner,
        ...(input.dueDate === undefined || input.dueDate === '' ? {} : { dueDate: input.dueDate }),
        ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
      },
    ));
    if (!isOpaqueIdentifier(row.id)) throw new BusinessError('invalid_response');
    return row.id;
  }

  /** 불일치 처리 3종. 표시일 뿐 원본 기록은 바뀌지 않는다(D45 영역 ③). */
  async resolveDiscrepancy(
    supportCaseId: string, discrepancyId: string, status: DiscrepancyResolution,
  ): Promise<void> {
    if (!isOpaqueIdentifier(supportCaseId) || !isOpaqueIdentifier(discrepancyId)) {
      throw new BusinessError('invalid_request', 400);
    }
    await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/discrepancies/${encodeURIComponent(discrepancyId)}/resolution`,
      'PUT', { status },
    );
  }

  async closure(supportCaseId: string): Promise<ClosureInfo> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    return this.decodeClosure(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/closure`,
    ), supportCaseId);
  }

  /** 종결은 사유가 필수다. 보관 시계는 서버가 정하고 화면이 계산하지 않는다(D10). */
  async close(supportCaseId: string, reason: string): Promise<ClosureInfo> {
    if (!isOpaqueIdentifier(supportCaseId) || reason.trim() === '') {
      throw new BusinessError('invalid_request', 400);
    }
    const closed = await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/close`, 'POST', { reason: reason.trim() },
    );
    const row = record(closed);
    // 종결 응답은 케이스 자체다. 화면이 쓰는 값은 종결 조회와 같은 모양으로 다시 읽는다.
    if (!isOpaqueIdentifier(row.id) && !isOpaqueIdentifier(row.supportCaseId)) {
      throw new BusinessError('invalid_response');
    }
    return this.closure(supportCaseId);
  }

  private decodeClosure(value: unknown, supportCaseId: string): ClosureInfo {
    const row = record(value);
    if (row.supportCaseId !== supportCaseId || (row.status !== 'active' && row.status !== 'closed')
      || !isNullableString(row.closedAt) || !isNullableString(row.closedReason)
      || !isNullableString(row.purgeDue) || !isNullableString(row.purgedAt)
      || typeof row.hasOtherActiveSupportCase !== 'boolean') throw new BusinessError('invalid_response');
    return {
      supportCaseId, status: row.status, closedAt: row.closedAt, closedReason: row.closedReason,
      purgeDue: row.purgeDue, purgedAt: row.purgedAt, hasOtherActiveSupportCase: row.hasOtherActiveSupportCase,
    };
  }
}
