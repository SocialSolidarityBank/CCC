"""Verified Qwen loader and persistent ASCII JSON subprocess client."""

from __future__ import annotations

import hashlib
import json
import math
import os
import queue
import re
import subprocess
import threading
from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from .model_registry import ModelSpec, role_spec
from .speaker_mapping import Segment

QWEN_ASR_NAME = "Qwen/Qwen3-ASR-1.7B"
QWEN_ALIGNER_NAME = "Qwen/Qwen3-ForcedAligner-0.6B"
QWEN_MODEL_NAMES = frozenset((QWEN_ASR_NAME, QWEN_ALIGNER_NAME))
QWEN_REQUIRED_FILES = {
    QWEN_ASR_NAME: frozenset((
        "model-00001-of-00002.safetensors",
        "model-00002-of-00002.safetensors",
        "model.safetensors.index.json",
    )),
    QWEN_ALIGNER_NAME: frozenset(("model.safetensors",)),
}
QWEN_CHECKPOINT_PATTERNS = ("model*.safetensors", "pytorch_model*.bin", "*.index.json")
QWEN_FILE_PATTERNS = ("*.json", "merges.txt", "vocab.json")
STARTUP_TIMEOUT_SECONDS = 600.0
INFERENCE_TIMEOUT_SECONDS = 600.0
CLOSE_TIMEOUT_SECONDS = 5.0
MAX_PROTOCOL_LINE_BYTES = 8 * 1024 * 1024
_PIPELINE_ROOT = Path(__file__).resolve().parents[1]
_REVISION = re.compile(r"^[0-9a-f]{40}$")
_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_ALLOWED_CHILD_ENV = (
    "PATH",
    "HOME",
    "USERPROFILE",
    "SYSTEMROOT",
    "WINDIR",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LOCALAPPDATA",
    "APPDATA",
    "HF_HOME",
    "HF_HUB_CACHE",
    "HUGGINGFACE_HUB_CACHE",
    "TRANSFORMERS_CACHE",
    "TORCH_HOME",
    "XDG_CACHE_HOME",
    "CUDA_VISIBLE_DEVICES",
    "CUDA_PATH",
    "CUDA_HOME",
    "ROCM_HOME",
    "LD_LIBRARY_PATH",
    "DYLD_LIBRARY_PATH",
    "OMP_NUM_THREADS",
    "MKL_NUM_THREADS",
    "LANG",
    "LC_ALL",
)
_STARTUP_CODES = frozenset((
    "dependency_missing",
    "device_unavailable",
    "device_unsupported",
    "model_file_missing",
    "model_hash_mismatch",
    "model_load_failed",
    "model_manifest_invalid",
    "model_index_invalid",
    "model_snapshot_ambiguous",
    "model_snapshot_missing",
))
_INFERENCE_CODES = frozenset((
    "audio_path_invalid",
    "inference_failed",
    "request_invalid",
    "sdk_output_invalid",
))


class QwenRuntimeError(RuntimeError):
    """A stable error code safe to expose outside the isolated runtime."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def qwen_manifest_models() -> list[dict[str, Any]]:
    """Return the two immutable Qwen roles in the benchmark loader's row shape."""
    specs = (role_spec("qwen-asr"), role_spec("qwen-aligner"))
    if any(not spec.files for spec in specs):
        raise QwenRuntimeError("model_manifest_invalid")
    return [_model_row(spec) for spec in specs]


def _model_row(spec: ModelSpec) -> dict[str, Any]:
    return {
        "name": spec.name,
        "revision": spec.revision,
        "files": [{"name": file.name, "sha256": file.sha256} for file in spec.files],
    }


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _snapshot_download(**kwargs: Any) -> str:
    try:
        from huggingface_hub import snapshot_download
    except ImportError as error:
        raise QwenRuntimeError("dependency_missing") from error
    return snapshot_download(**kwargs)


