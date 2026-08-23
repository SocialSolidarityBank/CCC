"""CCC-30 한 바퀴 완주 journey — 온보딩 → 실무자 → 참여자 링크 → 가입 → 배지 →
인테이크 일정 → 기록 저장 → 브리핑 → 다음 일정까지 실제 브라우저로 돈다.

기존 journey-*.py 와 같은 방식(playwright, artifacts/journey/<label>/journey.json +
단계별 PNG)이고, 각 화면의 '나가는 길'(링크·버튼)을 채집해 막다른 화면(dead_end)을
표시한다. 전제: docs/ops.md '로컬 프리뷰'대로 웹(3000)이 떠 있고 로컬 시드(실무자·
참여자, PUBLIC_SIGNUP_ENABLED=1)가 준비돼 있다.

    ~/.local/share/uv/tools/playwright/bin/python scripts/design/journey-complete.py

각 단계는 대상을 '찾아서 클릭'하는 대신 직접 URL 로 이동한다(기존 방식과 같음) —
링크가 진짜 있는지는 record() 의 links/dead_end 로 점검한다. 채우는 폼(참여자 가입)만
예외로 실제 입력한다.
"""

import json
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

label = sys.argv[1] if len(sys.argv) > 1 else "complete"
base = os.environ.get("SHOT_BASE", "http://localhost:3000")
out_dir = pathlib.Path("artifacts/journey") / label
out_dir.mkdir(parents=True, exist_ok=True)

steps: list[dict[str, object]] = []


