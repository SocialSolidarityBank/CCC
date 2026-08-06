import type { ReactNode } from 'react';

/** 배지 계열(DESIGN.md §5 상태 배지, D58 ④ 계열 의미 고정).
 *  neutral = 무채색 기본형, blue = 일정·유형·정보, mint = 진행·상태·담당(사람),
 *  lavender = AI·승인 대기, risk = 확인된 리스크·오류 상태(D9 허용 자리). */
export type WireBadgeTone = 'neutral' | 'blue' | 'mint' | 'lavender' | 'risk';

export interface WireBadgeProps {
  children: ReactNode;
  tone?: WireBadgeTone;
  /** 상태 알림으로 읽혀야 하는 배지(role="status"·"alert")에만 준다. */
  role?: 'status' | 'alert';
  'aria-live'?: 'polite' | 'assertive';
  className?: string;
}

/** 화면 전체의 유일한 배지 부품(2026-08-07 Q 리팩터링).
 *  모양(.wire-badge)은 wire-styles.ts 한 곳이 소유한다. 배지를 새로 그리지 말고
 *  이 부품에 tone 만 골라 쓴다. 눌러서 상태를 바꾸는 태그는 배지가 아니라
 *  컨트롤(.wire-status-tag, radius 6)이다. */
export function WireBadge({ children, tone = 'neutral', role, 'aria-live': ariaLive, className }: WireBadgeProps) {
  return (
    <span
      className={['wire-badge', className].filter(Boolean).join(' ')}
      data-tone={tone === 'neutral' ? undefined : tone}
      role={role}
      aria-live={ariaLive}
    >
      {children}
    </span>
  );
}
