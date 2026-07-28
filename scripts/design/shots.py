"""스킨 패스 렌더 증거 수집기 — 로컬 프리뷰 화면을 PNG 로 찍는다.

색만 바뀌는 작업은 테스트가 통과하면서 화면이 깨질 수 있으므로 before/after 쌍이 근거다.

    ~/.local/share/uv/tools/playwright/bin/python scripts/design/shots.py <라벨>

전제: docs/ops.md '로컬 프리뷰' 절차대로 API(8787)·웹(3000)이 떠 있어야 한다.
레포 의존성에는 playwright 를 넣지 않는다 — 머신에 설치된 uv 툴을 그대로 쓴다.
"""

import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

if len(sys.argv) < 2:
    print("usage: python scripts/design/shots.py <label>", file=sys.stderr)
    raise SystemExit(1)

label = sys.argv[1]
base = os.environ.get("SHOT_BASE", "http://localhost:3000")
beneficiary = os.environ.get("SHOT_BENEFICIARY", "crane-001")
case_id = os.environ.get("SHOT_CASE", "373abf6e-80a2-47de-8f95-f7f76cf0c209")
out_dir = pathlib.Path("artifacts/skin-shots") / label

PAGES = [
    ("home", "/"),
    ("kit", "/kit"),
    ("schedule", "/programs/financial_support_v1/schedule"),
    ("briefing", f"/participants/{beneficiary}/programs/{case_id}/briefing"),
    ("participant", f"/participants/{beneficiary}"),
    ("records", f"/participants/{beneficiary}/programs/{case_id}/records"),
    ("record-new", f"/participants/{beneficiary}/programs/{case_id}/records/new"),
    ("intake", f"/participants/{beneficiary}/programs/{case_id}/records/intake"),
    ("participant-new", "/participants/new"),
    ("schedule-new", "/schedules/new"),
    ("settings", "/settings"),
    ("admin-users", "/admin/users"),
    ("preview-gate", "/preview"),
]

# 모바일은 레이아웃이 바뀌는 화면만 찍는다(전 화면 2배는 비교 비용만 늘린다).
MOBILE_PAGES = {"home", "schedule", "briefing", "record-new"}

VIEWPORTS = [
    ("desktop", {"width": 1440, "height": 1000}),
    ("mobile", {"width": 390, "height": 844}),
]

out_dir.mkdir(parents=True, exist_ok=True)
failures: list[str] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    for vp_name, viewport in VIEWPORTS:
        context = browser.new_context(viewport=viewport, device_scale_factor=2)
        page = context.new_page()
        for name, path in PAGES:
            if vp_name == "mobile" and name not in MOBILE_PAGES:
                continue
            try:
                response = page.goto(f"{base}{path}", wait_until="networkidle", timeout=30_000)
                status = response.status if response is not None else 0
                if status >= 400:
                    failures.append(f"{name} -> HTTP {status}")
                # 아코디언(details)은 접힌 채로는 내부 스타일이 안 보이므로 전부 펼친다.
                page.evaluate("() => { for (const d of document.querySelectorAll('details')) d.open = true; }")
                page.wait_for_timeout(250)
                page.screenshot(path=str(out_dir / f"{vp_name}-{name}.png"), full_page=True)
            except Exception as error:  # noqa: BLE001 - 한 화면 실패가 나머지를 막지 않게 한다
                failures.append(f"{vp_name}/{name} -> {str(error).splitlines()[0]}")
        context.close()
    browser.close()

print(f"saved to {out_dir}")
if failures:
    print(f"FAILURES ({len(failures)}):")
    for line in failures:
        print(f"  {line}")
    raise SystemExit(1)
print("all pages captured with no navigation errors")
