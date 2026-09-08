import { defineConfig } from 'vitest/config';

/**
 * 시드 생성 전용 설정. 오케스트레이터(generate.ts) 하나만 include 한다.
 * 루트/apps 테스트 명령에는 절대 걸리지 않는다 — apps/api config 는 apps/api/test/** 만
 * include 하고, 이 파일은 명시적으로 --config 로 지목해야만 실행된다.
 *
 * 실행(로컬 키):   SEED_PROFILE=preview SEED_TARGET=local PII_ENC_KEY=<base64 32B> pnpm exec vitest run --config scripts/seed/vitest.config.ts
 * 실행(원격 키):   RUNBOOK의 `pnpm seed:generate:preview` 경로 사용.
 */
export default defineConfig({
  test: {
    include: ['scripts/seed/generate.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
    maxWorkers: 1,
    minWorkers: 1,
    fileParallelism: false,
  },
});
