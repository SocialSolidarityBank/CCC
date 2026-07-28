import type { ReactNode } from 'react';

export interface MetaRowProps {
  /** 표시할 조각들. null·undefined·빈 문자열은 걸러낸다. */
  items: (ReactNode | null | undefined)[];
  className?: string;
}

/**
 * 서로 다른 정보를 나란히 놓는 메타 줄(DESIGN.md §10).
 *
 * 제품 UI 문자열에서는 구분자 가운뎃점을 쓰지 않는다 — 조각을 각각 독립 노드로 두고
 * 간격으로 띄운다. `대면 · 3회차`가 아니라 `대면` `3회차` 두 노드다.
 * 한 낱말 안에서 묶어 읽는 병렬(`이름·연락처·계좌`)은 이 규칙의 대상이 아니므로 그대로 둔다.
 */
export function MetaRow({ items, className }: MetaRowProps) {
  const visible = items.filter(
    (item) => item !== null && item !== undefined && item !== '',
  );
  if (visible.length === 0) return null;

  const classes = ['wire-meta-row', className].filter(Boolean).join(' ');
  return (
    <span className={classes}>
      {visible.map((item, index) => (
        <span key={index}>{item}</span>
      ))}
    </span>
  );
}
