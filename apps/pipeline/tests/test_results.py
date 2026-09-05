"""v2 결과 payload 계약 (S5 §2.1) — hash 3종과 canonical JSON 표기."""

import unittest

from ccc_pipeline.results import (
    build_result,
    build_result_request,
    canonical_json,
    canonical_sha256,
    sha256_hex,
)

ATTESTATION = {
    "id": "attestation-fixture",
    "resultHash": "c" * 64,
}
COMMON = {
    "masking_pipeline_version": "ner-mask-v1-addr-cond-dict",
    "masking_pipeline_hash": "d" * 64,
    "ner_attestation": ATTESTATION,
    "release_qualification_receipt_id": "receipt-fixture",
    "source_ref": "text:job-1",
}


class CanonicalJsonTest(unittest.TestCase):
    def test_numbers_and_keys_match_the_server_canonicalization(self):
        # 서버는 RFC 8785 로 같은 문자열을 만든다. 1.0 이 "1.0" 으로 남으면 해시가 어긋난다.
        self.assertEqual(canonical_json({"b": 1, "a": 1.0}), '{"a":1,"b":1}')
        self.assertEqual(canonical_json([12.34, True, None, "가"]), '[12.34,true,null,"가"]')

    def test_rejects_values_json_cannot_canonicalize(self):
        with self.assertRaises(TypeError):
            canonical_json({"at": object()})


class BuildResultTest(unittest.TestCase):
    def test_text_result_carries_s6_metadata_and_whole_body_evidence(self):
        result = build_result("text", "MASKED 본문", **COMMON)
        self.assertEqual(result["kind"], "text")
        self.assertEqual(result["sha256"], sha256_hex("MASKED 본문"))
        self.assertEqual(result["evidenceHash"], canonical_sha256(result["evidence"]))
        evidence = result["evidence"][0]
        self.assertEqual(evidence["sourceSha256"], result["sha256"])
        self.assertEqual(evidence["evidenceQuote"], "MASKED 본문")
        self.assertEqual(evidence["sourceEnd"], len("MASKED 본문"))
        self.assertTrue(result["nerAvailable"])
        self.assertEqual(result["nerAttestationId"], ATTESTATION["id"])
        self.assertEqual(result["nerAttestationResultHash"], ATTESTATION["resultHash"])
        self.assertNotIn("emotionScores", result)

    def test_audio_result_requires_a_reliability_flag_and_keeps_numeric_emotion(self):
        with self.assertRaises(ValueError):
            build_result("audio", "MASKED 전사", **COMMON)
        result = build_result(
            "audio",
            "MASKED 전사",
            **COMMON,
            emotion_scores={},
            transcript_reliable=False,
            transcript_warnings=[{"startSeconds": 5.0, "endSeconds": 65.0, "reason": "repetition_collapse"}],
        )
        self.assertEqual(result["emotionScores"], {})
        self.assertIs(result["transcriptReliable"], False)
        self.assertEqual(len(result["transcriptWarnings"]), 1)

    def test_empty_or_unknown_kind_is_refused(self):
        with self.assertRaises(ValueError):
            build_result("text", "   ", **COMMON)
        with self.assertRaises(ValueError):
            build_result("video", "MASKED", **COMMON)


class BuildResultRequestTest(unittest.TestCase):
    def test_payload_hash_covers_schema_version_attempt_and_result(self):
        result = build_result("text", "MASKED 본문", **COMMON)
        request = build_result_request("t" * 64, 2, result)
        self.assertEqual(request["schemaVersion"], 2)
        self.assertEqual(request["attempt"], 2)
        self.assertEqual(request["claimToken"], "t" * 64)
        self.assertEqual(request["payloadSha256"], canonical_sha256({
            "schemaVersion": 2,
            "attempt": 2,
            "result": result,
        }))
        # attempt 가 다르면 같은 결과라도 payload hash 가 달라진다.
        self.assertNotEqual(request["payloadSha256"], build_result_request("t" * 64, 3, result)["payloadSha256"])
        # resultId 는 매번 새로 생기고 hash 에는 들어가지 않는다(멱등 키는 hash 다).
        self.assertNotEqual(request["resultId"], build_result_request("t" * 64, 2, result)["resultId"])
        self.assertEqual(request["payloadSha256"], build_result_request("t" * 64, 2, result)["payloadSha256"])


if __name__ == "__main__":
    unittest.main()
