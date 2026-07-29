import unittest

from ccc_pipeline import masking


class MaskPatternsTest(unittest.TestCase):
    def test_masks_mobile_phone_variants(self):
        for raw in ["010-1234-5678", "010 1234 5678", "01012345678", "010.1234.5678"]:
            self.assertNotIn("1234", masking.mask_patterns(f"연락처는 {raw} 입니다"), raw)
            self.assertIn(masking.PHONE_TOKEN, masking.mask_patterns(f"연락처는 {raw} 입니다"), raw)

    def test_masks_landline(self):
        masked = masking.mask_patterns("사무실 02-745-1234로 전화했다")
        self.assertIn(masking.PHONE_TOKEN, masked)
        self.assertNotIn("745", masked)

    def test_masks_rrn_before_phone_pattern(self):
        masked = masking.mask_patterns("주민번호 901231-1234567 확인")
        self.assertIn(masking.RRN_TOKEN, masked)
        self.assertNotIn("1234567", masked)
        self.assertNotIn(masking.PHONE_TOKEN, masked)

    def test_masks_email(self):
        masked = masking.mask_patterns("메일 someone.kim+dev@example.co.kr 로 보냄")
        self.assertIn(masking.EMAIL_TOKEN, masked)
        self.assertNotIn("example", masked)

    def test_masks_account_number(self):
        masked = masking.mask_patterns("계좌 110-234-567890 이체")
        self.assertIn(masking.ACCOUNT_TOKEN, masked)
        self.assertNotIn("567890", masked)

    def test_keeps_plain_amounts_and_dates(self):
        text = "12월 3일에 50000원을 지원받았다"
        self.assertEqual(masking.mask_patterns(text), text)


class MaskTextWithNerTest(unittest.TestCase):
    def test_applies_ner_spans_from_end_to_keep_offsets(self):
        text = "김철수 씨가 박영희 씨에게 전화했다"

        def fake_ner(value: str):
            return [(0, 3), (7, 10)]  # 김철수, 박영희

        masked = masking.mask_text(text, fake_ner)
        self.assertNotIn("김철수", masked)
        self.assertNotIn("박영희", masked)
        self.assertEqual(masked.count(masking.PERSON_TOKEN), 2)

    def test_ignores_out_of_range_spans(self):
        masked = masking.mask_text("짧은 문장", lambda _: [(100, 200), (3, 2)])
        self.assertEqual(masked, "짧은 문장")

    def test_regex_still_applies_without_ner(self):
        masked = masking.mask_text("010-1111-2222", None)
        self.assertEqual(masked, masking.PHONE_TOKEN)


class MaskConditionsTest(unittest.TestCase):
    def test_masks_diagnosis_with_korean_particles_attached(self):
        # 조사가 붙어도 잡혀야 한다 — \b 를 못 쓰는 이유가 이것이다.
        for raw in ["우울증을", "우울증이", "우울증 진단을", "당뇨병도"]:
            masked = masking.mask_conditions(f"작년에 {raw} 받았다고 말했다")
            self.assertIn(masking.CONDITION_TOKEN, masked, raw)

    def test_matches_spaced_and_unspaced_forms_from_one_entry(self):
        for raw in ["공황장애", "공황 장애"]:
            masked = masking.mask_conditions(f"{raw} 때문에 외출이 어렵다")
            self.assertNotIn("공황", masked, raw)
            self.assertTrue(masked.startswith(masking.CONDITION_TOKEN), raw)

    def test_prefers_the_longest_term(self):
        masked = masking.mask_conditions("제2형 당뇨병 관리 중")
        self.assertEqual(masked, f"{masking.CONDITION_TOKEN} 관리 중")
        self.assertEqual(masked.count(masking.CONDITION_TOKEN), 1)

    def test_matches_ascii_abbreviations_case_insensitively(self):
        for raw in ["ADHD", "adhd", "PTSD", "hiv"]:
            self.assertIn(masking.CONDITION_TOKEN, masking.mask_conditions(f"{raw} 관련 상담"), raw)

    def test_keeps_counselling_context_sentences(self):
        # 구체 병명만 치환한다 — 이 문장들이 사라지면 브리핑이 쓸모없어진다.
        for text in [
            "요즘 몸이 안 좋다고 했다",
            "지난주에 병원에 다녀왔다",
            "약을 계속 먹고 있다",
            "많이 우울하다고 말했다",
            "검사 결과를 기다리는 중이다",
            "입원 이야기가 나왔다",
        ]:
            self.assertEqual(masking.mask_conditions(text), text, text)

    def test_does_not_mask_bare_cancer_word(self):
        # '암' 단독은 사전에서 일부러 뺐다(암호·어두움 등과 겹친다). 부위가 붙으면 잡는다.
        self.assertEqual(masking.mask_conditions("암호를 잊었다"), "암호를 잊었다")
        self.assertIn(masking.CONDITION_TOKEN, masking.mask_conditions("위암 수술을 받았다"))