def prepare_qwen_models(
    models: Iterable[dict[str, Any]],
    *,
    snapshot_download: Callable[..., str] | None = None,
    local_files_only: bool = True,
) -> dict[str, Path]:
    """Resolve fixed revisions and verify every declared weight file."""
    rows = list(models)
    if (
        len(rows) != 2
        or any(not isinstance(row, dict) for row in rows)
        or {row.get("name") for row in rows} != QWEN_MODEL_NAMES
    ):
        raise QwenRuntimeError("model_manifest_invalid")
    download = snapshot_download or _snapshot_download
    snapshots: dict[str, Path] = {}
    for row in rows:
        revision = row.get("revision")
        files = row.get("files")
        if not isinstance(revision, str) or _REVISION.fullmatch(revision) is None:
            raise QwenRuntimeError("model_manifest_invalid")
        if not isinstance(files, list) or not files:
            raise QwenRuntimeError("model_manifest_invalid")
        patterns: list[str] = []
        for file in files:
            if not isinstance(file, dict):
                raise QwenRuntimeError("model_manifest_invalid")
            name, expected = file.get("name"), file.get("sha256")
            if not isinstance(name, str) or not isinstance(expected, str):
                raise QwenRuntimeError("model_manifest_invalid")
            relative = Path(name)
            if (
                not name
                or "\0" in name
                or relative.is_absolute()
                or ".." in relative.parts
                or _SHA256.fullmatch(expected) is None
            ):
                raise QwenRuntimeError("model_manifest_invalid")
            patterns.append(name)
        expected_files = QWEN_REQUIRED_FILES[row["name"]]
        if len(patterns) != len(expected_files) or frozenset(patterns) != expected_files:
            raise QwenRuntimeError("model_manifest_invalid")
        try:
            snapshot = Path(download(
                repo_id=row["name"],
                revision=revision,
                allow_patterns=[*patterns, *QWEN_FILE_PATTERNS],
                local_files_only=local_files_only,
            )).resolve(strict=True)
        except QwenRuntimeError:
            raise
        except Exception as error:
            raise QwenRuntimeError("model_snapshot_missing") from error
        if not snapshot.is_dir():
            raise QwenRuntimeError("model_snapshot_missing")
        for file in files:
            try:
                candidate = snapshot / file["name"]
                if not candidate.is_file():
                    raise OSError
                digest = _sha256(candidate)
            except OSError as error:
                raise QwenRuntimeError("model_file_missing") from error
            if digest != file["sha256"]:
                raise QwenRuntimeError("model_hash_mismatch")
        checkpoint_files = {
            str(candidate.relative_to(snapshot))
            for pattern in QWEN_CHECKPOINT_PATTERNS
            for candidate in snapshot.glob(pattern)
            if candidate.is_file()
        }
        if checkpoint_files != expected_files:
            raise QwenRuntimeError("model_snapshot_ambiguous")
        if row["name"] == QWEN_ASR_NAME:
            try:
                index = json.loads((snapshot / "model.safetensors.index.json").read_text(encoding="utf-8"))
                weight_map = index["weight_map"]
            except (OSError, UnicodeError, ValueError, KeyError, TypeError) as error:
                raise QwenRuntimeError("model_index_invalid") from error
            if (
                not isinstance(index, dict)
                or set(index) != {"metadata", "weight_map"}
                or not isinstance(index["metadata"], dict)
                or not isinstance(weight_map, dict)
                or not weight_map
                or any(not isinstance(name, str) or not isinstance(file, str) for name, file in weight_map.items())
                or frozenset(weight_map.values()) != expected_files - {"model.safetensors.index.json"}
            ):
                raise QwenRuntimeError("model_index_invalid")
        snapshots[row["name"]] = snapshot
    return snapshots


def _import_torch() -> Any:
    try:
        import torch
    except ImportError as error:
        raise QwenRuntimeError("dependency_missing") from error
    return torch


def validate_qwen_device(device: str, torch: Any | None = None) -> None:
    if device not in ("cpu", "cuda", "mps"):
        raise QwenRuntimeError("device_unsupported")
    if device == "cpu":
        return
    runtime = torch or _import_torch()
    if device == "cuda" and not runtime.cuda.is_available():
        raise QwenRuntimeError("device_unavailable")
    if device == "mps" and not runtime.backends.mps.is_available():
        raise QwenRuntimeError("device_unavailable")


