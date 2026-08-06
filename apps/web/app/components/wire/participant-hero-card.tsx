import type { ReactNode } from 'react';
import { ParticipantName } from './participant-name';

// ParticipantHeroCard — 당사자 중심 화면의 공통 머리 (D38 · DESIGN.md §5).
//
// URL이 특정 당사자를 가리키는 화면(/participants/:id/**)은 전부 이 부품을 단다.
// 고정 1층 + 슬롯 3층:
//  ① 이름 — `이름 (가명 ID)` 한 줄. 항상 있다 (ParticipantName size="hero").
//  ② 상태 태그 — 케이스 1개를 보는 화면(브리핑·기록)에서만 필수다.
//     허브처럼 케이스가 교차하는 화면은 사업마다 active/closed가 달라
//     단일 상태가 없으므로 생략한다.
//  ③ 메타 한 줄 — 최대 1줄. 내용은 화면이 정한다(브리핑=맥락, 허브=연락처).
//     계좌·주소 등 추가 PII는 메타 줄에 올리지 않는다.
//  ④ 행동 — 버튼 줄(세컨더리 → 프라이머리, §4-5). 없어도 된다.
//
// 2026-08-06 Q 개편: **2행 골격이다** — 1행 = 이름·태그·연락처(좌) + 버튼(우), 회색
// --line 풀블리드 구분선 아래 2행 = 메타 한 줄(서브 행). 당사자 카드와 같은 문법이다.
// 구 배치(메타가 이름 아래·버튼과 나란)는 버튼이 3개가 되자 중간 폭에서 메타를 뭉갰다.
// 메타가 없는 화면(허브)은 구분선 없이 1행만 남는다. 좁아지면 1행이 접혀 버튼이 이름
// 아래로 내려가고, 767 미만에서는 버튼이 세로로 쌓인다(기존 모바일 규칙).
//
// 부품은 내용에 무관심하다 — 메타의 성격(맥락 vs PII)이 화면마다 다른 것은
// 계약 위반이 아니라 화면 재량이다.
// 카드 계약(radius 12 · 아웃라인 --line 1px, 그림자 없음: D60)은 .surface-card 가 담당한다.

export interface ParticipantHeroCardProps {
  /** 복호화된 실명. 미기입이면 가명 ID가 대신 제목이 된다(D31 폴백). */
  name: string | null;
  /** 가명 ID(동물 슬러그, D20). */
  beneficiaryId: string;
  /** 화면 상태 태그 문구(예: '상담 준비'). 케이스 1개 화면에서만 넘긴다. */
  stageTag?: string;
  /** 메타 한 줄. 내용은 화면이 정한다. */
  meta?: ReactNode;
  /**
   * 이름 크기(2026-08-04 D59). 허브(당사자 정보)는 h2(18) — 이미 '그 사람' 화면이라
   * 페이지 제목 크기가 과했다. 브리핑·기록 등 케이스 화면은 hero(28) 그대로.
   */
  nameSize?: 'hero' | 'h2';
  /**
   * 이름 옆에 나란히 앉는 연락처(2026-08-04 D59 — 구 개인정보 접힘 대체). 간격을 두고
   * 같은 줄에 선다. 계좌·주소 등 추가 PII 는 여기 올리지 않는다(§5 계약 유지).
   */
  contact?: string;
  /**
   * 가명 ID 를 이름 옆에 표시한다(2026-08-06 Q — 당사자 정보 허브 한정. D59 ② 부분
   * 재개정의 당사자 카드 정보 칸과 같은 표기: 연락처보다 옅은 그레이, 대조용 값).
   */
  showId?: boolean;
  /** 우상단 행동 버튼. 세컨더리 → 프라이머리 순서로 넘긴다(§4-5). */
  actions?: ReactNode;
  className?: string;
}

export function ParticipantHeroCard({
  name,
  beneficiaryId,
  stageTag,
  meta,
  nameSize = 'hero',
  contact,
  showId = false,
  actions,
  className,
}: ParticipantHeroCardProps) {
  const classes = ['page-header', 'surface-card', 'participant-hero-card', className]
    .filter(Boolean)
    .join(' ');
  return (
    <header className={classes}>
      <div className="participant-hero-top">
        <h1 className="participant-hero-title">
          <ParticipantName name={name} beneficiaryId={beneficiaryId} size={nameSize} />
          {/* 이름 폴백이 이미 ID 인 경우(무응답·파기)는 같은 값을 두 번 적지 않는다. */}
          {showId && name !== null && name.length > 0 && (
            <span className="participant-hero-id">{beneficiaryId}</span>
          )}
          {contact !== undefined && contact.length > 0 && (
            <span className="participant-hero-contact">{contact}</span>
          )}
          {stageTag !== undefined && <span className="participant-hero-stage">{stageTag}</span>}
        </h1>
        {actions !== undefined && <div className="page-actions">{actions}</div>}
      </div>
      {meta !== undefined && (
        <>
          <hr className="participant-hero-divider" />
          <p className="participant-hero-meta">{meta}</p>
        </>
      )}
    </header>
  );
}
