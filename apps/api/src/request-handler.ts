import {
  ACTION_ITEM_RESOLUTION_STATUSES,
  type ActionItemResolutionStatus,
  AiProviderNotConfiguredError,
  assertSupportCaseAccess,
  ConflictError,
  ContrastResolutionRequiredError,
  SpeakerConfirmationRequiredError,
  DraftVersionRequiredError,
  FLAG_TYPES,
  ForbiddenError,
  GroundedEvidenceRequiredError,
  FixtureDraftApprovalForbiddenError,
  LIFE_AREA_KEYS,
  LIFE_AREA_STATUSES,
  INTAKE_ANSWER_KEYS,
  INTAKE_ANSWER_RESPONSES,
  INTAKE_EXTENDED_PII_FIELDS,
  PARTICIPANT_BASIC_INFO_FIELDS,
  NotApprovedError,
  PilotTextAiConsentRequiredError,
  StaleDraftVersionError,
  TextAiPilotDisabledError,
  ValidationError,
  PrivacyConsentRequiredError,
  EmergencyReasonRequiredError,
  assertPilotTextAiConsent,
  assertRecordingUploadAllowed,
  approveSession,
  activateAiProviderConfiguration,
  collectDiscrepancyDetectionSources,
  replaceSessionDiscrepancies,
  resolveSessionDiscrepancy,
  listRecordErrorSessionIds,
  assignSupportCase,
  COUNSELING_RECORD_DETAIL_KEYS,
  cancelCounselingSchedule,
  closeGoal,
  countUpcomingSchedulesLinkedToGoal,
  createBeneficiaryWithInitialSupportCase,
  createCase,
  createCounselingRecord,
  createIntakeRecord,
  updateIntakeRecord,
  createParticipantInvite,
  completeParticipantSignup,
  getInviteForSignup,
  getIntakeRecordContext,
  createCounselingSchedule,
  listScheduleCandidates,
  createGeneratedAiDraftForService,
  createFixtureGeneratedAiDraftForService,
  createGoal,
  createSupportCase,
  deactivateUser,
  editAiDraftForSession,
  getActiveAiProviderRuntimeMetadataForService,
  getActiveAiProviderStatus,
  getAiDraftRegenerationAvailability,
  getBriefing,
  getCase,
  getCurrentAiDraftForSession,
  getLatestPilotTextAiConsentStatus,
  getParticipantBasicInfo,
  getParticipantBriefing,
  getParticipantGoalTree,
  getPipelineAudioKey,
  getPipelineHealth,
  getMyIdentity,
  getLastProgramType,
  getOrganizationProfile,
  completeOrganizationOnboarding,
  rememberLastProgramType,
  getNextCounselingScheduleForSupportCase,
  getScheduleSessionPlan,
  getSession,
  getTodaySchedules,
  getMonthSchedules,
  getUpcomingSchedules,
  listCases,
  listCounselingRecords,
  listCounselorAssignments,
  listGoals,
  listPipelineJobs,
  listTextWorkItems,
  getTextWorkItemSource,
  completeTextWorkItem,
  claimRecordingResultDownstream,
  commitRecordingResult,
  enqueueTextWorkForGoalChange,
  enqueueTextWorkItem,
  finalizeRecordingResult,
  releaseRecordingResultDownstream,
  listSessions,
  listSupportCaseAssignees,
  listAssignedParticipants,
  listPrivacyConsentFollowUps,
  listSupportCasesForBeneficiary,
  listUsers,
  loadAiCallMaterialsForService,
  markCounselingScheduleNoShow,
  previewExpiredPii,
  purgeExpiredPiiAsAdmin,
  recordAiCallOutcome,
  recordMaskedSourceSnapshot,
  recordPilotTextAiConsentEvidence,
  registerAiProviderConfiguration,
  registerRecording,
  rescheduleCounselingSchedule,
  reviewAiDraftForSession,
  updateScheduleSessionGoals,
  searchParticipants,
  setSupportCaseOverallGoal,
  updateGoalTitle,
  updateParticipantConsent,
  updateParticipantPii,
  upsertUser,
  SESSION_GOAL_MATERIAL_LABEL,
  type Actor,
  type AiCallFailureReason,
  type AiCallMaterial,
  type AiCallOutcome,
  type AiDraftContrastAxis,
  type AiDraftSourceMaterialRef,
  type AiDraftVersion,
  type AiDraftReviewInput,
  type AiContrastResolutionInput,
  type CounselingRecordDetails,
  type AssignedParticipant,
  type ParticipantSearchResult,
  type Role,
  type Session,
} from '../../../db/gateway';
import { isBeneficiaryId } from '../../../db/animal-slugs';
import {
  AI_CONTRAST_AXES,
  AI_DRAFT_PROMPT_VERSION,
  AI_DRAFT_SCHEMA_VERSION,
  DISCREPANCY_PROMPT_VERSION,
  AiProviderInputError,
  AiProviderProhibitedOutputError,
  AiProviderUnavailableError,
  type AiContrastAxisStates,
  type AiContrastAxisStatus,
  type AiProviderMaterial,
  type AiProviderOutput,
  type AiProviderUnavailableReason,
  canonicalAiProviderConfigHash,
  detectPreviewFixtureDiscrepancies,
  generatePreviewFixtureAiDraft,
  resolveAiProviderAdapter,
  validateAiDraftSummary,
  validateAiEvidenceIds,
  validateAiProviderOutput,
  validateAiProviderRequest,
  validateDiscrepancyDetectionOutput,
  validateDiscrepancyDetectionRequest,
} from './ai-provider';
import { ActorAuthenticationError, actorFromRequest, type ApiEnv } from './identity';
// preview-gate 는 여기서 타입만 가져가므로(import type) 런타임 순환이 생기지 않는다.
import { previewModeEnabled } from './preview-gate';
import {
  MAX_AUDIO_BYTES,
  deleteAudioObject,
  getAudioObject,
  newAudioKey,
  normalizeAudioContentType,
  putAudioObject,
} from './audio-store';

type JsonObject = Record<string, unknown>;

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
};

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...jsonHeaders, ...headers } });
}

function sessionResponse(session: Session): Omit<Session, 'audioR2Key'> {
  const { audioR2Key: _audioR2Key, ...response } = session;
  return response;
}

function asObject(value: unknown): JsonObject {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new ValidationError('request JSON must be an object');
  }
  return value as JsonObject;
}

async function requestBody(request: Request): Promise<JsonObject> {
  try {
    return asObject(await request.json());
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('request body must be valid JSON');
  }
}

function requiredString(body: JsonObject, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) throw new ValidationError(key + ' is required');
  return value;
}

function optionalString(body: JsonObject, key: string): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ValidationError(key + ' must be a string');
  return value;
}

function optionalNullableString(body: JsonObject, key: string): string | null | undefined {
  const value = body[key];
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw new ValidationError(key + ' must be a string or null');
  return value;
}

function optionalBoolean(body: JsonObject, key: string): boolean {
  const value = body[key];
  if (value === undefined) return false;
  if (typeof value !== 'boolean') throw new ValidationError(key + ' must be a boolean');
  return value;
}

// 등록 이메일(#37 · T2 enc_email): 선택 항목. 형식 검증은 라우트가 소유하고(잘못된 형식은
// 400), 게이트웨이는 비어 있지 않은지만 본 뒤 AES-GCM 으로 금고에 저장한다(D3 · D24).
// 없으면 undefined 를 돌려 호출부가 게이트웨이 입력 키에서 아예 뺀다(assertExactKeys 대비).
const REGISTERED_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function optionalRegisteredEmail(body: JsonObject): string | undefined {
  const value = body.email;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ValidationError('email must be a string');
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > 254 || !REGISTERED_EMAIL.test(trimmed)) {
    throw new ValidationError('email is invalid');
  }
  return trimmed;
}

// 등록 이름·연락처(#37 보완): 선택 항목. 비어 있지 않은 문자열 + 길이 상한만 라우트에서
// 검증하고, 저장은 게이트웨이가 AES-GCM 으로 한다(D3 · D24). 없으면 undefined.
function optionalRegisteredText(body: JsonObject, key: string, maxLength: number): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ValidationError(key + ' must be a string');
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLength) throw new ValidationError(key + ' is invalid');
  return trimmed;
}

function objectArray(value: unknown, key: string): JsonObject[] {
  if (!Array.isArray(value)) throw new ValidationError(key + ' must be an array');
  return value.map(asObject);
}


function parseApproval(body: JsonObject) {
  const expectedDraftVersion = body.expectedDraftVersion;
  if (
    expectedDraftVersion !== undefined
    && (typeof expectedDraftVersion !== 'number' || !Number.isInteger(expectedDraftVersion) || expectedDraftVersion < 1)
  ) {
    throw new DraftVersionRequiredError();
  }
  return {
    ...(expectedDraftVersion === undefined ? {} : { expectedDraftVersion }),
    missingFromMemo: objectArray(body.missingFromMemo, 'missingFromMemo').map((item) => {
      const actionValue = requiredString(item, 'action');
      if (actionValue !== 'accept' && actionValue !== 'dismiss') throw new ValidationError('missingFromMemo action is invalid');
      const action: 'accept' | 'dismiss' = actionValue;
      return { item: requiredString(item, 'item'), action };
    }),
    missingFromAudio: objectArray(body.missingFromAudio, 'missingFromAudio').map((item) => {
      const actionValue = requiredString(item, 'action');
      if (actionValue !== 'confirmed' && actionValue !== 'corrected') throw new ValidationError('missingFromAudio action is invalid');
      const action: 'confirmed' | 'corrected' = actionValue;
      return { item: requiredString(item, 'item'), action };
    }),
    undiscussedGoals: objectArray(body.undiscussedGoals, 'undiscussedGoals').map((item) => {
      const goalId = requiredString(item, 'goalId');
      const note = optionalString(item, 'note');
      return note === undefined ? { goalId } : { goalId, note };
    }),
  };
}

function requireOnlyKeys(body: JsonObject, allowed: readonly string[]): void {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new ValidationError('request contains unsupported fields');
  }
}
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CANONICAL_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CANONICAL_DATE = /^\d{4}-\d{2}-\d{2}$/;

// 확장 단계(티켓 #11): 레거시 A형식과 동물 슬러그 형식을 모두 수용한다 (D20).
function requireBeneficiaryId(value: string): string {
  if (!isBeneficiaryId(value)) throw new ValidationError('beneficiary id is invalid');
  return value;
}

function requiredUuid(body: JsonObject, key: string): string {
  const value = requiredString(body, key);
  if (!CANONICAL_UUID.test(value)) throw new ValidationError(key + ' is invalid');
  return value;
}

function requireRouteUuid(value: string, key: string): string {
  if (!CANONICAL_UUID.test(value)) throw new ValidationError(key + ' is invalid');
  return value;
}

function canonicalUtc(value: string, key: string): string {
  if (!CANONICAL_UTC_INSTANT.test(value)) throw new ValidationError(key + ' is invalid');
  try {
    if (new Date(value).toISOString() !== value) throw new ValidationError(key + ' is invalid');
  } catch {
    throw new ValidationError(key + ' is invalid');
  }
  return value;
}

function requiredCanonicalUtc(body: JsonObject, key: string): string {
  return canonicalUtc(requiredString(body, key), key);
}

function canonicalDate(value: string, key: string): string {
  if (!CANONICAL_DATE.test(value)) throw new ValidationError(key + ' is invalid');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new ValidationError(key + ' is invalid');
  }
  return value;
}

function requiredExpectedVersion(body: JsonObject, key: string): number {
  const value = body[key];
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new ValidationError(key + ' is invalid');
  }
  return value as number;
}

function requireHumanParticipantActor(actor: Actor): void {
  if (actor.role !== 'admin' && actor.role !== 'counselor') {
    throw new ForbiddenError('human participant access is required');
  }
}

function requireFinancialSupportProgramType(body: JsonObject): 'financial_support_v1' {
  if (body.programType !== 'financial_support_v1') {
    throw new ValidationError('program type is invalid');
  }
  return 'financial_support_v1';
}

/**
 * 긴급 등록 사유 (G1). **빈 문자열도 그대로 넘긴다** — "긴급 등록을 골랐는데 사유가 비었다"는
 * 판정은 게이트웨이가 `emergency_reason_required` 로 내려야 화면이 그 자리를 짚어 안내한다.
 * 여기서 400 invalid_request 로 뭉치면 원인 없는 실패가 된다(게이트 문서 §2 G1).
 */
function optionalEmergencyReason(body: JsonObject): string | undefined {
  const value = body.emergencyReason;
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ValidationError('emergencyReason must be a string');
  if (value.length > 500) throw new ValidationError('emergencyReason is invalid');
  return value;
}

function parseInitialParticipantCreation(body: JsonObject, actor: Actor) {
  requireHumanParticipantActor(actor);
  // 항목별 동의(D15·D23)는 등록 입력과 함께 오지만 게이트웨이에는 별도 인자로 넘긴다.
  // 등록 폼은 두 체크 상태(false 포함)를 항상 보내므로 동의 기록을 남긴다. 두 키가 모두
  // 없는 (레거시/프로그램) 호출은 동의 기록을 만들지 않는다(하위 호환). 어느 항목이든
  // 체크는 기본 미동의(false)이며, 미동의여도 등록은 진행된다(D15 미동의 경로).
  // D49: 동의는 2종이다 — ① consentPrivacy · ② consentRecordingAi(구 녹음+텍스트 AI 를 합침).
  // 등록 폼은 항상 둘을 보내고, 둘 다 없는 호출만 하위 호환이다.
  // G1(2026-07-29 Q 결정1): ① 은 이제 등록의 하드 게이트다. 그래서 HTTP 등록은 동의 키가
  // 없어도 **언제나** consent 객체(전부 false)를 만들어 게이트웨이 게이트를 지나게 한다 —
  // 하위 호환으로 게이트를 건너뛰는 구멍을 두지 않는다. 통과 경로는 ① 체크 또는 긴급 등록뿐이다.
  const emergencyReason = optionalEmergencyReason(body);
  const consent = {
    privacy: optionalBoolean(body, 'consentPrivacy'),
    recordingAi: optionalBoolean(body, 'consentRecordingAi'),
    ...(emergencyReason === undefined ? {} : { emergency: { reason: emergencyReason } }),
  };
  // 이메일은 선택 항목이다. undefined 면 게이트웨이 입력에서 아예 빼야 한다 —
  // { email: undefined } 로 두면 Object.keys 에 남아 assertExactKeys 가 거부한다(#37).
  const email = optionalRegisteredEmail(body);
  const name = optionalRegisteredText(body, 'name', 100);
  const phone = optionalRegisteredText(body, 'phone', 32);
  // D41 1-1: 생년월일·주소(거주지역)·성별도 등록이 받는다. 값은 금고에 암호화 저장된다.
  const birthDate = optionalRegisteredText(body, 'birthDate', 10);
  const region = optionalRegisteredText(body, 'region', 200);
  const gender = optionalRegisteredText(body, 'gender', 20);
  const optionalPii = {
    ...(name === undefined ? {} : { name }),
    ...(phone === undefined ? {} : { phone }),
    ...(email === undefined ? {} : { email }),
    ...(birthDate === undefined ? {} : { birthDate }),
    ...(region === undefined ? {} : { region }),
    ...(gender === undefined ? {} : { gender }),
  };
  // intakeAt 키는 받지 않는다(CCC-56): 등록은 인테이크가 아니다. intake_at 은 NULL 로
  // 시작하고, 인테이크 기록 저장(createIntakeRecord)이 채운다. 모르는 키는 400 이므로
  // 옛 클라이언트가 보내던 intakeAt 도 여기서 걸린다.
  const registrationKeys = ['consentPrivacy', 'consentRecordingAi', 'emergencyReason', 'name', 'phone', 'email', 'birthDate', 'region', 'gender'];
  if (actor.role === 'admin') {
    requireOnlyKeys(body, ['programType', 'initialAssigneeUserId', ...registrationKeys]);
    return {
      input: {
        programType: requireFinancialSupportProgramType(body),
        initialAssigneeUserId: requiredUuid(body, 'initialAssigneeUserId'),
        ...optionalPii,
      },
      consent,
    };
  }
  requireOnlyKeys(body, ['programType', ...registrationKeys]);
  return {
    input: {
      programType: requireFinancialSupportProgramType(body),
      ...optionalPii,
    },
    consent,
  };
}

