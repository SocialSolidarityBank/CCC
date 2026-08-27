"""전 라우트 디자인 실측 캡처 하니스.

라우트, 대표 URL, fixture, 권한 상태와 2개 테마 x 3개 폭 측정 조합은
``scripts/design/route-inventory.json`` 한 곳에서 읽는다.

    python3 scripts/design/shots.py --check-inventory
    ~/.local/share/uv/tools/playwright/bin/python scripts/design/shots.py <라벨>

캡처 전제는 docs/ops.md의 로컬 프리뷰 절차와 같다. 런타임에서 발급되는 fixture 값은
인벤토리의 ``fixtureEnvironment``에 선언된 환경 변수로 받는다.
권한별 서버를 나눠 찍을 때는 ``SHOT_PERMISSION_ACTOR=institution-admin`` 또는
``SHOT_PERMISSION_ACTOR=!institution-admin``처럼 actor 포함·제외 선택자를 쓴다.
"""

import json
import os
import pathlib
import re
import struct
import sys
from typing import Any


REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
INVENTORY_PATH = REPO_ROOT / "scripts/design/route-inventory.json"
PLACEHOLDER = re.compile(r"\{\{([A-Za-z][A-Za-z0-9]*)\}\}")
CAPTURE_LABEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]*")
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def route_pattern(page_path: str, source_root: str) -> str:
    """Next App Router의 page.tsx 경로를 사람이 읽는 라우트 패턴으로 바꾼다."""
    prefix = f"{source_root.rstrip('/')}/"
    if not page_path.startswith(prefix) or not page_path.endswith("/page.tsx"):
        raise ValueError(f"page 경로 형식이 잘못되었습니다: {page_path}")
    relative = page_path[len(prefix) : -len("/page.tsx")]
    if relative == "":
        return "/"
    segments = []
    for segment in relative.split("/"):
        match = re.fullmatch(r"\[([^/]+)\]", segment)
        segments.append(f":{match.group(1)}" if match else segment)
    return "/" + "/".join(segments)


def load_inventory() -> dict[str, Any]:
    try:
        data = json.loads(INVENTORY_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"인벤토리를 읽을 수 없습니다: {error}") from error
    if not isinstance(data, dict):
        raise ValueError("인벤토리 최상위 값은 객체여야 합니다")
    return data


def validate_inventory(data: dict[str, Any]) -> None:
    """인벤토리 스키마와 실제 page.tsx 집합이 정확히 같은지 검사한다."""
    errors: list[str] = []
    source_root = data.get("sourceRoot")
    routes = data.get("routes")
    matrix = data.get("measurementMatrix")
    defaults = data.get("fixtureDefaults")
    fixture_environment = data.get("fixtureEnvironment")

    if data.get("version") != 1:
        errors.append("version은 1이어야 합니다")
    if not isinstance(source_root, str) or not source_root:
        errors.append("sourceRoot가 필요합니다")
        source_root = "apps/web/app"
    if not isinstance(routes, list):
        errors.append("routes는 배열이어야 합니다")
        routes = []
    if not isinstance(defaults, dict):
        errors.append("fixtureDefaults는 객체여야 합니다")
        defaults = {}
    if not isinstance(fixture_environment, dict):
        errors.append("fixtureEnvironment는 객체여야 합니다")
        fixture_environment = {}
    elif any(not isinstance(key, str) or not isinstance(value, str) for key, value in fixture_environment.items()):
        errors.append("fixtureEnvironment의 키와 환경 변수 이름은 문자열이어야 합니다")

    themes = matrix.get("themes") if isinstance(matrix, dict) else None
    viewports = matrix.get("viewports") if isinstance(matrix, dict) else None
    if not isinstance(themes, list) or [item.get("name") for item in themes if isinstance(item, dict)] != ["light", "dark"]:
        errors.append("measurementMatrix.themes는 light, dark 순서의 2개 테마여야 합니다")
    widths = [item.get("width") for item in viewports if isinstance(item, dict)] if isinstance(viewports, list) else []
    if widths != [1280, 767, 390]:
        errors.append("measurementMatrix.viewports 폭은 1280, 767, 390이어야 합니다")

    actual_pages = {
        path.relative_to(REPO_ROOT).as_posix()
        for path in (REPO_ROOT / source_root).rglob("page.tsx")
    }
    inventory_pages: set[str] = set()
    inventory_patterns: set[str] = set()
    allowed_states = {"allowed", "public"}

    for index, route in enumerate(routes):
        label = f"routes[{index}]"
        if not isinstance(route, dict):
            errors.append(f"{label}는 객체여야 합니다")
            continue
        page = route.get("page")
        pattern = route.get("routePattern")
        url = route.get("representativeUrl")
        fixture = route.get("seedFixture")
        permission = route.get("permission")
        if not isinstance(page, str):
            errors.append(f"{label}.page가 필요합니다")
            continue
        if page in inventory_pages:
            errors.append(f"중복 page: {page}")
        inventory_pages.add(page)
        expected_pattern = route_pattern(page, source_root)
        if pattern != expected_pattern:
            errors.append(f"{page}: routePattern은 {expected_pattern}이어야 합니다")
        if not isinstance(pattern, str) or pattern in inventory_patterns:
            errors.append(f"중복 또는 잘못된 routePattern: {pattern}")
        else:
            inventory_patterns.add(pattern)
        if not isinstance(url, str) or not url.startswith("/"):
            errors.append(f"{page}: representativeUrl은 /로 시작해야 합니다")
        if not isinstance(fixture, str) or not fixture:
            errors.append(f"{page}: seedFixture가 필요합니다")
        if not isinstance(permission, dict) or permission.get("state") not in allowed_states or not isinstance(permission.get("actor"), str):
            errors.append(f"{page}: permission.state와 permission.actor가 필요합니다")
        if not isinstance(route.get("unification"), bool):
            errors.append(f"{page}: unification은 boolean이어야 합니다")
        if page.endswith("/kit/page.tsx") and route.get("unification") is not False:
            errors.append("kit 페이지는 통일 판정에서 제외해야 합니다")
        if not page.endswith("/kit/page.tsx") and route.get("unification") is not True:
            errors.append(f"{page}: kit 외 페이지는 통일 판정 대상이어야 합니다")
        if isinstance(url, str):
            for key in PLACEHOLDER.findall(url):
                if key not in defaults and key not in fixture_environment:
                    errors.append(f"{page}: 선언되지 않은 fixture 변수 {key}")

    missing = sorted(actual_pages - inventory_pages)
    extra = sorted(inventory_pages - actual_pages)
    if missing:
        errors.append("인벤토리 누락 page: " + ", ".join(missing))
    if extra:
        errors.append("존재하지 않는 page: " + ", ".join(extra))
    if len(routes) != len(actual_pages):
        errors.append(f"라우트 수 불일치: inventory={len(routes)}, page.tsx={len(actual_pages)}")

    if errors:
        raise ValueError("route inventory 검증 실패\n- " + "\n- ".join(errors))


