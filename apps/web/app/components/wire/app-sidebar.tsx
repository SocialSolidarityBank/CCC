'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { ParticipantProgramType } from '../../lib/api';
import { DEFAULT_PROGRAM_TYPE, ORG_LABEL, PROGRAM_LABELS, PROGRAM_TYPES, isKnownProgramType } from '../../lib/labels';

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
    { label: '전체 일정', href: `/programs/${programType}/schedule/all`, icon: 'calendar', soon: true },
    { label: '당사자', href: '/participants', icon: 'participants' },
  ];
}

/** 16px 단색 라인 아이콘(DESIGN.md §4). currentColor 라 활성 항목에서 글자와 같이 물든다. */
function NavIcon({ name }: { name: NavItem['icon'] | 'settings' | 'org' }) {
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
    case 'upcoming':
      return <svg {...common}><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></svg>;
    case 'calendar':
      return <svg {...common}><rect x="2" y="3" width="12" height="11" rx="2" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></svg>;
    case 'participants':
      return <svg {...common}><circle cx="8" cy="5.5" r="2.5" /><path d="M3 13.5c0-2.5 2.2-4 5-4s5 1.5 5 4" /></svg>;
    case 'settings':
      return <svg {...common}><circle cx="8" cy="8" r="2.5" /><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4" /></svg>;
    case 'org':
      return <svg {...common}><path d="M8 1.8l5.4 3.1v6.2L8 14.2 2.6 11.1V4.9z" /></svg>;
  }
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
export function AppSidebar({ programType, activePath }: AppSidebarProps) {
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
  const switchable = PROGRAM_TYPES.length > 1;

  const navigation = (
    <ul className="navigation-list">
      {menu.map((item) => {
        // 하위 경로(예: 당사자 상세)에서도 그 메뉴가 활성으로 남아야 "지금 어디인지"가 유지된다.
        // '/participants' 가 '/participants/new' 까지 먹지 않도록 정확 일치 + 경계(/) 만 본다.
        const active = current === item.href || current.startsWith(`${item.href}/`);
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
        <span className="drawer-handle-program">{PROGRAM_LABELS[activeProgram]}</span>
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
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><NavIcon name="org" /></span>
          <span>{ORG_LABEL}</span>
        </div>
        {/* 사업 전환기는 기관명 아래·메뉴 위다 — 아래 모든 메뉴의 범위를 정하므로
            위에 있어야 포함 관계가 눈으로 읽힌다 (ADR-0014 §2). */}
        <div className="program-switcher">
          <p className="program-switcher-label">사업</p>
          <p className="program-switcher-name" aria-current="true">
            {PROGRAM_LABELS[activeProgram]}
            {switchable && <span aria-hidden="true"> ▾</span>}
          </p>
        </div>
        {navigation}
        <div className="sidebar-footer">{settings}</div>
        {/* 닫기는 드로어일 때만 보인다. 스크림·Esc 외에 **보이는** 탈출구가 하나는 있어야
            한다 — 스크림을 눌러 닫는 것을 모르는 사람이 갇힌다. */}
        <button type="button" className="drawer-close" onClick={() => setDrawerOpen(false)}>메뉴 닫기</button>
      </nav>
    </>
  );
}
