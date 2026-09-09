export const STT_ENGINE_IDS = ['qwen3-asr', 'azure-speech-koreacentral'] as const;
export type SttEngineId = typeof STT_ENGINE_IDS[number];
export type SttReadinessMode = 'off' | 'local' | 'azure';

export type SttReadinessReport =
  | { schemaVersion: 1; sttMode: 'off'; sttEngineId: null; state: 'unavailable'; capacity: 0 }
  | { schemaVersion: 1; sttMode: 'local'; sttEngineId: 'qwen3-asr'; state: 'ready' | 'unavailable'; capacity: 0 | 1 }
  | { schemaVersion: 1; sttMode: 'azure'; sttEngineId: 'azure-speech-koreacentral'; state: 'ready' | 'unavailable'; capacity: 0 | 1 };

export type SttReadinessRecord = SttReadinessReport & {
  orgId: string;
  agentId: string;
  receivedAt: string;
  expiresAt: string;
};

export function isSttReadinessReport(value: unknown): value is SttReadinessReport {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  if (keys !== 'capacity,schemaVersion,state,sttEngineId,sttMode') return false;
  if (record.schemaVersion !== 1 || (record.state !== 'ready' && record.state !== 'unavailable')) return false;
  if (record.capacity !== 0 && record.capacity !== 1) return false;
  if (record.state === 'unavailable' && record.capacity !== 0) return false;
  if (record.sttMode === 'off') return record.sttEngineId === null && record.state === 'unavailable' && record.capacity === 0;
  if (record.sttMode === 'local') return record.sttEngineId === 'qwen3-asr';
  return record.sttMode === 'azure' && record.sttEngineId === 'azure-speech-koreacentral';
}
