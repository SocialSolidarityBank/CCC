import 'server-only';
import { headers } from 'next/headers';
import { getCloudflareContext } from '@opennextjs/cloudflare';

export type ApiErrorCode =
  | 'authentication_required'
  | 'access_denied'
  | 'forbidden'
  | 'invalid_request'
  | 'validation_error'
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
  | 'service_unavailable';

const knownErrorCodes = new Set<ApiErrorCode>([
  'authentication_required',
  'access_denied',
  'forbidden',
  'invalid_request',
  'validation_error',
  'not_found',
  'conflict',
  'not_eligible_or_already_purged',
  'pilot_text_ai_consent_required',
  'text_ai_pilot_disabled',
  'stale_draft_version',
  'draft_version_required',
  'grounded_evidence_required',
  'ai_provider_not_configured',
  'ai_prohibited_output',
  'ai_provider_unavailable',
  'service_unavailable',
]);

export class ApiError extends Error {
  constructor(readonly code: ApiErrorCode) {
    super(code);
    this.name = 'ApiError';
  }
}

export interface CaseRecord {
  id: string;
  programType: string;
  status: 'active' | 'closed';
  intakeAt: string | null;
}

export interface Goal {
  id: string;
  caseId: string;
  title: string;
  status: 'active' | 'closed';
  closedAt: string | null;
  closedReason: string | null;
}

export interface ManualSession {
  id: string;
  caseId: string;
  heldAt: string;
  channel: 'in_person' | 'phone' | 'video';
  memo: string | null;
  aiStatus: string;
}

export interface OfficialBriefingFlag {
  id: string;
  flagType: string;
  source: 'ai' | 'counselor';
  reviewStatus: 'confirmed';
}

export interface Briefing {
  caseId: string;
  gasTrend: Array<{
    goal: Goal;
    points: Array<{ heldAt: string; score: number }>;
  }>;
  lastSessionSummary: {
    source: 'ai' | 'memo';
    text: string;
    pendingApprovalCount: number;
  } | null;
  openActionItems: Array<{
    id: string;
    description: string;
    dueDate: string | null;
  }>;
  flags: OfficialBriefingFlag[];
  questions: string[];
}

export interface PilotTextAiConsent {
  caseId: string;
  status: 'recorded' | 'missing';
  evidenceId: string | null;
  noticeVersion: string | null;
  noticeHash: string | null;
  evidenceHash: string | null;
  effectiveAt: string | null;
}

export interface AiEvidence {
  id: string;
  claimKey: string;
  quote: string;
}

export type AiDraftReviewDecision = 'approved' | 'rejected' | 'superseded' | null;

export interface AiDraft {
  version: number;
  summaryText: string;
  /** D45 핵심 한 줄(CCC-38) — 승인 화면에서 요약·질문과 함께 검토된다. null = 레거시 초안. */
  oneLiner: string | null;
  /** CCC-39: 구조화 제안(제목+이유). 승인 흐름에서 요약과 함께 승인된다(R2). */
  questions: Array<{ title: string; reason: string }>;
  reviewDecision: AiDraftReviewDecision;
  evidence: AiEvidence[];
}

export interface CreateCaseInput {
  programType: string;
  intakeAt?: string;
}

export interface ManualSessionInput {
  heldAt: string;
  channel: 'in_person' | 'phone' | 'video';
  memo: string;
}

export interface PilotTextAiConsentInput {
  noticeVersion: string;
  noticeHash: string;
  evidenceRef: string;
  evidenceHash: string;
  effectiveAt: string;
}

export interface EditAiDraftInput {
  expectedVersion: number;
  evidenceIds: string[];
}

export interface ReviewAiDraftInput {
  expectedVersion: number;
  decision: 'approved' | 'rejected';
}

/** 사용자 디렉터리 역할(users 테이블). 화면 라벨은 페이지에서 CONTEXT.md 용어로 매핑한다. */
export type DirectoryRole = 'admin' | 'counselor' | 'service';

/** 로그인한 본인의 신원 — 설정 화면 '내 계정'(GET /me). */
export interface MyIdentity {
  id: string;
  orgId: string;
  email: string;
  role: DirectoryRole;
  active: boolean;
  // D31: 직원 표시 이름. 미입력이면 null 이며 화면은 이메일로 폴백한다.
  name: string | null;
}

/** 기관 사용자 디렉터리 항목 — 설정 화면 '기관 실무자 목록'(GET /users, 기관 관리자 전용). */
export interface DirectoryUser {
  id: string;
  orgId: string;
  email: string;
  role: DirectoryRole;
  active: boolean;
  // D31: 직원 표시 이름. 미입력이면 null 이며 화면은 이메일로 폴백한다.
  name: string | null;
}

export type ParticipantProgramType = 'financial_support_v1';

export type CounselingScheduleStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';
export type FlagType =
  | 'crisis_utterance'
  | 'contact_loss_risk'
  | 'housing_livelihood_shock'
  | 'debt_deterioration'
  | 'repeated_noncompliance';


export interface SourceSupportCase {
  id: string;
  programType: ParticipantProgramType;
  status: 'active' | 'closed';
}

export interface ParticipantProgram {
  id: string;
  beneficiaryId: string;
  programType: ParticipantProgramType;
  status: 'active' | 'closed';
  intakeAt: string | null;
  creationKind: 'legacy_import' | 'initial' | 'subsequent';
  sourceSupportCase: SourceSupportCase | null;
  /**
   * D36: 내가 담당(또는 admin)인 사업인가. false 면 존재와 담당 실무자 이름까지만 보이고
   * 상담 내용(브리핑·기록)으로는 들어갈 수 없다 — 화면은 이 값으로 링크를 잠근다.
   */
  authorized: boolean;
  /** 활성 담당 실무자 표시 이름. 비담당 사업에서 "누구에게 물어보나"를 답한다. */
  assigneeNames: string[];
  /** 동의 3종의 현재 상태(D44). 등록 시 받고 당사자 정보 페이지에서 고친다. */
  consent: ParticipantConsent;
  /** 마지막으로 동의 상태를 기록한 시각. 한 번도 없으면 null(최초 동의일이 아니다). */
  consentRecordedAt: string | null;
}

/** 동의 3종(D15·D23·D44). 개인정보 수집·이용 / 녹음·음성 분석 / 텍스트 AI 정리. */
export interface ParticipantConsent {
  privacy: boolean;
  recording: boolean;
  textAi: boolean;
}

export interface ParticipantDetail {
  beneficiaryId: string;
  // D24·D31: 역할 기준 실명·연락처 기본 표시. 미기입이거나 범위 밖이면 null(슬러그 폴백).
  // 서버가 이미 화면 단위 감사를 남기므로(db/gateway.ts) 화면에서 감사를 또 남기지 않는다.
  name: string | null;
  phone: string | null;
  programs: ParticipantProgram[];
}

/** 당사자 목록(사이드바 '당사자'의 도착지). 케이스 상태로 거르지 않는다 — 종결만 남은 당사자도 나온다. */
export interface AssignedParticipant {
  beneficiaryId: string;
  status: 'active' | 'closed';
  programCount: number;
  name: string | null;
  phone: string | null;
}

export interface ParticipantSearchResult {
  beneficiaryId: string;
  status: 'active' | 'closed';
  programCount: number;
  // D24·ADR-0005: 선택 UI 실명 목록. 담당·admin 범위 밖이거나 미기입이면 null.
  name: string | null;
}

export interface TodaySchedule {
  id: string;
  beneficiaryId: string;
  supportCaseId: string;
  scheduledAt: string;
  programType: ParticipantProgramType;
  status: CounselingScheduleStatus;
  // D24·ADR-0005: 담당·admin 카드에 실린 실명·연락처(서버 복호화). 미기입이면 null.
  participantName: string | null;
  participantPhone: string | null;
}

export interface TodaySchedules {
  date: string;
  timeZone: string;
  startUtc: string;
  endUtc: string;
  schedules: TodaySchedule[];
}

