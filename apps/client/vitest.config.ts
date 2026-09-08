import { defineConfig } from 'vitest/config';

// 순수 로직만 검사한다. React 렌더 검사는 apps/client 에 아직 의존성이 설치되지 않아
// 이 단계 범위 밖이다(설치 승인 요청은 보고서에 있다).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'build/**/*.test.mjs'],
  },
});
