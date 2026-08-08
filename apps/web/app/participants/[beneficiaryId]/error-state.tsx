import { WireError } from '../../components/wire/wire-state';
import { WireButton } from '../../components/wire/wire-button';
import { GridContainer } from '../../components/wire/grid-container';
import { PageTitle } from '../../components/wire/page-title';

// 당사자 정보 화면의 오류 상태. 서버 컴포넌트(page.tsx)에서 쓰지만,
// jsdom 테스트가 page.tsx 를 직접 import 하면 server-only·next/headers 가
// 해결되지 않아 별도 모듈로 뺐다(CCC-23).

export type ErrorKind = 'authentication_required' | 'access_or_not_found' | 'service_unavailable';

export const errorMessages: Record<ErrorKind, string> = {
  authentication_required: '인증 정보를 확인할 수 없습니다. 다시 로그인한 뒤 당사자 정보를 확인하세요.',
  access_or_not_found: '요청한 당사자 정보를 확인할 수 없습니다. 접근 권한과 주소를 확인하세요.',
  service_unavailable: '당사자 정보를 지금 불러올 수 없습니다. 잠시 후 다시 시도하세요.',
};

export function ErrorState({ kind }: { kind: ErrorKind }) {
  return (
    // 로딩·오류의 제목은 같은 부품이다(2026-08-09) — 클래스 없는 h1 은 UA 기본 굵기 700 이라
    // 로드된 화면(PageTitle 600)과 굵기가 갈렸다.
    <GridContainer as="main" className="page-content">
      <div className="page-header"><PageTitle>당사자 정보</PageTitle></div>
      <WireError>{errorMessages[kind]}</WireError>
      <p><WireButton variant="secondary" href="/participants">당사자 목록으로 돌아가기</WireButton></p>
    </GridContainer>
  );
}
