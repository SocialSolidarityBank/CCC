import type { ReactNode, ToggleEvent } from 'react';
import { DisclosureChevron } from './chevron';

// 카드 계약(2026-08-05 Q 개정 · ADR-0030): **아웃라인 카드**다 — 그림자가 아니라 선이 경계를
// 만든다(Infisical·Cloudflare·Vercel·Supabase 레퍼런스). 기본은 회색 --line 1px, 선택·활성만
// --gradient-brand 1px. 그림자는 떠 있는 층(모달·팝오버·스티키)만 쓴다.
// 본문 구획은 전부 이 컴포넌트를 거친다 — 손으로 만든 카드 div 는 여백이 제각각이 된다
// (2026-08-05 Q "컴포넌트화를 안 해서 여백 관리가 어려움").

/** 콜아웃(안내줄) 톤 3종. 값은 D34 계열 의미 고정을 따른다. */
export type WireCardTone = 'info' | 'mint' | 'lavender';

export interface WireCardProps {
  children: ReactNode;
  /** 카드 상단 타이틀. 있으면 아래 그라데이션 1px 구분선이 붙는다. */
  title?: ReactNode;
  /** 카드가 독립적인 글 한 편이면 article, 페이지의 한 구획이면 section, 이동 목차면 nav 로
   *  낸다(2026-08-09 기록지 바로가기). 기본 div. */
  as?: 'div' | 'article' | 'section' | 'nav';
  /** 카드 이름을 짚어 주는 요소 id. as 를 함께 주지 않으면 랜드마크가 생기지 않는다. */
  labelledBy?: string;
  /**
   * 안내줄 변형(D59 ② 강조 컨테이너). 'info' = 블루 tint 면(시간·상태 축, D34),
   * 'mint' = 사람·소속, 'lavender' = 주의·대기(색 규율 5 — 2026-08-07 콜아웃 확정으로 추가).
   * 리스크 어휘(--risk 테두리)는 배너 전용이라 여기 없다(D9).
   */
  tone?: WireCardTone;
  /** 테스트 고정용 data-testid. 컴포넌트화 전 손 카드가 쓰던 값을 그대로 잇는다. */
  testId?: string;
  /** aria-live 안내 카드(role="status" 등)를 카드 요소 자체에 얹을 때. */
  role?: string;
  className?: string;
}

/** 카드 계약(DESIGN.md §5): 흰 배경 · radius 12 · **회색 --line 1px** · 그림자 없음.
 *  그라데이션 테두리는 선택·활성 표면과 리스크 배너 전용이다(2026-07-26 정정 — 모든 카드에
 *  두르면 리스크 배너가 다른 카드와 구별되지 않는다, D9).
 *  헤더와 본문 사이 구분선은 그라데이션 1px 그대로다. */
export function WireCard({ children, title, as: Tag = 'div', labelledBy, tone, testId, role, className }: WireCardProps) {
  const classes = ['surface-card', 'wire-card', className].filter(Boolean).join(' ');
  return (
    <Tag className={classes} aria-labelledby={labelledBy} data-tone={tone} data-testid={testId} role={role}>
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

export interface WireCardDetailsProps {
  children: ReactNode;
  /** 접힘 줄에 남는 카드 제목. */
  title: ReactNode;
  /** 제목 오른쪽(화살표 앞)에 앉는 배지·부속. */
  badge?: ReactNode | undefined;
  /** 기본 펼침 여부. 네이티브 details 라 이후 상태는 브라우저가 갖는다. */
  open?: boolean | undefined;
  /** 앵커 이동·일괄 토글의 대상 id. */
  id?: string | undefined;
  /**
   * 여닫힘을 바깥 상태와 맞춰야 할 때만 쓴다(기록지 위기·안전 칸: 6영역에서 '위기'를 고르면
   * 자동으로 펼쳐지고, 실무자가 닫으면 그 사실을 화면이 알아야 한다). 네이티브 details 라
   * 이 값을 주지 않으면 여닫힘은 그대로 브라우저가 갖는다.
   */
  onToggle?: ((event: ToggleEvent<HTMLDetailsElement>) => void) | undefined;
  testId?: string | undefined;
  className?: string | undefined;
}

/** 접힘 카드 — 브리핑 3영역·미해결 액션이 쓴다(2026-08-05 카드화, 구 플랫 아코디언).
 *  네이티브 details 위에 카드 계약을 얹은 것이라 '전체 접기'(details.open 일괄 토글)와
 *  앵커 진입이 그대로 동작한다. 펼친 카드가 곧 활성이라 그라데이션 테두리는
 *  .surface-card[open] 규칙이 이미 갖는다(D47과 같은 어휘). */
export function WireCardDetails({ children, title, badge, open, id, onToggle, testId, className }: WireCardDetailsProps) {
  const classes = ['surface-card', 'wire-card', 'wire-card-details', className].filter(Boolean).join(' ');
  return (
    <details className={classes} open={open} id={id} onToggle={onToggle} data-testid={testId}>
      <summary className="wire-card-summary">
        <span className="wire-card-title">{title}</span>
        <span className="wire-card-summary-right">
          {badge}
          <DisclosureChevron />
        </span>
      </summary>
      <div className="wire-card-body">{children}</div>
    </details>
  );
}

export type WireFieldLayout = 'row' | 'stack';
export type WireFieldTone = 'mint' | 'blue' | 'sub';
export type WireFieldSize = 'md' | 'sm';

export interface WireFieldProps {
  readonly label: ReactNode;
  readonly children: ReactNode;
  readonly layout?: WireFieldLayout;
  readonly tone?: WireFieldTone;
  /** 값 크기. 기본 md(16). sm 은 라벨과 같은 14 로 내려 제목과의 대비를 키운다. */
  readonly size?: WireFieldSize;
  readonly compact?: boolean;
  readonly truncate?: boolean;
}

/** 정보 필드: 라벨 14/600 + 값 16/400. 기본은 고정폭 가로형이고 필요하면 간격·넘침만 명시한다. */
export function WireField({
  label,
  children,
  layout = 'row',
  tone = 'mint',
  size = 'md',
  compact = false,
  truncate = false,
}: WireFieldProps) {
  return (
    <div
      className="wire-field-row"
      data-compact={compact ? 'true' : undefined}
      data-layout={layout === 'row' ? undefined : layout}
      data-size={size === 'md' ? undefined : size}
      data-tone={tone === 'mint' ? undefined : tone}
      data-truncate={truncate ? 'true' : undefined}
    >
      <span className="wire-field-label">{label}</span>
      <span className="wire-field-value">{children}</span>
    </div>
  );
}

export interface WireBulletsProps {
  items: ReactNode[];
  /** 크기·색을 자리에 맞추는 덧클래스(예: 콜아웃 본문의 .notice-list). 기하는 그대로 둔다. */
  className?: string;
}

/** 불릿 리스트. 불릿은 **항목이 2개 이상일 때만** 쓴다(2026-08-07 Q 불릿 규칙 신설) —
 *  한 항목뿐이면 목록이 아니라 문장이므로 불릿 없는 본문 한 줄로 그린다. 이 부품을 쓰는
 *  모든 카드(브리핑 세션 목표·맞춤형 질문, 일정 위저드 등)에 같은 규칙이 적용된다. */
export function WireBullets({ items, className }: WireBulletsProps) {
  if (items.length === 1) {
    return <p className={['wire-bullets-single', className].filter(Boolean).join(' ')}>{items[0]}</p>;
  }
  return (
    <ul className={['wire-bullets', className].filter(Boolean).join(' ')}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
