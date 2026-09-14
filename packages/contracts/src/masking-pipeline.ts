import { canonicalizeJcs } from './jcs';
import { isRecord } from './guards';
import { RESULT_SCHEMA_VERSION } from './agent-jobs';

const HEX_40 = /^[0-9a-f]{40}$/u;
const HEX_64 = /^[0-9a-f]{64}$/u;
const VERSION_IDENTIFIER = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LABEL = /^[A-Z][A-Z0-9_]*$/u;

const REGISTRY_KEYS = [
  'activeMaskingPipelineVersion',
  'pipelines',
  'schemaVersion',
] as const;
const MANIFEST_KEYS = [
  'addressLabels',
  'conditionDictionaryVersion',
  'conditionLabels',
  'conditionNerModelId',
  'conditionNerModelRevision',
  'directIdentifierRulesVersion',
  'g7RelativeDateRulesVersion',
  'labelSetHash',
  'maskingPipelineHash',
  'maskingPipelineVersion',
  'nerHealthCorpusHash',
  'nerHealthResultHash',
  'nerModelId',
  'nerModelRevision',
  'personLabels',
  'quasiIdentifierRulesVersion',
  'regexRulesVersion',
  'resultSchemaVersion',
  'schemaVersion',
] as const;

export interface MaskingPipelineManifest {
  schemaVersion: 2;
  resultSchemaVersion: typeof RESULT_SCHEMA_VERSION;
  maskingPipelineVersion: string;
  maskingPipelineHash: string;
  directIdentifierRulesVersion: 'direct-v1';
  regexRulesVersion: 'regex-v2';
  conditionDictionaryVersion: 'condition-dict-v1';
  quasiIdentifierRulesVersion: 'quasi-v1';
  g7RelativeDateRulesVersion: 'calendar-day-v1';
  nerModelId: string;
  nerModelRevision: string;
  personLabels: string[];
  addressLabels: string[];
  conditionNerModelId: string | null;
  conditionNerModelRevision: string | null;
  conditionLabels: string[];
  labelSetHash: string;
  nerHealthCorpusHash: string;
  nerHealthResultHash: string;
}

export interface MaskingPipelineRegistry {
  schemaVersion: 1;
  activeMaskingPipelineVersion: string;
  pipelines: readonly MaskingPipelineManifest[];
  active: MaskingPipelineManifest;
}

export class MaskingPipelineManifestError extends Error {
  constructor() {
    super('masking pipeline manifest is invalid');
    this.name = 'MaskingPipelineManifestError';
  }
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function isLabelList(value: unknown, allowEmpty = false): value is string[] {
  return Array.isArray(value)
    && (allowEmpty || value.length > 0)
    && value.every(item => typeof item === 'string' && LABEL.test(item))
    && new Set(value).size === value.length;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function assertNoDuplicateJsonObjectKeys(raw: string): void {
  let cursor = 0;
  const fail = (): never => {
    throw new MaskingPipelineManifestError();
  };
  const skipWhitespace = () => {
    while (cursor < raw.length && /\s/u.test(raw[cursor]!)) cursor += 1;
  };
  const readString = (): string => {
    if (raw[cursor] !== '"') fail();
    const start = cursor;
    cursor += 1;
    while (cursor < raw.length) {
      const character = raw[cursor]!;
      cursor += 1;
      if (character === '"') {
        try {
          return JSON.parse(raw.slice(start, cursor)) as string;
        } catch {
          fail();
        }
      }
      if (character === '\\') {
        if (cursor >= raw.length) fail();
        cursor += 1;
      } else if (character.charCodeAt(0) < 0x20) {
        fail();
      }
    }
    return fail();
  };
  const readValue = (): void => {
    skipWhitespace();
    if (raw[cursor] === '{') {
      cursor += 1;
      skipWhitespace();
      const keys = new Set<string>();
      if (raw[cursor] === '}') {
        cursor += 1;
        return;
      }
      while (cursor < raw.length) {
        skipWhitespace();
        const key = readString();
        if (keys.has(key)) fail();
        keys.add(key);
        skipWhitespace();
        if (raw[cursor] !== ':') fail();
        cursor += 1;
        readValue();
        skipWhitespace();
        if (raw[cursor] === '}') {
          cursor += 1;
          return;
        }
        if (raw[cursor] !== ',') fail();
        cursor += 1;
      }
      fail();
    }
    if (raw[cursor] === '[') {
      cursor += 1;
      skipWhitespace();
      if (raw[cursor] === ']') {
        cursor += 1;
        return;
      }
      while (cursor < raw.length) {
        readValue();
        skipWhitespace();
        if (raw[cursor] === ']') {
          cursor += 1;
          return;
        }
        if (raw[cursor] !== ',') fail();
        cursor += 1;
      }
      fail();
    }
    if (raw[cursor] === '"') {
      readString();
      return;
    }
    const start = cursor;
    while (cursor < raw.length && !/[\s,\]}]/u.test(raw[cursor]!)) cursor += 1;
    if (start === cursor) fail();
    try {
      JSON.parse(raw.slice(start, cursor));
    } catch {
      fail();
    }
  };

