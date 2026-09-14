// Versioned intake HTTP boundary. The shared contract owns the questionnaire and writes.
import type { CurrentConsentState } from '@ccc/contracts/consent';
import {
  INTAKE_WRITE_SCHEMA_VERSION, IntakeContractError, parseIntakeCreateRequest, parseIntakeQuestionLifecycle,
  parseIntakeUpdateRequest, parseIntakeQuestionnaire, type IntakeCreateRequest, type IntakeUpdateRequest,
  type IntakeModuleSnapshot, type IntakeSavedRecord, type IntakeRevision, type IntakeMutationResponse,
} from '@ccc/contracts/intake';
import { isNullableString, isOpaqueIdentifier, record } from './api';
import { decodeConsentStates } from './consent';
import { BusinessError } from './errors';
import type { BusinessTransport } from './transport';

export interface IntakeContext {
  beneficiaryId: string;
  supportCaseId: string;
  participant: { name: string | null; phone: string | null; email: string | null };
  sessionSequence: number;
  hasIntake: boolean;
  canWrite: boolean;
  writeSchemaVersion: typeof INTAKE_WRITE_SCHEMA_VERSION;
  moduleSnapshot: IntakeModuleSnapshot;
  extendedPii: { birthDate: string | null; region: string | null; emergencyContact: string | null; gender: string | null };
  consent: CurrentConsentState[];
  overallGoal: string | null;
  schedule: { id: string; version: number; scheduledAt: string } | null;
  saved: IntakeSavedRecord | null;
}

const positiveInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const channel = (value: unknown): value is IntakeCreateRequest['channel'] => value === 'in_person' || value === 'phone' || value === 'video';

function moduleSnapshot(value: unknown): IntakeModuleSnapshot {
  const row = record(value);
  if (!isOpaqueIdentifier(row.programId) || !positiveInteger(row.programVersion)
    || typeof row.financialSupportEnabled !== 'boolean') throw new BusinessError('invalid_response');
  return { programId: row.programId, programVersion: row.programVersion, financialSupportEnabled: row.financialSupportEnabled };
}

function savedRecord(value: unknown): IntakeSavedRecord | null {
  if (value === null) return null;
  const row = record(value);
  if (!isOpaqueIdentifier(row.sessionId) || !instant(row.heldAt) || !channel(row.channel)
    || !positiveInteger(row.revision) || !Array.isArray(row.history)) throw new BusinessError('invalid_response');
  const revision = row.revision;
  const history: IntakeRevision[] = row.history.map((entry) => {
    const item = record(entry);
    if (!positiveInteger(item.revision) || item.revision >= revision
      || (item.schemaVersion !== 1 && item.schemaVersion !== 2) || !instant(item.heldAt)
      || !channel(item.channel) || !isNullableString(item.actorId) || !instant(item.recordedAt)
      || !(item.convertedFromRevision === null || positiveInteger(item.convertedFromRevision))
      || !isNullableString(item.detailsJson)) throw new BusinessError('invalid_response');
    let questionLifecycle;
    try { questionLifecycle = item.questionLifecycle === null ? null : parseIntakeQuestionLifecycle(item.questionLifecycle); }
    catch { throw new BusinessError('invalid_response'); }
    return { revision: item.revision, schemaVersion: item.schemaVersion, heldAt: item.heldAt,
      channel: item.channel, actorId: item.actorId, recordedAt: item.recordedAt,
      convertedFromRevision: item.convertedFromRevision, detailsJson: item.detailsJson, questionLifecycle };
  });
  let questionLifecycle;
  try { questionLifecycle = row.questionLifecycle === null ? null : parseIntakeQuestionLifecycle(row.questionLifecycle); }
  catch { throw new BusinessError('invalid_response'); }
  const base = { sessionId: row.sessionId, heldAt: row.heldAt, channel: row.channel, revision, history, questionLifecycle };
  if (row.schemaVersion === 1 && row.questionnaire === null && isNullableString(row.legacyDetailsJson)) {
    return { ...base, schemaVersion: 1, questionnaire: null, legacyDetailsJson: row.legacyDetailsJson };
  }
  if (row.schemaVersion === 2 && row.legacyDetailsJson === null) {
    try { return { ...base, schemaVersion: 2, questionnaire: parseIntakeQuestionnaire(row.questionnaire), legacyDetailsJson: null }; }
    catch { throw new BusinessError('invalid_response'); }
  }
  throw new BusinessError('invalid_response');
}

