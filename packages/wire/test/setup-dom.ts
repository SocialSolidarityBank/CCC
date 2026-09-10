import { vi } from 'vitest';

// jsdom has no layout engine. Consumer tests still exercise native inputs;
// responsive geometry is verified by the real-browser design harness and smoke checks.
vi.stubGlobal('matchMedia', (media: string) => ({
  media,
  matches: false,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
}));
vi.stubGlobal('ResizeObserver', class {
  observe() {}
  unobserve() {}
  disconnect() {}
});
Object.defineProperty(document, 'fonts', {
  configurable: true,
  value: Object.assign(new EventTarget(), { ready: Promise.resolve() }),
});
