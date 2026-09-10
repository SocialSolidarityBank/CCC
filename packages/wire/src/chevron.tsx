export type ChevronDir = 'up' | 'down' | 'right' | 'left';

/**
 * 네 방향 공용 꺽쇠. 12px 슬롯 안의 한 SVG 경로를 회전해 방향만 바꾼다.
 * 경로 중심은 viewBox 정중앙(6, 6)이라 글줄 옆에서 방향에 따라 흔들리지 않는다.
 */
export function Chevron({ dir }: { dir: ChevronDir }) {
  return (
    <svg
      aria-hidden="true"
      className="wire-chevron"
      data-dir={dir}
      focusable="false"
      viewBox="0 0 12 12"
    >
      <path
        d="M3.3 4.65 6 7.35 8.7 4.65"
        fill="none"
        stroke="var(--chevron-color, var(--sub))"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

export type DisclosureChevronVariant = 'button' | 'plain';

/**
 * 네이티브 details 요약 줄의 상태 표시.
 * button은 일정 기간 이동과 같은 공용 원형 면, plain은 12px 잉크 슬롯만 쓴다.
 */
export function DisclosureChevron({
  variant = 'button',
}: {
  variant?: DisclosureChevronVariant;
}) {
  return (
    <span
      aria-hidden="true"
      className={variant === 'button'
        ? 'wire-disclosure-chevron wire-chevron-button'
        : 'wire-disclosure-chevron'}
      data-variant={variant}
    >
      <Chevron dir="down" />
    </span>
  );
}
