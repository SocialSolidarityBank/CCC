"""레이아웃 계약(D37/ADR-0015) 실측 — **실제 앱 화면**이 계약과 같은 숫자인지 잰다.

`artifacts/layout-frame-v1/sheet.html` 은 시안이 계약과 맞는지만 증명한다. 이 스크립트는
같은 계산을 라이브 화면에 대고 돌려서 **코드가 계약을 지키는지**를 본다.

    ~/.local/share/uv/tools/playwright/bin/python scripts/design/layout-measure.py

전제: docs/ops.md '로컬 프리뷰'대로 API(8787)와 웹(3000)이 떠 있어야 한다.
결과는 artifacts/layout-measure/<라벨>/measure.json 과 화면별 PNG(1440 만).

재는 것 (DESIGN.md §4 · §7 락 8~12):
  - 페이지 컨테이너 총폭 1120(패딩 포함) · 좌우 패딩 40 → 글 폭 1040
    (.narrow 960 은 2026-08-05 폐지 — 장폭은 1120 하나다)
  - 상단 헤더 높이 56 (2026-08-05 신설) · 768 미만에서 없음(드로어가 대신한다)
  - 섹션 간격 24 · 카드 gap 20
  - 사이드바 280 (2026-08-02 D58/ADR-0028 — 구 240) · 768 미만에서 숨음
  - 표준 그리드 열 수(1440 에서 2) · 조밀 그리드 열 수(1440 에서 3, 좁으면 1)
  - 가로 스크롤 없음
"""

import json
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

label = sys.argv[1] if len(sys.argv) > 1 else "d37"
base = os.environ.get("SHOT_BASE", "http://localhost:3000")
out_dir = pathlib.Path("artifacts/layout-measure") / label
out_dir.mkdir(parents=True, exist_ok=True)

# 계약 값. 폭이 줄어도 따라 줄지 않는다 — 768 미만 패딩만 예외다(§4-4).
CONTRACT = {
    "page_max": 1120,
    "header": 56,  # 2026-08-05 상단 헤더 — 767 미만은 0(드로어 손잡이 바가 대신한다)
    "pad_desktop": 40,
    "pad_mobile_x": 16,
    "section_gap": 24,
    "card_gap": 20,
    "sidebar": 280,  # 2026-08-02 D58/ADR-0028 — 구 240
}
WIDTHS = [1440, 1280, 1024, 767, 390]
# 참여 사업 ID 는 시드마다 달라진다 — 참여자 허브에서 첫 사업 링크를 읽어 채운다.
PARTICIPANT = os.environ.get("MEASURE_PARTICIPANT", "whale-001")
PROGRAM_TYPE = os.environ.get("MEASURE_PROGRAM_TYPE", "microloan")

MEASURE_JS = """() => {
  const px = (v) => Math.round(parseFloat(v) || 0);
  const content = document.querySelector('.page-content');
  const sidebar = document.querySelector('.sidebar');
  const cols = (el) => el ? getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length : null;
  const out = {
    scrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    docScroll: document.documentElement.scrollWidth,
    docClient: document.documentElement.clientWidth,
  };
  const header = document.querySelector('.app-header');
  if (header) {
    const hs = getComputedStyle(header);
    out.headerHeight = hs.display === 'none' ? 0 : Math.round(header.getBoundingClientRect().height);
  }
  if (content) {
    const cs = getComputedStyle(content);
    out.containerWidth = Math.round(content.getBoundingClientRect().width);
    out.padLeft = px(cs.paddingLeft);
    out.padRight = px(cs.paddingRight);
    out.textWidth = out.containerWidth - out.padLeft - out.padRight;
    out.sectionGap = px(cs.rowGap);
    out.containerType = cs.containerType;
  }
  if (sidebar) {
    const cs2 = getComputedStyle(sidebar);
    // 768 미만에서 사이드바는 숨는 게 아니라 **드로어**라 화면 밖으로 나간다(§4-4).
    // DOM 에는 폭 280 으로 남아 있지만 position:fixed 라 본문 트랙을 차지하지 않는다 —
    // 여기서 재는 것은 "본문 폭을 얼마나 가져가는가"이므로 드로어는 0 이다.
    out.sidebarDrawer = cs2.position === 'fixed';
    out.sidebarWidth = (cs2.display === 'none' || out.sidebarDrawer)
      ? 0
      : Math.round(sidebar.getBoundingClientRect().width);
  } else {
    out.sidebarWidth = 0;
    out.sidebarDrawer = false;
  }
  const std = document.querySelector('.briefing-cards-grid, .card-grid, .participant-program-list');
  if (std) { out.stdCols = cols(std); out.stdGap = px(getComputedStyle(std).columnGap); }
  const dense = document.querySelector('.briefing-gas-grid, .card-grid-dense');
  if (dense) { out.denseCols = cols(dense); out.denseGap = px(getComputedStyle(dense).columnGap); }
  return out;
}"""


