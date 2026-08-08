'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { PREVIEW_COOKIE_NAME, requestPreviewUnlock } from './lib/api';
import {
  ApiError,
  addSupportCaseAssignee,
  closeGoal,
  createCounselingRecord,
  createGoal,
  createIntakeRecord,
  getGoalUpcomingLinkCount,
  updateGoalTitle,
  updateIntakeRecord,
  goalCloseReasons,
  type Goal,
  type GoalCloseReason,
  intakeAnswerKeys,
  intakeAnswerResponses,
  type IntakeAdditionalItemInput,
  type IntakeAnswerInput,
  type IntakeDebtEntryInput,
  type IntakeLinkedOrgInput,
  type IntakeExtendedPiiInput,
  type IntakeGoalInput,
  type IntakeLifeAreaInput,
  type IntakeNextMeetingInput,
  completeOrganizationOnboarding,
  createCounselingSchedule,
  createInitialParticipantProgram,
  createParticipantInvite,
  getPublicInviteInfo,
  signupParticipant,
  createSubsequentParticipantProgram,
  editAiDraft,
  getMyIdentity,
  getParticipantBriefing,
  getSession,
  getParticipantProgram,
  listGoals,
  recordPilotTextAiConsent,
  registerCounselor,
  reviewAiDraft,
  updateParticipantConsent,
  updateParticipantBasicInfo,
  updateScheduleSessionGoals,
  updateSupportCaseOverallGoal,
  resolveDiscrepancy,
  type ManualActionItem,
  type ManualActionItemResolution,
  type ActionItemResolutionStatus,
  actionItemResolutionStatuses,
  type FlagType,
  type ManualGasScore,
  type ManualLifeArea,
  type ManualRecordDetails,
  type ManualRecordFlag,
  lifeAreaKeys,
  lifeAreaStatuses,
} from './lib/api';
import { isBeneficiaryId } from '../../../db/animal-slugs';

type Notice =
  | 'invalid_request'
  | 'validation_error'
  | 'authentication_required'
  | 'access_denied'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'not_eligible_or_already_purged'
  | 'pilot_text_ai_consent_required'
  | 'text_ai_pilot_disabled'
  | 'stale_draft_version'
  | 'draft_version_required'
  | 'grounded_evidence_required'
  | 'ai_provider_not_configured'
  | 'ai_prohibited_output'
  | 'ai_provider_unavailable'
  // G1: ① 동의 하드 게이트에 걸린 두 경우. 화면이 원인을 그대로 안내한다.
  | 'privacy_consent_required'
  | 'emergency_reason_required'
  | 'service_unavailable';

class FormInputError extends Error {}

function value(formData: FormData, name: string): string {
  const input = formData.get(name);
  return typeof input === 'string' ? input : '';
}

function requiredValue(formData: FormData, name: string): string {
  const input = value(formData, name);
  if (input.trim().length === 0) throw new FormInputError();
  return input;
}

function opaqueId(formData: FormData, name: string): string {
  const input = requiredValue(formData, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input)) throw new FormInputError();
  return input;
}
function opaqueReference(formData: FormData, name: string): string {
  const input = requiredValue(formData, name);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(input)) throw new FormInputError();
  return input;
}


function positiveInteger(formData: FormData, name: string): number {
  const input = Number(value(formData, name));
  if (!Number.isSafeInteger(input) || input < 1) throw new FormInputError();
  return input;
}

function isoLikeDateTime(formData: FormData, name: string): string {
  const input = requiredValue(formData, name);
  if (Number.isNaN(Date.parse(input))) throw new FormInputError();
  return input;
}

function sha256(formData: FormData, name: string): string {
  const input = requiredValue(formData, name);
  if (!/^[a-fA-F0-9]{64}$/.test(input)) throw new FormInputError();
  return input.toLowerCase();
}
// 확장 단계(티켓 #11): 레거시 A형식과 동물 슬러그 형식을 모두 수용한다 (D20).
function participantId(formData: FormData, name: string): string {
  const input = requiredValue(formData, name);
  if (!isBeneficiaryId(input)) throw new FormInputError();
  return input;
}

// 체크박스는 체크됐을 때만 폼 데이터에 실린다(미체크 = 키 부재 = 미동의, D15).
function checkbox(formData: FormData, name: string): boolean {
  return formData.get(name) !== null;
}

function optionalOpaqueId(formData: FormData, name: string): string | undefined {
  const input = value(formData, name);
  if (input.length === 0) return undefined;
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(input)) throw new FormInputError();
  return input;
}

function canonicalUtcDateTime(formData: FormData, name: string): string {
  const input = requiredValue(formData, name);
  const parsed = new Date(input);
  if (Number.isNaN(parsed.valueOf())) throw new FormInputError();
  return parsed.toISOString();
}

// 등록 이메일(선택, #37). 비면 undefined 라 바디에서 빠진다. 형식 검증(400)은 API 가 소유한다.
function optionalEmail(formData: FormData, name: string): string | undefined {
  const input = value(formData, name).trim();
  return input.length === 0 ? undefined : input;
}

// 등록 이름·연락처(선택, #37 보완). 비면 undefined 라 바디에서 빠진다. 길이 상한만 폼에서 본다.
function optionalTrimmedText(formData: FormData, name: string, maxLength: number): string | undefined {
  const input = value(formData, name).trim();
  if (input.length === 0) return undefined;
  if (input.length > maxLength) throw new FormInputError();
  return input;
}

// 기본정보 수정(CCC-37): 폼이 7종을 언제나 함께 보내므로 빈 칸은 undefined 가 아니라
// null 이다 — "안 건드림"이 아니라 "지운다"를 뜻한다. 길이 상한만 폼에서 본다.
function nullableTrimmedText(formData: FormData, name: string, maxLength: number): string | null {
  const input = value(formData, name).trim();
  if (input.length === 0) return null;
  if (input.length > maxLength) throw new FormInputError();
  return input;
}

function submissionId(formData: FormData): string {
  const input = requiredValue(formData, 'submissionId');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input)) {
    throw new FormInputError();
  }
  return input;
}

function jsonArray(formData: FormData, name: string): unknown[] {
  const input = value(formData, name);
  if (input.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(input);
    if (!Array.isArray(parsed)) throw new FormInputError();
    return parsed;
  } catch (error) {
    if (error instanceof FormInputError) throw error;
    throw new FormInputError();
  }
}

function recordObject(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') throw new FormInputError();
  return value as Record<string, unknown>;
}

function hasOnlyKeys(record: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(record).some((key) => !keys.includes(key))) throw new FormInputError();
}

function parseManualGasScores(formData: FormData): ManualGasScore[] {
  const goalIds = new Set<string>();
  return jsonArray(formData, 'gasScoresJson').map((item) => {
    const score = recordObject(item);
    hasOnlyKeys(score, ['goalId', 'score']);
    if (
      typeof score.goalId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(score.goalId)
      || typeof score.score !== 'number'
      || !Number.isInteger(score.score)
      || score.score < -2
      || score.score > 2
      || goalIds.has(score.goalId)
    ) throw new FormInputError();
    goalIds.add(score.goalId);
    return { goalId: score.goalId, score: score.score };
  });
}