  readValue();
  skipWhitespace();
  if (cursor !== raw.length) fail();
}

async function decodeManifest(value: unknown): Promise<MaskingPipelineManifest> {
  if (!isRecord(value) || !hasExactKeys(value, MANIFEST_KEYS)) throw new MaskingPipelineManifestError();
  if (
    value.schemaVersion !== 2
    || value.resultSchemaVersion !== RESULT_SCHEMA_VERSION
    || typeof value.maskingPipelineVersion !== 'string'
    || !VERSION_IDENTIFIER.test(value.maskingPipelineVersion)
    || typeof value.maskingPipelineHash !== 'string'
    || !HEX_64.test(value.maskingPipelineHash)
    || value.directIdentifierRulesVersion !== 'direct-v1'
    || value.regexRulesVersion !== 'regex-v2'
    || value.conditionDictionaryVersion !== 'condition-dict-v1'
    || value.quasiIdentifierRulesVersion !== 'quasi-v1'
    || value.g7RelativeDateRulesVersion !== 'calendar-day-v1'
    || typeof value.nerModelId !== 'string'
    || value.nerModelId.length === 0
    || typeof value.nerModelRevision !== 'string'
    || !HEX_40.test(value.nerModelRevision)
    || !isLabelList(value.personLabels)
    || !isLabelList(value.addressLabels)
    || !isLabelList(value.conditionLabels, true)
    || typeof value.labelSetHash !== 'string'
    || !HEX_64.test(value.labelSetHash)
    || typeof value.nerHealthCorpusHash !== 'string'
    || !HEX_64.test(value.nerHealthCorpusHash)
    || typeof value.nerHealthResultHash !== 'string'
    || !HEX_64.test(value.nerHealthResultHash)
  ) throw new MaskingPipelineManifestError();
  const hasConditionModel = typeof value.conditionNerModelId === 'string' && value.conditionNerModelId.length > 0;
  if (
    (value.conditionNerModelId !== null && !hasConditionModel)
    || (value.conditionNerModelRevision !== null
      && (typeof value.conditionNerModelRevision !== 'string' || !HEX_40.test(value.conditionNerModelRevision)))
    || hasConditionModel !== (value.conditionNerModelRevision !== null)
    || hasConditionModel !== (value.conditionLabels.length > 0)
  ) throw new MaskingPipelineManifestError();

  const labelsHash = await sha256Hex(canonicalizeJcs(
    [...value.personLabels, ...value.addressLabels].sort(),
  ));
  if (labelsHash !== value.labelSetHash) throw new MaskingPipelineManifestError();

  const { maskingPipelineHash, ...unsigned } = value;
  if (await sha256Hex(canonicalizeJcs(unsigned)) !== maskingPipelineHash) {
    throw new MaskingPipelineManifestError();
  }
  return value as unknown as MaskingPipelineManifest;
}

export async function decodeMaskingPipelineRegistry(raw: string | undefined): Promise<MaskingPipelineRegistry> {
  let value: unknown;
  try {
    assertNoDuplicateJsonObjectKeys(raw ?? '');
    value = JSON.parse(raw ?? '');
  } catch {
    throw new MaskingPipelineManifestError();
  }
  if (!isRecord(value) || !hasExactKeys(value, REGISTRY_KEYS)
    || value.schemaVersion !== 1
    || typeof value.activeMaskingPipelineVersion !== 'string'
    || !VERSION_IDENTIFIER.test(value.activeMaskingPipelineVersion)
    || !Array.isArray(value.pipelines)
    || value.pipelines.length === 0
  ) throw new MaskingPipelineManifestError();

  const pipelines = await Promise.all(value.pipelines.map(decodeManifest));
  const versions = new Set(pipelines.map(manifest => manifest.maskingPipelineVersion));
  if (versions.size !== pipelines.length) throw new MaskingPipelineManifestError();
  const active = pipelines.find(
    manifest => manifest.maskingPipelineVersion === value.activeMaskingPipelineVersion,
  );
  if (active === undefined) throw new MaskingPipelineManifestError();
  return {
    schemaVersion: 1,
    activeMaskingPipelineVersion: value.activeMaskingPipelineVersion,
    pipelines,
    active,
  };
}

export async function hasRegisteredMaskingPipeline(raw: string | undefined): Promise<boolean> {
  try {
    await decodeMaskingPipelineRegistry(raw);
    return true;
  } catch {
    return false;
  }
}

export async function registeredMaskingPipeline(
  raw: string | undefined,
  version: unknown,
  hash: unknown,
): Promise<MaskingPipelineManifest | null> {
  if (typeof version !== 'string' || typeof hash !== 'string') return null;
  try {
    const registry = await decodeMaskingPipelineRegistry(raw);
    return registry.pipelines.find(
      manifest => manifest.maskingPipelineVersion === version && manifest.maskingPipelineHash === hash,
    ) ?? null;
  } catch {
    return null;
  }
}

export async function isRegisteredMaskingPipelinePair(
  raw: string | undefined,
  version: unknown,
  hash: unknown,
): Promise<boolean> {
  return await registeredMaskingPipeline(raw, version, hash) !== null;
}
