'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Chevron, type ChevronDir } from './chevron';

export interface ListRowProps {
  children: ReactNode;
  /** 텍스트 정렬. 기본 left. */
  align?: 'left' | 'center';
  /** 우측 체브론 방향. 생략하면 없음. open이 주어지면 open으로 방향을 파생한다. */
  chevron?: ChevronDir;
  /** 아코디언 열림 상태. true=펼침(체브론 down), false=접힘(체브론 right). */
  open?: boolean;
  /** 뮤트 필(--muted)로 강조. */
  selected?: boolean;
  /** 링크로 렌더. onClick과 함께 주면 링크가 우선한다. */
  href?: string;
  /** 버튼으로 렌더(아코디언 토글 등). */
  onClick?: () => void;
  /** 아코디언 토글 버튼일 때 접근성 상태. */
  ariaExpanded?: boolean;
  ariaControls?: string;
  className?: string;
}

function resolveDir(chevron: ChevronDir | undefined, open: boolean | undefined): ChevronDir | null {
  if (chevron !== undefined) return chevron;
  if (open !== undefined) return open ? 'down' : 'right';
  return null;
}

/**
 * 풀폭 라운드 로우(72px). 링크·버튼·정적 3가지로 렌더한다.
 * 체브론(down/right/none), selected(뮤트 필), 아코디언 open 상태를 지원한다.
 */
export function ListRow({
  children,
  align = 'left',
  chevron,
  open,
  selected = false,
  href,
  onClick,
  ariaExpanded,
  ariaControls,
  className,
}: ListRowProps) {
  const dir = resolveDir(chevron, open);
  const classes = ['surface-card', 'wire-row', className].filter(Boolean).join(' ');
  const inner = (
    <>
      <span className="wire-row-text">{children}</span>
      {dir !== null && <Chevron dir={dir} />}
    </>
  );

  if (href !== undefined) {
    return (
      <Link className={classes} href={href} data-align={align} data-selected={selected ? 'true' : undefined}>
        {inner}
      </Link>
    );
  }

  if (onClick !== undefined) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        data-align={align}
        data-selected={selected ? 'true' : undefined}
        aria-expanded={ariaExpanded}
        aria-controls={ariaControls}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={classes} data-align={align} data-static="true" data-selected={selected ? 'true' : undefined}>
      {inner}
    </div>
  );
}