class MaskingReportTest(unittest.TestCase):
    def test_counts_each_layer_without_keeping_originals(self):
        text = "우울증 진단을 받았고 연락처는 010-1234-5678 이다"
        masked, report = masking.mask_text_with_report(text)

        self.assertEqual(report.counts[masking.CONDITION_TOKEN], 1)
        self.assertEqual(report.counts[masking.PHONE_TOKEN], 1)
        self.assertEqual(report.total, 2)
        # 보고서는 숫자만 담는다 (R3) — 치환된 원문이 어디에도 남아서는 안 된다.
        serialized = repr(report.as_mapping())
        self.assertNotIn("우울증", serialized)
        self.assertNotIn("1234", serialized)
        self.assertNotIn("우울증", masked)

    def test_counts_person_and_condition_ner_spans(self):
        text = "김철수 씨는 루푸스 이야기를 했다"

        masked, report = masking.mask_text_with_report(
            text,
            ner=lambda _: [(0, 3)],
            condition_ner=lambda _: [(7, 10)],  # 루푸스 — 사전에 없는 병명은 NER 몫이다
        )
        self.assertEqual(report.counts[masking.PERSON_TOKEN], 1)
        self.assertEqual(report.counts[masking.CONDITION_TOKEN], 1)
        self.assertNotIn("김철수", masked)
        self.assertNotIn("루푸스", masked)

    def test_empty_report_when_nothing_matches(self):
        _masked, report = masking.mask_text_with_report("오늘은 특별한 일이 없었다")
        self.assertEqual(report.total, 0)
        self.assertEqual(report.as_mapping(), {})


# G3 완료 기준: "병명 포함 테스트 문장 셋에서 치환율 측정".
# 왼쪽은 문장, 오른쪽은 그 문장에서 사라져야 하는 원문 조각이다.
CONDITION_CORPUS: tuple[tuple[str, str], ...] = (
    ("당사자는 우울증으로 3년째 약을 먹는다고 했다", "우울증"),
    ("공황 장애 때문에 지하철을 못 탄다", "공황"),
    ("제2형 당뇨병 진단을 받은 뒤 식단을 바꿨다", "당뇨"),
    ("고혈압 약을 빼먹는 날이 많다", "고혈압"),
    ("간경화가 진행돼 일을 줄였다", "간경화"),
    ("B형 간염 보균 사실을 처음 말했다", "간염"),
    ("폐결핵 치료를 마쳤다고 했다", "결핵"),
    ("조현병 진단 이력을 언급했다", "조현병"),
    ("알코올 의존증 자조 모임에 나간다", "알코올"),
    ("ADHD 검사를 받아 보려 한다", "ADHD"),
    ("어머니가 치매라 돌봄 부담이 크다", "치매"),
    ("허리 디스크로 앉아 있기 힘들다", "디스크"),
    ("만성 신부전으로 주 3회 병원에 간다", "신부전"),
    ("위암 수술 이후 체중이 줄었다", "위암"),
    ("불면증이 심해져 낮에 졸린다", "불면증"),
)

# 오탐 확인용 — 이 문장들은 한 글자도 바뀌면 안 된다.
CONTEXT_CORPUS: tuple[str, ...] = (
    "몸이 예전 같지 않다고 했다",
    "병원비 걱정이 크다고 말했다",
    "약속한 서류를 아직 못 냈다",
    "기분이 가라앉는 날이 많다고 했다",
    "일자리를 다시 찾아보려 한다",
    "아이 학교 문제로 상담을 요청했다",
)


class ConditionMaskingRateTest(unittest.TestCase):
    def test_masks_every_diagnosis_in_the_corpus(self):
        missed = [
            sentence
            for sentence, fragment in CONDITION_CORPUS
            if fragment in masking.mask_conditions(sentence)
        ]
        rate = (len(CONDITION_CORPUS) - len(missed)) / len(CONDITION_CORPUS)
        self.assertEqual(missed, [], f"치환율 {rate:.0%} — 놓친 문장이 있다")
        self.assertEqual(rate, 1.0)

    def test_leaves_context_sentences_untouched(self):
        changed = [text for text in CONTEXT_CORPUS if masking.mask_conditions(text) != text]
        self.assertEqual(changed, [], "맥락 문장이 마스킹됐다 — 오탐")


if __name__ == "__main__":
    unittest.main()
