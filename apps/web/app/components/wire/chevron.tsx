export type ChevronDir = 'down' | 'right' | 'left';

/** 그레이스케일 체브론. down=펼침/아래, right=닫힘/오른쪽, left=이전(달 이동). */
export function Chevron({ dir }: { dir: ChevronDir }) {
  return <span aria-hidden="true" className="wire-chevron" data-dir={dir} />;
}