export interface ParticipantBriefingSection {
  sourceSupportCase: SourceSupportCase;
  gasTrend: Array<{
    goalId: string;
    goalTitle: string;
    status: 'active' | 'closed';
    closedAt: string | null;
    points: Array<{ heldAt: string; score: number }>;
  }>;
  lastSessionSummary: {
    source: 'ai' | 'memo';
    text: string;
    pendingApprovalCount: number;
  } | null;
  openActionItems: Array<{
    id: string;
    description: string;
    owner: 'counselor' | 'beneficiary' | 'org';
    dueDate: string | null;
  }>;
  flags: Array<{
    id: string;
    flagType: FlagType;
    source: 'ai' | 'counselor';
    reviewStatus: 'confirmed';
  }>;
  // D45 영역 ① AI 제안(CCC-39) — 제목·이유·근거 회차. 최대 3개(서버가 끊는다).
  // reason=null 은 구조화 이전(v1) 단문 질문 저장분 — 화면은 이유 줄만 생략한다.
  aiSuggestions: Array<{
    title: string;
    reason: string | null;
    sessionId: string;
    heldAt: string | null;
  }>;
  // D45 영역 ② 회차별 정리 — 상담일·유형·핵심 한 줄(최신순). 승인된 AI 한 줄이 없으면
  // 화면이 수기 발췌 + '수기' 배지로 폴백한다(D5·CCC-38).
  sessionRows: Array<{
    sessionId: string;
    heldAt: string;
    kind: 'regular' | 'intake';
    aiOneLiner: string | null;
    memoExcerpt: string | null;
  }>;
}

// 티켓 #35(T5) 계약: 포커스 참여사업의 다가오는 상담 일정 + 그 세션 목표(케이스 목표 연결)·
// 맞춤형 질문. 티켓 #34(T4) 상담 준비 화면이 "오늘 확인할 질문" 카드에 병기한다. 일정 없으면 null.
export interface BriefingUpcomingSchedule {
  id: string;
  scheduledAt: string;
  sessionGoals: Array<{ body: string; caseGoalId: string | null; caseGoalTitle: string | null }>;
  customQuestions: string[];
}

export interface ParticipantBriefing {
  beneficiaryId: string;
  focusSupportCaseId: string;
  /** D45 전체 목표 — 포커스 케이스당 1개, null = 설정 전. */
  overallGoal: string | null;
  /** D45: 담당 실무자만 그 자리 편집. admin 은 열람만이라 false 로 온다. */
  canEditOverallGoal: boolean;
  // D24·ADR-0005: 담당·기관 관리자에게 기본 표시하는 실명·연락처. 미기입이면 null.
  participant: { name: string | null; phone: string | null };
  sections: ParticipantBriefingSection[];
  // T5 계약: 포커스 참여사업의 다가오는 일정(세션 목표·맞춤형 질문). 없으면 null.
  focusUpcomingSchedule: BriefingUpcomingSchedule | null;
}

export interface ManualGasScore {
  goalId: string;
  score: number;
}

export interface ManualActionItem {
  description: string;
  owner: 'counselor' | 'beneficiary' | 'org';
  dueDate?: string;
}

export interface ManualRecordFlag {
  flagType: FlagType;
}

export const actionItemResolutionStatuses = ['done', 'in_progress', 'not_done', 'hold'] as const;
export type ActionItemResolutionStatus = (typeof actionItemResolutionStatuses)[number];

export interface ManualActionItemResolution {
  actionItemId: string;
  status: ActionItemResolutionStatus;
  note?: string;
}

export interface OpenActionItem {
  id: string;
  description: string;
  owner: 'counselor' | 'beneficiary' | 'org';
  dueDate: string | null;
}

// 생활 6영역 스냅샷(CCC-8).
export type LifeAreaKey = (typeof lifeAreaKeys)[number];
export type LifeAreaStatus = (typeof lifeAreaStatuses)[number];

export interface LifeAreaSnapshotEntry {
  areaKey: LifeAreaKey;
  status: LifeAreaStatus;
  note: string | null;
}

// 회차별 6영역 입력: changed=false('변화 없음')면 직전 스냅샷을 복사하고,
// changed=true 면 status(+note)로 기록한다.
export type ManualLifeArea =
  | { areaKey: LifeAreaKey; changed: false }
  | { areaKey: LifeAreaKey; changed: true; status: LifeAreaStatus; note?: string };

export interface SupportCaseRecord {
  id: string;
  heldAt: string;
  channel: 'in_person' | 'phone' | 'video';
  memo: string;
  gasScores: Array<ManualGasScore & { goalTitle: string }>;
  actionItems: Array<{
    id: string;
    description: string;
    owner: 'counselor' | 'beneficiary' | 'org';
    dueDate: string | null;
    resolved: boolean;
  }>;
  flags: Array<{
    id: string;
    flagType: FlagType;
    source: 'ai' | 'counselor';
    reviewStatus: 'confirmed' | 'rejected' | 'pending';
  }>;
  lifeAreaSnapshot: LifeAreaSnapshotEntry[];
  // 기록 종류(CCC-7) — 목록에서 인테이크/정기 구분 표시용.
  kind: SessionKind;
  createdAt: string;
}

export interface SupportCaseRecordGoal {
  id: string;
  title: string;
  status: 'active' | 'closed';
}

export interface SupportCaseRecords {
  records: SupportCaseRecord[];
  goals: SupportCaseRecordGoal[];
  schedule: CounselingSchedule | null;
}

// 정기 기록지 고정 헤더의 "이번 상담 목표"(D28 · CCC-10). 일정에 연결된 세션 목표를 표시한다.
export interface RecordSessionGoal {
  body: string;
  caseGoalTitle: string | null;
}

// 지난 상담 한 줄 요약(D5 수기 메모 폴백 · CCC-10). 참고 표시용이며 클릭 시 브리핑으로 이동한다.
export interface RecordLastSummary {
  heldAt: string;
  text: string;
}

export interface NewRecordContext {
  goals: SupportCaseRecordGoal[];
  schedules: CounselingSchedule[];
  openActionItems: OpenActionItem[];
  // 직전 회차의 6영역 스냅샷(CCC-8) — 폼의 "직전 상태" 표시원. 스냅샷 이력이 없으면 빈 배열.
  latestLifeAreaSnapshot: LifeAreaSnapshotEntry[];
  // 다가오는 일정의 세션 목표·맞춤형 질문(CCC-10). 일정이 없거나 조회 실패 시 빈 배열로 낮춰 동작한다.
  sessionGoals: RecordSessionGoal[];
  customQuestions: string[];
  // 지난 상담 한 줄 요약(CCC-10). 수기 메모가 있는 최신 회차의 첫 줄. 없으면 null.
  lastRecordSummary: RecordLastSummary | null;
}

export interface CreateInitialParticipantProgramInput {
  programType: ParticipantProgramType;
  intakeAt: string;
  initialAssigneeUserId?: string;
  // 항목별 동의 3종(D15·D23·D44). 기본 미동의. 미동의여도 등록은 진행된다.
  consentPrivacy?: boolean;
  consentRecording?: boolean;
  consentTextAi?: boolean;
  // 등록 시 받은 이름·연락처·이메일(선택). pii_vault enc_* 로 저장된다(D3 · D24 · #32·#37).
  // JSON 직렬화가 undefined 를 지우므로 미입력은 바디에서 자연히 빠진다.
  name?: string;
  phone?: string;
  email?: string;
  // D41 1-1 · D42: 생년월일(YYYY-MM-DD)·주소 또는 거주지역·성별도 등록이 받아 금고에 넣는다.
  birthDate?: string;
  region?: string;
  gender?: string;
}

export interface ScheduleCandidate {
  beneficiaryId: string;
  supportCaseId: string;
  programType: ParticipantProgramType;
  // D31·D24: 당사자 선택 UI 의 역할 기준 실명·연락처·이메일. 담당·admin 범위 밖이거나 미기입이면 null.
  participantName: string | null;
  participantPhone: string | null;
  participantEmail: string | null;
  /**
   * 인테이크 완료 시각. null 이면 아직 인테이크가 없다 (D35 · ADR-0014 §5).
   * 1단계가 이 값으로 상담 유형 기본값을 잡는다 — 없으면 '인테이크', 있으면 '기본 상담'.
   */
  intakeAt: string | null;
}

export interface CreateSubsequentParticipantProgramInput {
  schemaVersion: 1;
  submissionId: string;
  programType: ParticipantProgramType;
  intakeAt: string;
  sourceSupportCaseId?: string;
  initialAssigneeUserId?: string;
}

export interface ParticipantProgramCreation {
  beneficiaryId: string;
  supportCaseId: string;
  assignmentRole: 'primary';
  replayed: boolean;
}

