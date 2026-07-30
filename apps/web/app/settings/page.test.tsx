import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AdminSection } from './page';
import { adminMenu } from '../admin/admin-format';

afterEach(cleanup);

// page.tsx 가 lib/api 를 import 하므로 모듈 로드 자체가 @opennextjs/cloudflare 변환에 걸린다.
// AdminSection 은 API 를 쓰지 않지만, 모듈이 로드되도록 최소 목을 둔다.
vi.mock('../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  getMyIdentity: vi.fn(),
  listOrgUsers: vi.fn(),
}));

// 설정 페이지 전체는 async 서버 컴포넌트라 jsdom 에서 렌더할 수 없다.
// AdminSection 은 동기·무데이터 부품이라 직접 렌더해 단언한다(admin-sidebar.test.tsx 패턴).
// 역할 게이트(`me.role === 'admin' ? <AdminSection /> : null`)는 페이지의 자명한 조건문이다.

describe('설정 화면 — 관리자 구역 (CCC-21)', () => {
  it('관리자 구역에 링크 4개가 순서대로 보인다', () => {
    const { container } = render(<AdminSection />);

    expect(container.querySelector('#settings-admin-heading')?.textContent).toBe('관리자');

    const hrefs = Array.from(container.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/admin', '/admin/assign', '/admin/users', '/admin/invite']);
  });

  it('링크 목록이 관리자 탭 정의(adminMenu)와 같다 — /admin/settings 만 제외', () => {
    // 두 곳이 어긋나지 않도록 같은 정의를 재사용하는지 고정한다.
    const expected = adminMenu
      .filter((item) => item.href !== '/admin/settings')
      .map((item) => item.href);
    expect(expected).toEqual(['/admin', '/admin/assign', '/admin/users', '/admin/invite']);
  });
});