function parseSubsequentParticipantCreation(body: JsonObject, actor: Actor) {
  requireHumanParticipantActor(actor);
  // G1: 추가 참여 사업도 ① 하드 게이트를 지난다 — 두 번째 사업은 동의 2종이 미체크로
  // 시작하므로(D44) 여기서 다시 받는다. D49: ② 도 이 경로에서 받는다(전에는 사업을 만든 뒤
  // 당사자 정보 페이지에서 따로 고쳐야 했다). ② 는 게이트가 아니라 선택이므로 키가 없으면 뺀다.
  const emergencyReason = optionalEmergencyReason(body);
  const consentKeys = ['consentPrivacy', 'consentRecordingAi', 'emergencyReason'];
  const consentRecordingAi = Object.hasOwn(body, 'consentRecordingAi')
    ? optionalBoolean(body, 'consentRecordingAi')
    : undefined;
  const consentInput = {
    consentPrivacy: optionalBoolean(body, 'consentPrivacy'),
    ...(consentRecordingAi === undefined ? {} : { consentRecordingAi }),
    ...(emergencyReason === undefined ? {} : { emergencyReason }),
  };
  // intakeAt 키는 여기서도 받지 않는다(CCC-56) — 추가 참여 사업도 등록 시점에는 인테이크 전이다.
  if (actor.role === 'admin') {
    requireOnlyKeys(body, ['schemaVersion', 'submissionId', 'programType', 'initialAssigneeUserId', ...consentKeys]);
    return {
      schemaVersion: requiredSchemaVersion(body),
      submissionId: requiredUuid(body, 'submissionId'),
      programType: requireFinancialSupportProgramType(body),
      initialAssigneeUserId: requiredUuid(body, 'initialAssigneeUserId'),
      ...consentInput,
    };
  }
  requireOnlyKeys(body, ['schemaVersion', 'submissionId', 'programType', 'sourceSupportCaseId', ...consentKeys]);
  return {
    schemaVersion: requiredSchemaVersion(body),
    submissionId: requiredUuid(body, 'submissionId'),
    programType: requireFinancialSupportProgramType(body),
    sourceSupportCaseId: requiredUuid(body, 'sourceSupportCaseId'),
    ...consentInput,
  };
}

function requiredSchemaVersion(body: JsonObject): 1 {
  if (body.schemaVersion !== 1) throw new ValidationError('schema version is invalid');
  return 1;
}

function parseRecordCreation(body: JsonObject) {
  const hasSchedule = Object.hasOwn(body, 'scheduleId') || Object.hasOwn(body, 'expectedScheduleVersion');
  const hasResolutions = Object.hasOwn(body, 'actionResolutions');
  const hasLifeAreas = Object.hasOwn(body, 'lifeAreas');
  const hasDetails = Object.hasOwn(body, 'details');
  const allowedKeys = ['submissionId', 'heldAt', 'channel', 'memo', 'gasScores', 'actions', 'flags'];
  if (hasResolutions) allowedKeys.push('actionResolutions');
  if (hasLifeAreas) allowedKeys.push('lifeAreas');
  if (hasDetails) allowedKeys.push('details');
  if (hasSchedule) allowedKeys.push('scheduleId', 'expectedScheduleVersion');
  requireOnlyKeys(body, allowedKeys);
  const channelValue = requiredString(body, 'channel');
  if (channelValue !== 'in_person' && channelValue !== 'phone' && channelValue !== 'video') {
    throw new ValidationError('record channel is invalid');
  }
  const channel: 'in_person' | 'phone' | 'video' = channelValue;
  const gasScores = objectArray(body.gasScores, 'gasScores').map((score) => {
    requireOnlyKeys(score, ['goalId', 'score']);
    const value = score.score;
    if (!Number.isInteger(value) || (value as number) < -2 || (value as number) > 2) {
      throw new ValidationError('GAS score is invalid');
    }
    return { goalId: requiredUuid(score, 'goalId'), score: value as -2 | -1 | 0 | 1 | 2 };
  });
  if (new Set(gasScores.map((score) => score.goalId)).size !== gasScores.length) {
    throw new ValidationError('GAS score is duplicated');
  }
  const actionItems = objectArray(body.actions, 'actions').map((action) => {
    requireOnlyKeys(action, Object.hasOwn(action, 'dueDate') ? ['description', 'owner', 'dueDate'] : ['description', 'owner']);
    const ownerValue = requiredString(action, 'owner');
    if (ownerValue !== 'counselor' && ownerValue !== 'beneficiary' && ownerValue !== 'org') {
      throw new ValidationError('action owner is invalid');
    }
    const owner: 'counselor' | 'beneficiary' | 'org' = ownerValue;
    const dueDate = action.dueDate;
    if (dueDate !== undefined && typeof dueDate !== 'string') {
      throw new ValidationError('dueDate is invalid');
    }
    return {
      description: requiredString(action, 'description'),
      owner,
      ...(dueDate === undefined ? {} : { dueDate: canonicalDate(dueDate, 'dueDate') }),
    };
  });
  const flags = objectArray(body.flags, 'flags').map((flag) => {
    requireOnlyKeys(flag, ['flagType']);
    const flagType = requiredString(flag, 'flagType');
    if (!(FLAG_TYPES as readonly string[]).includes(flagType)) {
      throw new ValidationError('flag type is invalid');
    }
    return { flagType: flagType as typeof FLAG_TYPES[number] };
  });
  const actionItemResolutions = hasResolutions
    ? objectArray(body.actionResolutions, 'actionResolutions').map((resolution) => {
      requireOnlyKeys(resolution, Object.hasOwn(resolution, 'note') ? ['actionItemId', 'status', 'note'] : ['actionItemId', 'status']);
      const status = requiredString(resolution, 'status');
      if (!(ACTION_ITEM_RESOLUTION_STATUSES as readonly string[]).includes(status)) {
        throw new ValidationError('action item resolution status is invalid');
      }
      return {
        actionItemId: requiredUuid(resolution, 'actionItemId'),
        status: status as ActionItemResolutionStatus,
        ...(Object.hasOwn(resolution, 'note') ? { note: requiredString(resolution, 'note') } : {}),
      };
    })
    : undefined;
  const lifeAreas = hasLifeAreas
    ? objectArray(body.lifeAreas, 'lifeAreas').map((area) => {
      const changed = area.changed;
      if (typeof changed !== 'boolean') throw new ValidationError('life area changed is invalid');
      requireOnlyKeys(
        area,
        changed
          ? (Object.hasOwn(area, 'note') ? ['areaKey', 'changed', 'status', 'note'] : ['areaKey', 'changed', 'status'])
          : ['areaKey', 'changed'],
      );
      const areaKey = requiredString(area, 'areaKey');
      if (!(LIFE_AREA_KEYS as readonly string[]).includes(areaKey)) {
        throw new ValidationError('life area key is invalid');
      }
      if (!changed) {
        return { areaKey: areaKey as typeof LIFE_AREA_KEYS[number], changed: false as const };
      }
      const status = requiredString(area, 'status');
      if (!(LIFE_AREA_STATUSES as readonly string[]).includes(status)) {
        throw new ValidationError('life area status is invalid');
      }
      return {
        areaKey: areaKey as typeof LIFE_AREA_KEYS[number],
        changed: true as const,
        status: status as typeof LIFE_AREA_STATUSES[number],
        ...(Object.hasOwn(area, 'note') ? { note: requiredString(area, 'note') } : {}),
      };
    })
    : undefined;
  // 서술형 항목(CCC-10): 알려진 키만, 값은 공백 아닌 문자열. 빈 객체는 게이트웨이가 거부한다.
  const details = hasDetails
    ? (() => {
      const raw = asObject(body.details);
      requireOnlyKeys(raw, COUNSELING_RECORD_DETAIL_KEYS);
      const parsed: Record<string, string> = {};
      for (const key of COUNSELING_RECORD_DETAIL_KEYS) {
        if (Object.hasOwn(raw, key)) parsed[key] = requiredString(raw, key);
      }
      return parsed;
    })()
    : undefined;
  return {
    submissionId: requiredUuid(body, 'submissionId'),
    heldAt: requiredCanonicalUtc(body, 'heldAt'),
    channel,
    memo: requiredString(body, 'memo'),
    gasScores,
    actionItems,
    flags,
    ...(actionItemResolutions === undefined ? {} : { actionItemResolutions }),
    ...(lifeAreas === undefined ? {} : { lifeAreas }),
    ...(details === undefined ? {} : { details }),
    ...(hasSchedule
      ? {
        scheduleId: requiredUuid(body, 'scheduleId'),
        expectedScheduleVersion: requiredExpectedVersion(body, 'expectedScheduleVersion'),
      }
      : {}),
  };
}

function requiredBoolean(body: JsonObject, key: string): boolean {
  const value = body[key];
  if (typeof value !== 'boolean') throw new ValidationError(key + ' must be a boolean');
  return value;
}

// 인테이크 제출 파서(CCC-7). 게이트웨이 createIntakeRecord 입력으로 정규화한다.
// 바디 키는 정기 기록과 맞춰 액션은 'actions' 로 받고, 게이트웨이엔 actionItems 로 넘긴다.
function parseIntakeCreation(body: JsonObject) {
  const hasSchedule = Object.hasOwn(body, 'scheduleId') || Object.hasOwn(body, 'expectedScheduleVersion');
  const hasManagerOpinion = Object.hasOwn(body, 'managerOpinion');
  const hasAnswers = Object.hasOwn(body, 'answers');
  const hasExtendedPii = Object.hasOwn(body, 'extendedPii');
  const hasAdditionalItems = Object.hasOwn(body, 'additionalItems');
  const hasNextMeeting = Object.hasOwn(body, 'nextMeeting');
  // D42: 동의·원하는 도움 3문·6영역·목표·다음 행동은 정본 질문지에 대응 항목이 없어 선택이다.
  const hasConsent = Object.hasOwn(body, 'consent');
  const hasHelpNarrative = Object.hasOwn(body, 'helpNarrative');
  const hasLifeAreas = Object.hasOwn(body, 'lifeAreas');
  const hasGoals = Object.hasOwn(body, 'goals');
  const hasActions = Object.hasOwn(body, 'actions');
  const hasDebts = Object.hasOwn(body, 'debts');
  const hasLinkedOrgs = Object.hasOwn(body, 'linkedOrgs');
  const allowedKeys = ['submissionId', 'heldAt', 'channel'];
  if (hasConsent) allowedKeys.push('consent');
  if (hasHelpNarrative) allowedKeys.push('helpNarrative');
  if (hasLifeAreas) allowedKeys.push('lifeAreas');
  if (hasGoals) allowedKeys.push('goals');
  if (hasActions) allowedKeys.push('actions');
  if (hasAnswers) allowedKeys.push('answers');
  if (hasExtendedPii) allowedKeys.push('extendedPii');
  if (hasAdditionalItems) allowedKeys.push('additionalItems');
  if (hasDebts) allowedKeys.push('debts');
  if (hasLinkedOrgs) allowedKeys.push('linkedOrgs');
  if (hasNextMeeting) allowedKeys.push('nextMeeting');
  if (hasManagerOpinion) allowedKeys.push('managerOpinion');
  if (hasSchedule) allowedKeys.push('scheduleId', 'expectedScheduleVersion');
  requireOnlyKeys(body, allowedKeys);

  const channelValue = requiredString(body, 'channel');
  if (channelValue !== 'in_person' && channelValue !== 'phone' && channelValue !== 'video') {
    throw new ValidationError('record channel is invalid');
  }
  const channel: 'in_person' | 'phone' | 'video' = channelValue;

  const consent = !hasConsent ? undefined : (() => {
    const consentObject = asObject(body.consent);
    requireOnlyKeys(consentObject, ['privacy', 'recordingAi']);
    return {
      privacy: requiredBoolean(consentObject, 'privacy'),
      recordingAi: requiredBoolean(consentObject, 'recordingAi'),
    };
  })();

  const helpNarrative = !hasHelpNarrative ? undefined : (() => {
    const narrativeObject = asObject(body.helpNarrative);
    requireOnlyKeys(narrativeObject, ['todayHelp', 'hardestPoint', 'desiredChange']);
    return {
      todayHelp: requiredString(narrativeObject, 'todayHelp'),
      hardestPoint: requiredString(narrativeObject, 'hardestPoint'),
      desiredChange: requiredString(narrativeObject, 'desiredChange'),
    };
  })();

  const lifeAreas = !hasLifeAreas ? undefined : objectArray(body.lifeAreas, 'lifeAreas').map((area) => {
    requireOnlyKeys(area, Object.hasOwn(area, 'note') ? ['areaKey', 'status', 'note'] : ['areaKey', 'status']);
    const areaKey = requiredString(area, 'areaKey');
    if (!(LIFE_AREA_KEYS as readonly string[]).includes(areaKey)) {
      throw new ValidationError('life area key is invalid');
    }
    const status = requiredString(area, 'status');
    if (!(LIFE_AREA_STATUSES as readonly string[]).includes(status)) {
      throw new ValidationError('life area status is invalid');
    }
    return {
      areaKey: areaKey as typeof LIFE_AREA_KEYS[number],
      status: status as typeof LIFE_AREA_STATUSES[number],
      ...(Object.hasOwn(area, 'note') ? { note: requiredString(area, 'note') } : {}),
    };
  });

  const goals = !hasGoals ? undefined : objectArray(body.goals, 'goals').map((goal) => {
    requireOnlyKeys(goal, Object.hasOwn(goal, 'scaleCriteria') ? ['title', 'scaleCriteria'] : ['title']);
    return {
      title: requiredString(goal, 'title'),
      ...(Object.hasOwn(goal, 'scaleCriteria') ? { scaleCriteria: goal.scaleCriteria } : {}),
    };
  });

  const actionItems = !hasActions ? undefined : objectArray(body.actions, 'actions').map((action) => {
    requireOnlyKeys(action, Object.hasOwn(action, 'dueDate') ? ['description', 'owner', 'dueDate'] : ['description', 'owner']);
    const ownerValue = requiredString(action, 'owner');
    if (ownerValue !== 'counselor' && ownerValue !== 'beneficiary' && ownerValue !== 'org') {
      throw new ValidationError('action owner is invalid');
    }
    const owner: 'counselor' | 'beneficiary' | 'org' = ownerValue;
    const dueDate = action.dueDate;
    if (dueDate !== undefined && typeof dueDate !== 'string') {
      throw new ValidationError('dueDate is invalid');
    }
    return {
      description: requiredString(action, 'description'),
      owner,
      ...(dueDate === undefined ? {} : { dueDate: canonicalDate(dueDate, 'dueDate') }),
    };
  });

  // 질문지 답변(D41). 키·응답 어휘는 게이트웨이 상수를 그대로 쓴다.
  const answers = !hasAnswers ? undefined : objectArray(body.answers, 'answers').map((answer) => {
    requireOnlyKeys(answer, Object.hasOwn(answer, 'text') ? ['key', 'response', 'text'] : ['key', 'response']);
    const key = requiredString(answer, 'key');
    if (!(INTAKE_ANSWER_KEYS as readonly string[]).includes(key)) {
      throw new ValidationError('intake answer key is invalid');
    }
    const response = requiredString(answer, 'response');
    if (!(INTAKE_ANSWER_RESPONSES as readonly string[]).includes(response)) {
      throw new ValidationError('intake answer response is invalid');
    }
    return {
      key: key as typeof INTAKE_ANSWER_KEYS[number],
      response: response as typeof INTAKE_ANSWER_RESPONSES[number],
      ...(Object.hasOwn(answer, 'text') ? { text: requiredString(answer, 'text') } : {}),
    };
  });

  // 추가 개인정보(P4) — 준 필드만 넘긴다. 값은 게이트웨이가 금고에 암호화 저장한다(D3).
  const extendedPiiObject = hasExtendedPii ? asObject(body.extendedPii) : undefined;
  const extendedPii = extendedPiiObject === undefined ? undefined : (() => {
    requireOnlyKeys(extendedPiiObject, INTAKE_EXTENDED_PII_FIELDS);
    const patch: Record<string, string> = {};
    for (const field of INTAKE_EXTENDED_PII_FIELDS) {
      if (Object.hasOwn(extendedPiiObject, field)) patch[field] = requiredString(extendedPiiObject, field);
    }
    return patch;
  })();

  const additionalItems = !hasAdditionalItems
    ? undefined
    : objectArray(body.additionalItems, 'additionalItems').map((entry) => {
      const entryKeys = ['item'];
      for (const key of ['owner', 'dueDate', 'reason', 'method', 'dueNote']) {
        if (Object.hasOwn(entry, key)) entryKeys.push(key);
      }
      requireOnlyKeys(entry, entryKeys);
      return {
        item: requiredString(entry, 'item'),
        ...(Object.hasOwn(entry, 'owner') ? { owner: requiredString(entry, 'owner') } : {}),
        ...(Object.hasOwn(entry, 'dueDate') ? { dueDate: canonicalDate(requiredString(entry, 'dueDate'), 'dueDate') } : {}),
        ...(Object.hasOwn(entry, 'reason') ? { reason: requiredString(entry, 'reason') } : {}),
        ...(Object.hasOwn(entry, 'method') ? { method: requiredString(entry, 'method') } : {}),
        ...(Object.hasOwn(entry, 'dueNote') ? { dueNote: requiredString(entry, 'dueNote') } : {}),
      };
    });

  // 반복 행 표 2종(2-1 부채 · 3-3 연계 기관). 첫 열만 필수이고 나머지는 준 것만 넘긴다.
  function tableRows(value: unknown, label: string, requiredKey: string, optionalKeys: readonly string[]) {
    return objectArray(value, label).map((row) => {
      const keys = [requiredKey, ...optionalKeys.filter((key) => Object.hasOwn(row, key))];
      requireOnlyKeys(row, keys);
      return Object.fromEntries(keys.map((key) => [key, requiredString(row, key)]));
    });
  }
  const debts = !hasDebts
    ? undefined
    : tableRows(body.debts, 'debts', 'creditor', ['kind', 'balance', 'monthlyPayment', 'arrearsStatus']) as Array<
      { creditor: string; kind?: string; balance?: string; monthlyPayment?: string; arrearsStatus?: string }>;
  const linkedOrgs = !hasLinkedOrgs
    ? undefined
    : tableRows(body.linkedOrgs, 'linkedOrgs', 'orgName', ['serviceName', 'supportDetail', 'usagePeriod', 'progressStatus']) as Array<
      { orgName: string; serviceName?: string; supportDetail?: string; usagePeriod?: string; progressStatus?: string }>;

  const nextMeeting = !hasNextMeeting ? undefined : (() => {
    const meeting = asObject(body.nextMeeting);
    requireOnlyKeys(meeting, ['heldAt', 'channel']);
    const meetingChannel = requiredString(meeting, 'channel');
    if (meetingChannel !== 'in_person' && meetingChannel !== 'phone' && meetingChannel !== 'video') {
      throw new ValidationError('next meeting channel is invalid');
    }
    return {
      heldAt: requiredCanonicalUtc(meeting, 'heldAt'),
      channel: meetingChannel as 'in_person' | 'phone' | 'video',
    };
  })();

  return {
    submissionId: requiredUuid(body, 'submissionId'),
    heldAt: requiredCanonicalUtc(body, 'heldAt'),
    channel,
    ...(consent === undefined ? {} : { consent }),
    ...(helpNarrative === undefined ? {} : { helpNarrative }),
    ...(lifeAreas === undefined ? {} : { lifeAreas }),
    ...(goals === undefined ? {} : { goals }),
    ...(actionItems === undefined ? {} : { actionItems }),
    ...(answers === undefined ? {} : { answers }),
    ...(extendedPii === undefined ? {} : { extendedPii }),
    ...(additionalItems === undefined ? {} : { additionalItems }),
    ...(debts === undefined ? {} : { debts }),
    ...(linkedOrgs === undefined ? {} : { linkedOrgs }),
    ...(nextMeeting === undefined ? {} : { nextMeeting }),
    ...(hasManagerOpinion ? { managerOpinion: requiredString(body, 'managerOpinion') } : {}),
    ...(hasSchedule
      ? {
        scheduleId: requiredUuid(body, 'scheduleId'),
        expectedScheduleVersion: requiredExpectedVersion(body, 'expectedScheduleVersion'),
      }
      : {}),
  };
}

