'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { adminMenu } from '../../admin/admin-format';

export interface AdminSidebarProps {
  /** 활성 경로. 생략하면 현재 경로로 자동 판단. */
  activePath?: string;
  className?: string;
}

/**
 * 관리자 영역의 2차 내비. **탭이다 — 두 번째 사이드바가 아니다.**
 *
 * 2026-07-26(CCC-18a): 셸이 좌측 사이드바로 바뀌면서 이 컴포넌트가 335px 컬럼으로 남아
 * 있으면 관리자 화면에 내비 기둥이 두 개(240 + 335 = 575px) 서고, "사이드바 = 장소"라는
 * D35 의 축이 어느 쪽인지 읽히지 않는다. 그래서 가로 탭으로 내린다 — 앱 전체의 장소는
 * 좌측 사이드바가, 관리자 안에서의 자리는 이 탭이 알려준다.
 *
 * 시각 계약은 새로 만들지 않았다. DESIGN.md §5 '탭'(활성 = --ink 글자 + 하단 2px solid
 * var(--ink), 비활성 --sub, 색이 아니라 대비로 구분)을 구현한 기존 `.wire-tabs` 를 쓴다.
 */
export function AdminSidebar({ activePath, className }: AdminSidebarProps) {
  const pathname = usePathname();
  const current = activePath ?? pathname;
  const classes = ['wire-tabs', 'wire-admin-tabs', className].filter(Boolean).join(' ');

  return (
    <nav aria-label="관리자 메뉴" className={classes}>
      {adminMenu.map((item) => {
        // '/admin' 은 모든 관리자 경로의 접두어라 하위 경로까지 먹으면 두 탭이 동시에
        // 활성이 된다. 기관(=/admin)만 정확 일치로 보고 나머지는 하위 경로까지 본다.
        const active = item.href === '/admin'
          ? current === '/admin'
          : current === item.href || current.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            className="wire-tab"
            href={item.href}
            data-active={active ? 'true' : undefined}
            aria-current={active ? 'page' : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
