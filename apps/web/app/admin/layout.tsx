import type { ReactNode } from 'react';
import { AdminSidebar } from '../components/wire/admin-sidebar';
import { GridContainer } from '../components/wire/grid-container';
import { ApiError, getMyIdentity } from '../lib/api';

// 관리자 영역 공통 레이아웃(재개편 T8, #38): 좌측 AdminSidebar + 우측 콘텐츠.
// 접근 통제는 admin 역할만(D25 — 기관 관리자 역할은 현행 admin 이 수행). 비관리자는 콘텐츠를
// 렌더하지 않고 403 안내만 보여준다. 모든 API 는 게이트웨이에서 assertAdmin 을 다시 강제한다(R1).
export default async function AdminLayout({ children }: { children: ReactNode }) {
  let role: string | null = null;
  let unavailable = false;
  try {
    role = (await getMyIdentity()).role;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    unavailable = true;
  }

  if (role !== 'admin') {
    return (
      <main className="page-content">
        <GridContainer>
          <p className="empty" role="alert">
            {unavailable
              ? '관리자 정보를 확인할 수 없습니다. 다시 로그인한 뒤 시도하세요.'
              : '이 영역은 기관 관리자만 접근할 수 있습니다.'}
          </p>
        </GridContainer>
      </main>
    );
  }

  // CCC-18a: 관리자 2차 내비는 좌측 컬럼이 아니라 **가로 탭**이다. 셸 사이드바(240px) 옆에
  // 335px 컬럼이 또 서면 내비 기둥이 두 개가 되어 D35 의 "사이드바 = 장소" 축이 흐려진다.
  return (
    <main className="page-content">
      <GridContainer className="wire-admin-layout">
        <AdminSidebar />
        <div className="wire-admin-content">{children}</div>
      </GridContainer>
    </main>
  );
}