function parseManualActionItems(formData: FormData): ManualActionItem[] {
  return jsonArray(formData, 'actionItemsJson').map((item) => {
    const action = recordObject(item);
    hasOnlyKeys(action, ['description', 'owner', 'dueDate']);
    const description = action.description;
    const owner = action.owner;
    const dueDate = action.dueDate;
    if (
      typeof description !== 'string'
      || description.trim().length === 0
      || (owner !== 'counselor' && owner !== 'beneficiary' && owner !== 'org')
    ) throw new FormInputError();
    if (dueDate !== undefined && (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
      throw new FormInputError();
    }
    return dueDate === undefined
      ? { description: description.trim(), owner }
      : { description: description.trim(), owner, dueDate };
  });
}

function parseManualActionItemResolutions(formData: FormData): ManualActionItemResolution[] {
  const allowed = new Set(actionItemResolutionStatuses);
  const actionItemIds = new Set<string>();
  return jsonArray(formData, 'actionResolutionsJson').map((item) => {
    const resolution = recordObject(item);
    hasOnlyKeys(resolution, ['actionItemId', 'status', 'note']);
    const actionItemId = resolution.actionItemId;
    const status = resolution.status;
    const note = resolution.note;
    if (
      typeof actionItemId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(actionItemId)
      || typeof status !== 'string'
      || !allowed.has(status as ActionItemResolutionStatus)
      || actionItemIds.has(actionItemId)
    ) throw new FormInputError();
    if (note !== undefined && (typeof note !== 'string' || note.trim().length === 0)) {
      throw new FormInputError();
    }
    actionItemIds.add(actionItemId);
    return note === undefined
      ? { actionItemId, status: status as ActionItemResolutionStatus }
      : { actionItemId, status: status as ActionItemResolutionStatus, note: note.trim() };
  });
}

function parseManualFlags(formData: FormData): ManualRecordFlag[] {
  const allowed = new Set([
    'crisis_utterance',
    'contact_loss_risk',
    'housing_livelihood_shock',
    'debt_deterioration',
    'repeated_noncompliance',
  ]);
  return jsonArray(formData, 'flagsJson').map((item) => {
    const flag = recordObject(item);
    hasOnlyKeys(flag, ['flagType']);
    if (typeof flag.flagType !== 'string' || !allowed.has(flag.flagType)) throw new FormInputError();
    return { flagType: flag.flagType as FlagType };
  });
}

// 6영역 스냅샷(CCC-8): 폼이 6영역을 전부 보내면 파싱해 전달하고, 비어 있으면 생략(undefined).
function parseManualLifeAreas(formData: FormData): ManualLifeArea[] | undefined {
  const raw = jsonArray(formData, 'lifeAreasJson');
  if (raw.length === 0) return undefined;
  const allowedKeys = new Set<string>(lifeAreaKeys);
  const allowedStatuses = new Set<string>(lifeAreaStatuses);
  return raw.map((item) => {
    const area = recordObject(item);
    const areaKey = area.areaKey;
    const changed = area.changed;
    if (typeof areaKey !== 'string' || !allowedKeys.has(areaKey) || typeof changed !== 'boolean') {
      throw new FormInputError();
    }
    if (!changed) {
      hasOnlyKeys(area, ['areaKey', 'changed']);
      return { areaKey: areaKey as ManualLifeArea['areaKey'], changed: false };
    }
    hasOnlyKeys(area, area.note === undefined ? ['areaKey', 'changed', 'status'] : ['areaKey', 'changed', 'status', 'note']);
    const status = area.status;
    const note = area.note;
    if (typeof status !== 'string' || !allowedStatuses.has(status)) throw new FormInputError();
    if (note !== undefined && (typeof note !== 'string' || note.trim().length === 0)) throw new FormInputError();
    return note === undefined
      ? { areaKey: areaKey as ManualLifeArea['areaKey'], changed: true, status: status as (typeof lifeAreaStatuses)[number] }
      : { areaKey: areaKey as ManualLifeArea['areaKey'], changed: true, status: status as (typeof lifeAreaStatuses)[number], note: note.trim() };
  });
}

const manualRecordDetailKeys = ['sessionGoalNote', 'changeSinceLast', 'safetyNote', 'counselorOpinion'] as const;

function jsonObjectOrUndefined(formData: FormData, name: string): Record<string, unknown> | undefined {
  const input = value(formData, name);
  if (input.trim().length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new FormInputError();
  }
  return recordObject(parsed);
}

/**
 * 서술형 항목(CCC-10): 채운 항목만 실어 보내고, 하나도 없으면 undefined 로 바디에서 뺀다
 * (게이트웨이가 빈 객체를 거부하고, 제출 해시도 details 없음으로 계산된다).
 */
function parseManualRecordDetails(formData: FormData): ManualRecordDetails | undefined {
  const details = jsonObjectOrUndefined(formData, 'detailsJson');
  if (details === undefined) return undefined;
  hasOnlyKeys(details, manualRecordDetailKeys);
  const parsed: ManualRecordDetails = {};
  for (const key of manualRecordDetailKeys) {
    const item = details[key];
    if (item === undefined) continue;
    if (typeof item !== 'string' || item.trim().length === 0) throw new FormInputError();
    parsed[key] = item.trim();
  }
  return Object.keys(parsed).length === 0 ? undefined : parsed;
}

function noticeFor(error: unknown): Notice {
  if (error instanceof FormInputError) return 'invalid_request';
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'authentication_required':
      case 'access_denied':
      case 'forbidden':
      case 'invalid_request':
      case 'validation_error':
      case 'not_found':
      case 'conflict':
      case 'not_eligible_or_already_purged':
      case 'pilot_text_ai_consent_required':
      case 'text_ai_pilot_disabled':
      case 'stale_draft_version':
      case 'draft_version_required':
      case 'grounded_evidence_required':
      case 'ai_provider_not_configured':
      case 'service_unavailable':
      case 'ai_prohibited_output':
      case 'ai_provider_unavailable':
      // G1: ① 미동의·긴급 사유 누락은 화면이 원인을 그대로 안내한다.
      case 'privacy_consent_required':
      case 'emergency_reason_required':
        return error.code;
    }
  }
  throw error;
}

function withNotice(path: string, name: 'notice' | 'error', code: string): string {
  const destination = new URL(path, 'https://ccc.invalid');
  destination.searchParams.set(name, code);
  return `${destination.pathname}${destination.search}`;
}

/**
 * 미리보기 코드 게이트 해제(CCC-6). 코드를 API 로 보내 검증하고, 성공하면 받은 서명
 * 토큰을 웹 도메인의 HttpOnly 쿠키로 심은 뒤 홈으로 보낸다. 실패는 진입 화면으로 되돌린다.
 * CCC_PREVIEW 가 아닌 환경에서는 진입 화면 자체가 없으므로 이 액션도 호출되지 않는다.
 */
export async function unlockPreviewAction(formData: FormData): Promise<void> {
  const code = value(formData, 'code');
  if (code.trim().length === 0) redirect(withNotice('/preview', 'error', 'invalid_request'));

  let result: Awaited<ReturnType<typeof requestPreviewUnlock>> | undefined;
  try {
    result = await requestPreviewUnlock(code);
  } catch (error) {
    redirect(withNotice('/preview', 'error', noticeFor(error)));
  }

  if (result === undefined) redirect(withNotice('/preview', 'error', 'service_unavailable'));

  const store = await cookies();
  store.set(PREVIEW_COOKIE_NAME, result.token, {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: '/',
    maxAge: result.maxAgeSeconds,
  });
  redirect('/');
}

/**
 * AI 초안 액션 3종이 끝난 뒤 돌아갈 곳(CCC-60).
 *
 * 원래는 `/cases/:caseId` 와 `/sessions/new` 로 갔는데, 그 둘은 다른 화면으로 넘기기만 하던
 * 옛 별칭이라 이 티켓에서 지웠다. 그래서 이 액션들의 목적지가 없어졌다.
 *
 * **액션 자체는 남긴다.** 게이트웨이 호출과 버전 검사가 들어 있고, AI 승인 화면(CCC-67)이
 * 생기면 그대로 쓸 물건이다. 지금은 그 화면이 없어서 이 액션들을 부르는 곳도 0건이다.
 * 승인 화면이 생기는 날 이 상수를 그 화면 주소로 바꾼다.
 */
const AI_DRAFT_RETURN_PATH = '/';

function revalidateCase(): void {
  revalidatePath(AI_DRAFT_RETURN_PATH);
}

function participantPath(beneficiaryId: string): string {
  return `/participants/${encodeURIComponent(beneficiaryId)}`;
}

/** 기본정보 수정 화면(CCC-37). 저장 성공·실패 모두 이 화면으로 돌아온다. */
function participantEditPath(beneficiaryId: string): string {
  return `${participantPath(beneficiaryId)}/edit`;
}

function participantProgramPath(beneficiaryId: string, supportCaseId: string): string {
  return `${participantPath(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}`;
}

function participantBriefingPath(beneficiaryId: string, supportCaseId: string): string {
  return `${participantProgramPath(beneficiaryId, supportCaseId)}/briefing`;
}

