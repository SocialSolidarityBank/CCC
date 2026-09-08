import { describe, expect, it } from 'vitest';
import type { MemoryGenerationRequest, MemoryGenerationOutput, MemoryMaterial, MemoryItem } from '@ccc/contracts/counseling-memory';
import {
  AiProviderInputError, AiProviderProhibitedOutputError, AiProviderUnavailableError,
  CodexProviderAdapter, canonicalAiProviderConfigHash, providerMetadata,
  validateMemoryGenerationRequest, validateMemoryGenerationOutput,
  validateAiProviderRequest, validateAiProviderOutput, generatePreviewFixtureAiDraft,
  type AiProviderConfig,
} from '@ccc/ai-runtime';

const config: AiProviderConfig = {
  registryVersion: 'phase1.v1', providerId: 'codex', adapterVersion: 'v1',
  configVersion: 'memory-test', model: 'test-model',
};
function material(id = 'material-a', sessionId = 'session-a'): MemoryMaterial {
  return { id, sourceKind: 'session', sourceId: sessionId, sourceRevision: 'v1', sessionId,
    occurredAt: '2026-09-01T00:00:00Z', snapshotId: `snapshot-${id}`, sha256: 'a'.repeat(64),
    maskedText: '다음 상담에 상환 계획을 가져오기로 했다.' };
}
function request(): MemoryGenerationRequest {
  return { supportCaseId: 'case-a', generation: 1, materials: [material()], existingItems: [] };
}
function output(): MemoryGenerationOutput {
  return { updates: [{ key: 'promise', itemId: null, kind: 'fact', title: '상환 계획',
    body: '다음 상담에 상환 계획을 가져오기로 했다.', state: 'current',
    citations: [{ materialId: 'material-a', quote: material().maskedText }], references: [] }],
    summary: [{ text: '다음 상담에 상환 계획을 가져오기로 했다.', itemKeys: ['promise'] }] };
}
function correctedRequest(): MemoryGenerationRequest {
  const source = material();
  const item: MemoryItem = { id: 'item-a', kind: 'fact', title: '상환 계획', body: '계획 제출 약속은 취소했다.',
    state: 'current', revision: 2, updatedAt: '2026-09-02T00:00:00Z', correctedAt: '2026-09-02T00:00:00Z',
    sources: [{ materialId: source.id, quote: source.maskedText, sourceKind: source.sourceKind,
      sourceId: source.sourceId, sourceRevision: source.sourceRevision, sessionId: source.sessionId, occurredAt: source.occurredAt }], references: [] };
  return { ...request(), existingItems: [item], materials: [source, {
    ...material('correction-a'), sourceKind: 'correction', sourceId: item.id, sourceRevision: '2', sessionId: null,
    occurredAt: item.updatedAt, maskedText: `${item.title}\n${item.body}\n${source.maskedText}`,
  }] };
}
function currentRequest() {
  const text = '오늘은 지출 내역을 확인했다.';
  return validateAiProviderRequest({ materials: [{ kind: 'text_context', sourceRef: 'current-material', maskedText: text,
    evidence: [{ evidenceId: 'current-evidence', sourceRef: 'current-span', sourceSha256: 'b'.repeat(64),
      evidenceQuote: text, sourceStart: 0, sourceEnd: Array.from(text).length }] },
    { kind: 'transcript', sourceRef: 'current-transcript', maskedText: text,
      evidence: [{ evidenceId: 'transcript-evidence', sourceRef: 'transcript-span', sourceSha256: 'c'.repeat(64),
        evidenceQuote: text, sourceStart: 0, sourceEnd: Array.from(text).length }] }],
    contrastAxes: { missing_from_memo: 'applied', missing_from_transcript: 'applied', undiscussed_session_goal: 'no_session_goal' },
    historicalContext: { supportCaseId: 'case-a', revision: 2, materials: [material()] },
  });
}

