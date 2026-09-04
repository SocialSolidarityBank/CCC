import type { SessionKind } from '../../lib/api';
import { WireBadge, type WireBadgeSize } from './wire-badge';

type ConsultationTypePresentation = {
  readonly label: string;
  readonly tone: 'mint' | 'lavender';
};

// 2026-09-04 Q: `기본상담` 은 붙여 쓴다. `인테이크` 와 같은 네 글자라 두 배지 폭이
// 62.3 으로 같아져, 회차 행에서 칸 폭을 강제하지 않고도 크기가 통일된다.
const consultationTypePresentations = {
  regular: { label: '기본상담', tone: 'mint' },
  intake: { label: '인테이크', tone: 'lavender' },
} satisfies Record<SessionKind, ConsultationTypePresentation>;

export function consultationTypeLabel(kind: SessionKind): string {
  return consultationTypePresentations[kind].label;
}

export function ConsultationTypeBadge({
  kind,
  size,
}: {
  readonly kind: SessionKind;
  readonly size?: WireBadgeSize;
}) {
  const presentation = consultationTypePresentations[kind];
  return (
    <WireBadge
      tone={presentation.tone}
      {...(size === undefined ? {} : { size })}
    >
      {presentation.label}
    </WireBadge>
  );
}
