import { defineConfig } from 'vitest/config';

// CCC-201 variant probe only — deliberately excludes runtime.test.ts so this config
// never re-runs the long collection.
export default defineConfig({
  cacheDir: './artifacts/ccc201-screen-api/.vite-variants',
  test: {
    include: ['artifacts/ccc201-screen-api/variants.test.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 60_000,
    maxWorkers: 1,
  },
});