export interface CreateCounselingRecordInput {
  submissionId: string;
  heldAt: string;
  channel: SupportCaseRecord['channel'];
  memo: string;
  gasScores: ManualGasScore[];
  actions: ManualActionItem[];
  flags: ManualRecordFlag[];
  actionResolutions?: ManualActionItemResolution[];
  lifeAreas?: ManualLifeArea[];
  details?: ManualRecordDetails;
  goalTransition?: ManualGoalTransition;
  scheduleId?: string;
  expectedScheduleVersion?: number;
}

// 정기 기록지 서술형 항목(CCC-10 · 0016). 전부 선택이며 채운 항목이 없으면 details 를 보내지 않는다.
export interface ManualRecordDetails {
  sessionGoalNote?: string;
  changeSinceLast?: string;
  safetyNote?: string;
  counselorOpinion?: string;
}

// 목표 종료+신설(CCC-10 · D12). 문구 수정 금지 — 종료(사유 필수) 후 신설로만 바꾼다.
export interface ManualGoalTransition {
  closeGoalId: string;
  closedReason: string;
  newGoalTitle?: string;
}

export interface CreatedCounselingRecord {
  id: string;
  heldAt: string;
  channel: SupportCaseRecord['channel'];
  memo: string;
}

export interface CreateCounselingRecordResult {
  record: CreatedCounselingRecord;
  replayed: boolean;
}

// 인테이크 작성 컨텍스트(CCC-7). 회차 자동값·당사자 표시(D31)·기존 인테이크 여부.
export interface IntakeRecordContext {
  beneficiaryId: string;
  supportCaseId: string;
  participant: { name: string | null; phone: string | null; email: string | null };
  sessionSequence: number;
  hasIntake: boolean;
  // 1-1 기본정보 표시용(D42 ①). 서버가 금고에서 복호화해 실어 준다(감사 1건).
  extendedPii: IntakeExtendedPii;
  // 1단계 동의 상태 표시용(D42 ②). 입력은 당사자 등록 화면 몫.
  consent: { privacy: boolean; recording: boolean; textAi: boolean };
}

// 인테이크 6영역 기준선(P1): 6영역 전부 상태 직접 입력('변화 없음' 없음).
export interface IntakeLifeAreaInput {
  areaKey: LifeAreaKey;
  status: LifeAreaStatus;
  note?: string;
}

export interface IntakeGoalInput {
  title: string;
  scaleCriteria?: unknown;
}

// 질문지 답변 키 어휘. 게이트웨이 INTAKE_ANSWER_KEYS 와 같은 순서·같은 값이어야 한다(D41).
export const intakeAnswerKeys = [
  'referral_path', 'referral_org', 'referral_reason',
  'more_since', 'more_trigger', 'more_focus',
  'life_detail_economy', 'life_detail_housing', 'life_detail_employment',
  'life_detail_health', 'life_detail_mental_health', 'life_detail_family',
  'crisis_immediate_risk', 'crisis_needed_connection', 'crisis_safety_status', 'crisis_emergency_contact',
  'strength_personal', 'strength_relational', 'strength_past_coping', 'strength_resources',
  'participation_availability', 'participation_transport', 'participation_constraint',
  'welfare_basic_livelihood', 'welfare_benefit_type', 'welfare_near_poverty', 'welfare_other',
  'counsel_method', 'contact_time', 'contact_caution',
  'application_reason', 'application_reason_detail',
  'difficulty_areas',
  'economy_income_type', 'economy_monthly_income', 'economy_monthly_expense',
  'economy_arrears', 'economy_debt_types',
  'employment_status', 'employment_income_stability', 'employment_detail',
  'housing_type', 'housing_instability', 'housing_detail',
  'health_physical', 'health_care_barrier', 'health_stress', 'health_daily_impact', 'health_detail',
  'family_household_type', 'family_care_burden', 'family_detail',
  'need_primary', 'need_secondary', 'need_detail',
  'previous_support_detail',
  'strength_detail',
  'participation_barrier', 'participation_preferred_method', 'participation_detail',
  'summary_urgency', 'summary_direction',
] as const;
export type IntakeAnswerKey = (typeof intakeAnswerKeys)[number];

export const intakeAnswerResponses = ['answered', 'declined', 'unknown', 'not_applicable'] as const;
export type IntakeAnswerResponse = (typeof intakeAnswerResponses)[number];

export interface IntakeAnswerInput {
  key: IntakeAnswerKey;
  response: IntakeAnswerResponse;
  text?: string;
}

export const intakeExtendedPiiFields = ['birthDate', 'region', 'emergencyContact', 'gender'] as const;
export type IntakeExtendedPiiField = (typeof intakeExtendedPiiFields)[number];
export type IntakeExtendedPii = Record<IntakeExtendedPiiField, string | null>;
export type IntakeExtendedPiiInput = Partial<Record<IntakeExtendedPiiField, string>>;

export interface IntakeAdditionalItemInput {
  item: string;
  owner?: string;
  dueDate?: string;
  reason?: string;
  method?: string;
  dueNote?: string;
}

// 반복 행 표 2종(2-1 부채 · 3-3 연계 기관). 첫 열만 필수다.
export interface IntakeDebtEntryInput {
  creditor: string;
  kind?: string;
  balance?: string;
  monthlyPayment?: string;
  arrearsStatus?: string;
}

export interface IntakeLinkedOrgInput {
  orgName: string;
  serviceName?: string;
  supportDetail?: string;
  usagePeriod?: string;
  progressStatus?: string;
}

export interface IntakeNextMeetingInput {
  heldAt: string;
  channel: SupportCaseRecord['channel'];
}

export interface CreateIntakeRecordInput {
  submissionId: string;
  heldAt: string;
  channel: SupportCaseRecord['channel'];
  // D42: 5종은 선택 — 정본 질문지에 대응 항목이 없다(동의는 등록 화면, 목표는 보류).
  consent?: { privacy: boolean; recordingAi: boolean };
  helpNarrative?: { todayHelp: string; hardestPoint: string; desiredChange: string };
  lifeAreas?: IntakeLifeAreaInput[];
  goals?: IntakeGoalInput[];
  actions?: ManualActionItem[];
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

export interface CreatedIntakeRecord {
  id: string;
  heldAt: string;
  channel: SupportCaseRecord['channel'];
  kind: SessionKind;
}

export interface CreateIntakeRecordResult {
  record: CreatedIntakeRecord;
  replayed: boolean;
}

export interface CounselingSchedule {
  id: string;
  beneficiaryId: string;
  supportCaseId: string;
  scheduledAt: string;
  status: CounselingScheduleStatus;
  version: number;
}

export interface CreateScheduleSessionGoalInput {
  body: string;
  caseGoalId?: string | null;
}

export interface CreateCounselingScheduleInput {
  beneficiaryId: string;
  supportCaseId: string;
  scheduledAt: string;
  /** 상담 유형. 생략하면 'regular'(기본 상담). 티켓 #36. */
  sessionKind?: 'regular' | 'intake';
  /** 상담 방법. 생략하면 'in_person'(v1 대면 전용, D4). */
  channel?: 'in_person';
  /** 세션 목표(regular 전용). intake 에는 줄 수 없다. */
  sessionGoals?: CreateScheduleSessionGoalInput[];
  /** 케이스 목표(intake 전용, D12). 측정 가능한 문장 1~3개. */
  caseGoals?: string[];
  customQuestions?: string[];
}

export interface RescheduleCounselingScheduleInput {
  expectedVersion: number;
  scheduledAt: string;
}

export interface ScheduleTransitionInput {
  expectedVersion: number;
}

const participantProgramTypes = ['financial_support_v1'] as const;
const caseStatuses = ['active', 'closed'] as const;
const creationKinds = ['legacy_import', 'initial', 'subsequent'] as const;
const recordChannels = ['in_person', 'phone', 'video'] as const;
const actionOwners = ['counselor', 'beneficiary', 'org'] as const;
const flagSources = ['ai', 'counselor'] as const;
const flagReviewStatuses = ['confirmed', 'rejected', 'pending'] as const;
const flagTypes = [
  'crisis_utterance',
  'contact_loss_risk',
  'housing_livelihood_shock',
  'debt_deterioration',
  'repeated_noncompliance',
] as const;
const scheduleStatuses = ['scheduled', 'completed', 'cancelled', 'no_show'] as const;
const directoryRoles = ['admin', 'counselor', 'service'] as const;
// 생활 6영역(CCC-8). 키·라벨 근거: docs/intake/CCC-intake-required-vs-optional-questions.md §D.
export const lifeAreaKeys = ['economy', 'housing', 'employment', 'health', 'mental_health', 'family'] as const;
export const lifeAreaStatuses = ['okay', 'strained', 'crisis', 'not_applicable', 'declined'] as const;
// 기록 종류(CCC-7). 정기·기존 기록은 'regular', 인테이크는 'intake'.
export const sessionKinds = ['regular', 'intake'] as const;
export type SessionKind = (typeof sessionKinds)[number];

function contractViolation(): never {
  throw new Error('API response did not match the declared contract.');
}

function responseObject(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') contractViolation();
  return value as Record<string, unknown>;
}

function responseProperty(record: Record<string, unknown>, name: string): unknown {
  if (!(name in record)) contractViolation();
  return record[name];
}

function responseString(record: Record<string, unknown>, name: string): string {
  const value = responseProperty(record, name);
  if (typeof value !== 'string') contractViolation();
  return value;
}

function responseNullableString(record: Record<string, unknown>, name: string): string | null {
  const value = responseProperty(record, name);
  if (value !== null && typeof value !== 'string') contractViolation();
  return value;
}

function responseBoolean(record: Record<string, unknown>, name: string): boolean {
  const value = responseProperty(record, name);
  if (typeof value !== 'boolean') contractViolation();
  return value;
}

function responseInteger(record: Record<string, unknown>, name: string): number {
  const value = responseProperty(record, name);
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) contractViolation();
  return value;
}

