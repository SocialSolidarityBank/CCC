// 하니스 생성기(apps/web/app/kit/hierarchy-harness.test.tsx)가 이 스크립트에서 CSS 추출기를
// 가져다 쓴다. 추출기를 두 벌 두면 검사와 하니스가 서로 다른 CSS 를 보게 되므로 한 벌만 둔다.
// 스크립트 본체는 순수 JS 라(레포의 다른 guard 들과 같다) 형태만 여기 적어 준다.

/** 파일에서 백틱 템플릿 리터럴 본문만 모은다. 줄 번호는 파일 기준으로 보존한다. */
export function extractCss(file: string): string;

/** layout.tsx의 shellStyles 식과 같은 캐스케이드 순서로 CSS를 조립한다. */
export function composeRuntimeCss(file: string, injectedWireStyles: string): string;

export interface HierarchyRecord {
  key: string;
  file: string;
  line: number;
  selector: string;
  combo: string;
  missing: string[];
}

export function audit(sources?: { file: string; css: string }[]): {
  violations: HierarchyRecord[];
  unresolved: HierarchyRecord[];
};

export function compare(
  violations: { key: string }[],
  baselineEntries: string[],
): { fresh: { key: string }[]; stale: string[] };
