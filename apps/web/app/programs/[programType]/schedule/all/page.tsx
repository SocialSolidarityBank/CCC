import { notFound } from 'next/navigation';
import { GridContainer } from '../../../../components/wire/grid-container';
import { PageTitle } from '../../../../components/wire/page-title';
import { WireButton } from '../../../../components/wire/wire-button';
import { isKnownProgramType } from '../../../../lib/labels';

// 사이드바 '전체 일정'(D35 · ADR-0014 §2)의 도착지.
//
// 이 주소는 CCC-18 이 사이드바에 메뉴 자리만 잡아 두고 화면을 만들지 않아 **404 였다** —
// 메뉴를 누르면 오류 화면이 떴다(2026-07-26 Q 보고 · 실측 확인). 여기서는 그 404 만 없앤다.
//
// 화면 내용은 CCC-19 가 정한다. 그 티켓은 아직 '무엇을 만들지'가 미정이라 질문 10개를 먼저
// 닫아야 하고(범위: 기간·필터·지난 상담 포함 여부·달력형 여부), 추측해서 만들면 곧 다시
// 갈아엎게 된다. 그래서 지금은 **빈 상태 계약(DESIGN.md §5)** 으로 정직하게 비워 두고
// 지금 쓸 수 있는 화면으로 보낸다. 데이터를 부르지 않으므로 감사·접근 영향도 없다.

export default async function ProgramScheduleAllPage({
  params,
}: {
  params: Promise<{ programType: string }>;
}) {
  const { programType } = await params;
  if (!isKnownProgramType(programType)) notFound();

  return (
    <main className="page-content">
      <GridContainer>
        <div className="page-header">
          <PageTitle>전체 일정</PageTitle>
          <div className="page-actions">
            <WireButton href="/schedules/new" variant="primary">상담 등록</WireButton>
          </div>
        </div>
        <div className="wire-empty">
          <svg
            className="wire-empty-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            <rect x="3" y="5" width="18" height="16" rx="3" />
            <path d="M3 10h18M8 2v4M16 2v4" />
          </svg>
          <p className="wire-empty-title">전체 일정 화면은 아직 준비 중입니다</p>
          <p className="wire-empty-desc">
            기간을 넓혀 보는 화면을 준비하고 있습니다. 지금은 다가오는 일정에서 오늘과 앞으로 8일치를 볼 수 있습니다.
          </p>
          <WireButton href={`/programs/${programType}/schedule`}>다가오는 일정 보기</WireButton>
        </div>
      </GridContainer>
    </main>
  );
}