function revalidateParticipantProgram(beneficiaryId: string, supportCaseId: string): void {
  const programPath = participantProgramPath(beneficiaryId, supportCaseId);
  revalidatePath('/');
  // 구 '/records'·'/records/new' 갱신은 지웠다(CCC-60). 전자는 다른 화면으로 넘기기만 하던
  // 별칭이라 이 티켓에서 라우트째 없앴고, 후자는 애초에 존재한 적 없는 주소다(실제 기록 작성
  // 화면은 아래 `${programPath}/records/new` 다).
  revalidatePath(participantPath(beneficiaryId));
  revalidatePath(participantEditPath(beneficiaryId));
  revalidatePath(participantBriefingPath(beneficiaryId, supportCaseId));
  revalidatePath(`${programPath}/records`);
  revalidatePath(`${programPath}/records/new`);
  // 인테이크 조회 화면(CCC-58) — 수정 저장 직후 이 경로로 돌아오므로 함께 갱신한다.
  revalidatePath(`${programPath}/records/intake`);
}

function rejectInconsistentCaseId(formData: FormData, authoritativeCaseId: string): void {
  const submittedCaseIds = formData.getAll('caseId');
  if (submittedCaseIds.some((caseId) => typeof caseId !== 'string' || caseId !== authoritativeCaseId)) {
    throw new FormInputError();
  }
}

function parseEvidenceIds(formData: FormData): string[] {
  const values = formData.getAll('evidenceIds');
  if (values.length === 0) throw new FormInputError();

  const ids: string[] = [];
  for (const value of values) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)) {
      throw new FormInputError();
    }
    ids.push(value);
  }

  if (new Set(ids).size !== ids.length) throw new FormInputError();
  return ids;
}


export async function recordPilotTextAiConsentAction(formData: FormData): Promise<void> {
  let caseId: string | undefined;
  try {
    caseId = opaqueId(formData, 'caseId');
    await recordPilotTextAiConsent(caseId, {
      noticeVersion: opaqueReference(formData, 'noticeVersion'),
      noticeHash: sha256(formData, 'noticeHash'),
      evidenceRef: opaqueReference(formData, 'evidenceRef'),
      evidenceHash: sha256(formData, 'evidenceHash'),
      effectiveAt: isoLikeDateTime(formData, 'effectiveAt'),
    });
  } catch (error) {
    redirect(withNotice(AI_DRAFT_RETURN_PATH, 'error', noticeFor(error)));
  }

  if (caseId === undefined) redirect(withNotice(AI_DRAFT_RETURN_PATH, 'error', 'service_unavailable'));
  revalidateCase();
  redirect(withNotice(AI_DRAFT_RETURN_PATH, 'notice', 'pilot_consent_recorded'));
}


export async function editAiDraftAction(formData: FormData): Promise<void> {
  let caseId: string | undefined;
  let sessionId: string | undefined;
  try {
    sessionId = opaqueId(formData, 'sessionId');
    const session = await getSession(sessionId);
    if (session.id !== sessionId) throw new FormInputError();
    caseId = session.caseId;
    rejectInconsistentCaseId(formData, caseId);
    await editAiDraft(session.id, {
      expectedVersion: positiveInteger(formData, 'expectedVersion'),
      evidenceIds: parseEvidenceIds(formData),
    });
  } catch (error) {
    redirect(withNotice(AI_DRAFT_RETURN_PATH, 'error', noticeFor(error)));
  }

  if (caseId === undefined || sessionId === undefined) {
    redirect(withNotice(AI_DRAFT_RETURN_PATH, 'error', 'service_unavailable'));
  }
  revalidateCase();
  redirect(withNotice(AI_DRAFT_RETURN_PATH, 'notice', 'ai_draft_edited'));
}

export async function reviewAiDraftAction(formData: FormData): Promise<void> {
  let caseId: string | undefined;
  let sessionId: string | undefined;
  let decision: 'approved' | 'rejected' | undefined;
  try {
    sessionId = opaqueId(formData, 'sessionId');
    const session = await getSession(sessionId);
    if (session.id !== sessionId) throw new FormInputError();
    caseId = session.caseId;
    rejectInconsistentCaseId(formData, caseId);
    const decisionValue = requiredValue(formData, 'decision');
    if (decisionValue !== 'approved' && decisionValue !== 'rejected') throw new FormInputError();
    decision = decisionValue;
    await reviewAiDraft(session.id, {
      expectedVersion: positiveInteger(formData, 'expectedVersion'),
      decision,
    });
  } catch (error) {
    redirect(withNotice(AI_DRAFT_RETURN_PATH, 'error', noticeFor(error)));
  }

  if (caseId === undefined || sessionId === undefined || decision === undefined) {
    redirect(withNotice(AI_DRAFT_RETURN_PATH, 'error', 'service_unavailable'));
  }
  revalidateCase();
  redirect(withNotice(AI_DRAFT_RETURN_PATH, 'notice', `ai_${decision}`));
}
/**
 * 동의 3종 수정·철회 (D44). 당사자 정보 페이지의 참여 사업 카드마다 붙는다.
 *
 * 체크박스는 체크됐을 때만 폼에 실리므로(checkbox 헬퍼) 미체크는 곧 철회다 — 두 값을
 * 언제나 함께 보내 서버가 현재 상태 전체를 한 행으로 기록하게 한다(append-only 이력, D14).
 * 권한(담당 실무자·기관 관리자)은 게이트웨이가 판정한다 — 화면에서 다시 판정하지 않는다.
 */
export async function updateParticipantConsentAction(formData: FormData): Promise<void> {
  let beneficiaryId: string | undefined;
  try {
    beneficiaryId = participantId(formData, 'beneficiaryId');
    const supportCaseId = requiredValue(formData, 'supportCaseId');
    await updateParticipantConsent(supportCaseId, {
      privacy: checkbox(formData, 'consentPrivacy'),
      recordingAi: checkbox(formData, 'consentRecordingAi'),
    });
    revalidateParticipantProgram(beneficiaryId, supportCaseId);
  } catch (error) {
    const fallback = beneficiaryId === undefined ? '/participants' : participantPath(beneficiaryId);
    redirect(withNotice(fallback, 'error', noticeFor(error)));
  }
  if (beneficiaryId === undefined) redirect(withNotice('/participants', 'error', 'service_unavailable'));
  redirect(withNotice(participantPath(beneficiaryId), 'notice', 'consent_updated'));
}

/**
 * 전체 목표 그 자리 입력·수정 (D45 · CCC-41). 브리핑의 전체 목표 카드에서 제출한다.
 * 빈 칸 저장은 "설정 전"으로 되돌린다(케이스당 1개·수정 가능·점수 없음 — D33).
 * 권한(담당 실무자만)·감사(D14)는 게이트웨이가 판정한다 — 여기서는 값만 나른다.
 * 성공 피드백은 별도 notice 없이 갱신된 카드 자체다. 실패만 notice 코드로 돌아온다.
 */
export async function updateOverallGoalAction(formData: FormData): Promise<void> {
  let beneficiaryId: string | undefined;
  let supportCaseId: string | undefined;
  try {
    beneficiaryId = participantId(formData, 'beneficiaryId');
    supportCaseId = opaqueId(formData, 'supportCaseId');
    const overallGoal = nullableTrimmedText(formData, 'overallGoal', 200);
    await updateSupportCaseOverallGoal(supportCaseId, overallGoal);
    revalidateParticipantProgram(beneficiaryId, supportCaseId);
  } catch {
    // 실패 사유는 코드 하나로 뭉친다 — 길이 초과는 입력 maxLength 로 이미 막혀 있어,
    // 남는 실패(권한·일시 장애)는 안내 한 줄이면 충분하다.
    const fallback = beneficiaryId === undefined || supportCaseId === undefined
      ? '/participants'
      : participantBriefingPath(beneficiaryId, supportCaseId);
    redirect(withNotice(fallback, 'notice', 'overall_goal_error'));
  }
  if (beneficiaryId === undefined || supportCaseId === undefined) {
    redirect(withNotice('/participants', 'error', 'service_unavailable'));
  }
  redirect(participantBriefingPath(beneficiaryId, supportCaseId));
}

// ── 세부 목표 (D62 · CCC-68) ─────────────────────────────────────────────────
// 상담 기록 작성 화면의 세부 목표 구획이 부른다. 기록지 폼과 별개의 즉시 저장이다 —
// 목표는 제출 ID 로 재현 보호할 기록이 아니라 케이스에 붙는 현재 상태이기 때문이다.
// 권한(담당 실무자·기관 관리자)·활성 상한 3개·사유 검증·이력 보존은 게이트웨이가 갖는다(R1).

