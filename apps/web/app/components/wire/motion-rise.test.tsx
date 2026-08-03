// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MotionRise } from './motion-rise';

vi.mock('next/navigation', () => ({ usePathname: () => '/participants' }));

/** jsdom 에는 IntersectionObserver 가 없다 — 콜백을 붙잡아 교차를 손으로 발화한다.
 *  브라우저 실검증은 패널이 숨겨지면 Chromium 이 IO 콜백을 멈춰 불가능했다(2026-08-03),
 *  그래서 이 테스트가 떠오름 배선의 결정론적 증거다. */
class FakeObserver {
  static instance: FakeObserver | null = null;
  callback: IntersectionObserverCallback;
  observed: Element[] = [];
  unobserved: Element[] = [];
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeObserver.instance = this;
  }
  observe(target: Element) { this.observed.push(target); }
  unobserve(target: Element) { this.unobserved.push(target); }
  disconnect() {}
}

describe('MotionRise (§6 떠오름 · CCC-53)', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', FakeObserver as unknown as typeof IntersectionObserver);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: false }));
    document.body.innerHTML = '<main class="page-content"><section id="a"></section><section id="b"></section></main>';
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
    FakeObserver.instance = null;
  });

  it('본문 직속 자식을 관찰하고, 교차한 것에만 .motion-rise 를 1회 붙인 뒤 관찰을 푼다', () => {
    render(<MotionRise />);
    const observer = FakeObserver.instance;
    expect(observer).not.toBeNull();
    expect(observer?.observed.map((el) => el.id)).toEqual(['a', 'b']);

    const a = document.getElementById('a');
    observer?.callback(
      [{ target: a, isIntersecting: true } as unknown as IntersectionObserverEntry,
       { target: document.getElementById('b'), isIntersecting: false } as unknown as IntersectionObserverEntry],
      observer as unknown as IntersectionObserver,
    );
    expect(a?.classList.contains('motion-rise')).toBe(true);
    expect(document.getElementById('b')?.classList.contains('motion-rise')).toBe(false);
    // 1회 상한: 교차한 요소는 관찰이 풀린다 — 스크롤할 때마다 다시 뜨지 않는다(§6).
    expect(observer?.unobserved.map((el) => el.id)).toEqual(['a']);
  });

  it('움직임 줄이기가 켜져 있으면 관찰 자체를 생략한다', () => {
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    render(<MotionRise />);
    expect(FakeObserver.instance).toBeNull();
  });
});
