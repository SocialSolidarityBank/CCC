import type { ReactNode } from 'react';

// 값 앞 표시(2026-09-17 Q · DESIGN.md §4-9). 배지는 값 뒤에 붙어 그 값의 상태·분류·건수를
// 말하는 알약이고, 값보다 먼저 읽혀야 하는 표시는 알약이 아니라 계열색 글자다.
//
// 가르는 기준은 뜻이다(Q 기준 3 + 판정 한 줄):
//   ① 상태·판정(동사·형용사류)      → 배지  예) 진행 중, 완료, 연결됨, 자격 없음
//   ② 닫힌 선택지에서 고른 하나      → 배지  예) 괜찮음·긴장·위기, 담당 실무자·당사자·기관
//   ③ 수량                          → 배지  예) 3건, 필수 3/3
//   ④ 시간 축                       → 배지  예) 오늘, 기한 2026-09-17 (TimeAxisBadge 전용)
//   ⑤ 필수 표식                     → 배지  (WireRequiredMarker)
//   ⑥ 바뀌지 않는 분류·출처 이름     → 이 부품  예) 기본상담·인테이크, 수기·승인 요약, 전사·텍스트
// 가르지 못하면 나중에 바뀌는 값인지 본다. 바뀌면 배지, 그 항목에 붙어 안 바뀌면 이 부품이다.
//
// 배지를 값 앞에 두는 안은 실측으로 기각했다: 이름 시작선 편차가 0에서 23px로 벌어지고,
// 고정 열로 되찾으면 390px에서 잘리는 이름이 1개에서 2개로 늘었다.

/** 계열 의미는 D34 고정이다. mint = 사람·소속·진행, lavender = AI 산출·주의, blue = 시간 축. */
export type WireMarkerTone = 'mint' | 'lavender' | 'blue';

export interface WireMarkerProps {
  children: ReactNode;
  tone: WireMarkerTone;
  testId?: string;
}

/**
 * 값 앞 분류·출처 표시. 면과 테두리가 없는 14/600 계열 deep 글자 한 조각이다.
 *
 * 크기·굵기·색을 바깥에서 정할 수 없다. className 슬롯이 없는 이유는 `WireItem`과 같다 —
 * 슬롯이 곧 계약을 비켜 가는 길이 된다.
 */
export function WireMarker({ children, tone, testId }: WireMarkerProps) {
  return (
    <span className="wire-marker" data-tone={tone} data-testid={testId}>
      {children}
    </span>
  );
}
