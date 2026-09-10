// 당사자 목록·등록·허브·기본정보의 실제 API 경계 (P3).
// 응답은 계약이 정한 키만 읽고, 없는 값을 채우지 않는다. 화면이 쓰는 판정은 전부 서버 응답에서 온다.

import type { ProgramAdmissionState } from '@ccc/contracts/program-admission';
import { isAdmissionState, isNullableString, isOpaqueIdentifier, record } from './api';
import { BusinessError } from './errors';
import type { BusinessTransport } from './transport';

export interface ParticipantListItem {
  beneficiaryId: string;
  status: 'active' | 'closed';
  programCount: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  /** 같은 기관에서 참여 중인 사업 이름. 서버가 중복을 없애고 정렬해 보낸다. */
  programNames: string[];
  newSignup: boolean;
}

export interface ParticipantProgram {
  id: string;
  beneficiaryId: string;
  programId: string;
  programName: string | null;
  programType: 'financial_support_v1';
  status: 'active' | 'closed';
  /** 아래 다섯은 담당 사업에만 실린다. 축소 투영에서는 null이다(D86). */
  intakeAt: string | null;
  creationKind: 'legacy_import' | 'initial' | 'subsequent' | null;
  participantName: string | null;
  participantPhone: string | null;
  closedAt: string | null;
  /** D36: 담당하지 않는 사업은 목록에만 오르고 상담 내용으로 들어갈 수 없다. */
  authorized: boolean;
  assigneeNames: string[];
  upcomingSchedule: { id: string; scheduledAt: string; sessionKind: 'regular' | 'intake' } | null;
}
export interface ParticipantHub {
  beneficiaryId: string;
  /** 비담당 실무자에게 내려가는 2단 축소 응답인지(D86 ⑤). */
  restricted: boolean;
  participantName: string | null;
  participantPhone: string | null;
  participantEmail: string | null;
  participantBirthDate: string | null;
  status: 'active' | 'closed' | null;
  closedAt: string | null;
  /** 담당 사업의 공식 기록 수. 초안만 있는 회차는 세지 않는다. */
  sessionCount: number | null;
  lastSessionAt: string | null;
  programs: ParticipantProgram[];
}

export const BASIC_INFO_FIELDS = ['name', 'phone', 'email', 'account', 'birthDate', 'region', 'gender'] as const;
export type BasicInfoField = (typeof BASIC_INFO_FIELDS)[number];

export interface ParticipantBasicInfo extends Record<BasicInfoField, string | null> {
  beneficiaryId: string;
  supportCaseContextId: string;
  version: number;
}

export interface ProgramOption {
  id: string;
  displayName: string | null;
  programType: 'financial_support_v1';
  admissionState: ProgramAdmissionState;
}

export interface ParticipantRegistrationInput {
  programId: string;
  /** 같은 등록을 두 번 만들지 않기 위한 열쇠. 화면이 제출 한 번에 하나를 만든다. */
  idempotencyKey: string;
  /** 여섯 영역 동의 사건. 발행된 고지문에서 만든다(S7 §6). 옛 2종 불리언은 보내지 않는다. */
  consentEvents: Record<string, unknown>[];
  /** 긴급 등록 사유(D46). 개인정보 동의를 아직 받지 못한 경우에만 쓴다. */
  emergencyReason?: string;
  name?: string;
  phone?: string;
  email?: string;
  birthDate?: string;
  region?: string;
  gender?: string;
  /** 관리자 등록은 첫 담당 실무자를 함께 정한다. 실무자 등록에는 이 키가 없다. */
  initialAssigneeUserId?: string;
}

export interface ParticipantCreationResult {
  beneficiaryId: string;
  supportCaseId: string;
  assignmentRole: 'primary';
  replayed: boolean;
}

function exactKeys(row: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(row).length !== keys.length || !keys.every((key) => Object.hasOwn(row, key))) {
    throw new BusinessError('invalid_response');
  }
}

