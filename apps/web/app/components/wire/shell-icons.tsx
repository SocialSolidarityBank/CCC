// 셸 공용 16px 단색 라인 아이콘(DESIGN.md §4). currentColor 라 활성 항목에서 글자와 같이 물든다.
// 2026-08-05 app-sidebar.tsx 에서 분리 — 상단 헤더 신설(Q 지시)로 헤더·사이드바 두 부품이
// 같은 아이콘을 쓰게 되어, 한쪽이 다른 쪽을 임포트하는 대신 공용 모듈로 뺐다.

export type ShellIconName =
  | 'upcoming'
  | 'calendar'
  | 'participants'
  | 'settings'
  | 'org'
  | 'logout'
  | 'theme-dark'
  | 'theme-light'
  | 'close';

export function NavIcon({ name }: { name: ShellIconName }) {
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
