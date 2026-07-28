import math
import unittest

from ccc_pipeline.emotion import SPEECH_WEIGHT, TEXT_WEIGHT, aggregate_scores, score_from_probs


class ScoreFromProbsTest(unittest.TestCase):
    def test_positive_minus_negative(self):
        score = score_from_probs({"기쁨": 0.6, "슬픔": 0.3, "중립": 0.1})
        self.assertAlmostEqual(score, 0.3)

    def test_english_labels_case_insensitive(self):
        score = score_from_probs({"Happiness": 0.2, "Anger": 0.7})
        self.assertAlmostEqual(score, -0.5)

    def test_unknown_labels_are_neutral(self):
        self.assertEqual(score_from_probs({"neutral": 1.0}), 0.0)


class AggregateScoresTest(unittest.TestCase):
    def test_weighted_combination(self):
        scores = aggregate_scores([0.5], [-0.5])
        self.assertAlmostEqual(scores["combined"], SPEECH_WEIGHT * 0.5 + TEXT_WEIGHT * -0.5)
        self.assertEqual(scores["utteranceCount"], 1.0)

    def test_missing_speech_axis_falls_back_to_text(self):
        scores = aggregate_scores([], [0.4, 0.2])
        self.assertNotIn("speech", scores)
        self.assertAlmostEqual(scores["combined"], 0.3)

    def test_missing_both_axes_reports_count_only(self):
        scores = aggregate_scores([], [])
        self.assertEqual(scores, {"utteranceCount": 0.0})

    def test_all_values_finite_numbers(self):
        # 서버 isNumericOnly(R4) 통과 조건: 유한 숫자만.
        scores = aggregate_scores([0.1, float("nan")], [0.2])
        for value in scores.values():
            self.assertIsInstance(value, float)
            self.assertTrue(math.isfinite(value))


if __name__ == "__main__":
    unittest.main()
