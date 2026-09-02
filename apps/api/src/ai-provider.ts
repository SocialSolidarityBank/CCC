// 호출 ①과 호출 ②의 외부 AI 계약, 검증, 어댑터를 한곳에서 관리한다.
export const AI_PROVIDER_REGISTRY_VERSION = 'phase1.v1';
export const CODEX_PROVIDER_ID = 'codex';
export const CODEX_PROVIDER_ADAPTER_VERSION = 'v1';
export const AI_PROVIDER_REGISTRY = Object.freeze({
  registryVersion: AI_PROVIDER_REGISTRY_VERSION,
  adapters: Object.freeze({
    codex: Object.freeze({
      providerId: CODEX_PROVIDER_ID,
      adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
    }),
  }),
});
// v2 (CCC-38·CCC-39·D45): 출력에 핵심 한 줄(oneLiner)이 추가되고, 브리핑 질문이 단문
// 텍스트에서 구조화 제안(짧은 제목 + 확인 이유)으로 바뀌었다. 버전을 올리면 활성 프로바이더
// 설정 해시가 어긋나 재활성화 전까지 fail-closed 된다 — 구 스키마로 생성이 계속되는
// 드리프트를 막는 의도된 동작이다.
//
// v3 (CCC-102 · D69 · ADR-0036): 요청이 재료 하나에서 재료 배열(전사 · 텍스트 맥락)로
// 넓어지고, 출력에 대조 3종(contrast)이 붙는다. 같은 이유로 v2 활성 설정은 fail-closed 다.
//
// v4 (CCC-126 · D70~D72 · ADR-0037): claims 에 목표 중심 구획 라벨을 붙이고, 전사
// 원문으로만 뒷받침되는 리스크 플래그 제안을 같은 호출에서 받는다. v3 활성 설정은
// 해시가 어긋나 재활성화 전까지 fail-closed 된다.
export const AI_DRAFT_PROMPT_VERSION = 'phase1.grounded.v4';
export const AI_DRAFT_SCHEMA_VERSION = 'phase1.grounded-draft.v4';
export const DISCREPANCY_PROMPT_VERSION = 'phase1.discrepancy.v1';
export const DISCREPANCY_SCHEMA_VERSION = 'phase1.discrepancy-list.v1';

const MAX_MASKED_TEXT_LENGTH = 24_000;
/** 재료 하나가 실을 수 있는 근거 항목 수. */
const MAX_EVIDENCE_ITEMS = 64;
/** 재료 종류는 두 가지뿐이라 재료 수의 상한도 2다(D69 · ADR-0036). */
const MAX_MATERIALS = 2;
/** 편집 경로가 되돌려 보내는 근거 id 목록의 상한. 재료 전부의 합이다. */
const MAX_TOTAL_EVIDENCE_ITEMS = MAX_EVIDENCE_ITEMS * MAX_MATERIALS;
/** 대조 축당 항목 상한. db/gateway.ts 의 저장 상한과 같은 값이다. */
const MAX_CONTRAST_FINDINGS_PER_AXIS = 8;
const MAX_CONTRAST_DESCRIPTION_LENGTH = 200;
const MAX_CONTRAST_QUOTE_LENGTH = 500;
const MAX_CLAIMS = 32;
const MAX_CLAIM_LENGTH = 2_000;
const MAX_FLAG_SUGGESTIONS = 8;
const MAX_FLAG_QUOTE_LENGTH = 500;
const MIN_QUESTIONS = 2;
const MAX_QUESTIONS = 3;
// D45: "짧은 제목" — 화면에서 한 줄에 앉는 길이로 강제한다.
const MAX_QUESTION_TITLE_LENGTH = 80;
// 게이트웨이의 MAX_AI_ONE_LINER_LENGTH(db/gateway.ts)와 같은 값 — 회차 줄에 앉는 한 문장.
const MAX_ONE_LINER_LENGTH = 120;
const CODEX_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const CODEX_REQUEST_TIMEOUT_MS = 20_000;

// 내용 불일치 검출(D45 · CCC-43) 상한. 소스 = 공식화된 회차의 가명 처리 텍스트.
const MAX_DISCREPANCY_SOURCES = 12;
const MAX_DISCREPANCIES = 8;
const MAX_DISCREPANCY_QUOTE_LENGTH = 500;

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const opaqueReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const versionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const modelPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const piiPatterns = [
  /(?<![\d-])\d{6}[-\s]?[1-4]\d{6}(?![\d-])/u,
  /(?<![\d-])0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?![\d-])/u,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/u,
  /(?<![\d-])\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{2,8})?(?![\d-])/u,
  /(?:\b(?:name|full[ _-]?name)\s*[:：]\s*[^\s,;]+)|(?:\b(?:전화|연락처|주민번호|계좌|이메일)\s*[:：]\s*[^\s,;]+)/iu,
] as const;

const prohibitedOutputPatterns = [
  /\bGAS\s*(?:score|점수)?\s*[:=-]?\s*[-+]?[0-2](?:\b|점)/iu,
  /\b(?:diagnos(?:is|e|ed|tic)|mental[ _-]?health[ _-]?assessment)\b/iu,
  /(?:심리|정신|의학적?)\s*진단/u,
  /\b(?:support|benefit|assistance)\s*(?:continuation|continue|termination|terminate|stop|end)\b/iu,
  /지원\s*(?:지속|계속|중단|종료|연장)\s*(?:결정|판단|권고)?/u,
  /\b(?:flag|risk)\s*(?:is\s*)?(?:confirmed|confirm(?:ed)?)\b/iu,
  /(?:위험|플래그)\s*(?:확정|확인됨)/u,
] as const;

export interface AiProviderConfig {
  registryVersion: typeof AI_PROVIDER_REGISTRY_VERSION;
  providerId: typeof CODEX_PROVIDER_ID;
  adapterVersion: typeof CODEX_PROVIDER_ADAPTER_VERSION;
  configVersion: string;
  model: string;
}

export interface AiProviderMetadata {
  registryVersion: typeof AI_PROVIDER_REGISTRY_VERSION;
  providerId: typeof CODEX_PROVIDER_ID;
  adapterVersion: typeof CODEX_PROVIDER_ADAPTER_VERSION;
  configVersion: string;
  model: string;
  promptVersion: typeof AI_DRAFT_PROMPT_VERSION;
  schemaVersion: typeof AI_DRAFT_SCHEMA_VERSION;
}

export interface AiEvidenceReference {
  evidenceId: string;
  sourceRef: string;
  sourceSha256: string;
  evidenceQuote: string;
  sourceStart: number;
  sourceEnd: number;
}

export interface AiClaimEvidenceReference extends AiEvidenceReference {}

export const AI_CLAIM_SECTIONS = [
  'session_goal_discussion',
  'other_topics',
  'next_session_commitments',
] as const;
export type AiClaimSection = (typeof AI_CLAIM_SECTIONS)[number];

export const AI_FLAG_TYPES = [
  'crisis_utterance',
  'contact_loss_risk',
  'housing_livelihood_shock',
  'debt_deterioration',
  'repeated_noncompliance',
  'violence_exploitation',
] as const;
export type AiFlagType = (typeof AI_FLAG_TYPES)[number];

export interface AiGeneratedClaim {
  claimKey: string;
  section: AiClaimSection;
  text: string;
  evidence: readonly AiClaimEvidenceReference[];
}

