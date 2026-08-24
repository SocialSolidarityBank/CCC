import type { SessionKind } from '../../lib/api';
import { WireBadge, type WireBadgeSize } from './wire-badge';

type ConsultationTypePresentation = {
  readonly label: string;
  readonly tone: 'mint' | 'lavender';
};

const consultationTypePresentations = {
  regular: { label: '기본 상담', tone: 'mint' },
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
