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

        # 레거시 형태(구조화 품질 필드 없음) — 구 서버 폴백이 보내는 페이로드다(CCC-124).
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

    def test_structured_transcript_quality_fields(self):
        # CCC-124: 전사 품질은 텍스트 안 경고 문장이 아니라 구조화 필드로 나간다.
        warnings = [{"startSeconds": 5.0, "endSeconds": 30.0, "reason": "repetition"}]
        body = build_recording_result(
            "[상담자] 마스킹 완료 본문",
            {},
            "ner-mask-v1",
            transcript_reliable=False,
            transcript_warnings=warnings,
        )
        self.assertEqual(
            set(body),
            {
                "maskedText", "sha256", "maskingPipelineVersion", "evidence", "emotionScores",
                "transcriptReliable", "transcriptWarnings",
            },
        )
        self.assertIs(body["transcriptReliable"], False)
        self.assertEqual(body["transcriptWarnings"], warnings)

    def test_reliable_transcript_sends_empty_warning_list(self):
        body = build_recording_result(
            "[상담자] 마스킹 완료 본문",
            {},
            "ner-mask-v1",
            transcript_reliable=True,
            transcript_warnings=[],
        )
        self.assertIs(body["transcriptReliable"], True)
        self.assertEqual(body["transcriptWarnings"], [])

    def test_warnings_without_reliability_flag_are_rejected(self):
        with self.assertRaises(ValueError):
            build_recording_result(
                "본문",
                {},
                "ner-mask-v1",
                transcript_warnings=[{"startSeconds": 0.0, "endSeconds": 1.0, "reason": "repetition"}],
            )

    def test_rejects_empty_masked_transcript(self):
        with self.assertRaises(ValueError):
            build_recording_result("   ", {"utteranceCount": 0.0}, "ner-mask-v1")


if __name__ == "__main__":
    unittest.main()