def fixture_values(data: dict[str, Any]) -> dict[str, str]:
    values = {key: str(value) for key, value in data["fixtureDefaults"].items()}
    for key, environment_name in data["fixtureEnvironment"].items():
        value = os.environ.get(environment_name)
        if value:
            values[key] = value
    return values


def resolve_url(template: str, values: dict[str, str]) -> str:
    missing = sorted(set(PLACEHOLDER.findall(template)) - values.keys())
    if missing:
        raise ValueError("fixture 환경 변수가 필요합니다: " + ", ".join(missing))
    return PLACEHOLDER.sub(lambda match: values[match.group(1)], template)


def screenshot_name(route_pattern_value: str) -> str:
    if route_pattern_value == "/":
        return "home"
    return route_pattern_value.strip("/").replace("/", "__").replace(":", "by-")


def capture_dir(label: str) -> pathlib.Path:
    if CAPTURE_LABEL.fullmatch(label) is None or label in {".", ".."}:
        raise ValueError("캡처 라벨은 영문·숫자로 시작하고 영문·숫자·점·밑줄·하이픈만 써야 합니다")
    return REPO_ROOT / "artifacts/skin-shots" / label


def expected_capture_files(data: dict[str, Any]) -> dict[str, tuple[int, int]]:
    expected: dict[str, tuple[int, int]] = {}
    for theme in data["measurementMatrix"]["themes"]:
        for viewport in data["measurementMatrix"]["viewports"]:
            for route in data["routes"]:
                name = screenshot_name(route["routePattern"])
                filename = f"{theme['name']}-{viewport['name']}-{name}.png"
                expected[filename] = (viewport["width"], viewport["height"])
    return expected


def selected_routes(data: dict[str, Any], actor_selector: str | None) -> list[dict[str, Any]]:
    routes = data["routes"]
    if actor_selector is None or actor_selector == "":
        return routes
    exclude = actor_selector.startswith("!")
    actor = actor_selector[1:] if exclude else actor_selector
    known_actors = {route["permission"]["actor"] for route in routes}
    if actor not in known_actors:
        raise ValueError(f"인벤토리에 없는 permission actor입니다: {actor}")
    return [
        route
        for route in routes
        if (route["permission"]["actor"] != actor if exclude else route["permission"]["actor"] == actor)
    ]


def png_dimensions(path: pathlib.Path) -> tuple[int, int]:
    header = path.read_bytes()[:24]
    if len(header) != 24 or header[:8] != PNG_SIGNATURE or header[12:16] != b"IHDR":
        raise ValueError(f"PNG 형식이 아닙니다: {path.name}")
    return struct.unpack(">II", header[16:24])


