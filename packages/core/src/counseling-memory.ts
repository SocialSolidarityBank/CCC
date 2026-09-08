import type { MemoryGenerationRequest, MemoryGenerationOutput, MemoryItem, MemorySummaryLine, MemorySource, MemoryMaterial } from '@ccc/contracts/counseling-memory';

export const MEMORY_BATCH_SIZE = 8;
export const MEMORY_CHUNK_SIZE = 24000;
export interface MemoryChunk { start: number; end: number; text: string }
export function memoryChunks(text: string): MemoryChunk[] {
  const points = Array.from(text);
  const chunks: MemoryChunk[] = [];
  for (let start = 0; start < points.length; start += MEMORY_CHUNK_SIZE) {
    const end = Math.min(points.length, start + MEMORY_CHUNK_SIZE);
    chunks.push({ start, end, text: points.slice(start, end).join('') });
  }
  return chunks;
}
export interface MemoryReconciliation { items: MemoryItem[]; changed: MemoryItem[]; summary: MemorySummaryLine[] }
export interface MemorySelectionCandidate { item: MemoryItem; material: MemoryMaterial }
export interface MemorySelectionContext {
  currentSessionId: string;
  goalIds: ReadonlySet<string>;
  unresolvedActionIds: ReadonlySet<string>;
  currentMaskedTexts: readonly string[];
}
const MEMORY_CONTEXT_MATERIAL_LIMIT = 8;
const MEMORY_CONTEXT_TEXT_LIMIT = 96000;
const MEMORY_RELEVANCE_CONTEXT_LIMIT = 12000;
const MEMORY_RELEVANCE_TERM_LIMIT = 64;

function relevanceTerms(texts: readonly string[]): string[] {
  const terms = new Set<string>();
  let remaining = MEMORY_RELEVANCE_CONTEXT_LIMIT;
  for (const text of texts) {
    if (remaining <= 0) break;
    const chars: string[] = [];
    for (const char of text) {
      if (chars.length >= remaining) break;
      chars.push(char);
    }
    const bounded = chars.join('').normalize('NFKC').toLowerCase();
    remaining -= chars.length;
    for (const token of bounded.match(/[\p{L}\p{N}]{2,}/gu) ?? []) {
      if (terms.size >= MEMORY_RELEVANCE_TERM_LIMIT) return [...terms];
      terms.add(token);
    }
  }
  return [...terms];
}
function memoryTextScore(text: string, terms: readonly string[]): number {
  const normalized = text.normalize('NFKC').toLowerCase();
  let score = 0;
  for (const term of terms) if (normalized.includes(term)) score += Math.min(term.length, 8);
  return score;
}

/**
 * Historical context precedence is intentional: current-session goal links,
 * unresolved action links, bounded masked-text relevance, then recency. Only
 * current items survive, and a source touching the current session is never
 * eligible. A final ID tie-break keeps retries identical.
 */
export function selectHistoricalMemoryMaterials(
  candidates: readonly MemorySelectionCandidate[],
  context: MemorySelectionContext,
): MemoryMaterial[] {
  const terms = relevanceTerms(context.currentMaskedTexts);
  const ranked = candidates
    .filter(candidate =>
      candidate.item.state === 'current'
      && candidate.material.sessionId !== context.currentSessionId
      && !candidate.item.sources.some(source => source.sessionId === context.currentSessionId))
    .map((candidate, index) => {
      const goalLinked = candidate.item.references.some(reference =>
        reference.kind === 'goal' && context.goalIds.has(reference.id));
      const actionLinked = candidate.item.references.some(reference =>
        reference.kind === 'action' && context.unresolvedActionIds.has(reference.id));
      const textScore = memoryTextScore(candidate.material.maskedText, terms);
      return {
        candidate,
        index,
        precedence: goalLinked ? 3 : actionLinked ? 2 : textScore > 0 ? 1 : 0,
        textScore,
      };
    })
    .sort((left, right) =>
      right.precedence - left.precedence
      || right.textScore - left.textScore
      || right.candidate.material.occurredAt.localeCompare(left.candidate.material.occurredAt)
      || left.candidate.item.id.localeCompare(right.candidate.item.id)
      || left.candidate.material.id.localeCompare(right.candidate.material.id)
      || left.index - right.index);
  const selected: MemoryMaterial[] = [];
  const itemIds = new Set<string>();
  let textLength = 0;
  for (const entry of ranked) {
    if (itemIds.has(entry.candidate.item.id)) continue;
    const material = entry.candidate.material;
    if (textLength + material.maskedText.length > MEMORY_CONTEXT_TEXT_LIMIT) continue;
    itemIds.add(entry.candidate.item.id);
    selected.push(material);
    textLength += material.maskedText.length;
    if (selected.length >= MEMORY_CONTEXT_MATERIAL_LIMIT) break;
  }
  return selected;
}
const prohibited = /(?:심리\s*진단|성격\s*(?:장애|유형)|지원\s*(?:중단|지속)\s*(?:결정|권고)|GAS\s*[=:])/iu;
export function assertMemoryText(text: unknown, limit = 4000): asserts text is string {
  if (typeof text !== 'string' || !text.trim() || Array.from(text).length > limit || prohibited.test(text)) throw new Error('memory_output_invalid');
}
function hasLaterCorrectionSource(item: MemoryItem, sources: readonly MemorySource[]): boolean {
  return item.correctedAt !== null && sources.some(source =>
    source.sourceKind === 'session'
    && source.sessionId !== null
    && Date.parse(source.occurredAt) > Date.parse(item.correctedAt!)
    && !item.sources.some(prior =>
      prior.sourceId === source.sourceId
      || prior.sessionId === source.sessionId
      || prior.quote.includes(source.quote)
      || source.quote.includes(prior.quote)));
}

