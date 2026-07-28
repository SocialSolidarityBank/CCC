"""실무자가 당사자 가입 링크를 실제로 발급해 본다 (CCC-29 · D39/ADR-0016).

발급 버튼을 눌러 링크·QR·이메일 문안 세 형태가 실제로 나오는지, 복사 버튼이 붙어 있는지,
막다른 화면이 아닌지(복귀 링크)를 확인하고 스크린샷을 남긴다.

    ~/.local/share/uv/tools/playwright/bin/python scripts/design/journey-invite-issue.py
"""

import json
import os
import pathlib

from playwright.sync_api import sync_playwright

base = os.environ.get("SHOT_BASE", "http://localhost:3000")
out = pathlib.Path(os.environ.get("SHOT_OUT", "artifacts/journey/ccc-29"))
out.mkdir(parents=True, exist_ok=True)

report: dict[str, object] = {}

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(f"{base}/participants/invite", wait_until="networkidle")
    page.screenshot(path=str(out / "01-idle.png"), full_page=True)

    report["title"] = page.locator("h1").first.inner_text()
    report["target_fields"] = page.locator(".wire-field-row").all_inner_texts()
    report["issue_button"] = page.get_by_role("button", name="가입 링크 만들기").count()

    # 발급
    page.get_by_role("button", name="가입 링크 만들기").click()
    page.wait_for_selector("#invite-url", timeout=15000)
    page.wait_for_timeout(400)
    page.screenshot(path=str(out / "02-issued.png"), full_page=True)

    url_value = page.locator("#invite-url").input_value()
    report["issued_url"] = url_value
    report["token_len"] = len(url_value.rsplit("/", 1)[-1])
    report["qr_svg"] = page.locator(".wire-invite-qr svg").count()
    report["email_draft_lines"] = len(page.locator("#invite-email-draft").input_value().splitlines())
    report["copy_buttons"] = page.get_by_role("button", name="복사").count() + page.locator(
        "button", has_text="복사"
    ).count()
    report["sidebar_return"] = page.locator(".navigation-link[data-current=\"true\"]").count()

    # 레이아웃 계약: 글 폭(D37 — narrow 화면)
    box = page.locator(".page-content").first.bounding_box()
    report["page_content_width"] = None if box is None else round(box["width"])

    # 모바일 접힘
    page.set_viewport_size({"width": 390, "height": 900})
    page.wait_for_timeout(300)
    page.screenshot(path=str(out / "03-mobile.png"), full_page=True)
    mobile_box = page.locator(".wire-invite-qr").first.bounding_box()
    report["mobile_qr_width"] = None if mobile_box is None else round(mobile_box["width"])
    report["horizontal_overflow"] = page.evaluate(
        "document.documentElement.scrollWidth > document.documentElement.clientWidth"
    )

    report["page_errors"] = errors
    browser.close()

(out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(report, ensure_ascii=False, indent=2))
