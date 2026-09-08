import { defineConfig } from 'vitest/config';

// 공개 Wire 부품도 클라이언트 빌드와 같은 JSX 변환으로 검사한다.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'build/**/*.test.mjs'],
  },
});
