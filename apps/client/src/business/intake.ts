// 인테이크 기록의 API 경계 (P5). 정본 질문지는 `intake-form.ts`가 갖고 여기서는 계약만 다룬다.
// 저장은 케이스당 한 번이고, 저장된 뒤에는 같은 화면이 수정으로 바뀐다.

import type { CurrentConsentState } from '@ccc/contracts/consent';
import { isNullableString, isOpaqueIdentifier, record } from './api';
import { decodeConsentStates } from './consent';
import { BusinessError } from './errors';
import { INTAKE_RESPONSES, type IntakeResponse, type IntakeTableName } from './intake-form';
import type { BusinessTransport } from './transport';

export interface IntakeAnswer { key: string; response: IntakeResponse; text?: string }
export type IntakeTableRow = Record<string, string>;

export interface IntakeContext {
  beneficiaryId: string;
  supportCaseId: string;
  participant: { name: string | null; phone: string | null; email: string | null };
  sessionSequence: number;
  hasIntake: boolean;
  extendedPii: { birthDate: string | null; region: string | null; emergencyContact: string | null; gender: string | null };
  /** 여섯 영역 현재 상태(S7). 인테이크 화면은 읽기만 하고 여기서 동의를 바꾸지 않는다. */
  consent: CurrentConsentState[];
  overallGoal: string | null;
  schedule: { id: string; version: number; scheduledAt: string } | null;
  saved: {
    sessionId: string;
    heldAt: string;
    answers: IntakeAnswer[];
    debts: IntakeTableRow[];
    linkedOrgs: IntakeTableRow[];
    additionalItems: IntakeTableRow[];
    managerOpinion: string | null;
  } | null;
}

function decodeAnswers(value: unknown): IntakeAnswer[] {
  if (!Array.isArray(value)) throw new BusinessError('invalid_response');
  return value.map((entry) => {
    const row = record(entry);
    if (typeof row.key !== 'string' || typeof row.response !== 'string'
      || !(INTAKE_RESPONSES as readonly string[]).includes(row.response)
      || (row.text !== undefined && typeof row.text !== 'string')) throw new BusinessError('invalid_response');
    return {
      key: row.key, response: row.response as IntakeResponse,
      ...(row.text === undefined ? {} : { text: row.text }),
    };
  });
}

function decodeRows(value: unknown): IntakeTableRow[] {
  if (!Array.isArray(value)) throw new BusinessError('invalid_response');
  return value.map((entry) => {
    const row = record(entry);
    const decoded: IntakeTableRow = {};
    for (const [key, cell] of Object.entries(row)) {
      if (typeof cell !== 'string') throw new BusinessError('invalid_response');
      decoded[key] = cell;
    }
    return decoded;
  });
}

export function decodeIntakeContext(value: unknown, supportCaseId: string): IntakeContext {
  const row = record(value);
  const participant = record(row.participant);
  const extendedPii = record(row.extendedPii);

  const schedule = row.schedule === null || row.schedule === undefined ? null : record(row.schedule);
  const saved = row.saved === null || row.saved === undefined ? null : record(row.saved);
  if (row.supportCaseId !== supportCaseId || !isOpaqueIdentifier(row.beneficiaryId)
    || typeof row.sessionSequence !== 'number' || !Number.isSafeInteger(row.sessionSequence)
    || typeof row.hasIntake !== 'boolean' || !isNullableString(row.overallGoal)
    || !isNullableString(participant.name) || !isNullableString(participant.phone)
    || !isNullableString(participant.email)) throw new BusinessError('invalid_response');
  const pii = (key: string): string | null => {
    const cell = extendedPii[key];
    if (cell === undefined || cell === null) return null;
    if (typeof cell !== 'string') throw new BusinessError('invalid_response');
    return cell;
  };
  return {
    beneficiaryId: row.beneficiaryId, supportCaseId,
    participant: { name: participant.name, phone: participant.phone, email: participant.email },
    sessionSequence: row.sessionSequence, hasIntake: row.hasIntake,
    extendedPii: {
      birthDate: pii('birthDate'), region: pii('region'),
      emergencyContact: pii('emergencyContact'), gender: pii('gender'),
    },
    consent: decodeConsentStates({ consent: row.consent }),
    overallGoal: row.overallGoal,
    schedule: schedule === null ? null : (() => {
      if (!isOpaqueIdentifier(schedule.id) || typeof schedule.version !== 'number'
        || typeof schedule.scheduledAt !== 'string') throw new BusinessError('invalid_response');
      return { id: schedule.id, version: schedule.version, scheduledAt: schedule.scheduledAt };
    })(),
    saved: saved === null ? null : (() => {
      if (!isOpaqueIdentifier(saved.sessionId) || typeof saved.heldAt !== 'string'
        || !isNullableString(saved.managerOpinion)) throw new BusinessError('invalid_response');
      return {
        sessionId: saved.sessionId, heldAt: saved.heldAt, answers: decodeAnswers(saved.answers),
        debts: decodeRows(saved.debts), linkedOrgs: decodeRows(saved.linkedOrgs),
        additionalItems: decodeRows(saved.additionalItems), managerOpinion: saved.managerOpinion,
      };
    })(),
  };
}