/**
 * 인테이크 수정 입력(2026-08-08 Q "확인/수정"). parseIntakeCreation 의 부분집합이다 —
 * 위저드가 소유한 필드만 받고, 동의·목표·금고·일정 연결은 이 경로에 없다.
 */
function parseIntakeUpdate(body: JsonObject) {
  const hasManagerOpinion = Object.hasOwn(body, 'managerOpinion');
  const hasAnswers = Object.hasOwn(body, 'answers');
  const hasAdditionalItems = Object.hasOwn(body, 'additionalItems');
  const hasDebts = Object.hasOwn(body, 'debts');
  const hasLinkedOrgs = Object.hasOwn(body, 'linkedOrgs');
  const allowedKeys = ['heldAt', 'channel'];
  if (hasAnswers) allowedKeys.push('answers');
  if (hasAdditionalItems) allowedKeys.push('additionalItems');
  if (hasDebts) allowedKeys.push('debts');
  if (hasLinkedOrgs) allowedKeys.push('linkedOrgs');
  if (hasManagerOpinion) allowedKeys.push('managerOpinion');
  requireOnlyKeys(body, allowedKeys);

  const channelValue = requiredString(body, 'channel');
  if (channelValue !== 'in_person' && channelValue !== 'phone' && channelValue !== 'video') {
    throw new ValidationError('record channel is invalid');
  }

  const answers = !hasAnswers ? undefined : objectArray(body.answers, 'answers').map((answer) => {
    requireOnlyKeys(answer, Object.hasOwn(answer, 'text') ? ['key', 'response', 'text'] : ['key', 'response']);
    const key = requiredString(answer, 'key');
    if (!(INTAKE_ANSWER_KEYS as readonly string[]).includes(key)) {
      throw new ValidationError('intake answer key is invalid');
    }
    const response = requiredString(answer, 'response');
    if (!(INTAKE_ANSWER_RESPONSES as readonly string[]).includes(response)) {
      throw new ValidationError('intake answer response is invalid');
    }
    return {
      key: key as typeof INTAKE_ANSWER_KEYS[number],
      response: response as typeof INTAKE_ANSWER_RESPONSES[number],
      ...(Object.hasOwn(answer, 'text') ? { text: requiredString(answer, 'text') } : {}),
    };
  });

  const additionalItems = !hasAdditionalItems
    ? undefined
    : objectArray(body.additionalItems, 'additionalItems').map((entry) => {
      const entryKeys = ['item'];
      for (const key of ['owner', 'dueDate', 'reason', 'method', 'dueNote']) {
        if (Object.hasOwn(entry, key)) entryKeys.push(key);
      }
      requireOnlyKeys(entry, entryKeys);
      return {
        item: requiredString(entry, 'item'),
        ...(Object.hasOwn(entry, 'owner') ? { owner: requiredString(entry, 'owner') } : {}),
        ...(Object.hasOwn(entry, 'dueDate') ? { dueDate: canonicalDate(requiredString(entry, 'dueDate'), 'dueDate') } : {}),
        ...(Object.hasOwn(entry, 'reason') ? { reason: requiredString(entry, 'reason') } : {}),
        ...(Object.hasOwn(entry, 'method') ? { method: requiredString(entry, 'method') } : {}),
        ...(Object.hasOwn(entry, 'dueNote') ? { dueNote: requiredString(entry, 'dueNote') } : {}),
      };
    });

  function tableRows(value: unknown, label: string, requiredKey: string, optionalKeys: readonly string[]) {
    return objectArray(value, label).map((row) => {
      const keys = [requiredKey, ...optionalKeys.filter((key) => Object.hasOwn(row, key))];
      requireOnlyKeys(row, keys);
      return Object.fromEntries(keys.map((key) => [key, requiredString(row, key)]));
    });
  }
  const debts = !hasDebts
    ? undefined
    : tableRows(body.debts, 'debts', 'creditor', ['kind', 'balance', 'monthlyPayment', 'arrearsStatus']) as Array<
      { creditor: string; kind?: string; balance?: string; monthlyPayment?: string; arrearsStatus?: string }>;
  const linkedOrgs = !hasLinkedOrgs
    ? undefined
    : tableRows(body.linkedOrgs, 'linkedOrgs', 'orgName', ['serviceName', 'supportDetail', 'usagePeriod', 'progressStatus']) as Array<
      { orgName: string; serviceName?: string; supportDetail?: string; usagePeriod?: string; progressStatus?: string }>;

  return {
    heldAt: requiredCanonicalUtc(body, 'heldAt'),
    channel: channelValue as 'in_person' | 'phone' | 'video',
    ...(answers === undefined ? {} : { answers }),
    ...(additionalItems === undefined ? {} : { additionalItems }),
    ...(debts === undefined ? {} : { debts }),
    ...(linkedOrgs === undefined ? {} : { linkedOrgs }),
    ...(hasManagerOpinion ? { managerOpinion: requiredString(body, 'managerOpinion') } : {}),
  };
}

function parseScheduleSessionGoals(body: JsonObject): Array<{ body: string; caseGoalId: string | null }> | undefined {
  if (!Object.hasOwn(body, 'sessionGoals')) return undefined;
  return objectArray(body.sessionGoals, 'sessionGoals').map((goal) => {
    requireOnlyKeys(goal, ['body', 'caseGoalId']);
    const text = requiredString(goal, 'body');
    const caseGoalId = goal.caseGoalId;
    if (caseGoalId === undefined || caseGoalId === null) return { body: text, caseGoalId: null };
    if (typeof caseGoalId !== 'string' || !CANONICAL_UUID.test(caseGoalId)) {
      throw new ValidationError('caseGoalId is invalid');
    }
    return { body: text, caseGoalId };
  });
}

function parseScheduleCustomQuestions(body: JsonObject): string[] | undefined {
  if (!Object.hasOwn(body, 'customQuestions')) return undefined;
  if (!Array.isArray(body.customQuestions)) throw new ValidationError('customQuestions must be an array');
  return body.customQuestions.map((question) => {
    if (typeof question !== 'string' || question.trim().length === 0) {
      throw new ValidationError('customQuestions entries must be non-empty strings');
    }
    return question;
  });
}

// 상담 유형(#36). 생략 가능하며, 주면 'regular'|'intake' 만 허용한다.
function parseScheduleKind(body: JsonObject): 'regular' | 'intake' | undefined {
  if (!Object.hasOwn(body, 'sessionKind')) return undefined;
  const value = body.sessionKind;
  if (value !== 'regular' && value !== 'intake') throw new ValidationError('sessionKind is invalid');
  return value;
}

// 상담 방법(#36, D4). 생략 가능하며, v1 은 'in_person' 만 허용한다.
function parseScheduleChannel(body: JsonObject): 'in_person' | undefined {
  if (!Object.hasOwn(body, 'channel')) return undefined;
  if (body.channel !== 'in_person') throw new ValidationError('channel is invalid');
  return body.channel;
}

// 인테이크 케이스 목표(#36, D12). 생략 가능하며, 주면 비어 있지 않은 문자열 배열이어야 한다.
function parseScheduleCaseGoals(body: JsonObject): string[] | undefined {
  if (!Object.hasOwn(body, 'caseGoals')) return undefined;
  if (!Array.isArray(body.caseGoals)) throw new ValidationError('caseGoals must be an array');
  return body.caseGoals.map((title) => {
    if (typeof title !== 'string' || title.trim().length === 0) {
      throw new ValidationError('caseGoals entries must be non-empty strings');
    }
    return title;
  });
}

function parseScheduleCreation(body: JsonObject) {
  requireOnlyKeys(body, [
    'beneficiaryId', 'supportCaseId', 'scheduledAt',
    'sessionKind', 'channel', 'sessionGoals', 'caseGoals', 'customQuestions',
  ]);
  const sessionKind = parseScheduleKind(body);
  const channel = parseScheduleChannel(body);
  const sessionGoals = parseScheduleSessionGoals(body);
  const caseGoals = parseScheduleCaseGoals(body);
  const customQuestions = parseScheduleCustomQuestions(body);
  return {
    beneficiaryId: requireBeneficiaryId(requiredString(body, 'beneficiaryId')),
    supportCaseId: requiredUuid(body, 'supportCaseId'),
    scheduledAt: requiredCanonicalUtc(body, 'scheduledAt'),
    ...(sessionKind === undefined ? {} : { sessionKind }),
    ...(channel === undefined ? {} : { channel }),
    ...(sessionGoals === undefined ? {} : { sessionGoals }),
    ...(caseGoals === undefined ? {} : { caseGoals }),
    ...(customQuestions === undefined ? {} : { customQuestions }),
  };
}

function parseScheduleReschedule(body: JsonObject) {
  requireOnlyKeys(body, ['expectedVersion', 'scheduledAt']);
  return {
    expectedVersion: requiredExpectedVersion(body, 'expectedVersion'),
    scheduledAt: requiredCanonicalUtc(body, 'scheduledAt'),
  };
}

function parseScheduleTransition(body: JsonObject) {
  requireOnlyKeys(body, ['expectedVersion']);
  return { expectedVersion: requiredExpectedVersion(body, 'expectedVersion') };
}

// 세션 목표 수정 (D62 §6 · CCC-70). 묶음 통째 교체라 sessionGoals 는 필수다.
// 빈 배열은 "전부 지움"이고, 키 생략은 실수로 본다(생성의 선택 필드와 다른 계약).
function parseScheduleSessionGoalsUpdate(body: JsonObject) {
  requireOnlyKeys(body, ['expectedVersion', 'sessionGoals']);
  const sessionGoals = parseScheduleSessionGoals(body);
  if (sessionGoals === undefined) throw new ValidationError('sessionGoals is required');
  return {
    expectedVersion: requiredExpectedVersion(body, 'expectedVersion'),
    sessionGoals,
  };
}

function requestQuery(url: URL, allowed: readonly string[]): URLSearchParams {
  for (const key of new Set(url.searchParams.keys())) {
    if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) {
      throw new ValidationError('query is invalid');
    }
  }
  return url.searchParams;
}

function participantSearchResultResponse(result: ParticipantSearchResult) {
  // D24·ADR-0005: 선택 UI 실명 목록을 위해 실명을 싣는다(서버 복호화 완료값). 연락처·계좌는 제외.
  return {
    beneficiaryId: result.beneficiaryId,
    status: result.status,
    programCount: result.programCount,
    name: result.name,
  };
}

function assignedParticipantResponse(participant: AssignedParticipant) {
  // 목록 화면은 실명·연락처를 기본 표시한다(D24·ADR-0005 — 역할 기준, 계좌는 제외).
  return {
    beneficiaryId: participant.beneficiaryId,
    status: participant.status,
    programCount: participant.programCount,
    name: participant.name,
    phone: participant.phone,
  };
}

