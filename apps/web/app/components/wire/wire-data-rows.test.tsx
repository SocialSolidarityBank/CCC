import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { WireDataRow, WireDataRows } from './wire-data-rows';

afterEach(cleanup);

describe('WireDataRows (CCC-81)', () => {
  it('정의 목록 2열(라벨 | 값)로 렌더한다', () => {
    const { container } = render(
      <WireDataRows>
        <WireDataRow label="가족 관계" value="배우자·자녀" />
        <WireDataRow label="주거 형태" value="월세" />
      </WireDataRows>,
    );

    const dl = container.querySelector('dl.wire-data-rows');
    expect(dl).not.toBeNull();
    const rows = [...(dl?.querySelectorAll('div.wire-data-row') ?? [])];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.querySelector('dt')?.textContent).toBe('가족 관계');
    expect(rows[0]?.querySelector('dd')?.textContent).toBe('배우자·자녀');
  });
});