export interface AiFlagSuggestion {
  type: AiFlagType;
  sourceRef: string;
  quote: string;
}
/** D45 영역 ① 구조화 제안 — 짧은 제목 + 확인해야 하는 이유. 근거는 evidence 가 강제한다. */
export interface AiGeneratedQuestion {
  title: string;
  reason: string;
  evidence: readonly AiClaimEvidenceReference[];
}

/**
 * 호출 ① 의 재료 하나 (D69 · ADR-0036 · CCC-102).
 *
 * `kind` 는 서버가 판정한다. 프로바이더가 고르는 값이 아니다. `sourceRef` 는 그 재료의
 * 마스킹 스냅샷 식별자이고, 대조 항목이 어느 재료를 인용했는지 가리키는 데 쓴다.
 * 재료 본문은 장비가 2차 마스킹한 `masked_text` 뿐이다(R3 · D57). 다른 원문은 없다.
 */
export type AiMaterialKind = 'transcript' | 'text_context';

export interface AiProviderMaterial {
  kind: AiMaterialKind;
  sourceRef: string;
  maskedText: string;
  evidence: readonly AiEvidenceReference[];
}

/** 대조 3종의 축. '미논의 목표' 의 기준은 회기 목표뿐이다(ADR-0036 결정 3). */
export type AiContrastAxis =
  | 'missing_from_memo'
  | 'missing_from_transcript'
  | 'undiscussed_session_goal';

/** 축의 적용 여부. 서버가 재료 구성에서 계산해 요청에 실어 보낸다(AI 가 정하지 않는다). */
export type AiContrastAxisStatus = 'applied' | 'no_transcript' | 'no_text' | 'no_session_goal';

export type AiContrastAxisStates = Readonly<Record<AiContrastAxis, AiContrastAxisStatus>>;

export const AI_CONTRAST_AXES: readonly AiContrastAxis[] = [
  'missing_from_memo',
  'missing_from_transcript',
  'undiscussed_session_goal',
];

/**
 * 축마다 인용을 어느 재료에서 끌어와야 하는가. 축 정의가 곧 출처다
 * '메모에 없는 내용' 은 전사에는 있고 메모에 없는 것이라 인용이 전사에서 나오고,
 * 나머지 둘은 메모 쪽(텍스트 맥락)에서 나온다.
 */
const CONTRAST_AXIS_MATERIAL: Readonly<Record<AiContrastAxis, AiMaterialKind>> = {
  missing_from_memo: 'transcript',
  missing_from_transcript: 'text_context',
  undiscussed_session_goal: 'text_context',
};

export interface AiProviderRequest {
  /** 전사 → 텍스트 맥락 순으로 고정 정렬된 재료 1~2개. */
  materials: readonly AiProviderMaterial[];
  /** 서버가 판정한 축별 적용 여부. applied 가 아닌 축은 항목을 만들면 안 된다. */
  contrastAxes: AiContrastAxisStates;
}

/**
 * 대조 항목 하나. 짧은 설명 + 근거 인용. 어느 쪽이 맞는지 판단하지 않는다(R5).
 * 인용은 명시한 재료 원문의 정확한 부분 문자열이어야 한다(불일치 검출과 같은 태도).
 */
export interface AiContrastFinding {
  description: string;
  materialKind: AiMaterialKind;
  sourceRef: string;
  quote: string;
}

export type AiContrastOutput = Readonly<Record<AiContrastAxis, readonly AiContrastFinding[]>>;

export interface AiProviderOutput {
  claims: readonly AiGeneratedClaim[];
  questions: readonly AiGeneratedQuestion[];
  /** D45 영역 ② 핵심 한 줄 — 개행 없는 한 문장, 요약·질문과 함께 승인된다(R2). */
  oneLiner: string;
  /** 대조 3종(R2 승인 대상). 적용되지 않은 축은 빈 배열이다. */
  contrast: AiContrastOutput;
  /** 전사 발언만 인용하는 미확정 리스크 플래그 제안(D72). 전사가 없으면 빈 배열이다. */
  flagSuggestions: readonly AiFlagSuggestion[];
}

/**
 * 내용 불일치 검출(D45 · ADR-0018 · CCC-43) 요청. 소스는 게이트웨이가 가명 처리한
 * 공식 기록 텍스트뿐이고(R3), sourceRef 는 회차(session) 불투명 식별자다.
 * triggerRef = 이번 공식화로 검출을 일으킨 회차 — 출력은 이 회차가 낀 쌍만 허용된다.
 */
export interface DiscrepancySourceInput {
  sourceRef: string;
  text: string;
}

export interface DiscrepancyDetectionRequest {
  triggerRef: string;
  sources: readonly DiscrepancySourceInput[];
}

/**
 * 불일치 한 쌍 — 판단 없이 양쪽 원문 인용과 회차 참조만(R5). 인용은 해당 소스 텍스트의
 * 문자 그대로의 부분 문자열이어야 검증을 통과한다(근거 없는 인용 금지, D9 와 같은 태도).
 */
export interface DetectedDiscrepancy {
  kind: 'cross_session' | 'within_session';
  leftRef: string;
  leftQuote: string;
  rightRef: string;
  rightQuote: string;
}

export interface DiscrepancyDetectionOutput {
  discrepancies: readonly DetectedDiscrepancy[];
}

/**
 * The provider receives only gateway-reloaded, locally NER-masked evidence.
 * Credentials stay in Worker bindings.
 */
export interface AiProviderAdapter {
  readonly providerId: typeof CODEX_PROVIDER_ID;
  readonly adapterVersion: string;
  generate(request: AiProviderRequest): Promise<AiProviderOutput>;
  /**
   * 내용 불일치 검출(CCC-43). 선택 메서드 — 없으면 검출은 조용히 스킵된다(D8:
   * 검출 실패·미지원이 기록 저장을 막으면 안 된다). 반환값은 호출자가
   * validateDiscrepancyDetectionOutput 으로 반드시 재검증한다.
   */
  detectDiscrepancies?(request: DiscrepancyDetectionRequest): Promise<unknown>;
}

/**
 * Object bindings do not exist in deployed Workers. This seam therefore exists
 * only for in-process tests and still requires the exact Codex tuple.
 */
export interface AiProviderTestAdapter extends AiProviderAdapter {
  readonly adapterVersion: typeof CODEX_PROVIDER_ADAPTER_VERSION;
  readonly testOnly: true;
  readonly config: AiProviderConfig;
}

export interface AiProviderRuntimeEnv {
  AI_PROVIDER_CONFIG?: string;
  CODEX_API_KEY?: string;
  /**
   * 유료 외부 사업자 호출의 최종 운영 스위치. 정확히 "1"일 때만 실제 HTTPS 호출을
   * 허용한다. 설정·키가 배포돼 있어도 합성 스모크나 Preview 점검이 암묵적으로 비용을
   * 만들지 않게 기본은 OFF다. 테스트 주입 어댑터는 네트워크를 쓰지 않으므로 예외다.
   */
  EXTERNAL_AI_CALLS_ENABLED?: string;
  /** In-process tests may inject an object binding that deployed Workers cannot provide. */
  AI_PROVIDER_ADAPTER?: AiProviderAdapter;
}

export class AiProviderInputError extends Error {
  constructor() {
    super('invalid_ai_generation_request');
  }
}

export class AiProviderProhibitedOutputError extends Error {
  constructor() {
    super('ai_prohibited_output');
  }
}

/**
 * 사용 불가의 **사유 분류** (CCC-47). 내용이 아니라 분류다 — 응답 본문·프롬프트·키는
 * 어디에도 담지 않는다(R3). 이 값이 없으면 "설정 안 됨"·"키 틀림"·"모델명 틀림"·
 * "망 장애"가 관측에서 전부 같은 사건으로 보인다.
 */
