import type { ReactNode } from 'react';

export interface WireCardProps {
  children: ReactNode;
  /** 카드 상단 타이틀. 있으면 아래 그라데이션 1px 구분선이 붙는다. */
  title?: ReactNode;
  /** 카드가 독립적인 글 한 편이면 article, 페이지의 한 구획이면 section 으로 낸다. 기본 div. */
  as?: 'div' | 'article' | 'section';
  /** 카드 이름을 짚어 주는 요소 id. as 를 함께 주지 않으면 랜드마크가 생기지 않는다. */
  labelledBy?: string;
  className?: string;
}

/** 카드 계약(DESIGN.md §5): 흰 배경 · radius 12 · **회색 --line 1px** · --shadow-soft.
 *  그라데이션 테두리는 선택·활성 표면과 리스크 배너 전용이다(2026-07-26 정정 — 모든 카드에
 *  두르면 리스크 배너가 다른 카드와 구별되지 않는다, D9).
 *  헤더와 본문 사이 구분선은 그라데이션 1px 그대로다. */
export function WireCard({ children, title, as: Tag = 'div', labelledBy, className }: WireCardProps) {
  const classes = ['surface-card', 'wire-card', className].filter(Boolean).join(' ');
  return (
    <Tag className={classes} aria-labelledby={labelledBy}>
      {title !== undefined && (
        <>
          {/* p 가 아니라 div 다 — 타이틀에 제목·배지 같은 블록 조각이 들어온다. */}
          <div className="wire-card-title">{title}</div>
          <hr className="wire-card-divider" />
        </>
      )}
      <div className="wire-card-body">{children}</div>
    </Tag>
  );
}

export interface WireFieldProps {
  label: ReactNode;
  children: ReactNode;
}

/** 정보 필드(§5): 라벨 14/700 민트 deep + 값 16 --ink. 라벨은 고정폭. */
export function WireField({ label, children }: WireFieldProps) {
  return (
    <div className="wire-field-row">
      <span className="wire-field-label">{label}</span>
      <span className="wire-field-value">{children}</span>
    </div>
  );
}

export interface WireBulletsProps {
  items: ReactNode[];
}

/** 불릿 리스트. */
export function WireBullets({ items }: WireBulletsProps) {
  return (
    <ul className="wire-bullets">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
