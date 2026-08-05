'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './wire-icon';
import { NavIcon } from './shell-icons';

// 기관 선택창 (2026-08-05 Q 2차 — Infisical·OpenAI 플랫폼 레퍼런스).
//
// D50 "기관명 = 홈 링크"의 **형태 부분 대체**: 기관명은 이제 사업 전환기와 같은 선택창이고,
// 목록에서 기관을 고르면 그 기관의 홈('/')으로 간다 — 홈 배선 자체는 유지된다(누르는 횟수만
// 1 → 2). 여러 기관 가입("여러 조직과 사업을 선택해야 하기 때문에 이부분 중요")을 전제로
// 형태를 지금 정한다 — 사업 전환기의 '1개여도 선택창'(2026-08-03 Q)과 같은 원칙이라,
// 현 단계(단일 기관)에서는 목록에 1개만 뜬다.
//
// 팝오버 동작·클래스는 program-switcher 의 것을 그대로 쓴다(바깥 pointerdown 닫기 + Escape
// 닫고 초점 복귀). 새 상호작용·새 표면을 발명하지 않는다. 트리거만 다르다 —
// 기관 마크(32) + 기관명 18/600 + 상하 꺽쇠.

export function OrgSwitcher({ orgLabel }: { orgLabel: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: PointerEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className="program-switcher org-switcher" ref={rootRef}>
      {/* '기관' 라벨은 화면에 없어도 접근 이름("기관 <기관명>")을 만든다 — 사업 전환기의
          라벨 규칙과 같다(display:none 이어도 aria-labelledby 가 읽는다). */}
      <p className="program-switcher-label" id={`${menuId}-label`}>기관</p>
      <div className="program-switcher-box">
        <button
          type="button"
          ref={buttonRef}
          className="program-switcher-trigger"
          aria-expanded={open}
          aria-labelledby={`${menuId}-label ${menuId}-value`}
          onClick={() => setOpen((previous) => !previous)}
        >
          <span className="brand-mark" aria-hidden="true"><NavIcon name="org" /></span>
          <span className="program-switcher-name" id={`${menuId}-value`}>{orgLabel}</span>
          <span className="switcher-updown" aria-hidden="true"><NavIcon name="updown" /></span>
        </button>
        {open ? (
          <ul className="program-switcher-menu" aria-labelledby={`${menuId}-label`}>
            <li>
              {/* 기관을 고르면 그 기관의 홈으로 간다 — D50 홈 배선의 새 자리. 지금은 기관이
                  1개라 현재 기관 = 유일한 항목이다. */}
              <Link
                className="program-switcher-option"
                href="/"
                data-selected="true"
                aria-current="true"
                onClick={() => setOpen(false)}
              >
                <span className="program-switcher-check" aria-hidden="true"><Icon name="check" size={14} /></span>
                <span>{orgLabel}</span>
              </Link>
            </li>
          </ul>
        ) : null}
      </div>
    </div>
  );
}