export type AiProviderUnavailableReason =
  | 'config_missing'
  | 'config_invalid'
  | 'external_calls_disabled'
  | 'api_key_missing'
  | 'adapter_invalid'
  | 'network'
  | 'http_status'
  | 'malformed_response'
  | 'unknown';

export class AiProviderUnavailableError extends Error {
  /**
   * `status` 는 http_status 일 때의 응답 코드다. 401(키)·404(모델명)를 가르는 유일한
   * 단서라 숫자만 남긴다 — 본문은 요청을 되비칠 수 있어 남기지 않는다(R3).
   */
  constructor(
    readonly reason: AiProviderUnavailableReason = 'unknown',
    readonly status?: number,
  ) {
    super('ai_provider_unavailable');
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && !Array.isArray(value) && typeof value === 'object';
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === 'string' && field.trim() === field ? field : null;
}

function hasPiiLikeValue(value: string): boolean {
  return piiPatterns.some((pattern) => pattern.test(value));
}

function hasProhibitedOutput(value: string): boolean {
  return prohibitedOutputPatterns.some((pattern) => pattern.test(value));
}

/**
 * 이 시스템이 발급하는 식별자는 crypto.randomUUID() 의 정규 UUID 다(db/gateway.ts newId()).
 * UUID 는 하이픈으로 끊긴 16진 그룹이라 계좌·전화번호를 겨냥한 piiPatterns[3]
 * (`\d{2,6}-\d{2,6}-\d{2,8}`)에 우연히 걸린다 — 실측 20만 개 중 8,651개(4.3%).
 * 예: `006ec309-6253-498c-8bfe-4dd22ddfe344` 의 `309-6253-498` 구간.
 *
 * 그 결과 API 가 **자기가 발급한 식별자를 자기 검증기로 거부**해, 실무자의 AI 초안 편집이
 * 약 4.3% 확률로 400 invalid_request 로 실패했다(이슈 #47 — flake 로 보였던 것의 실체).
 *
 * 정규 UUID(8-4-4-4-12 16진, 36자)는 주민번호(13자리)·전화(10~11자리)·계좌(10~16자리)
 * 어느 것도 취할 수 없는 형태다. 따라서 **식별자 검증에 한해** PII 패턴을 면제한다.
 * 자유 텍스트 검사(assertSafeText)는 그대로 두므로 R3 2단 방어는 약화되지 않는다.
 */
const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isCanonicalUuid(value: string): boolean {
  return canonicalUuidPattern.test(value);
}

function isOpaqueId(value: string): boolean {
  return opaqueIdPattern.test(value) && (isCanonicalUuid(value) || !hasPiiLikeValue(value));
}
function isOpaqueReference(value: string): boolean {
  return opaqueReferencePattern.test(value) && (isCanonicalUuid(value) || !hasPiiLikeValue(value));
}

function assertSafeText(value: unknown, maxLength: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength || hasPiiLikeValue(value)) {
    throw new AiProviderInputError();
  }
}

function assertNoProhibitedKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    const normalized = key.replaceAll('_', '').toLowerCase();
    if (
      normalized === 'gasscore'
      || normalized === 'score'
      || normalized === 'confirmed'
      || normalized === 'diagnosis'
      || normalized === 'supportdecision'
      || normalized === 'continuationsupport'
      || normalized === 'approval'
    ) {
      throw new AiProviderProhibitedOutputError();
    }
  }
}
function assertExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[], error: Error): void {
  if (Object.keys(value).some((key) => !expectedKeys.includes(key))) throw error;
}


function sourceTextSpan(value: string, start: number, end: number): string {
  return Array.from(value).slice(start, end).join('');
}

function evidenceSpanKey(evidence: Pick<AiEvidenceReference, 'sourceRef' | 'sourceStart' | 'sourceEnd'>): string {
  return `${evidence.sourceRef}\u0000${evidence.sourceStart}\u0000${evidence.sourceEnd}`;
}

function requiredTextField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === 'string' && field.trim().length > 0 ? field : null;
}
function integerField(value: Record<string, unknown>, key: string): number | null {
  const field = value[key];
  return typeof field === 'number' && Number.isInteger(field) ? field : null;
}

function assertEvidenceReference(value: unknown, inputText: string): asserts value is AiEvidenceReference {
  if (!isRecord(value)) throw new AiProviderInputError();
  assertExactKeys(
    value,
    ['evidenceId', 'sourceRef', 'sourceSha256', 'evidenceQuote', 'sourceStart', 'sourceEnd'],
    new AiProviderInputError(),
  );
  const evidenceId = stringField(value, 'evidenceId');
  const sourceRef = stringField(value, 'sourceRef');
  const sourceSha256 = stringField(value, 'sourceSha256');
  const evidenceQuote = requiredTextField(value, 'evidenceQuote');
  const sourceStart = integerField(value, 'sourceStart');
  const sourceEnd = integerField(value, 'sourceEnd');
  if (
    evidenceId === null
    || !isOpaqueId(evidenceId)
    || sourceRef === null
    || !isOpaqueReference(sourceRef)
    || sourceSha256 === null
    || !sha256Pattern.test(sourceSha256)
    || evidenceQuote === null
    || sourceStart === null
    || sourceStart < 0
    || sourceEnd === null
    || sourceEnd <= sourceStart
  ) {
    throw new AiProviderInputError();
  }
  assertSafeText(evidenceQuote, MAX_CLAIM_LENGTH);
  if (sourceTextSpan(inputText, sourceStart, sourceEnd) !== evidenceQuote) {
    throw new AiProviderInputError();
  }
}

function assertClaimEvidenceReference(
  value: unknown,
  allowedReferences: ReadonlyMap<string, AiEvidenceReference>,
): asserts value is AiClaimEvidenceReference {
  if (!isRecord(value)) throw new AiProviderProhibitedOutputError();
  assertNoProhibitedKeys(value);
  assertExactKeys(
    value,
    ['evidenceId', 'sourceRef', 'sourceSha256', 'evidenceQuote', 'sourceStart', 'sourceEnd'],
    new AiProviderProhibitedOutputError(),
  );
  const evidenceId = stringField(value, 'evidenceId');
  const sourceRef = stringField(value, 'sourceRef');
  const sourceSha256 = stringField(value, 'sourceSha256');
  const evidenceQuote = requiredTextField(value, 'evidenceQuote');
  const sourceStart = integerField(value, 'sourceStart');
  const sourceEnd = integerField(value, 'sourceEnd');
  const expected = evidenceId === null ? undefined : allowedReferences.get(evidenceId);
  if (
    expected === undefined
    || sourceRef === null
    || sourceSha256 === null
    || evidenceQuote === null
    || sourceStart === null
    || sourceEnd === null
    || expected.sourceRef !== sourceRef
    || expected.sourceSha256 !== sourceSha256
    || expected.evidenceQuote !== evidenceQuote
    || expected.sourceStart !== sourceStart
    || expected.sourceEnd !== sourceEnd
  ) {
    throw new AiProviderProhibitedOutputError();
  }
}

