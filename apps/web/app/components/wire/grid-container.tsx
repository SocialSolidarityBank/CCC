import { createElement, type ReactNode } from 'react';

type ContainerTag = 'div' | 'main' | 'section' | 'header';

export interface GridContainerProps {
  children: ReactNode;
  /** 렌더할 태그. 기본 div. */
  as?: ContainerTag;
  /** content = 820 콘텐츠 폭(기본), wide = 1280 밴드(헤더 등). */
  width?: 'content' | 'wide';
  /** true면 children을 12컬럼 grid로 배치. false(기본)면 단일 컬럼. */
  grid?: boolean;
  className?: string;
}

/**
 * 와이어프레임 레이아웃 컨테이너. 최대 1280 중앙 정렬.
 * content 폭은 좌우 여백 230 → 820(12컬럼×50 + 거터 20). 12컬럼 배치는 자식에
 * wire-col-3/4/6/12 클래스로 span을 준다(카드 2열 = wire-col-6 = 400).
 */
export function GridContainer({
  children,
  as = 'div',
  width = 'content',
  grid = false,
  className,
}: GridContainerProps) {
  const classes = ['wire-container', className].filter(Boolean).join(' ');
  return createElement(
    as,
    { className: classes, 'data-width': width, 'data-grid': grid ? 'true' : 'false' },
    children,
  );
}
