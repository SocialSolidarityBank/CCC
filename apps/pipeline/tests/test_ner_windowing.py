"""Token-window regressions independent of model downloads."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from ccc_pipeline import masking


class _Tensor:
    def __init__(self, values):
        self.values = values

    def __getitem__(self, index):
        return _Tensor(self.values[index])

    def tolist(self):
        return self.values


class _Recognizer:
    """A character-token classifier that otherwise truncates after 510 tokens."""
    def __init__(self, *, clipped=False, fail_window=None, tokens_per_char=1):
        self.tokenizer = SimpleNamespace(
            is_fast=True, model_max_length=512,
            num_special_tokens_to_add=lambda pair=False: 2,
        )
        self.model = SimpleNamespace(config=SimpleNamespace(id2label={
            0: "O", 1: "B-private_person", 2: "I-private_person",
            3: "E-private_person", 4: "S-private_address",
        }))
        self.clipped = clipped
        self.fail_window = fail_window
        self.tokens_per_char = tokens_per_char
        self.forward_count = 0

    def preprocess(self, text, tokenizer_params=None, is_split_into_words=False):
        params = tokenizer_params or {}
        capacity = params.get("max_length", 512) - 2
        stride = params.get("stride", 0)
        tokens = [(ord(char), index, index + 1)
                  for index, char in enumerate(text)
                  for _ in range(self.tokens_per_char)]
        start = 0
        while True:
            window = tokens[start:start + capacity]
            last = start + capacity >= len(tokens) or self.clipped or not params
            yield {
                "input_ids": _Tensor([[0, *[token[0] for token in window], 1]]),
                "special_tokens_mask": _Tensor([[1, *([0] * len(window)), 1]]),
                "offset_mapping": _Tensor([[(0, 0), *[(t[1], t[2]) for t in window], (0, 0)]]),
                "sentence": text if start == 0 else None,
                "is_last": last,
            }
            if last:
                break
            start += capacity - stride

    def forward(self, chunk):
        self.forward_count += 1
        if self.forward_count == self.fail_window:
            raise RuntimeError("sensitive fixture contents must not escape")
        return chunk

    def postprocess(self, outputs, **kwargs):
        chunk = outputs[0]
        labels = {ord("홍"): "B-private_person", ord("길"): "I-private_person", ord("동"): "E-private_person"}
        ids = chunk["input_ids"][0].tolist()
        offsets = chunk["offset_mapping"][0].tolist()
        return [{"entity": labels.get(ids[index], "O"), "index": index,
                 "start": offsets[index][0], "end": offsets[index][1]}
                for index in range(1, len(ids) - 1)]

    def __call__(self, text):
        return self.postprocess([self.forward(next(self.preprocess(text)))])


def _person(recognizer, transformers_version="4.53.3"):
    transformers = SimpleNamespace(pipeline=lambda *args, **kwargs: recognizer)
    spec = SimpleNamespace(name="fixture", revision="fixed")
    versions = {"torch": "2.8.0", "transformers": transformers_version}
    with (
        patch.dict("sys.modules", {"transformers": transformers}),
        patch.object(masking, "model_spec", return_value=spec),
        patch("importlib.metadata.version", side_effect=versions.__getitem__),
    ):
        return masking.build_ner("fixture")


class NerWindowingTest(unittest.TestCase):
    def test_incompatible_transformers_is_rejected_before_model_inference(self):
        recognizer = _Recognizer()
        with self.assertRaises(masking.MaskingConfigError):
            _person(recognizer, transformers_version="4.52.0")
        self.assertEqual(recognizer.forward_count, 0)

    def test_front_and_tail_names_are_both_masked(self):
        source = "홍길동" + "가" * 600 + "홍길동"
        self.assertEqual(masking.mask_text(source, _person(_Recognizer())), source.replace("홍길동", "[인명]"))

    def test_boundary_name_and_unicode_offsets_are_preserved(self):
        source = "😀e\u0301" + "가" * 506 + "홍길동" + "나" * 200
        self.assertEqual(masking.mask_text(source, _person(_Recognizer())), source.replace("홍길동", "[인명]"))

    def test_truncated_tokenization_fails_before_inference(self):
        recognizer = _Recognizer(clipped=True)
        with self.assertRaisesRegex(masking.MaskingConfigError, "^local_ner_unavailable$"):
            _person(recognizer)("가" * 600 + "홍길동")
        self.assertEqual(recognizer.forward_count, 0)

    def test_later_window_failure_does_not_retain_input_in_error(self):
        source = "가" * 600 + "홍길동"
        try:
            masking.recognize_ner_tokens(_Recognizer(fail_window=2), source)
        except masking.MaskingConfigError as error:
            self.assertEqual(str(error), "local_ner_unavailable")
            self.assertIsNone(error.__context__)
            trace = error.__traceback__
            while trace is not None:
                if trace.tb_frame.f_globals.get("__name__") == masking.__name__:
                    self.assertFalse(any(
                        isinstance(value, str) and value == source
                        for value in trace.tb_frame.f_locals.values()
                    ))
                trace = trace.tb_next
        else:
            self.fail("a failed window returned a partial result")

    def test_character_budget_fails_before_inference(self):
        recognizer = _Recognizer()
        with self.assertRaisesRegex(masking.MaskingConfigError, "^local_ner_unavailable$"):
            _person(recognizer)("가" * 24_001)
        self.assertEqual(recognizer.forward_count, 0)

    def test_window_budget_fails_before_inference(self):
        recognizer = _Recognizer(tokens_per_char=2)
        with self.assertRaisesRegex(masking.MaskingConfigError, "^local_ner_unavailable$"):
            _person(recognizer)("가" * 13_000)
        self.assertEqual(recognizer.forward_count, 0)


if __name__ == "__main__":
    unittest.main()
