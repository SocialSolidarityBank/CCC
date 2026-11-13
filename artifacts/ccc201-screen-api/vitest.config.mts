import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: './artifacts/ccc201-screen-api/.vite',
  test: {
    include: ['artifacts/ccc201-screen-api/runtime.test.ts'],
    environment: 'node',
    testTimeout: 1_200_000,
    hookTimeout: 60_000,
    maxWorkers: 1,
  },
});
