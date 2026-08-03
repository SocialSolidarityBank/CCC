"""드로어(768 미만 셸) 실동작 확인 — DESIGN.md §4-4 · §7 락 8·11.

컴포넌트 테스트는 상태와 마크업만 본다. 실제로 **화면 밖에 있다가 밀려 들어오는지**,
본문이 사이드바만큼 밀리지 않는지, 데스크톱에는 손잡이가 없는지는 렌더해야 안다.

    ~/.local/share/uv/tools/playwright/bin/python scripts/design/drawer-check.py

전제: docs/ops.md '로컬 프리뷰'대로 API(8787)·웹(3000)이 떠 있어야 한다.
결과는 artifacts/layout-measure/drawer/ 에 PNG 3장.
"""

import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

base = os.environ.get("SHOT_BASE", "http://localhost:3000")
path = os.environ.get("DRAWER_PATH", "/participants")
out = pathlib.Path("artifacts/layout-measure/drawer")
out.mkdir(parents=True, exist_ok=True)

fails: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'OK ' if ok else 'X  '} {label}{'' if ok else ' — ' + detail}")
    if not ok:
        fails.append(label)


with sync_playwright() as p:
    browser = p.chromium.launch()

    # ── 데스크톱 1440: 손잡이·스크림이 없고 사이드바가 280 으로 서 있다 (D58 — 구 240) ──
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(f"{base}{path}", wait_until="networkidle")
    page.wait_for_timeout(400)
    desk = page.evaluate("""() => {
      const h = document.querySelector('.drawer-handle');
      const s = document.querySelector('.sidebar');
      return {
        handleShown: h ? getComputedStyle(h).display !== 'none' : false,
        closeShown: (() => { const c = document.querySelector('.drawer-close');
                             return c ? getComputedStyle(c).display !== 'none' : false; })(),
        sidebarWidth: s ? Math.round(s.getBoundingClientRect().width) : 0,
        sidebarLeft: s ? Math.round(s.getBoundingClientRect().left) : null,
      };
    }""")
    check("1440: 손잡이 바 없음 (락 8 — 상단 헤더 띠 금지)", not desk["handleShown"], str(desk))
    check("1440: 드로어 닫기 버튼 없음", not desk["closeShown"], str(desk))
    check("1440: 사이드바 280 · 왼쪽 끝 고정", desk["sidebarWidth"] == 280 and desk["sidebarLeft"] == 0, str(desk))
    page.screenshot(path=str(out / "desktop-1440.png"))
    page.close()

    # ── 휴대폰 390: 평소엔 화면 밖, 손잡이를 누르면 들어온다 ──
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.goto(f"{base}{path}", wait_until="networkidle")
    page.wait_for_timeout(400)

    closed = page.evaluate("""() => {
      const s = document.querySelector('.sidebar');
      const h = document.querySelector('.drawer-handle');
      const box = s.getBoundingClientRect();
      return {
        handleShown: getComputedStyle(h).display !== 'none',
        handleHeight: Math.round(h.getBoundingClientRect().height),
        sidebarRight: Math.round(box.right),
        sidebarWidth: Math.round(box.width),
        scrim: document.querySelector('.drawer-scrim') !== null,
        docScroll: document.documentElement.scrollWidth,
        docClient: document.documentElement.clientWidth,
      };
    }""")
    check("390: 손잡이 바 보임 · 높이 56", closed["handleShown"] and closed["handleHeight"] == 56, str(closed))
    # 닫혔을 때 오른쪽 끝이 0 이하 = 화면 밖에 있다.
    check("390: 드로어가 화면 밖에 있다", closed["sidebarRight"] <= 0, str(closed))
    check("390: 스크림 없음", not closed["scrim"], str(closed))
    check("390: 가로 스크롤 없음", closed["docScroll"] <= closed["docClient"], str(closed))
    page.screenshot(path=str(out / "mobile-390-closed.png"))

    page.click(".drawer-handle")
    page.wait_for_timeout(300)
    opened = page.evaluate("""() => {
      const box = document.querySelector('.sidebar').getBoundingClientRect();
      const scrim = document.querySelector('.drawer-scrim');
      return {
        left: Math.round(box.left), width: Math.round(box.width),
        top: Math.round(box.top), height: Math.round(box.height),
        viewport: innerHeight,
        scrimHeight: scrim ? Math.round(scrim.getBoundingClientRect().height) : 0,
        scrim: scrim !== null,
        expanded: document.querySelector('.drawer-handle').getAttribute('aria-expanded'),
        bodyOverflow: getComputedStyle(document.body).overflow,
      };
    }""")
    # 280 · max 82vw → 390 에서 280.
    check("390: 열면 왼쪽 0 · 폭 280", opened["left"] == 0 and opened["width"] == 280, str(opened))
    # 화면 높이를 채워야 한다. 내용 높이로 뜨면 아래쪽에 본문이 비쳐 패널로 안 읽힌다 —
    # 2026-07-27 에 죽은 `.sidebar{position:relative}` 가 position:fixed 를 덮어 실제로 그랬다.
    check("390: 드로어가 화면 높이를 채운다",
          opened["top"] == 0 and opened["height"] == opened["viewport"], str(opened))
    check("390: 스크림이 화면 전체를 덮는다", opened["scrimHeight"] == opened["viewport"], str(opened))
    check("390: 스크림 생김 · aria-expanded=true", opened["scrim"] and opened["expanded"] == "true", str(opened))
    check("390: 열린 동안 본문 스크롤 잠김", opened["bodyOverflow"] == "hidden", str(opened))
    page.screenshot(path=str(out / "mobile-390-open.png"))

    # 스크림 중앙(x=195)은 폭 280 드로어 밑이라 클릭이 드로어에 가로막힌다 — 사람이 실제로
    # 누르는 자리는 드로어 오른쪽의 드러난 띠다. 좌표로 그 자리를 누른다.
    page.mouse.click(340, 400)
    page.wait_for_timeout(300)
    after = page.evaluate("""() => ({
      right: Math.round(document.querySelector('.sidebar').getBoundingClientRect().right),
      scrim: document.querySelector('.drawer-scrim') !== null,
      bodyOverflow: getComputedStyle(document.body).overflow,
    })""")
    check("390: 스크림을 누르면 닫히고 스크롤이 풀린다",
          after["right"] <= 0 and not after["scrim"] and after["bodyOverflow"] != "hidden", str(after))
    page.close()
    browser.close()

print(f"\n실패 {len(fails)}건 · 스크린샷 {out}/")
sys.exit(1 if fails else 0)
