import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 워크스페이스 패키지는 .ts 소스를 그대로 export 한다. Next 가 트랜스파일해야 한다.
  transpilePackages: ['@ccc/contracts'],
};

export default nextConfig;