function responseArray(record: Record<string, unknown>, name: string): unknown[] {
  const value = responseProperty(record, name);
  if (!Array.isArray(value)) contractViolation();
  return value;
}

function responseEnum<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) contractViolation();
  return value as T;
}

function decodeSourceSupportCase(value: unknown): SourceSupportCase {
  const record = responseObject(value);
  return {
    id: responseString(record, 'id'),
    programType: responseEnum(responseProperty(record, 'programType'), participantProgramTypes),
    status: responseEnum(responseProperty(record, 'status'), caseStatuses),
  };
}

function decodeParticipantProgram(value: unknown): ParticipantProgram {
  const record = responseObject(value);
  const sourceSupportCase = responseProperty(record, 'sourceSupportCase');
  return {
    id: responseString(record, 'id'),
    beneficiaryId: responseString(record, 'beneficiaryId'),
    programType: responseEnum(responseProperty(record, 'programType'), participantProgramTypes),
    status: responseEnum(responseProperty(record, 'status'), caseStatuses),
    intakeAt: responseNullableString(record, 'intakeAt'),
    creationKind: responseEnum(responseProperty(record, 'creationKind'), creationKinds),
    sourceSupportCase: sourceSupportCase === null ? null : decodeSourceSupportCase(sourceSupportCase),
    authorized: responseBoolean(record, 'authorized'),
    assigneeNames: responseArray(record, 'assigneeNames').map((name) => {
      if (typeof name !== 'string') contractViolation();
      return name;
    }),
    consent: decodeParticipantConsent(responseProperty(record, 'consent')),
    consentRecordedAt: responseNullableString(record, 'consentRecordedAt'),
  };
}

function decodeParticipantConsent(value: unknown): ParticipantConsent {
  const record = responseObject(value);
  return {
    privacy: responseBoolean(record, 'privacy'),
    recording: responseBoolean(record, 'recording'),
    textAi: responseBoolean(record, 'textAi'),
  };
}

function decodeAssignedParticipant(value: unknown): AssignedParticipant {
  const record = responseObject(value);
  return {
    beneficiaryId: responseString(record, 'beneficiaryId'),
    status: responseEnum(responseProperty(record, 'status'), caseStatuses),
    programCount: responseInteger(record, 'programCount'),
    name: responseNullableString(record, 'name'),
    phone: responseNullableString(record, 'phone'),
  };
}

function decodeParticipantSearchResult(value: unknown): ParticipantSearchResult {
  const record = responseObject(value);
  return {
    beneficiaryId: responseString(record, 'beneficiaryId'),
    status: responseEnum(responseProperty(record, 'status'), caseStatuses),
    programCount: responseInteger(record, 'programCount'),
    name: responseNullableString(record, 'name'),
  };
}

function decodeSupportCaseRecord(value: unknown): SupportCaseRecord {
  const record = responseObject(value);
  return {
    id: responseString(record, 'id'),
    heldAt: responseString(record, 'heldAt'),
    channel: responseEnum(responseProperty(record, 'channel'), recordChannels),
    memo: responseString(record, 'memo'),
    gasScores: responseArray(record, 'gasScores').map((score) => {
      const item = responseObject(score);
      return {
        goalId: responseString(item, 'goalId'),
        goalTitle: responseString(item, 'goalTitle'),
        score: responseInteger(item, 'score'),
      };
    }),
    actionItems: responseArray(record, 'actionItems').map((action) => {
      const item = responseObject(action);
      return {
        id: responseString(item, 'id'),
        description: responseString(item, 'description'),
        owner: responseEnum(responseProperty(item, 'owner'), actionOwners),
        dueDate: responseNullableString(item, 'dueDate'),
        resolved: responseBoolean(item, 'resolved'),
      };
    }),
    flags: responseArray(record, 'flags').map((flag) => {
      const item = responseObject(flag);
      return {
        id: responseString(item, 'id'),
        flagType: responseEnum(responseProperty(item, 'flagType'), flagTypes),
        source: responseEnum(responseProperty(item, 'source'), flagSources),
        reviewStatus: responseEnum(responseProperty(item, 'reviewStatus'), flagReviewStatuses),
      };
    }),
    lifeAreaSnapshot: responseArray(record, 'lifeAreaSnapshot').map(decodeLifeAreaSnapshotEntry),
    kind: responseEnum(responseProperty(record, 'kind'), sessionKinds),
    createdAt: responseString(record, 'createdAt'),
  };
}

function decodeLifeAreaSnapshotEntry(value: unknown): LifeAreaSnapshotEntry {
  const item = responseObject(value);
  return {
    areaKey: responseEnum(responseProperty(item, 'areaKey'), lifeAreaKeys),
    status: responseEnum(responseProperty(item, 'status'), lifeAreaStatuses),
    note: responseNullableString(item, 'note'),
  };
}

function decodeSupportCaseRecordGoal(value: unknown): SupportCaseRecordGoal {
  const record = responseObject(value);
  return {
    id: responseString(record, 'id'),
    title: responseString(record, 'title'),
    status: responseEnum(responseProperty(record, 'status'), caseStatuses),
  };
}

function decodeCounselingSchedule(value: unknown): CounselingSchedule {
  const record = responseObject(value);
  const version = responseInteger(record, 'version');
  if (version < 1) contractViolation();
  return {
    id: responseString(record, 'id'),
    beneficiaryId: responseString(record, 'beneficiaryId'),
    supportCaseId: responseString(record, 'supportCaseId'),
    scheduledAt: responseString(record, 'scheduledAt'),
    status: responseEnum(responseProperty(record, 'status'), scheduleStatuses),
    version,
  };
}

function decodeSupportCaseRecords(value: unknown): SupportCaseRecords {
  const record = responseObject(value);
  const schedule = responseProperty(record, 'schedule');
  return {
    records: responseArray(record, 'records').map(decodeSupportCaseRecord),
    goals: responseArray(record, 'goals').map(decodeSupportCaseRecordGoal),
    schedule: schedule === null ? null : decodeCounselingSchedule(schedule),
  };
}

function decodeCreateCounselingRecordResult(value: unknown): CreateCounselingRecordResult {
  const record = responseObject(value);
  const createdRecord = responseObject(responseProperty(record, 'record'));
  return {
    record: {
      id: responseString(createdRecord, 'id'),
      heldAt: responseString(createdRecord, 'heldAt'),
      channel: responseEnum(responseProperty(createdRecord, 'channel'), recordChannels),
      memo: responseString(createdRecord, 'memo'),
    },
    replayed: responseBoolean(record, 'replayed'),
  };
}
// The web/API Access applications must accept the same forwarded identity audience.
// Never add local actor headers here: production identity is only Cookie/JWT assertion.
function configuredApiOrigin(): URL {
  const value = process.env.CCC_API_ORIGIN;
  if (value === undefined || value.length === 0) {
    throw new ApiError('service_unavailable');
  }

  try {
    const origin = new URL(value);
    const isLocalHttp = origin.protocol === 'http:'
      && (origin.hostname === 'localhost' || origin.hostname === '127.0.0.1' || origin.hostname === '[::1]');
    if ((origin.protocol !== 'https:' && !isLocalHttp) || origin.username || origin.password || origin.search || origin.hash) {
      throw new ApiError('service_unavailable');
    }
    return origin;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('service_unavailable');
  }
}

