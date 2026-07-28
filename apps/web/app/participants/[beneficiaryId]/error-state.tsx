import Link from 'next/link';
import { GridContainer } from '../../components/wire/grid-container';

// 참여자 정보 화면의 오류 상태. 서버 컴포넌트(page.tsx)에서 쓰지만,
// jsdom 테스트가 page.tsx 를 직접 import 하면 server-only·next/headers 가
// 해결되지 않아 별도 모듈로 뺐다(CCC-23).

export type ErrorKind = 'authentication_required' | 'access_or_not_found' | 'service_unavailable';

export const errorMessages: Record<ErrorKind, string> = {
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 참여자 정보를 확인하세요.',
  access_or_not_found: '요청한 참여자 정보를 확인할 수 없습니다. 접근 권한과 주소를 확인하세요.',
  service_unavailable: '참여자 정보를 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.',
};

export function ErrorState({ kind }: { kind: ErrorKind }) {
  return (
    <main className="page-content">
      <GridContainer>
        <div className="page-header"><div><h1>참여자 정보</h1></div></div>
        <p className="status risk" role="alert">{errorMessages[kind]}</p>
        <p><Link href="/participants">참여자 목록으로 돌아가기</Link></p>
      </GridContainer>
    </main>
  );
}
