"""위계 실측 — 렌더 결과에서 **이웃한 두 줄이 같은 옷인지**를 본다 (DESIGN.md §2-2 규칙 1).

정적 검사(`pnpm guard:hierarchy`)와 무엇이 다른가. 그쪽은 한 요소의 최종 조합이 역할표 안인지를
CSS 만 보고 판정한다. 이쪽이 답하는 것은 CSS 파일에 아예 없는 물음이다 — 어느 줄 다음에 어느
줄이 오는가. 세로로 붙은 두 줄이 크기·굵기·색 셋 다 같으면 무엇을 먼저 읽어야 할지가 사라진다.

재는 대상은 `artifacts/hierarchy-harness/harness.html` 이고, 그 파일은 **실제 부품으로** 렌더한
것이다(생성기: apps/web/app/kit/hierarchy-harness.test.tsx). 마크업을 손으로 옮겨 적으면 부품이
바뀌어도 하니스는 옛 모양을 재고 초록불이 거짓이 된다.

    pnpm design:hierarchy
    # 또는
    ~/.local/share/uv/tools/playwright/bin/python scripts/design/hierarchy-measure.py

나열은 위반이 아니다(§2-2 규칙 1 단서). 다만 **나열이라는 표시가 있어야** 봐준다 — 목록 태그
(ul·ol·표), 목록 클래스, 또는 같은 이름표(class)를 단 형제. 이름 없는 <p> 를 줄줄이 쌓은 것은
나열이 아니라 쌓임으로 본다. 실제로 그것이 킷 페이지 '고치기 전' 칸이 보여 주는 모양이다.

결과: artifacts/hierarchy-harness/measure.json + 화면에 요약.
종료 코드: 통제군(킷 반례)을 못 잡으면 1, 기준선에 없는 새 쌍이 있으면 1, 아니면 0.
"""

import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

repo_root = pathlib.Path(__file__).resolve().parents[2]
harness = repo_root / "artifacts/hierarchy-harness/harness.html"
screens_file = repo_root / "artifacts/hierarchy-harness/screens.json"
baseline_file = repo_root / "scripts/design/hierarchy-adjacency-baseline.json"
out_file = repo_root / "artifacts/hierarchy-harness/measure.json"

# 하니스는 폭에 따라 위계가 갈리지 않지만(크기·굵기·색은 767 분기 밖에서 같다) 값을 재는
# 이상 폭은 고정해 둔다. 767 미만은 제목 크기가 갈리므로 따로 재야 한다면 이 값을 바꾼다.
VIEWPORT = {"width": 1280, "height": 900}

MEASURE_JS = r"""
() => {
  // 나열이라는 **표시**. 표시가 없으면 쌓임으로 본다 — 그래야 이름 없는 <p> 줄 세우기가 걸린다.
  const LIST_TAGS = new Set(['UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'DL', 'MENU']);
  const LIST_CLASSES = ['wire-bullets', 'card-grid', 'briefing-cards-grid', 'wire-choice-group'];

  const cls = (el) => el.getAttribute('class') || '';
  const trip = (el) => {
    const s = getComputedStyle(el);
    return `${s.fontSize}/${s.fontWeight}/${s.color}`;
  };
  // 자기 면이나 테두리를 가진 것은 §2-2 규칙 4 대로 '한 축'을 이미 만족한다(배지·버튼·칩).
  const hasOwnSurface = (el) => {
    const s = getComputedStyle(el);
    const bg = s.backgroundColor;
    const opaque = bg && bg !== 'transparent' && !/rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(bg);
    const bordered = ['Top', 'Right', 'Bottom', 'Left'].some((side) => {
      const w = parseFloat(s['border' + side + 'Width']) || 0;
      return w > 0 && s['border' + side + 'Style'] !== 'none';
    });
    return opaque || bordered || s.backgroundImage !== 'none';
  };
  const ownText = (el) =>
    [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
  const textOf = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ');
  const label = (el) => textOf(el).slice(0, 40);
  // 이어지는 본문 문단은 쌓임이 아니라 나열이다 — 한 덩어리의 글이고 원래 대등하다.
  // 라벨과 값이 번갈아 서는 눌린 쌓임과는 길이가 갈린다(킷 반례는 5~22자, 동의 문단은 60자 이상).
  // 길이로 가르는 것은 근사지만, 이 둘을 구조로 가를 방법이 없다(둘 다 이름 없는 <p> 형제다).
  const PROSE_LEN = 40;
  const pathOf = (el) => {
    const parts = [];
    let cur = el;
    for (let i = 0; i < 3 && cur && cur.tagName; i += 1) {
      const c = cls(cur).split(/\s+/).filter(Boolean)[0];
      parts.unshift(cur.tagName.toLowerCase() + (c ? '.' + c : ''));
      cur = cur.parentElement;
    }
    return parts.join('>');
  };

  const findings = [];
  const prose = [];
  const sizes = {};
  for (const screen of document.querySelectorAll('[data-screen]')) {
    const id = screen.getAttribute('data-screen');
    let lineCount = 0;
    const parents = new Set();
    for (const el of screen.querySelectorAll('*')) {
      if (ownText(el)) { lineCount += 1; parents.add(el.parentElement); }
    }
    sizes[id] = lineCount;

    for (const parent of parents) {
      if (!parent || parent === screen) continue;
      if (LIST_TAGS.has(parent.tagName)) continue;
      if (LIST_CLASSES.some((c) => parent.classList.contains(c))) continue;

      const lines = [...parent.children].filter(ownText);
      for (let i = 1; i < lines.length; i += 1) {
        const a = lines[i - 1];
        const b = lines[i];
        // 같은 이름표를 단 형제는 나열이다(목록 항목·반복 행).
        if (cls(a) !== '' && cls(a) === cls(b)) continue;
        // 한 줄에 나란히 선 것은 '쌓인 것'이 아니다. 겹치면 같은 줄로 본다.
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        if (ra.height === 0 || rb.height === 0) continue;
        if (rb.top < ra.bottom - 2) continue;
        // 배지·버튼처럼 자기 면을 가진 쪽이 하나라도 있으면 규칙 1 은 이미 만족이다.
        if (hasOwnSurface(a) || hasOwnSurface(b)) continue;

        const ta = trip(a);
        if (ta !== trip(b)) continue;
        const hit = {
          screen: id,
          parent: pathOf(parent),
          combo: ta,
          first: label(a),
          second: label(b),
        };
        const bothLong = textOf(a).length >= PROSE_LEN && textOf(b).length >= PROSE_LEN;
        (bothLong ? prose : findings).push(hit);
      }
    }
  }
  return { findings, prose, sizes, bodyWidth: document.body.clientWidth };
}
"""