function parseProviderConfigValue(value: unknown): AiProviderConfig {
  if (!isRecord(value)) throw new AiProviderUnavailableError('config_invalid');
  assertExactKeys(
    value,
    ['registryVersion', 'providerId', 'adapterVersion', 'configVersion', 'model'],
    new AiProviderUnavailableError('config_invalid'),
  );
  const registryVersion = stringField(value, 'registryVersion');
  const providerId = stringField(value, 'providerId');
  const adapterVersion = stringField(value, 'adapterVersion');
  const configVersion = stringField(value, 'configVersion');
  const model = stringField(value, 'model');
  if (
    registryVersion !== AI_PROVIDER_REGISTRY_VERSION
    || providerId !== CODEX_PROVIDER_ID
    || adapterVersion !== CODEX_PROVIDER_ADAPTER_VERSION
    || configVersion === null
    || !versionPattern.test(configVersion)
    || model === null
    || !modelPattern.test(model)
  ) {
    throw new AiProviderUnavailableError('config_invalid');
  }
  return {
    registryVersion: AI_PROVIDER_REGISTRY_VERSION,
    providerId: CODEX_PROVIDER_ID,
    adapterVersion: CODEX_PROVIDER_ADAPTER_VERSION,
    configVersion,
    model,
  };
}

function parseProviderConfig(rawConfig: string): AiProviderConfig {
  try {
    return parseProviderConfigValue(JSON.parse(rawConfig));
  } catch (error) {
    if (error instanceof AiProviderUnavailableError) throw error;
    throw new AiProviderUnavailableError('config_invalid');
  }
}

/** The registry accepts only the approved Phase-1 Codex adapter. */
export function resolveAiProviderConfig(env: AiProviderRuntimeEnv): AiProviderConfig {
  const rawConfig = env.AI_PROVIDER_CONFIG?.trim();
  if (rawConfig === undefined || rawConfig.length === 0) throw new AiProviderUnavailableError('config_missing');
  return parseProviderConfig(rawConfig);
}

export function providerMetadata(config: AiProviderConfig): AiProviderMetadata {
  return {
    registryVersion: config.registryVersion,
    providerId: config.providerId,
    adapterVersion: config.adapterVersion,
    configVersion: config.configVersion,
    model: config.model,
    promptVersion: AI_DRAFT_PROMPT_VERSION,
    schemaVersion: AI_DRAFT_SCHEMA_VERSION,
  };
}

/**
 * The approved gateway hash is SHA-256 of this fixed-order, complete runtime
 * tuple. Keeping the serialization here prevents model/prompt/schema drift.
 */
export async function canonicalAiProviderConfigHash(config: AiProviderConfig): Promise<string> {
  const metadata = providerMetadata(config);
  const tuple = JSON.stringify({
    adapterVersion: metadata.adapterVersion,
    configVersion: metadata.configVersion,
    model: metadata.model,
    promptVersion: metadata.promptVersion,
    providerId: metadata.providerId,
    registryVersion: metadata.registryVersion,
    schemaVersion: metadata.schemaVersion,
  });
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tuple));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Validates a request before it can reach an adapter. The route must reject all
 * extra prompt/control fields separately so request text is treated as evidence,
 * never as a user-controlled provider instruction.
 */
export function validateAiProviderRequest(value: unknown): AiProviderRequest {
  if (!isRecord(value)) throw new AiProviderInputError();
  assertExactKeys(value, ['materials', 'contrastAxes'], new AiProviderInputError());
  if (
    !Array.isArray(value.materials)
    || value.materials.length === 0
    || value.materials.length > MAX_MATERIALS
  ) {
    throw new AiProviderInputError();
  }

  const materials: AiProviderMaterial[] = [];
  const materialKinds = new Set<AiMaterialKind>();
  const materialRefs = new Set<string>();
  // evidenceId 는 요청 전체에서 유일해야 한다. 출력이 id 하나로 근거를 되짚기 때문이다.
  const evidenceIds = new Set<string>();
  for (const rawMaterial of value.materials) {
    if (!isRecord(rawMaterial)) throw new AiProviderInputError();
    assertExactKeys(rawMaterial, ['kind', 'sourceRef', 'maskedText', 'evidence'], new AiProviderInputError());
    const kind = stringField(rawMaterial, 'kind');
    const sourceRef = stringField(rawMaterial, 'sourceRef');
    if (
      (kind !== 'transcript' && kind !== 'text_context')
      || materialKinds.has(kind)
      || sourceRef === null
      || !isOpaqueReference(sourceRef)
      || materialRefs.has(sourceRef)
    ) {
      throw new AiProviderInputError();
    }
    const maskedText = rawMaterial.maskedText;
    assertSafeText(maskedText, MAX_MASKED_TEXT_LENGTH);
    if (
      !Array.isArray(rawMaterial.evidence)
      || rawMaterial.evidence.length === 0
      || rawMaterial.evidence.length > MAX_EVIDENCE_ITEMS
    ) {
      throw new AiProviderInputError();
    }

    const evidence: AiEvidenceReference[] = [];
    // 구간 중복 검사는 **재료 안에서만** 한다. 서로 다른 재료가 같은 sourceRef·구간을
    // 가질 수 있고(장비가 정하는 값이다) 그것은 충돌이 아니다.
    const evidenceSpans = new Set<string>();
    for (const item of rawMaterial.evidence) {
      assertEvidenceReference(item, maskedText);
      if (evidenceIds.has(item.evidenceId) || evidenceSpans.has(evidenceSpanKey(item))) {
        throw new AiProviderInputError();
      }
      evidenceIds.add(item.evidenceId);
      evidenceSpans.add(evidenceSpanKey(item));
      evidence.push({
        evidenceId: item.evidenceId,
        sourceRef: item.sourceRef,
        sourceSha256: item.sourceSha256,
        evidenceQuote: item.evidenceQuote,
        sourceStart: item.sourceStart,
        sourceEnd: item.sourceEnd,
      });
    }
    materialKinds.add(kind);
    materialRefs.add(sourceRef);
    materials.push({ kind, sourceRef, maskedText, evidence });
  }

  const rawAxes = value.contrastAxes;
  if (!isRecord(rawAxes)) throw new AiProviderInputError();
  assertExactKeys(rawAxes, [...AI_CONTRAST_AXES], new AiProviderInputError());
  const axes: Partial<Record<AiContrastAxis, AiContrastAxisStatus>> = {};
  for (const axis of AI_CONTRAST_AXES) {
    const status = stringField(rawAxes, axis);
    if (
      status !== 'applied'
      && status !== 'no_transcript'
      && status !== 'no_text'
      && status !== 'no_session_goal'
    ) {
      throw new AiProviderInputError();
    }
    // applied 는 그 축이 요구하는 재료가 실제로 실려 있을 때만 성립한다. 서버 판정과
    // 재료 구성이 어긋나면 조립이 틀린 것이므로 사업자에 닿기 전에 막는다.
    if (status === 'applied' && !materialKinds.has(CONTRAST_AXIS_MATERIAL[axis])) {
      throw new AiProviderInputError();
    }
    if (status === 'applied' && axis !== 'undiscussed_session_goal' && materialKinds.size < MAX_MATERIALS) {
      // 두 대조 축은 양쪽 재료를 견줘야 성립한다.
      throw new AiProviderInputError();
    }
    axes[axis] = status;
  }

  return {
    materials,
    contrastAxes: {
      missing_from_memo: axes.missing_from_memo ?? 'no_text',
      missing_from_transcript: axes.missing_from_transcript ?? 'no_transcript',
      undiscussed_session_goal: axes.undiscussed_session_goal ?? 'no_session_goal',
    },
  };
}

/**
 * Deterministic Preview-only fixture output. It has no fetch implementation and
 * can copy only evidence references that already passed request validation.
 */
