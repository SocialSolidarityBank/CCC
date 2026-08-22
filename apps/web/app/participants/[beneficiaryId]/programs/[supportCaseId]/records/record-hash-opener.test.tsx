import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { RecordHashOpener } from './record-hash-opener';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('RecordHashOpener', () => {
  it('Next 경로 전환이 마운트 뒤 해시를 붙여도 대상 회차를 펼친다', () => {
    window.history.replaceState(null, '', '/records');
    const frameCallbacks: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameCallbacks.push(callback);
      return frameCallbacks.length;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    const { container } = render(<>
      <RecordHashOpener />
      <details id="record-session-old"><summary>과거 회차</summary></details>
    </>);
    const target = container.querySelector('#record-session-old') as HTMLDetailsElement;
    target.scrollIntoView = vi.fn();
    expect(target.open).toBe(false);

    window.history.replaceState(null, '', '/records#record-session-old');
    for (const callback of frameCallbacks) callback(0);

    expect(target.open).toBe(true);
    expect(target.scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
  });
});
