"""상담사가 3회차 기록을 실제로 채워 넣고 '서버에 공식 기록 저장'까지 눌러 본다.

journey-counselor.py 가 '이동'을 봤다면 여기서는 **일이 끝나는가**를 본다 —
상담 내용을 넣을 칸이 실제로 있는지, 저장이 성공하는지, 저장 뒤 어디로 가는지.

    ~/.local/share/uv/tools/playwright/bin/python scripts/design/journey-record-save.py
"""

import json
import os
import pathlib

from playwright.sync_api import sync_playwright

base = os.environ.get("SHOT_BASE", "http://localhost:3000")
beneficiary = os.environ.get("JOURNEY_MINE", "whale-001")
support_case = os.environ.get("JOURNEY_CASE", "0c79b7fa-2fd5-4aca-95e3-451fcb5e2477")
out_dir = pathlib.Path("artifacts/journey/record-save")
out_dir.mkdir(parents=True, exist_ok=True)

MEMO = (
    "발주량 조절은 자리잡음 — 나물류 덜 시키고 폐기 줄었다고 함.\n"
    "대출로 대출 막는 패턴이 이번 회차에 처음 드러남. 본인도 다음 달 반복될까 걱정.\n"
    "대인관계 회피 언급(동생 전화 피함). 지속 관찰 필요."
)

result: dict[str, object] = {}

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 1200})
    errors: list[str] = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    url = f"{base}/participants/{beneficiary}/programs/{support_case}/records/new"
    page.goto(url, wait_until="networkidle")

    # 0) 접힌 아코디언을 전부 펼친다.
    #    GAS·액션·리스크 플래그가 기본 접힘이라, 펼치지 않으면 입력 자체가 불가능하다
    #    (2026-07-27 실측: element is not visible 로 fill 실패). 이 사실 자체를 기록한다.
    result["accordions_total"] = page.locator("details.record-accordion").count()
    result["accordions_open_by_default"] = page.locator("details.record-accordion[open]").count()
    page.eval_on_selector_all("details", "els => els.forEach(e => e.open = true)")
    page.wait_for_timeout(300)

    # 1) 수기 메모 + 상담 일시
    page.fill("textarea[name=memo]", MEMO)
    page.fill("input[name=heldAt]", "2026-07-27T14:00")

    # 2) GAS 세 칸 — 대본대로 +1 / 0 / -1
    gas = page.query_selector_all("select[name=gasScore]")
    result["gas_select_count"] = len(gas)
    for sel, value in zip(gas, ["1", "0", "-1"]):
        try:
            sel.select_option(value)
        except Exception as exc:  # 선택지가 대본과 다르면 그대로 남긴다
            result.setdefault("gas_errors", []).append(f"{value}: {exc}")

    # 3) 액션 아이템 3건
    actions = [
        ("지출 장부 정리 마무리", "2026-08-10"),
        ("부채 상담 연계 자료 안내", "2026-08-10"),
        ("동생에게 안부 문자", "2026-08-03"),
    ]
    for i, (desc, due) in enumerate(actions):
        if page.query_selector(f"input[name=actionDescription{i}]"):
            page.fill(f"input[name=actionDescription{i}]", desc)
            page.fill(f"input[name=actionDueDate{i}]", due)

    # 4) 리스크 — 고정 유형 선택칸이 있는지, 없으면 자유 서술만 되는지
    result["risk_type_control"] = bool(
        page.query_selector("select[name*=flag], input[name*=flag], select[name*=risk]")
    )
    if page.query_selector("textarea[name=safetyNote]"):
        page.fill("textarea[name=safetyNote]", "부채 돌려막기 진술. 동생 연락 회피 — 고립 초기 신호.")

    page.screenshot(path=str(out_dir / "01-filled.png"), full_page=True)

    # 5) 저장
    save = page.get_by_role("button", name="서버에 공식 기록 저장")
    result["save_button_found"] = save.count() > 0
    if save.count() > 0:
        save.first.click()
        page.wait_for_load_state("networkidle")
        page.wait_for_timeout(1500)

    result["url_after_save"] = page.url
    body = " ".join(page.inner_text("body").split())
    result["body_after_save"] = body[:600]
    result["saved_ok"] = ("저장" in body and "실패" not in body and "오류" not in body)
    page.screenshot(path=str(out_dir / "02-after-save.png"), full_page=True)

    # 6) 저장한 기록이 목록에 실제로 보이는가
    page.goto(f"{base}/participants/{beneficiary}/programs/{support_case}/records",
              wait_until="networkidle")
    listing = " ".join(page.inner_text("body").split())
    result["memo_visible_in_list"] = "발주량" in listing
    result["records_list_excerpt"] = listing[:500]
    page.screenshot(path=str(out_dir / "03-records-list.png"), full_page=True)

    result["page_errors"] = errors
    browser.close()

(out_dir / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2)[:2000])
