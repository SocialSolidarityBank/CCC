"""IA 수정 패스 렌더 증거 수집기 — 앱의 **모든** 화면을 PNG 로 찍는다.

스킨 패스의 shots.py 는 13화면만 찍어서 `/participants`·`/admin/*` 같은 화면이 증거에서
빠져 있었다. 셸(장폭·여백)을 고치면 전 화면이 조용히 재배치되므로 여기서는 라우트를
전부 넣는다. 404 도 결함이므로 걸러내지 않고 상태 코드와 함께 기록한다.

    ~/.local/share/uv/tools/playwright/bin/python scripts/design/ia-shots.py <라벨>

전제: docs/ops.md '로컬 프리뷰' 절차대로 API(8787)·웹(3000)이 떠 있어야 한다.
"""

import json
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

if len(sys.argv) < 2:
    print("usage: python scripts/design/ia-shots.py <label>", file=sys.stderr)
    raise SystemExit(1)

label = sys.argv[1]
base = os.environ.get("SHOT_BASE", "http://localhost:3000")
beneficiary = os.environ.get("SHOT_BENEFICIARY", "crane-001")
case_id = os.environ.get("SHOT_CASE", "5d60b9ba-3092-4a91-b3f2-06f00bfd0270")
program = os.environ.get("SHOT_PROGRAM", "financial_support_v1")
out_dir = pathlib.Path("artifacts/ia-shots") / label

PAGES = [
    ("home", "/"),
    ("kit", "/kit"),
    ("schedule", f"/programs/{program}/schedule"),
    ("schedule-all", f"/programs/{program}/schedule/all"),
    ("participants", "/participants"),
    ("participant-hub", f"/participants/{beneficiary}"),
    ("participant-new", "/participants/new"),
    ("participant-invite", "/participants/invite"),
    ("briefing", f"/participants/{beneficiary}/programs/{case_id}/briefing"),
    ("records", f"/participants/{beneficiary}/programs/{case_id}/records"),
    ("record-new", f"/participants/{beneficiary}/programs/{case_id}/records/new"),
    ("intake", f"/participants/{beneficiary}/programs/{case_id}/records/intake"),
    ("schedule-new", "/schedules/new"),
    ("session-new", "/sessions/new"),
    ("settings", "/settings"),
    ("admin", "/admin"),
    ("admin-users", "/admin/users"),
    ("admin-assign", "/admin/assign"),
    ("admin-invite", "/admin/invite"),
    ("admin-settings", "/admin/settings"),
    ("preview-gate", "/preview"),
]

VIEWPORTS = [
    ("desktop", {"width": 1440, "height": 1000}),
    ("mobile", {"width": 390, "height": 844}),
]

out_dir.mkdir(parents=True, exist_ok=True)
report: list[dict[str, object]] = []

with sync_playwright() as p:
    browser = p.chromium.launch()
    for vp_name, viewport in VIEWPORTS:
        context = browser.new_context(viewport=viewport, device_scale_factor=2)
        page = context.new_page()
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        for name, path in PAGES:
            errors.clear()
            response = page.goto(f"{base}{path}", wait_until="networkidle")
            status = response.status if response is not None else 0
            page.screenshot(path=str(out_dir / f"{name}-{vp_name}.png"), full_page=True)
            if vp_name == "desktop":
                # 셸 측정: 콘텐츠 컬럼의 실제 폭·좌우 여백을 숫자로 남긴다.
                metrics = page.evaluate(
                    """() => {
                      const main = document.querySelector('main');
                      const container = document.querySelector('.wire-container');
                      const box = (el) => el ? { w: Math.round(el.getBoundingClientRect().width),
                                                 x: Math.round(el.getBoundingClientRect().left) } : null;
                      return { main: box(main), container: box(container) };
                    }"""
                )
                report.append({"page": name, "path": path, "status": status,
                               "errors": list(errors), "metrics": metrics})
        context.close()
    browser.close()

(out_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2))
bad = [r for r in report if r["status"] != 200 or r["errors"]]
print(f"shots -> {out_dir}  ({len(PAGES)} pages x {len(VIEWPORTS)} viewports)")
for r in bad:
    print(f"  DEFECT {r['status']} {r['path']} {r['errors']}")