def record(page, name: str, note: str = "") -> dict[str, object]:
    links = page.eval_on_selector_all(
        "a[href]",
        "els => els.map(e => ({t: (e.innerText||'').trim().slice(0,40), h: e.getAttribute('href')}))",
    )
    buttons = page.eval_on_selector_all(
        "button, input[type=submit]",
        "els => els.map(e => ({t: (e.innerText||e.value||'').trim().slice(0,40), d: e.disabled, type: e.type}))",
    )
    enabled_actions = [
        button for button in buttons
        if not button["d"] and button["t"] and button["type"] == "submit"
    ]
    body_text = page.inner_text("body")
    # 공개 가입 표면에는 직원 앱으로 돌아가는 링크를 일부러 두지 않는다. 대신 가입 전에는
    # 활성 제출 버튼이 출구이고, 가입 완료·자기 확인은 그 자체가 의도된 종점이다.
    terminal_markers = {
        "05-join-submitted": "가입이 완료되었습니다",
        "06-self-check": "당사자 자기 확인",
    }
    terminal_marker = terminal_markers.get(name)
    terminal = terminal_marker is not None and terminal_marker in body_text
    shell = {"/participants", "/settings", "/programs/financial_support_v1/schedule"}
    own = [l for l in links
           if l["h"] and l["h"] not in shell
           and "/schedule/all" not in l["h"]]
    # D35 기준: 앱 화면은 셸 링크가 복귀 경로다. 공개 가입 화면은 이름 있는 submit
    # 버튼이나 명시적 완료 종점으로 막다름 여부를 판별한다.
    entry = {
        "step": name,
        "url": page.url,
        "note": note,
        "links_total": len(links),
        "links_own": own[:14],
        "buttons": [b for b in buttons][:14],
        "enabled_actions": enabled_actions,
        "terminal": terminal,
        "own_exits": len(own),
        "dead_end": len(links) == 0 and len(enabled_actions) == 0 and not terminal,
        "title": page.title(),
    }
    steps.append(entry)
    page.screenshot(path=str(out_dir / f"{len(steps):02d}-{name}.png"), full_page=True)
    return entry


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    # 1) 실무자 첫 화면 (승인된 실무자 세션 — 로컬 프리뷰 자동 인증 가정)
    page.goto(base, wait_until="networkidle")
    record(page, "01-home", "로그인 후 첫 화면")

    # 2) 참여자 목록 — 새 가입 배지(CCC-26) 영역
    page.goto(f"{base}/participants", wait_until="networkidle")
    record(page, "02-participants", "참여자 목록(새 가입 배지 확인)")

    # 3) 참여자 링크 발급 화면(CCC-33·CCC-27 전제)
    page.goto(f"{base}/participants/invite", wait_until="networkidle")
    record(page, "03-invite", "참여자 초대 발급")

    # 4) 참여자 가입(공개 표면) — 유효 토큰이 있다는 전제 아래. 토큰은 환경변수로 받는다.
    token = os.environ.get("JOURNEY_JOIN_TOKEN", "")
    if token:
        page.goto(f"{base}/join/participant/{token}", wait_until="networkidle")
        record(page, "04-participant-join", "참여자 가입(공개)")
        # 가입 폼이 보이면 실제로 제출한다(이름·연락처·동의 2종).
        if page.locator("form").count() > 0:
            try:
                page.fill("input[name=name]", "여정 참여자")
                page.fill("input[name=phone]", "010-0000-0000")
                page.check("input[name=consentPrivacy]")
                page.check("input[name=consentRecordingAi]")
                page.click("button[type=submit]")
                page.wait_for_load_state("networkidle", timeout=10000)
                record(page, "05-join-submitted", "가입 제출 후")
            except Exception as e:  # noqa: BLE001
                errors.append(f"join submit failed: {e}")
        # 가입 직후 같은 링크 = 자기 확인(CCC-27)
        if token:
            page.goto(f"{base}/join/participant/{token}", wait_until="networkidle")
            record(page, "06-self-check", "같은 링크 재방문 = 자기 확인")

    # 5) 배지 확인 — 참여자 목록 복귀
    page.goto(f"{base}/participants", wait_until="networkidle")
    rec = record(page, "07-participants-again", "가입 후 참여자 목록(새 가입 배지)")
    rec["body_has_new_signup"] = "새 가입" in page.inner_text("body")

    # 6) 인테이크 일정 등록
    page.goto(f"{base}/schedules/new", wait_until="networkidle")
    record(page, "08-schedule-new", "다가오는 일정 등록(1단계)")

    # 7) 기록 저장 — 담당 참여자의 회차 목록 → 새 기록
    mine = os.environ.get("JOURNEY_MINE", "")
    if mine:
        page.goto(f"{base}/participants/{mine}", wait_until="networkidle")
        hub = record(page, "09-hub", "담당 참여자 허브")
        briefing = next((l["h"] for l in hub["links_own"] if "briefing" in (l["h"] or "")), None)
        if briefing:
            page.goto(base + briefing, wait_until="networkidle")
            br = record(page, "10-briefing", "15초 페이지(브리핑)")
            body = page.inner_text("body")
            br["visible_sections"] = {
                k: (k in body) for k in ["리스크", "전체 목표", "액션", "개인정보", "승인 대기", "불일치"]
            }
            records = next((l["h"] for l in br["links_own"] if l["h"].endswith("/records")), None)
            if records:
                page.goto(base + records, wait_until="networkidle")
                rr = record(page, "11-records", "전체 상담 기록")
                new_rec = next((l["h"] for l in rr["links_own"] if l["h"].endswith("/records/new")), None)
                if new_rec:
                    page.goto(base + new_rec, wait_until="networkidle")
                    n = record(page, "12-record-new", "상담 기록 작성")
                    body = page.inner_text("body")
                    n["can_enter"] = {
                        k: (k in body) for k in ["수기 메모", "액션", "플래그", "6영역", "의견", "GAS"]
                    }

    # 8) 다음 상담 등록 — 막다른 골목이 없는지
    page.goto(f"{base}/schedules/new", wait_until="networkidle")
    record(page, "13-schedule-next", "다음 상담 등록")

    # 9) 설정 — 복귀 링크
    page.goto(f"{base}/settings", wait_until="networkidle")
    record(page, "14-settings", "설정")

    browser.close()

(out_dir / "journey.json").write_text(
    json.dumps({"steps": steps, "page_errors": errors}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
dead = [s for s in steps if s["dead_end"]]
print(f"steps={len(steps)} dead_end={len(dead)} errors={len(errors)} -> {out_dir}/journey.json")
if dead:
    print("DEAD ENDS:", json.dumps([{"step": s["step"], "url": s["url"]} for s in dead], ensure_ascii=False))
