import { type ReactNode } from 'react';

/**
 * 시간 축 부품 (CCC-78 · daisyUI Timeline 계열) — 시간 순서를 보이는 읽기 전용 나열.
 *
 * 규칙(2026-08-10 외부 라이브러리 대조에서 하니스 규칙으로 옮긴 것):
 *   - 한 구획이 시간 순서의 흐름이라는 것을 **선 + 마디(dot)**로 보여준다. 나열이므로
 *     위계 4단의 '연속 금지'는 형제 구획 규칙의 예외다(각 항목은 제목·메타 짝).
 *   - 마디는 사각 7px + radius 2(원형은 32px 아이콘 버튼·라디오 전용 — D61 ①), 선은
 *     `--line` 1px. 색은 계열 의미를 갖지 않는다(시간 자체는 무채색 축).
 *   - 항목 사이 간격은 `--space-3`(목록 안 카드 20 과 같은 열).
 *
 * 사용: 목표 문구 이력(goal_revisions, 0031)이 첫 적용이다. 영역 ② 회차별 정리는
 * 2026-08-07 Q 결정(고정 폭 칸 가로 행)이 살아 있어 그 화면은 부품을 쓰지 않는다.
 */
export function WireTimeline({ children }: { children: ReactNode }) {
  return <ol className="wire-timeline">{children}</ol>;
}

export function WireTimelineItem({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={className === undefined ? 'wire-timeline-item' : `wire-timeline-item ${className}`}>{children}</li>;
}