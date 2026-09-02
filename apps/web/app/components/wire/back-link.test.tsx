import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const router = vi.hoisted(() => ({ back: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));

const { BackLink } = await import('./back-link');
const layoutSource = readFileSync(resolve(process.cwd(), 'app/layout.tsx'), 'utf8');

afterEach(cleanup);
beforeEach(() => {
  router.back.mockClear();
  router.push.mockClear();
});

/** jsdom 의 history.length 는 읽기 전용이라 값을 갈아끼워 두 경우를 만든다. */
function setHistoryLength(length: number): void {
  Object.defineProperty(window.history, 'length', { value: length, configurable: true });
}

describe('BackLink (2026-07-31)', () => {
  it('히스토리가 있으면 브라우저 뒤로가기와 같은 일을 한다', () => {
    setHistoryLength(3);
    const { container } = render(<BackLink />);
    fireEvent.click(container.querySelector('.page-back') as HTMLElement);
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });

  it('돌아갈 곳이 없으면 버튼 자체를 그리지 않는다', () => {
    // 링크를 직접 열었거나 새 탭에서 시작한 경우다(외부 검토자가 링크를 받아 여는 상황).
    // 홈으로 보내면 안 된다 — '/' 는 일정으로 **리다이렉트**하는 경로라 리다이렉트로 도착한
    // 그 화면으로 되돌아와, 눌러도 아무 일이 없는 것처럼 보인다.
    setHistoryLength(1);
    const { container } = render(<BackLink />);
    expect(container.querySelector('.page-back')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('링크가 아니라 버튼이다 — 되돌리기는 갈 곳이 정해진 이동이 아니다', () => {
    setHistoryLength(3);
    const { container } = render(<BackLink />);
    const control = container.querySelector('.page-back');
    expect(control?.tagName).toBe('BUTTON');
    expect(control?.getAttribute('type')).toBe('button');
    expect(control?.textContent).toContain('뒤로');
  });

  it('뒤로 방향도 공용 12px 꺽쇠 한 벌을 쓴다', () => {
    setHistoryLength(3);
    const { container } = render(<BackLink />);
    expect(container.querySelector('.page-back .wire-chevron[data-dir="left"]')).not.toBeNull();
    expect(container.querySelector('.page-back .wire-icon')).toBeNull();
  });

  it('뒤로가기 버튼도 전역 버튼처럼 알약 반경을 쓴다', () => {
    expect(layoutSource).toMatch(
      /\.page-back\{[^}]*border-radius:var\(--radius-pill\)/,
    );
  });
});
