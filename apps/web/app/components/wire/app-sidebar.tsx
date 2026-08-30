'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { NavIcon } from './shell-icons';
import { WireBadge } from './wire-badge';
import { OrgSwitcher } from './org-switcher';
import { ProgramSwitcher, resolveActiveProgram } from './program-switcher';
import { logoutAction } from '../../logout-action';
import { clearAllDrafts } from '../../lib/form-draft';
import { toggleThemeAction } from '../../theme-action';
import type { Theme } from '../../lib/theme-cookie';
import type { ParticipantProgramType } from '../../lib/api';
import { ORG_LABEL, PROGRAM_LABELS } from '../../lib/labels';

// 앱 셸의 좌측 사이드바 (D35 · ADR-0014 §2). 축은 **사이드바 = 장소 / 페이지 우상단 = 행동**
// 이었으나, **2026-08-30 Q 부분 개정**으로 등록·초대 화면은 하위 메뉴(장소)로도 선다 —
// "사이드바에 페이지를 모두 보여주고 하위 서브 메뉴 신설": 일정 > 상담 등록, 당사자 >
// 당사자 등록·당사자 초대. 우상단 행동 버튼은 그대로다(두 입구 공존, DESIGN.md §4-5).
//
// 2026-08-05 Q — 상단 헤더 신설(Infisical 레퍼런스)로 축이 한 층 더 갈렸다:
// **헤더 = 맥락(기관·사업) + 계정 행동(설정·테마·로그아웃) / 사이드바 = 장소(메뉴)**.
// 2026-08-06 Q — 좁은 화면도 같은 축이다: **모바일 바 = 맥락(기관·사업 선택창) + 메뉴 버튼**,
// **드로어 = 계정 행동(상단 줄) + 메뉴**. 드로어의 기관명·사업 전환기 블록은 뺐다(바가 전담).
// 상단 줄은 데스크톱에서 CSS(768 이상 display:none)로 숨는다 — 데스크톱 계정 행동은 헤더 몫.
//
// 시각 계약은 DESIGN.md §4·§5 가 정본이고 여기서 새로 정하지 않는다 — 폭 280(--sidebar-width),
// 배경은 캔버스 + 오른쪽 1px 그라데이션 라인(2026-08-05 Q — 구 --gradient-sidebar 면 폐지),
// 활성 항목 --blue-tint 배경 + --gradient-brand 테두리. 클래스는 layout.tsx 의
// .sidebar / .navigation-link / .sidebar-head / .sidebar-actions 를 그대로 쓴다.

type NavIconName = 'upcoming' | 'calendar' | 'participants' | 'participant-add' | 'invite';

interface NavItem {
  label: string;
  href: string;
  icon: NavIconName;
  /** 아직 화면이 없는 메뉴. 누르기 전에 알린다 — 눌러 보고 실망하지 않게 (CCC-23). */
  soon?: boolean;
  /**
   * 하위 메뉴(2026-08-30 Q). 부모와 같은 내비 옷이고 **아이콘도 전부 갖는다**(같은 날 Q 2차
   * "적당한 아이콘은 모두 넣되"). 층은 들여쓰기와 왼쪽 세로선이 말한다.
   */
  children?: { label: string; href: string; icon: NavIconName }[];
}

/**
 * 사업 범위 안의 메뉴. '오늘 상담'을 따로 두지 않는 것은 의도다 — 오늘+다가오는이 한 화면에
 * 있어야 "오늘 걸 보려면 어느 메뉴지"를 판단하지 않는다 (ADR-0014 §2).
 * '다가오는 일정'과 '전체 일정' 두 메뉴는 D75(ADR-0039)로 `일정` 하나가 됐다 — 두 창의
 * 경계는 메뉴가 아니라 화면 안 범위 전환(다가오는 7일 | 월 전체)이 말한다.
 */