export type GoalActionResult = { status: 'saved'; goal: Goal } | { status: Notice };

const GOAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const MAX_GOAL_TITLE_LENGTH = 200;

/** 세 액션 공용 입구: 대상 짝(당사자·참여 사업) 검증 + 소속 확인. */
async function assertGoalActionScope(beneficiaryId: string, supportCaseId: string): Promise<void> {
  if (!isBeneficiaryId(beneficiaryId) || !GOAL_ID_PATTERN.test(supportCaseId)) throw new FormInputError();
  await getParticipantProgram(beneficiaryId, supportCaseId);
}

function goalTitleOf(raw: string): string {
  if (typeof raw !== 'string') throw new FormInputError();
  const title = raw.trim();
  if (title.length === 0 || title.length > MAX_GOAL_TITLE_LENGTH) throw new FormInputError();
  return title;
}

/** 세부 목표 신설(본 상담 1회차 흐름). 활성 상한 3개는 게이트웨이가 최종 강제한다. */
export async function createGoalAction(
  input: { beneficiaryId: string; supportCaseId: string; title: string },
): Promise<GoalActionResult> {
  try {
    await assertGoalActionScope(input.beneficiaryId, input.supportCaseId);
    const goal = await createGoal(input.supportCaseId, goalTitleOf(input.title));
    revalidateParticipantProgram(input.beneficiaryId, input.supportCaseId);
    return { status: 'saved', goal };
  } catch (error) {
    return { status: noticeFor(error) };
  }
}

/** 세부 목표 문구 수정(D12 수정 금지 폐지). 이전 문구·수정자·시각은 게이트웨이가 이력으로 남긴다. */
export async function updateGoalTitleAction(
  input: { beneficiaryId: string; supportCaseId: string; goalId: string; title: string },
): Promise<GoalActionResult> {
  try {
    if (!GOAL_ID_PATTERN.test(input.goalId)) throw new FormInputError();
    await assertGoalActionScope(input.beneficiaryId, input.supportCaseId);
    const goal = await updateGoalTitle(input.goalId, goalTitleOf(input.title));
    revalidateParticipantProgram(input.beneficiaryId, input.supportCaseId);
    return { status: 'saved', goal };
  } catch (error) {
    return { status: noticeFor(error) };
  }
}

export type GoalUpcomingLinksResult = { status: 'ok'; upcomingCount: number } | { status: Notice };

/**
 * 이 세부 목표에 연결된 미래 회기 수(D62 §5). 닫기 패널의 알림 한 줄 판정용 — 알림일 뿐
 * 닫기를 막지 않으므로, 화면은 이 액션이 실패해도 닫기 흐름을 그대로 진행한다.
 */
export async function countGoalUpcomingLinksAction(
  input: { beneficiaryId: string; supportCaseId: string; goalId: string },
): Promise<GoalUpcomingLinksResult> {
  try {
    if (!GOAL_ID_PATTERN.test(input.goalId)) throw new FormInputError();
    await assertGoalActionScope(input.beneficiaryId, input.supportCaseId);
    return { status: 'ok', upcomingCount: await getGoalUpcomingLinkCount(input.goalId) };
  } catch (error) {
    return { status: noticeFor(error) };
  }
}

/** 세부 목표 닫기. 사유는 달성/중단/재설정 선택값만 — 닫은 목표는 다시 열지 않는다(D62 §5). */
export async function closeGoalAction(
  input: { beneficiaryId: string; supportCaseId: string; goalId: string; reason: GoalCloseReason },
): Promise<GoalActionResult> {
  try {
    if (!GOAL_ID_PATTERN.test(input.goalId)) throw new FormInputError();
    if (!(goalCloseReasons as readonly string[]).includes(input.reason)) throw new FormInputError();
    await assertGoalActionScope(input.beneficiaryId, input.supportCaseId);
    const goal = await closeGoal(input.goalId, input.reason);
    revalidateParticipantProgram(input.beneficiaryId, input.supportCaseId);
    return { status: 'saved', goal };
  } catch (error) {
    return { status: noticeFor(error) };
  }
}

/**
 * 불일치 처리 3종 (D45 · ADR-0018 · CCC-42). 브리핑 영역 ③ 의 처리 버튼이 제출한다.
 * 처리는 표시일 뿐 원본 기록은 그대로다 — 여기서 바뀌는 것은 처리 상태뿐이다.
 * 권한(담당 실무자·기관 관리자)·감사(D14)는 게이트웨이가 판정한다.
 * 성공 피드백은 갱신된 목록 자체이고, 실패만 notice 코드로 돌아온다(전체 목표 카드와 같은 방식).
 */
export async function resolveDiscrepancyAction(formData: FormData): Promise<void> {
  let beneficiaryId: string | undefined;
  let supportCaseId: string | undefined;
  try {
    beneficiaryId = participantId(formData, 'beneficiaryId');
    supportCaseId = opaqueId(formData, 'supportCaseId');
    const discrepancyId = opaqueId(formData, 'discrepancyId');
    const status = formData.get('status');
    if (status !== 'situation_changed' && status !== 'record_error' && status !== 'confirmed') {
      throw new Error('discrepancy resolution status is invalid');
    }
    await resolveDiscrepancy(supportCaseId, discrepancyId, status);
    revalidateParticipantProgram(beneficiaryId, supportCaseId);
  } catch {
    const fallback = beneficiaryId === undefined || supportCaseId === undefined
      ? '/participants'
      : participantBriefingPath(beneficiaryId, supportCaseId);
    redirect(withNotice(fallback, 'notice', 'discrepancy_error'));
  }
  if (beneficiaryId === undefined || supportCaseId === undefined) {
    redirect(withNotice('/participants', 'error', 'service_unavailable'));
  }
  redirect(participantBriefingPath(beneficiaryId, supportCaseId));
}

/**
 * 기본정보 수정 (CCC-37). 이름·연락처·이메일·계좌·생년월일·주소·성별 7종을 **언제나 함께**
 * 보낸다 — 폼이 현재 상태 전체를 들고 있으므로 빈 칸은 곧 "지운다"(null)다.
 *
 * 값은 금고에 AES-GCM 으로 저장되고(D3) 감사는 게이트웨이가 남긴다(D14). PII 는 임시본에도
 * 리다이렉트 주소에도 싣지 않는다 — 실패해도 오가는 것은 notice 코드뿐이다(R3).
 * 권한(담당 실무자·기관 관리자)은 게이트웨이가 판정한다.
 */
