'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Chevron } from './chevron';

/** 버튼 종류 5종(DESIGN.md §5). 색·테두리 규칙은 종류가 정하고, 크기는 높이만 바꾼다.
 *  neutral 은 2026-08-06 Q 위계 재편으로 신설: 이동·보기 조작(뒤로, 시간순, 달 이동)은
 *  그레이 아웃라인, 컬러(아웃라인·그라데이션 면)는 중요 행동(등록·저장류)만 갖는다. */
export type WireButtonVariant = 'primary' | 'secondary' | 'neutral' | 'ghost' | 'danger';

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
  /** 텍스트 정렬. 기본 center(2026-08-02 D58 — 구 left 기본은 버그). 체브론이 있으면
   *  텍스트 좌측·체브론 우측으로 배치된다. */
  align?: 'left' | 'center';
  /** 체브론 표시. true·'right' = 우측(다음·이동), 'left' = 좌측(이전 달). */
  chevron?: boolean | 'left' | 'right';
  disabled?: boolean;
  /** 링크로 렌더(비활성 아니면). */
  href?: string;
  /** 버튼으로 렌더. */
  onClick?: () => void;
  type?: 'button' | 'submit';
  /**
   * 제출 버튼이 폼에 실어 보내는 이름·값. 한 폼에 선택지가 여럿일 때(예: 불일치 처리 3종)
   * 어느 버튼을 눌렀는지 서버 액션이 알아야 한다. href 로 렌더될 때는 무시된다.
   */
  name?: string;
  value?: string;
  /**
   * 폼 밖에 선 제출 버튼이 가리키는 form id (2026-08-07 — 카드 제목 줄의 '동의 저장' 등,
   * 버튼이 폼 바깥 마크업에 서야 할 때). href 로 렌더될 때는 무시된다.
   */
  form?: string;
  /**
   * 라벨이 아이콘뿐일 때의 접근성 이름(2026-08-09 — WireRepeatActions 의 +/- 버튼).
   * 글자 라벨이 있으면 주지 않는다: 이름이 둘이면 스크린 리더가 라벨을 못 읽는다.
   */
  ariaLabel?: string;
  className?: string;
}

/** 버튼 4종 × 크기 2단(DESIGN.md §5). 전부 radius pill, 높이만 40/32로 갈린다. */
export function WireButton({
  children,
  size = 'small',
  variant,
  height = 'md',
  align = 'center',
  chevron = false,
  disabled = false,
  href,
  onClick,
  type = 'button',
  name,
  value,
  form,
  ariaLabel,
  className,
}: WireButtonProps) {
  const resolvedVariant: WireButtonVariant = variant ?? (size === 'large' ? 'primary' : 'secondary');
  const justify = chevron !== false && chevron !== undefined ? 'between' : align;
  const classes = ['wire-button', className].filter(Boolean).join(' ');
  const inner = (
    <>
      {chevron === 'left' && <Chevron dir="left" />}
      <span className="wire-button-text">{children}</span>
      {(chevron === true || chevron === 'right') && <Chevron dir="right" />}
    </>
  );

  if (href !== undefined && !disabled) {
    return (
      <Link className={classes} href={href} aria-label={ariaLabel} data-variant={resolvedVariant} data-height={height} data-justify={justify}>
        {inner}
      </Link>
    );
  }

  return (
    <button
      className={classes}
      type={type}
      name={name}
      value={value}
      form={form}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      data-variant={resolvedVariant}
      data-height={height}
      data-justify={justify}
    >
      {inner}
    </button>
  );
}
