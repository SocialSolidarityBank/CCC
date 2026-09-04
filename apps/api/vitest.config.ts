import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/api/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    // setupD1 의 beforeEach/afterEach 가 miniflare 를 띄우고 템플릿 DB 를 복사한다.
    // 기본 10초는 부하가 걸린 호스트에서 넘겨 무관한 파일이 10.0초 시그니처로 죽는다.
    hookTimeout: 60_000,
  },
});
