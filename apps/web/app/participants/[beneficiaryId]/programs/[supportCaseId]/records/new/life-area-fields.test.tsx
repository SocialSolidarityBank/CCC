import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { LifeAreaSnapshotEntry } from '../../../../../../lib/api';
import { LifeAreaFields } from './life-area-fields';

afterEach(cleanup);

describe('LifeAreaFields', () => {
  it('6영역 전부를 렌더하고, 기본값은 변화 없음이다', () => {
    const { container } = render(<LifeAreaFields latest={[]} />);
    const selects = container.querySelectorAll('select');
    expect(selects).toHaveLength(6);
    for (const select of Array.from(selects)) {
      expect((select as HTMLSelectElement).value).toBe('');
      expect(select.getAttribute('name')).toMatch(/^lifeAreaStatus_/);
    }
    // 2026-08-09 Q: 영역 하나가 카드 하나다(구 fieldset+legend 대체 — §2-2 규칙 3).
    expect(container.querySelectorAll('.life-area-card').length).toBe(6);
    // 직전 스냅샷이 없으면 모든 영역이 '미기록'이고, 그 배지는 라벤더(대기 축)다.
    expect((container.textContent ?? '').match(/미기록/g) ?? []).toHaveLength(6);
    expect(container.querySelectorAll('.wire-badge[data-tone="lavender"]').length).toBe(6);
  });

  it('직전 스냅샷이 있으면 영역별 직전 상태를 배지로 표시하고, 위기는 리스크 색(class=risk)을 준다', () => {
    const latest: LifeAreaSnapshotEntry[] = [
      { areaKey: 'economy', status: 'crisis', note: null },
      { areaKey: 'housing', status: 'okay', note: 'STABLE' },
    ];
    const { container } = render(<LifeAreaFields latest={latest} />);
    expect(container.textContent).toContain('위기');
    expect(container.textContent).toContain('괜찮음');
    // 경제(위기)만 리스크 색 배지.
    const riskBadges = container.querySelectorAll('.wire-badge[data-tone="risk"]');
    expect(riskBadges).toHaveLength(1);
    expect((riskBadges[0]?.textContent ?? '')).toContain('위기');
  });
});
