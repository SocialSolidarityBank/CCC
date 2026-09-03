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