function participantProgramResponse(
  entry: Awaited<ReturnType<typeof listSupportCasesForBeneficiary>>['programs'][number],
  participant: Awaited<ReturnType<typeof listSupportCasesForBeneficiary>>['participant'],
) {
  const { supportCase } = entry;
  return {
    id: supportCase.id,
    beneficiaryId: supportCase.beneficiaryId,
    programType: supportCase.programType,
    status: supportCase.status,
    intakeAt: supportCase.intakeAt,
    creationKind: supportCase.creationKind,
    sourceSupportCase: null,
    // D24·ADR-0005: 당사자 상세는 실명·연락처를 기본 표시. 한 당사자의 프로그램들이라 값은 동일.
    participantName: participant.name,
    participantPhone: participant.phone,
    // D36: 내가 담당하지 않는 사업도 목록에 나오되 상담 내용으로는 들어갈 수 없다.
    // 화면은 authorized 로 링크를 걸거나 잠그고, assigneeNames 로 "누구에게 물어보나"를 답한다.
    authorized: entry.authorized,
    assigneeNames: entry.assigneeNames,
    // D44: 동의의 현재 상태. 시각 자체가 아니라 여부만 내린다 — 화면은 체크 상태를
    // 그리고, "언제 기록했나"는 consentRecordedAt 한 줄로 충분하다.
    // D49 표시 규칙: ② 는 두 컬럼 중 하나라도 찍혀 있으면 동의로 읽는다(구 3종 기록 호환).
    consent: {
      privacy: supportCase.consentPrivacyAt !== null,
      recordingAi: supportCase.consentRecordingAt !== null || supportCase.consentTextAiAt !== null,
    },
    // 동의 시각이 아니라 **기록 시각**이다 — 3종을 모두 철회하면 동의 시각은 전부 NULL 이라
    // 방금 남긴 철회 기록이 "기록 없음"으로 보인다. 값은 append-only 이력에서 온다.
    consentRecordedAt: entry.consentRecordedAt,
    // 허브 '최신 일정' 카드(2026-08-06 Q). 담당 사업에만 실리고 비담당은 null 이다(D36).
    upcomingSchedule: entry.upcomingSchedule,
  };
}

function counselorAssignmentResponse(
  participant: Awaited<ReturnType<typeof listCounselorAssignments>>['participants'][number],
) {
  return {
    beneficiaryId: participant.beneficiaryId,
    supportCaseId: participant.supportCaseId,
    programType: participant.programType,
    status: participant.status,
    assignmentRole: participant.assignmentRole,
    // D24·ADR-0005: admin 관리자 영역은 실명·연락처를 기본 표시. 계좌는 싣지 않는다.
    participantName: participant.name,
    participantPhone: participant.phone,
  };
}

function supportCaseAssigneeResponse(
  assignee: Awaited<ReturnType<typeof listSupportCaseAssignees>>[number],
) {
  return {
    id: assignee.id,
    supportCaseId: assignee.supportCaseId,
    userId: assignee.userId,
    role: assignee.role,
    assignedAt: assignee.assignedAt,
  };
}

function scheduleResponse(schedule: Awaited<ReturnType<typeof rescheduleCounselingSchedule>>) {
  return {
    id: schedule.id,
    beneficiaryId: schedule.beneficiaryId,
    supportCaseId: schedule.supportCaseId,
    scheduledAt: schedule.scheduledAt,
    status: schedule.status,
    version: schedule.version,
  };
}

function scheduleSessionPlanResponse(plan: Awaited<ReturnType<typeof getScheduleSessionPlan>>) {
  return {
    scheduleId: plan.scheduleId,
    beneficiaryId: plan.beneficiaryId,
    supportCaseId: plan.supportCaseId,
    scheduledAt: plan.scheduledAt,
    status: plan.status,
    version: plan.version,
    sessionKind: plan.sessionKind,
    channel: plan.channel,
    sessionGoals: plan.sessionGoals.map((goal) => ({
      id: goal.id,
      body: goal.body,
      caseGoalId: goal.caseGoalId,
      caseGoalTitle: goal.caseGoalTitle,
      ordinal: goal.ordinal,
    })),
    customQuestions: plan.customQuestions.map((question) => ({
      id: question.id,
      body: question.body,
      ordinal: question.ordinal,
    })),
  };
}

function normalizeParticipantBriefing(briefing: Awaited<ReturnType<typeof getParticipantBriefing>>) {
  const sources = [
    briefing.focusedSupportCase,
    ...briefing.supportCases.filter((supportCase) => supportCase.id !== briefing.focusedSupportCase.id),
  ];
  return {
    beneficiaryId: briefing.beneficiaryId,
    focusSupportCaseId: briefing.focusedSupportCase.id,
    // D45 전체 목표 — 포커스 케이스당 1개, NULL = 설정 전. 편집 가능 여부는 게이트웨이 판정.
    overallGoal: briefing.overallGoal,
    // D62 §8 (CCC-69): 포커스 케이스의 활성 세부 목표 — 전체 목표 카드 아래 최대 3줄.
    activeGoals: briefing.focusActiveGoals.map((goal) => ({ id: goal.id, title: goal.title })),
    canEditOverallGoal: briefing.canEditOverallGoal,
    // D24·ADR-0005: 담당·기관 관리자(=접근 권한 통과자)에게 실명·연락처를 기본 표시.
    participant: briefing.participant,
    sections: sources.map((sourceSupportCase) => {
      const summary = briefing.summaries.find((candidate) => candidate.sourceSupportCase.id === sourceSupportCase.id);
      return {
        sourceSupportCase,
        gasTrend: briefing.gasTrends
          .filter((trend) => trend.sourceSupportCase.id === sourceSupportCase.id)
          .map((trend) => ({
            goalId: trend.goal.id,
            goalTitle: trend.goal.title,
            status: trend.goal.status,
            closedAt: trend.goal.closedAt,
            points: trend.points,
          })),
        lastSessionSummary: summary === undefined
          ? null
          : {
            source: summary.source,
            text: summary.text,
            pendingApprovalCount: summary.pendingApprovalCount,
          },
        // 브리핑에는 승인 대기 초안 본문을 싣지 않는다(R2). fixture 회차 ID만 전용 검수
        // 화면 입구로 내리고, 그 화면이 provenance를 다시 fail-closed 검증한다.
        pendingReviewSessionIds:
          briefing.pendingReviewSessionIdsBySupportCase[sourceSupportCase.id] ?? [],
        openActionItems: briefing.actionItems
          .filter((item) => item.sourceSupportCase.id === sourceSupportCase.id)
          .map(({ action }) => ({
            id: action.id,
            description: action.description,
            owner: action.owner,
            dueDate: action.dueDate,
          })),
        flags: briefing.flags
          .filter((item) => item.sourceSupportCase.id === sourceSupportCase.id)
          .map(({ flag }) => ({
            id: flag.id,
            flagType: flag.flagType,
            source: flag.source,
            reviewStatus: flag.reviewStatus,
          })),
        // D45 영역 ① AI 제안 (CCC-39) — 제목·이유·근거 회차(sessionId·heldAt). 최대 3개는
        // 게이트웨이가 이미 끊었다. 화면은 sessionId 로 해당 회차 기록에 링크를 건다.
        aiSuggestions: briefing.aiSuggestions
          .filter((suggestion) => suggestion.sourceSupportCase.id === sourceSupportCase.id)
          .map((suggestion) => ({
            title: suggestion.title,
            reason: suggestion.reason,
            sessionId: suggestion.sessionId,
            heldAt: suggestion.heldAt,
          })),
        // D45 영역 ② 회차별 정리 — 상담일·유형·핵심 한 줄(승인분)·수기 발췌 (최신순, 게이트웨이 정렬 보존).
        sessionRows: briefing.sessionRows
          .filter((row) => row.sourceSupportCase.id === sourceSupportCase.id)
          .map((row) => ({
            sessionId: row.sessionId,
            heldAt: row.heldAt,
            kind: row.kind,
            aiOneLiner: row.aiOneLiner,
            memoExcerpt: row.memoExcerpt,
          })),
        // D45 영역 ③ 내용 불일치 — 저장된 검출 결과(CCC-43). 판단 없음(R5). 처리 3종(CCC-42)은
        // resolution 으로 함께 나가고, 화면이 미처리/접힌 이력으로 가른다.
        discrepancies: briefing.discrepancies
          .filter((item) => item.sourceSupportCase.id === sourceSupportCase.id)
          .map((item) => ({
            id: item.id,
            kind: item.kind,
            left: item.left,
            right: item.right,
            detectedAt: item.detectedAt,
            resolution: item.resolution,
          })),
      };
    }),
    // 포커스 참여사업의 다가오는 상담 일정의 세션 목표·맞춤형 질문 (D28, 티켓 #34 소비).
    focusUpcomingSchedule: briefing.focusUpcomingSchedule === null
      ? null
      : {
        id: briefing.focusUpcomingSchedule.id,
        scheduledAt: briefing.focusUpcomingSchedule.scheduledAt,
        sessionKind: briefing.focusUpcomingSchedule.sessionKind,
        channel: briefing.focusUpcomingSchedule.channel,
        sessionGoals: briefing.focusUpcomingSchedule.sessionGoals.map((goal) => ({
          body: goal.body,
          caseGoalId: goal.caseGoalId,
          caseGoalTitle: goal.caseGoalTitle,
          // D62 §5 (CCC-69): 부모가 닫힌 세션 목표는 화면이 부모 이름을 흐리게 병기한다.
          caseGoalStatus: goal.caseGoalStatus,
        })),
        customQuestions: briefing.focusUpcomingSchedule.customQuestions.map((question) => question.body),
      },
  };
}

/** 당사자 허브 목표 트리 (D62 §8 · CCC-69). 담당 케이스만 — 범위·감사는 게이트웨이가 강제한다(R1). */
function participantGoalTreeResponse(tree: Awaited<ReturnType<typeof getParticipantGoalTree>>) {
  return tree.map((entry) => ({
    sourceSupportCase: entry.sourceSupportCase,
    overallGoal: entry.overallGoal,
    overallGoalRevisions: entry.overallGoalRevisions,
    goals: entry.goals.map((goal) => ({
      id: goal.id,
      title: goal.title,
      status: goal.status,
      closedReason: goal.closedReason,
      closedAt: goal.closedAt,
      revisions: goal.revisions,
      sessionGoals: goal.sessionGoals,
    })),
  }));
}

function counselingRecordResponse(record: Awaited<ReturnType<typeof createCounselingRecord>>['record']) {
  return {
    id: record.id,
    heldAt: record.heldAt,
    channel: record.channel,
    memo: record.memo,
  };
}

function intakeRecordResponse(record: Awaited<ReturnType<typeof createIntakeRecord>>['record']) {
  return {
    id: record.id,
    heldAt: record.heldAt,
    channel: record.channel,
    kind: record.kind,
  };
}

function intakeContextResponse(context: Awaited<ReturnType<typeof getIntakeRecordContext>>) {
  return {
    beneficiaryId: context.beneficiaryId,
    supportCaseId: context.supportCaseId,
    participant: context.participant,
    sessionSequence: context.sessionSequence,
    hasIntake: context.hasIntake,
    extendedPii: context.extendedPii,
    consent: context.consent,
    // 저장된 인테이크 내용(확인/수정 화면 재료, 2026-08-08 Q). 없으면 null.
    saved: context.saved,
    // 전체 목표 현재값(D62 · CCC-68) — 인테이크 화면의 전체 목표 칸 프리필 재료.
    overallGoal: context.overallGoal,
    // 다음 예정 일정(CCC-57). 위저드가 완료 처리에 쓸 id·version 이고, 예정 건이 없으면 null.
    schedule: nextCounselingScheduleResponse(context.schedule),
  };
}

function counselingRecordDetailsResponse(
  record: CounselingRecordDetails,
  goalTitles: ReadonlyMap<string, string>,
) {
  return {
    id: record.id,
    supportCaseId: record.supportCaseId,
    heldAt: record.heldAt,
    channel: record.channel,
    memo: record.memo,
    kind: record.kind,
    createdAt: record.createdAt,
    gasScores: record.gasScores.map((score) => ({
      goalId: score.goalId,
      goalTitle: goalTitles.get(score.goalId)!,
      score: score.score,
    })),
    actionItems: record.actionItems.map((item) => ({
      id: item.id,
      description: item.description,
      owner: item.owner,
      dueDate: item.dueDate,
      resolved: item.resolvedAt !== null,
    })),
    flags: record.confirmedFlags.map((flag) => ({
      id: flag.id,
      flagType: flag.flagType,
      source: flag.source,
      reviewStatus: flag.reviewStatus,
    })),
    lifeAreaSnapshot: record.lifeAreaSnapshot.map((area) => ({
      areaKey: area.areaKey,
      status: area.status,
      note: area.note,
    })),
    // D47 접힌 줄·회차 카드용 3종. 저장된 값을 싣기만 한다 — 새 스키마 없음(ADR-0019 영향).
    aiOneLiner: record.aiOneLiner,
    memoExcerpt: record.memoExcerpt,
    sessionGoals: record.sessionGoals,
  };
}

function nextCounselingScheduleResponse(
  schedule: Awaited<ReturnType<typeof getNextCounselingScheduleForSupportCase>>,
) {
  if (schedule === null) return null;
  return {
    id: schedule.id,
    beneficiaryId: schedule.beneficiaryId,
    supportCaseId: schedule.supportCaseId,
    scheduledAt: schedule.scheduledAt,
    status: schedule.status,
    version: schedule.version,
    completedSessionId: schedule.completedSessionId,
  };
}

function requiredDraftVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new DraftVersionRequiredError();
  }
  return value;
}

function routeDraftVersion(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) {
    throw new ValidationError('draft version is invalid');
  }
  const version = Number(value);
  if (!Number.isSafeInteger(version)) {
    throw new ValidationError('draft version is invalid');
  }
  return version;
}

function parsePilotTextAiConsent(body: JsonObject) {
  requireOnlyKeys(body, ['noticeVersion', 'noticeHash', 'evidenceRef', 'evidenceHash', 'effectiveAt']);
  return {
    noticeVersion: requiredString(body, 'noticeVersion'),
    noticeSha256: requiredString(body, 'noticeHash'),
    evidenceRef: requiredString(body, 'evidenceRef'),
    evidenceSha256: requiredString(body, 'evidenceHash'),
    effectiveAt: requiredString(body, 'effectiveAt'),
  };
}
function requiredInteger(body: JsonObject, key: string): number {
  const value = body[key];
  if (!Number.isInteger(value)) throw new ValidationError(key + ' must be an integer');
  return value as number;
}

function parseMaskedSourceSnapshot(body: JsonObject) {
  requireOnlyKeys(body, ['maskedText', 'sha256', 'maskingPipelineVersion', 'evidence']);
  const evidence = objectArray(body.evidence, 'evidence').map((item) => {
    requireOnlyKeys(
      item,
      ['id', 'sourceRef', 'sourceSha256', 'evidenceQuote', 'sourceStart', 'sourceEnd'],
    );
    return {
      id: requiredString(item, 'id'),
      sourceRef: requiredString(item, 'sourceRef'),
      sourceSha256: requiredString(item, 'sourceSha256'),
      evidenceQuote: requiredString(item, 'evidenceQuote'),
      sourceStart: requiredInteger(item, 'sourceStart'),
      sourceEnd: requiredInteger(item, 'sourceEnd'),
    };
  });
  if (evidence.length === 0) throw new ValidationError('evidence is required');
  return {
    maskedText: requiredString(body, 'maskedText'),
    sha256: requiredString(body, 'sha256'),
    maskingPipelineVersion: requiredString(body, 'maskingPipelineVersion'),
    evidence,
  };
}

function parseRecordingResult(body: JsonObject) {
  requireOnlyKeys(body, ['maskedText', 'sha256', 'maskingPipelineVersion', 'evidence', 'emotionScores']);
  const snapshot = parseMaskedSourceSnapshot({
    maskedText: body.maskedText,
    sha256: body.sha256,
    maskingPipelineVersion: body.maskingPipelineVersion,
    evidence: body.evidence,
  });
  const emotionScores = asObject(body.emotionScores);
  return { ...snapshot, emotionScores };
}