def check_inventory() -> None:
    data = load_inventory()
    validate_inventory(data)
    combinations = len(data["measurementMatrix"]["themes"]) * len(data["measurementMatrix"]["viewports"])
    judged = sum(1 for route in data["routes"] if route["unification"])
    print(f"route-inventory: {len(data['routes'])}개 page.tsx 일치, 통일 판정 {judged}개, 라우트당 실측 조합 {combinations}개")


def check_capture(label: str) -> None:
    data = load_inventory()
    validate_inventory(data)
    out_dir = capture_dir(label)
    expected = expected_capture_files(data)
    actual = {path.name for path in out_dir.glob("*.png")} if out_dir.is_dir() else set()
    missing = sorted(expected.keys() - actual)
    extra = sorted(actual - expected.keys())
    errors: list[str] = []
    if missing:
        errors.append("누락 PNG: " + ", ".join(missing))
    if extra:
        errors.append("초과 PNG: " + ", ".join(extra))

    for filename in sorted(expected.keys() & actual):
        css_width, css_height = expected[filename]
        try:
            pixel_width, pixel_height = png_dimensions(out_dir / filename)
        except ValueError as error:
            errors.append(str(error))
            continue
        if pixel_width != css_width * 2:
            errors.append(f"{filename}: 폭 {pixel_width}px, 기대 {css_width * 2}px")
        if pixel_height < css_height * 2:
            errors.append(f"{filename}: 높이 {pixel_height}px, 최소 {css_height * 2}px")

    for viewport in data["measurementMatrix"]["viewports"]:
        for route in data["routes"]:
            name = screenshot_name(route["routePattern"])
            light = out_dir / f"light-{viewport['name']}-{name}.png"
            dark = out_dir / f"dark-{viewport['name']}-{name}.png"
            if light.name in actual and dark.name in actual and light.read_bytes() == dark.read_bytes():
                errors.append(f"{viewport['name']}/{name}: 라이트·다크 캡처가 같습니다")

    if errors:
        raise ValueError("전 라우트 실측 검증 실패\n- " + "\n- ".join(errors))

    judged = sum(1 for route in data["routes"] if route["unification"])
    controls = len(data["routes"]) - judged
    print(
        f"capture sweep verified: {len(actual)} PNG, 6 combinations, "
        f"통일 판정 {judged}개 라우트, kit 통제군 {controls}개"
    )


def capture(label: str) -> None:
    from playwright.sync_api import sync_playwright

    data = load_inventory()
    validate_inventory(data)
    values = fixture_values(data)
    actor_selector = os.environ.get("SHOT_PERMISSION_ACTOR")
    routes = [
        (route, resolve_url(route["representativeUrl"], values))
        for route in selected_routes(data, actor_selector)
    ]
    base = os.environ.get("SHOT_BASE", "http://localhost:3000").rstrip("/")
    out_dir = capture_dir(label)
    out_dir.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for theme in data["measurementMatrix"]["themes"]:
            for viewport in data["measurementMatrix"]["viewports"]:
                size = {"width": viewport["width"], "height": viewport["height"]}
                context = browser.new_context(viewport=size, device_scale_factor=2)
                context.add_cookies([{
                    "name": "ccc_theme",
                    "value": theme["cookieValue"],
                    "url": base,
                }])
                page = context.new_page()
                for route, path in routes:
                    name = screenshot_name(route["routePattern"])
                    run_label = f"{theme['name']}/{viewport['name']}/{name}"
                    try:
                        response = page.goto(f"{base}{path}", wait_until="networkidle", timeout=30_000)
                        status = response.status if response is not None else 0
                        if status >= 400:
                            failures.append(f"{run_label} -> HTTP {status}")
                        page.evaluate("() => { for (const d of document.querySelectorAll('details')) d.open = true; }")
                        page.wait_for_timeout(250)
                        filename = f"{theme['name']}-{viewport['name']}-{name}.png"
                        page.screenshot(path=str(out_dir / filename), full_page=True)
                    except Exception as error:  # noqa: BLE001 - 한 화면 실패가 나머지를 막지 않게 한다
                        failures.append(f"{run_label} -> {str(error).splitlines()[0]}")
                context.close()
        browser.close()

    print(f"saved to {out_dir}")
    if failures:
        print(f"FAILURES ({len(failures)}):")
        for line in failures:
            print(f"  {line}")
        raise SystemExit(1)
    suffix = "" if actor_selector is None else f" for permission actor selector {actor_selector}"
    print(f"all {len(routes)} routes captured across 6 measurement combinations{suffix}")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--check-inventory":
        check_inventory()
    elif len(sys.argv) == 3 and sys.argv[1] == "--check-capture":
        check_capture(sys.argv[2])
    elif len(sys.argv) == 2:
        capture(sys.argv[1])
    else:
        print(
            "usage: python3 scripts/design/shots.py --check-inventory | --check-capture <label> | <label>",
            file=sys.stderr,
        )
        raise SystemExit(1)
