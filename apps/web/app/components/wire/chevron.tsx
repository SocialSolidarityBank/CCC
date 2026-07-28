export type ChevronDir = 'down' | 'right';

/** 그레이스케일 체브론. down=펼침/아래, right=닫힘/오른쪽. */
export function Chevron({ dir }: { dir: ChevronDir }) {
  return <span aria-hidden="true" className="wire-chevron" data-dir={dir} />;
}
