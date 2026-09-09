// 일정과 15초 페이지의 API 경계 (P4).
// 서버가 정한 날짜 경계와 상태를 그대로 쓰고, 화면이 시간대를 다시 계산하지 않는다.

import { isNullableString, isOpaqueIdentifier, record } from './api';
import { BusinessError } from './errors';
import type { BusinessTransport } from './transport';

export type ScheduleStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';
export type ScheduleKind = 'regular' | 'intake';

export interface ScheduleCard {
  id: string;
  supportCaseId: string;
  beneficiaryId: string;
  scheduledAt: string;
  status: ScheduleStatus;
  sessionKind: ScheduleKind;
  channel: 'in_person';
  participantName: string | null;
  participantPhone: string | null;
  completedSessionId: string | null;
}

export interface ScheduleWindow {
  /** 서버가 정한 기관 시간대의 기준 날짜와 경계. 화면은 이 값만 쓴다. */
  date: string;
  timeZone: string;
  startUtc: string;
  endUtc: string;
  schedules: ScheduleCard[];
}

export interface ScheduleCandidate {
  beneficiaryId: string;
  supportCaseId: string;
  participantName: string | null;
  participantPhone: string | null;
  intakeAt: string | null;
}

export interface SessionGoal {
  id: string;
  body: string;
  caseGoalId: string | null;
  caseGoalTitle: string | null;
  ordinal: number;
}

export interface SchedulePlan {
  scheduleId: string;
  beneficiaryId: string;
  supportCaseId: string;
  scheduledAt: string;
  status: ScheduleStatus;
  version: number;
  sessionKind: ScheduleKind;
  sessionGoals: SessionGoal[];
  customQuestions: Array<{ id: string; body: string; ordinal: number }>;
}

export interface BriefingSessionRow {
  sessionId: string;
  heldAt: string;
  kind: ScheduleKind;
  aiOneLiner: string | null;
  memoExcerpt: string | null;
}

export interface BriefingDiscrepancy {
  id: string;
  kind: string;
  left: string;
  right: string;
  resolution: string | null;
}

export interface Briefing {
  beneficiaryId: string;
  focusSupportCaseId: string;
  overallGoal: string | null;
  canEditOverallGoal: boolean;
  activeGoals: Array<{ id: string; title: string }>;
  participant: { name: string | null; phone: string | null };
  /** 포커스 사업 구획만 화면이 읽는다. 다른 사업 구획은 목록 화면 몫이다. */
  focus: {
    aiSuggestions: Array<{ title: string; reason: string; sessionId: string | null; heldAt: string | null }>;
    sessionRows: BriefingSessionRow[];
    discrepancies: BriefingDiscrepancy[];
    openActionItems: Array<{ id: string; description: string; owner: string; dueDate: string | null; sessionId: string | null }>;
    confirmedFlags: Array<{ id: string; flagType: string; quote: string | null }>;
    pendingReviewCount: number;
  };
  upcoming: {
    id: string;
    scheduledAt: string;
    sessionKind: ScheduleKind;
    sessionGoals: Array<{ body: string; caseGoalTitle: string | null }>;
    customQuestions: string[];
  } | null;
}

const STATUSES: readonly ScheduleStatus[] = ['scheduled', 'completed', 'cancelled', 'no_show'];

function utcInstant(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value));
}

function decodeCard(value: unknown): ScheduleCard {
  const row = record(value);
  if (!isOpaqueIdentifier(row.id) || !isOpaqueIdentifier(row.supportCaseId) || !isOpaqueIdentifier(row.beneficiaryId)
    || !utcInstant(row.scheduledAt) || !(STATUSES as readonly unknown[]).includes(row.status)
    || (row.sessionKind !== 'regular' && row.sessionKind !== 'intake') || row.channel !== 'in_person'
    || !isNullableString(row.participantName) || !isNullableString(row.participantPhone)
    || !(row.completedSessionId === null || isOpaqueIdentifier(row.completedSessionId))) {
    throw new BusinessError('invalid_response');
  }
  return {
    id: row.id, supportCaseId: row.supportCaseId, beneficiaryId: row.beneficiaryId,
    scheduledAt: row.scheduledAt, status: row.status as ScheduleStatus,
    sessionKind: row.sessionKind, channel: 'in_person',
    participantName: row.participantName, participantPhone: row.participantPhone,
    completedSessionId: row.completedSessionId as string | null,
  };
}

