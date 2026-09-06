import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { AdminSidebar } from '../components/wire/admin-sidebar';
import { GridContainer } from '../components/wire/grid-container';
import { WireError } from '../components/wire/wire-state';
import { ApiError, getMyIdentity, type MyRole } from '../lib/api';
import { adminMenuFor } from './admin-format';

// 관리자 영역 공통 레이아웃(재개편 T8, #38): 가로 탭 + 콘텐츠.
// 탭은 내 역할의 합만큼만 그린다(ADR-0044 결정 7, D74). 탭이 하나도 없으면 /admin 은 404 다.
// 모든 API 는 게이트웨이에서 역할을 다시 강제한다(R1). 화면 필터는 안내이지 방어가 아니다.
export default async function AdminLayout({ children }: { children: ReactNode }) {
  let roles: MyRole[] = [];
  try {
    roles = (await getMyIdentity()).roles;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return (
      <main className="page-content">
        <GridContainer>
          <WireError>관리자 정보를 확인할 수 없습니다. 다시 로그인한 뒤 시도하세요.</WireError>
        </GridContainer>
      </main>
    );
  }

  const items = adminMenuFor(roles);
  if (items.length === 0) notFound();

  // CCC-18a: 관리자 2차 내비는 좌측 컬럼이 아니라 **가로 탭**이다. 셸 사이드바(240px) 옆에
  // 335px 컬럼이 또 서면 내비 기둥이 두 개가 되어 D35 의 "사이드바 = 장소" 축이 흐려진다.
  return (
    <main className="page-content">
      <GridContainer className="wire-admin-layout">
        <AdminSidebar items={items} />
        <div className="wire-admin-content">{children}</div>
      </GridContainer>
    </main>
  );
}
