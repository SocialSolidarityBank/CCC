'use client';

import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { Chevron } from './chevron';

// 링크 렌더러 경계(2026-09-08). 이 부품은 프레임워크를 모른다. 기본은 평범한 <a> 이고,
// 클라이언트 사이드 이동이 필요한 앱만 자기 렌더러를 끼운다(apps/web 은 next/link).
// 서버 컴포넌트에서 함수를 prop 으로 넘기면 RSC 가 막으므로 렌더러를 넣는 쪽도 클라이언트
// 모듈이어야 한다. 이 파일이 'use client' 라 Provider 도 클라이언트 경계 안에 선다.

/** 링크로 렌더할 때 넘어가는 속성. DOM 은 기존 <a> 그대로다. */
export interface WireLinkProps {
  href: string;
  className: string;
  children: ReactNode;
  'aria-label'?: string;
  'data-variant': string;
  'data-justify': string;
}

export type WireLinkRenderer = (props: WireLinkProps) => ReactElement;

const WireLinkContext = createContext<WireLinkRenderer | null>(null);

/** 앱이 자기 링크 부품을 끼우는 자리. 넣지 않으면 기본 <a> 다. */
export function WireLinkProvider({
  renderer,
  children,
}: {
  renderer: WireLinkRenderer;
  children: ReactNode;
}) {
  return <WireLinkContext.Provider value={renderer}>{children}</WireLinkContext.Provider>;
}
/** 등록된 링크 렌더러를 반환한다. 없으면 null(기본 `<a>`).
 *  공용 부품에서 WireLinkContext 를 직접 import 하지 않고 이 훅을 쓴다. */
export function useWireLink(): WireLinkRenderer | null {
  return useContext(WireLinkContext);
}


/** 버튼 종류 5종(DESIGN.md §5). 색·테두리 규칙은 종류가 정한다. 높이는 전 버튼 32 단일이다
 *  (2026-08-28 Q — 구 md 40 / sm 32 2단 폐지: 툴바·목록 버튼과 HERO·폼 버튼이 한 높이로 선다).
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
  /** 텍스트 정렬. 기본 center(2026-08-02 D58 — 구 left 기본은 버그). 체브론이 있으면
   *  텍스트 좌측·체브론 우측으로 배치된다. */
  align?: 'left' | 'center';
  /** 체브론 표시. true·'right' = 우측(다음·이동), 'left' = 좌측(이전 달). */
  chevron?: boolean | 'left' | 'right';
  /** 글자 앞 16px 아이콘(NavIcon). 아이콘만 있는 버튼은 WireRepeatActions 어휘라 여기서는 글자와 함께만 쓴다. */
  icon?: ReactNode;
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

/** 버튼 5종(DESIGN.md §5). 알약(--radius-pill, 2026-08-25 Q) · 높이 32 단일(2026-08-28 Q). 종류가 색·면만 가른다. */
export function WireButton({
  children,
  size = 'small',
  variant,
  align = 'center',
  chevron = false,
  icon,
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
  const renderLink = useContext(WireLinkContext);
  const resolvedVariant: WireButtonVariant = variant ?? (size === 'large' ? 'primary' : 'secondary');
  const justify = chevron !== false && chevron !== undefined ? 'between' : align;
  const classes = ['wire-button', className].filter(Boolean).join(' ');
  const inner = (
    <>
      {chevron === 'left' && <Chevron dir="left" />}
      {icon}
      <span className="wire-button-text">{children}</span>
      {(chevron === true || chevron === 'right') && <Chevron dir="right" />}
    </>
  );

  if (href !== undefined && !disabled) {
    const linkProps: WireLinkProps = {
      className: classes,
      href,
      'data-variant': resolvedVariant,
      'data-justify': justify,
      children: inner,
      ...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel }),
    };
    return renderLink === null ? <a {...linkProps} /> : renderLink(linkProps);
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
      data-justify={justify}
    >
      {inner}
    </button>
  );
}
