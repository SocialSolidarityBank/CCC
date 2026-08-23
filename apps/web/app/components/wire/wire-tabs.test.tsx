import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { WireTab, WireTabs } from './wire-tabs';

afterEach(cleanup);

describe('WireTabs (CCC-83)', () => {
  it('tablist/tab 역할과 aria-selected 를 고정한다', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <WireTabs>
        <WireTab active onSelect={() => onSelect(0)}>전사 대조</WireTab>
        <WireTab active={false} onSelect={() => onSelect(1)}>화자 매핑</WireTab>
      </WireTabs>,
    );

    const tablist = container.querySelector('[role="tablist"].wire-tabs');
    expect(tablist).not.toBeNull();
    const tabs = [...(tablist?.querySelectorAll('button[role="tab"]') ?? [])];
    expect(tabs).toHaveLength(2);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('false');

    fireEvent.click(tabs[1]!);
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});