export function reconcileMemory(request: MemoryGenerationRequest, output: MemoryGenerationOutput, id: () => string, at: string): MemoryReconciliation {
  if (!output || !Array.isArray(output.updates) || output.updates.length > 32 || !Array.isArray(output.summary) || output.summary.length > 3) throw new Error('memory_output_invalid');
  const existing = new Map(request.existingItems.map(item => [item.id, item]));
  const materials = new Map(request.materials.map(material => [material.id, material]));
  const keys = new Map(request.existingItems.map(item => [item.id, item.id]));
  const touched = new Set<string>();
  const changed: MemoryItem[] = [];
  for (const update of output.updates) {
    if (!update || typeof update.key !== 'string' || !update.key || keys.has(update.key) || (update.kind !== 'fact' && update.kind !== 'observation') || !['current', 'historical', 'conflicting'].includes(update.state)) throw new Error('memory_output_invalid');
    assertMemoryText(update.title, 80); assertMemoryText(update.body, 2000);
    const old = update.itemId === null ? undefined : existing.get(update.itemId);
    if (update.itemId !== null && (!old || touched.has(update.itemId))) throw new Error('memory_output_invalid');
    if (!Array.isArray(update.citations) || !update.citations.length || update.citations.length > 32 || !Array.isArray(update.references) || update.references.length > 32) throw new Error('memory_output_invalid');
    const sources: MemorySource[] = update.citations.map(citation => {
      const material = materials.get(citation.materialId);
      if (!material || typeof citation.quote !== 'string' || !citation.quote.trim() || Array.from(citation.quote).length > 500 || !material.maskedText.includes(citation.quote)) throw new Error('memory_evidence_invalid');
      return { ...citation, sourceKind: material.sourceKind, sourceId: material.sourceId, sourceRevision: material.sourceRevision, sessionId: material.sessionId, occurredAt: material.occurredAt };
    });
    if (update.kind === 'observation' && new Set(sources.filter(source => source.sourceKind === 'session' && source.sessionId !== null).map(source => source.sessionId)).size < 2) throw new Error('memory_evidence_invalid');
    if (old?.correctedAt) {
      const changedContent = update.body !== old.body || update.title !== old.title
        || update.kind !== old.kind || update.state !== old.state
        || JSON.stringify(update.references) !== JSON.stringify(old.references)
        || JSON.stringify(update.citations) !== JSON.stringify(old.sources.map(({ materialId, quote }) => ({ materialId, quote })));
      if (changedContent && !hasLaterCorrectionSource(old, sources)) throw new Error('memory_correction_protected');
    }
    if (!old) {
      for (const protectedItem of request.existingItems) {
        if (protectedItem.correctedAt === null) continue;
        const overlapsProtectedEvidence = protectedItem.title === update.title || sources.some(source =>
          protectedItem.sources.some(prior =>
            (prior.sourceKind === source.sourceKind && prior.sourceId === source.sourceId)
            || prior.quote.includes(source.quote) || source.quote.includes(prior.quote)));
        if (overlapsProtectedEvidence && !hasLaterCorrectionSource(protectedItem, sources)) throw new Error('memory_correction_protected');
      }
    }
    for (const citation of update.citations) {
      const material = materials.get(citation.materialId)!;
      if (material.sourceKind !== 'derived_summary' && material.sourceKind !== 'correction') continue;
      const parent = request.existingItems.find(item => item.id === material.sourceId && String(item.revision) === material.sourceRevision);
      if (!parent) throw new Error('memory_evidence_invalid');
      for (const source of parent.sources) if (!sources.some(prior => prior.materialId === source.materialId && prior.quote === source.quote)) sources.push(source);
    }
    if (sources.length > 32) throw new Error('memory_output_invalid');
    for (const reference of update.references) {
      if (!reference || !['goal', 'action'].includes(reference.kind) || !request.materials.some(material => material.sourceKind === reference.kind && material.sourceId === reference.id) && !old?.references.some(prior => prior.kind === reference.kind && prior.id === reference.id)) throw new Error('memory_reference_invalid');
    }
    const item: MemoryItem = { id: old?.id ?? id(), kind: update.kind, title: update.title, body: update.body, state: update.state, revision: (old?.revision ?? 0) + 1, updatedAt: at, correctedAt: old?.correctedAt ?? null, sources, references: update.references };
    keys.set(update.key, item.id); touched.add(item.id); existing.set(item.id, item); changed.push(item);
  }
  const summary = output.summary.map(line => {
    assertMemoryText(line.text, 500);
    if (!Array.isArray(line.itemKeys) || !line.itemKeys.length) throw new Error('memory_output_invalid');
    const itemIds = line.itemKeys.map(key => {
      const itemId = keys.get(key);
      if (!itemId || existing.get(itemId)?.state === 'historical') throw new Error('memory_output_invalid');
      return itemId;
    });
    return { text: line.text, itemIds: [...new Set(itemIds)] };
  });
  return { items: [...existing.values()], changed, summary };
}
