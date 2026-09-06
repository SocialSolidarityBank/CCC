import math
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from metrics import pool_sessions, score_session  # noqa: E402


def reference(
    transcript: str = "가\n나",
    turns: list[dict] | None = None,
) -> dict:
    return {
        "transcript": transcript,
        "speakerTurns": turns
        if turns is not None
        else [
            {"start": 0.0, "end": 5.0, "speaker": "A", "text": "가"},
            {"start": 5.0, "end": 10.0, "speaker": "B", "text": "나"},
        ],
    }


def score(
    ref: dict,
    hypothesis: str,
    predicted_turns: list[dict] | None = None,
    *,
    duration: float = 10.0,
    wall: float = 1.0,
    windows_cpu: bool = True,
) -> dict:
    if predicted_turns is None:
        predicted_turns = [
            {"start": 0.0, "end": 5.0, "speaker": "X"},
            {"start": 5.0, "end": 10.0, "speaker": "Y"},
        ]
    return score_session(ref, hypothesis, predicted_turns, wall, duration, windows_cpu)


class CerAndSafetyTest(unittest.TestCase):
    def test_normalizes_nfc_line_endings_and_whitespace_before_codepoint_alignment(self) -> None:
        turns = [
            {"start": 0.0, "end": 5.0, "speaker": "A", "text": "é"},
            {"start": 5.0, "end": 10.0, "speaker": "B", "text": "가  나"},
        ]
        result = score(reference("é\r\n가  나", turns), "e\u0301 가\t나")

        self.assertEqual(
            result["cer"],
            {
                "substitutions": 0,
                "deletions": 0,
                "insertions": 0,
                "errors": 0,
                "referenceCharacters": 5,
                "value": 0.0,
                "status": "PASS",
            },
        )

    def test_alignment_counts_unicode_codepoints_not_encoded_bytes(self) -> None:
        turns = [
            {"start": 0.0, "end": 5.0, "speaker": "A", "text": "\U00020000나"},
            {"start": 5.0, "end": 10.0, "speaker": "B", "text": ""},
        ]
        result = score(reference("\U00020000나", turns), "\U00020001나")

        self.assertEqual(result["cer"]["referenceCharacters"], 2)
        self.assertEqual(result["cer"]["substitutions"], 1)
        self.assertEqual(result["cer"]["value"], 0.5)

    def test_empty_reference_has_no_cer_denominator(self) -> None:
        turns = [
            {"start": 0.0, "end": 5.0, "speaker": "A", "text": ""},
            {"start": 5.0, "end": 10.0, "speaker": "B", "text": ""},
        ]
        result = score(reference("", turns), "가")

        self.assertEqual(result["cer"]["insertions"], 1)
        self.assertIsNone(result["cer"]["value"])
        self.assertEqual(result["cer"]["status"], "UNMEASURED")

    def test_maximal_insertion_event_starts_at_twenty_codepoints(self) -> None:
        below = score(reference(), "가" + "삽" * 19 + " 나")
        boundary = score(reference(), "가" + "삽" * 20 + " 나")

        self.assertEqual(below["safety"], {"eventCount": 0, "events": [], "status": "PASS"})
        self.assertEqual(
            boundary["safety"],
            {
                "eventCount": 1,
                "events": [{"type": "insertion", "start": 1, "end": 21}],
                "status": "FAIL",
            },
        )

    def test_consecutive_fully_deleted_turns_use_summed_turn_duration(self) -> None:
        turns = [
            {"start": 0.0, "end": 4.0, "speaker": "A", "text": "첫째"},
            {"start": 5.0, "end": 11.0, "speaker": "B", "text": "둘째"},
            {"start": 11.0, "end": 14.0, "speaker": "A", "text": "셋째"},
        ]
        result = score(
            reference("첫째\n둘째\n셋째", turns),
            "셋째",
            [
                {"start": 0.0, "end": 4.0, "speaker": "X"},
                {"start": 5.0, "end": 14.0, "speaker": "Y"},
            ],
            duration=14.0,
        )

        self.assertEqual(
            result["safety"],
            {
                "eventCount": 1,
                "events": [{"type": "deletedReferenceTurns", "start": 0.0, "end": 11.0}],
                "status": "FAIL",
            },
        )

    def test_deleted_nested_turns_cover_the_latest_end(self) -> None:
        turns = [
            {"start": 0.0, "end": 15.0, "speaker": "A", "text": "가"},
            {"start": 1.0, "end": 2.0, "speaker": "B", "text": "나"},
        ]
        result = score(reference("가\n나", turns), "", duration=60.0)
        self.assertEqual(result["safety"]["events"], [{"type": "deletedReferenceTurns", "start": 0.0, "end": 15.0}])

    def test_safety_result_never_contains_reference_or_hypothesis_text(self) -> None:
        secret_reference = "REFERENCE_SECRET"
        secret_hypothesis = "HYPOTHESIS_SECRET" * 2
        turns = [
            {"start": 0.0, "end": 5.0, "speaker": "A", "text": secret_reference},
            {"start": 5.0, "end": 10.0, "speaker": "B", "text": "끝"},
        ]
        result = score(reference(f"{secret_reference}\n끝", turns), secret_hypothesis)

        rendered = repr(result)
        self.assertNotIn(secret_reference, rendered)
        self.assertNotIn("HYPOTHESIS_SECRET", rendered)