function parseAiDraftGeneration(body: JsonObject): { sourceSnapshotId: string } {
  requireOnlyKeys(body, ['sourceSnapshotId']);
  return { sourceSnapshotId: requiredString(body, 'sourceSnapshotId') };
}

function parseAiDraftEdit(body: JsonObject) {
  requireOnlyKeys(body, ['expectedVersion', 'evidenceIds']);
  return {
    expectedVersion: requiredDraftVersion(body.expectedVersion),
    evidenceIds: validateAiEvidenceIds(body.evidenceIds),
  };
}

function parseAiDraftReview(body: JsonObject): AiDraftReviewInput {
  // CCC-114: 승인은 대조 3종 항목별 처리(항목이 없어도 빈 배열)와 화자 확인을 실을 수 있다.
  // 형태만 여기서 거르고, 완전성(모든 항목을 덮는가)은 게이트웨이가 판정한다(R1).
  requireOnlyKeys(body, ['expectedVersion', 'decision', 'contrastResolutions', 'speakerMappingConfirmed']);
  const decisionValue = requiredString(body, 'decision');
  if (decisionValue !== 'approved' && decisionValue !== 'rejected') {
    throw new ValidationError('decision is invalid');
  }
  const decision: 'approved' | 'rejected' = decisionValue === 'approved' ? 'approved' : 'rejected';
  const review: AiDraftReviewInput = {
    expectedVersion: requiredDraftVersion(body.expectedVersion),
    decision,
  };
  if (body.contrastResolutions !== undefined) {
    review.contrastResolutions = objectArray(body.contrastResolutions, 'contrastResolutions').map((item) => {
      requireOnlyKeys(item, ['axis', 'findingIndex', 'status']);
      return {
        axis: requiredString(item, 'axis'),
        findingIndex: requiredInteger(item, 'findingIndex'),
        status: requiredString(item, 'status'),
      } as AiContrastResolutionInput;
    });
  }
  if (body.speakerMappingConfirmed !== undefined) {
    review.speakerMappingConfirmed = requiredBoolean(body, 'speakerMappingConfirmed');
  }
  return review;
}

function aiDraftResponse(draft: AiDraftVersion) {
  return {
    version: draft.version,
    origin: draft.origin,
    creationMode: draft.creationMode,
    summaryText: draft.summaryText,
    // 승인 화면의 핵심 한 줄 항목(CCC-38) — 요약·질문과 함께 검토·승인된다(R2).
    oneLiner: draft.oneLiner,
    reviewDecision: draft.reviewDecision,
    questions: draft.questions,
    evidence: draft.evidence.map((evidence) => ({
      id: evidence.id,
      claimKey: evidence.claimKey,
      quote: evidence.evidenceQuote,
    })),
    // 대조 3종(D69 · ADR-0036). 승인 화면이 처리하는 항목이라 초안과 함께 나간다(R2).
    // 축 상태는 서버 판정이고, 적용되지 않은 축은 항목 없이 사유만 실린다.
    contrast: draft.contrast.map((axis) => ({
      axis: axis.axis,
      status: axis.status,
      findings: axis.findings.map((finding) => ({
        description: finding.description,
        materialKind: finding.materialKind,
        quote: finding.quote,
      })),
    })),
  };
}

/**
 * 검토 화면(초안 조회 · 근거 재선택 · 승인/반려) 1차 역할 필터 (CCC-105 · D7 · D40).
 * 담당 실무자 또는 기관 관리자만 통과시킨다 - 실제 담당 여부와 기관 경계는 게이트웨이
 * 함수(assertCaseAccess 등)가 검사한다(R1). 이 함수는 역할만 거른다.
 */
function requireAiDraftReviewActor(actor: Actor): void {
  if (actor.role !== 'counselor' && actor.role !== 'admin') {
    throw new ForbiddenError('counselor or admin role is required for AI draft review');
  }
}

/**
 * 내용 불일치 검출 (D45 · ADR-0018 · CCC-43) — 기록 공식화 직후(수기 저장 · AI 정리 승인)
 * 호출된다. **최선 노력**이다: 동의 부재(D15)·프로바이더 미구성/실패·검증 거부 등 어떤
 * 실패도 기록 저장 응답을 막지 않고 조용히 스킵된다(D8 — 다음 공식화 때 재검출). 전송
 * 재료는 게이트웨이가 가명 처리한 공식 텍스트뿐이고(R3), 출력은 판단 없는 인용 쌍만
 * 통과한다(R5). 브리핑은 저장된 결과만 읽으므로 이 함수는 열람 경로에서 절대 불리지 않는다.
 */
/** 사업자에 **닿기도 전에** 끝난 사유들 — 손 쓸 자리가 시크릿·설정이다(CCC-47). */
const CONFIGURATION_REASONS: ReadonlySet<AiProviderUnavailableReason> = new Set([
  'config_missing',
  'config_invalid',
  'external_calls_disabled',
  'api_key_missing',
  'adapter_invalid',
]);

async function runDiscrepancyDetection(env: ApiEnv, actor: Actor, sessionId: string): Promise<void> {
  // CCC-47 — 어떻게 끝났든 사실 한 줄을 남긴다. 이 값들은 전부 분류·숫자·설정값이고
  // 상담 내용은 하나도 들어가지 않는다(R3). 관측이 없으면 아래 스킵 경로들이 "정상적으로
  // 불일치가 없었다"와 구분되지 않는다 — 그게 이 티켓의 출발점이다.
  const startedAt = Date.now();
  let outcome: AiCallOutcome = 'failed_other';
  let caseId: string | null = null;
  let reason: AiCallFailureReason | null = null;
  let status: number | null = null;
  let sourceCount: number | null = null;
  let storedCount: number | null = null;
  let model: string | null = null;

  try {
    const material = await collectDiscrepancyDetectionSources(env, actor, sessionId);
    caseId = material.caseId;
    sourceCount = material.sources.length;
    if (!material.sources.some((source) => source.sessionId === material.triggerSessionId)) {
      // 가장 흔한 상태다 — 장비가 아직 2차 마스킹 스냅샷을 올리지 않았다(대기 중, D8).
      outcome = 'skipped_no_snapshot';
      return;
    }
    // 텍스트 AI 동의 게이트 (D15 · D44) — 파일럿 중지·동의 부재면 여기서 던져 스킵된다.
    // 서비스 역할(장비 스냅샷 직후 경로)은 수집 단계에서 이미 같은 게이트를 통과했다.
    if (actor.role !== 'service') await assertPilotTextAiConsent(env, actor, material.caseId);
    const providerRequest = validateDiscrepancyDetectionRequest({
      triggerRef: material.triggerSessionId,
      sources: material.sources.map((source) => ({ sourceRef: source.sessionId, text: source.text })),
    });
    let rawOutput: unknown;
    if (previewModeEnabled(env)) {
      if (env.AI_PROVIDER_ADAPTER === undefined) {
        rawOutput = detectPreviewFixtureDiscrepancies(providerRequest);
      } else {
        const { adapter, config } = resolveAiProviderAdapter(env);
        model = config.model;
        if (adapter.detectDiscrepancies === undefined) {
          outcome = 'skipped_unsupported';
          return;
        }
        rawOutput = await adapter.detectDiscrepancies(providerRequest);
      }
    } else {
      const { adapter, config } = resolveAiProviderAdapter(env);
      model = config.model;
      if (adapter.detectDiscrepancies === undefined) {
        outcome = 'skipped_unsupported';
        return;
      }
      rawOutput = await adapter.detectDiscrepancies(providerRequest);
    }
    const output = validateDiscrepancyDetectionOutput(rawOutput, providerRequest);
    await replaceSessionDiscrepancies(env, actor, sessionId, output.discrepancies.map((item) => ({
      kind: item.kind,
      leftSessionId: item.leftRef,
      leftQuote: item.leftQuote,
      rightSessionId: item.rightRef,
      rightQuote: item.rightQuote,
    })));
    storedCount = output.discrepancies.length;
    outcome = storedCount === 0 ? 'empty' : 'stored';
  } catch (error) {
    // 내용 무로깅(R3) — 실패는 스킵이 계약이다(D8). 기록 저장은 이미 성공했다.
    // 분류만 갈라 둔다: 어느 실패인지 모르면 고칠 자리도 알 수 없다(CCC-47).
    if (error instanceof PilotTextAiConsentRequiredError) {
      outcome = 'skipped_consent';
    } else if (error instanceof TextAiPilotDisabledError) {
      outcome = 'skipped_pilot_disabled';
    } else if (error instanceof AiProviderUnavailableError) {
      // 설정이 없어 못 부른 것과 불렀는데 실패한 것을 가른다 — 손 쓸 자리가 서로 다르다.
      // (앞은 시크릿·설정, 뒤는 사업자·망. 티켓이 쓴 두 낱말이기도 하다.)
      outcome = CONFIGURATION_REASONS.has(error.reason) ? 'provider_unavailable' : 'provider_error';
      reason = error.reason;
      status = error.status ?? null;
    } else if (error instanceof AiProviderProhibitedOutputError) {
      outcome = 'output_rejected';
    } else if (error instanceof AiProviderInputError) {
      outcome = 'request_invalid';
    }
  } finally {
    // 게이트웨이 안에서도 삼키지만, finally 에서 새어 나가는 예외는 성공한 기록 저장의
    // 201 을 500 으로 바꾼다 — 관측 때문에 그럴 수는 없다(D8).
    try {
      await recordAiCallOutcome(env, actor, {
        kind: 'discrepancy_detection',
        outcome,
        sessionId,
        caseId,
        reason,
        status,
        sourceCount,
        storedCount,
        durationMs: Date.now() - startedAt,
        model,
        promptVersion: DISCREPANCY_PROMPT_VERSION,
      });
    } catch {
      // 관측 실패는 관측 실패로 끝난다.
    }
  }
}

/**
 * 기록 공식화 훅 (D5 · R2). ① 텍스트 일감을 큐에 넣어 처리 장비가 2차 마스킹
 * 스냅샷을 만들게 하고(ADR-0027), ② 불일치 검출을 시도한다. 스냅샷이 아직 없는
 * 회차는 ②가 조용히 스킵되고, 장비가 스냅샷을 올리는 순간 그 경로에서 다시 돈다.
 * 둘 다 최선 노력이다 — 어느 쪽 실패도 기록 저장 응답을 막지 않는다(D8).
 */
async function onRecordOfficialized(
  env: ApiEnv,
  actor: Actor,
  sessionId: string,
  reason: 'manual_record' | 'ai_draft_approved',
): Promise<void> {
  try {
    await enqueueTextWorkItem(env, actor, sessionId, reason);
  } catch {
    // 큐 적재 실패는 스킵이다(D8) — 다음 공식화 때 다시 쌓인다. 내용 무로깅(R3).
  }
  await runDiscrepancyDetection(env, actor, sessionId);
}

/**
 * 목표 확정·수정 훅 (D69 · ADR-0036 결정 4 · CCC-103). 바뀐 목표 문구가 담긴 스냅샷을
 * 장비가 새로 만들도록 그 케이스의 회차들을 텍스트 일감 큐에 다시 올린다. 기록 공식화
 * 훅과 같은 최선 노력이다. 실패해도 목표 저장 응답을 막지 않는다(D8).
 * 전체 목표를 지우는 것(null)도 재료가 바뀐 것이라 함께 올린다. 문구가 그대로인 저장도
 * 올리지만 대기 행이 이미 있으면 부분 유니크 인덱스가 흡수하므로 큐가 부풀지 않는다.
 * 회기 목표(updateScheduleSessionGoals)는 훅을 걸지 않는다. 근거는 getTextWorkItemSource
 * 주석에 있다.
 */
async function onGoalRevised(env: ApiEnv, actor: Actor, caseRef: string): Promise<void> {
  try {
    await enqueueTextWorkForGoalChange(env, actor, caseRef);
  } catch {
    // 큐 적재 실패는 스킵이다(D8). 다음 목표 수정·기록 공식화 때 다시 쌓인다. 내용 무로깅(R3).
  }
}

function providerEvidenceLinks(output: ReturnType<typeof validateAiProviderOutput>) {
  const links: Array<{
    sourceEvidenceItemId: string;
    claimKey: string;
    evidenceQuote: string;
    sourceRef: string;
    sourceStart: number;
    sourceEnd: number;
  }> = [];
  if (output.claims.some((claim) => /^question_[0-9].*$/.test(claim.claimKey))) {
    throw new AiProviderProhibitedOutputError();
  }

  for (const claim of output.claims) {
    for (const reference of claim.evidence) {
      links.push({
        sourceEvidenceItemId: reference.evidenceId,
        claimKey: claim.claimKey,
        evidenceQuote: reference.evidenceQuote,
        sourceRef: reference.sourceRef,
        sourceStart: reference.sourceStart,
        sourceEnd: reference.sourceEnd,
      });
    }
  }
  const claimKeys = new Set(output.claims.map((claim) => claim.claimKey));
  for (const [index, question] of output.questions.entries()) {
    const claimKey = `question_${index + 1}`;
    if (claimKeys.has(claimKey)) {
      throw new AiProviderProhibitedOutputError();
    }
    for (const reference of question.evidence) {
      links.push({
        sourceEvidenceItemId: reference.evidenceId,
        claimKey,
        evidenceQuote: reference.evidenceQuote,
        sourceRef: reference.sourceRef,
        sourceStart: reference.sourceStart,
        sourceEnd: reference.sourceEnd,
      });
    }
  }
  return links;
}

/**
 * 축 적용 여부 판정 (D69 · ADR-0036 결정 2·3 · CCC-102). **서버가 정한다**. AI 는
 * 이 값을 받기만 한다. 이름은 "무엇이 없는가" 로 붙인다(어느 검사가 먼저 걸렸는지가 아니라).
 *
 * - 메모에 없는 내용 / 음성에 없는 내용: 양쪽 재료를 견줘야 성립한다. 하나가 없으면
 *   없는 쪽을 사유로 남긴다.
 * - 미논의 목표: 텍스트 재료의 [회기 목표] 구획만이 기준이다(전체·세부 목표는 문맥 재료).
 *   구획이 없으면 회기 목표가 없는 회차이므로 no_session_goal 이다.
 */
export function contrastAxisStates(materials: readonly AiProviderMaterial[]): AiContrastAxisStates {
  const transcript = materials.find((material) => material.kind === 'transcript');
  const text = materials.find((material) => material.kind === 'text_context');
  const crossAxisStatus: AiContrastAxisStatus = transcript === undefined
    ? 'no_transcript'
    : text === undefined ? 'no_text' : 'applied';
  return {
    missing_from_memo: crossAxisStatus,
    missing_from_transcript: crossAxisStatus,
    undiscussed_session_goal: text === undefined
      ? 'no_text'
      : text.maskedText.includes(SESSION_GOAL_MATERIAL_LABEL) ? 'applied' : 'no_session_goal',
  };
}

function providerMaterials(materials: readonly AiCallMaterial[]): AiProviderMaterial[] {
  return materials.map((material) => ({
    kind: material.kind,
    sourceRef: material.snapshot.id,
    maskedText: material.snapshot.maskedText,
    evidence: material.snapshot.evidence.map((evidence) => ({
      evidenceId: evidence.id,
      sourceRef: evidence.sourceRef,
      sourceSha256: evidence.sourceSha256,
      evidenceQuote: evidence.evidenceQuote,
      sourceStart: evidence.sourceStart,
      sourceEnd: evidence.sourceEnd,
    })),
  }));
}

/** 초안에 남길 재료 증빙(id + 해시 + 종류). 주 재료도 한 항목으로 들어간다. */
function draftMaterialRefs(materials: readonly AiCallMaterial[]): AiDraftSourceMaterialRef[] {
  return materials.map((material) => ({
    kind: material.kind,
    snapshotId: material.snapshot.id,
    snapshotSha256: material.snapshot.sha256,
  }));
}

