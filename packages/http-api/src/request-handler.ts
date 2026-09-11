import type { MeResponse } from '@ccc/contracts/institution';
import type { CreateProgramInput, UpdateProgramInput, ProgramOptionsResponse, ProgramMutationResponse, ProgramAdmissionDeniedResponse } from '@ccc/contracts/program-admission';
import {
  ACTION_ITEM_RESOLUTION_STATUSES,
  type ActionItemResolutionStatus,
  AiProviderNotConfiguredError,
  assertSupportCaseAccess,
  listSettingsSupportCaseOptions,
  getRetentionPolicy,
  updateRetentionPolicy,
  getMyIdentity,
  getInstitutionReadiness,
  listMyRoles,
  listAuditLog,
  listDirectoryAccounts,
  updateDirectoryRoles,
  deactivateDirectoryAccount,
  type DirectoryRole,
  correctCounselingMemory,
  getCounselingMemory,
  getCounselingMemorySettings,
  loadCounselingMemoryContext,
  setCounselingMemorySettings,
  acceptCounselingMemorySource,
  claimCounselingMemorySources,
  getCounselingMemorySource,
  issueCounselingMemoryDictionary,
  releaseCounselingMemorySource,
  ConflictError,
  ProgramAdmissionRequiredError,
  createProgram,
  updateProgram,
  listPrograms,
  listProgramOptions,
  getInstalledAiPolicy,
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
  EmotionDeferredError,
  assertPilotTextAiConsent,
  assertPilotTextAiConsentForService,
  admitRecordingUpload,
  beginRecordingUploadIntent,
  abandonRecordingUpload,
  authorizeRecordingUploadTarget,
  authorizeStorageSignerOperation,
  authorizeRecordingUploadStream,
  beginAgentJobAudioTargetMint,
  completeAgentJobAudioTargetMint,
  failRecordingUploadStorageWrite,
  completeRecordingUploadStorageWrite,
  failAgentJobAudioTargetMint,
  authorizeSessionTextAiEgress,
  approveSession,
  activateAiProviderConfiguration,
  collectDiscrepancyDetectionSources,
  replaceSessionDiscrepancies,
  resolveSessionDiscrepancy,
  listRecordErrorSessionIds,
  acceptSupportCaseAssignment,
  COUNSELING_RECORD_DETAIL_KEYS,
  cancelCounselingSchedule,
  closeGoal,
  closeSupportCase,
  getSupportCaseClosureInfo,
  forceTransferSupportCase,
  countUpcomingSchedulesLinkedToGoal,
  createBeneficiaryWithInitialSupportCase,
  issueRegistrationConsentDisclosures,
  createCase,
  createCounselingRecord,
  createActionItem,
  createIntakeRecord,
  updateIntakeRecord,
  createParticipantInvite,
  completeParticipantSignup,
  createStaffInvite,
  listStaffInvites,
  revokeStaffInvite,
  getStaffInvitePublicInfo,
  acceptStaffInvite,
  getParticipantRequestLinkInfo,
  issueParticipantRequestLinkDisclosures,
  issueAgentPairingCode,
  redeemAgentPairingCode,
  rotateAgentRefreshCredential,
  revokeAgentInstallation,
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
  getTranscriptQualityForSession,
  getLatestPilotTextAiConsentStatus,
  getParticipantBasicInfo,
  getParticipantBriefing,
  getParticipantGoalTree,
  getSupportCaseConsent,
  issueSupportCaseConsentDisclosures,
  listSupportCaseConsentEvents,
  closeAgentJobAudioObjectMissing,
  getAgentJobAudioDelivery,
  getPendingRecordingUpload,
  listAudioManualNoteFallbacks,
  getPipelineHealth,
  exportCase,
  listCaseExportHistory,
  getLastProgramType,
  getOrganizationProfile,
  updateOrganizationProfile,
  completeOrganizationOnboarding,
  rememberLastProgramType,
  revokeIdentitySession,
  getNextCounselingScheduleForSupportCase,
  getScheduleSessionPlan,
  getSession,
  getTodaySchedules,
  getMonthSchedules,
  getUpcomingSchedules,
  listCases,
  listCounselingRecords,
  getSupportCaseReport,
  listCounselorAssignments,
  listMySupportCaseAssignmentRequests,
  listGoals,
  claimAgentJobs,
  heartbeatAgentJob,
  releaseAgentJob,
  getAgentJobSource,
  issueAgentJobMaskDictionary,
  verifyAgentJobAudio,
  authorizeAgentJobEgress,
  markAgentJobEgressInFlight,
  acceptAgentJobResult,
  appendSupportCaseConsentEvent,
  recordSttReadiness,
  reconcileSupportCaseAudioDeletions,
  reconcileAudioObjectDeletion,
  acknowledgeAudioManualNoteFallback,
  reconcileAgentJobAudioDeletion,
  ConsentContractError,
  type AgentJobResultAcceptance,
  AgentJobContractError,
  type AgentRuntime,
  claimRecordingResultDownstream,
  commitRecordingResult,
  enqueueTextWorkForGoalChange,
  enqueueTextWorkItem,
  finalizeRecordingResult,
  releaseRecordingResultDownstream,
  listSessions,
  listSupportCaseAssignees,
  countNewSignups,
  requestSupportCaseAssignment,
  requestOwnSupportCaseAssignment,
  reviewSupportCaseAssignmentRequest,
  listAssignedParticipants,
  listPrivacyConsentFollowUps,
  listParticipantPiiRetentionReviews,
  listSupportCasesForBeneficiary,
  type ParticipantProgramList,
  listUsers,
  loadAiCallMaterialsForService,
  markCounselingScheduleNoShow,
  PiiPurgeDisabledError,
  recordAiCallOutcome,
  registerAiProviderConfiguration,
  registerRecording,
  rescheduleCounselingSchedule,
  reviewAiDraftForSession,
  reviewParticipantPiiRetention,
  updateScheduleSessionGoals,
  searchParticipants,
  setSupportCaseOverallGoal,
  updateGoalTitle,
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
  type ParticipantPiiRetentionReviewInput,
  type AiDraftReviewInput,
  type CounselingRecordDetails,
  type CounselingScheduleDisplayColor,
  type AssignedParticipant,
  type ParticipantSearchResult,
  type Role,
  type Session,
} from '@ccc/core/gateway';
import { isBeneficiaryId } from '@ccc/contracts/animal-slugs';
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
} from '@ccc/ai-runtime';
import { gatewayActorFromIdentity, type ApiEnv } from './identity';
import { buildCapabilities, CapabilitiesUnavailableError, verifiedInstallManifest } from './capabilities';
import {
  jobErrorHttpStatus,
  routeForMode,
  type AudioVerifyRequest,
  type ClaimRequest,
  type EgressAuthorizationRequest,
  type EgressInFlightRequest,
  type PermanentReleaseReason,
  type ReleaseRequest,
  type ResultRequest,
} from '@ccc/contracts/agent-jobs';
import {
  CONSENT_DOMAINS,
  type AppendConsentEventInput,
  type ConsentDecision,
  type ProviderId,
  type PurposeLiteral,
  type RetentionDuration,
} from '@ccc/contracts/consent';
import { isSttReadinessReport } from '@ccc/contracts/stt-readiness';
// preview-gate 는 여기서 타입만 가져가므로(import type) 런타임 순환이 생기지 않는다.
import { previewModeEnabled } from './preview-gate';
import { memoryTrialEnabled, memoryTrialReadiness } from './counseling-memory-trial';
import { runCounselingMemory, runCounselingMemoryTrial } from './counseling-memory-runner';
import { createScheduledJobRunner, dueScheduledJobKinds } from '@ccc/core/scheduled-job-runner';
import { decodeStorageSignerRequest, type StorageSignerRequest } from '@ccc/contracts/audio';
import { ActorAuthenticationError, AUDIO_CONTENT_TYPES, IdentityStoreUnavailableError, MfaRequiredError, type Actor as IdentityActor, type AudioContentType, type AudioObjectMetadata, type JobReport } from '@ccc/contracts/runtime';

type JsonObject = Record<string, unknown>;
function normalizeAudioContentType(header: string | null): AudioContentType | null {
  if (header === null) return null;
  const base = header.split(';')[0]?.trim().toLowerCase() ?? '';
  return Object.prototype.hasOwnProperty.call(AUDIO_CONTENT_TYPES, base)
    ? base as AudioContentType
    : null;
}


const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
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

