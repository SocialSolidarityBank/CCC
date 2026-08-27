"""전 라우트 IA 실측 캡처기.

``shots.py``가 인벤토리와 PNG 자체를 검증하는 정적 하니스라면, 이 도구는 같은
인벤토리의 2개 테마 x 3개 폭을 실제 프리뷰에서 캡처하고 보고서를 남긴다.

    python3 scripts/design/ia-shots.py <라벨>
    python3 scripts/design/ia-shots.py --plan
    python3 scripts/design/ia-shots.py --verify-report artifacts/ia-shots/<라벨>/report.json

캡처에는 docs/ops.md의 로컬 프리뷰 절차대로 API(8787)와 웹(3000)이 떠 있어야 한다.
런타임 fixture는 route-inventory.json의 환경 변수 이름으로 주입한다.
"""

import argparse
import importlib.util
import json
import os
import pathlib
from typing import Any


SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
INVENTORY_PATH = SCRIPT_DIR / "route-inventory.json"
OUTPUT_ROOT = REPO_ROOT / "artifacts/ia-shots"


def _load_shots_module() -> Any:
    spec = importlib.util.spec_from_file_location("design_shots", SCRIPT_DIR / "shots.py")
    if spec is None or spec.loader is None:
        raise RuntimeError("shots.py를 불러올 수 없습니다")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


shots = _load_shots_module()


def load_inventory() -> dict[str, Any]:
    data = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("인벤토리 최상위 값은 객체여야 합니다")
    shots.validate_inventory(data)
    return data


