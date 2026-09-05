"""정렬 실측 게이트 — "정렬을 눈대중이 아니라 픽셀로 증명" (2026-08-30 Q).

align-check 스킬(~/developer/tools/align-tools/align-check.mjs)의 선언·판정 계약을 이 레포의
브라우저 레인(python playwright + 정적 하니스)으로 옮긴 것이다. 원본은 node playwright 를
cwd 에서 해석하는데 이 워크스페이스에는 node playwright 가 없고, 실측 레인은 이미
python playwright(hierarchy-measure.py)로 서 있다 — 브라우저 스택을 둘로 늘리지 않는다.

재는 대상은 `artifacts/align-harness/align.html` 이고, 그 파일은 **실제 부품으로** 렌더한
것이다(생성기: apps/web/app/kit/align-harness.test.tsx — 위계 하니스와 같은 원칙).
단언은 `scripts/design/align-assertions.json` 이 선언한다. 기본 형식은 스킬 원본의
{name, selectors, axis, tolerance}이고 chevron-xy는 maxRatio와 선택 expectedSize를 함께 받는다.

축 — 원본 3종:
  x  : 매칭된 모든 요소의 center-x 가 tolerance 안에서 일치(세로선 정렬)
  y  : center-y 일치(가로 한 줄 정렬)
  xy : selectors=[자식, 컨테이너] — 자식이 컨테이너의 정중앙(버튼 안 텍스트 등)

확장 13종, 이 레포의 결함이 중심 공유로 표현되지 않아 더했다:
  center-y-each: selectors=[행, 행 안 자식]. 반복 행마다 자식이 자기 행의 세로 중앙인가.
  no-overlap-x-each: selectors=[행, 왼쪽 자식, 오른쪽 자식]. 반복 행의 두 자식이 겹치는가.
  bullet-y: selectors=[li 셀렉터]. 각 li 의 ::before 점 중심이 자기 첫 줄 중심과 같은가.
  chevron-xy: selectors=[꺽쇠 슬롯]. 내부 SVG path 잉크가 슬롯 정중앙이고 maxRatio보다 작은가.
  gap-pair: selectors=[A 위, A 아래, B 위, B 아래]. 두 묶음의 세로 간격과 선택 expectedGap을 잰다.
  inset-y: selectors=[컨테이너, 첫 자식, 마지막 자식]. 위아래 여백과 선택 expectedInset을 잰다.
  text-gap-pair: selectors=[A 위, A 아래, B 위, B 아래]. 각 요소의 실제 글자 첫줄·끝줄 사이 간격을 잰다.
  inset-x-ink: selectors=[컨테이너, 왼쪽 SVG path, 오른쪽 글자]. 실제 잉크의 좌우 여백을 비교한다.
  inset-right: selectors=[컨테이너, 자식]. 자식 오른쪽과 컨테이너 오른쪽 사이가 expectedInset인가.
  overflow-x: selectors=[컨테이너]. scrollWidth가 clientWidth를 넘는가.
  width: selectors=[폭을 맞출 요소들]. 렌더된 가로 폭의 최대 차이가 tolerance 안인가.
  height: selectors=[높이를 맞출 요소들]. expectedHeight와, 선택하면 expectedBorderWidth·expectedPaddingInline도 잰다.
  size: selectors=[상자]. 렌더된 가로·세로가 expectedWidth·expectedHeight와 같은가.

단언에 viewport={width,height}를 주면 그 폭에서 다시 배치한 뒤 잰다. 화면을 줄였을 때만
드러나는 꺽쇠·줄바꿈 회귀를 데스크톱 단언과 같은 파일에서 막는다.

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

    if (a.axis === 'chevron-xy') {
      const arrows = a.selectors.flatMap((sel) => [...document.querySelectorAll(sel)]);
      if (arrows.length === 0) return { name: a.name, pass: false, detail: '요소 없음' };
      let worstX = 0;
      let worstY = 0;
      let largestRatio = 0;
      let worstSize = 0;
      for (const arrow of arrows) {
        const arrowRect = arrow.getBoundingClientRect();
        if (a.expectedSize !== undefined) {
          worstSize = Math.max(worstSize, Math.abs(arrowRect.width - a.expectedSize), Math.abs(arrowRect.height - a.expectedSize));
        }
        const glyph = arrow.matches('svg.wire-chevron') ? arrow : arrow.querySelector('svg.wire-chevron');
        const path = glyph?.querySelector('path');
        if (!glyph || !path) return { name: a.name, pass: false, detail: '공용 SVG 꺽쇠 없음' };
        const pathRect = path.getBoundingClientRect();
        const stroke = Number.parseFloat(path.getAttribute('stroke-width') ?? '0');
        const inkWidth = pathRect.width + stroke;
        const inkHeight = pathRect.height + stroke;
        worstX = Math.max(worstX, Math.abs(center(pathRect, 'x') - center(arrowRect, 'x')));
        worstY = Math.max(worstY, Math.abs(center(pathRect, 'y') - center(arrowRect, 'y')));
        largestRatio = Math.max(largestRatio, inkWidth / arrowRect.width, inkHeight / arrowRect.height);
      }
      const maxRatio = a.maxRatio ?? Infinity;
      return {
        name: a.name,
        pass: worstX <= tol && worstY <= tol && largestRatio <= maxRatio && worstSize <= tol,
        detail: `dx ${worstX.toFixed(2)}px / dy ${worstY.toFixed(2)}px / 잉크 비율 ${largestRatio.toFixed(3)} / 크기 오차 ${worstSize.toFixed(2)}px (허용 ${tol}px, 최대 ${maxRatio})`,
      };
    }

    if (a.axis === 'gap-pair') {
      const els = a.selectors.map((sel) => document.querySelector(sel));
      if (els.some((el) => !el)) return { name: a.name, pass: false, detail: '요소 없음' };
      const gapOf = (top, bottom) => bottom.getBoundingClientRect().top - top.getBoundingClientRect().bottom;
      const first = gapOf(els[0], els[1]);
      const second = gapOf(els[2], els[3]);
      const delta = Math.abs(first - second);
      const expectedDelta = a.expectedGap === undefined
        ? 0
        : Math.max(Math.abs(first - a.expectedGap), Math.abs(second - a.expectedGap));
      return {
        name: a.name,
        pass: delta <= tol && expectedDelta <= tol,
        detail: `한쪽 ${first.toFixed(2)}px / 다른 쪽 ${second.toFixed(2)}px / 기준 오차 ${expectedDelta.toFixed(2)}px (허용 ${tol})`,
      };
    }

    if (a.axis === 'text-gap-pair') {
      const els = a.selectors.map((sel) => document.querySelector(sel));
      if (els.some((el) => !el)) return { name: a.name, pass: false, detail: '요소 없음' };
      const textRects = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return [...range.getClientRects()];
      };
      const firstRects = textRects(els[0]);
      const firstNextRects = textRects(els[1]);
      const secondRects = textRects(els[2]);
      const secondNextRects = textRects(els[3]);
      if ([firstRects, firstNextRects, secondRects, secondNextRects].some((rects) => rects.length === 0)) {
        return { name: a.name, pass: false, detail: '측정 가능한 글자 없음' };
      }
      const textGap = (topRects, bottomRects) => bottomRects[0].top - topRects.at(-1).bottom;
      const first = textGap(firstRects, firstNextRects);
      const second = textGap(secondRects, secondNextRects);
      const delta = Math.abs(first - second);
      const expectedDelta = a.expectedGap === undefined
        ? 0
        : Math.max(Math.abs(first - a.expectedGap), Math.abs(second - a.expectedGap));
      return {
        name: a.name,
        pass: delta <= tol && expectedDelta <= tol,
        detail: `한쪽 ${first.toFixed(2)}px / 다른 쪽 ${second.toFixed(2)}px / 기준 오차 ${expectedDelta.toFixed(2)}px (허용 ${tol})`,
      };
    }

    if (a.axis === 'inset-x-ink') {
      const [boxSel, leftInkSel, rightTextSel] = a.selectors;
      const box = document.querySelector(boxSel);
      const leftInk = document.querySelector(leftInkSel);
      const rightText = document.querySelector(rightTextSel);
      if (!box || !leftInk || !rightText) return { name: a.name, pass: false, detail: '요소 없음' };
      const boxRect = box.getBoundingClientRect();
      const leftRect = leftInk.getBoundingClientRect();
      const stroke = Number.parseFloat(leftInk.getAttribute('stroke-width') ?? '0');
      const range = document.createRange();
      range.selectNodeContents(rightText);
      const textRects = [...range.getClientRects()];
      if (textRects.length === 0) return { name: a.name, pass: false, detail: '측정 가능한 글자 없음' };
      const left = leftRect.left - stroke / 2 - boxRect.left;
      const right = boxRect.right - textRects.at(-1).right;
      const delta = Math.abs(left - right);
      const expectedDelta = Math.max(
        a.expectedLeft === undefined ? 0 : Math.abs(left - a.expectedLeft),
        a.expectedRight === undefined ? 0 : Math.abs(right - a.expectedRight),
      );
      return {
        name: a.name,
        pass: delta <= tol && expectedDelta <= tol,
        detail: `왼쪽 잉크 여백 ${left.toFixed(2)}px / 오른쪽 글자 여백 ${right.toFixed(2)}px / 차이 ${delta.toFixed(2)}px / 기준 오차 ${expectedDelta.toFixed(2)}px (허용 ${tol})`,
      };
    }

    if (a.axis === 'inset-right') {
      const [boxSel, childSel] = a.selectors;
      const box = document.querySelector(boxSel);
      const child = document.querySelector(childSel);
      if (!box || !child) return { name: a.name, pass: false, detail: '요소 없음' };
      const inset = box.getBoundingClientRect().right - child.getBoundingClientRect().right;
      const expectedDelta = Math.abs(inset - (a.expectedInset ?? 0));
      return {
        name: a.name,
        pass: expectedDelta <= tol,
        detail: `오른쪽 여백 ${inset.toFixed(2)}px / 기준 오차 ${expectedDelta.toFixed(2)}px (허용 ${tol})`,
      };
    }

    if (a.axis === 'inset-y') {
      const [boxSel, firstSel, lastSel] = a.selectors;
      const box = document.querySelector(boxSel);
      const first = document.querySelector(firstSel);
      const last = document.querySelector(lastSel);
      if (!box || !first || !last) return { name: a.name, pass: false, detail: '요소 없음' };
      const boxRect = box.getBoundingClientRect();
      const top = first.getBoundingClientRect().top - boxRect.top;
      const bottom = boxRect.bottom - last.getBoundingClientRect().bottom;
      const delta = Math.abs(top - bottom);
      const expectedDelta = a.expectedInset === undefined
        ? 0
        : Math.max(Math.abs(top - a.expectedInset), Math.abs(bottom - a.expectedInset));
      return {
        name: a.name,
        pass: delta <= tol && expectedDelta <= tol,
        detail: `위 ${top.toFixed(2)}px / 아래 ${bottom.toFixed(2)}px / 기준 오차 ${expectedDelta.toFixed(2)}px (허용 ${tol})`,
      };
    }

    if (a.axis === 'center-y-each') {
      const rows = [...document.querySelectorAll(a.selectors[0])];
      if (rows.length === 0) return { name: a.name, pass: false, detail: '요소 없음' };
      let worst = 0;
      for (const row of rows) {
        const child = row.querySelector(a.selectors[1]);
        if (!child) return { name: a.name, pass: false, detail: '행 안 자식 없음' };
        worst = Math.max(worst, Math.abs(center(row.getBoundingClientRect(), 'y') - center(child.getBoundingClientRect(), 'y')));
      }
      return { name: a.name, pass: worst <= tol, detail: `최대 어긋남 ${worst.toFixed(2)}px, 행 ${rows.length}개 (허용 ${tol})` };
    }
    if (a.axis === 'no-overlap-x-each') {
      const rows = [...document.querySelectorAll(a.selectors[0])];
      if (rows.length === 0) return { name: a.name, pass: false, detail: '요소 없음' };
      let minimum = Infinity;
      for (const row of rows) {
        const left = row.querySelector(a.selectors[1]);
        const right = row.querySelector(a.selectors[2]);
        if (!left || !right) return { name: a.name, pass: false, detail: '행 안 자식 없음' };
        minimum = Math.min(minimum, right.getBoundingClientRect().left - left.getBoundingClientRect().right);
      }
      return { name: a.name, pass: minimum >= -tol, detail: `최소 가로 여유 ${minimum.toFixed(2)}px, 행 ${rows.length}개 (허용 겹침 ${tol})` };
    }
    if (a.axis === 'size') {
      const els = a.selectors.flatMap((sel) => [...document.querySelectorAll(sel)]);
      if (els.length === 0) return { name: a.name, pass: false, detail: '요소 없음' };
      if (a.expectedWidth === undefined || a.expectedHeight === undefined) {
        return { name: a.name, pass: false, detail: 'expectedWidth·expectedHeight 없음' };
      }
      const worstWidth = Math.max(...els.map((el) => Math.abs(el.getBoundingClientRect().width - a.expectedWidth)));
      const worstHeight = Math.max(...els.map((el) => Math.abs(el.getBoundingClientRect().height - a.expectedHeight)));
      return {
        name: a.name,
        pass: worstWidth <= tol && worstHeight <= tol,
        detail: `가로 오차 ${worstWidth.toFixed(2)}px / 세로 오차 ${worstHeight.toFixed(2)}px (허용 ${tol})`,
      };
    }
    if (a.axis === 'height') {
      const els = a.selectors.flatMap((sel) => [...document.querySelectorAll(sel)]);
      if (els.length === 0) return { name: a.name, pass: false, detail: '요소 없음' };
      if (a.expectedHeight === undefined) {
        return { name: a.name, pass: false, detail: 'expectedHeight 없음' };
      }
      const worstHeight = Math.max(...els.map((el) => Math.abs(el.getBoundingClientRect().height - a.expectedHeight)));
      const worstBorder = a.expectedBorderWidth === undefined ? 0 : Math.max(...els.map((el) => {
        const style = getComputedStyle(el);
        return Math.max(
          Math.abs(parseFloat(style.borderTopWidth) - a.expectedBorderWidth),
          Math.abs(parseFloat(style.borderRightWidth) - a.expectedBorderWidth),
          Math.abs(parseFloat(style.borderBottomWidth) - a.expectedBorderWidth),
          Math.abs(parseFloat(style.borderLeftWidth) - a.expectedBorderWidth),
        );
      }));
      const worstPadding = a.expectedPaddingInline === undefined ? 0 : Math.max(...els.map((el) => {
        const style = getComputedStyle(el);
        return Math.max(
          Math.abs(parseFloat(style.paddingLeft) - a.expectedPaddingInline),
          Math.abs(parseFloat(style.paddingRight) - a.expectedPaddingInline),
        );
      }));
      return {
        name: a.name,
        pass: worstHeight <= tol && worstBorder <= tol && worstPadding <= tol,
        detail: `높이 오차 ${worstHeight.toFixed(2)}px / 사방 외곽선 오차 ${worstBorder.toFixed(2)}px / 좌우 패딩 오차 ${worstPadding.toFixed(2)}px, ${els.length}개 (허용 ${tol})`,
      };
    }



    if (a.axis === 'overflow-x') {
      const els = a.selectors.flatMap((sel) => [...document.querySelectorAll(sel)]);
      if (els.length === 0) return { name: a.name, pass: false, detail: '요소 없음' };
      const worst = Math.max(...els.map((el) => el.scrollWidth - el.clientWidth));
      return { name: a.name, pass: worst <= tol, detail: `최대 가로 넘침 ${worst.toFixed(2)}px (허용 ${tol})` };
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

    if (a.axis === 'width') {
      const els = a.selectors.flatMap((sel) => [...document.querySelectorAll(sel)]);
      if (els.length < 2) return { name: a.name, pass: false, detail: `폭 비교에 2개 이상 필요(찾음 ${els.length})` };
      const widths = els.map((el) => el.getBoundingClientRect().width);
      const spread = Math.max(...widths) - Math.min(...widths);
      return { name: a.name, pass: spread <= tol, detail: `폭 차이 ${spread.toFixed(2)}px, ${els.length}개 (허용 ${tol})` };
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

    groups = {}
    for assertion in asserts:
        viewport = assertion.get("viewport", VIEWPORT)
        key = (int(viewport["width"]), int(viewport["height"]))
        groups.setdefault(key, []).append(assertion)

    with sync_playwright() as p:
        browser = p.chromium.launch(args=["--allow-file-access-from-files"])
        page = browser.new_page(viewport=VIEWPORT)
        results = []
        for (width, height), group in groups.items():
            page.set_viewport_size({"width": width, "height": height})
            page.goto(harness.as_uri())
            font_loaded = page.evaluate(
                """async () => {
                  const spec = '14px "Pretendard Variable"';
                  const sample = '뒤로 당사자 동의';
                  await document.fonts.load(spec, sample);
                  await document.fonts.ready;
                  return document.fonts.check(spec, sample);
                }"""
            )
            if not font_loaded:
                print("정렬 하니스가 한국어 표본에 Pretendard Variable을 불러오지 못했다.")
                browser.close()
                return 1
            batch = page.evaluate(CHECK_JS, group)
            for result in batch:
                result["viewport"] = f"{width}x{height}"
            results.extend(batch)
        browser.close()

    all_pass = True
    print(f"정렬 실측 @ {harness.relative_to(repo_root)} (단언 {len(results)}건)")
    for result in results:
        mark = "통과" if result["pass"] else "실패"
        if not result["pass"]:
            all_pass = False
        print(f"  {mark} — {result['name']} [{result['viewport']}]: {result.get('detail', '')}")
    return 0 if all_pass else 1


if __name__ == "__main__":
    sys.exit(main())
