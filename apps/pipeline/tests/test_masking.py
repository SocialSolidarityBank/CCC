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


class LabelContractTest(unittest.TestCase):
    """모델이 선언한 라벨과 설정한 접두의 대조 (2026-07-31 Q 결정).

    이 검사가 없으면 접두가 어긋났을 때 **경고 없이 치환 0건**이 되고, 그 결과가
    "이름이 없는 상담 기록"과 구분되지 않는다 — 조용한 PII 유출이다(R3).
    """

    class _FakeRecognizer:
        def __init__(self, labels):
            self.model = type("M", (), {"config": type("C", (), {"id2label": dict(enumerate(labels))})()})()

    def test_accepts_a_model_that_declares_a_matching_label(self):
        recognizer = self._FakeRecognizer(["O", "B-PS", "I-PS"])
        masking._assert_labels_exist(recognizer, "fixture/klue-ner", ("PS", "PER"))

    def test_strips_bio_prefixes_before_comparing(self):
        # 파이프라인 aggregation 이 태깅 접두를 떼므로 대조도 떼고 한다.
        recognizer = self._FakeRecognizer(["O", "B-NAME", "I-NAME"])
        masking._assert_labels_exist(recognizer, "fixture/pii-model", ("NAME",))

    def test_accepts_bioes_tagging(self):
        # 채택 모델(korean-pii-e5-base)이 BIOES 다 — E-/S- 를 못 떼면 멀쩡한 모델을 거부한다.
        recognizer = self._FakeRecognizer(
            ["O", "B-private_person", "I-private_person", "E-private_person", "S-private_person"],
        )
        masking._assert_labels_exist(recognizer, "FrameByFrame/korean-pii-e5-base", ("PRIVATE_PERSON",))

    def test_default_person_labels_cover_the_adopted_model(self):
        # 기본값만으로도 채택 모델이 뜬다 — 세팅 때 라벨을 안 적어도 조용히 0건이 되지 않는다.
        recognizer = self._FakeRecognizer(["O", "S-private_person", "S-private_address"])
        masking._assert_labels_exist(
            recognizer, "FrameByFrame/korean-pii-e5-base", masking.DEFAULT_PERSON_LABELS,
        )

    def test_klue_style_labels_are_not_matched_by_the_pii_prefix(self):
        # PS 가 PRIVATE_* 를 우연히 먹지 않는지 — 접두 비교의 흔한 사고.
        recognizer = self._FakeRecognizer(["O", "B-private_phone"])
        with self.assertRaises(masking.MaskingConfigError):
            masking._assert_labels_exist(recognizer, "fixture/pii-model", ("PS", "PER"))

    def test_rejects_a_model_whose_labels_do_not_match(self):
        # PII 전용 모델(NAME 계열)에 KLUE 접두(PS/PER)를 설정한 전형적인 실수.
        recognizer = self._FakeRecognizer(["O", "B-NAME", "B-PHONE"])
        with self.assertRaises(masking.MaskingConfigError):
            masking._assert_labels_exist(recognizer, "fixture/pii-model", ("PS", "PER"))

    def test_rejects_a_model_that_declares_no_labels(self):
        # 대조 자체가 불가능하면 통과시키지 않는다.
        recognizer = self._FakeRecognizer([])
        with self.assertRaises(masking.MaskingConfigError):
            masking._assert_labels_exist(recognizer, "fixture/unknown", ("PS",))


class AddressLayerTest(unittest.TestCase):
    """주소 계층 (2026-08-01 Q 결정) — 이름과 **다른 토큰**으로 가린다."""

    def test_address_uses_its_own_token(self):
        text = "김철수 씨가 행복아파트 3동에 산다고 말함"

        def person(t):
            i = t.find("김철수")
            return [(i, i + 3)]

        def address(t):
            i = t.find("행복아파트 3동")
            return [(i, i + len("행복아파트 3동"))]

        masked, report = masking.mask_text_with_report(text, person, None, address)
        # 주소를 [인명] 으로 치환하면 검토 화면과 집계가 둘 다 거짓이 된다.
        self.assertIn("[인명]", masked)
        self.assertIn("[주소]", masked)
        self.assertNotIn("행복아파트", masked)
        self.assertEqual(report.as_mapping()[masking.PERSON_TOKEN], 1)
        self.assertEqual(report.as_mapping()[masking.ADDRESS_TOKEN], 1)

    def test_layers_do_not_shift_each_other_offsets(self):
        # 두 계층 스팬을 합쳐 뒤에서 앞으로 치환하지 않으면 엉뚱한 자리가 잘린다.
        text = "가나다 주소는 라마바사 이다"

        def person(t):
            return [(0, 3)]

        def address(t):
            i = t.find("라마바사")
            return [(i, i + 4)]

        masked, _ = masking.mask_text_with_report(text, person, None, address)
        self.assertEqual(masked, "[인명] 주소는 [주소] 이다")

    def test_address_layer_can_be_turned_off(self):
        masked, report = masking.mask_text_with_report("행복아파트 3동", None, None, None)
        self.assertEqual(masked, "행복아파트 3동")
        self.assertEqual(report.total, 0)


