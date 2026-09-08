import { describe, expect, it } from 'vitest';
import { memoryChunks, reconcileMemory } from '../../../packages/core/src/counseling-memory';
import type { MemoryGenerationRequest, MemoryItem, MemoryGenerationOutput } from '@ccc/contracts/counseling-memory';

const item: MemoryItem = { id: 'item-one', kind: 'fact', title: '연락', body: '오후에 연락', state: 'current', revision: 2, updatedAt: '2026-09-08T00:00:00.000Z', correctedAt: '2026-09-08T00:00:00.000Z', references: [], sources: [{ materialId: 'old', quote: '오전 연락', sourceKind: 'session', sourceId: 'session-one', sourceRevision: '1', sessionId: 'session-one', occurredAt: '2026-09-01T00:00:00.000Z' }] };
const request: MemoryGenerationRequest = { supportCaseId: 'case-one', generation: 9, existingItems: [item], materials: [{ id: 'old', sourceKind: 'session', sourceId: 'session-one', sourceRevision: '1', sessionId: 'session-one', occurredAt: '2026-09-01T00:00:00.000Z', snapshotId: 'snapshot-one', sha256: 'a'.repeat(64), maskedText: '오전 연락' }] };
const output: MemoryGenerationOutput = { updates: [{ key: 'change', itemId: item.id, kind: 'fact', title: '연락', body: '오전 연락', state: 'current', citations: [{ materialId: 'old', quote: '오전 연락' }], references: [] }], summary: [] };

describe('counseling memory source boundaries', () => {
  it('cannot undo a correction from identical old evidence after an unrelated generation advances', () => {
    expect(() => reconcileMemory(request, output, () => 'new', '2026-09-09T00:00:00.000Z')).toThrow();
  });
  it('cannot replace a correction by regenerating a newer revision of the same old source', () => {
    const replay = { ...request, materials: request.materials.map(material => ({ ...material, sourceRevision: '2' })) };
    const replacement = { ...output, updates: output.updates.map(update => ({ ...update, itemId: null })) };
    expect(() => reconcileMemory(replay, replacement, () => 'replacement', '2026-09-09T00:00:00.000Z')).toThrow('memory_correction_protected');
  });
  it('cannot change a corrected title while keeping its body and old evidence', () => {
    const replacement = { ...output, updates: output.updates.map(update => ({ ...update, title: '오전 연락 우선', body: item.body })) };
    expect(() => reconcileMemory(request, replacement, () => 'replacement', '2026-09-09T00:00:00.000Z')).toThrow('memory_correction_protected');
  });
  it('does not count regenerated material from one session as two observation sources', () => {
    const uncorrected = { ...request, existingItems: [], materials: [...request.materials, { ...request.materials[0]!, id: 'second', sourceRevision: '2' }] };
    expect(() => reconcileMemory(uncorrected, { updates: [{ ...output.updates[0]!, itemId: null, kind: 'observation', citations: [{ materialId: 'old', quote: '오전 연락' }, { materialId: 'second', quote: '오전 연락' }] }], summary: [] }, () => 'new', '2026-09-09T00:00:00.000Z')).toThrow();
  });
  it('preserves omitted items and rejects summary references to nonexistent items', () => {
    expect(reconcileMemory(request, { updates: [], summary: [] }, () => 'new', '2026-09-09T00:00:00.000Z').items).toEqual([item]);
    expect(() => reconcileMemory(request, { updates: [], summary: [{ text: '없는 내용', itemKeys: ['missing'] }] }, () => 'new', '2026-09-09T00:00:00.000Z')).toThrow();
  });
  it('chunks astral Unicode without losing source positions or trailing text', () => {
    const text = '가'.repeat(23999) + '𐐀' + '끝';
    expect(memoryChunks(text)).toEqual([{ start: 0, end: 24000, text: '가'.repeat(23999) + '𐐀' }, { start: 24000, end: 24001, text: '끝' }]);
  });
});