export function generatePreviewFixtureAiDraft(request: AiProviderRequest): AiProviderOutput {
  const primary = request.materials[0];
  if (primary === undefined) throw new AiProviderInputError();
  const evidence = primary.evidence.map((reference) => ({ ...reference }));
  const byKind = new Map(request.materials.map((material) => [material.kind, material] as const));

  // 축 상태가 applied 인 축만 항목을 갖는다. 재료 구성이 그대로 비쳐 보이게.
  const fixtureFindings = (axis: AiContrastAxis): AiContrastFinding[] => {
    if (request.contrastAxes[axis] !== 'applied') return [];
    const material = byKind.get(CONTRAST_AXIS_MATERIAL[axis]);
    if (material === undefined) return [];
    const quote = material.evidence[0]?.evidenceQuote;
    if (quote === undefined) return [];
    return [{
      description: '합성 대조 항목입니다.',
      materialKind: material.kind,
      sourceRef: material.sourceRef,
      quote,
    }];
  };

  return {
    claims: [{
      claimKey: 'fixture-claim',
      section: 'other_topics',
      text: '합성 녹음 처리가 완료되었습니다.',
      evidence,
    }],
    questions: [
      {
        title: '합성 일정 확인',
        reason: '가상 일정의 확인이 필요합니다.',
        evidence: evidence.map((reference) => ({ ...reference })),
      },
      {
        title: '합성 비용 확인',
        reason: '가상 비용의 확인이 필요합니다.',
        evidence: evidence.map((reference) => ({ ...reference })),
      },
    ],
    oneLiner: '합성 녹음 처리 결과입니다.',
    contrast: {
      missing_from_memo: fixtureFindings('missing_from_memo'),
      missing_from_transcript: fixtureFindings('missing_from_transcript'),
      undiscussed_session_goal: fixtureFindings('undiscussed_session_goal'),
    },
    flagSuggestions: [],
  };
}

/** Preview fixture inputs do not attest a contradictory pair, so output is deterministically empty. */
export function detectPreviewFixtureDiscrepancies(
  _request: DiscrepancyDetectionRequest,
): DiscrepancyDetectionOutput {
  return { discrepancies: [] };
}


export function validateAiDraftSummary(value: unknown): string {
  assertSafeText(value, MAX_MASKED_TEXT_LENGTH);
  if (hasProhibitedOutput(value)) throw new AiProviderProhibitedOutputError();
  return value;
}
export function validateAiEvidenceIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TOTAL_EVIDENCE_ITEMS) {
    throw new AiProviderInputError();
  }
  const ids = value.map((item) => {
    if (typeof item !== 'string') throw new AiProviderInputError();
    const id = item.trim();
    if (!isOpaqueId(id)) throw new AiProviderInputError();
    return id;
  });
  if (new Set(ids).size !== ids.length) throw new AiProviderInputError();
  return ids;
}

function validateOutputEvidenceReferences(
  value: unknown,
  allowedReferences: ReadonlyMap<string, AiEvidenceReference>,
): AiClaimEvidenceReference[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TOTAL_EVIDENCE_ITEMS) {
    throw new AiProviderProhibitedOutputError();
  }

  const referencedEvidenceIds = new Set<string>();
  const evidence: AiClaimEvidenceReference[] = [];
  for (const reference of value) {
    assertClaimEvidenceReference(reference, allowedReferences);
    if (referencedEvidenceIds.has(reference.evidenceId)) {
      throw new AiProviderProhibitedOutputError();
    }
    referencedEvidenceIds.add(reference.evidenceId);
    evidence.push({
      evidenceId: reference.evidenceId,
      sourceRef: reference.sourceRef,
      sourceSha256: reference.sourceSha256,
      evidenceQuote: reference.evidenceQuote,
      sourceStart: reference.sourceStart,
      sourceEnd: reference.sourceEnd,
    });
  }
  return evidence;
}

function assertSafeGeneratedOutputText(value: unknown): asserts value is string {
  if (
    typeof value !== 'string'
    || value.trim().length === 0
    || value.length > MAX_CLAIM_LENGTH
    || hasPiiLikeValue(value)
    || hasProhibitedOutput(value)
  ) {
    throw new AiProviderProhibitedOutputError();
  }
}

/**
 * Turns a provider's response into the one grounded schema accepted by the
 * gateway. Every claim and briefing question must cite an exact request evidence
 * reference; unsupported response fields and prohibited judgments fail closed.
 */
export function validateAiProviderOutput(value: unknown, request: AiProviderRequest): AiProviderOutput {
  if (!isRecord(value)) throw new AiProviderProhibitedOutputError();
  assertNoProhibitedKeys(value);
  assertExactKeys(
    value,
    ['claims', 'questions', 'oneLiner', 'contrast', 'flagSuggestions'],
    new AiProviderProhibitedOutputError(),
  );
  if (!Array.isArray(value.claims) || value.claims.length === 0 || value.claims.length > MAX_CLAIMS) {
    throw new AiProviderProhibitedOutputError();
  }
  if (
    !Array.isArray(value.questions)
    || value.questions.length < MIN_QUESTIONS
    || value.questions.length > MAX_QUESTIONS
  ) {
    throw new AiProviderProhibitedOutputError();
  }

  const requestEvidence = request.materials.flatMap((material) => [...material.evidence]);
  const allowedReferences = new Map(requestEvidence.map((evidence) => [evidence.evidenceId, evidence] as const));
  if (allowedReferences.size !== requestEvidence.length) {
    throw new AiProviderProhibitedOutputError();
  }
  // 구간 유일성은 재료 안에서만 요구한다. 재료가 다르면 같은 구간이 정상이다.
  for (const material of request.materials) {
    const spans = new Set(material.evidence.map(evidenceSpanKey));
    if (spans.size !== material.evidence.length) throw new AiProviderProhibitedOutputError();
  }

  const claimKeys = new Set<string>();
  const claims: AiGeneratedClaim[] = [];
  let previousSectionIndex = -1;
  for (const rawClaim of value.claims) {
    if (!isRecord(rawClaim)) throw new AiProviderProhibitedOutputError();
    assertNoProhibitedKeys(rawClaim);
    assertExactKeys(
      rawClaim,
      ['claimKey', 'section', 'text', 'evidence'],
      new AiProviderProhibitedOutputError(),
    );
    const claimKey = stringField(rawClaim, 'claimKey');
    const section = stringField(rawClaim, 'section');
    const text = rawClaim.text;
    const sectionIndex = section === null
      ? -1
      : (AI_CLAIM_SECTIONS as readonly string[]).indexOf(section);
    if (
      claimKey === null
      || !isOpaqueId(claimKey)
      || claimKeys.has(claimKey)
      || sectionIndex < 0
      || sectionIndex < previousSectionIndex
    ) {
      throw new AiProviderProhibitedOutputError();
    }
    assertSafeGeneratedOutputText(text);
    const evidence = validateOutputEvidenceReferences(rawClaim.evidence, allowedReferences);
    claimKeys.add(claimKey);
    previousSectionIndex = sectionIndex;
    claims.push({ claimKey, section: section as AiClaimSection, text, evidence });
  }

  const questionTitles = new Set<string>();
  const questions: AiGeneratedQuestion[] = [];
  for (const rawQuestion of value.questions) {
    if (!isRecord(rawQuestion)) throw new AiProviderProhibitedOutputError();
    assertNoProhibitedKeys(rawQuestion);
    assertExactKeys(rawQuestion, ['title', 'reason', 'evidence'], new AiProviderProhibitedOutputError());
    const title = rawQuestion.title;
    const reason = rawQuestion.reason;
    assertSafeGeneratedOutputText(title);
    if (title.length > MAX_QUESTION_TITLE_LENGTH) {
      throw new AiProviderProhibitedOutputError();
    }
    assertSafeGeneratedOutputText(reason);
    if (questionTitles.has(title)) {
      throw new AiProviderProhibitedOutputError();
    }
    questionTitles.add(title);
    questions.push({
      title,
      reason,
      evidence: validateOutputEvidenceReferences(rawQuestion.evidence, allowedReferences),
    });
  }

  // 핵심 한 줄(D45·CCC-38): 개행 없는 한 문장. PII 유사 패턴·금지 판단은 claims 와 같은
  // 검사(assertSafeGeneratedOutputText)를 통과해야 한다.
  const oneLiner = value.oneLiner;
  assertSafeGeneratedOutputText(oneLiner);
  if (oneLiner.includes('\n') || oneLiner.length > MAX_ONE_LINER_LENGTH) {
    throw new AiProviderProhibitedOutputError();
  }
  return {
    claims,
    questions,
    oneLiner,
    contrast: validateContrastOutput(value.contrast, request),
    flagSuggestions: validateFlagSuggestions(value.flagSuggestions, request),
  };
}