def qwen_segments(results: object) -> list[Segment]:
    """Convert the official SDK's forced-alignment output without dropping spacing."""
    if not isinstance(results, list) or len(results) != 1:
        raise QwenRuntimeError("sdk_output_invalid")
    result = results[0]
    text = getattr(result, "text", None)
    timestamps = getattr(result, "time_stamps", None)
    if text == "" and timestamps is None:
        return []
    if not isinstance(text, str) or timestamps is None:
        raise QwenRuntimeError("sdk_output_invalid")
    aligned: list[tuple[int, float, float]] = []
    cursor = 0
    exact_text_mapping = True
    try:
        for item in timestamps:
            item_text = item.text
            start = float(item.start_time)
            end = float(item.end_time)
            if (
                not isinstance(item_text, str)
                or not item_text
                or not math.isfinite(start)
                or not math.isfinite(end)
                or start < 0.0
                or end < start
            ):
                raise ValueError
            position = text.find(item_text, cursor)
            if position < 0:
                exact_text_mapping = False
            else:
                cursor = position + len(item_text)
            aligned.append((position, start, end))
    except (AttributeError, TypeError, ValueError) as error:
        raise QwenRuntimeError("sdk_output_invalid") from error
    if not aligned:
        if text:
            raise QwenRuntimeError("sdk_output_invalid")
        return []
    if not exact_text_mapping:
        return [Segment(aligned[0][1], aligned[-1][2], text)]
    return [
        Segment(
            start,
            end,
            text[0 if index == 0 else position : aligned[index + 1][0] if index + 1 < len(aligned) else len(text)],
        )
        for index, (position, start, end) in enumerate(aligned)
    ]


def load_qwen(snapshots: dict[str, Path], device: str, threads: int = 1) -> Callable[[str], list[Segment]]:
    """Load the official ASR SDK and ForcedAligner from verified local snapshots."""
    if threads < 1:
        raise QwenRuntimeError("device_unsupported")
    torch = _import_torch()
    validate_qwen_device(device, torch)
    torch.set_num_threads(threads)
    try:
        from qwen_asr import Qwen3ASRModel
    except ImportError as error:
        raise QwenRuntimeError("dependency_missing") from error
    dtype = torch.float32 if device in ("cpu", "mps") else torch.bfloat16
    device_map = "cuda:0" if device == "cuda" else device
    try:
        model = Qwen3ASRModel.from_pretrained(
            str(snapshots[QWEN_ASR_NAME]),
            dtype=dtype,
            device_map=device_map,
            forced_aligner=str(snapshots[QWEN_ALIGNER_NAME]),
            forced_aligner_kwargs={"dtype": dtype, "device_map": device_map},
            max_inference_batch_size=1,
            max_new_tokens=4096,
            local_files_only=True,
        )
    except Exception as error:
        raise QwenRuntimeError("model_load_failed") from error

    def infer(audio_path: str) -> list[Segment]:
        try:
            results = model.transcribe(
                audio=audio_path,
                context="",
                language="Korean",
                return_time_stamps=True,
            )
            return qwen_segments(results)
        except QwenRuntimeError:
            raise
        except Exception as error:
            raise QwenRuntimeError("inference_failed") from error

    return infer


def _child_environment() -> dict[str, str]:
    env = {name: os.environ[name] for name in _ALLOWED_CHILD_ENV if name in os.environ}
    env.update({
        "PYTHONPATH": str(_PIPELINE_ROOT),
        "PYTHONNOUSERSITE": "1",
        "PYTHONUNBUFFERED": "1",
        "PYTHONUTF8": "1",
        "HF_HUB_OFFLINE": "1",
        "HF_HUB_DISABLE_PROGRESS_BARS": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "TRANSFORMERS_VERBOSITY": "error",
        "TOKENIZERS_PARALLELISM": "false",
    })
    return env


