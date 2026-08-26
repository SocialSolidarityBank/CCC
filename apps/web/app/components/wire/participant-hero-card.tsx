import type { ReactNode } from 'react';
import { MetaRow } from './meta-row';
import { ParticipantName, type ParticipantNameSize } from './participant-name';

// ParticipantHeroCard — 당사자 중심 화면의 공통 머리 (D38 · DESIGN.md §5).
//
// URL이 특정 당사자를 가리키는 화면(/participants/:id/**)은 전부 이 부품을 단다.
// 고정 1층 + 슬롯 3층:
//  ① 이름 — 항상 있다. 당사자 정보 허브만 이름 24 뒤에 가명 ID를 하이픈 없이 붙인다.
//  ② 상태 태그 — 케이스 1개를 보는 화면(브리핑·기록)에서만 필수다.
//     허브처럼 케이스가 교차하는 화면은 사업마다 active/closed가 달라
//     단일 상태가 없으므로 생략한다.
//  ③ 정보 한 줄 — 연락처와 화면별 메타. 구분선 아래에 선다.
//     계좌·주소 등 추가 PII는 메타 줄에 올리지 않는다.
//  ④ 행동 — 버튼 줄(세컨더리 → 프라이머리, §4-5). 없어도 된다.
//
// 2행 골격: 1행 = 이름·선택적 ID·태그(좌) + 버튼(우), 회색 --line 풀블리드 구분선
// 아래 2행 = 연락처·메타. 당사자 정보 허브 외 화면에는 ID가 없다.
// 2행에 넣을 것이 없으면 구분선 없이 1행만 남는다. 좁아지면 행동 묶음이 이름 아래로
// 내려가고, 767 이하는 내용 크기의 버튼을 가로로 모아 자연스럽게 줄바꿈한다.
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
  /**
   * 상태 태그 색 계열(D61 ② 개정, CCC-106). 기본은 neutral이다.
   * AI 산출·승인 대기 계열 낱말(D58 ④)에만 lavender를 넘긴다.
   */
  stageTagTone?: 'neutral' | 'lavender' | undefined;
  /** 메타 한 줄. 내용은 화면이 정하고 구분선 아래 정보 행에 선다. */
  meta?: ReactNode;
  /**
   * 연락처(2026-08-04 D59, 구 개인정보 접힘 대체). 구분선 아래 정보 행에 선다.
   * 당사자 정보 허브에서도 제목 행에 올리지 않는다.
   * 계좌·주소 등 추가 PII 는 여기 올리지 않는다(§5).
   */
  contact?: string;
  /**
   * 가명 ID 를 이름 바로 뒤에 표시한다(당사자 정보 허브 한정).
   * D59 ② 부분 재개정의 당사자 카드와 같은 옅은 그레이 대조용 값이다.
   */
  showId?: boolean;
  /** 화면별 의미 슬롯. 데스크톱 24px, 767 이하는 18px 이름 계약을 쓴다. */
  nameSize?: ParticipantNameSize;
  /** 우상단 행동 버튼. 세컨더리 → 프라이머리 순서로 넘긴다(§4-5). */
  actions?: ReactNode;
  className?: string;
}

export function ParticipantHeroCard({
  name,
  beneficiaryId,
  stageTag,
  stageTagTone = 'neutral',
  meta,
  contact,
  showId = false,
  nameSize = 'hero',
  actions,
  className,
}: ParticipantHeroCardProps) {
  const classes = ['page-header', 'surface-card', 'participant-hero-card', className]
    .filter(Boolean)
    .join(' ');
  // 연락처와 메타는 모든 화면에서 구분선 아래 정보 행에 둔다.
  const infoItems: (ReactNode | null)[] = [
    contact !== undefined && contact.length > 0
      ? <span className="participant-hero-contact">{contact}</span>
      : null,
    meta ?? null,
  ];
  const hasInfo = infoItems.some((item) => item !== null);
  return (
    <header className={classes}>
      <div className="participant-hero-top">
        <h1 className="participant-hero-title">
           <ParticipantName name={name} beneficiaryId={beneficiaryId} size={nameSize} />
           {showId && name !== null && name.length > 0 && (
             <span className="participant-hero-inline-item">
               <span className="participant-hero-id">{beneficiaryId}</span>
             </span>
           )}
          {stageTag !== undefined && (
            <span
              className="wire-status-tag"
              data-tone={stageTagTone}
            >
              {stageTag}
            </span>
          )}
        </h1>
        {actions !== undefined && <div className="page-actions">{actions}</div>}
      </div>
      {hasInfo && (
        <>
          <hr className="participant-hero-divider" />
          <p className="participant-hero-meta">
            <MetaRow items={infoItems} />
          </p>
        </>
      )}
    </header>
  );
}