function validateFlagSuggestions(value: unknown, request: AiProviderRequest): AiFlagSuggestion[] {
  if (!Array.isArray(value) || value.length > MAX_FLAG_SUGGESTIONS) {
    throw new AiProviderProhibitedOutputError();
  }
  const transcript = request.materials.find((material) => material.kind === 'transcript');
  if (transcript === undefined && value.length > 0) {
    throw new AiProviderProhibitedOutputError();
  }

  const suggestions: AiFlagSuggestion[] = [];
  const seen = new Set<string>();
  for (const rawSuggestion of value) {
    if (!isRecord(rawSuggestion)) throw new AiProviderProhibitedOutputError();
    assertNoProhibitedKeys(rawSuggestion);
    assertExactKeys(
      rawSuggestion,
      ['type', 'sourceRef', 'quote'],
      new AiProviderProhibitedOutputError(),
    );
    const type = stringField(rawSuggestion, 'type');
    const sourceRef = stringField(rawSuggestion, 'sourceRef');
    const quote = rawSuggestion.quote;
    if (
      type === null
      || !(AI_FLAG_TYPES as readonly string[]).includes(type)
      || sourceRef === null
      || transcript === undefined
      || sourceRef !== transcript.sourceRef
    ) {
      throw new AiProviderProhibitedOutputError();
    }
    assertSafeGeneratedOutputText(quote);
    if (quote.length > MAX_FLAG_QUOTE_LENGTH || !transcript.maskedText.includes(quote)) {
      throw new AiProviderProhibitedOutputError();
    }
    const key = `${type}\u0000${sourceRef}\u0000${quote}`;
    if (seen.has(key)) throw new AiProviderProhibitedOutputError();
    seen.add(key);
    suggestions.push({ type: type as AiFlagType, sourceRef, quote });
  }
  return suggestions;
}

/**
 * 대조 3종 검증 (D69 · ADR-0036 · CCC-102).
 *
 * 축은 셋 다 있어야 하고, 서버가 applied 로 판정하지 않은 축은 항목이 0개여야 한다.
 * 항목의 인용은 ① 그 축이 쓰는 재료에서 나와야 하고 ② 그 재료 원문의 정확한 부분
 * 문자열이어야 한다. ②는 불일치 검출(validateDiscrepancyDetectionOutput)과 같은 태도다.
 */
function validateContrastOutput(value: unknown, request: AiProviderRequest): AiContrastOutput {
  if (!isRecord(value)) throw new AiProviderProhibitedOutputError();
  assertNoProhibitedKeys(value);
  assertExactKeys(value, [...AI_CONTRAST_AXES], new AiProviderProhibitedOutputError());

  const materialByRef = new Map(request.materials.map((material) => [material.sourceRef, material] as const));
  const contrast: Partial<Record<AiContrastAxis, AiContrastFinding[]>> = {};
  for (const axis of AI_CONTRAST_AXES) {
    const rawFindings = value[axis];
    if (!Array.isArray(rawFindings) || rawFindings.length > MAX_CONTRAST_FINDINGS_PER_AXIS) {
      throw new AiProviderProhibitedOutputError();
    }
    if (request.contrastAxes[axis] !== 'applied' && rawFindings.length > 0) {
      throw new AiProviderProhibitedOutputError();
    }

    const expectedKind = CONTRAST_AXIS_MATERIAL[axis];
    const findings: AiContrastFinding[] = [];
    const seen = new Set<string>();
    for (const rawFinding of rawFindings) {
      if (!isRecord(rawFinding)) throw new AiProviderProhibitedOutputError();
      assertNoProhibitedKeys(rawFinding);
      assertExactKeys(
        rawFinding,
        ['description', 'materialKind', 'sourceRef', 'quote'],
        new AiProviderProhibitedOutputError(),
      );
      const materialKind = stringField(rawFinding, 'materialKind');
      const sourceRef = stringField(rawFinding, 'sourceRef');
      const description = rawFinding.description;
      const quote = rawFinding.quote;
      if (materialKind !== expectedKind || sourceRef === null) {
        throw new AiProviderProhibitedOutputError();
      }
      const material = materialByRef.get(sourceRef);
      if (material === undefined || material.kind !== expectedKind) {
        throw new AiProviderProhibitedOutputError();
      }
      assertSafeGeneratedOutputText(description);
      assertSafeGeneratedOutputText(quote);
      if (
        description.length > MAX_CONTRAST_DESCRIPTION_LENGTH
        || quote.length > MAX_CONTRAST_QUOTE_LENGTH
        // 원문 인용 강제. 재료에 없는 문장은 인용이 아니다.
        || !material.maskedText.includes(quote)
      ) {
        throw new AiProviderProhibitedOutputError();
      }
      const key = `${description}\u0000${sourceRef}\u0000${quote}`;
      if (seen.has(key)) throw new AiProviderProhibitedOutputError();
      seen.add(key);
      findings.push({ description, materialKind, sourceRef, quote });
    }
    contrast[axis] = findings;
  }
  return {
    missing_from_memo: contrast.missing_from_memo ?? [],
    missing_from_transcript: contrast.missing_from_transcript ?? [],
    undiscussed_session_goal: contrast.undiscussed_session_goal ?? [],
  };
}

/** 검출 요청 검증 — 소스 텍스트는 가명 처리된 안전 텍스트여야 하고 참조는 유일해야 한다. */
export function validateDiscrepancyDetectionRequest(value: unknown): DiscrepancyDetectionRequest {
  if (!isRecord(value)) throw new AiProviderInputError();
  assertExactKeys(value, ['triggerRef', 'sources'], new AiProviderInputError());
  const triggerRef = stringField(value, 'triggerRef');
  if (triggerRef === null || !isOpaqueReference(triggerRef)) throw new AiProviderInputError();
  if (!Array.isArray(value.sources) || value.sources.length === 0 || value.sources.length > MAX_DISCREPANCY_SOURCES) {
    throw new AiProviderInputError();
  }
  const refs = new Set<string>();
  const sources: DiscrepancySourceInput[] = [];
  for (const item of value.sources) {
    if (!isRecord(item)) throw new AiProviderInputError();
    assertExactKeys(item, ['sourceRef', 'text'], new AiProviderInputError());
    const sourceRef = stringField(item, 'sourceRef');
    if (sourceRef === null || !isOpaqueReference(sourceRef) || refs.has(sourceRef)) {
      throw new AiProviderInputError();
    }
    assertSafeText(item.text, MAX_MASKED_TEXT_LENGTH);
    refs.add(sourceRef);
    sources.push({ sourceRef, text: item.text });
  }
  if (!refs.has(triggerRef)) throw new AiProviderInputError();
  return { triggerRef, sources };
}

