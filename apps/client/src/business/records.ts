// 상담 기록 확인하기와 상담 기록하기의 API 경계 (P5 첫 묶음).
// 수기 기록은 저장 즉시 공식 기록이고(D5), AI 초안은 승인 전까지 이 화면에 오르지 않는다(R2).

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
  repeated_noncompliance: '약속 불이행 반복',
  violence_exploitation: '폭력, 착취 피해',
};

export const RECORD_DETAIL_KEYS = ['sessionGoalNote', 'changeSinceLast', 'safetyNote', 'counselorOpinion'] as const;
export type RecordDetailKey = (typeof RECORD_DETAIL_KEYS)[number];
export const RECORD_DETAIL_LABELS: Record<RecordDetailKey, string> = {
  sessionGoalNote: '이번 상담의 목표',
  changeSinceLast: '지난 회차 이후 달라진 점',
  safetyNote: '안전과 위기 관련 메모',
  counselorOpinion: '담당 실무자 의견',
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

export interface CounselingRecordRow {
  id: string;
  heldAt: string;
  kind: 'regular' | 'intake';
  memo: string;
  /** 승인된 AI 한 줄만 온다. null이면 화면은 수기 발췌로 낮추고 수기 배지를 단다(R2·D5). */
  aiOneLiner: string | null;
  memoExcerpt: string | null;
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
      return {
        id: item.id, heldAt: item.heldAt, kind: item.kind, memo: item.memo,
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
    schedule?: { id: string; expectedVersion: number };
  }): Promise<{ id: string; replayed: boolean }> {
    if (!isOpaqueIdentifier(supportCaseId) || !isOpaqueIdentifier(input.submissionId)
      || !utcInstant(input.heldAt) || input.memo.trim() === '') {
      throw new BusinessError('invalid_request', 400);
    }
    const details: Record<string, string> = {};
    for (const key of RECORD_DETAIL_KEYS) {
      const value = input.details[key];
      if (value !== undefined && value.trim() !== '') details[key] = value.trim();
    }
    const body: Record<string, unknown> = {
      submissionId: input.submissionId,
      heldAt: input.heldAt,
      // D4: v1은 대면만이다. 전화와 화상은 수기 경로로 남는다.
      channel: 'in_person',
      memo: input.memo,
      // D43: GAS 채점은 보류다. 빈 배열만 보낸다.
      gasScores: [],
      actions: input.actions.map((action) => ({
        description: action.description, owner: action.owner,
        ...(action.dueDate === undefined || action.dueDate === '' ? {} : { dueDate: action.dueDate }),
      })),
      flags: input.flagTypes.map((flagType) => ({ flagType })),
      ...(Object.keys(details).length === 0 ? {} : { details }),
      ...(input.schedule === undefined ? {} : {
        scheduleId: input.schedule.id, expectedScheduleVersion: input.schedule.expectedVersion,
      }),
    };
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
