#!/usr/bin/env python3
"""Pinned JSON-lines inference workers for the synthetic S13 benchmark."""

from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib.metadata
import json
import logging
import os
import re
import sys
import tempfile
import time
import wave
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TextIO

PIPELINE_ROOT = Path(__file__).resolve().parents[2] / "apps" / "pipeline"
if str(PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(PIPELINE_ROOT))

from ccc_pipeline.speaker_mapping import Segment  # noqa: E402
from ccc_pipeline.transcribe import transcribe_audio  # noqa: E402

ENGINE_NAMES = ("faster-whisper", "qwen3-asr", "diarization")
SESSION_ID = re.compile(r"^case-(\d{3})-session-(\d{2})$")
MODEL_MANIFEST = Path(__file__).with_name("benchmark-models.json")
MODEL_FILE_PATTERNS = {
    "Systran/faster-whisper-medium": ["config.json", "tokenizer.json", "vocabulary.txt"],
    "Qwen/Qwen3-ASR-1.7B": ["*.json", "merges.txt", "vocab.json"],
    "Qwen/Qwen3-ForcedAligner-0.6B": ["*.json", "merges.txt", "vocab.json"],
}

os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("TRANSFORMERS_VERBOSITY", "error")
for logger_name in ("huggingface_hub", "transformers", "pyannote", "lightning"):
    logging.getLogger(logger_name).setLevel(logging.ERROR)


class StartupError(RuntimeError):
    """Sanitized startup failure safe to expose as a stable code."""