export function decodeScheduleWindow(value: unknown): ScheduleWindow {
  const row = record(value);
  if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(row.date)
    || typeof row.timeZone !== 'string' || !row.timeZone
    || !utcInstant(row.startUtc) || !utcInstant(row.endUtc)
    || !Array.isArray(row.schedules)) throw new BusinessError('invalid_response');
  return {
    date: row.date, timeZone: row.timeZone, startUtc: row.startUtc, endUtc: row.endUtc,
    schedules: row.schedules.map(decodeCard),
  };
}

export function decodeCandidates(value: unknown): ScheduleCandidate[] {
  const row = record(value);
  if (!Array.isArray(row.candidates)) throw new BusinessError('invalid_response');
  return row.candidates.map((entry) => {
    const candidate = record(entry);
    if (!isOpaqueIdentifier(candidate.beneficiaryId) || !isOpaqueIdentifier(candidate.supportCaseId)
      || !isNullableString(candidate.participantName) || !isNullableString(candidate.participantPhone)
      || !isNullableString(candidate.intakeAt)) throw new BusinessError('invalid_response');
    return {
      beneficiaryId: candidate.beneficiaryId, supportCaseId: candidate.supportCaseId,
      participantName: candidate.participantName, participantPhone: candidate.participantPhone,
      intakeAt: candidate.intakeAt,
    };
  });
}

function decodeSessionGoal(value: unknown): SessionGoal {
  const goal = record(value);
  if (!isOpaqueIdentifier(goal.id) || typeof goal.body !== 'string'
    || !(goal.caseGoalId === null || isOpaqueIdentifier(goal.caseGoalId))
    || !isNullableString(goal.caseGoalTitle)
    || typeof goal.ordinal !== 'number' || !Number.isSafeInteger(goal.ordinal)) {
    throw new BusinessError('invalid_response');
  }
  return {
    id: goal.id, body: goal.body, caseGoalId: goal.caseGoalId as string | null,
    caseGoalTitle: goal.caseGoalTitle, ordinal: goal.ordinal,
  };
}

export function decodePlan(value: unknown): SchedulePlan {
  const row = record(value);
  if (!isOpaqueIdentifier(row.scheduleId) || !isOpaqueIdentifier(row.beneficiaryId)
    || !isOpaqueIdentifier(row.supportCaseId) || !utcInstant(row.scheduledAt)
    || !(STATUSES as readonly unknown[]).includes(row.status)
    || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1
    || (row.sessionKind !== 'regular' && row.sessionKind !== 'intake')
    || !Array.isArray(row.sessionGoals) || !Array.isArray(row.customQuestions)) {
    throw new BusinessError('invalid_response');
  }
  return {
    scheduleId: row.scheduleId, beneficiaryId: row.beneficiaryId, supportCaseId: row.supportCaseId,
    scheduledAt: row.scheduledAt, status: row.status as ScheduleStatus, version: row.version,
    sessionKind: row.sessionKind, sessionGoals: row.sessionGoals.map(decodeSessionGoal),
    customQuestions: row.customQuestions.map((entry) => {
      const question = record(entry);
      if (!isOpaqueIdentifier(question.id) || typeof question.body !== 'string'
        || typeof question.ordinal !== 'number') throw new BusinessError('invalid_response');
      return { id: question.id, body: question.body, ordinal: question.ordinal };
    }),
  };
}