/**
 * 검출 출력 검증 — 판단·해석 필드는 스키마 자체가 거부하고(assertExactKeys), 인용은
 * 요청 소스 텍스트의 부분 문자열이어야 한다. 트리거 회차가 끼지 않은 쌍, 유형과 회차의
 * 모순(within 인데 회차가 다름 등)도 전부 fail-closed 다.
 */
export function validateDiscrepancyDetectionOutput(
  value: unknown,
  request: DiscrepancyDetectionRequest,
): DiscrepancyDetectionOutput {
  if (!isRecord(value)) throw new AiProviderProhibitedOutputError();
  assertNoProhibitedKeys(value);
  assertExactKeys(value, ['discrepancies'], new AiProviderProhibitedOutputError());
  if (!Array.isArray(value.discrepancies) || value.discrepancies.length > MAX_DISCREPANCIES) {
    throw new AiProviderProhibitedOutputError();
  }
  const textByRef = new Map(request.sources.map((source) => [source.sourceRef, source.text] as const));
  const seen = new Set<string>();
  const discrepancies: DetectedDiscrepancy[] = [];
  for (const item of value.discrepancies) {
    if (!isRecord(item)) throw new AiProviderProhibitedOutputError();
    assertNoProhibitedKeys(item);
    assertExactKeys(
      item,
      ['kind', 'leftRef', 'leftQuote', 'rightRef', 'rightQuote'],
      new AiProviderProhibitedOutputError(),
    );
    const kind = stringField(item, 'kind');
    const leftRef = stringField(item, 'leftRef');
    const rightRef = stringField(item, 'rightRef');
    const leftQuote = item.leftQuote;
    const rightQuote = item.rightQuote;
    if (
      (kind !== 'cross_session' && kind !== 'within_session')
      || leftRef === null
      || rightRef === null
    ) {
      throw new AiProviderProhibitedOutputError();
    }
    const leftText = textByRef.get(leftRef);
    const rightText = textByRef.get(rightRef);
    if (leftText === undefined || rightText === undefined) throw new AiProviderProhibitedOutputError();
    if (kind === 'within_session' && leftRef !== rightRef) throw new AiProviderProhibitedOutputError();
    if (kind === 'cross_session' && leftRef === rightRef) throw new AiProviderProhibitedOutputError();
    // 검출은 공식화된 회차를 계기로 실행된다 — 그 회차가 낀 쌍만 유효하다.
    if (leftRef !== request.triggerRef && rightRef !== request.triggerRef) {
      throw new AiProviderProhibitedOutputError();
    }
    assertSafeGeneratedOutputText(leftQuote);
    assertSafeGeneratedOutputText(rightQuote);
    if (
      leftQuote.length > MAX_DISCREPANCY_QUOTE_LENGTH
      || rightQuote.length > MAX_DISCREPANCY_QUOTE_LENGTH
      // 원문 인용 강제 — 소스에 없는 문장은 인용이 아니다.
      || !leftText.includes(leftQuote)
      || !rightText.includes(rightQuote)
    ) {
      throw new AiProviderProhibitedOutputError();
    }
    const key = [kind, leftRef, leftQuote, rightRef, rightQuote].join('\u0000');
    if (seen.has(key)) throw new AiProviderProhibitedOutputError();
    seen.add(key);
    discrepancies.push({ kind, leftRef, leftQuote, rightRef, rightQuote });
  }
  return { discrepancies };
}

function responseText(response: unknown): string | null {
  if (!isRecord(response)) return null;
  if (typeof response.output_text === 'string') return response.output_text;
  if (!Array.isArray(response.output)) return null;
  for (const item of response.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (isRecord(content) && content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return null;
}

const contrastFindingSchema = {
  type: 'array',
  maxItems: MAX_CONTRAST_FINDINGS_PER_AXIS,
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['description', 'materialKind', 'sourceRef', 'quote'],
    properties: {
      description: { type: 'string', minLength: 1, maxLength: MAX_CONTRAST_DESCRIPTION_LENGTH },
      materialKind: { type: 'string', enum: ['transcript', 'text_context'] },
      sourceRef: { type: 'string' },
      quote: { type: 'string', minLength: 1, maxLength: MAX_CONTRAST_QUOTE_LENGTH },
    },
  },
} as const;

const codexResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['claims', 'questions', 'oneLiner', 'contrast', 'flagSuggestions'],
  properties: {
    oneLiner: { type: 'string', minLength: 1, maxLength: 120 },
    // 대조 3종(D69 · ADR-0036). 판단 필드가 없다. 설명과 원문 인용뿐이다(R5).
    contrast: {
      type: 'object',
      additionalProperties: false,
      required: ['missing_from_memo', 'missing_from_transcript', 'undiscussed_session_goal'],
      properties: {
        missing_from_memo: contrastFindingSchema,
        missing_from_transcript: contrastFindingSchema,
        undiscussed_session_goal: contrastFindingSchema,
      },
    },
    claims: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claimKey', 'section', 'text', 'evidence'],
        properties: {
          claimKey: { type: 'string' },
          section: { type: 'string', enum: AI_CLAIM_SECTIONS },
          text: { type: 'string' },
          evidence: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['evidenceId', 'sourceRef', 'sourceSha256', 'evidenceQuote', 'sourceStart', 'sourceEnd'],
              properties: {
                evidenceId: { type: 'string' },
                sourceRef: { type: 'string' },
                sourceSha256: { type: 'string' },
                evidenceQuote: { type: 'string' },
                sourceStart: { type: 'integer' },
                sourceEnd: { type: 'integer' },
              },
            },
          },
        },
      },
    },
    flagSuggestions: {
      type: 'array',
      maxItems: MAX_FLAG_SUGGESTIONS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'sourceRef', 'quote'],
        properties: {
          type: { type: 'string', enum: AI_FLAG_TYPES },
          sourceRef: { type: 'string' },
          quote: { type: 'string', minLength: 1, maxLength: MAX_FLAG_QUOTE_LENGTH },
        },
      },
    },
    questions: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'reason', 'evidence'],
        properties: {
          title: { type: 'string' },
          reason: { type: 'string' },
          evidence: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['evidenceId', 'sourceRef', 'sourceSha256', 'evidenceQuote', 'sourceStart', 'sourceEnd'],
              properties: {
                evidenceId: { type: 'string' },
                sourceRef: { type: 'string' },
                sourceSha256: { type: 'string' },
                evidenceQuote: { type: 'string' },
                sourceStart: { type: 'integer' },
                sourceEnd: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  },
} as const;

