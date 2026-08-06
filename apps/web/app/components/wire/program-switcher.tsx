'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from './wire-icon';
import { NavIcon } from './shell-icons';
import type { ParticipantProgramType } from '../../lib/api';
import { DEFAULT_PROGRAM_TYPE, PROGRAM_TYPES, isKnownProgramType } from '../../lib/labels';

// 2026-08-05 app-sidebar.tsx 에서 분리 — 상단 헤더 신설(Q 지시, Infisical 레퍼런스)로
// 데스크톱에서는 헤더가, 768 미만 드로어에서는 사이드바가 같은 전환기를 쓴다.
// 마크업·동작은 분리 전과 같고 자리만 옮겼다.

/** 경로에서 현재 워크스페이스를 읽는다. `/programs/:type/...` 밖이면 null. */
export function programTypeFromPath(path: string): ParticipantProgramType | null {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'programs' || parts[1] === undefined) return null;
  return isKnownProgramType(parts[1]) ? parts[1] : null;
}

/**
 * 지금 보고 있는 사업이 워크스페이스다. 경로 밖(당사자·설정)에서는 넘겨받은 폴백으로,
 * 그것도 없으면 첫 사업으로 떨어진다 — 메뉴 링크가 목적지를 잃지 않게 항상 하나를 고른다.
 * 헤더·사이드바가 같은 판단을 해야 하므로 한 곳에 둔다.
 */
export function resolveActiveProgram(path: string, fallback?: string): ParticipantProgramType {
  const fromPath = programTypeFromPath(path);
  if (fromPath !== null) return fromPath;
  return fallback !== undefined && isKnownProgramType(fallback) ? fallback : DEFAULT_PROGRAM_TYPE;
}

/**
 * 사업 전환기 (2026-07-31 Q 요청). 지금 등록된 사업은 1개뿐이라 목록에도 1개만 뜨지만,
 * 사업이 늘면 그대로 동작한다 — 그래서 '2개부터 형태를 정한다'(구 ADR-0014 개정 1번)를
 * 지금 닫는다.
 *
 * 팝오버 방식은 date-picker-control.tsx 의 것을 그대로 따른다(바깥 pointerdown 으로 닫기 +
 * Escape 로 닫고 **초점을 버튼으로 되돌리기**). 새 상호작용을 발명하지 않는다.
 *
 * 사업이 1개뿐이어도 **선택창이다**(2026-08-03 Q 지시 — 구 '1개면 글자' 판단 대체).
 * 늘 같은 자리가 같은 컨트롤이어야 사업이 늘었을 때 조작법이 바뀌지 않는다.
 */
export function ProgramSwitcher({
  activeProgram,
  programLabels,
}: {
  activeProgram: ParticipantProgramType;
  programLabels: Record<ParticipantProgramType, string>;
}) {
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
    <div className="program-switcher" ref={rootRef}>
      {/* '사업' 라벨은 선택창과 별도 노드다. 드로어(세로)에서는 선택창 **위**(2026-08-04 Q),
          헤더(가로)에서는 선택창 왼쪽에 나란히 선다 — 배치는 CSS 컨텍스트가 정한다. */}
      <p className="program-switcher-label" id={`${menuId}-label`}>사업</p>
      <div className="program-switcher-box">
        {/* **listbox 가 아니라 열고 닫는 목록(disclosure)이다.** 처음에는 role="listbox" +
            role="option" 으로 적었는데, ARIA 는 option 안에 링크 같은 조작 가능한 자식을 두는 것을
            금지하고(둘이 같은 노드를 두고 다툰다) listbox 라고 알린 이상 화살표 이동을 기대하게
            만든다 — 그 둘을 다 지키려면 초점 관리를 직접 구현해야 하는데, 여기서 필요한 것은
            '누르면 그 사업으로 가는 링크 목록'뿐이다. 그래서 역할을 참칭하지 않고 링크로 남긴다.
            현재 항목은 aria-current 로 알린다 — 메뉴 링크(navigation-link)와 같은 방식이다. */}
        <button
          type="button"
          ref={buttonRef}
          className="program-switcher-trigger"
          aria-expanded={open}
          aria-labelledby={`${menuId}-label ${menuId}-value`}
          onClick={() => setOpen((previous) => !previous)}
        >
          <span className="program-switcher-name" id={`${menuId}-value`}>{programLabels[activeProgram]}</span>
          {/* 상하 꺽쇠(2026-08-05 Q 2차 — 구 아래 꺽쇠 대체): 단방향 꺽쇠는 '펼침'을, 상하
              꺽쇠는 '고르는 값'을 말한다. 기관 선택창과 같은 어휘(Infisical·OpenAI 레퍼런스). */}
          <span className="switcher-updown" aria-hidden="true"><NavIcon name="updown" /></span>
        </button>
        {open ? (
          <ul className="program-switcher-menu" aria-labelledby={`${menuId}-label`}>
            {PROGRAM_TYPES.map((type) => {
              const selected = type === activeProgram;
              return (
                <li key={type}>
                  {/* 사업을 바꾸는 것은 워크스페이스를 옮기는 것이므로 그 사업의 일정으로 간다.
                      Link 라 서버가 rememberLastProgramType 을 그 화면에서 저장한다. */}
                  <Link
                    className="program-switcher-option"
                    href={`/programs/${type}/schedule`}
                    data-selected={selected ? 'true' : undefined}
                    aria-current={selected ? 'true' : undefined}
                    onClick={() => setOpen(false)}
                  >
                    <span className="program-switcher-check" aria-hidden="true">{selected ? <Icon name="check" size={14} /> : null}</span>
                    <span>{programLabels[type]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
