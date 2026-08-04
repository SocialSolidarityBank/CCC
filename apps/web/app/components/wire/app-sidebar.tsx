'use client';

import Link from 'next/link';
import { Icon } from './wire-icon';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { logoutAction } from '../../logout-action';
import { toggleThemeAction } from '../../theme-action';
import type { Theme } from '../../lib/theme-cookie';
import type { ParticipantProgramType } from '../../lib/api';
import { DEFAULT_PROGRAM_TYPE, ORG_LABEL, PROGRAM_LABELS, PROGRAM_TYPES, isKnownProgramType } from '../../lib/labels';
import { Chevron } from './chevron';

// 앱 셸의 좌측 사이드바 (D35 · ADR-0014 §2). 축은 **사이드바 = 장소 / 페이지 우상단 = 행동**이라
// 등록 2개(상담·당사자)는 여기 넣지 않는다 — 섞이면 누를 때마다 "화면이 바뀌는 것"과
// "새로 만드는 것"을 판별해야 한다. 설정도 사이드바 1곳만 남긴다(구 헤더 링크 + 프로필
// 드롭다운 이중 진입 폐기).
//
// 시각 계약은 DESIGN.md §4·§5 가 정본이고 여기서 새로 정하지 않는다 — 폭 240(--sidebar-width),
// 배경 --gradient-sidebar, 활성 항목 --blue-tint 배경 + --blue-deep 글자. 클래스는 layout.tsx 의
// .sidebar / .navigation-link / .sidebar-footer 를 그대로 쓴다(스킨 패스가 이미 넣어둔 계약).

interface NavItem {
  label: string;
  href: string;
  icon: 'upcoming' | 'calendar' | 'participants';
  /** 아직 화면이 없는 메뉴. 누르기 전에 알린다 — 눌러 보고 실망하지 않게 (CCC-23). */
  soon?: boolean;
}

/**
 * 사업 범위 안의 메뉴. '오늘 상담'을 따로 두지 않는 것은 의도다 — 오늘+다가오는이 한 화면에
 * 있어야 "오늘 걸 보려면 어느 메뉴지"를 판단하지 않는다 (ADR-0014 §2).
 */
function programMenu(programType: ParticipantProgramType): NavItem[] {
  return [
    { label: '다가오는 일정', href: `/programs/${programType}/schedule`, icon: 'upcoming' },
    // '전체 일정'은 CCC-19 가 만든다. 여기서는 메뉴 자리만 잡는다.
    // '준비 중' 배지는 CCC-19 로 화면이 생기면서 뗐다 — 화면이 있는 메뉴에 남겨 두면
    // 안 만들어진 것으로 읽힌다.
    { label: '전체 일정', href: `/programs/${programType}/schedule/all`, icon: 'calendar' },
    { label: '당사자', href: '/participants', icon: 'participants' },
  ];
}