def check(width: int, m: dict) -> list[str]:
    """계약과 다른 값만 문장으로 돌려준다. 빈 목록 = 통과."""
    bad = []
    mobile = width < 768
    if m.get("scrollX"):
        bad.append(f"가로 스크롤 발생 ({m['docScroll']} > {m['docClient']})")
    if "containerWidth" in m:
        pad = CONTRACT["pad_mobile_x"] if mobile else CONTRACT["pad_desktop"]
        if m["padLeft"] != pad or m["padRight"] != pad:
            bad.append(f"컨테이너 좌우 패딩 {m['padLeft']}/{m['padRight']} (계약 {pad})")
        # 넓은 화면에서만 상한이 걸린다. 좁으면 화면 폭을 따라가는 게 정상이다.
        # 장폭은 1120 하나다(.narrow 960 은 2026-08-05 폐지).
        avail = width - m.get("sidebarWidth", 0)
        expected = min(CONTRACT["page_max"], avail)
        if abs(m["containerWidth"] - expected) > 1:
            bad.append(f"컨테이너 총폭 {m['containerWidth']} (계약 {expected})")
        if m["sectionGap"] != CONTRACT["section_gap"]:
            bad.append(f"섹션 간격 {m['sectionGap']} (계약 {CONTRACT['section_gap']})")
        if m.get("containerType") != "inline-size":
            bad.append(f"container-type {m.get('containerType')} (계약 inline-size)")
    if m.get("sidebarWidth") is not None:
        want = 0 if mobile else CONTRACT["sidebar"]
        if m["sidebarWidth"] != want:
            bad.append(f"사이드바 {m['sidebarWidth']} (계약 {want})")
    # 셸이 바뀌는 지점은 이 하나뿐이다(§4-4 · 락 11) — 768 미만은 드로어, 이상은 고정 사이드바.
    if m.get("sidebarDrawer") is not None and m["sidebarDrawer"] != mobile:
        bad.append(f"{'드로어여야 하는데 고정' if mobile else '고정이어야 하는데 드로어'}다")
    # 상단 헤더(2026-08-05): 데스크톱 56 · 768 미만 0(드로어 손잡이 바가 대신한다).
    if m.get("headerHeight") is not None:
        want_header = 0 if mobile else CONTRACT["header"]
        if m["headerHeight"] != want_header:
            bad.append(f"헤더 높이 {m['headerHeight']} (계약 {want_header})")
    for key, name in (("stdGap", "표준 그리드 gap"), ("denseGap", "조밀 그리드 gap")):
        if key in m and m[key] != CONTRACT["card_gap"]:
            bad.append(f"{name} {m[key]} (계약 {CONTRACT['card_gap']})")
    # 조밀 그리드는 3열 아니면 1열이다 — 2열이면 세부 목표 3개가 둘 + 외톨이로 앉는다(§4-2).
    if m.get("denseCols") == 2:
        bad.append("조밀 그리드가 2열 (계약: 3열 아니면 1열)")
    # §4-2 표가 든 실제 숫자를 그대로 단언한다. 위의 검사들은 "틀린 값이 없는가"만 보므로
    # 그리드가 통째로 1열로 주저앉아도 통과한다 — 그래서 열 수는 따로 못 박는다.
    if width == 1440:
        if m.get("stdCols") is not None and m["stdCols"] != 2:
            bad.append(f"1440 에서 표준 그리드 {m['stdCols']}열 (계약 2열)")
        if m.get("denseCols") is not None and m["denseCols"] != 3:
            bad.append(f"1440 에서 조밀 그리드 {m['denseCols']}열 (계약 3열)")
    return bad


def discover_routes(page) -> list[tuple[str, str]]:
    page.goto(f"{base}/participants/{PARTICIPANT}", wait_until="networkidle")
    page.wait_for_timeout(600)
    href = page.eval_on_selector_all(
        "a[href*='/briefing']", "els => els.map(e => e.getAttribute('href'))"
    )
    if not href:
        raise SystemExit(f"참여자 {PARTICIPANT} 의 브리핑 링크를 찾지 못했다 — 시드·로그인 상태를 확인할 것")
    routes = [
        ("participants", "/participants"),
        ("participant-hub", f"/participants/{PARTICIPANT}"),
        ("schedule", f"/programs/{PROGRAM_TYPE}/schedule"),
        # 폼 화면 2종 — 구 .narrow(960) 였다가 2026-08-05 에 기본 폭(1120)으로 합쳐진
        # 화면이라, 폐지가 실제로 반영됐는지 함께 잰다.
        ("schedule-new", "/schedules/new"),
        ("participant-new", "/participants/new"),
    ]
    if href:
        case = href[0]
        routes.insert(0, ("briefing", case))
        routes.append(("records", case.replace("/briefing", "/records")))
        routes.append(("record-new", case.replace("/briefing", "/records/new")))
    return routes


rows = []
with sync_playwright() as p:
    browser = p.chromium.launch()
    probe = browser.new_page(viewport={"width": 1440, "height": 900})
    ROUTES = discover_routes(probe)
    probe.close()
    for width in WIDTHS:
        page = browser.new_page(viewport={"width": width, "height": 900})
        for name, path in ROUTES:
            page.goto(f"{base}{path}", wait_until="networkidle")
            # dev 서버는 첫 방문에 CSS 를 나중에 주입한다 — 그 순간에 재면 사이드바가 0 으로 잡힌다.
            # 셸이 붙기를 기다린다. .page-content 가 없는 화면(킷 셸만 쓰는 화면)도 있으므로
            # 없으면 그냥 넘어간다 — 아래 측정이 알아서 빈 값으로 보고한다.
            try:
                page.wait_for_selector(".page-content", state="attached", timeout=5000)
            except Exception:
                pass
            page.wait_for_timeout(400)
            m = page.evaluate(MEASURE_JS)
            bad = check(width, m)
            rows.append({"width": width, "route": name, "path": path, "measured": m, "violations": bad})
            print(f"{width:>5} {name:<16} {'OK' if not bad else 'X  ' + ' / '.join(bad)}")
            if width == 1440:
                page.screenshot(path=str(out_dir / f"{name}-1440.png"), full_page=True)
        page.close()
    browser.close()

(out_dir / "measure.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
fails = sum(len(r["violations"]) for r in rows)
print(f"\n계약 위반 {fails}건 · 결과 {out_dir}/measure.json")
sys.exit(1 if fails else 0)
