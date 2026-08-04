'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NavIcon } from './shell-icons';
import { ProgramSwitcher, resolveActiveProgram } from './program-switcher';
import { logoutAction } from '../../logout-action';
import { toggleThemeAction } from '../../theme-action';
import type { Theme } from '../../lib/theme-cookie';
import type { ParticipantProgramType } from '../../lib/api';
import { ORG_LABEL, PROGRAM_LABELS } from '../../lib/labels';

// 앱 셸의 좌측 사이드바 (D35 · ADR-0014 §2). 축은 **사이드바 = 장소 / 페이지 우상단 = 행동**이라
// 등록 2개(상담·당사자)는 여기 넣지 않는다 — 섞이면 누를 때마다 "화면이 바뀌는 것"과
// "새로 만드는 것"을 판별해야 한다.
//
// 2026-08-05 Q — 상단 헤더 신설(Infisical 레퍼런스)로 축이 한 층 더 갈렸다:
// **헤더 = 맥락(기관·사업) + 계정 행동(설정·테마·로그아웃) / 사이드바 = 장소(메뉴)**.
// 데스크톱(768 이상) 사이드바에는 메뉴만 남는다. 아래 마크업의 머리(기관명)·사업 전환기·
// 하단 묶음은 지우지 않았다 — **768 미만 드로어가 그대로 쓴다**(헤더는 좁은 화면에 없어,
// 드로어가 기관·사업·메뉴·계정 행동을 전부 담는 기존 구조가 유지된다). 데스크톱에서는
// CSS(layout.tsx `.sidebar-mobile` 규칙)가 그 블록들을 숨긴다.
//
// 시각 계약은 DESIGN.md §4·§5 가 정본이고 여기서 새로 정하지 않는다 — 폭 280(--sidebar-width),
// 배경은 캔버스 + 오른쪽 1px 그라데이션 라인(2026-08-05 Q — 구 --gradient-sidebar 면 폐지),
// 활성 항목 --blue-tint 배경 + --gradient-brand 테두리. 클래스는 layout.tsx 의
// .sidebar / .navigation-link / .sidebar-footer 를 그대로 쓴다.

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
 * 좌측 사이드바(280px). **768px 미만에서는 같은 마크업이 드로어로 변한다**(DESIGN.md §4-4) —
 * 평소엔 화면 밖에 있고 상단 손잡이 바(56px)를 눌러야 왼쪽에서 밀려 들어온다.
 *
 * 이전에는 모바일용 가로 내비를 따로 렌더했는데 두 가지가 잘못돼 있었다: 계약이 정한 드로어가
 * 아니었고, 기관명과 **사업 전환기가 빠져 있어 좁은 화면에서는 지금 어느 사업인지 볼 수도
 * 바꿀 수도 없었다.** 마크업을 한 벌로 합치면 그 갈라짐이 구조적으로 사라진다.
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
  // 워크스페이스 판정은 헤더와 같은 헬퍼를 쓴다(program-switcher.tsx) — 두 부품이 다른
  // 사업을 가리키면 메뉴와 전환기가 어긋난다.
  const activeProgram = resolveActiveProgram(current, programType);
  const menu = programMenu(activeProgram);

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
      {/* 손잡이 바 = 좁은 화면의 헤더 — 768 미만에서만 보인다. 내용은 메뉴 버튼뿐이다
          (2026-08-05 Q ④ "모바일에선 헤더에 메뉴만 두고 전부 사이드바로" — 구 '현재 사업명'
          표기를 뺐다. 사업 확인·전환은 드로어 안 전환기가 맡는다). */}
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
        {/* ── 머리·사업 전환기·하단 묶음 세 블록은 **드로어 전용**이다(2026-08-05 Q —
            데스크톱에서는 상단 헤더가 같은 내용을 담는다. app-header.tsx 참조).
            마크업을 지우지 않고 CSS(768 이상 display:none)로 숨기는 이유: 드로어가 이 블록들을
            그대로 쓰고, 마크업 두 벌(모바일용/데스크톱용)을 두면 다시 갈라지기 때문이다. ── */}
        {/* 기관명이 곧 홈 버튼이다 (2026-07-31 Q 요청). 목적지는 '/' — 마지막 선택 사업을
            서버가 읽어 그 일정으로 보낸다(page.tsx). */}
        <div className="sidebar-head">
          <Link className="brand" href="/">
            <span className="brand-mark" aria-hidden="true"><NavIcon name="org" /></span>
            <span>{orgLabel}</span>
          </Link>
          {/* 드로어 닫기 X (2026-08-04 Q — 구 하단 '메뉴 닫기' 텍스트 버튼 대체).
              패널 상단 우측은 닫기의 관례 자리라 배우지 않아도 찾는다.
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