def _matrix(data: dict[str, Any]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    return [
        (theme, viewport)
        for theme in data["measurementMatrix"]["themes"]
        for viewport in data["measurementMatrix"]["viewports"]
    ]


def build_plan(data: dict[str, Any]) -> list[dict[str, Any]]:
    values = shots.fixture_values(data)
    actor_selector = os.environ.get("SHOT_PERMISSION_ACTOR")
    routes = shots.selected_routes(data, actor_selector)
    plan: list[dict[str, Any]] = []
    for theme, viewport in _matrix(data):
        for route in routes:
            plan.append(
                {
                    **route,
                    "resolvedUrl": shots.resolve_url(route["representativeUrl"], values),
                    "theme": theme["name"],
                    "width": viewport["width"],
                    "height": viewport["height"],
                    "viewport": viewport["name"],
                }
            )
    return plan


def sweep_key(row: dict[str, Any]) -> tuple[str, str, int]:
    return (str(row["page"]), str(row["theme"]), int(row["width"]))


def capture_filename(row: dict[str, Any]) -> str:
    slug = shots.screenshot_name(str(row["routePattern"]))
    return f"{row['theme']}-{row['viewport']}-{slug}.png"


def report_metadata(row: dict[str, Any]) -> dict[str, Any]:
    """보고서에 런타임 fixture가 치환된 URL을 남기지 않는다."""
    return {
        key: value for key, value in row.items() if key not in {"resolvedUrl", "viewport"}
    } | {"path": row["representativeUrl"]}


def validate_sweep(
    plan: list[dict[str, Any]],
    report: list[dict[str, Any]],
    report_dir: pathlib.Path,
    *,
    require_files: bool = True,
) -> list[str]:
    """계획된 실측 행의 완전성, 테마·뷰포트 관측값과 라우트 상태를 검증한다."""
    defects: list[str] = []
    expected = {sweep_key(row): row for row in plan}
    observed: dict[tuple[str, str, int], dict[str, Any]] = {}

    for row in report:
        try:
            key = sweep_key(row)
        except (KeyError, TypeError, ValueError) as error:
            defects.append(f"형식이 잘못된 보고서 행: {error}")
            continue
        if key not in expected:
            defects.append(f"계획에 없는 실측: {key}")
            continue
        if key in observed:
            defects.append(f"중복 실측: {key}")
            continue
        observed[key] = row

    for key, planned in expected.items():
        row = observed.get(key)
        if row is None:
            defects.append(f"누락 실측: {key}")
            continue

        screenshot = row.get("screenshot")
        expected_name = capture_filename(planned)
        if screenshot != expected_name:
            defects.append(f"스크린샷 이름 불일치: {key} {screenshot!r} != {expected_name!r}")
        elif require_files and not (report_dir / expected_name).is_file():
            defects.append(f"스크린샷 파일 없음: {key} {expected_name}")

        if row.get("observedTheme") != planned["theme"]:
            defects.append(f"테마 불일치: {key} {row.get('observedTheme')!r} != {planned['theme']!r}")
        viewport = row.get("viewport")
        expected_viewport = {"width": planned["width"], "height": planned["height"]}
        if viewport != expected_viewport:
            defects.append(f"뷰포트 불일치: {key} {viewport!r} != {expected_viewport!r}")

        # kit은 정적 가드의 통제군이다. 캡처 완전성은 검사하되 런타임 오류는 제외한다.
        if planned["unification"] and row.get("status") != 200:
            defects.append(f"HTTP 실패: {key} {row.get('status')!r}")
        if planned["unification"]:
            errors = row.get("errors")
            if not isinstance(errors, list) or errors:
                defects.append(f"브라우저 오류: {key} {errors!r}")

    return defects


def capture(label: str, data: dict[str, Any], plan: list[dict[str, Any]]) -> int:
    from playwright.sync_api import sync_playwright

    base = os.environ.get("SHOT_BASE", "http://localhost:3000").rstrip("/")
    out_dir = OUTPUT_ROOT / label
    out_dir.mkdir(parents=True, exist_ok=True)
    report: list[dict[str, Any]] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for theme, viewport in _matrix(data):
            rows = [
                row for row in plan
                if row["theme"] == theme["name"] and row["width"] == viewport["width"]
            ]
            context = browser.new_context(
                viewport={"width": viewport["width"], "height": viewport["height"]},
                device_scale_factor=2,
            )
            context.add_cookies([{"name": "ccc_theme", "value": theme["cookieValue"], "url": base}])
            page = context.new_page()
            page_errors: list[str] = []
            page.on("pageerror", lambda error: page_errors.append(str(error)))
            for row in rows:
                page_errors.clear()
                status = 0
                observed: dict[str, Any] = {"observedTheme": None, "viewport": None, "metrics": None}
                screenshot = capture_filename(row)
                try:
                    response = page.goto(
                        f"{base}{row['resolvedUrl']}",
                        wait_until="networkidle",
                        timeout=30_000,
                    )
                    status = response.status if response is not None else 0
                    observed = page.evaluate(
                        """() => {
                          const main = document.querySelector('main');
                          const container = document.querySelector('.wire-container');
                          const box = (el) => el ? { w: Math.round(el.getBoundingClientRect().width),
                                                     x: Math.round(el.getBoundingClientRect().left) } : null;
                          return {
                            observedTheme: document.documentElement.dataset.theme || 'light',
                            viewport: { width: window.innerWidth, height: window.innerHeight },
                            metrics: { main: box(main), container: box(container) },
                          };
                        }"""
                    )
                    page.screenshot(path=str(out_dir / screenshot), full_page=True)
                except Exception as error:  # noqa: BLE001
                    page_errors.append(str(error).splitlines()[0])
                report.append(
                    {
                        **report_metadata(row),
                        "status": status,
                        "errors": list(page_errors),
                        "screenshot": screenshot,
                        **observed,
                    }
                )
            context.close()
        browser.close()

    report_path = out_dir / "report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    defects = validate_sweep(plan, report, out_dir)
    matrix = data["measurementMatrix"]
    print(
        f"ia-shots -> {out_dir} ({len(data['routes'])} routes x "
        f"{len(matrix['themes'])} themes x {len(matrix['viewports'])} widths)"
    )
    for defect in defects:
        print(f"  DEFECT {defect}")
    return 1 if defects else 0


def verify_report(path: pathlib.Path, data: dict[str, Any], plan: list[dict[str, Any]]) -> int:
    report = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(report, list):
        raise ValueError("실측 보고서 최상위 값은 배열이어야 합니다")
    defects = validate_sweep(plan, report, path.parent)
    if defects:
        for defect in defects:
            print(f"DEFECT {defect}")
        return 1
    print(f"verified {len(report)} measurements -> {path}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("label", nargs="?", help="artifacts/ia-shots 아래 결과 폴더 이름")
    parser.add_argument("--plan", action="store_true", help="브라우저 없이 실측 대상 JSON을 출력")
    parser.add_argument("--verify-report", type=pathlib.Path, help="기존 report.json과 PNG 완전성을 재검증")
    args = parser.parse_args()
    if not args.plan and args.verify_report is None and args.label is None:
        parser.error("label이 필요합니다")
    if args.label is not None and (args.plan or args.verify_report is not None):
        parser.error("label은 --plan 또는 --verify-report와 함께 쓸 수 없습니다")

    try:
        data = load_inventory()
        plan = build_plan(data)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))
    if args.plan:
        print(json.dumps(plan, ensure_ascii=False))
        return 0
    if args.verify_report is not None:
        try:
            return verify_report(args.verify_report, data, plan)
        except (OSError, ValueError, json.JSONDecodeError) as error:
            parser.error(str(error))
    return capture(args.label, data, plan)


if __name__ == "__main__":
    raise SystemExit(main())
