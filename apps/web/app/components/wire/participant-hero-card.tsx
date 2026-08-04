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
//  ④ 행동 — 우상단 버튼 최대 2개(세컨더리 → 프라이머리, §4-5). 없어도 된다.
//
// 부품은 내용에 무관심하다 — 메타의 성격(맥락 vs PII)이 화면마다 다른 것은
// 계약 위반이 아니라 화면 재량이다.
// 카드 계약(radius 12 · --shadow-soft · --line 1px)은 .surface-card 가 담당한다.

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
  actions,
  className,
}: ParticipantHeroCardProps) {
  const classes = ['page-header', 'surface-card', 'participant-hero-card', className]
    .filter(Boolean)
    .join(' ');
  return (
    <header className={classes}>
      <div className="participant-hero-identity">
        <h1 className="participant-hero-title">
          <ParticipantName name={name} beneficiaryId={beneficiaryId} size={nameSize} />
          {contact !== undefined && contact.length > 0 && (
            <span className="participant-hero-contact">{contact}</span>
          )}
          {stageTag !== undefined && <span className="participant-hero-stage">{stageTag}</span>}
        </h1>
        {meta !== undefined && <p className="participant-hero-meta">{meta}</p>}
      </div>
      {actions !== undefined && <div className="page-actions">{actions}</div>}
    </header>
  );
}
