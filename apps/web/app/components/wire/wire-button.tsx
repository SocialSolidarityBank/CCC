'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Chevron } from './chevron';

/** 버튼 종류 4종(DESIGN.md §5). 색·테두리 규칙은 종류가 정하고, 크기는 높이만 바꾼다. */
export type WireButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

export interface WireButtonProps {
  children: ReactNode;
  /**
   * 와이어프레임 시절의 크기 축. 지금은 종류의 기본값을 정하는 데만 쓴다 —
   * large 는 화면의 주 행동이었으므로 프라이머리, small 은 세컨더리가 된다.
   * 새 코드는 variant 를 직접 지정한다.
   */
  size?: 'small' | 'large';
  /** 종류. 미지정 시 size 에서 도출한다. */
  variant?: WireButtonVariant;
  /** 높이 축(§5 · 2026-07-26 Q 결정): md = 40px(기본), sm = 32px. 색 규칙은 동일하다. */
  height?: 'md' | 'sm';
  /** 텍스트 정렬. 기본 left. 체브론이 있으면 텍스트 좌측·체브론 우측으로 배치된다. */
  align?: 'left' | 'center';
  /** 우측 체브론 표시. */
  chevron?: boolean;
  disabled?: boolean;
  /** 링크로 렌더(비활성 아니면). */
  href?: string;
  /** 버튼으로 렌더. */
  onClick?: () => void;
  type?: 'button' | 'submit';
  className?: string;
}

/** 버튼 4종 × 크기 2단(DESIGN.md §5). 전부 radius pill, 높이만 40/32로 갈린다. */
export function WireButton({
  children,
  size = 'small',
  variant,
  height = 'md',
  align = 'left',
  chevron = false,
  disabled = false,
  href,
  onClick,
  type = 'button',
  className,
}: WireButtonProps) {
  const resolvedVariant: WireButtonVariant = variant ?? (size === 'large' ? 'primary' : 'secondary');
  const justify = chevron ? 'between' : align === 'center' ? 'center' : 'left';
  const classes = ['wire-button', className].filter(Boolean).join(' ');
  const inner = (
    <>
      <span className="wire-button-text">{children}</span>
      {chevron && <Chevron dir="right" />}
    </>
  );

  if (href !== undefined && !disabled) {
    return (
      <Link className={classes} href={href} data-variant={resolvedVariant} data-height={height} data-justify={justify}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      className={classes}
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-variant={resolvedVariant}
      data-height={height}
      data-justify={justify}
    >
      {inner}
    </button>
  );
}