function accessAuthorizationCookie(cookieHeader: string | null): string | null {
  if (cookieHeader === null) return null;

  for (const segment of cookieHeader.split(';')) {
    const cookie = segment.trim();
    const separator = cookie.indexOf('=');
    if (separator === -1 || cookie.slice(0, separator) !== 'CF_Authorization') continue;

    const value = cookie.slice(separator + 1);
    if (value.length > 0) return `CF_Authorization=${value}`;
  }

  return null;
}

/** 미리보기 세션 쿠키(ccc_preview) 이름·값만 뽑아 API 로 포워딩할 문자열을 만든다(CCC-6). */
export const PREVIEW_COOKIE_NAME = 'ccc_preview';
function previewAuthorizationCookie(cookieHeader: string | null): string | null {
  if (cookieHeader === null) return null;

  for (const segment of cookieHeader.split(';')) {
    const cookie = segment.trim();
    const separator = cookie.indexOf('=');
    if (separator === -1 || cookie.slice(0, separator) !== PREVIEW_COOKIE_NAME) continue;

    const value = cookie.slice(separator + 1);
    if (value.length > 0) return `${PREVIEW_COOKIE_NAME}=${value}`;
  }

  return null;
}

async function accessHeaders(): Promise<Headers> {
  const inbound = await headers();
  const accessAssertion = inbound.get('cf-access-jwt-assertion');
  const forwarded = new Headers({ accept: 'application/json' });

  // 미리보기 환경(CCC-6): Access 쿠키/JWT 대신 미리보기 세션 쿠키를 API 로 포워딩한다.
  // 쿠키가 없으면 authentication_required — middleware.ts 가 진입 화면으로 유도한다.
  if (process.env.CCC_PREVIEW === 'true') {
    const previewCookie = previewAuthorizationCookie(inbound.get('cookie'));
    if (previewCookie === null) throw new ApiError('authentication_required');
    forwarded.set('cookie', previewCookie);
    return forwarded;
  }

  if (accessAssertion !== null && accessAssertion.length > 0) {
    // Service bindings preserve ordinary headers but may strip Access-reserved
    // headers. The API still verifies the original signed JWT and its audience.
    forwarded.set('x-ccc-access-jwt', accessAssertion);
    return forwarded;
  }

  const accessCookie = accessAuthorizationCookie(inbound.get('cookie'));
  if (accessCookie === null) {
    // 로컬 프리뷰(dev 이중 잠금): dev 실행이면서 CCC_LOCAL_PREVIEW='true' 일 때만 쿠키
    // 없이 진행한다 — 신원은 API 쪽 local-actor 리졸버가 공급한다. 운영 번들은
    // NODE_ENV=production 이라 이 분기가 열리지 않는다.
    if (process.env.NODE_ENV !== 'production' && process.env.CCC_LOCAL_PREVIEW === 'true') {
      return forwarded;
    }
    throw new ApiError('authentication_required');
  }

  forwarded.set('cookie', accessCookie);
  return forwarded;
}

function endpoint(path: string): URL {
  if (!path.startsWith('/')) throw new ApiError('service_unavailable');
  return new URL(path, configuredApiOrigin());
}

function errorCode(status: number, payload: unknown): ApiErrorCode {
  if (payload !== null && typeof payload === 'object' && 'error' in payload) {
    const value = payload.error;
    if (typeof value === 'string' && knownErrorCodes.has(value as ApiErrorCode)) {
      return value as ApiErrorCode;
    }
  }
  if (status === 401) return 'authentication_required';
  if (status === 403) return 'access_denied';
  if (status === 400 || status === 422) return 'invalid_request';
  if (status === 404) return 'not_found';
  if (status === 409 || status === 410) return 'conflict';
  return 'service_unavailable';
}

async function fetchApi(url: URL, init: RequestInit): Promise<Response> {
  if (process.env.NODE_ENV !== 'production') {
    return fetch(url, init);
  }

  const { env } = await getCloudflareContext({ async: true });
  return env.CCC_API.fetch(new Request(url.toString(), init));
}

async function requestJson<T>(path: string, init: Omit<RequestInit, 'headers'> = {}): Promise<T> {
  const requestHeaders = await accessHeaders();

  if (init.body !== undefined) {
    requestHeaders.set('content-type', 'application/json; charset=utf-8');
  }

  let response: Response;
  try {
    response = await fetchApi(endpoint(path), {
      ...init,
      headers: requestHeaders,
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    throw new ApiError('service_unavailable');
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) contractViolation();
  }

  if (!response.ok) throw new ApiError(errorCode(response.status, payload));
  return payload as T;
}

function jsonRequest<T>(path: string, method: 'POST' | 'PUT' | 'PATCH', body: unknown): Promise<T> {
  return requestJson<T>(path, {
    method,
    body: JSON.stringify(body),
  });
}

export async function listCases(): Promise<CaseRecord[]> {
  return requestJson<CaseRecord[]>('/cases');
}

export async function getCase(caseId: string): Promise<CaseRecord> {
  return requestJson<CaseRecord>(`/cases/${encodeURIComponent(caseId)}`);
}

export async function getSession(sessionId: string): Promise<ManualSession> {
  return requestJson<ManualSession>(`/sessions/${encodeURIComponent(sessionId)}`);
}

export async function createCase(input: CreateCaseInput): Promise<CaseRecord> {
  return jsonRequest<CaseRecord>('/cases', 'POST', input);
}

export async function listGoals(caseId: string): Promise<Goal[]> {
  return requestJson<Goal[]>(`/cases/${encodeURIComponent(caseId)}/goals`);
}

export async function createGoal(caseId: string, title: string): Promise<Goal> {
  return jsonRequest<Goal>(`/cases/${encodeURIComponent(caseId)}/goals`, 'POST', { title });
}

export async function createManualSession(caseId: string, input: ManualSessionInput): Promise<ManualSession> {
  return jsonRequest<ManualSession>(`/cases/${encodeURIComponent(caseId)}/sessions`, 'POST', input);
}

export async function getBriefing(caseId: string): Promise<Briefing> {
  return requestJson<Briefing>(`/cases/${encodeURIComponent(caseId)}/briefing`);
}

export async function listSessions(caseId: string): Promise<ManualSession[]> {
  return requestJson<ManualSession[]>(`/cases/${encodeURIComponent(caseId)}/sessions`);
}

export async function getPilotTextAiConsent(caseId: string): Promise<PilotTextAiConsent> {
  return requestJson<PilotTextAiConsent>(`/cases/${encodeURIComponent(caseId)}/pilot-text-ai-consent`);
}

export async function recordPilotTextAiConsent(caseId: string, input: PilotTextAiConsentInput): Promise<PilotTextAiConsent> {
  return jsonRequest<PilotTextAiConsent>(`/cases/${encodeURIComponent(caseId)}/pilot-text-ai-consent`, 'POST', input);
}

export async function getAiDraft(sessionId: string): Promise<AiDraft> {
  return requestJson<AiDraft>(`/sessions/${encodeURIComponent(sessionId)}/ai`);
}

export async function editAiDraft(sessionId: string, input: EditAiDraftInput): Promise<AiDraft> {
  return jsonRequest<AiDraft>(
    `/sessions/${encodeURIComponent(sessionId)}/ai/drafts/${encodeURIComponent(String(input.expectedVersion))}/edit`,
    'POST',
    input,
  );
}

export async function reviewAiDraft(sessionId: string, input: ReviewAiDraftInput): Promise<AiDraft> {
  return jsonRequest<AiDraft>(
    `/sessions/${encodeURIComponent(sessionId)}/ai/drafts/${encodeURIComponent(String(input.expectedVersion))}/review`,
    'POST',
    input,
  );
}
function dateOnly(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError('invalid_request');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
    throw new ApiError('invalid_request');
  }
  return value;
}

export async function getTodaySchedules(date?: string): Promise<TodaySchedules> {
  const suffix = date === undefined ? '' : `?date=${encodeURIComponent(dateOnly(date))}`;
  return requestJson<TodaySchedules>(`/schedules/today${suffix}`);
}