/** 16px 단색 라인 아이콘(DESIGN.md §4). currentColor 라 활성 항목에서 글자와 같이 물든다. */
function NavIcon({ name }: { name: NavItem['icon'] | 'settings' | 'org' | 'logout' | 'theme-dark' | 'theme-light' | 'close' }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  };
  switch (name) {
    // 아이콘은 **가는 곳**을 가리킨다(현재 상태가 아니라). 라이트일 때 달이 뜨고, 누르면 어두워진다.
    case 'theme-dark':
      return <svg {...common}><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" /></svg>;
    case 'theme-light':
      return <svg {...common}><circle cx="8" cy="8" r="3" /><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M12.95 3.05l-1.06 1.06M4.11 11.89l-1.06 1.06" /></svg>;
    case 'upcoming':
      return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>;
    case 'calendar':
      return <svg {...common}><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></svg>;
    case 'participants':
      return <svg {...common}><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" /></svg>;
    // 설정은 톱니(원+방사선)가 아니라 **슬라이더**다(2026-08-02 CCC-52) — 방사선 톱니는
    // 16px 에서 해(라이트 모드) 아이콘과 같은 모양으로 렌더돼 테마 항목과 겹쳐 보였다.
    case 'settings':
      return <svg {...common}><path d="M2.5 4.5h5.2M12.3 4.5h1.2M2.5 11.5h1.2M7.3 11.5h6.2" /><circle cx="10.2" cy="4.5" r="1.9" /><circle cx="5.4" cy="11.5" r="1.9" /></svg>;
    case 'org':
      return <svg {...common}><path d="M8 1.8l5.4 3.1v6.2L8 14.2 2.6 11.1V4.9z" /></svg>;
    case 'logout':
      return <svg {...common}><path d="M6 14H3.5A1.5 1.5 0 012 12.5v-9A1.5 1.5 0 013.5 2H6M10.5 11L14 8l-3.5-3M14 8H6" /></svg>;
    // 드로어 닫기 X (2026-08-04 Q — 구 하단 '메뉴 닫기' 텍스트 버튼 대체).
    case 'close':
      return <svg {...common}><path d="M4 4l8 8M12 4l-8 8" /></svg>;
  }
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
function ProgramSwitcher({
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
      {/* '사업' 라벨은 선택창 **위**다(2026-08-04 Q — 구 2026-08-03 '라벨+흰 상자 한 줄' 대체).
          라벨 줄 아래 흰 상자가 오고, 드롭다운은 그 상자를 기준으로 뜬다. */}
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
          {/* 방향은 늘 아래다 — Chevron 계약에 'up' 이 없고(down|right), 열림 여부는
              aria-expanded 와 열린 목록 자체가 이미 알린다. 이 하나 때문에 공용 부품을 넓히지 않는다. */}
          <Chevron dir="down" />
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

/** 경로에서 현재 워크스페이스를 읽는다. `/programs/:type/...` 밖이면 null. */
function programTypeFromPath(path: string): ParticipantProgramType | null {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'programs' || parts[1] === undefined) return null;
  return isKnownProgramType(parts[1]) ? parts[1] : null;
}

export interface AppSidebarProps {
  /**
   * 워크스페이스 폴백. 경로가 사업을 알려주지 않는 화면(당사자·설정)에서 쓴다.
   * CCC-18b 가 계정 설정에 저장된 마지막 선택 사업을 여기로 넣는다 — 그전까지는 첫 사업.
   */
  programType?: string;
  /** 활성 경로. 생략하면 현재 경로로 자동 판단. */
  activePath?: string;
  /**
   * 온보딩이 저장한 기관 이름 (CCC-32). 루트 레이아웃이 getDisplayLabels() 로 넣는다.
   * 생략하면 labels.ts 하드코딩 라벨 — 테스트·스토리 렌더가 지금까지처럼 동작한다.
   */
  orgLabel?: string;
  /** 온보딩이 저장한 사업 표시 이름 매핑 (CCC-32). 생략하면 labels.ts 폴백. */
  programLabels?: Record<ParticipantProgramType, string>;
  /**
   * 현재 테마 (D56 · ADR-0026). 루트 레이아웃이 쿠키에서 읽어 넣는다 — 여기서 직접 읽지
   * 않는 이유는 이 컴포넌트가 클라이언트이고 쿠키 판정은 첫 페인트 전에 끝나 있어야 하기
   * 때문이다. 생략하면 라이트로 그린다(테스트·스토리 렌더가 지금까지처럼 동작한다).
   */
  theme?: Theme;
}

/**
 * 좌측 사이드바(240px). **768px 미만에서는 같은 마크업이 드로어로 변한다**(DESIGN.md §4-4) —
 * 평소엔 화면 밖에 있고 상단 손잡이 바(56px)를 눌러야 왼쪽에서 밀려 들어온다.
 *
 * 이전에는 모바일용 가로 내비를 따로 렌더했는데 두 가지가 잘못돼 있었다: 계약이 정한 드로어가
 * 아니었고, 기관명과 **사업 전환기가 빠져 있어 좁은 화면에서는 지금 어느 사업인지 볼 수도
 * 바꿀 수도 없었다.** 마크업을 한 벌로 합치면 그 갈라짐이 구조적으로 사라진다.
 *
 * 손잡이 바는 §7 락 8 이 금지한 '상단 헤더 띠'가 아니다 — 데스크톱에는 없고 내용은 손잡이뿐이다.
 */
export function AppSidebar({
  programType,
  activePath,
  orgLabel = ORG_LABEL,
  programLabels = PROGRAM_LABELS,
  theme = 'light',
}: AppSidebarProps) {
  const pathname = usePathname();
  const current = activePath ?? pathname;
  const [drawerOpen, setDrawerOpen] = useState(false);
  const handleRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  // 이동하면 닫는다. 드로어가 열린 채로 남으면 도착한 화면을 자기가 가린다 —
  // 메뉴를 누른 사람은 "갔다"고 생각하는데 화면은 그대로인 것처럼 보인다.
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  useEffect(() => {
    if (!drawerOpen) return;
    // Esc 로 닫는다. 스크림을 못 누르는 상황(키보드·보조기기)에서 유일한 탈출구다.
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    // 열려 있는 동안 뒤 본문이 같이 스크롤되면 스크림이 덮은 것처럼 안 읽힌다.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // 초점을 드로어 안으로 옮긴다 — 안 옮기면 탭이 뒤 본문을 돌아 화면과 어긋난다.
    drawerRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      // 닫을 때 손잡이로 초점을 돌려준다(열기 전 자리).
      handleRef.current?.focus();
    };
  }, [drawerOpen]);
  // 지금 보고 있는 사업이 워크스페이스다. 경로 밖(당사자·설정)에서는 넘겨받은 값으로,
  // 그것도 없으면 첫 사업으로 떨어진다 — 메뉴 링크가 목적지를 잃지 않게 항상 하나를 고른다.
  const fallback = programType !== undefined && isKnownProgramType(programType) ? programType : DEFAULT_PROGRAM_TYPE;
  const activeProgram = programTypeFromPath(current) ?? fallback;
  const menu = programMenu(activeProgram);
  // 사업이 1개인 동안은 드롭다운 없이 라벨만이다 — 누를 데가 없는 화살표를 두지 않는다.
  // 2개부터 전환기 형태를 정한다(ADR-0014 개정 1번, 미결이나 착수를 막지 않음).

  // 하위 경로(예: 당사자 상세)에서도 그 메뉴가 활성으로 남아야 "지금 어디인지"가 유지된다.
  // '/participants' 가 '/participants/new' 까지 먹지 않도록 정확 일치 + 경계(/) 만 보고,
  // 겹치는 후보 중 **가장 긴 href 하나만** 활성이다(2026-08-03 Q 보고 — '전체 일정'
  // /schedule/all 에서 '다가오는 일정' /schedule 이 접두사 일치로 같이 켜져 둘이 동시
  // 선택된 것처럼 보였다).
  const matches = menu.filter((item) => current === item.href || current.startsWith(`${item.href}/`));
  const activeHref = matches.reduce<string | null>(
    (longest, item) => (longest === null || item.href.length > longest.length ? item.href : longest),
    null,
  );

  const navigation = (
    <ul className="navigation-list">
      {menu.map((item) => {
        const active = item.href === activeHref;
        return (
          <li key={item.href}>
            <Link
              className="navigation-link"
              href={item.href}
              data-current={active ? 'true' : undefined}
              aria-current={active ? 'page' : undefined}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
              {item.soon ? <span className="navigation-soon">준비 중</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  const settingsActive = current === '/settings' || current.startsWith('/settings/');
  const settings = (
    <Link
      className="navigation-link"
      href="/settings"
      data-current={settingsActive ? 'true' : undefined}
      aria-current={settingsActive ? 'page' : undefined}
    >
      <NavIcon name="settings" />
      <span>설정</span>
    </Link>
  );

  return (
    <>
      {/* 손잡이 바 — 768 미만에서만 보인다. 여기 메뉴를 늘리지 않는다(늘리는 순간 락 8 이
          금지한 상단 헤더 띠가 된다). 지금 어느 사업인지는 바에도 적어 둔다 — 드로어를
          열지 않고도 워크스페이스를 확인할 수 있어야 한다. */}
      <button
        ref={handleRef}
        type="button"
        className="drawer-handle"
        aria-expanded={drawerOpen}
        aria-controls="app-sidebar"
        onClick={() => setDrawerOpen((open) => !open)}
      >
        <span aria-hidden="true" className="drawer-handle-bars"><i /><i /><i /></span>
        <span className="drawer-handle-label">메뉴</span>
        <span className="drawer-handle-program">{programLabels[activeProgram]}</span>
      </button>
      {/* 스크림은 드로어가 열렸을 때만 존재한다. 눌러서 닫는 것이 좁은 화면의 주 동작이다. */}
      {drawerOpen ? (
        <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      ) : null}
      <nav
        ref={drawerRef}
        id="app-sidebar"
        className="sidebar"
        aria-label="주 메뉴"
        data-drawer-open={drawerOpen ? 'true' : undefined}
        tabIndex={-1}
      >
        {/* 기관명이 곧 홈 버튼이다 (2026-07-31 Q 요청). 서비스 로고를 누르면 처음 화면으로
            가는 것은 웹의 보편 관례라, 별도 '홈' 메뉴를 만드는 것보다 배울 것이 적다.
            목적지는 '/' 다 — 마지막 선택 사업을 서버가 읽어 그 일정으로 보낸다(page.tsx).
            여기서 /programs/:type/schedule 로 직접 링크하면 당사자·설정 화면처럼 경로가
            사업을 안 알려주는 곳에서 폴백(첫 사업)으로 새어, 방금 보던 사업과 달라진다. */}
        <div className="sidebar-head">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true"><NavIcon name="org" /></span>
            <span>{orgLabel}</span>
          </Link>
          {/* 드로어 닫기 X — 768 미만에서만 보인다(2026-08-04 Q — 구 하단 '메뉴 닫기' 텍스트
              버튼 대체). 패널 상단 우측은 닫기의 관례 자리라 배우지 않아도 찾는다.
              스크림·Esc 는 그대로 남는 닫는 길이다. */}
          <button type="button" className="drawer-dismiss" aria-label="메뉴 닫기" onClick={() => setDrawerOpen(false)}>
            <NavIcon name="close" />
          </button>
        </div>
        {/* 사업 전환기는 기관명 아래·메뉴 위다 — 아래 모든 메뉴의 범위를 정하므로
            위에 있어야 포함 관계가 눈으로 읽힌다 (ADR-0014 §2). */}
        <ProgramSwitcher
          activeProgram={activeProgram}
          programLabels={programLabels}
        />
        {navigation}
        <div className="sidebar-footer">
          {settings}
          {/* 로그아웃은 설정 아래 마지막이다 — 파괴적이진 않지만 '나가는' 행동이라 메뉴
              흐름의 끝에 둔다. 서버 액션 폼인 이유는 쿠키를 지우는 일이 서버 몫이기 때문이다
              (HttpOnly 라 클라이언트에서 못 지운다). */}
          {/* 테마 전환 (D56). 로그아웃과 같은 이유로 서버 액션 폼이다 — 쿠키를 서버가 쓰고,
              그래야 다음 렌더의 <html data-theme> 이 첫 페인트부터 맞는다. GET 링크로 두면
              프리페치가 테마를 제멋대로 바꾼다.
              라벨은 **가는 곳**을 말한다 — 현재 상태를 말하면 누를 때마다 무엇이 될지 한 번 더
              생각해야 한다. 조사 '로'는 뺀다(2026-08-04 Q — "다크 모드"로 충분히 읽히고 짧다).
              aria-pressed 로 현재 상태는 따로 알린다. */}
          <form action={toggleThemeAction} className="sidebar-logout-form">
            <button
              type="submit"
              className="navigation-link sidebar-logout"
              aria-pressed={theme === 'dark'}
            >
              <NavIcon name={theme === 'dark' ? 'theme-light' : 'theme-dark'} />
              <span>{theme === 'dark' ? '라이트 모드' : '다크 모드'}</span>
            </button>
          </form>
          <form action={logoutAction} className="sidebar-logout-form">
            <button type="submit" className="navigation-link sidebar-logout">
              <NavIcon name="logout" />
              <span>로그아웃</span>
            </button>
          </form>
        </div>
      </nav>
    </>
  );
}
