import type { DeploymentMode } from './runtime';

export type { DeploymentMode } from './runtime';

export const AGENT_JOB_STATES = [
  'pending',
  'leased',
  'blocked',
  'succeeded',
  'cancelled',
  'expired',
  'failed',
] as const;
export type AgentJobState = typeof AGENT_JOB_STATES[number];

export type JobKind = 'audio' | 'text';
export type ProcessingRoute = 'community-cloud-agent' | 'local-single-agent' | 'local-office-agent';
export type SttEngine = 'local' | 'azure' | null;
/** S7이 실제 literal과 의미를 소유한다. */
export type ConsentScope = string & { readonly __s7ConsentDomain: unique symbol };

export const CLAIM_LIMIT_DEFAULT = 10;
export const CLAIM_LIMIT_MIN = 2;
export const CLAIM_LIMIT_MAX = 50;
export const AGENT_JOB_MAX_ATTEMPTS = 3 as const;

export function normalizeClaimLimit(value: unknown): number {
  if (value === undefined) return CLAIM_LIMIT_DEFAULT;
  if (!Number.isInteger(value) || (value as number) < CLAIM_LIMIT_MIN || (value as number) > CLAIM_LIMIT_MAX) {
    throw new TypeError('claim limit is invalid');
  }
  return value as number;
}

export type ReleaseReason =
  | 'engine_unavailable'
  | 'local_ner_unavailable'
  | 'result_schema_invalid'
  | 'masking_failed'
  | 'consent_not_effective'
  | 'audio_object_missing'
  | 'audio_hash_mismatch'
  | 'route_mismatch'
  | 'permanent_failure';
export type PermanentReleaseReason = Exclude<ReleaseReason, 'engine_unavailable' | 'local_ner_unavailable'>;

export interface NerAttestation {
  id: string;
  modelId: string;
  modelRevision: string;
  labelSetHash: string;
  corpusHash: string;
  resultHash: string;
  validatedAt: string;
  expiresAt: string;
  status: 'passed';
}

export interface NerReleaseQualificationReceipt extends NerAttestation {
  receiptId: string;
}

export interface AzureEgressAuthorization {
  egressAuthorizationId: string;
  tuple: {
    orgId: string;
    jobId: string;
    claimTokenHash: string;
    attempt: number;
    rawAudioSha256: string;
    consentRevision: string;
    provider: 'azure';
  };
  status: 'authorized';
  expiresAt: string;
}

export interface OpenAiEgressAuthorization {
  egressAuthorizationId: string;
  tuple: {
    provider: 'openai';
    orgId: string;
    supportCaseId: string;
    sessionId: string;
    workItemId: string;
    actorId: string;
    operation: 'generate' | 'regenerate' | 'detect_discrepancies';
    materialHashes: string[];
    consentRevision: string;
  };
  status: 'authorized';
  expiresAt: string;
}

export type EgressAuthorization = AzureEgressAuthorization | OpenAiEgressAuthorization;
export type EgressRecordStatus = 'authorized' | 'in_flight' | 'completed' | 'revoked' | 'expired';

export interface EgressAuthorizationRequest {
  claimToken: string;
  attempt: number;
  rawAudioSha256: string;
  provider: 'azure';
}

export interface EgressInFlightRequest {
  egressAuthorizationId: string;
  claimToken: string;
  attempt: number;
}

export interface EgressInFlightResponse {
  egressAuthorizationId: string;
  provider: 'azure' | 'openai';
  state: 'in_flight';
  startedAt: string;
}

export interface MaskDictionaryEntry {
  field: string;
  sourceValue: string;
  replacement: string;
}

export interface MaskDictionaryRequest {
  claimToken: string;
  attempt: number;
}

export interface MaskDictionaryResponse {
  dictionaryId: string;
  jobId: string;
  expiresAt: string;
  oneTime: true;
  entries: MaskDictionaryEntry[];
}

export interface ClaimRequest {
  limit?: number;
  nerAttestation: NerAttestation;
  releaseQualificationReceiptId: string;
}

export interface AgentJob {
  jobId: string;
  sessionId: string;
  caseId: string;
  kind: JobKind;
  state: 'leased';
  attempt: number;
  maxAttempts: typeof AGENT_JOB_MAX_ATTEMPTS;
  claimToken: string;
  claimedAt: string;
  leaseExpiresAt: string;
  enqueuedAt: string;
  route: ProcessingRoute;
  sttEngine: SttEngine;
  requiredConsent: ConsentScope[];
  releaseQualificationReceiptId: string;
  terminalFailureCode: string | null;
  maskDictionaryEndpoint: string;
  audio: null | {
    generationId: string;
    clientAssertedSha256: string | null;
    agentComputedSha256: string | null;
    rawAudioSha256: string | null;
    retentionHardCapAt: string;
    processingDeadlineAt: string | null;
    egressAuthorizationId: string | null;
    delivery: 'protected-get' | 'api-stream';
    endpoint: string;
    expiresAt: string | null;
  };
}

