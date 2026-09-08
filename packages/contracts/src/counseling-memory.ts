export type MemoryKind = 'fact' | 'observation';
export type MemoryItemState = 'current' | 'historical' | 'conflicting';
export type MemorySourceKind = 'session' | 'goal' | 'action' | 'correction' | 'derived_summary';

export interface MemoryCitation {
  materialId: string;
  quote: string;
}

export interface MemoryMaterial {
  id: string;
  sourceKind: MemorySourceKind;
  sourceId: string;
  sourceRevision: string;
  sessionId: string | null;
  occurredAt: string;
  snapshotId: string;
  sha256: string;
  maskedText: string;
}

export interface MemorySource extends MemoryCitation {
  sourceKind: MemorySourceKind;
  sourceId: string;
  sourceRevision: string;
  sessionId: string | null;
  occurredAt: string;
}

export interface MemoryReference {
  kind: 'goal' | 'action';
  id: string;
}

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  title: string;
  body: string;
  state: MemoryItemState;
  revision: number;
  updatedAt: string;
  correctedAt: string | null;
  sources: MemorySource[];
  references: MemoryReference[];
}

export interface MemorySummaryLine {
  text: string;
  itemIds: string[];
}

export type MemoryStatus =
  | 'empty'
  | 'backfill'
  | 'updating'
  | 'ready'
  | 'off'
  | 'blocked'
  | 'failed'
  | 'closed'
  | 'unavailable';

export interface CaseMemoryView {
  supportCaseId: string;
  revision: number;
  status: MemoryStatus;
  reason: string | null;
  updatedAt: string | null;
  summary: MemorySummaryLine[];
  items: MemoryItem[];
  history: MemoryItem[];
  canCorrect: boolean;
}

export interface MemoryCorrectionInput {
  itemId: string;
  expectedRevision: number;
  body: string;
}

export interface MemorySettingsInput {
  enabled: boolean;
  expectedVersion: number;
}

export interface MemorySettingsView {
  enabled: boolean;
  version: number;
  pendingCases: number;
  blockedCases: number;
  failedCases: number;
  lastSuccessAt: string | null;
}

/** Patch output: an omitted existing item is preserved, never deleted. */
export interface MemoryGenerationRequest {
  supportCaseId: string;
  generation: number;
  materials: MemoryMaterial[];
  existingItems: MemoryItem[];
}

export interface MemoryItemUpdate {
  key: string;
  itemId: string | null;
  kind: MemoryKind;
  title: string;
  body: string;
  state: MemoryItemState;
  citations: MemoryCitation[];
  references: MemoryReference[];
}

export interface MemoryGenerationOutput {
  updates: MemoryItemUpdate[];
  summary: Array<{ text: string; itemKeys: string[] }>;
}

/** Internal scheduler lease, not a public API payload. */
export interface MemoryWork {
  id: string;
  orgId: string;
  supportCaseId: string;
  serviceActorId: string;
  generation: number;
  correctionRevision: number;
  settingsVersion: number;
  leaseToken: string;
}

/** Verified historical inputs remain outside current-session evidence. */
export interface MemoryHistoricalContext {
  supportCaseId: string;
  revision: number;
  materials: MemoryMaterial[];
}
