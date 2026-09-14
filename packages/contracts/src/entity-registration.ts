export type EntityRegistrationFamily = 'generic' | 'memory';
export type EntityRegistrationKind = 'person' | 'institution';
export type EntityRegistrationReason = 'ambiguous_identity' | 'missing_identity_evidence';

export interface EntityRegistrationOccurrence {
  sourceId: string;
  sourceRevision: string;
  start: number;
  end: number;
}

export interface EntityRegistrationEntry {
  kind: EntityRegistrationKind;
  sourceValue: string;
  occurrences: EntityRegistrationOccurrence[];
  entityReference: string | null;
}

export interface EntityRegistrationRequest {
  family: EntityRegistrationFamily;
  jobId: string;
  claimToken: string;
  attempt: number;
  sourceBundleRevision: string;
  expectedMapRevision: number;
  entries: EntityRegistrationEntry[];
}

export interface EntityRegistrationResultEntry {
  index: number;
  number: number | null;
  reason: EntityRegistrationReason | null;
}

export type EntityRegistrationResponse =
  | {
    outcome: 'applied';
    mapRevision: number;
    entries: EntityRegistrationResultEntry[];
  }
  | {
    outcome: 'superseded';
  };

export interface EntitySourceDescriptor {
  sourceId: string;
  sourceRevision: string;
  sourceKind: string;
  start: number;
  end: number;
  sha256: string;
  consultationDate: string;
  dateRevision: string;
}

export interface EntitySourceBinding {
  version: 1;
  sourceBundleRevision: string;
  orgId: string;
  supportCaseId: string;
  beneficiaryId: string;
  vaultCreatedAt: string;
  vaultVersion: number;
  keyVersion: number;
  family: EntityRegistrationFamily;
  jobId: string;
  attempt: number;
  claimTokenHash: string;
  generation: number;
  mapRevision: number;
  consentRevision: string;
  sources: EntitySourceDescriptor[];
  audio: {
    generationId: string;
    rawSha256: string | null;
  } | null;
}
