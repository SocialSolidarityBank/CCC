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
