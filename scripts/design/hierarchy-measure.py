"""렌더 실측 — 브라우저에 물린 화면에서 **레인 둘**을 잰다.

레인 ①  위계: 이웃한 두 줄이 같은 옷인지 (DESIGN.md §2-2 규칙 1)
레인 ②  기하: 자리 예약, 붙박이, 가로 넘침 (CCC-91, ADR-0034 실측 4)

정적 검사(`pnpm guard:hierarchy`)와 무엇이 다른가. 그쪽은 한 요소의 최종 조합이 역할표 안인지를
CSS 만 보고 판정한다. 이쪽이 답하는 것은 CSS 파일에 아예 없는 물음이다. 어느 줄 다음에 어느
줄이 오는가, 그리고 그 상자가 실제로 어디에 얼마나 서는가. 둘 다 렌더해 봐야 안다.

재는 대상은 `artifacts/hierarchy-harness/harness.html` 이고, 그 파일은 **실제 부품으로** 렌더한
것이다(생성기: apps/web/app/kit/hierarchy-harness.test.tsx). 마크업을 손으로 옮겨 적으면 부품이
바뀌어도 하니스는 옛 모양을 재고 초록불이 거짓이 된다.

    pnpm design:hierarchy
    # 또는
    HIERARCHY_PYTHON=~/.local/share/uv/tools/playwright/bin/python pnpm design:hierarchy

**두 레인을 섞지 않는다**(CCC-91 지시). 위반 종류가 다르면 판정도 기준선 파일도 따로 둔다.
위계는 `hierarchy-adjacency-baseline.json`, 기하는 `geometry-baseline.json` 이다.

다만 `--update-baseline` 은 **둘을 함께 다시 쓴다.** 한쪽만 고치려고 부른 것이 다른 쪽까지
덮으므로, 부르고 나면 두 파일의 변경을 다 보고 커밋한다. 갱신 뒤 찍히는 개수 두 개가
그 확인용이다.

나열은 위반이 아니다(§2-2 규칙 1 단서). 다만 **나열이라는 표시가 있어야** 봐준다. 목록 태그
(ul·ol·표), 목록 클래스, 또는 같은 이름표(class)를 단 형제다. 이름 없는 <p> 를 줄줄이 쌓은 것은
나열이 아니라 쌓임으로 본다. 실제로 그것이 킷 페이지 '고치기 전' 칸이 보여 주는 모양이다.

결과: artifacts/hierarchy-harness/measure.json + 화면에 요약.
종료 코드: 통제군을 못 잡으면 1, 두 기준선 중 어느 쪽이든 어긋나면 1, 아니면 0.
"""

import json
import pathlib
import sys

from playwright.sync_api import sync_playwright

repo_root = pathlib.Path(__file__).resolve().parents[2]
harness = repo_root / "artifacts/hierarchy-harness/harness.html"
screens_file = repo_root / "artifacts/hierarchy-harness/screens.json"
baseline_file = repo_root / "scripts/design/hierarchy-adjacency-baseline.json"
geometry_baseline_file = repo_root / "scripts/design/geometry-baseline.json"
out_file = repo_root / "artifacts/hierarchy-harness/measure.json"

# 재는 폭 (2026-08-10 CCC-86 으로 셋이 됐다, 구 1280 하나).
#
# 왜 좁은 폭이 따로 필요한가. **가로로 나란하던 것이 세로로 쌓이는 순간**이 규칙 1 이 처음
# 적용되는 자리다. 넓은 폭에서 한 줄에 나란히 선 두 값은 이 실측이 건너뛰는데(같은 줄은
# 쌓임이 아니다), 767 미만에서 열이 하나로 접히면 그 둘이 위아래로 붙는다. 그래서 1280 에서
# 0건인 것이 390 에서도 0건이라는 보장이 없다. 제목 크기도 28 에서 24 로 갈린다(§2-1).
#
# 767 을 넣은 것은 경계 그 자체를 재기 위해서다. 브레이크포인트가 `max-width:767px` 라 767 은
# 좁은 쪽에 속하고, 그 한 픽셀 차이가 실제로 어느 분기에 앉는지는 재 보는 편이 빠르다.
#
# **320 은 일부러 안 넣는다**(2026-08-11 Q 결정). 인테이크 카드가 폭 295 밑으로는 안 줄어들어
# 320 에서 6px, 300 에서 26px 이 화면 밖으로 나간다(CCC-93 실측). 고칠 수 있는 결함이지만
# 받치는 폭에 넣지 않기로 했다. 실무자가 주로 컴퓨터에서 쓰는 도구이고 요즘 기기는 대개 375
# 이상이라, 390 이 들어가는 것으로 실사용 범위를 덮는다고 봤다. 즉 320 에서 화면이 밀리는 것은
# **아직 못 찾은 결함이 아니라 범위 밖**이다. 되살리려면 이 목록에 넣고 나오는 위반을 고친다.
WIDTHS = [1280, 767, 390]
HEIGHT = 900