/** 브리핑은 구획이 많아 화면이 실제로 읽는 값만 검사하고, 그 값이 어긋나면 거부한다. */
export function decodeBriefing(value: unknown, focusSupportCaseId: string): Briefing {
  const row = record(value);
  const participant = record(row.participant);
  if (!isOpaqueIdentifier(row.beneficiaryId) || row.focusSupportCaseId !== focusSupportCaseId
    || !isNullableString(row.overallGoal) || typeof row.canEditOverallGoal !== 'boolean'
    || !Array.isArray(row.activeGoals) || !Array.isArray(row.sections)
    || !isNullableString(participant.name) || !isNullableString(participant.phone)) {
    throw new BusinessError('invalid_response');
  }
  const focusSection = row.sections.map(record)
    .find((section) => record(section.sourceSupportCase).id === focusSupportCaseId);
  if (focusSection === undefined) throw new BusinessError('invalid_response');
  const list = (key: string) => {
    const entries = focusSection[key];
    if (!Array.isArray(entries)) throw new BusinessError('invalid_response');
    return entries.map(record);
  };
  const upcoming = row.focusUpcomingSchedule === null || row.focusUpcomingSchedule === undefined
    ? null : record(row.focusUpcomingSchedule);
  return {
    beneficiaryId: row.beneficiaryId,
    focusSupportCaseId,
    overallGoal: row.overallGoal,
    canEditOverallGoal: row.canEditOverallGoal,
    activeGoals: row.activeGoals.map((entry) => {
      const goal = record(entry);
      if (!isOpaqueIdentifier(goal.id) || typeof goal.title !== 'string') throw new BusinessError('invalid_response');
      return { id: goal.id, title: goal.title };
    }),
    participant: { name: participant.name, phone: participant.phone },
    focus: {
      aiSuggestions: list('aiSuggestions').map((entry) => {
        if (typeof entry.title !== 'string' || typeof entry.reason !== 'string'
          || !isNullableString(entry.sessionId) || !isNullableString(entry.heldAt)) {
          throw new BusinessError('invalid_response');
        }
        return { title: entry.title, reason: entry.reason, sessionId: entry.sessionId, heldAt: entry.heldAt };
      }),
      sessionRows: list('sessionRows').map((entry) => {
        if (!isOpaqueIdentifier(entry.sessionId) || !utcInstant(entry.heldAt)
          || (entry.kind !== 'regular' && entry.kind !== 'intake')
          || !isNullableString(entry.aiOneLiner) || !isNullableString(entry.memoExcerpt)) {
          throw new BusinessError('invalid_response');
        }
        return {
          sessionId: entry.sessionId, heldAt: entry.heldAt, kind: entry.kind,
          aiOneLiner: entry.aiOneLiner, memoExcerpt: entry.memoExcerpt,
        };
      }),
      discrepancies: list('discrepancies').map((entry) => {
        if (!isOpaqueIdentifier(entry.id) || typeof entry.kind !== 'string'
          || typeof entry.left !== 'string' || typeof entry.right !== 'string') {
          throw new BusinessError('invalid_response');
        }
        const resolution = entry.resolution === null || entry.resolution === undefined
          ? null : record(entry.resolution).status;
        if (!isNullableString(resolution ?? null)) throw new BusinessError('invalid_response');
        return {
          id: entry.id, kind: entry.kind, left: entry.left, right: entry.right,
          resolution: (resolution ?? null) as string | null,
        };
      }),
      openActionItems: list('openActionItems').map((entry) => {
        if (!isOpaqueIdentifier(entry.id) || typeof entry.description !== 'string'
          || typeof entry.owner !== 'string' || !isNullableString(entry.dueDate)
          || !isNullableString(entry.sessionId)) throw new BusinessError('invalid_response');
        return {
          id: entry.id, description: entry.description, owner: entry.owner,
          dueDate: entry.dueDate, sessionId: entry.sessionId,
        };
      }),
      // 확인된 플래그만 배너에 오른다. 제안 상태는 승인 화면 몫이다(D9·R5).
      confirmedFlags: list('flags').filter((entry) => entry.reviewStatus === 'confirmed').map((entry) => {
        if (!isOpaqueIdentifier(entry.id) || typeof entry.flagType !== 'string'
          || !isNullableString(entry.quote)) throw new BusinessError('invalid_response');
        return { id: entry.id, flagType: entry.flagType, quote: entry.quote };
      }),
      pendingReviewCount: Array.isArray(focusSection.pendingReviewSessionIds)
        ? focusSection.pendingReviewSessionIds.length : 0,
    },
    upcoming: upcoming === null ? null : {
      id: isOpaqueIdentifier(upcoming.id) ? upcoming.id : (() => { throw new BusinessError('invalid_response'); })(),
      scheduledAt: utcInstant(upcoming.scheduledAt) ? upcoming.scheduledAt : (() => { throw new BusinessError('invalid_response'); })(),
      sessionKind: upcoming.sessionKind === 'intake' ? 'intake' : 'regular',
      sessionGoals: (Array.isArray(upcoming.sessionGoals) ? upcoming.sessionGoals : []).map((entry) => {
        const goal = record(entry);
        if (typeof goal.body !== 'string' || !isNullableString(goal.caseGoalTitle)) {
          throw new BusinessError('invalid_response');
        }
        return { body: goal.body, caseGoalTitle: goal.caseGoalTitle };
      }),
      customQuestions: (Array.isArray(upcoming.customQuestions) ? upcoming.customQuestions : []).map((entry) => {
        const question = record(entry);
        if (typeof question.body !== 'string') throw new BusinessError('invalid_response');
        return question.body;
      }),
    },
  };
}

