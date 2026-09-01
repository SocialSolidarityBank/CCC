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

export type DisclosureChevronSize = 'md' | 'sm';
export type DisclosureChevronFrame = 'circle' | 'none';

/** 네이티브 details 요약 줄의 상태 슬롯. 잉크는 위 Chevron 한 벌만 쓴다. */
export function DisclosureChevron({
  size = 'md',
  frame = 'circle',
}: {
  size?: DisclosureChevronSize;
  frame?: DisclosureChevronFrame;
}) {
  return (
    <span
      aria-hidden="true"
      className="wire-disclosure-chevron"
      data-frame={frame === 'circle' ? undefined : frame}
      data-size={size === 'md' ? undefined : size}
    >
      <Chevron dir="down" />
    </span>
  );
}
