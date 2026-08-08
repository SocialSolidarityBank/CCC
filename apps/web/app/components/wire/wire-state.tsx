import type { ReactNode } from 'react';
import { WireBadge } from './wire-badge';

// 빈 상태와 오류 알림 (2026-08-09 Q 전수 정리).
//
// 전수 조사에서 이 둘이 얽혀 있었다. `.empty` 클래스 17곳 중 **10곳이 role="alert"** 였다 —
// 같은 옷이 "칸이 비었다"와 "불러오지 못했다"를 함께 입고 있었고, 같은 오류를 다른 화면
// 7곳은 리스크 배지로, 2곳은 인라인 검정 글자로 그리고 있었다. 의미가 셋이면 옷도 셋이어야
// 하는데 옷은 셋인데 의미와 짝이 안 맞은 상태였다.
//
// 이제 짝은 둘뿐이다:
//   * 비었다  → WireEmpty (14/400 --sub 한 줄, role="status")
//   * 실패했다 → WireError (리스크 배지, role="alert")
// 새 화면이 빈 상태나 오류 문장을 손으로 그리지 않는다.

export interface WireEmptyProps {
  children: ReactNode;
  /** 값이 실시간으로 채워지는 자리(검색 결과 등)에만 준다. */
  live?: boolean;
  /**
   * 한 줄이 카드 하나를 통째로 채울 때만 켠다(min-height 92) — 로딩 화면처럼 이 줄이
   * 카드의 유일한 내용이면 얇은 띠가 카드로 읽히지 않는다. 목록·구획 안의 빈 줄에는
   * 쓰지 않는다: 한 카드에 빈 줄이 둘이면 92 × 2 가 통째로 비어 보인다.
   */
  reserve?: boolean;
  /** 테스트 고정용 data-testid. 클래스로 잡던 자리를 부품으로 옮길 때 잇는다. */
  testId?: string;
  className?: string;
}

/**
 * 빈 상태 한 줄 — "아직 없다"를 알린다(§2-2 위계 4단 ④ 설명·메타).
 *
 * `red` **자리를 예약하지 않는다.** 구 `.empty` 는 `min-height:92px` 를 갖고 있었는데,
 * 그 값이 브리핑처럼 한 카드에 빈 줄이 둘 이상 나오는 자리에서는 카드 안이 통째로
 * 비어 보이게 만들어(92 × 2 = 184) 브리핑만 `.briefing-note` 라는 두 번째 규칙을
 * 따로 갖게 된 원인이었다. 높이 예약은 빈 상태의 뜻이 아니라 그 화면 레이아웃의 일이다.
 */
export function WireEmpty({ children, live = false, reserve = false, testId, className }: WireEmptyProps) {
  return (
    <p
      className={['empty', className].filter(Boolean).join(' ')}
      role="status"
      data-testid={testId}
      {...(reserve ? { 'data-reserve': 'true' } : {})}
      {...(live ? { 'aria-live': 'polite' as const } : {})}
    >
      {children}
    </p>
  );
}

export interface WireErrorProps {
  children: ReactNode;
  className?: string;
}

/**
 * 오류 알림 한 줄 — 못 불러왔거나 못 저장했음을 알린다. 리스크 배지 톤이다(§5 risk 톤은
 * 확인된 리스크와 오류 상태 전용, D9 허용 자리).
 *
 * 입력칸 하나에 붙는 검증 오류는 이것이 아니라 `WireFormField` 의 `error` 슬롯이 맡는다
 * (§5 입력칸 계약: 테두리 1.5px + 칸 아래 메시지). 이 부품은 **화면·구획 수준**이다.
 */
export function WireError({ children, className }: WireErrorProps) {
  return (
    <WireBadge tone="risk" role="alert" {...(className === undefined ? {} : { className })}>
      {children}
    </WireBadge>
  );
}
