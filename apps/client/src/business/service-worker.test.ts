import { describe, expect, it, vi } from 'vitest';
import { registerShellWorker } from './service-worker';

interface FakeWorker { state: string; listeners: (() => void)[] }

function fakeNavigator(registration: Record<string, unknown>) {
  return {
    serviceWorker: {
      controller: {},
      register: vi.fn(async () => registration),
    },
  } as unknown as Navigator;
}

describe('정적 셸 워커 등록', () => {
  it('빌드 산출물이 아니면 등록하지 않는다', () => {
    const register = vi.fn();
    vi.stubGlobal('navigator', { serviceWorker: { register, controller: null } });
    registerShellWorker(() => {}, false);
    expect(register).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('설치를 마친 새 워커를 대기 상태로 알리고 강제로 활성화하지 않는다', async () => {
    const installing: FakeWorker & { postMessage: ReturnType<typeof vi.fn>; addEventListener: (name: string, fn: () => void) => void } = {
      state: 'installing', listeners: [], postMessage: vi.fn(),
      addEventListener(name, fn) { if (name === 'statechange') this.listeners.push(fn); },
    };
    const updateFound: (() => void)[] = [];
    const registration = {
      waiting: null,
      installing,
      addEventListener(name: string, fn: () => void) { if (name === 'updatefound') updateFound.push(fn); },
    };
    vi.stubGlobal('navigator', fakeNavigator(registration));
    const seen: boolean[] = [];
    registerShellWorker((state) => seen.push(state.waiting), true);
    await Promise.resolve();
    await Promise.resolve();
    updateFound.forEach((fn) => fn());
    installing.state = 'installed';
    installing.listeners.forEach((fn) => fn());
    expect(seen).toEqual([true]);
    // 강제 활성화 지시를 보내지 않는다. 갱신은 사용자가 다시 열 때 적용된다.
    expect(installing.postMessage).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
