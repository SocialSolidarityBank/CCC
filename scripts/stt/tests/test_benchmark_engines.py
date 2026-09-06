from __future__ import annotations

import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

STT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STT))

import benchmark_engines as engines  # noqa: E402


class WorkerProtocolTest(unittest.TestCase):
    def setUp(self) -> None:
        self.root = tempfile.TemporaryDirectory()
        self.addCleanup(self.root.cleanup)
        self.audio_dir = Path(self.root.name) / "audio"
        self.audio_dir.mkdir()
        self.audio = self.audio_dir / "case-001-session-01.wav"
        self.audio.write_bytes(b"synthetic audio")
        self.calls: list[Path] = []
        self.worker = engines.LoadedWorker(
            engine="qwen3-asr",
            response_key="text",
            infer=self._infer,
            metadata={
                "engine": "qwen3-asr",
                "models": [],
                "packages": {},
                "backend": "qwen-asr-transformers",
                "device": "cpu",
                "threads": 2,
            },
        )

    def _infer(self, path: Path, _work_dir: Path) -> str:
        self.calls.append(path)
        return "private hypothesis"

    def serve(self, request: dict[str, object]) -> dict[str, object]:
        output = io.StringIO()
        engines.serve(
            self.worker,
            self.audio_dir,
            io.StringIO(json.dumps(request) + "\n"),
            output,
        )
        return json.loads(output.getvalue())

    def test_protocol_accepts_audio_only_and_emits_one_response(self) -> None:
        response = self.serve({"sessionId": "case-001-session-01", "audioPath": str(self.audio)})
        self.assertEqual(response["sessionId"], "case-001-session-01")
        self.assertEqual(response["text"], "private hypothesis")
        self.assertGreaterEqual(response["engineWallSeconds"], 0.0)
        self.assertEqual(set(response["metadata"]), {"engine", "models", "packages", "backend", "device", "threads"})
        self.assertEqual(self.calls, [self.audio.resolve()])

    def test_relative_audio_path_is_resolved_inside_audio_directory(self) -> None:
        response = self.serve({"sessionId": "case-001-session-01", "audioPath": self.audio.name})
        self.assertNotIn("errorCode", response)
        self.assertEqual(self.calls, [self.audio.resolve()])

    def test_protocol_preserves_unicode_under_legacy_windows_encoding(self) -> None:
        encoded = io.BytesIO()
        with io.TextIOWrapper(encoded, encoding="cp1252") as stream:
            engines._emit(stream, {"text": "한글"})
            self.assertEqual(json.loads(encoded.getvalue().decode("utf-8")), {"text": "한글"})

    def test_protocol_rejects_reference_or_transcript_fields_without_inference(self) -> None:
        response = self.serve(
            {
                "sessionId": "case-001-session-01",
                "audioPath": str(self.audio),
                "transcript": "must never reach a model",
            }
        )
        self.assertEqual(response, {"sessionId": "case-001-session-01", "errorCode": "invalid_request"})
        self.assertEqual(self.calls, [])
        self.assertNotIn("must never reach a model", json.dumps(response))

    def test_path_escape_is_rejected_without_inference(self) -> None:
        outside = Path(self.root.name) / "outside.wav"
        outside.write_bytes(b"synthetic audio")
        response = self.serve({"sessionId": "case-001-session-01", "audioPath": str(outside)})
        self.assertEqual(response, {"sessionId": "case-001-session-01", "errorCode": "audio_path_invalid"})
        self.assertEqual(self.calls, [])


class ModelLoadingTest(unittest.TestCase):
    def test_unavailable_requested_device_never_falls_back_to_cpu(self) -> None:
        torch = SimpleNamespace(
            cuda=SimpleNamespace(is_available=lambda: False),
            backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)),
        )
        with self.assertRaisesRegex(engines.StartupError, "device_unavailable"):
            engines.validate_device("qwen3-asr", "cuda", torch)

    def test_bad_model_hash_fails_before_sdk_loader(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            snapshot = Path(root)
            (snapshot / "model.safetensors").write_bytes(b"wrong")
            model = {
                "name": "Qwen/Qwen3-ForcedAligner-0.6B",
                "revision": "c7cbfc2048c462b0d63a45797104fc9db3ad62b7",
                "files": [{"name": "model.safetensors", "sha256": "0" * 64}],
            }
            spec = {"backend": "qwen-asr-transformers", "packages": ["qwen-asr"], "models": [model]}
            with patch.object(engines, "_snapshot_download", return_value=str(snapshot)), patch.object(
                engines, "_load_qwen"
            ) as sdk_loader:
                with self.assertRaisesRegex(engines.StartupError, "model_hash_mismatch"):
                    engines.load_engine("qwen3-asr", "cpu", 1, spec)
            sdk_loader.assert_not_called()

    def test_chunk_boundaries_do_not_merge_words_or_split_aligned_characters(self) -> None:
        def selected_chunks(*_args, on_chunk):
            on_chunk([engines.Segment(0.0, 0.5, "한"), engines.Segment(0.5, 1.0, "글")])
            on_chunk([engines.Segment(2.0, 3.0, "이어")])
        with patch.object(engines, "prepare_models", return_value={"Systran/faster-whisper-medium": Path("snapshot")}), patch.object(engines, "_metadata", return_value={}), patch.object(engines, "_load_faster_whisper", return_value=lambda _: []), patch.object(engines, "transcribe_audio", side_effect=selected_chunks):
            worker = engines.load_engine("faster-whisper", "cpu", 1, {"models": []})
            text = worker.infer(Path("audio.wav"), Path("work"))
        self.assertEqual(text, "한글 이어")

    def test_empty_qwen_transcription_needs_no_forced_alignment(self) -> None:
        self.assertEqual(engines.qwen_segments([SimpleNamespace(text="", time_stamps=None)]), [])
        with self.assertRaisesRegex(engines.RequestError, "sdk_output_invalid"):
            engines.qwen_segments([SimpleNamespace(text="말한 내용", time_stamps=None)])

    def test_qwen_sdk_result_shape_produces_real_segments(self) -> None:
        result = SimpleNamespace(
            text="안녕 하세요",
            time_stamps=[
                SimpleNamespace(text="안녕", start_time=0.1, end_time=0.4),
                SimpleNamespace(text="하세요", start_time=0.4, end_time=0.8),
            ],
        )
        segments = engines.qwen_segments([result])
        self.assertEqual([(s.start, s.end, s.text) for s in segments], [(0.1, 0.4, "안녕 "), (0.4, 0.8, "하세요")])
        self.assertEqual("".join(segment.text for segment in segments), result.text)

    def test_non_cpu_qwen_load_is_not_attempted_without_device_support(self) -> None:
        manifest = {
            "backend": "qwen-asr-transformers",
            "packages": [],
            "models": [],
        }
        with patch.object(engines, "_import_torch") as import_torch, patch.object(engines, "prepare_models") as prepare:
            import_torch.return_value = SimpleNamespace(
                cuda=SimpleNamespace(is_available=lambda: False),
                backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)),
            )
            with self.assertRaisesRegex(engines.StartupError, "device_unavailable"):
                engines.load_engine("qwen3-asr", "cuda", 1, manifest)
        prepare.assert_not_called()


if __name__ == "__main__":
    unittest.main()
