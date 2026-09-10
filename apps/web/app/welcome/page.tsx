import type { Metadata } from 'next';
import { WelcomePage as PublicWelcomePage } from '@ccc/site/pages';

export const metadata: Metadata = { title: 'CCC 사례관리 소개' };

// 공개 소개만 공유한다. 업무 홈의 계정 설정 기반 리다이렉트는 옮기지 않는다.
// 이 레거시 경로는 검증된 업무 origin을 갖지 않으므로 로그인 링크를 만들지 않는다.
export default function WelcomePage() {
  return <PublicWelcomePage />;
}
