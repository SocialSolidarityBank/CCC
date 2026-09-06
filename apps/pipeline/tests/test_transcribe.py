"""전사 오케스트레이션 테스트 (D53) — 가짜 엔진으로 ML·ffmpeg 없이 돈다.

무음 탐지와 조각 추출은 ffmpeg 에 붙어 있으므로 여기서만 대체한다. 나머지
(조각 순회·시각 되돌리기·반복 검사·반으로 잘라 재시도)는 실제 코드가 돈다.
"""

import unittest
import hashlib
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from pathlib import Path
from unittest import mock

from ccc_pipeline import transcribe as transcribe_module
from ccc_pipeline.speaker_mapping import Segment
from ccc_pipeline.transcribe import KNOWN_ENGINES, build_engine, transcribe_audio


class FakeEngine:
    """호출된 파일 경로를 기록하고, 경로별로 정해진 결과를 돌려준다."""

    def __init__(self, results: dict[str, list[Segment]], default: list[Segment] | None = None) -> None:
        self.results = results
        self.default = default if default is not None else []
        self.calls: list[str] = []

    def __call__(self, audio_path: str) -> list[Segment]:
        self.calls.append(audio_path)
        for key, value in self.results.items():
            if key in audio_path:
                return value
        return self.default


def fake_extract(_audio_path: str, chunk, out_path: str) -> str:  # noqa: ANN001
    """실제 자르기 대신 경로만 만들어 준다(파일을 쓰지 않는다)."""
    return out_path


class BuildEngineTest(unittest.TestCase):
    def test_unknown_engine_fails_loudly(self) -> None:
        # 오타가 조용히 기본 엔진으로 폴백하면, 어떤 엔진으로 전사했는지 알 수 없게 된다.
        with self.assertRaises(ValueError) as caught:
            build_engine("qwen3", "medium")
        self.assertIn("qwen3", str(caught.exception))

    def test_whisper_is_known(self) -> None:
        self.assertIn("whisper", KNOWN_ENGINES)
        self.assertTrue(callable(build_engine("whisper", "medium")))


class CandidateEngineTest(unittest.TestCase):
    def test_candidate_consumes_lazy_segments_and_reuses_loaded_model(self):
        with TemporaryDirectory() as directory:
            checkpoint = Path(directory) / "model.bin"
            checkpoint.write_bytes(b"candidate-weights")
            spec = SimpleNamespace(
                name="fixture/model", revision="a" * 40,
                checkpoint_sha256=hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
            )
            consumed = []
            def segments():
                consumed.append(True)
                yield SimpleNamespace(start=0.5, end=1.5, text="합성 음성")
            model = mock.Mock()
            model.transcribe.side_effect = lambda *a, **kw: (segments(), None)
            constructor = mock.Mock(return_value=model)
            with (
                mock.patch.dict(sys.modules, {
                    "faster_whisper": SimpleNamespace(WhisperModel=constructor),
                    "huggingface_hub": SimpleNamespace(snapshot_download=mock.Mock(return_value=directory)),
                }),
                mock.patch.object(transcribe_module, "role_spec", return_value=spec),
            ):
                engine = build_engine("faster-whisper-int8-cpu", "medium")
                for _ in range(2):
                    result = engine("synthetic.wav")
                    self.assertEqual(result, [Segment(0.5, 1.5, "합성 음성")])
                self.assertEqual(len(consumed), 2)
                constructor.assert_called_once_with(
                    directory, device="cpu", compute_type="int8", local_files_only=True,
                )
                # A failed candidate must propagate, not invoke the legacy engine.
                model.transcribe.side_effect = RuntimeError("candidate unavailable")
                with mock.patch.object(transcribe_module, "_build_whisper") as legacy:
                    with self.assertRaises(RuntimeError):
                        engine("synthetic.wav")
                    legacy.assert_not_called()

    def test_corrupt_candidate_checkpoint_never_reaches_inference(self):
        with TemporaryDirectory() as directory:
            (Path(directory) / "model.bin").write_bytes(b"tampered")
            spec = SimpleNamespace(name="fixture/model", revision="a" * 40, checkpoint_sha256="0" * 64)
            constructor = mock.Mock()
            with (
                mock.patch.dict(sys.modules, {
                    "faster_whisper": SimpleNamespace(WhisperModel=constructor),
                    "huggingface_hub": SimpleNamespace(snapshot_download=mock.Mock(return_value=directory)),
                }),
                mock.patch.object(transcribe_module, "role_spec", return_value=spec),
            ):
                with self.assertRaisesRegex(RuntimeError, "SHA-256"):
                    build_engine("faster-whisper-int8-cpu", "medium")("synthetic.wav")
                constructor.assert_not_called()


