import type { ReactNode } from 'react';
import { WireBadge } from './wire-badge';

/** 오늘, 날짜, 주차, 기한처럼 시간 축을 표시할 때만 쓰는 blue 채움 배지. */
export function TimeAxisBadge({ children }: { readonly children: ReactNode }) {
  return <WireBadge tone="blue">{children}</WireBadge>;
}
