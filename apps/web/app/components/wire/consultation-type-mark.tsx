import { WireMarker, type WireMarkerTone } from '@ccc/wire';
import type { SessionKind } from '../../lib/api';

type ConsultationTypePresentation = {
  readonly label: string;
  readonly tone: WireMarkerTone;
};

// 2026-09-04 Q: 기본상담은 붙여 쓴다. 인테이크와 같은 네 글자라
// 회차 행에서 칸 폭을 강제하지 않고도 두 표시 폭이 같다.
const consultationTypePresentations = {
  regular: { label: '기본상담', tone: 'mint' },
  intake: { label: '인테이크', tone: 'lavender' },
} satisfies Record<SessionKind, ConsultationTypePresentation>;

export function consultationTypeLabel(kind: SessionKind): string {
  return consultationTypePresentations[kind].label;
}

// 2026-09-17 Q(§4-9): 상담 유형은 배지가 아니라 계열색 글자다. 그 회차가 인테이크인지
// 기본 상담인지는 나중에 바뀌지 않는 분류이고, 회차를 고르기 전에 먼저 읽는 값이다.
// 알약으로 두면 핵심 한 줄 앞을 면이 막아 문장 시작선이 밀린다(D47 배지 지정 부분 대체 —
// 계열 의미 민트·라벤더는 그대로다).
export function ConsultationTypeMark({ kind }: { readonly kind: SessionKind }) {
  const presentation = consultationTypePresentations[kind];
  return <WireMarker tone={presentation.tone}>{presentation.label}</WireMarker>;
}