def _validated_python(path: str | Path) -> Path:
    try:
        candidate = Path(path)
        if not candidate.is_absolute():
            raise QwenRuntimeError("qwen_python_invalid")
        resolved = candidate.resolve(strict=True)
    except QwenRuntimeError:
        raise
    except (OSError, RuntimeError, TypeError, ValueError) as error:
        raise QwenRuntimeError("qwen_python_invalid") from error
    if not resolved.is_file() or (os.name != "nt" and not os.access(resolved, os.X_OK)):
        raise QwenRuntimeError("qwen_python_invalid")
    # Keep the venv entrypoint: launching its resolved base binary loses pyvenv.cfg.
    return candidate


class QwenEngine:
    """Callable that lazily starts one isolated child and reuses it until ``close``."""

    def __init__(self, python_executable: str | Path, device: str = "cpu") -> None:
        self._python = _validated_python(python_executable)
        if device not in ("cpu", "cuda", "mps"):
            raise QwenRuntimeError("device_unsupported")
        self._device = device
        self._process: subprocess.Popen[bytes] | None = None
        self._responses: queue.Queue[bytes | None] = queue.Queue(maxsize=4)
        self._reader: threading.Thread | None = None
        self._next_id = 1
        self._closed = False
        self._initialized = False
        self._lock = threading.Lock()

    def start(self) -> None:
        """Load and verify both fixed models without requiring or transcribing audio."""
        with self._lock:
            if self._closed:
                raise QwenRuntimeError("qwen_engine_closed")
            self._ensure_started()

    def is_ready(self) -> bool:
        """Return whether the successfully initialized child is still alive."""
        # The IPC lock is held throughout inference; liveness must not wait on it.
        process = self._process
        return not self._closed and self._initialized and process is not None and process.poll() is None

    def __call__(self, audio_path: str) -> list[Segment]:
        try:
            path = Path(audio_path).resolve(strict=True)
        except (OSError, RuntimeError, TypeError, ValueError) as error:
            raise QwenRuntimeError("audio_path_invalid") from error
        if not path.is_file():
            raise QwenRuntimeError("audio_path_invalid")
        with self._lock:
            if self._closed:
                raise QwenRuntimeError("qwen_engine_closed")
            self._ensure_started()
            request_id = self._next_id
            self._next_id += 1
            self._send({"id": request_id, "audioPath": str(path)})
            try:
                response = self._receive(INFERENCE_TIMEOUT_SECONDS)
            except QwenRuntimeError:
                self._abort()
                raise
            if type(response.get("id")) is not int or response["id"] != request_id:
                self._abort()
                raise QwenRuntimeError("qwen_protocol_invalid")
            if "error" in response:
                if set(response) != {"id", "error"}:
                    self._abort()
                    raise QwenRuntimeError("qwen_protocol_invalid")
                error_code = response["error"]
                self._abort()
                raise QwenRuntimeError(error_code if error_code in _INFERENCE_CODES else "qwen_inference_failed")
            try:
                if set(response) != {"id", "segments"}:
                    raise TypeError
                rows = response["segments"]
                if not isinstance(rows, list):
                    raise TypeError
                segments = []
                for row in rows:
                    if not isinstance(row, dict) or set(row) != {"start", "end", "text"}:
                        raise TypeError
                    raw_start, raw_end, text = row["start"], row["end"], row["text"]
                    if (
                        type(raw_start) not in (int, float)
                        or type(raw_end) not in (int, float)
                        or not isinstance(text, str)
                    ):
                        raise TypeError
                    start, end = float(raw_start), float(raw_end)
                    if not math.isfinite(start) or not math.isfinite(end) or start < 0.0 or end < start:
                        raise ValueError
                    segments.append(Segment(start, end, text))
                return segments
            except (KeyError, TypeError, ValueError):
                self._abort()
                raise QwenRuntimeError("qwen_protocol_invalid") from None

    def _ensure_started(self) -> None:
        if self._process is not None:
            return
        try:
            process = subprocess.Popen(
                [str(self._python), "-m", "ccc_pipeline.qwen_child", "--device", self._device],
                cwd=str(_PIPELINE_ROOT),
                env=_child_environment(),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                bufsize=0,
                shell=False,
            )
        except OSError as error:
            self._closed = True
            raise QwenRuntimeError("qwen_child_start_failed") from error
        if process.stdin is None or process.stdout is None:
            self._stop_process(process, terminate=True)
            self._closed = True
            raise QwenRuntimeError("qwen_child_start_failed")
        self._process = process
        self._reader = threading.Thread(target=self._read_responses, args=(process.stdout,), daemon=True)
        self._reader.start()
        try:
            response = self._receive(STARTUP_TIMEOUT_SECONDS)
        except QwenRuntimeError:
            self._abort()
            raise
        if response == {"type": "ready"}:
            self._initialized = True
            return
        code = response.get("code") if response.get("type") == "startup_error" else None
        self._abort()
        raise QwenRuntimeError(code if code in _STARTUP_CODES else "qwen_child_start_failed")

    def _read_responses(self, stream: Any) -> None:
        while True:
            try:
                line = stream.readline(MAX_PROTOCOL_LINE_BYTES + 1)
            except (OSError, ValueError):
                line = b""
            try:
                self._responses.put_nowait(line or None)
            except queue.Full:
                return
            if not line or len(line) > MAX_PROTOCOL_LINE_BYTES or not line.endswith(b"\n"):
                return

    def _send(self, payload: dict[str, Any]) -> None:
        process = self._process
        if process is None or process.stdin is None or process.poll() is not None:
            self._abort()
            raise QwenRuntimeError("qwen_child_exited")
        try:
            line = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("ascii") + b"\n"
            process.stdin.write(line)
            process.stdin.flush()
        except (BrokenPipeError, OSError, ValueError):
            self._abort()
            raise QwenRuntimeError("qwen_child_exited") from None

    def _receive(self, timeout: float) -> dict[str, Any]:
        try:
            line = self._responses.get(timeout=timeout)
        except queue.Empty:
            raise QwenRuntimeError("qwen_child_timeout") from None
        if line is None or len(line) > MAX_PROTOCOL_LINE_BYTES or not line.endswith(b"\n"):
            raise QwenRuntimeError("qwen_protocol_invalid")
        try:
            response = json.loads(line.decode("ascii"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise QwenRuntimeError("qwen_protocol_invalid") from None
        if not isinstance(response, dict):
            raise QwenRuntimeError("qwen_protocol_invalid")
        return response

    def close(self) -> None:
        """Idempotently request shutdown, then terminate/kill if the child does not exit."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            process = self._process
            if process is None:
                return
            try:
                self._send({"type": "close"})
                if self._receive(CLOSE_TIMEOUT_SECONDS) != {"type": "closed"}:
                    raise QwenRuntimeError("qwen_protocol_invalid")
            except QwenRuntimeError:
                pass
            self._stop_process(process)
            self._process = None
            self._join_reader()

    def _abort(self) -> None:
        self._closed = True
        process = self._process
        if process is not None:
            self._stop_process(process, terminate=True)
            self._process = None
            self._join_reader()

    def _join_reader(self) -> None:
        if self._reader is not None:
            self._reader.join(timeout=CLOSE_TIMEOUT_SECONDS)
            self._reader = None

    @staticmethod
    def _stop_process(process: subprocess.Popen[bytes], terminate: bool = False) -> None:
        try:
            if process.stdin is not None:
                process.stdin.close()
        except (OSError, ValueError):
            pass
        try:
            if terminate and process.poll() is None:
                process.terminate()
            process.wait(timeout=CLOSE_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            try:
                process.kill()
                process.wait(timeout=CLOSE_TIMEOUT_SECONDS)
            except (OSError, subprocess.TimeoutExpired):
                pass
        except OSError:
            try:
                process.kill()
            except OSError:
                pass
        try:
            if process.stdout is not None:
                process.stdout.close()
        except (OSError, ValueError):
            pass
