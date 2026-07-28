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


if __name__ == "__main__":
    unittest.main()