class RepetitionTest(unittest.TestCase):
    def test_uses_pre_punctuation_normalized_hypothesis_length_as_denominator(self) -> None:
        result = score(reference(), "가.가.가.가.")

        self.assertEqual(result["repetition"]["hypothesisCharacters"], 8)
        self.assertEqual(result["repetition"]["excess"], 3)
        self.assertEqual(
            result["repetition"]["runs"],
            [{"period": 1, "repeats": 4, "start": 0, "end": 4}],
        )
        self.assertEqual(result["repetition"]["value"], 3 / 8)
        self.assertEqual(result["repetition"]["status"], "FAIL")

    def test_period_wins_tied_overlap_before_start_offset(self) -> None:
        result = score(reference(), "aaaaaaabababab")

        self.assertEqual(
            result["repetition"]["runs"],
            [{"period": 1, "repeats": 7, "start": 0, "end": 7}],
        )
        self.assertEqual(result["repetition"]["excess"], 6)

    def test_earlier_start_wins_tied_overlap_for_same_period(self) -> None:
        result = score(reference(), "ababababa")

        self.assertEqual(
            result["repetition"]["runs"],
            [{"period": 2, "repeats": 4, "start": 0, "end": 8}],
        )

    def test_empty_normalized_hypothesis_is_unmeasured(self) -> None:
        result = score(reference(), " \r\n\t ")

        self.assertEqual(result["repetition"]["hypothesisCharacters"], 0)
        self.assertIsNone(result["repetition"]["value"])
        self.assertEqual(result["repetition"]["status"], "UNMEASURED")


class DerTest(unittest.TestCase):
    def setUp(self) -> None:
        self.turns = [
            {"start": 0.0, "end": 6.0, "speaker": "A", "text": "가"},
            {"start": 4.0, "end": 10.0, "speaker": "B", "text": "나"},
        ]
        self.ref = reference("가\n나", self.turns)

    def test_finds_optimal_swapped_speaker_assignment_including_overlap(self) -> None:
        result = score(
            self.ref,
            "가 나",
            [
                {"start": 0.0, "end": 6.0, "speaker": "Y"},
                {"start": 4.0, "end": 10.0, "speaker": "X"},
            ],
        )

        self.assertEqual(
            result["der"],
            {
                "falseAlarmSeconds": 0.0,
                "missedSeconds": 0.0,
                "confusionSeconds": 0.0,
                "referenceSpeechSeconds": 12.0,
                "value": 0.0,
                "status": "PASS",
            },
        )

    def test_scores_silence_false_alarm_in_speaker_seconds(self) -> None:
        result = score(
            self.ref,
            "가 나",
            [
                {"start": 0.0, "end": 6.0, "speaker": "X"},
                {"start": 4.0, "end": 10.0, "speaker": "Y"},
                {"start": 10.0, "end": 12.0, "speaker": "X"},
            ],
            duration=12.0,
        )

        self.assertEqual(result["der"]["falseAlarmSeconds"], 2.0)
        self.assertEqual(result["der"]["missedSeconds"], 0.0)
        self.assertEqual(result["der"]["confusionSeconds"], 0.0)
        self.assertEqual(result["der"]["value"], 2 / 12)

    def test_missing_predicted_speech_is_missed_not_unmeasured(self) -> None:
        result = score(self.ref, "가 나", [], duration=10.0)

        self.assertEqual(result["der"]["missedSeconds"], 12.0)
        self.assertEqual(result["der"]["falseAlarmSeconds"], 0.0)
        self.assertEqual(result["der"]["confusionSeconds"], 0.0)
        self.assertEqual(result["der"]["value"], 1.0)
        self.assertEqual(result["der"]["status"], "FAIL")

    def test_one_prediction_across_reference_overlap_separates_miss_and_confusion(self) -> None:
        result = score(
            self.ref,
            "가 나",
            [{"start": 0.0, "end": 10.0, "speaker": "X"}],
        )

        self.assertEqual(result["der"]["missedSeconds"], 2.0)
        self.assertEqual(result["der"]["confusionSeconds"], 4.0)
        self.assertEqual(result["der"]["value"], 0.5)

    def test_extra_predicted_label_is_unmatched_without_displacing_optimal_pair(self) -> None:
        result = score(
            self.ref,
            "가 나",
            [
                {"start": 0.0, "end": 6.0, "speaker": "X"},
                {"start": 4.0, "end": 10.0, "speaker": "Y"},
                {"start": 0.0, "end": 10.0, "speaker": "EXTRA"},
            ],
        )

        self.assertEqual(result["der"]["falseAlarmSeconds"], 10.0)
        self.assertEqual(result["der"]["missedSeconds"], 0.0)
        self.assertEqual(result["der"]["confusionSeconds"], 0.0)