export async function updateParticipantBasicInfoAction(formData: FormData): Promise<void> {
  let beneficiaryId: string | undefined;
  try {
    beneficiaryId = participantId(formData, 'beneficiaryId');
    const supportCaseContextId = opaqueId(formData, 'supportCaseContextId');
    const expectedVersion = positiveInteger(formData, 'expectedVersion');
    const birthDate = nullableTrimmedText(formData, 'birthDate', 10);
    if (birthDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new FormInputError();
    await updateParticipantBasicInfo(beneficiaryId, {
      supportCaseContextId,
      expectedVersion,
      name: nullableTrimmedText(formData, 'name', 100),
      phone: nullableTrimmedText(formData, 'phone', 32),
      email: nullableTrimmedText(formData, 'email', 200),
      account: nullableTrimmedText(formData, 'account', 100),
      birthDate,
      region: nullableTrimmedText(formData, 'region', 200),
      gender: nullableTrimmedText(formData, 'gender', 20),
    });
    revalidateParticipantProgram(beneficiaryId, supportCaseContextId);
  } catch (error) {
    const fallback = beneficiaryId === undefined ? '/participants' : participantEditPath(beneficiaryId);
    redirect(withNotice(fallback, 'error', noticeFor(error)));
  }
  if (beneficiaryId === undefined) redirect(withNotice('/participants', 'error', 'service_unavailable'));
  redirect(withNotice(participantEditPath(beneficiaryId), 'notice', 'basic_info_updated'));
}

export async function createInitialParticipantProgramAction(formData: FormData): Promise<void> {
  let beneficiaryId: string | undefined;
  let supportCaseId: string | undefined;
  try {
    // 등록자=담당 실무자(D7): 폼에서 담당 실무자를 받지 않는다. admin 은 게이트웨이 계약상 담당 실무자 필수라
    // 본인을 배정하고, counselor 는 전달하지 않아 게이트웨이 자동 본인 배정에 맡긴다.
    const identity = await getMyIdentity();
    const email = optionalEmail(formData, 'email');
    const name = optionalTrimmedText(formData, 'name', 100);
    const phone = optionalTrimmedText(formData, 'phone', 32);
    // D41 1-1 · D42 ①: 생년월일·주소(거주지역)·성별은 등록 화면이 받아 금고에 저장한다.
    // 인테이크 화면은 이 값을 읽어 표시만 한다.
    const birthDate = optionalTrimmedText(formData, 'birthDate', 10);
    const region = optionalTrimmedText(formData, 'region', 200);
    const gender = optionalTrimmedText(formData, 'gender', 20);
    if (birthDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) throw new FormInputError();
    // 긴급 등록(G1): 토글을 켰을 때만 사유를 싣는다. 사유가 비면 서버가 emergency_reason_required 로
    // 되돌려 주므로 여기서 다시 판정하지 않는다 — 판정은 게이트웨이 한 곳이다(R1).
    const emergencyReason = checkbox(formData, 'emergencyRegistration')
      ? (optionalTrimmedText(formData, 'emergencyReason', 500) ?? '')
      : undefined;
    const created = await createInitialParticipantProgram({
      programType: 'financial_support_v1',
      // intakeAt 을 싣지 않는다(CCC-56): 등록 시각을 인테이크 완료로 기록하던 오염을 중단.
      // 인테이크 완료 시각은 인테이크 기록 저장이 채운다.
      // 항목별 동의 2종(D49·D23·D44): ② 는 기본 미체크이고 미동의여도 등록은 진행된다.
      // ① 은 하드 게이트다(G1) — 미체크면 긴급 등록 사유가 있어야 서버가 받아 준다.
      consentPrivacy: checkbox(formData, 'consentPrivacy'),
      consentRecordingAi: checkbox(formData, 'consentRecordingAi'),
      ...(emergencyReason === undefined ? {} : { emergencyReason }),
      ...(identity.role === 'admin' ? { initialAssigneeUserId: identity.id } : {}),
      // 등록 폼의 이름·연락처·이메일을 금고에 저장한다(#37 보완, 계좌만 이후 updateParticipantPii).
      ...(name === undefined ? {} : { name }),
      ...(phone === undefined ? {} : { phone }),
      ...(email === undefined ? {} : { email }),
      ...(birthDate === undefined ? {} : { birthDate }),
      ...(region === undefined ? {} : { region }),
      ...(gender === undefined ? {} : { gender }),
    });
    beneficiaryId = created.beneficiaryId;
    supportCaseId = created.supportCaseId;
  } catch (error) {
    redirect(withNotice('/participants/new', 'error', noticeFor(error)));
  }

  if (beneficiaryId === undefined || supportCaseId === undefined) {
    redirect(withNotice('/participants/new', 'error', 'service_unavailable'));
  }
  revalidateParticipantProgram(beneficiaryId, supportCaseId);
  revalidatePath('/schedules/new');
  // 콜드스타트 해소(티켓 #19): 등록 완료 → 새 당사자가 preselect 된 상담 등록으로 잇는다.
  redirect(withNotice(
    `/schedules/new?target=${encodeURIComponent(`${beneficiaryId}|${supportCaseId}`)}`,
    'notice',
    'program_created',
  ));
}

export async function createSubsequentParticipantProgramAction(formData: FormData): Promise<void> {
  let beneficiaryId: string | undefined;
  let supportCaseId: string | undefined;
  try {
    beneficiaryId = participantId(formData, 'beneficiaryId');
    // 추가 참여 사업도 ① 하드 게이트를 지난다(G1) — 두 번째 사업은 동의 3종이 미체크로
    // 시작하므로(D44) 여기서 ① 을 다시 받고, 미체크면 긴급 등록 사유가 있어야 한다.
    const emergencyReason = checkbox(formData, 'emergencyRegistration')
      ? (optionalTrimmedText(formData, 'emergencyReason', 500) ?? '')
      : undefined;
    const created = await createSubsequentParticipantProgram(beneficiaryId, {
      schemaVersion: 1,
      submissionId: submissionId(formData),
      programType: 'financial_support_v1',
      // intakeAt 을 싣지 않는다(CCC-56) — 추가 참여 사업도 등록 시점에는 인테이크 전이다.
      sourceSupportCaseId: opaqueId(formData, 'sourceSupportCaseId'),
      // D49: 두 번째 참여 사업도 2종을 여기서 받는다 — 전에는 ② 를 보낼 경로가 없었다.
      consentPrivacy: checkbox(formData, 'consentPrivacy'),
      consentRecordingAi: checkbox(formData, 'consentRecordingAi'),
      ...(emergencyReason === undefined ? {} : { emergencyReason }),
    });
    supportCaseId = created.supportCaseId;
  } catch (error) {
    redirect(withNotice(beneficiaryId === undefined ? '/records/new' : participantPath(beneficiaryId), 'error', noticeFor(error)));
  }

  if (beneficiaryId === undefined || supportCaseId === undefined) {
    redirect(withNotice('/records/new', 'error', 'service_unavailable'));
  }
  revalidateParticipantProgram(beneficiaryId, supportCaseId);
  redirect(withNotice(participantBriefingPath(beneficiaryId, supportCaseId), 'notice', 'program_created'));
}

// 상담 등록(#20): 당사자 선택은 'beneficiaryId|supportCaseId' 한 값으로 커플링해
// 담당 케이스만 노출한 목록에서 고르게 한다. 담당 검사·감사는 API 게이트웨이가 강제한다(R1).
export async function createCounselingScheduleAction(formData: FormData): Promise<void> {
  try {
    const target = requiredValue(formData, 'target');
    const separator = target.indexOf('|');
    if (separator === -1) throw new FormInputError();
    const beneficiaryId = target.slice(0, separator);
    const supportCaseId = target.slice(separator + 1);
    if (!isBeneficiaryId(beneficiaryId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(supportCaseId)) {
      throw new FormInputError();
    }
    await createCounselingSchedule({
      beneficiaryId,
      supportCaseId,
      scheduledAt: canonicalUtcDateTime(formData, 'scheduledAt'),
    });
  } catch (error) {
    redirect(withNotice('/schedules/new', 'error', noticeFor(error)));
  }
  revalidatePath('/');
  revalidatePath('/schedules/new');
  redirect(withNotice('/', 'notice', 'schedule_created'));
}

// 사용자 id 는 이메일 또는 UUID 다(게이트웨이 OPAQUE_IDENTIFIER 와 동치): 공백·제어문자만 배제.
function userIdentifier(formData: FormData, name: string): string {
  const input = requiredValue(formData, name);
  if (!/^[^\s\x00-\x1f\x7f-\x9f]{1,128}$/.test(input)) throw new FormInputError();
  return input;
}

// 관리자 영역(재개편 T8, #38): 공동 담당 추가(D7). 관리자 검사·감사는 API 게이트웨이가 강제한다(R1).
export async function addSupportCaseAssigneeAction(formData: FormData): Promise<void> {
  let supportCaseId: string | undefined;
  try {
    supportCaseId = opaqueId(formData, 'supportCaseId');
    const userId = userIdentifier(formData, 'userId');
    await addSupportCaseAssignee(supportCaseId, userId);
  } catch (error) {
    const back = supportCaseId === undefined
      ? '/admin/assign'
      : `/admin/assign?supportCaseId=${encodeURIComponent(supportCaseId)}`;
    redirect(withNotice(back, 'error', noticeFor(error)));
  }
  if (supportCaseId === undefined) redirect(withNotice('/admin/assign', 'error', 'service_unavailable'));
  revalidatePath('/admin/assign');
  revalidatePath('/admin/users');
  redirect(withNotice(`/admin/assign?supportCaseId=${encodeURIComponent(supportCaseId)}`, 'notice', 'assignee_added'));
}

// 실무자 등록(기존 POST /users, role=counselor). 관리자 검사·감사는 API 게이트웨이가 강제한다(R1).
/**
 * 관리자 온보딩 2단계 저장 (CCC-32 · 스펙 #78 US 1). 조직 이름·첫 사업 표시 이름만
 * 진짜 저장한다 — admin 검사·감사는 게이트웨이 몫(R1). 저장한 이름이 셸(사이드바) 전체에
 * 되비치므로 레이아웃 단위로 재검증한다.
 */
export async function completeOrganizationOnboardingAction(formData: FormData): Promise<void> {
  try {
    const orgName = requiredValue(formData, 'orgName').trim();
    const programDisplayName = requiredValue(formData, 'programDisplayName').trim();
    if (orgName.length === 0 || orgName.length > 80) throw new FormInputError();
    if (programDisplayName.length === 0 || programDisplayName.length > 120) throw new FormInputError();
    await completeOrganizationOnboarding({ orgName, programDisplayName });
  } catch (error) {
    redirect(withNotice('/onboarding', 'error', noticeFor(error)));
  }
  revalidatePath('/', 'layout');
  redirect(withNotice('/onboarding', 'notice', 'onboarding_saved'));
}

export async function registerCounselorAction(formData: FormData): Promise<void> {
  try {
    const email = requiredValue(formData, 'email').trim();
    if (email.length === 0 || email.length > 254) throw new FormInputError();
    await registerCounselor(email);
  } catch (error) {
    redirect(withNotice('/admin/invite', 'error', noticeFor(error)));
  }
  revalidatePath('/admin/invite');
  revalidatePath('/admin/users');
  redirect(withNotice('/admin/invite', 'notice', 'counselor_registered'));
}

export type ParticipantInviteResult = { status: 'created'; token: string } | { status: Notice };

// 당사자 가입 링크 발급(D39 · ADR-0016 · CCC-29). 링크·QR·이메일 문안 조립은 화면 몫이고
// 여기는 토큰만 받아 넘긴다. 권한(사람만)·감사는 API 게이트웨이가 강제한다(R1·D14).
export async function createParticipantInviteAction(): Promise<ParticipantInviteResult> {
  try {
    const invite = await createParticipantInvite('financial_support_v1');
    return { status: 'created', token: invite.token };
  } catch (error) {
    return { status: noticeFor(error) };
  }
}

export type ParticipantSignupResult =
  | { status: 'created'; beneficiaryId: string; supportCaseId: string }
  | { status: Notice };

/**
 * 당사자 자기 가입(CCC-28 · D39 · ADR-0016 #4). 공개 경로 — 인증 불필요.
 * 성공 시 당사자+케이스+담당 배정이 원자 생성되고 201 반환. 토큰 무효·이미 소비는
 * not_found. 리다이렉트 없음 — 클라이언트가 인라인 완료 상태를 표시한다.
 */
export async function signupParticipantAction(formData: FormData): Promise<ParticipantSignupResult> {
  const token = requiredValue(formData, 'token');
  const name = requiredValue(formData, 'name');
  const phone = formData.get('phone');
  const email = formData.get('email');
  // 항목별 동의 2종(D49): 등록 화면과 같은 체크박스 이름·순서. ① 은 하드 게이트라
  // 미체크면 서버가 privacy_consent_required 로 되돌린다(G1 — 자기 가입에는 긴급 예외가 없다).
  // ② 는 기본 미체크이고 미동의여도 가입은 진행된다(D15).
  const consent = {
    privacy: checkbox(formData, 'consentPrivacy'),
    recordingAi: checkbox(formData, 'consentRecordingAi'),
  };
  try {
    const result = await signupParticipant({
      token,
      name,
      ...(typeof phone === 'string' && phone.trim().length > 0 ? { phone: phone.trim() } : {}),
      ...(typeof email === 'string' && email.trim().length > 0 ? { email: email.trim() } : {}),
      consent,
    });
    return { status: 'created', beneficiaryId: result.beneficiaryId, supportCaseId: result.supportCaseId };
  } catch (error) {
    return { status: noticeFor(error) };
  }
}

const SCHEDULE_UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface ScheduleWizardSessionGoal {
  body: string;
  caseGoalId: string | null;
}

export interface CreateSchedulePlanInput {
  beneficiaryId: string;
  supportCaseId: string;
  scheduledAt: string;
  // 상담 유형(#36). 'intake' 면 세션 목표를 연결할 기존 목표가 아직 없어 그 단계를 건너뛴다.
  // 구 caseGoals(케이스 목표 신설)는 없앴다(CCC-64). 아래 createSchedulePlanAction 주석 참조.
  sessionKind: 'regular' | 'intake';
  sessionGoals: ScheduleWizardSessionGoal[];
  customQuestions: string[];
}

export type ScheduleContextResult =
  | {
      status: 'loaded';
      caseGoals: Array<{ id: string; title: string }>;
      lastBriefing: { source: 'ai' | 'memo'; text: string } | null;
    }
  | { status: Notice };

export type CreateSchedulePlanResult = { status: 'created' } | { status: Notice };

function assertScheduleTargetScope(beneficiaryId: string, supportCaseId: string): void {
  if (!isBeneficiaryId(beneficiaryId)) throw new FormInputError();
  if (!SCHEDULE_UUID_PATTERN.test(supportCaseId)) throw new FormInputError();
}

function normalizeCaseGoalId(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!SCHEDULE_UUID_PATTERN.test(trimmed)) throw new FormInputError();
  return trimmed;
}

// 3단계 상담 등록 2단계 진입 시 참고 데이터: 활성 케이스 목표(연결 선택지)와 지난 브리핑 요약.
// 담당 검사·감사는 API 게이트웨이가 강제한다(R1). 브리핑이 없거나 실패하면 lastBriefing 은 null.
export async function loadScheduleContextAction(
  beneficiaryId: string,
  supportCaseId: string,
): Promise<ScheduleContextResult> {
  try {
    assertScheduleTargetScope(beneficiaryId, supportCaseId);
    const goals = await listGoals(supportCaseId);
    const caseGoals = goals
      .filter((goal) => goal.status === 'active')
      .map((goal) => ({ id: goal.id, title: goal.title }));
    let lastBriefing: { source: 'ai' | 'memo'; text: string } | null = null;
    try {
      const briefing = await getParticipantBriefing(beneficiaryId, supportCaseId);
      const focus = briefing.sections.find((section) => section.sourceSupportCase.id === supportCaseId);
      const summary = focus?.lastSessionSummary ?? null;
      if (summary !== null) lastBriefing = { source: summary.source, text: summary.text };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      // 브리핑 조회 실패는 참고 카드만 비운다 — 등록 흐름은 막지 않는다.
    }
    return { status: 'loaded', caseGoals, lastBriefing };
  } catch (error) {
    return { status: noticeFor(error) };
  }
}

// 3단계 상담 등록 완료: 유형에 따라 갈린다(#36). 기본 상담은 세션 목표(케이스 목표 연결 포함,
// D28)·맞춤형 질문을, 인테이크는 케이스 목표(D12)·맞춤형 질문을 원자적으로 저장한다(gateway 경유,
// R1). 성공 시 템플릿 미리보기를 위해 상태만 돌려주고 이동은 클라이언트가 한다.
export async function createSchedulePlanAction(
  input: CreateSchedulePlanInput,
): Promise<CreateSchedulePlanResult> {
  try {
    assertScheduleTargetScope(input.beneficiaryId, input.supportCaseId);
    const scheduledAt = new Date(input.scheduledAt);
    if (Number.isNaN(scheduledAt.valueOf())) throw new FormInputError();
    const customQuestions = input.customQuestions
      .map((question) => question.trim())
      .filter((question) => question.length > 0);

    if (input.sessionKind === 'intake') {
      // 구 caseGoals(측정 가능한 문장 1~3개, 필수)는 보내지 않는다(CCC-64, 2026-08-08 Q 결정).
      // 그 값은 goals 표로 들어가는데 D43 이 그 층을 보류해 읽는 화면이 없었고, 일정을 잡는
      // 시점은 아직 당사자를 만나기 전이라 목표를 지어내게 하는 순서 자체가 틀렸다.
      // 목표는 첫 상담에서 대화로 정해 브리핑의 '전체 목표'에 적는다(D45).
      await createCounselingSchedule({
        beneficiaryId: input.beneficiaryId,
        supportCaseId: input.supportCaseId,
        scheduledAt: scheduledAt.toISOString(),
        sessionKind: 'intake',
        ...(customQuestions.length > 0 ? { customQuestions } : {}),
      });
    } else {
      const sessionGoals = input.sessionGoals
        .map((goal) => ({ body: goal.body.trim(), caseGoalId: normalizeCaseGoalId(goal.caseGoalId) }))
        .filter((goal) => goal.body.length > 0);
      await createCounselingSchedule({
        beneficiaryId: input.beneficiaryId,
        supportCaseId: input.supportCaseId,
        scheduledAt: scheduledAt.toISOString(),
        ...(sessionGoals.length > 0 ? { sessionGoals } : {}),
        ...(customQuestions.length > 0 ? { customQuestions } : {}),
      });
    }
    revalidatePath('/');
    revalidatePath('/schedules/new');
    return { status: 'created' };
  } catch (error) {
    return { status: noticeFor(error) };
  }
}

// 세션 목표 수정 (D62 §6 · CCC-70): 일정 시작 시각 전까지만 묶음 통째 교체. 잠금·활성
// 세부 목표만 연결·낙관 잠금은 API 게이트웨이가 강제한다(R1). 여기는 경계 검증과
// 정리(trim·빈 줄 제거)만 한다. 브리핑 영역 ①이 같은 데이터를 읽으므로 함께 재검증한다.
export interface UpdateSessionGoalsActionInput {
  scheduleId: string;
  beneficiaryId: string;
  supportCaseId: string;
  expectedVersion: number;
  sessionGoals: ScheduleWizardSessionGoal[];
}

export type UpdateSessionGoalsActionResult = { status: 'saved'; version: number } | { status: Notice };

export async function updateScheduleSessionGoalsAction(
  input: UpdateSessionGoalsActionInput,
): Promise<UpdateSessionGoalsActionResult> {
  try {
    assertScheduleTargetScope(input.beneficiaryId, input.supportCaseId);
    if (!SCHEDULE_UUID_PATTERN.test(input.scheduleId)) throw new FormInputError();
    if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new FormInputError();
    const sessionGoals = input.sessionGoals
      .map((goal) => ({ body: goal.body.trim(), caseGoalId: normalizeCaseGoalId(goal.caseGoalId) }))
      .filter((goal) => goal.body.length > 0);
    const result = await updateScheduleSessionGoals(input.scheduleId, {
      expectedVersion: input.expectedVersion,
      sessionGoals,
    });
    revalidatePath(`/schedules/${input.scheduleId}/plan`);
    revalidatePath(
      `/participants/${input.beneficiaryId}/programs/${input.supportCaseId}/briefing`,
    );
    return { status: 'saved', version: result.version };
  } catch (error) {
    return { status: noticeFor(error) };
  }
}

export type CounselingRecordActionResult =
  | { status: 'saved' }
  | { status: 'replayed' }
  | { status: Notice };

// 인테이크 위저드 제출 입력(CCC-7). 클라이언트 위저드가 6단계 상태를 이 객체로 모아
// 한 번 호출한다. 형식·범위 검증은 여기(경계)와 게이트웨이가 이중으로 하고, P1 충족 여부는
// 게이트웨이가 최종 강제한다(R1). 저장은 최종 "완료" 1회다 — 부분 저장 없음.
export interface CreateIntakeRecordActionInput {
  beneficiaryId: string;
  supportCaseId: string;
  submissionId: string;
  heldAt: string;
  channel: 'in_person' | 'phone' | 'video';
  // D42: 5종은 선택. 4단계 위저드는 보내지 않는다(동의는 등록 화면, 목표는 보류).
  consent?: { privacy: boolean; recordingAi: boolean };
  helpNarrative?: { todayHelp: string; hardestPoint: string; desiredChange: string };
  lifeAreas?: IntakeLifeAreaInput[];
  goals?: IntakeGoalInput[];
  actions?: ManualActionItem[];
  // 전부 선택 — 비어 있으면 아예 보내지 않는다.
  answers?: IntakeAnswerInput[];
  extendedPii?: IntakeExtendedPiiInput;
  additionalItems?: IntakeAdditionalItemInput[];
  debts?: IntakeDebtEntryInput[];
  linkedOrgs?: IntakeLinkedOrgInput[];
  nextMeeting?: IntakeNextMeetingInput;
  managerOpinion?: string;
  /**
   * 완료로 넘길 연결 일정(CCC-57). 둘은 언제나 함께 온다. 정기 기록지와 같은 규칙이다.
   * **작성 경로 전용이다**: 수정 경로(updateIntakeRecordAction)는 실려 와도 버린다.
   */
  scheduleId?: string;
  expectedScheduleVersion?: number;
  /**
   * 전체 목표(D62 · CCC-68). 인테이크 기록 화면이 주 입력 자리다. 세 값이 구분된다:
   * undefined = 서버 현재값에서 안 바뀜(호출 안 함) / null = 지움(설정 전으로) / 문자열 = 새 값.
   * 위저드가 서버 프리필과 비교해 바뀐 경우에만 싣는다 — 안 바뀐 저장마다 감사·이력이
   * 쌓이지 않게 한다. 저장은 인테이크 기록과 별개 호출(setSupportCaseOverallGoal)이라
   * 이력·권한·감사는 그쪽 게이트웨이가 갖는다.
   */
  overallGoal?: string | null;
}

export type IntakeRecordActionResult =
  /** overallGoalSaved: 전체 목표 별개 호출의 결과(D62). 시도하지 않았으면(값 안 바뀜) true. */
  | { status: 'saved'; overallGoalSaved: boolean }
  | { status: 'replayed'; overallGoalSaved: boolean }
  | { status: Notice };

const INTAKE_SUBMISSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export async function createIntakeRecordAction(
  input: CreateIntakeRecordActionInput,
): Promise<IntakeRecordActionResult> {
  try {
    assertScheduleTargetScope(input.beneficiaryId, input.supportCaseId);
    if (!INTAKE_SUBMISSION_UUID.test(input.submissionId)) throw new FormInputError();
    const heldAt = new Date(input.heldAt);
    if (Number.isNaN(heldAt.valueOf())) throw new FormInputError();
    if (input.channel !== 'in_person' && input.channel !== 'phone' && input.channel !== 'video') {
      throw new FormInputError();
    }
    for (const area of input.lifeAreas ?? []) {
      if (
        !(lifeAreaKeys as readonly string[]).includes(area.areaKey)
        || !(lifeAreaStatuses as readonly string[]).includes(area.status)
      ) throw new FormInputError();
    }
    // P3·P4 어휘 검사(CCC-9). 최종 강제는 게이트웨이지만 경계에서도 한 번 거른다.
    for (const answer of input.answers ?? []) {
      if (
        !(intakeAnswerKeys as readonly string[]).includes(answer.key)
        || !(intakeAnswerResponses as readonly string[]).includes(answer.response)
      ) throw new FormInputError();
    }
    if (input.nextMeeting !== undefined) {
      const nextMeetingAt = new Date(input.nextMeeting.heldAt);
      if (Number.isNaN(nextMeetingAt.valueOf())) throw new FormInputError();
    }
    assertIntakeOverallGoalInput(input.overallGoal);
    // 연결 일정 완료(CCC-57). 정기 기록지와 같은 짝 규칙이다. 둘 다 있거나 둘 다 없다.
    // 한쪽만 오면 게이트웨이가 버전 검사를 못 하므로 여기서 막는다.
    const hasSchedule = input.scheduleId !== undefined;
    if (hasSchedule !== (input.expectedScheduleVersion !== undefined)) throw new FormInputError();
    if (input.scheduleId !== undefined && !SCHEDULE_UUID_PATTERN.test(input.scheduleId)) throw new FormInputError();
    if (
      input.expectedScheduleVersion !== undefined
      && (!Number.isSafeInteger(input.expectedScheduleVersion) || input.expectedScheduleVersion < 1)
    ) throw new FormInputError();
    await getParticipantProgram(input.beneficiaryId, input.supportCaseId);
    const managerOpinion = input.managerOpinion?.trim();
    const result = await createIntakeRecord(input.supportCaseId, {
      submissionId: input.submissionId,
      heldAt: heldAt.toISOString(),
      channel: input.channel,
      ...(input.consent === undefined ? {} : { consent: input.consent }),
      ...(input.helpNarrative === undefined ? {} : {
        helpNarrative: {
          todayHelp: input.helpNarrative.todayHelp.trim(),
          hardestPoint: input.helpNarrative.hardestPoint.trim(),
          desiredChange: input.helpNarrative.desiredChange.trim(),
        },
      }),
      ...(input.lifeAreas === undefined ? {} : {
        lifeAreas: input.lifeAreas.map((area) => {
          const note = area.note?.trim();
          return note !== undefined && note.length > 0
            ? { areaKey: area.areaKey, status: area.status, note }
            : { areaKey: area.areaKey, status: area.status };
        }),
      }),
      ...(input.goals === undefined ? {} : {
        goals: input.goals.map((goal) => (
          goal.scaleCriteria !== undefined
            ? { title: goal.title.trim(), scaleCriteria: goal.scaleCriteria }
            : { title: goal.title.trim() }
        )),
      }),
      ...(input.actions === undefined ? {} : { actions: input.actions }),
      ...(input.debts === undefined || input.debts.length === 0 ? {} : { debts: input.debts }),
      ...(input.linkedOrgs === undefined || input.linkedOrgs.length === 0 ? {} : { linkedOrgs: input.linkedOrgs }),
      ...(input.answers === undefined || input.answers.length === 0 ? {} : { answers: input.answers }),
      ...(input.extendedPii === undefined || Object.keys(input.extendedPii).length === 0
        ? {}
        : { extendedPii: input.extendedPii }),
      ...(input.additionalItems === undefined || input.additionalItems.length === 0
        ? {}
        : { additionalItems: input.additionalItems }),
      ...(input.nextMeeting === undefined
        ? {}
        : {
          nextMeeting: {
            heldAt: new Date(input.nextMeeting.heldAt).toISOString(),
            channel: input.nextMeeting.channel,
          },
        }),
      ...(managerOpinion === undefined || managerOpinion.length === 0 ? {} : { managerOpinion }),
      // 연결 일정 완료(CCC-57). 게이트웨이가 소유·상태·버전을 다시 검사하고, 어긋나면
      // 기록 저장 자체가 서지 않는다(버전 검사 유지, 티켓 지시).
      ...(input.scheduleId === undefined || input.expectedScheduleVersion === undefined
        ? {}
        : { scheduleId: input.scheduleId, expectedScheduleVersion: input.expectedScheduleVersion }),
    });
    // 전체 목표(D62 · CCC-68). 인테이크 저장이 선 다음에만 시도한다 — 보조 값의 실패가
    // 주 기록 저장을 막으면 안 된다. 실패해도 인테이크는 저장된 채로, 화면이 15초 페이지
    // 카드(보조 입력 자리)로 안내한다.
    const overallGoalSaved = await saveIntakeOverallGoal(input.supportCaseId, input.overallGoal);
    revalidateParticipantProgram(input.beneficiaryId, input.supportCaseId);
    return { status: result.replayed ? 'replayed' : 'saved', overallGoalSaved };
  } catch (error) {
    return { status: noticeFor(error) };
  }
}

/** 전체 목표 입력 검증(D62). undefined = 안 바뀜, null = 지움, 문자열은 200자 상한(게이트웨이와 동일). */
function assertIntakeOverallGoalInput(overallGoal: string | null | undefined): void {
  if (overallGoal === undefined || overallGoal === null) return;
  if (typeof overallGoal !== 'string' || overallGoal.trim().length > 200) throw new FormInputError();
}

/** 전체 목표 별개 호출(D62). 시도하지 않았으면 true, 시도해서 실패하면 false — 던지지 않는다. */
async function saveIntakeOverallGoal(supportCaseId: string, overallGoal: string | null | undefined): Promise<boolean> {
  if (overallGoal === undefined) return true;
  try {
    const trimmed = overallGoal === null ? null : overallGoal.trim();
    await updateSupportCaseOverallGoal(supportCaseId, trimmed === null || trimmed.length === 0 ? null : trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * 인테이크 수정(2026-08-08 Q "확인/수정"). 위저드가 create 와 같은 입력형으로 부르므로
 * 프런트 검증도 같은 규칙을 쓴다 — 다만 서버로는 수정 경로가 받는 위저드 소유분만 보낸다.
 * submissionId 는 수정 경로에 없다(덮어쓰기는 본질상 멱등이라 재현 보호가 필요 없다).
 *
 * **일정 연결(scheduleId·expectedScheduleVersion)은 실려 와도 버린다**(CCC-57). 수정 경로
 * 파서(parseIntakeUpdate)가 허용 키 목록으로 막고 있어 보내면 요청 전체가 거부된다.
 * 일정 완료는 처음 저장할 때 한 번 하는 일이고, 고쳐 쓰기는 그 자리가 아니다.
 */
export async function updateIntakeRecordAction(
  input: CreateIntakeRecordActionInput,
): Promise<IntakeRecordActionResult> {
  try {
    assertScheduleTargetScope(input.beneficiaryId, input.supportCaseId);
    const heldAt = new Date(input.heldAt);
    if (Number.isNaN(heldAt.valueOf())) throw new FormInputError();
    if (input.channel !== 'in_person' && input.channel !== 'phone' && input.channel !== 'video') {
      throw new FormInputError();
    }
    for (const answer of input.answers ?? []) {
      if (
        !(intakeAnswerKeys as readonly string[]).includes(answer.key)
        || !(intakeAnswerResponses as readonly string[]).includes(answer.response)
      ) throw new FormInputError();
    }
    assertIntakeOverallGoalInput(input.overallGoal);
    await getParticipantProgram(input.beneficiaryId, input.supportCaseId);
    const managerOpinion = input.managerOpinion?.trim();
    await updateIntakeRecord(input.supportCaseId, {
      heldAt: heldAt.toISOString(),
      channel: input.channel,
      ...(input.answers === undefined || input.answers.length === 0 ? {} : { answers: input.answers }),
      ...(input.debts === undefined || input.debts.length === 0 ? {} : { debts: input.debts }),
      ...(input.linkedOrgs === undefined || input.linkedOrgs.length === 0 ? {} : { linkedOrgs: input.linkedOrgs }),
      ...(input.additionalItems === undefined || input.additionalItems.length === 0
        ? {}
        : { additionalItems: input.additionalItems }),
      ...(managerOpinion === undefined || managerOpinion.length === 0 ? {} : { managerOpinion }),
    });
    // 전체 목표(D62 · CCC-68). 작성 경로와 같은 규칙 — 바뀐 경우에만 실려 오고, 실패해도
    // 인테이크 수정은 저장된 채다.
    const overallGoalSaved = await saveIntakeOverallGoal(input.supportCaseId, input.overallGoal);
    revalidateParticipantProgram(input.beneficiaryId, input.supportCaseId);
    return { status: 'saved', overallGoalSaved };
  } catch (error) {
    return { status: noticeFor(error) };
  }
}

export async function createCounselingRecordAction(
  formData: FormData,
): Promise<CounselingRecordActionResult> {
  try {
    const beneficiaryId = participantId(formData, 'beneficiaryId');
    const supportCaseId = opaqueId(formData, 'supportCaseId');
    await getParticipantProgram(beneficiaryId, supportCaseId);
    const channel = requiredValue(formData, 'channel');
    if (channel !== 'in_person' && channel !== 'phone' && channel !== 'video') throw new FormInputError();

    const scheduleId = optionalOpaqueId(formData, 'scheduleId');
    const scheduleVersionValue = value(formData, 'expectedScheduleVersion');
    if ((scheduleId === undefined) !== (scheduleVersionValue.length === 0)) throw new FormInputError();

    const gasScores = parseManualGasScores(formData);
    const lifeAreas = parseManualLifeAreas(formData);
    const details = parseManualRecordDetails(formData);
    const result = await createCounselingRecord(supportCaseId, {
      submissionId: submissionId(formData),
      heldAt: canonicalUtcDateTime(formData, 'heldAt'),
      channel,
      memo: requiredValue(formData, 'memo'),
      gasScores,
      actions: parseManualActionItems(formData),
      flags: parseManualFlags(formData),
      actionResolutions: parseManualActionItemResolutions(formData),
      ...(lifeAreas === undefined ? {} : { lifeAreas }),
      ...(details === undefined ? {} : { details }),
      ...(scheduleId === undefined
        ? {}
        : { scheduleId, expectedScheduleVersion: positiveInteger(formData, 'expectedScheduleVersion') }),
    });
    revalidateParticipantProgram(beneficiaryId, supportCaseId);
    return { status: result.replayed ? 'replayed' : 'saved' };
  } catch (error) {
    return { status: noticeFor(error) };
  }
}