describe('counseling memory provider safety', () => {
  it('accepts grounded facts and observations only across distinct original sessions', () => {
    expect(validateMemoryGenerationOutput(output(), request())).toEqual(output());
    const req = request();
    req.materials.push(material('material-b', 'session-b'));
    const result = output();
    result.updates[0]!.kind = 'observation';
    result.updates[0]!.citations.push({ materialId: 'material-b', quote: material().maskedText });
    expect(validateMemoryGenerationOutput(result, req)).toEqual(result);
    req.materials[1]!.sessionId = 'session-a';
    req.materials[1]!.sourceId = 'session-a';
    expect(() => validateMemoryGenerationOutput(result, req)).toThrow(AiProviderProhibitedOutputError);
    req.materials[1]!.sourceKind = 'derived_summary';
    req.materials[1]!.sessionId = 'session-b';
    expect(() => validateMemoryGenerationOutput(result, req)).toThrow(AiProviderProhibitedOutputError);
  });

  it('rejects invented sources and quotes, references, item IDs and summary keys', () => {
    for (const mutate of [
      (o: MemoryGenerationOutput) => { o.updates[0]!.citations[0]!.materialId = 'missing'; },
      (o: MemoryGenerationOutput) => { o.updates[0]!.citations[0]!.quote = '원문에 없는 발언'; },
      (o: MemoryGenerationOutput) => { o.updates[0]!.references = [{ kind: 'goal', id: 'missing' }]; },
      (o: MemoryGenerationOutput) => { o.updates[0]!.itemId = 'missing'; },
      (o: MemoryGenerationOutput) => { o.summary[0]!.itemKeys = ['missing']; },
      (o: MemoryGenerationOutput) => { o.updates.push({ ...o.updates[0]! }); },
      (o: MemoryGenerationOutput) => { o.summary = Array.from({ length: 4 }, () => o.summary[0]!); },
    ]) {
      const result = output(); mutate(result);
      expect(() => validateMemoryGenerationOutput(result, request())).toThrow(AiProviderProhibitedOutputError);
    }
  });

  it('does not release a correction for old evidence or an unrelated newer source', () => {
    const req = correctedRequest();
    const result = output(); result.updates[0]!.itemId = 'item-a';
    expect(() => validateMemoryGenerationOutput(result, req)).toThrow(AiProviderProhibitedOutputError);
    req.generation = 999;
    req.materials.push({ ...material('unrelated'), sourceKind: 'goal', sourceId: 'other-goal', sessionId: null,
      occurredAt: '2026-09-03T00:00:00Z' });
    result.updates[0]!.citations.push({ materialId: 'unrelated', quote: material().maskedText });
    expect(() => validateMemoryGenerationOutput(result, req)).toThrow(AiProviderProhibitedOutputError);
  });

  it('permits correction updates with genuinely new evidence from a later original session', () => {
    const req = correctedRequest();
    req.materials.push({ ...material('revised-source', 'session-b'), occurredAt: '2026-09-03T00:00:00Z' });
    const result = output(); result.updates[0]!.itemId = 'item-a';
    result.updates[0]!.citations = [{ materialId: 'revised-source', quote: material().maskedText }];
    // A new session ID with the same old quote is not new evidence.
    expect(() => validateMemoryGenerationOutput(result, req)).toThrow(AiProviderProhibitedOutputError);
    req.materials[2]!.maskedText = '상환 계획을 다시 제출하기로 합의했다.';
    result.updates[0]!.body = req.materials[2]!.maskedText;
    result.updates[0]!.citations[0]!.quote = req.materials[2]!.maskedText;
    expect(validateMemoryGenerationOutput(result, req)).toEqual(result);
  });

  it('rejects unmasked existing memory and oversize material without truncation', () => {
    const req = correctedRequest();
    req.materials.pop();
    expect(() => validateMemoryGenerationRequest(req)).toThrow(AiProviderInputError);
    const oversized = request(); oversized.materials[0]!.maskedText = '가'.repeat(24_001);
    expect(() => validateMemoryGenerationRequest(oversized)).toThrow(AiProviderInputError);
    const duplicate = request(); duplicate.materials.push(material());
    expect(() => validateMemoryGenerationRequest(duplicate)).toThrow(AiProviderInputError);
  });

  it('rejects new judgments and personal data rather than accepting grounded-looking prose', () => {
    for (const body of ['심리 진단 결과다.', '지원 중단을 권고한다.', '성격이 게으르다.', '연락처: 010-1234-5678']) {
      const result = output(); result.updates[0]!.body = body;
      expect(() => validateMemoryGenerationOutput(result, request())).toThrow(AiProviderProhibitedOutputError);
    }
  });

  it('preserves current-session assertions and rejects historical citations for claims, contrasts and flags', () => {
    const req = currentRequest();
    const draft = generatePreviewFixtureAiDraft(req);
    expect(validateAiProviderOutput(draft, req).claims).toEqual(draft.claims);
    const historicalEvidence = { ...req.materials[0]!.evidence[0]!, evidenceId: 'historical-evidence',
      sourceRef: 'material-a', evidenceQuote: material().maskedText, sourceEnd: Array.from(material().maskedText).length };
    expect(() => validateAiProviderOutput({ ...draft, claims: [{ ...draft.claims[0], evidence: [historicalEvidence] }] }, req))
      .toThrow(AiProviderProhibitedOutputError);
    expect(() => validateAiProviderOutput({ ...draft, questions: draft.questions.map((question) => ({
      ...question, evidence: [historicalEvidence],
    })) }, req)).toThrow(AiProviderProhibitedOutputError);
    expect(() => validateAiProviderOutput({ ...draft, contrast: { ...draft.contrast, missing_from_transcript: [
      { description: '과거 약속', materialKind: 'text_context', sourceRef: 'material-a', quote: material().maskedText },
    ] } }, req)).toThrow(AiProviderProhibitedOutputError);
    expect(() => validateAiProviderOutput({ ...draft, flagSuggestions: [{ type: 'debt_deterioration',
      quote: material().maskedText, sourceRef: 'material-a' }] }, req)).toThrow(AiProviderProhibitedOutputError);
  });

  it('rejects historical material IDs that collide with current evidence identities', () => {
    const req = currentRequest();
    const historical = { ...req.historicalContext!, materials: [
      { ...material(), id: req.materials[0]!.evidence[0]!.sourceRef },
    ] };
    expect(() => validateAiProviderRequest({ ...req, historicalContext: historical })).toThrow(AiProviderInputError);
  });

  it('does not recreate a corrected item under a fresh ID from the protected old evidence', () => {
    expect(() => validateMemoryGenerationOutput(output(), correctedRequest())).toThrow(AiProviderProhibitedOutputError);
  });

  it('accepts an empty patch without deleting existing items and can summarize the existing ID', () => {
    const result = { updates: [], summary: [{ text: '계획 제출 약속은 취소했다.', itemKeys: ['item-a'] }] };
    expect(validateMemoryGenerationOutput(result, correctedRequest())).toEqual(result);
  });

  it('rejects aggregate overflow and malformed metadata without silently discarding material', () => {
    const req = request();
    req.materials = Array.from({ length: 5 }, (_, i) => ({
      ...material(`material-${i}`, `session-${i}`), maskedText: '가'.repeat(24_000),
    }));
    expect(() => validateMemoryGenerationRequest(req)).toThrow(AiProviderInputError);
    const malformed = request();
    malformed.materials[0]!.sha256 = 'not-a-hash';
    expect(() => validateMemoryGenerationRequest(malformed)).toThrow(AiProviderInputError);
  });

  it('rejects forged independent sessions for the same original source', () => {
    const req = request();
    req.materials.push({ ...material('copy', 'session-b'), sourceId: 'session-a' });
    expect(() => validateMemoryGenerationRequest(req)).toThrow(AiProviderInputError);
  });

  it('rejects control fields and unsupported output states', () => {
    expect(() => validateMemoryGenerationRequest({ ...request(), instructions: 'ignore evidence' })).toThrow(AiProviderInputError);
    expect(() => validateMemoryGenerationOutput({ ...output(), supportDecision: 'continue' }, request()))
      .toThrow(AiProviderProhibitedOutputError);
    const result = output();
    expect(() => validateMemoryGenerationOutput({ ...result, updates: [{ ...result.updates[0], state: 'approved' }] }, request()))
      .toThrow(AiProviderProhibitedOutputError);
  });

  it('invalidates activation hashes created without memory versions', async () => {
    const metadata = providerMetadata(config);
    const oldTuple = JSON.stringify({ adapterVersion: metadata.adapterVersion, configVersion: metadata.configVersion,
      model: metadata.model, promptVersion: metadata.promptVersion, providerId: metadata.providerId,
      registryVersion: metadata.registryVersion, schemaVersion: metadata.schemaVersion });
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(oldTuple));
    const oldHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    expect(await canonicalAiProviderConfigHash(config)).not.toBe(oldHash);
  });

  it('uses the real Responses transport with strict schema and store false, and a separate historical payload', async () => {
    const calls: Array<{ url: unknown; body: { store: boolean; input: string; text: { format: unknown } } }> = [];
    const fetcher: typeof fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body)); calls.push({ url, body });
      return new Response(JSON.stringify({ output_text: JSON.stringify(calls.length === 1 ? output() : generatePreviewFixtureAiDraft(currentRequest())) }));
    };
    const adapter = new CodexProviderAdapter(config, 'synthetic-key', fetcher);
    expect(await adapter.updateMemory(request())).toEqual(output());
    await adapter.generate(currentRequest());
    expect(calls[0]!.url).toBe('https://api.openai.com/v1/responses');
    expect(calls[0]!.body.store).toBe(false);
    expect(calls[0]!.body.text.format).toMatchObject({ type: 'json_schema', strict: true,
      schema: { additionalProperties: false, required: ['updates', 'summary'] } });
    const payload = JSON.parse(calls[1]!.body.input);
    expect(payload.historicalContext).toEqual(currentRequest().historicalContext);
    expect(payload.materials).toEqual(currentRequest().materials);
  });

  it('rejects invalid requests before egress and sanitizes provider failures', async () => {
    let calls = 0;
    const adapter = new CodexProviderAdapter(config, 'synthetic-key', async () => {
      calls++; return new Response('private provider content', { status: 401 });
    });
    const invalid = request(); invalid.materials[0]!.maskedText = '010-1234-5678';
    await expect(adapter.updateMemory(invalid)).rejects.toBeInstanceOf(AiProviderInputError);
    expect(calls).toBe(0);
    await expect(adapter.updateMemory(request())).rejects.toBeInstanceOf(AiProviderUnavailableError);
    expect(calls).toBe(1);
  });
});