const STORAGE_AUTHORIZATION_BODY_BYTES = 1024 * 1024;
async function storageAuthorizationBody(request: Request): Promise<StorageSignerRequest> {
  const contentType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  const declaredLength = request.headers.get('content-length');
  if (
    contentType !== 'application/json'
    || (declaredLength !== null
      && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > STORAGE_AUTHORIZATION_BODY_BYTES))
  ) throw new ValidationError('storage authorization body is invalid');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > STORAGE_AUTHORIZATION_BODY_BYTES) {
    throw new ValidationError('storage authorization body is invalid');
  }
  try {
    return decodeStorageSignerRequest(JSON.parse(text));
  } catch {
    throw new ValidationError('storage authorization body is invalid');
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

function parseParticipantPiiRetentionReview(body: JsonObject): ParticipantPiiRetentionReviewInput {
  const decision = requiredString(body, 'decision');
  if (decision === 'purge') {
    return { decision };
  }
  if (decision !== 'retain') {
    throw new ValidationError('retention decision is invalid');
  }
  const reasonKind = requiredString(body, 'reasonKind');
  if (
    reasonKind !== 'extended_consent'
    && reasonKind !== 'active_work'
    && reasonKind !== 'legal_requirement'
  ) {
    throw new ValidationError('retention reason kind is invalid');
  }
  return {
    decision,
    reasonKind,
    reason: requiredString(body, 'reason'),
    retainUntil: requiredString(body, 'retainUntil'),
  };
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
  requireOnlyKeys(body, ['expectedDraftVersion']);
  const expectedDraftVersion = body.expectedDraftVersion;
  if (
    expectedDraftVersion !== undefined
    && (typeof expectedDraftVersion !== 'number' || !Number.isInteger(expectedDraftVersion) || expectedDraftVersion < 1)
  ) {
    throw new DraftVersionRequiredError();
  }
  return expectedDraftVersion === undefined ? {} : { expectedDraftVersion };
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
  const emergencyReason = optionalEmergencyReason(body);
  const consentEvents = parseInitialConsentEvents(body.consentEvents);
  const idempotencyKey = requiredString(body, 'idempotencyKey');
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
  const registrationKeys = ['idempotencyKey', 'consentEvents', 'emergencyReason', 'name', 'phone', 'email', 'birthDate', 'region', 'gender'];
  if (actor.role === 'admin') {
    requireOnlyKeys(body, ['programId', 'initialAssigneeUserId', ...registrationKeys]);
    return {
      input: {
        programId: requiredString(body, 'programId'),
        idempotencyKey,
        consentEvents,
        ...(emergencyReason === undefined ? {} : { emergencyReason }),
        initialAssigneeUserId: requiredUuid(body, 'initialAssigneeUserId'),
        ...optionalPii,
      },
    };
  }
  requireOnlyKeys(body, ['programId', ...registrationKeys]);
  return {
    input: {
      programId: requiredString(body, 'programId'),
      idempotencyKey,
      consentEvents,
      ...(emergencyReason === undefined ? {} : { emergencyReason }),
      ...optionalPii,
    },
  };
}

function parseInitialConsentEvents(value: unknown): AppendConsentEventInput[] {
  if (!Array.isArray(value) || value.length !== CONSENT_DOMAINS.length) {
    throw new ValidationError('six consent events are required');
  }
  return value.map(event => {
    if (event === null || typeof event !== 'object' || Array.isArray(event)) {
      throw new ValidationError('consent event is invalid');
    }
    return parseConsentEventInput(event as JsonObject);
  });
}

function parseSubsequentParticipantCreation(body: JsonObject, actor: Actor) {
  requireHumanParticipantActor(actor);
  const emergencyReason = optionalEmergencyReason(body);
  const consentKeys = ['consentEvents', 'emergencyReason'];
  const consentInput = {
    consentEvents: parseInitialConsentEvents(body.consentEvents),
    ...(emergencyReason === undefined ? {} : { emergencyReason }),
  };
  // intakeAt 키는 여기서도 받지 않는다(CCC-56) — 추가 참여 사업도 등록 시점에는 인테이크 전이다.
  if (actor.role === 'admin') {
    requireOnlyKeys(body, ['schemaVersion', 'submissionId', 'programId', 'initialAssigneeUserId', ...consentKeys]);
    return {
      schemaVersion: requiredSchemaVersion(body),
      submissionId: requiredUuid(body, 'submissionId'),
      programId: requiredString(body, 'programId'),
      initialAssigneeUserId: requiredUuid(body, 'initialAssigneeUserId'),
      ...consentInput,
    };
  }
  requireOnlyKeys(body, ['schemaVersion', 'submissionId', 'programId', 'sourceSupportCaseId', ...consentKeys]);
  return {
    schemaVersion: requiredSchemaVersion(body),
    submissionId: requiredUuid(body, 'submissionId'),
    programId: requiredString(body, 'programId'),
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
  const hasHelpNarrative = Object.hasOwn(body, 'helpNarrative');
  const hasLifeAreas = Object.hasOwn(body, 'lifeAreas');
  const hasGoals = Object.hasOwn(body, 'goals');
  const hasActions = Object.hasOwn(body, 'actions');
  const hasDebts = Object.hasOwn(body, 'debts');
  const hasLinkedOrgs = Object.hasOwn(body, 'linkedOrgs');
  const allowedKeys = ['submissionId', 'heldAt', 'channel'];
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

function parseScheduleDisplay(body: JsonObject): { allDay?: boolean; displayColor?: CounselingScheduleDisplayColor | null } {
  const displayColor = body.displayColor;
  if (displayColor !== undefined && displayColor !== null && displayColor !== 'mint'
    && displayColor !== 'lavender' && displayColor !== 'coral' && displayColor !== 'cyan'
    && displayColor !== 'light-magenta') throw new ValidationError('displayColor is invalid');
  return {
    ...(Object.hasOwn(body, 'allDay') ? { allDay: requiredBoolean(body, 'allDay') } : {}),
    ...(displayColor === undefined ? {} : { displayColor }),
  };
}

function parseScheduleCreation(body: JsonObject) {
  requireOnlyKeys(body, [
    'beneficiaryId', 'supportCaseId', 'scheduledAt', 'allDay', 'displayColor',
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
    ...parseScheduleDisplay(body),
    ...(sessionKind === undefined ? {} : { sessionKind }),
    ...(channel === undefined ? {} : { channel }),
    ...(sessionGoals === undefined ? {} : { sessionGoals }),
    ...(caseGoals === undefined ? {} : { caseGoals }),
    ...(customQuestions === undefined ? {} : { customQuestions }),
  };
}

function parseScheduleReschedule(body: JsonObject) {
  requireOnlyKeys(body, ['expectedVersion', 'scheduledAt', 'allDay', 'displayColor']);
  return {
    expectedVersion: requiredExpectedVersion(body, 'expectedVersion'),
    scheduledAt: requiredCanonicalUtc(body, 'scheduledAt'),
    ...parseScheduleDisplay(body),
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

function parseExportHistoryQuery(query: URLSearchParams) {
  const limitValue = query.get('limit');
  let limit: number | undefined;
  if (limitValue !== null) {
    if (!/^[1-9]\d*$/u.test(limitValue)) throw new ValidationError('limit is invalid');
    limit = Number(limitValue);
    if (!Number.isSafeInteger(limit) || limit > 50) throw new ValidationError('limit is invalid');
  }
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(query.get('cursor') === null ? {} : { cursor: query.get('cursor')! }),
  };
}

function parseAuditLogQuery(query: URLSearchParams) {
  const limitValue = query.get('limit');
  let limit: number | undefined;
  if (limitValue !== null) {
    if (!/^[1-9]\d*$/u.test(limitValue)) throw new ValidationError('limit is invalid');
    limit = Number(limitValue);
    if (!Number.isSafeInteger(limit) || limit > 100) throw new ValidationError('limit is invalid');
  }
  const actorId = query.get('actorId') ?? undefined;
  const supportCaseId = query.get('supportCaseId') ?? undefined;
  if (actorId !== undefined && actorId.trim().length === 0) throw new ValidationError('actorId is invalid');
  if (supportCaseId !== undefined && supportCaseId.trim().length === 0) {
    throw new ValidationError('supportCaseId is invalid');
  }
  const fromValue = query.get('from');
  const toValue = query.get('to');
  const from = fromValue === null ? undefined : canonicalUtc(fromValue, 'from');
  const to = toValue === null ? undefined : canonicalUtc(toValue, 'to');
  if (from !== undefined && to !== undefined && from > to) {
    throw new ValidationError('date range is invalid');
  }
  return {
    ...(limit === undefined ? {} : { limit }),
    ...(query.get('cursor') === null ? {} : { cursor: query.get('cursor')! }),
    ...(actorId === undefined ? {} : { actorId }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(supportCaseId === undefined ? {} : { supportCaseId }),
  };
}
function parseProgramStaff(value: unknown): NonNullable<CreateProgramInput['staff']> {
  if (!Array.isArray(value)) throw new ValidationError('program staff is invalid');
  return value.map((entry) => {
    const person = asObject(entry);
    requireOnlyKeys(person, ['userId', 'isResponsible']);
    if (typeof person.isResponsible !== 'boolean') throw new ValidationError('staff responsibility is invalid');
    return { userId: requiredString(person, 'userId'), isResponsible: person.isResponsible };
  });
}

function parseProgramChoices(body: JsonObject): Pick<CreateProgramInput, 'storageMode' | 'processingMode' | 'confirmation' | 'staff'> {
  const storageMode = optionalNullableString(body, 'storageMode');
  if (storageMode !== undefined && storageMode !== null && storageMode !== 'supabase_seoul'
    && storageMode !== 'naver_public' && storageMode !== 'local_encrypted' && storageMode !== 'undecided') {
    throw new ValidationError('storage choice is invalid');
  }
  const processingMode = optionalNullableString(body, 'processingMode');
  if (processingMode !== undefined && processingMode !== null && processingMode !== 'external_allowed'
    && processingMode !== 'internal_only' && processingMode !== 'undecided') {
    throw new ValidationError('processing choice is invalid');
  }
  const confirmation = body.confirmation === undefined ? undefined : body.confirmation === null ? null
    : parseProgramConfirmation(asObject(body.confirmation));
  return {
    ...(storageMode === undefined ? {} : { storageMode }),
    ...(processingMode === undefined ? {} : { processingMode }),
    ...(confirmation === undefined ? {} : { confirmation }),
    ...(body.staff === undefined ? {} : { staff: parseProgramStaff(body.staff) }),
  };
}

function parseProgramConfirmation(body: JsonObject) {
  requireOnlyKeys(body, ['copyVersion', 'copyHash', 'installationPolicyVersion', 'installationConfigHash']);
  return {
    copyVersion: requiredString(body, 'copyVersion'),
    copyHash: requiredString(body, 'copyHash'),
    installationPolicyVersion: requiredExpectedVersion(body, 'installationPolicyVersion'),
    installationConfigHash: requiredString(body, 'installationConfigHash'),
  };
}

function decodedProgramId(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    throw new ValidationError('program id is invalid');
  }
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
    email: participant.email,
    programNames: participant.programNames,
    // CCC-26 새 가입 배지 — 케이스에서 파생한 값이다(목록 API 가 감사 한 건을 이미 남긴다).
    newSignup: participant.newSignup,
  };
}

function participantProgramResponse(
  entry: ParticipantProgramList['programs'][number],
  participant: ParticipantProgramList['participant'],
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
    // 일반 사업 목록 소비자는 실명·연락처만 받는다. 이메일은 hub 응답에서만 직렬화한다.
    participantName: participant.name,
    participantPhone: participant.phone,
    // D36: 내가 담당하지 않는 사업도 목록에 나오되 상담 내용으로는 들어갈 수 없다.
    // 화면은 authorized 로 링크를 걸거나 잠그고, assigneeNames 로 "누구에게 물어보나"를 답한다.
    authorized: entry.authorized,
    assigneeNames: entry.assigneeNames,
    // 동의 시각이 아니라 **기록 시각**이다 — 3종을 모두 철회하면 동의 시각은 전부 NULL 이라
    // 방금 남긴 철회 기록이 "기록 없음"으로 보인다. 값은 append-only 이력에서 온다.
    consentRecordedAt: entry.consentRecordedAt,
    // 허브 '최신 일정' 카드(2026-08-06 Q). 담당 사업에만 실리고 비담당은 null 이다(D36).
    upcomingSchedule: entry.upcomingSchedule,
  };
}

function participantHubResponse(
  beneficiaryId: string,
  programList: ParticipantProgramList,
) {
  return {
    beneficiaryId,
    restricted: programList.restricted === true,
    participantName: programList.participant.name,
    participantPhone: programList.participant.phone,
    participantEmail: programList.participant.email,
    ...(programList.restricted === true ? {} : {
      participantBirthDate: programList.participant.birthDate ?? null,
      ...programList.progress,
    }),
    programs: programList.programs.map((program) => {
      const identification = {
        id: program.supportCase.id, beneficiaryId, programId: program.programId, programName: program.programName,
        programType: program.supportCase.programType, status: program.supportCase.status,
        authorized: program.authorized, assigneeNames: program.assigneeNames,
      };
      return program.authorized ? {
        ...participantProgramResponse(program, programList.participant), ...identification,
        closedAt: program.supportCase.closedAt,
      } : identification;
    }),
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
    status: assignee.status,
    acceptanceRequestedBy: assignee.acceptanceRequestedBy,
    acceptedAt: assignee.acceptedAt,
    transferReason: assignee.transferReason,
    notifiedBy: assignee.notifiedBy,
    notifiedAt: assignee.notifiedAt,
    assignedAt: assignee.assignedAt,
  };
}

function scheduleResponse(schedule: Awaited<ReturnType<typeof rescheduleCounselingSchedule>>) {
  return {
    id: schedule.id,
    beneficiaryId: schedule.beneficiaryId,
    supportCaseId: schedule.supportCaseId,
    scheduledAt: schedule.scheduledAt,
    allDay: schedule.allDay,
    displayColor: schedule.displayColor,
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
    allDay: plan.allDay,
    displayColor: plan.displayColor,
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
            sessionId: action.sessionId,
          })),
        flags: briefing.flags
          .filter((item) => item.sourceSupportCase.id === sourceSupportCase.id)
          .map(({ flag }) => ({
            id: flag.id,
            flagType: flag.flagType,
            source: flag.source,
            reviewStatus: flag.reviewStatus,
            sessionId: flag.sessionId,
            quote: flag.quote,
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
            sourceQuotes: suggestion.sourceQuotes,
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
        allDay: briefing.focusUpcomingSchedule.allDay,
        displayColor: briefing.focusUpcomingSchedule.displayColor,
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
      linkedSessions: goal.linkedSessions,
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
      quote: flag.quote,
    })),
    lifeAreaSnapshot: record.lifeAreaSnapshot.map((area) => ({
      areaKey: area.areaKey,
      status: area.status,
      note: area.note,
    })),
    // CCC-11: 담당 실무자 의견 — 저장된 값만 싣는다. 화면은 비면 블록을 그리지 않는다.
    managerOpinion: record.managerOpinion,
    // D47 접힌 줄·회차 카드용 3종. 저장된 값을 싣기만 한다 — 새 스키마 없음(ADR-0019 영향).
    aiOneLiner: record.aiOneLiner,
    memoExcerpt: record.memoExcerpt,
    sessionGoals: record.sessionGoals,
    discrepancies: record.discrepancies,
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
    allDay: schedule.allDay,
    displayColor: schedule.displayColor,
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

/** 전사 품질 구조화 필드 (CCC-124). 시간 구간과 고정 사유 코드만 받는다(R3). */
function parseTranscriptWarnings(body: JsonObject) {
  return objectArray(body.transcriptWarnings, 'transcriptWarnings').map((item) => {
    requireOnlyKeys(item, ['startSeconds', 'endSeconds', 'reason']);
    const startSeconds = item.startSeconds;
    const endSeconds = item.endSeconds;
    if (typeof startSeconds !== 'number' || typeof endSeconds !== 'number') {
      throw new ValidationError('transcript warning span is invalid');
    }
    return { startSeconds, endSeconds, reason: requiredString(item, 'reason') };
  });
}

/** S5 MaskedSource. S6 metadata 와 근거 hash 는 선택이 아니라 필수다. */
function parseAgentMaskedSource(body: JsonObject) {
  const base = parseMaskedSourceSnapshot({
    maskedText: body.maskedText,
    sha256: body.sha256,
    maskingPipelineVersion: body.maskingPipelineVersion,
    evidence: body.evidence,
  });
  if (body.nerAvailable !== true) throw new ValidationError('nerAvailable must be true');
  return {
    ...base,
    maskingPipelineHash: requiredString(body, 'maskingPipelineHash'),
    nerAvailable: true as const,
    nerAttestationId: requiredString(body, 'nerAttestationId'),
    nerAttestationResultHash: requiredString(body, 'nerAttestationResultHash'),
    releaseQualificationReceiptId: requiredString(body, 'releaseQualificationReceiptId'),
    evidenceHash: requiredString(body, 'evidenceHash'),
  };
}

const AGENT_MASKED_SOURCE_KEYS = [
  'kind', 'maskedText', 'sha256', 'maskingPipelineVersion', 'maskingPipelineHash', 'nerAvailable',
  'nerAttestationId', 'nerAttestationResultHash', 'releaseQualificationReceiptId', 'evidenceHash',
  'evidence',
];

function parseAgentResultRequest(body: JsonObject): ResultRequest {
  requireOnlyKeys(body, ['schemaVersion', 'claimToken', 'attempt', 'resultId', 'payloadSha256', 'result']);
  // v2 는 schemaVersion 2 하나만 받는다. v1 payload fallback 은 없다(S5 §2.7).
  if (body.schemaVersion !== 2) throw new ValidationError('schema version is invalid');
  const raw = asObject(body.result);
  const kind = requiredString(raw, 'kind');
  if (kind !== 'audio' && kind !== 'text') throw new ValidationError('result kind is invalid');
  requireOnlyKeys(
    raw,
    kind === 'audio'
      ? [...AGENT_MASKED_SOURCE_KEYS, 'emotionScores', 'transcriptReliable', 'transcriptWarnings']
      : AGENT_MASKED_SOURCE_KEYS,
  );
  const masked = parseAgentMaskedSource(raw);
  const result = kind === 'audio'
    ? {
      ...masked,
      kind: 'audio' as const,
      emotionScores: asObject(raw.emotionScores),
      transcriptReliable: requiredBoolean(raw, 'transcriptReliable'),
      transcriptWarnings: parseTranscriptWarnings(raw),
    }
    : { ...masked, kind: 'text' as const };
  return {
    schemaVersion: 2,
    claimToken: requiredString(body, 'claimToken'),
    attempt: requiredInteger(body, 'attempt'),
    resultId: requiredString(body, 'resultId'),
    payloadSha256: requiredString(body, 'payloadSha256'),
    result,
  };
}

function parseClaimCredentials(body: JsonObject): { claimToken: string; attempt: number } {
  requireOnlyKeys(body, ['claimToken', 'attempt']);
  return { claimToken: requiredString(body, 'claimToken'), attempt: requiredInteger(body, 'attempt') };
}

/** claim 자격은 GET 에서도 필요하다. URL 에 토큰을 싣지 않고 헤더로만 받는다. */
function claimCredentialsFromHeaders(request: Request): { claimToken: string; attempt: number } {
  const claimToken = request.headers.get('x-ccc-job-claim');
  const attempt = Number(request.headers.get('x-ccc-job-attempt'));
  if (claimToken === null || claimToken.length === 0 || !Number.isInteger(attempt)) {
    throw new ValidationError('claim credentials are required');
  }
  return { claimToken, attempt };
}

function parseClaimRequest(body: JsonObject): ClaimRequest {
  const hasLimit = Object.hasOwn(body, 'limit');
  requireOnlyKeys(body, hasLimit
    ? ['limit', 'nerAttestation', 'releaseQualificationReceiptId']
    : ['nerAttestation', 'releaseQualificationReceiptId']);
  const attestation = asObject(body.nerAttestation);
  requireOnlyKeys(attestation, [
    'id', 'modelId', 'modelRevision', 'labelSetHash', 'corpusHash', 'resultHash',
    'validatedAt', 'expiresAt', 'status',
  ]);
  if (attestation.status !== 'passed') throw new ValidationError('ner attestation status is invalid');
  return {
    ...(hasLimit ? { limit: requiredInteger(body, 'limit') } : {}),
    nerAttestation: {
      id: requiredString(attestation, 'id'),
      modelId: requiredString(attestation, 'modelId'),
      modelRevision: requiredString(attestation, 'modelRevision'),
      labelSetHash: requiredString(attestation, 'labelSetHash'),
      corpusHash: requiredString(attestation, 'corpusHash'),
      resultHash: requiredString(attestation, 'resultHash'),
      validatedAt: requiredCanonicalUtc(attestation, 'validatedAt'),
      expiresAt: requiredCanonicalUtc(attestation, 'expiresAt'),
      status: 'passed',
    },
    releaseQualificationReceiptId: requiredString(body, 'releaseQualificationReceiptId'),
  };
}

function parseReleaseRequest(body: JsonObject): ReleaseRequest {
  requireOnlyKeys(body, ['claimToken', 'attempt', 'outcome', 'reason']);
  const credentials = parseClaimCredentials({ claimToken: body.claimToken, attempt: body.attempt });
  const outcome = requiredString(body, 'outcome');
  const reason = requiredString(body, 'reason');
  if (outcome === 'transient' && reason === 'engine_unavailable') {
    return { ...credentials, outcome: 'transient', reason: 'engine_unavailable' };
  }
  if (outcome === 'blocked' && reason === 'local_ner_unavailable') {
    return { ...credentials, outcome: 'blocked', reason: 'local_ner_unavailable' };
  }
  if (outcome === 'permanent' && (PERMANENT_RELEASE_REASONS as readonly string[]).includes(reason)) {
    return { ...credentials, outcome: 'permanent', reason: reason as PermanentReleaseReason };
  }
  throw new ValidationError('release outcome is invalid');
}

const PERMANENT_RELEASE_REASONS = [
  'result_schema_invalid',
  'masking_failed',
  'consent_not_effective',
  'audio_object_missing',
  'audio_hash_mismatch',
  'route_mismatch',
  'permanent_failure',
] as const;

function parseAudioVerifyRequest(body: JsonObject): AudioVerifyRequest {
  requireOnlyKeys(body, ['claimToken', 'attempt', 'generationId', 'agentComputedSha256']);
  return {
    ...parseClaimCredentials({ claimToken: body.claimToken, attempt: body.attempt }),
    generationId: requiredString(body, 'generationId'),
    agentComputedSha256: requiredString(body, 'agentComputedSha256'),
  };
}

function parseEgressAuthorizationRequest(body: JsonObject): EgressAuthorizationRequest {
  requireOnlyKeys(body, ['claimToken', 'attempt', 'rawAudioSha256', 'provider']);
  if (body.provider !== 'azure') throw new ValidationError('provider is invalid');
  return {
    ...parseClaimCredentials({ claimToken: body.claimToken, attempt: body.attempt }),
    rawAudioSha256: requiredString(body, 'rawAudioSha256'),
    provider: 'azure',
  };
}

function parseEgressInFlightRequest(body: JsonObject): EgressInFlightRequest {
  requireOnlyKeys(body, ['egressAuthorizationId', 'claimToken', 'attempt']);
  return {
    ...parseClaimCredentials({ claimToken: body.claimToken, attempt: body.attempt }),
    egressAuthorizationId: requiredString(body, 'egressAuthorizationId'),
  };
}

/**
 * claim 시점의 route·engine·오디오 전달 방식. 서명된 install manifest 가 유일한 근거다.
 * 승인 registry 에 없는 STT 는 engine `null` 이고, 그러면 오디오 작업은 claim 되지 않는다(D77).
 */

function parseSttReadinessReport(body: JsonObject) {
  if (!isSttReadinessReport(body)) throw new ValidationError('STT readiness report is invalid');
  return body;
}

function parseConsentEventInput(body: JsonObject): AppendConsentEventInput {
  requireOnlyKeys(body, [
    'domain', 'decision', 'provider', 'providerLegalRecipient', 'providerCountry', 'purpose',
    'retentionDuration', 'copyVersion', 'copyHash', 'disclosureSnapshotId', 'effectiveAt',
    'idempotencyKey', 'correctionOfEventId', 'expectedRevision',
  ]);
  const domain = requiredString(body, 'domain');
  if (!CONSENT_DOMAINS.includes(domain as AppendConsentEventInput['domain'])) {
    throw new ValidationError('consent domain is invalid');
  }
  const decision = requiredString(body, 'decision');
  if (!(['grant', 'withdraw', 'decline', 'correct'] as ConsentDecision[]).includes(decision as ConsentDecision)) {
    throw new ValidationError('consent decision is invalid');
  }
  const provider = optionalNullableString(body, 'provider') ?? null;
  if (
    provider !== null
    && !(['institution', 'institution_recording', 'institution_private_storage', 'azure', 'openai'] as ProviderId[]).includes(provider as ProviderId)
  ) throw new ValidationError('consent provider is invalid');
  const purpose = optionalNullableString(body, 'purpose') ?? null;
  if (
    purpose !== null
    && !([
      'case_management', 'sensitive_case_management', 'counseling_recording',
      'speech_to_text', 'ai_briefing', 'voice_original_retention',
    ] as PurposeLiteral[]).includes(purpose as PurposeLiteral)
  ) throw new ValidationError('consent purpose is invalid');
  const retentionDuration = optionalNullableString(body, 'retentionDuration') ?? null;
  if (retentionDuration !== null && retentionDuration !== 'default_temporary_d85') {
    throw new ValidationError('consent retention duration is invalid');
  }
  const expectedRevisionValue = body.expectedRevision;
  if (
    expectedRevisionValue !== null
    && (!Number.isInteger(expectedRevisionValue) || (expectedRevisionValue as number) < 0)
  ) throw new ValidationError('expected consent revision is invalid');
  return {
    domain: domain as AppendConsentEventInput['domain'],
    decision: decision as ConsentDecision,
    provider: provider as ProviderId | null,
    providerLegalRecipient: optionalNullableString(body, 'providerLegalRecipient') ?? null,
    providerCountry: optionalNullableString(body, 'providerCountry') ?? null,
    purpose: purpose as PurposeLiteral | null,
    retentionDuration: retentionDuration as RetentionDuration | null,
    copyVersion: requiredString(body, 'copyVersion'),
    copyHash: requiredString(body, 'copyHash'),
    disclosureSnapshotId: requiredString(body, 'disclosureSnapshotId'),
    effectiveAt: requiredCanonicalUtc(body, 'effectiveAt'),
    idempotencyKey: requiredString(body, 'idempotencyKey'),
    correctionOfEventId: optionalNullableString(body, 'correctionOfEventId') ?? null,
    expectedRevision: expectedRevisionValue as number | null,
  };
}
async function resolveAgentRuntime(env: ApiEnv): Promise<AgentRuntime> {
  const manifest = await verifiedInstallManifest(env);
  const requested = env.CCC_STT_MODE === 'local' || env.CCC_STT_MODE === 'azure' ? env.CCC_STT_MODE : 'off';
  const requestedId = requested === 'local' ? 'qwen3-asr'
    : requested === 'azure' ? 'azure-speech-koreacentral' : null;
  const approved = requestedId !== null && manifest.approvedSttEngineIds.some(
    (entry) => entry.id === requestedId && entry.mode === requested,
  );
  return {
    route: routeForMode(manifest.mode),
    sttEngine: requested === 'off' || !approved ? null : requested,
    sttEngineId: approved ? requestedId : null,
    audioDelivery: manifest.mode === 'community-cloud' ? 'protected-get' : 'api-stream',
  };
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
  // D71: 대조 항목은 읽기 전용이고 승인 자체가 전체 확인을 뜻한다. 화자 확인만 별도 확언한다.
  requireOnlyKeys(body, ['expectedVersion', 'decision', 'speakerMappingConfirmed']);
  const decisionValue = requiredString(body, 'decision');
  if (decisionValue !== 'approved' && decisionValue !== 'rejected') {
    throw new ValidationError('decision is invalid');
  }
  const decision: 'approved' | 'rejected' = decisionValue === 'approved' ? 'approved' : 'rejected';
  const review: AiDraftReviewInput = {
    expectedVersion: requiredDraftVersion(body.expectedVersion),
    decision,
  };
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
    claims: draft.claims,
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
        const { adapter, config } = (await resolveAiProviderAdapter(env));
        model = config.model;
        if (adapter.detectDiscrepancies === undefined) {
          outcome = 'skipped_unsupported';
          return;
        }
        await authorizeSessionTextAiEgress(env, actor, sessionId);
        rawOutput = await adapter.detectDiscrepancies(providerRequest);
      }
    } else {
      const { adapter, config } = (await resolveAiProviderAdapter(env));
      model = config.model;
      if (adapter.detectDiscrepancies === undefined) {
        outcome = 'skipped_unsupported';
        return;
      }
      await authorizeSessionTextAiEgress(env, actor, sessionId);
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
      const historicalContext = await loadCounselingMemoryContext(env, actor, sessionId);
      const generationRequest = historicalContext === null
        ? providerRequest
        : validateAiProviderRequest({ ...providerRequest, historicalContext });
      const rawOutput = env.AI_PROVIDER_ADAPTER === undefined
        ? generatePreviewFixtureAiDraft(generationRequest)
        : await (await resolveAiProviderAdapter(env)).adapter.generate(generationRequest);
      const output = validateAiProviderOutput(rawOutput, generationRequest);
      const draft = await createFixtureGeneratedAiDraftForService(env, actor, sessionId, {
        origin: 'fixture_generated',
        creationMode: 'fixture_generated',
        summaryText: validateAiDraftSummary(output.claims.map((claim) => claim.text).join('\n')),
        claims: output.claims.map((claim) => ({
          claimKey: claim.claimKey,
          section: claim.section,
          text: claim.text,
        })),
        flagSuggestions: output.flagSuggestions.map((suggestion) => ({
          flagType: suggestion.type,
          sourceRef: suggestion.sourceRef,
          quote: suggestion.quote,
        })),
        oneLiner: output.oneLiner,
        sourceSnapshotId: sourceSnapshot.id,
        sourceSnapshotHash: sourceSnapshot.sha256,
        promptVersion: AI_DRAFT_PROMPT_VERSION,
        schemaVersion: AI_DRAFT_SCHEMA_VERSION,
        questions: output.questions.map((question) => ({ title: question.title, reason: question.reason })),
        evidence: providerEvidenceLinks(output),
        materials: materialRefs,
        ...(historicalContext === null ? {} : {
          memoryContext: {
            supportCaseId: historicalContext.supportCaseId,
            revision: historicalContext.revision,
            materialSnapshotIds: historicalContext.materials.map((material) => material.snapshotId),
          },
        }),
        contrast: draftContrastAxes(output, providerRequest.contrastAxes),
      });
      outcome = 'stored';
      return draft;
    }

    // 주입형 testOnly adapter는 기존 테스트 seam이다. Preview 전용 내장 fixture 선택과
    // 구분하며, 실제 provider와 같은 활성 설정·동의·스냅샷 검증을 그대로 거친다.
    const { adapter, config } = (await resolveAiProviderAdapter(env));
    model = config.model;
    const runtimeConfigHash = await canonicalAiProviderConfigHash(config);

    // Check the active provider, then reload verified historical context at the outbound boundary.
    const activeProvider = await getActiveAiProviderRuntimeMetadataForService(env, actor, sessionId);
    if (
      activeProvider.adapterId !== adapter.providerId
      || activeProvider.adapterVersion !== adapter.adapterVersion
      || activeProvider.configHash !== runtimeConfigHash
    ) {
      throw new AiProviderUnavailableError();
    }

    const historicalContext = await loadCounselingMemoryContext(env, actor, sessionId);
    const generationRequest = historicalContext === null
      ? providerRequest
      : validateAiProviderRequest({ ...providerRequest, historicalContext });
    await authorizeSessionTextAiEgress(env, actor, sessionId);
    const output = validateAiProviderOutput(await adapter.generate(generationRequest), generationRequest);
    const draft = await createGeneratedAiDraftForService(env, actor, sessionId, {
      summaryText: validateAiDraftSummary(output.claims.map((claim) => claim.text).join('\n')),
      claims: output.claims.map((claim) => ({
        claimKey: claim.claimKey,
        section: claim.section,
        text: claim.text,
      })),
      flagSuggestions: output.flagSuggestions.map((suggestion) => ({
        flagType: suggestion.type,
        sourceRef: suggestion.sourceRef,
        quote: suggestion.quote,
      })),
      oneLiner: output.oneLiner,
      sourceSnapshotId: sourceSnapshot.id,
      sourceSnapshotHash: sourceSnapshot.sha256,
      providerConfigId: activeProvider.providerConfigId,
      consentEvidenceId: activeProvider.consentEvidenceId,
      consentRevision: activeProvider.consentRevision,
      consentReceipt: activeProvider.consentReceipt,
      modelId: config.model,
      promptVersion: AI_DRAFT_PROMPT_VERSION,
      schemaVersion: AI_DRAFT_SCHEMA_VERSION,
      questions: output.questions.map((question) => ({ title: question.title, reason: question.reason })),
      evidence: providerEvidenceLinks(output),
      materials: materialRefs,
      ...(historicalContext === null ? {} : {
        memoryContext: {
          supportCaseId: historicalContext.supportCaseId,
          revision: historicalContext.revision,
          materialSnapshotIds: historicalContext.materials.map((material) => material.snapshotId),
        },
      }),
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
 * 확인한 뒤 AudioStore 포트로 콘텐츠를 스트리밍한다. 등록 시점에는 registerRecording이
 * 같은 상태를 원자적으로 다시 확인한다. 등록이 실패하면 방금 올린 객체를 정리한다.
 */
async function handleAudioUpload(
  request: Request,
  env: ApiEnv,
  actor: Actor,
  sessionId: string,
): Promise<Response> {
  if (env.audioStore === null) return json({ error: 'service_unavailable' }, 503);
  const runtime = await resolveAgentRuntime(env);
  if (runtime.audioDelivery === 'protected-get') {
    throw new ValidationError('community cloud upload requires an upload target');
  }
  const admission = await admitRecordingUpload(env, actor, sessionId, runtime);
  const contentType = normalizeAudioContentType(request.headers.get('content-type'));
  if (contentType === null) throw new ValidationError('audio content type is not allowed');
  const declaredLengthHeader = request.headers.get('content-length');
  const contentLength = declaredLengthHeader === null ? Number.NaN : Number(declaredLengthHeader);
  if (!Number.isInteger(contentLength) || contentLength < 1 || contentLength > 209_715_200) {
    throw new ValidationError('audio content length is required');
  }
  if (request.body === null) throw new ValidationError('audio body must not be empty');
  const clientAssertedSha256 = request.headers.get('x-ccc-audio-sha256');
  if (clientAssertedSha256 !== null && !/^[0-9a-f]{64}$/.test(clientAssertedSha256)) {
    throw new ValidationError('client audio hash is invalid');
  }
  const uploadExpiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const intent = await beginRecordingUploadIntent(
    env,
    actor,
    sessionId,
    admission,
    'api-stream',
    {
      contentLength,
      contentType,
      clientAssertedSha256,
      storageSha256: null,
      uploadExpiresAt,
    },
  );
  let putFinished = false;
  try {
    await authorizeRecordingUploadStream(env, actor, sessionId, intent.audioObjectId, admission);
    const stored = await env.audioStore.put(intent.key, request.body, {
      contentLength, contentType, expiresAt: uploadExpiresAt,
    } satisfies AudioObjectMetadata);
    putFinished = true;
    await completeRecordingUploadStorageWrite(
      env, actor, sessionId, intent.audioObjectId, stored.generationId, stored.sha256,
    );
    return json(sessionResponse(await registerRecording(env, actor, sessionId, intent.key, admission, {
      contentLength,
      contentType,
      clientAssertedSha256,
      storageSha256: stored.sha256,
      generationId: stored.generationId,
      uploadExpiresAt,
    }, intent.audioObjectId)));
  } catch (error) {
    if (!putFinished) {
      await failRecordingUploadStorageWrite(env, actor, sessionId, intent.audioObjectId);
    }
    await abandonRecordingUpload(env, actor, intent.audioObjectId, 'rejected_upload');
    await reconcileAudioObjectDeletion(env, env.audioStore, intent.audioObjectId);
    throw error;
  }
}

async function handleAudioUploadTarget(
  request: Request,
  env: ApiEnv,
  actor: Actor,
  sessionId: string,
): Promise<Response> {
  if (env.audioStore === null) throw new CapabilitiesUnavailableError('audio storage unavailable');
  const runtime = await resolveAgentRuntime(env);
  if (runtime.audioDelivery !== 'protected-get') throw new ValidationError('upload targets are cloud-only');
  const body = await requestBody(request);
  requireOnlyKeys(body, ['contentLength', 'contentType', 'clientAssertedSha256']);
  const contentLength = requiredInteger(body, 'contentLength');
  const contentType = normalizeAudioContentType(requiredString(body, 'contentType'));
  if (contentType === null || contentLength < 1 || contentLength > 209_715_200) {
    throw new ValidationError('audio metadata is invalid');
  }
  const clientAssertedSha256 = optionalNullableString(body, 'clientAssertedSha256') ?? null;
  if (clientAssertedSha256 !== null && !/^[0-9a-f]{64}$/.test(clientAssertedSha256)) {
    throw new ValidationError('client audio hash is invalid');
  }
  const admission = await admitRecordingUpload(env, actor, sessionId, runtime);
  const uploadExpiresAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  const intent = await beginRecordingUploadIntent(
    env, actor, sessionId, admission, 'protected-get',
    { contentLength, contentType, clientAssertedSha256, storageSha256: null, uploadExpiresAt },
  );
  let target: { url: string; expiresAt: string } | null;
  let ceiling: number;
  try {
    target = await env.audioStore.createUploadTarget(intent.key, {
      contentLength, contentType, expiresAt: uploadExpiresAt,
    }, { kind: 'upload', audioObjectId: intent.audioObjectId });
    // S8 §2.2 (2026-09-11 개정): the online upload decision moves `upload_expires_at` forward, so
    // the minted target is compared against the ceiling that is durable now, not against the value
    // this request asked for. Both sides are canonical UTC ISO instants; parse anyway so a
    // non-canonical provider string fails closed instead of comparing as a smaller string.
    ceiling = Date.parse(
      (await getPendingRecordingUpload(env, actor, sessionId, intent.audioObjectId)).uploadExpiresAt,
    );
  } catch (error) {
    await abandonRecordingUpload(env, actor, intent.audioObjectId, 'upload_abandoned');
    await reconcileAudioObjectDeletion(env, env.audioStore, intent.audioObjectId);
    throw error;
  }
  const mintedExpiresAt = target === null ? Number.NaN : Date.parse(target.expiresAt);
  if (
    target === null
    || !Number.isFinite(mintedExpiresAt)
    || !Number.isFinite(ceiling)
    || mintedExpiresAt > ceiling
  ) {
    await abandonRecordingUpload(env, actor, intent.audioObjectId, 'upload_abandoned');
    await reconcileAudioObjectDeletion(env, env.audioStore, intent.audioObjectId);
    throw new CapabilitiesUnavailableError('audio upload target unavailable');
  }
  try {
    await authorizeRecordingUploadTarget(env, actor, sessionId, intent.audioObjectId, admission);
  } catch (error) {
    await abandonRecordingUpload(env, actor, intent.audioObjectId, 'consent_withdrawal');
    await reconcileAudioObjectDeletion(env, env.audioStore, intent.audioObjectId);
    throw error;
  }
  return json({ audioObjectId: intent.audioObjectId, url: target.url, expiresAt: target.expiresAt }, 201, {
    'cache-control': 'no-store',
  });
}

async function handleAudioUploadCompletion(
  env: ApiEnv,
  actor: Actor,
  sessionId: string,
  audioObjectId: string,
): Promise<Response> {
  if (env.audioStore === null) throw new CapabilitiesUnavailableError('audio storage unavailable');
  const runtime = await resolveAgentRuntime(env);
  if (runtime.audioDelivery !== 'protected-get') throw new ValidationError('upload targets are cloud-only');
  const admission = await admitRecordingUpload(env, actor, sessionId, runtime);
  const pending = await getPendingRecordingUpload(env, actor, sessionId, audioObjectId);
  const object = await env.audioStore.get(pending.key, { kind: 'upload', audioObjectId });
  if (
    object === null || object.contentLength !== pending.contentLength
    || object.contentType !== pending.contentType
  ) {
    await abandonRecordingUpload(env, actor, audioObjectId, 'rejected_upload');
    await reconcileAudioObjectDeletion(env, env.audioStore, audioObjectId);
    throw new ConflictError('uploaded audio metadata does not match');
  }
  try {
    return json(sessionResponse(await registerRecording(env, actor, sessionId, pending.key, admission, {
      contentLength: pending.contentLength,
      contentType: pending.contentType,
      clientAssertedSha256: pending.clientAssertedSha256,
      storageSha256: object.sha256,
      generationId: object.generationId,
      uploadExpiresAt: pending.uploadExpiresAt,
    }, audioObjectId)));
  } catch (error) {
    await abandonRecordingUpload(env, actor, audioObjectId, 'consent_withdrawal');
    await reconcileAudioObjectDeletion(env, env.audioStore, audioObjectId);
    throw error;
  }
}

function errorResponse(error: unknown): Response {
  if (error instanceof ActorAuthenticationError) return json({ error: 'actor_authentication_required' }, 401);
  if (error instanceof MfaRequiredError) return json({ error: 'mfa_required' }, 403);
  // S5 §2.6 고정 형태. 원문·PII·시크릿을 싣지 않는다.
  if (error instanceof AgentJobContractError) {
    return json(
      { error: error.code, jobId: error.jobId, retryable: error.retryable },
      jobErrorHttpStatus(error.code),
    );
  }
  if (error instanceof ConsentContractError) return json({ error: error.code }, error.statusCode);
  if (error instanceof IdentityStoreUnavailableError) return json({ error: 'service_unavailable' }, 503);
  if (error instanceof ForbiddenError) return json({ error: 'forbidden' }, 403);
  if (error instanceof ConflictError) return json({ error: 'conflict' }, 409);
  if (error instanceof ProgramAdmissionRequiredError) {
    return json({ error: error.code, reason: error.reason } satisfies ProgramAdmissionDeniedResponse, error.statusCode);
  }
  if (error instanceof PilotTextAiConsentRequiredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof TextAiPilotDisabledError) return json({ error: error.code }, error.statusCode);
  if (error instanceof PiiPurgeDisabledError) return json({ error: error.code }, error.statusCode);
  if (error instanceof StaleDraftVersionError) return json({ error: error.code }, error.statusCode);
  if (error instanceof DraftVersionRequiredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof GroundedEvidenceRequiredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof FixtureDraftApprovalForbiddenError) return json({ error: error.code }, error.statusCode);
  // 녹음 회차 승인 전 화자 확인 미충족은 화면이 원인을 안내한다.
  if (error instanceof SpeakerConfirmationRequiredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof AiProviderNotConfiguredError) return json({ error: error.code }, error.statusCode);
  // G1: ① 미동의·긴급 사유 누락은 'invalid_request' 로 뭉치지 않는다 — 화면이 "동의를
  // 체크하거나 긴급 등록을 고르라"고 안내하려면 원인이 코드로 구분돼야 한다(게이트 문서 §2 G1).
  if (error instanceof PrivacyConsentRequiredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof EmergencyReasonRequiredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof EmotionDeferredError) return json({ error: error.code }, error.statusCode);
  if (error instanceof AiProviderInputError) return json({ error: 'invalid_request' }, 400);
  if (error instanceof AiProviderProhibitedOutputError) return json({ error: 'ai_prohibited_output' }, 422);
  if (error instanceof AiProviderUnavailableError) return json({ error: 'ai_provider_unavailable' }, 503);
  if (error instanceof ValidationError) return json({ error: 'invalid_request' }, 400);
  if (error instanceof NotApprovedError) return json({ error: 'approval_required' }, 409);
  // 설치 manifest 부재·검증 실패는 fail closed. 원인은 응답에 싣지 않는다(S2 §2.7).
  if (error instanceof CapabilitiesUnavailableError) return json({ error: 'service_unavailable' }, 503);
  return json({ error: 'internal_error' }, 500);
}

export type ActorResolver = (request: Request, env: ApiEnv) => Promise<Actor | IdentityActor>;

export async function handleRequest(
  request: Request,
  env: ApiEnv,
  resolveActor: ActorResolver,
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
      || (request.method === 'GET' && pubParts.length === 5 && pubParts[0] === 'invites' && pubParts[1] === 'participant'
        && pubParts[3] === 'consent' && pubParts[4] === 'disclosures')
      || (request.method === 'POST' && pubParts.length === 2 && pubParts[0] === 'signup' && pubParts[1] === 'participant');
    // D86 실무자 초대 공개 경로는 당사자 공개 가입 스위치와 무관하다. 토큰이 자격이고 실패는 전부 404다.
    const staffInviteTokenPath = pubParts.length >= 3 && pubParts[0] === 'staff-invites' && pubParts[1] === 'token';
    // D86: 익명 실무자 초대 가입 경로(worker)는 폐기됐다. 인증 전에 404로 닫아 토큰 유효성을 새지 않는다.
    if (pubParts[0] === 'invites' && pubParts[1] === 'worker') return json({ error: 'not_found' }, 404);
    // ── 기능 스위치(CCC-112 · P0-2): 공개 가입 표면은 PUBLIC_SIGNUP_ENABLED 가 정확히
    // D86: 자기 확인 페이지는 폐기됐다. 토큰 유효성을 새지 않게 인증 전에 404로 닫는다.
    if (request.method === 'GET' && pubParts.length === 4 && pubParts[0] === 'invites' && pubParts[1] === 'participant' && pubParts[3] === 'me') {
      return json({ error: 'not_found' }, 404);
    }
    // '1' 일 때만 열린다. 없거나 다른 값이면 404 — 미지의 경로와 응답을 구분 불가하게
    // 둔다(fail closed, EXTERNAL_AI_CALLS_ENABLED 와 같은 규약). 미리보기 코드 게이트보다
    // **앞**이다: 스위치가 닫힌 배포에서는 코드가 있어도 이 표면이 존재하지 않는다.
    // D86 실무자 초대 공개 경로는 이 스위치 밖이지만 미리보기 코드 게이트는 같이 받는다.
    const publicSignupEnabled = env.PUBLIC_SIGNUP_ENABLED === '1';
    if (publicSignupPath && !publicSignupEnabled) return json({ error: 'not_found' }, 404);
    if (env.installationMode === undefined && env.CCC_INSTALL_MANIFEST !== undefined) {
      const installation = await verifiedInstallManifest(env);
      env = { ...env, installationMode: installation.mode };
    }
    if ((publicSignupPath || staffInviteTokenPath) && previewModeEnabled(env)) await resolveActor(request, env);
    if (request.method === 'GET' && pubParts.length === 3 && pubParts[0] === 'invites' && pubParts[1] === 'participant') {
      // D86 요청 링크 조회. GET은 소비하지 않고, 무효·만료는 404로 뭉친다.
      requestQuery(url, []);
      try {
        return json(await getParticipantRequestLinkInfo(env, pubParts[2] ?? ''), 200, { 'cache-control': 'no-store' });
      } catch (e) {
        if (e instanceof ForbiddenError) return json({ error: 'not_found' }, 404);
        throw e;
      }
    }
    if (request.method === 'GET' && pubParts.length === 5 && pubParts[0] === 'invites' && pubParts[1] === 'participant'
      && pubParts[3] === 'consent' && pubParts[4] === 'disclosures') {
      requestQuery(url, []);
      try {
        return json({ disclosures: await issueParticipantRequestLinkDisclosures(env, pubParts[2] ?? '') },
          200, { 'cache-control': 'no-store' });
      } catch (e) {
        if (e instanceof ForbiddenError) return json({ error: 'not_found' }, 404);
        throw e;
      }
    }
    if (request.method === 'POST' && pubParts.length === 2 && pubParts[0] === 'signup' && pubParts[1] === 'participant') {
      requestQuery(url, []);
      const body = await requestBody(request);
      requireOnlyKeys(body, ['token', 'name', 'phone', 'email', 'consentEvents']);
      const phone = optionalString(body, 'phone');
      const email = optionalString(body, 'email');
      try {
        return json(await completeParticipantSignup(env, {
          token: requiredString(body, 'token'),
          name: requiredString(body, 'name'),
          consentEvents: parseInitialConsentEvents(body.consentEvents),
          ...(phone === undefined ? {} : { phone }),
          ...(email === undefined ? {} : { email }),
        }), 201);
      } catch (e) {
        if (e instanceof ForbiddenError) return json({ error: 'not_found' }, 404);
        throw e;
      }
    }
    if (staffInviteTokenPath && request.method === 'GET' && pubParts.length === 3) {
      requestQuery(url, []);
      try {
        return json(await getStaffInvitePublicInfo(env, pubParts[2] ?? ''), 200, { 'cache-control': 'no-store' });
      } catch (e) {
        if (e instanceof ForbiddenError) return json({ error: 'not_found' }, 404);
        throw e;
      }
    }
    if (staffInviteTokenPath && request.method === 'POST' && pubParts.length === 4 && pubParts[3] === 'accept') {
      requestQuery(url, []);
      const body = await requestBody(request);
      requireOnlyKeys(body, ['name', 'email']);
      try {
        return json(await acceptStaffInvite(env, {
          token: pubParts[2] ?? '', name: requiredString(body, 'name'), email: requiredString(body, 'email'),
        }), 201);
      } catch (e) {
        if (e instanceof ForbiddenError) return json({ error: 'not_found' }, 404);
        throw e;
      }
    }
    // ── E6-4 Agent 자격 교환: 제시한 code·refresh 자체가 자격이라 신원 해석 앞에 온다.
    // 사람 신원이 없는 요청이므로 Actor 로 투영하지 않고, 실패는 모두 401 이다.
    if (request.method === 'POST' && pubParts.length === 2 && pubParts[0] === 'agents'
      && (pubParts[1] === 'pair' || pubParts[1] === 'token')) {
      requestQuery(url, []);
      const body = await requestBody(request);
      if (pubParts[1] === 'pair') {
        requireOnlyKeys(body, ['pairingCode']);
        return json(await redeemAgentPairingCode(env, body.pairingCode), 201, { 'cache-control': 'no-store' });
      }
      requireOnlyKeys(body, ['refreshToken']);
      return json(await rotateAgentRefreshCredential(env, body.refreshToken), 201, { 'cache-control': 'no-store' });
    }
    const resolvedActor = await resolveActor(request, env);
    const parts = url.pathname.split('/').filter((part) => part.length > 0);
    // S2 §2.6: system Actor 는 내부 두 경로에서만 받는다. 업무 route 는 신원을 사람 역할로
    // 투영하기 전에 여기서 끊는다 — /me·/capabilities 처럼 투영을 건너뛰는 route 도 포함이다.
    if ('kind' in resolvedActor && resolvedActor.kind === 'system'
      && url.pathname !== '/internal/storage/authorize' && url.pathname !== '/internal/scheduler/run') {
      return json({ error: 'forbidden' }, 403);
    }
    if (url.pathname === '/internal/scheduler/run') {
      // S11 §2.8 cron tick. 자격은 공유 비밀 하나이고, 무엇을 돌릴지는 서버 시각이 정한다.
      if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
      if (request.headers.has('origin')) return json({ error: 'forbidden' }, 403);
      requestQuery(url, []);
      if (!('kind' in resolvedActor) || resolvedActor.kind !== 'system'
        || resolvedActor.authn.source !== 'scheduler-secret'
        || !resolvedActor.scopes.includes('scheduler:run')) return json({ error: 'forbidden' }, 403);
      const text = (await request.text()).trim();
      if (text.length > 0) {
        let body: unknown;
        try { body = JSON.parse(text); } catch { throw new ValidationError('request body must be valid JSON'); }
        requireOnlyKeys(asObject(body), []);
      }
      const audioStore = env.audioStore;
      if (audioStore === null) return json({ error: 'service_unavailable' }, 503);
      const ranAt = new Date().toISOString();
      const runtimeEnv = env;
      const runner = createScheduledJobRunner({ ...runtimeEnv, audioStore }, () => runCounselingMemory(runtimeEnv));
      const jobs: JobReport[] = [];
      for (const kind of dueScheduledJobKinds(ranAt)) jobs.push(await runner.run(kind, ranAt));
      return json({ ranAt, jobs }, 200, { 'cache-control': 'no-store' });
    }
    if (url.pathname === '/internal/storage/authorize') {
      if (request.method !== 'POST') return json({ error: 'not_found' }, 404);
      if (request.headers.has('origin')) return json({ error: 'forbidden' }, 403);
      const authorization = request.headers.get('authorization');
      if (authorization === null || !/^Bearer [^\s,]+$/.test(authorization)) {
        throw new ActorAuthenticationError();
      }
      requestQuery(url, []);
      const installation = await verifiedInstallManifest(env);
      if (installation.mode !== 'community-cloud' || !('kind' in resolvedActor)) {
        return json({ error: 'forbidden' }, 403);
      }
      const body = await storageAuthorizationBody(request);
      try {
        return json(
          await authorizeStorageSignerOperation(env, resolvedActor, body),
          200,
          { 'cache-control': 'no-store', 'x-ccc-installation-id': installation.installationId },
        );
      } catch (error) {
        if (
          error instanceof ForbiddenError
          || error instanceof ConflictError
          || error instanceof ProgramAdmissionRequiredError
          || error instanceof ConsentContractError
          || error instanceof AgentJobContractError
        ) return json({ error: 'forbidden' }, 403);
        throw error;
      }
    }
    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'auth' && parts[1] === 'logout') {
      requestQuery(url, []);
      requireOnlyKeys(await requestBody(request), []);
      if (!('kind' in resolvedActor) || resolvedActor.kind !== 'human' || resolvedActor.authn.sessionId === null) {
        throw new ForbiddenError('session logout requires a verified human session');
      }
      try {
        await revokeIdentitySession(env, resolvedActor.authn.sessionId, 'logout');
      } catch {
        throw new IdentityStoreUnavailableError();
      }
      return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
    }
    if (request.method === 'GET' && parts.length === 1 && parts[0] === 'capabilities') {
      // 배포 capability(S2 §2.8, E1-7). 사람 역할만, Agent 는 403. 응답은 캐시하지 않고
      // 설치 ID 헤더를 실어 client 가 signed manifest 와 byte-equal 비교한다.
      requestQuery(url, []);
      const { manifest, installationId } = await buildCapabilities(env, resolvedActor);
      return json(manifest, 200, { 'cache-control': 'no-store', 'x-ccc-installation-id': installationId });
    }
    if (request.method === 'GET' && parts.length === 1 && parts[0] === 'me') {
      // 로그인한 본인의 신원(이메일·역할) — 설정 화면 '내 계정'. 역할 무관, 자기 기관 자기 행만.
      requestQuery(url, []);
      const me = await getMyIdentity(env, resolvedActor);
      // lastProgramType: `/` 직행 목적지 (D35 · ADR-0014 '개정' 2번). 미선택이면 null 이고
      // 화면이 첫 사업으로 폴백한다.
      const lastProgramType = await getLastProgramType(env, resolvedActor);
      // roles: D74 역할 합(ADR-0038). 어드민 탭 필터(ADR-0044 결정 7)가 읽는다. legacy `role` 은 유지.
      const roles = await listMyRoles(env, resolvedActor);
      const institution = await getInstitutionReadiness(env, resolvedActor);
      return json({
        id: me.id, orgId: me.orgId, email: me.email, role: me.role, active: me.active, name: me.name,
        lastProgramType, roles, institution,
      } satisfies MeResponse);
    }
    if (parts[0] === 'settings' && parts[1] === 'accounts') {
      // Preserve technical-only identities here. Authorization still reads canonical grants; the stored role is audit metadata.
      const account = await getMyIdentity(env, resolvedActor);
      const actor = { userId: account.id, orgId: account.orgId, role: account.role };
      if (request.method === 'GET' && parts.length === 2) {
        const query = requestQuery(url, ['cursor']);
        return json(await listDirectoryAccounts(env, actor, query.get('cursor') ?? undefined));
      }
      requestQuery(url, []);
      if (parts.length === 4 && parts[2] !== undefined) {
        let userId: string;
        try { userId = decodeURIComponent(parts[2]); }
        catch { throw new ValidationError('account id is invalid'); }
        if (request.method === 'PATCH' && parts[3] === 'roles') {
          const body = await requestBody(request);
          requireOnlyKeys(body, ['roles', 'expectedRoles']);
          return json(await updateDirectoryRoles(env, actor, userId, {
            roles: requestDirectoryRoles(body, 'roles'), expectedRoles: requestDirectoryRoles(body, 'expectedRoles'),
          }));
        }
        if (request.method === 'POST' && parts[3] === 'deactivate') {
          const body = await requestBody(request);
          requireOnlyKeys(body, ['reason']);
          return json(await deactivateDirectoryAccount(env, actor, userId, requiredString(body, 'reason')));
        }
      }
    }
    const actor = 'kind' in resolvedActor ? gatewayActorFromIdentity(resolvedActor) : resolvedActor;
    const installationPolicy = await getInstalledAiPolicy(env, actor);
    env = { ...env, CCC_STT_MODE: installationPolicy.sttMode, CCC_LLM_MODE: installationPolicy.llmMode };
    if (parts.length === 1 && parts[0] === 'program-options' && request.method === 'GET') {
      requestQuery(url, []);
      return json({ programs: await listProgramOptions(env, actor) } satisfies ProgramOptionsResponse);
    }
    if (parts.length === 1 && parts[0] === 'programs') {
      requestQuery(url, []);
      if (request.method === 'GET') return json(await listPrograms(env, actor));
      if (request.method === 'POST') {
        const body = await requestBody(request);
        requireOnlyKeys(body, ['displayName', 'storageMode', 'processingMode', 'confirmation', 'staff']);
        const program = await createProgram(env, actor, {
          displayName: requiredString(body, 'displayName'), ...parseProgramChoices(body),
        });
        return json({ program } satisfies ProgramMutationResponse, 201);
      }
    }
    if (parts.length === 2 && parts[0] === 'programs' && request.method === 'PATCH') {
      requestQuery(url, []);
      const body = await requestBody(request);
      requireOnlyKeys(body, ['expectedVersion', 'displayName', 'storageMode', 'processingMode', 'confirmation', 'status', 'staff']);
      const displayName = optionalString(body, 'displayName');
      const input: UpdateProgramInput = {
        expectedVersion: requiredExpectedVersion(body, 'expectedVersion'),
        ...(displayName === undefined ? {} : { displayName }), ...parseProgramChoices(body),
      };
      const status = optionalString(body, 'status');
      if (status !== undefined) {
        if (status !== 'active' && status !== 'closed') throw new ValidationError('program status is invalid');
        input.status = status;
      }
      const program = await updateProgram(env, actor, decodedProgramId(parts[1]!), input);
      return json({ program } satisfies ProgramMutationResponse);
    }
    if (request.method === 'GET' && parts.length === 1 && parts[0] === 'audit-log') {
      const query = requestQuery(url, ['limit', 'cursor', 'actorId', 'from', 'to', 'supportCaseId']);
      return json(await listAuditLog(env, actor, parseAuditLogQuery(query)));
    }
    if (request.method === 'POST' && parts.length === 1 && parts[0] === 'schedules') {
      // 상담 등록(#20): 담당 케이스 한정·감사는 createCounselingSchedule(R1 관문) 내장.
      requestQuery(url, []);
      return json(
        scheduleResponse(await createCounselingSchedule(env, actor, parseScheduleCreation(await requestBody(request)))),
        201,
      );
    }
    if (parts.length === 2 && parts[0] === 'settings' && parts[1] === 'counseling-memory') {
      requestQuery(url, []);
      if (request.method === 'GET') {
        return json(await getCounselingMemorySettings(env, actor), 200, { 'cache-control': 'no-store' });
      }
      if (request.method === 'PUT') {
        const body = await requestBody(request);
        requireOnlyKeys(body, ['enabled', 'expectedVersion']);
        return json(await setCounselingMemorySettings(env, actor, {
          enabled: requiredBoolean(body, 'enabled'),
          expectedVersion: requiredExpectedVersion(body, 'expectedVersion'),
        }), 200, { 'cache-control': 'no-store' });
      }
    }
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'organization' && parts[1] === 'profile') {
      // 기관·첫 사업 표시 이름 (CCC-32). 모든 화면의 셸(사이드바)이 읽으므로 역할 무관,
      // 값이 없으면 null — 화면이 labels.ts 하드코딩 라벨로 폴백한다. 감사 없음 근거는 게이트웨이 주석.
      requestQuery(url, []);
      return json(await getOrganizationProfile(env, actor));
    }
    if (request.method === 'PATCH' && parts.length === 2 && parts[0] === 'organization' && parts[1] === 'profile') {
      requestQuery(url, []);
      const body = await requestBody(request);
      if (typeof body.orgName !== 'string'
        || (body.expectedOrgName !== null && typeof body.expectedOrgName !== 'string')) {
        throw new ValidationError('organization profile payload is invalid');
      }
      return json(await updateOrganizationProfile(env, actor, { ...body, orgName: body.orgName, expectedOrgName: body.expectedOrgName }));
    }
    if (request.method === 'POST' && parts.length === 2 && parts[0] === 'organization' && parts[1] === 'onboarding') {
      // 관리자 온보딩 2단계 저장 (CCC-32 · 스펙 #78 US 1). admin 검사·감사는 게이트웨이 내장(R1).
      requestQuery(url, []);
      const body = await requestBody(request);
      requireOnlyKeys(body, ['orgName', 'programDisplayName']);
      const orgName = body.orgName;
      const programDisplayName = body.programDisplayName;
      if (typeof orgName !== 'string' || typeof programDisplayName !== 'string') {
        throw new ValidationError('organization onboarding payload is invalid');
      }
      return json(await completeOrganizationOnboarding(env, actor, { orgName, programDisplayName }));
    }
    if (request.method === 'PUT' && parts.length === 2 && parts[0] === 'me' && parts[1] === 'last-program') {
      // 마지막에 선택한 사업을 본인 계정에 기억시킨다. 본인 행만 쓰고 감사는 남기지 않는다
      // (근거: db/gateway.ts rememberLastProgramType · migrations/sqlite/0017 주석).
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
      // 발급도 공개 가입 표면의 일부다(CCC-112): 스위치가 닫힌 배포에서 아무도 못 쓰는
      // 링크를 만들 이유가 없으므로 같은 스위치로 404 한다.
      if (!publicSignupEnabled) return json({ error: 'not_found' }, 404);
      requestQuery(url, []);
      const body = await requestBody(request);
      requireOnlyKeys(body, ['programId']);
      return json(await createParticipantInvite(env, actor, { programId: requiredString(body, 'programId') }), 201);
    }
    if (parts[0] === 'staff-invites') {
      requestQuery(url, []);
      if (request.method === 'GET' && parts.length === 1) return json({ invites: await listStaffInvites(env, actor) });
      if (request.method === 'POST' && parts.length === 1) {
        const body = await requestBody(request);
        requireOnlyKeys(body, ['email', 'roles']);
        if (!Array.isArray(body.roles) || body.roles.some((role) => typeof role !== 'string')) {
          throw new ValidationError('invite roles are invalid');
        }
        return json(await createStaffInvite(env, actor, {
          email: requiredString(body, 'email'), roles: body.roles as Parameters<typeof createStaffInvite>[2]['roles'],
        }), 201);
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'revoke') {
        try {
          return json({ invite: await revokeStaffInvite(env, actor, decodeURIComponent(parts[1]!)) });
        } catch (e) {
          if (e instanceof ForbiddenError) return json({ error: 'not_found' }, 404);
          throw e;
        }
      }
    }
    if (request.method === 'GET' && parts.length === 4 && parts[0] === 'programs'
      && parts[2] === 'consent' && parts[3] === 'disclosures') {
      requestQuery(url, []);
      return json({ disclosures: await issueRegistrationConsentDisclosures(env, actor, decodedProgramId(parts[1]!)) },
        200, { 'cache-control': 'no-store' });
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
      && parts.length === 2
      && parts[0] === 'participants'
      && parts[1] === 'new-signup-count'
    ) {
      // CCC-26 사이드바 '참여자' 메뉴의 미확인 숫자 — 목록과 같은 범위·파생 규칙.
      // 'search' 와 같은 이유로 일반 당사자 상세 라우트보다 먼저 처리한다.
      requestQuery(url, []);
      return json({ count: await countNewSignups(env, actor) });
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
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'hub') {
        requestQuery(url, []);
        const programList = await listSupportCasesForBeneficiary(
          env,
          actor,
          beneficiaryId,
          { includeEmail: true, hub: true },
        );
        return json(participantHubResponse(beneficiaryId, programList));
      }
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
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'exports' && parts[1] === 'cases') {
      const query = requestQuery(url, ['cursor']);
      return json(await listSettingsSupportCaseOptions(env, actor, 'assigned', query.get('cursor') ?? undefined));
    }
    if (parts[0] === 'support-cases' && parts[1] !== undefined) {
      const supportCaseId = requireRouteUuid(parts[1], 'support case id');
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'report') {
        requestQuery(url, []);
        return json(await getSupportCaseReport(env, actor, supportCaseId), 200, { 'cache-control': 'no-store' });
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'export') {
        requestQuery(url, []);
        return json(await exportCase(env, actor, supportCaseId));
      }
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'export-history') {
        const query = requestQuery(url, ['limit', 'cursor']);
        return json(await listCaseExportHistory(env, actor, supportCaseId, parseExportHistoryQuery(query)));
      }
      if (parts.length === 4 && parts[2] === 'memory' && parts[3] === 'trial') {
        if (!memoryTrialEnabled(env)) return json({ error: 'not_found' }, 404);
        requestQuery(url, []);
        if (request.method === 'GET') {
          return json(await memoryTrialReadiness(env, actor, supportCaseId), 200, { 'cache-control': 'no-store' });
        }
        if (request.method === 'POST') {
          const body = await requestBody(request);
          requireOnlyKeys(body, ['confirmExternalAi']);
          if (body.confirmExternalAi !== true) throw new ValidationError('external_call_confirmation_required');
          const state = await memoryTrialReadiness(env, actor, supportCaseId);
          if (!state.ready) return json(state, 409, { 'cache-control': 'no-store' });
          const counters = await runCounselingMemoryTrial(env, actor, supportCaseId);
          return json({ ...await memoryTrialReadiness(env, actor, supportCaseId), counters },
            200, { 'cache-control': 'no-store' });
        }
      }
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'memory') {
        requestQuery(url, []);
        return json(await getCounselingMemory(env, actor, supportCaseId), 200, { 'cache-control': 'no-store' });
      }
      if (request.method === 'POST' && parts.length === 4 && parts[2] === 'memory' && parts[3] === 'corrections') {
        requestQuery(url, []);
        const body = await requestBody(request);
        requireOnlyKeys(body, ['itemId', 'expectedRevision', 'body']);
        return json(await correctCounselingMemory(env, actor, supportCaseId, {
          itemId: requiredUuid(body, 'itemId'),
          expectedRevision: requiredExpectedVersion(body, 'expectedRevision'),
          body: requiredString(body, 'body'),
        }), 200, { 'cache-control': 'no-store' });
      }
      // 케이스 종결(CCC-107) — 지원 기록을 닫고 보관 기간을 세기 시작한다. 담당 실무자 또는
      // admin(게이트웨이의 assertSupportCaseAccess 강제, R1). 사유는 필수. purge_due 는
      // 이 요청이 아니라 DB 트리거가 설정하고(D10), 파기 실행은 CCC-113 소관이다.
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'close') {
        requestQuery(url, []);
        const body = await requestBody(request);
        requireOnlyKeys(body, ['reason']);
        const closed = await closeSupportCase(env, actor, supportCaseId, requiredString(body, 'reason'));
        return json(closed);
      }
      // 종결 화면 조회(CCC-107): 종결 상태 + 금고 보관 시계(purge_due·purged_at) 읽기 전용.
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'closure') {
        requestQuery(url, []);
        return json(await getSupportCaseClosureInfo(env, actor, supportCaseId));
      }
      if (request.method === 'POST' && parts[2] === 'assignment-requests') {
        requestQuery(url, []);
        if (parts.length === 3) {
          const body = await requestBody(request);
          requireOnlyKeys(body, ['reason']);
          return json(supportCaseAssigneeResponse(await requestOwnSupportCaseAssignment(
            env, actor, supportCaseId, requiredString(body, 'reason'),
          )), 201);
        }
        if (parts.length === 5 && parts[4] === 'review') {
          const assignmentId = requireRouteUuid(parts[3] ?? '', 'assignment id');
          const body = await requestBody(request);
          const decision = requiredString(body, 'decision');
          requireOnlyKeys(body, decision === 'reject' ? ['decision', 'reason'] : ['decision']);
          if (decision !== 'coassign' && decision !== 'transfer' && decision !== 'reject') throw new ValidationError('assignment decision is invalid');
          return json(supportCaseAssigneeResponse(await reviewSupportCaseAssignmentRequest(
            env, actor, supportCaseId, assignmentId,
            decision === 'reject' ? { decision, reason: requiredString(body, 'reason') } : { decision },
          )));
        }
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'force-transfer') {
        requestQuery(url, []);
        const body = await requestBody(request);
        requireOnlyKeys(body, ['toUserId', 'reason', 'participantNotified']);
        const participantNotified = requiredBoolean(body, 'participantNotified');
        await forceTransferSupportCase(env, actor, {
          supportCaseId,
          toUserId: requiredString(body, 'toUserId'),
          reason: requiredString(body, 'reason'),
          ...(participantNotified ? { notifiedBy: actor.userId } : {}),
        });
        return json({ transferred: true });
      }
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'assignees') {
        // 케이스 담당 실무자 목록 — 담당 실무자 또는 admin(gateway 의 assertSupportCaseAccess 강제). 관리자 배정 화면용.
        requestQuery(url, []);
        const assignees = await listSupportCaseAssignees(env, actor, supportCaseId);
        return json({ assignees: assignees.map(supportCaseAssigneeResponse) });
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'assignees') {
        // 배정 요청(D74) — admin 전용. 수락 전에는 상담 내용과 PII가 열리지 않는다.
        requestQuery(url, []);
        const body = await requestBody(request);
        requireOnlyKeys(body, ['userId', 'role']);
        const userId = requiredString(body, 'userId');
        const roleValue = optionalString(body, 'role');
        if (roleValue !== undefined && roleValue !== 'primary' && roleValue !== 'secondary') {
          throw new ValidationError('assignee role is invalid');
        }
        const assignee = roleValue === undefined
          ? await requestSupportCaseAssignment(env, actor, supportCaseId, userId)
          : await requestSupportCaseAssignment(env, actor, supportCaseId, userId, roleValue);
        return json(supportCaseAssigneeResponse(assignee), 201);
      }
      if (
        request.method === 'POST'
        && parts.length === 5
        && parts[2] === 'assignees'
        && parts[4] === 'accept'
      ) {
        requestQuery(url, []);
        const assignmentId = requireRouteUuid(parts[3] ?? '', 'assignment id');
        await acceptSupportCaseAssignment(env, actor, assignmentId, supportCaseId);
        return json({ accepted: true });
      }
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'consent') {
        requestQuery(url, []);
        return json({ consent: await getSupportCaseConsent(env, actor, supportCaseId) });
      }
      if (
        request.method === 'GET' && parts.length === 4
        && parts[2] === 'consent' && parts[3] === 'events'
      ) {
        requestQuery(url, []);
        return json({ events: await listSupportCaseConsentEvents(env, actor, supportCaseId) });
      }
      if (
        request.method === 'GET' && parts.length === 4
        && parts[2] === 'consent' && parts[3] === 'disclosures'
      ) {
        requestQuery(url, []);
        return json({
          disclosures: await issueSupportCaseConsentDisclosures(env, actor, supportCaseId),
        }, 200, { 'cache-control': 'no-store' });
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'consent-events') {
        requestQuery(url, []);
        const event = await appendSupportCaseConsentEvent(
          env, actor, supportCaseId, parseConsentEventInput(await requestBody(request)),
        );
        if (env.audioStore !== null && (event.decision === 'withdraw' || event.decision === 'decline')) {
          await reconcileSupportCaseAudioDeletions(env, env.audioStore, actor.orgId, supportCaseId);
        }
        return json(event, 201);
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
      requestQuery(url, []);
      const body = await requestBody(request);
      requireOnlyKeys(body, ['programId', 'idempotencyKey', 'consentEvents', 'emergencyReason']);
      const emergencyReason = optionalEmergencyReason(body);
      return json(await createCase(env, actor, {
        programId: requiredString(body, 'programId'),
        idempotencyKey: requiredString(body, 'idempotencyKey'),
        consentEvents: parseInitialConsentEvents(body.consentEvents),
        ...(emergencyReason === undefined ? {} : { emergencyReason }),
      }), 201);
    }
    if (parts[0] === 'cases' && parts[1] !== undefined) {
      const caseId = parts[1];
      if (request.method === 'GET' && parts.length === 2) return json(await getCase(env, actor, caseId));
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'briefing') return json(await getBriefing(env, actor, caseId));
      if (request.method === 'GET' && parts.length === 3 && parts[2] === 'pilot-text-ai-consent') {
        return json(await getLatestPilotTextAiConsentStatus(env, actor, caseId));
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
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'action-items') {
        const body = await requestBody(request);
        requireOnlyKeys(body, ['description', 'owner', 'dueDate', 'sessionId']);
        const owner = requiredString(body, 'owner');
        if (owner !== 'counselor' && owner !== 'beneficiary' && owner !== 'org') {
          throw new ValidationError('action item owner is invalid');
        }
        const dueDate = optionalString(body, 'dueDate');
        const sessionId = optionalString(body, 'sessionId');
        return json(await createActionItem(env, actor, caseId, {
          description: requiredString(body, 'description'),
          owner,
          ...(dueDate === undefined || dueDate.length === 0 ? {} : { dueDate }),
          ...(sessionId === undefined ? {} : { sessionId }),
        }), 201);
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
        // 전사 품질 (CCC-124) — 승인 화면이 전사 신뢰 불가 구간을 표시한다.
        // null = 녹음 결과가 없거나 구조화 필드가 없던 레거시 결과(품질 미상).
        const transcriptQuality = await getTranscriptQualityForSession(env, actor, sessionId);
        return json({
          ...aiDraftResponse(draft),
          regenerateAvailable: regeneration.available,
          regenerateSourceSnapshotId: regeneration.sourceSnapshotId,
          transcriptQuality,
        });
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
      if (
        request.method === 'POST' && parts.length === 3 && parts[2] === 'audio-upload-target'
      ) {
        return await handleAudioUploadTarget(request, env, actor, sessionId);
      }
      if (
        request.method === 'POST' && parts.length === 5
        && parts[2] === 'audio-upload-target' && parts[4] === 'complete'
      ) {
        return await handleAudioUploadCompletion(
          env, actor, sessionId, requireRouteUuid(parts[3] ?? '', 'audio object id'),
        );
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'approve') {
        return json(sessionResponse(await approveSession(env, actor, sessionId, parseApproval(await requestBody(request)))));
      }
    }
    if (request.method === 'GET' && parts.length === 3 && parts[0] === 'ai' && parts[1] === 'provider' && parts[2] === 'status') {
      // CCC-44: 활성 설정 + **배포 런타임 설정과의 대조**를 함께 내려준다 — 해시 불일치가
      // 초안 생성을 막는 사유를 화면이 그대로 보여줄 수 있어야 한다(R5 유지, 값을 새지 않게).
      const active = await getActiveAiProviderStatus(env, actor);
      let runtime: {
        configured: boolean;
        adapterId: string | null;
        adapterVersion: string | null;
        configHash: string | null;
        matches: boolean | null;
      };
      try {
        const { config } = (await resolveAiProviderAdapter(env));
        const configHash = await canonicalAiProviderConfigHash(config);
        runtime = {
          configured: true,
          adapterId: config.providerId,
          adapterVersion: config.adapterVersion,
          configHash,
          matches: !active.enabled ? false : (
            active.adapterId === config.providerId
            && active.adapterVersion === config.adapterVersion
            && active.configHash === configHash
          ),
        };
      } catch {
        runtime = {
          configured: false,
          adapterId: null,
          adapterVersion: null,
          configHash: null,
          matches: null,
        };
      }
      return json({ ...active, runtime });
    }
    if (
      request.method === 'POST'
      && parts.length === 3
      && parts[0] === 'ai'
      && parts[1] === 'provider'
      && parts[2] === 'activate-runtime'
    ) {
      // CCC-44: 기관 관리자가 넣은 승인 참조로 **배포된 런타임만** 등록·활성화한다(운영 포함).
      // 환경 변수의 정확한 레지스트리 tuple과 API 키를 먼저 검증한다. 호출자가 임의
      // hash/model을 넣을 수 없고, 현재 배포 설정과 DB activation이 항상 함께 움직인다.
      // 권한(기관 관리자)은 등록·활성화 게이트웨이가 강제한다(D66 · R1).
      const body = await requestBody(request);
      requireOnlyKeys(body, ['approvalRef']);
      const approvalRef = requiredString(body, 'approvalRef');
      // 환경 변수의 정확한 레지스트리 tuple과 API 키를 먼저 검증한다. 호출자가 임의
      // hash/model을 넣을 수 없고, 현재 배포 설정과 DB activation이 항상 함께 움직인다.
      const { config } = (await resolveAiProviderAdapter(env));
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
    if (
      request.method === 'POST' && parts.length === 2
      && parts[0] === 'pipeline' && parts[1] === 'readiness'
    ) {
      requestQuery(url, []);
      return json(await recordSttReadiness(
        env, actor, parseSttReadinessReport(await requestBody(request)),
      ), 200, { 'cache-control': 'no-store' });
    }
    if (request.method === 'GET' && parts.length === 2 && parts[0] === 'pipeline' && parts[1] === 'health') {
      // D8 폴링 워치독 조회 — 관리자 전용(getPipelineHealth 내부에서 강제). 자기 기관만.
      return json(await getPipelineHealth(env, actor));
    }
    if (parts[0] === 'audio-lifecycle' && parts[1] === 'manual-notes') {
      requestQuery(url, []);
      if (request.method === 'GET' && parts.length === 2) {
        return json(
          { manualNotes: await listAudioManualNoteFallbacks(env, actor) },
          200,
          { 'cache-control': 'no-store' },
        );
      }
      if (
        request.method === 'POST' && parts.length === 4
        && parts[2] !== undefined && parts[3] === 'ack'
      ) {
        if (!await acknowledgeAudioManualNoteFallback(env, actor, parts[2])) {
          throw new ConflictError('manual note fallback is unavailable');
        }
        return new Response(null, { status: 204 });
      }
    }
    if (parts[0] === 'pipeline' && parts[1] === 'memory') {
      requestQuery(url, []);
      if (actor.role !== 'service') throw new ForbiddenError();
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'claim') {
        await verifiedInstallManifest(env);
        const jobs = await claimCounselingMemorySources(env, actor, parseClaimRequest(await requestBody(request)));
        return json({ schemaVersion: 2, jobs }, 200, { 'cache-control': 'no-store' });
      }
      if (parts[2] !== undefined && parts.length === 4) {
        const jobId = requireRouteUuid(parts[2], 'memory job id');
        if (request.method === 'GET' && parts[3] === 'source') {
          const { claimToken, attempt } = claimCredentialsFromHeaders(request);
          return json(await getCounselingMemorySource(env, actor, jobId, claimToken, attempt), 200, { 'cache-control': 'no-store' });
        }
        if (request.method === 'POST' && parts[3] === 'mask-dictionary') {
          return json(await issueCounselingMemoryDictionary(env, actor, jobId, parseClaimCredentials(await requestBody(request))), 200, { 'cache-control': 'no-store' });
        }
        if (request.method === 'POST' && parts[3] === 'result') {
          await acceptCounselingMemorySource(env, actor, jobId, parseAgentResultRequest(await requestBody(request)));
          return new Response(null, { status: 204 });
        }
        if (request.method === 'POST' && parts[3] === 'release') {
          await releaseCounselingMemorySource(env, actor, jobId, parseReleaseRequest(await requestBody(request)));
          return new Response(null, { status: 204 });
        }
      }
    }
    // Agent 작업 계약 v2 (S5). 모든 endpoint 가 service 자격과 live claim 을 요구한다.
    if (parts[0] === 'pipeline' && parts[1] === 'jobs') {
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'claim') {
        const runtime = await resolveAgentRuntime(env);
        const claimed = await claimAgentJobs(
          env, actor, runtime, parseClaimRequest(await requestBody(request)), env.audioStore ?? undefined,
        );
        return json(claimed, 200, { 'cache-control': 'no-store' });
      }
      const jobId = parts[2];
      if (jobId !== undefined && parts.length === 4) {
        if (request.method === 'POST' && parts[3] === 'heartbeat') {
          return json(await heartbeatAgentJob(env, actor, jobId, parseClaimCredentials(await requestBody(request))));
        }
        if (request.method === 'POST' && parts[3] === 'release') {
          const audioObjectId = await releaseAgentJob(
            env, actor, jobId, parseReleaseRequest(await requestBody(request)),
          );
          if (audioObjectId !== null && env.audioStore !== null) {
            await reconcileAudioObjectDeletion(env, env.audioStore, audioObjectId);
          }
          return new Response(null, { status: 204 });
        }
        if (request.method === 'GET' && parts[3] === 'source') {
          const credentials = claimCredentialsFromHeaders(request);
          const source = await getAgentJobSource(env, actor, jobId, credentials.claimToken, credentials.attempt);
          return json(source, 200, { 'cache-control': 'no-store' });
        }
        if (request.method === 'POST' && parts[3] === 'mask-dictionary') {
          const dictionary = await issueAgentJobMaskDictionary(
            env,
            actor,
            jobId,
            parseClaimCredentials(await requestBody(request)),
          );
          return json(dictionary, 200, { 'cache-control': 'no-store' });
        }
        if (request.method === 'GET' && parts[3] === 'audio') {
          const credentials = claimCredentialsFromHeaders(request);
          const runtime = await resolveAgentRuntime(env);
          const delivery = await getAgentJobAudioDelivery(
            env,
            actor,
            jobId,
            credentials.claimToken,
            credentials.attempt,
            runtime,
          );
          if (env.audioStore === null) return json({ error: 'service_unavailable' }, 503);
          if (runtime.audioDelivery === 'protected-get') {
            const mint = await beginAgentJobAudioTargetMint(
              env, actor, jobId, credentials.claimToken, credentials.attempt,
            );
            let target: { url: string; expiresAt: string } | null;
            try {
              target = await env.audioStore.createDownloadTarget(mint.key, 600, {
                kind: 'claim',
                jobId,
                claimToken: credentials.claimToken,
                attempt: credentials.attempt,
              });
            } catch (error) {
              await failAgentJobAudioTargetMint(env, actor, mint.mintId);
              throw error;
            }
            const nowMs = Date.now();
            const expiresAtMs = target === null ? Number.NaN : Date.parse(target.expiresAt);
            if (
              target === null || !Number.isFinite(expiresAtMs)
              || expiresAtMs <= nowMs || expiresAtMs > nowMs + 600_000
            ) {
              await failAgentJobAudioTargetMint(env, actor, mint.mintId);
              return json({ error: 'service_unavailable' }, 503);
            }
            try {
              await completeAgentJobAudioTargetMint(
                env, actor, jobId, credentials.claimToken, credentials.attempt, mint, target.expiresAt,
              );
            } catch (error) {
              await failAgentJobAudioTargetMint(env, actor, mint.mintId);
              throw error;
            }
            return json({
              delivery: 'signed-get',
              url: target.url,
              expiresAt: target.expiresAt,
            }, 200, { 'cache-control': 'no-store' });
          }
          const object = await env.audioStore.get(delivery.audioR2Key);
          if (object === null) {
            const audioObjectId = await closeAgentJobAudioObjectMissing(
              env, actor, jobId, credentials.claimToken, credentials.attempt,
            );
            if (audioObjectId !== null && env.audioStore !== null) {
              await reconcileAudioObjectDeletion(env, env.audioStore, audioObjectId);
            }
            return json({ error: 'audio_object_missing', jobId, retryable: false }, 404);
          }
          // 저장소 키는 응답에 싣지 않는다. canonical content-type 으로 바이트만 중계한다.
          const headers = new Headers();
          headers.set('content-type', object.contentType);
          headers.set('cache-control', 'no-store');
          return new Response(object.body, { status: 200, headers });
        }
        if (request.method === 'POST' && parts[3] === 'result') {
          let accepted: AgentJobResultAcceptance;
          try {
            accepted = await acceptAgentJobResult(
              env,
              actor,
              jobId,
              parseAgentResultRequest(await requestBody(request)),
            );
          } catch (error) {
            if (env.audioStore !== null) await reconcileAgentJobAudioDeletion(env, env.audioStore, actor.orgId, jobId);
            throw error;
          }
          if (accepted.audioObjectId !== null && env.audioStore !== null) {
            await reconcileAudioObjectDeletion(env, env.audioStore, accepted.audioObjectId);
          }
          const committed = accepted.recording;
          if (committed !== null) {
            let finalizedNow = false;
            if (!committed.finalized) {
              let llmEnabled = env.CCC_LLM_MODE === 'openai' && env.TEXT_AI_PILOT_ENABLED === '1';
              if (llmEnabled) {
                try {
                  await assertPilotTextAiConsentForService(env, actor, accepted.sessionId);
                } catch (error) {
                  if (error instanceof ConsentContractError && error.code === 'consent_not_effective') {
                    llmEnabled = false;
                  } else {
                    throw error;
                  }
                }
              }
              if (llmEnabled && !committed.downstreamReady) {
                const claimToken = await claimRecordingResultDownstream(env, actor, accepted.sessionId);
                if (claimToken === null) {
                  throw new ConflictError('recording result downstream work is already in progress');
                }
                try {
                  await generateAiDraft(env, actor, accepted.sessionId, {
                    sourceSnapshotId: committed.snapshot.id,
                  });
                } catch (error) {
                  await releaseRecordingResultDownstream(env, actor, accepted.sessionId, claimToken);
                  throw error;
                }
              }
              finalizedNow = await finalizeRecordingResult(env, actor, accepted.sessionId);
              if (finalizedNow && llmEnabled) {
                await runDiscrepancyDetection(env, actor, accepted.sessionId);
              }
            }
          }
          else if (accepted.kind === 'text' && !accepted.replayed) {
            // 이제서야 이 회차가 2차 마스킹을 마친 재료를 갖는다 — 공식화 시점에 스킵됐던
            // 불일치 검출을 여기서 돌린다(ADR-0027). 실패는 스킵이다(D8).
            await runDiscrepancyDetection(env, actor, accepted.sessionId);
          }
          return new Response(null, { status: 204 });
        }
      }
      if (jobId !== undefined && parts.length === 5 && request.method === 'POST') {
        if (parts[3] === 'audio' && parts[4] === 'verify') {
          const verifyRequest = parseAudioVerifyRequest(await requestBody(request));
          const runtime = await resolveAgentRuntime(env);
          await getAgentJobAudioDelivery(
            env, actor, jobId, verifyRequest.claimToken, verifyRequest.attempt, runtime,
          );
          try {
            return json(await verifyAgentJobAudio(env, actor, jobId, verifyRequest));
          } catch (error) {
            if (env.audioStore !== null) await reconcileAgentJobAudioDeletion(env, env.audioStore, actor.orgId, jobId);
            throw error;
          }
        }
        if (parts[3] === 'egress' && parts[4] === 'authorize') {
          const authorizationRequest = parseEgressAuthorizationRequest(await requestBody(request));
          const runtime = await resolveAgentRuntime(env);
          return json(await authorizeAgentJobEgress(
            env, actor, jobId, authorizationRequest, runtime,
          ), 200, { 'cache-control': 'no-store' });
        }
        if (parts[3] === 'egress' && parts[4] === 'in-flight') {
          const inFlightRequest = parseEgressInFlightRequest(await requestBody(request));
          const runtime = await resolveAgentRuntime(env);
          return json(await markAgentJobEgressInFlight(
            env, actor, jobId, inFlightRequest, runtime,
          ));
        }
      }
    }
    if (parts.length === 2 && parts[0] === 'settings' && parts[1] === 'retention-policy') {
      requestQuery(url, []);
      if (request.method === 'GET') {
        return json(await getRetentionPolicy(env, actor), 200, { 'cache-control': 'no-store' });
      }
      if (request.method === 'PUT') {
        const body = await requestBody(request);
        requireOnlyKeys(body, ['expectedVersion', 'piiPurgeGraceDays']);
        return json(await updateRetentionPolicy(env, actor, {
          expectedVersion: requiredExpectedVersion(body, 'expectedVersion'),
          piiPurgeGraceDays: requiredInteger(body, 'piiPurgeGraceDays'),
        }), 200, { 'cache-control': 'no-store' });
      }
    }
    if (parts[0] === 'pii-retention' && parts[1] === 'reviews') {
      // CCC-121: cron은 아카이브만 하고, 기관 관리자가 이 큐에서 보존 또는 파기를 결정한다.
      if (request.method === 'GET' && parts.length === 2) {
        return json({ reviews: await listParticipantPiiRetentionReviews(env, actor) });
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] !== undefined) {
        return json(await reviewParticipantPiiRetention(
          env,
          actor,
          parts[2],
          parseParticipantPiiRetentionReview(await requestBody(request)),
        ));
      }
    }

    if (request.method === 'GET' && parts.length === 1 && parts[0] === 'assignment-requests') {
      requestQuery(url, []);
      return json({ requests: await listMySupportCaseAssignmentRequests(env, actor) });
    }

    if (request.method === 'GET' && parts.length === 3 && parts[0] === 'settings' && parts[1] === 'assignments' && parts[2] === 'cases') {
      const query = requestQuery(url, ['cursor']);
      return json(await listSettingsSupportCaseOptions(env, actor, 'organization', query.get('cursor') ?? undefined));
    }
    if (request.method === 'GET' && parts.length === 4 && parts[0] === 'settings' && parts[1] === 'assignments' && parts[2] === 'cases') {
      requestQuery(url, []);
      const supportCaseId = requireRouteUuid(parts[3] ?? '', 'support case id');
      const assignees = await listSupportCaseAssignees(env, actor, supportCaseId, { includeRequested: true });
      return json({ assignees: assignees.map(supportCaseAssigneeResponse) });
    }
    if (parts[0] === 'agents') {
      // E6-4 관리자 표면 — 설치 발급과 폐기 둘뿐이다(gateway 가 admin 을 강제한다).
      // 자격 평문은 발급 응답에만 나가므로 두 경로 모두 캐시하지 않는다.
      requestQuery(url, []);
      if (request.method === 'POST' && parts.length === 2 && parts[1] === 'pairing-codes') {
        const body = await requestBody(request);
        requireOnlyKeys(body, ['actorUserId']);
        return json(await issueAgentPairingCode(env, actor, {
          actorUserId: requiredString(body, 'actorUserId'),
        }), 201, { 'cache-control': 'no-store' });
      }
      if (request.method === 'POST' && parts.length === 3 && parts[2] === 'revoke' && parts[1] !== undefined) {
        requireOnlyKeys(await requestBody(request), []);
        return json(await revokeAgentInstallation(env, actor, decodeURIComponent(parts[1])), 200, {
          'cache-control': 'no-store',
        });
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

function requestDirectoryRoles(body: Record<string, unknown>, key: string): DirectoryRole[] {
  const values = body[key];
  if (!Array.isArray(values) || values.length > 3) throw new ValidationError('account roles are invalid');
  return values.map((role) => {
    if (role !== 'institution-admin' && role !== 'technical-admin' && role !== 'worker') {
      throw new ValidationError('account role is invalid');
    }
    return role;
  });
}
