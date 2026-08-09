import type { ReactNode } from 'react';
import { GridContainer } from './grid-container';
import { PageTitle } from './page-title';
import { WireCard } from './wire-card';
import { WireError } from './wire-state';

// 오류 화면 공용 부품(2026-08-09 Q "당사자 정보 프리뷰 오류 화면" 정정). PageLoading 과
// 같은 셸이다 — DESIGN.md §5 로딩 행 ③ "오류·빈 상태도 같은 셸을 쓴다"가 이미 계약인데,
// 오류만 카드 없이 맨 그리드에 알약 배지로 서 있었다(제목 자리와 여백이 로딩과 어긋났다).
//
// 규칙은 PageLoading 과 나란하다:
// 1. 제목은 로드된 화면과 같은 부품·같은 문자열(PageTitle) — 로딩에서 오류로 넘어갈 때
//    제목이 움직이지 않는다.
// 2. 오류 한 줄은 카드 안에 선다(§4-5). 카드 높이도 로딩과 같은 92 예약이라 로딩 카드가
//    오류 카드로 바뀔 때 화면이 튀지 않는다.
// 3. 복귀 버튼은 카드 아래 한 줄이다 — 빈 상태 화면(브리핑 EmptyState)과 같은 문법.

export interface PageErrorProps {
  /** 로드에 성공했다면 섰을 화면과 **똑같은** 제목 문자열. */
  title: string;
  /** 오류 한 줄. */
  children: ReactNode;
  /** 복귀 버튼 등 다음 행동. 없으면 행동 줄 자체를 그리지 않는다. */
  action?: ReactNode;
}

export function PageError({ title, children, action }: PageErrorProps) {
  return (
    <GridContainer as="main" className="page-content">
      <div className="page-header"><PageTitle>{title}</PageTitle></div>
      <WireCard><WireError reserve>{children}</WireError></WireCard>
      {action !== undefined && <div>{action}</div>}
    </GridContainer>
  );
}
