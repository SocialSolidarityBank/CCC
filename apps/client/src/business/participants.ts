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
  newSignup: boolean;
}

export interface ParticipantConsent {
  privacy: boolean;
  recordingAi: boolean;
}

export interface ParticipantProgram {
  id: string;
  beneficiaryId: string;
  programType: 'financial_support_v1';
  status: 'active' | 'closed';
  intakeAt: string | null;
  creationKind: 'legacy_import' | 'initial' | 'subsequent';
  participantName: string | null;
  participantPhone: string | null;
  /** D36: 담당하지 않는 사업은 목록에만 오르고 상담 내용으로 들어갈 수 없다. */
  authorized: boolean;
  assigneeNames: string[];
  consent: ParticipantConsent;
  consentRecordedAt: string | null;
  upcomingSchedule: { id: string; scheduledAt: string; sessionKind: 'regular' | 'intake' } | null;
}

export interface ParticipantHub {
  beneficiaryId: string;
  participantName: string | null;
  participantPhone: string | null;
  participantEmail: string | null;
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
  consentPrivacy: boolean;
  consentRecordingAi: boolean;
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
  exactKeys(row, ['beneficiaryId', 'status', 'programCount', 'name', 'phone', 'newSignup']);
  if (!isOpaqueIdentifier(row.beneficiaryId) || (row.status !== 'active' && row.status !== 'closed')
    || typeof row.programCount !== 'number' || !Number.isSafeInteger(row.programCount) || row.programCount < 0
    || !isNullableString(row.name) || !isNullableString(row.phone)
    || typeof row.newSignup !== 'boolean') throw new BusinessError('invalid_response');
  return {
    beneficiaryId: row.beneficiaryId, status: row.status, programCount: row.programCount,
    name: row.name, phone: row.phone, newSignup: row.newSignup,
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

function decodeConsent(value: unknown): ParticipantConsent {
  const row = record(value);
  exactKeys(row, ['privacy', 'recordingAi']);
  if (typeof row.privacy !== 'boolean' || typeof row.recordingAi !== 'boolean') {
    throw new BusinessError('invalid_response');
  }
  return { privacy: row.privacy, recordingAi: row.recordingAi };
}

function decodeProgram(value: unknown): ParticipantProgram {
  const row = record(value);
  exactKeys(row, ['id', 'beneficiaryId', 'programType', 'status', 'intakeAt', 'creationKind', 'sourceSupportCase',
    'participantName', 'participantPhone', 'authorized', 'assigneeNames', 'consent', 'consentRecordedAt',
    'upcomingSchedule']);
  if (!isOpaqueIdentifier(row.id) || !isOpaqueIdentifier(row.beneficiaryId)
    || row.programType !== 'financial_support_v1'
    || (row.status !== 'active' && row.status !== 'closed')
    || !isNullableString(row.intakeAt)
    || (row.creationKind !== 'legacy_import' && row.creationKind !== 'initial' && row.creationKind !== 'subsequent')
    || !isNullableString(row.participantName) || !isNullableString(row.participantPhone)
    || typeof row.authorized !== 'boolean'
    || !Array.isArray(row.assigneeNames) || !row.assigneeNames.every((name) => typeof name === 'string')
    || !isNullableString(row.consentRecordedAt)) throw new BusinessError('invalid_response');
  return {
    id: row.id, beneficiaryId: row.beneficiaryId, programType: 'financial_support_v1', status: row.status,
    intakeAt: row.intakeAt, creationKind: row.creationKind,
    participantName: row.participantName, participantPhone: row.participantPhone,
    authorized: row.authorized, assigneeNames: row.assigneeNames as string[],
    consent: decodeConsent(row.consent), consentRecordedAt: row.consentRecordedAt,
    upcomingSchedule: decodeUpcomingSchedule(row.upcomingSchedule),
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
  exactKeys(row, ['beneficiaryId', 'participantName', 'participantPhone', 'participantEmail', 'programs']);
  if (row.beneficiaryId !== beneficiaryId || !isNullableString(row.participantName)
    || !isNullableString(row.participantPhone) || !isNullableString(row.participantEmail)
    || !Array.isArray(row.programs)) throw new BusinessError('invalid_response');
  return {
    beneficiaryId, participantName: row.participantName, participantPhone: row.participantPhone,
    participantEmail: row.participantEmail, programs: row.programs.map(decodeProgram),
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
    const body: Record<string, unknown> = {
      programId: input.programId,
      consentPrivacy: input.consentPrivacy,
      consentRecordingAi: input.consentRecordingAi,
    };
    if (input.emergencyReason !== undefined) body.emergencyReason = input.emergencyReason;
    if (input.initialAssigneeUserId !== undefined) body.initialAssigneeUserId = input.initialAssigneeUserId;
    for (const field of ['name', 'phone', 'email', 'birthDate', 'region', 'gender'] as const) {
      const value = input[field];
      if (value !== undefined && value.trim() !== '') body[field] = value.trim();
    }
    return decodeCreation(await this.transport.request('/participants', 'POST', body));
  }

  async updateConsent(supportCaseId: string, consent: ParticipantConsent): Promise<ParticipantConsent> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    const value = record(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/consent`, 'PUT',
      { privacy: consent.privacy, recordingAi: consent.recordingAi },
    ));
    exactKeys(value, ['supportCaseId', 'privacy', 'recordingAi', 'recordedAt']);
    if (value.supportCaseId !== supportCaseId || typeof value.privacy !== 'boolean'
      || typeof value.recordingAi !== 'boolean' || !isNullableString(value.recordedAt)) {
      throw new BusinessError('invalid_response');
    }
    return { privacy: value.privacy, recordingAi: value.recordingAi };
  }
}
