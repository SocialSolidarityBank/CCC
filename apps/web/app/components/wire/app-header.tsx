'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NavIcon } from './shell-icons';
import { OrgSwitcher } from './org-switcher';
import { ProgramSwitcher, resolveActiveProgram } from './program-switcher';
import { logoutAction } from '../../logout-action';
import { toggleThemeAction } from '../../theme-action';
import type { Theme } from '../../lib/theme-cookie';
import type { ParticipantProgramType } from '../../lib/api';
import { ORG_LABEL, PROGRAM_LABELS } from '../../lib/labels';

// 상단 헤더 (2026-08-05 Q 지시, Infisical 레퍼런스 — 구 락 8 "상단 헤더 띠 금지" 대체).
//
// 셸의 축이 두 층으로 갈린다: **헤더 = 맥락(기관·사업) + 계정 행동(설정·테마·로그아웃)** /
// **사이드바 = 장소(메뉴)**. D50 이 사이드바에 두었던 기관명(=홈)·사업 전환기·로그아웃과
// D56 의 테마 토글, D35 의 설정 항목이 전부 이리로 옮겨 왔다 — 배선(홈 링크 '/', 서버 액션
// 폼, 전환기 동작)은 그대로고 자리만 바뀌었다.
//
// 헤더는 **화면 전체 폭의 캔버스 띠**다(2026-08-05 Q — 셸 그리드 1행, 사이드바 위까지 확장).
// 배경 면(그라데이션)은 없고, 본문과는 **하단 1px 그라데이션 라인**으로만 갈린다 — 같은 날
// Q 지시 두 번의 결과: ① "배경 그라데이션 없애고 라인으로만" ② "영역 구분은 그라데이션
// 3색 라인으로"(사이드바 면 배경도 함께 폐지, 오른쪽 세로 라인으로 대체).
// 좌우 패딩 24 라 기관 마크가 사이드바 메뉴 아이콘과 같은 좌측선(24)에 선다.
// 사업명은 상자 없이 **텍스트 + 화살표**다('사업' 라벨은 화면에서 뺀다 — 접근 이름에는 남는다).
//
// 768 미만에는 이 헤더가 없다 — 드로어(AppSidebar)가 기관·사업·메뉴·하단 묶음을 전부 담는
// 기존 구조 그대로다(DESIGN.md §4-4). 그래서 전환기·기관명이 DOM 에 두 벌 있지만 미디어
// 쿼리로 한쪽만 보인다(useId 가 id 충돌을 막는다).

export interface AppHeaderProps {
  /** 워크스페이스 폴백 — AppSidebar 와 같은 계약(경로가 사업을 안 알려주는 화면용). */
  programType?: string;
  /** 활성 경로. 생략하면 현재 경로로 자동 판단. */
  activePath?: string;
  /** 온보딩이 저장한 기관 이름 (CCC-32). 생략하면 labels.ts 하드코딩 라벨. */
  orgLabel?: string;
  /** 온보딩이 저장한 사업 표시 이름 매핑 (CCC-32). 생략하면 labels.ts 폴백. */
  programLabels?: Record<ParticipantProgramType, string>;
  /** 현재 테마 (D56 · ADR-0026). 루트 레이아웃이 쿠키에서 읽어 넣는다. */
  theme?: Theme;
}

export function AppHeader({
  programType,
  activePath,
  orgLabel = ORG_LABEL,
  programLabels = PROGRAM_LABELS,
  theme = 'light',
}: AppHeaderProps) {
  const pathname = usePathname();
  const current = activePath ?? pathname;
  const activeProgram = resolveActiveProgram(current, programType);
  const settingsActive = current === '/settings' || current.startsWith('/settings/');

  return (
    <header className="app-header">
      {/* 기관명도 선택창이다 (2026-08-05 Q 2차 — Infisical·OpenAI 레퍼런스, 구 홈 링크 대체.
          D50 홈 배선은 목록 안으로 옮겨 갔다 — 기관을 고르면 그 기관의 홈 '/' 로 간다). */}
      <OrgSwitcher orgLabel={orgLabel} />
      {/* 기관 | 사업 구분은 1px 세로 선이다 — 글자 구분자(/·|)를 쓰지 않는 문안 규칙(§10)과 맞다. */}
      <span className="header-divider" aria-hidden="true" />
      <ProgramSwitcher activeProgram={activeProgram} programLabels={programLabels} />
      <div className="header-actions">
        {/* 계정 행동 3개는 아이콘 원형 버튼이다 — 드로어 닫기 X 와 같은 세컨더리 옷(그라데이션
            1px 테두리 + --panel 채움, 32×32 원). 라벨은 aria-label + title 로 남긴다. */}
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
        {/* 테마 전환 (D56). 서버 액션 폼인 이유는 쿠키를 서버가 써야 다음 렌더의
            <html data-theme> 이 첫 페인트부터 맞기 때문이다. GET 링크로 두면 프리페치가
            테마를 제멋대로 바꾼다. 라벨은 **가는 곳**을 말한다(§11). */}
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
        {/* 로그아웃 — 쿠키를 지우는 일이 서버 몫이라 서버 액션 폼이다(HttpOnly). */}
        <form action={logoutAction} className="header-action-form">
          <button type="submit" className="header-icon-button" aria-label="로그아웃" title="로그아웃">
            <NavIcon name="logout" />
          </button>
        </form>
      </div>
    </header>
  );
}
