import type { ReactNode } from 'react';

/** 배지 계열(DESIGN.md §5 상태 배지).
 *  neutral = 무채색 기본형, blue = 시간 축(TimeAxisBadge 전용), risk = 확인된 리스크·오류 상태(D9 허용 자리).
 *  나머지 색상은 형제 배지 구분 variation이고 기본 배정 순서는
 *  mint → lavender → coral → cyan → light-magenta 이며 lime·amber 는 최후순위 폴리백이다(2026-08-24 Q 결정).
 *  상담 유형은 기본 상담=mint, 인테이크=lavender로 고정한다.
 *  light-magenta 면은 승인 hex #D96BC8 하나만 쓰고(다크 별도 음영을 만들지 않는다),
 *  그 면 위 글자만 전용 --on-badge-light-magenta 를 써 두 테마에서 대비 6.29 로 기준을 넘는다. */
export type WireBadgeTone =
  | 'neutral'
  | 'blue'
  | 'mint'
  | 'lavender'
  | 'coral'
  | 'amber'
  | 'lime'
  | 'cyan'
  | 'light-magenta'
  | 'risk';

export type WireBadgeSize = 'md' | 'sm';

export interface WireBadgeProps {
  children: ReactNode;
  tone?: WireBadgeTone;
  /** 크기. 기본 md(높이 24·글자 14). sm(높이 20·패딩 8·글자 12)은 당사자 카드 헤더 전용이다. */
  size?: WireBadgeSize;
  /** 상태 알림으로 읽혀야 하는 배지(role="status"·"alert")에만 준다. */
  role?: 'status' | 'alert';
  'aria-live'?: 'polite' | 'assertive';
  /** 테스트 고정용 data-testid. 킷의 다른 부품(WireCard·WireCallout)과 같은 계약이다. */
  testId?: string;
  className?: string;
}

/** 화면 전체의 유일한 배지 부품(2026-08-07 Q 리팩터링).
 *  모양(.wire-badge)은 wire-styles.ts 한 곳이 소유한다. 배지를 새로 그리지 말고
 *  이 부품에 tone 만 골라 쓴다. 눌러서 상태를 바꾸는 태그는 배지가 아니라
 *  컨트롤(.wire-status-tag, radius 6)이다. */
export function WireBadge({ children, tone = 'neutral', size = 'md', role, 'aria-live': ariaLive, testId, className }: WireBadgeProps) {
  return (
    <span
      className={['wire-badge', className].filter(Boolean).join(' ')}
      data-size={size === 'md' ? undefined : size}
      data-tone={tone === 'neutral' ? undefined : tone}
      role={role}
      aria-live={ariaLive}
      data-testid={testId}
    >
      {children}
    </span>
  );
}
