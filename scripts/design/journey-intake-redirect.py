"""인테이크 저장 → 브리핑 직행 + 1회성 '다음 상담 등록' 안내줄(CCC-31 · 스펙 #78 US 17·18).

저장 직후 그 참여 사업의 브리핑으로 이동하고, 상단에 안내줄이 한 번 뜬 뒤
주소에서 파라미터가 지워지며, 안내줄 버튼이 상담 등록 화면(참여자·참여 사업
사전 선택)으로 이어지는지를 실제 브라우저로 증명한다. 새로고침 시 안내줄이
사라지는 1회성도 확인한다.

    ~/.local/share/uv/tools/playwright/bin/python scripts/design/journey-intake-redirect.py
"""

import json
import os
import pathlib
import re
import urllib.parse

from playwright.sync_api import sync_playwright

base = os.environ.get("SHOT_BASE", "http://localhost:3000")
beneficiary = os.environ.get("JOURNEY_BENEFICIARY", "crane-001")
support_case = os.environ.get(
    "JOURNEY_CASE", "5d60b9ba-3092-4a91-b3f2-06f00bfd0270"
)
out_dir = pathlib.Path("artifacts/journey/intake-redirect")
out_dir.mkdir(parents=True, exist_ok=True)

AREAS = ["경제·생계", "주거", "일·고용·학업", "건강", "심리·정서", "가족·관계·돌봄"]

result: dict[str, object] = {}

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1400})
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    intake_url = f"{base}/participants/{beneficiary}/programs/{support_case}/records/intake"
    page.goto(intake_url, wait_until="networkidle")
    result["intake_loaded"] = page.get_by_role("heading", name="① 시작").count() > 0

    # 상담 일시(자동 채움 보장용)
    if page.get_by_label("상담 일시").count() > 0:
        page.get_by_label("상담 일시").fill("2026-07-28T14:00")

    # ② 동의 2
    page.get_by_role("button", name=re.compile(r"2\. 동의")).click()
    page.get_by_label("개인정보 수집·이용 동의").click()
    page.get_by_label("녹음·AI 정리 동의").click()

    # ③ 원하는 도움 3문
    page.get_by_role("button", name=re.compile(r"3\. 원하는 도움")).click()
    page.get_by_label("오늘 어떤 도움").fill("생계비 상담")
    page.get_by_label("가장 힘든 점").fill("월세 체납")
    page.get_by_label("어떻게 달라지면").fill("안정적으로 거주")

    # ④ 생활 상황 6영역
    page.get_by_role("button", name=re.compile(r"4\. 생활 상황")).click()
    for label in AREAS:
        page.get_by_label(f"{label} 상태").select_option("okay")

    # ⑤ 목표 1 + 행동 1
    page.get_by_role("button", name=re.compile(r"5\. 정리")).click()
    page.get_by_label("목표 1", exact=True).fill("월세 체납 해소")
    page.get_by_label("다음 행동 1", exact=True).fill("서류 준비")

    complete = page.get_by_role("button", name="완료")
    result["complete_enabled"] = complete.is_enabled()
    page.screenshot(path=str(out_dir / "01-intake-filled.png"), full_page=True)

    # 저장 → 브리핑 직행
    complete.click()
    page.wait_for_url(lambda u: "/briefing" in u, timeout=15000)
    result["url_after_save"] = page.url
    result["redirect_has_notice_param"] = "notice=intake_saved" in page.url

    # 안내줄 등장 대기(서버가 notice=intake_saved 로 렌더)
    notice = page.get_by_test_id("intake-saved-notice")
    notice.wait_for(state="visible", timeout=10000)
    result["notice_visible"] = notice.is_visible()
    result["notice_title"] = notice.locator("p").first.inner_text()
    page.wait_for_timeout(400)  # replaceState 가 URL 파라미터를 지울 때까지
    result["url_after_strip"] = page.url
    result["param_stripped_after_mount"] = "notice=" not in page.url
    page.screenshot(path=str(out_dir / "02-briefing-notice.png"), full_page=True)

    # 안내줄 버튼 → 상담 등록 화면(참여자·참여 사업 사전 선택)
    cta = notice.get_by_role("link", name="다음 상담 등록")
    result["cta_href"] = cta.get_attribute("href")
    cta.click()
    page.wait_for_url(lambda u: "/schedules/new" in u, timeout=10000)
    parsed = urllib.parse.parse_qs(urllib.parse.urlparse(page.url).query)
    result["schedule_target"] = parsed.get("target", [None])[0]
    result["target_prefilled_correct"] = result["schedule_target"] == f"{beneficiary}|{support_case}"
    page.screenshot(path=str(out_dir / "03-schedule-prefilled.png"), full_page=True)

    # 1회성: 브리핑을 새로고침하면 안내줄이 사라진다
    page.goto(
        f"{base}/participants/{beneficiary}/programs/{support_case}/briefing",
        wait_until="networkidle",
    )
    result["notice_absent_on_reload"] = page.get_by_test_id("intake-saved-notice").count() == 0
    page.screenshot(path=str(out_dir / "04-briefing-no-notice.png"), full_page=True)

    result["page_errors"] = errors
    browser.close()

(out_dir / "result.json").write_text(
    json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(json.dumps(result, ensure_ascii=False, indent=2))
