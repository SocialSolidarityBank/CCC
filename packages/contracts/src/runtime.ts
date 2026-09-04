export type AudioContentType =
  | 'audio/mp4'
  | 'audio/mpeg'
  | 'audio/wav'
  | 'audio/x-wav'
  | 'audio/webm'
  | 'audio/x-m4a';

export const AUDIO_CONTENT_TYPES: Record<AudioContentType, true> = {
  'audio/mp4': true,
  'audio/mpeg': true,
  'audio/wav': true,
  'audio/x-wav': true,
  'audio/webm': true,
  'audio/x-m4a': true,
};

export interface AudioObjectMetadata {
  contentLength: number;
  contentType: AudioContentType;
  expiresAt: string;
}

export type AudioDownload = AudioObjectMetadata & {
  body: ReadableStream<Uint8Array>;
  sha256: string | null;
};

export type AudioDeleteVerificationMethod =
  | 'authenticated-get-404'
  | 'filesystem-stat-enoent'
  | 'r2-head-absent';

export interface AudioDeletionEvidence {
  keyHash: string;
  generationId: string | null;
  objectSha256: string | null;
  deletionAttemptId: string;
  deletionRequestedAt: string;
  providerDeleteAcceptedAt: string | null;
  deletedAt: string | null;
  deleteSucceeded: boolean;
  absentFromList: boolean;
  absentFromMetadata: boolean;
  directReadAbsent: boolean;
  verificationMethod: AudioDeleteVerificationMethod;
  providerStatus?: number;
  verifiedAt: string;
}

export interface AudioStore {
  put(
    key: string,
    body: ReadableStream<Uint8Array>,
    metadata: AudioObjectMetadata,
  ): Promise<{ sha256: string }>;
  get(key: string): Promise<AudioDownload | null>;
  delete(key: string): Promise<AudioDeletionEvidence>;
  createUploadTarget(
    key: string,
    metadata: AudioObjectMetadata,
  ): Promise<{ url: string; expiresAt: string } | null>;
  createDownloadTarget(
    key: string,
    expiresInSeconds?: number,
  ): Promise<{ url: string; expiresAt: string } | null>;
}

/**
 * 예약 작업 포트. 실행기(Workers cron, Supabase pg_cron tick, Local 프로세스 타이머)는
 * 종류와 예약 시각만 넘기고, 작업 몸체는 runner 하나가 갖는다.
 */
export type ScheduledJobKind = 'pipeline_watchdog' | 'pii_retention' | 'audio_expiry';

export interface JobReport {
  kind: ScheduledJobKind;
  /** 예약 시각(cron tick). 실행기의 벽시계가 아니다. */
  nowIso: string;
  completedAt: string;
  /** 작업별 집계. 열쇠는 작업이 정한다(예: 워치독 `stale`, 보존 `archived`). */
  counters: Record<string, number>;
}

export interface ScheduledJobRunner {
  run(kind: ScheduledJobKind, nowIso: string): Promise<JobReport>;
}

export interface Scheduler {
  schedule(kind: ScheduledJobKind, cron: string): Promise<void>;
}

// ── 배포 모드와 canonical Actor (S2 §2.1, ADR-0041 D76·D82) ─────────────────

export type DeploymentMode = 'community-cloud' | 'local-single' | 'local-office';
export const DEPLOYMENT_MODES: readonly DeploymentMode[] = ['community-cloud', 'local-single', 'local-office'];

export type ActorKind = 'human' | 'agent' | 'system';
export type ActorRole = 'institution-admin' | 'technical-admin' | 'supervisor' | 'worker' | 'service';
export type AuthSource =
  | 'supabase-jwt'
  | 'cloudflare-access'
  | 'single-local-bearer'
  | 'office-local-bearer'
  | 'agent-bearer'
  | 'scheduler-secret';