def load_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback


def main() -> int:
    if not harness.exists():
        print("하니스가 없다. 먼저 만든다:", file=sys.stderr)
        print("  pnpm --filter @ccc/web exec vitest run app/kit/hierarchy-harness.test.tsx", file=sys.stderr)
        return 1

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport=VIEWPORT)
        page.goto(harness.as_uri())
        result = page.evaluate(MEASURE_JS)
        browser.close()

    # 패널이 숨겨져 있으면 뷰포트가 0 이 되어 계산값이 전부 거짓이 된다(2026-08-10 실측에서
    # 실제로 겪었다). 폭을 단언하지 않으면 그 거짓이 조용히 보고서로 나간다.
    body_width = result["bodyWidth"]
    if body_width < VIEWPORT["width"] * 0.5:
        print(f"본문 폭이 {body_width}px 이다. 뷰포트가 제대로 안 섰으니 잰 값을 믿을 수 없다.", file=sys.stderr)
        return 1

    findings = result["findings"]
    prose = result["prose"]
    sizes = result["sizes"]
    screens = load_json(screens_file, [])
    labels = {s["id"]: s["label"] for s in screens}

    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(
        json.dumps(
            {"bodyWidth": body_width, "sizes": sizes, "findings": findings, "prose": prose},
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    print(f"본문 폭 {body_width}px, 화면 {len(sizes)}개")
    for sid, count in sizes.items():
        hits = [f for f in findings if f["screen"] == sid]
        para = [f for f in prose if f["screen"] == sid]
        extra = f", 이어진 본문 문단 {len(para)}쌍" if para else ""
        print(f"  {labels.get(sid, sid)}: 글자 줄 {count}개, 눌린 쌍 {len(hits)}개{extra}")
    if prose:
        print("\n이어진 본문 문단은 위반으로 세지 않는다(원래 대등한 나열). measure.json 의 prose 에 남는다.")

    # 통제군. 킷 페이지 맨 위 '고치기 전' 칸은 일부러 눌린 쌓임이다. 저기서 아무것도 못 찾으면
    # 위반이 없는 것이 아니라 이 스크립트가 고장 난 것이다.
    if not any(f["screen"] == "kit" for f in findings):
        print("\n통제군 실패. 킷 페이지의 '고치기 전' 반례를 못 잡았다. 실측이 고장 났다.", file=sys.stderr)
        return 1

    baseline = load_json(baseline_file, {"entries": []})
    known = set(baseline["entries"])
    # 킷은 통제군이라 래칫에서 뺀다. 저기 눌린 쌓임이 있는 것이 정상이고(일부러 만든 반례),
    # 기준선에 넣으면 "고치면 실패"와 "고장 나면 실패"가 한 줄에서 부딪힌다.
    keys = {f"{f['screen']} | {f['parent']} | {f['combo']}" for f in findings if f["screen"] != "kit"}

    if "--update-baseline" in sys.argv:
        baseline_file.write_text(
            json.dumps(
                {
                    "note": "위계 실측 기준선(이웃한 두 줄). 여기 적힌 쌍은 이미 있던 것이라 실패로 세지 않는다.",
                    "generated": "pnpm design:hierarchy -- --update-baseline",
                    "entries": sorted(keys),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"\n기준선 갱신: 쌍 {len(keys)}개")
        return 0

    fresh = sorted(keys - known)
    stale = sorted(known - keys)
    if fresh:
        print(f"\n새로 눌린 쌓임 {len(fresh)}건:", file=sys.stderr)
        for key in fresh:
            hit = next(f for f in findings if f"{f['screen']} | {f['parent']} | {f['combo']}" == key)
            print(f"  {key}", file=sys.stderr)
            print(f"    '{hit['first']}' 다음에 '{hit['second']}' 가 같은 옷으로 온다", file=sys.stderr)
    if stale:
        print(f"\n기준선이 낡았다. 아래 {len(stale)}건은 더 이상 안 나오니 목록에서도 지운다:", file=sys.stderr)
        for key in stale:
            print(f"  {key}", file=sys.stderr)

    if fresh or stale:
        return 1
    print(f"\n실측 통과. 새 쌍 0건, 기준선에 남은 기존 쌍 {len(known)}개")
    return 0


if __name__ == "__main__":
    sys.exit(main())
