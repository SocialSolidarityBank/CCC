"""정렬 실측 게이트 — "정렬을 눈대중이 아니라 픽셀로 증명" (2026-08-30 Q).

align-check 스킬(~/developer/tools/align-tools/align-check.mjs)의 선언·판정 계약을 이 레포의
브라우저 레인(python playwright + 정적 하니스)으로 옮긴 것이다. 원본은 node playwright 를
cwd 에서 해석하는데 이 워크스페이스에는 node playwright 가 없고, 실측 레인은 이미
python playwright(hierarchy-measure.py)로 서 있다 — 브라우저 스택을 둘로 늘리지 않는다.

재는 대상은 `artifacts/align-harness/align.html` 이고, 그 파일은 **실제 부품으로** 렌더한
것이다(생성기: apps/web/app/kit/align-harness.test.tsx — 위계 하니스와 같은 원칙).
단언은 `scripts/design/align-assertions.json` 이 선언한다. 형식은 스킬 원본 그대로
{name, selectors, axis, tolerance} 다.

축 — 원본 3종:
  x  : 매칭된 모든 요소의 center-x 가 tolerance 안에서 일치(세로선 정렬)
  y  : center-y 일치(가로 한 줄 정렬)
  xy : selectors=[자식, 컨테이너] — 자식이 컨테이너의 정중앙(버튼 안 텍스트 등)

확장 2종 — 이 레포의 결함이 중심 공유로 표현되지 않아 더했다:
  gap-y   : selectors=[위 요소, 아래 요소] — 위 요소의 padding-bottom(가로선 위 여백)과
            두 요소 사이 간격(가로선 아래 여백)이 같은가. 가로선이 위 요소의
            border-bottom 이라 선 자체는 요소가 아니다.
  bullet-y: selectors=[li 셀렉터] — 각 li 의 ::before 점 중심이 자기 첫 줄 상자의 세로
            중앙과 같은가. 의사 요소는 셀렉터로 못 잡아 계산값(top·height)으로 잰다.

    pnpm design:align
    # 또는
    HIERARCHY_PYTHON=~/.local/share/uv/tools/playwright/bin/python pnpm design:align

종료 코드: 하니스 없음·단언 실패가 하나라도 있으면 1, 아니면 0.
"""

import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

repo_root = pathlib.Path(__file__).resolve().parents[2]
harness = repo_root / "artifacts/align-harness/align.html"
assertions_file = repo_root / "scripts/design/align-assertions.json"

VIEWPORT = {"width": 1280, "height": 900}

CHECK_JS = r"""
(asserts) => {
  const center = (rect, axis) => (axis === 'y' ? rect.top + rect.height / 2 : rect.left + rect.width / 2);
  return asserts.map((a) => {
    const tol = a.tolerance ?? 1;

    if (a.axis === 'xy') {
      const [childSel, contSel] = a.selectors;
      const child = document.querySelector(childSel);
      const cont = document.querySelector(contSel);
      if (!child || !cont) return { name: a.name, pass: false, detail: '요소 없음' };
      const dx = Math.abs(center(child.getBoundingClientRect(), 'x') - center(cont.getBoundingClientRect(), 'x'));
      const dy = Math.abs(center(child.getBoundingClientRect(), 'y') - center(cont.getBoundingClientRect(), 'y'));
      return { name: a.name, pass: dx <= tol && dy <= tol, detail: `dx ${dx.toFixed(2)} dy ${dy.toFixed(2)} (허용 ${tol})` };
    }

    if (a.axis === 'gap-y') {
      const [aboveSel, belowSel] = a.selectors;
      const above = document.querySelector(aboveSel);
      const below = document.querySelector(belowSel);
      if (!above || !below) return { name: a.name, pass: false, detail: '요소 없음' };
      const aboveGap = parseFloat(getComputedStyle(above).paddingBottom);
      const belowGap = below.getBoundingClientRect().top - above.getBoundingClientRect().bottom;
      const delta = Math.abs(aboveGap - belowGap);
      return {
        name: a.name,
        pass: delta <= tol,
        detail: `선 위 ${aboveGap.toFixed(2)}px / 선 아래 ${belowGap.toFixed(2)}px (허용 ${tol})`,
      };
    }

    if (a.axis === 'bullet-y') {
      const items = [...document.querySelectorAll(a.selectors[0])];
      if (items.length === 0) return { name: a.name, pass: false, detail: '요소 없음' };
      let worst = 0;
      let measured = 0;
      for (const li of items) {
        const s = getComputedStyle(li, '::before');
        if (s.position !== 'absolute') continue;
        // ::before 는 li 패딩 상자 기준 절대 배치다. li 는 테두리 0 이라 border box 와 같다.
        const liTop = li.getBoundingClientRect().top;
        const dotCenter = liTop + parseFloat(s.top) + parseFloat(s.height) / 2;
        const range = document.createRange();
        range.selectNodeContents(li);
        const firstLine = range.getClientRects()[0];
        if (!firstLine) continue;
        measured += 1;
        worst = Math.max(worst, Math.abs(dotCenter - (firstLine.top + firstLine.height / 2)));
      }
      if (measured === 0) return { name: a.name, pass: false, detail: '측정 가능한 li 없음' };
      return { name: a.name, pass: worst <= tol, detail: `최대 어긋남 ${worst.toFixed(2)}px, li ${measured}개 (허용 ${tol})` };
    }

    const els = a.selectors.flatMap((sel) => [...document.querySelectorAll(sel)]);
    if (els.length < 2) return { name: a.name, pass: false, detail: `정렬 비교에 2개 이상 필요(찾음 ${els.length})` };
    const centers = els.map((el) => center(el.getBoundingClientRect(), a.axis || 'x'));
    const spread = Math.max(...centers) - Math.min(...centers);
    return { name: a.name, pass: spread <= tol, detail: `delta ${spread.toFixed(2)}px, ${els.length}개 (허용 ${tol})` };
  });
}
"""


def main() -> int:
    if not harness.exists():
        print(f"정렬 하니스가 없다: {harness}")
        print("먼저 생성기를 돌린다: pnpm --filter @ccc/web exec vitest run app/kit/align-harness.test.tsx")
        return 1
    asserts = json.loads(assertions_file.read_text(encoding="utf-8"))

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        page.goto(harness.as_uri())
        results = page.evaluate(CHECK_JS, asserts)
        browser.close()

    all_pass = True
    print(f"정렬 실측 @ {harness.relative_to(repo_root)} (단언 {len(results)}건)")
    for result in results:
        mark = "통과" if result["pass"] else "실패"
        if not result["pass"]:
            all_pass = False
        print(f"  {mark} — {result['name']}: {result.get('detail', '')}")
    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