/** 어댑터 출력의 대조를 축 상태와 짝지어 저장 형태로 옮긴다. */
function draftContrastAxes(
  output: AiProviderOutput,
  axes: AiContrastAxisStates,
): AiDraftContrastAxis[] {
  return AI_CONTRAST_AXES.map((axis) => ({
    axis,
    status: axes[axis],
    findings: output.contrast[axis].map((finding) => ({ ...finding })),
  }));
}

async function generateAiDraft(
  env: ApiEnv,
  actor: Actor,
  sessionId: string,
  body: JsonObject,
): Promise<AiDraftVersion> {
  const startedAt = Date.now();
  let outcome: AiCallOutcome = 'failed_other';
  let reason: AiCallFailureReason | null = null;
  let status: number | null = null;
  let model: string | null = null;
  const { sourceSnapshotId } = parseAiDraftGeneration(body);
  try {
    // 요청은 스냅샷 하나만 지목하고, 반대편 재료는 게이트웨이가 붙인다(ADR-0036 결정 2).
    const materialSet = await loadAiCallMaterialsForService(env, actor, sessionId, sourceSnapshotId);
    const sourceSnapshot = materialSet.requested.snapshot;
    const materials = providerMaterials(materialSet.materials);
    const providerRequest = validateAiProviderRequest({
      materials,
      contrastAxes: contrastAxisStates(materials),
    });
    const materialRefs = draftMaterialRefs(materialSet.materials);

    if (previewModeEnabled(env)) {
      const rawOutput = env.AI_PROVIDER_ADAPTER === undefined
        ? generatePreviewFixtureAiDraft(providerRequest)
        : await resolveAiProviderAdapter(env).adapter.generate(providerRequest);
      const output = validateAiProviderOutput(rawOutput, providerRequest);
      const draft = await createFixtureGeneratedAiDraftForService(env, actor, sessionId, {
        origin: 'fixture_generated',
        creationMode: 'fixture_generated',
        summaryText: validateAiDraftSummary(output.claims.map((claim) => claim.text).join('\n')),
        oneLiner: output.oneLiner,
        sourceSnapshotId: sourceSnapshot.id,
        sourceSnapshotHash: sourceSnapshot.sha256,
        promptVersion: AI_DRAFT_PROMPT_VERSION,
        schemaVersion: AI_DRAFT_SCHEMA_VERSION,
        questions: output.questions.map((question) => ({ title: question.title, reason: question.reason })),
        evidence: providerEvidenceLinks(output),
        materials: materialRefs,
        contrast: draftContrastAxes(output, providerRequest.contrastAxes),
      });
      outcome = 'stored';
      return draft;
    }

    // 주입형 testOnly adapter는 기존 테스트 seam이다. Preview 전용 내장 fixture 선택과
    // 구분하며, 실제 provider와 같은 활성 설정·동의·스냅샷 검증을 그대로 거친다.
    const { adapter, config } = resolveAiProviderAdapter(env);
    model = config.model;
    const runtimeConfigHash = await canonicalAiProviderConfigHash(config);

    // Provider and current consent are selected together as the final pre-outbound D1 read.
    const activeProvider = await getActiveAiProviderRuntimeMetadataForService(env, actor, sessionId);
    if (
      activeProvider.adapterId !== adapter.providerId
      || activeProvider.adapterVersion !== adapter.adapterVersion
      || activeProvider.configHash !== runtimeConfigHash
    ) {
      throw new AiProviderUnavailableError();
    }

    const output = validateAiProviderOutput(await adapter.generate(providerRequest), providerRequest);
    const draft = await createGeneratedAiDraftForService(env, actor, sessionId, {
      summaryText: validateAiDraftSummary(output.claims.map((claim) => claim.text).join('\n')),
      oneLiner: output.oneLiner,
      sourceSnapshotId: sourceSnapshot.id,
      sourceSnapshotHash: sourceSnapshot.sha256,
      providerConfigId: activeProvider.providerConfigId,
      consentEvidenceId: activeProvider.consentEvidenceId,
      modelId: config.model,
      promptVersion: AI_DRAFT_PROMPT_VERSION,
      schemaVersion: AI_DRAFT_SCHEMA_VERSION,
      questions: output.questions.map((question) => ({ title: question.title, reason: question.reason })),
      evidence: providerEvidenceLinks(output),
      materials: materialRefs,
      contrast: draftContrastAxes(output, providerRequest.contrastAxes),
    });
    outcome = 'stored';
    return draft;
  } catch (error) {
    if (error instanceof AiProviderUnavailableError) {
      outcome = CONFIGURATION_REASONS.has(error.reason) ? 'provider_unavailable' : 'provider_error';
      reason = error.reason;
      status = error.status ?? null;
    } else if (error instanceof AiProviderProhibitedOutputError) {
      outcome = 'output_rejected';
    } else if (error instanceof AiProviderInputError) {
      outcome = 'request_invalid';
    }
    throw error;
  } finally {
    await recordAiCallOutcome(env, actor, {
      kind: 'draft_generation',
      outcome,
      sessionId,
      reason,
      status,
      durationMs: Date.now() - startedAt,
      model,
      promptVersion: AI_DRAFT_PROMPT_VERSION,
    });
  }
}

/**
 * 상담 녹음 업로드(실무자·관리자). gateway preflight가 접근 권한·동의·세션 상태를
 * 확인한 뒤 콘텐츠를 읽어 R2에 저장한다. 등록 시점에는 registerRecording이 같은
 * 상태를 원자적으로 다시 확인한다. 등록이 실패하면 방금 올린 R2 객체를 지워
 * 고아 오디오를 남기지 않는다.
 * ⚠ arrayBuffer 버퍼링이라 실사용 200 MB 본문은 Worker 메모리 한계가 있다 —
 * 2단계-a 로컬 수용 기준에선 충분하고, 대용량 스트리밍은 후속 과제로 남긴다.
 */
async function handleAudioUpload(
  request: Request,
  env: ApiEnv,
  actor: Actor,
  sessionId: string,
): Promise<Response> {
  await assertRecordingUploadAllowed(env, actor, sessionId);
  const contentType = normalizeAudioContentType(request.headers.get('content-type'));
  if (contentType === null) {
    throw new ValidationError('audio content type is not allowed');
  }
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null && Number(declaredLength) > MAX_AUDIO_BYTES) {
    throw new ValidationError('audio exceeds the maximum size');
  }
  const body = await request.arrayBuffer();
  if (body.byteLength === 0) {
    throw new ValidationError('audio body must not be empty');
  }
  if (body.byteLength > MAX_AUDIO_BYTES) {
    throw new ValidationError('audio exceeds the maximum size');
  }

  const key = newAudioKey(sessionId);
  await putAudioObject(env, key, body, contentType);
  try {
    return json(sessionResponse(await registerRecording(env, actor, sessionId, key)));
  } catch (error) {
    // 등록 실패(권한·동의·승인세션 등) 시 방금 올린 객체를 정리한 뒤 다시 던진다.
    await deleteAudioObject(env, key);
    throw error;
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof ActorAuthenticationError) return json({ error: 'actor_authentication_required' }, 401);
  if (error instanceof ForbiddenError) return json({ error: 'forbidden' }, 403);
  if (error instanceof ConflictError) return json({ error: 'conflict' }, 409);
  if (error instanceof PilotTextAiConsentRequiredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof TextAiPilotDisabledError) return json({ error: error.code }, error.statusCode);
  if (error instanceof StaleDraftVersionError) return json({ error: error.code }, error.statusCode);
  if (error instanceof DraftVersionRequiredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof GroundedEvidenceRequiredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof FixtureDraftApprovalForbiddenError) return json({ error: error.code }, error.statusCode);
  // CCC-114: 승인 전제(대조 3종 항목별 처리 · 화자 확인) 미충족은 화면이 원인을 안내한다.
  if (error instanceof ContrastResolutionRequiredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof SpeakerConfirmationRequiredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof AiProviderNotConfiguredError) return json({ error: error.code }, error.statusCode);
  // G1: ① 미동의·긴급 사유 누락은 'invalid_request' 로 뭉치지 않는다 — 화면이 "동의를
  // 체크하거나 긴급 등록을 고르라"고 안내하려면 원인이 코드로 구분돼야 한다(게이트 문서 §2 G1).
  if (error instanceof PrivacyConsentRequiredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof EmergencyReasonRequiredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof AiProviderInputError) return json({ error: 'invalid_request' }, 400);
  if (error instanceof AiProviderProhibitedOutputError) return json({ error: 'ai_prohibited_output' }, 422);
  if (error instanceof AiProviderUnavailableError) return json({ error: 'ai_provider_unavailable' }, 503);
  if (error instanceof ValidationError) return json({ error: 'invalid_request' }, 400);
  if (error instanceof NotApprovedError) return json({ error: 'approval_required' }, 409);
  return json({ error: 'internal_error' }, 500);
}

export type ActorResolver = (request: Request, env: ApiEnv) => Promise<Actor>;

