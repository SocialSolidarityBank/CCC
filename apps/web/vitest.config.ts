import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Next.js tsconfig은 jsx: "preserve"라서 vitest(rolldown/oxc)가 JSX를 변환하지 않은 채
  // SSR 파서로 넘겨 파스 에러가 난다. 테스트에서는 automatic 런타임으로 변환하도록 명시한다.
  oxc: {
    jsx: { runtime: 'automatic' },
  },
  test: {
    environment: 'jsdom',
    include: ['app/**/*.test.{ts,tsx}'],
  },
});
