from __future__ import annotations

import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

STT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STT))

import benchmark as benchmark_module


class BenchmarkContractTest(unittest.TestCase):
    benchmark = benchmark_module

    def test_fixture_failure_stops_workers_and_records_integrity_failure(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            out = Path(root) / "run"
            with patch.object(self.benchmark, "verify_fixture", side_effect=ValueError("private fixture detail")), patch.object(self.benchmark, "worker_responses") as workers:
                result = self.benchmark.run_benchmark(Path(root) / "manifest.json", Path(root), Path(root) / "receipt.json", out, {})
            workers.assert_not_called()
            self.assertEqual(result["status"], "FAIL")
            self.assertEqual(result["errorCode"], "fixture_integrity_failed")
            self.assertNotIn("private fixture detail", (out / "stt-metrics.json").read_text())

    def test_existing_run_is_never_overwritten(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            out = Path(root) / "run"
            out.mkdir()
            evidence = out / "stt-metrics.json"
            evidence.write_text("original")
            with self.assertRaises(FileExistsError):
                self.benchmark.run_benchmark(Path(root) / "manifest.json", Path(root), Path(root) / "receipt.json", out, {})
            self.assertEqual(evidence.read_text(), "original")

    def test_worker_identity_mismatch_cannot_be_scored_as_another_session(self) -> None:
        process = type("Process", (), {})()
        process.stdin = io.StringIO()
        process.stdout = io.StringIO(json.dumps({"sessionId": "case-002-session-01", "text": "private output"}) + "\n")
        process.poll = lambda: 0
        process.wait = lambda **kwargs: 0
        process.terminate = lambda: None
        with patch.object(self.benchmark.subprocess, "Popen", return_value=process):
            rows = list(self.benchmark.worker_responses(["python"], [{"sessionId": "case-001-session-01", "audioPath": "case-001-session-01.wav"}]))
        self.assertEqual(rows[0], {"sessionId": "case-001-session-01", "errorCode": "worker_protocol_failed"})
        self.assertNotIn("private output", json.dumps(rows))

    def test_worker_start_failure_accounts_for_every_requested_session(self) -> None:
        sessions = [{"sessionId": f"case-001-session-{index:02}", "audioPath": "audio.wav"} for index in (1, 2)]
        with patch.object(self.benchmark.subprocess, "Popen", side_effect=OSError("private process detail")):
            rows = list(self.benchmark.worker_responses(["missing-python"], sessions))
        self.assertEqual([row["sessionId"] for row in rows], [row["sessionId"] for row in sessions])
        self.assertTrue(all(row["errorCode"] == "worker_start_failed" for row in rows))
        self.assertNotIn("private process detail", json.dumps(rows))

    def test_trailing_duplicate_prediction_is_an_integrity_failure(self) -> None:
        code = "import sys,json; row=json.loads(sys.stdin.readline()); sys.stdout.write((json.dumps(row)+'\\n')*2); sys.stdout.flush(); sys.stdin.read()"
        sessions = [{"sessionId": "case-001-session-01", "audioPath": "audio.wav"}]
        with self.assertRaisesRegex(RuntimeError, "worker_exit_failed"):
            list(self.benchmark.worker_responses([sys.executable, "-c", code], sessions))

    def test_diarization_exit_failure_cannot_pass_with_complete_predictions(self) -> None:
        sessions = [{"caseId": "case-001", "sessionId": f"session-{index}", "audioPath": "audio.wav", "referencePath": "reference.json", "audioSha256": "a" * 64, "transcriptSha256": "b" * 64, "speakerTruthSha256": "c" * 64, "durationSeconds": 10.0} for index in range(150)]
        reference = {"transcript": "가\n나", "speakerTurns": [{"start": 0.0, "end": 5.0, "speaker": "A", "text": "가"}, {"start": 5.0, "end": 10.0, "speaker": "B", "text": "나"}]}
        verification = {"manifestSha256": "d" * 64}
        manifest = {"fixtureId": "synthetic-fixture", "sessions": sessions}
        def read_json(path):
            return {"manifest.json": manifest, "receipt.json": verification, "reference.json": reference}[path.name]
        def responses(command, requested):
            engine = command[0]
            metadata = {"engine": engine, "models": [{"name": "synthetic/model", "revision": "0" * 40, "files": [{"name": "model.bin", "sha256": "0" * 64}]}], "packages": {"synthetic": "1.0"}, "backend": "synthetic", "device": "cpu", "threads": 1}
            for session in requested:
                row = {"sessionId": session["sessionId"], "metadata": metadata}
                row.update({"turns": reference["speakerTurns"]} if engine == "diarization" else {"text": "가 나", "engineWallSeconds": 1.0})
                yield row
            if engine == "diarization":
                raise RuntimeError("worker_exit_failed")
        with tempfile.TemporaryDirectory() as root:
            out = Path(root) / "run"
            with patch.object(self.benchmark, "verify_fixture", return_value=verification), patch.object(self.benchmark, "read_json", side_effect=read_json), patch.object(self.benchmark, "worker_responses", side_effect=responses), patch.object(self.benchmark, "hardware", return_value={"system": "Windows"}), patch.object(self.benchmark, "_source_hashes", return_value={}), patch.object(self.benchmark, "_command_output", return_value=None), patch("builtins.print"):
                report = self.benchmark.run_benchmark(Path("manifest.json"), Path(root), Path("receipt.json"), out, {engine: [engine] for engine in ("diarization", *self.benchmark.ENGINES)})
            self.assertEqual(report["status"], "FAIL")
            self.assertTrue(all(not row["complete"] for row in report["engines"].values()))

    def test_metadata_does_not_accept_transcripts_or_unpinned_models(self) -> None:
        with self.assertRaises(ValueError):
            self.benchmark.safe_metadata({"text": "private output"})
        with self.assertRaises(ValueError):
            self.benchmark.safe_metadata({"engine": "qwen3-asr", "models": [{"name": "Qwen/model", "revision": "main", "files": []}], "packages": {}, "backend": "transformers", "device": "cpu", "threads": 1})


if __name__ == "__main__":
    unittest.main()
