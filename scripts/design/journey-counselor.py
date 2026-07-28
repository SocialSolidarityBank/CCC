"""상담사 페르소나 E2E 여정 — 실제 클릭으로 '상담 한 바퀴'를 돈다.

ia-shots.py 가 '모든 화면이 뜨는가'를 보는 반면 여기서는 **화면 사이를 실제로 이동**해서
- 오늘 만날 참여자까지 몇 번 클릭에 닿는가
- 각 화면에 나가는 길(링크·버튼)이 있는가 / 막다른 골목인가
- 기록 화면에 상담 내용을 넣을 칸이 실제로 있는가
를 기록한다. 전제: docs/ops.md '로컬 프리뷰'대로 웹(3000)이 떠 있어야 한다.

    ~/.local/share/uv/tools/playwright/bin/python scripts/design/journey-counselor.py

결과는 artifacts/journey/<라벨>/journey.json 과 단계별 PNG.
"""

import json
import os
import pathlib
import sys

from playwright.sync_api import sync_playwright

label = sys.argv[1] if len(sys.argv) > 1 else "counselor"
base = os.environ.get("SHOT_BASE", "http://localhost:3000")
mine = os.environ.get("JOURNEY_MINE", "whale-001")       # 담당 참여자
theirs = os.environ.get("JOURNEY_THEIRS", "crane-001")   # 담당 아닌 참여자
out_dir = pathlib.Path("artifacts/journey") / label
out_dir.mkdir(parents=True, exist_ok=True)

steps: list[dict[str, object]] = []


def record(page, name: str, note: str = "") -> dict[str, object]:
    """현재 화면의 '나가는 길'과 입력칸을 채집한다."""
    links = page.eval_on_selector_all(
        "a[href]",
        "els => els.map(e => ({t: (e.innerText||'').trim().slice(0,40), h: e.getAttribute('href')}))",
    )
    buttons = page.eval_on_selector_all(
        "button, input[type=submit]",
        "els => els.map(e => ({t: (e.innerText||e.value||'').trim().slice(0,40), d: e.disabled}))",
    )
    fields = page.eval_on_selector_all(
        "input:not([type=hidden]), textarea, select",
        "els => els.map(e => ({n: e.name||e.id||'', ty: e.tagName.toLowerCase()+':'+(e.type||'')}))",
    )
    # 사이드바 링크는 전 화면 공통이라 '그 화면만의 출구'와 구분한다.
    shell = {"/participants", "/settings"}
    own = [l for l in links
           if l["h"] and l["h"] not in shell
           and "/schedule" not in l["h"]]
    entry = {
        "step": name,
        "url": page.url,
        "note": note,
        "links_total": len(links),
        "links_own": own[:14],
        "buttons": [b for b in buttons][:14],
        "fields_count": len(fields),
        "fields": fields[:30],
        "dead_end": len(own) == 0,
    }
    steps.append(entry)
    page.screenshot(path=str(out_dir / f"{len(steps):02d}-{name}.png"), full_page=True)
    return entry


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    # 1) 첫 화면 — 로그인 후 상담사가 처음 보는 곳
    page.goto(base, wait_until="networkidle")
    record(page, "01-home", "로그인 직후 첫 화면")

    # 2) 참여자 목록 → 담당 참여자 허브
    page.goto(f"{base}/participants", wait_until="networkidle")
    record(page, "02-participants", "사이드바 '참여자'")

    page.goto(f"{base}/participants/{mine}", wait_until="networkidle")
    hub = record(page, "03-hub", "담당 참여자 정보 허브")

    # 3) 허브에서 브리핑으로 — 실제 링크를 눌러서 간다
    briefing_href = next((l["h"] for l in hub["links_own"] if "briefing" in (l["h"] or "")), None)
    if briefing_href:
        page.goto(base + briefing_href, wait_until="networkidle")
        record(page, "04-briefing", "허브 → 상담 준비(브리핑)")
        # 브리핑 본문에서 무엇이 실제로 보이는지
        body = page.inner_text("body")
        steps[-1]["visible_sections"] = {
            k: (k in body) for k in
            ["리스크", "전체 목표", "GAS", "지난 상담", "확인할 질문", "액션", "개인정보", "승인 대기"]
        }
        records_href = next((l["h"] for l in steps[-1]["links_own"] if l["h"].endswith("/records")), None)
    else:
        records_href = None

    # 4) 상담 기록 목록 → 새 기록
    if records_href:
        page.goto(base + records_href, wait_until="networkidle")
        rec = record(page, "05-records", "브리핑 → 상담 기록 목록")
        new_href = next((l["h"] for l in rec["links_own"] if l["h"].endswith("/records/new")), None)
        if new_href:
            page.goto(base + new_href, wait_until="networkidle")
            newrec = record(page, "06-record-new", "기록 목록 → 새 기록 작성")
            body = page.inner_text("body")
            newrec["can_enter"] = {
                k: (k in body) for k in
                ["세션 목표", "GAS", "액션", "리스크", "메모", "플래그", "점수"]
            }

    # 5) 상담 등록(다음 일정)
    page.goto(f"{base}/schedules/new", wait_until="networkidle")
    record(page, "07-schedule-new", "상담 등록 1단계")

    # 6) 담당이 아닌 참여자 직접 접근 — 막혀야 정상
    page.goto(f"{base}/participants/{theirs}", wait_until="networkidle")
    blocked = record(page, "08-not-mine", "담당 아닌 참여자 직접 주소 접근")
    blocked["body_text"] = " ".join(page.inner_text("body").split())[-260:]

    # 7) 전체 일정 (CCC-19 미구현 여부 확인)
    page.goto(f"{base}/programs/financial_support_v1/schedule/all", wait_until="networkidle")
    allsched = record(page, "09-schedule-all", "사이드바 '전체 일정'")
    allsched["body_text"] = " ".join(page.inner_text("body").split())[-260:]

    # 8) 설정 — 막다른 골목인지
    page.goto(f"{base}/settings", wait_until="networkidle")
    record(page, "10-settings", "사이드바 '설정'")

    browser.close()

(out_dir / "journey.json").write_text(
    json.dumps({"steps": steps, "page_errors": errors}, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
print(f"steps={len(steps)} errors={len(errors)} -> {out_dir}/journey.json")
