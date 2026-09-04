import type { ReactNode } from 'react';
import { MetaRow } from './meta-row';
import { ParticipantName, type ParticipantNameSize } from './participant-name';
import { WireField, type WireFieldTone } from './wire-card';

// ParticipantHeroCard — 당사자 중심 화면의 공통 머리 (D38 · DESIGN.md §5).
//
// URL이 특정 당사자를 가리키는 화면(/participants/:id/**)은 전부 이 부품을 단다.
// PageTitle이 화면의 h1을 맡고, 이 카드의 당사자 이름은 그 아래 h2로 선다(2026-09-03 Q).
// 고정 1층 + 슬롯 3층:
//  ① 이름: 항상 있다.
//  ② 상태 태그: 케이스 1개를 보는 화면(브리핑·기록)에서만 필수다.
//     허브처럼 케이스가 교차하는 화면은 사업마다 active/closed가 달라 생략한다.
//  ③ 정보: 연락처와 화면별 메타 한 줄, 또는 라벨형 반응형 정보 격자다.
//     당사자 정보 허브는 ID·연락처·이메일을 격자로 보이고, 항목이 늘면 다음 줄로 흐른다.
//     계좌·주소 등 추가 PII는 정보 영역에 올리지 않는다.
//  ④ 행동: 버튼 줄(세컨더리 → 프라이머리, §4-5). 없어도 된다.
//
// 2행 골격: 1행 = 이름·태그(좌) + 버튼(우), 회색 --line 풀블리드 구분선 아래
// 2행 = 정보 한 줄 또는 정보 격자다. 정보가 없으면 구분선 없이 1행만 남는다.
// 좁아지면 행동 묶음이 이름 아래로 내려가고, 정보 격자는 한 열이 된다.
//
// 부품은 내용에 무관심하다 — 메타의 성격(맥락 vs PII)이 화면마다 다른 것은
// 계약 위반이 아니라 화면 재량이다.
// 카드 계약(radius 12 · 아웃라인 --line 1px, 그림자 없음: D60)은 .surface-card 가 담당한다.

export interface ParticipantHeroDetail {
  /** 짧은 읽기 전용 정보 라벨. 같은 HERO 안에서 중복하지 않는다. */
  label: string;
  value: ReactNode;
  /** 정보 라벨의 의미색. 연락 정보는 mint, 시간 정보는 blue를 쓴다. */
  tone?: WireFieldTone;
}

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
   * 연락처. 구분선 아래 정보 행에 선다. 라벨형 격자를 쓰는 허브는 details에 넣는다.
   * 계좌·주소 등 추가 PII는 여기 올리지 않는다(§5).
   */
  contact?: string;
  /**
   * 라벨형 반응형 정보 격자. 당사자 정보 허브의 ID·연락처·이메일과 이후 추가 값을 받는다.
   * 빈 값은 호출부가 제외하며, 항목 수에 따라 다음 줄로 자동 배치한다.
   */
  details?: readonly ParticipantHeroDetail[];
  /** 화면별 이름 의미 슬롯. hero·hub는 모든 폭에서 18/600 계약을 쓴다. */
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
  details = [],
  nameSize = 'hero',
  actions,
  className,
}: ParticipantHeroCardProps) {
  const classes = ['page-header', 'surface-card', 'participant-hero-card', className]
    .filter(Boolean)
    .join(' ');
  const metaItems: (ReactNode | null)[] = [
    contact !== undefined && contact.length > 0
      ? <span className="participant-hero-contact">{contact}</span>
      : null,
    meta ?? null,
  ];
  const hasMeta = metaItems.some((item) => item !== null);
  const hasInfo = details.length > 0 || hasMeta;
  return (
    <header className={classes}>
      <div className="participant-hero-top">
        <h2 className="participant-hero-title">
          <ParticipantName name={name} beneficiaryId={beneficiaryId} size={nameSize} />
          {stageTag !== undefined && (
            <span
              className="wire-status-tag"
              data-tone={stageTagTone}
            >
              {stageTag}
            </span>
          )}
        </h2>
        {actions !== undefined && <div className="page-actions">{actions}</div>}
      </div>
      {hasInfo && (
        <>
          <hr className="participant-hero-divider" />
          {details.length > 0 && (
            <div className="participant-hero-details">
              {details.map((detail) => (
                <WireField key={detail.label} label={detail.label} layout="stack" size="sm"
                  {...(detail.tone === undefined ? {} : { tone: detail.tone })}>
                  {detail.value}
                </WireField>
              ))}
            </div>
          )}
          {hasMeta && (
            <p className="participant-hero-meta">
              <MetaRow items={metaItems} />
            </p>
          )}
        </>
      )}
    </header>
  );
}
