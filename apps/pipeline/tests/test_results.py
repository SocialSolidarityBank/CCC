import hashlib
import unittest
from unittest import mock

from ccc_pipeline.results import build_recording_result


class BuildRecordingResultTest(unittest.TestCase):
    def test_contract_contains_only_masked_source_and_numeric_processing_metadata(self):
        with mock.patch("ccc_pipeline.results.uuid.uuid4", return_value="fixture-evidence-id"):
            body = build_recording_result(
                "[상담자] 마스킹 완료 본문",
                {"combined": 0.1, "utteranceCount": 3.0},
                "ner-mask-v1",
            )

        self.assertEqual(
            set(body),
            {"maskedText", "sha256", "maskingPipelineVersion", "evidence", "emotionScores"},
        )
        self.assertNotIn("aiSummary", body)
        self.assertNotIn("aiSchema", body)
        self.assertEqual(body["sha256"], hashlib.sha256(body["maskedText"].encode("utf-8")).hexdigest())
        self.assertEqual(body["evidence"], [{
            "id": "fixture-evidence-id",
            "sourceRef": "recording-transcript",
            "sourceSha256": body["sha256"],
            "evidenceQuote": body["maskedText"],
            "sourceStart": 0,
            "sourceEnd": len(body["maskedText"]),
        }])

    def test_rejects_empty_masked_transcript(self):
        with self.assertRaises(ValueError):
            build_recording_result("   ", {"utteranceCount": 0.0}, "ner-mask-v1")


if __name__ == "__main__":
    unittest.main()