function decodeListItem(value: unknown): ParticipantListItem {
  const row = record(value);
  exactKeys(row, ['beneficiaryId', 'status', 'programCount', 'name', 'phone', 'email', 'programNames', 'newSignup']);
  if (!isOpaqueIdentifier(row.beneficiaryId) || (row.status !== 'active' && row.status !== 'closed')
    || typeof row.programCount !== 'number' || !Number.isSafeInteger(row.programCount) || row.programCount < 0
    || !isNullableString(row.name) || !isNullableString(row.phone) || !isNullableString(row.email)
    || !Array.isArray(row.programNames) || !row.programNames.every((name) => typeof name === 'string')
    || typeof row.newSignup !== 'boolean') throw new BusinessError('invalid_response');
  return {
    beneficiaryId: row.beneficiaryId, status: row.status, programCount: row.programCount,
    name: row.name, phone: row.phone, email: row.email,
    programNames: row.programNames as string[], newSignup: row.newSignup,
  };
}

function decodeUpcomingSchedule(value: unknown): ParticipantProgram['upcomingSchedule'] {
  if (value === null) return null;
  const row = record(value);
  exactKeys(row, ['id', 'scheduledAt', 'sessionKind']);
  if (!isOpaqueIdentifier(row.id) || typeof row.scheduledAt !== 'string'
    || !Number.isFinite(Date.parse(row.scheduledAt))
    || (row.sessionKind !== 'regular' && row.sessionKind !== 'intake')) throw new BusinessError('invalid_response');
  return { id: row.id, scheduledAt: row.scheduledAt, sessionKind: row.sessionKind };
}

/** D86 축소 허브의 사업 투영. 상담 내용과 동의는 응답에 없어야 한다. */
function decodeRestrictedProgram(row: Record<string, unknown>): ParticipantProgram {
  exactKeys(row, ['id', 'beneficiaryId', 'programId', 'programName', 'programType', 'status',
    'authorized', 'assigneeNames']);
  if (!isOpaqueIdentifier(row.id) || !isOpaqueIdentifier(row.beneficiaryId)
    || !isOpaqueIdentifier(row.programId) || !isNullableString(row.programName)
    || row.programType !== 'financial_support_v1'
    || (row.status !== 'active' && row.status !== 'closed') || row.authorized !== false
    || !Array.isArray(row.assigneeNames) || !row.assigneeNames.every((name) => typeof name === 'string')) {
    throw new BusinessError('invalid_response');
  }
  return {
    id: row.id, beneficiaryId: row.beneficiaryId, programId: row.programId,
    programName: row.programName, programType: 'financial_support_v1', status: row.status,
    intakeAt: null, creationKind: null, participantName: null, participantPhone: null,
    authorized: false, assigneeNames: row.assigneeNames as string[],
    closedAt: null, upcomingSchedule: null,
  };
}

function decodeProgram(value: unknown): ParticipantProgram {
  const row = record(value);
  if (row.authorized === false) return decodeRestrictedProgram(row);
  exactKeys(row, ['id', 'beneficiaryId', 'programId', 'programName', 'programType', 'status', 'intakeAt',
    'creationKind', 'sourceSupportCase', 'participantName', 'participantPhone', 'authorized', 'assigneeNames',
    'consent', 'consentRecordedAt', 'closedAt', 'upcomingSchedule']);
  if (!isOpaqueIdentifier(row.id) || !isOpaqueIdentifier(row.beneficiaryId)
    || !isOpaqueIdentifier(row.programId) || !isNullableString(row.programName)
    || row.programType !== 'financial_support_v1'
    || (row.status !== 'active' && row.status !== 'closed')
    || !isNullableString(row.intakeAt) || !isNullableString(row.closedAt)
    || (row.creationKind !== 'legacy_import' && row.creationKind !== 'initial' && row.creationKind !== 'subsequent')
    || !isNullableString(row.participantName) || !isNullableString(row.participantPhone)
    || row.authorized !== true
    || !Array.isArray(row.assigneeNames) || !row.assigneeNames.every((name) => typeof name === 'string')
    || !isNullableString(row.consentRecordedAt)) throw new BusinessError('invalid_response');
  return {
    id: row.id, beneficiaryId: row.beneficiaryId, programId: row.programId, programName: row.programName,
    programType: 'financial_support_v1', status: row.status,
    intakeAt: row.intakeAt, creationKind: row.creationKind,
    participantName: row.participantName, participantPhone: row.participantPhone,
    authorized: true, assigneeNames: row.assigneeNames as string[],
    // 옛 동의 2종(`consent`, `consentRecordedAt`)은 응답 모양만 확인하고 화면으로 내보내지 않는다.
    // 동의는 여섯 영역 사건이 정본이다(S7 §5.1.1).
    closedAt: row.closedAt, upcomingSchedule: decodeUpcomingSchedule(row.upcomingSchedule),
  };
}