export interface ClaimResponse {
  schemaVersion: 2;
  jobs: AgentJob[];
}

export interface HeartbeatRequest {
  claimToken: string;
  attempt: number;
}

export interface HeartbeatResponse {
  jobId: string;
  state: 'leased';
  attempt: number;
  leaseExpiresAt: string;
}

export type ReleaseRequest =
  | { claimToken: string; attempt: number; outcome: 'transient'; reason: 'engine_unavailable' }
  | { claimToken: string; attempt: number; outcome: 'blocked'; reason: 'local_ner_unavailable' }
  | { claimToken: string; attempt: number; outcome: 'permanent'; reason: PermanentReleaseReason };

export interface MaskedEvidence {
  id: string;
  sourceRef: string;
  sourceSha256: string;
  evidenceQuote: string;
  sourceStart: number;
  sourceEnd: number;
}

export interface MaskedSource {
  maskedText: string;
  sha256: string;
  maskingPipelineVersion: string;
  maskingPipelineHash: string;
  nerAvailable: true;
  nerAttestationId: string;
  nerAttestationResultHash: string;
  releaseQualificationReceiptId: string;
  evidenceHash: string;
  evidence: MaskedEvidence[];
}

export interface AudioResult extends MaskedSource {
  kind: 'audio';
  emotionScores: Record<string, unknown>;
  transcriptReliable: boolean;
  transcriptWarnings: Array<{ startSeconds: number; endSeconds: number; reason: string }>;
}

export interface TextResult extends MaskedSource {
  kind: 'text';
}

export interface ResultRequest {
  schemaVersion: 2;
  claimToken: string;
  attempt: number;
  resultId: string;
  payloadSha256: string;
  result: AudioResult | TextResult;
}

export interface SourceResponse {
  sessionId: string;
  text: string;
}

export interface SignedGetResponse {
  delivery: 'signed-get';
  url: string;
  expiresAt: string;
}

export interface AudioVerifyRequest {
  claimToken: string;
  attempt: number;
  generationId: string;
  agentComputedSha256: string;
}

export interface AudioVerifyResponse {
  jobId: string;
  generationId: string;
  rawAudioSha256: string;
  verifiedAt: string;
}

export interface AudioDeletionEnqueue {
  audioObjectId: string;
  generationId: string;
  deletionAttemptId: string;
  reason:
    | 'processed'
    | 'cancelled'
    | 'consent_withdrawal'
    | 'processing_failed'
    | 'hash_mismatch'
    | 'retry_exhausted'
    | 'unprocessed_expiry'
    | 'retention_hard_cap';
}

export const AGENT_JOB_ERROR_CODES = [
  'authentication_required',
  'forbidden',
  'job_not_found',
  'lease_expired',
  'stale_claim',
  'consent_not_effective',
  'audio_object_missing',
  'audio_hash_mismatch',
  'audio_deleted',
  'route_mismatch',
  'engine_unavailable',
  'masking_snapshot_missing',
  'local_ner_unavailable',
  'registered_pii_detected',
  'unmasked_identifier_detected',
  'evidence_hash_mismatch',
  'masking_pipeline_version_mismatch',
  'dictionary_already_consumed',
  'result_schema_invalid',
  'result_conflict',
  'retry_exhausted',
] as const;
export type JobErrorCode = typeof AGENT_JOB_ERROR_CODES[number];

export interface JobError {
  error: JobErrorCode;
  jobId: string | null;
  retryable: boolean;
}

export function jobErrorHttpStatus(error: JobErrorCode): 401 | 403 | 404 | 409 | 422 {
  if (error === 'authentication_required') return 401;
  if (error === 'forbidden') return 403;
  if (error === 'job_not_found' || error === 'audio_object_missing') return 404;
  if (
    error === 'lease_expired'
    || error === 'stale_claim'
    || error === 'consent_not_effective'
    || error === 'audio_deleted'
    || error === 'route_mismatch'
    || error === 'dictionary_already_consumed'
    || error === 'result_conflict'
    || error === 'retry_exhausted'
  ) return 409;
  return 422;
}

export function routeForMode(mode: DeploymentMode): ProcessingRoute {
  if (mode === 'community-cloud') return 'community-cloud-agent';
  if (mode === 'local-single') return 'local-single-agent';
  return 'local-office-agent';
}
