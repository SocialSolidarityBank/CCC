// 전체 상담 리포트의 API 경계 (P6). 서버가 저장된 근거만 투영하고 GET 시 새로 만들지 않는다.
//
// 근거가 없으면 구획 자체가 없다. 그것은 "위험 없음"이나 "변화 없음"이 아니라 "자료 없음"이다.
// 화면은 빈 구획을 안전 판정으로 바꿔 읽지 않는다.

import type { ReportEvidence, SupportCaseReport } from '@ccc/contracts/report';
import { isNullableString, isOpaqueIdentifier, record } from './api';
import { BusinessError } from './errors';
import type { BusinessTransport } from './transport';

export const REPORT_SECTION_LABELS = {
  situationChanges: '상황 변화',
  goalChanges: '목표와 방향',
  actionItems: '약속과 할 일',
  resourceConnections: '연계 자원',
  riskSignals: '위험 신호',
} as const;
export type ReportSectionKey = keyof typeof REPORT_SECTION_LABELS;
export const REPORT_SECTION_ORDER: readonly ReportSectionKey[] = [
  'situationChanges', 'goalChanges', 'actionItems', 'resourceConnections', 'riskSignals',
];

export const ACTION_RESOLUTION_LABELS: Record<'done' | 'in_progress' | 'not_done' | 'hold', string> = {
  done: '완료', in_progress: '진행 중', not_done: '못 함', hold: '보류',
};

function evidence(value: unknown): ReportEvidence {
  const row = record(value);
  if (!isOpaqueIdentifier(row.sessionId) || typeof row.sessionNumber !== 'number'
    || !Number.isSafeInteger(row.sessionNumber) || typeof row.heldAt !== 'string'
    || typeof row.source !== 'string' || typeof row.text !== 'string' || row.text === '') {
    throw new BusinessError('invalid_response');
  }
  return {
    sessionId: row.sessionId, sessionNumber: row.sessionNumber, heldAt: row.heldAt,
    source: row.source, text: row.text,
  };
}

function optionalEvidence(value: unknown): ReportEvidence | undefined {
  return value === undefined ? undefined : evidence(value);
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new BusinessError('invalid_response');
  return value;
}

function entries(value: unknown): { entries: ReportEvidence[] } | undefined {
  if (value === undefined) return undefined;
  const row = record(value);
  if (!Array.isArray(row.entries)) throw new BusinessError('invalid_response');
  return { entries: row.entries.map(evidence) };
}