export function decodeParticipantList(value: unknown): ParticipantListItem[] {
  const row = record(value);
  exactKeys(row, ['results']);
  if (!Array.isArray(row.results)) throw new BusinessError('invalid_response');
  return row.results.map(decodeListItem);
}

export function decodeParticipantHub(value: unknown, beneficiaryId: string): ParticipantHub {
  const row = record(value);
  const restricted = row.restricted === true;
  exactKeys(row, restricted
    ? ['beneficiaryId', 'restricted', 'participantName', 'participantPhone', 'participantEmail', 'programs']
    : ['beneficiaryId', 'restricted', 'participantName', 'participantPhone', 'participantEmail',
      'participantBirthDate', 'status', 'closedAt', 'sessionCount', 'lastSessionAt', 'programs']);
  if (row.beneficiaryId !== beneficiaryId || !isNullableString(row.participantName)
    || !isNullableString(row.participantPhone) || !isNullableString(row.participantEmail)
    || !Array.isArray(row.programs)) throw new BusinessError('invalid_response');
  const base = {
    beneficiaryId, restricted, participantName: row.participantName, participantPhone: row.participantPhone,
    participantEmail: row.participantEmail, programs: row.programs.map(decodeProgram),
  };
  if (restricted) {
    return { ...base, participantBirthDate: null, status: null, closedAt: null, sessionCount: null, lastSessionAt: null };
  }
  if (!isNullableString(row.participantBirthDate) || (row.status !== 'active' && row.status !== 'closed')
    || !isNullableString(row.closedAt) || !isNullableString(row.lastSessionAt)
    || typeof row.sessionCount !== 'number' || !Number.isSafeInteger(row.sessionCount) || row.sessionCount < 0) {
    throw new BusinessError('invalid_response');
  }
  return {
    ...base, participantBirthDate: row.participantBirthDate, status: row.status,
    closedAt: row.closedAt, sessionCount: row.sessionCount, lastSessionAt: row.lastSessionAt,
  };
}

export function decodeBasicInfo(value: unknown, beneficiaryId: string): ParticipantBasicInfo {
  const row = record(value);
  exactKeys(row, ['beneficiaryId', 'supportCaseContextId', 'version', ...BASIC_INFO_FIELDS]);
  if (row.beneficiaryId !== beneficiaryId || !isOpaqueIdentifier(row.supportCaseContextId)
    || typeof row.version !== 'number' || !Number.isSafeInteger(row.version) || row.version < 1
    || !BASIC_INFO_FIELDS.every((field) => isNullableString(row[field]))) throw new BusinessError('invalid_response');
  const fields = Object.fromEntries(
    BASIC_INFO_FIELDS.map((field) => [field, row[field] as string | null]),
  ) as Record<BasicInfoField, string | null>;
  return { beneficiaryId, supportCaseContextId: row.supportCaseContextId, version: row.version, ...fields };
}

