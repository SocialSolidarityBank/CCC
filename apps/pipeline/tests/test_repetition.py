"""반복 붕괴 검사 테스트 (D53). 실측된 실패(같은 문장 254회 연속)의 축소판이다."""

import unittest

from ccc_pipeline.repetition import (
    REASON_REPETITION,
    collapse_runs,
    find_repetition_runs,
    inject_legacy_warnings,
    legacy_warning_text,
    normalize,
    warning_spans,
)
from ccc_pipeline.speaker_mapping import Segment, format_transcript


def segments(texts: list[str], step: float = 5.0) -> list[Segment]:
    return [Segment(start=i * step, end=(i + 1) * step, text=text) for i, text in enumerate(texts)]


class FindRepetitionRunsTest(unittest.TestCase):
    def test_normal_conversation_has_no_runs(self) -> None:
        found = find_repetition_runs(segments(["안녕하세요", "네 안녕하세요", "요즘 어떠세요"]), 4)
        self.assertEqual(found, [])

    def test_detects_a_collapsed_tail(self) -> None:
        found = find_repetition_runs(segments(["실제 대화입니다"] + ["구독과 좋아요 부탁드립니다"] * 6), 4)
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0].count, 6)
        self.assertEqual(found[0].start_index, 1)
        self.assertEqual(found[0].end_index, 6)
        self.assertAlmostEqual(found[0].start, 5.0)
        self.assertAlmostEqual(found[0].end, 35.0)

    def test_below_threshold_is_not_a_run(self) -> None:
        # 상담에서 같은 말을 두세 번 하는 것은 흔하다 — 그것까지 실패로 보지 않는다.
        self.assertEqual(find_repetition_runs(segments(["네"] * 3), 4), [])

    def test_punctuation_differences_still_count_as_repetition(self) -> None:
        found = find_repetition_runs(segments(["같은 말", "같은 말.", "같은 말!", "같은 말…"]), 4)
        self.assertEqual(len(found), 1)

    def test_blank_segments_are_not_repetition(self) -> None:
        # 무음 구간에서 빈 결과가 줄줄이 나오는 것은 붕괴가 아니다.
        self.assertEqual(find_repetition_runs(segments(["", "  ", "", ""]), 4), [])

    def test_two_separate_runs(self) -> None:
        found = find_repetition_runs(segments(["가"] * 4 + ["사이 발화"] + ["나"] * 5), 4)
        self.assertEqual([run.count for run in found], [4, 5])

    def test_threshold_must_be_at_least_two(self) -> None:
        with self.assertRaises(ValueError):
            find_repetition_runs(segments(["가"]), 1)

    def test_normalize_collapses_whitespace(self) -> None:
        self.assertEqual(normalize("  같은   말 .  "), "같은 말")


class CollapseRunsTest(unittest.TestCase):
    def test_run_is_folded_into_one_flagged_line_without_warning_prose(self) -> None:
        # CCC-124: 경고 문장은 더 이상 전사에 끼워 넣지 않는다 — 접힌 줄은 반복된
        # 문장 한 번 + warning 플래그이고, 시간 구간·사유는 구조화 필드로 나간다.
        original = segments(["앞 발화"] + ["반복 문장"] * 5 + ["뒤 발화"])
        runs = find_repetition_runs(original, 4)
        collapsed = collapse_runs(original, runs)

        self.assertEqual(len(collapsed), 3)
        self.assertEqual(collapsed[0].text, "앞 발화")
        self.assertEqual(collapsed[2].text, "뒤 발화")
        self.assertTrue(collapsed[1].warning)
        self.assertEqual(collapsed[1].text, "반복 문장")
        self.assertNotIn("⚠", collapsed[1].text)
        # 접힌 줄은 원래 구간 전체의 시각을 덮는다 — 언제 무너졌는지가 필요한 정보다.
        self.assertAlmostEqual(collapsed[1].start, 5.0)
        self.assertAlmostEqual(collapsed[1].end, 30.0)

    def test_no_runs_returns_the_same_list(self) -> None:
        original = segments(["가", "나", "다"])
        self.assertIs(collapse_runs(original, []), original)

    def test_collapsed_line_has_no_speaker_label_in_transcript(self) -> None:
        # 접힌 줄은 믿을 수 없는 구간이다 — 역할 라벨을 붙이면 발화로 오독된다.
        original = segments(["앞 발화"] + ["반복 문장"] * 5)
        collapsed = collapse_runs(original, find_repetition_runs(original, 4))
        text = format_transcript(collapsed, {})
        self.assertTrue(text.startswith("[화자?] 앞 발화"))
        self.assertIn("\n반복 문장", text)
        self.assertNotIn("[화자?] 반복 문장", text)


class WarningSpansTest(unittest.TestCase):
    def test_spans_carry_times_and_fixed_reason_only(self) -> None:
        original = segments(["앞 발화"] + ["반복 문장"] * 5 + ["뒤 발화"])
        runs = find_repetition_runs(original, 4)
        spans = warning_spans(runs)
        self.assertEqual(spans, [{"startSeconds": 5.0, "endSeconds": 30.0, "reason": REASON_REPETITION}])
        # 반복된 문장은 구조화 필드에 싣지 않는다 — 마스킹을 거치지 않는 경로다(R3).
        for span in spans:
            self.assertEqual(set(span), {"startSeconds", "endSeconds", "reason"})


class LegacyWarningTest(unittest.TestCase):
    def test_legacy_text_matches_the_pre_ccc124_format(self) -> None:
        original = segments(["앞 발화"] + ["반복 문장"] * 5)
        run = find_repetition_runs(original, 4)[0]
        text = legacy_warning_text(run)
        self.assertIn("⚠ 전사 실패 구간", text)
        self.assertIn("5회 반복", text)
        self.assertIn("반복 문장", text)
        self.assertIn("00:05~00:30", text)

    def test_inject_restores_warning_prose_on_collapsed_lines(self) -> None:
        original = segments(["앞 발화"] + ["반복 문장"] * 5 + ["뒤 발화"])
        runs = find_repetition_runs(original, 4)
        collapsed = collapse_runs(original, runs)
        legacy = inject_legacy_warnings(collapsed, runs)

        self.assertEqual(len(legacy), 3)
        self.assertEqual(legacy[0].text, "앞 발화")
        self.assertEqual(legacy[2].text, "뒤 발화")
        self.assertTrue(legacy[1].warning)
        self.assertIn("⚠ 전사 실패 구간", legacy[1].text)
        self.assertIn("반복 문장", legacy[1].text)
        # 접힌 줄의 시각은 유지된다.
        self.assertAlmostEqual(legacy[1].start, 5.0)
        self.assertAlmostEqual(legacy[1].end, 30.0)

    def test_inject_without_runs_returns_equivalent_segments(self) -> None:
        original = segments(["가", "나"])
        self.assertEqual(inject_legacy_warnings(original, []), original)


if __name__ == "__main__":
    unittest.main()