class TranscribeAudioTest(unittest.TestCase):
    def run_with(self, engine: FakeEngine, silences, duration, **kwargs):  # noqa: ANN001, ANN201
        with mock.patch.object(transcribe_module, "detect_silences", return_value=(silences, duration)), \
             mock.patch.object(transcribe_module, "extract_chunk", side_effect=fake_extract):
            return transcribe_audio("/tmp/audio.wav", Path("/tmp/work"), engine, **kwargs)

    def test_short_audio_goes_to_the_engine_whole(self) -> None:
        engine = FakeEngine({}, default=[Segment(0.0, 3.0, "짧은 상담")])
        result = self.run_with(engine, [], 60.0, max_chunk_seconds=180.0)

        self.assertEqual(engine.calls, ["/tmp/audio.wav"])  # 자르지 않았다
        self.assertEqual(len(result.segments), 1)
        self.assertTrue(result.reliable)

    def test_missing_ffmpeg_falls_back_to_whole_file(self) -> None:
        # detect_silences 가 ([], 0.0) 을 주는 상황 = ffmpeg 없음. 멈추지 않고 통짜로 넣는다.
        engine = FakeEngine({}, default=[Segment(0.0, 3.0, "통짜")])
        result = self.run_with(engine, [], 0.0)

        self.assertEqual(engine.calls, ["/tmp/audio.wav"])
        self.assertEqual(result.forced_cuts, 1)
        self.assertEqual(len(result.segments), 1)

    def test_chunk_timestamps_are_shifted_back_to_the_whole_file(self) -> None:
        # 조각을 잘라 넣으면 엔진은 0초부터 세므로, 전체 파일 기준으로 되돌려야 한다.
        engine = FakeEngine({}, default=[Segment(0.0, 5.0, "발화")])
        result = self.run_with(engine, [], 400.0, max_chunk_seconds=180.0, min_chunk_seconds=30.0)

        self.assertEqual(len(engine.calls), 3)
        self.assertEqual([round(s.start, 1) for s in result.segments], [0.0, 180.0, 360.0])

    def test_repetition_is_collapsed_and_reported(self) -> None:
        engine = FakeEngine({}, default=[Segment(i * 2.0, i * 2.0 + 2.0, "구독과 좋아요") for i in range(6)])
        result = self.run_with(engine, [], 60.0, max_chunk_seconds=180.0, repeat_threshold=4)

        self.assertFalse(result.reliable)
        self.assertEqual(len(result.warnings), 1)
        self.assertEqual(result.warnings[0].count, 6)
        self.assertEqual(len(result.segments), 1)
        self.assertTrue(result.segments[0].warning)

    def test_repeating_chunk_is_retried_in_halves(self) -> None:
        collapsed = [Segment(i * 2.0, i * 2.0 + 2.0, "같은 문장") for i in range(6)]
        healthy = [Segment(0.0, 2.0, "제대로 된 발화")]
        # 첫 조각(chunk-0)만 무너지고, 반으로 자른 재시도(chunk-0r0/0r1)는 멀쩡하다.
        engine = FakeEngine({"chunk-0r": healthy, "chunk-0": collapsed}, default=healthy)
        result = self.run_with(engine, [], 400.0, max_chunk_seconds=180.0, min_chunk_seconds=30.0)

        self.assertIn("chunk-0r0", "".join(engine.calls))
        self.assertTrue(result.reliable)  # 재시도가 반복을 없앴다

    def test_retry_result_is_rejected_when_it_is_not_better(self) -> None:
        # 재시도가 더 낫지 않으면 원래 결과를 둔다 — 잘게 쪼갤수록 문맥이 사라진다.
        collapsed = [Segment(i * 2.0, i * 2.0 + 2.0, "같은 문장") for i in range(6)]
        engine = FakeEngine({}, default=collapsed)
        result = self.run_with(engine, [], 400.0, max_chunk_seconds=180.0, min_chunk_seconds=30.0)

        self.assertFalse(result.reliable)
        self.assertEqual(len(result.warnings), 3)  # 조각 3개가 전부 무너진 상태

    def test_whole_file_fallback_is_not_retried(self) -> None:
        # 통짜 폴백은 자를 근거(길이)가 없다 — 재시도 없이 경고만 남긴다.
        collapsed = [Segment(i * 2.0, i * 2.0 + 2.0, "같은 문장") for i in range(6)]
        engine = FakeEngine({}, default=collapsed)
        result = self.run_with(engine, [], 0.0)

        self.assertEqual(engine.calls, ["/tmp/audio.wav"])
        self.assertFalse(result.reliable)


    def test_observer_receives_repetition_before_collapse(self) -> None:
        repeated = [Segment(i * 2.0, i * 2.0 + 2.0, "같은 문장") for i in range(6)]
        observed = []
        result = self.run_with(FakeEngine({}, default=repeated), [], 0.0, on_chunk=observed.extend)

        self.assertEqual([segment.text for segment in observed], ["같은 문장"] * 6)
        self.assertLess(len(result.segments), len(observed))
        self.assertFalse(result.reliable)

if __name__ == "__main__":
    unittest.main()
