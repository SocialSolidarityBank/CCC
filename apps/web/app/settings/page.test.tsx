import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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

  it('링크 목록이 관리자 탭 정의(adminMenu)와 그대로 같다', () => {
    // 두 곳이 어긋나지 않도록 같은 정의를 재사용하는지 고정한다.
    // CCC-55 로 걸러낼 것이 없어졌다 — 구 '/admin/settings' 는 라우트도 메뉴 항목도 사라졌다.
    expect(adminMenu.map((item) => item.href)).toEqual(['/admin', '/admin/assign', '/admin/users', '/admin/invite']);
    expect(adminMenu.some((item) => item.href === '/admin/settings')).toBe(false);
  });

  // CCC-55 완료 기준: 설정 화면은 한 곳이고 중첩 main 이 없다.
  // 구 '/admin/settings' 는 이 화면을 그대로 재수출해 관리자 레이아웃(<main>) 안에서
  // 또 <main> 을 열었다. 라우트 파일이 없다는 것이 그 두 가지를 동시에 보장한다.
  // 이 화면이 async 서버 컴포넌트라 jsdom 에서 통째로 렌더할 수 없어, 렌더 대신 라우트
  // 자체의 부재로 못박는다.
  it('설정 화면은 /settings 한 곳뿐이다 — 관리자 영역에 사본 라우트가 없다', () => {
    // 경로 기준은 vitest 루트(apps/web)다. import.meta.url 은 변환된 가상 경로라 여기서
    // 파일을 못 찾는다 — 그러면 두 단언이 다 false 가 되어 검사가 조용히 헛돈다.
    // 아래 '있어야 하는 쪽'이 그 대조군이다. 지우지 말 것.
    const route = (relative: string) => resolve(process.cwd(), 'app', relative);
    expect(existsSync(route('admin/settings/page.tsx'))).toBe(false);
    expect(existsSync(route('settings/page.tsx'))).toBe(true);
  });

  // 이 탭줄은 '관리자 영역 안의 장소'만 나열한다. 밖으로 나가는 주소가 섞이면 누르는 순간
  // 레이아웃과 함께 탭줄이 사라진다 — 설정이 그래서 빠졌다.
  it('관리자 메뉴는 전부 /admin 안의 주소다', () => {
    for (const item of adminMenu) {
      expect(item.href === '/admin' || item.href.startsWith('/admin/')).toBe(true);
    }
  });
});