export function decodeProgramOptions(value: unknown): ProgramOption[] {
  const row = record(value);
  exactKeys(row, ['programs']);
  if (!Array.isArray(row.programs)) throw new BusinessError('invalid_response');
  return row.programs.map((entry) => {
    const option = record(entry);
    exactKeys(option, ['id', 'displayName', 'programType', 'admissionState']);
    if (!isOpaqueIdentifier(option.id) || !isNullableString(option.displayName)
      || option.programType !== 'financial_support_v1'
      || !isAdmissionState(option.admissionState)) throw new BusinessError('invalid_response');
    return {
      id: option.id, displayName: option.displayName, programType: 'financial_support_v1' as const,
      admissionState: option.admissionState,
    };
  });
}

function decodeCreation(value: unknown): ParticipantCreationResult {
  const row = record(value);
  exactKeys(row, ['beneficiaryId', 'supportCaseId', 'assignmentRole', 'replayed']);
  if (!isOpaqueIdentifier(row.beneficiaryId) || !isOpaqueIdentifier(row.supportCaseId)
    || row.assignmentRole !== 'primary' || typeof row.replayed !== 'boolean') {
    throw new BusinessError('invalid_response');
  }
  return {
    beneficiaryId: row.beneficiaryId, supportCaseId: row.supportCaseId,
    assignmentRole: 'primary', replayed: row.replayed,
  };
}

function participantPath(beneficiaryId: string, suffix: string): string {
  if (!isOpaqueIdentifier(beneficiaryId)) throw new BusinessError('invalid_request', 400);
  return `/participants/${encodeURIComponent(beneficiaryId)}/${suffix}`;
}

export class ParticipantsApi {
  constructor(private readonly transport: BusinessTransport) {}

  async list(): Promise<ParticipantListItem[]> {
    return decodeParticipantList(await this.transport.request('/participants'));
  }

  async programOptions(): Promise<ProgramOption[]> {
    return decodeProgramOptions(await this.transport.request('/program-options'));
  }

  async hub(beneficiaryId: string): Promise<ParticipantHub> {
    return decodeParticipantHub(await this.transport.request(participantPath(beneficiaryId, 'hub')), beneficiaryId);
  }

  async basicInfo(beneficiaryId: string): Promise<ParticipantBasicInfo> {
    return decodeBasicInfo(await this.transport.request(participantPath(beneficiaryId, 'basic-info')), beneficiaryId);
  }

  /** 값이 온 항목만 보낸다. 빈 문자열은 null 로 보내 "지운다"가 되고, 안 보낸 키는 그대로 둔다. */
  async saveBasicInfo(
    beneficiaryId: string,
    input: { supportCaseContextId: string; expectedVersion: number } & Partial<Record<BasicInfoField, string | null>>,
  ): Promise<ParticipantBasicInfo> {
    if (!isOpaqueIdentifier(input.supportCaseContextId) || !Number.isSafeInteger(input.expectedVersion)) {
      throw new BusinessError('invalid_request', 400);
    }
    const body: Record<string, unknown> = {
      supportCaseContextId: input.supportCaseContextId, expectedVersion: input.expectedVersion,
    };
    for (const field of BASIC_INFO_FIELDS) {
      if (Object.hasOwn(input, field)) body[field] = input[field] ?? null;
    }
    return decodeBasicInfo(
      await this.transport.request(participantPath(beneficiaryId, 'basic-info'), 'PUT', body),
      beneficiaryId,
    );
  }

  async register(input: ParticipantRegistrationInput): Promise<ParticipantCreationResult> {
    if (!isOpaqueIdentifier(input.programId)) throw new BusinessError('invalid_request', 400);
    if (!isOpaqueIdentifier(input.idempotencyKey)) throw new BusinessError('invalid_request', 400);
    const body: Record<string, unknown> = {
      programId: input.programId,
      idempotencyKey: input.idempotencyKey,
      consentEvents: input.consentEvents,
    };
    if (input.emergencyReason !== undefined) body.emergencyReason = input.emergencyReason;
    if (input.initialAssigneeUserId !== undefined) body.initialAssigneeUserId = input.initialAssigneeUserId;
    for (const field of ['name', 'phone', 'email', 'birthDate', 'region', 'gender'] as const) {
      const value = input[field];
      if (value !== undefined && value.trim() !== '') body[field] = value.trim();
    }
    return decodeCreation(await this.transport.request('/participants', 'POST', body));
  }