export interface IntakeSubmission {
  submissionId: string;
  heldAt: string;
  answers: IntakeAnswer[];
  tables: Record<IntakeTableName, IntakeTableRow[]>;
  managerOpinion: string;
  extendedPii?: Partial<Record<'birthDate' | 'region' | 'emergencyContact' | 'gender', string>>;
  schedule?: { id: string; expectedVersion: number };
}

export class IntakeApi {
  constructor(private readonly transport: BusinessTransport) {}

  async context(supportCaseId: string): Promise<IntakeContext> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    return decodeIntakeContext(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/records/intake`,
    ), supportCaseId);
  }

  private body(input: IntakeSubmission, create: boolean): Record<string, unknown> {
    const answers = input.answers.filter((answer) => answer.response !== 'answered' || (answer.text ?? '').trim() !== '')
      .map((answer) => (answer.response === 'answered'
        ? { key: answer.key, response: answer.response, text: (answer.text ?? '').trim() }
        : { key: answer.key, response: answer.response }));
    const rows = (name: IntakeTableName) => input.tables[name]
      .map((row) => Object.fromEntries(Object.entries(row)
        .filter(([, cell]) => cell.trim() !== '').map(([key, cell]) => [key, cell.trim()])))
      .filter((row) => Object.keys(row).length > 0);
    const extendedPii = Object.fromEntries(Object.entries(input.extendedPii ?? {})
      .filter(([, cell]) => typeof cell === 'string' && cell.trim() !== '')
      .map(([key, cell]) => [key, (cell as string).trim()]));
    return {
      ...(create ? { submissionId: input.submissionId } : {}),
      heldAt: input.heldAt,
      // D4: v1은 대면만이다.
      channel: 'in_person',
      answers,
      debts: rows('debts'),
      linkedOrgs: rows('linkedOrgs'),
      additionalItems: rows('additionalItems'),
      ...(input.managerOpinion.trim() === '' ? {} : { managerOpinion: input.managerOpinion.trim() }),
      ...(create && Object.keys(extendedPii).length > 0 ? { extendedPii } : {}),
      ...(create && input.schedule !== undefined
        ? { scheduleId: input.schedule.id, expectedScheduleVersion: input.schedule.expectedVersion }
        : {}),
    };
  }

  /** 케이스당 한 번이다. 같은 제출 ID로 다시 보내면 서버가 기존 회차를 돌려준다. */
  async create(supportCaseId: string, input: IntakeSubmission): Promise<{ id: string; replayed: boolean }> {
    if (!isOpaqueIdentifier(supportCaseId) || !isOpaqueIdentifier(input.submissionId)) {
      throw new BusinessError('invalid_request', 400);
    }
    const response = record(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/records/intake`, 'POST', this.body(input, true),
    ));
    const saved = record(response.record);
    if (!isOpaqueIdentifier(saved.id) || typeof response.replayed !== 'boolean') {
      throw new BusinessError('invalid_response');
    }
    return { id: saved.id, replayed: response.replayed };
  }

  /** 저장된 인테이크 수정. 위저드가 소유한 필드만 덮어쓴다. */
  async update(supportCaseId: string, input: IntakeSubmission): Promise<string> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    const response = record(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/records/intake`, 'PUT', this.body(input, false),
    ));
    const saved = record(response.record);
    if (!isOpaqueIdentifier(saved.id)) throw new BusinessError('invalid_response');
    return saved.id;
  }
}