class RequestError(ValueError):
    """Sanitized per-request protocol failure."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class LoadedWorker:
    engine: str
    response_key: str
    infer: Callable[[Path, Path], Any]
    metadata: dict[str, Any]


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _snapshot_download(**kwargs: Any) -> str:
    from huggingface_hub import snapshot_download

    return snapshot_download(**kwargs)


def _valid_model(model: object) -> bool:
    if not isinstance(model, dict):
        return False
    revision = model.get("revision")
    files = model.get("files")
    if not isinstance(model.get("name"), str) or not re.fullmatch(r"[0-9a-f]{40}", revision or ""):
        return False
    if not isinstance(files, list) or not files:
        return False
    for file in files:
        if not isinstance(file, dict) or not isinstance(file.get("name"), str):
            return False
        sha256 = file.get("sha256")
        if not re.fullmatch(r"[0-9a-f]{64}", sha256 or ""):
            return False
        if Path(file["name"]).is_absolute() or ".." in Path(file["name"]).parts:
            return False
    return True


def read_engine_manifest(path: Path, engine: str) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        spec = payload["engines"][engine]
    except (OSError, json.JSONDecodeError, KeyError, TypeError) as error:
        raise StartupError("model_manifest_invalid") from error
    if payload.get("schemaVersion") != 1 or not isinstance(spec, dict):
        raise StartupError("model_manifest_invalid")
    if not isinstance(spec.get("backend"), str) or not spec["backend"]:
        raise StartupError("model_manifest_invalid")
    packages = spec.get("packages")
    models = spec.get("models")
    if not isinstance(packages, list) or not packages or any(not isinstance(item, str) or not item for item in packages):
        raise StartupError("model_manifest_invalid")
    if not isinstance(models, list) or not models or any(not _valid_model(model) for model in models):
        raise StartupError("model_manifest_invalid")
    return spec


def prepare_models(models: list[dict[str, Any]]) -> dict[str, Path]:
    snapshots: dict[str, Path] = {}
    for model in models:
        patterns = [file["name"] for file in model["files"]]
        patterns.extend(MODEL_FILE_PATTERNS.get(model["name"], []))
        try:
            snapshot = Path(
                _snapshot_download(
                    repo_id=model["name"],
                    revision=model["revision"],
                    allow_patterns=patterns,
                )
            ).resolve()
        except Exception as error:
            raise StartupError("model_download_failed") from error
        for file in model["files"]:
            candidate = snapshot / file["name"]
            try:
                digest = _sha256(candidate)
            except OSError as error:
                raise StartupError("model_file_missing") from error
            if digest != file["sha256"]:
                raise StartupError("model_hash_mismatch")
        snapshots[model["name"]] = snapshot
    return snapshots


def _import_torch() -> Any:
    import torch

    return torch


def validate_device(engine: str, device: str, torch: Any | None = None) -> None:
    if engine == "faster-whisper" and device != "cpu":
        raise StartupError("device_unsupported")
    if device == "cpu":
        return
    torch = torch or _import_torch()
    if device == "cuda" and not torch.cuda.is_available():
        raise StartupError("device_unavailable")
    if device == "mps" and not torch.backends.mps.is_available():
        raise StartupError("device_unavailable")


def _package_versions(names: Iterable[str]) -> dict[str, str]:
    versions: dict[str, str] = {}
    for name in names:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError as error:
            raise StartupError("package_missing") from error
    return versions


def _metadata(engine: str, spec: dict[str, Any], device: str, threads: int) -> dict[str, Any]:
    return {
        "engine": engine,
        "models": [
            {
                "name": model["name"],
                "revision": model["revision"],
                "files": [dict(file) for file in model["files"]],
            }
            for model in spec["models"]
        ],
        "packages": _package_versions(spec["packages"]),
        "backend": spec["backend"],
        "device": device,
        "threads": threads,
    }


def _load_faster_whisper(snapshot: Path, threads: int) -> Callable[[str], list[Segment]]:
    from faster_whisper import WhisperModel

    model = WhisperModel(
        str(snapshot),
        device="cpu",
        compute_type="int8",
        cpu_threads=threads,
        local_files_only=True,
    )

    def infer(audio_path: str) -> list[Segment]:
        segments, _ = model.transcribe(audio_path, language="ko", vad_filter=False)
        return [Segment(float(item.start), float(item.end), str(item.text)) for item in segments]

    return infer


def qwen_segments(results: object) -> list[Segment]:
    if not isinstance(results, list) or len(results) != 1:
        raise RequestError("sdk_output_invalid")
    result = results[0]
    text = getattr(result, "text", None)
    timestamps = getattr(result, "time_stamps", None)
    if text == "" and timestamps is None:
        return []
    if not isinstance(text, str) or timestamps is None:
        raise RequestError("sdk_output_invalid")
    aligned: list[tuple[int, int, float, float]] = []
    cursor = 0
    exact_text_mapping = True
    try:
        for item in timestamps:
            item_text = item.text
            start = float(item.start_time)
            end = float(item.end_time)
            if not isinstance(item_text, str) or not item_text or start < 0.0 or end < start:
                raise ValueError
            position = text.find(item_text, cursor)
            if position < 0:
                exact_text_mapping = False
            else:
                cursor = position + len(item_text)
            aligned.append((position, cursor, start, end))
    except (AttributeError, TypeError, ValueError) as error:
        raise RequestError("sdk_output_invalid") from error
    if not aligned:
        if text:
            raise RequestError("sdk_output_invalid")
        return []
    if not exact_text_mapping:
        return [Segment(aligned[0][2], aligned[-1][3], text)]
    return [
        Segment(start, end, text[0 if index == 0 else position : aligned[index + 1][0] if index + 1 < len(aligned) else len(text)])
        for index, (position, _, start, end) in enumerate(aligned)
    ]


def _load_qwen(snapshots: dict[str, Path], device: str, threads: int) -> Callable[[str], list[Segment]]:
    torch = _import_torch()
    torch.set_num_threads(threads)
    from qwen_asr import Qwen3ASRModel

    dtype = torch.float32 if device in ("cpu", "mps") else torch.bfloat16
    device_map = "cuda:0" if device == "cuda" else device
    model = Qwen3ASRModel.from_pretrained(
        str(snapshots["Qwen/Qwen3-ASR-1.7B"]),
        dtype=dtype,
        device_map=device_map,
        forced_aligner=str(snapshots["Qwen/Qwen3-ForcedAligner-0.6B"]),
        forced_aligner_kwargs={"dtype": dtype, "device_map": device_map},
        max_inference_batch_size=1,
        max_new_tokens=4096,
        local_files_only=True,
    )

    def infer(audio_path: str) -> list[Segment]:
        results = model.transcribe(
            audio=audio_path,
            context="",
            language="Korean",
            return_time_stamps=True,
        )
        return qwen_segments(results)

    return infer


def _local_diarization_config(snapshots: dict[str, Path], output: Path) -> Path:
    pipeline_snapshot = snapshots["pyannote/speaker-diarization-3.1"]
    source = pipeline_snapshot / "config.yaml"
    try:
        config = source.read_text(encoding="utf-8")
    except OSError as error:
        raise StartupError("model_file_missing") from error
    expected = {
        "pyannote/segmentation-3.0": snapshots["pyannote/segmentation-3.0"] / "pytorch_model.bin",
        "pyannote/wespeaker-voxceleb-resnet34-LM": snapshots["pyannote/wespeaker-voxceleb-resnet34-LM"] / "pytorch_model.bin",
    }
    for remote, local in expected.items():
        marker = f"{remote}\n"
        if marker not in config:
            raise StartupError("diarization_config_invalid")
        config = config.replace(marker, f"{local}\n", 1)
    output.write_text(config, encoding="utf-8")
    return output


def _load_diarization(snapshots: dict[str, Path], device: str, threads: int) -> Callable[[Path, Path], Any]:
    torch = _import_torch()
    torch.set_num_threads(threads)
    from pyannote.audio import Pipeline
    from pyannote.audio.core.task import Problem, Resolution, Specifications

    with tempfile.TemporaryDirectory(prefix="ccc-diarization-") as root:
        config_path = _local_diarization_config(snapshots, Path(root) / "config.yaml")
        # Only the four types present in the checksum-verified checkpoints are allowed.
        with torch.serialization.safe_globals([Problem, Resolution, Specifications, torch.torch_version.TorchVersion]):
            pipeline = Pipeline.from_pretrained(str(config_path), use_auth_token=None)
    if pipeline is None:
        raise StartupError("model_load_failed")
    pipeline.to(torch.device(device))

    def infer(audio_path: Path, _work_dir: Path) -> list[dict[str, Any]]:
        annotation = pipeline(str(audio_path), max_speakers=2)
        return [
            {"start": float(turn.start), "end": float(turn.end), "speaker": str(speaker)}
            for turn, _, speaker in annotation.itertracks(yield_label=True)
        ]

    return infer


def load_engine(engine: str, device: str, threads: int, spec: dict[str, Any]) -> LoadedWorker:
    if threads < 1:
        raise StartupError("threads_invalid")
    try:
        validate_device(engine, device)
    except StartupError:
        raise
    except Exception as error:
        raise StartupError("package_missing") from error
    snapshots = prepare_models(spec["models"])
    try:
        metadata = _metadata(engine, spec, device, threads)
        if engine == "faster-whisper":
            model_engine = _load_faster_whisper(snapshots["Systran/faster-whisper-medium"], threads)
        elif engine == "qwen3-asr":
            model_engine = _load_qwen(snapshots, device, threads)
        elif engine == "diarization":
            return LoadedWorker(engine, "turns", _load_diarization(snapshots, device, threads), metadata)
        else:
            raise StartupError("engine_invalid")
    except StartupError:
        raise
    except Exception as error:
        raise StartupError("model_load_failed") from error

    def infer(audio_path: Path, work_dir: Path) -> str:
        chunk_texts: list[str] = []
        transcribe_audio(str(audio_path), work_dir, model_engine, on_chunk=lambda segments: chunk_texts.append("".join(segment.text for segment in segments)))
        return " ".join(chunk_texts)

    return LoadedWorker(engine, "text", infer, metadata)


def _write_silence(path: Path) -> None:
    with wave.open(str(path), "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\0\0" * 16000)


def warm_up(worker: LoadedWorker) -> None:
    with tempfile.TemporaryDirectory(prefix="ccc-stt-warmup-") as root:
        root_path = Path(root)
        silence = root_path / "synthetic-silence.wav"
        _write_silence(silence)
        try:
            worker.infer(silence, root_path)
        except Exception as error:
            raise StartupError("warmup_failed") from error


def _safe_session_id(row: object) -> str | None:
    if not isinstance(row, dict) or not isinstance(row.get("sessionId"), str):
        return None
    value = row["sessionId"]
    match = SESSION_ID.fullmatch(value)
    if match is None or not (1 <= int(match.group(1)) <= 30 and 1 <= int(match.group(2)) <= 5):
        return None
    return value


def validate_request(row: object, audio_dir: Path) -> tuple[str, Path]:
    session_id = _safe_session_id(row)
    if session_id is None or not isinstance(row, dict) or set(row) != {"sessionId", "audioPath"}:
        raise RequestError("invalid_request")
    if not isinstance(row["audioPath"], str):
        raise RequestError("invalid_request")
    try:
        audio_path = (audio_dir / row["audioPath"]).resolve(strict=True)
    except (OSError, RuntimeError):
        raise RequestError("audio_path_invalid") from None
    if not audio_path.is_file() or not audio_path.is_relative_to(audio_dir):
        raise RequestError("audio_path_invalid")
    return session_id, audio_path


def _emit(stream: TextIO, payload: dict[str, Any]) -> None:
    stream.write(json.dumps(payload, separators=(",", ":")) + "\n")
    stream.flush()


def serve(worker: LoadedWorker, audio_dir: Path, input_stream: TextIO, output_stream: TextIO) -> None:
    audio_dir = audio_dir.resolve(strict=True)
    for line in input_stream:
        if not line.strip():
            continue
        row: object = None
        session_id: str | None = None
        try:
            row = json.loads(line)
            session_id, audio_path = validate_request(row, audio_dir)
            with tempfile.TemporaryDirectory(prefix="ccc-stt-request-") as root:
                started = time.perf_counter()
                value = worker.infer(audio_path, Path(root))
                elapsed = time.perf_counter() - started
            response = {
                "sessionId": session_id,
                worker.response_key: value,
                "engineWallSeconds": elapsed,
                "metadata": worker.metadata,
            }
        except json.JSONDecodeError:
            response = {"sessionId": None, "errorCode": "invalid_json"}
        except RequestError as error:
            response = {"sessionId": _safe_session_id(row), "errorCode": error.code}
        except Exception:
            response = {"sessionId": session_id, "errorCode": "inference_failed"}
        _emit(output_stream, response)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True, choices=ENGINE_NAMES)
    parser.add_argument("--audio-dir", required=True, type=Path)
    parser.add_argument("--device", choices=("cpu", "mps", "cuda"), default="cpu")
    parser.add_argument("--threads", type=int, default=1)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    protocol_output = sys.stdout
    try:
        with contextlib.redirect_stdout(sys.stderr):
            audio_dir = args.audio_dir.resolve(strict=True)
            if not audio_dir.is_dir():
                raise StartupError("audio_dir_invalid")
            spec = read_engine_manifest(MODEL_MANIFEST, args.engine)
            worker = load_engine(args.engine, args.device, args.threads, spec)
            warm_up(worker)
            serve(worker, audio_dir, sys.stdin, protocol_output)
    except (StartupError, OSError) as error:
        code = str(error) if isinstance(error, StartupError) else "audio_dir_invalid"
        sys.stderr.write(json.dumps({"errorCode": code}, separators=(",", ":")) + "\n")
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