MEASURE_JS = r"""
() => {
  // 나열이라는 **표시**. 표시가 없으면 쌓임으로 본다 — 그래야 이름 없는 <p> 줄 세우기가 걸린다.
  const LIST_TAGS = new Set(['UL', 'OL', 'TABLE', 'THEAD', 'TBODY', 'TFOOT', 'DL', 'MENU']);
  // `wire-meta-row` 는 2026-08-10(CCC-86) 에 더했다. MetaRow 는 "서로 다른 정보를 나란히
  // 놓는 메타 줄"이고 자식 span 이 정의상 대등하다. 넓은 폭에서는 한 줄에 나란히 서서 건너뛰던
  // 것이 767 미만에서 줄바꿈으로 위아래가 되며 쌓임처럼 보였다. 나열이라는 표시가 빠져 있었다.
  const LIST_CLASSES = ['wire-bullets', 'card-grid', 'briefing-cards-grid', 'wire-choice-group', 'wire-meta-row'];

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


# ── 레인 ②: 기하 ────────────────────────────────────────────────────────────
#
# 왜 따로 있는가. 위계 판정이 읽는 것은 `fontSize/fontWeight/color` 셋뿐이라, 상자가 어디에
# 얼마나 서는지는 아무도 안 봤다. 검사 3종이 전부 위반 0 인데도 사람이 지적한 결함 한 무리가
# 있었고 그것이 전부 기하였다(ADR-0034 실측 2). 로딩 글자 세로 중앙, 인테이크 레일 붙박이,
# 390 가로 넘침 셋이 실제로 새어 나간 자리다.
#
# **판정은 세 가지뿐이고, 셋 다 글꼴에 안 기댄다.** 이 조건이 중요하다. 하니스는 file:// 로
# 열리고 리눅스 CI 에는 한글 글꼴이 없어 글자에서 나온 높이·너비는 플랫폼마다 갈린다(CCC-86
# 에서 킷 쌍이 macOS 4, 리눅스 5 로 갈린 것이 그 증거다). 그래서 재는 것을 골랐다.
#   - 자리 예약: min-height 가 만드는 바닥이라 글자 길이와 무관하다(내용이 넘치면 통과한다).
#   - 붙박이: `position`·`top` 은 계산된 선언값이고 렌더 폭과 무관하다.
#   - 가로 넘침: 12px 넘침을 재는 데 1px 오차는 문제가 안 된다.
#
# **뺀 것: 형제 간 좌측 기준선.** CCC-91 이 후보로 든 셋 중 하나인데 실측해 보고 뺐다. 지금
# 화면에서 좌측 기준선이 0 이 아닌 쌍 74건을 전수로 보니 전부 구조가 만든 값이었다. 카드
# 패딩 24(63건), 가운데 정렬한 빈 상태(51·58·83), 줄바꿈된 격자 칸(602·617·803)이다. 16 미만
# 어긋남은 세 폭 통틀어 0건이라 규칙을 세워도 잡을 것이 없고, 남는 것은 예외 목록뿐이다.
# 그 자리를 가로 넘침이 대신한다. 이쪽은 실제로 새어 나간 적이 있다(CCC-88 검수, 390 에서
# 요소 16개).
GEOMETRY_JS = r"""
() => {
  // WireEmpty 의 자리 예약 계약(layout.tsx `p.empty[data-reserve="true"]`, wire-styles
  // `.wire-error[data-reserve="true"]`). 이 값이 죽으면 카드 본문이 한 줄 높이로 쪼그라들고
  // 글자가 위아래 가운데에서 밀려난다. CCC-88 에서 실제로 92 가 21 로 죽어 있었다.
  const RESERVE_MIN = 92;
  // 넘침 허용 오차. 서브픽셀 반올림만 봐준다.
  const EDGE_SLACK = 1;

  const pathOf = (el) => {
    const parts = [];
    let cur = el;
    for (let i = 0; i < 3 && cur && cur.tagName; i += 1) {
      const c = (cur.getAttribute('class') || '').split(/\s+/).filter(Boolean)[0];
      parts.unshift(cur.tagName.toLowerCase() + (c ? '.' + c : ''));
      cur = cur.parentElement;
    }
    return parts.join('>');
  };

  // 스스로 자르거나 굴리는 조상이 있으면 그 안의 넘침은 화면 밖으로 안 나간다. 의도된
  // 가로 스크롤 상자(레일의 overflow-y:auto 가 x 축을 auto 로 끌어올린 경우 포함)를
  // 위반으로 세지 않기 위한 조건이다.
  const clippedX = (el, stop) => {
    for (let cur = el.parentElement; cur && cur !== stop; cur = cur.parentElement) {
      const ox = getComputedStyle(cur).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true;
    }
    return false;
  };

  const findings = [];
  // 잰 개수를 함께 낸다. 0 건이 "위반 없음"인지 "아무것도 안 봤음"인지 화면에서 같아 보이는
  // 것을 막는 유일한 장치다. 기하에는 킷 반례 같은 통제군이 없으므로(일부러 넘치는 화면을
  // 킷에 두면 그 화면이 실제로 390 에서 깨진다) 이 숫자가 통제군 노릇을 한다.
  //
  // `overflowAll` 은 넘친 요소를 하나도 빼지 않고 센 값이다. 판정은 바깥 테두리만 세지만
  // (아래 참조) 번짐의 크기는 보고서에 남겨 둔다. 이 숫자는 글꼴에 따라 크게 갈린다.
  const probes = { elements: 0, reserve: 0, sticky: 0, overflowAll: 0 };
  // 이미 넘친 것으로 판정된 요소. `querySelectorAll('*')` 이 문서 순서를 주므로 부모가 자식보다
  // 항상 먼저 들어온다.
  const overflowing = new Set();

  for (const screen of document.querySelectorAll('[data-screen]')) {
    const id = screen.getAttribute('data-screen');
    const box = screen.getBoundingClientRect();
    for (const el of screen.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      probes.elements += 1;
      const hit = (rule, detail) => findings.push({ screen: id, rule, path: pathOf(el), detail });

      // 1) 자리 예약이 살아 있는가.
      if (el.getAttribute('data-reserve') === 'true') {
        probes.reserve += 1;
        if (r.height < RESERVE_MIN - EDGE_SLACK) {
          hit('reserve', `높이 ${Math.round(r.height)}px 인데 예약은 ${RESERVE_MIN}px 다. 예약이 죽으면 글자가 세로 가운데에서 밀린다`);
        }
      }

      // 2) 붙박이가 켜지는가. 적혀 있는 것과 켜지는 것은 다르다.
      if (s.position === 'sticky') {
        probes.sticky += 1;
        // 기준 변이 하나도 없으면 sticky 는 relative 와 같다. 계산값만 보므로 플랫폼 불변이다.
        if (['top', 'right', 'bottom', 'left'].every((k) => s[k] === 'auto')) {
          hit('sticky-no-inset', 'position:sticky 인데 top·right·bottom·left 가 전부 auto 다. 기준 변이 없으면 붙지 않는다');
        }
        // 격자 칸은 기본이 stretch 라 레일이 본문 길이만큼 늘어난다. 그러면 움직일 자리가
        // 없어 sticky 가 죽는다(CCC-88 인테이크 레일, 내용 231px 이 3065px 로 늘어나 있었다).
        //
        // 내용 높이를 **자식들의 합집합**으로 잰다. `scrollHeight` 를 쓰면 안 된다. 늘어난
        // 요소의 scrollHeight 는 내용이 아니라 자기 높이를 돌려주므로(clientHeight 와 큰 쪽),
        // 늘어날수록 문턱도 같이 커져 판정이 영영 안 선다. 처음에 그렇게 썼다가 일부러
        // 늘여 보는 검증에서 안 걸려서 찾았다.
        const kids = [...el.children];
        if (kids.length) {
          const top = Math.min(...kids.map((k) => k.getBoundingClientRect().top));
          const bottom = Math.max(...kids.map((k) => k.getBoundingClientRect().bottom));
          const contentH = bottom - top + (parseFloat(s.paddingTop) || 0) + (parseFloat(s.paddingBottom) || 0);
          const ph = el.parentElement ? el.parentElement.getBoundingClientRect().height : 0;
          // 문턱을 넉넉히 잡는다. 내용의 2배 넘게 길면서 부모를 꽉 채운 때만 잡는다.
          // 실측 여유가 231 대 231(건강한 레일)이라 이 문턱에 걸릴 일이 없다.
          if (contentH > 0 && r.height > contentH * 2 && r.height > ph - 4) {
            hit('sticky-stretched', `높이 ${Math.round(r.height)}px 가 부모 ${Math.round(ph)}px 를 꽉 채운다(내용은 ${Math.round(contentH)}px). 늘어난 붙박이는 움직일 자리가 없다`);
          }
        }
      }

      // 3) 화면 밖으로 나가는가. 기준은 뷰포트가 아니라 그 화면의 상자다. 하니스는 화면
      //    여덟 개를 세로로 쌓으므로 뷰포트를 기준으로 삼으면 화면마다 다른 것을 재게 된다.
      //    fixed 는 자기 기준이 뷰포트라 이 비교가 뜻을 잃어 뺀다.
      if (s.position !== 'fixed' && !clippedX(el, screen)) {
        const right = r.right - box.right;
        const left = box.left - r.left;
        if (right > EDGE_SLACK || left > EDGE_SLACK) {
          overflowing.add(el);
          probes.overflowAll += 1;
          // **바깥 테두리만 센다.** 부모가 이미 넘쳤으면 자식은 그것 때문에 따라 나간 것이라
          // 새 사실이 아니다. 고칠 자리는 넘침이 시작되는 곳 하나다.
          //
          // 이 조건이 없으면 판정이 글꼴을 탄다. 2026-08-11 CI 에서 실제로 겪었다. 같은 결함이
          // macOS 는 16건, 리눅스는 129건으로 나왔다. 원인(위저드 격자 트랙이 컨테이너보다
          // 넓다)은 하나인데 글꼴이 넓어지면 더 깊은 자손까지 선을 넘기 때문이다. 바깥
          // 테두리는 그 트랙을 채우는 격자 칸들이라 두 플랫폼에서 같다. 번짐의 크기는
          // probes.overflowAll 에 남는다.
          if (!overflowing.has(el.parentElement)) {
            const side = right > left ? `오른쪽으로 ${Math.round(right)}px` : `왼쪽으로 ${Math.round(left)}px`;
            hit('overflow-x', `화면 상자 밖으로 ${side} 나간다`);
          }
        }
      }
    }
  }
  return { findings, probes };
}
"""


def load_json(path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return fallback


def geo_key(f) -> str:
    return f"{f['width']} | {f['screen']} | {f['rule']} | {f['path']}"


def write_baseline(path, note, keys) -> None:
    path.write_text(
        json.dumps(
            {
                "note": note,
                "generated": "pnpm design:hierarchy -- --update-baseline",
                "entries": sorted(keys),
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def main() -> int:
    if not harness.exists():
        print("하니스가 없다. 먼저 만든다:", file=sys.stderr)
        print("  pnpm --filter @ccc/web exec vitest run app/kit/hierarchy-harness.test.tsx", file=sys.stderr)
        return 1

    runs = {}
    geo = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": WIDTHS[0], "height": HEIGHT})
        page.goto(harness.as_uri())
        for width in WIDTHS:
            # 브라우저는 한 번만 띄우고 폭만 바꾼다. 폭마다 새로 띄우면 비용이 폭 수만큼 는다.
            page.set_viewport_size({"width": width, "height": HEIGHT})
            runs[width] = page.evaluate(MEASURE_JS)
            geo[width] = page.evaluate(GEOMETRY_JS)
        browser.close()

    # 패널이 숨겨져 있으면 뷰포트가 0 이 되어 계산값이 전부 거짓이 된다(2026-08-10 실측에서
    # 실제로 겪었다). 폭을 단언하지 않으면 그 거짓이 조용히 보고서로 나간다.
    for width, result in runs.items():
        if result["bodyWidth"] < width * 0.5:
            print(
                f"{width} 에서 본문 폭이 {result['bodyWidth']}px 이다. 뷰포트가 제대로 안 섰으니 잰 값을 믿을 수 없다.",
                file=sys.stderr,
            )
            return 1

    findings = [dict(f, width=w) for w, r in runs.items() for f in r["findings"]]
    prose = [dict(f, width=w) for w, r in runs.items() for f in r["prose"]]
    geo_findings = [dict(f, width=w) for w, r in geo.items() for f in r["findings"]]
    screens = load_json(screens_file, [])
    labels = {s["id"]: s["label"] for s in screens}

    out_file.parent.mkdir(parents=True, exist_ok=True)
    out_file.write_text(
        json.dumps(
            {
                "widths": {str(w): {"bodyWidth": r["bodyWidth"], "sizes": r["sizes"]} for w, r in runs.items()},
                "findings": findings,
                "prose": prose,
                "geometry": {
                    "findings": geo_findings,
                    "probes": {str(w): r["probes"] for w, r in geo.items()},
                },
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )

    for width, result in runs.items():
        print(f"폭 {width} (본문 {result['bodyWidth']}px), 화면 {len(result['sizes'])}개")
        for sid, count in result["sizes"].items():
            hits = [f for f in result["findings"] if f["screen"] == sid]
            para = [f for f in result["prose"] if f["screen"] == sid]
            extra = f", 이어진 본문 문단 {len(para)}쌍" if para else ""
            print(f"  {labels.get(sid, sid)}: 글자 줄 {count}개, 눌린 쌍 {len(hits)}개{extra}")
    if prose:
        print("\n이어진 본문 문단은 위반으로 세지 않는다(원래 대등한 나열). measure.json 의 prose 에 남는다.")

    # ── 기하 요약 ──
    print()
    for width, result in geo.items():
        probe = result["probes"]
        by_rule = {}
        for f in result["findings"]:
            by_rule[f["rule"]] = by_rule.get(f["rule"], 0) + 1
        detail = ", ".join(f"{r} {n}건" for r, n in sorted(by_rule.items())) or "위반 0"
        # 넘침은 바깥 테두리만 세므로, 딸려 나간 자손 수를 따로 붙인다. 이 숫자가 크면 결함
        # 하나가 화면을 얼마나 넓게 밀고 있는지가 보인다(글꼴에 따라 갈리므로 판정은 아니다).
        spread = probe["overflowAll"] - by_rule.get("overflow-x", 0)
        detail += f" (넘침에 딸려 나간 자손 {spread}개)" if spread else ""
        print(
            f"기하 폭 {width}: 요소 {probe['elements']}개(자리 예약 {probe['reserve']}, "
            f"붙박이 {probe['sticky']}), {detail}"
        )

    # 통제군 둘. 종류가 달라 판정도 다르다.
    #
    # 위계는 킷 페이지 '고치기 전' 칸이 통제군이다. 저기서 아무것도 못 찾으면 위반이 없는
    # 것이 아니라 이 스크립트가 고장 난 것이다. **폭마다** 본다. 한 폭에서만 잡히면 나머지
    # 폭은 아무것도 안 보고 있었을 수 있다.
    blind = [w for w, r in runs.items() if not any(f["screen"] == "kit" for f in r["findings"])]
    if blind:
        print(f"\n통제군 실패. 폭 {blind} 에서 킷 반례를 못 잡았다. 그 폭의 실측이 고장 났다.", file=sys.stderr)
        return 1

    # 기하에는 반례 화면을 두지 않는다. 일부러 넘치는 칸을 킷에 심으면 킷이 실제로 390 에서
    # 깨지고, 그것은 CCC-88 이 방금 고친 결함을 되돌리는 일이다. 대신 **잰 개수**를 단언한다.
    # 선택자가 썩어 대상을 못 찾으면 위반 0 이 아니라 여기서 멈춘다.
    for width, result in geo.items():
        probe = result["probes"]
        if probe["elements"] == 0:
            print(f"\n기하 통제군 실패. 폭 {width} 에서 잰 요소가 0개다. 훑기가 고장 났다.", file=sys.stderr)
            return 1
        if probe["reserve"] == 0:
            print(
                f"\n기하 통제군 실패. 폭 {width} 에서 자리 예약([data-reserve]) 대상이 0개다. "
                "로딩 화면이 하니스에서 빠졌거나 속성 이름이 바뀌었다.",
                file=sys.stderr,
            )
            return 1
    # 붙박이는 폭마다 단언하지 않는다. 레일은 880 미만에서 한 열로 접히며 정상적으로 사라진다
    # (실측: 1280 에 둘, 1024 에 하나, 880 아래로는 없다). 가장 넓은 폭에서만 대상이 있어야 한다.
    widest = max(WIDTHS)
    if geo[widest]["probes"]["sticky"] == 0:
        print(
            f"\n기하 통제군 실패. 폭 {widest} 에서 붙박이(position:sticky) 대상이 0개다. "
            "레일이 하니스에서 빠졌거나 선택자가 썩었다.",
            file=sys.stderr,
        )
        return 1

    # 킷은 위계 통제군이라 래칫에서 뺀다. 저기 눌린 쌓임이 있는 것이 정상이고(일부러 만든
    # 반례), 기준선에 넣으면 "고치면 실패"와 "고장 나면 실패"가 한 줄에서 부딪힌다.
    # 키에 폭을 넣는다. 같은 자리라도 폭이 다르면 다른 사실이다.
    keys = {f"{f['width']} | {f['screen']} | {f['parent']} | {f['combo']}" for f in findings if f["screen"] != "kit"}
    known = set(load_json(baseline_file, {"entries": []})["entries"])
    # 기하는 킷도 뺄 이유가 없다. 킷에는 일부러 만든 기하 반례가 없기 때문이다.
    geo_keys = {geo_key(f) for f in geo_findings}

    if "--update-baseline" in sys.argv:
        write_baseline(
            baseline_file,
            "위계 실측 기준선(이웃한 두 줄). 여기 적힌 쌍은 이미 있던 것이라 실패로 세지 않는다.",
            keys,
        )
        write_baseline(
            geometry_baseline_file,
            "기하 실측 기준선(자리 예약·붙박이·가로 넘침). 여기 적힌 자리는 "
            "**고쳐야 하는데 아직 안 고친 결함**이지 승인된 예외가 아니다. 새 위반만 막으려고 "
            "적어 둔 것이고, 고쳤으면 목록에서도 지운다(안 지우면 실패한다).",
            geo_keys,
        )
        print(f"\n기준선 갱신: 위계 {len(keys)}개, 기하 {len(geo_keys)}개")
        return 0

    failed = False

    fresh = sorted(keys - known)
    stale = sorted(known - keys)
    if fresh:
        print(f"\n새로 눌린 쌓임 {len(fresh)}건:", file=sys.stderr)
        for key in fresh:
            hit = next(
                f for f in findings if f"{f['width']} | {f['screen']} | {f['parent']} | {f['combo']}" == key
            )
            print(f"  {key}", file=sys.stderr)
            print(f"    '{hit['first']}' 다음에 '{hit['second']}' 가 같은 옷으로 온다", file=sys.stderr)
    if stale:
        print(f"\n기준선이 낡았다. 아래 {len(stale)}건은 더 이상 안 나오니 목록에서도 지운다:", file=sys.stderr)
        for key in stale:
            print(f"  {key}", file=sys.stderr)
    if fresh or stale:
        failed = True

    known_geo = set(load_json(geometry_baseline_file, {"entries": []})["entries"])
    geo_fresh = sorted(geo_keys - known_geo)
    geo_stale = sorted(known_geo - geo_keys)
    if geo_fresh:
        print(f"\n새 기하 위반 {len(geo_fresh)}건:", file=sys.stderr)
        for key in geo_fresh:
            hit = next(f for f in geo_findings if geo_key(f) == key)
            print(f"  {key}", file=sys.stderr)
            print(f"    {hit['detail']}", file=sys.stderr)
    if geo_stale:
        print(f"\n기하 기준선이 낡았다. 아래 {len(geo_stale)}건은 더 이상 안 나오니 목록에서도 지운다:", file=sys.stderr)
        for key in geo_stale:
            print(f"  {key}", file=sys.stderr)
    if geo_fresh or geo_stale:
        # 기준선을 만든 기계와 지금 기계가 다르면 화면이 조금 다르게 설 수 있다. 하니스는
        # file:// 로 열려 리눅스 CI 에는 한글 글꼴이 없다(CCC-86 에서 킷 쌍이 macOS 4,
        # 리눅스 5 로 갈렸다). 세 판정 모두 글꼴에 안 기대게 골랐지만, 로컬은 초록인데 CI 만
        # 빨갛다면 화면이 아니라 이것부터 의심한다.
        print(
            "\n로컬과 CI 의 결과가 다르면 글꼴 차이일 수 있다. 기준선은 CI 와 같은 환경에서 만든다.",
            file=sys.stderr,
        )
        failed = True

    if failed:
        return 1
    print(
        f"\n실측 통과. 위계 새 쌍 0건(기준선 {len(known)}개), "
        f"기하 새 위반 0건(기준선 {len(known_geo)}개)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