export function decodeIntakeContext(value: unknown, supportCaseId: string): IntakeContext {
  const row = record(value);
  const participant = record(row.participant);
  const pii = record(row.extendedPii);
  if (row.supportCaseId !== supportCaseId || !isOpaqueIdentifier(row.beneficiaryId)
    || !positiveInteger(row.sessionSequence) || typeof row.hasIntake !== 'boolean'
    || typeof row.canWrite !== 'boolean' || row.writeSchemaVersion !== INTAKE_WRITE_SCHEMA_VERSION
    || !isNullableString(row.overallGoal) || !isNullableString(participant.name)
    || !isNullableString(participant.phone) || !isNullableString(participant.email)) throw new BusinessError('invalid_response');
  const saved = savedRecord(row.saved);
  if (row.hasIntake !== (saved !== null)) throw new BusinessError('invalid_response');
  const piiValue = (key: string): string | null => {
    if (pii[key] === undefined || pii[key] === null) return null;
    if (typeof pii[key] !== 'string') throw new BusinessError('invalid_response');
    return pii[key];
  };
  const schedule = row.schedule === null ? null : record(row.schedule);
  if (schedule !== null && (!isOpaqueIdentifier(schedule.id) || !positiveInteger(schedule.version) || !instant(schedule.scheduledAt))) {
    throw new BusinessError('invalid_response');
  }
  return {
    beneficiaryId: row.beneficiaryId, supportCaseId,
    participant: { name: participant.name, phone: participant.phone, email: participant.email },
    sessionSequence: row.sessionSequence, hasIntake: row.hasIntake, canWrite: row.canWrite,
    writeSchemaVersion: INTAKE_WRITE_SCHEMA_VERSION, moduleSnapshot: moduleSnapshot(row.moduleSnapshot),
    extendedPii: { birthDate: piiValue('birthDate'), region: piiValue('region'), emergencyContact: piiValue('emergencyContact'), gender: piiValue('gender') },
    consent: decodeConsentStates({ consent: row.consent }), overallGoal: row.overallGoal,
    schedule: schedule === null ? null : { id: schedule.id as string, version: schedule.version as number, scheduledAt: schedule.scheduledAt as string },
    saved,
  };
}

function mutationResponse(value: unknown): IntakeMutationResponse {
  const row = record(value);
  const saved = record(row.record);
  if (row.schemaVersion !== INTAKE_WRITE_SCHEMA_VERSION || !positiveInteger(row.revision) || typeof row.replayed !== 'boolean'
    || !isOpaqueIdentifier(saved.id) || !instant(saved.heldAt) || !channel(saved.channel) || saved.kind !== 'intake') {
    throw new BusinessError('invalid_response');
  }
  return { schemaVersion: INTAKE_WRITE_SCHEMA_VERSION, revision: row.revision, replayed: row.replayed,
    record: { id: saved.id, heldAt: saved.heldAt, channel: saved.channel, kind: 'intake' } };
}

export class IntakeApi {
  constructor(private readonly transport: BusinessTransport) {}

  async context(supportCaseId: string): Promise<IntakeContext> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    return decodeIntakeContext(await this.transport.request(`/support-cases/${encodeURIComponent(supportCaseId)}/records/intake`), supportCaseId);
  }

  async create(supportCaseId: string, input: IntakeCreateRequest): Promise<IntakeMutationResponse> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    try { parseIntakeCreateRequest(input); }
    catch (error) { if (error instanceof IntakeContractError) throw new BusinessError('invalid_request', 400); throw error; }
    return mutationResponse(await this.transport.request(`/support-cases/${encodeURIComponent(supportCaseId)}/records/intake`, 'POST', input));
  }

  async update(supportCaseId: string, input: IntakeUpdateRequest): Promise<IntakeMutationResponse> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    try { parseIntakeUpdateRequest(input); }
    catch (error) { if (error instanceof IntakeContractError) throw new BusinessError('invalid_request', 400); throw error; }
    return mutationResponse(await this.transport.request(`/support-cases/${encodeURIComponent(supportCaseId)}/records/intake`, 'PUT', input));
  }
}