/** 오늘 + 향후 7일 창(8일). 상담 일정 화면이 오늘/다가오는 상담으로 나눠 쓴다. */
export async function getUpcomingSchedules(date?: string): Promise<TodaySchedules> {
  const suffix = date === undefined ? '' : `?date=${encodeURIComponent(dateOnly(date))}`;
  return requestJson<TodaySchedules>(`/schedules/upcoming${suffix}`);
}

/**
 * 상담 등록 폼의 당사자 후보 — '담당 활성 참여사업' 기준(티켓 #19 콜드스타트 해소).
 * 일정 유무와 무관하므로 방금 등록해 아직 일정이 없는 당사자도 첫 상담을 등록할 수 있다.
 */
export async function listScheduleCandidates(): Promise<ScheduleCandidate[]> {
  const payload = await requestJson<{ candidates: ScheduleCandidate[] }>('/schedules/candidates');
  return payload.candidates;
}

export async function listParticipantPrograms(beneficiaryId: string): Promise<ParticipantProgram[]> {
  const payload = await requestJson<unknown>(
    `/participants/${encodeURIComponent(beneficiaryId)}/support-cases`,
  );
  if (!Array.isArray(payload)) contractViolation();
  const programs = payload.map(decodeParticipantProgram);
  if (programs.some((program) => program.beneficiaryId !== beneficiaryId)) contractViolation();
  return programs;
}

/**
 * 당사자 정보 페이지(허브)가 쓰는 당사자 1명 + 그 사람의 기관 내 전 참여 사업 (D36).
 *
 * 실명·연락처는 **API 가 이미 내려주고 있고 감사도 이미 남는다**(`db/gateway.ts` 의
 * `listSupportCasesForBeneficiary`). 사업마다 같은 값이 실려 오므로 첫 행에서 한 번만
 * 읽는다 — 화면에서 감사를 새로 붙이면 화면 조회당 1건(D24)이 중복된다.
 */
export async function getParticipantDetail(beneficiaryId: string): Promise<ParticipantDetail> {
  const payload = await requestJson<unknown>(
    `/participants/${encodeURIComponent(beneficiaryId)}/support-cases`,
  );
  if (!Array.isArray(payload)) contractViolation();
  const programs = payload.map(decodeParticipantProgram);
  if (programs.some((program) => program.beneficiaryId !== beneficiaryId)) contractViolation();
  const first = payload[0];
  const contact = first === undefined ? null : responseObject(first);
  return {
    beneficiaryId,
    name: contact === null ? null : responseNullableString(contact, 'participantName'),
    phone: contact === null ? null : responseNullableString(contact, 'participantPhone'),
    programs,
  };
}

/** 당사자 목록 — 케이스 상태로 거르지 않는다(종결만 남은 당사자도 나온다). */
export async function listAssignedParticipants(): Promise<AssignedParticipant[]> {
  const payload = await requestJson<unknown>('/participants');
  const record = responseObject(payload);
  return responseArray(record, 'results').map(decodeAssignedParticipant);
}

/** 당사자 검색 (티켓 #16). 가명 ID·한글 표시명 부분 일치. 응답은 PII 없이 최소 필드만. */
export async function searchParticipants(query: string): Promise<ParticipantSearchResult[]> {
  const payload = await requestJson<unknown>(`/participants/search?q=${encodeURIComponent(query)}`);
  const record = responseObject(payload);
  return responseArray(record, 'results').map(decodeParticipantSearchResult);
}

/**
 * 담당 케이스 1건을 집어 오는 **접근 가드**다 — 기록 작성 액션과 기록 목록이 본 작업 전에
 * 부른다. 담당이 아니면 `not_found` 로 던진다(존재 여부를 알려주지 않는다).
 *
 * `authorized` 를 반드시 함께 본다. D36 으로 이 목록에 **담당하지 않는 사업도** 들어오게
 * 됐으므로(당사자 허브에서 라벨·담당 실무자만 보여주기 위해), 필터 없이 `find` 하면 이 가드가
 * 비담당 케이스를 통과시킨다 — 게이트웨이가 본 작업에서 다시 막아 실제 권한이 새지는
 * 않지만, 가드가 이름과 다른 일을 하게 되고 오류도 not_found 가 아니라 403 으로 바뀐다.
 * 같은 함정을 API 쪽 레거시 기록 경로에서도 고쳤다(request-handler.ts).
 */
export async function getParticipantProgram(
  beneficiaryId: string,
  supportCaseId: string,
): Promise<ParticipantProgram> {
  const programs = await listParticipantPrograms(beneficiaryId);
  const program = programs.find((candidate) => candidate.authorized && candidate.id === supportCaseId);
  if (program === undefined) throw new ApiError('not_found');
  return program;
}

export async function getParticipantBriefing(
  beneficiaryId: string,
  supportCaseId: string,
): Promise<ParticipantBriefing> {
  return requestJson<ParticipantBriefing>(
    `/participants/${encodeURIComponent(beneficiaryId)}/programs/${encodeURIComponent(supportCaseId)}/briefing`,
  );
}

export async function listSupportCaseRecords(
  beneficiaryId: string,
  supportCaseId: string,
): Promise<SupportCaseRecords> {
  await getParticipantProgram(beneficiaryId, supportCaseId);
  const records = decodeSupportCaseRecords(await requestJson<unknown>(
    `/support-cases/${encodeURIComponent(supportCaseId)}/records?official=true`,
  ));
  if (
    records.schedule !== null
    && (records.schedule.beneficiaryId !== beneficiaryId || records.schedule.supportCaseId !== supportCaseId)
  ) contractViolation();
  return records;
}

export async function getNewRecordContext(
  beneficiaryId: string,
  supportCaseId: string,
): Promise<NewRecordContext> {
  const history = await listSupportCaseRecords(beneficiaryId, supportCaseId);
  const openActionItems: OpenActionItem[] = [];
  for (const record of history.records) {
    for (const action of record.actionItems) {
      if (!action.resolved) {
        openActionItems.push({
          id: action.id,
          description: action.description,
          owner: action.owner,
          dueDate: action.dueDate,
        });
      }
    }
  }
  // 직전 상태 = held_at 내림차순 기록 중 스냅샷을 보유한 첫 회차의 값(콜드스타트면 빈 배열).
  // history.records 는 listCounselingRecords 와 같은 held_at DESC 순서다.
  const latestLifeAreaSnapshot = history.records.find((record) => record.lifeAreaSnapshot.length > 0)?.lifeAreaSnapshot ?? [];
  // 지난 상담 한 줄 요약(CCC-10): 수기 메모가 있는 최신 회차의 첫 줄만 참고로 싣는다(D5).
  const lastRecordWithMemo = history.records.find((record) => record.memo.trim().length > 0);
  const plan = history.schedule === null
    ? { sessionGoals: [], customQuestions: [] }
    : await loadScheduleSessionPlan(history.schedule.id);
  return {
    goals: history.goals,
    schedules: history.schedule === null ? [] : [history.schedule],
    openActionItems,
    latestLifeAreaSnapshot,
    sessionGoals: plan.sessionGoals,
    customQuestions: plan.customQuestions,
    lastRecordSummary: lastRecordWithMemo === undefined
      ? null
      : { heldAt: lastRecordWithMemo.heldAt, text: firstLine(lastRecordWithMemo.memo) },
  };
}