class OverlapPolicyTest(unittest.TestCase):
    """겹치는 스팬 처리 (2026-08-01 Q 결정: 못 가리는 것보다 과하게 가리는 쪽).

    통째로 건너뛰면 겹치지 않는 부분이 원문 그대로 남는다 — 그건 유출이고 되돌릴 수 없다.
    """

    def test_overlapping_spans_are_clipped_not_dropped(self):
        text = "행복아파트 김철수 씨"
        # 주소(0,6)와 인명(7,10)이 아니라, 주소가 인명을 물고 들어오는 겹침을 만든다.
        def person(_t):
            return [(7, 10)]

        def address(_t):
            return [(0, 9)]

        masked, report = masking.mask_text_with_report(text, person, None, address)
        # 합집합을 한 토큰으로 덮는다 — 조각이 남지 않는 것이 핵심이다.
        self.assertNotIn("행복아파트", masked)
        self.assertNotIn("김철수", masked)
        # 계층이 섞이면 식별력이 큰 쪽(인명)을 쓴다.
        self.assertEqual(masked, "[인명]씨")
        self.assertEqual(report.total, 1)

    def test_fully_covered_span_is_skipped(self):
        text = "김철수 씨"

        def outer(_t):
            return [(0, 3)]

        def inner(_t):
            return [(1, 2)]

        masked, report = masking.mask_text_with_report(text, outer, None, inner)
        # 안쪽 스팬은 바깥에 덮이므로 한 번만 치환된다 — 토큰이 중첩되지 않는다.
        self.assertEqual(masked, "[인명] 씨")
        self.assertEqual(report.total, 1)

    def test_no_fragment_survives_a_partial_overlap(self):
        # 회귀 방지: 잘라서 치환하던 구현은 "[인명][주소]수 씨" 처럼 조각을 남겼다.
        text = "가나다라마바사"
        masked, _ = masking.mask_text_with_report(
            text, lambda _t: [(4, 7)], None, lambda _t: [(0, 5)],
        )
        self.assertEqual(masked, "[인명]")


# '짧은 목표 문장' 유형 (D62 §7 검수 반영 · ADR-0032 · CCC-73).
# 목표 문장은 "아들 학원비 마련"처럼 짧아 앞뒤 맥락이 없고, D62 이후 전체 목표가
# 텍스트 일감 원문에 실려 이 마스킹을 그대로 거친다. 여기서는 결정론 계층
# (정규식·질병명 사전·스팬 적용 산수)이 짧은 문장에서도 어긋나지 않는 것을 고정한다.
# NER 모델이 짧은 문장의 인명·지명을 실제로 잡아내는지는 실측 게이트 몫이며,
# 그 실측은 이 말뭉치를 재사용한다.
GOAL_SENTENCE_CORPUS: tuple[tuple[str, str], ...] = (
    # 왼쪽은 짧은 목표 문장, 오른쪽은 마스킹 뒤 사라져야 하는 원문 조각이다.
    ("우울증 약 복용을 거르지 않는다", "우울증"),
    ("공황 장애 통원 치료를 이어 간다", "공황"),
    ("알코올 의존증 자조 모임에 매주 나간다", "알코올"),
    ("밀린 병원비 계좌 110-234-567890 정리", "567890"),
    ("연락 두절 방지용 번호 010-1234-5678 유지", "1234"),
)

# 오탐 대조군: 결정론 계층은 이 문장들을 한 글자도 바꾸면 안 된다. 인명·지명이 든
# "아들 학원비"·"공장 복직" 류는 NER 계층 몫이라 여기서는 원문 유지가 정답이다.
GOAL_CONTEXT_CORPUS: tuple[str, ...] = (
    "아들 학원비를 마련한다",
    "공장 복직을 준비한다",
    "보증금 500만원을 모은다",
    "월세 체납을 해소한다",
    "매출 기록 습관을 들인다",
)


class ShortGoalSentenceMaskingTest(unittest.TestCase):
    """짧은 목표 문장 유형 — 결정론 계층의 치환율과 오탐, 경계 스팬 산수."""

    def test_masks_every_fragment_in_the_goal_corpus(self):
        missed = [
            sentence
            for sentence, fragment in GOAL_SENTENCE_CORPUS
            if fragment in masking.mask_text(sentence)
        ]
        self.assertEqual(missed, [], "짧은 목표 문장에서 결정론 계층이 조각을 놓쳤다")

    def test_leaves_plain_goal_sentences_untouched(self):
        changed = [text for text in GOAL_CONTEXT_CORPUS if masking.mask_text(text) != text]
        self.assertEqual(changed, [], "짧은 목표 문장이 결정론 계층에 과탐됐다")

    def test_person_span_at_the_head_of_a_short_sentence(self):
        # "OO공장 복직" 류: 문장 머리를 덮는 스팬이 오프셋을 밀지 않아야 한다.
        masked = masking.mask_text("김철수 공장 복직", lambda _t: [(0, 3)])
        self.assertEqual(masked, f"{masking.PERSON_TOKEN} 공장 복직")

    def test_person_span_at_the_tail_of_a_short_sentence(self):
        masked = masking.mask_text("복직 준비를 돕는 김철수", lambda _t: [(10, 13)])
        self.assertEqual(masked, f"복직 준비를 돕는 {masking.PERSON_TOKEN}")

    def test_span_covering_the_whole_short_sentence(self):
        # 문장 전체가 이름 하나인 극단: 전부 토큰 하나로 덮여야 한다.
        masked = masking.mask_text("김철수", lambda _t: [(0, 3)])
        self.assertEqual(masked, masking.PERSON_TOKEN)
