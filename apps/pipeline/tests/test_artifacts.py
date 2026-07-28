import unittest

from ccc_pipeline.artifacts import AI_SUMMARY_PLACEHOLDER, build_artifacts


class BuildArtifactsTest(unittest.TestCase):
    def test_contract_shape(self):
        body = build_artifacts("[수혜자?] 전사 내용", {"combined": 0.1, "utteranceCount": 3.0})
        # docs/api-contract-pipeline.md 필수 필드 전부 포함
        self.assertEqual(
            set(body),
            {"transcript", "aiSummary", "aiSchema", "aiContrast", "emotionScores", "flagProposals", "gasEvidence"},
        )
        self.assertEqual(
            set(body["aiContrast"]), {"missingFromMemo", "missingFromAudio", "undiscussedGoals"}
        )
        # 서버 requiredString: aiSummary는 비면 400 — 자리표시 문구가 비어 있지 않아야 한다
        self.assertTrue(body["aiSummary"].strip())
        self.assertEqual(body["aiSummary"], AI_SUMMARY_PLACEHOLDER)
        # 2단계-c 전에는 빈 배열로 보낸다
        self.assertEqual(body["flagProposals"], [])
        self.assertEqual(body["gasEvidence"], [])

    def test_rejects_empty_transcript(self):
        with self.assertRaises(ValueError):
            build_artifacts("   ", {"utteranceCount": 0.0})


if __name__ == "__main__":
    unittest.main()