  /**
   * 실무자 발 배정 요청(D86 ⑥). 요청자는 서버가 인증 주체에서 정한다. 이 호출은 접근을 열지 않는다.
   * 이미 요청했거나 담당이면 서버가 409로 막고 화면은 그 사실을 그대로 보여 준다.
   */
  async requestAssignment(supportCaseId: string, reason: string): Promise<{ id: string; status: string }> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    const trimmed = reason.trim();
    if (trimmed === '' || trimmed.length > 500 || /[\r\n]/u.test(trimmed)) {
      throw new BusinessError('invalid_request', 400);
    }
    const value = record(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/assignment-requests`, 'POST', { reason: trimmed },
    ));
    if (!isOpaqueIdentifier(value.id) || typeof value.status !== 'string') throw new BusinessError('invalid_response');
    return { id: value.id, status: value.status };
  }

  /** 기관 관리자만 쓴다. 승인은 공동 담당이나 이관 중 하나를 고르고, 반려는 사유가 필요하다. */
  async reviewAssignmentRequest(supportCaseId: string, assignmentId: string, input:
    { decision: 'coassign' | 'transfer' } | { decision: 'reject'; reason: string },
  ): Promise<{ id: string; status: string; role: string }> {
    if (!isOpaqueIdentifier(supportCaseId) || !isOpaqueIdentifier(assignmentId)) {
      throw new BusinessError('invalid_request', 400);
    }
    let body: { decision: 'coassign' | 'transfer' } | { decision: 'reject'; reason: string };
    if (input.decision === 'reject') {
      const reason = input.reason.trim();
      if (reason === '' || reason.length > 500 || /[\r\n]/u.test(reason)) {
        throw new BusinessError('invalid_request', 400);
      }
      body = { decision: 'reject', reason };
    } else {
      body = { decision: input.decision };
    }
    const value = record(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/assignment-requests/${encodeURIComponent(assignmentId)}/review`,
      'POST', body,
    ));
    if (!isOpaqueIdentifier(value.id) || typeof value.status !== 'string' || typeof value.role !== 'string') {
      throw new BusinessError('invalid_response');
    }
    return { id: value.id, status: value.status, role: value.role };
  }

  /**
   * 관리자 등록의 첫 담당 실무자 후보. 기존 계정 디렉터리를 커서로 끝까지 읽고 활성 실무자만 남긴다.
   * 사업 staff 목록으로 대신하지 않는다.
   */
  async activeWorkerOptions(): Promise<Array<{ id: string; name: string | null; email: string | null }>> {
    const options: Array<{ id: string; name: string | null; email: string | null }> = [];
    let cursor: string | null = null;
    for (let page = 0; page < 50; page += 1) {
      const payload: unknown = await this.transport.request(
        cursor === null ? '/settings/accounts' : `/settings/accounts?cursor=${encodeURIComponent(cursor)}`,
      );
      const row = record(payload);
      if (!Array.isArray(row.accounts) || !isNullableString(row.nextCursor)) {
        throw new BusinessError('invalid_response');
      }
      for (const entry of row.accounts) {
        const account = record(entry);
        if (!isOpaqueIdentifier(account.id) || typeof account.active !== 'boolean'
          || !Array.isArray(account.roles)) throw new BusinessError('invalid_response');
        if (!account.active || !account.roles.includes('worker')) continue;
        if (!isNullableString(account.name) || !isNullableString(account.email)) {
          throw new BusinessError('invalid_response');
        }
        options.push({ id: account.id, name: account.name, email: account.email });
      }
      cursor = row.nextCursor;
      if (cursor === null) return options;
    }
    throw new BusinessError('invalid_response');
  }
}
