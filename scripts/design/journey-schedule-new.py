"""상담 등록(다음 만남 잡기)을 끝까지 눌러 본다.

참여자 시나리오가 '다음 회차까지 약속 2개'로 끝나므로, 다음 일정을 실제로 잡을 수
있는지가 상담 한 바퀴의 마지막 칸이다. 단계마다 무엇이 보이고 무엇이 막히는지 남긴다.

    ~/.local/share/uv/tools/playwright/bin/python scripts/design/journey-schedule-new.py
"""

import json
import os
import pathlib

from playwright.sync_api import sync_playwright

base = os.environ.get("SHOT_BASE", "http://localhost:3000")
out_dir = pathlib.Path("artifacts/journey/schedule-new")
out_dir.mkdir(parents=True, exist_ok=True)

stages: list[dict[str, object]] = []


def snap(page, name: str) -> None:
    body = " ".join(page.inner_text("body").split())
    stages.append({
        "stage": name,
        "url": page.url,
        "buttons": page.eval_on_selector_all(
            "button", "els => els.map(e => ({t:(e.innerText||'').trim().slice(0,34), d:e.disabled}))"
        )[:12],
        "fields": page.eval_on_selector_all(
            "input:not([type=hidden]), textarea, select",
            "els => els.map(e => e.tagName.toLowerCase()+':'+(e.type||'')+':'+(e.name||e.id||''))",
        )[:14],
        "body": body[-420:],
    })
    page.screenshot(path=str(out_dir / f"{len(stages):02d}-{name}.png"), full_page=True)


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1100})
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    page.goto(f"{base}/schedules/new", wait_until="networkidle")
    snap(page, "step1-참여자선택")

    # 참여자 카드(임하준) 선택 → '다음' 이 열리는지
    page.locator("button", has_text="임하준").first.click()
    page.wait_for_timeout(400)
    snap(page, "step1-선택후")

    def click_next() -> bool:
        nxt = page.locator("button", has_text="다음")
        if nxt.count() > 0 and not nxt.first.is_disabled():
            nxt.first.click()
            page.wait_for_timeout(600)
            return True
        return False

    # 일시를 먼저 채운다 — 1단계 필수값이다
    dt0 = page.locator("input[type=datetime-local]")
    if dt0.count() > 0:
        dt0.first.fill("2026-08-10T14:00")
        page.wait_for_timeout(400)
    snap(page, "step1-일시입력")

    click_next()
    snap(page, "step2")
    click_next()
    snap(page, "step3")

    # 일시 입력이 보이면 채우고 등록까지
    dt = page.locator("input[type=datetime-local]")
    if dt.count() > 0:
        dt.first.fill("2026-08-10T14:00")
        page.wait_for_timeout(300)
    submit = page.locator("button", has_text="등록")
    if submit.count() > 0 and not submit.first.is_disabled():
        submit.first.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1200)
    snap(page, "step4-등록후")

    browser.close()

(out_dir / "result.json").write_text(
    json.dumps({"stages": stages, "page_errors": errors}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
for s in stages:
    print("=" * 60)
    print(s["stage"], "|", s["url"].replace(base, ""))
    print("  버튼:", [(b["t"] or "?") + ("(비활성)" if b["d"] else "") for b in s["buttons"]])
    print("  입력:", s["fields"])
    print("  본문:", s["body"][-240:])
print("page_errors:", errors)
