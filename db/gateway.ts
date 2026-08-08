/**
 * db/gateway.ts — D1 접근 단일 관문 (R1) · 시그니처 초안 v0.1
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 이 파일은 D1 접근 단일 관문으로, 권한 검사·감사 로그·PII 보호를 함께 강제한다.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * 규칙 (CLAUDE.md 4장):
 *   R1  모든 D1 조회·쓰기는 이 파일의 공용 함수만 거친다.
 *       다른 파일에서 env.DB.prepare 직접 호출 금지 (Guard Hook이 커밋 차단).
 *   공통 계약 — 모든 공개 함수는 내부에서 반드시:
 *     1. org_id 일치 검사 (D1: 멀티테넌트 대비)
 *     2. 접근 권한 검사 (D7: 관리자이거나 case_assignees 활성 담당 실무자)
 *     3. audit_log 기록 (D14: 열람 포함 전부, append-only)
 *   을 수행한다. 조회 함수는 추가로:
 *     4. R2 승인 필터 — approved_at이 NULL인 AI 산출물(ai_*)은
 *        브리핑·통계·보고서용 조회 결과에서 제외하거나 '승인 대기'로만 표시.
 */

import { ANIMAL_SLUGS, ANIMAL_SLUG_KOREAN_NAMES, isBeneficiaryId } from './animal-slugs';
import { CONSENT_TEXT_AI_NOTICE_TEXT, CONSENT_TEXT_AI_NOTICE_VERSION } from './consent-notice';

// ── 환경 타입 ───────────────────────────────────────────────────────────────
export interface Env {
  DB: D1Database;
  /**
   * PII 암호화 키 (D3): AES-GCM 256bit, base64.
   * Cloudflare Workers 시크릿으로만 주입한다. 코드·로그·에러 메시지 출력 금지 (R3).
   */
  PII_ENC_KEY: string;
  /**
   * PII 암호화 키 세대. 키 순환 시 암호문과 함께 어느 키로 암호화했는지 식별한다.
   * 미설정은 기존 기본 키 세대(1)를 뜻한다.
   */
  PII_KEY_VERSION?: string;
  /**
   * D8 파이프라인 무폴링 판정 임계값(시간). 미설정이면 PIPELINE_STALE_HOURS_DEFAULT(6).
   * wrangler.toml [vars] 또는 Workers 환경 변수로 주입한다(문자열).
   */
  PIPELINE_STALE_HOURS?: string;
  /**
   * Phase 1 텍스트 AI 파일럿 전역 중지 스위치. 정확히 '1'일 때만 새 증적·초안·검토를
   * 허용한다. 기본값과 다른 모든 값은 수기 전용으로 fail-closed 한다.
   */
  TEXT_AI_PILOT_ENABLED?: string;
}

// ── 호출자(Actor) ───────────────────────────────────────────────────────────

export type Role =
  | 'admin'      // 관리자: 기관 내 전체 케이스 + PII 복호화 권한
  | 'counselor'  // 실무자: 자기 담당 케이스만 (case_assignees 활성 행 기준, D7)
  | 'service';   // Mac Mini 파이프라인 (Access 서비스 토큰, D13):
                 // ingest 계열 함수만 호출 가능, 그 외 전부 거부

/** Cloudflare Access가 검증한 호출자. 모든 gateway 함수의 첫 인자. */
export interface Actor {
  userId: string; // Access 이메일 또는 서비스 토큰 식별자
  orgId: string;
  role: Role;
}

// ── 공통 에러 ───────────────────────────────────────────────────────────────

/** 권한 없음: org 불일치, 비담당 케이스 접근, 역할 위반 등 (D7) */
export class ForbiddenError extends Error {}
/** R2 위반: 미승인 AI 산출물을 공식 경로로 요청 */
export class NotApprovedError extends Error {}
/** 요청 값이 시스템 규칙을 만족하지 않을 때 반환한다. */
export class ValidationError extends Error {}
/** Phase 1 파일럿 증적이 없어서 텍스트 AI를 시작·검토할 수 없다. */
export class PilotTextAiConsentRequiredError extends Error {
  readonly code = 'pilot_text_ai_consent_required';
  readonly statusCode = 409;

  constructor() {
    super('pilot_text_ai_consent_required');
  }
}
/** Phase 1 파일럿이 전역 중지되어 새 텍스트 AI 작업을 할 수 없다. */
export class TextAiPilotDisabledError extends Error {
  readonly code = 'text_ai_pilot_disabled';
  readonly statusCode = 409;

  constructor() {
    super('text_ai_pilot_disabled');
  }
}
/** 호출자가 현재 초안이 아닌 버전을 전이하려 했다. */
export class StaleDraftVersionError extends Error {
  readonly code = 'stale_draft_version';
  readonly statusCode = 409;

  constructor() {
    super('stale_draft_version');
  }
}
/** 레거시 승인 호환 경로에 필요한 불변 초안 버전이 빠졌다. */
export class DraftVersionRequiredError extends Error {
  readonly code = 'draft_version_required';
  readonly statusCode = 409;

  constructor() {
    super('draft_version_required');
  }
}
/** 생성 AI 초안을 공식화할 마스킹 근거 링크가 없다. */
export class GroundedEvidenceRequiredError extends Error {
  readonly code = 'grounded_evidence_required';
  readonly statusCode = 409;

  constructor() {
    super('grounded_evidence_required');
  }
}
/** 파일럿용 Privacy/Security 승인 provider 설정이 활성화되지 않았다. */
export class AiProviderNotConfiguredError extends Error {
  readonly code = 'ai_provider_not_configured';
  readonly statusCode = 409;

  constructor() {
    super('ai_provider_not_configured');
  }
}

/**
 * ① 개인정보 수집·이용 동의 없이 등록하려 했다 (G1 · 2026-07-29 Q 결정1).
 * 긴급 등록(사유 필수)만이 예외이며, 그 경로를 화면이 안내할 수 있도록 코드를 따로 둔다 —
 * 'invalid_request' 로 뭉치면 화면에서 원인 없는 실패로 보인다(게이트 문서 §2 G1).
 */
export class PrivacyConsentRequiredError extends Error {
  readonly code = 'privacy_consent_required';
  readonly statusCode = 422;

  constructor() {
    super('privacy_consent_required');
  }
}
/** 긴급 등록을 골랐는데 사유가 비었다 (G1). 사유 없는 예외는 기록 없는 우회다. */
export class EmergencyReasonRequiredError extends Error {
  readonly code = 'emergency_reason_required';
  readonly statusCode = 422;

  constructor() {
    super('emergency_reason_required');
  }
}

// ── 설정 상수 ───────────────────────────────────────────────────────────────

/**
 * 긴급 등록 시 ① 개인정보 동의를 보완해야 하는 기한(일). G1 의 **설정값**이다 —
 * 법률 검토가 재개되면(2026-07-30 Q 결정으로 MVP 범위에서는 종료) 이 숫자만 바꾼다.
 * 기관별 설정으로 나누지 않는다(전역 1개, G2 의 보존 상한과 같은 태도).
 */
export const EMERGENCY_CONSENT_GRACE_DAYS = 14;

/**
 * D8 무폴링 판정 기본 임계값(시간). env.PIPELINE_STALE_HOURS로 덮어쓸 수 있다.
 * Mac Mini가 이 시간 이상 poll_pipeline을 남기지 않으면 stale로 판정한다.
 */
export const PIPELINE_STALE_HOURS_DEFAULT = 6;

/**
 * 시스템(HTTP 행위자 없는 cron) 컨텍스트가 감사 로그에 남기는 actor_id.
 * audit_log.actor_role CHECK는 admin|counselor|service만 허용하므로 역할은 'service'를
 * 쓰고, 사람/파이프라인 서비스와 구분은 이 actor_id로 한다 (D14).
 *   - 워치독 점검(watchdog_check): 읽기 전용, scheduled 핸들러에서만 호출.
 *   - 자동 파기(purge_pii): purge_due 경과분 일괄 처리, scheduled 핸들러에서만 호출.
 */
export const WATCHDOG_ACTOR_ID = 'system:watchdog';
export const PURGE_ACTOR_ID = 'system:purge';

/** 케이스당 활성 목표 상한 (CLAUDE.md 3장) */
export const MAX_ACTIVE_GOALS = 3;

/** D9 리스크 플래그 고정 유형 목록 — 유일 출처. FlagType·toFlagType이 이 배열을 따른다. */
export const FLAG_TYPES = [
  'crisis_utterance',
  'contact_loss_risk',
  'housing_livelihood_shock',
  'debt_deterioration',
  'repeated_noncompliance',
] as const;

type DbRow = Record<string, unknown>;

function now(): string {
  return new Date().toISOString();
}

function newId(): string {
  return crypto.randomUUID();
}

/**
 * audit_log.created_at은 SQLite DEFAULT (datetime('now')) 형식이다:
 * 'YYYY-MM-DD HH:MM:SS' (공백 구분, UTC, 소수·타임존 접미사 없음).
 * JS의 Date는 공백 구분 문자열을 로컬 시간으로 해석하므로, 'T'로 바꾸고 'Z'를
 * 붙여 UTC로 강제 파싱한다. (Date.now()와 비교하려면 반드시 UTC여야 한다.)
 * 유효하지 않으면 NaN을 반환한다.
 */
function parseSqliteUtc(value: string): number {
  return Date.parse(value.replace(' ', 'T') + 'Z');
}

/** HTTP 행위자 없는 cron 컨텍스트용 감사 행위자. 역할은 'service'(CHECK 허용값). */
function systemActor(userId: string, orgId: string): Actor {
  return { userId, orgId, role: 'service' };
}

/** D8 임계값(시간) 해석: env.PIPELINE_STALE_HOURS(양수) 우선, 없거나 부적합하면 기본값. */
function resolvePipelineStaleHours(env: Env): number {
  const raw = env.PIPELINE_STALE_HOURS;
  if (raw === undefined) {
    return PIPELINE_STALE_HOURS_DEFAULT;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : PIPELINE_STALE_HOURS_DEFAULT;
}

/**
 * D1(SQLite)의 PRIMARY KEY·UNIQUE 제약 위반 에러인지 판별한다.
 * cases.id 순번 발급의 read-then-insert 경합을 재시도로 흡수할 때 쓴다.
 */
function isUniqueConstraintError(error: unknown): boolean {
  const code = error !== null && typeof error === 'object' && 'code' in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return /\b(?:UNIQUE constraint failed|PRIMARY KEY constraint failed)\b/i.test(message);
}
function isStaleDraftVersionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /stale_draft_version/i.test(message);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function parseJson<T>(value: unknown): T | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function stringifyJson(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? 'null' : encoded;
}

function toCaseStatus(value: unknown): Case['status'] {
  return value === 'closed' ? 'closed' : 'active';
}

function toAssigneeRole(value: unknown): Assignee['role'] {
  return value === 'secondary' ? 'secondary' : 'primary';
}

function toRole(value: unknown): Role {
  if (value === 'admin' || value === 'service') {
    return value;
  }

  return 'counselor';
}

function mapCase(row: DbRow): Case {
  return {
    id: stringValue(row.id),
    orgId: stringValue(row.org_id),
    programType: stringValue(row.program_type),
    status: toCaseStatus(row.status),
    intakeAt: nullableString(row.intake_at),
    consentRecordingAt: nullableString(row.consent_recording_at),
    consentTextAiAt: nullableString(row.consent_text_ai_at),
    closedAt: nullableString(row.closed_at),
    closedReason: nullableString(row.closed_reason),
    purgeDue: nullableString(row.purge_due),
    extra: parseJson<Record<string, unknown>>(row.extra),
  };
}

function mapAssignee(row: DbRow): Assignee {
  return {
    caseId: stringValue(row.case_id),
    userId: stringValue(row.user_id),
    role: toAssigneeRole(row.role),
    assignedAt: stringValue(row.assigned_at),
    unassignedAt: nullableString(row.unassigned_at),
  };
}

function toGoalStatus(value: unknown): Goal['status'] {
  return value === 'closed' ? 'closed' : 'active';
}

function toAiStatus(value: unknown): AiStatus {
  if (value === 'uploaded' || value === 'processing' || value === 'review_ready' || value === 'approved') {
    return value;
  }

  return 'none';
}

function toChannel(value: unknown): Session['channel'] {
  if (value === 'phone' || value === 'video') {
    return value;
  }

  return 'in_person';
}

export function toFlagType(value: unknown): FlagType {
  if ((FLAG_TYPES as readonly string[]).includes(value as string)) {
    return value as FlagType;
  }

  throw new ValidationError('flag type is not allowed');
}

function toFlagSource(value: unknown): Flag['source'] {
  return value === 'counselor' ? 'counselor' : 'ai';
}

function toReviewStatus(value: unknown): Flag['reviewStatus'] {
  if (value === 'confirmed' || value === 'rejected') {
    return value;
  }

  return 'pending';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function parseContrast(value: unknown): ContrastResult | null {
  const parsed = parseJson<Partial<ContrastResult>>(value);

  if (
    parsed === null
    || !isStringArray(parsed.missingFromMemo)
    || !isStringArray(parsed.missingFromAudio)
    || !isStringArray(parsed.undiscussedGoals)
  ) {
    return null;
  }

  return {
    missingFromMemo: parsed.missingFromMemo,
    missingFromAudio: parsed.missingFromAudio,
    undiscussedGoals: parsed.undiscussedGoals,
  };
}


function mapGoal(row: DbRow): Goal {
  return {
    id: stringValue(row.id),
    caseId: stringValue(row.case_id),
    title: stringValue(row.title),
    scaleCriteria: parseJson<unknown>(row.scale_criteria),
    status: toGoalStatus(row.status),
    closedReason: nullableString(row.closed_reason),
    closedAt: nullableString(row.closed_at),
    replacedByGoalId: nullableString(row.replaced_by_goal_id),
  };
}

function mapSession(row: DbRow): Session {
  return {
    id: stringValue(row.id),
    caseId: stringValue(row.case_id),
    counselorId: stringValue(row.counselor_id),
    heldAt: stringValue(row.held_at),
    channel: toChannel(row.channel),
    memo: nullableString(row.memo),
    aiStatus: toAiStatus(row.ai_status),
    transcript: nullableString(row.transcript),
    audioR2Key: nullableString(row.audio_r2_key),
    aiSummary: nullableString(row.ai_summary),
    aiSchema: parseJson<unknown>(row.ai_schema),
    aiContrast: parseContrast(row.ai_contrast),
    emotionScores: parseJson<unknown>(row.emotion_scores),
    speakerMappingConfirmedAt: nullableString(row.speaker_mapping_confirmed_at),
    approvedAt: nullableString(row.approved_at),
    approvedBy: nullableString(row.approved_by),
    extra: parseJson<Record<string, unknown>>(row.extra),
  };
}

function officialSession(session: Session): Session {
  return {
    ...session,
    transcript: null,
    audioR2Key: null,
    aiSummary: null,
    aiSchema: null,
    aiContrast: null,
    emotionScores: null,
    speakerMappingConfirmedAt: null,
  };
}

function mapActionItem(row: DbRow): ActionItem {
  const owner = row.owner;
  return {
    id: stringValue(row.id),
    caseId: stringValue(row.case_id),
    sessionId: nullableString(row.session_id),
    description: stringValue(row.description),
    owner: owner === 'beneficiary' || owner === 'org' ? owner : 'counselor',
    dueDate: nullableString(row.due_date),
    resolvedAt: nullableString(row.resolved_at),
  };
}

function mapFlag(row: DbRow): Flag {
  return {
    id: stringValue(row.id),
    caseId: stringValue(row.case_id),
    sessionId: nullableString(row.session_id),
    flagType: toFlagType(row.flag_type),
    quote: nullableString(row.quote),
    source: toFlagSource(row.source),
    reviewStatus: toReviewStatus(row.review_status),
    reviewedBy: nullableString(row.reviewed_by),
    reviewedAt: nullableString(row.reviewed_at),
  };
}

function mapGasScore(row: DbRow): GasScore {
  const rawScore = typeof row.score === 'number' ? row.score : Number.parseInt(stringValue(row.score), 10);
  const score = rawScore === -2 || rawScore === -1 || rawScore === 0 || rawScore === 1 || rawScore === 2 ? rawScore : 0;
  return {
    sessionId: stringValue(row.session_id),
    goalId: stringValue(row.goal_id),
    score,
    evidenceQuote: nullableString(row.evidence_quote),
    scoredBy: stringValue(row.scored_by),
  };
}
const SHA256_HEX = /^[a-f0-9]{64}$/;
const OPAQUE_IDENTIFIER = /^[^\s\x00-\x1F\x7F-\x9F]{1,128}$/;
const OPAQUE_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const VERSION_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function integerValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === 'string' && /^-?\d+$/.test(value)) {
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  return null;
}

function nullableInteger(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return integerValue(value);
}

function toAiDraftOrigin(value: unknown): AiDraftOrigin {
  if (value === 'generated' || value === 'legacy_import') {
    return value;
  }

  throw new ValidationError('AI draft origin is invalid');
}
function toAiDraftCreationMode(value: unknown): AiDraftCreationMode {
  if (value === 'provider_generated' || value === 'human_edited' || value === 'legacy_import') {
    return value;
  }

  throw new ValidationError('AI draft creation mode is invalid');
}


function toAiDraftGroundingStatus(value: unknown): AiDraftGroundingStatus {
  if (value === 'grounded' || value === 'legacy_unverified') {
    return value;
  }

  throw new ValidationError('AI draft grounding status is invalid');
}

function toAiReviewDecision(value: unknown): AiReviewDecision | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value === 'approved' || value === 'rejected' || value === 'superseded') {
    return value;
  }

  throw new ValidationError('AI review decision is invalid');
}

function mapPilotTextAiConsentEvidence(row: DbRow): PilotTextAiConsentEvidence {
  return {
    id: stringValue(row.id),
    caseId: stringValue(row.case_id),
    noticeVersion: stringValue(row.notice_version),
    noticeSha256: stringValue(row.notice_sha256),
    evidenceRef: stringValue(row.evidence_ref),
    evidenceSha256: stringValue(row.evidence_sha256),
    capturedBy: stringValue(row.captured_by),
    effectiveAt: stringValue(row.effective_at),
    createdAt: stringValue(row.created_at),
  };
}
function mapAiWorkItem(row: DbRow): AiWorkItem {
  return {
    id: stringValue(row.work_item_id ?? row.id),
    caseId: stringValue(row.case_id),
    sessionId: stringValue(row.session_id),
    kind: stringValue(row.kind),
    createdAt: stringValue(row.created_at),
  };
}

function mapMaskedSourceEvidenceItem(row: DbRow): MaskedSourceEvidenceItem {
  const sourceStart = integerValue(row.source_start);
  const sourceEnd = integerValue(row.source_end);
  if (
    sourceStart === null
    || sourceEnd === null
    || sourceStart < 0
    || sourceEnd <= sourceStart
  ) {
    throw new ValidationError('masked source evidence positions are invalid');
  }

  return {
    id: stringValue(row.id),
    snapshotId: stringValue(row.snapshot_id),
    sourceRef: stringValue(row.source_ref),
    sourceSha256: stringValue(row.source_sha256),
    evidenceQuote: stringValue(row.evidence_quote),
    sourceStart,
    sourceEnd,
    createdAt: stringValue(row.created_at),
  };
}

function mapMaskedSourceSnapshot(
  row: DbRow,
  evidence: MaskedSourceEvidenceItem[] = [],
): MaskedSourceSnapshot {
  return {
    id: stringValue(row.id),
    caseId: stringValue(row.case_id),
    sessionId: stringValue(row.session_id),
    maskedText: stringValue(row.masked_text),
    sha256: stringValue(row.sha256),
    maskingPipelineVersion: stringValue(row.masking_pipeline_version),
    createdAt: stringValue(row.created_at),
    evidence,
  };
}

function mapAiEvidenceLink(row: DbRow): AiEvidenceLink {
  const sourceStart = integerValue(row.source_start);
  const sourceEnd = integerValue(row.source_end);
  if (
    sourceStart === null
    || sourceEnd === null
    || sourceStart < 0
    || sourceEnd <= sourceStart
  ) {
    throw new ValidationError('AI evidence positions are invalid');
  }

  return {
    id: stringValue(row.id),
    draftVersionId: stringValue(row.draft_version_id),
    sourceEvidenceItemId: stringValue(row.source_evidence_item_id),
    claimKey: stringValue(row.claim_key),
    evidenceQuote: stringValue(row.evidence_quote),
    sourceRef: stringValue(row.source_ref),
    sourceStart,
    sourceEnd,
    createdAt: stringValue(row.created_at),
  };
}

function mapAiDraftVersion(row: DbRow, evidence: AiEvidenceLink[] = []): AiDraftVersion {
  const version = integerValue(row.version);
  if (version === null || version < 1) {
    throw new ValidationError('AI draft version is invalid');
  }
  const origin = toAiDraftOrigin(row.origin);
  const questions = parseAiDraftQuestions(row.questions_json, origin);

  return {
    id: stringValue(row.draft_id ?? row.id),
    workItemId: stringValue(row.work_item_id),
    caseId: stringValue(row.case_id),
    sessionId: stringValue(row.session_id),
    kind: stringValue(row.kind),
    version,
    parentVersionId: nullableString(row.parent_version_id),
    summaryText: stringValue(row.summary_text),
    oneLiner: nullableString(row.one_liner),
    questions,
    sourceSnapshotId: nullableString(row.source_snapshot_id),
    sourceSnapshotHash: nullableString(row.source_snapshot_hash),
    consentEvidenceId: nullableString(row.consent_evidence_id),
    providerConfigId: nullableString(row.provider_config_id),
    modelId: nullableString(row.model_id),
    promptVersion: nullableString(row.prompt_version),
    schemaVersion: nullableString(row.schema_version),
    origin,
    creationMode: toAiDraftCreationMode(row.creation_mode),
    groundingStatus: toAiDraftGroundingStatus(row.grounding_status),
    createdBy: nullableString(row.created_by),
    createdAt: stringValue(row.created_at),
    reviewDecision: toAiReviewDecision(row.review_decision),
    reviewedBy: nullableString(row.reviewed_by),
    reviewedAt: nullableString(row.reviewed_at),
    replacementDraftId: nullableString(row.replacement_draft_id),
    evidence,
  };
}

function mapApprovedAiBriefing(row: DbRow): ApprovedAiBriefing {
  const version = integerValue(row.draft_version ?? row.version);
  if (version === null || version < 1) {
    throw new ValidationError('approved AI briefing version is invalid');
  }
  const origin = toAiDraftOrigin(row.origin);
  const questions = parseAiDraftQuestions(row.questions_json, origin);

  return {
    workItemId: stringValue(row.work_item_id),
    draftVersionId: stringValue(row.draft_version_id),
    caseId: stringValue(row.case_id),
    sessionId: stringValue(row.session_id),
    version,
    summaryText: stringValue(row.summary_text),
    oneLiner: nullableString(row.one_liner),
    questions,
    origin,
    groundingStatus: toAiDraftGroundingStatus(row.grounding_status),
    approvedBy: stringValue(row.approved_by),
    approvedAt: stringValue(row.approved_at),
  };
}
function parseOpaqueReferenceList(value: unknown): string[] {
  const parsed = parseJson<unknown>(value);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((item) => typeof item !== 'string' || !OPAQUE_REFERENCE.test(item))) {
    throw new ValidationError('AI provider approval references are invalid');
  }

  return parsed;
}

function mapAiProviderConfiguration(row: DbRow): AiProviderConfiguration {
  return {
    id: stringValue(row.config_id ?? row.id),
    adapterId: stringValue(row.adapter_id),
    adapterVersion: stringValue(row.adapter_version),
    configHash: stringValue(row.config_hash),
    approvalRefs: parseOpaqueReferenceList(row.approval_refs_json),
    createdBy: stringValue(row.created_by),
    createdAt: stringValue(row.created_at),
  };
}

function mapActiveAiProviderConfiguration(row: DbRow): ActiveAiProviderConfiguration {
  return {
    ...mapAiProviderConfiguration(row),
    activationId: stringValue(row.activation_id),
    activatedBy: stringValue(row.activated_by),
    activatedAt: stringValue(row.activated_at),
  };
}

function isPilotTextAiEnabled(env: Env): boolean {
  return env.TEXT_AI_PILOT_ENABLED === '1';
}

function assertOpaqueIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !OPAQUE_IDENTIFIER.test(value)) {
    throw new ValidationError(`${field} is invalid`);
  }
}
function activePiiKeyVersion(env: Env): number {
  if (env.PII_KEY_VERSION === undefined) {
    return 1;
  }

  if (!/^[1-9][0-9]*$/.test(env.PII_KEY_VERSION)) {
    throw new ValidationError('PII key version is invalid');
  }

  const version = Number(env.PII_KEY_VERSION);
  if (!Number.isSafeInteger(version)) {
    throw new ValidationError('PII key version is invalid');
  }

  return version;
}

function assertOpaqueReference(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !OPAQUE_REFERENCE.test(value)) {
    throw new ValidationError(`${field} is invalid`);
  }
}

function assertSha256(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !SHA256_HEX.test(value)) {
    throw new ValidationError(`${field} must be a SHA-256 hex digest`);
  }
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sourceTextSpan(value: string, start: number, end: number): string {
  return Array.from(value).slice(start, end).join('');
}

function assertVersionIdentifier(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !VERSION_IDENTIFIER.test(value)) {
    throw new ValidationError(`${field} is invalid`);
  }
}

function assertRequiredText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} is required`);
  }
}
const MIN_GENERATED_AI_DRAFT_QUESTIONS = 2;
const MAX_GENERATED_AI_DRAFT_QUESTIONS = 3;
// D45 영역 ②: 회차 줄에 앉는 "핵심 한 줄" — 개행 없는 한 문장, 브리핑 훑기용 상한.
const MAX_AI_ONE_LINER_LENGTH = 120;

function assertAiOneLiner(value: unknown, required: boolean): asserts value is string | null | undefined {
  if (value === null || value === undefined) {
    if (required) throw new ValidationError('AI one-liner is required');
    return;
  }
  assertRequiredText(value, 'AI one-liner');
  if (value.includes('\n') || value.length > MAX_AI_ONE_LINER_LENGTH) {
    throw new ValidationError('AI one-liner must be a single line of 120 characters or fewer');
  }
}

function questionClaimKey(index: number): string {
  return `question_${index + 1}`;
}
function isQuestionClaimKey(value: string): boolean {
  return /^question_[0-9].*$/.test(value);
}

/**
 * 저장분 한 항목을 구조화 제안으로 정규화한다 (CCC-39·D45).
 * v1 저장분은 단문 질문 문자열 — reason 없이 제목만 있는 제안으로 읽는다.
 */
function normalizeAiBriefingSuggestion(item: unknown): AiBriefingSuggestion {
  if (typeof item === 'string') {
    return { title: item, reason: null };
  }
  if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
    const record = item as Record<string, unknown>;
    if (
      Object.keys(record).every((key) => key === 'title' || key === 'reason')
      && typeof record.title === 'string'
      && (typeof record.reason === 'string' || record.reason === null)
    ) {
      return { title: record.title, reason: record.reason ?? null };
    }
  }
  throw new ValidationError('AI briefing suggestion is invalid');
}

function assertGeneratedAiDraftQuestions(value: unknown): asserts value is AiBriefingSuggestion[] {
  if (
    !Array.isArray(value)
    || value.length < MIN_GENERATED_AI_DRAFT_QUESTIONS
    || value.length > MAX_GENERATED_AI_DRAFT_QUESTIONS
  ) {
    throw new ValidationError('AI briefing questions must contain two or three items');
  }

  const titles = new Set<string>();
  for (const item of value) {
    const suggestion = normalizeAiBriefingSuggestion(item);
    assertRequiredText(suggestion.title, 'AI briefing suggestion title');
    if (suggestion.reason !== null) {
      assertRequiredText(suggestion.reason, 'AI briefing suggestion reason');
    }
    if (titles.has(suggestion.title)) {
      throw new ValidationError('AI briefing questions must be unique');
    }
    titles.add(suggestion.title);
  }
}

function parseAiDraftQuestions(value: unknown, origin: AiDraftOrigin): AiBriefingSuggestion[] {
  const parsed = parseJson<unknown>(value);
  if (origin === 'legacy_import') {
    if (!Array.isArray(parsed) || parsed.length !== 0) {
      throw new ValidationError('legacy AI draft questions must be empty');
    }
    return [];
  }

  if (!Array.isArray(parsed)) {
    throw new ValidationError('AI briefing questions must contain two or three items');
  }
  const normalized = parsed.map(normalizeAiBriefingSuggestion);
  assertGeneratedAiDraftQuestions(normalized);
  return normalized;
}

/**
 * 저장·프러버넌스 비교용 직렬화. v1 단문(reason=null)은 문자열로 되돌려
 * 저장 형태를 왕복시킨다 — human_edited 새 버전이 부모의 questions_json 과
 * 바이트 단위로 같아야 하는 DB 가드(0026 · parent.questions_json IS NEW.questions_json)와 맞춘다.
 */
function questionsToJson(questions: AiBriefingSuggestion[]): string {
  return stringifyJson(questions.map((suggestion) => (
    suggestion.reason === null
      ? suggestion.title
      : { title: suggestion.title, reason: suggestion.reason }
  )));
}
function assertTimestamp(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new ValidationError(`${field} is invalid`);
  }
}

function canonicalEffectiveTimestamp(value: unknown, field: string): string {
  assertTimestamp(value, field);
  const canonical = new Date(value).toISOString();
  if (value !== canonical || Date.parse(canonical) > Date.now() + 5 * 60 * 1000) {
    throw new ValidationError(`${field} must be a canonical UTC time that is not in the future`);
  }
  return canonical;
}

function assertHuman(actor: Actor): void {
  if (actor.role === 'service') {
    throw new ForbiddenError('service role is not allowed for this action');
  }
}

function assertAdmin(actor: Actor): void {
  if (actor.role !== 'admin') {
    throw new ForbiddenError('admin role is required');
  }
}

interface LegacyCaseContext {
  caseRecord: Case;
  supportCaseId: string;
  beneficiaryId: string;
}

/**
 * Resolves a Phase-1 public case id only through the published legacy edge.
 * Compatibility exports keep accepting A### ids, while all child-table access
 * remains scoped to the canonical SupportCase id.
 */
async function resolveLegacyCaseContext(
  env: Env,
  orgId: string,
  caseId: string,
): Promise<LegacyCaseContext> {
  const row = await env.DB.prepare(
    `SELECT
       COALESCE(support_case.legacy_case_id, support_case.id) AS id,
       support_case.org_id,
       support_case.program_type,
       support_case.status,
       support_case.intake_at,
       support_case.consent_recording_at,
       support_case.consent_text_ai_at,
       support_case.closed_at,
       support_case.closed_reason,
       vault.purge_due,
       support_case.extra,
       support_case.id AS support_case_id,
       support_case.beneficiary_id
     FROM support_cases AS support_case
     JOIN beneficiaries AS beneficiary
       ON beneficiary.id = support_case.beneficiary_id
      AND beneficiary.org_id = support_case.org_id
     LEFT JOIN participant_pii_vault AS vault
       ON vault.beneficiary_id = support_case.beneficiary_id
      AND vault.org_id = support_case.org_id
     WHERE (support_case.legacy_case_id = ? OR support_case.id = ?)
       AND support_case.org_id = ?
       AND beneficiary.initialization_state = 'complete'`,
  ).bind(caseId, caseId, orgId).first<DbRow>();

  if (row === null) {
    throw new ForbiddenError('case is not available in this organization');
  }

  return {
    caseRecord: mapCase(row),
    supportCaseId: stringValue(row.support_case_id),
    beneficiaryId: stringValue(row.beneficiary_id),
  };
}

async function getCaseForOrg(env: Env, orgId: string, caseId: string): Promise<Case> {
  return (await resolveLegacyCaseContext(env, orgId, caseId)).caseRecord;
}

async function assertCaseAccess(env: Env, actor: Actor, caseId: string): Promise<Case> {
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);

  if (actor.role === 'admin') {
    return context.caseRecord;
  }

  if (actor.role !== 'counselor') {
    throw new ForbiddenError('service role cannot access case records');
  }

  const assignment = await env.DB.prepare(
    'SELECT id FROM support_case_assignees WHERE org_id = ? AND support_case_id = ? AND user_id = ? AND unassigned_at IS NULL',
  )
    .bind(actor.orgId, context.supportCaseId, actor.userId)
    .first<{ id: string }>();

  if (assignment === null) {
    throw new ForbiddenError('active case assignment is required');
  }

  return context.caseRecord;
}

async function getCaseForAdmin(env: Env, actor: Actor, caseId: string): Promise<Case> {
  assertAdmin(actor);
  return getCaseForOrg(env, actor.orgId, caseId);
}

async function writeAudit(
  env: Env,
  actor: Actor,
  entry: {
    action: string;
    targetTable: string;
    targetId?: string | null;
    caseId?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO audit_log (org_id, actor_id, actor_role, action, target_table, target_id, case_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))',
  )
    .bind(
      actor.orgId,
      actor.userId,
      actor.role,
      entry.action,
      entry.targetTable,
      entry.targetId ?? null,
      entry.caseId ?? null,
      entry.detail === undefined ? null : stringifyJson(entry.detail),
    )
    .run();
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function bytesToBase64(value: Uint8Array): string {
  let binary = '';

  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

async function piiKey(env: Env): Promise<CryptoKey> {
  const rawKey = base64ToBytes(env.PII_ENC_KEY);

  if (rawKey.byteLength !== 32) {
    throw new ValidationError('PII encryption key must be a 32-byte base64 value');
  }

  return crypto.subtle.importKey('raw', toArrayBuffer(rawKey), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptPii(env: Env, value: string | null): Promise<string | null> {
  if (value === null) {
    return null;
  }

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(value);
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      await piiKey(env),
      toArrayBuffer(encoded),
    ),
  );
  const packed = new Uint8Array(iv.byteLength + encrypted.byteLength);
  packed.set(iv);
  packed.set(encrypted, iv.byteLength);
  return bytesToBase64(packed);
}


async function decryptPii(env: Env, value: string | null): Promise<string | null> {
  if (value === null) {
    return null;
  }

  const packed = base64ToBytes(value);
  const iv = packed.slice(0, 12);
  const ciphertext = packed.slice(12);

  if (iv.byteLength !== 12 || ciphertext.byteLength === 0) {
    throw new ValidationError('stored PII ciphertext is invalid');
  }

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    await piiKey(env),
    toArrayBuffer(ciphertext),
  );
  return new TextDecoder().decode(decrypted);
}

async function readPiiValues(
  env: Env,
  orgId: string,
  caseId: string,
): Promise<{ name: string | null; phone: string | null; account: string | null; email: string | null }> {
  const context = await resolveLegacyCaseContext(env, orgId, caseId);
  const row = await env.DB.prepare(
    'SELECT enc_name, enc_phone, enc_account, enc_email FROM participant_pii_vault WHERE beneficiary_id = ? AND org_id = ?',
  )
    .bind(context.beneficiaryId, orgId)
    .first<{ enc_name: string | null; enc_phone: string | null; enc_account: string | null; enc_email: string | null }>();

  if (row === null) {
    return { name: null, phone: null, account: null, email: null };
  }

  return {
    name: await decryptPii(env, row.enc_name),
    phone: await decryptPii(env, row.enc_phone),
    account: await decryptPii(env, row.enc_account),
    email: await decryptPii(env, row.enc_email),
  };
}

function maskRegisteredPii(
  text: string,
  caseId: string,
  pii: { name: string | null; phone: string | null; account: string | null; email: string | null },
): string {
  let masked = text;

  // 등록된 실명·연락처·계좌·이메일은 모두 전사·AI 입력에서 가명 ID 로 치환한다 (R3 · D2).
  for (const value of [pii.name, pii.phone, pii.account, pii.email]) {
    if (value !== null && value.length > 0) {
      masked = masked.replaceAll(value, caseId);
    }
  }

  return masked;
}

async function getGoalForOrg(env: Env, orgId: string, goalId: string): Promise<Goal> {
  const row = await env.DB.prepare(
    `SELECT goal.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM goals AS goal
     JOIN support_cases AS support_case ON support_case.id = goal.support_case_id
     WHERE goal.id = ? AND goal.org_id = ?`,
  )
    .bind(goalId, orgId)
    .first<DbRow>();

  if (row === null) {
    throw new ForbiddenError('goal is not available in this organization');
  }

  return mapGoal(row);
}

async function getSessionForOrg(env: Env, orgId: string, sessionId: string): Promise<Session> {
  const row = await env.DB.prepare(
    `SELECT session.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM sessions AS session
     JOIN support_cases AS support_case ON support_case.id = session.support_case_id
     WHERE session.id = ? AND session.org_id = ?`,
  )
    .bind(sessionId, orgId)
    .first<DbRow>();

  if (row === null) {
    throw new ForbiddenError('session is not available in this organization');
  }

  return mapSession(row);
}

async function assertSessionAccess(env: Env, actor: Actor, sessionId: string): Promise<Session> {
  assertHuman(actor);
  const session = await getSessionForOrg(env, actor.orgId, sessionId);
  await assertCaseAccess(env, actor, session.caseId);
  return session;
}

async function getActionItemForOrg(env: Env, orgId: string, actionItemId: string): Promise<ActionItem> {
  const row = await env.DB.prepare(
    `SELECT action_item.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM action_items AS action_item
     JOIN support_cases AS support_case ON support_case.id = action_item.support_case_id
     WHERE action_item.id = ? AND action_item.org_id = ?`,
  )
    .bind(actionItemId, orgId)
    .first<DbRow>();

  if (row === null) {
    throw new ForbiddenError('action item is not available in this organization');
  }

  return mapActionItem(row);
}

async function getFlagForOrg(env: Env, orgId: string, flagId: string): Promise<Flag> {
  const row = await env.DB.prepare(
    `SELECT flag.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM flags AS flag
     JOIN support_cases AS support_case ON support_case.id = flag.support_case_id
     WHERE flag.id = ? AND flag.org_id = ?`,
  )
    .bind(flagId, orgId)
    .first<DbRow>();

  if (row === null) {
    throw new ForbiddenError('flag is not available in this organization');
  }

  return mapFlag(row);
}

/**
 * 여러 목표를 한 번에 조회해 goalId → caseId 맵으로 반환한다 (N+1 방지).
 * 반환에 없는 goalId는 기관에 존재하지 않는 것으로, 호출부가 ForbiddenError를 던진다.
 */
async function goalCaseMap(env: Env, orgId: string, goalIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(goalIds)].filter((id) => id.length > 0);

  if (unique.length === 0) {
    return new Map();
  }

  const placeholders = unique.map(() => '?').join(', ');
  const result = await env.DB.prepare(
    `SELECT goal.id, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM goals AS goal
     JOIN support_cases AS support_case ON support_case.id = goal.support_case_id
     WHERE goal.org_id = ? AND goal.id IN (${placeholders})`,
  ).bind(orgId, ...unique).all<{ id: string; case_id: string }>();
  return new Map(result.results.map((row) => [stringValue(row.id), stringValue(row.case_id)]));
}

function sameStringItems(expected: string[], actual: string[]): boolean {
  if (expected.length !== actual.length) {
    return false;
  }

  return [...expected].sort().every((value, index) => value === [...actual].sort()[index]);
}
async function writePhase1Denial(
  env: Env,
  actor: Actor,
  entry: { targetTable: string; targetId?: string | null; caseId?: string | null; reason: string },
): Promise<void> {
  await writeAudit(env, actor, {
    action: 'deny',
    targetTable: entry.targetTable,
    ...(entry.targetId !== undefined ? { targetId: entry.targetId } : {}),
    ...(entry.caseId !== undefined ? { caseId: entry.caseId } : {}),
    detail: { reason: entry.reason },
  });
}

async function assertPhase1CaseAccess(env: Env, actor: Actor, caseId: string, targetTable: string): Promise<Case> {
  try {
    assertHuman(actor);
    return await assertCaseAccess(env, actor, caseId);
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable,
      targetId: caseId,
      caseId,
      reason: error instanceof ForbiddenError ? 'forbidden' : 'invalid_actor',
    });
    throw error;
  }
}

async function assertPhase1SessionAccess(env: Env, actor: Actor, sessionId: string): Promise<Session> {
  try {
    return await assertSessionAccess(env, actor, sessionId);
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'sessions',
      targetId: sessionId,
      reason: error instanceof ForbiddenError ? 'forbidden' : 'invalid_actor',
    });
    throw error;
  }
}
async function assertServiceSessionAccess(
  env: Env,
  actor: Actor,
  sessionId: string,
  targetTable: string,
): Promise<Session> {
  if (actor.role !== 'service') {
    await writePhase1Denial(env, actor, {
      targetTable,
      targetId: sessionId,
      reason: 'forbidden',
    });
    throw new ForbiddenError('service role is required');
  }

  try {
    return await getSessionForOrg(env, actor.orgId, sessionId);
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable,
      targetId: sessionId,
      reason: error instanceof ForbiddenError ? 'forbidden' : 'invalid_actor',
    });
    throw error;
  }
}

async function assertServiceTextAiSessionGrant(
  env: Env,
  actor: Actor,
  sessionId: string,
): Promise<{ session: Session; consentEvidenceId: string }> {
  const session = await assertServiceSessionAccess(
    env,
    actor,
    sessionId,
    'pilot_text_ai_consent_evidence',
  );
  const context = await resolveLegacyCaseContext(env, actor.orgId, session.caseId);
  if (!isPilotTextAiEnabled(env)) {
    await writePhase1Denial(env, actor, {
      targetTable: 'pilot_text_ai_consent_evidence',
      caseId: session.caseId,
      reason: 'text_ai_pilot_disabled',
    });
    throw new TextAiPilotDisabledError();
  }

  const evidence = await env.DB.prepare(
    `SELECT id
     FROM pilot_text_ai_consent_evidence
     WHERE org_id = ? AND support_case_id = ?
       AND effective_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     ORDER BY effective_at DESC, created_at DESC, id DESC
     LIMIT 1`,
  ).bind(actor.orgId, context.supportCaseId).first<{ id: string }>();
  if (evidence === null) {
    await writePhase1Denial(env, actor, {
      targetTable: 'pilot_text_ai_consent_evidence',
      caseId: session.caseId,
      reason: 'pilot_text_ai_consent_required',
    });
    throw new PilotTextAiConsentRequiredError();
  }

  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'pilot_text_ai_consent_evidence',
    targetId: evidence.id,
    caseId: session.caseId,
    detail: { purpose: 'service_text_ai_grant_check' },
  });
  return { session, consentEvidenceId: evidence.id };
}

async function getAiWorkItemForOrg(env: Env, orgId: string, workItemId: string): Promise<AiWorkItem> {
  const row = await env.DB.prepare(
    `SELECT work.id, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id,
            work.session_id, work.kind, work.created_at
     FROM ai_work_items AS work
     JOIN support_cases AS support_case ON support_case.id = work.support_case_id
     WHERE work.id = ? AND work.org_id = ?`,
  ).bind(workItemId, orgId).first<DbRow>();

  if (row === null) {
    throw new ForbiddenError('AI work item is not available in this organization');
  }

  return mapAiWorkItem(row);
}

async function findAiWorkItemForSession(
  env: Env,
  orgId: string,
  sessionId: string,
  kind: string,
): Promise<AiWorkItem | null> {
  const row = await env.DB.prepare(
    `SELECT work.id, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id,
            work.session_id, work.kind, work.created_at
     FROM ai_work_items AS work
     JOIN support_cases AS support_case ON support_case.id = work.support_case_id
     WHERE work.org_id = ? AND work.session_id = ? AND work.kind = ?`,
  ).bind(orgId, sessionId, kind).first<DbRow>();
  return row === null ? null : mapAiWorkItem(row);
}

async function assertAiWorkItemAccess(env: Env, actor: Actor, workItemId: string): Promise<AiWorkItem> {
  try {
    assertHuman(actor);
    const workItem = await getAiWorkItemForOrg(env, actor.orgId, workItemId);
    await assertCaseAccess(env, actor, workItem.caseId);
    return workItem;
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_work_items',
      targetId: workItemId,
      reason: error instanceof ForbiddenError ? 'forbidden' : 'invalid_actor',
    });
    throw error;
  }
}

async function listAiEvidenceLinks(env: Env, draftVersionId: string): Promise<AiEvidenceLink[]> {
  const result = await env.DB.prepare(
    'SELECT id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote, source_ref, source_start, source_end, created_at FROM ai_evidence_links WHERE draft_version_id = ? ORDER BY created_at, id',
  ).bind(draftVersionId).all<DbRow>();
  return result.results.map(mapAiEvidenceLink);
}
async function listMaskedSourceEvidenceItems(
  env: Env,
  snapshotId: string,
): Promise<MaskedSourceEvidenceItem[]> {
  const result = await env.DB.prepare(
    'SELECT id, snapshot_id, source_ref, source_sha256, evidence_quote, source_start, source_end, created_at FROM ai_masked_source_evidence_items WHERE snapshot_id = ? ORDER BY source_start, source_end, id',
  ).bind(snapshotId).all<DbRow>();
  return result.results.map(mapMaskedSourceEvidenceItem);
}

async function getMaskedSourceSnapshotForOrg(
  env: Env,
  orgId: string,
  caseId: string,
  sessionId: string,
  snapshotId: string,
): Promise<MaskedSourceSnapshot> {
  const context = await resolveLegacyCaseContext(env, orgId, caseId);
  const row = await env.DB.prepare(
    `SELECT snapshot.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM ai_masked_source_snapshots AS snapshot
     JOIN support_cases AS support_case ON support_case.id = snapshot.support_case_id
     WHERE snapshot.id = ? AND snapshot.org_id = ? AND snapshot.support_case_id = ? AND snapshot.session_id = ?`,
  ).bind(snapshotId, orgId, context.supportCaseId, sessionId).first<DbRow>();
  if (row === null) {
    throw new ForbiddenError('masked source snapshot is not available in this session');
  }

  return mapMaskedSourceSnapshot(row, await listMaskedSourceEvidenceItems(env, snapshotId));
}

async function getCurrentAiDraftVersion(env: Env, orgId: string, workItemId: string): Promise<AiDraftVersion> {
  const row = await env.DB.prepare(
    `SELECT
       draft.id AS draft_id,
       draft.work_item_id,
       draft.version,
       draft.parent_version_id,
       draft.summary_text,
       draft.one_liner,
       draft.questions_json,
       draft.source_snapshot_id,
       draft.source_snapshot_hash,
       draft.consent_evidence_id,
       draft.provider_config_id,
       draft.model_id,
       draft.prompt_version,
       draft.schema_version,
       draft.origin,
       draft.creation_mode,
       draft.grounding_status,
       draft.created_by,
       draft.created_at,
       COALESCE(support_case.legacy_case_id, support_case.id) AS case_id,
       work.session_id,
       work.kind,
       review.decision AS review_decision,
       review.actor_id AS reviewed_by,
       review.created_at AS reviewed_at,
       review.replacement_draft_id
     FROM ai_draft_versions AS draft
     INNER JOIN ai_work_items AS work ON work.id = draft.work_item_id
     INNER JOIN support_cases AS support_case ON support_case.id = work.support_case_id
     LEFT JOIN ai_review_events AS review ON review.draft_version_id = draft.id
     WHERE draft.work_item_id = ?
       AND work.org_id = ?
       AND draft.version = (
         SELECT MAX(version) FROM ai_draft_versions WHERE work_item_id = ?
       )`,
  ).bind(workItemId, orgId, workItemId).first<DbRow>();

  if (row === null) {
    throw new ValidationError('AI work item has no draft version');
  }

  const draft = mapAiDraftVersion(row);
  return { ...draft, evidence: await listAiEvidenceLinks(env, draft.id) };
}

function requireExpectedDraftVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new DraftVersionRequiredError();
  }

  return value;
}

function assertCurrentGeneratedPendingDraft(draft: AiDraftVersion, expectedVersion: number): void {
  if (
    draft.version !== expectedVersion
    || draft.reviewDecision !== null
    || draft.origin !== 'generated'
    || draft.groundingStatus !== 'grounded'
  ) {
    throw new StaleDraftVersionError();
  }
}

function assertGeneratedAiDraftInput(
  input: AiDraftContentInput,
  requireKind: boolean,
  requireSourceSnapshot = requireKind,
): void {
  assertRequiredText(input.summaryText, 'AI summary');
  // 핵심 한 줄(D45·CCC-38)은 새 생성 경로(requireKind)에서 필수, 편집 경로는 레거시
  // 초안(v1 스키마, one_liner 없음)의 재버전을 위해 NULL 을 허용한다.
  assertAiOneLiner(input.oneLiner, requireKind);
  assertGeneratedAiDraftQuestions(input.questions);
  assertSha256(input.sourceSnapshotHash, 'source snapshot hash');
  assertOpaqueIdentifier(input.modelId, 'model id');
  assertVersionIdentifier(input.promptVersion, 'prompt version');
  assertVersionIdentifier(input.schemaVersion, 'schema version');
  if (requireKind) {
    const generated = input as GeneratedAiDraftInput;
    assertOpaqueIdentifier(generated.providerConfigId, 'provider config id');
    assertOpaqueIdentifier(generated.consentEvidenceId, 'consent evidence id');
  }

  if (requireKind) {
    const generated = input as GeneratedAiDraftInput;
    if (generated.kind !== AI_WORK_KIND_BRIEFING) {
      throw new ValidationError('AI work kind is invalid');
    }
  }

  if (requireSourceSnapshot) {
    assertOpaqueIdentifier(input.sourceSnapshotId, 'source snapshot id');
  }

  if (!Array.isArray(input.evidence)) {
    throw new ValidationError('AI evidence must be a list');
  }
  const requiredQuestionEvidenceKeys = new Set(
    input.questions.map((_, index) => questionClaimKey(index)),
  );
  const questionEvidenceKeys = new Set<string>();
  let hasSummaryEvidence = false;

  for (const item of input.evidence) {
    if (item === null || typeof item !== 'object') {
      throw new ValidationError('AI evidence item is invalid');
    }

    const evidence = item as AiEvidenceInput;
    if (requireSourceSnapshot) {
      assertOpaqueIdentifier(evidence.sourceEvidenceItemId, 'source evidence item id');
    }
    assertOpaqueIdentifier(evidence.claimKey, 'AI evidence claim key');
    if (requiredQuestionEvidenceKeys.has(evidence.claimKey)) {
      questionEvidenceKeys.add(evidence.claimKey);
    } else if (!isQuestionClaimKey(evidence.claimKey)) {
      hasSummaryEvidence = true;
    }
    assertRequiredText(evidence.evidenceQuote, 'AI evidence quote');
    assertOpaqueReference(evidence.sourceRef, 'AI evidence source reference');

    const sourceStart: unknown = evidence.sourceStart;
    const sourceEnd: unknown = evidence.sourceEnd;
    if (
      typeof sourceStart !== 'number'
      || !Number.isInteger(sourceStart)
      || sourceStart < 0
      || typeof sourceEnd !== 'number'
      || !Number.isInteger(sourceEnd)
      || sourceEnd <= sourceStart
    ) {
      throw new ValidationError('AI evidence source positions are invalid');
    }
  }
  for (const claimKey of requiredQuestionEvidenceKeys) {
    if (!questionEvidenceKeys.has(claimKey)) {
      throw new ValidationError('AI briefing question evidence is required');
    }
  }
  if (!hasSummaryEvidence) {
    throw new ValidationError('AI summary evidence is required');
  }
}

async function maskGeneratedAiDraftInput<T extends AiDraftContentInput>(
  env: Env,
  actor: Actor,
  caseId: string,
  input: T,
): Promise<T> {
  const pii = await readPiiValues(env, actor.orgId, caseId);
  const mask = (text: string): string => maskRegisteredPii(text, caseId, pii);
  await writeAudit(env, actor, {
    action: 'decrypt_pii',
    targetTable: 'pii_vault',
    targetId: caseId,
    caseId,
  });

  return {
    ...input,
    summaryText: mask(input.summaryText),
    oneLiner: input.oneLiner == null ? input.oneLiner : mask(input.oneLiner),
    questions: input.questions.map((suggestion) => ({
      title: mask(suggestion.title),
      reason: suggestion.reason === null ? null : mask(suggestion.reason),
    })),
    evidence: input.evidence.map((item) => ({
      ...item,
      evidenceQuote: mask(item.evidenceQuote),
    })),
  } as T;
}

// ── 엔티티 타입 (schema.sql과 1:1) ──────────────────────────────────────────

export interface Case {
  id: string;                    // 가명 ID (레거시 'A017' 또는 동물 슬러그 'swallow-003' — D20)
  orgId: string;
  programType: string;
  status: 'active' | 'closed';
  intakeAt: string | null;
  consentRecordingAt: string | null;  // D15 분리 동의
  consentTextAiAt: string | null;
  closedAt: string | null;
  closedReason: string | null;
  purgeDue: string | null;
  extra: Record<string, unknown> | null; // 확장 슬롯 (통계·브리핑 제외)
}

export interface Assignee {
  caseId: string;
  userId: string;
  role: 'primary' | 'secondary';
  assignedAt: string;
  unassignedAt: string | null;
}

export interface Goal {
  id: string;
  caseId: string;
  title: string;                 // D12: 수정 불가
  scaleCriteria: unknown | null; // GAS -2~+2 단계 기준 (JSON)
  status: 'active' | 'closed';
  closedReason: string | null;
  closedAt: string | null;
  replacedByGoalId: string | null;
}

export type AiStatus = 'none' | 'uploaded' | 'processing' | 'review_ready' | 'approved';

export interface Session {
  id: string;
  caseId: string;
  counselorId: string;
  heldAt: string;
  channel: 'in_person' | 'phone' | 'video'; // D4: v1 녹음은 대면만
  memo: string | null;           // 수기 메모 — 즉시 공식 (D5)
  aiStatus: AiStatus;
  transcript: string | null;     // 마스킹 완료 전사만 (R3)
  audioR2Key: string | null;
  aiSummary: string | null;      // 이하 ai_*는 approved_at 전 비공식 (R2)
  aiSchema: unknown | null;
  aiContrast: ContrastResult | null;
  emotionScores: unknown | null; // 숫자만 (R4), JSON 형태는 2단계 확정
  speakerMappingConfirmedAt: string | null; // D11
  approvedAt: string | null;
  approvedBy: string | null;
  extra: Record<string, unknown> | null;
  /**
   * AI가 제안한 목표별 근거 발췌 (D6). 검토·GAS 채점 화면 전용 —
   * getSession에서만 채운다(목록·내보내기·브리핑에는 싣지 않는다).
   * 저장된 quote는 마스킹 완료본이다 (R3).
   */
  aiGasEvidence?: Array<{ goalId: string; quote: string }>;
  /**
   * 이 회차 시점의 생활 6영역 스냅샷 (CCC-8). getSession 에서만 채운다
   * (목록·내보내기에는 listCounselingRecords 의 lifeAreaSnapshot 을 쓴다).
   */
  lifeAreaSnapshot?: LifeAreaSnapshotEntry[];
}

/** Claude 대조 출력 3종 (R2 승인 화면의 핵심) */
export interface ContrastResult {
  missingFromMemo: string[];     // 메모에 없는 내용 (누락 후보)
  missingFromAudio: string[];    // 음성에 없는 내용 (확인 필요)
  undiscussedGoals: string[];    // 미논의 목표 (goal id)
}

export interface GasScore {
  sessionId: string;
  goalId: string;
  score: -2 | -1 | 0 | 1 | 2;   // 실무자가 직접 매김 (D6)
  evidenceQuote: string | null;  // AI 발췌 제안 (D6)
  scoredBy: string;
}

export interface ActionItem {
  id: string;
  caseId: string;
  sessionId: string | null;
  description: string;
  owner: 'counselor' | 'beneficiary' | 'org';
  dueDate: string | null;
  resolvedAt: string | null;
}

/** D9 고정 유형 — 8장 미결 초안 5종. 현장 검증 후 확정. 목록은 FLAG_TYPES가 유일 출처. */
export type FlagType = (typeof FLAG_TYPES)[number];

export interface Flag {
  id: string;
  caseId: string;
  sessionId: string | null;
  flagType: FlagType;
  quote: string | null;          // source='ai'면 필수 (D9)
  source: 'ai' | 'counselor';
  reviewStatus: 'pending' | 'confirmed' | 'rejected';
  reviewedBy: string | null;
  reviewedAt: string | null;
}

/** 브리핑 화면 응답 — 노출 5항목 고정 (CLAUDE.md 6장) */
export interface Briefing {
  caseId: string;
  /** 1. 목표별 GAS 추이 (목표 종료 시점·후속 목표 연결 포함, D12) */
  gasTrend: Array<{
    goal: Goal;
    points: Array<{ heldAt: string; score: number }>;
  }>;
  /** 2. 지난 세션 3줄 요약 — 승인된 AI 요약이 없으면 수기 메모 폴백 (D5) */
  lastSessionSummary: {
    source: 'ai' | 'memo';
    text: string;
    pendingApprovalCount: number; // "승인 대기 N건" 배지
  } | null;
  /** 3. 미해결 액션 아이템 */
  openActionItems: ActionItem[];
  /** 4. 리스크 플래그 (화면 최우선 배치) — 실무자 생성 또는 confirmed만 (미검토 AI 제안 제외) */
  flags: Flag[];
  /** 5. 오늘 확인할 질문 2~3개 (AI 생성, 승인된 기록만 입력으로 사용) */
  questions: string[];
}

/** Mac Mini가 Workers API로만 조회하는 처리 대기 작업 (D13). */
export interface PipelineJob {
  id: string;
  caseId: string;
  status: AiStatus;
  audioAvailable: boolean;
}

/**
 * D8 파이프라인 폴링 건강도. 기관 1개 기준.
 *  - lastPolledAt: 가장 최근 poll_pipeline 감사 시각(ISO, UTC). 폴링 기록이 없으면 null.
 *  - pendingJobCount: 오디오가 등록됐지만 아직 처리 안 된 세션 수(uploaded|processing).
 *  - status:
 *      'ok'       — 임계값 안에 최근 폴링이 있음.
 *      'stale'    — 임계값 초과로 무폴링(또는 대기 작업이 있는데 폴링 이력 자체가 없음).
 *      'inactive' — 폴링 이력도 없고 대기 작업도 없음(알림 대상 아님).
 *  - stale: 관리자 알림 트리거 여부('stale' status일 때만 true).
 */
export interface PipelineHealth {
  orgId: string;
  lastPolledAt: string | null;
  stale: boolean;
  status: 'ok' | 'stale' | 'inactive';
  pendingJobCount: number;
  thresholdHours: number;
}
/**
 * Phase 1 텍스트 AI 파일럿 동의 증적. 원본 동의 내용은 D1에 저장하지 않고
 * 버전·해시·불투명 참조만 append-only로 남긴다.
 */
export interface PilotTextAiConsentEvidence {
  id: string;
  caseId: string;
  noticeVersion: string;
  noticeSha256: string;
  evidenceRef: string;
  evidenceSha256: string;
  capturedBy: string;
  effectiveAt: string;
  createdAt: string;
}
/**
 * A service-only grant proves the current session is still eligible for one
 * outbound text-AI operation without exposing consent references or actors.
 */
export interface ServiceTextAiSessionGrant {
  sessionId: string;
  caseId: string;
  consentEvidenceId: string;
}

/** Immutable, fully masked source evidence scoped to one source snapshot. */
export interface MaskedSourceEvidenceItem {
  id: string;
  snapshotId: string;
  sourceRef: string;
  sourceSha256: string;
  evidenceQuote: string;
  sourceStart: number; // Unicode code-point offset in maskedText
  sourceEnd: number;   // exclusive Unicode code-point offset in maskedText
  createdAt: string;
}

/** Service-readable provider input; it never contains raw PII or governance refs. */
export interface MaskedSourceSnapshot {
  id: string;
  caseId: string;
  sessionId: string;
  maskedText: string;
  sha256: string;
  maskingPipelineVersion: string;
  createdAt: string;
  evidence: MaskedSourceEvidenceItem[];
}

export interface MaskedSourceEvidenceItemInput {
  id: string;
  sourceRef: string;
  sourceSha256: string;
  evidenceQuote: string;
  sourceStart: number; // Unicode code-point offset in maskedText
  sourceEnd: number;   // exclusive Unicode code-point offset in maskedText
}

export interface RecordMaskedSourceSnapshotInput {
  maskedText: string;
  sha256: string;
  maskingPipelineVersion: string;
  evidence: MaskedSourceEvidenceItemInput[];
}


export type AiDraftOrigin = 'generated' | 'legacy_import';
export type AiDraftGroundingStatus = 'grounded' | 'legacy_unverified';
export type AiReviewDecision = 'approved' | 'rejected' | 'superseded';
export type AiDraftCreationMode = 'provider_generated' | 'human_edited' | 'legacy_import';

/** 하나의 세션·출력종류에 대한 불변 AI 초안 계보의 루트. */
export interface AiWorkItem {
  id: string;
  caseId: string;
  sessionId: string;
  kind: string;
  createdAt: string;
}

/**
 * D45 영역 ① 구조화 제안 — 짧은 제목 + 확인해야 하는 이유. 근거 회차는 초안이 속한
 * 세션이고 인용은 ai_evidence_links(question_N)가 강제한다. reason=null 은
 * v1 단문 질문 저장분의 하위 호환 표기다(신규 생성분은 항상 채워진다).
 */
export interface AiBriefingSuggestion {
  title: string;
  reason: string | null;
}

/** 마스킹된 근거 링크. 링크가 없는 generated 초안은 검토할 수 있어도 승인할 수 없다. */
export interface AiEvidenceLink {
  id: string;
  draftVersionId: string;
  sourceEvidenceItemId: string;
  claimKey: string;
  evidenceQuote: string;
  sourceRef: string;
  sourceStart: number;
  sourceEnd: number;
  createdAt: string;
}

export interface AiDraftVersion {
  id: string;
  workItemId: string;
  caseId: string;
  sessionId: string;
  kind: string;
  version: number;
  parentVersionId: string | null;
  summaryText: string;
  /** D45 영역 ② 핵심 한 줄. NULL = 스키마 v1 레거시 초안(한 줄 없음). */
  oneLiner: string | null;
  questions: AiBriefingSuggestion[];
  sourceSnapshotId: string | null;
  sourceSnapshotHash: string | null;
  consentEvidenceId: string | null;
  providerConfigId: string | null;
  modelId: string | null;
  promptVersion: string | null;
  schemaVersion: string | null;
  origin: AiDraftOrigin;
  creationMode: AiDraftCreationMode;
  groundingStatus: AiDraftGroundingStatus;
  createdBy: string | null;
  createdAt: string;
  reviewDecision: AiReviewDecision | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  replacementDraftId: string | null;
  evidence: AiEvidenceLink[];
}

/** `approved_ai_briefing_v1`에서만 반환하는 공식 AI 브리핑 행. */
export interface ApprovedAiBriefing {
  workItemId: string;
  draftVersionId: string;
  caseId: string;
  sessionId: string;
  version: number;
  summaryText: string;
  /** D45 영역 ② 핵심 한 줄. NULL = 한 줄이 없던 시절의 승인 초안. */
  oneLiner: string | null;
  questions: AiBriefingSuggestion[];
  origin: AiDraftOrigin;
  groundingStatus: AiDraftGroundingStatus;
  approvedBy: string;
  approvedAt: string;
}

export interface AiEvidenceInput {
  sourceEvidenceItemId?: string;
  claimKey: string;
  evidenceQuote: string;
  sourceRef: string;
  sourceStart: number; // Unicode code-point offset in the attested masked source
  sourceEnd: number;   // exclusive Unicode code-point offset in the attested masked source
}

export interface AiDraftContentInput {
  summaryText: string;
  /** D45 핵심 한 줄. 생성 경로는 필수, 편집 경로는 레거시 초안 호환으로 NULL 허용. */
  oneLiner?: string | null;
  questions: AiBriefingSuggestion[];
  sourceSnapshotId?: string;
  sourceSnapshotHash: string;
  modelId: string;
  promptVersion: string;
  schemaVersion: string;
  evidence: AiEvidenceInput[];
}

export interface GeneratedAiDraftInput extends AiDraftContentInput {
  kind?: string;
  providerConfigId: string;
  consentEvidenceId: string;
}

export interface EditGeneratedAiDraftInput extends AiDraftContentInput {
  expectedVersion: number;
}
export interface AiDraftReviewInput {
  expectedVersion: number;
  decision: 'approved' | 'rejected';
}
export interface PilotTextAiConsentEvidenceInput {
  noticeVersion: string;
  noticeSha256: string;
  evidenceRef: string;
  evidenceSha256: string;
  effectiveAt: string;
}
export interface AiProviderConfiguration {
  id: string;
  adapterId: string;
  adapterVersion: string;
  configHash: string;
  approvalRefs: string[];
  createdBy: string;
  createdAt: string;
}

export interface ActiveAiProviderConfiguration extends AiProviderConfiguration {
  activationId: string;
  activatedBy: string;
  activatedAt: string;
}
/** Runtime metadata is safe for service orchestration and excludes governance refs. */
export interface ActiveAiProviderRuntimeMetadata {
  adapterId: string;
  adapterVersion: string;
  configHash: string;
}

/** Provider and consent selection fixed immediately before outbound generation. */
export interface AiProviderExecutionSelection extends ActiveAiProviderRuntimeMetadata {
  providerConfigId: string;
  consentEvidenceId: string;
}
/**
 * Safe, content-free pilot-consent metadata for UI/API status checks. The
 * opaque evidence reference is intentionally never part of this shape.
 */
export interface PilotTextAiConsentStatus {
  caseId: string;
  status: 'recorded' | 'missing';
  evidenceId: string | null;
  noticeVersion: string | null;
  noticeHash: string | null;
  evidenceHash: string | null;
  effectiveAt: string | null;
}

/** Safe organization-level provider activation metadata for administrators. */
export interface ActiveAiProviderStatus {
  enabled: boolean;
  adapterId: string | null;
  adapterVersion: string | null;
  configHash: string | null;
}

/**
 * Session-scoped edit input. The gateway resolves immutable evidence links by
 * id so callers never need their source references or snapshots.
 */
export interface EditAiDraftForSessionInput {
  expectedVersion: number;
  evidenceIds: string[];
}


export interface AiProviderConfigurationInput {
  adapterId: string;
  adapterVersion: string;
  configHash: string;
  approvalRefs: string[];
}

/** 안정적인 기본 kind. 세션당 이 kind의 work item은 하나만 존재한다. */
export const AI_WORK_KIND_BRIEFING = 'text_ai_briefing';

// ============================================================================
// Phase 1 텍스트 AI 증적 · 불변 초안 · 공식 투영
// ============================================================================
async function assertPhase1ProviderAdmin(env: Env, actor: Actor): Promise<void> {
  try {
    assertAdmin(actor);
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_provider_configs',
      reason: 'forbidden',
    });
    throw error;
  }
}

async function activeAiProviderConfigurationForCase(
  env: Env,
  actor: Actor,
  caseId: string,
): Promise<ActiveAiProviderConfiguration> {
  await assertPhase1CaseAccess(env, actor, caseId, 'ai_provider_configs');
  const row = await env.DB.prepare(
    `SELECT
       config.id AS config_id,
       config.adapter_id,
       config.adapter_version,
       config.config_hash,
       config.approval_refs_json,
       config.created_by,
       config.created_at,
       activation.id AS activation_id,
       activation.activated_by,
       activation.activated_at
     FROM ai_provider_activations AS activation
     INNER JOIN ai_provider_configs AS config ON config.id = activation.config_id
     WHERE activation.org_id = ? AND activation.deactivated_at IS NULL
     ORDER BY activation.activated_at DESC, activation.id DESC
     LIMIT 1`,
  ).bind(actor.orgId).first<DbRow>();
  if (row === null) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_provider_configs',
      caseId,
      reason: 'ai_provider_not_configured',
    });
    throw new AiProviderNotConfiguredError();
  }

  const config = mapActiveAiProviderConfiguration(row);
  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'ai_provider_configs',
    targetId: config.id,
    caseId,
    detail: { active: true },
  });
  return config;
}

/**
 * Compatibility-safe provider lookup for case-authorized callers. Governance
 * references and actor identities remain internal to the gateway.
 */
export async function getActiveAiProviderConfiguration(
  env: Env,
  actor: Actor,
  caseId: string,
): Promise<ActiveAiProviderRuntimeMetadata> {
  const config = await activeAiProviderConfigurationForCase(env, actor, caseId);
  return {
    adapterId: config.adapterId,
    adapterVersion: config.adapterVersion,
    configHash: config.configHash,
  };
}

export async function getActiveAiProviderRuntimeMetadataForService(
  env: Env,
  actor: Actor,
  sessionId: string,
): Promise<AiProviderExecutionSelection> {
  const grant = await assertServiceTextAiSessionGrant(env, actor, sessionId);
  const row = await env.DB.prepare(
    `SELECT
       config.id AS config_id,
       config.adapter_id,
       config.adapter_version,
       config.config_hash,
       evidence.id AS consent_evidence_id
     FROM sessions AS session
     INNER JOIN pilot_text_ai_consent_evidence AS evidence
       ON evidence.id = (
         SELECT latest.id
         FROM pilot_text_ai_consent_evidence AS latest
         WHERE latest.org_id = session.org_id
           AND latest.support_case_id = session.support_case_id
           AND latest.effective_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         ORDER BY latest.effective_at DESC, latest.created_at DESC, latest.id DESC
         LIMIT 1
       )
     INNER JOIN ai_provider_activations AS activation
       ON activation.org_id = session.org_id
      AND activation.deactivated_at IS NULL
     INNER JOIN ai_provider_configs AS config
       ON config.id = activation.config_id
      AND config.org_id = session.org_id
     WHERE session.id = ? AND session.org_id = ?
     ORDER BY activation.activated_at DESC, activation.id DESC
     LIMIT 1`,
  ).bind(sessionId, actor.orgId).first<DbRow>();
  if (row === null) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_provider_configs',
      caseId: grant.session.caseId,
      reason: 'ai_provider_not_configured',
    });
    throw new AiProviderNotConfiguredError();
  }

  const metadata: AiProviderExecutionSelection = {
    providerConfigId: stringValue(row.config_id),
    consentEvidenceId: stringValue(row.consent_evidence_id),
    adapterId: stringValue(row.adapter_id),
    adapterVersion: stringValue(row.adapter_version),
    configHash: stringValue(row.config_hash),
  };
  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'ai_provider_configs',
    targetId: stringValue(row.config_id),
    caseId: grant.session.caseId,
    detail: { active: true, purpose: 'service_text_ai_runtime' },
  });
  return metadata;
}
/**
 * Returns only organization activation metadata safe for an administrator
 * status screen. Approval references and any provider secrets stay internal.
 */
export async function getActiveAiProviderStatus(
  env: Env,
  actor: Actor,
): Promise<ActiveAiProviderStatus> {
  await assertPhase1ProviderAdmin(env, actor);
  const row = await env.DB.prepare(
    `SELECT
       config.id AS config_id,
       config.adapter_id,
       config.adapter_version,
       config.config_hash
     FROM ai_provider_activations AS activation
     INNER JOIN ai_provider_configs AS config ON config.id = activation.config_id
     WHERE activation.org_id = ? AND activation.deactivated_at IS NULL
     ORDER BY activation.activated_at DESC, activation.id DESC
     LIMIT 1`,
  ).bind(actor.orgId).first<DbRow>();
  const status: ActiveAiProviderStatus = row === null
    ? {
      enabled: false,
      adapterId: null,
      adapterVersion: null,
      configHash: null,
    }
    : {
      enabled: true,
      adapterId: stringValue(row.adapter_id),
      adapterVersion: stringValue(row.adapter_version),
      configHash: stringValue(row.config_hash),
    };
  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'ai_provider_configs',
    ...(row === null ? {} : { targetId: stringValue(row.config_id) }),
    detail: { active: status.enabled },
  });
  return status;
}


/**
 * Privacy/Security 승인 참조가 있는 불변 provider configuration을 등록한다. 활성화는
 * 별도 함수여서 외부 승인과 rollout gate를 묵시적으로 통과시키지 않는다.
 */
export async function registerAiProviderConfiguration(
  env: Env,
  actor: Actor,
  input: AiProviderConfigurationInput,
): Promise<AiProviderConfiguration> {
  await assertPhase1ProviderAdmin(env, actor);
  try {
    if (input === null || typeof input !== 'object' || !Array.isArray(input.approvalRefs) || input.approvalRefs.length === 0) {
      throw new ValidationError('AI provider configuration is invalid');
    }
    assertOpaqueIdentifier(input.adapterId, 'provider adapter id');
    assertVersionIdentifier(input.adapterVersion, 'provider adapter version');
    assertSha256(input.configHash, 'provider configuration hash');
    for (const approvalRef of input.approvalRefs) {
      assertOpaqueReference(approvalRef, 'provider approval reference');
    }
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_provider_configs',
      reason: 'invalid_ai_provider_configuration',
    });
    throw error;
  }

  const config: AiProviderConfiguration = {
    id: newId(),
    adapterId: input.adapterId,
    adapterVersion: input.adapterVersion,
    configHash: input.configHash,
    approvalRefs: [...input.approvalRefs],
    createdBy: actor.userId,
    createdAt: now(),
  };
  await env.DB.prepare(
    'INSERT INTO ai_provider_configs (id, org_id, adapter_id, adapter_version, config_hash, approval_refs_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    config.id,
    actor.orgId,
    config.adapterId,
    config.adapterVersion,
    config.configHash,
    stringifyJson(config.approvalRefs),
    config.createdBy,
    config.createdAt,
  ).run();
  await writeAudit(env, actor, {
    action: 'create',
    targetTable: 'ai_provider_configs',
    targetId: config.id,
    detail: { adapterId: config.adapterId, approvalRefCount: config.approvalRefs.length },
  });
  return config;
}

/** 새 activation을 append하고 기존 active configuration은 retirement timestamp만 기록한다. */
export async function activateAiProviderConfiguration(
  env: Env,
  actor: Actor,
  configId: string,
): Promise<ActiveAiProviderConfiguration> {
  await assertPhase1ProviderAdmin(env, actor);
  const configRow = await env.DB.prepare(
    'SELECT id, adapter_id, adapter_version, config_hash, approval_refs_json, created_by, created_at FROM ai_provider_configs WHERE id = ? AND org_id = ?',
  ).bind(configId, actor.orgId).first<DbRow>();
  if (configRow === null) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_provider_configs',
      targetId: configId,
      reason: 'forbidden',
    });
    throw new ForbiddenError('AI provider configuration is not available in this organization');
  }
  const config = mapAiProviderConfiguration(configRow);
  const prior = await env.DB.prepare(
    'SELECT id FROM ai_provider_activations WHERE org_id = ? AND deactivated_at IS NULL',
  ).bind(actor.orgId).first<{ id: string }>();
  if (prior?.id !== undefined) {
    const activeConfig = await env.DB.prepare(
      'SELECT config_id FROM ai_provider_activations WHERE id = ? AND org_id = ?',
    ).bind(prior.id, actor.orgId).first<{ config_id: string }>();
    if (activeConfig?.config_id === config.id) {
      await writePhase1Denial(env, actor, {
        targetTable: 'ai_provider_activations',
        targetId: prior.id,
        reason: 'provider_already_active',
      });
      throw new ValidationError('AI provider configuration is already active');
    }
  }

  const activatedAt = now();
  const activationId = newId();
  try {
    const statements: D1PreparedStatement[] = [];
    if (prior?.id !== undefined) {
      statements.push(env.DB.prepare(
        'UPDATE ai_provider_activations SET deactivated_at = ? WHERE id = ? AND org_id = ? AND deactivated_at IS NULL',
      ).bind(activatedAt, prior.id, actor.orgId));
    }
    statements.push(env.DB.prepare(
      'INSERT INTO ai_provider_activations (id, org_id, config_id, previous_activation_id, activated_by, activated_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).bind(activationId, actor.orgId, config.id, prior?.id ?? null, actor.userId, activatedAt));
    await env.DB.batch(statements);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      await writePhase1Denial(env, actor, {
        targetTable: 'ai_provider_activations',
        targetId: config.id,
        reason: 'provider_activation_conflict',
      });
      throw new ValidationError('AI provider activation changed concurrently');
    }
    throw error;
  }

  if (prior?.id !== undefined) {
    await writeAudit(env, actor, {
      action: 'update',
      targetTable: 'ai_provider_activations',
      targetId: prior.id,
      detail: { retired: true },
    });
  }
  await writeAudit(env, actor, {
    action: 'create',
    targetTable: 'ai_provider_activations',
    targetId: activationId,
    detail: { configId: config.id },
  });
  return {
    ...config,
    activationId,
    activatedBy: actor.userId,
    activatedAt,
  };
}

/**
 * 파일럿 텍스트 AI 동의 증적을 append-only로 기록한다. 원본 동의 본문·서명은 받거나
 * 저장하지 않으며, legacy cases.consent_text_ai_at은 이 경로의 권한 근거가 아니다.
 */
export async function recordPilotTextAiConsentEvidence(
  env: Env,
  actor: Actor,
  caseId: string,
  input: PilotTextAiConsentEvidenceInput,
): Promise<PilotTextAiConsentEvidence> {
  await assertPhase1CaseAccess(env, actor, caseId, 'pilot_text_ai_consent_evidence');
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);

  if (!isPilotTextAiEnabled(env)) {
    await writePhase1Denial(env, actor, {
      targetTable: 'pilot_text_ai_consent_evidence',
      caseId,
      reason: 'text_ai_pilot_disabled',
    });
    throw new TextAiPilotDisabledError();
  }

  try {
    if (input === null || typeof input !== 'object') {
      throw new ValidationError('pilot text AI consent evidence is invalid');
    }
    assertVersionIdentifier(input.noticeVersion, 'notice version');
    assertSha256(input.noticeSha256, 'notice hash');
    assertOpaqueReference(input.evidenceRef, 'evidence reference');
    assertSha256(input.evidenceSha256, 'evidence hash');
    input.effectiveAt = canonicalEffectiveTimestamp(input.effectiveAt, 'evidence effective time');
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'pilot_text_ai_consent_evidence',
      caseId,
      reason: 'invalid_pilot_text_ai_evidence',
    });
    throw error;
  }

  const evidence: PilotTextAiConsentEvidence = {
    id: newId(),
    caseId,
    noticeVersion: input.noticeVersion,
    noticeSha256: input.noticeSha256,
    evidenceRef: input.evidenceRef,
    evidenceSha256: input.evidenceSha256,
    capturedBy: actor.userId,
    effectiveAt: input.effectiveAt,
    createdAt: now(),
  };
  await env.DB.prepare(
    'INSERT INTO pilot_text_ai_consent_evidence (id, org_id, support_case_id, notice_version, notice_sha256, evidence_ref, evidence_sha256, captured_by, effective_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    evidence.id,
    actor.orgId,
    context.supportCaseId,
    evidence.noticeVersion,
    evidence.noticeSha256,
    evidence.evidenceRef,
    evidence.evidenceSha256,
    evidence.capturedBy,
    evidence.effectiveAt,
    evidence.createdAt,
  ).run();
  await writeAudit(env, actor, {
    action: 'create',
    targetTable: 'pilot_text_ai_consent_evidence',
    targetId: evidence.id,
    caseId,
    detail: { purpose: 'text_ai_pilot' },
  });
  return evidence;
}

/** 파일럿 증적 목록은 권한 있는 검토자에게만 metadata로 제공한다. */
export async function listPilotTextAiConsentEvidence(
  env: Env,
  actor: Actor,
  caseId: string,
): Promise<PilotTextAiConsentEvidence[]> {
  await assertPhase1CaseAccess(env, actor, caseId, 'pilot_text_ai_consent_evidence');
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  const result = await env.DB.prepare(
    `SELECT evidence.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM pilot_text_ai_consent_evidence AS evidence
     JOIN support_cases AS support_case ON support_case.id = evidence.support_case_id
     WHERE evidence.org_id = ? AND evidence.support_case_id = ?
     ORDER BY evidence.effective_at DESC, evidence.created_at DESC, evidence.id DESC`,
  ).bind(actor.orgId, context.supportCaseId).all<DbRow>();
  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'pilot_text_ai_consent_evidence',
    caseId,
    detail: { purpose: 'text_ai_pilot' },
  });
  return result.results.map(mapPilotTextAiConsentEvidence);
}
/**
 * Returns the latest consent record as safe metadata only. The opaque
 * evidence reference is deliberately not selected or returned.
 */
export async function getLatestPilotTextAiConsentStatus(
  env: Env,
  actor: Actor,
  caseId: string,
): Promise<PilotTextAiConsentStatus> {
  await assertPhase1CaseAccess(env, actor, caseId, 'pilot_text_ai_consent_evidence');
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  const row = await env.DB.prepare(
    `SELECT
       evidence.id,
       COALESCE(support_case.legacy_case_id, support_case.id) AS case_id,
       evidence.notice_version,
       evidence.notice_sha256,
       evidence.evidence_sha256,
       evidence.effective_at
     FROM pilot_text_ai_consent_evidence AS evidence
     JOIN support_cases AS support_case ON support_case.id = evidence.support_case_id
     WHERE evidence.org_id = ? AND evidence.support_case_id = ?
       AND evidence.effective_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     ORDER BY evidence.effective_at DESC, evidence.created_at DESC, evidence.id DESC
     LIMIT 1`,
  ).bind(actor.orgId, context.supportCaseId).first<DbRow>();
  const status: PilotTextAiConsentStatus = row === null
    ? {
      caseId,
      status: 'missing',
      evidenceId: null,
      noticeVersion: null,
      noticeHash: null,
      evidenceHash: null,
      effectiveAt: null,
    }
    : {
      caseId: stringValue(row.case_id),
      status: 'recorded',
      evidenceId: stringValue(row.id),
      noticeVersion: stringValue(row.notice_version),
      noticeHash: stringValue(row.notice_sha256),
      evidenceHash: stringValue(row.evidence_sha256),
      effectiveAt: stringValue(row.effective_at),
    };
  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'pilot_text_ai_consent_evidence',
    ...(row === null ? {} : { targetId: stringValue(row.id) }),
    caseId,
    detail: { purpose: 'text_ai_pilot_status', recorded: status.status === 'recorded' },
  });
  return status;
}


/**
 * Phase 1 텍스트 AI의 유일한 grant 검사. 파일럿 중지 또는 증적 부재는 모두
 * content-free 안정 오류로 거부한다. 호출자는 provider outbound 직전에도 이 함수를
 * 다시 호출해야 한다.
 */
export async function assertPilotTextAiConsent(
  env: Env,
  actor: Actor,
  caseId: string,
): Promise<PilotTextAiConsentEvidence> {
  await assertPhase1CaseAccess(env, actor, caseId, 'pilot_text_ai_consent_evidence');
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);

  if (!isPilotTextAiEnabled(env)) {
    await writePhase1Denial(env, actor, {
      targetTable: 'pilot_text_ai_consent_evidence',
      caseId,
      reason: 'text_ai_pilot_disabled',
    });
    throw new TextAiPilotDisabledError();
  }

  const row = await env.DB.prepare(
    `SELECT evidence.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM pilot_text_ai_consent_evidence AS evidence
     JOIN support_cases AS support_case ON support_case.id = evidence.support_case_id
     WHERE evidence.org_id = ? AND evidence.support_case_id = ?
       AND evidence.effective_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     ORDER BY evidence.effective_at DESC, evidence.created_at DESC, evidence.id DESC
     LIMIT 1`,
  ).bind(actor.orgId, context.supportCaseId).first<DbRow>();
  if (row === null) {
    await writePhase1Denial(env, actor, {
      targetTable: 'pilot_text_ai_consent_evidence',
      caseId,
      reason: 'pilot_text_ai_consent_required',
    });
    throw new PilotTextAiConsentRequiredError();
  }

  const evidence = mapPilotTextAiConsentEvidence(row);
  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'pilot_text_ai_consent_evidence',
    targetId: evidence.id,
    caseId,
    detail: { purpose: 'text_ai_pilot_grant_check' },
  });
  return evidence;
}
/**
 * Reasserts the Phase-1 text-AI grant for a service-bound session immediately
 * before provider work. It intentionally returns no consent reference metadata.
 */
export async function assertPilotTextAiConsentForService(
  env: Env,
  actor: Actor,
  sessionId: string,
): Promise<ServiceTextAiSessionGrant> {
  const grant = await assertServiceTextAiSessionGrant(env, actor, sessionId);
  return {
    sessionId: grant.session.id,
    caseId: grant.session.caseId,
    consentEvidenceId: grant.consentEvidenceId,
  };
}

function assertMaskedSourceSnapshotInput(input: RecordMaskedSourceSnapshotInput): void {
  if (input === null || typeof input !== 'object') {
    throw new ValidationError('masked source snapshot input is invalid');
  }

  assertRequiredText(input.maskedText, 'masked source text');
  assertSha256(input.sha256, 'masked source hash');
  assertVersionIdentifier(input.maskingPipelineVersion, 'masking pipeline version');
  if (!Array.isArray(input.evidence)) {
    throw new ValidationError('masked source evidence must be a list');
  }

  const evidenceIds = new Set<string>();
  const evidenceSpans = new Set<string>();
  for (const item of input.evidence) {
    if (item === null || typeof item !== 'object') {
      throw new ValidationError('masked source evidence item is invalid');
    }

    assertOpaqueIdentifier(item.id, 'masked source evidence id');
    assertOpaqueReference(item.sourceRef, 'masked source evidence reference');
    assertSha256(item.sourceSha256, 'masked source evidence hash');
    assertRequiredText(item.evidenceQuote, 'masked source evidence quote');
    if (
      !Number.isInteger(item.sourceStart)
      || item.sourceStart < 0
      || !Number.isInteger(item.sourceEnd)
      || item.sourceEnd <= item.sourceStart
    ) {
      throw new ValidationError('masked source evidence positions are invalid');
    }

    if (evidenceIds.has(item.id)) {
      throw new ValidationError('masked source evidence ids must be unique');
    }
    const spanKey = `${item.sourceRef}\u0000${item.sourceStart}\u0000${item.sourceEnd}`;
    if (evidenceSpans.has(spanKey)) {
      throw new ValidationError('masked source evidence spans must be unique');
    }
    evidenceIds.add(item.id);
    evidenceSpans.add(spanKey);
  }
}

/**
 * Persists an immutable, fully masked source snapshot before provider outbound.
 * The service sends local-NER-masked text; the gateway re-applies registered
 * PII substitution and verifies the resulting SHA-256 and every exact span.
 */
export async function recordMaskedSourceSnapshot(
  env: Env,
  actor: Actor,
  sessionId: string,
  input: RecordMaskedSourceSnapshotInput,
): Promise<MaskedSourceSnapshot> {
  const grant = await assertServiceTextAiSessionGrant(env, actor, sessionId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, grant.session.caseId);
  try {
    assertMaskedSourceSnapshotInput(input);
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_masked_source_snapshots',
      targetId: sessionId,
      caseId: grant.session.caseId,
      reason: 'invalid_masked_source_snapshot',
    });
    throw error;
  }

  const pii = await readPiiValues(env, actor.orgId, grant.session.caseId);
  await writeAudit(env, actor, {
    action: 'decrypt_pii',
    targetTable: 'pii_vault',
    targetId: grant.session.caseId,
    caseId: grant.session.caseId,
  });
  const mask = (text: string): string => maskRegisteredPii(text, grant.session.caseId, pii);
  const maskedText = mask(input.maskedText);
  const snapshotHash = await sha256Hex(maskedText);
  if (snapshotHash !== input.sha256) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_masked_source_snapshots',
      targetId: sessionId,
      caseId: grant.session.caseId,
      reason: 'masked_source_hash_mismatch',
    });
    throw new ValidationError('masked source snapshot hash is invalid');
  }

  const evidence: MaskedSourceEvidenceItem[] = [];
  try {
    for (const item of input.evidence) {
      const evidenceQuote = mask(item.evidenceQuote);
      if (
        item.sourceSha256 !== snapshotHash
        || sourceTextSpan(maskedText, item.sourceStart, item.sourceEnd) !== evidenceQuote
      ) {
        throw new ValidationError('masked source evidence is invalid');
      }
      evidence.push({
        id: item.id,
        snapshotId: '',
        sourceRef: item.sourceRef,
        sourceSha256: snapshotHash,
        evidenceQuote,
        sourceStart: item.sourceStart,
        sourceEnd: item.sourceEnd,
        createdAt: '',
      });
    }
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_masked_source_evidence_items',
      targetId: sessionId,
      caseId: grant.session.caseId,
      reason: 'invalid_masked_source_evidence',
    });
    throw error;
  }

  const createdAt = now();
  const snapshotId = newId();
  const snapshot: MaskedSourceSnapshot = {
    id: snapshotId,
    caseId: grant.session.caseId,
    sessionId: grant.session.id,
    maskedText,
    sha256: snapshotHash,
    maskingPipelineVersion: input.maskingPipelineVersion,
    createdAt,
    evidence: evidence.map((item) => ({
      ...item,
      snapshotId,
      createdAt,
    })),
  };
  try {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO ai_masked_source_snapshots (id, org_id, support_case_id, session_id, masked_text, sha256, masking_pipeline_version, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      snapshot.id,
      actor.orgId,
      context.supportCaseId,
      snapshot.sessionId,
      snapshot.maskedText,
      snapshot.sha256,
      snapshot.maskingPipelineVersion,
      actor.userId,
      snapshot.createdAt,
    ),
    ...snapshot.evidence.map((item) => env.DB.prepare(
      'INSERT INTO ai_masked_source_evidence_items (id, snapshot_id, org_id, support_case_id, session_id, source_ref, source_sha256, evidence_quote, source_start, source_end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      item.id,
      snapshot.id,
      actor.orgId,
      context.supportCaseId,
      snapshot.sessionId,
      item.sourceRef,
      item.sourceSha256,
      item.evidenceQuote,
      item.sourceStart,
      item.sourceEnd,
      item.createdAt,
    )),
  ]);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      await writePhase1Denial(env, actor, {
        targetTable: 'ai_masked_source_snapshots',
        targetId: snapshot.id,
        caseId: snapshot.caseId,
        reason: 'masked_source_snapshot_conflict',
      });
      throw new ValidationError('masked source snapshot conflict');
    }
    throw error;
  }

  await writeAudit(env, actor, {
    action: 'create',
    targetTable: 'ai_masked_source_snapshots',
    targetId: snapshot.id,
    caseId: snapshot.caseId,
    detail: {
      maskingPipelineVersion: snapshot.maskingPipelineVersion,
      evidenceItemCount: snapshot.evidence.length,
    },
  });
  return snapshot;
}

/** Reloads only the immutable masked provider input for the granted session. */
export async function loadMaskedSourceSnapshotForService(
  env: Env,
  actor: Actor,
  sessionId: string,
  snapshotId: string,
): Promise<MaskedSourceSnapshot> {
  const grant = await assertServiceTextAiSessionGrant(env, actor, sessionId);
  try {
    assertOpaqueIdentifier(snapshotId, 'masked source snapshot id');
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_masked_source_snapshots',
      targetId: sessionId,
      caseId: grant.session.caseId,
      reason: 'invalid_masked_source_snapshot',
    });
    throw error;
  }
  let snapshot: MaskedSourceSnapshot;
  try {
    snapshot = await getMaskedSourceSnapshotForOrg(
      env,
      actor.orgId,
      grant.session.caseId,
      grant.session.id,
      snapshotId,
    );
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_masked_source_snapshots',
      targetId: snapshotId,
      caseId: grant.session.caseId,
      reason: 'forbidden',
    });
    throw error;
  }

  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'ai_masked_source_snapshots',
    targetId: snapshot.id,
    caseId: snapshot.caseId,
    detail: { purpose: 'service_text_ai_provider_input', evidenceItemCount: snapshot.evidence.length },
  });
  return snapshot;
}
type AttestedAiEvidenceInput = AiEvidenceInput & { sourceEvidenceItemId: string };

function resolveAttestedAiEvidence(
  snapshot: MaskedSourceSnapshot,
  evidence: AiEvidenceInput[],
): AttestedAiEvidenceInput[] {
  return evidence.map((link) => {
    const exactMatches = snapshot.evidence.filter((item) => (
      item.evidenceQuote === link.evidenceQuote
      && item.sourceRef === link.sourceRef
      && item.sourceStart === link.sourceStart
      && item.sourceEnd === link.sourceEnd
    ));
    const sourceItem = link.sourceEvidenceItemId === undefined
      ? exactMatches.length === 1 ? exactMatches[0] : undefined
      : snapshot.evidence.find((item) => item.id === link.sourceEvidenceItemId);

    if (
      sourceItem === undefined
      || sourceItem.evidenceQuote !== link.evidenceQuote
      || sourceItem.sourceRef !== link.sourceRef
      || sourceItem.sourceStart !== link.sourceStart
      || sourceItem.sourceEnd !== link.sourceEnd
      || sourceItem.sourceSha256 !== snapshot.sha256
    ) {
      throw new ValidationError('AI evidence is not attested by the source snapshot');
    }

    return {
      sourceEvidenceItemId: sourceItem.id,
      claimKey: link.claimKey,
      evidenceQuote: sourceItem.evidenceQuote,
      sourceRef: sourceItem.sourceRef,
      sourceStart: sourceItem.sourceStart,
      sourceEnd: sourceItem.sourceEnd,
    };
  });
}
/**
 * Creates a provider-generated draft only for the service actor. It reloads the
 * immutable masked source snapshot for the same session, reasserts the pilot
 * grant, verifies active provider runtime metadata, and never accepts browser
 * or counselor generation.
 */
export async function createGeneratedAiDraft(
  env: Env,
  actor: Actor,
  sessionId: string,
  input: GeneratedAiDraftInput,
): Promise<AiDraftVersion> {
  const serviceGrant = await assertServiceTextAiSessionGrant(env, actor, sessionId);
  const session = serviceGrant.session;
  const context = await resolveLegacyCaseContext(env, actor.orgId, session.caseId);
  if (session.memo === null) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_draft_versions',
      targetId: sessionId,
      caseId: session.caseId,
      reason: 'manual_memo_required',
    });
    throw new ValidationError('a manual memo is required for text AI generation');
  }

  let normalizedInput: GeneratedAiDraftInput;
  try {
    if (input === null || typeof input !== 'object') {
      throw new ValidationError('AI draft input is invalid');
    }
    normalizedInput = {
      ...input,
      kind: input.kind ?? AI_WORK_KIND_BRIEFING,
    };
    assertGeneratedAiDraftInput(normalizedInput, true);
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_draft_versions',
      targetId: sessionId,
      caseId: session.caseId,
      reason: 'invalid_ai_draft',
    });
    throw error;
  }

  const sourceSnapshotId = normalizedInput.sourceSnapshotId;
  if (sourceSnapshotId === undefined) {
    throw new ValidationError('source snapshot id is required');
  }
  let sourceSnapshot: MaskedSourceSnapshot;
  try {
    sourceSnapshot = await loadMaskedSourceSnapshotForService(
      env,
      actor,
      session.id,
      sourceSnapshotId,
    );
    if (sourceSnapshot.sha256 !== normalizedInput.sourceSnapshotHash) {
      throw new ValidationError('source snapshot hash is invalid');
    }
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_masked_source_snapshots',
      targetId: sourceSnapshotId,
      caseId: session.caseId,
      reason: 'source_snapshot_attestation_required',
    });
    throw error;
  }

  const providerRuntime = await getActiveAiProviderRuntimeMetadataForService(env, actor, session.id);
  if (
    providerRuntime.providerConfigId !== normalizedInput.providerConfigId
    || providerRuntime.consentEvidenceId !== normalizedInput.consentEvidenceId
  ) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_draft_versions',
      targetId: sessionId,
      caseId: session.caseId,
      reason: 'provider_execution_selection_stale',
    });
    throw new StaleDraftVersionError();
  }
  const consentEvidenceId = normalizedInput.consentEvidenceId;
  const providerConfigId = normalizedInput.providerConfigId;
  const maskedInput = await maskGeneratedAiDraftInput(env, actor, session.caseId, normalizedInput);
  let attestedEvidence: AttestedAiEvidenceInput[];
  try {
    attestedEvidence = resolveAttestedAiEvidence(sourceSnapshot, maskedInput.evidence);
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_evidence_links',
      targetId: sourceSnapshot.id,
      caseId: session.caseId,
      reason: 'source_evidence_attestation_required',
    });
    throw error;
  }

  const existingWorkItem = await findAiWorkItemForSession(
    env,
    actor.orgId,
    sessionId,
    AI_WORK_KIND_BRIEFING,
  );
  if (existingWorkItem !== null) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_work_items',
      targetId: existingWorkItem.id,
      caseId: session.caseId,
      reason: 'stale_draft_version',
    });
    throw new StaleDraftVersionError();
  }

  const createdAt = now();
  const workItem: AiWorkItem = {
    id: newId(),
    caseId: session.caseId,
    sessionId,
    kind: AI_WORK_KIND_BRIEFING,
    createdAt,
  };
  const draftId = newId();
  const draftVersion = 1;
  const parentVersionId = null;
  const evidence: AiEvidenceLink[] = attestedEvidence.map((item) => ({
    id: newId(),
    draftVersionId: draftId,
    sourceEvidenceItemId: item.sourceEvidenceItemId,
    claimKey: item.claimKey,
    evidenceQuote: item.evidenceQuote,
    sourceRef: item.sourceRef,
    sourceStart: item.sourceStart,
    sourceEnd: item.sourceEnd,
    createdAt,
  }));

  try {
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        'INSERT INTO ai_work_items (id, org_id, support_case_id, session_id, kind, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).bind(workItem.id, actor.orgId, context.supportCaseId, workItem.sessionId, workItem.kind, workItem.createdAt),
    ];
    statements.push(env.DB.prepare(
      'INSERT INTO ai_draft_versions (id, work_item_id, version, parent_version_id, summary_text, one_liner, questions_json, source_snapshot_id, source_snapshot_hash, consent_evidence_id, provider_config_id, model_id, prompt_version, schema_version, origin, creation_mode, grounding_status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      draftId,
      workItem.id,
      draftVersion,
      parentVersionId,
      maskedInput.summaryText,
      maskedInput.oneLiner ?? null,
      questionsToJson(maskedInput.questions),
      sourceSnapshot.id,
      sourceSnapshot.sha256,
      consentEvidenceId,
      providerConfigId,
      maskedInput.modelId,
      maskedInput.promptVersion,
      maskedInput.schemaVersion,
      'generated',
      'provider_generated',
      'grounded',
      actor.userId,
      createdAt,
    ));
    for (const link of evidence) {
      statements.push(env.DB.prepare(
        'INSERT INTO ai_evidence_links (id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote, source_ref, source_start, source_end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        link.id,
        link.draftVersionId,
        link.sourceEvidenceItemId,
        link.claimKey,
        link.evidenceQuote,
        link.sourceRef,
        link.sourceStart,
        link.sourceEnd,
        link.createdAt,
      ));
    }
    await env.DB.batch(statements);
  } catch (error) {
    if (isUniqueConstraintError(error) || isStaleDraftVersionError(error)) {
      await writePhase1Denial(env, actor, {
        targetTable: 'ai_draft_versions',
        targetId: sessionId,
        caseId: session.caseId,
        reason: 'stale_draft_version',
      });
      throw new StaleDraftVersionError();
    }
    throw error;
  }

  await writeAudit(env, actor, {
    action: 'create',
    targetTable: 'ai_work_items',
    targetId: workItem.id,
    caseId: workItem.caseId,
    detail: { kind: workItem.kind },
  });
  await writeAudit(env, actor, {
    action: 'create',
    targetTable: 'ai_draft_versions',
    targetId: draftId,
    caseId: workItem.caseId,
    detail: {
      version: draftVersion,
      evidenceCount: evidence.length,
      questionCount: maskedInput.questions.length,
      origin: 'generated',
      creationMode: 'provider_generated',
      providerAdapter: providerRuntime.adapterId,
      providerAdapterVersion: providerRuntime.adapterVersion,
    },
  });
  return {
    id: draftId,
    workItemId: workItem.id,
    caseId: workItem.caseId,
    sessionId,
    kind: workItem.kind,
    version: draftVersion,
    parentVersionId,
    summaryText: maskedInput.summaryText,
    oneLiner: maskedInput.oneLiner ?? null,
    questions: maskedInput.questions,
    sourceSnapshotId: sourceSnapshot.id,
    sourceSnapshotHash: sourceSnapshot.sha256,
    consentEvidenceId,
    providerConfigId,
    modelId: maskedInput.modelId,
    promptVersion: maskedInput.promptVersion,
    schemaVersion: maskedInput.schemaVersion,
    origin: 'generated',
    creationMode: 'provider_generated',
    groundingStatus: 'grounded',
    createdBy: actor.userId,
    createdAt,
    reviewDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    replacementDraftId: null,
    evidence,
  };
}
/** Explicit API-worker entry point for the service-only provider completion path. */
export async function createGeneratedAiDraftForService(
  env: Env,
  actor: Actor,
  sessionId: string,
  input: GeneratedAiDraftInput,
): Promise<AiDraftVersion> {
  return createGeneratedAiDraft(env, actor, sessionId, input);
}
/**
 * Generated 초안을 수정하면 이전 행을 바꾸지 않고 새 버전을 삽입한 뒤 이전 버전에
 * superseded 검토 이벤트를 append한다. 동시 수정은 unique version 제약으로 stale 처리한다.
 */
async function editGeneratedAiDraft(
  env: Env,
  actor: Actor,
  workItemId: string,
  input: EditGeneratedAiDraftInput,
): Promise<AiDraftVersion> {
  const workItem = await assertAiWorkItemAccess(env, actor, workItemId);

  let expectedVersion: number;
  try {
    expectedVersion = requireExpectedDraftVersion(
      input !== null && typeof input === 'object' ? input.expectedVersion : undefined,
    );
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_draft_versions',
      targetId: workItemId,
      caseId: workItem.caseId,
      reason: 'draft_version_required',
    });
    throw error;
  }

  let current: AiDraftVersion;
  try {
    current = await getCurrentAiDraftVersion(env, actor.orgId, workItem.id);
    assertCurrentGeneratedPendingDraft(current, expectedVersion);
    if (
      current.sourceSnapshotId === null
      || current.sourceSnapshotHash === null
      || current.providerConfigId === null
      || current.modelId === null
      || current.promptVersion === null
      || current.schemaVersion === null
    ) {
      throw new StaleDraftVersionError();
    }
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_draft_versions',
      targetId: workItem.id,
      caseId: workItem.caseId,
      reason: error instanceof StaleDraftVersionError ? 'stale_draft_version' : 'invalid_ai_draft_state',
    });
    throw error;
  }

  try {
    assertGeneratedAiDraftInput(input, false, false);
    if (
      input.sourceSnapshotHash !== current.sourceSnapshotHash
      || input.modelId !== current.modelId
      || input.promptVersion !== current.promptVersion
      || input.schemaVersion !== current.schemaVersion
      || (input.sourceSnapshotId !== undefined && input.sourceSnapshotId !== current.sourceSnapshotId)
      || questionsToJson(input.questions) !== questionsToJson(current.questions)
      // 핵심 한 줄도 질문과 같이 AI 산출물이다 — 사람 편집은 증거 재선택뿐, 한 줄은 부모 그대로.
      || (input.oneLiner ?? null) !== current.oneLiner
    ) {
      throw new ValidationError('AI draft provenance must match its parent');
    }
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_draft_versions',
      targetId: current.id,
      caseId: workItem.caseId,
      reason: 'invalid_ai_draft',
    });
    throw error;
  }

  let sourceSnapshot: MaskedSourceSnapshot;
  try {
    sourceSnapshot = await getMaskedSourceSnapshotForOrg(
      env,
      actor.orgId,
      workItem.caseId,
      workItem.sessionId,
      current.sourceSnapshotId,
    );
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_masked_source_snapshots',
      targetId: current.sourceSnapshotId,
      caseId: workItem.caseId,
      reason: 'source_snapshot_attestation_required',
    });
    throw error;
  }
  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'ai_masked_source_snapshots',
    targetId: sourceSnapshot.id,
    caseId: workItem.caseId,
    detail: { purpose: 'human_edit_attestation' },
  });

  const consentEvidence = await assertPilotTextAiConsent(env, actor, workItem.caseId);
  const maskedInput = await maskGeneratedAiDraftInput(env, actor, workItem.caseId, input);
  let attestedEvidence: AttestedAiEvidenceInput[];
  try {
    attestedEvidence = resolveAttestedAiEvidence(sourceSnapshot, maskedInput.evidence);
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_evidence_links',
      targetId: current.id,
      caseId: workItem.caseId,
      reason: 'source_evidence_attestation_required',
    });
    throw error;
  }

  const createdAt = now();
  const draftId = newId();
  const nextVersion = current.version + 1;
  const evidence: AiEvidenceLink[] = attestedEvidence.map((item) => ({
    id: newId(),
    draftVersionId: draftId,
    sourceEvidenceItemId: item.sourceEvidenceItemId,
    claimKey: item.claimKey,
    evidenceQuote: item.evidenceQuote,
    sourceRef: item.sourceRef,
    sourceStart: item.sourceStart,
    sourceEnd: item.sourceEnd,
    createdAt,
  }));

  try {
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        'INSERT INTO ai_draft_versions (id, work_item_id, version, parent_version_id, summary_text, one_liner, questions_json, source_snapshot_id, source_snapshot_hash, consent_evidence_id, provider_config_id, model_id, prompt_version, schema_version, origin, creation_mode, grounding_status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        draftId,
        workItem.id,
        nextVersion,
        current.id,
        maskedInput.summaryText,
        maskedInput.oneLiner ?? null,
        questionsToJson(maskedInput.questions),
        current.sourceSnapshotId,
        current.sourceSnapshotHash,
        consentEvidence.id,
        current.providerConfigId,
        current.modelId,
        current.promptVersion,
        current.schemaVersion,
        'generated',
        'human_edited',
        'grounded',
        actor.userId,
        createdAt,
      ),
    ];
    for (const link of evidence) {
      statements.push(env.DB.prepare(
        'INSERT INTO ai_evidence_links (id, draft_version_id, source_evidence_item_id, claim_key, evidence_quote, source_ref, source_start, source_end, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        link.id,
        link.draftVersionId,
        link.sourceEvidenceItemId,
        link.claimKey,
        link.evidenceQuote,
        link.sourceRef,
        link.sourceStart,
        link.sourceEnd,
        link.createdAt,
      ));
    }
    statements.push(env.DB.prepare(
      'INSERT INTO ai_review_events (id, work_item_id, draft_version_id, decision, replacement_draft_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(newId(), workItem.id, current.id, 'superseded', draftId, actor.userId, createdAt));
    await env.DB.batch(statements);
  } catch (error) {
    if (isUniqueConstraintError(error) || isStaleDraftVersionError(error)) {
      await writePhase1Denial(env, actor, {
        targetTable: 'ai_draft_versions',
        targetId: current.id,
        caseId: workItem.caseId,
        reason: 'stale_draft_version',
      });
      throw new StaleDraftVersionError();
    }
    throw error;
  }

  await writeAudit(env, actor, {
    action: 'update',
    targetTable: 'ai_draft_versions',
    targetId: draftId,
    caseId: workItem.caseId,
    detail: {
      version: nextVersion,
      supersedesVersion: current.version,
      evidenceCount: evidence.length,
      questionCount: maskedInput.questions.length,
      creationMode: 'human_edited',
    },
  });
  return {
    id: draftId,
    workItemId: workItem.id,
    caseId: workItem.caseId,
    sessionId: workItem.sessionId,
    kind: workItem.kind,
    version: nextVersion,
    parentVersionId: current.id,
    summaryText: maskedInput.summaryText,
    oneLiner: maskedInput.oneLiner ?? null,
    questions: maskedInput.questions,
    sourceSnapshotId: current.sourceSnapshotId,
    sourceSnapshotHash: current.sourceSnapshotHash,
    consentEvidenceId: consentEvidence.id,
    providerConfigId: current.providerConfigId,
    modelId: current.modelId,
    promptVersion: current.promptVersion,
    schemaVersion: current.schemaVersion,
    origin: 'generated',
    creationMode: 'human_edited',
    groundingStatus: 'grounded',
    createdBy: actor.userId,
    createdAt,
    reviewDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    replacementDraftId: null,
    evidence,
  };
}
function isCompleteGroundingEvidence(evidence: AiEvidenceLink[], questions: AiBriefingSuggestion[]): boolean {
  return (
    evidence.length > 0
    && evidence.every((link) => (
      link.claimKey.length > 0
      && link.evidenceQuote.trim().length > 0
      && link.sourceRef.length > 0
    ))
    && evidence.some((link) => !isQuestionClaimKey(link.claimKey))
    && questions.every((_, index) => evidence.some((link) => link.claimKey === questionClaimKey(index)))
  );
}

/**
 * 현재 pending generated draft에만 하나의 terminal review event를 append한다. 승인 시
 * sessions 호환 컬럼도 같은 batch에서 갱신하지만, 공식 읽기는 항상 view를 사용한다.
 */
export async function reviewGeneratedAiDraft(
  env: Env,
  actor: Actor,
  workItemId: string,
  input: AiDraftReviewInput,
): Promise<AiDraftVersion> {
  const workItem = await assertAiWorkItemAccess(env, actor, workItemId);

  let expectedVersion: number;
  let decision: 'approved' | 'rejected';
  try {
    expectedVersion = requireExpectedDraftVersion(
      input !== null && typeof input === 'object' ? input.expectedVersion : undefined,
    );
    const proposedDecision: unknown = input !== null && typeof input === 'object'
      ? input.decision
      : undefined;
    if (proposedDecision !== 'approved' && proposedDecision !== 'rejected') {
      throw new ValidationError('AI review decision is invalid');
    }
    decision = proposedDecision;
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_review_events',
      targetId: workItem.id,
      caseId: workItem.caseId,
      reason: error instanceof DraftVersionRequiredError ? 'draft_version_required' : 'invalid_review_decision',
    });
    throw error;
  }

  await assertPilotTextAiConsent(env, actor, workItem.caseId);
  let current: AiDraftVersion;
  try {
    current = await getCurrentAiDraftVersion(env, actor.orgId, workItem.id);
    assertCurrentGeneratedPendingDraft(current, expectedVersion);
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_review_events',
      targetId: workItem.id,
      caseId: workItem.caseId,
      reason: error instanceof StaleDraftVersionError ? 'stale_draft_version' : 'invalid_ai_draft_state',
    });
    throw error;
  }

  if (decision === 'approved' && !isCompleteGroundingEvidence(current.evidence, current.questions)) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_review_events',
      targetId: current.id,
      caseId: workItem.caseId,
      reason: 'grounded_evidence_required',
    });
    throw new GroundedEvidenceRequiredError();
  }

  const reviewedAt = now();
  try {
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(
        'INSERT INTO ai_review_events (id, work_item_id, draft_version_id, decision, replacement_draft_id, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(newId(), workItem.id, current.id, decision, null, actor.userId, reviewedAt),
    ];
    if (decision === 'approved') {
      statements.push(env.DB.prepare(
        'UPDATE sessions SET ai_status = ?, ai_summary = ?, approved_at = ?, approved_by = ?, updated_at = ? WHERE id = ? AND org_id = ?',
      ).bind('approved', current.summaryText, reviewedAt, actor.userId, reviewedAt, workItem.sessionId, actor.orgId));
    }
    await env.DB.batch(statements);
  } catch (error) {
    if (isUniqueConstraintError(error) || isStaleDraftVersionError(error)) {
      await writePhase1Denial(env, actor, {
        targetTable: 'ai_review_events',
        targetId: current.id,
        caseId: workItem.caseId,
        reason: 'stale_draft_version',
      });
      throw new StaleDraftVersionError();
    }
    throw error;
  }

  await writeAudit(env, actor, {
    action: decision === 'approved' ? 'approve' : 'reject',
    targetTable: 'ai_draft_versions',
    targetId: current.id,
    caseId: workItem.caseId,
    detail: { version: current.version, origin: current.origin },
  });
  return {
    ...current,
    reviewDecision: decision,
    reviewedBy: actor.userId,
    reviewedAt,
    replacementDraftId: null,
  };
}

/** 현재 draft의 승인 전 검토 내용은 case assignee/admin에게만 제공한다. */
export async function getCurrentGeneratedAiDraft(
  env: Env,
  actor: Actor,
  workItemId: string,
): Promise<AiDraftVersion> {
  const workItem = await assertAiWorkItemAccess(env, actor, workItemId);
  const draft = await getCurrentAiDraftVersion(env, actor.orgId, workItem.id);
  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'ai_draft_versions',
    targetId: draft.id,
    caseId: workItem.caseId,
    detail: { version: draft.version, official: false },
  });
  return draft;
}
/**
 * Resolves the single Phase-1 work item for a session after authorizing the
 * caller against its case. It is intentionally session-scoped for HTTP/UI
 * callers; work-item ids remain an internal immutable-storage detail.
 */
export async function getLatestAiWorkItemForSession(
  env: Env,
  actor: Actor,
  sessionId: string,
): Promise<AiWorkItem | null> {
  const session = await assertPhase1SessionAccess(env, actor, sessionId);
  const workItem = await findAiWorkItemForSession(env, actor.orgId, sessionId, AI_WORK_KIND_BRIEFING);
  await writeAudit(env, actor, {
    action: 'read',
    targetTable: workItem === null ? 'sessions' : 'ai_work_items',
    targetId: workItem?.id ?? sessionId,
    caseId: session.caseId,
    detail: { kind: AI_WORK_KIND_BRIEFING, found: workItem !== null },
  });
  return workItem;
}

/** Returns the current immutable draft for a session, or null before work exists. */
export async function getCurrentAiDraftForSession(
  env: Env,
  actor: Actor,
  sessionId: string,
): Promise<AiDraftVersion | null> {
  const workItem = await getLatestAiWorkItemForSession(env, actor, sessionId);
  if (workItem === null) {
    return null;
  }
  return getCurrentGeneratedAiDraft(env, actor, workItem.id);
}


function editInputForCurrentAiDraft(
  current: AiDraftVersion,
  input: EditAiDraftForSessionInput,
): EditGeneratedAiDraftInput {
  const expectedVersion = requireExpectedDraftVersion(
    input !== null && typeof input === 'object' ? input.expectedVersion : undefined,
  );
  if (current.version !== expectedVersion || current.reviewDecision !== null) {
    throw new StaleDraftVersionError();
  }
  if (input === null || typeof input !== 'object') {
    throw new ValidationError('AI draft edit input is invalid');
  }
  if (!Array.isArray(input.evidenceIds) || input.evidenceIds.length === 0) {
    throw new ValidationError('AI evidence ids are required');
  }
  if (
    current.origin !== 'generated'
    || current.groundingStatus !== 'grounded'
    || current.sourceSnapshotId === null
    || current.sourceSnapshotHash === null
    || current.providerConfigId === null
    || current.modelId === null
    || current.promptVersion === null
    || current.schemaVersion === null
  ) {
    throw new StaleDraftVersionError();
  }

  const toInput = (evidence: AiEvidenceLink): AiEvidenceInput => ({
    sourceEvidenceItemId: evidence.sourceEvidenceItemId,
    claimKey: evidence.claimKey,
    evidenceQuote: evidence.evidenceQuote,
    sourceRef: evidence.sourceRef,
    sourceStart: evidence.sourceStart,
    sourceEnd: evidence.sourceEnd,
  });
  const evidenceById = new Map(current.evidence.map((evidence) => [evidence.id, evidence] as const));
  const selectedEvidence: AiEvidenceInput[] = [];
  const selectedIds = new Set<string>();
  const selectedEvidenceKeys = new Set<string>();
  for (const evidenceId of input.evidenceIds) {
    assertOpaqueIdentifier(evidenceId, 'AI evidence id');
    if (selectedIds.has(evidenceId)) {
      throw new ValidationError('AI evidence ids must be unique');
    }
    const evidence = evidenceById.get(evidenceId);
    if (evidence === undefined) {
      throw new ValidationError('AI evidence id is not available for this draft');
    }
    selectedIds.add(evidenceId);
    selectedEvidence.push(toInput(evidence));
    selectedEvidenceKeys.add(`${evidence.claimKey}\u0000${evidence.sourceEvidenceItemId}`);
  }
  const summaryText = selectedEvidence.map((evidence) => evidence.evidenceQuote).join('\n');

  const requiredQuestionEvidenceKeys = new Set(
    current.questions.map((_, index) => questionClaimKey(index)),
  );
  const questionEvidence = current.evidence.filter((evidence) => (
    requiredQuestionEvidenceKeys.has(evidence.claimKey)
  ));
  if (
    !current.questions.every((_, index) => (
      questionEvidence.some((evidence) => evidence.claimKey === questionClaimKey(index))
    ))
  ) {
    throw new GroundedEvidenceRequiredError();
  }
  for (const evidence of questionEvidence) {
    const key = `${evidence.claimKey}\u0000${evidence.sourceEvidenceItemId}`;
    if (!selectedEvidenceKeys.has(key)) {
      selectedEvidence.push(toInput(evidence));
      selectedEvidenceKeys.add(key);
    }
  }

  return {
    expectedVersion,
    summaryText,
    // 편집은 증거 재선택이다 — 핵심 한 줄은 부모 초안의 값을 그대로 잇는다(레거시면 NULL).
    oneLiner: current.oneLiner,
    questions: current.questions,
    sourceSnapshotId: current.sourceSnapshotId,
    sourceSnapshotHash: current.sourceSnapshotHash,
    modelId: current.modelId,
    promptVersion: current.promptVersion,
    schemaVersion: current.schemaVersion,
    evidence: selectedEvidence,
  };
}

/**
 * Creates an immutable replacement draft by session and current evidence ids.
 * Version checks, consent reassertion, source attestation, and append-only
 * writes remain delegated to editGeneratedAiDraft.
 */
export async function editAiDraftForSession(
  env: Env,
  actor: Actor,
  sessionId: string,
  input: EditAiDraftForSessionInput,
): Promise<AiDraftVersion> {
  requireExpectedDraftVersion(input !== null && typeof input === 'object' ? input.expectedVersion : undefined);
  const workItem = await getLatestAiWorkItemForSession(env, actor, sessionId);
  if (workItem === null) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_draft_versions',
      targetId: sessionId,
      reason: 'stale_draft_version',
    });
    throw new StaleDraftVersionError();
  }

  let current: AiDraftVersion;
  let editInput: EditGeneratedAiDraftInput;
  try {
    current = await getCurrentGeneratedAiDraft(env, actor, workItem.id);
    editInput = editInputForCurrentAiDraft(current, input);
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_draft_versions',
      targetId: workItem.id,
      caseId: workItem.caseId,
      reason: error instanceof StaleDraftVersionError ? 'stale_draft_version' : 'invalid_ai_draft',
    });
    throw error;
  }
  return editGeneratedAiDraft(env, actor, workItem.id, editInput);
}


/** Reviews the current immutable draft by session without exposing work-item ids. */
export async function reviewAiDraftForSession(
  env: Env,
  actor: Actor,
  sessionId: string,
  input: AiDraftReviewInput,
): Promise<AiDraftVersion> {
  requireExpectedDraftVersion(input !== null && typeof input === 'object' ? input.expectedVersion : undefined);
  const workItem = await getLatestAiWorkItemForSession(env, actor, sessionId);
  if (workItem === null) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_review_events',
      targetId: sessionId,
      reason: 'stale_draft_version',
    });
    throw new StaleDraftVersionError();
  }

  let current: AiDraftVersion;
  try {
    current = await getCurrentAiDraftVersion(env, actor.orgId, workItem.id);
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_review_events',
      targetId: workItem.id,
      caseId: workItem.caseId,
      reason: 'stale_draft_version',
    });
    throw new StaleDraftVersionError();
  }

  if (current.origin === 'generated') {
    return reviewGeneratedAiDraft(env, actor, workItem.id, input);
  }

  await writePhase1Denial(env, actor, {
    targetTable: 'ai_review_events',
    targetId: current.id,
    caseId: workItem.caseId,
    reason: 'stale_draft_version',
  });
  throw new StaleDraftVersionError();
}


export async function approveGeneratedAiDraft(
  env: Env,
  actor: Actor,
  workItemId: string,
  expectedVersion: number,
): Promise<AiDraftVersion> {
  return reviewGeneratedAiDraft(env, actor, workItemId, { expectedVersion, decision: 'approved' });
}

export async function rejectGeneratedAiDraft(
  env: Env,
  actor: Actor,
  workItemId: string,
  expectedVersion: number,
): Promise<AiDraftVersion> {
  return reviewGeneratedAiDraft(env, actor, workItemId, { expectedVersion, decision: 'rejected' });
}

async function loadApprovedAiBriefings(
  env: Env,
  orgId: string,
  caseId: string,
  sessionIds?: string[],
): Promise<ApprovedAiBriefing[]> {
  const context = await resolveLegacyCaseContext(env, orgId, caseId);
  const uniqueSessionIds = sessionIds === undefined ? [] : [...new Set(sessionIds)];
  if (sessionIds !== undefined && uniqueSessionIds.length === 0) {
    return [];
  }
  const sessionClause = uniqueSessionIds.length === 0
    ? ''
    : ` AND session_id IN (${uniqueSessionIds.map(() => '?').join(', ')})`;
  const result = await env.DB.prepare(
    `SELECT
       work_item_id,
       draft_version_id,
       case_id,
       session_id,
       draft_version,
       summary_text,
       one_liner,
       questions_json,
       origin,
       grounding_status,
       approved_by,
       approved_at
     FROM approved_ai_briefing_v1
     WHERE org_id = ? AND support_case_id = ?${sessionClause}
     ORDER BY approved_at DESC, draft_version DESC`,
  ).bind(orgId, context.supportCaseId, ...uniqueSessionIds).all<DbRow>();
  return result.results.map(mapApprovedAiBriefing);
}

/**
 * 공식 AI 브리핑은 immutable approved view만 통과한다. feature flag가 꺼져도 이미
 * 승인된 generated/legacy_import 행은 계속 읽혀 수기 및 과거 브리핑 연속성을 지킨다.
 */
export async function getApprovedAiBriefing(
  env: Env,
  actor: Actor,
  caseId: string,
): Promise<ApprovedAiBriefing[]> {
  await assertPhase1CaseAccess(env, actor, caseId, 'approved_ai_briefing_v1');
  const briefings = await loadApprovedAiBriefings(env, actor.orgId, caseId);
  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'approved_ai_briefing_v1',
    caseId,
    detail: { count: briefings.length },
  });
  return briefings;
}

function officialSessionFromApprovedBriefing(
  session: Session,
  briefing: ApprovedAiBriefing | undefined,
): Session {
  const official = officialSession(session);
  if (briefing === undefined) {
    return {
      ...official,
      approvedAt: null,
      approvedBy: null,
    };
  }

  return {
    ...official,
    aiStatus: 'approved',
    aiSummary: briefing.summaryText,
    approvedAt: briefing.approvedAt,
    approvedBy: briefing.approvedBy,
  };
}
// ============================================================================
// 내용 불일치 (session_discrepancies) — D45 · ADR-0018 · CCC-43
//
// 기록이 공식화되는 시점(수기 메모 저장 · AI 정리 승인)에 라우트가 ①
// collectDiscrepancyDetectionSources 로 가명 처리된 공식 텍스트를 모으고 ② 프로바이더
// 호출·검증(apps/api) 뒤 ③ replaceSessionDiscrepancies 로 저장한다. 브리핑은 저장된
// 결과만 읽는다(실시간 검사 기각, ADR-0018). 검출 실패는 기록 저장을 막지 않는다(D8).
// ============================================================================

export type DiscrepancyKind = 'cross_session' | 'within_session';
export type DiscrepancyResolutionStatus = 'situation_changed' | 'record_error' | 'confirmed';

export interface SessionDiscrepancy {
  id: string;
  supportCaseId: string;
  kind: DiscrepancyKind;
  triggerSessionId: string;
  leftSessionId: string;
  leftQuote: string;
  rightSessionId: string;
  rightQuote: string;
  detectedAt: string;
  /** 처리 3종(CCC-42). NULL = 미처리. 처리는 표시일 뿐 원본 기록은 불변이다(ADR-0018). */
  resolutionStatus: DiscrepancyResolutionStatus | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface DiscrepancyDetectionSource {
  sessionId: string;
  text: string;
}

export interface DiscrepancyDetectionMaterial {
  /** 레거시 케이스 ID — 텍스트 AI 동의 게이트(assertPilotTextAiConsent)용. */
  caseId: string;
  supportCaseId: string;
  triggerSessionId: string;
  /** 가명 처리 완료(R3) 공식 텍스트 — 회차당 수기 메모 + 승인된 AI 정리. 오래된 순. */
  sources: DiscrepancyDetectionSource[];
}

// 프로바이더에 보내는 회차 수 상한 — apps/api 의 MAX_DISCREPANCY_SOURCES 와 같은 값.
const DISCREPANCY_SOURCE_LIMIT = 12;
const DISCREPANCY_ITEM_LIMIT = 8;
const DISCREPANCY_QUOTE_LIMIT = 500;
// 브리핑이 싣는 처리된 이력의 상한(참여 사업당). 처리된 행은 삭제되지 않아 계속 쌓인다.
const DISCREPANCY_RESOLVED_HISTORY_LIMIT = 20;

async function resolveSessionScope(
  env: Env,
  orgId: string,
  sessionId: string,
): Promise<{ supportCaseId: string; beneficiaryId: string; caseId: string }> {
  const row = await env.DB.prepare(
    `SELECT session.support_case_id, support_case.beneficiary_id,
            COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM sessions AS session
     JOIN support_cases AS support_case ON support_case.id = session.support_case_id
     WHERE session.id = ? AND session.org_id = ?`,
  ).bind(sessionId, orgId).first<DbRow>();
  if (row === null) {
    throw new ForbiddenError('session is not available in this organization');
  }
  return {
    supportCaseId: stringValue(row.support_case_id),
    beneficiaryId: stringValue(row.beneficiary_id),
    caseId: stringValue(row.case_id),
  };
}

/**
 * 검출 재료 수집 — 공식 기록만(R2: 수기 메모(D5 즉시 공식) + 승인된 AI 정리).
 *
 * R3 (2026-07-31 · ADR-0027): 재료는 **처리 장비가 2차 마스킹(NER)한 스냅샷**
 * (`ai_masked_source_snapshots`)뿐이다. 수기 메모 원문을 쓰지 않는 이유는 금고에
 * 등록되지 않은 제3자("아들 김철수")를 1차 치환(maskRegisteredPii)이 잡지 못하기
 * 때문이다 — 그 텍스트는 사업자로 나갈 수 없다. 스냅샷이 없는 회차는 **재료에서
 * 빠지고**, 트리거 회차에 스냅샷이 없으면 호출자가 검출 자체를 스킵한다(D8:
 * 다음 공식화 때 재검출). 스냅샷을 만드는 것은 텍스트 일감 큐다.
 *
 * 권한: 담당 실무자 | admin (D7). 감사: PII 복호화 1건(decrypt_pii, D14).
 */
export async function collectDiscrepancyDetectionSources(
  env: Env,
  actor: Actor,
  triggerSessionId: string,
): Promise<DiscrepancyDetectionMaterial> {
  assertOpaqueIdentifier(triggerSessionId, 'session id');
  const scope = await resolveSessionScope(env, actor.orgId, triggerSessionId);
  if (actor.role === 'service') {
    // 장비가 스냅샷을 올린 직후의 재검출 경로(ADR-0027). 사람 담당 검사(D7) 대신
    // 서비스 역할 + 파일럿 활성 + 텍스트 AI 동의 근거를 확인한다.
    await assertPilotTextAiConsentForService(env, actor, triggerSessionId);
  } else {
    await assertSupportCaseAccess(env, actor, scope.supportCaseId);
  }

  const [sessionRows, approvedRows] = await Promise.all([
    // 회차당 최신 스냅샷 1건. 스냅샷이 없는 회차는 JOIN 에서 떨어진다.
    env.DB.prepare(
      `SELECT session.id AS id, session.held_at AS held_at, snapshot.masked_text AS masked_text
       FROM sessions AS session
       JOIN ai_masked_source_snapshots AS snapshot ON snapshot.id = (
         SELECT candidate.id FROM ai_masked_source_snapshots AS candidate
         WHERE candidate.org_id = session.org_id AND candidate.session_id = session.id
         ORDER BY candidate.created_at DESC, candidate.id DESC
         LIMIT 1
       )
       WHERE session.org_id = ? AND session.support_case_id = ?
       ORDER BY session.held_at DESC, session.id DESC
       LIMIT ?`,
    ).bind(actor.orgId, scope.supportCaseId, DISCREPANCY_SOURCE_LIMIT).all<DbRow>(),
    env.DB.prepare(
      `SELECT session_id, summary_text FROM approved_ai_briefing_v1
       WHERE org_id = ? AND support_case_id = ?
       ORDER BY approved_at DESC, draft_version DESC`,
    ).bind(actor.orgId, scope.supportCaseId).all<DbRow>(),
  ]);

  const approvedBySession = new Map<string, string>();
  for (const row of approvedRows.results) {
    const sessionId = stringValue(row.session_id);
    if (!approvedBySession.has(sessionId)) approvedBySession.set(sessionId, stringValue(row.summary_text));
  }

  const rows = [...sessionRows.results];
  if (!rows.some((row) => stringValue(row.id) === triggerSessionId)) {
    // 트리거 회차가 최근 N건 밖이면 따로 가져온다. 회차 자체가 없으면 권한 오류지만,
    // 스냅샷이 아직 없는 것은 오류가 아니라 스킵 사유다(마스킹 대기 중, D8).
    const triggerRow = await env.DB.prepare(
      `SELECT session.id AS id, session.held_at AS held_at, snapshot.masked_text AS masked_text
       FROM sessions AS session
       LEFT JOIN ai_masked_source_snapshots AS snapshot ON snapshot.id = (
         SELECT candidate.id FROM ai_masked_source_snapshots AS candidate
         WHERE candidate.org_id = session.org_id AND candidate.session_id = session.id
         ORDER BY candidate.created_at DESC, candidate.id DESC
         LIMIT 1
       )
       WHERE session.id = ? AND session.org_id = ? AND session.support_case_id = ?`,
    ).bind(triggerSessionId, actor.orgId, scope.supportCaseId).first<DbRow>();
    if (triggerRow === null) {
      throw new ForbiddenError('session is not available in this organization');
    }
    if (nullableString(triggerRow.masked_text) !== null) rows.push(triggerRow);
  }

  const pii = await readPiiValues(env, actor.orgId, scope.caseId);
  await writeAudit(env, actor, {
    action: 'decrypt_pii',
    targetTable: 'pii_vault',
    targetId: scope.caseId,
    caseId: scope.caseId,
    detail: { purpose: 'discrepancy_detection_masking' },
  });

  // 오래된 순으로 정렬해 회차 흐름이 보이게 보낸다.
  rows.sort((left, right) => stringValue(left.held_at).localeCompare(stringValue(right.held_at)));
  const sources: DiscrepancyDetectionSource[] = [];
  for (const row of rows) {
    const parts: string[] = [];
    // 2차 마스킹을 마친 스냅샷만 재료다(R3). 1차 치환은 그 위에 한 겹 더 얹는다.
    const maskedText = nullableString(row.masked_text);
    if (maskedText !== null && maskedText.trim().length > 0) parts.push(maskedText);
    const approvedSummary = approvedBySession.get(stringValue(row.id));
    if (approvedSummary !== undefined && approvedSummary.trim().length > 0) parts.push(approvedSummary);
    if (parts.length === 0) continue;
    sources.push({
      sessionId: stringValue(row.id),
      text: maskRegisteredPii(parts.join('\n'), scope.caseId, pii),
    });
  }

  return {
    caseId: scope.caseId,
    supportCaseId: scope.supportCaseId,
    triggerSessionId,
    sources,
  };
}

export interface DetectedSessionDiscrepancyInput {
  kind: DiscrepancyKind;
  leftSessionId: string;
  leftQuote: string;
  rightSessionId: string;
  rightQuote: string;
}

/**
 * 불일치 한 쌍의 동일성 키 — 유형 + 양쪽 (회차, 인용). 재검출이 이미 처리한 쌍을 다시
 * 올리지 않게 하는 데 쓴다(CCC-42). 인용까지 넣는 이유: 같은 두 회차에서 서로 다른 주제의
 * 불일치가 나올 수 있어 회차 쌍만으로는 다른 건까지 묻힌다. 좌우는 정렬한다 — 어느 쪽이
 * left 인지는 프로바이더가 그때그때 정하는 것이라 동일성의 일부가 아니다.
 *
 * 알려진 한계: **인용 텍스트가 정확히 같을 때만** 걸러진다. 프로바이더가 같은 불일치를 다른
 * 범위로 발췌하면(조사 하나 차이) 새 건으로 올라온다 — 출력 검증은 "소스 원문의 부분 문자열"만
 * 강제하고 같은 범위를 강제하지 않는다.
 */
function discrepancyPairKey(item: DetectedSessionDiscrepancyInput): string {
  const sides = [
    [item.leftSessionId, item.leftQuote],
    [item.rightSessionId, item.rightQuote],
  ].sort();
  return JSON.stringify([item.kind, sides]);
}

function mapSessionDiscrepancy(row: DbRow): SessionDiscrepancy {
  const resolution = nullableString(row.resolution_status);
  return {
    id: stringValue(row.id),
    supportCaseId: stringValue(row.support_case_id),
    kind: stringValue(row.kind) === 'within_session' ? 'within_session' : 'cross_session',
    triggerSessionId: stringValue(row.trigger_session_id),
    leftSessionId: stringValue(row.left_session_id),
    leftQuote: stringValue(row.left_quote),
    rightSessionId: stringValue(row.right_session_id),
    rightQuote: stringValue(row.right_quote),
    detectedAt: stringValue(row.detected_at),
    resolutionStatus: resolution === 'situation_changed' || resolution === 'record_error' || resolution === 'confirmed'
      ? resolution
      : null,
    resolvedBy: nullableString(row.resolved_by),
    resolvedAt: nullableString(row.resolved_at),
  };
}

/**
 * 검출 결과 저장 — 같은 트리거 회차의 **미처리** 행만 지우고 새 결과로 교체한다(재검출).
 * 처리된 행은 접힌 이력이라 남는다(ADR-0018, DB 트리거도 삭제를 막는다). 이미 이 참여 사업에
 * 있는 쌍(처리됨 또는 다른 트리거 회차의 미처리)은 새로 넣지 않는다 — 중복 방지. 인용은 저장 전에
 * 길이·유형 정합을 다시 검증하고, 회차 참조가 이 참여 사업의 회차인지도 확인한다.
 * 권한: 담당 실무자 | admin (D7). 감사: create 1건(D14).
 */
export async function replaceSessionDiscrepancies(
  env: Env,
  actor: Actor,
  triggerSessionId: string,
  items: DetectedSessionDiscrepancyInput[],
): Promise<SessionDiscrepancy[]> {
  assertOpaqueIdentifier(triggerSessionId, 'session id');
  if (!Array.isArray(items) || items.length > DISCREPANCY_ITEM_LIMIT) {
    throw new ValidationError('discrepancy items are invalid');
  }
  const scope = await resolveSessionScope(env, actor.orgId, triggerSessionId);
  if (actor.role === 'service') {
    // 장비 스냅샷 직후 재검출(ADR-0027). 사람 담당 검사 대신 서비스 텍스트 AI 게이트.
    await assertPilotTextAiConsentForService(env, actor, triggerSessionId);
  } else {
    assertHuman(actor);
    await assertSupportCaseAccess(env, actor, scope.supportCaseId);
  }

  const referencedIds = new Set<string>([triggerSessionId]);
  for (const item of items) {
    if (item === null || typeof item !== 'object') {
      throw new ValidationError('discrepancy item is invalid');
    }
    if (item.kind !== 'cross_session' && item.kind !== 'within_session') {
      throw new ValidationError('discrepancy kind is invalid');
    }
    assertOpaqueIdentifier(item.leftSessionId, 'discrepancy session id');
    assertOpaqueIdentifier(item.rightSessionId, 'discrepancy session id');
    for (const quote of [item.leftQuote, item.rightQuote]) {
      if (
        typeof quote !== 'string'
        || quote.trim().length === 0
        || quote.length > DISCREPANCY_QUOTE_LIMIT
      ) {
        throw new ValidationError('discrepancy quote is invalid');
      }
    }
    if (item.kind === 'within_session' && item.leftSessionId !== item.rightSessionId) {
      throw new ValidationError('within-session discrepancy must reference one session');
    }
    if (item.kind === 'cross_session' && item.leftSessionId === item.rightSessionId) {
      throw new ValidationError('cross-session discrepancy must reference two sessions');
    }
    if (item.leftSessionId !== triggerSessionId && item.rightSessionId !== triggerSessionId) {
      throw new ValidationError('discrepancy must involve the trigger session');
    }
    referencedIds.add(item.leftSessionId);
    referencedIds.add(item.rightSessionId);
  }

  const idList = [...referencedIds];
  const placeholders = idList.map(() => '?').join(', ');
  const known = await env.DB.prepare(
    `SELECT id FROM sessions
     WHERE org_id = ? AND support_case_id = ? AND id IN (${placeholders})`,
  ).bind(actor.orgId, scope.supportCaseId, ...idList).all<{ id: string }>();
  if (known.results.length !== idList.length) {
    throw new ForbiddenError('discrepancy references an unavailable session');
  }

  // 이미 있는 쌍은 다시 올리지 않는다 (CCC-42 · Q 결정 2026-07-29). 범위는 트리거 회차가 아니라
  // **참여 사업** 이다 — 검출은 수기 저장과 AI 초안 승인 양쪽에서 돌아가므로 같은 쌍이 서로 다른
  // 트리거 회차로 다시 올라올 수 있고, 그러면 브리핑에 같은 내용이 두 번 보인다.
  // 두 갈래를 함께 막는다: ① 처리된 행(트리거가 삭제를 막아 이력으로 남는다) ② **다른** 트리거
  // 회차의 미처리 행. 같은 트리거의 미처리 행은 아래 DELETE 가 지우고 새로 넣는 교체 대상이라
  // 제외한다 — 넣지 않으면 지우기만 하고 다시 못 넣는다.
  const existingRows = await env.DB.prepare(
    `SELECT kind, left_session_id, left_quote, right_session_id, right_quote
     FROM session_discrepancies
     WHERE org_id = ? AND support_case_id = ?
       AND (resolution_status IS NOT NULL OR trigger_session_id != ?)`,
  ).bind(actor.orgId, scope.supportCaseId, triggerSessionId).all<DbRow>();
  const existingKeys = new Set(existingRows.results.map((row) => discrepancyPairKey({
    kind: stringValue(row.kind) === 'within_session' ? 'within_session' : 'cross_session',
    leftSessionId: stringValue(row.left_session_id),
    leftQuote: stringValue(row.left_quote),
    rightSessionId: stringValue(row.right_session_id),
    rightQuote: stringValue(row.right_quote),
  })));
  const fresh = items.filter((item) => !existingKeys.has(discrepancyPairKey(item)));

  const detectedAt = now();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `DELETE FROM session_discrepancies
       WHERE org_id = ? AND trigger_session_id = ? AND resolution_status IS NULL`,
    ).bind(actor.orgId, triggerSessionId),
  ];
  const insertedIds: string[] = [];
  for (const item of fresh) {
    const id = newId();
    insertedIds.push(id);
    statements.push(env.DB.prepare(
      `INSERT INTO session_discrepancies (
         id, org_id, support_case_id, kind, trigger_session_id,
         left_session_id, left_quote, right_session_id, right_quote,
         detected_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      actor.orgId,
      scope.supportCaseId,
      item.kind,
      triggerSessionId,
      item.leftSessionId,
      item.leftQuote,
      item.rightSessionId,
      item.rightQuote,
      detectedAt,
      detectedAt,
    ));
  }
  statements.push(canonicalAuditStatement(env, actor, {
    action: 'create',
    targetTable: 'session_discrepancies',
    targetId: triggerSessionId,
    beneficiaryId: scope.beneficiaryId,
    supportCaseId: scope.supportCaseId,
    detail: { count: fresh.length, skippedExisting: items.length - fresh.length },
  }));
  await env.DB.batch(statements);

  if (insertedIds.length === 0) return [];
  const rows = await env.DB.prepare(
    `SELECT * FROM session_discrepancies
     WHERE org_id = ? AND id IN (${insertedIds.map(() => '?').join(', ')})`,
  ).bind(actor.orgId, ...insertedIds).all<DbRow>();
  // 같은 배치는 detected_at 이 동일해 시각 정렬이 무의미하다 — 입력(검출) 순서를 보존해 반환.
  const byId = new Map(rows.results.map((row) => [stringValue(row.id), mapSessionDiscrepancy(row)] as const));
  return insertedIds.flatMap((id) => {
    const mapped = byId.get(id);
    return mapped === undefined ? [] : [mapped];
  });
}

/**
 * 불일치 처리 3종 (상황 변경 / 기록 오류 / 확인 완료) — D45 · ADR-0018 · CCC-42.
 *
 * 처리는 **표시일 뿐 원본 기록은 불변**이다: 여기서 바뀌는 것은 처리 3컬럼뿐이고, 인용·회차·
 * 유형은 DB 트리거가 UPDATE 자체를 막는다. 처리된 행은 접힌 이력으로 남으며 삭제되지 않는다.
 *
 * 처리 종류는 **다시 바꿀 수 있다**(Q 결정 2026-07-29) — 잘못 누른 처리를 되돌릴 길을 남긴다.
 * 바꾼 전건이 감사로 쌓이므로 이력은 audit_log 쪽에서 온전하다(D14).
 *
 * 권한: 담당 실무자 | 기관 관리자 (D7 — `assertSupportCaseAccess`, 등록·동의와 같은 층).
 * 전체 목표(CCC-41)의 "담당 실무자만"과 다르다는 점에 주의.
 *
 * `expectedSupportCaseId` 를 주면 그 참여 사업 소속이 아닌 항목은 **바꾸기 전에** 거부한다.
 * 라우트가 주소(URL)의 참여 사업을 넘겨 쓴다 — 검사를 호출 뒤로 미루면 거절(403)을 돌려주면서
 * 이미 UPDATE 와 감사 1건이 커밋된 뒤라, 상태를 바꾼 403 이 된다.
 */
export async function resolveSessionDiscrepancy(
  env: Env,
  actor: Actor,
  discrepancyId: string,
  status: DiscrepancyResolutionStatus,
  expectedSupportCaseId?: string,
): Promise<SessionDiscrepancy> {
  assertHuman(actor);
  assertOpaqueIdentifier(discrepancyId, 'discrepancy id');
  if (status !== 'situation_changed' && status !== 'record_error' && status !== 'confirmed') {
    throw new ValidationError('discrepancy resolution status is invalid');
  }

  const existing = await env.DB.prepare(
    `SELECT * FROM session_discrepancies WHERE id = ? AND org_id = ?`,
  ).bind(discrepancyId, actor.orgId).first<DbRow>();
  if (existing === null) {
    throw new ForbiddenError('discrepancy is not available in this organization');
  }
  const current = mapSessionDiscrepancy(existing);
  // 주소가 가리킨 참여 사업과 실제 소속이 어긋나면 아무것도 바꾸기 전에 멈춘다.
  if (expectedSupportCaseId !== undefined && current.supportCaseId !== expectedSupportCaseId) {
    throw new ForbiddenError('discrepancy does not belong to this support case');
  }
  const scope = await resolveSessionScope(env, actor.orgId, current.triggerSessionId);
  await assertSupportCaseAccess(env, actor, current.supportCaseId);

  const resolvedAt = now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE session_discrepancies
       SET resolution_status = ?, resolved_by = ?, resolved_at = ?
       WHERE id = ? AND org_id = ?`,
    ).bind(status, actor.userId, resolvedAt, discrepancyId, actor.orgId),
    canonicalAuditStatement(env, actor, {
      action: 'resolve_discrepancy',
      targetTable: 'session_discrepancies',
      targetId: discrepancyId,
      beneficiaryId: scope.beneficiaryId,
      supportCaseId: current.supportCaseId,
      // 인용 원문은 감사 detail 에 싣지 않는다 — 처리 사실만 남긴다(D14 · R3).
      detail: { status, previousStatus: current.resolutionStatus },
    }),
  ]);

  return { ...current, resolutionStatus: status, resolvedBy: actor.userId, resolvedAt };
}

/**
 * '기록 오류'로 처리된 불일치가 가리키는 회차 ID 목록 — 상세 기록 화면이 그 회차 옆에
 * `기록 오류 처리됨` 표시를 붙이는 데 쓴다(ADR-0018: 원본은 남기고 표시만 붙여 다음
 * 열람자의 오해를 막는다).
 *
 * 0027 에는 **어느 쪽이 잘못된 기록인지**를 담는 칸이 없으므로 표시는 쌍이 가리키는 양쪽
 * 회차에 붙는다(회차 내 모순이면 한 곳). 한쪽만 지목하려면 스키마 변경이 필요하다.
 *
 * 권한: 담당 실무자 | 기관 관리자 (D7). 감사 없음 — 같은 화면의 기록 조회(listCounselingRecords)가
 * 이미 read 감사를 남기며, 이 함수는 그 화면의 표시 보강일 뿐이라 행을 나누면 조회 1건 원칙(D24)이
 * 깨진다.
 */
export async function listRecordErrorSessionIds(
  env: Env,
  actor: Actor,
  supportCaseId: string,
): Promise<string[]> {
  assertOpaqueIdentifier(supportCaseId, 'support case id');
  await assertSupportCaseAccess(env, actor, supportCaseId);
  const rows = await env.DB.prepare(
    `SELECT left_session_id, right_session_id FROM session_discrepancies
     WHERE org_id = ? AND support_case_id = ? AND resolution_status = 'record_error'`,
  ).bind(actor.orgId, supportCaseId).all<DbRow>();
  const ids = new Set<string>();
  for (const row of rows.results) {
    ids.add(stringValue(row.left_session_id));
    ids.add(stringValue(row.right_session_id));
  }
  return [...ids].sort();
}

// ============================================================================
// 케이스 (cases)
// ============================================================================

/**
 * Phase-1 compatibility creation is routed through the canonical participant /
 * SupportCase transaction. The resulting initial SupportCase carries its
 * beneficiary's legacy case id solely for the read-only compatibility views;
 * direct writes to those views remain rejected by schema triggers.
 */
export async function createCase(
  env: Env,
  actor: Actor,
  input: {
    programType?: string;
    intakeAt?: string;
    consentRecordingAt?: string | null; // D15
    consentTextAiAt?: string | null;
  },
): Promise<Case> {
  assertHuman(actor);
  const programType = input.programType ?? FINANCIAL_SUPPORT_V1;
  assertFinancialSupportProgramType(programType);
  const intakeAt = input.intakeAt === undefined
    ? null
    : canonicalUtcInstant(input.intakeAt, 'intake time');
  // intakeAt 은 legacyCompatibility 로만 전달한다(CCC-56) — canonicalInput 에 실으면
  // "등록 시각을 인테이크로 본다"는 폐기된 패턴이 되살아난다.
  const canonicalInput: CreateBeneficiaryWithInitialSupportCaseInput = actor.role === 'admin'
    ? { programType, initialAssigneeUserId: actor.userId }
    : { programType };
  const creation = await createBeneficiaryWithInitialSupportCase(
    env,
    actor,
    canonicalInput,
    {
      intakeAt,
      consentRecordingAt: input.consentRecordingAt ?? null,
      consentTextAiAt: input.consentTextAiAt ?? null,
    },
  );

  return getCaseForOrg(env, actor.orgId, creation.beneficiaryId);
}

/**
 * 케이스 단건 조회. PII는 포함하지 않는다(revealPii 별도).
 * 권한: 담당 실무자 | admin (D7). 감사: read.
 */
export async function getCase(env: Env, actor: Actor, caseId: string): Promise<Case> {
  const record = await assertCaseAccess(env, actor, caseId);
  await writeAudit(env, actor, { action: 'read', targetTable: 'cases', targetId: caseId, caseId });
  return record;
}

/**
 * 케이스 목록. counselor는 자기 담당 활성 케이스만, admin은 기관 전체.
 * 감사: read (목록 단위 1건).
 */
export async function listCases(
  env: Env,
  actor: Actor,
  filter?: { status?: 'active' | 'closed' },
): Promise<Case[]> {
  assertHuman(actor);
  const status = filter?.status;
  let result: D1Result<DbRow>;

  if (actor.role === 'admin') {
    result = status === undefined
      ? await env.DB.prepare('SELECT * FROM cases WHERE org_id = ? ORDER BY id').bind(actor.orgId).all<DbRow>()
      : await env.DB.prepare('SELECT * FROM cases WHERE org_id = ? AND status = ? ORDER BY id').bind(actor.orgId, status).all<DbRow>();
  } else {
    result = status === undefined
      ? await env.DB.prepare(
        'SELECT DISTINCT cases.* FROM cases INNER JOIN case_assignees ON case_assignees.case_id = cases.id WHERE cases.org_id = ? AND case_assignees.org_id = ? AND case_assignees.user_id = ? AND case_assignees.unassigned_at IS NULL ORDER BY cases.id',
      ).bind(actor.orgId, actor.orgId, actor.userId).all<DbRow>()
      : await env.DB.prepare(
        'SELECT DISTINCT cases.* FROM cases INNER JOIN case_assignees ON case_assignees.case_id = cases.id WHERE cases.org_id = ? AND cases.status = ? AND case_assignees.org_id = ? AND case_assignees.user_id = ? AND case_assignees.unassigned_at IS NULL ORDER BY cases.id',
      ).bind(actor.orgId, status, actor.orgId, actor.userId).all<DbRow>();
  }

  await writeAudit(env, actor, { action: 'read', targetTable: 'cases', detail: { list: true, status: status ?? 'all' } });
  return result.results.map(mapCase);
}

/**
 * Phase-1 compatibility closure delegates to the canonical SupportCase
 * operation. Retention scheduling and the successful audit remain schema-owned.
 */
export async function closeCase(
  env: Env,
  actor: Actor,
  caseId: string,
  reason: string,
): Promise<Case> {
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  await closeSupportCase(env, actor, context.supportCaseId, reason);
  return getCaseForOrg(env, actor.orgId, caseId);
}

/**
 * Phase-1 compatibility extra updates delegate to the canonical SupportCase
 * operation; the legacy `cases` view is read-only after cutover.
 */
export async function updateCaseExtra(
  env: Env,
  actor: Actor,
  caseId: string,
  extra: Record<string, unknown>,
): Promise<Case> {
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  await updateSupportCaseExtra(env, actor, context.supportCaseId, extra);
  return getCaseForOrg(env, actor.orgId, caseId);
}

// PII 금고 (participant_pii_vault) — D3 · D10 · R3
// PII 금고 (pii_vault) — D3 · D10 · R3
// ============================================================================

/**
 * Legacy compatibility PII registration. It is deliberately admin-only and
 * delegates to the canonical optimistic mutation so the vault update and its
 * audit are committed together. A legacy case must resolve to an active
 * canonical SupportCase and a non-purged versioned vault; otherwise it fails
 * closed.
 */
export async function registerPii(
  env: Env,
  actor: Actor,
  caseId: string,
  pii: { name?: string; phone?: string; account?: string; email?: string },
): Promise<void> {
  assertAdmin(actor);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  const vault = await getParticipantPiiVaultForOrg(env, actor.orgId, context.beneficiaryId);
  const version = integerValue(vault.version);
  if (version === null || vault.purged_at !== null) {
    throw new ForbiddenError('participant data is unavailable');
  }

  await updateParticipantPii(env, actor, context.beneficiaryId, {
    supportCaseContextId: context.supportCaseId,
    expectedVersion: version,
    ...pii,
  });
}

/**
 * PII 복호화 조회. 권한: admin 전용 (CLAUDE.md 3장).
 * 감사: decrypt_pii (D14 — 복호화는 전건 기록).
 */
export async function revealPii(
  env: Env,
  actor: Actor,
  caseId: string,
): Promise<{ name: string | null; phone: string | null; account: string | null; email: string | null }> {
  await getCaseForAdmin(env, actor, caseId);
  const pii = await readPiiValues(env, actor.orgId, caseId);
  await writeAudit(env, actor, { action: 'decrypt_pii', targetTable: 'participant_pii_vault', targetId: caseId, caseId });
  return pii;
}

/**
 * PII 파기 (D10). purge_due 경과 확인 후 enc_* 값을 비우고 purged_at 기록.
 * 행과 가명 기록은 보존한다(통계용). 권한: admin. 감사: purge_pii.
 */
export async function purgePii(env: Env, actor: Actor, caseId: string): Promise<void> {
  await getCaseForAdmin(env, actor, caseId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  const vault = await env.DB.prepare(
    'SELECT purge_due, purged_at FROM participant_pii_vault WHERE beneficiary_id = ? AND org_id = ?',
  ).bind(context.beneficiaryId, actor.orgId).first<{
    purge_due: string | null;
    purged_at: string | null;
  }>();
  if (
    vault === null
    || vault.purged_at !== null
    || vault.purge_due === null
    || parseSqliteUtc(vault.purge_due) > Date.now()
  ) {
    throw new ValidationError('PII is not due for purge');
  }

  const purgedAt = now();
  const result = await env.DB.prepare(
    `UPDATE participant_pii_vault
     SET enc_name = NULL, enc_phone = NULL, enc_account = NULL, enc_email = NULL,
           enc_birth_date = NULL, enc_region = NULL, enc_emergency_contact = NULL, enc_gender = NULL, purge_due = NULL,
         purged_at = ?, purged_by = ?, purged_by_role = ?,
         retention_changed_by = ?, retention_change_kind = 'purge_pii',
         retention_changed_at = ?, version = version + 1, updated_at = ?
     WHERE beneficiary_id = ? AND org_id = ? AND purged_at IS NULL
       AND purge_due IS NOT NULL AND purge_due <= datetime('now')`,
  ).bind(
    purgedAt,
    actor.userId,
    actor.role,
    actor.userId,
    purgedAt,
    purgedAt,
    context.beneficiaryId,
    actor.orgId,
  ).run();
  if ((result.meta?.changes ?? 0) < 1) {
    throw new ValidationError('PII is not due for purge');
  }
}

/**
 * 파기 예정일이 지난 미파기 PII를 SELECT한다(공통 조회).
 * 조건: 종결됐고(closed_at), purge_due가 있고 현재 시각 이하이며, 아직 파기 안 됨
 * (pii_vault.purged_at IS NULL). purge_due·now는 둘 다 toISOString(UTC, 동일 포맷)이라
 * 문자열 사전순 비교가 곧 시간순 비교다. orgId를 주면 그 기관으로 한정한다.
 */
async function selectDuePii(
  env: Env,
  nowIso: string,
  orgId?: string,
): Promise<Array<{ caseId: string; beneficiaryId: string; orgId: string; purgeDue: string }>> {
  const base = `SELECT
    support_case.legacy_case_id AS case_id,
    support_case.beneficiary_id,
    support_case.org_id,
    vault.purge_due
    FROM support_cases AS support_case
    JOIN participant_pii_vault AS vault
      ON vault.beneficiary_id = support_case.beneficiary_id
     AND vault.org_id = support_case.org_id
    WHERE support_case.legacy_case_id IS NOT NULL
      AND vault.purge_due IS NOT NULL
      AND vault.purge_due <= ?
      AND vault.purged_at IS NULL`;
  const result = orgId === undefined
    ? await env.DB.prepare(`${base} ORDER BY support_case.legacy_case_id`).bind(nowIso).all<DbRow>()
    : await env.DB.prepare(`${base} AND support_case.org_id = ? ORDER BY support_case.legacy_case_id`).bind(nowIso, orgId).all<DbRow>();
  return result.results.map((row) => ({
    caseId: stringValue(row.case_id),
    beneficiaryId: stringValue(row.beneficiary_id),
    orgId: stringValue(row.org_id),
    purgeDue: stringValue(row.purge_due),
  }));
}

/**
 * Purges each legacy-visible due vault through the same guarded transition as
 * the canonical purge command. The vault trigger owns the sole success audit.
 */
async function purgeDuePii(env: Env, actor: Actor, orgId: string | undefined): Promise<{ purgedCaseIds: string[] }> {
  const nowIso = now();
  const due = await selectDuePii(env, nowIso, orgId);
  const purgedCaseIds: string[] = [];

  for (const row of due) {
    const purgedAt = now();
    const result = await env.DB.prepare(
      `UPDATE participant_pii_vault
       SET enc_name = NULL, enc_phone = NULL, enc_account = NULL, enc_email = NULL,
           enc_birth_date = NULL, enc_region = NULL, enc_emergency_contact = NULL, enc_gender = NULL, purge_due = NULL,
           purged_at = ?, purged_by = ?, purged_by_role = ?,
           retention_changed_by = ?, retention_change_kind = 'purge_pii',
           retention_changed_at = ?, version = version + 1, updated_at = ?
       WHERE beneficiary_id = ? AND org_id = ? AND purged_at IS NULL
         AND purge_due IS NOT NULL AND purge_due <= datetime('now')
         AND NOT EXISTS (
           SELECT 1 FROM support_cases
           WHERE support_cases.beneficiary_id = participant_pii_vault.beneficiary_id
             AND support_cases.status = 'active'
         )`,
    ).bind(
      purgedAt,
      actor.userId,
      actor.role,
      actor.userId,
      purgedAt,
      purgedAt,
      row.beneficiaryId,
      row.orgId,
    ).run();
    if ((result.meta?.changes ?? 0) > 0) {
      purgedCaseIds.push(row.caseId);
    }
  }

  return { purgedCaseIds };
}

/**
 * 전 기관 자동 파기 (D10). scheduled(cron) 핸들러 전용 내부 진입점 — HTTP 행위자 없음.
 * 안전성 근거: scheduled 핸들러에서만 호출하고, 파기 대상은 purge_due 경과분으로 한정되며,
 * 각 파기가 append-only 감사(purge_pii, actor_id='system:purge')를 남긴다.
 */
export async function purgeExpiredPii(env: Env): Promise<{ purgedCaseIds: string[] }> {
  return purgeDuePii(env, systemActor(PURGE_ACTOR_ID, ''), undefined);
}

/**
 * 관리자 수동 파기 실행 (D10). 권한: admin 전용, 자기 기관 경과분만.
 * 감사: 케이스별 purge_pii(행위자=요청 관리자).
 */
export async function purgeExpiredPiiAsAdmin(env: Env, actor: Actor): Promise<{ purgedCaseIds: string[] }> {
  assertAdmin(actor);
  return purgeDuePii(env, actor, actor.orgId);
}

/**
 * 파기 예정 미리보기 (D10). 실제 파기 없이 대상 케이스만 나열한다.
 * 권한: admin 전용, 자기 기관. 감사: read(pii_vault, 미리보기 표시).
 */
export async function previewExpiredPii(env: Env, actor: Actor): Promise<Array<{ caseId: string; purgeDue: string }>> {
  assertAdmin(actor);
  const due = await selectDuePii(env, now(), actor.orgId);
  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'participant_pii_vault',
    detail: { duePurgePreview: true, count: due.length },
  });
  return due.map((row) => ({ caseId: row.caseId, purgeDue: row.purgeDue }));
}

// ============================================================================
// 담당 실무자 (case_assignees) — D7
// ============================================================================

/**
 * 담당 실무자 배정 (공동 담당 포함). 권한: admin. 감사: assign.
 */
export async function assignCase(
  env: Env,
  actor: Actor,
  caseId: string,
  userId: string,
  role?: 'primary' | 'secondary',
): Promise<void> {
  assertAdmin(actor);
  await assertCurrentHumanActor(env, actor);
  await assertOrganizationSettings(env, actor.orgId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  await assertSupportCaseAccess(env, actor, context.supportCaseId);
  assertOpaqueIdentifier(userId, 'assignee user id');
  await assertActiveHumanUser(env, actor.orgId, userId);
  const existing = await env.DB.prepare(
    'SELECT id FROM support_case_assignees WHERE org_id = ? AND support_case_id = ? AND user_id = ? AND unassigned_at IS NULL',
  ).bind(actor.orgId, context.supportCaseId, userId).first<{ id: string }>();
  if (existing !== null) {
    throw new ValidationError('user is already an active assignee');
  }
  const assignedAt = now();
  const assigneeRole = role ?? 'primary';
  if (assigneeRole !== 'primary' && assigneeRole !== 'secondary') {
    throw new ValidationError('assignee role is invalid');
  }
  await env.DB.prepare(
    'INSERT INTO support_case_assignees (id, org_id, support_case_id, user_id, role, assigned_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).bind(newId(), actor.orgId, context.supportCaseId, userId, assigneeRole, assignedAt).run();
  await writeAudit(env, actor, {
    action: 'assign',
    targetTable: 'support_case_assignees',
    caseId,
    detail: { assigneeRole },
  });
}

/**
 * 케이스 이관: 기존 담당 행에 unassigned_at 기록 + 새 담당 행 생성(원자 처리).
 * 행을 지우지 않아 담당 이력이 보존된다. 권한: admin. 감사: transfer.
 */
export async function transferCase(
  env: Env,
  actor: Actor,
  caseId: string,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  assertAdmin(actor);
  await assertCurrentHumanActor(env, actor);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  await transferSupportCase(env, actor, context.supportCaseId, fromUserId, toUserId);
}

/**
 * Phase-1 compatibility removal delegates to the canonical primary-preserving
 * SupportCase assignment operation.
 */
export async function unassignCase(
  env: Env,
  actor: Actor,
  caseId: string,
  userId: string,
): Promise<void> {
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  try {
    await unassignSupportCase(env, actor, context.supportCaseId, userId);
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    const active = await env.DB.prepare(
      `SELECT COUNT(*) AS count FROM support_case_assignees
       WHERE org_id = ? AND support_case_id = ? AND unassigned_at IS NULL`,
    ).bind(actor.orgId, context.supportCaseId).first<{ count: number }>();
    if ((active?.count ?? 0) <= 1) {
      throw new ValidationError('cannot unassign the last active assignee');
    }
    throw error;
  }
}

/** 담당 실무자 목록(이력 포함 옵션). 권한: 담당 실무자 | admin. 감사: read. */
export async function listAssignees(
  env: Env,
  actor: Actor,
  caseId: string,
  opts?: { includeHistory?: boolean },
): Promise<Assignee[]> {
  assertHuman(actor);
  await assertCaseAccess(env, actor, caseId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  const historyClause = opts?.includeHistory === true ? '' : 'AND assignment.unassigned_at IS NULL';
  const result = await env.DB.prepare(
    `SELECT assignment.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM support_case_assignees AS assignment
     JOIN support_cases AS support_case ON support_case.id = assignment.support_case_id
     WHERE assignment.org_id = ? AND assignment.support_case_id = ? ${historyClause}
     ORDER BY assignment.assigned_at`,
  ).bind(actor.orgId, context.supportCaseId).all<DbRow>();
  await writeAudit(env, actor, { action: 'read', targetTable: 'support_case_assignees', caseId });
  return result.results.map(mapAssignee);
}

// ============================================================================
// 목표 (goals) — D12
// ============================================================================

/**
 * 목표 신설. 활성 목표가 MAX_ACTIVE_GOALS(3개) 이상이면 거부.
 * 권한: 담당 실무자 | admin. 감사: create.
 */
export async function createGoal(
  env: Env,
  actor: Actor,
  caseId: string,
  input: { title: string; scaleCriteria?: unknown },
): Promise<Goal> {
  assertHuman(actor);
  await assertCaseAccess(env, actor, caseId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  const title = input.title.trim();

  if (title.length === 0) {
    throw new ValidationError('goal title is required');
  }

  const active = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM goals WHERE org_id = ? AND support_case_id = ? AND status = 'active'",
  ).bind(actor.orgId, context.supportCaseId).first<{ count: number }>();
  if ((active?.count ?? 0) >= MAX_ACTIVE_GOALS) {
    throw new ValidationError(`a case can have at most ${MAX_ACTIVE_GOALS} active goals`);
  }

  const goal: Goal = {
    id: newId(),
    caseId,
    title,
    scaleCriteria: input.scaleCriteria ?? null,
    status: 'active',
    closedReason: null,
    closedAt: null,
    replacedByGoalId: null,
  };
  const createdAt = now();
  await env.DB.prepare(
    'INSERT INTO goals (id, org_id, support_case_id, title, scale_criteria, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    goal.id,
    actor.orgId,
    context.supportCaseId,
    goal.title,
    goal.scaleCriteria === null ? null : stringifyJson(goal.scaleCriteria),
    goal.status,
    createdAt,
  ).run();
  await writeAudit(env, actor, { action: 'create', targetTable: 'goals', targetId: goal.id, caseId });
  return goal;
}

/**
 * 목표 종료 (D12: 문구 수정 대신 종료+신설). 사유 필수.
 * successor를 주면 신규 목표를 같은 트랜잭션으로 만들고
 * replaced_by_goal_id로 연결한다(GAS 이력 연속성).
 * 권한: 담당 실무자 | admin. 감사: close (+ 신설 시 create).
 */
export async function closeGoal(
  env: Env,
  actor: Actor,
  goalId: string,
  reason: string,
  successor?: { title: string; scaleCriteria?: unknown },
): Promise<{ closed: Goal; successor: Goal | null }> {
  assertHuman(actor);
  const goal = await getGoalForOrg(env, actor.orgId, goalId);
  await assertCaseAccess(env, actor, goal.caseId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, goal.caseId);

  if (goal.status !== 'active') {
    throw new ValidationError('only an active goal can be closed');
  }
  if (reason.trim().length === 0) {
    throw new ValidationError('closed reason is required');
  }

  let successorGoal: Goal | null = null;
  if (successor !== undefined) {
    const title = successor.title.trim();
    if (title.length === 0) {
      throw new ValidationError('successor goal title is required');
    }
    successorGoal = {
      id: newId(),
      caseId: goal.caseId,
      title,
      scaleCriteria: successor.scaleCriteria ?? null,
      status: 'active',
      closedReason: null,
      closedAt: null,
      replacedByGoalId: null,
    };
  }

  const closedAt = now();
  const statements: D1PreparedStatement[] = [];
  if (successorGoal !== null) {
    statements.push(env.DB.prepare(
      'INSERT INTO goals (id, org_id, support_case_id, title, scale_criteria, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      successorGoal.id,
      actor.orgId,
      context.supportCaseId,
      successorGoal.title,
      successorGoal.scaleCriteria === null ? null : stringifyJson(successorGoal.scaleCriteria),
      successorGoal.status,
      closedAt,
    ));
  }
  statements.push(env.DB.prepare(
    'UPDATE goals SET status = ?, closed_reason = ?, closed_at = ?, replaced_by_goal_id = ? WHERE id = ? AND org_id = ?',
  ).bind('closed', reason, closedAt, successorGoal?.id ?? null, goal.id, actor.orgId));
  await env.DB.batch(statements);
  await writeAudit(env, actor, { action: 'close', targetTable: 'goals', targetId: goal.id, caseId: goal.caseId });
  if (successorGoal !== null) {
    await writeAudit(env, actor, { action: 'create', targetTable: 'goals', targetId: successorGoal.id, caseId: goal.caseId });
  }

  return {
    closed: { ...goal, status: 'closed', closedReason: reason, closedAt, replacedByGoalId: successorGoal?.id ?? null },
    successor: successorGoal,
  };
}

/** 목표 목록(종료 포함 — GAS 추이 그래프용). 권한: 담당 실무자 | admin. 감사: read. */
export async function listGoals(env: Env, actor: Actor, caseId: string): Promise<Goal[]> {
  assertHuman(actor);
  await assertCaseAccess(env, actor, caseId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  const result = await env.DB.prepare(
    `SELECT goal.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM goals AS goal
     JOIN support_cases AS support_case ON support_case.id = goal.support_case_id
     WHERE goal.org_id = ? AND goal.support_case_id = ?
     ORDER BY goal.created_at`,
  ).bind(actor.orgId, context.supportCaseId).all<DbRow>();
  await writeAudit(env, actor, { action: 'read', targetTable: 'goals', caseId });
  return result.results.map(mapGoal);
}

// ============================================================================
// 세션 (sessions) — D5 · R2 · R3 · R4
// ============================================================================

/**
 * Phase-1 compatibility writer delegates to the canonical receipt-backed
 * manual-record command with a caller-owned operation receipt.
 */
export async function createManualSession(
  env: Env,
  actor: Actor,
  caseId: string,
  input: {
    submissionId: string;
    heldAt: string;
    channel: 'in_person' | 'phone' | 'video';
    memo: string;
    gasScores: CounselingRecordGasScoreInput[];
  },
): Promise<Session> {
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  const result = await createCounselingRecord(env, actor, context.supportCaseId, {
    submissionId: input.submissionId,
    heldAt: input.heldAt,
    channel: input.channel,
    memo: input.memo,
    gasScores: input.gasScores,
    actionItems: [],
    flags: [],
  });
  const { record } = result;
  return {
    id: record.id,
    caseId,
    counselorId: record.counselorId,
    heldAt: record.heldAt,
    channel: record.channel,
    memo: record.memo,
    aiStatus: 'none',
    transcript: null,
    audioR2Key: null,
    aiSummary: null,
    aiSchema: null,
    aiContrast: null,
    emotionScores: null,
    speakerMappingConfirmedAt: null,
    approvedAt: null,
    approvedBy: null,
    extra: null,
  };
}

async function assertRecordingUploadAllowedForSession(
  env: Env,
  actor: Actor,
  session: Session,
): Promise<void> {
  const caseRecord = await getCaseForOrg(env, actor.orgId, session.caseId);
  if (session.approvedAt !== null) {
    throw new ValidationError('an approved session cannot be re-registered');
  }
  if (caseRecord.consentRecordingAt === null) {
    throw new ValidationError('recording consent is required');
  }
  if (session.channel !== 'in_person') {
    throw new ValidationError('recording pipeline is limited to in-person sessions');
  }
}

/**
 * Read-only authorization and eligibility check for recording upload handling.
 * registerRecording repeats this check immediately before its mutation batch.
 */
export async function assertRecordingUploadAllowed(
  env: Env,
  actor: Actor,
  sessionId: string,
): Promise<void> {
  const session = await assertSessionAccess(env, actor, sessionId);
  await assertRecordingUploadAllowedForSession(env, actor, session);
}

/**
 * 녹음 업로드 등록: audio_r2_key 기록 + ai_status='uploaded'.
 * 케이스에 녹음 동의(consent_recording_at)가 없으면 거부 (D15).
 * 이미 승인된 세션은 재등록할 수 없다(승인된 공식 기록 보호, R2).
 * 미승인 세션을 재등록하면 이전 실행의 AI 산출물(전사·요약·대조·감정·화자 확인·
 * ai_gas_evidence·검토 전 AI 플래그)을 함께 비워 새 실행과 섞이지 않게 한다.
 * 권한: 담당 실무자 | admin. 감사: update.
 */
export async function registerRecording(
  env: Env,
  actor: Actor,
  sessionId: string,
  audioR2Key: string,
): Promise<Session> {
  const session = await assertSessionAccess(env, actor, sessionId);
  await assertRecordingUploadAllowedForSession(env, actor, session);
  if (audioR2Key.trim().length === 0) {
    throw new ValidationError('audio R2 key is required');
  }

  const updatedAt = now();
  // Repeat authorization and eligibility in the mutation batch so a preflight
  // check cannot authorize a later state change.
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE sessions
       SET audio_r2_key = ?, ai_status = ?, transcript = NULL, ai_summary = NULL, ai_schema = NULL,
           ai_contrast = NULL, emotion_scores = NULL, speaker_mapping_confirmed_at = NULL, updated_at = ?
       WHERE id = ? AND org_id = ? AND approved_at IS NULL AND channel = 'in_person'
         AND EXISTS (
           SELECT 1 FROM support_cases AS support_case
           WHERE support_case.id = sessions.support_case_id
             AND support_case.org_id = sessions.org_id
             AND support_case.consent_recording_at IS NOT NULL
         )
         AND (
           ? = 'admin' OR EXISTS (
             SELECT 1 FROM support_case_assignees AS assignment
             WHERE assignment.org_id = sessions.org_id
               AND assignment.support_case_id = sessions.support_case_id
               AND assignment.user_id = ?
               AND assignment.unassigned_at IS NULL
           )
         )`,
    ).bind(audioR2Key, 'uploaded', updatedAt, sessionId, actor.orgId, actor.role, actor.userId),
    env.DB.prepare(
      `DELETE FROM ai_gas_evidence
       WHERE org_id = ? AND session_id = ?
         AND EXISTS (
           SELECT 1 FROM sessions AS session
           WHERE session.id = ? AND session.org_id = ? AND session.approved_at IS NULL
             AND session.channel = 'in_person'
             AND EXISTS (
               SELECT 1 FROM support_cases AS support_case
               WHERE support_case.id = session.support_case_id
                 AND support_case.org_id = session.org_id
                 AND support_case.consent_recording_at IS NOT NULL
             )
             AND (
               ? = 'admin' OR EXISTS (
                 SELECT 1 FROM support_case_assignees AS assignment
                 WHERE assignment.org_id = session.org_id
                   AND assignment.support_case_id = session.support_case_id
                   AND assignment.user_id = ?
                   AND assignment.unassigned_at IS NULL
               )
             )
         )`,
    ).bind(actor.orgId, sessionId, sessionId, actor.orgId, actor.role, actor.userId),
    // 검토 전(pending) AI 플래그만 제거 — 실무자가 이미 확정/기각한 판단은 보존 (D9).
    env.DB.prepare(
      `DELETE FROM flags
       WHERE org_id = ? AND session_id = ? AND source = 'ai' AND review_status = 'pending'
         AND EXISTS (
           SELECT 1 FROM sessions AS session
           WHERE session.id = ? AND session.org_id = ? AND session.approved_at IS NULL
             AND session.channel = 'in_person'
             AND EXISTS (
               SELECT 1 FROM support_cases AS support_case
               WHERE support_case.id = session.support_case_id
                 AND support_case.org_id = session.org_id
                 AND support_case.consent_recording_at IS NOT NULL
             )
             AND (
               ? = 'admin' OR EXISTS (
                 SELECT 1 FROM support_case_assignees AS assignment
                 WHERE assignment.org_id = session.org_id
                   AND assignment.support_case_id = session.support_case_id
                   AND assignment.user_id = ?
                   AND assignment.unassigned_at IS NULL
               )
             )
         )`,
    ).bind(actor.orgId, sessionId, sessionId, actor.orgId, actor.role, actor.userId),
  ]);
  const updated = results[0] as unknown as { meta?: { changes?: number } };
  if ((updated.meta?.changes ?? 0) < 1) {
    throw new ConflictError('recording upload is no longer allowed');
  }
  await writeAudit(env, actor, { action: 'update', targetTable: 'sessions', targetId: sessionId, caseId: session.caseId });
  return {
    ...session,
    audioR2Key,
    aiStatus: 'uploaded',
    transcript: null,
    aiSummary: null,
    aiSchema: null,
    aiContrast: null,
    emotionScores: null,
    speakerMappingConfirmedAt: null,
  };
}


/** 처리 대기 중인 녹음 작업 목록. Mac Mini 서비스 역할 전용 (D13). */
// ============================================================================
// 텍스트 일감 큐 (D51 · ADR-0022 · ADR-0027 · 마이그레이션 0029)
//
// 오디오가 없는 회차의 2차 마스킹(NER)을 처리 장비에 맡기기 위한 큐다. 기록이
// 공식화될 때(수기 저장 · AI 정리 승인) 한 행이 쌓이고, 장비는 오디오 큐와 같은
// 폴링에서 이걸 가져가 마스킹한 뒤 `recordMaskedSourceSnapshot` 으로 스냅샷을
// 만든다. 스냅샷이 생겨야만 불일치 검출이 재료를 얻는다(R3).
// ============================================================================

export type TextWorkReason = 'manual_record' | 'ai_draft_approved';

export interface TextWorkItem {
  id: string;
  sessionId: string;
  reason: TextWorkReason;
  enqueuedAt: string;
}

/**
 * 공식화 훅 — 실패해도 기록 저장을 막지 않는다(D8). 같은 회차의 대기 행이 이미
 * 있으면 부분 유니크 인덱스가 조용히 흡수한다(INSERT OR IGNORE).
 */
export async function enqueueTextWorkItem(
  env: Env,
  actor: Actor,
  sessionId: string,
  reason: TextWorkReason,
): Promise<void> {
  assertOpaqueIdentifier(sessionId, 'session id');
  const scope = await resolveSessionScope(env, actor.orgId, sessionId);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO ai_text_work_queue (id, org_id, support_case_id, session_id, reason, status, enqueued_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
  ).bind(newId(), actor.orgId, scope.supportCaseId, sessionId, reason, now()).run();
}

/**
 * 장비 폴링 — **지금 실제로 처리할 수 있는** 대기 일감만. 오디오 큐와 함께 D8 무폴링
 * 감시에 합산된다.
 *
 * 처리 불가 조건을 목록 단계에서 걸러내는 이유: 스냅샷 저장(`recordMaskedSourceSnapshot`)
 * 은 파일럿 활성 + 텍스트 AI 동의 근거를 요구하고, 원문 조회는 공식 텍스트를 요구한다.
 * 이 조건이 안 맞는 행을 내보내면 장비가 매 폴링마다 같은 행을 집어 실패하고, 큐는
 * 삭제가 없어(0029 트리거) 영원히 쌓인다. 안 보이게 두면 조건이 갖춰지는 순간
 * — ② 동의가 기록되는 순간 — 저절로 보인다.
 */
export async function listTextWorkItems(env: Env, actor: Actor): Promise<TextWorkItem[]> {
  if (actor.role !== 'service') {
    throw new ForbiddenError('service role is required for text work items');
  }
  // 파일럿이 꺼져 있으면 스냅샷 저장이 전부 거부된다 — 아예 내보내지 않는다.
  if (!isPilotTextAiEnabled(env)) return [];

  const result = await env.DB.prepare(
    `SELECT queue.id, queue.session_id, queue.reason, queue.enqueued_at
     FROM ai_text_work_queue AS queue
     JOIN sessions AS session ON session.id = queue.session_id AND session.org_id = queue.org_id
     WHERE queue.org_id = ? AND queue.status = 'pending'
       -- ② 텍스트 AI 동의 근거가 효력 중이어야 스냅샷을 저장할 수 있다.
       AND EXISTS (
         SELECT 1 FROM pilot_text_ai_consent_evidence AS evidence
         WHERE evidence.org_id = queue.org_id
           AND evidence.support_case_id = queue.support_case_id
           AND evidence.effective_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       )
       -- 마스킹할 공식 텍스트가 있어야 한다(수기 메모 또는 승인된 AI 정리). 인테이크
       -- 회차는 memo 가 NULL 이라(본문은 intake_details) 승인된 정리가 생기기 전까지
       -- 여기서 걸린다 — 원문 조회가 400 을 던질 행을 애초에 내보내지 않는다.
       AND (
         TRIM(COALESCE(session.memo, '')) <> ''
         OR EXISTS (
           SELECT 1 FROM approved_ai_briefing_v1 AS approved
           WHERE approved.org_id = queue.org_id AND approved.session_id = queue.session_id
             AND TRIM(COALESCE(approved.summary_text, '')) <> ''
         )
       )
     ORDER BY queue.enqueued_at
     LIMIT 50`,
  ).bind(actor.orgId).all<DbRow>();
  const items = result.results.map((row) => ({
    id: stringValue(row.id),
    sessionId: stringValue(row.session_id),
    reason: stringValue(row.reason) as TextWorkReason,
    enqueuedAt: stringValue(row.enqueued_at),
  }));
  await writeAudit(env, actor, {
    action: 'poll_pipeline',
    targetTable: 'ai_text_work_queue',
    detail: { jobCount: items.length },
  });
  return items;
}

/**
 * 장비가 마스킹할 원문 — **1차 치환(등록 PII → 가명 ID)까지 마친** 공식 텍스트다.
 * 장비는 이 위에 NER 을 얹어 스냅샷을 만든다(D2 2단 방어). 1차 치환은 멱등이라
 * `recordMaskedSourceSnapshot` 이 다시 걸어도 해시가 어긋나지 않는다.
 * 동의·파일럿 게이트는 스냅샷 저장 시점에 다시 확인된다.
 */
export async function getTextWorkItemSource(
  env: Env,
  actor: Actor,
  itemId: string,
): Promise<{ sessionId: string; text: string }> {
  if (actor.role !== 'service') {
    throw new ForbiddenError('service role is required for text work items');
  }
  assertOpaqueIdentifier(itemId, 'text work item id');
  const item = await env.DB.prepare(
    `SELECT session_id, support_case_id FROM ai_text_work_queue
     WHERE id = ? AND org_id = ? AND status = 'pending'`,
  ).bind(itemId, actor.orgId).first<DbRow>();
  if (item === null) {
    throw new ForbiddenError('text work item is not available in this organization');
  }
  const sessionId = stringValue(item.session_id);
  const scope = await resolveSessionScope(env, actor.orgId, sessionId);

  const [sessionRow, approvedRow] = await Promise.all([
    env.DB.prepare('SELECT memo FROM sessions WHERE id = ? AND org_id = ?')
      .bind(sessionId, actor.orgId).first<DbRow>(),
    env.DB.prepare(
      `SELECT summary_text FROM approved_ai_briefing_v1
       WHERE org_id = ? AND session_id = ?
       ORDER BY approved_at DESC, draft_version DESC
       LIMIT 1`,
    ).bind(actor.orgId, sessionId).first<DbRow>(),
  ]);

  const parts: string[] = [];
  const memo = sessionRow === null ? null : nullableString(sessionRow.memo);
  if (memo !== null && memo.trim().length > 0) parts.push(memo);
  const summary = approvedRow === null ? null : nullableString(approvedRow.summary_text);
  if (summary !== null && summary.trim().length > 0) parts.push(summary);
  if (parts.length === 0) {
    throw new ValidationError('text work item has no official text');
  }

  const pii = await readPiiValues(env, actor.orgId, scope.caseId);
  await writeAudit(env, actor, {
    action: 'decrypt_pii',
    targetTable: 'pii_vault',
    targetId: scope.caseId,
    caseId: scope.caseId,
    detail: { purpose: 'text_work_item_masking' },
  });
  return { sessionId, text: maskRegisteredPii(parts.join('\n'), scope.caseId, pii) };
}

/** 스냅샷 저장 후 장비가 부른다. 완료 행은 불변이다(0029 트리거). */
export async function completeTextWorkItem(env: Env, actor: Actor, itemId: string): Promise<void> {
  if (actor.role !== 'service') {
    throw new ForbiddenError('service role is required for text work items');
  }
  assertOpaqueIdentifier(itemId, 'text work item id');
  const result = await env.DB.prepare(
    `UPDATE ai_text_work_queue SET status = 'done', completed_at = ?
     WHERE id = ? AND org_id = ? AND status = 'pending'`,
  ).bind(now(), itemId, actor.orgId).run();
  if ((result.meta?.changes ?? 0) === 0) {
    throw new ForbiddenError('text work item is not available in this organization');
  }
  await writeAudit(env, actor, {
    action: 'update',
    targetTable: 'ai_text_work_queue',
    targetId: itemId,
    detail: { status: 'done' },
  });
}

export async function listPipelineJobs(env: Env, actor: Actor): Promise<PipelineJob[]> {
  if (actor.role !== 'service') {
    throw new ForbiddenError('service role is required for pipeline jobs');
  }

  const result = await env.DB.prepare(
    `SELECT session.id, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id, session.ai_status, session.audio_r2_key
     FROM sessions AS session
     JOIN support_cases AS support_case ON support_case.id = session.support_case_id
     WHERE session.org_id = ? AND session.audio_r2_key IS NOT NULL
       AND session.ai_status IN ('uploaded', 'processing')
     ORDER BY session.updated_at`,
  ).bind(actor.orgId).all<DbRow>();
  const jobs = result.results.map((row) => ({
    id: stringValue(row.id),
    caseId: stringValue(row.case_id),
    status: toAiStatus(row.ai_status),
    audioAvailable: nullableString(row.audio_r2_key) !== null,
  }));
  await writeAudit(env, actor, {
    action: 'poll_pipeline',
    targetTable: 'sessions',
    detail: { jobCount: jobs.length },
  });
  return jobs;
}

/**
 * 오디오 중계용 R2 키 조회 (Mac Mini 서비스 역할 전용, D13).
 * org 일치·서비스 역할·오디오 등록 여부를 확인하고, 반환 전 audit_log에
 * 'download_audio'를 기록한다(D14: 오디오 열람은 전건 감사). audio_r2_key는
 * 응답 본문으로 절대 나가지 않고, request-handler가 R2에서 바이트를 중계할
 * 내부 용도로만 이 값을 쓴다.
 */
export async function getPipelineAudioKey(
  env: Env,
  actor: Actor,
  sessionId: string,
): Promise<{ audioR2Key: string; caseId: string }> {
  if (actor.role !== 'service') {
    throw new ForbiddenError('service role is required for pipeline jobs');
  }

  const session = await getSessionForOrg(env, actor.orgId, sessionId);
  if (session.audioR2Key === null) {
    throw new ValidationError('pipeline job has no registered audio');
  }
  await writeAudit(env, actor, { action: 'download_audio', targetTable: 'sessions', targetId: sessionId, caseId: session.caseId });
  return { audioR2Key: session.audioR2Key, caseId: session.caseId };
}

// ============================================================================
// 파이프라인 폴링 워치독 (D8) — poll_pipeline 감사 기록이 데이터 원천
// ============================================================================

/**
 * 한 기관의 폴링 건강도를 계산한다(감사 미기록 — 호출부가 감사 정책을 정한다).
 * 데이터 원천: audit_log의 최신 poll_pipeline 시각(listPipelineJobs가 남긴다) +
 * 처리 대기 세션 수. lastPolledAt은 SQLite datetime 형식이라 UTC로 파싱해 비교한다.
 */
async function computePipelineHealth(env: Env, orgId: string, thresholdHours: number): Promise<PipelineHealth> {
  const [pollRow, pendingRow] = await Promise.all([
    env.DB.prepare(
      "SELECT created_at FROM audit_log WHERE org_id = ? AND action = 'poll_pipeline' ORDER BY id DESC LIMIT 1",
    ).bind(orgId).first<{ created_at: string }>(),
    env.DB.prepare(
      "SELECT COUNT(*) AS count FROM sessions WHERE org_id = ? AND audio_r2_key IS NOT NULL AND ai_status IN ('uploaded', 'processing')",
    ).bind(orgId).first<{ count: number }>(),
  ]);

  const pendingJobCount = pendingRow?.count ?? 0;
  const thresholdMs = thresholdHours * 60 * 60 * 1000;

  if (pollRow === null || pollRow.created_at === null) {
    // 폴링 이력 없음: 대기 작업이 있으면 stale(파이프라인이 한 번도 돌지 않음),
    // 없으면 inactive(감시할 것이 없음 — 알림 대상 아님).
    const stale = pendingJobCount > 0;
    return {
      orgId,
      lastPolledAt: null,
      stale,
      status: stale ? 'stale' : 'inactive',
      pendingJobCount,
      thresholdHours,
    };
  }

  const lastPolledMs = parseSqliteUtc(pollRow.created_at);
  const stale = Number.isNaN(lastPolledMs) || Date.now() - lastPolledMs > thresholdMs;
  return {
    orgId,
    lastPolledAt: Number.isNaN(lastPolledMs) ? null : new Date(lastPolledMs).toISOString(),
    stale,
    status: stale ? 'stale' : 'ok',
    pendingJobCount,
    thresholdHours,
  };
}

/**
 * 폴링 건강도 조회(관리자 화면용, D8). 권한: admin 전용, 자기 기관만.
 * 감사: read(pipeline_health).
 */
export async function getPipelineHealth(env: Env, actor: Actor): Promise<PipelineHealth> {
  assertAdmin(actor);
  const health = await computePipelineHealth(env, actor.orgId, resolvePipelineStaleHours(env));
  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'pipeline_health',
    detail: { stale: health.stale, status: health.status, pendingJobCount: health.pendingJobCount },
  });
  return health;
}

/**
 * 전 기관 폴링 워치독 (D8). scheduled(cron) 핸들러 전용 내부 진입점 —
 * HTTP 행위자가 없다. 안전성 근거: (1) scheduled 핸들러에서만 호출하고,
 * (2) 세션·감사 조회만 하는 읽기 전용이며, (3) 남기는 유일한 쓰기는 append-only
 * 감사 행(watchdog_check)뿐이다. 기관별 건강도를 계산·감사하고 배열로 돌려준다.
 * 알림 발송 판단(stale)은 호출부(Workers scheduled 핸들러)가 한다 —
 * gateway는 D1만 만지고 알림 채널은 건드리지 않는다 (R1 정신).
 */
export async function runPipelineWatchdog(env: Env): Promise<PipelineHealth[]> {
  const thresholdHours = resolvePipelineStaleHours(env);
  const orgs = await env.DB.prepare('SELECT DISTINCT org_id FROM cases ORDER BY org_id').all<{ org_id: string }>();
  const healths: PipelineHealth[] = [];

  for (const row of orgs.results) {
    const orgId = stringValue(row.org_id);
    const health = await computePipelineHealth(env, orgId, thresholdHours);
    await writeAudit(env, systemActor(WATCHDOG_ACTOR_ID, orgId), {
      action: 'watchdog_check',
      targetTable: 'sessions',
      detail: {
        stale: health.stale,
        status: health.status,
        pendingJobCount: health.pendingJobCount,
        thresholdHours,
      },
    });
    healths.push(health);
  }

  return healths;
}

/**
 * 화자 매핑 확인 (D11: 자동 추정 → 실무자 1회 확인).
 * 권한: 담당 실무자 | admin. 감사: update.
 */
export async function confirmSpeakerMapping(
  env: Env,
  actor: Actor,
  sessionId: string,
): Promise<Session> {
  const session = await assertSessionAccess(env, actor, sessionId);
  const confirmedAt = now();
  await env.DB.prepare('UPDATE sessions SET speaker_mapping_confirmed_at = ?, updated_at = ? WHERE id = ? AND org_id = ?')
    .bind(confirmedAt, confirmedAt, sessionId, actor.orgId)
    .run();
  await writeAudit(env, actor, { action: 'update', targetTable: 'sessions', targetId: sessionId, caseId: session.caseId });
  return { ...session, speakerMappingConfirmedAt: confirmedAt };
}

/**
 * 세션 승인 (R2: 승인 = 정합성 검증). 전제 조건을 모두 검사한다:
 *   - ai_status='review_ready' 이고 화자 매핑 확인 완료 (D11)
 *   - 대조 3종 각 항목에 대한 실무자 처리 결과(resolutions)가 제출됨
 *   - GAS 점수는 recordGasScores로 먼저 저장됨 (D6)
 * 통과 시 approved_at/approved_by 기록 → 이후 브리핑·통계에 반영.
 * 권한: 담당 실무자 | admin. 감사: approve.
 */
export async function approveSession(
  env: Env,
  actor: Actor,
  sessionId: string,
  resolutions: {
    expectedDraftVersion?: number;
    missingFromMemo: Array<{ item: string; action: 'accept' | 'dismiss' }>;
    missingFromAudio: Array<{ item: string; action: 'confirmed' | 'corrected' }>;
    undiscussedGoals: Array<{ goalId: string; note?: string }>;
  },
): Promise<Session> {
  const session = await assertSessionAccess(env, actor, sessionId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, session.caseId);
  let expectedVersion: number;
  try {
    expectedVersion = requireExpectedDraftVersion(resolutions?.expectedDraftVersion);
  } catch (error) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_review_events',
      targetId: sessionId,
      caseId: session.caseId,
      reason: 'draft_version_required',
    });
    throw error;
  }

  const workItem = await findAiWorkItemForSession(env, actor.orgId, sessionId, AI_WORK_KIND_BRIEFING);
  if (workItem === null) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_review_events',
      targetId: sessionId,
      caseId: session.caseId,
      reason: 'stale_draft_version',
    });
    throw new StaleDraftVersionError();
  }

  if (session.aiStatus !== 'review_ready' || session.speakerMappingConfirmedAt === null) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_review_events',
      targetId: workItem.id,
      caseId: session.caseId,
      reason: 'session_not_ready',
    });
    throw new NotApprovedError('session is not ready for approval');
  }
  if (session.aiContrast === null) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_review_events',
      targetId: workItem.id,
      caseId: session.caseId,
      reason: 'session_contrast_missing',
    });
    throw new NotApprovedError('session contrast is missing');
  }
  const memoItems = resolutions.missingFromMemo.map((item) => item.item);
  const audioItems = resolutions.missingFromAudio.map((item) => item.item);
  const goalItems = resolutions.undiscussedGoals.map((item) => item.goalId);
  if (
    !sameStringItems(session.aiContrast.missingFromMemo, memoItems)
    || !sameStringItems(session.aiContrast.missingFromAudio, audioItems)
    || !sameStringItems(session.aiContrast.undiscussedGoals, goalItems)
  ) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_review_events',
      targetId: workItem.id,
      caseId: session.caseId,
      reason: 'contrast_resolution_required',
    });
    throw new NotApprovedError('all contrast items require a counselor resolution');
  }

  const activeGoals = await env.DB.prepare(
    "SELECT id FROM goals WHERE org_id = ? AND support_case_id = ? AND status = 'active'",
  ).bind(actor.orgId, context.supportCaseId).all<{ id: string }>();
  const savedScores = await env.DB.prepare('SELECT goal_id FROM session_goal_scores WHERE org_id = ? AND session_id = ?')
    .bind(actor.orgId, sessionId)
    .all<{ goal_id: string }>();
  const scoreIds = new Set(savedScores.results.map((row) => row.goal_id));
  if (activeGoals.results.some((goal) => !scoreIds.has(goal.id))) {
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_review_events',
      targetId: workItem.id,
      caseId: session.caseId,
      reason: 'gas_scores_required',
    });
    throw new NotApprovedError('GAS scores are required for every active goal before approval');
  }

  // The stop authority and current consent must gate compatibility approval too.
  await assertPilotTextAiConsent(env, actor, session.caseId);
  let approved: AiDraftVersion;
  try {
    approved = await reviewAiDraftForSession(env, actor, sessionId, {
      expectedVersion,
      decision: 'approved',
    });
  } catch (error) {
    if (error instanceof StaleDraftVersionError) {
      throw error;
    }
    await writePhase1Denial(env, actor, {
      targetTable: 'ai_review_events',
      targetId: workItem.id,
      caseId: session.caseId,
      reason: 'invalid_ai_draft_state',
    });
    throw error;
  }
  return {
    ...session,
    aiStatus: 'approved',
    aiSummary: approved.summaryText,
    approvedAt: approved.reviewedAt,
    approvedBy: approved.reviewedBy,
  };
}

/**
 * 세션 단건 조회. 검토 화면용 — 미승인 ai_* 포함해 반환하되
 * aiStatus로 초안임이 드러난다. 권한: 담당 실무자 | admin. 감사: read.
 */
export async function getSession(env: Env, actor: Actor, sessionId: string): Promise<Session> {
  const session = await assertSessionAccess(env, actor, sessionId);
  const workItem = await findAiWorkItemForSession(
    env,
    actor.orgId,
    sessionId,
    AI_WORK_KIND_BRIEFING,
  );
  const draft = session.aiStatus === 'review_ready' && workItem !== null
    ? await getCurrentAiDraftVersion(env, actor.orgId, workItem.id)
    : null;
  // D6: 검토·GAS 채점 화면이 참고할 AI 근거 발췌(마스킹 완료본)를 함께 싣는다.
  const evidence = await env.DB.prepare(
    'SELECT goal_id, quote FROM ai_gas_evidence WHERE org_id = ? AND session_id = ? ORDER BY created_at',
  ).bind(actor.orgId, sessionId).all<{ goal_id: string; quote: string }>();
  // CCC-8: 이 회차 시점의 6영역 스냅샷.
  const lifeAreas = await env.DB.prepare(
    'SELECT area_key, status, note FROM session_life_area_snapshots WHERE org_id = ? AND session_id = ? ORDER BY area_key',
  ).bind(actor.orgId, sessionId).all<DbRow>();
  await writeAudit(env, actor, { action: 'read', targetTable: 'sessions', targetId: sessionId, caseId: session.caseId });
  return {
    ...session,
    // A review-ready session projects only its immutable current draft; a
    // missing draft fails closed instead of surfacing compatibility columns.
    aiSummary: session.aiStatus === 'review_ready'
      ? draft?.summaryText ?? null
      : session.aiSummary,
    aiGasEvidence: evidence.results.map((row) => ({ goalId: stringValue(row.goal_id), quote: stringValue(row.quote) })),
    lifeAreaSnapshot: lifeAreas.results.map(mapLifeAreaSnapshotRow),
  };
}

/**
 * 세션 목록. official=true(기본)면 R2 필터 적용 —
 * 미승인 세션은 ai_* 필드를 비워서(null) 반환한다(수기 memo는 항상 포함, D5).
 * 권한: 담당 실무자 | admin. 감사: read.
 */
export async function listSessions(
  env: Env,
  actor: Actor,
  caseId: string,
  opts?: { official?: boolean },
): Promise<Session[]> {
  assertHuman(actor);
  await assertCaseAccess(env, actor, caseId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  const result = await env.DB.prepare(
    `SELECT session.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM sessions AS session
     JOIN support_cases AS support_case ON support_case.id = session.support_case_id
     WHERE session.org_id = ? AND session.support_case_id = ?
     ORDER BY session.held_at DESC`,
  ).bind(actor.orgId, context.supportCaseId).all<DbRow>();
  const sessions = result.results.map(mapSession);
  await writeAudit(env, actor, { action: 'read', targetTable: 'sessions', caseId, detail: { official: opts?.official !== false } });
  if (opts?.official === false) {
    return sessions;
  }

  const approvedBySession = new Map(
    (await loadApprovedAiBriefings(env, actor.orgId, caseId, sessions.map((session) => session.id)))
      .map((briefing) => [briefing.sessionId, briefing] as const),
  );
  return sessions.map((session) => officialSessionFromApprovedBriefing(session, approvedBySession.get(session.id)));
}

/**
 * 브리핑 조회 (CLAUDE.md 6장 — 상담 5분 전 한 화면).
 * R2: 승인된 AI 산출물만 사용. 승인된 요약이 없으면 수기 메모 폴백 +
 * pendingApprovalCount 배지 (D5). 감정은 이 응답에 문장으로 넣지 않는다 (R4).
 * 권한: 담당 실무자 | admin. 감사: read(briefing).
 */
export async function getBriefing(env: Env, actor: Actor, caseId: string): Promise<Briefing> {
  assertHuman(actor);
  await assertCaseAccess(env, actor, caseId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  const goalRows = await env.DB.prepare(
    `SELECT goal.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM goals AS goal
     JOIN support_cases AS support_case ON support_case.id = goal.support_case_id
     WHERE goal.org_id = ? AND goal.support_case_id = ?
     ORDER BY goal.created_at`,
  ).bind(actor.orgId, context.supportCaseId).all<DbRow>();
  const goals = goalRows.results.map(mapGoal);
  // 목표별 GAS 점수를 한 번의 IN 조회로 모아 goal_id로 버킷팅한다 (N+1 방지).
  const goalIds = goals.map((goal) => goal.id);
  const scoresQuery = goalIds.length === 0
    ? Promise.resolve({ results: [] as Array<{ goal_id: string; score: number; held_at: string }> })
    : env.DB.prepare(
      `SELECT session_goal_scores.goal_id, session_goal_scores.score, sessions.held_at
       FROM session_goal_scores
       INNER JOIN sessions ON sessions.id = session_goal_scores.session_id
       WHERE session_goal_scores.org_id = ?
         AND session_goal_scores.goal_id IN (${goalIds.map(() => '?').join(', ')})
       ORDER BY sessions.held_at`,
    ).bind(actor.orgId, ...goalIds).all<{ goal_id: string; score: number; held_at: string }>();

  // 서로 독립적인 조회는 병렬로 실행한다.
  const [scoreRows, latestRow, pending, actions, flags, approvedBriefings] = await Promise.all([
    scoresQuery,
    env.DB.prepare(
      `SELECT session.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
       FROM sessions AS session
       JOIN support_cases AS support_case ON support_case.id = session.support_case_id
       WHERE session.org_id = ? AND session.support_case_id = ?
       ORDER BY session.held_at DESC
       LIMIT 1`,
    ).bind(actor.orgId, context.supportCaseId).first<DbRow>(),
    env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM ai_draft_versions AS draft
       INNER JOIN ai_work_items AS work ON work.id = draft.work_item_id
       LEFT JOIN ai_review_events AS review ON review.draft_version_id = draft.id
       WHERE work.org_id = ?
         AND work.support_case_id = ?
         AND review.id IS NULL`,
    ).bind(actor.orgId, context.supportCaseId).first<{ count: number }>(),
    env.DB.prepare(
      `SELECT action_item.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
       FROM action_items AS action_item
       JOIN support_cases AS support_case ON support_case.id = action_item.support_case_id
       WHERE action_item.org_id = ? AND action_item.support_case_id = ? AND action_item.resolved_at IS NULL
       ORDER BY action_item.due_date, action_item.created_at`,
    ).bind(actor.orgId, context.supportCaseId).all<DbRow>(),
    // 브리핑에는 실무자가 만든 플래그 또는 실무자가 확정(confirmed)한 AI 플래그만 싣는다.
    // 검토 전 AI 제안(pending)은 사실 확정 전이므로 제외한다 — 검토 화면(listFlags)에만 나온다.
    env.DB.prepare(
      `SELECT flag.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
       FROM flags AS flag
       JOIN support_cases AS support_case ON support_case.id = flag.support_case_id
       WHERE flag.org_id = ? AND flag.support_case_id = ?
         AND (flag.source = 'counselor' OR flag.review_status = 'confirmed')
       ORDER BY flag.created_at DESC`,
    ).bind(actor.orgId, context.supportCaseId).all<DbRow>(),
    loadApprovedAiBriefings(env, actor.orgId, caseId),
  ]);

  const pointsByGoal = new Map<string, Array<{ heldAt: string; score: number }>>();
  for (const row of scoreRows.results) {
    const bucket = pointsByGoal.get(row.goal_id) ?? [];
    bucket.push({ heldAt: row.held_at, score: row.score });
    pointsByGoal.set(row.goal_id, bucket);
  }
  const gasTrend = goals.map((goal) => ({ goal, points: pointsByGoal.get(goal.id) ?? [] }));

  const latest = latestRow === null ? null : mapSession(latestRow);
  const approvedBySession = new Map(approvedBriefings.map((briefing) => [briefing.sessionId, briefing] as const));
  const latestApproved = latest === null ? undefined : approvedBySession.get(latest.id);
  const lastSessionSummary = latest === null || (latest.memo === null && latestApproved === undefined)
    ? null
    : latestApproved !== undefined
      ? { source: 'ai' as const, text: latestApproved.summaryText, pendingApprovalCount: pending?.count ?? 0 }
      : { source: 'memo' as const, text: latest.memo ?? '', pendingApprovalCount: pending?.count ?? 0 };
  await writeAudit(env, actor, { action: 'read', targetTable: 'briefing', targetId: caseId, caseId });

  return {
    caseId,
    gasTrend,
    lastSessionSummary,
    openActionItems: actions.results.map(mapActionItem),
    flags: flags.results.map(mapFlag),
    // 구 케이스 브리핑 응답은 단문 문자열 계약을 유지한다 — 구조화 제안의 제목만 싣는다(CCC-39).
    questions: (approvedBriefings[0]?.questions ?? []).map((suggestion) => suggestion.title),
  };
}

// ============================================================================
// GAS 점수 (session_goal_scores) — D6
// ============================================================================

/**
 * GAS 점수 기록. scored_by는 항상 사람(실무자) — service 역할은 호출 불가 (D6).
 * AI가 제안한 근거 발췌(evidenceQuote)는 함께 저장할 수 있다.
 * 권한: 담당 실무자 | admin. 감사: create.
 */
export async function recordGasScores(
  env: Env,
  actor: Actor,
  sessionId: string,
  scores: Array<{
    goalId: string;
    score: -2 | -1 | 0 | 1 | 2;
    evidenceQuote?: string;
  }>,
): Promise<GasScore[]> {
  const session = await assertSessionAccess(env, actor, sessionId);
  if (scores.length === 0) {
    throw new ValidationError('at least one GAS score is required');
  }

  const caseByGoal = await goalCaseMap(env, actor.orgId, scores.map((item) => item.goalId));
  const seenGoalIds = new Set<string>();
  const saved: GasScore[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const item of scores) {
    if (seenGoalIds.has(item.goalId)) {
      throw new ValidationError('a goal can be scored only once per request');
    }
    seenGoalIds.add(item.goalId);
    if (!Number.isInteger(item.score) || item.score < -2 || item.score > 2) {
      throw new ValidationError('GAS score must be an integer from -2 to 2');
    }
    const goalCaseId = caseByGoal.get(item.goalId);
    if (goalCaseId === undefined) {
      throw new ForbiddenError('goal is not available in this organization');
    }
    if (goalCaseId !== session.caseId) {
      throw new ValidationError('GAS score goal must belong to the session case');
    }
    const evidenceQuote = item.evidenceQuote ?? null;
    statements.push(env.DB.prepare(
      'INSERT INTO session_goal_scores (id, org_id, session_id, goal_id, score, evidence_quote, scored_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, goal_id) DO UPDATE SET score = excluded.score, evidence_quote = excluded.evidence_quote, scored_by = excluded.scored_by',
    ).bind(newId(), actor.orgId, sessionId, item.goalId, item.score, evidenceQuote, actor.userId, now()));
    saved.push({
      sessionId,
      goalId: item.goalId,
      score: item.score,
      evidenceQuote,
      scoredBy: actor.userId,
    });
  }

  await env.DB.batch(statements);
  await writeAudit(env, actor, { action: 'create', targetTable: 'session_goal_scores', caseId: session.caseId, detail: { scoreCount: scores.length } });
  return saved;
}

// ============================================================================
// 액션 아이템 (action_items)
// ============================================================================

/** 액션 아이템 생성. 권한: 담당 실무자 | admin. 감사: create. */
export async function createActionItem(
  env: Env,
  actor: Actor,
  caseId: string,
  input: {
    description: string;
    owner: 'counselor' | 'beneficiary' | 'org';
    dueDate?: string;
    sessionId?: string;
  },
): Promise<ActionItem> {
  assertHuman(actor);
  await assertCaseAccess(env, actor, caseId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  if (input.description.trim().length === 0) {
    throw new ValidationError('action item description is required');
  }
  if (input.owner !== 'counselor' && input.owner !== 'beneficiary' && input.owner !== 'org') {
    throw new ValidationError('action item owner is invalid');
  }
  if (input.sessionId !== undefined) {
    const session = await getSessionForOrg(env, actor.orgId, input.sessionId);
    if (session.caseId !== caseId) {
      throw new ValidationError('action item session must belong to the case');
    }
  }

  const action: ActionItem = {
    id: newId(),
    caseId,
    sessionId: input.sessionId ?? null,
    description: input.description,
    owner: input.owner,
    dueDate: input.dueDate ?? null,
    resolvedAt: null,
  };
  await env.DB.prepare(
    'INSERT INTO action_items (id, org_id, support_case_id, session_id, description, owner, due_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    action.id,
    actor.orgId,
    context.supportCaseId,
    action.sessionId,
    action.description,
    action.owner,
    action.dueDate,
    now(),
  ).run();
  await writeAudit(env, actor, { action: 'create', targetTable: 'action_items', targetId: action.id, caseId });
  return action;
}

/** 액션 아이템 해결 처리. 권한: 담당 실무자 | admin. 감사: update. */
export async function resolveActionItem(
  env: Env,
  actor: Actor,
  actionItemId: string,
): Promise<ActionItem> {
  assertHuman(actor);
  const action = await getActionItemForOrg(env, actor.orgId, actionItemId);
  await assertCaseAccess(env, actor, action.caseId);
  const resolvedAt = now();
  await env.DB.prepare('UPDATE action_items SET resolved_at = ?, resolved_by = ? WHERE id = ? AND org_id = ?')
    .bind(resolvedAt, actor.userId, actionItemId, actor.orgId)
    .run();
  await writeAudit(env, actor, { action: 'update', targetTable: 'action_items', targetId: actionItemId, caseId: action.caseId });
  return { ...action, resolvedAt };
}

/** 미해결 액션 아이템 목록 (브리핑 3번). 권한: 담당 실무자 | admin. 감사: read. */
export async function listOpenActionItems(
  env: Env,
  actor: Actor,
  caseId: string,
): Promise<ActionItem[]> {
  assertHuman(actor);
  await assertCaseAccess(env, actor, caseId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  const result = await env.DB.prepare(
    `SELECT action_item.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
     FROM action_items AS action_item
     JOIN support_cases AS support_case ON support_case.id = action_item.support_case_id
     WHERE action_item.org_id = ? AND action_item.support_case_id = ? AND action_item.resolved_at IS NULL
     ORDER BY action_item.due_date, action_item.created_at`,
  ).bind(actor.orgId, context.supportCaseId).all<DbRow>();
  await writeAudit(env, actor, { action: 'read', targetTable: 'action_items', caseId });
  return result.results.map(mapActionItem);
}

// ============================================================================
// 리스크 플래그 (flags) — D9
// ============================================================================

/**
 * 실무자 직접 플래그 생성 (source='counselor', 생성 즉시 confirmed).
 * AI 제안 플래그는 ingestSessionArtifacts 경유로만 들어온다(quote 필수).
 * 권한: 담당 실무자 | admin. 감사: create.
 */
export async function createFlag(
  env: Env,
  actor: Actor,
  caseId: string,
  input: { flagType: FlagType; quote?: string; sessionId?: string },
): Promise<Flag> {
  assertHuman(actor);
  await assertCaseAccess(env, actor, caseId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  const flagType = toFlagType(input.flagType);
  if (input.sessionId !== undefined) {
    const session = await getSessionForOrg(env, actor.orgId, input.sessionId);
    if (session.caseId !== caseId) {
      throw new ValidationError('flag session must belong to the case');
    }
  }

  const reviewedAt = now();
  const flag: Flag = {
    id: newId(),
    caseId,
    sessionId: input.sessionId ?? null,
    flagType,
    quote: input.quote ?? null,
    source: 'counselor',
    reviewStatus: 'confirmed',
    reviewedBy: actor.userId,
    reviewedAt,
  };
  await env.DB.prepare(
    'INSERT INTO flags (id, org_id, support_case_id, session_id, flag_type, quote, source, review_status, reviewed_by, reviewed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).bind(
    flag.id,
    actor.orgId,
    context.supportCaseId,
    flag.sessionId,
    flag.flagType,
    flag.quote,
    flag.source,
    flag.reviewStatus,
    flag.reviewedBy,
    flag.reviewedAt,
    reviewedAt,
  ).run();
  await writeAudit(env, actor, { action: 'create', targetTable: 'flags', targetId: flag.id, caseId });
  return flag;
}

/**
 * AI 제안 플래그 확인 — 맞음(confirmed)/틀림(rejected) (D9).
 * rejected도 삭제하지 않고 보존한다(분기별 적중률 점검 루프의 데이터).
 * 권한: 담당 실무자 | admin. 감사: update.
 */
export async function reviewFlag(
  env: Env,
  actor: Actor,
  flagId: string,
  verdict: 'confirmed' | 'rejected',
): Promise<Flag> {
  assertHuman(actor);
  const flag = await getFlagForOrg(env, actor.orgId, flagId);
  await assertCaseAccess(env, actor, flag.caseId);
  if (flag.source !== 'ai') {
    throw new ValidationError('only AI-proposed flags require review');
  }
  if (verdict !== 'confirmed' && verdict !== 'rejected') {
    throw new ValidationError('flag review verdict is invalid');
  }

  const reviewedAt = now();
  await env.DB.prepare('UPDATE flags SET review_status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ? AND org_id = ?')
    .bind(verdict, actor.userId, reviewedAt, flagId, actor.orgId)
    .run();
  await writeAudit(env, actor, { action: 'update', targetTable: 'flags', targetId: flagId, caseId: flag.caseId });
  return { ...flag, reviewStatus: verdict, reviewedBy: actor.userId, reviewedAt };
}

/** 플래그 목록. 기본은 rejected 제외. 권한: 담당 실무자 | admin. 감사: read. */
export async function listFlags(
  env: Env,
  actor: Actor,
  caseId: string,
  opts?: { includeRejected?: boolean },
): Promise<Flag[]> {
  assertHuman(actor);
  await assertCaseAccess(env, actor, caseId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  const result = opts?.includeRejected === true
    ? await env.DB.prepare(
      `SELECT flag.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
       FROM flags AS flag
       JOIN support_cases AS support_case ON support_case.id = flag.support_case_id
       WHERE flag.org_id = ? AND flag.support_case_id = ?
       ORDER BY flag.created_at DESC`,
    ).bind(actor.orgId, context.supportCaseId).all<DbRow>()
    : await env.DB.prepare(
      `SELECT flag.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
       FROM flags AS flag
       JOIN support_cases AS support_case ON support_case.id = flag.support_case_id
       WHERE flag.org_id = ? AND flag.support_case_id = ? AND flag.review_status != 'rejected'
       ORDER BY flag.created_at DESC`,
    ).bind(actor.orgId, context.supportCaseId).all<DbRow>();
  await writeAudit(env, actor, { action: 'read', targetTable: 'flags', caseId });
  return result.results.map(mapFlag);
}

// ============================================================================
// 감사·내보내기 (audit_log) — D14
// ============================================================================

/** AI 호출 관측 (CCC-47) 의 감사 action. 읽을 때 이 한 값으로 걸러 낸다. */
export const AI_CALL_AUDIT_ACTION = 'ai_call';

/** 어느 호출 자리인가. D51 ④ 의 두 자리에 대응한다. */
export type AiCallKind = 'discrepancy_detection';

/**
 * 한 번의 시도가 어떻게 끝났는가. **닫힌 목록**이라는 점이 핵심이다 — 자유 문자열을
 * 허용하면 언젠가 오류 메시지가 실려 상담 내용이 샌다(R3).
 *
 * - `stored` / `empty`      정상. 사업자가 답했고 결과를 저장했다(0건이면 empty).
 * - `skipped_no_snapshot`   트리거 회차에 2차 마스킹 스냅샷이 아직 없다 — 대기 중이며 가장 흔하다.
 * - `skipped_consent`       ② 동의 근거가 없다. 운영 전환 직후 기존 케이스 전부가 여기 걸린다(ADR-0027 실측 ②).
 * - `skipped_pilot_disabled` 파일럿 스위치가 꺼져 있다.
 * - `skipped_unsupported`   어댑터에 검출 메서드가 없다.
 * - `provider_unavailable`  설정이 없어 **부를 수조차 없었다**(설정·키). reason 이 어느 쪽인지 가른다.
 * - `provider_error`        불렀는데 실패했다(망·상태 코드·깨진 응답). 401 과 404 는 status 가 가른다.
 * - `output_rejected`       출력이 검증에 걸려 버려졌다(R5 — 인용이 원문과 다른 경우가 대부분일 것이다).
 * - `request_invalid`       우리가 만든 요청이 스키마에 안 맞았다 = 우리 쪽 버그.
 * - `failed_other`          그 밖의 예외(저장 실패 등).
 */
export type AiCallOutcome =
  | 'stored'
  | 'empty'
  | 'skipped_no_snapshot'
  | 'skipped_consent'
  | 'skipped_pilot_disabled'
  | 'skipped_unsupported'
  | 'provider_unavailable'
  | 'provider_error'
  | 'output_rejected'
  | 'request_invalid'
  | 'failed_other';

/**
 * 실패 사유. `apps/api/src/ai-provider.ts` 의 AiProviderUnavailableReason 을 그대로
 * 비춘다 — 게이트웨이가 앱 코드를 import 하지 않으므로(의존 방향) 값 목록을 여기 다시
 * 쓴다. 한쪽에만 값이 늘면 호출부에서 타입 오류로 잡힌다.
 *
 * **열린 문자열이 아니라는 점이 이 타입의 존재 이유다.** 자유 문자열을 허용하면 언젠가
 * 오류 메시지가 실려 상담 내용이 감사 로그로 샌다(R3).
 */
export type AiCallFailureReason =
  | 'config_missing'
  | 'config_invalid'
  | 'api_key_missing'
  | 'adapter_invalid'
  | 'network'
  | 'http_status'
  | 'malformed_response'
  | 'unknown';

export interface AiCallOutcomeEntry {
  kind: AiCallKind;
  outcome: AiCallOutcome;
  sessionId: string;
  caseId?: string | null;
  /** provider_unavailable · provider_error 의 세부 사유. */
  reason?: AiCallFailureReason | null;
  /** reason='http_status' 일 때의 응답 코드. 100~599 밖이면 버린다. */
  status?: number | null;
  /** 사업자에 보낸 재료 회차 수. 0 이면 보낼 것이 없었다는 뜻이다. */
  sourceCount?: number | null;
  /** 저장한 불일치 건수. */
  storedCount?: number | null;
  durationMs?: number | null;
  /** 설정값(운영자가 넣은 값)이라 상담 내용이 아니다. 모델·프롬프트 판올림 추적용. */
  model?: string | null;
  promptVersion?: string | null;
}

/** 정수만, 그것도 정해진 범위 안만 통과시킨다 — 숫자 자리로 문자열이 새지 않게. */
function boundedInteger(value: number | null | undefined, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < min || rounded > max) return undefined;
  return rounded;
}

/**
 * AI 호출 한 번의 **사실만** 남긴다 (CCC-47 · D14). 보낸 텍스트도 받은 텍스트도 남기지
 * 않는다(R3) — 분류·숫자·설정값뿐이다. 그래서 인자가 열린 문자열이 아니라 닫힌 타입이다.
 *
 * 권한 검사를 하지 않는 이유: 호출자는 이미 자기 경로에서 접근 검사를 통과했고, 이 함수는
 * **자기 자신의 실패까지** 남겨야 해서 여기서 다시 던지면 남길 것이 사라진다. 실패가 기록
 * 저장을 막아서도 안 된다(D8) — 호출자가 감싸지만, 여기서도 삼킨다.
 */
export async function recordAiCallOutcome(
  env: Env,
  actor: Actor,
  entry: AiCallOutcomeEntry,
): Promise<void> {
  const detail: Record<string, unknown> = {
    kind: entry.kind,
    outcome: entry.outcome,
  };
  if (typeof entry.reason === 'string' && entry.reason.length > 0) detail.reason = entry.reason;
  const status = boundedInteger(entry.status, 100, 599);
  if (status !== undefined) detail.status = status;
  const sourceCount = boundedInteger(entry.sourceCount, 0, 10_000);
  if (sourceCount !== undefined) detail.sourceCount = sourceCount;
  const storedCount = boundedInteger(entry.storedCount, 0, 10_000);
  if (storedCount !== undefined) detail.storedCount = storedCount;
  const durationMs = boundedInteger(entry.durationMs, 0, 3_600_000);
  if (durationMs !== undefined) detail.durationMs = durationMs;
  if (typeof entry.model === 'string' && entry.model.length > 0) detail.model = entry.model;
  if (typeof entry.promptVersion === 'string' && entry.promptVersion.length > 0) {
    detail.promptVersion = entry.promptVersion;
  }

  try {
    await writeAudit(env, actor, {
      action: AI_CALL_AUDIT_ACTION,
      targetTable: 'sessions',
      targetId: entry.sessionId,
      caseId: entry.caseId ?? null,
      detail,
    });
  } catch {
    // 관측이 기록 저장을 막으면 고치려던 것보다 나쁜 것을 들인다(D8).
  }
}

/**
 * 감사 로그 조회. 권한: admin 전용. 감사: read(audit_log) — 감사 조회도 기록.
 */
export async function listAuditLog(
  env: Env,
  actor: Actor,
  filter?: { caseId?: string; actorId?: string; from?: string; to?: string },
): Promise<
  Array<{
    id: number;
    actorId: string;
    actorRole: Role;
    action: string;
    targetTable: string;
    targetId: string | null;
    caseId: string | null;
    createdAt: string;
  }>
> {
  assertAdmin(actor);
  const conditions = ['org_id = ?'];
  const values: Array<string> = [actor.orgId];

  if (filter?.caseId !== undefined) {
    conditions.push('case_id = ?');
    values.push(filter.caseId);
  }
  if (filter?.actorId !== undefined) {
    conditions.push('actor_id = ?');
    values.push(filter.actorId);
  }
  if (filter?.from !== undefined) {
    conditions.push('created_at >= ?');
    values.push(filter.from);
  }
  if (filter?.to !== undefined) {
    conditions.push('created_at <= ?');
    values.push(filter.to);
  }

  const result = await env.DB.prepare(
    `SELECT id, actor_id, actor_role, action, target_table, target_id, case_id, created_at FROM audit_log WHERE ${conditions.join(' AND ')} ORDER BY id`,
  ).bind(...values).all<DbRow>();
  await writeAudit(env, actor, { action: 'read', targetTable: 'audit_log', detail: { filter: true } });

  return result.results.map((row) => ({
    id: typeof row.id === 'number' ? row.id : Number.parseInt(stringValue(row.id), 10),
    actorId: stringValue(row.actor_id),
    actorRole: toRole(row.actor_role),
    action: stringValue(row.action),
    targetTable: stringValue(row.target_table),
    targetId: nullableString(row.target_id),
    caseId: nullableString(row.case_id),
    createdAt: stringValue(row.created_at),
  }));
}

/**
 * 케이스 내보내기(보고서 등 외부 반출). PII는 포함하지 않는다.
 * R2: 승인된 기록만 포함. 권한: 담당 실무자 | admin. 감사: export (D14).
 */
export async function exportCase(
  env: Env,
  actor: Actor,
  caseId: string,
): Promise<{ case: Case; goals: Goal[]; sessions: Session[]; gasScores: GasScore[] }> {
  assertHuman(actor);
  const caseRecord = await assertCaseAccess(env, actor, caseId);
  const context = await resolveLegacyCaseContext(env, actor.orgId, caseId);
  // 서로 독립적인 조회는 병렬로 실행한다.
  const [goals, sessionRows, gasScores, approvedBriefings] = await Promise.all([
    env.DB.prepare(
      `SELECT goal.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
       FROM goals AS goal
       JOIN support_cases AS support_case ON support_case.id = goal.support_case_id
       WHERE goal.org_id = ? AND goal.support_case_id = ?
       ORDER BY goal.created_at`,
    ).bind(actor.orgId, context.supportCaseId).all<DbRow>(),
    env.DB.prepare(
      `SELECT session.*, COALESCE(support_case.legacy_case_id, support_case.id) AS case_id
       FROM sessions AS session
       JOIN support_cases AS support_case ON support_case.id = session.support_case_id
       WHERE session.org_id = ? AND session.support_case_id = ?
       ORDER BY session.held_at DESC`,
    ).bind(actor.orgId, context.supportCaseId).all<DbRow>(),
    env.DB.prepare(
      `SELECT session_goal_scores.*
       FROM session_goal_scores
       INNER JOIN sessions ON sessions.id = session_goal_scores.session_id
       WHERE session_goal_scores.org_id = ?
         AND sessions.support_case_id = ?
         AND EXISTS (
           SELECT 1
           FROM approved_ai_briefing_v1 AS approved
           WHERE approved.org_id = session_goal_scores.org_id
             AND approved.session_id = sessions.id
         )
       ORDER BY sessions.held_at`,
    ).bind(actor.orgId, context.supportCaseId).all<DbRow>(),
    loadApprovedAiBriefings(env, actor.orgId, caseId),
  ]);
  const approvedBySession = new Map(approvedBriefings.map((briefing) => [briefing.sessionId, briefing] as const));
  await writeAudit(env, actor, { action: 'export', targetTable: 'cases', targetId: caseId, caseId });
  return {
    case: caseRecord,
    goals: goals.results.map(mapGoal),
    sessions: sessionRows.results
      .map(mapSession)
      .map((session) => officialSessionFromApprovedBriefing(session, approvedBySession.get(session.id))),
    gasScores: gasScores.results.map(mapGasScore),
  };
}

// ============================================================================
// 사용자 디렉터리 (users) — Cloudflare Access 신원 → 앱 역할 매핑 (D1·D7·D13)
// ============================================================================

/** 사용자 디렉터리 행. Access 신원(email 또는 서비스 토큰 common_name)을 앱 역할에 매핑한다. */
export interface User {
  id: string;
  orgId: string;
  email: string; // 사람=로그인 이메일 / 서비스 토큰=client id·common_name
  role: Role;
  active: boolean;
  name: string | null; // 직원 표시 이름(D31). PII 금고 대상 아님 — 화면 표기용, 미입력이면 null
}

function mapUser(row: DbRow): User {
  return {
    id: stringValue(row.id),
    orgId: stringValue(row.org_id),
    email: stringValue(row.email),
    role: toRole(row.role),
    active: row.active === 1 || row.active === true,
    name: nullableString(row.name),
  };
}

async function getUserForOrg(env: Env, orgId: string, userId: string): Promise<User> {
  const row = await env.DB.prepare('SELECT * FROM users WHERE id = ? AND org_id = ?')
    .bind(userId, orgId)
    .first<DbRow>();

  if (row === null) {
    throw new ForbiddenError('user is not available in this organization');
  }

  return mapUser(row);
}

/**
 * 기관에 '이 사용자 말고' 활성 관리자가 하나도 없으면 거부한다.
 * 마지막 활성 관리자를 강등·비활성화해 기관이 관리자 없는 상태가 되는 것을 막는다.
 */
async function assertNotLastActiveAdmin(env: Env, orgId: string, excludeUserId: string): Promise<void> {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM users WHERE org_id = ? AND role = 'admin' AND active = 1 AND id != ?",
  ).bind(orgId, excludeUserId).first<{ count: number }>();

  if ((row?.count ?? 0) === 0) {
    throw new ValidationError('cannot remove the last active admin of the organization');
  }
}

/**
 * 이메일(사람) 또는 서비스 토큰 common_name으로 사용자 디렉터리 행을 조회한다.
 *
 * ⚠ 이 함수는 gateway의 공통 계약(actor·org·권한·감사)에서 의도적으로 벗어난 유일한
 * 예외다 — identity 해석(인증 확립) 단계에서 호출되므로 아직 Actor가 없다. 안전성 근거:
 *   1. 입력 email/common_name은 Cloudflare Access가 서명·검증한 JWT의 claim이다
 *      (호출부 identity.ts가 RS256 서명·iss·aud·exp를 먼저 검증한 뒤에만 부른다).
 *      즉 위조 불가능한 신원에 대한 디렉터리 행 1건만 되돌린다.
 *   2. 반환값은 PII가 아니라 {id, org_id, role}뿐이고, email은 이미 호출부가 아는 값이다.
 *   3. 이후 이 행으로 만들어진 Actor의 모든 gateway 호출은 정상적으로 org·권한·감사를 거친다.
 *   4. 이메일은 전역 UNIQUE라 결과가 0 또는 1건이며 교차 기관 노출이 없다.
 * 따라서 여기서 별도 감사를 남기지 않는다(인증 전 단계, 행위자 없음).
 */
export async function findUserByEmail(env: Env, email: string): Promise<User | null> {
  const row = await env.DB.prepare('SELECT * FROM users WHERE email = ?')
    .bind(email)
    .first<DbRow>();
  return row === null ? null : mapUser(row);
}

/** 사용자 디렉터리 목록. 권한: admin 전용, 자기 기관만. 감사: read(users). */
export async function listUsers(env: Env, actor: Actor): Promise<User[]> {
  assertAdmin(actor);
  const result = await env.DB.prepare('SELECT * FROM users WHERE org_id = ? ORDER BY email')
    .bind(actor.orgId)
    .all<DbRow>();
  await writeAudit(env, actor, { action: 'read', targetTable: 'users', detail: { list: true } });
  return result.results.map(mapUser);
}

/**
 * 사용자 프로비저닝(생성 또는 역할 갱신). email이 신원 키(전역 UNIQUE)다.
 *   - 신규(이메일 없음): userId를 주면 그 값을, 없으면 UUID를 id로 써 활성 상태로 만든다.
 *   - 기존(같은 기관): 역할을 갱신하고 active=1로 재활성화한다(프로비저닝 = 활성 보장).
 *     이때 userId 인자는 무시한다(이메일이 이미 신원을 특정한다).
 *   - 마지막 활성 관리자를 admin이 아닌 역할로 강등하려 하면 거부한다.
 *   - 다른 기관 소속 이메일은 건드릴 수 없다(ForbiddenError).
 * 권한: admin 전용, 자기 기관만. 감사: create 또는 update(users).
 */
export async function upsertUser(
  env: Env,
  actor: Actor,
  input: { email: string; role: Role; userId?: string; name?: string },
): Promise<User> {
  assertAdmin(actor);
  const email = input.email.trim();
  if (email.length === 0) {
    throw new ValidationError('user email is required');
  }
  const role = input.role;
  if (role !== 'admin' && role !== 'counselor' && role !== 'service') {
    throw new ValidationError('user role is invalid');
  }

  const existing = await findUserByEmail(env, email);
  if (existing !== null && existing.orgId !== actor.orgId) {
    throw new ForbiddenError('user belongs to another organization');
  }
  if (existing !== null && existing.role === 'admin' && existing.active && role !== 'admin') {
    await assertNotLastActiveAdmin(env, actor.orgId, existing.id);
  }

  // 표시 이름(D31)은 미전달(undefined)이면 기존값을 보존한다: INSERT 는 NULL, UPDATE 는 COALESCE.
  const name = input.name ?? null;
  if (existing === null) {
    const id = input.userId !== undefined && input.userId.trim().length > 0 ? input.userId.trim() : newId();
    await env.DB.prepare('INSERT INTO users (id, org_id, email, role, active, name) VALUES (?, ?, ?, ?, 1, ?)')
      .bind(id, actor.orgId, email, role, name)
      .run();
    await writeAudit(env, actor, { action: 'create', targetTable: 'users', targetId: id, detail: { role } });
    return { id, orgId: actor.orgId, email, role, active: true, name };
  }

  await env.DB.prepare('UPDATE users SET role = ?, active = 1, name = COALESCE(?, name) WHERE id = ? AND org_id = ?')
    .bind(role, name, existing.id, actor.orgId)
    .run();
  await writeAudit(env, actor, { action: 'update', targetTable: 'users', targetId: existing.id, detail: { role } });
  return { ...existing, role, active: true, name: input.name ?? existing.name };
}

/**
 * 사용자 비활성화(디렉터리에서 접근 차단). 행을 지우지 않고 active=0으로 기록한다.
 * 가드: 자기 자신은 비활성화 불가, 마지막 활성 관리자도 비활성화 불가
 * (관리자 없는 기관 방지 + 자기 축출로 인한 잠금 방지).
 * 권한: admin 전용, 자기 기관만. 감사: update(users).
 */
export async function deactivateUser(env: Env, actor: Actor, userId: string): Promise<User> {
  assertAdmin(actor);
  const user = await getUserForOrg(env, actor.orgId, userId);
  if (user.id === actor.userId) {
    throw new ValidationError('cannot deactivate yourself');
  }
  if (user.role === 'admin' && user.active) {
    await assertNotLastActiveAdmin(env, actor.orgId, userId);
  }
  await env.DB.prepare('UPDATE users SET active = 0 WHERE id = ? AND org_id = ?')
    .bind(userId, actor.orgId)
    .run();
  await writeAudit(env, actor, { action: 'update', targetTable: 'users', targetId: userId, detail: { active: false } });
  return { ...user, active: false };
}

/**
 * 로그인한 본인의 디렉터리 정보(이메일·역할)를 조회한다. 설정 화면의 '내 계정' 섹션이 쓴다.
 * 권한: 인증된 본인(역할 무관) — org_id 일치로 자기 기관 자기 행만 읽는다. 감사: read(users, self).
 * 관리자 전용이 아니므로 담당 실무자(counselor)도 자기 신원은 확인할 수 있다.
 */
export async function getMyIdentity(env: Env, actor: Actor): Promise<User> {
  const user = await getUserForOrg(env, actor.orgId, actor.userId);
  await writeAudit(env, actor, { action: 'read', targetTable: 'users', targetId: actor.userId, detail: { self: true } });
  return user;
}

/**
 * 마지막에 선택한 사업을 본인 계정에 기억시킨다 (D35 · ADR-0014 '개정' 2번).
 * `/` 가 이 값으로 직행하므로, 집 컴퓨터와 사무실에서 같은 사업으로 들어간다.
 *
 * **본인 행만 쓴다** — actor.userId 로 잠겨 있어 남의 설정을 바꿀 경로가 없다.
 * 서비스 토큰은 화면이 없으므로 사람만 허용한다.
 *
 * **감사를 남기지 않는다.** D14가 기록하라고 정한 것은 당사자·케이스 기록의 열람·변경·
 * PII 복호화·내보내기다. 본인 UI 설정을 화면 이동마다 남기면 감사 로그가 내비게이션
 * 흔적으로 덮여 "누가 누구의 PII를 봤나"를 찾기 어려워진다 — 감사의 목적을 해친다.
 * 근거는 migrations/0017 주석에도 적어 두었다.
 *
 * 값이 이미 같으면 UPDATE 를 실행하지 않는다 — 화면 진입마다 쓰기가 도는 것을 막는다.
 */
export async function rememberLastProgramType(
  env: Env,
  actor: Actor,
  programType: string,
): Promise<void> {
  assertHuman(actor);
  if (programType.trim().length === 0) throw new ValidationError('program type is required');
  const current = await env.DB.prepare('SELECT last_program_type FROM users WHERE id = ? AND org_id = ?')
    .bind(actor.userId, actor.orgId)
    .first<DbRow>();
  if (current === null) throw new ForbiddenError('user is not available in this organization');
  if (nullableString(current.last_program_type) === programType) return;
  await env.DB.prepare('UPDATE users SET last_program_type = ? WHERE id = ? AND org_id = ?')
    .bind(programType, actor.userId, actor.orgId)
    .run();
}

/**
 * `/` 직행 목적지. 저장값이 없으면 null 을 돌려주고 **화면이 첫 사업으로 폴백**한다 —
 * 사라진 사업인지까지는 여기서 판정하지 않는다(사업 목록은 화면 상수라 D1 밖에 있다).
 */
export async function getLastProgramType(env: Env, actor: Actor): Promise<string | null> {
  assertHuman(actor);
  const row = await env.DB.prepare('SELECT last_program_type FROM users WHERE id = ? AND org_id = ?')
    .bind(actor.userId, actor.orgId)
    .first<DbRow>();
  if (row === null) throw new ForbiddenError('user is not available in this organization');
  return nullableString(row.last_program_type);
}

// ============================================================================
// 내부 전용 (export하지 않음) — 구현 조각에서 채운다
// ============================================================================

/**
 * assertCaseAccess(env, actor, caseId):
 *   org_id 일치 + (admin 또는 case_assignees 활성 행) 검사. 실패 시 ForbiddenError.
 *   모든 공개 함수가 첫 단계로 호출한다 (D7).
 *
 * writeAudit(env, entry):
 *   audit_log INSERT. 모든 공개 함수가 마지막 단계로 호출한다 (D14).
 *   detail에 PII 값 기록 금지 (R3) — 필드명 수준까지만.
 *
 * encryptPii / decryptPii:
 *   AES-GCM (키: env.PII_ENC_KEY, D3). 이 파일 밖으로 평문 반출 금지 (R3).
 */

// ============================================================================
// Canonical participant / SupportCase gateway
// ============================================================================

/** A permanent, pseudonymous participant. Its id is the externally stable A### id. */
export interface Beneficiary {
  id: string;
  orgId: string;
  initializationState: 'pending' | 'complete';
  createdAt: string | null;
  updatedAt: string | null;
}

/** A program participation. Records, assignments, schedules, and AI remain scoped here. */
export interface SupportCase {
  id: string;
  orgId: string;
  beneficiaryId: string;
  legacyCaseId: string | null;
  programType: 'financial_support_v1';
  status: 'active' | 'closed';
  intakeAt: string | null;
  consentRecordingAt: string | null;
  consentTextAiAt: string | null;
  /** 개인정보 수집·이용 동의 시각 (D44 · 0020). NULL = 미동의. 게이트가 아니라 현재 상태다. */
  consentPrivacyAt: string | null;
  /** 전체 목표 (D45 · 0024). 케이스당 1개·수정 가능·점수 없음. NULL = 설정 전. */
  overallGoal: string | null;
  closedAt: string | null;
  closedReason: string | null;
  creationKind: 'legacy_import' | 'initial' | 'subsequent';
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SupportCaseAssignee {
  id: string;
  supportCaseId: string;
  userId: string;
  role: 'primary' | 'secondary';
  assignedAt: string;
  unassignedAt: string | null;
}

export interface ParticipantPiiVault {
  beneficiaryId: string;
  version: number;
  purgeDue: string | null;
  purgedAt: string | null;
}

export type CounselingScheduleStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';
// 상담 유형(기본 상담/인테이크)과 상담 방법(v1 대면 전용, D4). 티켓 #36.
export type CounselingScheduleKind = 'regular' | 'intake';
export type CounselingScheduleChannel = 'in_person';

export interface CounselingSchedule {
  id: string;
  beneficiaryId: string;
  supportCaseId: string;
  scheduledAt: string;
  status: CounselingScheduleStatus;
  sessionKind: CounselingScheduleKind;
  channel: CounselingScheduleChannel;
  version: number;
  completedSessionId: string | null;
  createdByActorId: string;
  updatedByActorId: string | null;
  completedByActorId: string | null;
  completedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface SourceSupportCase {
  id: string;
  programType: 'financial_support_v1';
  status: 'active' | 'closed';
}

export class ConflictError extends Error {}

const CANONICAL_UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FINANCIAL_SUPPORT_V1 = 'financial_support_v1' as const;

function canonicalCaseStatus(value: unknown): SupportCase['status'] {
  return value === 'closed' ? 'closed' : 'active';
}

function canonicalCreationKind(value: unknown): SupportCase['creationKind'] {
  if (value === 'initial' || value === 'subsequent') return value;
  return 'legacy_import';
}

function mapBeneficiary(row: DbRow): Beneficiary {
  return {
    id: stringValue(row.id),
    orgId: stringValue(row.org_id),
    initializationState: row.initialization_state === 'pending' ? 'pending' : 'complete',
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at),
  };
}

function mapSupportCase(row: DbRow): SupportCase {
  const programType = row.program_type;
  assertFinancialSupportProgramType(programType);
  return {
    id: stringValue(row.id),
    orgId: stringValue(row.org_id),
    beneficiaryId: stringValue(row.beneficiary_id),
    legacyCaseId: nullableString(row.legacy_case_id),
    programType,
    status: canonicalCaseStatus(row.status),
    intakeAt: nullableString(row.intake_at),
    consentRecordingAt: nullableString(row.consent_recording_at),
    consentTextAiAt: nullableString(row.consent_text_ai_at),
    consentPrivacyAt: nullableString(row.consent_privacy_at),
    overallGoal: nullableString(row.overall_goal),
    closedAt: nullableString(row.closed_at),
    closedReason: nullableString(row.closed_reason),
    creationKind: canonicalCreationKind(row.creation_kind),
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at),
  };
}

function mapSupportCaseAssignee(row: DbRow): SupportCaseAssignee {
  return {
    id: stringValue(row.id),
    supportCaseId: stringValue(row.support_case_id),
    userId: stringValue(row.user_id),
    role: toAssigneeRole(row.role),
    assignedAt: stringValue(row.assigned_at),
    unassignedAt: nullableString(row.unassigned_at),
  };
}

function canonicalScheduleStatus(value: unknown): CounselingScheduleStatus {
  if (value === 'completed' || value === 'cancelled' || value === 'no_show') return value;
  return 'scheduled';
}

// session_kind·channel 은 DB CHECK 로 고정 집합만 저장되므로 방어적으로 정규화한다
// (레거시/백필 행은 regular·in_person). 티켓 #36.
function canonicalScheduleKind(value: unknown): CounselingScheduleKind {
  return value === 'intake' ? 'intake' : 'regular';
}

function canonicalScheduleChannel(_value: unknown): CounselingScheduleChannel {
  return 'in_person';
}

function mapCounselingSchedule(row: DbRow): CounselingSchedule {
  const version = integerValue(row.version);
  if (version === null || version < 1) {
    throw new ValidationError('counseling schedule is invalid');
  }
  return {
    id: stringValue(row.id),
    beneficiaryId: stringValue(row.beneficiary_id),
    supportCaseId: stringValue(row.support_case_id),
    scheduledAt: stringValue(row.scheduled_at),
    status: canonicalScheduleStatus(row.status),
    sessionKind: canonicalScheduleKind(row.session_kind),
    channel: canonicalScheduleChannel(row.channel),
    version,
    completedSessionId: nullableString(row.completed_session_id),
    createdByActorId: stringValue(row.created_by_actor_id),
    updatedByActorId: nullableString(row.updated_by_actor_id),
    completedByActorId: nullableString(row.completed_by_actor_id),
    completedAt: nullableString(row.completed_at),
    createdAt: nullableString(row.created_at),
    updatedAt: nullableString(row.updated_at),
  };
}

function mapParticipantPiiVault(row: DbRow): ParticipantPiiVault {
  const version = integerValue(row.version);
  if (version === null || version < 1) {
    throw new ValidationError('participant PII vault is invalid');
  }
  return {
    beneficiaryId: stringValue(row.beneficiary_id),
    version,
    purgeDue: nullableString(row.purge_due),
    purgedAt: nullableString(row.purged_at),
  };
}

function sourceSupportCase(supportCase: SupportCase): SourceSupportCase {
  return {
    id: supportCase.id,
    programType: supportCase.programType,
    status: supportCase.status,
  };
}

// 확장 단계(티켓 #11): 레거시 A형식과 동물 슬러그 형식을 모두 수용한다 (D20).
function assertBeneficiaryId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !isBeneficiaryId(value)) {
    throw new ValidationError('beneficiary id is invalid');
  }
}

function canonicalUtcInstant(value: unknown, field: string): string {
  if (typeof value !== 'string' || !CANONICAL_UTC_INSTANT.test(value)) {
    throw new ValidationError(`${field} is invalid`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()) || date.toISOString() !== value) {
    throw new ValidationError(`${field} is invalid`);
  }
  return value;
}

function assertCanonicalSubmissionId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !CANONICAL_UUID.test(value)) {
    throw new ValidationError('submission id is invalid');
  }
}

function assertExactKeys(value: unknown, expected: readonly string[]): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('input is invalid');
  }
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    throw new ValidationError('input is invalid');
  }
}

function assertFinancialSupportProgramType(value: unknown): asserts value is typeof FINANCIAL_SUPPORT_V1 {
  if (value !== FINANCIAL_SUPPORT_V1) {
    throw new ValidationError('program type is invalid');
  }
}

function assertNonBlankText(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} is invalid`);
  }
}

function assertBoundedArray(value: unknown, field: string, maximum: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new ValidationError(`${field} is invalid`);
  }
}

/**
 * JCS is intentionally small here because canonical command payloads contain
 * only finite JSON primitives, arrays, and plain objects. It rejects values
 * that JSON.stringify would silently coerce, including malformed surrogates.
 */
export function canonicalizeJcs(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new ValidationError('canonical JSON number is invalid');
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new ValidationError('canonical JSON number is invalid');
    return serialized;
  }
  if (typeof value === 'string') {
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);
      if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
        const next = value.charCodeAt(index + 1);
        if (next < 0xdc00 || next > 0xdfff) {
          throw new ValidationError('canonical JSON string is invalid');
        }
        index += 1;
      } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
        throw new ValidationError('canonical JSON string is invalid');
      }
    }
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new ValidationError('canonical JSON string is invalid');
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJcs(item)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${canonicalizeJcs(key)}:${canonicalizeJcs(record[key])}`).join(',')}}`;
  }
  throw new ValidationError('canonical JSON value is invalid');
}

async function canonicalSha256(value: unknown): Promise<string> {
  return sha256Hex(canonicalizeJcs(value));
}

async function getBeneficiaryForOrg(
  env: Env,
  orgId: string,
  beneficiaryId: string,
  opts?: { completeOnly?: boolean },
): Promise<Beneficiary> {
  const row = await env.DB.prepare(
    `SELECT * FROM beneficiaries
     WHERE id = ? AND org_id = ?${opts?.completeOnly === true ? " AND initialization_state = 'complete'" : ''}`,
  ).bind(beneficiaryId, orgId).first<DbRow>();
  if (row === null) {
    throw new ForbiddenError('participant is unavailable');
  }
  return mapBeneficiary(row);
}

async function getSupportCaseForOrg(
  env: Env,
  orgId: string,
  supportCaseId: string,
  opts?: { completeOnly?: boolean },
): Promise<SupportCase> {
  const row = await env.DB.prepare(
    `SELECT support_cases.*
     FROM support_cases
     JOIN beneficiaries ON beneficiaries.id = support_cases.beneficiary_id
       AND beneficiaries.org_id = support_cases.org_id
     WHERE support_cases.id = ? AND support_cases.org_id = ?
       ${opts?.completeOnly === true ? " AND beneficiaries.initialization_state = 'complete'" : ''}`,
  ).bind(supportCaseId, orgId).first<DbRow>();
  if (row === null) {
    throw new ForbiddenError('support case is unavailable');
  }
  return mapSupportCase(row);
}

async function assertActiveHumanUser(
  env: Env,
  orgId: string,
  userId: string,
  expectedRole?: 'admin' | 'counselor',
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT id FROM users
     WHERE id = ? AND org_id = ? AND active = 1
       AND role IN ('admin', 'counselor')${expectedRole === undefined ? '' : ' AND role = ?'}`,
  ).bind(
    ...(expectedRole === undefined ? [userId, orgId] : [userId, orgId, expectedRole]),
  ).first<{ id: string }>();
  if (row === null) {
    throw new ForbiddenError('actor is unavailable');
  }
}

async function assertCurrentHumanActor(env: Env, actor: Actor): Promise<void> {
  assertHuman(actor);
  await assertActiveHumanUser(
    env,
    actor.orgId,
    actor.userId,
    actor.role === 'admin' ? 'admin' : 'counselor',
  );
}

async function assertActiveAssignment(
  env: Env,
  actor: Actor,
  supportCaseId: string,
): Promise<SupportCaseAssignee> {
  const row = await env.DB.prepare(
    `SELECT * FROM support_case_assignees
     WHERE org_id = ? AND support_case_id = ? AND user_id = ? AND unassigned_at IS NULL
     LIMIT 1`,
  ).bind(actor.orgId, supportCaseId, actor.userId).first<DbRow>();
  if (row === null) {
    throw new ForbiddenError('support case is unavailable');
  }
  return mapSupportCaseAssignee(row);
}

/**
 * Authorizes a SupportCase without granting mutation authority over a closed
 * participation. Counselors require an active assignment; administrators are
 * organization-scoped. Both paths reject non-published beneficiaries.
 */
export async function assertSupportCaseAccess(env: Env, actor: Actor, supportCaseId: string): Promise<SupportCase> {
  assertHuman(actor);
  const supportCase = await getSupportCaseForOrg(env, actor.orgId, supportCaseId, { completeOnly: true });
  if (actor.role === 'admin') {
    await assertActiveHumanUser(env, actor.orgId, actor.userId, 'admin');
    return supportCase;
  }
  await assertCurrentHumanActor(env, actor);
  await assertActiveAssignment(env, actor, supportCase.id);
  return supportCase;
}

/**
 * A mutating participant context always names one active SupportCase. It never
 * probes siblings, so a counselor's current assignment cannot disclose them.
 */
export async function assertActiveSupportCaseContext(
  env: Env,
  actor: Actor,
  beneficiaryId: string,
  supportCaseId: string,
): Promise<SupportCase> {
  assertBeneficiaryId(beneficiaryId);
  const supportCase = await assertSupportCaseAccess(env, actor, supportCaseId);
  if (supportCase.beneficiaryId !== beneficiaryId || supportCase.status !== 'active') {
    throw new ForbiddenError('support case is unavailable');
  }
  return supportCase;
}

async function writeCanonicalAudit(
  env: Env,
  actor: Actor,
  entry: {
    action: string;
    targetTable: string;
    targetId?: string | null;
    beneficiaryId?: string | null;
    supportCaseId?: string | null;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_log (
       org_id, actor_id, actor_role, action, target_table, target_id, case_id,
       beneficiary_id, support_case_id, detail, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, datetime('now'))`,
  ).bind(
    actor.orgId,
    actor.userId,
    actor.role,
    entry.action,
    entry.targetTable,
    entry.targetId ?? null,
    entry.beneficiaryId ?? null,
    entry.supportCaseId ?? null,
entry.detail === undefined ? null : stringifyJson(entry.detail),
  ).run();
}

function canonicalAuditStatement(
  env: Env,
  actor: Actor,
  entry: {
    action: string;
    targetTable: string;
    targetId: string;
    beneficiaryId: string;
    supportCaseId: string | null;
    detail: Record<string, unknown>;
    caseId?: string | null;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO audit_log (
       org_id, actor_id, actor_role, action, target_table, target_id, case_id,
       beneficiary_id, support_case_id, detail, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
  ).bind(
    actor.orgId,
    actor.userId,
    actor.role,
    entry.action,
    entry.targetTable,
    entry.targetId,
    entry.caseId ?? null,
    entry.beneficiaryId,
    entry.supportCaseId,
    stringifyJson(entry.detail),
  );
}
function conditionalCanonicalAuditStatement(
  env: Env,
  actor: Actor,
  entry: {
    action: string;
    targetTable: string;
    targetId: string;
    beneficiaryId: string;
    supportCaseId: string | null;
    detail: Record<string, unknown>;
  },
): D1PreparedStatement {
  return env.DB.prepare(
    `INSERT INTO audit_log (
       org_id, actor_id, actor_role, action, target_table, target_id, case_id,
       beneficiary_id, support_case_id, detail, created_at
     )
     SELECT ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, datetime('now')
     WHERE changes() = 1`,
  ).bind(
    actor.orgId,
    actor.userId,
    actor.role,
    entry.action,
    entry.targetTable,
    entry.targetId,
    entry.beneficiaryId,
    entry.supportCaseId,
    stringifyJson(entry.detail),
  );
}

/**
 * 신규 가명 ID 발급 — 동물 슬러그 + 동물별 순차번호 (D20 · ADR-0004 · 티켓 #11).
 *
 * - 동물 선택: 기관 내 슬러그 발급 수 기반 라운드로빈. 결정론적이라 검증 가능하고
 *   동물 풀을 균등하게 소진하며, 동시 생성 충돌 시 재시도가 다음 동물로 전진한다.
 * - 순번: 동물별·기관별 최대값 + 1 (3자리 제로패딩). id는 전역 PRIMARY KEY라
 *   다른 기관이 이미 선점한 번호는 전역 최대값 + 1로 건너뛴다 — 기관 내 단조
 *   증가는 유지되고 결번만 생긴다(현 단일 기관 배치에서는 발생하지 않음).
 * - 남는 동시성 충돌은 호출부의 UNIQUE 재시도 루프(F7)가 흡수한다.
 */
async function allocateBeneficiaryId(env: Env, orgId: string): Promise<string> {
  const rotation = await env.DB.prepare(
    "SELECT COUNT(*) AS issued FROM beneficiaries WHERE org_id = ? AND id GLOB '*-*'",
  ).bind(orgId).first<{ issued: number }>();
  const issued = rotation?.issued ?? 0;
  const animal = ANIMAL_SLUGS[issued % ANIMAL_SLUGS.length];
  if (animal === undefined) {
    throw new ValidationError('participant id allocation failed');
  }

  const sequences = await env.DB.prepare(
    `SELECT
       MAX(CASE WHEN org_id = ?1 THEN sequence END) AS org_max,
       MAX(sequence) AS global_max
     FROM (
       SELECT org_id, CAST(substr(id, ?2) AS INTEGER) AS sequence
       FROM beneficiaries
       WHERE id GLOB ?3
     )`,
  ).bind(orgId, animal.length + 2, `${animal}-[0-9]*`)
    .first<{ org_max: number | null; global_max: number | null }>();
  const orgMax = sequences?.org_max ?? 0;
  const globalMax = sequences?.global_max ?? 0;

  let next = orgMax + 1;
  if (next <= globalMax) {
    const taken = await env.DB.prepare('SELECT id FROM beneficiaries WHERE id = ?')
      .bind(`${animal}-${String(next).padStart(3, '0')}`)
      .first<{ id: string }>();
    if (taken !== null) next = globalMax + 1;
  }
  if (!Number.isSafeInteger(next) || next < 1) {
    throw new ValidationError('participant id allocation failed');
  }
  return `${animal}-${String(next).padStart(3, '0')}`;
}

export interface CreateBeneficiaryWithInitialSupportCaseInput {
  programType: 'financial_support_v1';
  /**
   * 인테이크 **완료** 시각(CCC-56). 등록은 인테이크가 아니므로 **등록 경로는 이 값을 보내지
   * 않는다** — HTTP 등록 라우트는 키 자체를 거부하고, 미제공이면 NULL(아직 없음)로 만든다.
   * 값을 실을 수 있는 곳은 직접 호출 하네스(테스트 픽스처)뿐이다. 실기록 경로는
   * createIntakeRecord 가 저장 시점에 채운다.
   */
  intakeAt?: string | null;
  initialAssigneeUserId?: string;
  // 등록 시점에 받은 값은 금고에 AES-GCM 암호문으로 저장한다(선택, D3 · D24 · #32 · #37).
  // 등록 폼이 이름·연락처·이메일을 받으므로 셋 다 등록 경로가 연다. 계좌는 이후
  // updateParticipantPii 로 채운다.
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  // D41 1-1·D42 ①: 생년월일·주소(거주지역)·성별도 등록 화면이 받아 금고에 넣는다. 인테이크
  // 화면은 이 값을 읽어 표시만 한다 — 세션 기록에는 남지 않는다(R3). 컬럼은 0015 재사용.
  birthDate?: string | null;
  region?: string | null;
  gender?: string | null;
}

/**
 * 당사자 등록 시 항목별 동의 3종(개인정보·녹음·텍스트 AI 분리, D15·D23·D44). 기본은 미동의(false)이며,
 * 미동의여도 등록은 진행된다(D15 미동의 경로). 동의한 항목은 등록 시각을
 * support_cases.consent_*_at(파이프라인 게이트) + participant_consent_records(기록자·일시)에
 * 함께 남긴다.
 */
export interface ParticipantConsentInput {
  /**
   * 개인정보 수집·이용 동의 (D44 → G1). **등록의 하드 게이트**다: true 가 아니면 등록이
   * 거부되고, 급박한 위기 개입만 `emergency`(사유 필수)로 통과한다. 생략은 미동의로 읽는다.
   */
  privacy?: boolean;
  /**
   * ② AI를 활용한 녹취기록 동의 (D49 — 구 ② 녹음·음성 분석 + 구 ③ 텍스트 AI 정리를 합친 것).
   * 체크 하나가 `consent_recording_at`·`consent_text_ai_at` **두 컬럼에 같은 시각**을 찍는다:
   * DB 는 3컬럼을 그대로 두므로(마이그레이션 없음) 법률 검토가 분리를 요구하면 화면만 다시
   * 펴면 된다. 값이 갈리면 0008·0014 insert 가드가 거부한다("NULL 아닌 동의 시각 = recorded_at").
   */
  recordingAi: boolean;
  /**
   * 긴급 등록 (G1 예외). ① 동의를 아직 받지 못한 채 등록해야 하는 경우에만 쓴다 —
   * 사유가 케이스 행에 남고 보완 기한(EMERGENCY_CONSENT_GRACE_DAYS)이 함께 생긴다.
   * ① 동의와 동시에 올 수 없다(예외는 동의가 없을 때만 성립).
   */
  emergency?: EmergencyRegistrationInput;
}

/** 긴급 등록 사유 (G1). 자유 텍스트라 감사 detail 에는 싣지 않는다(R3 태도). */
export interface EmergencyRegistrationInput {
  reason: string;
}

/** 긴급 등록으로 케이스 행에 남길 3값. 일반 등록이면 전부 NULL 이다. */
interface EmergencyRegistrationRecord {
  at: string;
  reason: string;
  dueAt: string;
}

const MAX_EMERGENCY_REASON_LENGTH = 500;

function emergencyConsentDueAt(instant: string): string {
  return new Date(Date.parse(instant) + EMERGENCY_CONSENT_GRACE_DAYS * 86_400_000).toISOString();
}

/**
 * ① 하드 게이트 판정 (G1 · 게이트 문서 §2). 등록 3경로(당사자 등록·추가 참여 사업·
 * 자기 가입)가 전부 이 함수 하나를 지난다 — 경로마다 조건을 다시 쓰면 한 곳만 느슨해진다.
 *
 * 반환값은 케이스 행에 쓸 긴급 등록 3값이며, ① 동의를 받았으면 null 이다.
 */
function assertPrivacyConsentGate(
  privacy: boolean,
  emergency: EmergencyRegistrationInput | undefined,
  createdAt: string,
): EmergencyRegistrationRecord | null {
  if (privacy) {
    // 동의가 있는데 긴급 예외까지 함께 오면 상태가 모순된다 — 예외는 동의가 없을 때만 성립한다.
    if (emergency !== undefined) throw new ValidationError('emergency registration requires missing privacy consent');
    return null;
  }
  if (emergency === undefined) throw new PrivacyConsentRequiredError();
  if (typeof emergency !== 'object' || emergency === null) throw new EmergencyReasonRequiredError();
  assertExactKeys(emergency, ['reason']);
  if (typeof emergency.reason !== 'string' || emergency.reason.trim().length === 0) {
    throw new EmergencyReasonRequiredError();
  }
  const reason = emergency.reason.trim();
  if (reason.length > MAX_EMERGENCY_REASON_LENGTH) {
    throw new ValidationError(`emergency reason must be at most ${MAX_EMERGENCY_REASON_LENGTH} characters`);
  }
  return { at: createdAt, reason, dueAt: emergencyConsentDueAt(createdAt) };
}
interface LegacyInitialSupportCaseCompatibility {
  intakeAt: string | null;
  consentRecordingAt: string | null;
  consentTextAiAt: string | null;
}

export interface CreateSupportCaseInput {
  schemaVersion: 1;
  submissionId: string;
  programType: 'financial_support_v1';
  /**
   * 인테이크 **완료** 시각(CCC-56). 추가 참여 사업도 등록 시점에는 인테이크 전이므로
   * HTTP 라우트는 키를 거부하고, 미제공이면 NULL 로 시작한다. 채움은 createIntakeRecord 몫이다.
   */
  intakeAt?: string | null;
  sourceSupportCaseId?: string;
  initialAssigneeUserId?: string;
  /**
   * ① 개인정보 수집·이용 동의 (G1). 같은 당사자의 두 번째 참여 사업도 동의 3종이 미체크로
   * 시작하므로(D44) 여기서 ① 을 다시 받는다. false 면 `emergencyReason` 없이는 거부된다.
   */
  consentPrivacy: boolean;
  /**
   * ② AI를 활용한 녹취기록 동의 (D49). **선택 인자**다 — ② 는 하드 게이트가 아니므로(G1은 ① 만)
   * 보내지 않으면 미동의로 시작한다. 이 인자가 생기기 전에는 두 번째 참여 사업에서 ② 를
   * 기록할 API 경로가 아예 없어, 사업을 만든 뒤 당사자 정보 페이지에서 따로 고쳐야 했다.
   */
  consentRecordingAi?: boolean;
  /** 긴급 등록 사유 (G1 예외). ① 미동의로 열어야 할 때만 넣는다. */
  emergencyReason?: string;
}

export interface SupportCaseCreationResult {
  beneficiaryId: string;
  supportCaseId: string;
  assignmentRole: 'primary';
  replayed: boolean;
}

export interface OrganizationSettings {
  orgId: string;
  timeZone: string;
  piiPurgeGraceDays: number;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export async function createOrganizationSettings(
  env: Env,
  actor: Actor,
  input: { timeZone: string; piiPurgeGraceDays: number },
): Promise<OrganizationSettings> {
  assertAdmin(actor);
  await assertCurrentHumanActor(env, actor);
  const timeZone = input.timeZone.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    throw new ValidationError('organization time zone is invalid');
  }
  if (!Number.isInteger(input.piiPurgeGraceDays) || input.piiPurgeGraceDays < 1 || input.piiPurgeGraceDays > 3660) {
    throw new ValidationError('PII purge grace days are invalid');
  }
  const existing = await env.DB.prepare('SELECT org_id FROM organization_settings WHERE org_id = ?')
    .bind(actor.orgId)
    .first<{ org_id: string }>();
  if (existing !== null) {
    throw new ConflictError('organization settings already exist');
  }
  const createdAt = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO organization_settings (
         org_id, time_zone, pii_purge_grace_days, version, created_at, updated_at
       ) VALUES (?, ?, ?, 1, ?, ?)`,
    ).bind(actor.orgId, timeZone, input.piiPurgeGraceDays, createdAt, createdAt),
    env.DB.prepare(
      `INSERT INTO audit_log (
         org_id, actor_id, actor_role, action, target_table, target_id, case_id, detail, created_at
       ) VALUES (?, ?, ?, 'create', 'organization_settings', ?, NULL, ?, ?)`,
    ).bind(
      actor.orgId,
      actor.userId,
      actor.role,
      actor.orgId,
      stringifyJson({ timeZone, piiPurgeGraceDays: input.piiPurgeGraceDays }),
      createdAt,
    ),
  ]);
  return {
    orgId: actor.orgId,
    timeZone,
    piiPurgeGraceDays: input.piiPurgeGraceDays,
    version: 1,
    createdAt,
    updatedAt: createdAt,
  };
}
export interface OrganizationProfile {
  orgId: string;
  orgName: string | null;
  programDisplayName: string | null;
}

/**
 * 사이드바·화면이 되비출 기관·첫 사업 표시 이름 (CCC-32 · 스펙 #78 US 2).
 *
 * **값이 없으면 null** — 화면이 기존 하드코딩 라벨(labels.ts)로 폴백한다. 설정 행 자체가
 * 없어도 에러가 아니라 null 이다: 이 함수는 모든 화면의 셸(사이드바)이 부르므로, 설정
 * 미비가 앱 전체를 잠그면 안 된다.
 *
 * **감사를 남기지 않는다** — 기관 표시 이름은 당사자·케이스 기록이 아니라 화면 설정이다.
 * 모든 페이지 렌더마다 감사 행이 쌓이면 실제 신호(누가 누구의 PII를 봤나)가 묻힌다
 * (getLastProgramType 과 같은 근거 — migrations/0017 주석).
 */
export async function getOrganizationProfile(env: Env, actor: Actor): Promise<OrganizationProfile> {
  assertHuman(actor);
  const row = await env.DB.prepare(
    'SELECT org_name, program_display_name FROM organization_settings WHERE org_id = ?',
  ).bind(actor.orgId).first<DbRow>();
  return {
    orgId: actor.orgId,
    orgName: row === null ? null : nullableString(row.org_name),
    programDisplayName: row === null ? null : nullableString(row.program_display_name),
  };
}

/**
 * 관리자 온보딩 2단계의 저장 (CCC-32 · 스펙 #78 US 1). 조직 이름·첫 사업 표시 이름만
 * 진짜 저장한다 — programs 테이블·사업 전환기 개편은 스펙이 명시적으로 제외했다.
 *
 * 설정 행이 이미 있어야 한다(로컬·미리보기 시드가 만든다 — scripts/seed/preload-data.ts).
 * 없는데 여기서 time_zone 을 지어내 INSERT 하면 0005 의 "no guessed default" 원칙이
 * 깨진다. 다시 실행하면 이름을 덮어쓴다(수정 경로 겸용 — 온보딩 화면 재방문이 409 로
 * 막히지 않는다). 변경은 전건 audit_log 에 남는다(D14).
 */
export async function completeOrganizationOnboarding(
  env: Env,
  actor: Actor,
  input: { orgName: string; programDisplayName: string },
): Promise<OrganizationProfile> {
  assertAdmin(actor);
  await assertCurrentHumanActor(env, actor);
  const orgName = input.orgName.trim();
  if (orgName.length < 1 || orgName.length > 80) {
    throw new ValidationError('organization name is invalid');
  }
  const programDisplayName = input.programDisplayName.trim();
  if (programDisplayName.length < 1 || programDisplayName.length > 120) {
    throw new ValidationError('program display name is invalid');
  }
  await assertOrganizationSettings(env, actor.orgId);
  const updatedAt = now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE organization_settings
       SET org_name = ?, program_display_name = ?, updated_at = ?
       WHERE org_id = ?`,
    ).bind(orgName, programDisplayName, updatedAt, actor.orgId),
    env.DB.prepare(
      `INSERT INTO audit_log (
         org_id, actor_id, actor_role, action, target_table, target_id, case_id, detail, created_at
       ) VALUES (?, ?, ?, 'update', 'organization_settings', ?, NULL, ?, ?)`,
    ).bind(
      actor.orgId,
      actor.userId,
      actor.role,
      actor.orgId,
      stringifyJson({ onboarding: true, orgName, programDisplayName }),
      updatedAt,
    ),
  ]);
  return { orgId: actor.orgId, orgName, programDisplayName };
}

async function assertOrganizationSettings(env: Env, orgId: string): Promise<void> {
  const row = await env.DB.prepare('SELECT org_id FROM organization_settings WHERE org_id = ?')
    .bind(orgId)
    .first<{ org_id: string }>();
  if (row === null) {
    throw new ForbiddenError('organization is unavailable');
  }
}
async function supportCaseReceiptReplay(
  env: Env,
  actor: Actor,
  beneficiaryId: string,
  input: CreateSupportCaseInput,
  payloadHash: string,
): Promise<SupportCaseCreationResult | null> {
  const receipt = await env.DB.prepare(
    `SELECT id, beneficiary_id, creation_payload_hash
     FROM support_cases
     WHERE org_id = ? AND created_by_actor_id = ? AND creation_submission_id = ?
     LIMIT 1`,
  ).bind(actor.orgId, actor.userId, input.submissionId).first<{
    id: string;
    beneficiary_id: string;
    creation_payload_hash: string;
  }>();

  if (receipt === null) return null;

  const supportCase = actor.role === 'counselor'
    ? await assertActiveSupportCaseContext(env, actor, beneficiaryId, receipt.id)
    : await assertSupportCaseAccess(env, actor, receipt.id);
  if (supportCase.beneficiaryId !== beneficiaryId) {
    throw new ForbiddenError('support case is unavailable');
  }
  if (receipt.creation_payload_hash !== payloadHash) {
    throw new ConflictError('submission conflicts with an existing official operation');
  }
  return {
    beneficiaryId,
    supportCaseId: supportCase.id,
    assignmentRole: 'primary',
    replayed: true,
  };
}

/**
 * Creates a permanent participant and its sole initial SupportCase in one D1
 * batch. PII is deliberately absent: the only vault row is an empty versioned
 * container. A failed audit or publication transition rolls the whole batch back.
 *
 * **① 하드 게이트(G1)**: `consent` 를 실은 호출 — 즉 사람이 쓰는 등록 경로 전부 — 는
 * ① 개인정보 수집·이용 동의가 없으면 거부되고, 긴급 등록(사유 필수)만 통과한다.
 * `consent` 없이 부르는 호출은 레거시 Phase-1 호환(`createCase`, 0008 시절 어휘라
 * ① 개념 자체가 없다)과 시드 하네스뿐이며, HTTP 등록 라우트는 언제나 consent 를 싣는다
 * (`parseInitialParticipantCreation`). 그 레거시 경로로 생긴 ① 미기록 케이스는
 * `listPrivacyConsentFollowUps` 의 보완 대상 리포트가 잡는다.
 */
export async function createBeneficiaryWithInitialSupportCase(
  env: Env,
  actor: Actor,
  input: CreateBeneficiaryWithInitialSupportCaseInput,
  legacyCompatibility?: LegacyInitialSupportCaseCompatibility,
  consent?: ParticipantConsentInput,
): Promise<SupportCaseCreationResult> {
  await assertCurrentHumanActor(env, actor);
  const expectedKeys = actor.role === 'admin'
    ? ['programType', 'initialAssigneeUserId']
    : ['programType'];
  // 이름·연락처·이메일은 선택 항목이므로 값이 있을 때만 허용 키에 넣는다(기존 등록 호출은 그대로).
  // intakeAt 도 같은 방식이다(CCC-56) — 등록 라우트는 보내지 않고, 하네스만 값을 실을 수 있다.
  const optionalPiiKeys = (['name', 'phone', 'email', 'birthDate', 'region', 'gender'] as const)
    .filter((key) => input[key] !== undefined);
  const optionalIntakeKeys = input.intakeAt === undefined ? [] : ['intakeAt'];
  assertExactKeys(input, [...expectedKeys, ...optionalIntakeKeys, ...optionalPiiKeys]);
  assertFinancialSupportProgramType(input.programType);
  for (const key of optionalPiiKeys) {
    const value = input[key];
    if (value !== null) assertNonBlankText(value, key);
  }
  if (input.birthDate !== undefined && input.birthDate !== null) assertDateOnly(input.birthDate);
  const intakeAt = legacyCompatibility === undefined
    ? (input.intakeAt === undefined || input.intakeAt === null
      ? null
      : canonicalUtcInstant(input.intakeAt, 'intake time'))
    : legacyCompatibility.intakeAt;
  await assertOrganizationSettings(env, actor.orgId);
  if (intakeAt !== null) {
    canonicalUtcInstant(intakeAt, 'intake time');
  }
  const piiKeyVersion = activePiiKeyVersion(env);
  // 등록 시 받은 이름·연락처·이메일을 금고에 미리 채운다(계좌는 이후 채움). 미제공은 NULL.
  const encName = input.name === undefined || input.name === null
    ? null
    : await encryptPii(env, input.name);
  const encPhone = input.phone === undefined || input.phone === null
    ? null
    : await encryptPii(env, input.phone);
  const encEmail = input.email === undefined || input.email === null
    ? null
    : await encryptPii(env, input.email);
  const encBirthDate = input.birthDate === undefined || input.birthDate === null
    ? null
    : await encryptPii(env, input.birthDate);
  const encRegion = input.region === undefined || input.region === null
    ? null
    : await encryptPii(env, input.region);
  const encGender = input.gender === undefined || input.gender === null
    ? null
    : await encryptPii(env, input.gender);

  const effectiveAssigneeUserId = actor.role === 'counselor'
    ? actor.userId
    : input.initialAssigneeUserId;
  assertOpaqueIdentifier(effectiveAssigneeUserId, 'initial assignee user id');
  await assertActiveHumanUser(env, actor.orgId, effectiveAssigneeUserId);

  // ① 하드 게이트(G1)는 가명 ID 재시도 루프 **밖에서** 한 번만 판정한다 — 입력 결함으로
  // 가명 ID 를 소모하지 않게 한다. 시각만 각 시도의 createdAt 으로 다시 맞춘다.
  const emergencyValidated = consent === undefined
    ? null
    : assertPrivacyConsentGate(consent.privacy === true, consent.emergency, now());

  let finalError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const beneficiaryId = await allocateBeneficiaryId(env, actor.orgId);
    const supportCaseId = newId();
    const legacyCaseId = legacyCompatibility === undefined ? null : beneficiaryId;
    const assignmentId = newId();
    const createdAt = now();
    // 항목별 동의(D15·D23): 동의한 항목만 등록 시각을 남기고, 미동의는 NULL 로 둔다.
    // 등록 폼 동의(consent)가 우선하고, 없으면 레거시 호환 경로의 값(있으면)을 쓴다.
    // D49: ② 는 한 체크로 두 컬럼에 같은 시각을 찍는다.
    const consentRecordingAt = consent?.recordingAi === true
      ? createdAt
      : (legacyCompatibility?.consentRecordingAt ?? null);
    const consentTextAiAt = consent?.recordingAi === true
      ? createdAt
      : (legacyCompatibility?.consentTextAiAt ?? null);
    // D44: 개인정보 동의는 레거시 호환 경로에 대응 입력이 없다 — 등록 폼 값만이 근거다.
    const consentPrivacyAt = consent?.privacy === true ? createdAt : null;
    // 긴급 등록 3값(G1). 일반 등록이면 전부 NULL 이고, DB 가드가 셋의 정합을 강제한다(0028).
    const emergency: EmergencyRegistrationRecord | null = emergencyValidated === null
      ? null
      : { at: createdAt, reason: emergencyValidated.reason, dueAt: emergencyConsentDueAt(createdAt) };
    const consentRecordId = consent === undefined ? null : newId();
    try {
      const statements: D1PreparedStatement[] = [
        env.DB.prepare(
          `INSERT INTO beneficiaries (
             id, org_id, initialization_state, created_at, updated_at
           ) VALUES (?, ?, 'pending', ?, ?)`,
        ).bind(beneficiaryId, actor.orgId, createdAt, createdAt),
        env.DB.prepare(
          `INSERT INTO participant_pii_vault (
             beneficiary_id, org_id, enc_name, enc_phone, enc_email,
             enc_birth_date, enc_region, enc_gender, key_version, version,
             retention_change_kind, retention_changed_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'create', ?, ?, ?)`,
        ).bind(
          beneficiaryId, actor.orgId, encName, encPhone, encEmail,
          encBirthDate, encRegion, encGender, piiKeyVersion, createdAt, createdAt, createdAt,
        ),
        env.DB.prepare(
          `INSERT INTO support_cases (
             id, org_id, beneficiary_id, legacy_case_id, program_type, status, intake_at,
             consent_recording_at, consent_text_ai_at, consent_privacy_at,
             emergency_registration_at, emergency_registration_reason, consent_privacy_due_at,
             creation_kind, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, 'initial', ?, ?)`,
        ).bind(
          supportCaseId,
          actor.orgId,
          beneficiaryId,
          legacyCaseId,
          FINANCIAL_SUPPORT_V1,
          intakeAt,
          consentRecordingAt,
          consentTextAiAt,
          consentPrivacyAt,
          emergency === null ? null : emergency.at,
          emergency === null ? null : emergency.reason,
          emergency === null ? null : emergency.dueAt,
          createdAt,
          createdAt,
        ),
        env.DB.prepare(
          `INSERT INTO support_case_assignees (
             id, org_id, support_case_id, user_id, role, assigned_at
           ) VALUES (?, ?, ?, ?, 'primary', ?)`,
        ).bind(assignmentId, actor.orgId, supportCaseId, effectiveAssigneeUserId, createdAt),
        canonicalAuditStatement(env, actor, {
          action: 'create',
          targetTable: 'beneficiaries',
          targetId: beneficiaryId,
          beneficiaryId,
          supportCaseId: null,
          detail: { schemaVersion: 1 },
          caseId: legacyCaseId,
        }),
        canonicalAuditStatement(env, actor, {
          action: 'create',
          targetTable: 'support_cases',
          targetId: supportCaseId,
          beneficiaryId,
          supportCaseId,
          detail: { programType: FINANCIAL_SUPPORT_V1, schemaVersion: 1 },
          caseId: legacyCaseId,
        }),
        canonicalAuditStatement(env, actor, {
          action: 'assign',
          targetTable: 'support_case_assignees',
          targetId: assignmentId,
          beneficiaryId,
          supportCaseId,
detail: { role: 'primary', initial: true },
          caseId: legacyCaseId,
        }),
        env.DB.prepare(
          `UPDATE beneficiaries
           SET initialization_state = 'complete', updated_at = ?
           WHERE id = ? AND org_id = ? AND initialization_state = 'pending'`,
        ).bind(createdAt, beneficiaryId, actor.orgId),
      ];
      // 당사자 완료 전환(위 UPDATE)의 changes 검사를 위해 인덱스를 고정한다.
      const completionIndex = statements.length - 1;
      // 동의 기록은 반드시 완료 전환 '이후'에 넣는다. beneficiaries_complete_guard 가
      // 그 시점에 당사자 감사 로그를 정확히 3건으로 요구하므로(D15·D23 · 0007), record_consent
      // 감사(4번째 beneficiary_id 행)는 가드 통과 뒤에 쌓여야 한다.
      if (consent !== undefined && consentRecordId !== null) {
        statements.push(
          env.DB.prepare(
            `INSERT INTO participant_consent_records (
               id, org_id, beneficiary_id, support_case_id, consent_recording_at,
               consent_text_ai_at, consent_privacy_at, recorded_by, recorded_at, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            consentRecordId,
            actor.orgId,
            beneficiaryId,
            supportCaseId,
            consentRecordingAt,
            consentTextAiAt,
            consentPrivacyAt,
            actor.userId,
            createdAt,
            createdAt,
          ),
          canonicalAuditStatement(env, actor, {
            action: 'record_consent',
            targetTable: 'participant_consent_records',
            targetId: consentRecordId,
            beneficiaryId,
            supportCaseId,
            // 긴급 등록은 여기서 함께 남긴다(G1 — 전건 감사). 사유는 자유 텍스트라 싣지 않는다(R3 태도).
            detail: {
              privacy: consent.privacy === true,
              recordingAi: consent.recordingAi,
              ...(emergency === null ? {} : { emergencyRegistration: true, consentPrivacyDueAt: emergency.dueAt }),
            },
            caseId: legacyCaseId,
          }),
        );
        // 등록 시점의 ② 체크도 AI 초안 근거 행을 만든다 (ADR-0027) — 정보 페이지에서
        // 다시 저장해야만 근거가 생기는 상태를 남기지 않는다.
        if (consentTextAiAt !== null) {
          const evidenceId = newId();
          statements.push(
            env.DB.prepare(
              `INSERT INTO pilot_text_ai_consent_evidence (
                 id, org_id, support_case_id, notice_version, notice_sha256, evidence_ref,
                 evidence_sha256, captured_by, effective_at, created_at
               ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).bind(
              evidenceId,
              actor.orgId,
              supportCaseId,
              CONSENT_TEXT_AI_NOTICE_VERSION,
              await sha256Hex(CONSENT_TEXT_AI_NOTICE_TEXT),
              `internal://participant-consent-records/${consentRecordId}`,
              await sha256Hex(`${consentRecordId} ${supportCaseId} ${createdAt}`),
              actor.userId,
              consentTextAiAt,
              createdAt,
            ),
            canonicalAuditStatement(env, actor, {
              action: 'create',
              targetTable: 'pilot_text_ai_consent_evidence',
              targetId: evidenceId,
              // 참여 사업 스코프 감사는 당사자 ID 를 함께 요구한다
              // (audit_log_participant_provenance_guard). 이 행은 완료 전환 **이후**에
              // 쌓이므로 beneficiaries_complete_guard 의 '당사자 감사 3건'은 그대로다.
              beneficiaryId,
              supportCaseId,
              detail: { purpose: 'text_ai_consent_wiring', noticeVersion: CONSENT_TEXT_AI_NOTICE_VERSION },
              caseId: legacyCaseId,
            }),
          );
        }
      }
      const results = await env.DB.batch(statements);
      const completion = results[completionIndex] as unknown as { meta?: { changes?: number } };
      if ((completion.meta?.changes ?? 0) < 1) {
        throw new ConflictError('participant initialization did not complete');
      }
      return {
        beneficiaryId,
        supportCaseId,
        assignmentRole: 'primary',
        replayed: false,
      };
    } catch (error) {
      finalError = error;
      if (!isUniqueConstraintError(error)) break;
    }
  }
  throw finalError instanceof Error ? finalError : new ConflictError('participant creation conflicted');
}

/** 동의 2종의 현재 상태 + 마지막 기록 정보 (D44 · 항목 수는 D49). 화면은 이 값으로 체크 상태를 그린다. */
export interface ParticipantConsentState {
  supportCaseId: string;
  privacy: boolean;
  /** ② AI를 활용한 녹취기록 (D49). 구 3종 기록은 두 컬럼 중 하나라도 찍혀 있으면 true 로 읽는다. */
  recordingAi: boolean;
  /** 마지막으로 동의 상태를 기록한 시각. 한 번도 기록한 적 없으면 null. */
  recordedAt: string | null;
}

/**
 * 당사자 정보 페이지에서 동의 3종을 고친다 (D44 · 2026-07-29 Q 결정).
 *
 * **권한**: 이 참여 사업의 담당 실무자 또는 기관 관리자만 — 등록과 같은 층이다.
 * `assertSupportCaseAccess` 하나가 그 판정을 전부 한다(R1). 담당하지 않는 실무자는
 * 허브에서 그 사업 카드를 보더라도(D36) 여기서 막힌다 — 표시 범위가 쓰기 권한이 되면 안 된다.
 *
 * **이력**: 현재값은 `support_cases` 를 UPDATE 하지만, 그 행위는 언제나
 * `participant_consent_records` 에 **새 행**으로 쌓인다(append-only, D14·D23). 철회(체크 해제)도
 * 마찬가지다 — 시각을 NULL 로 되돌린 행이 남으므로 "언제 동의했고 언제 철회했나"가 보존된다.
 * 행을 고쳐 이력을 지우는 경로는 DB 트리거가 막는다.
 *
 * **알려진 결과**: 0008·0014 의 insert 가드가 "NULL 이 아닌 동의 시각 = recorded_at" 을
 * 요구하므로 한 행은 언제나 **그 시점의 전체 스냅샷**이다. 따라서 3종 중 하나만 고쳐도
 * 나머지 동의 시각이 이번 기록 시각으로 갱신된다. 화면은 이 값을 "최초 동의일"이 아니라
 * "마지막 기록 시각"으로 읽어야 한다.
 */
export async function updateParticipantConsent(
  env: Env,
  actor: Actor,
  supportCaseId: string,
  consent: ParticipantConsentInput & { privacy: boolean },
): Promise<ParticipantConsentState> {
  assertOpaqueIdentifier(supportCaseId, 'support case id');
  assertExactKeys(consent, ['privacy', 'recordingAi']);
  for (const key of ['privacy', 'recordingAi'] as const) {
    if (typeof consent[key] !== 'boolean') throw new ValidationError('consent is invalid');
  }
  const supportCase = await assertSupportCaseAccess(env, actor, supportCaseId);
  await assertCurrentHumanActor(env, actor);

  const recordedAt = now();
  const privacyAt = consent.privacy ? recordedAt : null;
  // D49: ② 한 체크 → 두 컬럼에 같은 시각(또는 둘 다 NULL 로 철회).
  const recordingAt = consent.recordingAi ? recordedAt : null;
  const textAiAt = consent.recordingAi ? recordedAt : null;
  const consentRecordId = newId();

  // ② 체크는 AI 초안 저장의 근거 행도 만든다 (ADR-0027). 이 행이 없으면 동의를 다
  // 받은 케이스에서도 0026 트리거가 초안을 거부한다 — 화면과 파이프라인이 서로
  // 모르던 자리를 여기서 잇는다. 파일럿 스위치는 **사용**을 막을 뿐이므로, 근거는
  // 스위치 상태와 무관하게 남긴다. 철회(②=false)는 새 근거를 만들지 않는다 —
  // 근거 표는 append-only 라, 사용 차단은 `support_cases.consent_text_ai_at` 이 맡는다.
  const textAiEvidence = consent.recordingAi
    ? {
      id: newId(),
      noticeSha256: await sha256Hex(CONSENT_TEXT_AI_NOTICE_TEXT),
      evidenceRef: `internal://participant-consent-records/${consentRecordId}`,
      evidenceSha256: await sha256Hex(`${consentRecordId} ${supportCaseId} ${recordedAt}`),
    }
    : null;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE support_cases
       SET consent_privacy_at = ?, consent_recording_at = ?, consent_text_ai_at = ?, updated_at = ?
       WHERE id = ? AND org_id = ?`,
    ).bind(privacyAt, recordingAt, textAiAt, recordedAt, supportCaseId, actor.orgId),
    env.DB.prepare(
      `INSERT INTO participant_consent_records (
         id, org_id, beneficiary_id, support_case_id, consent_recording_at,
         consent_text_ai_at, consent_privacy_at, recorded_by, recorded_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      consentRecordId,
      actor.orgId,
      supportCase.beneficiaryId,
      supportCaseId,
      recordingAt,
      textAiAt,
      privacyAt,
      actor.userId,
      recordedAt,
      recordedAt,
    ),
    canonicalAuditStatement(env, actor, {
      action: 'record_consent',
      targetTable: 'participant_consent_records',
      targetId: consentRecordId,
      beneficiaryId: supportCase.beneficiaryId,
      supportCaseId,
      // 동의 **여부**만 남긴다 — 동의 문안·PII 는 감사 detail 에 넣지 않는다(R3).
      detail: { privacy: consent.privacy, recordingAi: consent.recordingAi, kind: 'update' },
      caseId: supportCase.legacyCaseId,
    }),
    ...(textAiEvidence === null ? [] : [
      env.DB.prepare(
        `INSERT INTO pilot_text_ai_consent_evidence (
           id, org_id, support_case_id, notice_version, notice_sha256, evidence_ref,
           evidence_sha256, captured_by, effective_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        textAiEvidence.id,
        actor.orgId,
        supportCaseId,
        CONSENT_TEXT_AI_NOTICE_VERSION,
        textAiEvidence.noticeSha256,
        textAiEvidence.evidenceRef,
        textAiEvidence.evidenceSha256,
        actor.userId,
        recordedAt,
        recordedAt,
      ),
      canonicalAuditStatement(env, actor, {
        action: 'create',
        targetTable: 'pilot_text_ai_consent_evidence',
        targetId: textAiEvidence.id,
        beneficiaryId: supportCase.beneficiaryId,
        supportCaseId,
        detail: { purpose: 'text_ai_consent_wiring', noticeVersion: CONSENT_TEXT_AI_NOTICE_VERSION },
        caseId: supportCase.legacyCaseId,
      }),
    ]),
  ]);

  return {
    supportCaseId,
    privacy: consent.privacy,
    recordingAi: consent.recordingAi,
    recordedAt,
  };
}

/** ① 동의 보완 대상 1건 (G1 완료 기준). PII 는 담지 않는다 — 가명 ID·사업·기한만이다(R3). */
export interface PrivacyConsentFollowUp {
  supportCaseId: string;
  beneficiaryId: string;
  programType: string;
  status: string;
  /** 긴급 등록으로 열린 케이스면 그 시각, 아니면 null(레거시·구 경로로 ① 이 비어 있는 케이스). */
  emergencyRegistrationAt: string | null;
  /** 보완 기한. 긴급 등록 건에만 있다. */
  consentPrivacyDueAt: string | null;
  /** 기한이 지났는가. 기한이 없으면 false. */
  overdue: boolean;
}

/**
 * ① 개인정보 동의가 기록되지 않은 참여 사업 목록 — **보완 대상 리포트** (G1 완료 기준).
 *
 * 두 부류가 함께 나온다: ① 긴급 등록으로 열려 보완 기한이 걸린 케이스(기한 임박·경과 순),
 * ② 하드 게이트 이전에 만들어졌거나 레거시 호환 경로(`createCase`)로 생긴 ① 미기록 케이스.
 * **기존 데이터를 고치지 않는다** — 목록화만 한다(게이트 문서 §2 G1 "마이그레이션 대상 아님").
 *
 * 범위는 다른 목록과 같다(D7): 실무자는 자신이 담당인 케이스, 기관 관리자는 기관 전체.
 * **활성 케이스만** 낸다 — 종결된 케이스는 보완할 상담이 남아 있지 않아 이 작업 큐에
 * 영원히 쌓이기만 한다(종결분 점검이 필요해지면 별도 조회로 뽑는다). 조회 감사는 목록 단위 1건(D14).
 */
export async function listPrivacyConsentFollowUps(
  env: Env,
  actor: Actor,
): Promise<PrivacyConsentFollowUp[]> {
  assertHuman(actor);
  await assertCurrentHumanActor(env, actor);
  const sql = actor.role === 'admin'
    ? `SELECT support_cases.id, support_cases.beneficiary_id, support_cases.program_type,
              support_cases.status, support_cases.emergency_registration_at,
              support_cases.consent_privacy_due_at
       FROM support_cases
       WHERE support_cases.org_id = ? AND support_cases.consent_privacy_at IS NULL
         AND support_cases.status = 'active'
       ORDER BY support_cases.consent_privacy_due_at IS NULL,
                support_cases.consent_privacy_due_at, support_cases.id`
    : `SELECT support_cases.id, support_cases.beneficiary_id, support_cases.program_type,
              support_cases.status, support_cases.emergency_registration_at,
              support_cases.consent_privacy_due_at
       FROM support_cases
       JOIN support_case_assignees ON support_case_assignees.support_case_id = support_cases.id
         AND support_case_assignees.org_id = support_cases.org_id
         AND support_case_assignees.user_id = ?
         AND support_case_assignees.unassigned_at IS NULL
       WHERE support_cases.org_id = ? AND support_cases.consent_privacy_at IS NULL
         AND support_cases.status = 'active'
       ORDER BY support_cases.consent_privacy_due_at IS NULL,
                support_cases.consent_privacy_due_at, support_cases.id`;
  const bindings = actor.role === 'admin' ? [actor.orgId] : [actor.userId, actor.orgId];
  const result = await env.DB.prepare(sql).bind(...bindings).all<DbRow>();
  await writeCanonicalAudit(env, actor, {
    action: 'read',
    targetTable: 'support_cases',
    detail: { list: 'privacy_consent_follow_up', resultCount: result.results.length },
  });
  const nowInstant = now();
  return result.results.map((row) => {
    const dueAt = nullableString(row.consent_privacy_due_at);
    return {
      supportCaseId: stringValue(row.id),
      beneficiaryId: stringValue(row.beneficiary_id),
      programType: stringValue(row.program_type),
      status: stringValue(row.status),
      emergencyRegistrationAt: nullableString(row.emergency_registration_at),
      consentPrivacyDueAt: dueAt,
      overdue: dueAt !== null && dueAt < nowInstant,
    };
  });
}

/** 기한 도래 며칠 전부터 "임박"으로 셀지 (G1 알림). 기한 자체(14일)와 달리 알림 시점 값이다. */
export const EMERGENCY_CONSENT_REMINDER_DAYS = 3;

/** 기관별 긴급 등록 보완 현황 집계 (G1 알림). 건수만 담는다 — 케이스·PII 는 담지 않는다(R3). */
export interface EmergencyConsentDeadlineSummary {
  orgId: string;
  /** 기한이 임박한(EMERGENCY_CONSENT_REMINDER_DAYS 이내) 미보완 건수. */
  dueSoon: number;
  /** 기한이 지난 미보완 건수. */
  overdue: number;
}

/**
 * 긴급 등록의 ① 동의 보완 기한 현황 (G1 "만료 전 담당 실무자 알림"). 워치독(cron)이
 * 부르는 읽기 전용 집계라 행위자를 받지 않는다 — `runPipelineWatchdog` 와 같은 자리다.
 * 알림 본문에 실릴 값이므로 기관 ID·건수만 낸다(notify.ts 계약: PII·케이스 내용 금지).
 */
export async function listEmergencyConsentDeadlines(env: Env): Promise<EmergencyConsentDeadlineSummary[]> {
  const nowInstant = now();
  const soonInstant = new Date(Date.parse(nowInstant) + EMERGENCY_CONSENT_REMINDER_DAYS * 86_400_000).toISOString();
  const result = await env.DB.prepare(
    `SELECT org_id,
            SUM(CASE WHEN consent_privacy_due_at < ? THEN 1 ELSE 0 END) AS overdue,
            SUM(CASE WHEN consent_privacy_due_at >= ? AND consent_privacy_due_at <= ? THEN 1 ELSE 0 END) AS due_soon
     FROM support_cases
     WHERE consent_privacy_at IS NULL
       AND consent_privacy_due_at IS NOT NULL
       AND status = 'active'
     GROUP BY org_id
     ORDER BY org_id`,
  ).bind(nowInstant, nowInstant, soonInstant).all<DbRow>();
  return result.results
    .map((row) => ({
      orgId: stringValue(row.org_id),
      dueSoon: Number(row.due_soon ?? 0),
      overdue: Number(row.overdue ?? 0),
    }))
    .filter((summary) => summary.dueSoon > 0 || summary.overdue > 0);
}

const MAX_OVERALL_GOAL_LENGTH = 200;

/**
 * 전체 목표 그 자리 입력·수정 (D45 · CCC-41). 케이스당 1개·수정 가능·점수 없음(D33)이라
 * goals 테이블(세부 목표, title 수정 금지)이 아니라 support_cases.overall_goal 을 쓴다.
 *
 * 권한은 **담당 실무자만**(ADR-0018 — 불일치 처리의 '담당 실무자·기관 관리자'보다 좁다).
 * counselor 는 assertSupportCaseAccess 가 활성 배정을 강제하고, admin 은 여기서 거른다.
 * null 또는 빈 문자열은 "지운다"(설정 전으로 되돌림). 변경 전건 감사(D14) — 목표 문장은
 * 자유 텍스트라 감사 detail 에 싣지 않는다(R3 태도, 동의 기록과 같은 원칙).
 */
export async function setSupportCaseOverallGoal(
  env: Env,
  actor: Actor,
  supportCaseId: string,
  overallGoal: string | null,
): Promise<{ supportCaseId: string; overallGoal: string | null }> {
  assertOpaqueIdentifier(supportCaseId, 'support case id');
  if (overallGoal !== null && typeof overallGoal !== 'string') {
    throw new ValidationError('overall goal is invalid');
  }
  const normalized = overallGoal === null ? null : overallGoal.trim();
  const nextGoal = normalized === null || normalized.length === 0 ? null : normalized;
  if (nextGoal !== null && nextGoal.length > MAX_OVERALL_GOAL_LENGTH) {
    throw new ValidationError(`overall goal must be at most ${MAX_OVERALL_GOAL_LENGTH} characters`);
  }
  const supportCase = await assertSupportCaseAccess(env, actor, supportCaseId);
  // D45 는 '담당 실무자만' 이었으나 2026-07-30 Q 결정으로 기관 관리자도 수정한다
  // (ADR-0018 개정). 담당 실무자는 assertSupportCaseAccess 가 활성 배정을 이미
  // 강제했고, admin 은 같은 함수가 기관 범위로 통과시킨다 — 여기서는 역할만 본다.
  if (actor.role !== 'counselor' && actor.role !== 'admin') {
    throw new ForbiddenError('only an assigned counselor or an org admin can edit the overall goal');
  }
  if (supportCase.status !== 'active') {
    throw new ValidationError('overall goal can only be edited on an active support case');
  }

  const updatedAt = now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE support_cases SET overall_goal = ?, updated_at = ?
       WHERE id = ? AND org_id = ?`,
    ).bind(nextGoal, updatedAt, supportCaseId, actor.orgId),
    canonicalAuditStatement(env, actor, {
      action: 'update',
      targetTable: 'support_cases',
      targetId: supportCaseId,
      beneficiaryId: supportCase.beneficiaryId,
      supportCaseId,
      detail: { field: 'overall_goal', cleared: nextGoal === null },
      caseId: supportCase.legacyCaseId,
    }),
  ]);
  return { supportCaseId, overallGoal: nextGoal };
}

/**
 * Strict v1 subsequent-participation command. The receipt hash covers all
 * server-derived authority inputs, while the submission id remains only the
 * actor-scoped durable receipt key.
 */
export async function createSupportCase(
  env: Env,
  actor: Actor,
  beneficiaryId: string,
  input: CreateSupportCaseInput,
): Promise<SupportCaseCreationResult> {
  await assertCurrentHumanActor(env, actor);
  assertBeneficiaryId(beneficiaryId);
  const baseKeys = actor.role === 'counselor'
    ? ['schemaVersion', 'submissionId', 'programType', 'sourceSupportCaseId']
    : ['schemaVersion', 'submissionId', 'programType', 'initialAssigneeUserId'];
  // ① 은 필수 키다(G1). 긴급 사유는 값이 있을 때만 허용 키에 넣는다(등록 경로의 선택 PII 와 같은 방식).
  // intakeAt 도 값이 있을 때만 허용한다(CCC-56, 하네스 전용 — HTTP 라우트는 키를 거부한다).
  const expectedKeys = [
    ...baseKeys,
    ...(input.intakeAt === undefined ? [] : ['intakeAt']),
    'consentPrivacy',
    // ② 는 선택이라 값이 있을 때만 허용 키에 넣는다(긴급 사유와 같은 방식).
    ...(input.consentRecordingAi === undefined ? [] : ['consentRecordingAi']),
    ...(input.emergencyReason === undefined ? [] : ['emergencyReason']),
  ];
  assertExactKeys(input, expectedKeys);
  if (typeof input.consentPrivacy !== 'boolean') throw new ValidationError('consent is invalid');
  if (input.consentRecordingAi !== undefined && typeof input.consentRecordingAi !== 'boolean') {
    throw new ValidationError('consent is invalid');
  }
  if (input.schemaVersion !== 1) throw new ValidationError('schema version is invalid');
  assertCanonicalSubmissionId(input.submissionId);
  assertFinancialSupportProgramType(input.programType);
  const intakeAt = input.intakeAt === undefined || input.intakeAt === null
    ? null
    : canonicalUtcInstant(input.intakeAt, 'intake time');
  await assertOrganizationSettings(env, actor.orgId);

  let sourceSupportCaseId: string | null = null;
  let effectiveAssigneeUserId: string;
  if (actor.role === 'counselor') {
    assertOpaqueIdentifier(input.sourceSupportCaseId, 'source support case id');
    sourceSupportCaseId = input.sourceSupportCaseId;
    await assertActiveSupportCaseContext(env, actor, beneficiaryId, sourceSupportCaseId);
    effectiveAssigneeUserId = actor.userId;
  } else {
    effectiveAssigneeUserId = input.initialAssigneeUserId as string;
    assertOpaqueIdentifier(effectiveAssigneeUserId, 'initial assignee user id');
    await getBeneficiaryForOrg(env, actor.orgId, beneficiaryId, { completeOnly: true });
    await assertActiveHumanUser(env, actor.orgId, effectiveAssigneeUserId);
  }

  // ① 하드 게이트(G1). 영수증 해시 이전에 판정한다 — 동의 없는 요청이 재생(replay)으로
  // 통과하면 안 된다. 해시에도 동의·긴급 여부를 넣어, 같은 제출 id 로 조건만 바꾼 재시도는
  // 조용한 재생이 아니라 409 가 되게 한다.
  const createdAt = now();
  const emergency = assertPrivacyConsentGate(
    input.consentPrivacy === true,
    input.emergencyReason === undefined ? undefined : { reason: input.emergencyReason },
    createdAt,
  );

  const payloadHash = await canonicalSha256({
    actorId: actor.userId,
    beneficiaryId,
    consentPrivacy: input.consentPrivacy === true,
    // D49: 같은 제출 id 로 동의만 바꾼 재시도가 조용한 재생으로 통과하면 안 된다.
    consentRecordingAi: input.consentRecordingAi === true,
    creatorRole: actor.role,
    effectiveAssigneeUserId,
    emergencyRegistration: emergency !== null,
    intakeAt,
    orgId: actor.orgId,
    programType: FINANCIAL_SUPPORT_V1,
    schemaVersion: 1,
    sourceSupportCaseId,
  });

  const replay = await supportCaseReceiptReplay(env, actor, beneficiaryId, input, payloadHash);
  if (replay !== null) return replay;

  const supportCaseId = newId();
  const assignmentId = newId();
  const consentRecordId = newId();
  const consentPrivacyAt = input.consentPrivacy === true ? createdAt : null;
  // D49: ② 한 체크 → 두 컬럼에 같은 시각(insert 가드 정합).
  const consentRecordingAiAt = input.consentRecordingAi === true ? createdAt : null;
  const creationBoundary = actor.role === 'counselor'
    ? {
      sql: `EXISTS (
        SELECT 1 FROM beneficiaries
        WHERE id = ? AND org_id = ? AND initialization_state = 'complete'
      )
      AND EXISTS (
        SELECT 1
        FROM support_cases AS source_case
        JOIN support_case_assignees AS assignment
          ON assignment.support_case_id = source_case.id
         AND assignment.org_id = source_case.org_id
        JOIN users AS assigned_user
          ON assigned_user.id = assignment.user_id
         AND assigned_user.org_id = source_case.org_id
        WHERE source_case.id = ?
          AND source_case.org_id = ?
          AND source_case.beneficiary_id = ?
          AND source_case.status = 'active'
          AND assignment.user_id = ?
          AND assignment.unassigned_at IS NULL
          AND assigned_user.active = 1
          AND assigned_user.role = 'counselor'
      )`,
      bindings: [
        beneficiaryId,
        actor.orgId,
        sourceSupportCaseId,
        actor.orgId,
        beneficiaryId,
        actor.userId,
      ],
    }
    : {
      sql: `EXISTS (
        SELECT 1 FROM beneficiaries
        WHERE id = ? AND org_id = ? AND initialization_state = 'complete'
      )
      AND EXISTS (
        SELECT 1 FROM users
        WHERE id = ? AND org_id = ? AND active = 1
          AND role IN ('admin', 'counselor')
      )`,
      bindings: [beneficiaryId, actor.orgId, effectiveAssigneeUserId, actor.orgId],
    };
  try {
    const results = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO support_cases (
           id, org_id, beneficiary_id, program_type, status, intake_at, creation_kind,
           creation_submission_id, creation_payload_hash, created_by_actor_id,
           source_support_case_id, initial_assignee_user_id,
           consent_privacy_at, consent_recording_at, consent_text_ai_at,
           emergency_registration_at, emergency_registration_reason,
           consent_privacy_due_at, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, 'active', ?, 'subsequent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE ${creationBoundary.sql}`,
      ).bind(
        supportCaseId,
        actor.orgId,
        beneficiaryId,
        FINANCIAL_SUPPORT_V1,
        intakeAt,
        input.submissionId,
        payloadHash,
        actor.userId,
        sourceSupportCaseId,
        effectiveAssigneeUserId,
        consentPrivacyAt,
        consentRecordingAiAt,
        consentRecordingAiAt,
        emergency === null ? null : emergency.at,
        emergency === null ? null : emergency.reason,
        emergency === null ? null : emergency.dueAt,
        createdAt,
        createdAt,
        ...creationBoundary.bindings,
      ),
      conditionalCanonicalAuditStatement(env, actor, {
        action: 'create',
        targetTable: 'support_cases',
        targetId: supportCaseId,
        beneficiaryId,
        supportCaseId,
        detail: { programType: FINANCIAL_SUPPORT_V1, schemaVersion: 1 },
      }),
      env.DB.prepare(
        `INSERT INTO support_case_assignees (
           id, org_id, support_case_id, user_id, role, assigned_at
         )
         SELECT ?, ?, ?, ?, 'primary', ?
         WHERE EXISTS (
           SELECT 1 FROM support_cases
           WHERE id = ? AND org_id = ? AND beneficiary_id = ?
         )`,
      ).bind(
        assignmentId,
        actor.orgId,
        supportCaseId,
        effectiveAssigneeUserId,
        createdAt,
        supportCaseId,
        actor.orgId,
        beneficiaryId,
      ),
      conditionalCanonicalAuditStatement(env, actor, {
        action: 'assign',
        targetTable: 'support_case_assignees',
        targetId: assignmentId,
        beneficiaryId,
        supportCaseId,
        detail: { role: 'primary', initial: true },
      }),
      // ① 동의(또는 긴급 등록)의 이력 행 (D44 · G1). 케이스 생성이 경계에서 거부되면
      // WHERE EXISTS 가 이 행도 함께 없앤다 — 고아 동의 기록을 남기지 않는다.
      // ② 는 이 요청에서 받은 값이다(D49) — 두 번째 사업은 앞 사업의 동의를 물려받지 않고,
      // 보내지 않으면 미동의(NULL)로 시작한다.
      env.DB.prepare(
        `INSERT INTO participant_consent_records (
           id, org_id, beneficiary_id, support_case_id, consent_recording_at,
           consent_text_ai_at, consent_privacy_at, recorded_by, recorded_at, created_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         WHERE EXISTS (
           SELECT 1 FROM support_cases
           WHERE id = ? AND org_id = ? AND beneficiary_id = ?
         )`,
      ).bind(
        consentRecordId,
        actor.orgId,
        beneficiaryId,
        supportCaseId,
        consentRecordingAiAt,
        consentRecordingAiAt,
        consentPrivacyAt,
        actor.userId,
        createdAt,
        createdAt,
        supportCaseId,
        actor.orgId,
        beneficiaryId,
      ),
      conditionalCanonicalAuditStatement(env, actor, {
        action: 'record_consent',
        targetTable: 'participant_consent_records',
        targetId: consentRecordId,
        beneficiaryId,
        supportCaseId,
        // 사유 텍스트는 싣지 않는다(R3 태도) — 긴급 여부와 보완 기한만 남긴다.
        detail: {
          privacy: input.consentPrivacy === true,
          recordingAi: input.consentRecordingAi === true,
          ...(emergency === null ? {} : { emergencyRegistration: true, consentPrivacyDueAt: emergency.dueAt }),
        },
      }),
    ]);
    const creation = results[0] as unknown as { meta?: { changes?: number } };
    if ((creation.meta?.changes ?? 0) < 1) {
      throw new ConflictError('support case is unavailable');
    }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const matched = await supportCaseReceiptReplay(env, actor, beneficiaryId, input, payloadHash);
    if (matched !== null) return matched;
    throw error;
  }

  return {
    beneficiaryId,
    supportCaseId,
    assignmentRole: 'primary',
    replayed: false,
  };
}

/** Lists only the SupportCase ids already authorized for this actor. */
export async function listAuthorizedSupportCaseIdsForBeneficiary(
  env: Env,
  actor: Actor,
  beneficiaryId: string,
): Promise<string[]> {
  assertBeneficiaryId(beneficiaryId);
  await assertCurrentHumanActor(env, actor);
  const result = actor.role === 'admin'
    ? await env.DB.prepare(
      `SELECT support_cases.id
       FROM support_cases
       JOIN beneficiaries ON beneficiaries.id = support_cases.beneficiary_id
         AND beneficiaries.org_id = support_cases.org_id
       WHERE support_cases.org_id = ? AND support_cases.beneficiary_id = ?
         AND beneficiaries.initialization_state = 'complete'
       ORDER BY CASE support_cases.status WHEN 'active' THEN 0 ELSE 1 END,
                support_cases.program_type, support_cases.id`,
    ).bind(actor.orgId, beneficiaryId).all<{ id: string }>()
    : await env.DB.prepare(
      `SELECT support_cases.id
       FROM support_cases
       JOIN beneficiaries ON beneficiaries.id = support_cases.beneficiary_id
         AND beneficiaries.org_id = support_cases.org_id
       JOIN support_case_assignees ON support_case_assignees.support_case_id = support_cases.id
       WHERE support_cases.org_id = ? AND support_cases.beneficiary_id = ?
         AND beneficiaries.initialization_state = 'complete'
         AND support_case_assignees.org_id = ?
         AND support_case_assignees.user_id = ?
         AND support_case_assignees.unassigned_at IS NULL
       ORDER BY CASE support_cases.status WHEN 'active' THEN 0 ELSE 1 END,
                support_cases.program_type, support_cases.id`,
    ).bind(actor.orgId, beneficiaryId, actor.orgId, actor.userId).all<{ id: string }>();

  return result.results.map((row) => stringValue(row.id));
}

/**
 * 당사자 정보 페이지(허브)가 보여주는 참여 사업 한 건 (D36 · ADR-0014 '개정' 1번).
 * `authorized` 가 false 면 **내가 담당하지 않는 사업**이다 — 존재와 담당 실무자 이름까지만
 * 보이고 상담 내용(브리핑·기록·목표)으로는 들어갈 수 없다.
 */
export interface ParticipantProgramEntry {
  supportCase: SupportCase;
  /** 내가 담당(또는 admin)인가. 화면은 이 값으로 링크를 걸거나 잠근다. */
  authorized: boolean;
  /** 활성 담당 실무자 표시 이름(미입력이면 이메일). 비담당 사업에서 "누구에게 물어보나"를 답한다. */
  assigneeNames: string[];
  /**
   * 마지막으로 동의 상태를 기록한 시각 (D44). **동의 시각이 아니라 기록 시각이다** —
   * 3종을 모두 철회하면 동의 시각은 전부 NULL 이 되지만 "언제 그렇게 기록했나"는 남아야
   * 하므로, 값은 append-only 이력(`participant_consent_records.recorded_at`)에서 읽는다.
   */
  consentRecordedAt: string | null;
  /**
   * 이 사업의 가장 이른 예정(scheduled) 일정 — 허브의 '최신 일정' 카드가 쓴다(2026-08-06 Q).
   * **담당(또는 admin)인 사업에만 싣는다** — D36 은 비담당 사업의 존재·담당 실무자까지만
   * 열었고, 일정은 상담 내용 쪽이다. 브리핑의 focusUpcomingSchedule 과 같은 판정
   * (status='scheduled' 최조기 1건)이다.
   */
  upcomingSchedule: { id: string; scheduledAt: string; sessionKind: CounselingScheduleKind } | null;
}

export interface ParticipantProgramList {
  participant: ParticipantNameContact;
  programs: ParticipantProgramEntry[];
}

/**
 * 한 당사자의 기관 내 활성 담당 실무자 표시 이름을 사업별로 모은다.
 *
 * **이메일로 폴백하지 않는다.** 다른 화면(관리자 디렉터리)은 이름 미입력 시 이메일을
 * 보여주지만, 이 목록은 D36 으로 **담당하지 않는 사업**까지 실무자에게 내려간다 —
 * 이메일 폴백을 두면 `listUsers`(admin 전용)로 막아 둔 직원 이메일이 실무자에게 새는,
 * 어떤 결정도 승인하지 않은 공개가 된다. 이름이 없으면 그 담당 실무자는 목록에서 빠지고
 * 화면은 담당 줄을 그리지 않는다.
 *
 * 직원 이름은 당사자 PII 금고 대상이 아니라 복호화가 필요 없다(D31).
 */
async function loadAssigneeNamesBySupportCase(
  env: Env,
  orgId: string,
  supportCaseIds: string[],
): Promise<Map<string, string[]>> {
  const names = new Map<string, string[]>();
  if (supportCaseIds.length === 0) return names;
  const placeholders = supportCaseIds.map(() => '?').join(', ');
  const result = await env.DB.prepare(
    `SELECT assignment.support_case_id AS support_case_id,
            NULLIF(TRIM(users.name), '') AS display_name
     FROM support_case_assignees AS assignment
     JOIN users ON users.id = assignment.user_id AND users.org_id = assignment.org_id
     WHERE assignment.org_id = ?
       AND assignment.support_case_id IN (${placeholders})
       AND assignment.unassigned_at IS NULL
     ORDER BY assignment.assigned_at`,
  ).bind(orgId, ...supportCaseIds).all<DbRow>();
  for (const row of result.results) {
    const name = nullableString(row.display_name);
    if (name === null) continue;
    const caseId = stringValue(row.support_case_id);
    const existing = names.get(caseId);
    if (existing === undefined) names.set(caseId, [name]);
    else if (!existing.includes(name)) existing.push(name);
  }
  return names;
}

export async function listSupportCasesForBeneficiary(
  env: Env,
  actor: Actor,
  beneficiaryId: string,
): Promise<ParticipantProgramList> {
  // **집합이 둘이다 — 섞으면 안 된다** (D36 · ADR-0014 '개정' 1번).
  //  ① 접근 판정용: 내가 담당(또는 admin)인 사업. **1건도 없으면 페이지 자체가 안 열린다.**
  //  ② 표시용: 그 당사자의 기관 내 전 사업. 비담당 사업은 존재와 담당 실무자 이름까지만 보인다.
  //
  // ①의 게이트를 지우면 D36의 근거("이 페이지를 여는 사람은 이미 그 당사자의 담당 실무자라
  // PII를 보고 있다")가 무너진다 — 표시 범위를 넓히면서 같이 지우기 쉬우니 주의한다.
  const authorizedIds = await listAuthorizedSupportCaseIdsForBeneficiary(env, actor, beneficiaryId);
  if (authorizedIds.length === 0) {
    throw new ForbiddenError('participant is unavailable');
  }
  const authorized = new Set(authorizedIds);
  const result = await env.DB.prepare(
    `SELECT support_cases.* FROM support_cases
     JOIN beneficiaries ON beneficiaries.id = support_cases.beneficiary_id
       AND beneficiaries.org_id = support_cases.org_id
     WHERE support_cases.org_id = ? AND support_cases.beneficiary_id = ?
       AND beneficiaries.initialization_state = 'complete'
     ORDER BY CASE support_cases.status WHEN 'active' THEN 0 ELSE 1 END,
              support_cases.program_type, support_cases.id`,
  ).bind(actor.orgId, beneficiaryId).all<DbRow>();
  await writeCanonicalAudit(env, actor, {
    action: 'read',
    targetTable: 'beneficiaries',
    targetId: beneficiaryId,
    beneficiaryId,
  });
  // 실명·연락처는 ①을 통과했으므로 내려도 된다(D24·D31). 값이 있으면 화면 단위 감사 1건.
  const contacts = await loadParticipantContacts(env, actor.orgId, [beneficiaryId]);
  await auditParticipantPiiRead(env, actor, contacts, { targetId: beneficiaryId });
  const supportCases = result.results.map(mapSupportCase);
  const assigneeNames = await loadAssigneeNamesBySupportCase(
    env,
    actor.orgId,
    supportCases.map((supportCase) => supportCase.id),
  );
  const consentRecordedAt = await loadLastConsentRecordedAt(env, actor.orgId, beneficiaryId);
  const upcomingSchedules = await loadUpcomingScheduleBySupportCase(env, actor.orgId, authorizedIds);
  return {
    participant: participantNamePhone(contacts.get(beneficiaryId)),
    programs: supportCases.map((supportCase) => ({
      supportCase,
      authorized: authorized.has(supportCase.id),
      assigneeNames: assigneeNames.get(supportCase.id) ?? [],
      consentRecordedAt: consentRecordedAt.get(supportCase.id) ?? null,
      // 비담당 사업은 조회 자체를 안 했으므로 자연히 null 이다(D36 범위 유지).
      upcomingSchedule: upcomingSchedules.get(supportCase.id) ?? null,
    })),
  };
}

/**
 * 사업별 가장 이른 예정(scheduled) 일정 (허브 '최신 일정' 카드, 2026-08-06 Q).
 * 브리핑의 focusUpcomingSchedule 과 같은 판정을 여러 케이스에 한 번에 낸다 — 감사·권한이
 * 없는 내부 로더이고, 호출부(listSupportCasesForBeneficiary)가 담당 케이스 id 만 넘긴다.
 */
async function loadUpcomingScheduleBySupportCase(
  env: Env,
  orgId: string,
  supportCaseIds: string[],
): Promise<Map<string, { id: string; scheduledAt: string; sessionKind: CounselingScheduleKind }>> {
  const upcoming = new Map<string, { id: string; scheduledAt: string; sessionKind: CounselingScheduleKind }>();
  if (supportCaseIds.length === 0) return upcoming;
  const placeholders = supportCaseIds.map(() => '?').join(', ');
  const result = await env.DB.prepare(
    `SELECT id, support_case_id, scheduled_at, session_kind FROM counseling_schedules
     WHERE org_id = ? AND support_case_id IN (${placeholders}) AND status = 'scheduled'
     ORDER BY scheduled_at, id`,
  ).bind(orgId, ...supportCaseIds).all<DbRow>();
  for (const row of result.results) {
    const caseId = stringValue(row.support_case_id);
    if (upcoming.has(caseId)) continue;
    upcoming.set(caseId, {
      id: stringValue(row.id),
      scheduledAt: stringValue(row.scheduled_at),
      sessionKind: canonicalScheduleKind(row.session_kind),
    });
  }
  return upcoming;
}

/**
 * 참여 사업별 마지막 동의 기록 시각 (D44). 동의 시각이 아니라 **기록 시각**을 읽는다 —
 * 3종을 모두 철회하면 동의 시각은 전부 NULL 이 되므로, 동의 시각에서 역산하면 방금 남긴
 * 철회 기록이 화면에서 "기록 없음"으로 보인다. 이력 표는 append-only 라 MAX 가 곧 최신이다.
 */
async function loadLastConsentRecordedAt(
  env: Env,
  orgId: string,
  beneficiaryId: string,
): Promise<Map<string, string>> {
  const recorded = new Map<string, string>();
  const result = await env.DB.prepare(
    `SELECT support_case_id, MAX(recorded_at) AS recorded_at
     FROM participant_consent_records
     WHERE org_id = ? AND beneficiary_id = ?
     GROUP BY support_case_id`,
  ).bind(orgId, beneficiaryId).all<DbRow>();
  for (const row of result.results) {
    const value = nullableString(row.recorded_at);
    if (value !== null) recorded.set(stringValue(row.support_case_id), value);
  }
  return recorded;
}

/**
 * 당사자 목록 화면(사이드바 '당사자'의 도착지)이 쓰는 담당 당사자 전원.
 *
 * **케이스 상태로 거르지 않는다.** 상담 등록 후보(`listScheduleCandidates`)는 담당
 * **활성** 참여사업만 내리는데, 그 범위를 목록에 쓰면 종결 케이스만 남은 당사자가
 * 화면에서 조용히 사라진다 — 종결 케이스는 다시 들여다볼 일이 많은 쪽이고 이 화면은
 * 당사자 정보 허브의 입구다. 접근 범위는 `searchParticipants` 와 같다(활성 배정 기준,
 * counselor 는 담당 · admin 은 기관 전체 — R1 · D7).
 *
 * 실명은 D24·ADR-0005 로 역할 기준 기본 표시이며 서버에서 복호화해 싣는다(연락처 포함,
 * 계좌는 제외). 감사: read 1건 + 실명이 실리면 read_participant_pii 1건(D14).
 */
export async function listAssignedParticipants(
  env: Env,
  actor: Actor,
): Promise<AssignedParticipant[]> {
  assertHuman(actor);
  await assertCurrentHumanActor(env, actor);
  const sql = actor.role === 'admin'
    ? `SELECT beneficiaries.id AS beneficiary_id,
              MAX(CASE WHEN support_cases.status = 'active' THEN 1 ELSE 0 END) AS has_active,
              COUNT(DISTINCT support_cases.id) AS program_count
       FROM beneficiaries
       JOIN support_cases ON support_cases.beneficiary_id = beneficiaries.id
         AND support_cases.org_id = beneficiaries.org_id
       WHERE beneficiaries.org_id = ?
         AND beneficiaries.initialization_state = 'complete'
       GROUP BY beneficiaries.id
       ORDER BY beneficiaries.id`
    : `SELECT beneficiaries.id AS beneficiary_id,
              MAX(CASE WHEN support_cases.status = 'active' THEN 1 ELSE 0 END) AS has_active,
              COUNT(DISTINCT support_cases.id) AS program_count
       FROM beneficiaries
       JOIN support_cases ON support_cases.beneficiary_id = beneficiaries.id
         AND support_cases.org_id = beneficiaries.org_id
       JOIN support_case_assignees ON support_case_assignees.support_case_id = support_cases.id
         AND support_case_assignees.org_id = support_cases.org_id
         AND support_case_assignees.user_id = ?
         AND support_case_assignees.unassigned_at IS NULL
       WHERE beneficiaries.org_id = ?
         AND beneficiaries.initialization_state = 'complete'
       GROUP BY beneficiaries.id
       ORDER BY beneficiaries.id`;
  const bindings = actor.role === 'admin' ? [actor.orgId] : [actor.userId, actor.orgId];
  const result = await env.DB.prepare(sql).bind(...bindings).all<DbRow>();
  await writeCanonicalAudit(env, actor, {
    action: 'read',
    targetTable: 'beneficiaries',
    detail: { list: true, resultCount: result.results.length },
  });
  const ids = result.results.map((row) => stringValue(row.beneficiary_id));
  const contacts = await loadParticipantContacts(env, actor.orgId, ids);
  await auditParticipantPiiRead(env, actor, contacts, {});
  return result.results.map((row) => {
    const beneficiaryId = stringValue(row.beneficiary_id);
    const contact = contacts.get(beneficiaryId);
    return {
      beneficiaryId,
      status: integerValue(row.has_active) ? 'active' : 'closed',
      programCount: integerValue(row.program_count) ?? 0,
      name: contact?.name ?? null,
      phone: contact?.phone ?? null,
    };
  });
}

export interface AssignedParticipant {
  beneficiaryId: string;
  /** 진행 중인 참여 사업이 하나라도 있으면 active. 목록에서 거르는 값이 아니라 표시용이다. */
  status: 'active' | 'closed';
  programCount: number;
  // D24·ADR-0005: 역할 기준 기본 표시. 범위 밖이거나 미기입이면 null.
  name: string | null;
  phone: string | null;
}

export interface ParticipantSearchResult {
  beneficiaryId: string;
  status: 'active' | 'closed';
  programCount: number;
  // D24·ADR-0005: 당사자 선택 UI 는 실명 목록이 전제다("검색이 아니라 선택").
  // 담당(활성 배정)·admin 범위로 걸러진 결과의 실명만 서버 복호화해 싣는다. 미기입은 null.
  name: string | null;
}

const PARTICIPANT_SEARCH_MAX_QUERY_LENGTH = 64;
const PARTICIPANT_SEARCH_DEFAULT_LIMIT = 20;
const PARTICIPANT_SEARCH_MAX_LIMIT = 50;

/** LIKE 피연산자에서 와일드카드(%, _)와 이스케이프 문자(\)를 리터럴로 만든다. */
function escapeLikeOperand(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * 당사자 검색 (티켓 #16 · D21 · D24). 가명 ID(양형식) 부분 일치와 한글 표시명 부분 일치를
 * 함께 지원한다 — 한글 질의는 동물 슬러그(단일 출처 animal-slugs)로 환원해 접두어로 맞춘다.
 * 접근 범위는 다른 조회와 동일하다 — counselor는 담당 support_case, admin은 기관 전체 (R1 · D7).
 * D24·ADR-0005 로 선택 UI 가 실명 목록을 전제하므로 결과의 실명을 서버 복호화해 싣고
 * (연락처·계좌는 제외), 실명이 1건 이상 실리면 화면 단위 감사 1건(read_participant_pii).
 * 가명 ID·통계·외부 출력에는 여전히 실명을 싣지 않는다 (R3 — 이 응답은 인증된 내부 화면용).
 * 감사: read (검색 1건) + read_participant_pii (실명 노출 시).
 */
export async function searchParticipants(
  env: Env,
  actor: Actor,
  input: { query: string; limit?: number },
): Promise<ParticipantSearchResult[]> {
  assertHuman(actor);
  const query = input.query.trim();
  if (query.length === 0) throw new ValidationError('search query is required');
  if (query.length > PARTICIPANT_SEARCH_MAX_QUERY_LENGTH) throw new ValidationError('search query is too long');
  const limit = input.limit ?? PARTICIPANT_SEARCH_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > PARTICIPANT_SEARCH_MAX_LIMIT) {
    throw new ValidationError('search limit is invalid');
  }

  // 가명 ID 부분 일치(양형식 소문자 비교) OR 한글 표시명이 걸린 동물 슬러그의 접두어 일치.
  const matchConditions = [`LOWER(beneficiaries.id) LIKE '%' || ? || '%' ESCAPE '\\'`];
  const matchBindings: string[] = [escapeLikeOperand(query.toLowerCase())];
  for (const slug of ANIMAL_SLUGS) {
    if (ANIMAL_SLUG_KOREAN_NAMES[slug].includes(query)) {
      matchConditions.push(`beneficiaries.id LIKE ? ESCAPE '\\'`);
      matchBindings.push(`${slug}-%`);
    }
  }
  const matchClause = `(${matchConditions.join(' OR ')})`;

  const sql = actor.role === 'admin'
    ? `SELECT beneficiaries.id AS beneficiary_id,
              MAX(CASE WHEN support_cases.status = 'active' THEN 1 ELSE 0 END) AS has_active,
              COUNT(DISTINCT support_cases.id) AS program_count
       FROM beneficiaries
       JOIN support_cases ON support_cases.beneficiary_id = beneficiaries.id
         AND support_cases.org_id = beneficiaries.org_id
       WHERE beneficiaries.org_id = ?
         AND beneficiaries.initialization_state = 'complete'
         AND ${matchClause}
       GROUP BY beneficiaries.id
       ORDER BY beneficiaries.id
       LIMIT ?`
    : `SELECT beneficiaries.id AS beneficiary_id,
              MAX(CASE WHEN support_cases.status = 'active' THEN 1 ELSE 0 END) AS has_active,
              COUNT(DISTINCT support_cases.id) AS program_count
       FROM beneficiaries
       JOIN support_cases ON support_cases.beneficiary_id = beneficiaries.id
         AND support_cases.org_id = beneficiaries.org_id
       JOIN support_case_assignees ON support_case_assignees.support_case_id = support_cases.id
         AND support_case_assignees.org_id = support_cases.org_id
         AND support_case_assignees.user_id = ?
         AND support_case_assignees.unassigned_at IS NULL
       WHERE beneficiaries.org_id = ?
         AND beneficiaries.initialization_state = 'complete'
         AND ${matchClause}
       GROUP BY beneficiaries.id
       ORDER BY beneficiaries.id
       LIMIT ?`;

  const bindings = actor.role === 'admin'
    ? [actor.orgId, ...matchBindings, limit]
    : [actor.userId, actor.orgId, ...matchBindings, limit];

  const result = await env.DB.prepare(sql).bind(...bindings).all<DbRow>();
  await writeCanonicalAudit(env, actor, {
    action: 'read',
    targetTable: 'beneficiaries',
    detail: { search: true, resultCount: result.results.length },
  });
  const contacts = await loadParticipantContacts(
    env,
    actor.orgId,
    result.results.map((row) => stringValue(row.beneficiary_id)),
  );
  await auditParticipantPiiRead(env, actor, contacts, {});
  return result.results.map((row) => {
    const beneficiaryId = stringValue(row.beneficiary_id);
    return {
      beneficiaryId,
      status: integerValue(row.has_active) ? 'active' : 'closed',
      programCount: integerValue(row.program_count) ?? 0,
      name: contacts.get(beneficiaryId)?.name ?? null,
    };
  });
}

export interface ParticipantPiiUpdateInput {
  supportCaseContextId: string;
  expectedVersion: number;
  name?: string | null;
  phone?: string | null;
  account?: string | null;
  email?: string | null;
  // D41 1-1 · D42 ①: 인테이크 화면이 표시만 하게 되면서 이 세 항목의 쓰기 경로는 등록과
  // 이 함수뿐이다. 이미 등록된 당사자를 고칠 길을 남기려면 여기가 열려 있어야 한다.
  birthDate?: string | null;
  region?: string | null;
  gender?: string | null;
}

export interface ParticipantPiiReRegistrationInput {
  supportCaseContextId: string;
  expectedVersion: number;
  reason: string;
  name: string;
  phone: string;
  account: string;
}

interface ParticipantPiiVaultRow extends DbRow {
  enc_name: string | null;
  enc_phone: string | null;
  enc_account: string | null;
  enc_email: string | null;
  enc_birth_date: string | null;
  enc_region: string | null;
  enc_gender: string | null;
  version: number | string;
  purged_at: string | null;
}

async function getParticipantPiiVaultForOrg(
  env: Env,
  orgId: string,
  beneficiaryId: string,
): Promise<ParticipantPiiVaultRow> {
  const row = await env.DB.prepare(
    `SELECT beneficiary_id, enc_name, enc_phone, enc_account, enc_email,
            enc_birth_date, enc_region, enc_gender, version, purge_due, purged_at
     FROM participant_pii_vault
     WHERE beneficiary_id = ? AND org_id = ?`,
  ).bind(beneficiaryId, orgId).first<ParticipantPiiVaultRow>();
  if (row === null) {
    throw new ForbiddenError('participant data is unavailable');
  }
  return row;
}

async function encryptedParticipantPatch(
  env: Env,
  value: string | null | undefined,
  current: string | null,
  field: string,
): Promise<string | null> {
  if (value === undefined) return current;
  if (value !== null && typeof value !== 'string') {
    throw new ValidationError(`${field} is invalid`);
  }
  return encryptPii(env, value);
}

/**
 * Optimistic participant PII mutation. A currently active SupportCase is
 * required even for administrators, so a closed historical program cannot
 * mutate the participant-scoped vault.
 *
 * 권한(CCC-37, 2026-07-28): **담당 실무자 또는 기관 관리자**다 — `assertAdmin` 을 뗐다.
 * 근거는 이 층이 이미 등록에서 열려 있다는 것이다: `createBeneficiaryWithInitialSupportCase`
 * 는 counselor 가 부르고 이름·연락처·이메일·생년월일·주소·성별 **6종**을 같은 금고에 쓴다
 * (D42 ①). 등록 때 쓸 수 있는 값을 등록 뒤에 못 고치면 오타 하나를 관리자에게 부탁해야 한다.
 * **계좌는 예외다** — 등록의 `optionalPiiKeys` 에 없어 지금까지 admin 만 쓸 수 있었고,
 * CCC-37 이 7종에 포함시켰으므로 이번에 함께 열린다. 항목별로 권한을 가르지 않는다
 * (한 화면이 한 번에 저장하는 값에 권한 축을 하나 더 두면 감사·화면·게이트웨이가 어긋난다).
 * 케이스 단위 게이트는 그대로다 — 아래 `assertActiveSupportCaseContext` 가
 * `assertSupportCaseAccess`(admin 또는 **활성 배정된 담당 실무자**)를 통과시키므로,
 * 담당하지 않는 당사자의 금고는 여전히 열리지 않는다. 레거시 admin 전용 경로
 * (`registerPii`)는 자기 자리에서 `assertAdmin` 을 계속 갖는다.
 */
export async function updateParticipantPii(
  env: Env,
  actor: Actor,
  beneficiaryId: string,
  input: ParticipantPiiUpdateInput,
): Promise<ParticipantPiiVault> {
  await assertCurrentHumanActor(env, actor);
  assertBeneficiaryId(beneficiaryId);
  assertOpaqueIdentifier(input.supportCaseContextId, 'support case context id');
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new ValidationError('PII version is invalid');
  }
  const fields = (['name', 'phone', 'account', 'email', 'birthDate', 'region', 'gender'] as const)
    .filter((field) => input[field] !== undefined);
  if (fields.length === 0) {
    throw new ValidationError('PII patch is empty');
  }
  if (input.birthDate !== undefined && input.birthDate !== null) assertDateOnly(input.birthDate);
  await assertActiveSupportCaseContext(env, actor, beneficiaryId, input.supportCaseContextId);
  const current = await getParticipantPiiVaultForOrg(env, actor.orgId, beneficiaryId);
  const currentVersion = integerValue(current.version);
  if (currentVersion === null || currentVersion !== input.expectedVersion || current.purged_at !== null) {
    throw new ConflictError('participant data is unavailable');
  }

  const [encName, encPhone, encAccount, encEmail, encBirthDate, encRegion, encGender] = await Promise.all([
    encryptedParticipantPatch(env, input.name, current.enc_name, 'name'),
    encryptedParticipantPatch(env, input.phone, current.enc_phone, 'phone'),
    encryptedParticipantPatch(env, input.account, current.enc_account, 'account'),
    encryptedParticipantPatch(env, input.email, current.enc_email, 'email'),
    encryptedParticipantPatch(env, input.birthDate, current.enc_birth_date, 'birthDate'),
    encryptedParticipantPatch(env, input.region, current.enc_region, 'region'),
    encryptedParticipantPatch(env, input.gender, current.enc_gender, 'gender'),
  ]);
  const updatedAt = now();
  const result = await env.DB.batch([
    env.DB.prepare(
      `UPDATE participant_pii_vault
       SET enc_name = ?, enc_phone = ?, enc_account = ?, enc_email = ?,
           enc_birth_date = ?, enc_region = ?, enc_gender = ?, version = version + 1, updated_at = ?
       WHERE beneficiary_id = ? AND org_id = ? AND version = ? AND purged_at IS NULL`,
    ).bind(
      encName, encPhone, encAccount, encEmail, encBirthDate, encRegion, encGender,
      updatedAt, beneficiaryId, actor.orgId, input.expectedVersion,
    ),
conditionalCanonicalAuditStatement(env, actor, {
  action: 'update',
  targetTable: 'participant_pii_vault',
  targetId: beneficiaryId,
  beneficiaryId,
  supportCaseId: input.supportCaseContextId,
  detail: { fields },
}),
  ]);
  const update = result[0] as unknown as { meta?: { changes?: number } };
  if ((update.meta?.changes ?? 0) < 1) {
    throw new ConflictError('participant data is unavailable');
  }
  return {
    beneficiaryId,
    version: input.expectedVersion + 1,
    purgeDue: nullableString(current.purge_due),
    purgedAt: null,
  };
}

/** 기본정보 수정 화면(CCC-37)이 다루는 금고 항목. 감사 detail 에도 이 이름들만 남는다. */
export const PARTICIPANT_BASIC_INFO_FIELDS = [
  'name', 'phone', 'email', 'account', 'birthDate', 'region', 'gender',
] as const;
export type ParticipantBasicInfoField = (typeof PARTICIPANT_BASIC_INFO_FIELDS)[number];

export interface ParticipantBasicInfo {
  beneficiaryId: string;
  /** 저장에 그대로 쓸 활성 참여 사업. 화면이 고르지 않는다 — 게이트웨이가 정한다. */
  supportCaseContextId: string;
  /** 낙관적 잠금 값. 폼이 hidden 으로 돌려주고 저장이 이 값으로 충돌을 잡는다. */
  version: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  account: string | null;
  birthDate: string | null;
  region: string | null;
  gender: string | null;
}

/**
 * 기본정보 수정 화면(CCC-37)의 읽기 관문. 쓰기(`updateParticipantPii`)와 **같은 문**을
 * 지난다 — 활성 참여 사업 컨텍스트를 여기서 정해 돌려주고, 화면은 그 값을 그대로 저장에
 * 실어 보낸다. 읽기와 쓰기가 서로 다른 케이스를 고르는 일이 생기지 않는다.
 *
 * 감사는 **화면 조회당 read_participant_pii 1행**이다(D14·D24·ADR-0005). 실명·연락처
 * 외에 복호화해 실은 항목(이메일·계좌·생년월일·주소·성별)은 행을 나누지 않고 같은 행의
 * detail.fields 에 합친다 — `getIntakeRecordContext` 와 같은 방식이다(2026-07-25 Q 결정).
 */
export async function getParticipantBasicInfo(
  env: Env,
  actor: Actor,
  beneficiaryId: string,
): Promise<ParticipantBasicInfo> {
  // 담당(또는 admin) 사업이 1건도 없으면 이 당사자의 금고는 열리지 않는다(D36 전제 게이트).
  const authorizedIds = await listAuthorizedSupportCaseIdsForBeneficiary(env, actor, beneficiaryId);
  if (authorizedIds.length === 0) {
    throw new ForbiddenError('participant is unavailable');
  }
  const placeholders = authorizedIds.map(() => '?').join(', ');
  const activeRow = await env.DB.prepare(
    `SELECT id FROM support_cases
     WHERE org_id = ? AND beneficiary_id = ? AND status = 'active' AND id IN (${placeholders})
     ORDER BY program_type, id LIMIT 1`,
  ).bind(actor.orgId, beneficiaryId, ...authorizedIds).first<{ id: string }>();
  // 종결만 남은 당사자는 금고를 고칠 수 없다 — 쓰기가 활성 컨텍스트를 요구하기 때문이다.
  if (activeRow === null) {
    throw new ForbiddenError('support case is unavailable');
  }
  const supportCaseContextId = stringValue(activeRow.id);
  await assertActiveSupportCaseContext(env, actor, beneficiaryId, supportCaseContextId);

  const vault = await getParticipantPiiVaultForOrg(env, actor.orgId, beneficiaryId);
  const version = integerValue(vault.version);
  if (version === null || vault.purged_at !== null) {
    throw new ForbiddenError('participant data is unavailable');
  }
  const values = {
    name: await decryptPii(env, vault.enc_name),
    phone: await decryptPii(env, vault.enc_phone),
    email: await decryptPii(env, vault.enc_email),
    account: await decryptPii(env, vault.enc_account),
    birthDate: await decryptPii(env, vault.enc_birth_date),
    region: await decryptPii(env, vault.enc_region),
    gender: await decryptPii(env, vault.enc_gender),
  };
  const contacts = new Map<string, ParticipantContact>([
    [beneficiaryId, { name: values.name, phone: values.phone, email: values.email }],
  ]);
  await auditParticipantPiiRead(env, actor, contacts, {
    targetId: beneficiaryId,
    supportCaseId: supportCaseContextId,
    extraFields: (['email', 'account', 'birthDate', 'region', 'gender'] as const)
      .filter((field) => values[field] !== null),
  });
  return { beneficiaryId, supportCaseContextId, version, ...values };
}

/**
 * Re-registration is the only explicit path that may restore a purged vault.
 * It deliberately requires every value and an active program context.
 */
export async function reRegisterParticipantPii(
  env: Env,
  actor: Actor,
  beneficiaryId: string,
  input: ParticipantPiiReRegistrationInput,
): Promise<ParticipantPiiVault> {
  assertAdmin(actor);
  await assertCurrentHumanActor(env, actor);
  assertBeneficiaryId(beneficiaryId);
  assertOpaqueIdentifier(input.supportCaseContextId, 'support case context id');
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new ValidationError('PII version is invalid');
  }
  assertNonBlankText(input.reason, 're-registration reason');
  assertNonBlankText(input.name, 'name');
  assertNonBlankText(input.phone, 'phone');
  assertNonBlankText(input.account, 'account');
  await assertActiveSupportCaseContext(env, actor, beneficiaryId, input.supportCaseContextId);
  const current = await getParticipantPiiVaultForOrg(env, actor.orgId, beneficiaryId);
  const currentVersion = integerValue(current.version);
  if (currentVersion === null || currentVersion !== input.expectedVersion || current.purged_at === null) {
    throw new ConflictError('participant data is unavailable');
  }

  const [encName, encPhone, encAccount] = await Promise.all([
    encryptPii(env, input.name),
    encryptPii(env, input.phone),
    encryptPii(env, input.account),
  ]);
  const updatedAt = now();
  const result = await env.DB.batch([
    env.DB.prepare(
      `UPDATE participant_pii_vault
       SET enc_name = ?, enc_phone = ?, enc_account = ?, purge_due = NULL,
           purged_at = NULL, purged_by = NULL, purged_by_role = NULL,
           retention_changed_by = ?, retention_context_support_case_id = ?,
           retention_change_kind = 're_register_pii', retention_changed_at = ?,
           version = version + 1, updated_at = ?
       WHERE beneficiary_id = ? AND org_id = ? AND version = ? AND purged_at IS NOT NULL`,
    ).bind(
      encName,
      encPhone,
      encAccount,
      actor.userId,
      input.supportCaseContextId,
      updatedAt,
      updatedAt,
      beneficiaryId,
      actor.orgId,
      input.expectedVersion,
    ),
    conditionalCanonicalAuditStatement(env, actor, {
      action: 're_register_pii',
      targetTable: 'participant_pii_vault',
      targetId: beneficiaryId,
      beneficiaryId,
      supportCaseId: input.supportCaseContextId,
      detail: { fields: ['name', 'phone', 'account'], reasonProvided: true },
    }),
  ]);
  const update = result[0] as unknown as { meta?: { changes?: number } };
  if ((update.meta?.changes ?? 0) < 1) {
    throw new ConflictError('participant data is unavailable');
  }
  return {
    beneficiaryId,
    version: input.expectedVersion + 1,
    purgeDue: null,
    purgedAt: null,
  };
}

export interface ParticipantContact {
  name: string | null;
  phone: string | null;
  email: string | null;
}

/** 브리핑·상세가 노출하는 당사자 필드 — 실명·연락처만(이메일 제외, D31). */
export interface ParticipantNameContact {
  name: string | null;
  phone: string | null;
}

/**
 * 브리핑·상세 등 기존 소비자는 실명·연락처만 노출한다(이메일은 당사자 선택 UI 전용, D31).
 * loadParticipantContacts 가 이메일까지 복호화하더라도 이 경계에서 name·phone 만 추려
 * 이메일이 그 응답들로 새지 않게 한다.
 */
function participantNamePhone(contact: ParticipantContact | undefined): ParticipantNameContact {
  return { name: contact?.name ?? null, phone: contact?.phone ?? null };
}

/**
 * D24·ADR-0005 역할 기준 실명 표시의 공용 복호화 관문. 이미 접근 범위로 걸러진
 * (담당 활성 배정 또는 admin) 당사자 집합의 실명·연락처를 한 번의 배치 조회로
 * 복호화해 돌려준다 — 목록 응답의 N+1 을 피한다. 파기된 금고(purged_at)는 제외한다.
 * 접근 검사는 호출부가 이미 수행했다는 계약이다(비담당 실무자의 행은 애초에 결과에 없다).
 */
async function loadParticipantContacts(
  env: Env,
  orgId: string,
  beneficiaryIds: readonly string[],
): Promise<Map<string, ParticipantContact>> {
  const contacts = new Map<string, ParticipantContact>();
  const unique = [...new Set(beneficiaryIds)];
  if (unique.length === 0) return contacts;
  const placeholders = unique.map(() => '?').join(', ');
  const rows = await env.DB.prepare(
    `SELECT beneficiary_id, enc_name, enc_phone, enc_email
     FROM participant_pii_vault
     WHERE org_id = ? AND purged_at IS NULL AND beneficiary_id IN (${placeholders})`,
  ).bind(orgId, ...unique).all<{ beneficiary_id: string; enc_name: string | null; enc_phone: string | null; enc_email: string | null }>();
  for (const row of rows.results) {
    contacts.set(stringValue(row.beneficiary_id), {
      name: await decryptPii(env, row.enc_name),
      phone: await decryptPii(env, row.enc_phone),
      email: await decryptPii(env, row.enc_email),
    });
  }
  return contacts;
}

/**
 * PII(실명·연락처)가 1건 이상 실린 응답을 만든 게이트웨이 호출마다 화면 단위 감사
 * 1건을 남긴다(read_participant_pii, D14·D24). 값이 전부 null 이면(등록만 되고 PII
 * 미기입) 감사하지 않는다. 대상 당사자 목록은 detail 에 담아 이상 열람 분석이
 * 케이스 단위로 추적할 수 있게 한다. 클릭 단위(reveal)·마스킹 표시(masked) 감사를
 * 대체한다.
 */
async function auditParticipantPiiRead(
  env: Env,
  actor: Actor,
  contacts: Map<string, ParticipantContact>,
  scope: { targetId?: string | null; supportCaseId?: string | null; extraFields?: readonly string[] },
): Promise<void> {
  const beneficiaryIds = [...contacts.entries()]
    .filter(([, contact]) => contact.name !== null || contact.phone !== null)
    .map(([beneficiaryId]) => beneficiaryId)
    .sort();
  // 화면 조회 1건 = 감사 1행(D24·ADR-0005). 같은 화면이 실명·연락처 외에 다른 금고
  // 항목까지 복호화해 실었다면 행을 하나 더 쓰지 않고 이 행의 fields 에 합친다 —
  // 행이 갈리면 "이 실무자가 이 당사자를 몇 번 열람했나"를 셀 수 없게 된다(2026-07-25 Q 결정).
  const fields = ['name', 'phone', ...(scope.extraFields ?? [])];
  if (beneficiaryIds.length === 0 && (scope.extraFields?.length ?? 0) === 0) return;
  const auditedIds = beneficiaryIds.length > 0
    ? beneficiaryIds
    : scope.targetId != null ? [scope.targetId] : [];
  await writeCanonicalAudit(env, actor, {
    action: 'read_participant_pii',
    targetTable: 'participant_pii_vault',
    targetId: scope.targetId ?? null,
    beneficiaryId: auditedIds.length === 1 ? auditedIds[0]! : null,
    supportCaseId: scope.supportCaseId ?? null,
    detail: { fields, beneficiaryIds: auditedIds, count: auditedIds.length },
  });
}

/**
 * Updates only the SupportCase extension slot. The mutation and audit are
 * committed together, so Phase-1 compatibility callers never write the
 * read-only legacy view.
 */
export async function updateSupportCaseExtra(
  env: Env,
  actor: Actor,
  supportCaseId: string,
  extra: Record<string, unknown>,
): Promise<void> {
  const supportCase = await assertSupportCaseAccess(env, actor, supportCaseId);
  const updatedAt = now();
  const results = await env.DB.batch([
    env.DB.prepare(
      'UPDATE support_cases SET extra = ?, updated_at = ? WHERE id = ? AND org_id = ?',
    ).bind(stringifyJson(extra), updatedAt, supportCaseId, actor.orgId),
    conditionalCanonicalAuditStatement(env, actor, {
      action: 'update',
      targetTable: 'support_cases',
      targetId: supportCaseId,
      beneficiaryId: supportCase.beneficiaryId,
      supportCaseId,
      detail: { field: 'extra' },
    }),
  ]);
  const update = results[0] as unknown as { meta?: { changes?: number } };
  if ((update.meta?.changes ?? 0) < 1) {
    throw new ConflictError('support case is unavailable');
  }
}
/**
 * Closing a participation is irreversible. The retention deadline remains
 * schema-owned; the success audit is committed only with its guarded update.
 */
export async function closeSupportCase(
  env: Env,
  actor: Actor,
  supportCaseId: string,
  reason: string,
): Promise<SupportCase> {
  assertNonBlankText(reason, 'close reason');
  const supportCase = await assertSupportCaseAccess(env, actor, supportCaseId);
  if (supportCase.status !== 'active') {
    throw new ConflictError('support case is unavailable');
  }
  const closedAt = now();
  const operationId = newId();
  const auditDetail = JSON.stringify({ operationId });
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE support_cases
       SET status = 'closed', closed_at = ?, closed_reason = ?, closed_by_actor_id = ?,
           updated_at = ?
       WHERE id = ? AND org_id = ? AND status = 'active'`,
    ).bind(closedAt, reason, actor.userId, closedAt, supportCaseId, actor.orgId),
    env.DB.prepare(
      `INSERT INTO audit_log (
         org_id, actor_id, actor_role, action, target_table, target_id, case_id,
         beneficiary_id, support_case_id, detail, created_at
       )
       SELECT ?, ?, ?, 'close', 'support_cases', ?, NULL, ?, ?, ?, datetime('now')
       WHERE changes() = 1`,
    ).bind(
      actor.orgId,
      actor.userId,
      actor.role,
      supportCaseId,
      supportCase.beneficiaryId,
      supportCaseId,
      auditDetail,
    ),
  ]);
  const persisted = await env.DB.prepare(
    `SELECT support_case.id
     FROM support_cases AS support_case
     WHERE support_case.id = ? AND support_case.org_id = ?
       AND support_case.status = 'closed'
       AND support_case.closed_at = ?
       AND support_case.closed_reason = ?
       AND support_case.closed_by_actor_id = ?
       AND 1 = (
         SELECT COUNT(*) FROM audit_log AS audit
         WHERE audit.org_id = ? AND audit.actor_id = ? AND audit.actor_role = ?
           AND audit.action = 'close' AND audit.target_table = 'support_cases'
           AND audit.target_id = ? AND audit.case_id IS NULL
           AND audit.beneficiary_id = ? AND audit.support_case_id = ?
           AND audit.detail = ?
       )
     LIMIT 1`,
  ).bind(
    supportCaseId,
    actor.orgId,
    closedAt,
    reason,
    actor.userId,
    actor.orgId,
    actor.userId,
    actor.role,
    supportCaseId,
    supportCase.beneficiaryId,
    supportCaseId,
    auditDetail,
  ).first<{ id: string }>();
  if (persisted === null) {
    throw new ConflictError('support case is unavailable');
  }
  return {
    ...supportCase,
    status: 'closed',
    closedAt,
    closedReason: reason,
    updatedAt: closedAt,
  };
}

export interface ParticipantPiiPurgeResult {
  beneficiaryId: string;
  purged: boolean;
}

async function purgeParticipantPiiForActor(
  env: Env,
  actor: Actor,
  beneficiaryId: string,
): Promise<boolean> {
  const purgedAt = now();
  const result = await env.DB.batch([
    env.DB.prepare(
      `UPDATE participant_pii_vault
       SET enc_name = NULL, enc_phone = NULL, enc_account = NULL, enc_email = NULL,
           enc_birth_date = NULL, enc_region = NULL, enc_emergency_contact = NULL, enc_gender = NULL,
           purge_due = NULL, purged_at = ?, purged_by = ?, purged_by_role = ?,
           retention_changed_by = ?, retention_change_kind = 'purge_pii',
           retention_changed_at = ?, version = version + 1, updated_at = ?
       WHERE beneficiary_id = ? AND org_id = ? AND purged_at IS NULL
         AND purge_due IS NOT NULL AND purge_due <= datetime('now')
         AND NOT EXISTS (
           SELECT 1 FROM support_cases
           WHERE support_cases.beneficiary_id = participant_pii_vault.beneficiary_id
             AND support_cases.status = 'active'
         )`,
    ).bind(
      purgedAt,
      actor.userId,
      actor.role,
      actor.userId,
      purgedAt,
      purgedAt,
      beneficiaryId,
      actor.orgId,
    ),
  ]);
  const update = result[0] as unknown as { meta?: { changes?: number } };
  return (update.meta?.changes ?? 0) > 0;
}

/** An eligible successful purge is audited only by the vault transition trigger. */
export async function purgeParticipantPii(
  env: Env,
  actor: Actor,
  beneficiaryId: string,
): Promise<ParticipantPiiPurgeResult> {
  assertAdmin(actor);
  await assertCurrentHumanActor(env, actor);
  assertBeneficiaryId(beneficiaryId);
  await getBeneficiaryForOrg(env, actor.orgId, beneficiaryId, { completeOnly: true });
  const purged = await purgeParticipantPiiForActor(env, actor, beneficiaryId);
  if (!purged) {
    await writeCanonicalAudit(env, actor, {
      action: 'purge_pii_noop',
      targetTable: 'participant_pii_vault',
      targetId: beneficiaryId,
      beneficiaryId,
      detail: { reason: 'not_eligible_or_already_purged' },
    });
  }
  return { beneficiaryId, purged };
}

/**
 * Cron uses the same conditional transition. It intentionally emits no
 * per-row no-op audit; successful transitions have the schema-owned audit.
 */
export async function purgeExpiredParticipantPii(
  env: Env,
  opts?: { limit?: number },
): Promise<{ attempted: number; purged: number; noops: number }> {
  const limit = opts?.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new ValidationError('purge limit is invalid');
  }
  const candidates = await env.DB.prepare(
    `SELECT beneficiary_id, org_id
     FROM participant_pii_vault
     WHERE purged_at IS NULL AND purge_due IS NOT NULL AND purge_due <= datetime('now')
       AND NOT EXISTS (
         SELECT 1 FROM support_cases
         WHERE support_cases.beneficiary_id = participant_pii_vault.beneficiary_id
           AND support_cases.status = 'active'
       )
     ORDER BY purge_due, beneficiary_id
     LIMIT ?`,
  ).bind(limit).all<{ beneficiary_id: string; org_id: string }>();

  let purged = 0;
  for (const candidate of candidates.results) {
    const actor = systemActor(PURGE_ACTOR_ID, stringValue(candidate.org_id));
    if (await purgeParticipantPiiForActor(env, actor, stringValue(candidate.beneficiary_id))) {
      purged += 1;
    }
  }
  return {
    attempted: candidates.results.length,
    purged,
    noops: candidates.results.length - purged,
  };
}
/**
 * 세션 목표 입력 (D28). body 는 "이번 회차에서 다룰 것", caseGoalId 는 이 케이스의
 * 활성 케이스 목표(goals) 선택 연결 — 미연결(null/미지정) 허용, 복수 세션 목표가 같은
 * 케이스 목표를 향해도 된다. GAS 는 케이스 목표에만 매긴다(여기엔 점수 없음, R5·D6).
 */
export interface CreateScheduleSessionGoalInput {
  body: string;
  caseGoalId?: string | null;
}

export interface CreateCounselingScheduleInput {
  beneficiaryId: string;
  supportCaseId: string;
  scheduledAt: string;
  /** 상담 유형. 생략하면 'regular'(기본 상담). 티켓 #36. */
  sessionKind?: CounselingScheduleKind;
  /** 상담 방법. 생략하면 'in_person'(v1 대면 전용, D4). */
  channel?: CounselingScheduleChannel;
  /** 세션 목표(선택, regular 전용). 없으면 목표 없이 일정만 등록된다. intake 에는 줄 수 없다. */
  sessionGoals?: CreateScheduleSessionGoalInput[];
  /** 케이스 목표(intake 전용, D12). 측정 가능한 문장 1~3개를 이번 요청에서 함께 신설한다. */
  caseGoals?: string[];
  /** 맞춤형 질문(선택). AI 생성 질문과 별개로 실무자가 직접 적는다. */
  customQuestions?: string[];
}

export interface ScheduleSessionGoal {
  id: string;
  body: string;
  caseGoalId: string | null;
  caseGoalTitle: string | null;
  ordinal: number;
}

export interface ScheduleCustomQuestion {
  id: string;
  body: string;
  ordinal: number;
}

/** 한 상담 일정에 등록된 세션 목표·맞춤형 질문. 브리핑·일정 상세가 함께 쓴다. */
export interface ScheduleSessionPlan {
  scheduleId: string;
  sessionKind: CounselingScheduleKind;
  channel: CounselingScheduleChannel;
  sessionGoals: ScheduleSessionGoal[];
  customQuestions: ScheduleCustomQuestion[];
}

export interface RescheduleCounselingScheduleInput {
  expectedVersion: number;
  scheduledAt: string;
}

export interface ScheduleTransitionInput {
  expectedVersion: number;
}

export interface AuthoritativeDayInterval {
  date: string;
  timeZone: string;
  startUtc: string;
  endUtc: string;
}

export interface TodayScheduleCard {
  id: string;
  supportCaseId: string;
  beneficiaryId: string;
  scheduledAt: string;
  programType: 'financial_support_v1';
  status: CounselingScheduleStatus;
  sessionKind: CounselingScheduleKind;
  channel: CounselingScheduleChannel;
  // D24·ADR-0005: 담당(활성 배정)·admin 에게만 실명·연락처를 서버 복호화해 실어 준다.
  // 결과 행은 이미 접근 범위로 걸러졌으므로 여기 실린 값은 열람 권한이 있는 것이다.
  // 등록만 되고 PII 미기입이면 null.
  participantName: string | null;
  participantPhone: string | null;
  /**
   * 완료 회차의 세션 id. 전체 일정(CCC-19)이 지난 일정을 그 회차로 바로 보낸다
   * (`#record-{id}` 앵커, D47 ①). 스키마 CHECK 상 status='completed' 일 때만 값이 있다.
   */
  completedSessionId: string | null;
}

function assertDateOnly(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError('schedule date is invalid');
  }
  const [year, month, day] = value.split('-').map(Number);
  const candidate = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    candidate.getUTCFullYear() !== year
    || candidate.getUTCMonth() + 1 !== month
    || candidate.getUTCDate() !== day
  ) {
    throw new ValidationError('schedule date is invalid');
  }
}

function formatZonedParts(instant: Date, timeZone: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const values: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }
  return values;
}

function localDateAt(instant: Date, timeZone: string): string {
  const parts = formatZonedParts(instant, timeZone);
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  if (year === undefined || month === undefined || day === undefined) {
    throw new ValidationError('time zone is invalid');
  }
  return `${year}-${month}-${day}`;
}

function nextCalendarDate(date: string): string {
  assertDateOnly(date);
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + 1));
  return [
    String(next.getUTCFullYear()).padStart(4, '0'),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Adds `count` whole calendar days to a local date string. `count === 1` is
 * identical to `nextCalendarDate`; used to widen the schedule window (오늘 + 향후 N일).
 */
function addCalendarDays(date: string, count: number): string {
  assertDateOnly(date);
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + count));
  return [
    String(shifted.getUTCFullYear()).padStart(4, '0'),
    String(shifted.getUTCMonth() + 1).padStart(2, '0'),
    String(shifted.getUTCDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Finds the first instant in a local IANA calendar date. This is deliberately
 * not "start + 24h": two independently resolved boundaries remain correct for
 * DST gaps, folds, and non-24-hour days.
 */
function localDateStartUtc(date: string, timeZone: string): string {
  assertDateOnly(date);
  const [year, month, day] = date.split('-').map(Number);
  let low = Date.UTC(year!, month! - 1, day!) - 36 * 60 * 60 * 1000;
  let high = Date.UTC(year!, month! - 1, day!) + 36 * 60 * 60 * 1000;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (localDateAt(new Date(middle), timeZone) < date) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  if (localDateAt(new Date(low), timeZone) !== date) {
    throw new ValidationError('schedule date is unavailable in the configured time zone');
  }
  return new Date(low).toISOString();
}

async function resolveEffectiveTimeZone(env: Env, actor: Actor): Promise<string> {
  await assertCurrentHumanActor(env, actor);
  const [user, organization] = await Promise.all([
    env.DB.prepare('SELECT time_zone FROM users WHERE id = ? AND org_id = ? AND active = 1')
      .bind(actor.userId, actor.orgId)
      .first<{ time_zone: string | null }>(),
    env.DB.prepare('SELECT time_zone FROM organization_settings WHERE org_id = ?')
      .bind(actor.orgId)
      .first<{ time_zone: string }>(),
  ]);
  const timeZone = user?.time_zone ?? organization?.time_zone;
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new ForbiddenError('time zone is unavailable');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
  } catch {
    throw new ForbiddenError('time zone is unavailable');
  }
  return timeZone;
}

export async function resolveAuthoritativeTodayInterval(
  env: Env,
  actor: Actor,
  opts?: { date?: string; days?: number },
): Promise<AuthoritativeDayInterval> {
  const timeZone = await resolveEffectiveTimeZone(env, actor);
  const date = opts?.date ?? localDateAt(new Date(), timeZone);
  assertDateOnly(date);
  const days = opts?.days ?? 1;
  if (!Number.isInteger(days) || days < 1) {
    throw new ValidationError('schedule window is invalid');
  }
  return {
    date,
    timeZone,
    startUtc: localDateStartUtc(date, timeZone),
    endUtc: localDateStartUtc(addCalendarDays(date, days), timeZone),
  };
}

async function getCounselingScheduleForOrg(
  env: Env,
  orgId: string,
  scheduleId: string,
): Promise<CounselingSchedule> {
  const row = await env.DB.prepare(
    'SELECT * FROM counseling_schedules WHERE id = ? AND org_id = ?',
  ).bind(scheduleId, orgId).first<DbRow>();
  if (row === null) {
    throw new ForbiddenError('counseling schedule is unavailable');
  }
  return mapCounselingSchedule(row);
}
export async function getNextCounselingScheduleForSupportCase(
  env: Env,
  actor: Actor,
  supportCaseId: string,
): Promise<CounselingSchedule | null> {
  assertOpaqueIdentifier(supportCaseId, 'support case id');
  const supportCase = await assertSupportCaseAccess(env, actor, supportCaseId);
  const row = supportCase.status === 'active'
    ? await env.DB.prepare(
      `SELECT * FROM counseling_schedules
       WHERE org_id = ? AND support_case_id = ? AND status = 'scheduled'
       ORDER BY scheduled_at, id
       LIMIT 1`,
    ).bind(actor.orgId, supportCaseId).first<DbRow>()
    : null;
  const schedule = row === null ? null : mapCounselingSchedule(row);
  await writeCanonicalAudit(env, actor, {
    action: 'read',
    targetTable: 'counseling_schedules',
    beneficiaryId: supportCase.beneficiaryId,
    supportCaseId,
    detail: { nextEligible: true, found: schedule !== null },
  });
  return schedule;
}

async function assertScheduleMutationAccess(
  env: Env,
  actor: Actor,
  schedule: CounselingSchedule,
): Promise<SupportCase> {
  return assertActiveSupportCaseContext(env, actor, schedule.beneficiaryId, schedule.supportCaseId);
}

export async function getTodaySchedules(
  env: Env,
  actor: Actor,
  opts?: { date?: string; days?: number },
): Promise<AuthoritativeDayInterval & { schedules: TodayScheduleCard[] }> {
  const interval = await resolveAuthoritativeTodayInterval(env, actor, opts);
  const result = actor.role === 'admin'
    ? await env.DB.prepare(
      `SELECT schedule.id, schedule.support_case_id, schedule.beneficiary_id, schedule.scheduled_at, schedule.status, schedule.session_kind, schedule.channel, schedule.completed_session_id, support_case.program_type
       FROM counseling_schedules AS schedule
       JOIN support_cases AS support_case ON support_case.id = schedule.support_case_id
         AND support_case.org_id = schedule.org_id
       WHERE schedule.org_id = ? AND schedule.scheduled_at >= ? AND schedule.scheduled_at < ?
       ORDER BY schedule.scheduled_at, schedule.id`,
    ).bind(actor.orgId, interval.startUtc, interval.endUtc).all<DbRow>()
    : await env.DB.prepare(
      `SELECT schedule.id, schedule.support_case_id, schedule.beneficiary_id, schedule.scheduled_at, schedule.status, schedule.session_kind, schedule.channel, schedule.completed_session_id, support_case.program_type
       FROM counseling_schedules AS schedule
       JOIN support_cases AS support_case ON support_case.id = schedule.support_case_id
         AND support_case.org_id = schedule.org_id
       JOIN support_case_assignees AS assignment
         ON assignment.support_case_id = schedule.support_case_id
         AND assignment.org_id = schedule.org_id
       WHERE schedule.org_id = ? AND schedule.scheduled_at >= ? AND schedule.scheduled_at < ?
         AND assignment.user_id = ? AND assignment.unassigned_at IS NULL
       ORDER BY schedule.scheduled_at, schedule.id`,
    ).bind(actor.orgId, interval.startUtc, interval.endUtc, actor.userId).all<DbRow>();

  await writeCanonicalAudit(env, actor, {
    action: 'read',
    targetTable: 'counseling_schedules',
    detail: {
      date: interval.date,
      ...(opts?.days !== undefined && opts.days > 1 ? { days: opts.days } : {}),
    },
  });
  // 카드에 실명·연락처를 실으려 배치 복호화한다(N+1 회피). 결과 행은 이미 접근 범위
  // (담당 활성 배정 또는 admin org-wide)로 걸러졌으므로 전부 열람 권한 대상이다.
  const contacts = await loadParticipantContacts(
    env,
    actor.orgId,
    result.results.map((row) => stringValue(row.beneficiary_id)),
  );
  await auditParticipantPiiRead(env, actor, contacts, {});
  return {
    ...interval,
    schedules: result.results.map((row) => {
      const programType = row.program_type;
      assertFinancialSupportProgramType(programType);
      const beneficiaryId = stringValue(row.beneficiary_id);
      const contact = contacts.get(beneficiaryId);
      return {
        id: stringValue(row.id),
        supportCaseId: stringValue(row.support_case_id),
        beneficiaryId,
        scheduledAt: stringValue(row.scheduled_at),
        programType,
        status: canonicalScheduleStatus(row.status),
        sessionKind: canonicalScheduleKind(row.session_kind),
        channel: canonicalScheduleChannel(row.channel),
        participantName: contact?.name ?? null,
        participantPhone: contact?.phone ?? null,
        completedSessionId: nullableString(row.completed_session_id),
      };
    }),
  };
}

/**
 * Window for the merged 상담 일정 screen: today plus the next 7 calendar days
 * (오늘 + 향후 7일 → 8 calendar days, `[today, today+8)`; D21). The upcoming
 * section renders days 1..7. Reuses `getTodaySchedules`, so the R1 gateway
 * access rules (담당 케이스 한정, admin org-wide) and audit apply unchanged.
 */
export const UPCOMING_SCHEDULE_WINDOW_DAYS = 8;

export async function getUpcomingSchedules(
  env: Env,
  actor: Actor,
  opts?: { date?: string },
): Promise<AuthoritativeDayInterval & { schedules: TodayScheduleCard[] }> {
  return getTodaySchedules(env, actor, {
    ...(opts?.date !== undefined ? { date: opts.date } : {}),
    days: UPCOMING_SCHEDULE_WINDOW_DAYS,
  });
}

function assertMonthOnly(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new ValidationError('schedule month is invalid');
  }
}

/** 그 달의 날 수. `new Date(Date.UTC(y, m, 0))` 의 날짜가 곧 이전 달의 마지막 날이다. */
function daysInMonth(month: string): number {
  const [year, monthIndex] = month.split('-').map(Number);
  return new Date(Date.UTC(year!, monthIndex!, 0)).getUTCDate();
}

/**
 * 한 달 창의 상담 일정 (전체 일정 화면, CCC-19 · D35). '다가오는 일정'과 같은
 * `getTodaySchedules` 를 쓰므로 접근 범위(담당 활성 배정 또는 admin org-wide, D7)와
 * 감사(read + read_participant_pii 각 1행, D24)가 그대로 적용된다. 상태를 거르지 않아
 * 지난 일정(완료·취소·불참)도 함께 나온다 — 이 화면의 목적이 '지난·앞으로 둘 다'다.
 *
 * **달을 정하는 것은 서버다.** month 를 생략하면 기관 시간대의 오늘이 속한 달을 쓴다 —
 * 화면이 기본 달을 계산하려면 기관 시간대를 먼저 알아야 하는데 그 값이 여기 있기 때문이다
 * ('오늘'을 서버가 정하는 것과 같은 이유). 창 길이도 서버가 달에서 파생하므로 화면이
 * 임의 길이를 요구할 수 없다.
 */
export async function getMonthSchedules(
  env: Env,
  actor: Actor,
  opts?: { month?: string },
): Promise<AuthoritativeDayInterval & { schedules: TodayScheduleCard[] }> {
  const month = opts?.month ?? (await resolveEffectiveTimeZone(env, actor).then(
    (timeZone) => localDateAt(new Date(), timeZone).slice(0, 7),
  ));
  assertMonthOnly(month);
  return getTodaySchedules(env, actor, { date: `${month}-01`, days: daysInMonth(month) });
}

export interface ScheduleCandidate {
  beneficiaryId: string;
  supportCaseId: string;
  programType: 'financial_support_v1';
  // D31·D24: 당사자 선택 UI 는 역할 기준 실명·연락처·이메일을 직접 실어 보여준다(사업명 대신).
  // 접근 범위(담당 활성 배정 또는 admin)로 이미 걸러진 후보라 전부 열람 대상이다. 미기입은 null.
  participantName: string | null;
  participantPhone: string | null;
  participantEmail: string | null;
  /**
   * 인테이크 완료 시각. null 이면 아직 인테이크가 없다 (D35 · ADR-0014 §5).
   * 상담 등록 1단계가 이 값으로 **상담 유형 기본값**을 잡는다 — 없으면 '인테이크',
   * 있으면 '기본 상담'. 저장 시점의 "케이스당 인테이크 1회" 검사와는 별개다(그건 그대로 둔다).
   */
  intakeAt: string | null;
}

/**
 * 상담 등록 폼의 당사자 후보 (티켓 #19 콜드스타트 해소). 후보 기준을 '일정 보유'가
 * 아니라 '담당 활성 참여사업'으로 둔다 — 그래야 방금 등록해 아직 일정이 없는 당사자도
 * 첫 상담을 등록할 수 있다. counselor 는 자기 활성 배정 케이스만, admin 은 기관의 모든
 * 활성 참여사업을 본다(listCases 의 접근 모델과 동일, D7). 감사: read.
 */
export async function listScheduleCandidates(
  env: Env,
  actor: Actor,
): Promise<ScheduleCandidate[]> {
  assertHuman(actor);
  const result = actor.role === 'admin'
    ? await env.DB.prepare(
      `SELECT id AS support_case_id, beneficiary_id, program_type, intake_at
       FROM support_cases
       WHERE org_id = ? AND status = 'active'
       ORDER BY beneficiary_id, created_at DESC`,
    ).bind(actor.orgId).all<DbRow>()
    : await env.DB.prepare(
      `SELECT DISTINCT support_cases.id AS support_case_id,
              support_cases.beneficiary_id AS beneficiary_id,
              support_cases.program_type AS program_type,
              support_cases.intake_at AS intake_at,
              support_cases.created_at AS created_at
       FROM support_cases
       INNER JOIN support_case_assignees
         ON support_case_assignees.support_case_id = support_cases.id
        AND support_case_assignees.org_id = support_cases.org_id
       WHERE support_cases.org_id = ?
         AND support_cases.status = 'active'
         AND support_case_assignees.user_id = ?
         AND support_case_assignees.unassigned_at IS NULL
       ORDER BY support_cases.beneficiary_id, support_cases.created_at DESC`,
    ).bind(actor.orgId, actor.userId).all<DbRow>();

  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'support_cases',
    detail: { list: 'schedule_candidates', count: result.results.length },
  });

  // D31·D24: 선택 UI 에 실명·연락처·이메일을 실으려 배치 복호화한다(N+1 회피). 결과 행은 이미
  // 접근 범위(담당 활성 배정 또는 admin)로 걸러졌으므로 전부 열람 권한 대상이다. PII 가 실린
  // 화면 조회당 read_participant_pii 감사 1건(getTodaySchedules 와 동일 패턴).
  const contacts = await loadParticipantContacts(
    env,
    actor.orgId,
    result.results.map((row) => stringValue(row.beneficiary_id)),
  );
  await auditParticipantPiiRead(env, actor, contacts, {});

  return result.results.map((row) => {
    const programType = row.program_type;
    assertFinancialSupportProgramType(programType);
    const beneficiaryId = stringValue(row.beneficiary_id);
    const contact = contacts.get(beneficiaryId);
    return {
      beneficiaryId,
      supportCaseId: stringValue(row.support_case_id),
      programType,
      participantName: contact?.name ?? null,
      participantPhone: contact?.phone ?? null,
      participantEmail: contact?.email ?? null,
      intakeAt: nullableString(row.intake_at),
    };
  });
}

const MAX_SCHEDULE_SESSION_GOALS = 20;
const MAX_SCHEDULE_CUSTOM_QUESTIONS = 20;

interface NormalizedScheduleSessionGoal {
  body: string;
  caseGoalId: string | null;
}

/**
 * 세션 목표·맞춤형 질문 입력을 정규화한다. 각 문구는 trim 후 비어 있으면 거부하고,
 * caseGoalId 는 형식만 검증한다(같은 케이스·active 여부는 assertSessionGoalLinksActive).
 */
function normalizeSchedulePlanInput(
  input: CreateCounselingScheduleInput,
): { sessionGoals: NormalizedScheduleSessionGoal[]; customQuestions: string[] } {
  const sessionGoalsInput = input.sessionGoals ?? [];
  if (!Array.isArray(sessionGoalsInput)) throw new ValidationError('session goals are invalid');
  if (sessionGoalsInput.length > MAX_SCHEDULE_SESSION_GOALS) {
    throw new ValidationError(`a schedule can have at most ${MAX_SCHEDULE_SESSION_GOALS} session goals`);
  }
  const sessionGoals = sessionGoalsInput.map((goal): NormalizedScheduleSessionGoal => {
    const body = typeof goal.body === 'string' ? goal.body.trim() : '';
    if (body.length === 0) throw new ValidationError('session goal text is required');
    if (goal.caseGoalId === undefined || goal.caseGoalId === null) {
      return { body, caseGoalId: null };
    }
    assertOpaqueIdentifier(goal.caseGoalId, 'case goal id');
    return { body, caseGoalId: goal.caseGoalId };
  });

  const customQuestionsInput = input.customQuestions ?? [];
  if (!Array.isArray(customQuestionsInput)) throw new ValidationError('custom questions are invalid');
  if (customQuestionsInput.length > MAX_SCHEDULE_CUSTOM_QUESTIONS) {
    throw new ValidationError(`a schedule can have at most ${MAX_SCHEDULE_CUSTOM_QUESTIONS} custom questions`);
  }
  const customQuestions = customQuestionsInput.map((question) => {
    const body = typeof question === 'string' ? question.trim() : '';
    if (body.length === 0) throw new ValidationError('custom question text is required');
    return body;
  });

  return { sessionGoals, customQuestions };
}

/**
 * 세션 목표가 연결한 케이스 목표가 같은 참여사업의 active 목표인지 확인한다(D28).
 * 타 케이스·종료(closed) 목표 연결은 거부한다. 하나의 케이스 목표를 여러 세션 목표가
 * 향할 수 있으므로 중복을 제거한 distinct 집합으로 대조한다(복수 허용).
 */
async function assertSessionGoalLinksActive(
  env: Env,
  orgId: string,
  supportCaseId: string,
  caseGoalIds: Array<string | null>,
): Promise<void> {
  const distinct = [...new Set(caseGoalIds.filter((goalId): goalId is string => goalId !== null))];
  if (distinct.length === 0) return;
  const placeholders = distinct.map(() => '?').join(', ');
  const found = await env.DB.prepare(
    `SELECT id FROM goals
     WHERE org_id = ? AND support_case_id = ? AND status = 'active' AND id IN (${placeholders})`,
  ).bind(orgId, supportCaseId, ...distinct).all<{ id: string }>();
  if (found.results.length !== distinct.length) {
    throw new ValidationError('session goal link is invalid');
  }
}

function normalizeScheduleKind(value: unknown): CounselingScheduleKind {
  if (value === undefined || value === 'regular') return 'regular';
  if (value === 'intake') return 'intake';
  throw new ValidationError('schedule kind is invalid');
}

// v1 상담 방법은 대면만이다(D4). 다른 값은 거부한다 — 확장 시 이 목록을 넓힌다.
function normalizeScheduleChannel(value: unknown): CounselingScheduleChannel {
  if (value === undefined || value === 'in_person') return 'in_person';
  throw new ValidationError('schedule channel is invalid');
}

/**
 * 인테이크 케이스 목표 입력을 정규화한다(D12). 측정 가능한 문장을 1~MAX_ACTIVE_GOALS 개
 * 받으며, 각 문구는 trim 후 비어 있으면 거부한다. 기존 active 목표와의 합산 상한은
 * createCounselingSchedule 이 별도로 검사한다.
 */
function normalizeIntakeCaseGoals(input: CreateCounselingScheduleInput): string[] {
  const caseGoalsInput = input.caseGoals ?? [];
  if (!Array.isArray(caseGoalsInput)) throw new ValidationError('case goals are invalid');
  const caseGoals = caseGoalsInput.map((title) => {
    const body = typeof title === 'string' ? title.trim() : '';
    if (body.length === 0) throw new ValidationError('case goal text is required');
    return body;
  });
  if (caseGoals.length < 1) {
    throw new ValidationError('an intake schedule requires at least one case goal');
  }
  if (caseGoals.length > MAX_ACTIVE_GOALS) {
    throw new ValidationError(`a case can have at most ${MAX_ACTIVE_GOALS} active goals`);
  }
  return caseGoals;
}

export async function createCounselingSchedule(
  env: Env,
  actor: Actor,
  input: CreateCounselingScheduleInput,
): Promise<CounselingSchedule> {
  assertBeneficiaryId(input.beneficiaryId);
  assertOpaqueIdentifier(input.supportCaseId, 'support case id');
  const scheduledAt = canonicalUtcInstant(input.scheduledAt, 'schedule time');
  const sessionKind = normalizeScheduleKind(input.sessionKind);
  const channel = normalizeScheduleChannel(input.channel);
  await assertActiveSupportCaseContext(env, actor, input.beneficiaryId, input.supportCaseId);

  if (sessionKind === 'intake') {
    return createIntakeCounselingSchedule(env, actor, input, scheduledAt, channel);
  }

  // 기본 상담(regular): 인테이크 전용 케이스 목표는 받지 않는다.
  if (Array.isArray(input.caseGoals) && input.caseGoals.length > 0) {
    throw new ValidationError('only intake schedules create case goals');
  }
  const plan = normalizeSchedulePlanInput(input);
  await assertSessionGoalLinksActive(
    env,
    actor.orgId,
    input.supportCaseId,
    plan.sessionGoals.map((goal) => goal.caseGoalId),
  );
  const id = newId();
  const createdAt = now();
  // regular INSERT 은 그대로 둔다 — session_kind·channel 은 DEFAULT('regular'·'in_person')로 채워진다.
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO counseling_schedules (
         id, org_id, beneficiary_id, support_case_id, scheduled_at, status, version,
         created_by_actor_id, updated_by_actor_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'scheduled', 1, ?, ?, ?, ?)`,
    ).bind(
      id,
      actor.orgId,
      input.beneficiaryId,
      input.supportCaseId,
      scheduledAt,
      actor.userId,
      actor.userId,
      createdAt,
      createdAt,
    ),
  ];
  plan.sessionGoals.forEach((goal, index) => {
    statements.push(env.DB.prepare(
      `INSERT INTO schedule_session_goals (
         id, org_id, schedule_id, support_case_id, case_goal_id, body, ordinal, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(newId(), actor.orgId, id, input.supportCaseId, goal.caseGoalId, goal.body, index, actor.userId, createdAt));
  });
  plan.customQuestions.forEach((body, index) => {
    statements.push(env.DB.prepare(
      `INSERT INTO schedule_custom_questions (
         id, org_id, schedule_id, support_case_id, body, ordinal, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(newId(), actor.orgId, id, input.supportCaseId, body, index, actor.userId, createdAt));
  });
  statements.push(canonicalAuditStatement(env, actor, {
    action: 'create',
    targetTable: 'counseling_schedules',
    targetId: id,
    beneficiaryId: input.beneficiaryId,
    supportCaseId: input.supportCaseId,
    detail: { status: 'scheduled' },
  }));
  await env.DB.batch(statements);
  return {
    id,
    beneficiaryId: input.beneficiaryId,
    supportCaseId: input.supportCaseId,
    scheduledAt,
    status: 'scheduled',
    sessionKind: 'regular',
    channel,
    version: 1,
    completedSessionId: null,
    createdByActorId: actor.userId,
    updatedByActorId: actor.userId,
    completedByActorId: null,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * 인테이크 일정 등록(티켓 #36). 세션 목표 대신 케이스 목표(goals, D12)를 이번 요청에서
 * 함께 신설한다. 일정·케이스 목표·맞춤형 질문·감사를 한 배치로 원자적으로 쓴다(R1·R5:
 * 목표 문구는 실무자가 확정, AI 개입 없음). 세션 목표는 인테이크에 허용되지 않는다.
 */
async function createIntakeCounselingSchedule(
  env: Env,
  actor: Actor,
  input: CreateCounselingScheduleInput,
  scheduledAt: string,
  channel: CounselingScheduleChannel,
): Promise<CounselingSchedule> {
  if (Array.isArray(input.sessionGoals) && input.sessionGoals.length > 0) {
    throw new ValidationError('intake schedule cannot carry session goals');
  }
  const caseGoals = normalizeIntakeCaseGoals(input);
  // 맞춤형 질문 정규화는 재사용한다(세션 목표는 비운 채로).
  const { customQuestions } = normalizeSchedulePlanInput({ ...input, sessionGoals: [] });

  // 기존 active 목표와 신설분의 합이 케이스당 상한(MAX_ACTIVE_GOALS)을 넘지 않아야 한다(D12).
  const active = await env.DB.prepare(
    "SELECT COUNT(*) AS count FROM goals WHERE org_id = ? AND support_case_id = ? AND status = 'active'",
  ).bind(actor.orgId, input.supportCaseId).first<{ count: number }>();
  if ((active?.count ?? 0) + caseGoals.length > MAX_ACTIVE_GOALS) {
    throw new ValidationError(`a case can have at most ${MAX_ACTIVE_GOALS} active goals`);
  }

  const id = newId();
  const createdAt = now();
  const statements: D1PreparedStatement[] = [
    env.DB.prepare(
      `INSERT INTO counseling_schedules (
         id, org_id, beneficiary_id, support_case_id, scheduled_at, status, session_kind, channel, version,
         created_by_actor_id, updated_by_actor_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'scheduled', 'intake', ?, 1, ?, ?, ?, ?)`,
    ).bind(
      id,
      actor.orgId,
      input.beneficiaryId,
      input.supportCaseId,
      scheduledAt,
      channel,
      actor.userId,
      actor.userId,
      createdAt,
      createdAt,
    ),
  ];
  const goalIds = caseGoals.map(() => newId());
  caseGoals.forEach((title, index) => {
    statements.push(env.DB.prepare(
      'INSERT INTO goals (id, org_id, support_case_id, title, scale_criteria, status, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)',
    ).bind(goalIds[index], actor.orgId, input.supportCaseId, title, 'active', createdAt));
  });
  customQuestions.forEach((body, index) => {
    statements.push(env.DB.prepare(
      `INSERT INTO schedule_custom_questions (
         id, org_id, schedule_id, support_case_id, body, ordinal, created_by, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(newId(), actor.orgId, id, input.supportCaseId, body, index, actor.userId, createdAt));
  });
  statements.push(canonicalAuditStatement(env, actor, {
    action: 'create',
    targetTable: 'counseling_schedules',
    targetId: id,
    beneficiaryId: input.beneficiaryId,
    supportCaseId: input.supportCaseId,
    detail: { status: 'scheduled' },
  }));
  goalIds.forEach((goalId) => {
    statements.push(canonicalAuditStatement(env, actor, {
      action: 'create',
      targetTable: 'goals',
      targetId: goalId,
      beneficiaryId: input.beneficiaryId,
      supportCaseId: input.supportCaseId,
      detail: { via: 'intake_schedule' },
    }));
  });
  await env.DB.batch(statements);
  return {
    id,
    beneficiaryId: input.beneficiaryId,
    supportCaseId: input.supportCaseId,
    scheduledAt,
    status: 'scheduled',
    sessionKind: 'intake',
    channel,
    version: 1,
    completedSessionId: null,
    createdByActorId: actor.userId,
    updatedByActorId: actor.userId,
    completedByActorId: null,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

async function transitionCounselingSchedule(
  env: Env,
  actor: Actor,
  scheduleId: string,
  input: ScheduleTransitionInput & { scheduledAt?: string },
  transition: 'rescheduled' | 'cancelled' | 'no_show',
): Promise<CounselingSchedule> {
  assertOpaqueIdentifier(scheduleId, 'schedule id');
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new ValidationError('schedule version is invalid');
  }
  if (transition === 'rescheduled') {
    canonicalUtcInstant(input.scheduledAt, 'schedule time');
  }
  const existing = await getCounselingScheduleForOrg(env, actor.orgId, scheduleId);
  await assertScheduleMutationAccess(env, actor, existing);
  if (existing.status !== 'scheduled') {
    throw new ConflictError('counseling schedule is unavailable');
  }
  const scheduledAt = transition === 'rescheduled' ? input.scheduledAt as string : existing.scheduledAt;
  const updatedAt = now();
  const nextStatus = transition === 'rescheduled' ? 'scheduled' : transition;
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE counseling_schedules
       SET scheduled_at = ?, status = ?, version = version + 1, updated_by_actor_id = ?,
           updated_at = ?
       WHERE id = ? AND org_id = ? AND status = 'scheduled' AND version = ?`,
    ).bind(scheduledAt, nextStatus, actor.userId, updatedAt, scheduleId, actor.orgId, input.expectedVersion),
    conditionalCanonicalAuditStatement(env, actor, {
      action: transition === 'rescheduled' ? 'reschedule' : transition,
      targetTable: 'counseling_schedules',
      targetId: scheduleId,
      beneficiaryId: existing.beneficiaryId,
      supportCaseId: existing.supportCaseId,
      detail: { status: nextStatus },
    }),
  ]);
  const update = results[0] as unknown as { meta?: { changes?: number } };
  if ((update.meta?.changes ?? 0) < 1) {
    throw new ConflictError('counseling schedule is unavailable');
  }
  return {
    ...existing,
    scheduledAt,
    status: nextStatus,
    version: input.expectedVersion + 1,
    updatedByActorId: actor.userId,
    updatedAt,
  };
}

export async function rescheduleCounselingSchedule(
  env: Env,
  actor: Actor,
  scheduleId: string,
  input: RescheduleCounselingScheduleInput,
): Promise<CounselingSchedule> {
  return transitionCounselingSchedule(env, actor, scheduleId, input, 'rescheduled');
}

export async function cancelCounselingSchedule(
  env: Env,
  actor: Actor,
  scheduleId: string,
  input: ScheduleTransitionInput,
): Promise<CounselingSchedule> {
  return transitionCounselingSchedule(env, actor, scheduleId, input, 'cancelled');
}

export async function markCounselingScheduleNoShow(
  env: Env,
  actor: Actor,
  scheduleId: string,
  input: ScheduleTransitionInput,
): Promise<CounselingSchedule> {
  return transitionCounselingSchedule(env, actor, scheduleId, input, 'no_show');
}

/** 일정에 딸린 세션 목표·맞춤형 질문 항목(유형·방법 제외). loadScheduleSessionEntries 반환형. */
type ScheduleSessionEntries = Pick<ScheduleSessionPlan, 'sessionGoals' | 'customQuestions'>;

/**
 * 일정별 세션 목표·맞춤형 질문 로더 (감사·권한 없음, 내부 전용). 접근 검사를 이미
 * 통과한 스코프(getScheduleSessionPlan·브리핑)에서만 호출한다. 세션 목표에는 연결된
 * 케이스 목표 문구를 함께 채운다(연결 없으면 null). 유형·방법은 일정 행에서 별도로 붙인다.
 */
async function loadScheduleSessionEntries(
  env: Env,
  orgId: string,
  scheduleId: string,
): Promise<ScheduleSessionEntries> {
  const [goals, questions] = await Promise.all([
    env.DB.prepare(
      `SELECT session_goal.id, session_goal.body, session_goal.ordinal,
              session_goal.case_goal_id, goal.title AS case_goal_title
       FROM schedule_session_goals AS session_goal
       LEFT JOIN goals AS goal ON goal.id = session_goal.case_goal_id
         AND goal.org_id = session_goal.org_id
       WHERE session_goal.org_id = ? AND session_goal.schedule_id = ?
       ORDER BY session_goal.ordinal, session_goal.id`,
    ).bind(orgId, scheduleId).all<DbRow>(),
    env.DB.prepare(
      `SELECT id, body, ordinal FROM schedule_custom_questions
       WHERE org_id = ? AND schedule_id = ?
       ORDER BY ordinal, id`,
    ).bind(orgId, scheduleId).all<DbRow>(),
  ]);
  return {
    sessionGoals: goals.results.map((row) => ({
      id: stringValue(row.id),
      body: stringValue(row.body),
      caseGoalId: nullableString(row.case_goal_id),
      caseGoalTitle: nullableString(row.case_goal_title),
      ordinal: integerValue(row.ordinal) ?? 0,
    })),
    customQuestions: questions.results.map((row) => ({
      id: stringValue(row.id),
      body: stringValue(row.body),
      ordinal: integerValue(row.ordinal) ?? 0,
    })),
  };
}

/**
 * 일정별 세션 목표·맞춤형 질문 조회 (D28). 권한은 해당 참여사업 접근(담당 실무자·admin)으로
 * 게이트하고 감사(read)를 남긴다. 상담 유형·방법(#36)도 일정 행에서 함께 싣는다.
 */
export async function getScheduleSessionPlan(
  env: Env,
  actor: Actor,
  scheduleId: string,
): Promise<ScheduleSessionPlan> {
  assertOpaqueIdentifier(scheduleId, 'schedule id');
  const schedule = await getCounselingScheduleForOrg(env, actor.orgId, scheduleId);
  await assertSupportCaseAccess(env, actor, schedule.supportCaseId);
  const entries = await loadScheduleSessionEntries(env, actor.orgId, scheduleId);
  await writeCanonicalAudit(env, actor, {
    action: 'read',
    targetTable: 'schedule_session_goals',
    targetId: scheduleId,
    beneficiaryId: schedule.beneficiaryId,
    supportCaseId: schedule.supportCaseId,
  });
  return {
    scheduleId,
    sessionKind: schedule.sessionKind,
    channel: schedule.channel,
    sessionGoals: entries.sessionGoals,
    customQuestions: entries.customQuestions,
  };
}

/** 기록 종류(CCC-7 · 0014). 일정 session_kind(0010)와 값 어휘 통일. */
export const SESSION_KINDS = ['regular', 'intake'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

export interface CounselingRecord {
  id: string;
  supportCaseId: string;
  counselorId: string;
  heldAt: string;
  channel: Session['channel'];
  memo: string;
  // 기록 종류(CCC-7). 기존 행·정기 기록은 'regular', 인테이크는 'intake'.
  kind: SessionKind;
  aiSummary: string | null;
  approvedAt: string | null;
  createdAt: string;
}
export interface CounselingRecordGasScore {
  goalId: string;
  score: -2 | -1 | 0 | 1 | 2;
}

export interface CounselingRecordCompletedSchedule {
  id: string;
  scheduledAt: string;
  status: CounselingScheduleStatus;
  version: number;
}

export interface CounselingRecordDetails extends CounselingRecord {
  completedSchedule: CounselingRecordCompletedSchedule | null;
  gasScores: CounselingRecordGasScore[];
  actionItems: ActionItem[];
  confirmedFlags: Flag[];
  // 이 회차 시점의 6영역 스냅샷(CCC-8). 스냅샷 미보유 회차는 빈 배열.
  lifeAreaSnapshot: LifeAreaSnapshotEntry[];
  /**
   * D47 접힌 줄의 핵심 한 줄. **승인된 AI 한 줄만** 싣는다(0025 · R2) — 미승인·녹음 없음·
   * 레거시 초안이면 null 이고, 화면은 `memoExcerpt` 로 낮춰 '승인 대기' 배지를 붙인다(D5).
   * 브리핑 영역 ②와 같은 출처라 두 화면의 같은 회차가 같은 문장을 보여준다.
   */
  aiOneLiner: string | null;
  /** D47 접힌 줄의 폴백 발췌 — 수기 메모 첫 줄 최대 60자. 메모가 비면 null. */
  memoExcerpt: string | null;
  /**
   * D47 회차 카드의 '이번 상담의 목표'(GAS 가 있던 자리). **출처가 둘이고 중복 저장이 아니다**
   * (0016 주석): 일정에 연결된 회차는 `schedule_session_goals`(0009) 가 SSOT 이고, 일정 없이
   * 쓴 회차만 `record_details.sessionGoalNote` 를 쓴다. 일정 쪽을 먼저 보고 없으면 메모 쪽으로
   * 내려간다. **둘 다 없으면 빈 배열**이고 화면은 블록 자체를 그리지 않는다(인테이크가 그 경우).
   */
  sessionGoals: string[];
}

export interface CounselingRecordGasScoreInput {
  goalId: string;
  score: -2 | -1 | 0 | 1 | 2;
}

export interface CounselingRecordActionItemInput {
  description: string;
  owner: 'counselor' | 'beneficiary' | 'org';
  dueDate?: string;
}

export interface CounselingRecordFlagInput {
  flagType: FlagType;
  quote?: string;
}

/** 미해결 액션 4상태 처리(CCC-5 · 설계 v0.2). done 만 resolved_at 을 채운다. */
export const ACTION_ITEM_RESOLUTION_STATUSES = ['done', 'in_progress', 'not_done', 'hold'] as const;
export type ActionItemResolutionStatus = (typeof ACTION_ITEM_RESOLUTION_STATUSES)[number];

export interface CounselingRecordActionItemResolutionInput {
  actionItemId: string;
  status: ActionItemResolutionStatus;
  note?: string;
}

/**
 * 생활 6영역 스냅샷 (CCC-8). 키·상태값의 유일 출처.
 * 영역 키·라벨 근거: docs/intake/CCC-intake-required-vs-optional-questions.md §D(D1~D6).
 * 상태 5값 근거: 같은 문서 §D("괜찮음/긴장/위기/해당없음/답변거부").
 * 이 상태는 실무자 기입값이다 — 감정 점수(R4)·리스크 플래그(D9) 와 무관.
 */
export const LIFE_AREA_KEYS = [
  'economy',        // 경제·생계
  'housing',        // 주거
  'employment',     // 일·고용·학업
  'health',         // 건강(신체)
  'mental_health',  // 심리·정서·스트레스
  'family',         // 가족·관계·돌봄
] as const;
export type LifeAreaKey = (typeof LIFE_AREA_KEYS)[number];

export const LIFE_AREA_STATUSES = [
  'okay',           // 괜찮음
  'strained',       // 긴장
  'crisis',         // 위기
  'not_applicable', // 해당없음
  'declined',       // 답변거부
] as const;
export type LifeAreaStatus = (typeof LIFE_AREA_STATUSES)[number];

/**
 * 회차별 6영역 입력. changed=false('변화 없음')면 직전 세션 스냅샷 값을 복사한다
 * (직전 없으면 미기록 — 행 미생성). changed=true 면 제출된 status(+note)로 기록한다.
 */
export interface CounselingRecordLifeAreaInput {
  areaKey: LifeAreaKey;
  changed: boolean;
  status?: LifeAreaStatus;
  note?: string;
}

/** 저장·조회되는 한 영역의 스냅샷 값. */
export interface LifeAreaSnapshotEntry {
  areaKey: LifeAreaKey;
  status: LifeAreaStatus;
  note: string | null;
}

/**
 * 정기 기록지 서술형 항목(CCC-10 · 0016 record_details). 전부 선택이며, 하나라도 채워진
 * 경우에만 details 를 보낸다(빈 객체는 거부). 값은 서술 기록일 뿐 자동 판정 입력이
 * 아니다 — 플래그 확정·GAS 점수는 여전히 실무자 몫이다(D6·D9·R5).
 */
export interface CounselingRecordDetailsInput {
  /** 이번 상담 목표 — 일정에 세션 목표가 연결되지 않은 회차에서만 기록한다(D28). */
  sessionGoalNote?: string;
  /** 지난 상담 이후 달라진 일. */
  changeSinceLast?: string;
  /** 위기·안전 확인 서술. */
  safetyNote?: string;
  /** 담당 실무자 의견(당사자 발언과 구분). */
  counselorOpinion?: string;
}

/**
 * 목표 종료 + 신설(D12). 문구 수정은 금지이므로 기존 목표를 종료(사유 필수)하고 새 목표를
 * 신설해 replaced_by_goal_id 로 잇는다. 신설 없이 종료만 하는 것도 허용한다.
 */
export interface CounselingRecordGoalTransitionInput {
  closeGoalId: string;
  closedReason: string;
  newGoalTitle?: string;
}

export interface CreateCounselingRecordInput {
  submissionId: string;
  heldAt: string;
  channel: Session['channel'];
  memo: string;
  gasScores: CounselingRecordGasScoreInput[];
  actionItems: CounselingRecordActionItemInput[];
  flags: CounselingRecordFlagInput[];
  actionItemResolutions?: CounselingRecordActionItemResolutionInput[];
  // 6영역 전체 스냅샷(CCC-8). 구 클라이언트 호환을 위해 옵션 — 생략 시 스냅샷 미저장.
  lifeAreas?: CounselingRecordLifeAreaInput[];
  // 서술형 항목(CCC-10). 생략 시 record_details 는 NULL.
  details?: CounselingRecordDetailsInput;
  // 목표 종료+신설(CCC-10 · D12). 생략 시 목표는 변경하지 않는다.
  goalTransition?: CounselingRecordGoalTransitionInput;
  scheduleId?: string;
  expectedScheduleVersion?: number;
}

/** record_details 에 담기는 서술형 키 목록(CCC-10 · 0016). 유일 출처. */
export const COUNSELING_RECORD_DETAIL_KEYS = [
  'sessionGoalNote',
  'changeSinceLast',
  'safetyNote',
  'counselorOpinion',
] as const;

export interface CounselingRecordResult {
  record: CounselingRecord;
  replayed: boolean;
}

function mapCounselingRecord(row: DbRow, aiSummary: string | null = null, approvedAt: string | null = null): CounselingRecord {
  return {
    id: stringValue(row.id),
    supportCaseId: stringValue(row.support_case_id),
    counselorId: stringValue(row.counselor_id),
    heldAt: stringValue(row.held_at),
    channel: toChannel(row.channel),
    memo: stringValue(row.memo),
    kind: row.kind === 'intake' ? 'intake' : 'regular',
    aiSummary,
    approvedAt,
    createdAt: stringValue(row.created_at),
  };
}

function assertCounselingRecordInput(input: CreateCounselingRecordInput): void {
  const hasSchedule = input.scheduleId !== undefined || input.expectedScheduleVersion !== undefined;
  const hasResolutions = input.actionItemResolutions !== undefined;
  const hasLifeAreas = input.lifeAreas !== undefined;
  const expectedKeys = ['submissionId', 'heldAt', 'channel', 'memo', 'gasScores', 'actionItems', 'flags'];
  if (hasResolutions) expectedKeys.push('actionItemResolutions');
  if (hasLifeAreas) expectedKeys.push('lifeAreas');
  if (input.details !== undefined) expectedKeys.push('details');
  if (input.goalTransition !== undefined) expectedKeys.push('goalTransition');
  if (hasSchedule) expectedKeys.push('scheduleId', 'expectedScheduleVersion');
  assertExactKeys(input, expectedKeys);
  assertCanonicalSubmissionId(input.submissionId);
  canonicalUtcInstant(input.heldAt, 'record time');
  if (input.channel !== 'in_person' && input.channel !== 'phone' && input.channel !== 'video') {
    throw new ValidationError('record channel is invalid');
  }
  assertNonBlankText(input.memo, 'record memo');
  assertBoundedArray(input.gasScores, 'GAS scores', MAX_ACTIVE_GOALS);
  assertBoundedArray(input.actionItems, 'action items', 20);
  assertBoundedArray(input.flags, 'flags', 20);
  if (hasSchedule) {
    assertOpaqueIdentifier(input.scheduleId, 'schedule id');
    if (
      typeof input.expectedScheduleVersion !== 'number'
      || !Number.isInteger(input.expectedScheduleVersion)
      || input.expectedScheduleVersion < 1
    ) {
      throw new ValidationError('schedule version is invalid');
    }
  }

  const goalIds = new Set<string>();
  for (const score of input.gasScores) {
    assertExactKeys(score, ['goalId', 'score']);
    assertOpaqueIdentifier(score.goalId, 'goal id');
    if (!Number.isInteger(score.score) || score.score < -2 || score.score > 2) {
      throw new ValidationError('GAS score is invalid');
    }
    if (goalIds.has(score.goalId)) {
      throw new ValidationError('GAS score is duplicated');
    }
    goalIds.add(score.goalId);
  }
  for (const action of input.actionItems) {
    assertExactKeys(action, action.dueDate === undefined ? ['description', 'owner'] : ['description', 'owner', 'dueDate']);
    assertNonBlankText(action.description, 'action description');
    if (action.owner !== 'counselor' && action.owner !== 'beneficiary' && action.owner !== 'org') {
      throw new ValidationError('action owner is invalid');
    }
    if (action.dueDate !== undefined) assertDateOnly(action.dueDate);
  }
  for (const flag of input.flags) {
    assertExactKeys(flag, flag.quote === undefined ? ['flagType'] : ['flagType', 'quote']);
    toFlagType(flag.flagType);
    if (flag.quote !== undefined) assertNonBlankText(flag.quote, 'flag quote');
  }
  if (input.actionItemResolutions !== undefined) {
    assertBoundedArray(input.actionItemResolutions, 'action item resolutions', 20);
    const resolvedActionIds = new Set<string>();
    for (const resolution of input.actionItemResolutions) {
      assertExactKeys(resolution, resolution.note === undefined ? ['actionItemId', 'status'] : ['actionItemId', 'status', 'note']);
      assertOpaqueIdentifier(resolution.actionItemId, 'action item id');
      if (!(ACTION_ITEM_RESOLUTION_STATUSES as readonly string[]).includes(resolution.status)) {
        throw new ValidationError('action item resolution status is invalid');
      }
      if (resolution.note !== undefined) assertNonBlankText(resolution.note, 'action item resolution note');
      if (resolvedActionIds.has(resolution.actionItemId)) {
        throw new ValidationError('action item resolution is duplicated');
      }
      resolvedActionIds.add(resolution.actionItemId);
    }
  }
  if (input.lifeAreas !== undefined) assertLifeAreaInputs(input.lifeAreas);
  if (input.details !== undefined) assertCounselingRecordDetails(input.details);
  if (input.goalTransition !== undefined) {
    assertExactKeys(
      input.goalTransition,
      input.goalTransition.newGoalTitle === undefined
        ? ['closeGoalId', 'closedReason']
        : ['closeGoalId', 'closedReason', 'newGoalTitle'],
    );
    assertOpaqueIdentifier(input.goalTransition.closeGoalId, 'goal id');
    assertNonBlankText(input.goalTransition.closedReason, 'goal closed reason');
    if (input.goalTransition.newGoalTitle !== undefined) {
      assertNonBlankText(input.goalTransition.newGoalTitle, 'goal title');
    }
  }
}

/**
 * 서술형 항목 검증(CCC-10). 알려진 키만 허용하고 값은 공백이 아닌 문자열이어야 한다.
 * 빈 객체는 거부한다 — 채운 항목이 없으면 details 자체를 생략한다(제출 해시 정합).
 */
function assertCounselingRecordDetails(details: CounselingRecordDetailsInput): void {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) {
    throw new ValidationError('record details is invalid');
  }
  const keys = Object.keys(details);
  if (keys.length === 0) throw new ValidationError('record details is empty');
  for (const key of keys) {
    if (!(COUNSELING_RECORD_DETAIL_KEYS as readonly string[]).includes(key)) {
      throw new ValidationError('record details is invalid');
    }
    assertNonBlankText((details as Record<string, unknown>)[key], `record detail ${key}`);
  }
}

/**
 * 6영역 입력 검증(CCC-8). 6영역 전부 포함(누락 거부)·중복 금지·알 수 없는 키 거부.
 * changed=true 면 유효한 status 필수(note 선택), changed=false 면 status/note 불허
 * (직전 스냅샷을 복사하므로 값을 받지 않는다).
 */
function assertLifeAreaInputs(lifeAreas: CounselingRecordLifeAreaInput[]): void {
  assertBoundedArray(lifeAreas, 'life areas', LIFE_AREA_KEYS.length);
  const seen = new Set<string>();
  for (const area of lifeAreas) {
    if (typeof area !== 'object' || area === null || typeof area.changed !== 'boolean') {
      throw new ValidationError('life area is invalid');
    }
    assertExactKeys(
      area,
      area.changed
        ? (area.note === undefined ? ['areaKey', 'changed', 'status'] : ['areaKey', 'changed', 'status', 'note'])
        : ['areaKey', 'changed'],
    );
    if (!(LIFE_AREA_KEYS as readonly string[]).includes(area.areaKey)) {
      throw new ValidationError('life area key is invalid');
    }
    if (seen.has(area.areaKey)) {
      throw new ValidationError('life area is duplicated');
    }
    seen.add(area.areaKey);
    if (area.changed) {
      if (area.status === undefined || !(LIFE_AREA_STATUSES as readonly string[]).includes(area.status)) {
        throw new ValidationError('life area status is invalid');
      }
      if (area.note !== undefined) assertNonBlankText(area.note, 'life area note');
    }
  }
  if (seen.size !== LIFE_AREA_KEYS.length) {
    throw new ValidationError('life areas must cover all six areas');
  }
}

async function assertRecordGoalsBelongToSupportCase(
  env: Env,
  orgId: string,
  supportCaseId: string,
  gasScores: CounselingRecordGasScoreInput[],
): Promise<void> {
  if (gasScores.length === 0) return;
  const goalIds = gasScores.map((score) => score.goalId);
  const placeholders = goalIds.map(() => '?').join(', ');
  const found = await env.DB.prepare(
    `SELECT id FROM goals
     WHERE org_id = ? AND support_case_id = ? AND id IN (${placeholders})`,
  ).bind(orgId, supportCaseId, ...goalIds).all<{ id: string }>();
  if (found.results.length !== goalIds.length) {
    throw new ForbiddenError('record context is unavailable');
  }
}
async function assertActionResolutionsAreOpenInSupportCase(
  env: Env,
  orgId: string,
  supportCaseId: string,
  resolutions: CounselingRecordActionItemResolutionInput[],
): Promise<void> {
  if (resolutions.length === 0) return;
  const actionItemIds = resolutions.map((resolution) => resolution.actionItemId);
  const placeholders = actionItemIds.map(() => '?').join(', ');
  const found = await env.DB.prepare(
    `SELECT id FROM action_items
     WHERE org_id = ? AND support_case_id = ? AND resolved_at IS NULL AND id IN (${placeholders})`,
  ).bind(orgId, supportCaseId, ...actionItemIds).all<{ id: string }>();
  if (found.results.length !== actionItemIds.length) {
    throw new ForbiddenError('record context is unavailable');
  }
}

async function recordReplay(
  env: Env,
  actor: Actor,
  supportCaseId: string,
  input: CreateCounselingRecordInput,
  submissionHash: string,
): Promise<CounselingRecordResult | null> {
  const row = await env.DB.prepare(
    `SELECT *
     FROM sessions
     WHERE org_id = ? AND support_case_id = ? AND submission_id = ?
     LIMIT 1`,
  ).bind(actor.orgId, supportCaseId, input.submissionId).first<DbRow>();
  if (row === null) return null;
  if (row.submitted_by !== actor.userId || row.submission_hash !== submissionHash) {
    throw new ConflictError('submission conflicts with an existing official operation');
  }
  return { record: mapCounselingRecord(row), replayed: true };
}

function mapLifeAreaSnapshotRow(row: DbRow): LifeAreaSnapshotEntry {
  return {
    areaKey: stringValue(row.area_key) as LifeAreaKey,
    status: stringValue(row.status) as LifeAreaStatus,
    note: nullableString(row.note),
  };
}

/**
 * 직전 6영역 스냅샷(CCC-8): 해당 support case 의 세션 중 스냅샷을 보유한 최신 회차의
 * 값. '변화 없음' 복사원본이자, 기록 작성 폼의 "직전 상태" 표시원이다. 순서는
 * listCounselingRecords 와 같은 held_at DESC, id DESC — 복사원본과 표시값이 일치한다.
 */
async function getLatestLifeAreaSnapshot(
  env: Env,
  orgId: string,
  supportCaseId: string,
): Promise<LifeAreaSnapshotEntry[]> {
  const rows = await env.DB.prepare(
    `SELECT snapshot.area_key, snapshot.status, snapshot.note
     FROM session_life_area_snapshots AS snapshot
     WHERE snapshot.org_id = ? AND snapshot.session_id = (
       SELECT session.id FROM sessions AS session
       WHERE session.org_id = ? AND session.support_case_id = ?
         AND EXISTS (
           SELECT 1 FROM session_life_area_snapshots AS latest
           WHERE latest.session_id = session.id
         )
       ORDER BY session.held_at DESC, session.id DESC
       LIMIT 1
     )
     ORDER BY snapshot.area_key`,
  ).bind(orgId, orgId, supportCaseId).all<DbRow>();
  return rows.results.map(mapLifeAreaSnapshotRow);
}

/**
 * Persists an immediately official manual record. The batch commits the record,
 * child facts, optional schedule completion, and the schema trigger's one
 * submit_manual_record audit; a same-key/hash retry returns the committed
 * record without another audit.
 */
export async function createCounselingRecord(
  env: Env,
  actor: Actor,
  supportCaseId: string,
  input: CreateCounselingRecordInput,
): Promise<CounselingRecordResult> {
  assertOpaqueIdentifier(supportCaseId, 'support case id');
  assertCounselingRecordInput(input);
  const supportCase = await assertSupportCaseAccess(env, actor, supportCaseId);
  if (supportCase.status !== 'active') {
    throw new ConflictError('support case is unavailable');
  }
  await assertRecordGoalsBelongToSupportCase(env, actor.orgId, supportCaseId, input.gasScores);
  const actionItemResolutions = input.actionItemResolutions ?? [];

  const submissionHash = await canonicalSha256({
    actionItemResolutions,
    actionItems: input.actionItems,
    actorId: actor.userId,
    channel: input.channel,
    details: input.details ?? null,
    flags: input.flags,
    gasScores: input.gasScores,
    goalTransition: input.goalTransition ?? null,
    heldAt: input.heldAt,
    lifeAreas: input.lifeAreas ?? null,
    memo: input.memo,
    orgId: actor.orgId,
    scheduleId: input.scheduleId ?? null,
    scheduleVersion: input.expectedScheduleVersion ?? null,
    supportCaseId,
  });
  const replay = await recordReplay(env, actor, supportCaseId, input, submissionHash);
  if (replay !== null) return replay;
  await assertActionResolutionsAreOpenInSupportCase(env, actor.orgId, supportCaseId, actionItemResolutions);

  // 목표 종료+신설(D12): 종료 대상은 이 참여사업의 활성 목표여야 하고, 종료 1건을 뺀 뒤에도
  // 활성 목표 상한(MAX_ACTIVE_GOALS)을 넘지 않아야 한다. 상한 3에서 1종료+1신설은 통과한다.
  if (input.goalTransition !== undefined) {
    const target = await env.DB.prepare(
      `SELECT id FROM goals
       WHERE org_id = ? AND support_case_id = ? AND id = ? AND status = 'active'
       LIMIT 1`,
    ).bind(actor.orgId, supportCaseId, input.goalTransition.closeGoalId).first<{ id: string }>();
    if (target === null) throw new ForbiddenError('record context is unavailable');
    const activeGoals = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM goals WHERE org_id = ? AND support_case_id = ? AND status = 'active'",
    ).bind(actor.orgId, supportCaseId).first<{ count: number }>();
    const remaining = Number(activeGoals?.count ?? 0) - 1 + (input.goalTransition.newGoalTitle === undefined ? 0 : 1);
    if (remaining > MAX_ACTIVE_GOALS) {
      throw new ValidationError(`a case can have at most ${MAX_ACTIVE_GOALS} active goals`);
    }
  }

  let schedule: CounselingSchedule | null = null;
  if (input.scheduleId !== undefined) {
    schedule = await getCounselingScheduleForOrg(env, actor.orgId, input.scheduleId);
    await assertScheduleMutationAccess(env, actor, schedule);
    if (
      schedule.beneficiaryId !== supportCase.beneficiaryId
      || schedule.supportCaseId !== supportCaseId
      || schedule.status !== 'scheduled'
      || schedule.version !== input.expectedScheduleVersion
    ) {
      throw new ConflictError('counseling schedule is unavailable');
    }
  }

  // 6영역 스냅샷 해석(CCC-8): changed=true 는 제출값, changed=false 는 직전 스냅샷 복사.
  // 직전 없는(콜드스타트) '변화 없음' 영역은 미기록 — 행을 만들지 않는다.
  const lifeAreaRows: LifeAreaSnapshotEntry[] = [];
  if (input.lifeAreas !== undefined) {
    const priorByArea = new Map(
      (await getLatestLifeAreaSnapshot(env, actor.orgId, supportCaseId)).map((entry) => [entry.areaKey, entry] as const),
    );
    for (const area of input.lifeAreas) {
      if (area.changed && area.status !== undefined) {
        lifeAreaRows.push({ areaKey: area.areaKey, status: area.status, note: area.note ?? null });
      } else if (!area.changed) {
        const prior = priorByArea.get(area.areaKey);
        if (prior !== undefined) {
          lifeAreaRows.push({ areaKey: area.areaKey, status: prior.status, note: prior.note });
        }
      }
    }
  }

  const id = newId();
  const createdAt = now();
  // 서술형 항목(CCC-10 · 0016): 채운 항목이 없으면 컬럼을 NULL 로 둔다.
  const recordDetails = input.details === undefined ? null : stringifyJson({ ...input.details });
  const activeSupportCaseGuard = `EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = ? AND org_id = ? AND beneficiary_id = ? AND status = 'active'
  )`;
  const activeSupportCaseBindings = [supportCaseId, actor.orgId, supportCase.beneficiaryId];
  const sessionExistsClause = `EXISTS (
    SELECT 1 FROM sessions
    WHERE id = ? AND org_id = ? AND support_case_id = ?
  )`;
  const sessionExistsBindings = [id, actor.orgId, supportCaseId];
  const sessionStatement = schedule === null
    ? env.DB.prepare(
      `INSERT INTO sessions (
         id, org_id, support_case_id, counselor_id, held_at, channel, memo, record_details,
         submission_id, submission_hash, submitted_by, ai_status, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?
       WHERE ${activeSupportCaseGuard}`,
    ).bind(
      id,
      actor.orgId,
      supportCaseId,
      actor.userId,
      input.heldAt,
      input.channel,
      input.memo,
      recordDetails,
      input.submissionId,
      submissionHash,
      actor.userId,
      createdAt,
      createdAt,
      ...activeSupportCaseBindings,
    )
    : env.DB.prepare(
      `INSERT INTO sessions (
         id, org_id, support_case_id, counselor_id, held_at, channel, memo, record_details,
         submission_id, submission_hash, submitted_by, ai_status, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM counseling_schedules
         WHERE id = ? AND org_id = ? AND beneficiary_id = ? AND support_case_id = ?
           AND status = 'scheduled' AND version = ?
       )
       AND ${activeSupportCaseGuard}`,
    ).bind(
      id,
      actor.orgId,
      supportCaseId,
      actor.userId,
      input.heldAt,
      input.channel,
      input.memo,
      recordDetails,
      input.submissionId,
      submissionHash,
      actor.userId,
      createdAt,
      createdAt,
      schedule.id,
      actor.orgId,
      supportCase.beneficiaryId,
      supportCaseId,
      input.expectedScheduleVersion,
      ...activeSupportCaseBindings,
    );

  const statements: D1PreparedStatement[] = [sessionStatement];

  // 목표 종료+신설(D12): 신규 목표를 먼저 INSERT 한 뒤 종료 UPDATE 가 replaced_by_goal_id 로
  // 잇는다(외래키 순서). 종료는 status·closed_reason·closed_at·replaced_by_goal_id 만 건드리며
  // 목표 문구(title)는 절대 수정하지 않는다. goals 는 세션 트리거 감사 대상이 아니라 명시 감사(D14).
  if (input.goalTransition !== undefined) {
    const newGoalId = input.goalTransition.newGoalTitle === undefined ? null : newId();
    if (newGoalId !== null && input.goalTransition.newGoalTitle !== undefined) {
      statements.push(env.DB.prepare(
        `INSERT INTO goals (id, org_id, support_case_id, title, scale_criteria, status, created_at)
         SELECT ?, ?, ?, ?, NULL, 'active', ?
         WHERE ${sessionExistsClause}`,
      ).bind(
        newGoalId,
        actor.orgId,
        supportCaseId,
        input.goalTransition.newGoalTitle.trim(),
        createdAt,
        ...sessionExistsBindings,
      ));
      statements.push(conditionalCanonicalAuditStatement(env, actor, {
        action: 'create',
        targetTable: 'goals',
        targetId: newGoalId,
        beneficiaryId: supportCase.beneficiaryId,
        supportCaseId,
        detail: { kind: 'regular', replacesGoalId: input.goalTransition.closeGoalId },
      }));
    }
    statements.push(env.DB.prepare(
      `UPDATE goals
       SET status = 'closed', closed_reason = ?, closed_at = ?, replaced_by_goal_id = ?
       WHERE id = ? AND org_id = ? AND support_case_id = ? AND status = 'active'
         AND ${sessionExistsClause}`,
    ).bind(
      input.goalTransition.closedReason.trim(),
      createdAt,
      newGoalId,
      input.goalTransition.closeGoalId,
      actor.orgId,
      supportCaseId,
      ...sessionExistsBindings,
    ));
    statements.push(conditionalCanonicalAuditStatement(env, actor, {
      action: 'update',
      targetTable: 'goals',
      targetId: input.goalTransition.closeGoalId,
      beneficiaryId: supportCase.beneficiaryId,
      supportCaseId,
      detail: { closed: true, replacedByGoalId: newGoalId },
    }));
  }

  for (const score of input.gasScores) {
    statements.push(env.DB.prepare(
      `INSERT INTO session_goal_scores (
         id, org_id, session_id, goal_id, score, evidence_quote, scored_by, created_at
       )
       SELECT ?, ?, ?, ?, ?, NULL, ?, ?
       WHERE ${sessionExistsClause}`,
    ).bind(
      newId(),
      actor.orgId,
      id,
      score.goalId,
      score.score,
      actor.userId,
      createdAt,
      ...sessionExistsBindings,
    ));
  }
  for (const action of input.actionItems) {
    statements.push(env.DB.prepare(
      `INSERT INTO action_items (
         id, org_id, support_case_id, session_id, description, owner, due_date, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE ${sessionExistsClause}`,
    ).bind(
      newId(),
      actor.orgId,
      supportCaseId,
      id,
      action.description,
      action.owner,
      action.dueDate ?? null,
      createdAt,
      ...sessionExistsBindings,
    ));
  }
  for (const flag of input.flags) {
    statements.push(env.DB.prepare(
      `INSERT INTO flags (
         id, org_id, support_case_id, session_id, flag_type, quote, source, review_status,
         reviewed_by, reviewed_at, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, 'counselor', 'confirmed', ?, ?, ?
       WHERE ${sessionExistsClause}`,
    ).bind(
      newId(),
      actor.orgId,
      supportCaseId,
      id,
      flag.flagType,
      flag.quote ?? null,
      actor.userId,
      createdAt,
      createdAt,
      ...sessionExistsBindings,
    ));
  }
  for (const area of lifeAreaRows) {
    statements.push(env.DB.prepare(
      `INSERT INTO session_life_area_snapshots (
         id, org_id, session_id, area_key, status, note, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE ${sessionExistsClause}`,
    ).bind(
      newId(),
      actor.orgId,
      id,
      area.areaKey,
      area.status,
      area.note,
      createdAt,
      ...sessionExistsBindings,
    ));
  }
  for (const resolution of actionItemResolutions) {
    const resolvedAt = resolution.status === 'done' ? createdAt : null;
    const resolvedBy = resolution.status === 'done' ? actor.userId : null;
    statements.push(env.DB.prepare(
      `UPDATE action_items
       SET resolution_status = ?, resolution_note = ?, resolution_at = ?, resolution_session_id = ?,
           resolved_at = ?, resolved_by = ?
       WHERE id = ? AND org_id = ? AND support_case_id = ? AND resolved_at IS NULL
         AND ${sessionExistsClause}`,
    ).bind(
      resolution.status,
      resolution.note ?? null,
      createdAt,
      id,
      resolvedAt,
      resolvedBy,
      resolution.actionItemId,
      actor.orgId,
      supportCaseId,
      ...sessionExistsBindings,
    ));
    statements.push(env.DB.prepare(
      `INSERT INTO audit_log (
         org_id, actor_id, actor_role, action, target_table, target_id, case_id,
         beneficiary_id, support_case_id, detail, created_at
       )
       SELECT ?, ?, ?, 'update', 'action_items', ?, NULL, ?, ?, ?, datetime('now')
       WHERE ${sessionExistsClause}`,
    ).bind(
      actor.orgId,
      actor.userId,
      actor.role,
      resolution.actionItemId,
      supportCase.beneficiaryId,
      supportCaseId,
      stringifyJson({ resolutionStatus: resolution.status }),
      ...sessionExistsBindings,
    ));
  }
  if (schedule !== null) {
    statements.push(env.DB.prepare(
      `UPDATE counseling_schedules
       SET status = 'completed', completed_session_id = ?, completed_by_actor_id = ?,
           completed_at = ?, updated_by_actor_id = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND org_id = ? AND beneficiary_id = ? AND support_case_id = ?
         AND status = 'scheduled' AND version = ?
         AND ${sessionExistsClause}`,
    ).bind(
      id,
      actor.userId,
      createdAt,
      actor.userId,
      createdAt,
      schedule.id,
      actor.orgId,
      supportCase.beneficiaryId,
      supportCaseId,
      input.expectedScheduleVersion,
      ...sessionExistsBindings,
    ));
  }

  try {
    await env.DB.batch(statements);
    const persisted = await env.DB.prepare(
      `SELECT id FROM sessions
       WHERE id = ? AND org_id = ? AND support_case_id = ?
         AND submission_id = ? AND submission_hash = ? AND submitted_by = ?
       LIMIT 1`,
    ).bind(
      id,
      actor.orgId,
      supportCaseId,
      input.submissionId,
      submissionHash,
      actor.userId,
    ).first<{ id: string }>();
    if (persisted === null) {
      throw new ConflictError('counseling record is unavailable');
    }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const matched = await recordReplay(env, actor, supportCaseId, input, submissionHash);
    if (matched !== null) return matched;
    throw error;
  }
  return {
    record: {
      id,
      supportCaseId,
      counselorId: actor.userId,
      heldAt: input.heldAt,
      channel: input.channel,
      memo: input.memo,
      kind: 'regular',
      aiSummary: null,
      approvedAt: null,
      createdAt,
    },
    replayed: false,
  };
}

// ============================================================================
// 인테이크 기록 (createIntakeRecord) — CCC-7 · 티켓 #54 · 인테이크 설계 v0.3
// 첫 상담 기준선(동의·원하는 도움 3문·6영역·목표+GAS 기준·다음 행동)을 한 번의 호출로
// 원자 저장한다. 정기 기록(createCounselingRecord)과 분리된 함수다 — 인테이크는 목표를
// 신설하고(정기는 기존 목표에 GAS만), 6영역을 직접 입력하며('변화 없음' 개념 없음),
// 동의를 기록하고, 케이스당 1회로 제한된다.
// ============================================================================

/** 원하는 도움 3문(P1, 코어의 심장). intake_details JSON 에 격리 저장 — 브리핑·통계 제외. */
export interface IntakeHelpNarrativeInput {
  todayHelp: string;      // 오늘 어떤 도움을 받고 싶어서 오셨나요?
  hardestPoint: string;   // 지금 가장 힘든 점 / 먼저 해결하고 싶은 것은?
  desiredChange: string;  // 상황이 어떻게 달라지면 좋겠나요?
}

/** 인테이크 6영역 기준선(P1). 정기와 달리 6영역 전부 상태를 직접 입력한다(복사 개념 없음). */
export interface IntakeLifeAreaInput {
  areaKey: LifeAreaKey;
  status: LifeAreaStatus;
  note?: string;
}

/** 인테이크 목표(P1 → goals, D12·D6). scaleCriteria 는 GAS 기준(-2~+2 정의) 자유 JSON. */
export interface IntakeGoalInput {
  title: string;
  scaleCriteria?: unknown;
}

export interface IntakeActionItemInput {
  description: string;
  owner: 'counselor' | 'beneficiary' | 'org';
  dueDate?: string;
}

/**
 * 동의 2체크(v0.3). 둘 다 true 여야 인테이크 성립.
 * privacy → consent_privacy_at, recordingAi → consent_recording_at·consent_text_ai_at
 * 2컬럼 동시 기록(D15 법률 검토 결과에 따라 마이그레이션 없이 되돌리기 쉬운 구조).
 */
export interface IntakeConsentInput {
  privacy: boolean;
  recordingAi: boolean;
}

// --------------------------------------------------------------------------
// P3·P4 서술형 답변 (CCC-9) — 하나의 어휘로 통일
// 설계 v0.3 은 "모든 질문에 답변거부/모름/해당없음 허용"을 요구한다(§0-5). 질문마다
// 다른 필드를 만들면 5개 층(게이트웨이·핸들러·api·액션·위저드)에 같은 분기가 23번
// 복제된다. 대신 질문 키를 고정 어휘로 두고 답변 1건을 {key, response, text} 로 통일해,
// 검증기·파서·컴포넌트를 각각 하나만 둔다. 빈 문자열과 '답변거부'가 저장에서 구분된다.
// 저장 위치는 sessions.intake_details JSON(확장 슬롯 격리 — 브리핑·통계 제외).
// --------------------------------------------------------------------------

/**
 * 서술형·선택형 답변 키 고정 어휘. 화면 문구·선택값 목록은 위저드가 갖고, 저장은 이 키로 한다.
 *
 * 2026-07-28 D41·D42: 인테이크 정본 질문지(`PRD/intake-questionnaire-v1.md`) 4부의 항목을
 * 이 어휘로 전부 덮는다. 선택형도 같은 {key,response,text} 로 저장한다 — 선택값 문자열이
 * text 로 들어가고, '무응답'·'해당 없음'은 text 대신 response 코드로 남는다(빈칸과 구분).
 * 구 6단계 위저드가 쓰던 키는 지우지 않는다(기존 기록의 해석 어휘라 삭제하면 과거 JSON 이
 * 읽히지 않는다). 화면에서 안 쓰는 키는 그냥 오지 않을 뿐이다.
 */
export const INTAKE_ANSWER_KEYS = [
  // ── 구 6단계 위저드 어휘(기존 기록 해석용, 화면에서는 일부만 계속 쓴다) ──
  'referral_path', 'referral_org', 'referral_reason',
  'more_since', 'more_trigger', 'more_focus',
  'life_detail_economy', 'life_detail_housing', 'life_detail_employment',
  'life_detail_health', 'life_detail_mental_health', 'life_detail_family',
  'crisis_immediate_risk', 'crisis_needed_connection', 'crisis_safety_status', 'crisis_emergency_contact',
  'strength_personal', 'strength_relational', 'strength_past_coping', 'strength_resources',
  'participation_availability', 'participation_transport', 'participation_constraint',
  // ── 1. 상담 신청 및 기본정보 ──
  // 1-2 공적급여·수급자 여부
  'welfare_basic_livelihood', 'welfare_benefit_type', 'welfare_near_poverty', 'welfare_other',
  // 1-3 상담 운영정보(상담일=heldAt·실무자=작성자·회차=컨텍스트는 답변이 아니라 자동값)
  'counsel_method', 'contact_time', 'contact_caution',
  // 1-4 상담 신청 사유
  'application_reason', 'application_reason_detail',
  // ── 2. 현재 생활상황 ──
  'difficulty_areas',
  'economy_income_type', 'economy_monthly_income', 'economy_monthly_expense',
  'economy_arrears', 'economy_debt_types',
  'employment_status', 'employment_income_stability', 'employment_detail',
  'housing_type', 'housing_instability', 'housing_detail',
  'health_physical', 'health_care_barrier', 'health_stress', 'health_daily_impact', 'health_detail',
  'family_household_type', 'family_care_burden', 'family_detail',
  // ── 3. 필요한 도움과 활용 가능한 자원 ──
  'need_primary', 'need_secondary', 'need_detail',
  'previous_support_detail',
  'strength_detail',
  // ── 4. 상담 정리와 후속관리 ──
  'participation_barrier', 'participation_preferred_method', 'participation_detail',
  // 4-3 긴급도·주요 지원방향은 실무자가 직접 고른다 — AI 제안·자동값 없음(D41 ③ · R5).
  'summary_urgency', 'summary_direction',
] as const;
export type IntakeAnswerKey = (typeof INTAKE_ANSWER_KEYS)[number];

/** 답변 종류. 'answered' 만 text 를 갖고, 나머지 3종은 text 를 두지 않는다. */
export const INTAKE_ANSWER_RESPONSES = ['answered', 'declined', 'unknown', 'not_applicable'] as const;
export type IntakeAnswerResponse = (typeof INTAKE_ANSWER_RESPONSES)[number];

export interface IntakeAnswerInput {
  key: IntakeAnswerKey;
  response: IntakeAnswerResponse;
  text?: string;
}

/**
 * ① 시작 "기본정보 더 적기"(P4)의 추가 개인정보. 금고(participant_pii_vault)에 기존
 * AES-GCM 헬퍼로 암호화 저장한다(D3, 마이그레이션 0015). 실명·연락처·계좌·이메일은
 * 이 경로로 쓰지 않는다 — 그쪽은 admin 전용 updateParticipantPii 가 계속 유일한 관문이다.
 */
export const INTAKE_EXTENDED_PII_FIELDS = ['birthDate', 'region', 'emergencyContact', 'gender'] as const;
export type IntakeExtendedPiiField = (typeof INTAKE_EXTENDED_PII_FIELDS)[number];

export interface IntakeExtendedPiiInput {
  birthDate?: string;        // YYYY-MM-DD (달력 또는 직접 입력)
  region?: string;           // 거주 지역
  emergencyContact?: string; // 긴급 연락처
  gender?: string;           // 성별(자유 입력 — 고정 목록으로 좁히지 않는다, §0-4)
}

export type IntakeExtendedPii = Record<IntakeExtendedPiiField, string | null>;

/**
 * 4-2 추가 확인사항 표. 구 ⑤ "추가 확인 필요 정보"와 같은 구조를 이어 쓰고(D42), 정본
 * 질문지의 4열(추가 확인사항 / 필요한 이유 / 확인 방법 / 확인 예정 시점)을 담도록
 * reason·method·dueNote 를 덧붙였다. dueNote 는 '다음 상담 전' 같은 서술을 허용하려고
 * 날짜형 dueDate 와 따로 둔다 — 정본 예시가 날짜가 아니다.
 */
export interface IntakeAdditionalItemInput {
  item: string;
  owner?: string;
  dueDate?: string;
  reason?: string;
  method?: string;
  dueNote?: string;
}

/** 2-1 대출·부채 현황 반복 행. 채무가 없으면 첫 행에 '해당 없음'을 적는다(정본 참고). */
export interface IntakeDebtEntryInput {
  creditor: string;
  kind?: string;
  balance?: string;
  monthlyPayment?: string;
  arrearsStatus?: string;
}

/** 3-3 현재 연계된 기관·서비스 반복 행. 연계 자원이 없으면 첫 행에 '해당 없음'. */
export interface IntakeLinkedOrgInput {
  orgName: string;
  serviceName?: string;
  supportDetail?: string;
  usagePeriod?: string;
  progressStatus?: string;
}

/** ⑤ 다음 만남(P3). 저장 후 상담 일정 등록 화면으로 이어 붙인다(schedules, D28). */
export interface IntakeNextMeetingInput {
  heldAt: string;
  channel: Session['channel'];
}

/**
 * 인테이크 저장 입력.
 *
 * `red` 2026-07-28 D42: consent·helpNarrative·lifeAreas·goals·actionItems 5종은 **선택**이다.
 * 정본 질문지(D41)에 대응하는 항목이 없기 때문이다 — 동의 입력은 당사자 등록 화면으로
 * 옮겼고(D42 ②), 목표 입력은 통째로 빠졌으며(D42 ③ · D43), 원하는 도움 3문·6영역 상태·
 * 다음 행동은 정본에 없다. 값을 지어내 채우는 대신 안 보내는 쪽을 택했다. 주면 예전과
 * 똑같이 검증·저장하므로 기존 호출부·기록은 그대로 산다.
 */
export interface CreateIntakeRecordInput {
  submissionId: string;
  heldAt: string;
  channel: Session['channel'];
  consent?: IntakeConsentInput;
  helpNarrative?: IntakeHelpNarrativeInput;
  lifeAreas?: IntakeLifeAreaInput[];
  goals?: IntakeGoalInput[];
  actionItems?: IntakeActionItemInput[];
  answers?: IntakeAnswerInput[];
  extendedPii?: IntakeExtendedPiiInput;
  additionalItems?: IntakeAdditionalItemInput[];
  debts?: IntakeDebtEntryInput[];
  linkedOrgs?: IntakeLinkedOrgInput[];
  nextMeeting?: IntakeNextMeetingInput;
  managerOpinion?: string;
  scheduleId?: string;
  expectedScheduleVersion?: number;
}

export interface IntakeRecordResult {
  record: CounselingRecord;
  replayed: boolean;
}

/** 인테이크 작성 컨텍스트(회차 자동값·당사자 표시·기존 인테이크 여부). */
export interface IntakeRecordContext {
  beneficiaryId: string;
  supportCaseId: string;
  // D31 실명 기본 표시(역할 기준). 미기입이면 null. 화면 조회당 read_participant_pii 감사 1건.
  participant: { name: string | null; phone: string | null; email: string | null };
  // 자동 표시용 회차 = 기존 세션 수 + 1(P2).
  sessionSequence: number;
  // 케이스에 이미 인테이크(kind='intake')가 있으면 재작성 불가(1회 규칙).
  hasIntake: boolean;
  // 1-1 기본정보 표시용 금고 값(D42 ① — 인테이크 화면은 읽기만 한다). 감사는 화면 조회 1건에 합산.
  extendedPii: IntakeExtendedPii;
  // 1단계 동의 상태 표시용(D42 ②). 입력은 당사자 등록 화면 몫이라 여기서는 기록 여부만 읽는다.
  consent: { privacy: boolean; recordingAi: boolean };
  // 저장된 인테이크 내용(2026-08-08 Q "확인/수정"). hasIntake 가 true 일 때만 채워진다.
  // 위저드가 소유한 필드만 싣는다 — 동의·기본정보(금고)는 각자의 화면 몫이라 싣지 않는다.
  saved: IntakeSavedRecord | null;
  /**
   * 이 참여 사업의 다음 예정 일정(CCC-57). 인테이크를 저장할 때 이 일정을 완료로 넘기려면
   * 위저드가 id 와 version 을 알아야 한다. 그 배선이 없어서 인테이크를 마쳐도 일정이
   * 계속 '예정'으로 남아 있었다. 예정 건이 없으면 null 이고, 그때 위저드는 조작 칸을
   * 아예 그리지 않는다. 선정 규칙은 getNextCounselingScheduleForSupportCase 와 같다.
   */
  schedule: CounselingSchedule | null;
}

/**
 * 저장된 인테이크의 위저드 소유분(2026-08-08 Q "확인/수정"). intake_details JSON 중
 * 현행 위저드가 쓰고 고칠 수 있는 것만 꺼낸다. 구 6단계 위저드의 유산 키
 * (helpNarrative·nextMeeting)는 화면에 없으므로 싣지 않는다 — 수정 저장에서도 보존만 한다.
 */
export interface IntakeSavedRecord {
  sessionId: string;
  heldAt: string;
  channel: Session['channel'];
  answers: IntakeAnswerInput[];
  debts: IntakeDebtEntryInput[];
  linkedOrgs: IntakeLinkedOrgInput[];
  additionalItems: IntakeAdditionalItemInput[];
  managerOpinion: string | null;
}

function assertIntakeLifeAreaInputs(lifeAreas: IntakeLifeAreaInput[]): void {
  assertBoundedArray(lifeAreas, 'life areas', LIFE_AREA_KEYS.length);
  const seen = new Set<string>();
  for (const area of lifeAreas) {
    if (typeof area !== 'object' || area === null) {
      throw new ValidationError('life area is invalid');
    }
    assertExactKeys(area, area.note === undefined ? ['areaKey', 'status'] : ['areaKey', 'status', 'note']);
    if (!(LIFE_AREA_KEYS as readonly string[]).includes(area.areaKey)) {
      throw new ValidationError('life area key is invalid');
    }
    if (seen.has(area.areaKey)) {
      throw new ValidationError('life area is duplicated');
    }
    seen.add(area.areaKey);
    if (!(LIFE_AREA_STATUSES as readonly string[]).includes(area.status)) {
      throw new ValidationError('life area status is invalid');
    }
    if (area.note !== undefined) assertNonBlankText(area.note, 'life area note');
  }
  if (seen.size !== LIFE_AREA_KEYS.length) {
    throw new ValidationError('life areas must cover all six areas');
  }
}

/** 서술형 답변(P3·P4) 공통 검증 — 키는 고정 어휘, 중복 금지, text 는 'answered' 에만. */
function assertIntakeAnswerInputs(answers: IntakeAnswerInput[]): void {
  assertBoundedArray(answers, 'intake answers', INTAKE_ANSWER_KEYS.length);
  const seen = new Set<string>();
  for (const answer of answers) {
    if (typeof answer !== 'object' || answer === null) {
      throw new ValidationError('intake answer is invalid');
    }
    assertExactKeys(answer, answer.text === undefined ? ['key', 'response'] : ['key', 'response', 'text']);
    if (!(INTAKE_ANSWER_KEYS as readonly string[]).includes(answer.key)) {
      throw new ValidationError('intake answer key is invalid');
    }
    if (seen.has(answer.key)) {
      throw new ValidationError('intake answer is duplicated');
    }
    seen.add(answer.key);
    if (!(INTAKE_ANSWER_RESPONSES as readonly string[]).includes(answer.response)) {
      throw new ValidationError('intake answer response is invalid');
    }
    // 답변거부·모름·해당없음은 본문을 갖지 않는다 — 빈 문자열과 구분되게 저장한다.
    if (answer.response === 'answered') {
      assertNonBlankText(answer.text, 'intake answer text');
    } else if (answer.text !== undefined) {
      throw new ValidationError('intake answer text is invalid');
    }
  }
}

/** 추가 개인정보(P4). 준 필드만 갱신하고, 빈 패치는 거부한다. */
function assertIntakeExtendedPiiInput(input: IntakeExtendedPiiInput): void {
  const present = INTAKE_EXTENDED_PII_FIELDS.filter((field) => input[field] !== undefined);
  assertExactKeys(input, present);
  if (present.length === 0) {
    throw new ValidationError('extended PII patch is empty');
  }
  for (const field of present) {
    assertNonBlankText(input[field], `participant ${field}`);
  }
  if (input.birthDate !== undefined) {
    assertDateOnly(input.birthDate);
  }
}

function assertIntakeAdditionalItemInputs(items: IntakeAdditionalItemInput[]): void {
  assertBoundedArray(items, 'additional items', 20);
  for (const entry of items) {
    if (typeof entry !== 'object' || entry === null) {
      throw new ValidationError('additional item is invalid');
    }
    const expected = ['item'];
    if (entry.owner !== undefined) expected.push('owner');
    if (entry.dueDate !== undefined) expected.push('dueDate');
    if (entry.reason !== undefined) expected.push('reason');
    if (entry.method !== undefined) expected.push('method');
    if (entry.dueNote !== undefined) expected.push('dueNote');
    assertExactKeys(entry, expected);
    assertNonBlankText(entry.item, 'additional item');
    if (entry.owner !== undefined) assertNonBlankText(entry.owner, 'additional item owner');
    if (entry.dueDate !== undefined) assertDateOnly(entry.dueDate);
    if (entry.reason !== undefined) assertNonBlankText(entry.reason, 'additional item reason');
    if (entry.method !== undefined) assertNonBlankText(entry.method, 'additional item method');
    if (entry.dueNote !== undefined) assertNonBlankText(entry.dueNote, 'additional item due note');
  }
}

/**
 * 반복 행 표 공통 검증(2-1 부채·3-3 연계 기관). 첫 열만 필수이고 나머지는 준 것만 검사한다 —
 * assertIntakeAdditionalItemInputs 와 같은 모양을 유지해 표가 늘어도 분기가 복제되지 않는다.
 */
function assertIntakeTableRows(
  rows: Array<Record<string, unknown>>,
  label: string,
  requiredKey: string,
  optionalKeys: readonly string[],
): void {
  assertBoundedArray(rows, label, 20);
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) {
      throw new ValidationError(`${label} row is invalid`);
    }
    const expected = [requiredKey, ...optionalKeys.filter((key) => row[key] !== undefined)];
    assertExactKeys(row, expected);
    for (const key of expected) {
      assertNonBlankText(row[key], `${label} ${key}`);
    }
  }
}

const INTAKE_DEBT_OPTIONAL_KEYS = ['kind', 'balance', 'monthlyPayment', 'arrearsStatus'] as const;
const INTAKE_LINKED_ORG_OPTIONAL_KEYS = ['serviceName', 'supportDetail', 'usagePeriod', 'progressStatus'] as const;

function assertIntakeRecordInput(input: CreateIntakeRecordInput): void {
  const hasSchedule = input.scheduleId !== undefined || input.expectedScheduleVersion !== undefined;
  const hasManagerOpinion = input.managerOpinion !== undefined;
  const expectedKeys = ['submissionId', 'heldAt', 'channel'];
  if (input.consent !== undefined) expectedKeys.push('consent');
  if (input.helpNarrative !== undefined) expectedKeys.push('helpNarrative');
  if (input.lifeAreas !== undefined) expectedKeys.push('lifeAreas');
  if (input.goals !== undefined) expectedKeys.push('goals');
  if (input.actionItems !== undefined) expectedKeys.push('actionItems');
  if (input.answers !== undefined) expectedKeys.push('answers');
  if (input.extendedPii !== undefined) expectedKeys.push('extendedPii');
  if (input.additionalItems !== undefined) expectedKeys.push('additionalItems');
  if (input.debts !== undefined) expectedKeys.push('debts');
  if (input.linkedOrgs !== undefined) expectedKeys.push('linkedOrgs');
  if (input.nextMeeting !== undefined) expectedKeys.push('nextMeeting');
  if (hasManagerOpinion) expectedKeys.push('managerOpinion');
  if (hasSchedule) expectedKeys.push('scheduleId', 'expectedScheduleVersion');
  assertExactKeys(input, expectedKeys);
  assertCanonicalSubmissionId(input.submissionId);
  canonicalUtcInstant(input.heldAt, 'record time');
  if (input.channel !== 'in_person' && input.channel !== 'phone' && input.channel !== 'video') {
    throw new ValidationError('record channel is invalid');
  }

  // 동의 2체크 — 주면 둘 다 true 여야 한다. 안 주면 동의 기록을 만들지 않는다(D42 ②).
  if (input.consent !== undefined) {
    assertExactKeys(input.consent, ['privacy', 'recordingAi']);
    if (input.consent.privacy !== true || input.consent.recordingAi !== true) {
      throw new ValidationError('intake consent is required');
    }
  }

  // 원하는 도움 3문 — 주면 전부 비어있지 않은 문자열.
  if (input.helpNarrative !== undefined) {
    assertExactKeys(input.helpNarrative, ['todayHelp', 'hardestPoint', 'desiredChange']);
    assertNonBlankText(input.helpNarrative.todayHelp, 'help narrative todayHelp');
    assertNonBlankText(input.helpNarrative.hardestPoint, 'help narrative hardestPoint');
    assertNonBlankText(input.helpNarrative.desiredChange, 'help narrative desiredChange');
  }

  // 6영역 기준선 — 주면 6영역 전부.
  if (input.lifeAreas !== undefined) assertIntakeLifeAreaInputs(input.lifeAreas);

  // 목표 1~3(D12·D6). GAS 기준(scaleCriteria)은 자유 JSON. 인테이크 화면은 더 이상 보내지
  // 않지만(D42 ③ · D43) 다른 호출부가 주면 예전 계약대로 검증한다.
  if (input.goals !== undefined) {
    assertBoundedArray(input.goals, 'goals', MAX_ACTIVE_GOALS);
    if (input.goals.length < 1) throw new ValidationError('at least one goal is required');
    for (const goal of input.goals) {
      assertExactKeys(goal, goal.scaleCriteria === undefined ? ['title'] : ['title', 'scaleCriteria']);
      assertNonBlankText(goal.title, 'goal title');
    }
  }

  // 다음 행동 — 주면 1건 이상(→ action_items).
  if (input.actionItems !== undefined) {
  assertBoundedArray(input.actionItems, 'action items', 20);
  if (input.actionItems.length < 1) throw new ValidationError('at least one action item is required');
  for (const action of input.actionItems) {
    assertExactKeys(action, action.dueDate === undefined ? ['description', 'owner'] : ['description', 'owner', 'dueDate']);
    assertNonBlankText(action.description, 'action description');
    if (action.owner !== 'counselor' && action.owner !== 'beneficiary' && action.owner !== 'org') {
      throw new ValidationError('action owner is invalid');
    }
    if (action.dueDate !== undefined) assertDateOnly(action.dueDate);
  }
  }

  // 나머지는 전부 선택. 있으면 형식만 강제한다(비면 인테이크 성립에 영향 없음).
  if (input.answers !== undefined) assertIntakeAnswerInputs(input.answers);
  if (input.extendedPii !== undefined) assertIntakeExtendedPiiInput(input.extendedPii);
  if (input.additionalItems !== undefined) assertIntakeAdditionalItemInputs(input.additionalItems);
  if (input.debts !== undefined) {
    assertIntakeTableRows(
      input.debts as unknown as Array<Record<string, unknown>>,
      'debts',
      'creditor',
      INTAKE_DEBT_OPTIONAL_KEYS,
    );
  }
  if (input.linkedOrgs !== undefined) {
    assertIntakeTableRows(
      input.linkedOrgs as unknown as Array<Record<string, unknown>>,
      'linked orgs',
      'orgName',
      INTAKE_LINKED_ORG_OPTIONAL_KEYS,
    );
  }
  if (input.nextMeeting !== undefined) {
    assertExactKeys(input.nextMeeting, ['heldAt', 'channel']);
    canonicalUtcInstant(input.nextMeeting.heldAt, 'next meeting time');
    if (
      input.nextMeeting.channel !== 'in_person'
      && input.nextMeeting.channel !== 'phone'
      && input.nextMeeting.channel !== 'video'
    ) {
      throw new ValidationError('next meeting channel is invalid');
    }
  }

  if (hasManagerOpinion) assertNonBlankText(input.managerOpinion, 'manager opinion');

  if (hasSchedule) {
    assertOpaqueIdentifier(input.scheduleId, 'schedule id');
    if (
      typeof input.expectedScheduleVersion !== 'number'
      || !Number.isInteger(input.expectedScheduleVersion)
      || input.expectedScheduleVersion < 1
    ) {
      throw new ValidationError('schedule version is invalid');
    }
  }
}

async function intakeRecordReplay(
  env: Env,
  actor: Actor,
  supportCaseId: string,
  submissionId: string,
  submissionHash: string,
): Promise<IntakeRecordResult | null> {
  const row = await env.DB.prepare(
    `SELECT *
     FROM sessions
     WHERE org_id = ? AND support_case_id = ? AND submission_id = ?
     LIMIT 1`,
  ).bind(actor.orgId, supportCaseId, submissionId).first<DbRow>();
  if (row === null) return null;
  if (row.submitted_by !== actor.userId || row.submission_hash !== submissionHash) {
    throw new ConflictError('submission conflicts with an existing official operation');
  }
  return { record: mapCounselingRecord(row), replayed: true };
}

/**
 * 인테이크 추가 개인정보(0015 4종) 복호화 조회. 파기된 금고(purged_at)는 제외한다.
 * 접근 검사는 호출부가 이미 수행했다는 계약이다(loadParticipantContacts 와 동일).
 */
async function readIntakeExtendedPii(
  env: Env,
  orgId: string,
  beneficiaryId: string,
): Promise<IntakeExtendedPii> {
  const row = await env.DB.prepare(
    `SELECT enc_birth_date, enc_region, enc_emergency_contact, enc_gender
     FROM participant_pii_vault
     WHERE beneficiary_id = ? AND org_id = ? AND purged_at IS NULL`,
  ).bind(beneficiaryId, orgId).first<{
    enc_birth_date: string | null;
    enc_region: string | null;
    enc_emergency_contact: string | null;
    enc_gender: string | null;
  }>();
  if (row === null) {
    return { birthDate: null, region: null, emergencyContact: null, gender: null };
  }
  return {
    birthDate: await decryptPii(env, row.enc_birth_date),
    region: await decryptPii(env, row.enc_region),
    emergencyContact: await decryptPii(env, row.enc_emergency_contact),
    gender: await decryptPii(env, row.enc_gender),
  };
}

/**
 * 인테이크 작성 컨텍스트(GET). 권한·활성 검사 후 당사자 표시 정보(D31 역할 기준 실명)·
 * 회차 자동값·기존 인테이크 여부를 돌려준다. 감사는 **화면 조회당 read_participant_pii
 * 1건**이며(D14·D24·ADR-0005), 추가 개인정보(0015)를 복호화해 실었다면 그 필드 이름을
 * 같은 행의 detail.fields 에 합쳐 남긴다 — 행을 나누지 않는다(2026-07-25 Q 결정).
 */
export async function getIntakeRecordContext(
  env: Env,
  actor: Actor,
  supportCaseId: string,
): Promise<IntakeRecordContext> {
  assertOpaqueIdentifier(supportCaseId, 'support case id');
  const supportCase = await assertSupportCaseAccess(env, actor, supportCaseId);
  const contacts = await loadParticipantContacts(env, actor.orgId, [supportCase.beneficiaryId]);
  // 감사를 한 행으로 합치려면 추가 금고 항목을 먼저 읽어 실제로 실린 필드를 알아야 한다.
  const extendedPii = await readIntakeExtendedPii(env, actor.orgId, supportCase.beneficiaryId);
  // 다음 예정 일정(CCC-57). getNextCounselingScheduleForSupportCase 를 부르지 않고 같은
  // SELECT 를 인라인한다. 그 함수는 접근 검사와 감사 행을 자기가 또 만들어서, 화면 조회
  // 하나에 감사 두 행이 남는다(이 함수가 일부러 한 행으로 합쳐 온 것을 깨뜨린다).
  // 감사 행을 따로 만들지 않는 것은 아래 회차 수·동의·저장분 조회와 같은 규칙이다.
  // 화면 조회 1회 = 감사 1행이고, 일정 행에는 금고 값이 없다.
  const scheduleRow = supportCase.status === 'active'
    ? await env.DB.prepare(
      `SELECT * FROM counseling_schedules
       WHERE org_id = ? AND support_case_id = ? AND status = 'scheduled'
       ORDER BY scheduled_at, id
       LIMIT 1`,
    ).bind(actor.orgId, supportCaseId).first<DbRow>()
    : null;
  const schedule = scheduleRow === null ? null : mapCounselingSchedule(scheduleRow);
  await auditParticipantPiiRead(env, actor, contacts, {
    targetId: supportCase.beneficiaryId,
    supportCaseId,
    extraFields: INTAKE_EXTENDED_PII_FIELDS.filter((field) => extendedPii[field] !== null),
  });
  const contact = contacts.get(supportCase.beneficiaryId);
  const counts = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN kind = 'intake' THEN 1 ELSE 0 END) AS intake_count
     FROM sessions
     WHERE org_id = ? AND support_case_id = ?`,
  ).bind(actor.orgId, supportCaseId).first<{ total: number; intake_count: number | null }>();
  const total = Number(counts?.total ?? 0);
  // 1단계 동의 상태(D42 ② · D44). 3종 모두 이 참여 사업의 **현재값**을 읽는다 —
  // 0020 이전에는 개인정보 동의만 이력 표(participant_consent_records)에서
  // `consent_privacy_at IS NOT NULL` 로 골랐는데, 그 조회는 ① 철회 행(NULL)을 걸러내
  // 철회가 화면에 영영 반영되지 않고 ② 당사자의 다른 참여 사업 기록까지 긁어 왔다.
  // 표시 전용이라 시각이 아니라 기록 여부만 돌려준다.
  const consentRow = await env.DB.prepare(
    `SELECT consent_recording_at AS recording_at,
            consent_text_ai_at AS text_ai_at,
            consent_privacy_at AS privacy_at
     FROM support_cases WHERE id = ? AND org_id = ?`,
  ).bind(supportCaseId, actor.orgId)
    .first<{ recording_at: string | null; text_ai_at: string | null; privacy_at: string | null }>();
  const hasIntake = Number(counts?.intake_count ?? 0) > 0;
  // 저장된 인테이크 내용(확인/수정 화면 재료, 2026-08-08 Q). 감사는 이 화면 조회 1건에
  // 이미 합산돼 있다 — 위 read_participant_pii 가 이 조회의 감사다(행을 나누지 않는다).
  let saved: IntakeSavedRecord | null = null;
  if (hasIntake) {
    const intakeRow = await env.DB.prepare(
      `SELECT id, held_at, channel, intake_details FROM sessions
       WHERE org_id = ? AND support_case_id = ? AND kind = 'intake' LIMIT 1`,
    ).bind(actor.orgId, supportCaseId).first<{ id: string; held_at: string; channel: string; intake_details: string | null }>();
    if (intakeRow !== null) {
      const details = parseJson<Record<string, unknown>>(intakeRow.intake_details) ?? {};
      saved = {
        sessionId: intakeRow.id,
        heldAt: intakeRow.held_at,
        channel: intakeRow.channel as Session['channel'],
        answers: Array.isArray(details.answers) ? details.answers as IntakeAnswerInput[] : [],
        debts: Array.isArray(details.debts) ? details.debts as IntakeDebtEntryInput[] : [],
        linkedOrgs: Array.isArray(details.linkedOrgs) ? details.linkedOrgs as IntakeLinkedOrgInput[] : [],
        additionalItems: Array.isArray(details.additionalItems) ? details.additionalItems as IntakeAdditionalItemInput[] : [],
        managerOpinion: typeof details.managerOpinion === 'string' ? details.managerOpinion : null,
      };
    }
  }
  return {
    beneficiaryId: supportCase.beneficiaryId,
    supportCaseId,
    participant: {
      name: contact?.name ?? null,
      phone: contact?.phone ?? null,
      email: contact?.email ?? null,
    },
    sessionSequence: total + 1,
    hasIntake,
    extendedPii,
    consent: {
      privacy: consentRow?.privacy_at != null,
      // D49 표시 규칙: 구 3종 기록은 두 컬럼 중 하나라도 찍혀 있으면 ② 동의로 읽는다.
      recordingAi: consentRow?.recording_at != null || consentRow?.text_ai_at != null,
    },
    saved,
    schedule,
  };
}

/**
 * 인테이크 기록을 한 번의 원자 배치로 저장한다: 세션(kind=intake) + 목표 1~3 + 액션 +
 * 6영역 스냅샷 + 동의 기록. 재현(replay)은 인테이크 1회 규칙보다 먼저 판정한다 —
 * 정당한 네트워크 재시도(같은 submissionId)가 중복으로 거부되지 않게 한다. 1회 규칙은
 * 사전 조회와 세션 INSERT 의 WHERE 가드로 이중 강제한다.
 */
export async function createIntakeRecord(
  env: Env,
  actor: Actor,
  supportCaseId: string,
  input: CreateIntakeRecordInput,
): Promise<IntakeRecordResult> {
  assertOpaqueIdentifier(supportCaseId, 'support case id');
  assertIntakeRecordInput(input);
  const supportCase = await assertSupportCaseAccess(env, actor, supportCaseId);
  if (supportCase.status !== 'active') {
    throw new ConflictError('support case is unavailable');
  }

  // 제출 해시는 저장되는 모든 입력을 덮어야 한다 — 빠뜨린 필드는 "서로 다른 제출"을
  // 같은 해시로 만들고, 두 번째 제출이 재현(replay)으로 조용히 버려진다(CCC-9).
  const submissionHash = await canonicalSha256({
    actionItems: input.actionItems ?? null,
    actorId: actor.userId,
    additionalItems: input.additionalItems ?? null,
    answers: input.answers ?? null,
    channel: input.channel,
    consent: input.consent ?? null,
    debts: input.debts ?? null,
    extendedPii: input.extendedPii ?? null,
    goals: (input.goals ?? []).map((goal) => ({ title: goal.title, scaleCriteria: goal.scaleCriteria ?? null })),
    heldAt: input.heldAt,
    helpNarrative: input.helpNarrative ?? null,
    lifeAreas: input.lifeAreas ?? null,
    linkedOrgs: input.linkedOrgs ?? null,
    managerOpinion: input.managerOpinion ?? null,
    nextMeeting: input.nextMeeting ?? null,
    orgId: actor.orgId,
    scheduleId: input.scheduleId ?? null,
    scheduleVersion: input.expectedScheduleVersion ?? null,
    supportCaseId,
  });

  // 재현 우선(정당한 재시도 보호) → 그다음 1회 규칙.
  const replay = await intakeRecordReplay(env, actor, supportCaseId, input.submissionId, submissionHash);
  if (replay !== null) return replay;

  const existingIntake = await env.DB.prepare(
    `SELECT 1 FROM sessions WHERE org_id = ? AND support_case_id = ? AND kind = 'intake' LIMIT 1`,
  ).bind(actor.orgId, supportCaseId).first<{ 1: number }>();
  if (existingIntake !== null) {
    throw new ConflictError('intake record already exists for this support case');
  }

  // 목표 상한(D12): 기존 활성 목표 + 신규 목표 ≤ 3.
  const goalInputs = input.goals ?? [];
  if (goalInputs.length > 0) {
    const active = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM goals WHERE org_id = ? AND support_case_id = ? AND status = 'active'",
    ).bind(actor.orgId, supportCaseId).first<{ count: number }>();
    if ((Number(active?.count ?? 0)) + goalInputs.length > MAX_ACTIVE_GOALS) {
      throw new ValidationError(`a case can have at most ${MAX_ACTIVE_GOALS} active goals`);
    }
  }

  let schedule: CounselingSchedule | null = null;
  if (input.scheduleId !== undefined) {
    schedule = await getCounselingScheduleForOrg(env, actor.orgId, input.scheduleId);
    await assertScheduleMutationAccess(env, actor, schedule);
    if (
      schedule.beneficiaryId !== supportCase.beneficiaryId
      || schedule.supportCaseId !== supportCaseId
      || schedule.status !== 'scheduled'
      || schedule.version !== input.expectedScheduleVersion
    ) {
      throw new ConflictError('counseling schedule is unavailable');
    }
  }

  // 추가 개인정보를 쓰려면 금고 행이 살아 있어야 한다. 없거나 파기됐으면 배치의 UPDATE 가
  // 0행으로 조용히 지나가므로(세션만 저장되고 PII 는 사라짐) 여기서 먼저 막는다.
  if (input.extendedPii !== undefined) {
    const vault = await env.DB.prepare(
      'SELECT 1 AS present FROM participant_pii_vault WHERE beneficiary_id = ? AND org_id = ? AND purged_at IS NULL',
    ).bind(supportCase.beneficiaryId, actor.orgId).first<{ present: number }>();
    if (vault === null) {
      throw new ConflictError('participant data is unavailable');
    }
  }

  const id = newId();
  const createdAt = now();
  const intakeDetails = stringifyJson({
    helpNarrative: input.helpNarrative ?? null,
    managerOpinion: input.managerOpinion ?? null,
    // 질문지 답변·반복 행 표는 확장 슬롯 성격의 JSON 으로 격리한다(브리핑·통계 제외, 3층 구조).
    answers: input.answers ?? [],
    additionalItems: input.additionalItems ?? [],
    debts: input.debts ?? [],
    linkedOrgs: input.linkedOrgs ?? [],
    nextMeeting: input.nextMeeting ?? null,
  });
  const activeSupportCaseGuard = `EXISTS (
    SELECT 1 FROM support_cases
    WHERE id = ? AND org_id = ? AND beneficiary_id = ? AND status = 'active'
  )`;
  const activeSupportCaseBindings = [supportCaseId, actor.orgId, supportCase.beneficiaryId];
  const noExistingIntakeGuard = `NOT EXISTS (
    SELECT 1 FROM sessions WHERE org_id = ? AND support_case_id = ? AND kind = 'intake'
  )`;
  const noExistingIntakeBindings = [actor.orgId, supportCaseId];
  const sessionExistsClause = `EXISTS (
    SELECT 1 FROM sessions
    WHERE id = ? AND org_id = ? AND support_case_id = ?
  )`;
  const sessionExistsBindings = [id, actor.orgId, supportCaseId];

  const sessionStatement = schedule === null
    ? env.DB.prepare(
      `INSERT INTO sessions (
         id, org_id, support_case_id, counselor_id, held_at, channel, memo,
         kind, intake_details, submission_id, submission_hash, submitted_by,
         ai_status, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, NULL, 'intake', ?, ?, ?, ?, 'none', ?, ?
       WHERE ${activeSupportCaseGuard} AND ${noExistingIntakeGuard}`,
    ).bind(
      id,
      actor.orgId,
      supportCaseId,
      actor.userId,
      input.heldAt,
      input.channel,
      intakeDetails,
      input.submissionId,
      submissionHash,
      actor.userId,
      createdAt,
      createdAt,
      ...activeSupportCaseBindings,
      ...noExistingIntakeBindings,
    )
    : env.DB.prepare(
      `INSERT INTO sessions (
         id, org_id, support_case_id, counselor_id, held_at, channel, memo,
         kind, intake_details, submission_id, submission_hash, submitted_by,
         ai_status, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, NULL, 'intake', ?, ?, ?, ?, 'none', ?, ?
       WHERE EXISTS (
         SELECT 1 FROM counseling_schedules
         WHERE id = ? AND org_id = ? AND beneficiary_id = ? AND support_case_id = ?
           AND status = 'scheduled' AND version = ?
       )
       AND ${activeSupportCaseGuard} AND ${noExistingIntakeGuard}`,
    ).bind(
      id,
      actor.orgId,
      supportCaseId,
      actor.userId,
      input.heldAt,
      input.channel,
      intakeDetails,
      input.submissionId,
      submissionHash,
      actor.userId,
      createdAt,
      createdAt,
      schedule.id,
      actor.orgId,
      supportCase.beneficiaryId,
      supportCaseId,
      input.expectedScheduleVersion,
      ...activeSupportCaseBindings,
      ...noExistingIntakeBindings,
    );

  const statements: D1PreparedStatement[] = [sessionStatement];

  // 인테이크 완료 시각(CCC-56): 등록은 더 이상 intake_at 을 채우지 않으므로, 인테이크
  // 기록 저장이 곧 유일한 채움 지점이다. 값은 이 세션의 상담일(held_at)이다 — 위저드
  // 기본 유형·1회 규칙 안내가 읽는 신호(ScheduleCandidate.intakeAt)와 기록 존재가 여기서
  // 처음으로 같은 사실이 된다. 세션 INSERT 가 가드에 막히면 이 UPDATE 도 0행이다.
  statements.push(env.DB.prepare(
    `UPDATE support_cases
     SET intake_at = ?, updated_at = ?
     WHERE id = ? AND org_id = ? AND ${sessionExistsClause}`,
  ).bind(
    input.heldAt,
    createdAt,
    supportCaseId,
    actor.orgId,
    ...sessionExistsBindings,
  ));

  // 목표(신설) + 각 목표 생성 감사(세션 트리거는 세션 행만 감사하므로 goals 는 명시 감사 — D14).
  for (const goal of goalInputs) {
    const goalId = newId();
    statements.push(env.DB.prepare(
      `INSERT INTO goals (id, org_id, support_case_id, title, scale_criteria, status, created_at)
       SELECT ?, ?, ?, ?, ?, 'active', ?
       WHERE ${sessionExistsClause}`,
    ).bind(
      goalId,
      actor.orgId,
      supportCaseId,
      goal.title.trim(),
      goal.scaleCriteria === undefined || goal.scaleCriteria === null ? null : stringifyJson(goal.scaleCriteria),
      createdAt,
      ...sessionExistsBindings,
    ));
    // 바로 앞 goals INSERT 가 세션 미존재로 0행이면 changes()=0 → 감사도 생략(정합).
    statements.push(conditionalCanonicalAuditStatement(env, actor, {
      action: 'create',
      targetTable: 'goals',
      targetId: goalId,
      beneficiaryId: supportCase.beneficiaryId,
      supportCaseId,
      detail: { kind: 'intake' },
    }));
  }

  for (const action of input.actionItems ?? []) {
    statements.push(env.DB.prepare(
      `INSERT INTO action_items (
         id, org_id, support_case_id, session_id, description, owner, due_date, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, ?
       WHERE ${sessionExistsClause}`,
    ).bind(
      newId(),
      actor.orgId,
      supportCaseId,
      id,
      action.description,
      action.owner,
      action.dueDate ?? null,
      createdAt,
      ...sessionExistsBindings,
    ));
  }

  for (const area of input.lifeAreas ?? []) {
    statements.push(env.DB.prepare(
      `INSERT INTO session_life_area_snapshots (
         id, org_id, session_id, area_key, status, note, created_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?
       WHERE ${sessionExistsClause}`,
    ).bind(
      newId(),
      actor.orgId,
      id,
      area.areaKey,
      area.status,
      area.note ?? null,
      createdAt,
      ...sessionExistsBindings,
    ));
  }

  // 추가 개인정보(0015) — 세션과 같은 원자 배치 안에서 금고에만 저장한다(D3).
  // SET 목록은 새 4개 컬럼으로 한정한다: 실명·연락처·계좌·이메일은 이 경로로 절대 쓰지
  // 않는다(그쪽은 admin 전용 updateParticipantPii 가 유일한 관문). 준 필드만 바꾸도록
  // COALESCE(?, 기존값) 을 쓰고, key_version 은 updateParticipantPii 와 똑같이 건드리지
  // 않는다. 파기된 금고는 WHERE purged_at IS NULL 로 되살아나지 않는다.
  if (input.extendedPii !== undefined) {
    const patch = input.extendedPii;
    const [encBirthDate, encRegion, encEmergencyContact, encGender] = await Promise.all([
      encryptPii(env, patch.birthDate ?? null),
      encryptPii(env, patch.region ?? null),
      encryptPii(env, patch.emergencyContact ?? null),
      encryptPii(env, patch.gender ?? null),
    ]);
    statements.push(env.DB.prepare(
      `UPDATE participant_pii_vault
       SET enc_birth_date = COALESCE(?, enc_birth_date),
           enc_region = COALESCE(?, enc_region),
           enc_emergency_contact = COALESCE(?, enc_emergency_contact),
           enc_gender = COALESCE(?, enc_gender),
           version = version + 1, updated_at = ?
       WHERE beneficiary_id = ? AND org_id = ? AND purged_at IS NULL
         AND ${sessionExistsClause}`,
    ).bind(
      encBirthDate,
      encRegion,
      encEmergencyContact,
      encGender,
      createdAt,
      supportCase.beneficiaryId,
      actor.orgId,
      ...sessionExistsBindings,
    ));
    statements.push(conditionalCanonicalAuditStatement(env, actor, {
      action: 'update',
      targetTable: 'participant_pii_vault',
      targetId: supportCase.beneficiaryId,
      beneficiaryId: supportCase.beneficiaryId,
      supportCaseId,
      detail: {
        fields: INTAKE_EXTENDED_PII_FIELDS.filter((field) => patch[field] !== undefined),
        kind: 'intake',
      },
    }));
  }

  // 동의 기록(append-only): 화면 체크 privacy → consent_privacy_at, recordingAi → 2컬럼 동시.
  // 셋 다 recorded_at 과 같게 기록(insert_guard 정합). record_consent 감사(D14).
  // D42 ②: 인테이크 화면은 동의를 입력받지 않으므로 consent 가 없으면 기록도 만들지 않는다 —
  // 없는 동의를 인테이크 저장이 대신 남기면 등록 화면의 동의 기록과 어긋난다.
  if (input.consent !== undefined) {
  const consentRecordId = newId();
  statements.push(env.DB.prepare(
    `INSERT INTO participant_consent_records (
       id, org_id, beneficiary_id, support_case_id,
       consent_recording_at, consent_text_ai_at, consent_privacy_at,
       recorded_by, recorded_at, created_at
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
     WHERE ${sessionExistsClause}`,
  ).bind(
    consentRecordId,
    actor.orgId,
    supportCase.beneficiaryId,
    supportCaseId,
    createdAt,
    createdAt,
    createdAt,
    actor.userId,
    createdAt,
    createdAt,
    ...sessionExistsBindings,
  ));
  // D44 · 0020: 이력만 남기면 "지금 상태"(support_cases)와 어긋난다 — 인테이크 1단계와
  // 당사자 정보 페이지가 읽는 곳이 그쪽이기 때문이다. 같은 배치에서 현재값도 맞춘다.
  statements.push(env.DB.prepare(
    `UPDATE support_cases
     SET consent_recording_at = ?, consent_text_ai_at = ?, consent_privacy_at = ?, updated_at = ?
     WHERE id = ? AND org_id = ? AND ${sessionExistsClause}`,
  ).bind(
    createdAt, createdAt, createdAt, createdAt,
    supportCaseId, actor.orgId,
    ...sessionExistsBindings,
  ));
  statements.push(conditionalCanonicalAuditStatement(env, actor, {
    action: 'record_consent',
    targetTable: 'participant_consent_records',
    targetId: consentRecordId,
    beneficiaryId: supportCase.beneficiaryId,
    supportCaseId,
    detail: { privacy: true, recordingAi: true, kind: 'intake' },
  }));
  }

  if (schedule !== null) {
    statements.push(env.DB.prepare(
      `UPDATE counseling_schedules
       SET status = 'completed', completed_session_id = ?, completed_by_actor_id = ?,
           completed_at = ?, updated_by_actor_id = ?, version = version + 1, updated_at = ?
       WHERE id = ? AND org_id = ? AND beneficiary_id = ? AND support_case_id = ?
         AND status = 'scheduled' AND version = ?
         AND ${sessionExistsClause}`,
    ).bind(
      id,
      actor.userId,
      createdAt,
      actor.userId,
      createdAt,
      schedule.id,
      actor.orgId,
      supportCase.beneficiaryId,
      supportCaseId,
      input.expectedScheduleVersion,
      ...sessionExistsBindings,
    ));
  }

  try {
    await env.DB.batch(statements);
    const persisted = await env.DB.prepare(
      `SELECT id FROM sessions
       WHERE id = ? AND org_id = ? AND support_case_id = ?
         AND submission_id = ? AND submission_hash = ? AND submitted_by = ?
       LIMIT 1`,
    ).bind(
      id,
      actor.orgId,
      supportCaseId,
      input.submissionId,
      submissionHash,
      actor.userId,
    ).first<{ id: string }>();
    if (persisted === null) {
      // WHERE 가드(1회 규칙 등)로 세션이 안 들어갔거나 경합에서 밀렸다.
      const matched = await intakeRecordReplay(env, actor, supportCaseId, input.submissionId, submissionHash);
      if (matched !== null) return matched;
      throw new ConflictError('intake record already exists for this support case');
    }
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
    const matched = await intakeRecordReplay(env, actor, supportCaseId, input.submissionId, submissionHash);
    if (matched !== null) return matched;
    throw error;
  }

  return {
    record: {
      id,
      supportCaseId,
      counselorId: actor.userId,
      heldAt: input.heldAt,
      channel: input.channel,
      memo: '',
      kind: 'intake',
      aiSummary: null,
      approvedAt: null,
      createdAt,
    },
    replayed: false,
  };
}

/**
 * 인테이크 수정 입력(2026-08-08 Q "확인/수정"). 현행 위저드가 소유한 필드만 받는다.
 * 동의·기본정보(금고)·목표·다음 행동은 각자의 화면·수명 규칙이 있어 이 경로로 손대지
 * 않는다 — 그 다섯은 CreateIntakeRecordInput 에만 남는다.
 */
export interface UpdateIntakeRecordInput {
  heldAt: string;
  channel: Session['channel'];
  answers?: IntakeAnswerInput[];
  debts?: IntakeDebtEntryInput[];
  linkedOrgs?: IntakeLinkedOrgInput[];
  additionalItems?: IntakeAdditionalItemInput[];
  managerOpinion?: string;
}

function assertUpdateIntakeRecordInput(input: UpdateIntakeRecordInput): void {
  const expectedKeys = ['heldAt', 'channel'];
  if (input.answers !== undefined) expectedKeys.push('answers');
  if (input.debts !== undefined) expectedKeys.push('debts');
  if (input.linkedOrgs !== undefined) expectedKeys.push('linkedOrgs');
  if (input.additionalItems !== undefined) expectedKeys.push('additionalItems');
  if (input.managerOpinion !== undefined) expectedKeys.push('managerOpinion');
  assertExactKeys(input, expectedKeys);
  canonicalUtcInstant(input.heldAt, 'record time');
  if (input.channel !== 'in_person' && input.channel !== 'phone' && input.channel !== 'video') {
    throw new ValidationError('record channel is invalid');
  }
  if (input.answers !== undefined) assertIntakeAnswerInputs(input.answers);
  if (input.additionalItems !== undefined) assertIntakeAdditionalItemInputs(input.additionalItems);
  if (input.debts !== undefined) {
    assertIntakeTableRows(
      input.debts as unknown as Array<Record<string, unknown>>,
      'debts',
      'creditor',
      INTAKE_DEBT_OPTIONAL_KEYS,
    );
  }
  if (input.linkedOrgs !== undefined) {
    assertIntakeTableRows(
      input.linkedOrgs as unknown as Array<Record<string, unknown>>,
      'linked orgs',
      'orgName',
      INTAKE_LINKED_ORG_OPTIONAL_KEYS,
    );
  }
  if (input.managerOpinion !== undefined) assertNonBlankText(input.managerOpinion, 'manager opinion');
}

/**
 * 인테이크 수정(2026-08-08 Q "확인/수정"). 위저드 소유분(intake_details 의
 * answers·debts·linkedOrgs·additionalItems·managerOpinion + held_at·channel)만 덮어쓴다.
 * 구 위저드의 유산 키(helpNarrative·nextMeeting)는 화면이 편집하지 않으므로 보존한다 —
 * 지우면 과거 기록의 해석 재료가 사라진다. 세션 INSERT 감사 트리거는 UPDATE 를 덮지
 * 않으므로 감사는 명시로 남긴다(D14). 승인 개념이 없는 회차라(ai_status 'none')
 * R2 승인 게이트와 무관하다.
 */
export async function updateIntakeRecord(
  env: Env,
  actor: Actor,
  supportCaseId: string,
  input: UpdateIntakeRecordInput,
): Promise<IntakeRecordResult> {
  assertOpaqueIdentifier(supportCaseId, 'support case id');
  assertUpdateIntakeRecordInput(input);
  const supportCase = await assertSupportCaseAccess(env, actor, supportCaseId);
  if (supportCase.status !== 'active') {
    throw new ConflictError('support case is unavailable');
  }
  const intakeRow = await env.DB.prepare(
    `SELECT id, intake_details, created_at FROM sessions
     WHERE org_id = ? AND support_case_id = ? AND kind = 'intake' LIMIT 1`,
  ).bind(actor.orgId, supportCaseId).first<{ id: string; intake_details: string | null; created_at: string }>();
  if (intakeRow === null) {
    throw new ConflictError('intake record does not exist for this support case');
  }
  const existing = parseJson<Record<string, unknown>>(intakeRow.intake_details) ?? {};
  const intakeDetails = stringifyJson({
    helpNarrative: existing.helpNarrative ?? null,
    managerOpinion: input.managerOpinion ?? null,
    answers: input.answers ?? [],
    additionalItems: input.additionalItems ?? [],
    debts: input.debts ?? [],
    linkedOrgs: input.linkedOrgs ?? [],
    nextMeeting: existing.nextMeeting ?? null,
  });
  const updatedAt = now();
  // 권한을 변경 배치의 WHERE 에서 반복한다 — 사전 검사만으로는 이후 상태 변화를 승인하지
  // 못한다(레포 공통 패턴). 감사는 changes()=1 일 때만 같이 남는다.
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE sessions
       SET held_at = ?, channel = ?, intake_details = ?, updated_at = ?
       WHERE id = ? AND org_id = ? AND support_case_id = ? AND kind = 'intake'
         AND EXISTS (
           SELECT 1 FROM support_cases AS support_case
           WHERE support_case.id = sessions.support_case_id
             AND support_case.org_id = sessions.org_id
             AND support_case.status = 'active'
         )
         AND (
           ? = 'admin' OR EXISTS (
             SELECT 1 FROM support_case_assignees AS assignment
             WHERE assignment.org_id = sessions.org_id
               AND assignment.support_case_id = sessions.support_case_id
               AND assignment.user_id = ?
               AND assignment.unassigned_at IS NULL
           )
         )`,
    ).bind(
      input.heldAt,
      input.channel,
      intakeDetails,
      updatedAt,
      intakeRow.id,
      actor.orgId,
      supportCaseId,
      actor.role,
      actor.userId,
    ),
    conditionalCanonicalAuditStatement(env, actor, {
      action: 'update',
      targetTable: 'sessions',
      targetId: intakeRow.id,
      beneficiaryId: supportCase.beneficiaryId,
      supportCaseId,
      detail: { kind: 'intake' },
    }),
    // 인테이크 완료 시각 동기(CCC-56): 상담일(held_at)이 바뀌면 intake_at 도 따라간다.
    // 앞 UPDATE 가 권한·상태 가드에 막혀 0행이면 여기도 0행이어야 하므로, 이 호출이 방금
    // 쓴 값(held_at = ?, updated_at = ?)이 실제로 앉았는지를 조건으로 삼는다.
    env.DB.prepare(
      `UPDATE support_cases
       SET intake_at = ?, updated_at = ?
       WHERE id = ? AND org_id = ? AND EXISTS (
         SELECT 1 FROM sessions
         WHERE id = ? AND org_id = ? AND support_case_id = ? AND kind = 'intake'
           AND held_at = ? AND updated_at = ?
       )`,
    ).bind(
      input.heldAt,
      updatedAt,
      supportCaseId,
      actor.orgId,
      intakeRow.id,
      actor.orgId,
      supportCaseId,
      input.heldAt,
      updatedAt,
    ),
  ]);
  const updated = results[0] as unknown as { meta?: { changes?: number } };
  if ((updated.meta?.changes ?? 0) < 1) {
    throw new ConflictError('intake record is no longer editable');
  }
  return {
    record: {
      id: intakeRow.id,
      supportCaseId,
      counselorId: actor.userId,
      heldAt: input.heldAt,
      channel: input.channel,
      memo: '',
      kind: 'intake',
      aiSummary: null,
      approvedAt: null,
      createdAt: intakeRow.created_at,
    },
    replayed: false,
  };
}

export async function listCounselingRecords(
  env: Env,
  actor: Actor,
  supportCaseId: string,
): Promise<CounselingRecordDetails[]> {
  const supportCase = await assertSupportCaseAccess(env, actor, supportCaseId);
  const sessions = await env.DB.prepare(
    `SELECT * FROM sessions
     WHERE org_id = ? AND support_case_id = ?
     ORDER BY held_at DESC, id DESC`,
  ).bind(actor.orgId, supportCaseId).all<DbRow>();
  const sessionIds = sessions.results.map((row) => stringValue(row.id));

  if (sessionIds.length === 0) {
    await writeCanonicalAudit(env, actor, {
      action: 'read',
      targetTable: 'sessions',
      beneficiaryId: supportCase.beneficiaryId,
      supportCaseId,
    });
    return [];
  }

  const placeholders = sessionIds.map(() => '?').join(', ');
  const [approved, scores, actionItems, confirmedFlags, completedSchedules, lifeAreas] = await Promise.all([
    env.DB.prepare(
      // one_liner 는 D47 접힌 줄의 핵심 한 줄(0025) — 브리핑 영역 ②와 같은 승인 경로에서 읽는다(R2).
      `SELECT session_id, summary_text, approved_at, one_liner
       FROM approved_ai_briefing_v1
       WHERE org_id = ? AND support_case_id = ?`,
    ).bind(actor.orgId, supportCaseId).all<DbRow>(),
    env.DB.prepare(
      `SELECT * FROM session_goal_scores
       WHERE org_id = ? AND session_id IN (${placeholders})
       ORDER BY session_id, goal_id`,
    ).bind(actor.orgId, ...sessionIds).all<DbRow>(),
    env.DB.prepare(
      `SELECT * FROM action_items
       WHERE org_id = ? AND support_case_id = ? AND session_id IN (${placeholders})
       ORDER BY session_id, due_date, created_at, id`,
    ).bind(actor.orgId, supportCaseId, ...sessionIds).all<DbRow>(),
    env.DB.prepare(
      `SELECT * FROM flags
       WHERE org_id = ? AND support_case_id = ? AND session_id IN (${placeholders})
         AND review_status = 'confirmed'
       ORDER BY session_id, created_at, id`,
    ).bind(actor.orgId, supportCaseId, ...sessionIds).all<DbRow>(),
    env.DB.prepare(
      `SELECT id, completed_session_id, scheduled_at, status, version
       FROM counseling_schedules
       WHERE org_id = ? AND beneficiary_id = ? AND support_case_id = ?
         AND status = 'completed' AND completed_session_id IN (${placeholders})`,
    ).bind(actor.orgId, supportCase.beneficiaryId, supportCaseId, ...sessionIds).all<DbRow>(),
    env.DB.prepare(
      `SELECT session_id, area_key, status, note
       FROM session_life_area_snapshots
       WHERE org_id = ? AND session_id IN (${placeholders})
       ORDER BY session_id, area_key`,
    ).bind(actor.orgId, ...sessionIds).all<DbRow>(),
  ]);
  const approvedBySession = new Map(
    approved.results.map((row) => [
      stringValue(row.session_id),
      {
        summaryText: stringValue(row.summary_text),
        approvedAt: nullableString(row.approved_at),
        oneLiner: nullableString(row.one_liner),
      },
    ]),
  );
  // D47 '이번 상담의 목표' 1차 출처 — 그 회차가 완료 처리한 일정의 세션 목표(0009, SSOT).
  // 완료 일정을 위에서 이미 회차별로 묶었으므로 그 일정 ID 로만 좁혀 읽는다.
  const completedScheduleIds = completedSchedules.results.map((row) => stringValue(row.id));
  const scheduleGoalsByScheduleId = new Map<string, string[]>();
  if (completedScheduleIds.length > 0) {
    const schedulePlaceholders = completedScheduleIds.map(() => '?').join(', ');
    const scheduleGoals = await env.DB.prepare(
      `SELECT schedule_id, body
       FROM schedule_session_goals
       WHERE org_id = ? AND support_case_id = ? AND schedule_id IN (${schedulePlaceholders})
       ORDER BY schedule_id, ordinal`,
    ).bind(actor.orgId, supportCaseId, ...completedScheduleIds).all<DbRow>();
    for (const row of scheduleGoals.results) {
      const scheduleId = stringValue(row.schedule_id);
      const current = scheduleGoalsByScheduleId.get(scheduleId) ?? [];
      current.push(stringValue(row.body));
      scheduleGoalsByScheduleId.set(scheduleId, current);
    }
  }
  const scoresBySession = new Map<string, CounselingRecordGasScore[]>();
  for (const row of scores.results) {
    const stored = mapGasScore(row);
    const score = { goalId: stored.goalId, score: stored.score };
    const current = scoresBySession.get(stored.sessionId) ?? [];
    current.push(score);
    scoresBySession.set(stored.sessionId, current);
  }
  const actionsBySession = new Map<string, ActionItem[]>();
  for (const row of actionItems.results) {
    const action = mapActionItem({ ...row, case_id: supportCaseId });
    if (action.sessionId === null) continue;
    const current = actionsBySession.get(action.sessionId) ?? [];
    current.push(action);
    actionsBySession.set(action.sessionId, current);
  }
  const flagsBySession = new Map<string, Flag[]>();
  for (const row of confirmedFlags.results) {
    const flag = mapFlag({ ...row, case_id: supportCaseId });
    if (flag.sessionId === null) continue;
    const current = flagsBySession.get(flag.sessionId) ?? [];
    current.push(flag);
    flagsBySession.set(flag.sessionId, current);
  }
  const lifeAreasBySession = new Map<string, LifeAreaSnapshotEntry[]>();
  for (const row of lifeAreas.results) {
    const sessionId = stringValue(row.session_id);
    const current = lifeAreasBySession.get(sessionId) ?? [];
    current.push(mapLifeAreaSnapshotRow(row));
    lifeAreasBySession.set(sessionId, current);
  }
  const completedScheduleBySession = new Map<string, CounselingRecordCompletedSchedule>();
  for (const row of completedSchedules.results) {
    const completedSessionId = nullableString(row.completed_session_id);
    const version = integerValue(row.version);
    if (completedSessionId === null || version === null || version < 1) {
      throw new ValidationError('counseling schedule is invalid');
    }
    completedScheduleBySession.set(completedSessionId, {
      id: stringValue(row.id),
      scheduledAt: stringValue(row.scheduled_at),
      status: canonicalScheduleStatus(row.status),
      version,
    });
  }


  await writeCanonicalAudit(env, actor, {
    action: 'read',
    targetTable: 'sessions',
    beneficiaryId: supportCase.beneficiaryId,
    supportCaseId,
  });
  return sessions.results.map((row) => {
    const sessionId = stringValue(row.id);
    const projected = approvedBySession.get(sessionId);
    const completedSchedule = completedScheduleBySession.get(sessionId) ?? null;
    // 일정 쪽이 SSOT 이고, 일정이 없거나 목표가 안 달린 회차만 기록지 메모로 내려간다(0016).
    const scheduleGoals = completedSchedule === null
      ? []
      : scheduleGoalsByScheduleId.get(completedSchedule.id) ?? [];
    const sessionGoals = scheduleGoals.length > 0
      ? scheduleGoals
      : sessionGoalNoteLines(nullableString(row.record_details));
    return {
      ...mapCounselingRecord(row, projected?.summaryText ?? null, projected?.approvedAt ?? null),
      completedSchedule,
      gasScores: scoresBySession.get(sessionId) ?? [],
      actionItems: actionsBySession.get(sessionId) ?? [],
      confirmedFlags: flagsBySession.get(sessionId) ?? [],
      lifeAreaSnapshot: lifeAreasBySession.get(sessionId) ?? [],
      aiOneLiner: projected?.oneLiner ?? null,
      memoExcerpt: sessionMemoExcerpt(nullableString(row.memo)),
      sessionGoals,
    };
  });
}

export interface ParticipantBriefingGasTrend {
  sourceSupportCase: SourceSupportCase;
  goal: Pick<Goal, 'id' | 'title' | 'status' | 'closedAt'>;
  points: Array<{ heldAt: string; score: -2 | -1 | 0 | 1 | 2 }>;
}

export interface ParticipantBriefingSummary {
  sourceSupportCase: SourceSupportCase;
  sessionId: string;
  source: 'ai' | 'memo';
  text: string;
  pendingApprovalCount: number;
}

// D45 영역 ② 회차별 정리 — 회차마다 상담일·유형·핵심 한 줄. 메모 전문은 싣지 않는다:
// 브리핑은 훑는 화면이고 전문 입구는 '자세한 상담 기록 보기'다.
export interface ParticipantBriefingSessionRow {
  sourceSupportCase: SourceSupportCase;
  sessionId: string;
  heldAt: string;
  kind: 'regular' | 'intake';
  /** 승인된 AI 핵심 한 줄(CCC-38). NULL = 미승인·녹음 없음·레거시 → 화면은 수기 발췌 + '수기' 배지(D5). */
  aiOneLiner: string | null;
  memoExcerpt: string | null;
}

export interface ParticipantBriefingAction {
  sourceSupportCase: SourceSupportCase;
  action: ActionItem;
}

export interface ParticipantBriefingFlag {
  sourceSupportCase: SourceSupportCase;
  flag: Flag;
}

/**
 * D45 영역 ① AI 제안 (CCC-39). 재료는 공식 기록만 — approved_ai_briefing_v1 을 거친
 * 승인본에서만 조립한다(R2). sessionId·heldAt 이 근거 회차이고, 화면은 그 회차 기록으로
 * 링크를 건다. 참여 사업당 최대 MAX_BRIEFING_AI_SUGGESTIONS 개(최신 승인순).
 */
export interface ParticipantBriefingSuggestion {
  sourceSupportCase: SourceSupportCase;
  sessionId: string;
  /** 근거 회차의 상담일. 세션 행이 조회 범위에 없으면 null(링크는 세션 ID 로 여전히 건다). */
  heldAt: string | null;
  title: string;
  reason: string | null;
}

/** D45: AI 제안은 최대 3개 — 그 이상은 '오늘 만나기 전'이 훑기 화면이 아니게 된다. */
const MAX_BRIEFING_AI_SUGGESTIONS = 3;

/**
 * 포커스 참여사업의 다가오는 상담 일정과 그 세션 목표·맞춤형 질문 (D28). 티켓 #34가
 * 상담 준비 화면에 병기한다 — 브리핑은 데이터만 제공한다.
 */
export interface BriefingUpcomingSchedule {
  id: string;
  scheduledAt: string;
  sessionKind: CounselingScheduleKind;
  channel: CounselingScheduleChannel;
  sessionGoals: ScheduleSessionGoal[];
  customQuestions: ScheduleCustomQuestion[];
}

/**
 * D45 영역 ③ 내용 불일치 — 저장된 검출 결과의 읽기 전용 행(CCC-43). 판단 없이 양쪽
 * 원문 인용 + 회차 참조(상담일 포함)만 싣는다(R5). CCC-43 범위에서는 미처리 행만 온다.
 */
export interface ParticipantBriefingDiscrepancy {
  sourceSupportCase: SourceSupportCase;
  id: string;
  kind: DiscrepancyKind;
  left: { sessionId: string; heldAt: string; quote: string };
  right: { sessionId: string; heldAt: string; quote: string };
  detectedAt: string;
  /**
   * 처리 3종 (CCC-42). null = 미처리. 처리된 항목은 화면에서 접힌 이력으로 내려가고
   * 삭제되지 않는다. 처리자(userId)는 싣지 않는다 — 표시에 쓰지 않고 감사에 남는다(D14).
   */
  resolution: { status: DiscrepancyResolutionStatus; resolvedAt: string } | null;
}

export interface ParticipantBriefing {
  beneficiaryId: string;
  focusedSupportCase: SourceSupportCase;
  supportCases: SourceSupportCase[];
  gasTrends: ParticipantBriefingGasTrend[];
  summaries: ParticipantBriefingSummary[];
  sessionRows: ParticipantBriefingSessionRow[];
  actionItems: ParticipantBriefingAction[];
  flags: ParticipantBriefingFlag[];
  aiSuggestions: ParticipantBriefingSuggestion[];
  discrepancies: ParticipantBriefingDiscrepancy[];
  focusUpcomingSchedule: BriefingUpcomingSchedule | null;
  /** 포커스 참여사업의 전체 목표 (D45 · 0024). NULL = 설정 전. */
  overallGoal: string | null;
  /**
   * 전체 목표 그 자리 편집 가능 여부. 구 D45 는 '담당 실무자만' 이었으나
   * 2026-07-30 Q 결정으로 **기관 관리자도 수정한다**(ADR-0018 개정).
   * 접근은 assertSupportCaseAccess 가 이미 걸렀다 — counselor 는 활성 배정,
   * admin 은 기관 범위 — 그래서 여기서는 역할만 보면 된다.
   */
  canEditOverallGoal: boolean;
  // D24·ADR-0005: 담당·기관 관리자(=접근 권한 통과자)에게 실명·연락처를 기본 표시.
  // 접근 자체가 assertSupportCaseAccess 로 이미 걸러졌으므로 여기 도달하면 열람 권한이 있다.
  participant: ParticipantNameContact;
}

function orderedAuthorizedSupportCases(
  supportCases: SupportCase[],
  focusSupportCaseId: string,
): SupportCase[] {
  return [...supportCases].sort((left, right) => {
    if (left.id === focusSupportCaseId) return -1;
    if (right.id === focusSupportCaseId) return 1;
    if (left.status !== right.status) return left.status === 'active' ? -1 : 1;
    const program = left.programType.localeCompare(right.programType);
    return program !== 0 ? program : left.id.localeCompare(right.id);
  });
}

// 브리핑 조립은 방어적으로 읽는다 — 형태가 어긋난 행은 통째로 버리고 화면을 세우지 않는다.
// (v1 문자열·v2 {title, reason} 객체 혼재 허용 — 0026 가드와 같은 폭.)
function briefingSuggestions(row: DbRow): AiBriefingSuggestion[] {
  const parsed = parseJson<unknown>(row.questions_json);
  if (!Array.isArray(parsed)) return [];
  try {
    return parsed.map(normalizeAiBriefingSuggestion);
  } catch {
    return [];
  }
}

/**
 * record_details(0016) 의 sessionGoalNote 를 줄 단위로 편다 — D47 '이번 상담의 목표'의
 * 2차 출처다. 일정에 세션 목표가 연결되지 않은 회차에서 실무자가 기록지에 직접 적은 값이라
 * 여러 줄일 수 있고, 일정 쪽(schedule_session_goals)이 있으면 여기까지 오지 않는다.
 * JSON 이 깨졌거나 키가 없으면 빈 배열 — 기록 조회가 그것 때문에 실패하지는 않는다.
 */
function sessionGoalNoteLines(recordDetails: string | null): string[] {
  if (recordDetails === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(recordDetails);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const note = (parsed as Record<string, unknown>).sessionGoalNote;
  if (typeof note !== 'string') return [];
  return note.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
}

// 수기 메모의 첫 비어 있지 않은 줄에서 최대 60자 — D45 영역 ②의 폴백 발췌(D5).
function sessionMemoExcerpt(memo: string | null): string | null {
  if (memo === null) return null;
  const firstLine = memo.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
  if (firstLine.length === 0) return null;
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
}

/**
 * Focus is authorized before any aggregate content query. Every subsequent
 * query is bound to the preauthorized SupportCase set, preventing sibling
 * existence/content/count leakage while retaining per-item provenance.
 */
export async function getParticipantBriefing(
  env: Env,
  actor: Actor,
  beneficiaryId: string,
  focusSupportCaseId: string,
): Promise<ParticipantBriefing> {
  assertBeneficiaryId(beneficiaryId);
  assertOpaqueIdentifier(focusSupportCaseId, 'focused support case id');
  const focus = await assertSupportCaseAccess(env, actor, focusSupportCaseId);
  if (focus.beneficiaryId !== beneficiaryId) {
    throw new ForbiddenError('participant is unavailable');
  }

  const authorizedIds = await listAuthorizedSupportCaseIdsForBeneficiary(env, actor, beneficiaryId);
  if (!authorizedIds.includes(focusSupportCaseId)) {
    throw new ForbiddenError('participant is unavailable');
  }
  const placeholders = authorizedIds.map(() => '?').join(', ');
  const supportCaseRows = await env.DB.prepare(
    `SELECT * FROM support_cases
     WHERE org_id = ? AND beneficiary_id = ? AND id IN (${placeholders})`,
  ).bind(actor.orgId, beneficiaryId, ...authorizedIds).all<DbRow>();
  const supportCases = orderedAuthorizedSupportCases(
    supportCaseRows.results.map(mapSupportCase),
    focusSupportCaseId,
  );
  const sources = new Map<string, SourceSupportCase>(
    supportCases.map((supportCase): [string, SourceSupportCase] => [
      supportCase.id,
      sourceSupportCase(supportCase),
    ]),
  );
  const scopedValues = [actor.orgId, ...authorizedIds];

  const [goals, gas, sessions, approved, pending, actions, flags, discrepancyRows] = await Promise.all([
    env.DB.prepare(
      `SELECT * FROM goals
       WHERE org_id = ? AND support_case_id IN (${placeholders})
       ORDER BY created_at, id`,
    ).bind(...scopedValues).all<DbRow>(),
    env.DB.prepare(
      `SELECT goals.id AS goal_id, goals.title AS goal_title, goals.status AS goal_status,
              goals.closed_at AS goal_closed_at, sessions.support_case_id, sessions.held_at,
              session_goal_scores.score
       FROM session_goal_scores
       JOIN sessions ON sessions.id = session_goal_scores.session_id
         AND sessions.org_id = session_goal_scores.org_id
       JOIN goals ON goals.id = session_goal_scores.goal_id
         AND goals.org_id = session_goal_scores.org_id
       WHERE session_goal_scores.org_id = ?
         AND sessions.support_case_id IN (${placeholders})
         AND goals.support_case_id = sessions.support_case_id
       ORDER BY sessions.held_at, session_goal_scores.id`,
    ).bind(...scopedValues).all<DbRow>(),
    env.DB.prepare(
      `SELECT * FROM sessions
       WHERE org_id = ? AND support_case_id IN (${placeholders})
       ORDER BY held_at DESC, id DESC`,
    ).bind(...scopedValues).all<DbRow>(),
    env.DB.prepare(
      `SELECT support_case_id, session_id, summary_text, one_liner, questions_json, approved_at
       FROM approved_ai_briefing_v1
       WHERE org_id = ? AND support_case_id IN (${placeholders})
       ORDER BY approved_at DESC, draft_version DESC`,
    ).bind(...scopedValues).all<DbRow>(),
    env.DB.prepare(
      `SELECT work.support_case_id, COUNT(*) AS count
       FROM ai_work_items AS work
       WHERE work.org_id = ? AND work.support_case_id IN (${placeholders})
         AND NOT EXISTS (
           SELECT 1 FROM ai_review_events AS review
           WHERE review.work_item_id = work.id
         )
       GROUP BY work.support_case_id`,
    ).bind(...scopedValues).all<{ support_case_id: string; count: number }>(),
    env.DB.prepare(
      `SELECT * FROM action_items
       WHERE org_id = ? AND support_case_id IN (${placeholders}) AND resolved_at IS NULL
       ORDER BY due_date, created_at, id`,
    ).bind(...scopedValues).all<DbRow>(),
    env.DB.prepare(
      `SELECT * FROM flags
       WHERE org_id = ? AND support_case_id IN (${placeholders})
         AND (source = 'counselor' OR review_status = 'confirmed')
       ORDER BY created_at DESC, id DESC`,
    ).bind(...scopedValues).all<DbRow>(),
    // D45 영역 ③ — 저장된 검출 결과만 읽는다(실시간 검사 없음, ADR-0018). 미처리와 처리된
    // 항목을 **함께** 싣고(CCC-42: 처리분은 화면에서 접힌 이력), 미처리를 앞세운다. 회차
    // 링크용 상담일을 함께 싣는다.
    // 처리된 이력은 지워지지 않아 무한히 쌓이므로 **참여 사업마다 최근 20건**까지만 싣는다
    // (미처리는 실무자가 처리해야 할 목록이라 자르지 않는다).
    env.DB.prepare(
      `SELECT * FROM (
         SELECT discrepancy.*,
                left_session.held_at AS left_held_at,
                right_session.held_at AS right_held_at,
                ROW_NUMBER() OVER (
                  PARTITION BY discrepancy.support_case_id, (discrepancy.resolution_status IS NULL)
                  ORDER BY discrepancy.resolved_at DESC, discrepancy.id
                ) AS resolved_rank
         FROM session_discrepancies AS discrepancy
         JOIN sessions AS left_session
           ON left_session.id = discrepancy.left_session_id AND left_session.org_id = discrepancy.org_id
         JOIN sessions AS right_session
           ON right_session.id = discrepancy.right_session_id AND right_session.org_id = discrepancy.org_id
         WHERE discrepancy.org_id = ? AND discrepancy.support_case_id IN (${placeholders})
       )
       WHERE resolution_status IS NULL OR resolved_rank <= ${DISCREPANCY_RESOLVED_HISTORY_LIMIT}
       ORDER BY (resolution_status IS NULL) DESC, detected_at DESC, id`,
    ).bind(...scopedValues).all<DbRow>(),
  ]);

  const goalsById = new Map<string, Goal>(goals.results.map((row): [string, Goal] => [
    stringValue(row.id),
    mapGoal({
      ...row,
      case_id: row.support_case_id,
    }),
  ]));
  const trendByGoal = new Map<string, ParticipantBriefingGasTrend>();
  for (const row of gas.results) {
    const supportCaseId = stringValue(row.support_case_id);
    const source = sources.get(supportCaseId);
    const score = integerValue(row.score);
    if (source === undefined || score === null || score < -2 || score > 2) continue;
    const goalId = stringValue(row.goal_id);
    const existingGoal = goalsById.get(goalId);
    const trend = trendByGoal.get(goalId) ?? {
      sourceSupportCase: source,
      goal: existingGoal === undefined
        ? {
          id: goalId,
          title: stringValue(row.goal_title),
          status: toGoalStatus(row.goal_status),
          closedAt: nullableString(row.goal_closed_at),
        }
        : {
          id: existingGoal.id,
          title: existingGoal.title,
          status: existingGoal.status,
          closedAt: existingGoal.closedAt,
        },
      points: [],
    };
    trend.points.push({ heldAt: stringValue(row.held_at), score: score as -2 | -1 | 0 | 1 | 2 });
    trendByGoal.set(goalId, trend);
  }

  const approvedBySession = new Map<string, DbRow>();
  for (const row of approved.results) {
    const sessionId = stringValue(row.session_id);
    if (!approvedBySession.has(sessionId)) approvedBySession.set(sessionId, row);
  }
  const pendingBySupportCase = new Map<string, number>(
    pending.results.map((row): [string, number] => [
      stringValue(row.support_case_id),
      Number(row.count) || 0,
    ]),
  );
  const latestSessionBySupportCase = new Map<string, DbRow>();
  for (const row of sessions.results) {
    const supportCaseId = stringValue(row.support_case_id);
    if (!latestSessionBySupportCase.has(supportCaseId)) latestSessionBySupportCase.set(supportCaseId, row);
  }

  const summaries: ParticipantBriefingSummary[] = [];
  for (const supportCase of supportCases) {
    const session = latestSessionBySupportCase.get(supportCase.id);
    if (session === undefined) continue;
    const approvedRow = approvedBySession.get(stringValue(session.id));
    const text = approvedRow === undefined ? nullableString(session.memo) : stringValue(approvedRow.summary_text);
    if (text === null || text.length === 0) continue;
    summaries.push({
      sourceSupportCase: sourceSupportCase(supportCase),
      sessionId: stringValue(session.id),
      source: approvedRow === undefined ? 'memo' : 'ai',
      text,
      pendingApprovalCount: pendingBySupportCase.get(supportCase.id) ?? 0,
    });
  }

  // D45 영역 ① AI 제안 — approved 쿼리가 승인 최신순(approved_at DESC)이라 참여 사업당
  // 최근 승인본의 제안부터 최대 3개만 싣는다. 근거 회차(heldAt)는 세션 조회 결과에서 붙인다.
  const heldAtBySession = new Map<string, string>(
    sessions.results.map((row): [string, string] => [stringValue(row.id), stringValue(row.held_at)]),
  );
  const aiSuggestions: ParticipantBriefingSuggestion[] = [];
  const suggestionCountBySupportCase = new Map<string, number>();
  for (const row of approved.results) {
    const supportCaseId = stringValue(row.support_case_id);
    const source = sources.get(supportCaseId);
    if (source === undefined) continue;
    const sessionId = stringValue(row.session_id);
    for (const suggestion of briefingSuggestions(row)) {
      const count = suggestionCountBySupportCase.get(supportCaseId) ?? 0;
      if (count >= MAX_BRIEFING_AI_SUGGESTIONS) break;
      suggestionCountBySupportCase.set(supportCaseId, count + 1);
      aiSuggestions.push({
        sourceSupportCase: source,
        sessionId,
        heldAt: heldAtBySession.get(sessionId) ?? null,
        title: suggestion.title,
        reason: suggestion.reason,
      });
    }
  }

  // D45 영역 ② 회차별 정리 — sessions 쿼리가 이미 held_at DESC 라 최신순이 보존된다.
  // 핵심 한 줄은 approved_ai_briefing_v1 을 거친 승인분만 싣는다(R2) — approvedBySession 은
  // approved_at DESC 첫 행이라 회차당 최신 승인 초안의 한 줄이다.
  const sessionRows: ParticipantBriefingSessionRow[] = sessions.results.flatMap((row) => {
    const source = sources.get(stringValue(row.support_case_id));
    if (source === undefined) return [];
    const approvedRow = approvedBySession.get(stringValue(row.id));
    return [{
      sourceSupportCase: source,
      sessionId: stringValue(row.id),
      heldAt: stringValue(row.held_at),
      kind: stringValue(row.kind) === 'intake' ? 'intake' as const : 'regular' as const,
      aiOneLiner: approvedRow === undefined ? null : nullableString(approvedRow.one_liner),
      memoExcerpt: sessionMemoExcerpt(nullableString(row.memo)),
    }];
  });

  const actionItems = actions.results.flatMap((row) => {
    const source = sources.get(stringValue(row.support_case_id));
    if (source === undefined) return [];
    return [{
      sourceSupportCase: source,
      action: mapActionItem({ ...row, case_id: row.support_case_id }),
    }];
  });
  const discrepancies: ParticipantBriefingDiscrepancy[] = discrepancyRows.results.flatMap((row) => {
    const source = sources.get(stringValue(row.support_case_id));
    if (source === undefined) return [];
    const mapped = mapSessionDiscrepancy(row);
    return [{
      sourceSupportCase: source,
      id: mapped.id,
      kind: mapped.kind,
      left: { sessionId: mapped.leftSessionId, heldAt: stringValue(row.left_held_at), quote: mapped.leftQuote },
      right: { sessionId: mapped.rightSessionId, heldAt: stringValue(row.right_held_at), quote: mapped.rightQuote },
      detectedAt: mapped.detectedAt,
      resolution: mapped.resolutionStatus === null || mapped.resolvedAt === null
        ? null
        : { status: mapped.resolutionStatus, resolvedAt: mapped.resolvedAt },
    }];
  });

  const briefingFlags = flags.results.flatMap((row) => {
    const source = sources.get(stringValue(row.support_case_id));
    if (source === undefined) return [];
    return [{
      sourceSupportCase: source,
      flag: mapFlag({ ...row, case_id: row.support_case_id }),
    }];
  });

  // 포커스 참여사업의 다가오는(가장 이른 scheduled) 일정의 세션 목표·맞춤형 질문을 함께
  // 싣는다 (D28, 티켓 #34가 화면에 병기). 포커스는 이미 접근 인가됐고 loadScheduleSessionEntries
  // 는 감사·권한이 없는 내부 로더라 브리핑 감사 건수(read 1건)를 바꾸지 않는다. 상담 유형·방법(#36)도
  // 일정 행에서 함께 싣는다.
  let focusUpcomingSchedule: BriefingUpcomingSchedule | null = null;
  if (focus.status === 'active') {
    const upcomingRow = await env.DB.prepare(
      `SELECT id, scheduled_at, session_kind, channel FROM counseling_schedules
       WHERE org_id = ? AND support_case_id = ? AND status = 'scheduled'
       ORDER BY scheduled_at, id
       LIMIT 1`,
    ).bind(actor.orgId, focusSupportCaseId).first<DbRow>();
    if (upcomingRow !== null) {
      const scheduleId = stringValue(upcomingRow.id);
      const entries = await loadScheduleSessionEntries(env, actor.orgId, scheduleId);
      focusUpcomingSchedule = {
        id: scheduleId,
        scheduledAt: stringValue(upcomingRow.scheduled_at),
        sessionKind: canonicalScheduleKind(upcomingRow.session_kind),
        channel: canonicalScheduleChannel(upcomingRow.channel),
        sessionGoals: entries.sessionGoals,
        customQuestions: entries.customQuestions,
      };
    }
  }

  await writeCanonicalAudit(env, actor, {
    action: 'read',
    targetTable: 'participant_briefing',
    targetId: beneficiaryId,
    beneficiaryId,
    supportCaseId: focusSupportCaseId,
  });
  // 접근 권한은 assertSupportCaseAccess(focus)로 이미 통과했다 — 담당(활성 배정) 또는 admin.
  // 실명·연락처를 복호화해 실어 주고, 값이 있으면 화면 단위 감사 1건(read_participant_pii).
  const contacts = await loadParticipantContacts(env, actor.orgId, [beneficiaryId]);
  await auditParticipantPiiRead(env, actor, contacts, {
    targetId: beneficiaryId,
    supportCaseId: focusSupportCaseId,
  });
  return {
    beneficiaryId,
    focusedSupportCase: sourceSupportCase(focus),
    supportCases: supportCases.map(sourceSupportCase),
    gasTrends: [...trendByGoal.values()],
    summaries,
    sessionRows,
    actionItems,
    flags: briefingFlags,
    aiSuggestions,
    discrepancies,
    focusUpcomingSchedule,
    overallGoal: focus.overallGoal,
    canEditOverallGoal: actor.role === 'counselor' || actor.role === 'admin',
    participant: participantNamePhone(contacts.get(beneficiaryId)),
  };
}

export async function assignSupportCase(
  env: Env,
  actor: Actor,
  supportCaseId: string,
  userId: string,
  role: 'primary' | 'secondary' = 'secondary',
): Promise<SupportCaseAssignee> {
  assertAdmin(actor);
  await assertCurrentHumanActor(env, actor);
  assertOpaqueIdentifier(supportCaseId, 'support case id');
  assertOpaqueIdentifier(userId, 'assignee user id');
  if (role !== 'primary' && role !== 'secondary') {
    throw new ValidationError('assignee role is invalid');
  }
  const supportCase = await getSupportCaseForOrg(env, actor.orgId, supportCaseId, { completeOnly: true });
  await assertActiveHumanUser(env, actor.orgId, userId);
  const existing = await env.DB.prepare(
    `SELECT id FROM support_case_assignees
     WHERE org_id = ? AND support_case_id = ? AND user_id = ? AND unassigned_at IS NULL`,
  ).bind(actor.orgId, supportCaseId, userId).first<{ id: string }>();
  if (existing !== null) {
    throw new ConflictError('support case assignment already exists');
  }
  const id = newId();
  const assignedAt = now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO support_case_assignees (
         id, org_id, support_case_id, user_id, role, assigned_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, actor.orgId, supportCaseId, userId, role, assignedAt),
    canonicalAuditStatement(env, actor, {
      action: 'assign',
      targetTable: 'support_case_assignees',
      targetId: id,
      beneficiaryId: supportCase.beneficiaryId,
      supportCaseId,
      detail: { role },
    }),
  ]);
  return {
    id,
    supportCaseId,
    userId,
    role,
    assignedAt,
    unassignedAt: null,
  };
}

export async function transferSupportCase(
  env: Env,
  actor: Actor,
  supportCaseId: string,
  fromUserId: string,
  toUserId: string,
): Promise<void> {
  assertAdmin(actor);
  await assertCurrentHumanActor(env, actor);
  await assertOrganizationSettings(env, actor.orgId);
  assertOpaqueIdentifier(supportCaseId, 'support case id');
  assertOpaqueIdentifier(fromUserId, 'from user id');
  assertOpaqueIdentifier(toUserId, 'to user id');
  if (fromUserId === toUserId) {
    throw new ValidationError('transfer users must differ');
  }
  const supportCase = await getSupportCaseForOrg(env, actor.orgId, supportCaseId, { completeOnly: true });
  await assertActiveHumanUser(env, actor.orgId, toUserId);
  const current = await env.DB.prepare(
    `SELECT * FROM support_case_assignees
     WHERE org_id = ? AND support_case_id = ? AND user_id = ? AND unassigned_at IS NULL`,
  ).bind(actor.orgId, supportCaseId, fromUserId).first<DbRow>();
  if (current === null) {
    throw new ForbiddenError('support case assignment is unavailable');
  }
  const target = await env.DB.prepare(
    `SELECT id FROM support_case_assignees
     WHERE org_id = ? AND support_case_id = ? AND user_id = ? AND unassigned_at IS NULL`,
  ).bind(actor.orgId, supportCaseId, toUserId).first<{ id: string }>();
  if (target !== null) {
    throw new ConflictError('support case assignment already exists');
  }
  const transferredAt = now();
  const newAssignmentId = newId();
  const targetRole = toAssigneeRole(current.role);
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE support_case_assignees SET unassigned_at = ?
       WHERE id = ? AND org_id = ? AND unassigned_at IS NULL`,
    ).bind(transferredAt, stringValue(current.id), actor.orgId),
    env.DB.prepare(
      `INSERT INTO support_case_assignees (
         id, org_id, support_case_id, user_id, role, assigned_at
       )
       SELECT ?, ?, ?, ?, ?, ?
       WHERE changes() = 1`,
    ).bind(
      newAssignmentId,
      actor.orgId,
      supportCaseId,
      toUserId,
      targetRole,
      transferredAt,
    ),
    conditionalCanonicalAuditStatement(env, actor, {
      action: 'transfer',
      targetTable: 'support_case_assignees',
      targetId: newAssignmentId,
      beneficiaryId: supportCase.beneficiaryId,
      supportCaseId,
      detail: { role: targetRole },
    }),
  ]);
  const persisted = await env.DB.prepare(
    `SELECT source.id
     FROM support_case_assignees AS source
     WHERE source.id = ? AND source.org_id = ? AND source.support_case_id = ?
       AND source.user_id = ? AND source.unassigned_at = ?
       AND 1 = (
         SELECT COUNT(*) FROM support_case_assignees AS successor
         WHERE successor.id = ? AND successor.org_id = ? AND successor.support_case_id = ?
           AND successor.user_id = ? AND successor.role = ? AND successor.assigned_at = ?
           AND successor.unassigned_at IS NULL
       )
       AND 1 = (
         SELECT COUNT(*) FROM audit_log AS audit
         WHERE audit.org_id = ? AND audit.actor_id = ? AND audit.actor_role = ?
           AND audit.action = 'transfer' AND audit.target_table = 'support_case_assignees'
           AND audit.target_id = ? AND audit.case_id IS NULL
           AND audit.beneficiary_id = ? AND audit.support_case_id = ?
       )
     LIMIT 1`,
  ).bind(
    stringValue(current.id),
    actor.orgId,
    supportCaseId,
    fromUserId,
    transferredAt,
    newAssignmentId,
    actor.orgId,
    supportCaseId,
    toUserId,
    targetRole,
    transferredAt,
    actor.orgId,
    actor.userId,
    actor.role,
    newAssignmentId,
    supportCase.beneficiaryId,
    supportCaseId,
  ).first<{ id: string }>();
  if (persisted === null) {
    throw new ConflictError('support case assignment is unavailable');
  }
}

export async function unassignSupportCase(
  env: Env,
  actor: Actor,
  supportCaseId: string,
  userId: string,
): Promise<void> {
  assertAdmin(actor);
  await assertCurrentHumanActor(env, actor);
  const supportCase = await getSupportCaseForOrg(env, actor.orgId, supportCaseId, { completeOnly: true });
  const active = await env.DB.prepare(
    `SELECT id FROM support_case_assignees
     WHERE org_id = ? AND support_case_id = ? AND unassigned_at IS NULL`,
  ).bind(actor.orgId, supportCaseId).all<{ id: string }>();
  const assigned = await env.DB.prepare(
    `SELECT id, role FROM support_case_assignees
     WHERE org_id = ? AND support_case_id = ? AND user_id = ? AND unassigned_at IS NULL`,
  ).bind(actor.orgId, supportCaseId, userId).first<{ id: string; role: 'primary' | 'secondary' }>();
  if (assigned === null) {
    throw new ForbiddenError('support case assignment is unavailable');
  }
  if (assigned.role === 'primary') {
    throw new ValidationError('active primary support case assignee must be transferred before removal');
  }
  if (active.results.length <= 1) {
    throw new ValidationError('last active support case assignee cannot be removed');
  }
  const unassignedAt = now();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE support_case_assignees SET unassigned_at = ?
       WHERE id = ? AND org_id = ? AND unassigned_at IS NULL`,
    ).bind(unassignedAt, assigned.id, actor.orgId),
    conditionalCanonicalAuditStatement(env, actor, {
      action: 'update',
      targetTable: 'support_case_assignees',
      targetId: assigned.id,
      beneficiaryId: supportCase.beneficiaryId,
      supportCaseId,
      detail: { unassigned: true },
    }),
  ]);
}

export async function listSupportCaseAssignees(
  env: Env,
  actor: Actor,
  supportCaseId: string,
  opts?: { includeHistory?: boolean },
): Promise<SupportCaseAssignee[]> {
  const supportCase = await assertSupportCaseAccess(env, actor, supportCaseId);
  const result = await env.DB.prepare(
    `SELECT * FROM support_case_assignees
     WHERE org_id = ? AND support_case_id = ?
       ${opts?.includeHistory === true ? '' : 'AND unassigned_at IS NULL'}
     ORDER BY assigned_at, id`,
  ).bind(actor.orgId, supportCaseId).all<DbRow>();
  await writeCanonicalAudit(env, actor, {
    action: 'read',
    targetTable: 'support_case_assignees',
    beneficiaryId: supportCase.beneficiaryId,
    supportCaseId,
  });
  return result.results.map(mapSupportCaseAssignee);
}

/** 관리자 영역(재개편 T8)이 실무자 상세·사용자 화면에 싣는 '실무자별 활성 배정 당사자' 행. */
export interface CounselorAssignmentParticipant {
  beneficiaryId: string;
  supportCaseId: string;
  programType: 'financial_support_v1';
  status: 'active' | 'closed';
  assignmentRole: 'primary' | 'secondary';
  // D24·ADR-0005: admin 은 실명·연락처를 기본 열람한다(서버 복호화). PII 미기입이면 null.
  name: string | null;
  phone: string | null;
}

export interface CounselorAssignments {
  userId: string;
  participants: CounselorAssignmentParticipant[];
}

/**
 * 한 실무자(userId)의 활성 배정 당사자 목록 — 관리자 영역 사용자/실무자 상세 화면용(재개편 T8, D25).
 * 접근: admin 전용(assertAdmin), 자기 기관만. 실무자가 담당(활성 배정, unassigned_at IS NULL)한
 * 참여사업을 케이스 단위로 돌려주고, 각 당사자의 실명·연락처를 배치 복호화해 함께 싣는다.
 * 감사: 배정 목록 조회 1건(read, support_case_assignees) + 실명이 1건 이상 실리면 화면 단위
 * read_participant_pii 1건(D14·D24, loadParticipantContacts·auditParticipantPiiRead 공용 관문).
 * listSupportCasesForBeneficiary 와 동일한 이중 감사 형태다 — 대상만 실무자로 바뀐다.
 */
export async function listCounselorAssignments(
  env: Env,
  actor: Actor,
  userId: string,
): Promise<CounselorAssignments> {
  assertAdmin(actor);
  assertOpaqueIdentifier(userId, 'assignee user id');
  // 대상 실무자가 자기 기관 사용자인지 확인한다(없으면 ForbiddenError). 교차 기관 조회 차단.
  await getUserForOrg(env, actor.orgId, userId);
  const result = await env.DB.prepare(
    `SELECT support_cases.id AS support_case_id,
            support_cases.beneficiary_id AS beneficiary_id,
            support_cases.program_type AS program_type,
            support_cases.status AS status,
            support_case_assignees.role AS assignment_role
     FROM support_case_assignees
     JOIN support_cases ON support_cases.id = support_case_assignees.support_case_id
       AND support_cases.org_id = support_case_assignees.org_id
     WHERE support_case_assignees.org_id = ?
       AND support_case_assignees.user_id = ?
       AND support_case_assignees.unassigned_at IS NULL
     ORDER BY CASE support_cases.status WHEN 'active' THEN 0 ELSE 1 END,
              support_cases.beneficiary_id, support_cases.id`,
  ).bind(actor.orgId, userId).all<DbRow>();
  await writeAudit(env, actor, {
    action: 'read',
    targetTable: 'support_case_assignees',
    targetId: userId,
    detail: { assignmentsForUserId: userId, count: result.results.length },
  });
  const beneficiaryIds = result.results.map((row) => stringValue(row.beneficiary_id));
  const contacts = await loadParticipantContacts(env, actor.orgId, beneficiaryIds);
  await auditParticipantPiiRead(env, actor, contacts, { targetId: userId });
  return {
    userId,
    participants: result.results.map((row) => {
      const programType = row.program_type;
      assertFinancialSupportProgramType(programType);
      const beneficiaryId = stringValue(row.beneficiary_id);
      const contact = contacts.get(beneficiaryId) ?? { name: null, phone: null };
      return {
        beneficiaryId,
        supportCaseId: stringValue(row.support_case_id),
        programType,
        status: canonicalCaseStatus(row.status),
        assignmentRole: toAssigneeRole(row.assignment_role),
        name: contact.name,
        phone: contact.phone,
      };
    }),
  };
}

// ── 초대 토큰 (D39 · ADR-0016 · CCC-29) ─────────────────────────────────────
//
// 1차 MVP 가입 흐름의 기반. 토큰이 곧 자격이다(로그인 없음, 당사자는 users 미등재).
// 그래서 이 절의 조회·소비 함수는 예외적으로 Actor 없이 토큰 문자열을 받는다 —
// 인증 밖의 유일한 문이며, HTTP 라우트 테스트가 이 경계를 고정한다(스펙 #78 ②).
// 발급은 여전히 Actor 검사(R1)를 거치고, 발급·소비 전건이 audit_log 에 남는다(D14).

export type InviteKind = 'participant' | 'counselor';

export interface InviteToken {
  token: string;
  kind: InviteKind;
  orgId: string;
  /** participant 초대에는 항상 있고(링크가 사업을 정한다), counselor 초대는 null. */
  programType: string | null;
  issuedBy: string;
  status: 'issued' | 'used';
  issuedAt: string;
  usedAt: string | null;
}

/** 초대 소비를 감사할 때 쓰는 시스템 행위자 id. 가입자는 아직 디렉터리에 없다. */
export const INVITE_SIGNUP_ACTOR_ID = 'system:invite-signup';

/** 32바이트 난수 hex(64자). 추측·열거 불가가 이 토큰 보안의 전부다(의미 정보 금지, D20 참조). */
function newInviteTokenValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function mapInviteToken(row: DbRow): InviteToken {
  return {
    token: stringValue(row.token),
    kind: stringValue(row.kind) as InviteKind,
    orgId: stringValue(row.org_id),
    programType: row.program_type === null ? null : stringValue(row.program_type),
    issuedBy: stringValue(row.issued_by),
    status: stringValue(row.status) as InviteToken['status'],
    issuedAt: stringValue(row.issued_at),
    usedAt: row.used_at === null ? null : stringValue(row.used_at),
  };
}

/**
 * 당사자 가입 링크 발급(ADR-0016 결정 5). 실무자·관리자(사람)만 발급할 수 있고,
 * 링크에 사업(programType)과 발급자(actor)가 묶인다 — 가입 완료 시 이 발급자가
 * 담당 실무자가 된다(소비는 CCC-28의 가입 처리 몫).
 */
export async function createParticipantInvite(
  env: Env,
  actor: Actor,
  input: { programType: string },
): Promise<InviteToken> {
  assertHuman(actor);
  assertFinancialSupportProgramType(input.programType);

  const token = newInviteTokenValue();
  await env.DB.prepare(
    `INSERT INTO invite_tokens (token, org_id, kind, program_type, issued_by)
     VALUES (?, ?, 'participant', ?, ?)`,
  ).bind(token, actor.orgId, input.programType, actor.userId).run();

  await writeAudit(env, actor, {
    action: 'invite_issue',
    targetTable: 'invite_tokens',
    targetId: token,
    detail: { kind: 'participant', programType: input.programType },
  });

  return getInviteTokenOrThrow(env, token);
}

/**
 * 실무자 초대 링크 발급(CCC-33 이 화면을 단다). 관리자만 발급한다.
 * 가입 시 users 등재로 이어진다 — 소비는 counselor 종류로만 가능하다.
 */
export async function createCounselorInvite(env: Env, actor: Actor): Promise<InviteToken> {
  assertAdmin(actor);

  const token = newInviteTokenValue();
  await env.DB.prepare(
    `INSERT INTO invite_tokens (token, org_id, kind, program_type, issued_by)
     VALUES (?, ?, 'counselor', NULL, ?)`,
  ).bind(token, actor.orgId, actor.userId).run();

  await writeAudit(env, actor, {
    action: 'invite_issue',
    targetTable: 'invite_tokens',
    targetId: token,
    detail: { kind: 'counselor' },
  });

  return getInviteTokenOrThrow(env, token);
}

async function getInviteTokenOrThrow(env: Env, token: string): Promise<InviteToken> {
  const row = await env.DB.prepare('SELECT * FROM invite_tokens WHERE token = ?')
    .bind(token)
    .first<DbRow>();
  if (row === null) {
    throw new ForbiddenError('invite token is not available');
  }
  return mapInviteToken(row);
}

/**
 * 토큰 경계 조회(Actor 없음): 가입 화면이 "이 링크가 아직 유효한가 + 어느 기관·사업의
 * 초대인가"를 푸는 입구다. 종류 불일치·무효·이미 사용된 토큰은 전부 같은
 * ForbiddenError 로 거부한다 — 무엇이 틀렸는지 구분해 주면 열거 단서가 된다.
 */
export async function getInviteForSignup(
  env: Env,
  token: string,
  kind: InviteKind,
): Promise<InviteToken> {
  if (token.length === 0) {
    throw new ForbiddenError('invite token is not available');
  }
  const invite = await getInviteTokenOrThrow(env, token);
  if (invite.kind !== kind || invite.status !== 'issued') {
    throw new ForbiddenError('invite token is not available');
  }
  return invite;
}

/**
 * 토큰 소비(단방향 issued → used). UPDATE 의 WHERE status='issued' 가 원자적
 * 이중 사용 방지다 — 같은 토큰으로 두 번 가입할 수 없다. 가입자는 아직 디렉터리에
 * 없으므로 감사는 시스템 행위자(INVITE_SIGNUP_ACTOR_ID)로 남긴다(D14).
 */
export async function consumeInviteToken(
  env: Env,
  token: string,
  kind: InviteKind,
  usedBy: { beneficiaryId?: string; userId?: string },
): Promise<InviteToken> {
  const invite = await getInviteForSignup(env, token, kind);

  const result = await env.DB.prepare(
    `UPDATE invite_tokens
     SET status = 'used', used_at = datetime('now'), used_by_beneficiary_id = ?, used_by_user_id = ?
     WHERE token = ? AND status = 'issued'`,
  ).bind(usedBy.beneficiaryId ?? null, usedBy.userId ?? null, token).run();

  if (result.meta.changes !== 1) {
    throw new ForbiddenError('invite token is not available');
  }

  await writeAudit(env, systemActor(INVITE_SIGNUP_ACTOR_ID, invite.orgId), {
    action: 'invite_consume',
    targetTable: 'invite_tokens',
    targetId: token,
    detail: { kind, beneficiaryId: usedBy.beneficiaryId ?? null, userId: usedBy.userId ?? null },
  });

  return getInviteTokenOrThrow(env, token);
}
// ============================================================================
// 당사자 자기 가입(self signup) — 토 권한 원자 트랜잭션 (D39 · ADR-0016 · CCC-28)
//
// 당사자는 users 에 들지 않고 고유 토큰 링크로 가입한다. 이 함수는 인증된 행위자를
// 받지 않는다 — 토큰이 곧 자격이다. 대신 토큰에 박힌 발급자(issuedBy)를 '후원 행위자'
// 로 복원해 당사자·케이스·배정의 생성 감사를 남기고, 그 발급자를 담당 실무자로 배정한다
// (ADR-0016 결정 5). 동의 기록의 recorded_by 는 'self'(당사자 본인)로 둔다(결정 6).
//
// 한 배치(트랜잭션) 안에서: 당사자+금고+케이스+배정+생성 감사 3건+완료 전환, 그 뒤
// 동의 기록(recorded_by='self')+record_consent 감사, 마지막으로 토큰 소비 UPDATE+
// invite_consume 감사(시스템 행위자)를 넣는다. 토 소비를 같은 배치에 넣는 이유는
// 원자성 — 동시 이중 제출에서 진 쪽은 invite_tokens_no_double_consume 가드(0019)가
// 트랜잭션 전체를 되감아 고아 당사자가 남지 않게 한다.
//
// 감사 행위자 분리: 생성 3건+record_consent 감사는 후원 행위자(실제 사용자, 감사
// provenance 가드를 만족)로, invite_consume 감사는 시스템 행위자(INVITE_SIGNUP_ACTOR_ID)
// 로 남긴다. 후자는 beneficiary_id 를 갖지 않으므로 provenance 가드의 WHEN 에 걸리지
// 않는다. 동의 행의 recorded_by='self' 는 0019 가드가 허용한다.
// ============================================================================

/** 자기 가입 동의의 기록자 표식. 당사자 본인이 체크했음을 나타낸다(ADR-0016 결정 6). */
export const PARTICIPANT_SELF_RECORDER = 'self';

export interface ParticipantSignupInput {
  token: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  // 동의 3종(D44) — privacy 를 필수로 좁힌다. updateParticipantConsent 와 같은 모양이라
  // 등록 시 받은 값과 이후 수정·철회가 같은 어휘를 쓴다.
  consent: ParticipantConsentInput & { privacy: boolean };
}

export interface ParticipantSignupResult {
  beneficiaryId: string;
  supportCaseId: string;
}

/**
 * 당사자 가입 링크로 가입을 완료한다(원자). 토 검증 → 당사자+케이스+담당 배정+
 * 동의 기록(기록자=본인) → 토큰 소비를 한 트랜잭션에 묶는다. 인증된 행위자를 받지
 * 않는다(토큰이 자격). 이미 소비되었거나 없는 토큰은 ForbiddenError, 동시 이중 제출은
 * ConflictError, 입력 결함은 ValidationError.
 */
export async function completeParticipantSignup(
  env: Env,
  input: ParticipantSignupInput,
): Promise<ParticipantSignupResult> {
  const optionalKeys = (['phone', 'email'] as const).filter((key) => input[key] !== undefined);
  assertExactKeys(input, ['token', 'name', 'consent', ...optionalKeys]);
  assertNonBlankText(input.token, 'token');
  assertNonBlankText(input.name, 'name');
  for (const key of optionalKeys) {
    const value = input[key];
    if (value !== null) assertNonBlankText(value, key);
  }
  // 동의 2종(D49). 자기 가입은 등록이므로 등록 경로와 같은 2체크를 받는다. 둘 다 필수 boolean 이다.
  if (
    input.consent === null
    || typeof input.consent !== 'object'
    || typeof input.consent.privacy !== 'boolean'
    || typeof input.consent.recordingAi !== 'boolean'
  ) {
    throw new ValidationError('consent is required');
  }
  // ① 하드 게이트(G1): 자기 가입에는 **긴급 등록 예외가 없다**. 긴급 등록은 실무자가
  // 사유를 적고 책임지는 예외인데(전건 감사·보완 기한), 여기서는 당사자 본인이 체크하고
  // 판단할 실무자가 그 자리에 없다. ② ③ 미동의 경로는 그대로다(D15).
  if (input.consent.emergency !== undefined) {
    throw new ValidationError('emergency registration is not available on self signup');
  }
  assertPrivacyConsentGate(input.consent.privacy, undefined, now());

  // 순차 이중 제출 게이트: 이미 소비되었거나 종류가 안 맞으면 여기서 거부한다.
  // 동시 경계는 아래 배치 안의 가드가 맡는다.
  const invite = await getInviteForSignup(env, input.token, 'participant');
  const programType = invite.programType;
  if (programType === null) {
    throw new ForbiddenError('invite token is not available');
  }
  assertFinancialSupportProgramType(programType);

  // 후원 행위자 복원: 발급자가 활성 사용자인지 확인하고 역할까지 가져와 감사·배정에 쓴다.
  const sponsorRow = await env.DB.prepare(
    `SELECT id, role FROM users
     WHERE id = ? AND org_id = ? AND active = 1 AND role IN ('admin', 'counselor')`,
  ).bind(invite.issuedBy, invite.orgId).first<{ id: string; role: string }>();
  if (sponsorRow === null) {
    throw new ForbiddenError('invite sponsor is unavailable');
  }
  const sponsorActor: Actor = { userId: sponsorRow.id, orgId: invite.orgId, role: sponsorRow.role as Actor['role'] };

  await assertOrganizationSettings(env, invite.orgId);
  const piiKeyVersion = activePiiKeyVersion(env);
  const encName = await encryptPii(env, input.name);
  const encPhone = input.phone === undefined || input.phone === null ? null : await encryptPii(env, input.phone);
  const encEmail = input.email === undefined || input.email === null ? null : await encryptPii(env, input.email);

  let finalError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const beneficiaryId = await allocateBeneficiaryId(env, invite.orgId);
    const supportCaseId = newId();
    const assignmentId = newId();
    const consentRecordId = newId();
    const createdAt = now();
    // D49: ② 한 체크 → 두 컬럼에 같은 시각.
    const consentRecordingAt = input.consent.recordingAi ? createdAt : null;
    const consentTextAiAt = input.consent.recordingAi ? createdAt : null;
    const consentPrivacyAt = input.consent.privacy ? createdAt : null;
    try {
      const statements: D1PreparedStatement[] = [
        env.DB.prepare(
          `INSERT INTO beneficiaries (
             id, org_id, initialization_state, created_at, updated_at
           ) VALUES (?, ?, 'pending', ?, ?)`,
        ).bind(beneficiaryId, invite.orgId, createdAt, createdAt),
        env.DB.prepare(
          `INSERT INTO participant_pii_vault (
             beneficiary_id, org_id, enc_name, enc_phone, enc_email, key_version, version,
             retention_change_kind, retention_changed_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 1, 'create', ?, ?, ?)`,
        ).bind(beneficiaryId, invite.orgId, encName, encPhone, encEmail, piiKeyVersion, createdAt, createdAt, createdAt),
        env.DB.prepare(
          `INSERT INTO support_cases (
             id, org_id, beneficiary_id, legacy_case_id, program_type, status, intake_at,
             consent_recording_at, consent_text_ai_at, consent_privacy_at, creation_kind, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, 'initial', ?, ?)`,
        ).bind(
          supportCaseId,
          invite.orgId,
          beneficiaryId,
          null,
          programType,
          null,
          consentRecordingAt,
          consentTextAiAt,
          consentPrivacyAt,
          createdAt,
          createdAt,
        ),
        env.DB.prepare(
          `INSERT INTO support_case_assignees (
             id, org_id, support_case_id, user_id, role, assigned_at
           ) VALUES (?, ?, ?, ?, 'primary', ?)`,
        ).bind(assignmentId, invite.orgId, supportCaseId, sponsorRow.id, createdAt),
        canonicalAuditStatement(env, sponsorActor, {
          action: 'create',
          targetTable: 'beneficiaries',
          targetId: beneficiaryId,
          beneficiaryId,
          supportCaseId: null,
          detail: { schemaVersion: 1, via: 'invite_signup' },
          caseId: null,
        }),
        canonicalAuditStatement(env, sponsorActor, {
          action: 'create',
          targetTable: 'support_cases',
          targetId: supportCaseId,
          beneficiaryId,
          supportCaseId,
          detail: { programType, schemaVersion: 1, via: 'invite_signup' },
          caseId: null,
        }),
        canonicalAuditStatement(env, sponsorActor, {
          action: 'assign',
          targetTable: 'support_case_assignees',
          targetId: assignmentId,
          beneficiaryId,
          supportCaseId,
          detail: { role: 'primary', initial: true, via: 'invite_signup' },
          caseId: null,
        }),
        env.DB.prepare(
          `UPDATE beneficiaries
           SET initialization_state = 'complete', updated_at = ?
           WHERE id = ? AND org_id = ? AND initialization_state = 'pending'`,
        ).bind(createdAt, beneficiaryId, invite.orgId),
      ];
      const completionIndex = statements.length - 1;
      // 동의 기록(기록자=본인) + 감사는 완료 전환 뒤에 쌓는다(beneficiaries_complete_guard 가
      // 그 시점에 당사자 감사 3건을 요구하므로).
      statements.push(
        env.DB.prepare(
          `INSERT INTO participant_consent_records (
             id, org_id, beneficiary_id, support_case_id, consent_recording_at,
             consent_text_ai_at, consent_privacy_at, recorded_by, recorded_at, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          consentRecordId,
          invite.orgId,
          beneficiaryId,
          supportCaseId,
          consentRecordingAt,
          consentTextAiAt,
          consentPrivacyAt,
          PARTICIPANT_SELF_RECORDER,
          createdAt,
          createdAt,
        ),
        canonicalAuditStatement(env, sponsorActor, {
          action: 'record_consent',
          targetTable: 'participant_consent_records',
          targetId: consentRecordId,
          beneficiaryId,
          supportCaseId,
          detail: {
            privacy: input.consent.privacy,
            recordingAi: input.consent.recordingAi,
            recorder: PARTICIPANT_SELF_RECORDER,
          },
          caseId: null,
        }),
      );
      // 토큰 소비를 같은 배치에: 상태 술어 없이 업데이트해 경계에서 used 행을 맞춰도
      // 가드(0019)가 used->used 를 RAISE 로 막아 트랜잭션 전체를 되감게 한다.
      statements.push(
        env.DB.prepare(
          `UPDATE invite_tokens
           SET status = 'used', used_at = ?, used_by_beneficiary_id = ?, used_by_user_id = NULL
           WHERE token = ?`,
        ).bind(createdAt, beneficiaryId, input.token),
        env.DB.prepare(
          `INSERT INTO audit_log (
             org_id, actor_id, actor_role, action, target_table, target_id, case_id, detail, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'))`,
        ).bind(
          invite.orgId,
          INVITE_SIGNUP_ACTOR_ID,
          'service',
          'invite_consume',
          'invite_tokens',
          input.token,
          stringifyJson({ kind: 'participant', beneficiaryId, via: 'signup' }),
        ),
      );

      const results = await env.DB.batch(statements);
      const completion = results[completionIndex] as unknown as { meta?: { changes?: number } };
      if ((completion.meta?.changes ?? 0) < 1) {
        throw new ConflictError('participant initialization did not complete');
      }
      return { beneficiaryId, supportCaseId };
    } catch (error) {
      finalError = error;
      if (!isUniqueConstraintError(error)) break;
    }
  }
  // 동시 이중 제출: 진 쪽 배치는 가드가 되감았고, 그 오류를 409 로 번역한다.
  if (finalError instanceof Error && finalError.message.includes('invite_token_already_used')) {
    throw new ConflictError('invite token already used');
  }
  throw finalError instanceof Error ? finalError : new ConflictError('participant signup conflicted');
}

