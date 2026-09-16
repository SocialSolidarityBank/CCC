import { useEffect, useRef, useState, type ReactNode } from 'react';
import { NavIcon } from '../../../../apps/web/app/components/wire/shell-icons';
import { api } from '../lib/api';

/**
 * 프로토타입 셸. 운영 AppHeader/AppSidebar 와 같은 클래스·마크업을 쓰되
 * 서버 액션(테마·로그아웃 폼)과 Next 라우터 의존은 뺀다.
 * 메뉴는 프로토타입에 실제로 있는 화면만 둔다 — 일정·초대는 아직 없다.
 */

const NAV_SECTIONS = [
  {
    title: '당사자',
    items: [
      { label: '당사자 목록', href: '#/', icon: 'participants' as const, match: (r: string) => r === '/' || r === '/participants' || (r.startsWith('/participants/') && r !== '/participants/new') },
      { label: '당사자 등록', href: '#/participants/new', icon: 'participant-add' as const, staffOnly: true, match: (r: string) => r === '/participants/new' },
    ],
  },
];

function OrgMark() {
  return (
    <span className="org-switcher">
      <span className="program-switcher-box" style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <NavIcon name="org" />
        <span className="program-switcher-name">Relayer 프로토타입</span>
      </span>
    </span>
  );
}

export function Shell({
  route,
  me,
  onLogout,
  children,
}: {
  route: string;
  me: { id: string; role: string; label: string };
  onLogout: () => void;
  children: ReactNode;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const drawerRef = useRef<HTMLElement>(null);
  const handleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { setDrawerOpen(false); }, [route]);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const sync = () => setMobile(media.matches);
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    drawerRef.current?.focus({ preventScroll: true });
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      handleRef.current?.focus({ preventScroll: true });
    };
  }, [drawerOpen]);

  const logout = () => api.logout().then(onLogout).catch(onLogout);

  const navigation = (
    <div className="navigation-groups">
      {NAV_SECTIONS.map((section) => {
        const titleId = `nav-section-${section.title}`;
        return (
          <div className="navigation-group" key={section.title}>
            <p className="navigation-section-title" id={titleId}>{section.title}</p>
            <ul className="navigation-list" aria-labelledby={titleId}>
              {section.items.map((item) => {
                if ('staffOnly' in item && item.staffOnly && me.role !== 'staff') return null;
                const active = item.match(route);
                return (
                  <li key={item.href}>
                    <a
                      className="navigation-link"
                      href={item.href}
                      data-current={active ? 'true' : undefined}
                      aria-current={active ? 'page' : undefined}
                    >
                      <NavIcon name={item.icon} />
                      <span>{item.label}</span>
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="wire-shell app-shell">
      <header className="app-header">
        <OrgMark />
        <span className="header-divider" aria-hidden="true" />
        <span style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--ink)' }}>
          {me.label}({me.id})
        </span>
        <div className="header-actions">
          <button type="button" className="header-icon-button" aria-label="로그아웃" title="로그아웃" onClick={logout}>
            <NavIcon name="logout" />
          </button>
        </div>
      </header>

      <div className="drawer-bar">
        <OrgMark />
        <span className="panel-meta">{me.label}({me.id})</span>
        <button
          ref={handleRef}
          type="button"
          className="header-icon-button drawer-handle"
          aria-label="메뉴"
          title="메뉴"
          aria-expanded={drawerOpen}
          aria-controls="app-sidebar"
          onClick={() => setDrawerOpen((v) => !v)}
        >
          <NavIcon name="sidebar" />
        </button>
      </div>
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
        aria-hidden={mobile && !drawerOpen ? true : undefined}
        inert={mobile && !drawerOpen ? true : undefined}
        tabIndex={-1}
      >
        <div className="sidebar-head">
          <button type="button" className="header-icon-button drawer-dismiss" aria-label="메뉴 닫기" title="메뉴 닫기" onClick={() => setDrawerOpen(false)}>
            <NavIcon name="sidebar" />
          </button>
          <div className="sidebar-actions">
            <button type="button" className="header-icon-button" aria-label="로그아웃" title="로그아웃" onClick={logout}>
              <NavIcon name="logout" />
            </button>
          </div>
        </div>
        {navigation}
      </nav>

      <div className="content-column">
        <nav className="page-backbar" aria-label="페이지 이동">
          <BackButton />
        </nav>
        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}

export function BackButton() {
  const [canGoBack, setCanGoBack] = useState(false);
  useEffect(() => { setCanGoBack(window.history.length > 1); }, []);
  if (!canGoBack) return null;
  return (
    <button type="button" className="page-back" onClick={() => history.back()}>
      <svg className="wire-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        <path d="M10 3 5 8l5 5" />
      </svg>
      <span>뒤로</span>
    </button>
  );
}