function firstLine(memo: string): string {
  const line = memo.split('\n').map((part) => part.trim()).find((part) => part.length > 0) ?? '';
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

/**
 * 다가오는 일정의 세션 목표·맞춤형 질문(D28). 기록지의 참고 표시용이라 실패해도 폼을 막지
 * 않는다 — 조회가 어떤 이유로든 실패하면 빈 목록으로 낮춰 "수기 메모만으로 저장" 경로를 지킨다.
 */
async function loadScheduleSessionPlan(
  scheduleId: string,
): Promise<{ sessionGoals: RecordSessionGoal[]; customQuestions: string[] }> {
  try {
    const plan = responseObject(await requestJson<unknown>(`/schedules/${encodeURIComponent(scheduleId)}/plan`));
    return {
      sessionGoals: responseArray(plan, 'sessionGoals').map((value) => {
        const goal = responseObject(value);
        return { body: responseString(goal, 'body'), caseGoalTitle: responseNullableString(goal, 'caseGoalTitle') };
      }),
      customQuestions: responseArray(plan, 'customQuestions').map((value) => responseString(responseObject(value), 'body')),
    };
  } catch {
    return { sessionGoals: [], customQuestions: [] };
  }
}

export async function createInitialParticipantProgram(
  input: CreateInitialParticipantProgramInput,
): Promise<ParticipantProgramCreation> {
  return jsonRequest<ParticipantProgramCreation>('/participants', 'POST', input);
}

/**
 * 동의 3종 수정·철회 (D44). 세 값을 항상 함께 보낸다 — 서버가 현재 상태 전체를 한 번에
 * 기록하기 때문이다(부분 갱신이 아니다). 권한(담당 실무자·기관 관리자)은 서버가 판정한다.
 */
export async function updateParticipantConsent(
  supportCaseId: string,
  consent: ParticipantConsent,
): Promise<ParticipantConsent> {
  const payload = await jsonRequest<unknown>(
    `/support-cases/${encodeURIComponent(supportCaseId)}/consent`,
    'PUT',
    consent,
  );
  return decodeParticipantConsent(payload);
}

/** 전체 목표 그 자리 입력·수정 (D45 · CCC-41). null·빈 문자열은 "설정 전"으로 되돌린다. */
export async function updateSupportCaseOverallGoal(
  supportCaseId: string,
  overallGoal: string | null,
): Promise<{ supportCaseId: string; overallGoal: string | null }> {
  return jsonRequest<{ supportCaseId: string; overallGoal: string | null }>(
    `/support-cases/${encodeURIComponent(supportCaseId)}/overall-goal`,
    'PUT',
    { overallGoal },
  );
}

/** 기본정보 수정 화면(CCC-37)이 다루는 금고 7종. 폼 필드 이름과 1:1이다. */
export const PARTICIPANT_BASIC_INFO_FIELDS = [
  'name', 'phone', 'email', 'account', 'birthDate', 'region', 'gender',
] as const;
export type ParticipantBasicInfoField = (typeof PARTICIPANT_BASIC_INFO_FIELDS)[number];

export interface ParticipantBasicInfo {
  beneficiaryId: string;
  /** 저장에 그대로 실어 보낼 활성 참여 사업. 화면이 고르지 않는다 — 서버가 정한다. */
  supportCaseContextId: string;
  /** 낙관적 잠금 값. 폼이 hidden 으로 돌려준다. */
  version: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  account: string | null;
  birthDate: string | null;
  region: string | null;
  gender: string | null;
}

/** 저장 패치. 키가 없으면 "건드리지 않는다", null 이면 "지운다". */
export type ParticipantBasicInfoPatch = Partial<Record<ParticipantBasicInfoField, string | null>>;

function decodeParticipantBasicInfo(payload: unknown): ParticipantBasicInfo {
  const record = responseObject(payload);
  return {
    beneficiaryId: responseString(record, 'beneficiaryId'),
    supportCaseContextId: responseString(record, 'supportCaseContextId'),
    version: responseInteger(record, 'version'),
    name: responseNullableString(record, 'name'),
    phone: responseNullableString(record, 'phone'),
    email: responseNullableString(record, 'email'),
    account: responseNullableString(record, 'account'),
    birthDate: responseNullableString(record, 'birthDate'),
    region: responseNullableString(record, 'region'),
    gender: responseNullableString(record, 'gender'),
  };
}

/**
 * 기본정보 수정 화면의 읽기(CCC-37). 복호화된 금고 값이 실려 오므로 이 호출 자체가
 * 화면 조회 감사 1건을 남긴다(D24) — 화면에서 감사를 또 붙이지 않는다.
 */
export async function getParticipantBasicInfo(beneficiaryId: string): Promise<ParticipantBasicInfo> {
  return decodeParticipantBasicInfo(
    await requestJson<unknown>(`/participants/${encodeURIComponent(beneficiaryId)}/basic-info`),
  );
}

/** 기본정보 저장(CCC-37). 권한(담당 실무자·기관 관리자)과 버전 충돌은 서버가 판정한다. */
export async function updateParticipantBasicInfo(
  beneficiaryId: string,
  input: { supportCaseContextId: string; expectedVersion: number } & ParticipantBasicInfoPatch,
): Promise<void> {
  await jsonRequest<unknown>(
    `/participants/${encodeURIComponent(beneficiaryId)}/basic-info`,
    'PUT',
    input,
  );
}

export async function createSubsequentParticipantProgram(
  beneficiaryId: string,
  input: CreateSubsequentParticipantProgramInput,
): Promise<ParticipantProgramCreation> {
  return jsonRequest<ParticipantProgramCreation>(
    `/participants/${encodeURIComponent(beneficiaryId)}/support-cases`,
    'POST',
    input,
  );
}

export async function createCounselingRecord(
  supportCaseId: string,
  input: CreateCounselingRecordInput,
): Promise<CreateCounselingRecordResult> {
  return decodeCreateCounselingRecordResult(await jsonRequest<unknown>(
    `/support-cases/${encodeURIComponent(supportCaseId)}/records`,
    'POST',
    input,
  ));
}

function decodeIntakeExtendedPii(value: unknown): IntakeExtendedPii {
  const record = responseObject(value);
  return {
    birthDate: responseNullableString(record, 'birthDate'),
    region: responseNullableString(record, 'region'),
    emergencyContact: responseNullableString(record, 'emergencyContact'),
    gender: responseNullableString(record, 'gender'),
  };
}

export async function getIntakeRecordContext(supportCaseId: string): Promise<IntakeRecordContext> {
  const record = responseObject(await requestJson<unknown>(
    `/support-cases/${encodeURIComponent(supportCaseId)}/records/intake`,
  ));
  const participant = responseObject(responseProperty(record, 'participant'));
  return {
    beneficiaryId: responseString(record, 'beneficiaryId'),
    supportCaseId: responseString(record, 'supportCaseId'),
    participant: {
      name: responseNullableString(participant, 'name'),
      phone: responseNullableString(participant, 'phone'),
      email: responseNullableString(participant, 'email'),
    },
    sessionSequence: responseInteger(record, 'sessionSequence'),
    hasIntake: responseBoolean(record, 'hasIntake'),
    extendedPii: decodeIntakeExtendedPii(responseProperty(record, 'extendedPii')),
    consent: (() => {
      const consent = responseObject(responseProperty(record, 'consent'));
      return {
        privacy: responseBoolean(consent, 'privacy'),
        recording: responseBoolean(consent, 'recording'),
        textAi: responseBoolean(consent, 'textAi'),
      };
    })(),
  };
}

export async function createIntakeRecord(
  supportCaseId: string,
  input: CreateIntakeRecordInput,
): Promise<CreateIntakeRecordResult> {
  const result = responseObject(await jsonRequest<unknown>(
    `/support-cases/${encodeURIComponent(supportCaseId)}/records/intake`,
    'POST',
    input,
  ));
  const record = responseObject(responseProperty(result, 'record'));
  return {
    record: {
      id: responseString(record, 'id'),
      heldAt: responseString(record, 'heldAt'),
      channel: responseEnum(responseProperty(record, 'channel'), recordChannels),
      kind: responseEnum(responseProperty(record, 'kind'), sessionKinds),
    },
    replayed: responseBoolean(result, 'replayed'),
  };
}

export async function createCounselingSchedule(
  input: CreateCounselingScheduleInput,
): Promise<CounselingSchedule> {
  return decodeCounselingSchedule(await jsonRequest<unknown>('/schedules', 'POST', input));
}

export async function rescheduleCounselingSchedule(
  scheduleId: string,
  input: RescheduleCounselingScheduleInput,
): Promise<CounselingSchedule> {
  return jsonRequest<CounselingSchedule>(
    `/schedules/${encodeURIComponent(scheduleId)}/reschedule`,
    'PATCH',
    input,
  );
}

export async function cancelCounselingSchedule(
  scheduleId: string,
  input: ScheduleTransitionInput,
): Promise<CounselingSchedule> {
  return jsonRequest<CounselingSchedule>(
    `/schedules/${encodeURIComponent(scheduleId)}/cancel`,
    'POST',
    input,
  );
}

export async function markCounselingScheduleNoShow(
  scheduleId: string,
  input: ScheduleTransitionInput,
): Promise<CounselingSchedule> {
  return jsonRequest<CounselingSchedule>(
    `/schedules/${encodeURIComponent(scheduleId)}/no-show`,
    'POST',
    input,
  );
}

function decodeDirectoryUser(value: unknown): DirectoryUser {
  const record = responseObject(value);
  return {
    id: responseString(record, 'id'),
    orgId: responseString(record, 'orgId'),
    email: responseString(record, 'email'),
    role: responseEnum(responseProperty(record, 'role'), directoryRoles),
    active: responseBoolean(record, 'active'),
    name: responseNullableString(record, 'name'),
  };
}

/** 로그인한 본인의 신원(이메일·역할). 설정 화면 '내 계정' 섹션이 쓴다. */
export async function getMyIdentity(): Promise<MyIdentity> {
  return decodeDirectoryUser(await requestJson<unknown>('/me'));
}

/** 관리자 온보딩이 저장한 기관·첫 사업 표시 이름 (CCC-32). null 이면 labels.ts 폴백. */
export interface OrganizationProfile {
  orgId: string;
  orgName: string | null;
  programDisplayName: string | null;
}

function decodeOrganizationProfile(value: unknown): OrganizationProfile {
  const record = responseObject(value);
  return {
    orgId: responseString(record, 'orgId'),
    orgName: responseNullableString(record, 'orgName'),
    programDisplayName: responseNullableString(record, 'programDisplayName'),
  };
}

export async function getOrganizationProfile(): Promise<OrganizationProfile> {
  return decodeOrganizationProfile(await requestJson<unknown>('/organization/profile'));
}

/** 관리자 온보딩 2단계 저장 (CCC-32). admin 검사·감사는 API 게이트웨이 몫(R1). */
export async function completeOrganizationOnboarding(
  input: { orgName: string; programDisplayName: string },
): Promise<OrganizationProfile> {
  return decodeOrganizationProfile(await jsonRequest<unknown>('/organization/onboarding', 'POST', input));
}

/**
 * `/` 직행 목적지 — 마지막에 선택한 사업 (D35 · ADR-0014 '개정' 2번).
 * 미선택이면 null 이고 호출부가 첫 사업으로 폴백한다. 404 를 내지 않는다.
 *
 * `/me` 응답에서 이 필드만 읽는다 — `decodeDirectoryUser` 는 `/users` 와 공유하는
 * 디코더인데 그쪽 응답에는 이 필드가 없어서, 공유 디코더를 건드리면 목록이 깨진다.
 */
export async function getLastProgramType(): Promise<string | null> {
  const record = responseObject(await requestJson<unknown>('/me'));
  return responseNullableString(record, 'lastProgramType');
}

/**
 * 지금 보고 있는 사업을 본인 계정에 기억시킨다. 값이 이미 같으면 게이트웨이가 쓰기를
 * 건너뛴다. 감사는 남기지 않는다(본인 UI 설정 — db/gateway.ts rememberLastProgramType).
 */
export async function rememberLastProgramType(programType: string): Promise<void> {
  await requestJson<unknown>('/me/last-program', {
    method: 'PUT',
    body: JSON.stringify({ programType }),
  });
}

/** 기관 사용자 디렉터리 목록. 기관 관리자만 호출한다(비관리자에게는 403). */
export async function listOrgUsers(): Promise<DirectoryUser[]> {
  const payload = await requestJson<unknown>('/users');
  if (!Array.isArray(payload)) contractViolation();
  return payload.map(decodeDirectoryUser);
}

// 관리자 영역(재개편 T8, #38): 실무자별 활성 배정 당사자 + 케이스 담당 실무자 배정.
const assignmentRoles = ['primary', 'secondary'] as const;

/** 관리자 영역 사용자/실무자 상세에 실리는 실무자별 활성 배정 당사자 행(실명 포함). */
export interface AdminAssignmentParticipant {
  beneficiaryId: string;
  supportCaseId: string;
  programType: ParticipantProgramType;
  status: 'active' | 'closed';
  assignmentRole: 'primary' | 'secondary';
  // D24·ADR-0005: 관리자에게 기본 표시하는 실명·연락처. 미기입이면 null.
  participantName: string | null;
  participantPhone: string | null;
}

export interface CounselorAssignments {
  userId: string;
  participants: AdminAssignmentParticipant[];
}

export interface SupportCaseAssignee {
  id: string;
  supportCaseId: string;
  userId: string;
  role: 'primary' | 'secondary';
  assignedAt: string;
}

function decodeAdminAssignmentParticipant(value: unknown): AdminAssignmentParticipant {
  const record = responseObject(value);
  return {
    beneficiaryId: responseString(record, 'beneficiaryId'),
    supportCaseId: responseString(record, 'supportCaseId'),
    programType: responseEnum(responseProperty(record, 'programType'), participantProgramTypes),
    status: responseEnum(responseProperty(record, 'status'), caseStatuses),
    assignmentRole: responseEnum(responseProperty(record, 'assignmentRole'), assignmentRoles),
    participantName: responseNullableString(record, 'participantName'),
    participantPhone: responseNullableString(record, 'participantPhone'),
  };
}

function decodeSupportCaseAssignee(value: unknown): SupportCaseAssignee {
  const record = responseObject(value);
  return {
    id: responseString(record, 'id'),
    supportCaseId: responseString(record, 'supportCaseId'),
    userId: responseString(record, 'userId'),
    role: responseEnum(responseProperty(record, 'role'), assignmentRoles),
    assignedAt: responseString(record, 'assignedAt'),
  };
}

/** 실무자별 활성 배정 당사자(실명 포함). 기관 관리자만 호출한다(비관리자에게는 403). */
export async function listCounselorAssignments(userId: string): Promise<CounselorAssignments> {
  const payload = responseObject(await requestJson<unknown>(`/users/${encodeURIComponent(userId)}/assignments`));
  return {
    userId: responseString(payload, 'userId'),
    participants: responseArray(payload, 'participants').map(decodeAdminAssignmentParticipant),
  };
}

/** 케이스 담당 실무자 목록. 담당 실무자 또는 관리자. 관리자 배정 화면이 현재 배정 상태를 보여줄 때 쓴다. */
export async function listSupportCaseAssignees(supportCaseId: string): Promise<SupportCaseAssignee[]> {
  const payload = responseObject(await requestJson<unknown>(
    `/support-cases/${encodeURIComponent(supportCaseId)}/assignees`,
  ));
  return responseArray(payload, 'assignees').map(decodeSupportCaseAssignee);
}

/** 공동 담당 추가(D7). 기관 관리자만 호출한다. 기본 역할은 secondary. */
export async function addSupportCaseAssignee(
  supportCaseId: string,
  userId: string,
  role?: 'primary' | 'secondary',
): Promise<SupportCaseAssignee> {
  return decodeSupportCaseAssignee(await jsonRequest<unknown>(
    `/support-cases/${encodeURIComponent(supportCaseId)}/assignees`,
    'POST',
    role === undefined ? { userId } : { userId, role },
  ));
}

/** 실무자 등록(기존 POST /users, role=counselor). 기관 관리자만 호출한다. */
export async function registerCounselor(email: string): Promise<DirectoryUser> {
  return decodeDirectoryUser(await jsonRequest<unknown>('/users', 'POST', { email, role: 'counselor' }));
}

export interface PreviewUnlockResult {
  token: string;
  maxAgeSeconds: number;
}

/**
 * 미리보기 코드 게이트 해제(CCC-6). 아직 세션 쿠키가 없으므로 accessHeaders 를 거치지
 * 않고 코드만 API 로 보낸다. 성공하면 서명 토큰과 수명을 돌려주며, 호출부(서버 액션)가
 * 이 토큰을 웹 도메인의 HttpOnly 쿠키로 심는다. 잘못된 코드는 API 가 401 → invalid_request.
 */
export async function requestPreviewUnlock(code: string): Promise<PreviewUnlockResult> {
  const requestHeaders = new Headers({
    accept: 'application/json',
    'content-type': 'application/json; charset=utf-8',
  });

  let response: Response;
  try {
    response = await fetchApi(endpoint('/preview/unlock'), {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify({ code }),
      cache: 'no-store',
      redirect: 'manual',
    });
  } catch {
    throw new ApiError('service_unavailable');
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    if (response.ok) contractViolation();
  }

  if (!response.ok) throw new ApiError(errorCode(response.status, payload));

  const record = responseObject(payload);
  return {
    token: responseString(record, 'token'),
    maxAgeSeconds: responseInteger(record, 'maxAgeSeconds'),
  };
}
