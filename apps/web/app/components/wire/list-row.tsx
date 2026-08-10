'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Chevron, type ChevronDir } from './chevron';

export interface ListRowProps {
  children: ReactNode;
  /** 텍스트 정렬. 기본 left. */
  align?: 'left' | 'center';
  /** 우측 체브론 방향. 생략하면 없음. */
  chevron?: ChevronDir;
  /** 뮤트 필(--muted)로 강조. */
  selected?: boolean;
  /** 링크로 렌더. onClick과 함께 주면 링크가 우선한다. */
  href?: string;
  /** 버튼으로 렌더. */
  onClick?: () => void;
  className?: string;
}

/**
 * 풀폭 라운드 로우(72px). 링크·버튼·정적 3가지로 렌더한다.
 * 체브론(down/right/none)과 selected(고른 행)를 지원한다.
 *
 * **아코디언 변형은 2026-08-10 에 없앴다**(Q "아코디언 listrow 펼침면을 펼친 회차 카드로
 * 통일 가능?" → 가능하고, 사실상 이미 그랬다). 이 부품의 `open`·`ariaExpanded`·`ariaControls`
 * 는 킷 데모와 자기 테스트 말고 **쓰는 화면이 한 곳도 없었다** — 실제 아코디언은 전부
 * WireCardDetails(펼치면 제목 밑 회색 풀블리드 선 + 그라데이션 아웃라인)를 쓴다. 접히고
 * 펼쳐지는 어휘는 그 카드 하나이고, 이 부품은 누르면 이동하거나 고르는 한 줄이다.
 */
export function ListRow({
  children,
  align = 'left',
  chevron,
  selected = false,
  href,
  onClick,
  className,
}: ListRowProps) {
  const dir = chevron ?? null;
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
