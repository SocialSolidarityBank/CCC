import { defineConfig } from 'vitest/config';

export default defineConfig({
  // packages/wire는 순수 React 부품이라 JSX runtime만 설정하면 된다.
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./test/setup-dom.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
