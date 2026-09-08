import type { ReactNode } from 'react';
import { ParticipantName, type ParticipantNameSize } from './participant-name';
import { WireField, type WireFieldTone } from './wire-card';

// 당사자 중심 화면의 공통 머리(D38, DESIGN.md §5).
// 가로선 위에는 이름과 행동만 둔다. 내부 폭 760px 초과는 정보 3열이다.
// 760px 이하는 80px 라벨 행이다. 빈 하단은 구분선과 함께 생략한다.
// 화면별 정보 범위는 유지하며 계좌, 주소 등 추가 개인정보를 노출하지 않는다.

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
  /** 화면에서 이미 제공하던 정보. 빈 값은 호출부가 제외한다. */
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
  details = [],
  nameSize = 'hero',
  actions,
  className,
}: ParticipantHeroCardProps) {
  const classes = ['page-header', 'surface-card', 'participant-hero-card', className]
    .filter(Boolean)
    .join(' ');
  const hasInfo = details.length > 0;
  return (
    <header className={classes}>
      <div className="participant-hero-top">
        <h2 className="participant-hero-title">
          <ParticipantName name={name} beneficiaryId={beneficiaryId} size={nameSize} />
        </h2>
        {actions !== undefined && <div className="page-actions">{actions}</div>}
      </div>
      {hasInfo && (
        <>
          <hr className="participant-hero-divider" />
          <div className="participant-hero-info">
              <div className="participant-hero-details">
                {details.map((detail) => (
                  <WireField key={detail.label} label={detail.label} layout="stack" size="sm"
                    {...(detail.tone === undefined ? {} : { tone: detail.tone })}>
                    {detail.value}
                  </WireField>
                ))}
              </div>
          </div>
        </>
      )}
    </header>
  );
}
