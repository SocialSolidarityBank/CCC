import { type ReactNode } from 'react';

/**
 * 탭 부품 (CCC-83 · §5) — 활성 탭은 색이 아니라 그라데이션 밑줄로 구분한다(2026-08-03 Q).
 * 컨테이너 회색선을 가운데로 관통하는 2px 밑줄은 .wire-tab 의 ::after 가 갖는다.
 * 부품으로 있는 이유: 화면마다 button+aria-selected 를 손으로 조립하면 같은 계약이
 * 한 벌씩 복사된다(2026-08-10 대조에서 발견한 패턴).
 */
export function WireTabs({ children, className }: { children: ReactNode; className?: string }) {
  return <div role="tablist" className={className === undefined ? 'wire-tabs' : `wire-tabs ${className}`}>{children}</div>;
}

export function WireTab({
  active,
  onSelect,
  children,
  className,
}: {
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={className === undefined ? 'wire-tab' : `wire-tab ${className}`}
      onClick={onSelect}
    >
      {children}
    </button>
  );
}