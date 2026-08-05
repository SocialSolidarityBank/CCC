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
      // 2026-08-05 2차: 손잡이 버튼이 .drawer-bar(기관·사업 선택창 + 원형 메뉴 버튼) 안으로
      // 들어갔다. 노출 여부는 바가 정한다 — display:none 부모 안 자식의 computed display 는
      // 자기 값(grid)을 돌려주므로 바 자체를 봐야 한다.
      const bar = document.querySelector('.drawer-bar');
      const s = document.querySelector('.sidebar');
      return {
        barShown: bar ? getComputedStyle(bar).display !== 'none' : false,
        closeShown: (() => { const c = document.querySelector('.drawer-dismiss');
                             return c ? getComputedStyle(c).display !== 'none' : false; })(),
        sidebarWidth: s ? Math.round(s.getBoundingClientRect().width) : 0,
        sidebarLeft: s ? Math.round(s.getBoundingClientRect().left) : null,
      };
    }""")
    check("1440: 모바일 바 없음 (데스크톱은 상단 헤더가 맡는다)", not desk["barShown"], str(desk))
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
      const bar = document.querySelector('.drawer-bar');
      const h = document.querySelector('.drawer-handle');
      const box = s.getBoundingClientRect();
      return {
        barShown: getComputedStyle(bar).display !== 'none',
        barHeight: Math.round(bar.getBoundingClientRect().height),
        // 원형 메뉴 버튼(32)이 바 오른쪽 끝에 있고, 기관·사업 선택창이 그 왼쪽에 있다.
        handleRound: Math.round(h.getBoundingClientRect().width) === 32
          && Math.round(h.getBoundingClientRect().height) === 32,
        orgInBar: bar.querySelector('.org-switcher') !== null,
        programInBar: bar.querySelector('.program-switcher:not(.org-switcher)') !== null,
        sidebarLeft: Math.round(box.left),
        sidebarWidth: Math.round(box.width),
        docScroll: document.documentElement.scrollWidth,
        docClient: document.documentElement.clientWidth,
        scrim: document.querySelector('.drawer-scrim') !== null,
      };
    }""")
    check("390: 모바일 바 보임 · 높이 56", closed["barShown"] and closed["barHeight"] == 56, str(closed))
    check("390: 바 = 기관·사업 선택창 + 원형(32) 메뉴 버튼", closed["orgInBar"] and closed["programInBar"] and closed["handleRound"], str(closed))
    # 2026-08-06 Q ①: 드로어는 오른쪽에서 나온다 — 닫혔을 때 왼쪽 끝이 화면 폭 이상 = 화면 밖 오른쪽.
    check("390: 드로어가 화면 밖(오른쪽)에 있다", closed["sidebarLeft"] >= closed["docClient"], str(closed))
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
    # 280 · max 82vw → 390 에서 280. 오른쪽 끝에 붙는다(2026-08-06 Q ①).
    check("390: 열면 오른쪽 끝 · 폭 280", opened["left"] == 110 and opened["width"] == 280, str(opened))
    # 화면 높이를 채워야 한다. 내용 높이로 뜨면 아래쪽에 본문이 비쳐 패널로 안 읽힌다 —
    # 2026-07-27 에 죽은 `.sidebar{position:relative}` 가 position:fixed 를 덮어 실제로 그랬다.
    check("390: 드로어가 화면 높이를 채운다",
          opened["top"] == 0 and opened["height"] == opened["viewport"], str(opened))
    check("390: 스크림이 화면 전체를 덮는다", opened["scrimHeight"] == opened["viewport"], str(opened))
    check("390: 스크림 생김 · aria-expanded=true", opened["scrim"] and opened["expanded"] == "true", str(opened))
    check("390: 열린 동안 본문 스크롤 잠김", opened["bodyOverflow"] == "hidden", str(opened))
    # 2026-08-06 Q ③·2차: 드로어 안 모든 아이템의 좌우 시작선 — 드로어 버튼(닫기)·메뉴 상자
    # 좌 24, 계정 행동 묶음·메뉴 상자 우 24 (패딩 24 한 줄). 닫기는 여는 버튼과 같은 32 원형.
    align = page.evaluate("""() => {
      const s = document.querySelector('.sidebar').getBoundingClientRect();
      const dismiss = document.querySelector('.drawer-dismiss').getBoundingClientRect();
      const actions = [...document.querySelectorAll('.sidebar-actions .header-icon-button')];
      const last = actions[actions.length - 1].getBoundingClientRect();
      const nav = document.querySelector('.sidebar .navigation-link').getBoundingClientRect();
      return {
        dismissLeft: Math.round(dismiss.left - s.left), navLeft: Math.round(nav.left - s.left),
        actionsRight: Math.round(s.right - last.right), navRight: Math.round(s.right - nav.right),
        dismissSize: Math.round(dismiss.width) + 'x' + Math.round(dismiss.height),
      };
    }""")
    check("390: 좌우 시작선 정렬 — 드로어 버튼(32)·메뉴 상자 좌 24 · 계정 행동·메뉴 상자 우 24",
          align["dismissLeft"] == 24 and align["navLeft"] == 24
          and align["actionsRight"] == 24 and align["navRight"] == 24
          and align["dismissSize"] == "32x32", str(align))
    page.screenshot(path=str(out / "mobile-390-open.png"))

    # 드로어(110..390)가 오른쪽을 덮으므로 사람이 실제로 누르는 드러난 띠는 왼쪽이다.
    page.mouse.click(50, 400)
    page.wait_for_timeout(300)
    after = page.evaluate("""() => ({
      left: Math.round(document.querySelector('.sidebar').getBoundingClientRect().left),
      client: document.documentElement.clientWidth,
      scrim: document.querySelector('.drawer-scrim') !== null,
      bodyOverflow: getComputedStyle(document.body).overflow,
    })""")
    check("390: 스크림을 누르면 닫히고 스크롤이 풀린다",
          after["left"] >= after["client"] and not after["scrim"] and after["bodyOverflow"] != "hidden", str(after))
    page.close()
    browser.close()

print(f"\n실패 {len(fails)}건 · 스크린샷 {out}/")
sys.exit(1 if fails else 0)
