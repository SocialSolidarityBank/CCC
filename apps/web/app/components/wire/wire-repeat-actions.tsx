'use client';

import { Icon } from './wire-icon';
import { WireButton } from './wire-button';

// 반복 칸의 추가·삭제 세트 (2026-08-09 Q "추가하기 삭제하기 버튼은 세트로 만들어서 하나의
// 컴포넌트화 해. '+', '-' 로 해도 돼").
//
// 전수 조사에서 같은 조작이 **네 벌**이었다: 상담 일정 등록의 세 곳('이 목표 삭제'·
// '이 질문 삭제' + '추가하기')과 인테이크 반복 행 표('이 줄 삭제'·'줄 추가'). 라벨이
// 제각각인 것보다 나쁜 것은 **자리와 여백이 제각각**이었던 것이다 — 삭제는 칸 아래
// 왼쪽, 추가는 묶음 아래 왼쪽으로 서로 다른 줄에 떨어져 있어 둘이 한 쌍으로 읽히지 않았다.
//
// 이제 한 쌍이 한 줄에 오른쪽 정렬로 선다. 아이콘 버튼이라 라벨 길이가 자리를 흔들지 않고,
// 접근성 이름은 호출부가 항목 이름으로 채운다('목표 추가'·'이 목표 삭제').
//
// 형태는 새로 만들지 않는다: 조작 버튼 계약 그대로(neutral 그레이 아웃라인 · 32px ·
// radius 6, D61 ①). 문자 글리프 대신 SVG 아이콘이다(D58 ⑦).

export interface WireRepeatActionsProps {
  /** 항목 이름(예: '목표'·'질문'·'줄'). 접근성 이름을 이걸로 만든다. */
  itemLabel: string;
  /** 상한에 걸렸거나 추가를 막을 자리면 넘기지 않는다 — 그러면 + 를 그리지 않는다. */
  onAdd?: (() => void) | undefined;
  /** 마지막 한 칸이면 넘기지 않는다 — 그러면 - 를 그리지 않는다. */
  onRemove?: (() => void) | undefined;
}

export function WireRepeatActions({ itemLabel, onAdd, onRemove }: WireRepeatActionsProps) {
  if (onAdd === undefined && onRemove === undefined) return null;
  return (
    <div className="wire-repeat-actions">
      {onRemove !== undefined && (
        <WireButton variant="neutral" height="sm" onClick={onRemove} ariaLabel={`이 ${itemLabel} 삭제`}>
          <Icon name="minus" size={14} />
        </WireButton>
      )}
      {onAdd !== undefined && (
        <WireButton variant="neutral" height="sm" onClick={onAdd} ariaLabel={`${itemLabel} 추가`}>
          <Icon name="plus" size={14} />
        </WireButton>
      )}
    </div>
  );
}
