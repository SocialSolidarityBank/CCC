import { type ReactNode } from 'react';

/**
 * 정의 목록 2열(라벨 | 값) — 항목이 10개를 넘거나 세로로 쌓여 '눌린 쌓임'이 되는 화면용
 * 표 부품(CCC-81). `<dl>` 안에 `<div class="wire-data-row">`(dt 라벨 + dd 값)를 둔다.
 *
 * 적용: 인테이크 조회(정본 4부의 문답), 참여자 정보처럼 라벨·값이 한 줄에 있어야 읽히는 곳.
 * 단계(표 안의 표) 금지 — 테이블 셀 안에는 쓰지 않는다.
 */
export function WireDataRows({ children, className }: { children: ReactNode; className?: string }) {
  return <dl className={className === undefined ? 'wire-data-rows' : `wire-data-rows ${className}`}>{children}</dl>;
}

export function WireDataRow({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={className === undefined ? 'wire-data-row' : `wire-data-row ${className}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}