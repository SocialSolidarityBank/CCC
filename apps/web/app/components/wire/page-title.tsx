import type { ReactNode } from 'react';

export interface PageTitleProps {
  children: ReactNode;
  className?: string;
}

/** 중앙 정렬 큰 페이지 타이틀(40~48px bold). */
export function PageTitle({ children, className }: PageTitleProps) {
  const classes = ['wire-page-title', className].filter(Boolean).join(' ');
  return <h1 className={classes}>{children}</h1>;
}