export async function handleRequest(
  request: Request,
  env: ApiEnv,
  resolveActor: ActorResolver = actorFromRequest,
): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') return json({ status: 'ok', service: 'ccc-api' });

  try {
    // ── 공개 경로: 당사자 자기 가입(토큰이 자격, Access 불필요, D39 · CCC-28) ──
    //
    // **미리보기에는 공개 표면을 두지 않는다**(2026-07-28 Q 결정, ADR-0016 개정).
    // 미리보기 워커에서는 이 두 경로도 지정 코드 세션을 먼저 요구한다 — 통과하면
    // 그대로 공개 경로로 처리하므로 팀원은 코드만 있으면 가입 흐름을 검수할 수 있다.
    // 실패는 인증 경로와 같은 401/403 으로 떨어진다(가입 경로만 다르게 답하면 그 자체가
    // 단서다). 운영·로컬에서는 previewModeEnabled 가 false 라 이 줄이 아무 일도 안 한다.
    const pubParts = url.pathname.split('/').filter((p) => p.length > 0);
    const publicSignupPath =
      (request.method === 'GET' && pubParts.length === 3 && pubParts[0] === 'invites' && pubParts[1] === 'participant')
      || (request.method === 'POST' && pubParts.length === 2 && pubParts[0] === 'signup' && pubParts[1] === 'participant');
    if (publicSignupPath && previewModeEnabled(env)) await resolveActor(request, env);
    if (request.method === 'GET' && pubParts.length === 3 && pubParts[0] === 'invites' && pubParts[1] === 'participant') {
      requestQuery(url, []);
      // 빈 토큰은 조회 자체를 하지 않는다 — 아래 실패들과 같은 404 로 맞춰 응답을 구분 불가하게 둔다.
      const pathToken = pubParts[2] ?? '';
      if (pathToken.length === 0) return json({ error: 'not_found' }, 404);
      try {
        const invite = await getInviteForSignup(env, pathToken, 'participant');
        if (invite.programType === null) return json({ error: 'not_found' }, 404);
        return json({ programType: invite.programType });
      } catch (e) {
        if (e instanceof ForbiddenError) return json({ error: 'not_found' }, 404);
        throw e;
      }
    }
    if (request.method === 'POST' && pubParts.length === 2 && pubParts[0] === 'signup' && pubParts[1] === 'participant') {
      requestQuery(url, []);
      const body = await requestBody(request);
      const token = requiredString(body, 'token');
      const name = requiredString(body, 'name');
      const phone = optionalString(body, 'phone');
      const email = optionalString(body, 'email');
      // 동의 2종(D49): ① 개인정보 ② AI를 활용한 녹취기록. 자기 가입이 곧 등록이므로 등록
      // 화면과 같은 2체크를 받는다. 둘 다 독립 boolean 이고 ② 는 강제하지 않는다 — 미동의여도
      // 가입은 진행된다(D15 미동의 경로).
      const consentRaw = body.consent;
      if (
        consentRaw === null
        || typeof consentRaw !== 'object'
        || !('privacy' in consentRaw)
        || !('recordingAi' in consentRaw)
        || typeof consentRaw.privacy !== 'boolean'
        || typeof consentRaw.recordingAi !== 'boolean'
      ) {
        throw new ValidationError('consent is required');
      }
      const consent = { privacy: consentRaw.privacy, recordingAi: consentRaw.recordingAi };
      const signupInput: Parameters<typeof completeParticipantSignup>[1] = { token, name, consent };
      if (phone != null) signupInput.phone = phone;
      if (email != null) signupInput.email = email;
      try {
        const result = await completeParticipantSignup(env, signupInput);
        return json(result, 201);
      } catch (e) {
        if (e instanceof ForbiddenError) return json({ error: 'not_found' }, 404);
        throw e;
      }
    }
    const actor = await resolveActor(request, env);
    const parts = url.pathname.split('/').filter((part) => part.length > 0);
    if (request.method === 'POST' && parts.length === 1 && parts[0] === 'schedules') {
      // 상담 등록(#20): 담당 케이스 한정·감사는 createCounselingSchedule(R1 관문) 내장.
      requestQuery(url, []);
      return json(
        scheduleResponse(await createCounselingSchedule(env, actor, parseScheduleCreation(await requestBody(request)))),
        201,
      );
    }
    if (request.method === 'GET' && parts.length === 1 && parts[0] === 'me') {
      // 로그인한 본인의 신원(이메일·역할) — 설정 화면 '내 계정'. 역할 무관, 자기 기관 자기 행만.
      requestQuery(url, []);
      const me = await getMyIdentity(env, actor);
      // lastProgramType: `/` 직행 목적지 (D35 · ADR-0014 '개정' 2번). 미선택이면 null 이고
      // 화면이 첫 사업으로 폴백한다.
      const lastProgramType = await getLastProgramType(env, actor);
      return json({
        id: me.id, orgId: me.orgId, email: me.email, role: me.role, active: me.active, name: me.name,
        lastProgramType,
      });
    }
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'organization' && parts[1] === 'profile') {
      // 기관·첫 사업 표시 이름 (CCC-32). 모든 화면의 셸(사이드바)이 읽으므로 역할 무관,
      // 값이 없으면 null — 화면이 labels.ts 하드코딩 라벨로 폴백한다. 감사 없음 근거는 게이트웨이 주석.
      requestQuery(url, []);
      return json(await getOrganizationProfile(env, actor));
    }
    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'organization' && parts[1] === 'onboarding') {
      // 관리자 온보딩 2단계 저장 (CCC-32 · 스펙 #78 US 1). admin 검사·감사는 게이트웨이 내장(R1).
      requestQuery(url, []);
      const body = await requestBody(request);
      const orgName = body.orgName;
      const programDisplayName = body.programDisplayName;
      if (typeof orgName !== 'string' || typeof programDisplayName !== 'string') {
        throw new ValidationError('organization onboarding payload is invalid');
      }
      return json(await completeOrganizationOnboarding(env, actor, { orgName, programDisplayName }));
    }
    if (request.method === 'PUT' && parts.length === 2 && parts[0] === 'me' && parts[1] === 'last-program') {
      // 마지막에 선택한 사업을 본인 계정에 기억시킨다. 본인 행만 쓰고 감사는 남기지 않는다
      // (근거: db/gateway.ts rememberLastProgramType · migrations/0017 주석).
      requestQuery(url, []);
      const programType = (await requestBody(request)).programType;
      if (typeof programType !== 'string') throw new ValidationError('program type is required');
      await rememberLastProgramType(env, actor, programType);
      return json({ ok: true });
    }
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'schedules' && parts[1] === 'today') {
      const query = requestQuery(url, ['date']);
      const date = query.get('date');
      return json(await getTodaySchedules(env, actor, date === null ? undefined : { date: canonicalDate(date, 'date') }));
    }
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'schedules' && parts[1] === 'upcoming') {
      const query = requestQuery(url, ['date']);
      const date = query.get('date');
      return json(await getUpcomingSchedules(env, actor, date === null ? undefined : { date: canonicalDate(date, 'date') }));
    }
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'schedules' && parts[1] === 'month') {
      // 전체 일정 화면(CCC-19). month 를 생략하면 게이트웨이가 기관 시간대의 이번 달을 쓴다.
      const query = requestQuery(url, ['month']);
      const month = query.get('month');
      return json(await getMonthSchedules(env, actor, month === null ? undefined : { month }));
    }
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'schedules' && parts[1] === 'candidates') {
      // 상담 등록 폼의 당사자 후보 — '담당 활성 참여사업' 기준(티켓 #19 콜드스타트 해소).
      requestQuery(url, []);
      const candidates = await listScheduleCandidates(env, actor);
      return json({ candidates });
    }
    if (parts[0] === 'schedules' && parts[1] !== undefined) {
      const scheduleId = requireRouteUuid(parts[1], 'schedule id');
      if (request.method === 'PATCH' && parts.length === 3 && parts[2] === 'reschedule') {
        return json(scheduleResponse(await rescheduleCounselingSchedule(
          env,
          actor,
          scheduleId,
          parseScheduleReschedule(await requestBody(request)),
        )));
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'cancel') {
        return json(scheduleResponse(await cancelCounselingSchedule(
          env,
          actor,
          scheduleId,
          parseScheduleTransition(await requestBody(request)),
        )));
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'no-show') {
        return json(scheduleResponse(await markCounselingScheduleNoShow(
          env,
          actor,
          scheduleId,
          parseScheduleTransition(await requestBody(request)),
        )));
      }
      // 일정별 세션 목표·맞춤형 질문 조회 (#35). 담당·감사는 게이트웨이 내장(R1).
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'plan') {
        requestQuery(url, []);
        return json(scheduleSessionPlanResponse(await getScheduleSessionPlan(env, actor, scheduleId)));
      }
      // 세션 목표 수정 (D62 §6 · CCC-70): 시작 시각 전까지만, 활성 세부 목표만 연결.
      // 잠금·연결 규칙·낙관 잠금 전부 게이트웨이가 강제한다(R1).
      if (request.method === 'PUT' && parts.length === 3 && parts[2] === 'plan') {
        requestQuery(url, []);
        return json(await updateScheduleSessionGoals(
          env,
          actor,
          scheduleId,
          parseScheduleSessionGoalsUpdate(await requestBody(request)),
        ));
      }
    }
    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'invites' && parts[1] === 'participant') {
      // 당사자 가입 링크 발급(D39 · ADR-0016 · CCC-29). 사람(실무자·관리자)만 —
      // 권한·감사는 createParticipantInvite(R1 관문) 내장. 소비·가입은 CCC-28.
      requestQuery(url, []);
      const programType = (await requestBody(request)).programType;
      if (typeof programType !== 'string') throw new ValidationError('program type is required');
      return json(await createParticipantInvite(env, actor, { programType }), 201);
    }
    if (
      request.method === 'POST'
      && parts.length === 1
      && (parts[0] === 'participants' || parts[0] === 'beneficiaries')
    ) {
      requestQuery(url, []);
      const initialCreation = parseInitialParticipantCreation(await requestBody(request), actor);
      return json(await createBeneficiaryWithInitialSupportCase(
        env,
        actor,
        initialCreation.input,
        undefined,
        initialCreation.consent,
      ), 201);
    }
    if (
      request.method === 'GET'
      && parts.length === 2
      && (parts[0] === 'participants' || parts[0] === 'beneficiaries')
      && parts[1] === 'search'
    ) {
      // 검색 라우트는 일반 당사자 상세 라우트보다 먼저 처리한다 — 'search'는 가명 ID가 아니다.
      const searchQuery = requestQuery(url, ['q']).get('q');
      if (searchQuery === null) throw new ValidationError('search query is required');
      const results = await searchParticipants(env, actor, { query: searchQuery });
      return json({ results: results.map(participantSearchResultResponse) });
    }
    if (
      request.method === 'GET'
      && parts.length === 1
      && (parts[0] === 'participants' || parts[0] === 'beneficiaries')
    ) {
      // 당사자 목록(사이드바 '당사자'의 도착지). 케이스 상태로 거르지 않는다 — 종결
      // 케이스만 남은 당사자가 허브 입구에서 사라지지 않게 한다(게이트웨이 주석 참조).
      requestQuery(url, []);
      const participants = await listAssignedParticipants(env, actor);
      return json({ results: participants.map(assignedParticipantResponse) });
    }
    // ① 동의 보완 대상 리포트 (G1 완료 기준). 긴급 등록 건(기한 임박·경과 순) + 하드 게이트
    // 이전·레거시 경로로 ① 이 비어 있는 케이스를 함께 낸다. 범위(담당·기관)·감사는 게이트웨이가 강제한다(R1).
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'consent' && parts[1] === 'follow-ups') {
      requestQuery(url, []);
      return json({ results: await listPrivacyConsentFollowUps(env, actor) });
    }
    if (parts[0] === 'participants' && parts[1] !== undefined) {
      const beneficiaryId = requireBeneficiaryId(parts[1]);
      if (
        request.method === 'GET'
        && parts.length === 3
        && (parts[2] === 'support-cases' || parts[2] === 'programs')
      ) {
        requestQuery(url, []);
        const programList = await listSupportCasesForBeneficiary(env, actor, beneficiaryId);
        return json(programList.programs.map((program) => participantProgramResponse(program, programList.participant)));
      }
      if (
        request.method === 'POST'
        && parts.length === 3
        && (parts[2] === 'support-cases' || parts[2] === 'programs')
      ) {
        requestQuery(url, []);
        const result = await createSupportCase(
          env,
          actor,
          beneficiaryId,
          parseSubsequentParticipantCreation(await requestBody(request), actor),
        );
        return json(result, result.replayed ? 200 : 201);
      }
      // 당사자 허브 목표 트리 (D62 §8 · CCC-69). 담당(또는 admin) 케이스만 실린다 —
      // 목표는 상담 내용이라 D36 공개 범위 밖이고, 범위·감사는 게이트웨이가 강제한다(R1).
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'goal-tree') {
        requestQuery(url, []);
        return json({ cases: participantGoalTreeResponse(await getParticipantGoalTree(env, actor, beneficiaryId)) });
      }
      // 기본정보 수정 화면(CCC-37). 읽기·쓰기 모두 담당 실무자 또는 기관 관리자만 —
      // 게이트웨이가 강제한다(R1). 응답에는 복호화된 금고 값이 실리므로 감사는 게이트웨이가
      // 화면 조회당 1행으로 남긴다(D14·D24).
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'basic-info') {
        requestQuery(url, []);
        return json(await getParticipantBasicInfo(env, actor, beneficiaryId));
      }
      if (request.method === 'PUT' && parts.length === 3 && parts[2] === 'basic-info') {
        requestQuery(url, []);
        const body = await requestBody(request);
        requireOnlyKeys(body, ['supportCaseContextId', 'expectedVersion', ...PARTICIPANT_BASIC_INFO_FIELDS]);
        // 값이 온 항목만 패치로 만든다. null 은 "지운다"이고, 키 부재는 "건드리지 않는다"다.
        const patch: Record<string, string | null> = {};
        for (const field of PARTICIPANT_BASIC_INFO_FIELDS) {
          if (Object.hasOwn(body, field)) patch[field] = optionalNullableString(body, field) ?? null;
        }
        return json(await updateParticipantPii(env, actor, beneficiaryId, {
          supportCaseContextId: requiredUuid(body, 'supportCaseContextId'),
          expectedVersion: requiredInteger(body, 'expectedVersion'),
          ...patch,
        }));
      }
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'briefing') {
        const query = requestQuery(url, ['focusSupportCaseId']);
        const focusSupportCaseId = query.get('focusSupportCaseId');
        if (focusSupportCaseId === null) throw new ValidationError('focus support case id is required');
        const supportCaseId = requireRouteUuid(focusSupportCaseId, 'support case id');
        return json(normalizeParticipantBriefing(await getParticipantBriefing(env, actor, beneficiaryId, supportCaseId)));
      }
      if (
        request.method === 'GET'
        && parts.length === 5
        && parts[2] === 'programs'
        && parts[4] === 'briefing'
      ) {
        requestQuery(url, []);
        const supportCaseId = requireRouteUuid(parts[3] ?? '', 'support case id');
        return json(normalizeParticipantBriefing(await getParticipantBriefing(env, actor, beneficiaryId, supportCaseId)));
      }
    }
    if (parts[0] === 'support-cases' && parts[1] !== undefined) {
      const supportCaseId = requireRouteUuid(parts[1], 'support case id');
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'assignees') {
        // 케이스 담당 실무자 목록 — 담당 실무자 또는 admin(gateway 의 assertSupportCaseAccess 강제). 관리자 배정 화면용.
        requestQuery(url, []);
        const assignees = await listSupportCaseAssignees(env, actor, supportCaseId);
        return json({ assignees: assignees.map(supportCaseAssigneeResponse) });
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'assignees') {
        // 공동 담당 추가(D7) — admin 전용(gateway 의 assertAdmin 강제). 기본 역할은 secondary.
        requestQuery(url, []);
        const body = await requestBody(request);
        const userId = requiredString(body, 'userId');
        const roleValue = optionalString(body, 'role');
        if (roleValue !== undefined && roleValue !== 'primary' && roleValue !== 'secondary') {
          throw new ValidationError('assignee role is invalid');
        }
        const assignee = roleValue === undefined
          ? await assignSupportCase(env, actor, supportCaseId, userId)
          : await assignSupportCase(env, actor, supportCaseId, userId, roleValue);
        return json(supportCaseAssigneeResponse(assignee), 201);
      }
      // 동의 2종 수정·철회 (D44 · 항목 수는 D49). 담당 실무자 또는 기관 관리자만 —
      // 게이트웨이의 assertSupportCaseAccess 가 강제한다(R1). 두 값은 항상 함께 온다(현재 상태 전체).
      if (request.method === 'PUT' && parts.length === 3 && parts[2] === 'consent') {
        requestQuery(url, []);
        const body = await requestBody(request);
        requireOnlyKeys(body, ['privacy', 'recordingAi']);
        const updated = await updateParticipantConsent(env, actor, supportCaseId, {
          privacy: requiredBoolean(body, 'privacy'),
          recordingAi: requiredBoolean(body, 'recordingAi'),
        });
        return json(updated);
      }
      // 전체 목표 그 자리 입력·수정 (D45 · CCC-41). 담당 실무자만 — 게이트웨이가 강제한다(R1).
      // null 또는 빈 문자열은 "설정 전"으로 되돌린다.
      if (request.method === 'PUT' && parts.length === 3 && parts[2] === 'overall-goal') {
        requestQuery(url, []);
        const body = await requestBody(request);
        requireOnlyKeys(body, ['overallGoal']);
        const overallGoal = optionalNullableString(body, 'overallGoal') ?? null;
        const updatedGoal = await setSupportCaseOverallGoal(env, actor, supportCaseId, overallGoal);
        await onGoalRevised(env, actor, supportCaseId);
        return json(updatedGoal);
      }
      // 불일치 처리 3종 (D45 · CCC-42). 권한(담당 실무자·기관 관리자)은 게이트웨이가 강제한다(R1).
      // 처리는 표시일 뿐 원본 기록은 건드리지 않는다 — 바뀌는 것은 처리 3컬럼뿐이다(ADR-0018).
      if (
        request.method === 'PUT' && parts.length === 5
        && parts[2] === 'discrepancies' && parts[4] === 'resolution'
      ) {
        requestQuery(url, []);
        const body = await requestBody(request);
        requireOnlyKeys(body, ['status']);
        const status = requiredString(body, 'status');
        if (status !== 'situation_changed' && status !== 'record_error' && status !== 'confirmed') {
          throw new ValidationError('status is invalid');
        }
        const discrepancyId = requireRouteUuid(parts[3] ?? '', 'discrepancy id');
        // 주소의 참여 사업을 함께 넘긴다 — 게이트웨이가 **바꾸기 전에** 소속을 대조한다.
        // 여기서 응답을 받아 놓고 걸러내면 이미 저장·감사가 끝난 뒤라 상태를 바꾼 403 이 된다.
        return json(await resolveSessionDiscrepancy(env, actor, discrepancyId, status, supportCaseId));
      }
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'records') {
        const query = requestQuery(url, ['official']);
        const official = query.get('official');
        if (official !== null && official !== 'true') throw new ValidationError('official is invalid');
        const [records, goals, schedule, recordErrorSessionIds, supportCase] = await Promise.all([
          listCounselingRecords(env, actor, supportCaseId),
          listGoals(env, actor, supportCaseId),
          getNextCounselingScheduleForSupportCase(env, actor, supportCaseId),
          // '기록 오류'로 처리된 불일치가 가리키는 회차 — 화면이 그 기록 옆에 표시만 붙인다(CCC-42).
          listRecordErrorSessionIds(env, actor, supportCaseId),
          // D47: HERO 상태 태그와 전체 목표 한 줄(읽기 전용)의 재료. 접근 판정만 하고 감사는
          // 남기지 않으므로 이 화면의 read 감사는 listCounselingRecords 한 건 그대로다(D14).
          assertSupportCaseAccess(env, actor, supportCaseId),
        ]);
        const goalTitles = new Map(goals.map((goal): [string, string] => [goal.id, goal.title]));
        return json({
          records: records.map((record) => counselingRecordDetailsResponse(record, goalTitles)),
          // closedReason 은 세부 목표 구획(D62 · CCC-68)의 닫힘 사유 배지 재료다.
          goals: goals.map((goal) => ({ id: goal.id, title: goal.title, status: goal.status, closedReason: goal.closedReason })),
          schedule: nextCounselingScheduleResponse(schedule),
          recordErrorSessionIds,
          // 수정은 브리핑 몫이라 여기서는 값만 내려보낸다(D47 §1).
          overallGoal: supportCase.overallGoal,
          caseStatus: supportCase.status,
          programType: supportCase.programType,
        });
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'records') {
        requestQuery(url, []);
        const result = await createCounselingRecord(env, actor, supportCaseId, parseRecordCreation(await requestBody(request)));
        // 수기 메모는 저장 즉시 공식 기록(D5) — 공식화 시점 불일치 검출(CCC-43). 재생(replay)은
        // 이미 검출을 거친 제출이라 건너뛴다. 실패해도 저장 응답은 그대로 나간다(D8).
        if (!result.replayed) await onRecordOfficialized(env, actor, result.record.id, 'manual_record');
        return json(
          { record: counselingRecordResponse(result.record), replayed: result.replayed },
          result.replayed ? 200 : 201,
        );
      }
      // 인테이크 작성 컨텍스트(회차 자동값·당사자 표시·기존 인테이크 여부) — CCC-7.
      if (request.method === 'GET' && parts.length === 4 && parts[2] === 'records' && parts[3] === 'intake') {
        requestQuery(url, []);
        return json(intakeContextResponse(await getIntakeRecordContext(env, actor, supportCaseId)));
      }
      // 인테이크 제출(P1 일괄) — CCC-7.
      if (request.method === 'POST' && parts.length === 4 && parts[2] === 'records' && parts[3] === 'intake') {
        requestQuery(url, []);
        const result = await createIntakeRecord(env, actor, supportCaseId, parseIntakeCreation(await requestBody(request)));
        // 인테이크도 수기 공식 기록이다(D5) — 회차 내 모순 검출 대상(CCC-43).
        if (!result.replayed) await onRecordOfficialized(env, actor, result.record.id, 'manual_record');
        return json(
          { record: intakeRecordResponse(result.record), replayed: result.replayed },
          result.replayed ? 200 : 201,
        );
      }
      // 인테이크 수정(2026-08-08 Q "확인/수정") — 위저드 소유분만 덮어쓴다.
      if (request.method === 'PUT' && parts.length === 4 && parts[2] === 'records' && parts[3] === 'intake') {
        requestQuery(url, []);
        const result = await updateIntakeRecord(env, actor, supportCaseId, parseIntakeUpdate(await requestBody(request)));
        // 수정본도 수기 공식 기록이다(D5) — 공식화 시점 불일치 검출을 다시 돈다(CCC-43).
        await onRecordOfficialized(env, actor, result.record.id, 'manual_record');
        return json({ record: intakeRecordResponse(result.record) });
      }
    }

    if (request.method === 'GET' && parts.length === 1 && parts[0] === 'cases') {
      const status = url.searchParams.get('status');
      if (status !== null && status !== 'active' && status !== 'closed') throw new ValidationError('status is invalid');
      return json(await listCases(env, actor, status === null ? undefined : { status }));
    }
    if (request.method === 'POST' && parts.length === 1 && parts[0] === 'cases') {
      const body = await requestBody(request);
      const input: { programType?: string; intakeAt?: string; consentRecordingAt?: string | null; consentTextAiAt?: string | null } = {};
      const programType = optionalString(body, 'programType');
      const intakeAt = optionalString(body, 'intakeAt');
      const consentRecordingAt = optionalNullableString(body, 'consentRecordingAt');
      const consentTextAiAt = optionalNullableString(body, 'consentTextAiAt');
      if (programType !== undefined) input.programType = programType;
      if (intakeAt !== undefined) input.intakeAt = intakeAt;
      if (consentRecordingAt !== undefined) input.consentRecordingAt = consentRecordingAt;
      if (consentTextAiAt !== undefined) input.consentTextAiAt = consentTextAiAt;
      return json(await createCase(env, actor, input), 201);
    }
    if (parts[0] === 'cases' && parts[1] !== undefined) {
      const caseId = parts[1];
      if (request.method === 'GET' && parts.length === 2) return json(await getCase(env, actor, caseId));
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'briefing') return json(await getBriefing(env, actor, caseId));
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'pilot-text-ai-consent') {
        return json(await getLatestPilotTextAiConsentStatus(env, actor, caseId));
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'pilot-text-ai-consent') {
        await recordPilotTextAiConsentEvidence(env, actor, caseId, parsePilotTextAiConsent(await requestBody(request)));
        return json(await getLatestPilotTextAiConsentStatus(env, actor, caseId), 201);
      }
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'goals') {
        return json(await listGoals(env, actor, caseId));
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'goals') {
        const body = await requestBody(request);
        const created = await createGoal(env, actor, caseId, {
          title: requiredString(body, 'title'),
          ...(Object.hasOwn(body, 'scaleCriteria') ? { scaleCriteria: body.scaleCriteria } : {}),
        });
        await onGoalRevised(env, actor, caseId);
        return json(created, 201);
      }
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'sessions') {
        return json((await listSessions(env, actor, caseId)).map(sessionResponse));
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'sessions') {
        const input = parseRecordCreation(await requestBody(request));
        // `authorized` 를 반드시 함께 본다. D36 으로 이 목록에 **담당하지 않는 사업도**
        // 들어오게 됐으므로(라벨·담당 실무자만 보여주기 위해), 필터 없이 find 하면 비담당
        // 케이스에 기록을 쓰게 된다 — 표시 범위를 넓힌 것이 쓰기 권한을 넓히면 안 된다.
        const legacyEntry = (await listSupportCasesForBeneficiary(
          env,
          actor,
          requireBeneficiaryId(caseId),
        )).programs.find((entry) => entry.authorized && entry.supportCase.legacyCaseId === caseId);
        if (legacyEntry === undefined) {
          throw new ForbiddenError('legacy case has no authorized canonical support case');
        }
        const result = await createCounselingRecord(env, actor, legacyEntry.supportCase.id, input);
        // Phase-1 호환 경로도 같은 공식화 지점이다 — 검출 훅 동일(CCC-43).
        if (!result.replayed) await onRecordOfficialized(env, actor, result.record.id, 'manual_record');
        return json(
          { ...sessionResponse(await getSession(env, actor, result.record.id)), replayed: result.replayed },
          result.replayed ? 200 : 201,
        );
      }
    }
    if (parts[0] === 'goals' && parts[1] !== undefined) {
      const goalId = parts[1];
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'close') {
        const body = await requestBody(request);
        // D62 §5: 구 종료+신설 승계(successor)는 받지 않는다. 사유는 선택값 3종.
        const closed = await closeGoal(env, actor, goalId, requiredString(body, 'reason'));
        await onGoalRevised(env, actor, closed.caseId);
        return json(closed);
      }
      // 미래 회기 연결 수 (D62 §5 · CCC-70): 닫기 시도 화면의 알림 한 줄 판정용.
      // 알림일 뿐 닫기를 막지 않는다. 판정 SQL·권한·감사는 게이트웨이 내장(R1).
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'upcoming-links') {
        requestQuery(url, []);
        return json({ upcomingCount: await countUpcomingSchedulesLinkedToGoal(env, actor, goalId) });
      }
      // D62 §4: 세부 목표 문구 수정 — 수정 금지(D12) 폐지. 이력 보존은 게이트웨이가 한다.
      if (request.method === 'PUT' && parts.length === 3 && parts[2] === 'title') {
        const body = await requestBody(request);
        const retitled = await updateGoalTitle(env, actor, goalId, requiredString(body, 'title'));
        await onGoalRevised(env, actor, retitled.caseId);
        return json(retitled);
      }
    }
    if (parts[0] === 'sessions' && parts[1] !== undefined) {
      const sessionId = parts[1];
      if (request.method === 'GET' && parts.length === 2) return json(sessionResponse(await getSession(env, actor, sessionId)));
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'ai') {
        requireAiDraftReviewActor(actor);
        const draft = await getCurrentAiDraftForSession(env, actor, sessionId);
        if (draft === null) return json({ error: 'not_found' }, 404);
        // 재생성 노출 조건은 서버가 판정한다(D69 · ADR-0036 결정 2 · CCC-100, R1).
        const regeneration = await getAiDraftRegenerationAvailability(env, actor, sessionId, draft);
        return json({
          ...aiDraftResponse(draft),
          regenerateAvailable: regeneration.available,
          regenerateSourceSnapshotId: regeneration.sourceSnapshotId,
        });
      }
      if (request.method === 'POST' && parts.length === 4 && parts[2] === 'ai' && parts[3] === 'source') {
        const snapshot = await recordMaskedSourceSnapshot(env, actor, sessionId, parseMaskedSourceSnapshot(await requestBody(request)));
        // 이제서야 이 회차가 2차 마스킹을 마친 재료를 갖는다 — 공식화 시점에 스킵됐던
        // 불일치 검출을 여기서 돌린다(ADR-0027). 실패는 스킵이다(D8).
        await runDiscrepancyDetection(env, actor, sessionId);
        return json({
          sourceSnapshotId: snapshot.id,
          sha256: snapshot.sha256,
          maskingPipelineVersion: snapshot.maskingPipelineVersion,
          evidenceIds: snapshot.evidence.map((evidence) => evidence.id),
        }, 201);
      }
      if (request.method === 'POST' && parts.length === 4 && parts[2] === 'ai' && parts[3] === 'generate') {
        return json(aiDraftResponse(await generateAiDraft(env, actor, sessionId, await requestBody(request))), 201);
      }
      if (
        request.method === 'POST'
        && parts.length === 6
        && parts[2] === 'ai'
        && parts[3] === 'drafts'
        && parts[5] === 'edit'
      ) {
        requireAiDraftReviewActor(actor);
        const version = routeDraftVersion(parts[4] ?? '');
        const input = parseAiDraftEdit(await requestBody(request));
        if (input.expectedVersion !== version) throw new StaleDraftVersionError();
        return json(aiDraftResponse(await editAiDraftForSession(env, actor, sessionId, input)));
      }
      if (
        request.method === 'POST'
        && parts.length === 6
        && parts[2] === 'ai'
        && parts[3] === 'drafts'
        && parts[5] === 'review'
      ) {
        requireAiDraftReviewActor(actor);
        const version = routeDraftVersion(parts[4] ?? '');
        const input = parseAiDraftReview(await requestBody(request));
        if (input.expectedVersion !== version) throw new StaleDraftVersionError();
        const reviewed = await reviewAiDraftForSession(env, actor, sessionId, input);
        // AI 정리 승인 = 공식화(R2) — 이 시점에 불일치를 재검출한다(CCC-43). 거부는 비공식이라 제외.
        if (input.decision === 'approved') await onRecordOfficialized(env, actor, sessionId, 'ai_draft_approved');
        return json(aiDraftResponse(reviewed));
      }
      if (request.method === 'PUT' && parts.length === 3 && parts[2] === 'audio') {
        return await handleAudioUpload(request, env, actor, sessionId);
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'approve') {
        return json(sessionResponse(await approveSession(env, actor, sessionId, parseApproval(await requestBody(request)))));
      }
    }
    if (request.method === 'GET' && parts.length === 3 && parts[0] === 'ai' && parts[1] === 'provider' && parts[2] === 'status') {
      return json(await getActiveAiProviderStatus(env, actor));
    }
    if (
      request.method === 'POST'
      && parts.length === 3
      && parts[0] === 'ai'
      && parts[1] === 'provider'
      && parts[2] === 'activate-runtime'
    ) {
      if (!previewModeEnabled(env)) return json({ error: 'not_found' }, 404);
      const body = await requestBody(request);
      requireOnlyKeys(body, ['approvalRef']);
      const approvalRef = requiredString(body, 'approvalRef');
      // 환경 변수의 정확한 레지스트리 tuple과 API 키를 먼저 검증한다. 호출자가 임의
      // hash/model을 넣을 수 없고, 현재 배포 설정과 DB activation이 항상 함께 움직인다.
      const { config } = resolveAiProviderAdapter(env);
      const configHash = await canonicalAiProviderConfigHash(config);
      const current = await getActiveAiProviderStatus(env, actor);
      if (
        current.enabled
        && current.adapterId === config.providerId
        && current.adapterVersion === config.adapterVersion
        && current.configHash === configHash
      ) {
        return json({ ...current, replayed: true });
      }
      const registered = await registerAiProviderConfiguration(env, actor, {
        adapterId: config.providerId,
        adapterVersion: config.adapterVersion,
        configHash,
        approvalRefs: [approvalRef],
      });
      await activateAiProviderConfiguration(env, actor, registered.id);
      return json({
        enabled: true,
        adapterId: registered.adapterId,
        adapterVersion: registered.adapterVersion,
        configHash: registered.configHash,
        replayed: false,
      }, 201);
    }
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'pipeline' && parts[1] === 'health') {
      // D8 폴링 워치독 조회 — 관리자 전용(getPipelineHealth 내부에서 강제). 자기 기관만.
      return json(await getPipelineHealth(env, actor));
    }
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'pipeline' && parts[1] === 'jobs') {
      return json({ jobs: await listPipelineJobs(env, actor) });
    }
    // 텍스트 일감 큐(D51 · ADR-0027) — 오디오 없는 회차의 2차 마스킹을 장비에 맡긴다.
    if (parts[0] === 'pipeline' && parts[1] === 'text-jobs') {
      if (request.method === 'GET' && parts.length === 2) {
        return json({ jobs: await listTextWorkItems(env, actor) });
      }
      if (parts[2] !== undefined) {
        const itemId = parts[2];
        if (request.method === 'GET' && parts.length === 4 && parts[3] === 'source') {
          return json(await getTextWorkItemSource(env, actor, itemId));
        }
        if (request.method === 'POST' && parts.length === 4 && parts[3] === 'complete') {
          await completeTextWorkItem(env, actor, itemId);
          return new Response(null, { status: 204 });
        }
      }
    }
    if (parts[0] === 'pii-purge') {
      // D10 PII 파기 — 관리자 전용(gateway 내부에서 강제). 미리보기(GET)와 실행(POST) 분리.
      if (request.method === 'GET' && parts.length === 2 && parts[1] === 'due') {
        return json({ due: await previewExpiredPii(env, actor) });
      }
      if (request.method === 'POST' && parts.length === 1) {
        return json(await purgeExpiredPiiAsAdmin(env, actor));
      }
    }
    if (parts[0] === 'pipeline' && parts[1] === 'jobs' && parts[2] !== undefined) {
      const sessionId = parts[2];
      if (request.method === 'GET' && parts.length === 4 && parts[3] === 'audio') {
        // 서비스 역할·org·오디오 등록 확인 + download_audio 감사(D14)는 gateway가 담당한다.
        const { audioR2Key } = await getPipelineAudioKey(env, actor, sessionId);
        const object = await getAudioObject(env, audioR2Key);
        if (object === null) {
          return json({ error: 'audio_object_missing', jobId: sessionId }, 404);
        }
        // R2 키는 응답에 싣지 않는다. 저장된 content-type으로 바이트만 중계한다.
        const headers = new Headers();
        headers.set('content-type', object.httpMetadata?.contentType ?? 'application/octet-stream');
        headers.set('cache-control', 'no-store');
        return new Response(object.body, { status: 200, headers });
      }
      if (request.method === 'POST' && parts.length === 4 && parts[3] === 'result') {
        const committed = await commitRecordingResult(
          env,
          actor,
          sessionId,
          parseRecordingResult(await requestBody(request)),
        );
        // 통합 동의의 텍스트 AI 증적과 활성 스위치도 최종 관문이다. 후속 초안은
        // 마스킹 스냅샷만 재료로 만들며, 실패하면 review_ready로 올리지 않아 재시도된다.
        let finalizedNow = false;
        if (!committed.finalized) {
          if (!committed.downstreamReady) {
            const claimToken = await claimRecordingResultDownstream(env, actor, sessionId);
            if (claimToken === null) {
              throw new ConflictError('recording result downstream work is already in progress');
            }
            try {
              await generateAiDraft(env, actor, sessionId, { sourceSnapshotId: committed.snapshot.id });
            } catch (error) {
              await releaseRecordingResultDownstream(env, actor, sessionId, claimToken);
              throw error;
            }
          }
          finalizedNow = await finalizeRecordingResult(env, actor, sessionId);
        }
        if (finalizedNow) await runDiscrepancyDetection(env, actor, sessionId);
        return new Response(null, { status: 204 });
      }
    }

    if (parts[0] === 'users') {
      // 사용자 디렉터리 관리 — 관리자 전용(gateway 내부에서 강제). 자기 기관만.
      if (request.method === 'GET' && parts.length === 1) {
        return json(await listUsers(env, actor));
      }
      if (request.method === 'POST' && parts.length === 1) {
        const body = await requestBody(request);
        const roleValue = requiredString(body, 'role');
        if (roleValue !== 'admin' && roleValue !== 'counselor' && roleValue !== 'service') {
          throw new ValidationError('role is invalid');
        }
        const role: Role = roleValue;
        const userId = optionalString(body, 'userId');
        // 직원 표시 이름(D31): 선택 항목. 비어 있지 않은 문자열 + 길이 ≤50 만 라우트에서 검증한다.
        const name = optionalRegisteredText(body, 'name', 50);
        const input: { email: string; role: Role; userId?: string; name?: string } = { email: requiredString(body, 'email'), role };
        if (userId !== undefined) input.userId = userId;
        if (name !== undefined) input.name = name;
        return json(await upsertUser(env, actor, input), 201);
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'deactivate' && parts[1] !== undefined) {
        return json(await deactivateUser(env, actor, parts[1]));
      }
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'assignments' && parts[1] !== undefined) {
        // 실무자별 활성 배정 당사자(실명 포함) — 관리자 영역 사용자/실무자 상세(재개편 T8, D25).
        // id 는 이메일 또는 UUID 라 경로 세그먼트를 디코드해 웹의 encodeURIComponent 인코딩도 수용한다.
        requestQuery(url, []);
        const assignments = await listCounselorAssignments(env, actor, decodeURIComponent(parts[1]));
        return json({
          userId: assignments.userId,
          participants: assignments.participants.map(counselorAssignmentResponse),
        });
      }
    }

    return json({ error: 'not_found' }, 404);
  } catch (error) {
    return errorResponse(error);
  }
}
