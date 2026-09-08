import type { NextConfig } from 'next';

// 로컬 프리뷰를 localhost 밖(예: 테일넷 IP·MagicDNS)에서 열 때 Next 16 dev 서버가 /_next/*
// 자산을 403 으로 막는다(allowedDevOrigins). 호스트 목록은 레포에 박지 않고 CCC_DEV_ORIGINS
// (쉼표 구분)로 받는다. 운영 빌드에는 영향이 없다(dev 전용 옵션).
const devOrigins = (process.env.CCC_DEV_ORIGINS ?? '').split(',').map((s) => s.trim()).filter((s) => s.length > 0);

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // 워크스페이스 패키지는 .ts 소스를 그대로 export 한다. Next 가 트랜스파일해야 한다.
  transpilePackages: ['@ccc/contracts'],
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
};

export default nextConfig;
