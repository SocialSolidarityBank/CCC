import { describe, expect, it } from 'vitest';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import {
  MaskingPipelineManifestError,
  decodeMaskingPipelineRegistry,
  hasRegisteredMaskingPipeline,
  isRegisteredMaskingPipelinePair,
} from '@ccc/contracts/masking-pipeline';

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function canonicalRegistry(overrides: Record<string, unknown> = {}) {
  const unsigned = {
    schemaVersion: 2,
    resultSchemaVersion: 2,
    maskingPipelineVersion: 'ner-mask-v3',
    directIdentifierRulesVersion: 'direct-v1',
    regexRulesVersion: 'regex-v2',
    conditionDictionaryVersion: 'condition-dict-v1',
    quasiIdentifierRulesVersion: 'quasi-v1',
    g7RelativeDateRulesVersion: 'calendar-day-v1',
    nerModelId: 'FrameByFrame/korean-pii-e5-base',
    nerModelRevision: 'a308c54b4407819624a5661e31e162a269f39818',
    personLabels: ['PRIVATE_PERSON'],
    addressLabels: ['PRIVATE_ADDRESS'],
    conditionNerModelId: null,
    conditionNerModelRevision: null,
    conditionLabels: [],
    labelSetHash: 'b645305b068070375d95b18979ead77ec584833f6670dd82554605e9ccf4a4fc',
    nerHealthCorpusHash: '10265475ed38dbdc8f902cd78fb29654a948c96ddb9c9daeda3b485d4cdd46a5',
    nerHealthResultHash: 'fd02b5efd65f04f9814959875cefb76b1fa9596e34bd0441aa452be7224f1c72',
    ...overrides,
  };
  const maskingPipelineHash = await sha256Hex(canonicalizeJcs(unsigned));
  return JSON.stringify({
    schemaVersion: 1,
    activeMaskingPipelineVersion: unsigned.maskingPipelineVersion,
    pipelines: [{ ...unsigned, maskingPipelineHash }],
  });
}

describe('canonical masking pipeline registry', () => {
  it('makes one canonical manifest the active Agent identity and exact server allowlist pair', async () => {
    const raw = await canonicalRegistry();
    const registry = await decodeMaskingPipelineRegistry(raw);
    const active = registry.active;

    expect(active).toMatchObject({
      schemaVersion: 2,
      resultSchemaVersion: 2,
      maskingPipelineVersion: 'ner-mask-v3',
      maskingPipelineHash: '28f1e35f975b44c6bce719e1f9cae23e88f9092164531618d739be2abb5a7b9a',
      directIdentifierRulesVersion: 'direct-v1',
      regexRulesVersion: 'regex-v2',
      conditionDictionaryVersion: 'condition-dict-v1',
      quasiIdentifierRulesVersion: 'quasi-v1',
      g7RelativeDateRulesVersion: 'calendar-day-v1',
      nerModelId: 'FrameByFrame/korean-pii-e5-base',
      nerModelRevision: 'a308c54b4407819624a5661e31e162a269f39818',
      personLabels: ['PRIVATE_PERSON'],
      addressLabels: ['PRIVATE_ADDRESS'],
      conditionNerModelId: null,
      conditionNerModelRevision: null,
      conditionLabels: [],
      labelSetHash: 'b645305b068070375d95b18979ead77ec584833f6670dd82554605e9ccf4a4fc',
      nerHealthCorpusHash: '10265475ed38dbdc8f902cd78fb29654a948c96ddb9c9daeda3b485d4cdd46a5',
      nerHealthResultHash: 'fd02b5efd65f04f9814959875cefb76b1fa9596e34bd0441aa452be7224f1c72',
    });
    expect(await hasRegisteredMaskingPipeline(raw)).toBe(true);
    expect(await isRegisteredMaskingPipelinePair(
      raw,
      active.maskingPipelineVersion,
      active.maskingPipelineHash,
    )).toBe(true);
    expect(await isRegisteredMaskingPipelinePair(raw, active.maskingPipelineVersion, '0'.repeat(64))).toBe(false);
    expect(await isRegisteredMaskingPipelinePair(raw, 'ner-mask-*', active.maskingPipelineHash)).toBe(false);
  });

  it('rejects a freshly hashed but unsupported static-rule tuple and the old hash map shape', async () => {
    const unsupported = await canonicalRegistry({ g7RelativeDateRulesVersion: 'calendar-day-v2' });

    await expect(decodeMaskingPipelineRegistry(unsupported)).rejects.toBeInstanceOf(MaskingPipelineManifestError);
    await expect(decodeMaskingPipelineRegistry(JSON.stringify({ 'ner-mask-v2': 'a'.repeat(64) })))
      .rejects.toBeInstanceOf(MaskingPipelineManifestError);
  });

  it('rejects duplicate JSON members instead of parsing and re-digesting a repaired object', async () => {
    const raw = await canonicalRegistry();
    const duplicate = raw.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');

    await expect(decodeMaskingPipelineRegistry(duplicate)).rejects.toBeInstanceOf(MaskingPipelineManifestError);
  });
});
