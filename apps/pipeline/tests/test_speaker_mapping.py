import unittest

from ccc_pipeline.speaker_mapping import (
    BENEFICIARY,
    COUNSELOR,
    Segment,
    Turn,
    assign_speakers,
    estimate_roles,
    format_transcript,
)


class AssignSpeakersTest(unittest.TestCase):
    def test_assigns_by_max_overlap(self):
        segments = [Segment(0.0, 4.0, "안녕하세요"), Segment(4.0, 10.0, "네 요즘은요")]
        turns = [Turn(0.0, 4.5, "SPEAKER_00"), Turn(4.5, 10.0, "SPEAKER_01")]
        assigned = assign_speakers(segments, turns)
        self.assertEqual(assigned[0].speaker, "SPEAKER_00")
        self.assertEqual(assigned[1].speaker, "SPEAKER_01")

    def test_no_overlap_keeps_none(self):
        assigned = assign_speakers([Segment(20.0, 21.0, "x")], [Turn(0.0, 1.0, "SPEAKER_00")])
        self.assertIsNone(assigned[0].speaker)


class EstimateRolesTest(unittest.TestCase):
    def test_longest_speaker_is_beneficiary(self):
        segments = [
            Segment(0.0, 2.0, "요즘 어떠세요", "S_COUNSELOR"),
            Segment(2.0, 30.0, "사실 일자리 문제로…", "S_CLIENT"),
        ]
        roles = estimate_roles(segments)
        self.assertEqual(roles["S_CLIENT"], BENEFICIARY)
        self.assertEqual(roles["S_COUNSELOR"], COUNSELOR)

    def test_single_speaker_becomes_beneficiary(self):
        roles = estimate_roles([Segment(0.0, 5.0, "혼자 말함", "S0")])
        self.assertEqual(roles, {"S0": BENEFICIARY})

    def test_three_speakers_only_one_beneficiary(self):
        segments = [
            Segment(0.0, 10.0, "a", "S0"),
            Segment(10.0, 15.0, "b", "S1"),
            Segment(15.0, 18.0, "c", "S2"),
        ]
        roles = estimate_roles(segments)
        self.assertEqual([r for r in roles.values() if r == BENEFICIARY], [BENEFICIARY])

    def test_empty_input(self):
        self.assertEqual(estimate_roles([]), {})


class FormatTranscriptTest(unittest.TestCase):
    def test_labels_show_estimation_uncertainty(self):
        segments = [
            Segment(0.0, 2.0, "요즘 어떠세요", "S0"),
            Segment(2.0, 30.0, "일자리 문제로 힘듭니다", "S1"),
            Segment(30.0, 31.0, "  ", "S1"),  # 공백 구간은 생략
        ]
        roles = {"S0": COUNSELOR, "S1": BENEFICIARY}
        text = format_transcript(segments, roles)
        self.assertEqual(text.splitlines()[0], "[상담사?] 요즘 어떠세요")
        self.assertEqual(text.splitlines()[1], "[수혜자?] 일자리 문제로 힘듭니다")
        self.assertEqual(len(text.splitlines()), 2)

    def test_unassigned_speaker_gets_generic_label(self):
        text = format_transcript([Segment(0.0, 1.0, "누구 말인지 모름", None)], {})
        self.assertTrue(text.startswith("[화자?]"))


if __name__ == "__main__":
    unittest.main()
