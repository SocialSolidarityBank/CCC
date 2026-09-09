import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import run_windowing_probe as probe


class _Tensor:
    def __init__(self, values):
        self.values = values
        self.shape = (len(values), len(values[0]))

    def __getitem__(self, index):
        return SimpleNamespace(tolist=lambda: self.values[index])

    def tolist(self):
        return self.values


class _Pipeline:
    def preprocess(self, text):
        for start in (0, 2):
            yield {
                "input_ids": _Tensor([[0, start + 10, start + 11, 1]]),
                "offset_mapping": _Tensor([[[0, 0], [start, start + 1], [start + 1, start + 2], [0, 0]]]),
            }

    def forward(self, inputs):
        return {}


class ForwardCoverageTest(unittest.TestCase):
    def test_preprocessed_but_unexecuted_window_is_not_covered(self):
        pipeline, trace = _Pipeline(), probe._Trace()
        trace.reset("abcd")
        with probe._InstrumentedPipeline(pipeline, trace):
            windows = list(pipeline.preprocess("abcd"))
            pipeline.forward(windows[0])
        coverage = probe._coverage({"text": "abcd", "person": [], "address": []}, trace)
        self.assertEqual(coverage["unprocessedNonspaceCodepoints"], 2)

    def test_failed_forward_does_not_claim_source_coverage(self):
        pipeline, trace = _Pipeline(), probe._Trace()
        trace.reset("abcd")
        def fail(_inputs):
            raise RuntimeError("inference failed")
        pipeline.forward = fail
        with probe._InstrumentedPipeline(pipeline, trace):
            windows = list(pipeline.preprocess("abcd"))
            with self.assertRaises(RuntimeError):
                pipeline.forward(windows[0])
        coverage = probe._coverage({"text": "abcd", "person": [], "address": []}, trace)
        self.assertEqual(coverage["unprocessedNonspaceCodepoints"], 4)

    def test_source_change_during_measurement_cannot_be_certified(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            paths = [root / relative for relative in (
                "apps/pipeline/ccc_pipeline/masking.py", "scripts/privacy/qualify_ner.py",
                "scripts/privacy/run_windowing_probe.py",
            )]
            for path in paths:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("original", encoding="utf-8")
            def load(_root):
                paths[0].write_text("changed", encoding="utf-8")
                return SimpleNamespace(tokenizer=object()), object(), {}
            with (
                patch.object(probe, "_datasets", return_value=()),
                patch.object(probe, "_load_model", side_effect=load),
                patch.object(probe.time, "perf_counter", side_effect=[0.0, 1.0, 2.0]),
                patch.object(probe, "_stress", return_value={}),
            ):
                with self.assertRaisesRegex(probe.ProbeError, "implementation_changed"):
                    probe._measure(root)


if __name__ == "__main__":
    unittest.main()
