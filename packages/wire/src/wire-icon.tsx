/**
 * 16px 단색 라인 아이콘 공용 부품 (D58/ADR-0028 결정 7 · CCC-49).
 *
 * 사이드바 NavIcon 과 같은 계약이다: viewBox 16 · stroke 1.5 · currentColor · 라운드
 * 캡 — 글자색을 따라 물든다. 문자 글리프(⚠·✓·●·○ 등)를 아이콘 대용으로 쓰지 않는다
 * (§7 락 5) — OS·폰트마다 렌더가 다르고 다크 모드에서 색 제어가 안 된다.
 *
 * 크기는 §3-4 를 따른다: 내비·인라인 16(기본), 카드 헤더 18. 예외적으로 기존 CSS 가
 * 폭을 못 박은 자리(사업 전환기 체크 14)는 그 값을 넘긴다.
 */
export type IconName =
  | 'check'
  | 'warning'
  | 'dot'
  | 'dot-empty'
  | 'arrow-right'
  | 'arrow-up'
  | 'arrow-down'
  // 반복 칸 추가·삭제(WireRepeatActions, 2026-08-09 Q "'+', '-' 로 해도 돼").
  | 'plus'
  | 'minus';

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
    className: ['wire-icon', className].filter(Boolean).join(' '),
  };
  switch (name) {
    case 'check':
      return <svg {...common}><path d="M3 8.5l3.2 3.2L13 4.8" /></svg>;
    case 'warning':
      return <svg {...common}><path d="M8 2.2 14.6 13.4H1.4Z" /><path d="M8 6.6v2.8" /><path d="M8 11.7h.01" /></svg>;
    case 'dot':
      return <svg {...common}><circle cx="8" cy="8" r="4" fill="currentColor" stroke="none" /></svg>;
    case 'dot-empty':
      return <svg {...common}><circle cx="8" cy="8" r="4" /></svg>;
    case 'arrow-right':
      return <svg {...common}><path d="M2.5 8h11M9 3.5 13.5 8 9 12.5" /></svg>;
    case 'arrow-up':
      return <svg {...common}><path d="M8 13.5v-11M3.5 7 8 2.5 12.5 7" /></svg>;
    case 'arrow-down':
      return <svg {...common}><path d="M8 2.5v11M3.5 9 8 13.5 12.5 9" /></svg>;
    case 'plus':
      return <svg {...common}><path d="M8 3.5v9M3.5 8h9" /></svg>;
    case 'minus':
      return <svg {...common}><path d="M3.5 8h9" /></svg>;
  }
}
