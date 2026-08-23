import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AdminSidebar } from './admin-sidebar';

// usePathname 은 App Router 컨텍스트를 요구하므로 테스트에서는 목으로 대체한다.
// activePath 를 명시하면 현재 경로와 무관하게 활성 항목을 파생한다.
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

afterEach(cleanup);

describe('AdminSidebar', () => {
  it('activePath 로 정확히 한 항목만 활성 표시(data-active·aria-current)한다', () => {
    const { container } = render(<AdminSidebar activePath="/admin/users" />);
    const active = container.querySelectorAll('a[data-active="true"]');
    expect(active).toHaveLength(1);
    expect(active[0]?.getAttribute('href')).toBe('/admin/users');
    expect(active[0]?.getAttribute('aria-current')).toBe('page');
  });

  it("'/admin' 은 모든 관리자 경로의 접두어라 하위 경로에서 기관 탭이 같이 켜지지 않는다", () => {
    // 기관만 정확 일치로 보지 않으면 /admin/users 에서 기관·사용자 두 탭이 동시에 활성이 된다.
    const { container } = render(<AdminSidebar activePath="/admin/users/abc" />);
    const active = Array.from(container.querySelectorAll('a[data-active="true"]'));
    expect(active.map((anchor) => anchor.getAttribute('href'))).toEqual(['/admin/users']);
  });

  it('가로 탭으로 렌더한다 — 셸 사이드바 옆에 두 번째 기둥을 세우지 않는다', () => {
    const { container } = render(<AdminSidebar activePath="/admin" />);
    expect(container.querySelector('.wire-admin-sidebar')).toBeNull();
    expect(container.querySelector('nav.wire-tabs')).not.toBeNull();
  });

  // CCC-55: '설정' 탭은 뺐다. 설정은 관리자 영역 밖의 화면이고, 셸 헤더·사이드바의 톱니바퀴
  // 버튼이 관리자 화면에서도 늘 보인다. 탭으로 두면 누르는 순간 이 탭줄 자체가 사라졌다.
  it('기관·배정·사용자·실무자 초대 4개 메뉴를 순서대로 렌더한다', () => {
    const { container } = render(<AdminSidebar activePath="/admin" />);
    const hrefs = Array.from(container.querySelectorAll('a')).map((anchor) => anchor.getAttribute('href'));
    expect(hrefs).toEqual(['/admin', '/admin/assign', '/admin/users', '/admin/invite', '/admin/ai-provider']);
    // 관리자 레이아웃 밖으로 나가는 링크는 이 탭줄에 두지 않는다.
    expect(hrefs).not.toContain('/settings');
  });
});