function programMenu(programType: ParticipantProgramType): NavItem[] {
  return [
    {
      label: '일정',
      href: `/programs/${programType}/schedule`,
      icon: 'upcoming',
      children: [{ label: '상담 일정 등록', href: '/schedules/new', icon: 'calendar' }],
    },
    {
      label: '당사자',
      href: '/participants',
      icon: 'participants',
      children: [
        { label: '당사자 등록', href: '/participants/new', icon: 'participant-add' },
        { label: '당사자 초대', href: '/participants/invite', icon: 'invite' },
      ],
    },
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
   * CCC-26 '참여자' 메뉴의 미확인 새 가입 숫자. 루트 레이아웃이 서버에서 읽어 넣는다.
   * 0 이거나 undefined 면 배지를 그리지 않는다.
   */
  newSignupCount?: number;
  /**
   * 현재 테마 (D56 · ADR-0026). 루트 레이아웃이 쿠키에서 읽어 넣는다 — 여기서 직접 읽지
   * 않는 이유는 이 컴포넌트가 클라이언트이고 쿠키 판정은 첫 페인트 전에 끝나 있어야 하기
   * 때문이다. 생략하면 라이트로 그린다(테스트·스토리 렌더가 지금까지처럼 동작한다).
   */
  theme?: Theme;
}

/**
 * 좌측 사이드바(280px). **768px 미만에서는 같은 마크업이 드로어로 변한다**(DESIGN.md §4-4) —
 * 평소엔 화면 밖에 있고 바 오른쪽 끝의 메뉴 버튼을 눌러야 **오른쪽에서** 밀려 들어온다
 * (2026-08-06 Q — 여는 버튼과 같은 쪽이어야 손과 눈이 이어진다).
 */
export function AppSidebar({
  programType,
  activePath,
  orgLabel = ORG_LABEL,
  programLabels = PROGRAM_LABELS,
  theme = 'light',
  newSignupCount = 0,
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
    // preventScroll: 슬라이드 중 기본 스크롤 보정이 끼면 화면이 미세하게 튄다.
    drawerRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
      // 닫을 때 손잡이로 초점을 돌려준다(열기 전 자리).
      handleRef.current?.focus({ preventScroll: true });
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
  // 선택된 것처럼 보였다). 하위 메뉴도 같은 풀에서 겨룬다(2026-08-30) — /participants/new
  // 에서는 '당사자 등록'(더 긴 href) 하나만 켜지고 부모 '당사자'는 쉰다.
  const allEntries = menu.flatMap((item) => [
    { href: item.href },
    ...(item.children ?? []).map((child) => ({ href: child.href })),
  ]);
  const matches = allEntries.filter((item) => current === item.href || current.startsWith(`${item.href}/`));
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
              {/* CCC-26: 새 가입 미확인 숫자 — 사람·소속 축의 민트 배지(WireBadge 계약).
                  확인 행위로 사라지는 값이라 재방문 시 자리가 안 흔들린다. */}
              {item.icon === 'participants' && newSignupCount > 0 && (
                <WireBadge tone="mint" role="status">{newSignupCount}</WireBadge>
              )}
            </Link>
            {item.children !== undefined && (
              <ul className="navigation-sublist">
                {item.children.map((child) => {
                  const childActive = child.href === activeHref;
                  return (
                    <li key={child.href}>
                      <Link
                        className="navigation-link"
                        href={child.href}
                        data-current={childActive ? 'true' : undefined}
                        aria-current={childActive ? 'page' : undefined}
                      >
                        <NavIcon name={child.icon} />
                        <span>{child.label}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );

  const settingsActive = current === '/settings' || current.startsWith('/settings/');

  return (
    <>
      {/* 모바일 바 = 좁은 화면의 헤더 — 768 미만에서만 보인다. 2026-08-05 Q 2차(같은 날 ④
          "메뉴만" 대체): **좌측 = 기관·사업 선택창**(데스크톱 헤더와 같은 내용 — "웹화면,
          모바일화면 동시수정"), **우측 = 원형 사이드바 버튼**(구 좌측 햄버거+'메뉴' 글자 대체).
          Infisical·OpenAI 플랫폼처럼 여러 기관·사업을 고르는 흐름이 전제다. */}
      <div className="drawer-bar">
        <OrgSwitcher orgLabel={orgLabel} />
        <span className="header-divider" aria-hidden="true" />
        <ProgramSwitcher activeProgram={activeProgram} programLabels={programLabels} />
        <button
          ref={handleRef}
          type="button"
          className="header-icon-button drawer-handle"
          aria-label="메뉴"
          title="메뉴"
          aria-expanded={drawerOpen}
          aria-controls="app-sidebar"
          onClick={() => setDrawerOpen((open) => !open)}
        >
          <NavIcon name="sidebar" />
        </button>
      </div>
      {/* 스크림은 늘 마운트하고 열림 상태만 바꾼다(2026-08-06 Q "부자연") — 조건 마운트면
          닫는 순간 어둠이 뚝 사라지고 드로어만 남아 미끄러진다. 눌러서 닫는 것이 좁은
          화면의 주 동작이다(닫힘 상태는 pointer-events:none 이라 본문을 막지 않는다). */}
      <div
        className="drawer-scrim"
        data-open={drawerOpen ? 'true' : undefined}
        onClick={() => setDrawerOpen(false)}
        aria-hidden="true"
      />
      <nav
        ref={drawerRef}
        id="app-sidebar"
        className="sidebar"
        aria-label="주 메뉴"
        data-drawer-open={drawerOpen ? 'true' : undefined}
        tabIndex={-1}
      >
        {/* ── 드로어 = 계정 행동 + 메뉴 (2026-08-06 Q — 구 기관명·사업 전환기 블록 제거:
            그 맥락은 모바일 바가 전담한다. 두 벌 두면 다시 갈라진다).
            상단 줄 = **드로어 버튼(좌) + 설정·테마·로그아웃(우)** (2026-08-06 Q 2차 — 구
            '계정 행동 좌 + 닫기 X 우' 반전. 닫기는 X 가 아니라 여는 버튼과 같은 사이드바
            아이콘·같은 32 원형이다 — 한 버튼이 여닫는 토글로 읽힌다). 라벨은 aria-label +
            title 이 갖는다. 테마·로그아웃이 서버 액션 폼인 이유는 쿠키를 서버가 써야 하기
            때문이다(HttpOnly · 첫 페인트 테마 일치). 테마 라벨은 **가는 곳**을 말한다(§11) —
            aria-pressed 로 현재 상태는 따로 알린다. ── */}
        <div className="sidebar-head">
          {/* 스크림·Esc 는 그대로 남는 닫는 길이다. */}
          <button type="button" className="header-icon-button drawer-dismiss" aria-label="메뉴 닫기" title="메뉴 닫기" onClick={() => setDrawerOpen(false)}>
            <NavIcon name="sidebar" />
          </button>
          <div className="sidebar-actions">
            <Link
              className="header-icon-button"
              href="/settings"
              aria-label="설정"
              title="설정"
              data-current={settingsActive ? 'true' : undefined}
              aria-current={settingsActive ? 'page' : undefined}
            >
              <NavIcon name="settings" />
            </Link>
            <form action={toggleThemeAction} className="header-action-form">
              <button
                type="submit"
                className="header-icon-button"
                aria-label={theme === 'dark' ? '라이트 모드' : '다크 모드'}
                title={theme === 'dark' ? '라이트 모드' : '다크 모드'}
                aria-pressed={theme === 'dark'}
              >
                <NavIcon name={theme === 'dark' ? 'theme-light' : 'theme-dark'} />
              </button>
            </form>
            {/* 로그아웃 직전에 이 브라우저의 작성 중 임시본을 전부 지운다(P0-9 · CCC-111) —
            서버 액션은 localStorage 를 만질 수 없고, 공용 기기에서 다음 사용자에게
            작성 중 내용이 남으면 안 된다. */}
        <form action={logoutAction} onSubmit={clearAllDrafts} className="header-action-form">
              <button type="submit" className="header-icon-button" aria-label="로그아웃" title="로그아웃">
                <NavIcon name="logout" />
              </button>
            </form>
          </div>
        </div>
        {navigation}
      </nav>
    </>
  );
}