export class SchedulesApi {
  constructor(private readonly transport: BusinessTransport) {}

  /** `month`는 `YYYY-MM`이다. 서버가 기관 시간대로 달을 정하고 화면은 결과만 묶는다. */
  async month(month: string): Promise<ScheduleWindow> {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(month)) throw new BusinessError('invalid_request', 400);
    return decodeScheduleWindow(await this.transport.request(`/schedules/month?month=${month}`));
  }

  async candidates(): Promise<ScheduleCandidate[]> {
    return decodeCandidates(await this.transport.request('/schedules/candidates'));
  }

  async create(input: {
    beneficiaryId: string; supportCaseId: string; scheduledAt: string;
    sessionKind: ScheduleKind; sessionGoals: string[];
  }): Promise<{ id: string; scheduledAt: string }> {
    if (!isOpaqueIdentifier(input.beneficiaryId) || !isOpaqueIdentifier(input.supportCaseId)
      || !utcInstant(input.scheduledAt)) throw new BusinessError('invalid_request', 400);
    const body = {
      beneficiaryId: input.beneficiaryId, supportCaseId: input.supportCaseId,
      scheduledAt: input.scheduledAt, sessionKind: input.sessionKind, channel: 'in_person',
      sessionGoals: input.sessionGoals.map((goal) => ({ body: goal, caseGoalId: null })),
    };
    const row = record(await this.transport.request('/schedules', 'POST', body));
    if (!isOpaqueIdentifier(row.id) || !utcInstant(row.scheduledAt)) throw new BusinessError('invalid_response');
    return { id: row.id, scheduledAt: row.scheduledAt };
  }

  async plan(scheduleId: string): Promise<SchedulePlan> {
    if (!isOpaqueIdentifier(scheduleId)) throw new BusinessError('invalid_request', 400);
    return decodePlan(await this.transport.request(`/schedules/${encodeURIComponent(scheduleId)}/plan`));
  }

  async saveSessionGoals(scheduleId: string, expectedVersion: number, goals: string[]): Promise<number> {
    if (!isOpaqueIdentifier(scheduleId) || !Number.isSafeInteger(expectedVersion)) {
      throw new BusinessError('invalid_request', 400);
    }
    const row = record(await this.transport.request(
      `/schedules/${encodeURIComponent(scheduleId)}/plan`, 'PUT',
      { expectedVersion, sessionGoals: goals.map((goal) => ({ body: goal, caseGoalId: null })) },
    ));
    if (typeof row.version !== 'number' || !Number.isSafeInteger(row.version)) {
      throw new BusinessError('invalid_response');
    }
    return row.version;
  }

  async briefing(beneficiaryId: string, supportCaseId: string): Promise<Briefing> {
    if (!isOpaqueIdentifier(beneficiaryId) || !isOpaqueIdentifier(supportCaseId)) {
      throw new BusinessError('invalid_request', 400);
    }
    const path = `/participants/${encodeURIComponent(beneficiaryId)}`
      + `/programs/${encodeURIComponent(supportCaseId)}/briefing`;
    return decodeBriefing(await this.transport.request(path), supportCaseId);
  }

  async saveOverallGoal(supportCaseId: string, overallGoal: string | null): Promise<string | null> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    const row = record(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/overall-goal`, 'PUT', { overallGoal },
    ));
    if (!isNullableString(row.overallGoal)) throw new BusinessError('invalid_response');
    return row.overallGoal;
  }
}