export function decodeReport(value: unknown): SupportCaseReport {
  const row = record(value);
  const sections = record(row.sections);
  if (row.schemaVersion !== 1 || !isOpaqueIdentifier(row.supportCaseId)
    || !isOpaqueIdentifier(row.beneficiaryId) || typeof row.programId !== 'string'
    || !isNullableString(row.programName) || (row.status !== 'active' && row.status !== 'closed')
    || !Array.isArray(row.sessions)) {
    throw new BusinessError('invalid_response');
  }
  const goalChanges = sections.goalChanges === undefined ? undefined : (() => {
    const goal = record(sections.goalChanges);
    if (!Array.isArray(goal.directions)) throw new BusinessError('invalid_response');
    return { initialGoal: evidence(goal.initialGoal), directions: goal.directions.map(evidence) };
  })();
  const actionItems = sections.actionItems === undefined ? undefined : (() => {
    const block = record(sections.actionItems);
    if (!Array.isArray(block.items)) throw new BusinessError('invalid_response');
    return { items: block.items.map((entry) => {
      const item = record(entry);
      const status = item.resolutionStatus;
      if (!isOpaqueIdentifier(item.id) || typeof item.description !== 'string'
        || !(status === null || Object.hasOwn(ACTION_RESOLUTION_LABELS, status as string))
        || !isNullableString(item.resolvedAt) || !isNullableString(item.dueDate)) {
        throw new BusinessError('invalid_response');
      }
      return {
        id: item.id, description: item.description,
        resolutionStatus: status as 'done' | 'in_progress' | 'not_done' | 'hold' | null,
        resolvedAt: item.resolvedAt, dueDate: item.dueDate,
        evidence: evidence(item.evidence),
        ...(item.resolution === undefined ? {} : { resolution: evidence(item.resolution) }),
      };
    }) };
  })();
  const resourceConnections = sections.resourceConnections === undefined ? undefined : (() => {
    const block = record(sections.resourceConnections);
    if (!Array.isArray(block.entries)) throw new BusinessError('invalid_response');
    return { entries: block.entries.map((entry) => {
      const item = record(entry);
      if (typeof item.orgName !== 'string') throw new BusinessError('invalid_response');
      return {
        orgName: item.orgName,
        ...(item.serviceName === undefined ? {} : { serviceName: optionalText(item.serviceName)! }),
        ...(item.supportDetail === undefined ? {} : { supportDetail: optionalText(item.supportDetail)! }),
        ...(item.usagePeriod === undefined ? {} : { usagePeriod: optionalText(item.usagePeriod)! }),
        ...(item.progressStatus === undefined ? {} : { progressStatus: optionalText(item.progressStatus)! }),
        evidence: evidence(item.evidence),
      };
    }) };
  })();

  return {
    schemaVersion: 1,
    supportCaseId: row.supportCaseId, beneficiaryId: row.beneficiaryId,
    programId: row.programId, programName: row.programName, status: row.status,
    sessions: row.sessions.map((entry) => {
      const session = record(entry);
      if (!isOpaqueIdentifier(session.sessionId) || typeof session.sessionNumber !== 'number'
        || typeof session.heldAt !== 'string'
        || (session.kind !== 'regular' && session.kind !== 'intake')
        || (session.channel !== 'in_person' && session.channel !== 'phone' && session.channel !== 'video')) {
        throw new BusinessError('invalid_response');
      }
      const summary = optionalEvidence(session.summary);
      return {
        sessionId: session.sessionId, sessionNumber: session.sessionNumber, heldAt: session.heldAt,
        kind: session.kind, channel: session.channel,
        ...(summary === undefined ? {} : { summary }),
      };
    }),
    ...(row.firstIntakeGoal === undefined ? {} : { firstIntakeGoal: evidence(row.firstIntakeGoal) }),
    ...(row.nextConfirmations === undefined ? {} : {
      nextConfirmations: (Array.isArray(row.nextConfirmations) ? row.nextConfirmations : []).map((entry) => {
        const item = record(entry);
        if (typeof item.item !== 'string') throw new BusinessError('invalid_response');
        return {
          item: item.item,
          ...(item.reason === undefined ? {} : { reason: optionalText(item.reason)! }),
          ...(item.method === undefined ? {} : { method: optionalText(item.method)! }),
          ...(item.dueNote === undefined ? {} : { dueNote: optionalText(item.dueNote)! }),
          ...(item.dueDate === undefined ? {} : { dueDate: optionalText(item.dueDate)! }),
          ...(item.owner === undefined ? {} : { owner: optionalText(item.owner)! }),
          evidence: evidence(item.evidence),
        };
      }),
    }),
    sections: {
      ...(entries(sections.situationChanges) === undefined ? {} : { situationChanges: entries(sections.situationChanges)! }),
      ...(goalChanges === undefined ? {} : { goalChanges }),
      ...(actionItems === undefined ? {} : { actionItems }),
      ...(resourceConnections === undefined ? {} : { resourceConnections }),
      ...(entries(sections.riskSignals) === undefined ? {} : { riskSignals: entries(sections.riskSignals)! }),
    },
  };
}

export class ReportApi {
  constructor(private readonly transport: BusinessTransport) {}

  async read(supportCaseId: string): Promise<SupportCaseReport> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    return decodeReport(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/report`,
    ));
  }
}
