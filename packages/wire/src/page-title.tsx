import type { ReactNode } from 'react';

export interface PageTitleProps {
  children: ReactNode;
  className?: string;
}

/** 왼쪽 정렬 페이지 제목. 데스크톱 28/600, 767 이하는 24/600이다. */
export function PageTitle({ children, className }: PageTitleProps) {
  const classes = ['wire-page-title', className].filter(Boolean).join(' ');
  return <h1 className={classes}>{children}</h1>;
}
