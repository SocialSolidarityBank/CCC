import json
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parent))

from qualify_ner import (  # noqa: E402
    ADDRESS_LABEL,
    HEALTH_CORPUS_HASH,
    HEALTH_METRICS_HASH,
    PERSON_LABEL,
    QualificationError,
    canonical_sha256,
    measurement_passes,
    point_metrics,
    score_predictions,
    validate_corpus,
    wilson_interval,
    wilson_metrics,
    write_new_report,
)


N2 = json.loads(
    (Path(__file__).resolve().parent / "fixtures" / "s6-ner-health-ko-conversation-v2.json").read_text(
        encoding="utf-8",
    ),
)


def empty_counts() -> dict[str, dict[str, int]]:
    return {
        PERSON_LABEL: {"tp": 0, "fp": 0, "fn": 0},
        ADDRESS_LABEL: {"tp": 0, "fp": 0, "fn": 0},
    }


class CorpusValidationTest(unittest.TestCase):
    def test_approved_health_corpus_has_locked_hash_and_counts(self) -> None:
        validated = validate_corpus(N2, "health", HEALTH_CORPUS_HASH)

        self.assertEqual(validated.corpus_hash, HEALTH_CORPUS_HASH)
        self.assertEqual(validated.person_count, 4)
        self.assertEqual(validated.address_count, 4)
        self.assertEqual(len(validated.items), 7)

    def test_gold_substring_must_be_exactly_unambiguous(self) -> None:
        invalid = [dict(N2[0], text="김도윤 씨와 김도윤 씨가 상담했다.", address=[])] + N2[1:]

        with self.assertRaises(QualificationError) as caught:
            validate_corpus(invalid, "health", HEALTH_CORPUS_HASH)

        self.assertEqual(caught.exception.code, "corpus_invalid")
        self.assertIn("ambiguous_gold_substring", caught.exception.rows[0]["errorCodes"])


class ExactScoringTest(unittest.TestCase):
    def test_prediction_row_count_must_match_corpus(self) -> None:
        with self.assertRaises(QualificationError) as caught:
            score_predictions(N2, [])

        self.assertEqual(caught.exception.code, "prediction_count_mismatch")

    def test_duplicate_predictions_are_an_error_not_one_true_positive(self) -> None:
        duplicate = ((PERSON_LABEL, 0, 3), (PERSON_LABEL, 0, 3))
        predictions = [duplicate] + [tuple() for _ in N2[1:]]

        with self.assertRaises(QualificationError) as caught:
            score_predictions(N2, predictions)

        self.assertEqual(caught.exception.code, "duplicate_prediction")

    def test_row_report_contains_counts_but_no_predictions_or_spans(self) -> None:
        predictions = [
            ((PERSON_LABEL, 0, 3), (ADDRESS_LABEL, 7, 24)),
            ((PERSON_LABEL, 0, 3), (ADDRESS_LABEL, 8, 25)),
            ((PERSON_LABEL, 0, 3), (ADDRESS_LABEL, 7, 22)),
            ((PERSON_LABEL, 0, 3),),
            ((ADDRESS_LABEL, 4, 22),),
            tuple(),
            tuple(),
        ]

        counts, rows = score_predictions(N2, predictions)

        self.assertEqual(counts[PERSON_LABEL], {"tp": 4, "fp": 0, "fn": 0})
        self.assertEqual(counts[ADDRESS_LABEL], {"tp": 4, "fp": 0, "fn": 0})
        self.assertEqual(set(rows[0]), {"id", "status", "counts"})


class MetricBoundaryTest(unittest.TestCase):
    def test_zero_denominators_never_pass(self) -> None:
        counts = empty_counts()
        metrics = point_metrics(counts)
        bounds = wilson_metrics(counts)

        self.assertTrue(all(value is None for value in metrics.values()))
        self.assertTrue(all(value is None for value in bounds.values()))
        self.assertFalse(measurement_passes("health", counts, metrics, bounds))
        self.assertFalse(measurement_passes("release", counts, metrics, bounds))

    def test_perfect_health_metrics_keep_the_s6_canonical_hash(self) -> None:
        counts = {
            PERSON_LABEL: {"tp": 4, "fp": 0, "fn": 0},
            ADDRESS_LABEL: {"tp": 4, "fp": 0, "fn": 0},
        }

        self.assertEqual(canonical_sha256(point_metrics(counts)), HEALTH_METRICS_HASH)

    def test_wilson_endpoints_match_independent_known_values(self) -> None:
        self.assertEqual(wilson_interval(0, 0), (None, None))
        lower, upper = wilson_interval(0, 10)
        self.assertEqual(lower, 0.0)
        self.assertAlmostEqual(upper, 0.2775327998628892, places=15)
        lower, upper = wilson_interval(10, 10)
        self.assertAlmostEqual(lower, 0.7224672001371107, places=15)
        self.assertEqual(upper, 1.0)


class OutputContractTest(unittest.TestCase):
    def test_report_hash_excludes_only_its_own_field(self) -> None:
        with TemporaryDirectory() as directory:
            document = write_new_report(Path(directory) / "report.json", {"status": "validated"})

        self.assertEqual(
            document["reportHash"],
            canonical_sha256({"status": "validated"}),
        )

    def test_existing_output_is_never_overwritten(self) -> None:
        with TemporaryDirectory() as directory:
            output = Path(directory) / "report.json"
            output.write_text("preserve", encoding="utf-8")

            with self.assertRaises(QualificationError) as caught:
                write_new_report(output, {"status": "validated"})

            self.assertEqual(caught.exception.code, "output_exists")
            self.assertEqual(output.read_text(encoding="utf-8"), "preserve")

    def test_unsupported_interop_number_cannot_create_evidence(self) -> None:
        lower, _ = wilson_interval(1, 10000)
        with TemporaryDirectory() as directory:
            output = Path(directory) / "report.json"
            with self.assertRaises(QualificationError) as caught:
                write_new_report(output, {"wilsonLower": lower})
            self.assertEqual(caught.exception.code, "report_not_canonical")
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
