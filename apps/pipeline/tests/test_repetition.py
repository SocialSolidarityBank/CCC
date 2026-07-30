"""반복 붕괴 검사 테스트 (D53). 실측된 실패(같은 문장 254회 연속)의 축소판이다."""

import unittest

from ccc_pipeline.repetition import collapse_runs, find_repetition_runs, normalize
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
    def test_run_is_folded_into_one_warning_line(self) -> None:
        original = segments(["앞 발화"] + ["반복 문장"] * 5 + ["뒤 발화"])
        runs = find_repetition_runs(original, 4)
        collapsed = collapse_runs(original, runs)

        self.assertEqual(len(collapsed), 3)
        self.assertEqual(collapsed[0].text, "앞 발화")
        self.assertEqual(collapsed[2].text, "뒤 발화")
        self.assertTrue(collapsed[1].warning)
        self.assertIn("5회 반복", collapsed[1].text)
        self.assertIn("반복 문장", collapsed[1].text)  # 무엇이 반복됐는지도 남긴다
        # 접힌 줄은 원래 구간 전체의 시각을 덮는다 — 언제 무너졌는지가 필요한 정보다.
        self.assertAlmostEqual(collapsed[1].start, 5.0)
        self.assertAlmostEqual(collapsed[1].end, 30.0)

    def test_no_runs_returns_the_same_list(self) -> None:
        original = segments(["가", "나", "다"])
        self.assertIs(collapse_runs(original, []), original)

    def test_warning_line_has_no_speaker_label_in_transcript(self) -> None:
        # 경고는 사람이 한 말이 아니다 — 역할 라벨을 붙이면 발화로 오독된다.
        original = segments(["앞 발화"] + ["반복 문장"] * 5)
        collapsed = collapse_runs(original, find_repetition_runs(original, 4))
        text = format_transcript(collapsed, {})
        self.assertTrue(text.startswith("[화자?] 앞 발화"))
        self.assertIn("\n⚠ 전사 실패 구간", text)


if __name__ == "__main__":
    unittest.main()