export type AuthAssurance = 'none' | 'aal1' | 'aal2' | 'app-lock' | 'mfa';
export type RevocationReason =
  | 'logout'
  | 'password-reset'
  | 'mfa-reset'
  | 'admin-disable'
  | 'pairing-revoked'
  | 'security-event';

/**
 * 세 모드가 공유하는 lossless Actor. email, raw SID, token 원문, PII 를 담지 않는다.
 * `orgId=null` 은 system actor 만 허용한다. 구현 어댑터는 E4-1/E4-2/E4-3/E7/E8 소유.
 */
export interface Actor {
  kind: ActorKind;
  userId: string;
  orgId: string | null;
  roles: ActorRole[];
  scopes: string[];
  authn: {
    source: AuthSource;
    assurance: AuthAssurance;
    sessionId: string | null;
  };
}

export interface Identity {
  resolve(request: Request): Promise<Actor>;
  revokeAll(userId: string, reason: RevocationReason): Promise<void>;
  revokeSession(sessionId: string, reason: RevocationReason): Promise<void>;
}

// ── CapabilityManifest (S2 §2.8) ────────────────────────────────────────────

export type SttMode = 'off' | 'local' | 'azure';
export type LlmMode = 'off' | 'openai';
export const STT_MODES: readonly SttMode[] = ['off', 'local', 'azure'];
export const LLM_MODES: readonly LlmMode[] = ['off', 'openai'];
/** signed engine registry 의 exact member 만 이 brand 를 얻는다(`approvedSttEngineId`). */
export type ApprovedSttEngineId = string & { readonly __brand: 'ApprovedSttEngineId' };
export type SttEngine = ApprovedSttEngineId | null;
export type AgentStatus = 'connected' | 'delayed' | 'authentication_error' | 'quota_exceeded' | 'inactive';
export type CapabilityDisabledReason = 'unverified' | 'missing_key' | 'unsupported' | null;
export type CapabilityFeature = 'recording' | 'multi_user' | 'offline' | 'public_signup' | 'cloud_audio_temp' | 'ai_draft';

export interface CapabilityOption<M extends string> {
  mode: M;
  enabled: boolean;
  disabledReason: CapabilityDisabledReason;
}

export interface CapabilityManifest {
  schemaVersion: 1;
  mode: DeploymentMode;
  sttMode: SttMode;
  sttEngine: SttEngine;
  sttOptions: Array<CapabilityOption<SttMode>>;
  llmMode: LlmMode;
  llmOptions: Array<CapabilityOption<LlmMode>>;
  features: Record<CapabilityFeature, boolean>;
  agentStatus: AgentStatus;
}

/** signed install manifest 의 `approvedSttEngineIds` 원소. Q 승인 전 registry 는 비어 있다. */
export interface ApprovedSttEngineEntry {
  id: string;
  mode: 'local' | 'azure';
}

// ── 설치 신뢰 경계 (S2 §2.7) ────────────────────────────────────────────────

/** 설치 시 생성되는 public bootstrap. 키는 정확히 둘이다. */
export interface PublicBootstrap {
  apiBase: string;
  mode: DeploymentMode;
}

export interface SignedInstallManifest {
  schemaVersion: 1;
  mode: DeploymentMode;
  apiBase: string;
  clientOrigin: string;
  allowedOrigins: string[];
  host: string;
  scheme: 'https' | 'http' | 'ccc';
  endpointDiscovery: 'static' | 'dpapi-record';
  /** CSPRNG opaque ID. org/user ID 가 아니다. */
  installationId: string;
  sequence: number;
  publishedAt: string;
  expiresAt: string;
  approvedSttEngineIds: ApprovedSttEngineEntry[];
  supabaseProjectRef: string | null;
  supabaseAuthOrigin: string | null;
  supabasePublishableKey: string | null;
  signingKeyId: string;
  /** RFC 8785 JCS 로 정규화한 나머지 필드의 Ed25519 서명(base64). */
  ed25519Signature: string;
}
