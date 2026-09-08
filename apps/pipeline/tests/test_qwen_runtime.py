from __future__ import annotations

import hashlib
import io
import json
import os
import tempfile
import subprocess
import sys
import venv
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from ccc_pipeline.qwen_child import serve as serve_child

from ccc_pipeline.qwen_runtime import (
    QwenEngine,
    QwenRuntimeError,
    prepare_qwen_models,
    qwen_segments,
    validate_qwen_device,
)


class _Input(io.BytesIO):
    def close(self) -> None:
        self.was_closed = True


class _Process:
    def __init__(self, lines: list[dict | bytes]) -> None:
        encoded = [
            line if isinstance(line, bytes) else json.dumps(line, ensure_ascii=True).encode("ascii") + b"\n"
            for line in lines
        ]
        self.stdin = _Input()
        self.stdout = io.BytesIO(b"".join(encoded))
        self.returncode = None
        self.terminated = False
        self.killed = False

    def poll(self):  # noqa: ANN201
        return self.returncode

    def wait(self, timeout=None):  # noqa: ANN001, ANN201
        self.returncode = 0
        return 0

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = -1

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9


class QwenTimestampTest(unittest.TestCase):
    def test_sdk_timestamps_preserve_all_transcript_text(self) -> None:
        result = SimpleNamespace(
            text="안녕 하세요",
            time_stamps=[
                SimpleNamespace(text="안녕", start_time=0.1, end_time=0.4),
                SimpleNamespace(text="하세요", start_time=0.4, end_time=0.8),
            ],
        )

        segments = qwen_segments([result])

        self.assertEqual([(item.start, item.end, item.text) for item in segments], [
            (0.1, 0.4, "안녕 "),
            (0.4, 0.8, "하세요"),
        ])
        self.assertEqual("".join(item.text for item in segments), result.text)

    def test_missing_alignment_is_rejected_for_nonempty_text(self) -> None:
        self.assertEqual(qwen_segments([SimpleNamespace(text="", time_stamps=None)]), [])
        with self.assertRaisesRegex(QwenRuntimeError, "sdk_output_invalid"):
            qwen_segments([SimpleNamespace(text="말한 내용", time_stamps=None)])


class QwenModelBoundaryTest(unittest.TestCase):
    def test_unavailable_device_never_falls_back(self) -> None:
        torch = SimpleNamespace(
            cuda=SimpleNamespace(is_available=lambda: False),
            backends=SimpleNamespace(mps=SimpleNamespace(is_available=lambda: False)),
        )
        with self.assertRaisesRegex(QwenRuntimeError, "device_unavailable"):
            validate_qwen_device("cuda", torch)

    def test_wrong_weight_hash_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            snapshot = Path(root)
            weight = snapshot / "model.safetensors"
            weight.write_bytes(b"wrong")
            models = [
                {
                    "name": "Qwen/Qwen3-ASR-1.7B",
                    "revision": "7278e1e70fe206f11671096ffdd38061171dd6e5",
                    "files": [
                        {"name": "model-00001-of-00002.safetensors", "sha256": "0" * 64},
                        {
                            "name": "model-00002-of-00002.safetensors",
                            "sha256": hashlib.sha256(b"second").hexdigest(),
                        },
                    ],
                },
                {
                    "name": "Qwen/Qwen3-ForcedAligner-0.6B",
                    "revision": "c7cbfc2048c462b0d63a45797104fc9db3ad62b7",
                    "files": [{"name": "model.safetensors", "sha256": hashlib.sha256(weight.read_bytes()).hexdigest()}],
                },
            ]
            (snapshot / "model-00001-of-00002.safetensors").write_bytes(b"tampered")
            (snapshot / "model-00002-of-00002.safetensors").write_bytes(b"second")
            with self.assertRaisesRegex(QwenRuntimeError, "model_hash_mismatch"):
                prepare_qwen_models(models, snapshot_download=lambda **_kwargs: str(snapshot))

    def test_invalid_child_request_never_reaches_inference(self) -> None:
        infer = mock.Mock()
        output = io.BytesIO()

        serve_child(infer, io.BytesIO(b"not json\n"), output)

        self.assertEqual(json.loads(output.getvalue()), {"id": None, "error": "request_invalid"})
        infer.assert_not_called()

    def test_child_sanitizes_inference_exceptions(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            audio = Path(root) / "audio.wav"
            audio.write_bytes(b"audio")
            request = json.dumps({"id": 1, "audioPath": str(audio)}).encode("ascii") + b"\n"
            output = io.BytesIO()

            def fail(_path: str) -> None:
                raise RuntimeError("provider secret traceback")

            serve_child(fail, io.BytesIO(request), output)

        self.assertEqual(json.loads(output.getvalue()), {"id": 1, "error": "inference_failed"})
        self.assertNotIn(b"provider secret", output.getvalue())


class QwenEnvironmentTest(unittest.TestCase):
    def test_configured_virtualenv_is_the_environment_that_executes(self) -> None:
        from ccc_pipeline.qwen_runtime import _child_environment, _validated_python

        with tempfile.TemporaryDirectory() as tmp:
            environment = Path(tmp) / "qwen-env"
            venv.EnvBuilder(with_pip=False, symlinks=os.name != "nt").create(environment)
            python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            result = subprocess.run(
                [str(_validated_python(python)), "-c", "import sys; print(sys.prefix)"],
                env=_child_environment(), capture_output=True, text=True, timeout=15, check=True,
            )
            self.assertEqual(Path(result.stdout.strip()).resolve(), environment.resolve())

    def test_isolated_child_can_use_custom_cache_without_receiving_api_credentials(self) -> None:
        from ccc_pipeline.qwen_runtime import _child_environment

        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "snapshot").write_bytes(b"public-model-cache-fixture")
            with mock.patch.dict(os.environ, {
                "HF_HUB_CACHE": tmp, "AZURE_SPEECH_KEY": "test-secret-never-forward",
            }):
                environment = _child_environment()
            result = subprocess.run(
                [sys.executable, "-c",
                 "import os,pathlib; "
                 "print((pathlib.Path(os.environ.get('HF_HUB_CACHE','/missing-cache'))/'snapshot').is_file()); "
                 "print('AZURE_SPEECH_KEY' in os.environ)"],
                env=environment, capture_output=True, text=True, timeout=15, check=True,
            )
            self.assertEqual(result.stdout.splitlines(), ["True", "False"])


class QwenIpcTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.python = Path(self.temp.name) / "python"
        self.python.write_bytes(b"executable")
        self.python.chmod(0o700)
        self.audio = Path(self.temp.name) / "audio.wav"
        self.audio.write_bytes(b"audio")

    def engine(self, process: _Process):
        patcher = mock.patch("ccc_pipeline.qwen_runtime.subprocess.Popen", return_value=process)
        popen = patcher.start()
        self.addCleanup(patcher.stop)
        return QwenEngine(self.python, "cpu"), popen


    def test_missing_interpreter_fails_without_starting_a_child(self) -> None:
        with self.assertRaisesRegex(QwenRuntimeError, "qwen_python_invalid"):
            QwenEngine(Path(self.temp.name) / "missing-python", "cpu")

    def test_child_is_lazy_persistent_and_closes_explicitly(self) -> None:
        process = _Process([
            {"type": "ready"},
            {"id": 1, "segments": [{"start": 0.1, "end": 0.8, "text": "합성 음성"}]},
            {"id": 2, "segments": []},
            {"type": "closed"},
        ])
        engine, popen = self.engine(process)
        popen.assert_not_called()

        with mock.patch.dict(os.environ, {
            "AZURE_SPEECH_KEY": "must-not-reach-child",
            "CCC_API_TOKEN": "must-not-reach-child",
        }):
            self.assertEqual(engine(str(self.audio))[0].text, "합성 음성")
            self.assertEqual(engine(str(self.audio)), [])
        engine.close()
        engine.close()

        popen.assert_called_once()
        command = popen.call_args.args[0]
        self.assertIsInstance(command, list)
        self.assertFalse(popen.call_args.kwargs.get("shell", False))
        child_env = popen.call_args.kwargs["env"]
        self.assertNotIn("AZURE_SPEECH_KEY", child_env)
        self.assertNotIn("CCC_API_TOKEN", child_env)
        self.assertTrue(Path(child_env["PYTHONPATH"]).is_absolute())
        self.assertEqual(child_env["HF_HUB_OFFLINE"], "1")
        requests = [json.loads(line) for line in process.stdin.getvalue().decode("ascii").splitlines()]
        self.assertEqual([row.get("id") for row in requests[:2]], [1, 2])
        self.assertEqual(requests[-1], {"type": "close"})
        self.assertTrue(process.stdin.was_closed)

    def test_dependency_failure_is_reported_before_audio_request(self) -> None:
        process = _Process([{"type": "startup_error", "code": "dependency_missing"}])
        engine, _ = self.engine(process)

        with self.assertRaisesRegex(QwenRuntimeError, "dependency_missing"):
            engine(str(self.audio))

        self.assertEqual(process.stdin.getvalue(), b"")
        self.assertTrue(process.terminated)

    def test_malformed_child_response_is_sanitized_and_process_is_stopped(self) -> None:
        process = _Process([{"type": "ready"}, b"provider secret traceback\n"])
        engine, _ = self.engine(process)

        with self.assertRaisesRegex(QwenRuntimeError, "qwen_protocol_invalid") as caught:
            engine(str(self.audio))

        self.assertNotIn("provider secret", str(caught.exception))
        self.assertTrue(process.terminated)

    def test_child_error_code_does_not_expose_provider_output(self) -> None:
        process = _Process([{"type": "ready"}, {"id": 1, "error": "inference_failed"}])
        engine, _ = self.engine(process)

        with self.assertRaisesRegex(QwenRuntimeError, "inference_failed"):
            engine(str(self.audio))
        self.assertTrue(process.terminated)


if __name__ == "__main__":
    unittest.main()
