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
export const AI_DRAFT_PROMPT_VERSION = 'phase1.grounded.v1';
export const AI_DRAFT_SCHEMA_VERSION = 'phase1.grounded-draft.v1';

const MAX_MASKED_TEXT_LENGTH = 24_000;
const MAX_EVIDENCE_ITEMS = 64;
const MAX_CLAIMS = 32;
const MAX_CLAIM_LENGTH = 2_000;
const MIN_QUESTIONS = 2;
const MAX_QUESTIONS = 3;
const CODEX_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const CODEX_REQUEST_TIMEOUT_MS = 20_000;

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

export interface AiGeneratedClaim {
  claimKey: string;
  text: string;
  evidence: readonly AiClaimEvidenceReference[];
}
export interface AiGeneratedQuestion {
  text: string;
  evidence: readonly AiClaimEvidenceReference[];
}

export interface AiProviderRequest {
  maskedText: string;
  evidence: readonly AiEvidenceReference[];
}

export interface AiProviderOutput {
  claims: readonly AiGeneratedClaim[];
  questions: readonly AiGeneratedQuestion[];
}

/**
 * The provider receives only gateway-reloaded, locally NER-masked evidence.
 * Credentials stay in Worker bindings.
 */
export interface AiProviderAdapter {
  readonly providerId: typeof CODEX_PROVIDER_ID;
  readonly adapterVersion: string;
  generate(request: AiProviderRequest): Promise<AiProviderOutput>;
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

export class AiProviderUnavailableError extends Error {
  constructor() {
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
  if (!isRecord(value)) throw new AiProviderUnavailableError();
  assertExactKeys(
    value,
    ['registryVersion', 'providerId', 'adapterVersion', 'configVersion', 'model'],
    new AiProviderUnavailableError(),
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
    throw new AiProviderUnavailableError();
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
    throw new AiProviderUnavailableError();
  }
}

/** The registry accepts only the approved Phase-1 Codex adapter. */
export function resolveAiProviderConfig(env: AiProviderRuntimeEnv): AiProviderConfig {
  const rawConfig = env.AI_PROVIDER_CONFIG?.trim();
  if (rawConfig === undefined || rawConfig.length === 0) throw new AiProviderUnavailableError();
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
  assertExactKeys(value, ['maskedText', 'evidence'], new AiProviderInputError());
  const maskedText = value.maskedText;
  assertSafeText(maskedText, MAX_MASKED_TEXT_LENGTH);
  if (!Array.isArray(value.evidence) || value.evidence.length === 0 || value.evidence.length > MAX_EVIDENCE_ITEMS) {
    throw new AiProviderInputError();
  }

  const evidence: AiEvidenceReference[] = [];
  const evidenceIds = new Set<string>();
  const evidenceSpans = new Set<string>();
  for (const item of value.evidence) {
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
  return { maskedText, evidence };
}

export function validateAiDraftSummary(value: unknown): string {
  assertSafeText(value, MAX_MASKED_TEXT_LENGTH);
  if (hasProhibitedOutput(value)) throw new AiProviderProhibitedOutputError();
  return value;
}
export function validateAiEvidenceIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EVIDENCE_ITEMS) {
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
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_EVIDENCE_ITEMS) {
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
  assertExactKeys(value, ['claims', 'questions'], new AiProviderProhibitedOutputError());
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

  const allowedReferences = new Map(request.evidence.map((evidence) => [evidence.evidenceId, evidence] as const));
  const requestSpans = new Set(request.evidence.map(evidenceSpanKey));
  if (allowedReferences.size !== request.evidence.length || requestSpans.size !== request.evidence.length) {
    throw new AiProviderProhibitedOutputError();
  }

  const claimKeys = new Set<string>();
  const claims: AiGeneratedClaim[] = [];
  for (const rawClaim of value.claims) {
    if (!isRecord(rawClaim)) throw new AiProviderProhibitedOutputError();
    assertNoProhibitedKeys(rawClaim);
    assertExactKeys(rawClaim, ['claimKey', 'text', 'evidence'], new AiProviderProhibitedOutputError());
    const claimKey = stringField(rawClaim, 'claimKey');
    const text = rawClaim.text;
    if (claimKey === null || !isOpaqueId(claimKey) || claimKeys.has(claimKey)) {
      throw new AiProviderProhibitedOutputError();
    }
    assertSafeGeneratedOutputText(text);
    const evidence = validateOutputEvidenceReferences(rawClaim.evidence, allowedReferences);
    claimKeys.add(claimKey);
    claims.push({ claimKey, text, evidence });
  }

  const questionTexts = new Set<string>();
  const questions: AiGeneratedQuestion[] = [];
  for (const rawQuestion of value.questions) {
    if (!isRecord(rawQuestion)) throw new AiProviderProhibitedOutputError();
    assertNoProhibitedKeys(rawQuestion);
    assertExactKeys(rawQuestion, ['text', 'evidence'], new AiProviderProhibitedOutputError());
    const text = rawQuestion.text;
    assertSafeGeneratedOutputText(text);
    if (questionTexts.has(text)) {
      throw new AiProviderProhibitedOutputError();
    }
    questionTexts.add(text);
    questions.push({
      text,
      evidence: validateOutputEvidenceReferences(rawQuestion.evidence, allowedReferences),
    });
  }
  return { claims, questions };
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

const codexResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['claims', 'questions'],
  properties: {
    claims: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claimKey', 'text', 'evidence'],
        properties: {
          claimKey: { type: 'string' },
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
    questions: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'evidence'],
        properties: {
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
  },
} as const;

const CODEX_INSTRUCTIONS = [
  'Generate only grounded counseling-record draft claims and exactly two or three briefing questions.',
  'Each claim and each question must cite one or more supplied opaque evidence references exactly.',
  'Do not produce GAS scores, confirmations, diagnoses, or decisions about support continuation.',
  'Do not add names, contacts, accounts, or other personal data.',
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CODEX_REQUEST_TIMEOUT_MS);
    try {
      let response: Response;
      try {
        response = await this.fetcher(CODEX_RESPONSES_URL, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: this.config.model,
            instructions: CODEX_INSTRUCTIONS,
            input: JSON.stringify({ maskedText: request.maskedText, evidence: request.evidence }),
            text: {
              format: {
                type: 'json_schema',
                name: 'ccc_grounded_draft_v1',
                strict: true,
                schema: codexResponseSchema,
              },
            },
          }),
          signal: controller.signal,
        });
      } catch {
        throw new AiProviderUnavailableError();
      }
      if (!response.ok) throw new AiProviderUnavailableError();
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new AiProviderUnavailableError();
      }
      const text = responseText(payload);
      if (text === null) throw new AiProviderUnavailableError();
      try {
        return JSON.parse(text) as AiProviderOutput;
      } catch {
        throw new AiProviderUnavailableError();
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
      throw new AiProviderUnavailableError();
    }
    if (
      injectedAdapter.testOnly !== true
      || injectedAdapter.providerId !== CODEX_PROVIDER_ID
      || injectedAdapter.adapterVersion !== CODEX_PROVIDER_ADAPTER_VERSION
      || typeof injectedAdapter.generate !== 'function'
    ) {
      throw new AiProviderUnavailableError();
    }
    const config = parseProviderConfigValue(injectedAdapter.config);
    if (
      config.providerId !== injectedAdapter.providerId
      || config.adapterVersion !== injectedAdapter.adapterVersion
    ) {
      throw new AiProviderUnavailableError();
    }
    return { adapter: injectedAdapter as unknown as AiProviderTestAdapter, config };
  }

  const config = resolveAiProviderConfig(env);
  const apiKey = env.CODEX_API_KEY?.trim();
  if (apiKey === undefined || apiKey.length === 0) throw new AiProviderUnavailableError();
  return { adapter: new CodexProviderAdapter(config, apiKey), config };
}
