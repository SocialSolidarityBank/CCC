"""Internal STT trials keep transcripts local and require explicit external upload."""

import contextlib
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from ccc_pipeline import stt_trial
from ccc_pipeline.speaker_mapping import Segment


class TrialBoundaryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.audio = self.root / "own-test.wav"
        self.audio.write_bytes(b"operator-owned functional test input")
        self.output = self.root / "result"

    def arguments(self, *extra):
        return [
            "--audio", str(self.audio), "--engine", "qwen3-asr",
            "--stt-python", sys.executable, "--output-dir", str(self.output),
            *extra,
        ]

    def invoke(self, arguments):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            status = stt_trial.main(arguments)
        return status, stdout.getvalue(), stderr.getvalue()

    def test_undeclared_input_is_rejected_before_execution(self):
        with mock.patch.object(stt_trial, "build_engine") as build:
            status, stdout, stderr = self.invoke(self.arguments())
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(stderr)["errorCode"], "owned_test_recording_declaration_required")
        self.assertEqual(stdout, "")
        self.assertFalse(self.output.exists())
        build.assert_not_called()

    def test_azure_requires_separate_upload_authorization(self):
        arguments = [
            "--audio", str(self.audio), "--engine", "azure",
            "--owned-test-recording", "--output-dir", str(self.output),
        ]
        with mock.patch.dict(os.environ, {"AZURE_SPEECH_KEY": "test-only-not-a-real-key"}):
            status, _, stderr = self.invoke(arguments)
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(stderr)["errorCode"], "external_upload_not_authorized")
        self.assertFalse(self.output.exists())

    def test_transcript_cannot_be_written_inside_git_checkout(self):
        (self.root / ".git").mkdir()
        status, _, stderr = self.invoke(self.arguments("--owned-test-recording"))
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(stderr)["errorCode"], "output_inside_git_repository")
        self.assertFalse(self.output.exists())

    def test_existing_results_are_never_overwritten(self):
        self.output.mkdir()
        previous = self.output / "trial.json"
        previous.write_text("previous result", encoding="utf-8")
        status, _, stderr = self.invoke(self.arguments("--owned-test-recording"))
        self.assertEqual(status, 1)
        self.assertEqual(json.loads(stderr)["errorCode"], "output_already_exists")
        self.assertEqual(previous.read_text(encoding="utf-8"), "previous result")

    def test_result_stays_private_and_original_is_preserved(self):
        text = "LOCAL_ONLY_TRANSCRIPT_SENTINEL"
        original = self.audio.read_bytes()
        engine = mock.Mock(return_value=[Segment(0.0, 1.0, text)])
        with (
            mock.patch.object(stt_trial, "build_engine", return_value=engine),
            mock.patch("ccc_pipeline.transcribe.detect_silences", return_value=([], 1.0)),
        ):
            status, stdout, stderr = self.invoke(self.arguments("--owned-test-recording"))
        self.assertEqual(status, 0)
        self.assertEqual(stderr, "")
        self.assertNotIn(text, stdout)
        self.assertEqual(self.audio.read_bytes(), original)
        result = json.loads((self.output / "transcript.json").read_text(encoding="utf-8"))
        self.assertEqual(result["segments"][0]["text"], text)
        self.assertEqual(result["qualityEvaluation"], "deferred")
        self.assertEqual(sorted(p.name for p in self.output.iterdir()), ["transcript.json", "trial.json"])
        if os.name == "posix":
            self.assertEqual(self.output.stat().st_mode & 0o777, 0o700)
            self.assertEqual((self.output / "transcript.json").stat().st_mode & 0o777, 0o600)

    def test_provider_failure_does_not_expose_exception_or_leave_chunks(self):
        secret = "private-input-and-provider-secret"
        engine = mock.Mock(side_effect=RuntimeError(secret))
        with (
            mock.patch.object(stt_trial, "build_engine", return_value=engine),
            mock.patch("ccc_pipeline.transcribe.detect_silences", return_value=([], 1.0)),
        ):
            status, stdout, stderr = self.invoke(self.arguments("--owned-test-recording"))
        self.assertEqual(status, 1)
        self.assertNotIn(secret, stdout + stderr)
        metadata = (self.output / "trial.json").read_text(encoding="utf-8")
        self.assertNotIn(secret, metadata)
        self.assertEqual(json.loads(metadata)["status"], "failed")
        self.assertEqual(list(self.output.glob("chunks-*")), [])


if __name__ == "__main__":
    unittest.main()