class ValidationAndRtfTest(unittest.TestCase):
    def test_rejects_nonfinite_and_invalid_numeric_ranges(self) -> None:
        cases = [
            (reference(), [], math.nan, 10.0),
            (reference(), [], 1.0, math.inf),
            (
                reference(),
                [{"start": math.nan, "end": 1.0, "speaker": "X"}],
                1.0,
                10.0,
            ),
            (
                reference(),
                [{"start": 2.0, "end": 2.0, "speaker": "X"}],
                1.0,
                10.0,
            ),
            (
                reference(),
                [{"start": 0.0, "end": 11.0, "speaker": "X"}],
                1.0,
                10.0,
            ),
        ]
        for ref, predicted, wall, duration in cases:
            with self.subTest(predicted=predicted, wall=wall, duration=duration):
                with self.assertRaises(ValueError):
                    score_session(ref, "가 나", predicted, wall, duration, True)

    def test_rtf_verdict_is_only_measured_on_windows_cpu(self) -> None:
        non_windows = score(reference(), "가 나", wall=20.0, windows_cpu=False)
        windows = score(reference(), "가 나", wall=20.0, windows_cpu=True)

        self.assertEqual(non_windows["rtf"]["value"], 2.0)
        self.assertEqual(non_windows["rtf"]["status"], "UNMEASURED")
        self.assertEqual(windows["rtf"]["status"], "FAIL")


class PoolingTest(unittest.TestCase):
    def test_pools_components_instead_of_averaging_session_rates(self) -> None:
        long_turns = [
            {"start": 0.0, "end": 50.0, "speaker": "A", "text": "abcdefghij"},
            {"start": 50.0, "end": 100.0, "speaker": "B", "text": ""},
        ]
        short_turns = [
            {"start": 0.0, "end": 0.5, "speaker": "A", "text": "x"},
            {"start": 0.5, "end": 1.0, "speaker": "B", "text": ""},
        ]
        first = score(
            reference("abcdefghij", long_turns),
            "abcdefghij",
            [
                {"start": 0.0, "end": 50.0, "speaker": "X"},
                {"start": 50.0, "end": 100.0, "speaker": "Y"},
            ],
            duration=100.0,
            wall=10.0,
        )
        second = score(
            reference("x", short_turns),
            "y",
            [],
            duration=1.0,
            wall=1.0,
        )

        pooled = pool_sessions([first, second], windows_cpu=True)

        self.assertEqual(pooled["cer"]["value"], 1 / 11)
        self.assertEqual(pooled["rtf"]["value"], 11 / 101)
        self.assertEqual(pooled["der"]["value"], 1 / 101)
        self.assertNotEqual(pooled["cer"]["value"], (first["cer"]["value"] + second["cer"]["value"]) / 2)

    def test_zero_pooled_denominators_are_unmeasured(self) -> None:
        row = {
            "cer": {"substitutions": 0, "deletions": 0, "insertions": 1, "errors": 1, "referenceCharacters": 0, "value": None, "status": "UNMEASURED"},
            "repetition": {"excess": 0, "hypothesisCharacters": 0, "runs": [], "value": None, "status": "UNMEASURED"},
            "rtf": {"engineWallSeconds": 0.0, "audioDurationSeconds": 0.0, "value": None, "status": "UNMEASURED"},
            "der": {"falseAlarmSeconds": 0.0, "missedSeconds": 0.0, "confusionSeconds": 0.0, "referenceSpeechSeconds": 0.0, "value": None, "status": "UNMEASURED"},
            "safety": {"eventCount": 0, "events": [], "status": "PASS"},
        }

        pooled = pool_sessions([row], windows_cpu=False)

        for name in ("cer", "repetition", "rtf", "der"):
            self.assertIsNone(pooled[name]["value"])
            self.assertEqual(pooled[name]["status"], "UNMEASURED")
        self.assertEqual(pooled["safety"]["eventCount"], 0)
        self.assertEqual(pooled["safety"]["status"], "PASS")

    def test_rejects_fractional_pooled_count_components(self) -> None:
        row = score(reference(), "가 나")
        row["cer"]["substitutions"] = 0.5

        with self.assertRaises(ValueError):
            pool_sessions([row], windows_cpu=True)

    def test_pooled_ranges_keep_numeric_session_provenance_and_drop_extra_content(self) -> None:
        first = score(reference(), "가" + "삽" * 20 + " 나")
        second = score(reference(), "가" + "삽" * 20 + " 나")
        first["repetition"]["runs"][0]["text"] = "DO_NOT_COPY"
        first["safety"]["events"][0]["text"] = "DO_NOT_COPY"

        pooled = pool_sessions([first, second], windows_cpu=True)

        self.assertEqual([run["sessionIndex"] for run in pooled["repetition"]["runs"]], [0, 1])
        self.assertEqual([event["sessionIndex"] for event in pooled["safety"]["events"]], [0, 1])
        self.assertNotIn("DO_NOT_COPY", repr(pooled))


if __name__ == "__main__":
    unittest.main()
