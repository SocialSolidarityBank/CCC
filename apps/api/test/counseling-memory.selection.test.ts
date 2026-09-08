import { describe, expect, it } from 'vitest';
import type { MemoryItem, MemoryMaterial } from '@ccc/contracts/counseling-memory';
import { selectHistoricalMemoryMaterials, type MemorySelectionCandidate } from '../../../packages/core/src/counseling-memory';

const currentSessionId = 'session-current';

function material(id: string, text: string, occurredAt = '2026-08-01T00:00:00.000Z'): MemoryMaterial {
  return {
    id: `material-${id}`,
    sourceKind: 'derived_summary',
    sourceId: `item-${id}`,
    sourceRevision: '1',
    sessionId: null,
    occurredAt,
    snapshotId: `snapshot-${id}`,
    sha256: 'a'.repeat(64),
    maskedText: text,
  };
}

function candidate(
  id: string,
  text: string,
  options: Partial<Pick<MemoryItem, 'state' | 'references' | 'sources'>> = {},
  occurredAt = '2026-08-01T00:00:00.000Z',
): MemorySelectionCandidate {
  return {
    material: material(id, text, occurredAt),
    item: {
      id: `item-${id}`,
      kind: 'fact',
      title: `기억 ${id}`,
      body: text,
      state: options.state ?? 'current',
      revision: 1,
      updatedAt: occurredAt,
      correctedAt: null,
      sources: options.sources ?? [],
      references: options.references ?? [],
    },
  };
}

function select(candidates: readonly MemorySelectionCandidate[], currentMaskedTexts: readonly string[] = []) {
  return selectHistoricalMemoryMaterials(candidates, {
    currentSessionId,
    goalIds: new Set(['goal-current']),
    unresolvedActionIds: new Set(['action-current']),
    currentMaskedTexts,
  });
}

describe('purpose-aware historical memory selection', () => {
  it('keeps an older text-relevant item despite more than eight recent distractors', () => {
    const distractors = Array.from({ length: 9 }, (_, index) => candidate(
      `recent-${index}`,
      '일반적인 상담 배경',
      {},
      `2026-09-${String(9 - index).padStart(2, '0')}T00:00:00.000Z`,
    ));
    const result = select([
      ...distractors,
      candidate('old-relevant', '주거 지원 서류를 준비하기로 함', {}, '2025-01-01T00:00:00.000Z'),
    ], ['이번 상담은 주거 지원 진행을 확인한다']);

    expect(result.map(item => item.sourceId)).toContain('item-old-relevant');
  });

  it('orders exact current-session goal and unresolved action links before lexical matches', () => {
    const result = select([
      candidate('unrelated', '일반적인 배경', {}, '2026-09-08T00:00:00.000Z'),
      candidate('text', '주거 지원 관련 배경', {}, '2026-08-01T00:00:00.000Z'),
      candidate('action', '서류 제출 약속', { references: [{ kind: 'action', id: 'action-current' }] }, '2025-01-01T00:00:00.000Z'),
      candidate('goal', '주거 목표에 관한 기억', { references: [{ kind: 'goal', id: 'goal-current' }] }, '2024-01-01T00:00:00.000Z'),
    ], ['이번 상담에서 주거 지원을 확인한다']);

    expect(result.slice(0, 3).map(item => item.sourceId)).toEqual(['item-goal', 'item-action', 'item-text']);
  });

  it('excludes historical, conflicting, and current-session-derived items', () => {
    const result = select([
      candidate('historical', '오래된 기억', { state: 'historical' }),
      candidate('conflicting', '충돌하는 기억', { state: 'conflicting' }),
      candidate('current-source', '이번 회차에서 나온 기억', {
        sources: [{ materialId: 'source', quote: '이번 회차', sourceKind: 'session', sourceId: currentSessionId, sourceRevision: '1', sessionId: currentSessionId, occurredAt: '2026-09-08T00:00:00.000Z' }],
      }),
      candidate('safe', '이전 회차의 기억'),
    ], ['이번 회차']);

    expect(result.map(item => item.sourceId)).toEqual(['item-safe']);
  });

  it('uses stable ID ordering for equal-purpose and equal-time candidates', () => {
    const result = select([
      candidate('z-item', '같은 내용', {}, '2026-08-01T00:00:00.000Z'),
      candidate('a-item', '같은 내용', {}, '2026-08-01T00:00:00.000Z'),
    ], ['같은 내용']);

    expect(result.map(item => item.sourceId)).toEqual(['item-a-item', 'item-z-item']);
  });

  it.each([{ textLength: 1, count: 8 }, { textLength: 24000, count: 4 }])(
    'enforces both payload limits for $textLength-unit materials',
    ({ textLength, count }) => {
      const candidates = Array.from({ length: 9 }, (_, index) => candidate(
        `bounded-${index}`,
        '가'.repeat(textLength),
        {},
        `2026-08-${String(index + 1).padStart(2, '0')}T00:00:00.000Z`,
      ));
      const result = select(candidates);
      expect(result).toHaveLength(count);
      expect(result.reduce((length, item) => length + item.maskedText.length, 0)).toBeLessThanOrEqual(96000);
    },
  );
});
