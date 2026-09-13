import { INTAKE_AREAS, type IntakeArea } from './intake';

export const MANUAL_RECORD_SCHEMA_VERSION = 2 as const;
export const MANUAL_RECORD_METHODS = ['in_person', 'phone', 'video', 'visit'] as const;
export const MANUAL_RECORD_REASONS = ['regular', 'irregular', 'urgent', 'walk_in'] as const;
export const MANUAL_RECORD_URGENCIES = ['stable', 'caution', 'crisis'] as const;
export type ManualRecordMethod = typeof MANUAL_RECORD_METHODS[number];
export type ManualRecordReason = typeof MANUAL_RECORD_REASONS[number];
export type ManualRecordUrgency = typeof MANUAL_RECORD_URGENCIES[number];
export type ManualActionOwner = 'counselor' | 'beneficiary' | 'org';
export interface ManualNextAction { description: string; owner: ManualActionOwner; dueDate?: string }
export type ManualActionOutcomeInput = {
  actionItemId: string;
  expectedRevision: number;
  update?: { description?: string; dueDate?: string | null };
} & (
  | { outcome: 'done' | 'in_progress' }
  | { outcome: 'not_done'; continuation: 'continue' }
  | { outcome: 'not_done'; continuation: 'stop'; reason: string }
);
export interface ManualQuestionAnswerInput {
  kind: 'schedule' | 'record';
  questionId: string;
  sourceId: string;
  expectedRevision: number;
  answer: string;
}
export interface ManualAreaChange { area: IntakeArea; text: string }
export interface CreateManualRecordInput {
  schemaVersion: 2;
  submissionId: string;
  heldAt: string;
  channel: ManualRecordMethod;
  /** Omission means no reason was recorded, never an inferred regular appointment. */
  reason?: ManualRecordReason;
  memo: string;
  actionItems?: ManualNextAction[];
  actionOutcomes?: ManualActionOutcomeInput[];
  questionAnswers?: ManualQuestionAnswerInput[];
  nextQuestions?: string[];
  changes?: ManualAreaChange[];
  urgency?: ManualRecordUrgency;
  counselorOpinion?: string;
  flags?: Array<{ flagType: string; quote?: string }>;
  /** Existing explicit human scores only; no automatic calculation or required score. */
  gasScores?: Array<{ goalId: string; score: -2 | -1 | 0 | 1 | 2 }>;
  scheduleId?: string;
  expectedScheduleVersion?: number;
}
export interface ManualRecordDetails {
  schemaVersion: 2;
  method: ManualRecordMethod;
  reason: ManualRecordReason | null;
  urgency: ManualRecordUrgency | null;
  changes: ManualAreaChange[];
  counselorOpinion: string | null;
  nextQuestions: Array<{ id: string; body: string }>;
}
export interface ManualRecordRevision {
  revision: number;
  schemaVersion: 1 | 2;
  heldAt: string;
  channel: 'in_person' | 'phone' | 'video';
  memo: string | null;
  detailsJson: string | null;
  recordedAt: string;
  actorId: string | null;
}
export interface ManualActionRevision {
  revision: number;
  description: string;
  owner: ManualActionOwner;
  dueDate: string | null;
  resolutionStatus: 'done' | 'in_progress' | 'not_done' | 'hold' | null;
  resolutionNote: string | null;
  sourceSessionId: string | null;
  resolvedAt: string | null;
  stopReason: string | null;
}
export interface ManualActionOutcome {
  actionItemId: string;
  sessionId: string;
  heldAt: string;
  sourceRevision: number;
  outcome: 'done' | 'in_progress' | 'not_done' | 'unconfirmed';
  continuation: 'continue' | 'stop' | null;
  reason: string | null;
}
export interface ManualOpenAction {
  id: string;
  revision: number;
  sourceSessionId: string | null;
  sourceHeldAt: string | null;
  createdAt: string;
  description: string;
  owner: ManualActionOwner;
  dueDate: string | null;
  state: 'open' | 'done' | 'stopped';
  history: ManualActionRevision[];
  outcomes: ManualActionOutcome[];
}
export interface ManualQuestionOutcome {
  sessionId: string;
  heldAt: string;
  outcome: 'confirmed' | 'unconfirmed';
  answer: string | null;
  sourceRevision: number;
  sourceText: string;
}
export interface ManualPendingQuestion {
  kind: 'schedule' | 'record';
  id: string;
  sourceId: string;
  sourceRevision: number;
  sourceSessionId: string | null;
  sourceHeldAt: string | null;
  sourceScheduledAt: string | null;
  createdAt: string;
  body: string;
  state: 'open' | 'confirmed';
  outcomes: ManualQuestionOutcome[];
}
export interface ManualRecordProjection {
  schemaVersion: 1 | 2;
  revision: number;
  details: ManualRecordDetails | null;
  legacyDetailsJson: string | null;
  history: ManualRecordRevision[];
  actionOutcomes: ManualActionOutcome[];
  questionOutcomes: Array<ManualQuestionOutcome & { kind: 'schedule' | 'record'; questionId: string; sourceId: string }>;
}
export interface ManualRecordContext {
  schemaVersion: 2;
  supportCaseId: string;
  canWrite: boolean;
  defaults: { heldAt: string | null; channel: ManualRecordMethod | null; reason: null; scheduleId: string | null; scheduleVersion: number | null };
  actions: ManualOpenAction[];
  questions: ManualPendingQuestion[];
  closedActions: ManualOpenAction[];
  confirmedQuestions: ManualPendingQuestion[];
}
export class ManualRecordContractError extends Error {
  constructor() { super('manual record input is invalid'); }
}
function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !keys.includes(key))) throw new ManualRecordContractError();
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 24000): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function identifier(value: unknown): value is string { return text(value, 200); }
function revision(value: unknown): boolean { return Number.isSafeInteger(value) && Number(value) >= 1; }
function enumeration(value: unknown, values: readonly string[]): boolean { return typeof value === 'string' && values.includes(value); }
function date(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function array(value: unknown, max = 20): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > max) throw new ManualRecordContractError();
  return value;
}
export function parseCreateManualRecord(value: unknown): CreateManualRecordInput {
  const input = object(value, ['schemaVersion', 'submissionId', 'heldAt', 'channel', 'reason', 'memo', 'actionItems', 'actionOutcomes',
    'questionAnswers', 'nextQuestions', 'changes', 'urgency', 'counselorOpinion', 'flags', 'gasScores', 'scheduleId', 'expectedScheduleVersion']);
  if (input.schemaVersion !== 2 || !identifier(input.submissionId) || !text(input.heldAt)
    || !Number.isFinite(Date.parse(input.heldAt)) || new Date(input.heldAt).toISOString() !== input.heldAt
    || !enumeration(input.channel, MANUAL_RECORD_METHODS) || !text(input.memo)) throw new ManualRecordContractError();
  if (Object.hasOwn(input, 'reason') && !enumeration(input.reason, MANUAL_RECORD_REASONS)) throw new ManualRecordContractError();
  if (Object.hasOwn(input, 'urgency') && !enumeration(input.urgency, MANUAL_RECORD_URGENCIES)) throw new ManualRecordContractError();
  if (Object.hasOwn(input, 'counselorOpinion') && !text(input.counselorOpinion)) throw new ManualRecordContractError();
  if (Object.hasOwn(input, 'scheduleId') || Object.hasOwn(input, 'expectedScheduleVersion')) {
    if (!identifier(input.scheduleId) || !revision(input.expectedScheduleVersion)) throw new ManualRecordContractError();
  }
  for (const raw of array(input.actionItems)) {
    const action = object(raw, ['description', 'owner', 'dueDate']);
    if (!text(action.description, 2000) || !enumeration(action.owner, ['counselor', 'beneficiary', 'org'])
      || (Object.hasOwn(action, 'dueDate') && !date(action.dueDate))) throw new ManualRecordContractError();
  }
  const actionIds = new Set<unknown>();
  for (const raw of array(input.actionOutcomes, 200)) {
    const action = object(raw, ['actionItemId', 'expectedRevision', 'outcome', 'continuation', 'reason', 'update']);
    if (!identifier(action.actionItemId) || actionIds.has(action.actionItemId) || !revision(action.expectedRevision)
      || !enumeration(action.outcome, ['done', 'in_progress', 'not_done'])) throw new ManualRecordContractError();
    actionIds.add(action.actionItemId);
    if (action.outcome === 'not_done') {
      if (!enumeration(action.continuation, ['continue', 'stop'])
        || (action.continuation === 'stop' ? !text(action.reason, 2000) : Object.hasOwn(action, 'reason'))) throw new ManualRecordContractError();
    } else if (Object.hasOwn(action, 'continuation') || Object.hasOwn(action, 'reason')) throw new ManualRecordContractError();
    if (Object.hasOwn(action, 'update')) {
      const update = object(action.update, ['description', 'dueDate']);
      if (Object.keys(update).length === 0 || (Object.hasOwn(update, 'description') && !text(update.description, 2000))
        || (Object.hasOwn(update, 'dueDate') && update.dueDate !== null && !date(update.dueDate))) throw new ManualRecordContractError();
    }
  }
  const questionIds = new Set<string>();
  for (const raw of array(input.questionAnswers, 200)) {
    const answer = object(raw, ['kind', 'questionId', 'sourceId', 'expectedRevision', 'answer']);
    if (!enumeration(answer.kind, ['schedule', 'record']) || !identifier(answer.questionId) || !identifier(answer.sourceId)
      || !revision(answer.expectedRevision) || !text(answer.answer)) throw new ManualRecordContractError();
    const key = `${answer.kind}:${answer.questionId}`;
    if (questionIds.has(key)) throw new ManualRecordContractError();
    questionIds.add(key);
  }
  for (const question of array(input.nextQuestions)) if (!text(question, 2000)) throw new ManualRecordContractError();
  for (const raw of array(input.changes)) {
    const change = object(raw, ['area', 'text']);
    if (!enumeration(change.area, INTAKE_AREAS) || !text(change.text, 2000)) throw new ManualRecordContractError();
  }
  for (const raw of array(input.flags, 6)) {
    const flag = object(raw, ['flagType', 'quote']);
    if (!text(flag.flagType, 100) || (Object.hasOwn(flag, 'quote') && !text(flag.quote))) throw new ManualRecordContractError();
  }
  const goalIds = new Set<unknown>();
  for (const raw of array(input.gasScores, 3)) {
    const score = object(raw, ['goalId', 'score']);
    if (!identifier(score.goalId) || goalIds.has(score.goalId) || !Number.isInteger(score.score)
      || Number(score.score) < -2 || Number(score.score) > 2) throw new ManualRecordContractError();
    goalIds.add(score.goalId);
  }
  return input as unknown as CreateManualRecordInput;
}