// D69 · ADR-0036: 재료가 둘(전사 · 텍스트 맥락)일 수 있고 대조 3종이 출력에 붙는다.
// 축의 적용 여부는 요청의 contrastAxes 가 이미 정해서 온다. 모델이 다시 판단하지 않는다.
const CODEX_INSTRUCTIONS = [
  'Each supplied material is masked counseling-record text: kind transcript is the recorded session, kind text_context is the worker memo together with labelled goal sections.',
  'Generate only grounded counseling-record draft claims and exactly two or three structured briefing suggestions, using every supplied material without treating either transcript or worker memo as more authoritative.',
  'Give every claim exactly one section label and keep claims grouped in this order: session_goal_discussion, other_topics, next_session_commitments.',
  'Use session_goal_discussion for what was discussed under each labelled 회기 목표; omit that section when no session goal is supplied.',
  'Use other_topics for important matters outside session goals in chronological order.',
  'Use next_session_commitments only for grounded promises and tasks before the next session; describe them without inventing an owner or due date.',
  'Each suggestion has a short title (80 characters or fewer) naming what to check in the next session, and a reason explaining why it needs checking.',
  'Also produce oneLiner: a single-line Korean gist of the session in 120 characters or fewer, with no line breaks.',
  'Each claim and each suggestion must cite one or more supplied opaque evidence references exactly, from any material.',
  'Also produce contrast, three lists that compare the materials without judging them.',
  'missing_from_memo lists what the transcript records but the text_context memo does not; quote the transcript.',
  'missing_from_transcript lists what the text_context memo records but the transcript does not; quote the text_context.',
  'undiscussed_session_goal lists entries of the text_context section labelled 회기 목표 that this session did not address; quote the text_context.',
  'Judge undiscussed goals only against that 회기 목표 section; overall and detailed goals are background, never the test.',
  'Each contrast entry carries a short Korean description, the materialKind and sourceRef of the material it quotes, and a quote that is a verbatim substring of that material.',
  'Return an empty list for any contrast axis whose contrastAxes status is not applied, and for an applied axis with nothing to report.',
  'Do not produce GAS scores, confirmations, diagnoses, or decisions about support continuation.',
  'Do not decide which material is correct, and do not interpret or recommend anything in contrast entries.',
  'Also produce flagSuggestions using only verbatim transcript quotes and only these six types: crisis_utterance, contact_loss_risk, housing_livelihood_shock, debt_deterioration, repeated_noncompliance, violence_exploitation.',
  'For crisis_utterance and violence_exploitation, suggest a flag when the transcript reasonably indicates a possible safety concern; for the other four types require a clear, concrete participant statement.',
  'Never create flagSuggestions from text_context, and return an empty list when no transcript material is supplied.',
  'Do not add names, contacts, accounts, or other personal data.',
].join(' ');

// 불일치 검출 스키마(D45 · CCC-43) — 판단 필드가 아예 없다. 빈 배열이 정상 결과다.
const codexDiscrepancySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['discrepancies'],
  properties: {
    discrepancies: {
      type: 'array',
      maxItems: MAX_DISCREPANCIES,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'leftRef', 'leftQuote', 'rightRef', 'rightQuote'],
        properties: {
          kind: { type: 'string', enum: ['cross_session', 'within_session'] },
          leftRef: { type: 'string' },
          leftQuote: { type: 'string' },
          rightRef: { type: 'string' },
          rightQuote: { type: 'string' },
        },
      },
    },
  },
} as const;

// R5: 어느 쪽이 맞는지 판단·해석·권고 금지 — 상반된 서술의 원문 인용 쌍만.
const CODEX_DISCREPANCY_INSTRUCTIONS = [
  'Compare the supplied counseling-record sources and list only pairs of directly conflicting factual statements.',
  'Each pair must involve the trigger source; quote both sides verbatim as exact substrings of the source texts.',
  'Use kind within_session when both quotes come from the trigger source itself, cross_session otherwise.',
  'Do not judge which side is correct, do not interpret, summarize, diagnose, or recommend anything.',
  'Do not add names, contacts, accounts, or other personal data.',
  'Return an empty list when there is no direct conflict.',
].join(' ');

/** The sole Phase-1 external provider implementation. It never logs content. */
export class CodexProviderAdapter implements AiProviderAdapter {
  readonly providerId = CODEX_PROVIDER_ID;
  readonly adapterVersion = CODEX_PROVIDER_ADAPTER_VERSION;

  constructor(
    private readonly config: AiProviderConfig,
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async generate(request: AiProviderRequest): Promise<AiProviderOutput> {
    return await this.callStructured(
      CODEX_INSTRUCTIONS,
      JSON.stringify({ materials: request.materials, contrastAxes: request.contrastAxes }),
      'ccc_grounded_draft_v4',
      codexResponseSchema,
    ) as AiProviderOutput;
  }

  /** 내용 불일치 검출(CCC-43). 반환값 검증은 호출자의 validateDiscrepancyDetectionOutput 몫이다. */
  async detectDiscrepancies(request: DiscrepancyDetectionRequest): Promise<unknown> {
    return await this.callStructured(
      CODEX_DISCREPANCY_INSTRUCTIONS,
      JSON.stringify({ triggerRef: request.triggerRef, sources: request.sources }),
      'ccc_discrepancy_list_v1',
      codexDiscrepancySchema,
    );
  }

  private async callStructured(
    instructions: string,
    input: string,
    schemaName: string,
    schema: object,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CODEX_REQUEST_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await Reflect.apply(this.fetcher, globalThis, [CODEX_RESPONSES_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: this.config.model,
            store: false,
            instructions,
            input,
            text: {
              format: {
                type: 'json_schema',
                name: schemaName,
                strict: true,
                schema,
              },
            },
          }),
          signal: controller.signal,
        }]);
      } catch {
        // 망 장애·타임아웃(AbortController). 사업자에 닿지도 못한 경우다.
        throw new AiProviderUnavailableError('network');
      }
      // 상태 코드만 싣는다 — 401(키 오류)과 404(모델명 오류)를 가르는 단서다(CCC-47).
      if (!response.ok) throw new AiProviderUnavailableError('http_status', response.status);
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new AiProviderUnavailableError('malformed_response');
      }
      const text = responseText(payload);
      if (text === null) throw new AiProviderUnavailableError('malformed_response');
      try {
        return JSON.parse(text) as unknown;
      } catch {
        throw new AiProviderUnavailableError('malformed_response');
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function resolveAiProviderAdapter(env: AiProviderRuntimeEnv): { adapter: AiProviderAdapter; config: AiProviderConfig } {
  const injectedAdapter = env.AI_PROVIDER_ADAPTER;
  if (injectedAdapter !== undefined) {
    if (!isRecord(injectedAdapter)) {
      throw new AiProviderUnavailableError('adapter_invalid');
    }
    if (
      injectedAdapter.testOnly !== true
      || injectedAdapter.providerId !== CODEX_PROVIDER_ID
      || injectedAdapter.adapterVersion !== CODEX_PROVIDER_ADAPTER_VERSION
      || typeof injectedAdapter.generate !== 'function'
    ) {
      throw new AiProviderUnavailableError('adapter_invalid');
    }
    const config = parseProviderConfigValue(injectedAdapter.config);
    if (
      config.providerId !== injectedAdapter.providerId
      || config.adapterVersion !== injectedAdapter.adapterVersion
    ) {
      throw new AiProviderUnavailableError('adapter_invalid');
    }
    return { adapter: injectedAdapter as unknown as AiProviderTestAdapter, config };
  }

  const config = resolveAiProviderConfig(env);
  const apiKey = env.CODEX_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) throw new AiProviderUnavailableError('api_key_missing');
  if (env.EXTERNAL_AI_CALLS_ENABLED !== '1') {
    throw new AiProviderUnavailableError('external_calls_disabled');
  }
  return { adapter: new CodexProviderAdapter(config, apiKey), config };
}
