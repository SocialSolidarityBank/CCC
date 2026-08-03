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
   * 개인 정보 접힘 칸(2026-08-03 Q). 넘기면 이름 줄이 클릭 가능한 여닫이(summary)가 되고,
   * 이름 **아래**로 연락처·참여 사업 같은 개인 정보 칸이 열린다. 연락처를 메타 줄에
   * 상시 노출하는 대신 이 접힘으로 옮기는 것이 의도다.
   */
  pii?: ReactNode;
  /** 우상단 행동 버튼. 세컨더리 → 프라이머리 순서로 넘긴다(§4-5). */
  actions?: ReactNode;
  className?: string;
}

export function ParticipantHeroCard({
  name,
  beneficiaryId,
  stageTag,
  meta,
  pii,
  actions,
  className,
}: ParticipantHeroCardProps) {
  const classes = ['page-header', 'surface-card', 'participant-hero-card', className]
    .filter(Boolean)
    .join(' ');
  const title = (
    <h1 className="participant-hero-title">
      <ParticipantName name={name} beneficiaryId={beneficiaryId} size="hero" />
      {stageTag !== undefined && <span className="participant-hero-stage">{stageTag}</span>}
    </h1>
  );
  return (
    <header className={classes}>
      <div className="participant-hero-identity">
        {pii === undefined ? title : (
          /* 이름 줄이 곧 여닫이다 — 카드(이름)를 누르면 이름 아래로 개인 정보가 열린다. */
          <details className="participant-hero-pii">
            <summary>
              {title}
              <span aria-hidden="true" className="briefing-card-arrow" />
            </summary>
            <div className="participant-hero-pii-body">{pii}</div>
          </details>
        )}
        {meta !== undefined && <p className="participant-hero-meta">{meta}</p>}
      </div>
      {actions !== undefined && <div className="page-actions">{actions}</div>}
    </header>
  );
}
