import importlib.util
import os
import pathlib
import tempfile
import unittest

MODULE_PATH = pathlib.Path(__file__).with_name("ia-shots.py")
SPEC = importlib.util.spec_from_file_location("ia_shots", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
ia_shots = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ia_shots)


class SweepValidationTest(unittest.TestCase):
    def setUp(self) -> None:
        os.environ.update(
            {
                "SHOT_PARTICIPANT_INVITE_TOKEN": "test-participant-token",
                "SHOT_WORKER_INVITE_TOKEN": "test-worker-token",
                "SHOT_SESSION_ID": "test-session",
                "SHOT_SCHEDULE_ID": "test-schedule",
            }
        )
        self.data = ia_shots.load_inventory()
        self.plan = ia_shots.build_plan(self.data)
    def complete_report(self) -> list[dict[str, object]]:
        return [
            {
                **row,
                "status": 200,
                "errors": [],
                "screenshot": ia_shots.capture_filename(row),
                "observedTheme": row["theme"],
                "viewport": {"width": row["width"], "height": row["height"]},
                "metrics": {"main": None, "container": None},
            }
            for row in self.plan
        ]

    def test_complete_six_combination_sweep_passes(self) -> None:
        report = self.complete_report()
        self.assertEqual(len(report), len(self.data["routes"]) * 2 * 3)
        self.assertEqual(
            ia_shots.validate_sweep(self.plan, report, pathlib.Path("."), require_files=False), []
        )

    def test_missing_duplicate_and_wrong_observations_fail(self) -> None:
        report = self.complete_report()
        report.pop()
        report.append({**report[0]})
        report[0]["observedTheme"] = "dark" if report[0]["theme"] == "light" else "light"
        report[1]["viewport"] = {"width": 999, "height": 900}
        report[2]["status"] = 500
        report[3]["errors"] = ["render failed"]

        defects = ia_shots.validate_sweep(self.plan, report, pathlib.Path("."), require_files=False)
        joined = "\n".join(defects)
        self.assertIn("중복 실측", joined)
        self.assertIn("누락 실측", joined)
        self.assertIn("테마 불일치", joined)
        self.assertIn("뷰포트 불일치", joined)
        self.assertIn("HTTP 실패", joined)
        self.assertIn("브라우저 오류", joined)

    def test_screenshot_file_is_required_for_all_routes(self) -> None:
        report = self.complete_report()
        with tempfile.TemporaryDirectory() as directory:
            defects = ia_shots.validate_sweep(self.plan, report, pathlib.Path(directory))
        self.assertEqual(len([d for d in defects if "스크린샷 파일 없음" in d]), len(report))

    def test_kit_runtime_error_is_excluded_from_unification_judgement(self) -> None:
        report = self.complete_report()
        kit = next(row for row in report if row["routePattern"] == "/kit")
        kit["status"] = 500
        kit["errors"] = ["baseline counterexample"]
        self.assertEqual(
            ia_shots.validate_sweep(self.plan, report, pathlib.Path("."), require_files=False), []
        )


if __name__ == "__main__":
    unittest.main()
