"""Dedicated Qwen process. Stdout is reserved for bounded ASCII JSON messages."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, BinaryIO

from .qwen_runtime import (
    MAX_PROTOCOL_LINE_BYTES,
    QwenRuntimeError,
    load_qwen,
    prepare_qwen_models,
    qwen_manifest_models,
    validate_qwen_device,
)


def _emit(stream: BinaryIO, payload: dict[str, Any]) -> None:
    line = json.dumps(payload, ensure_ascii=True, separators=(",", ":")).encode("ascii") + b"\n"
    if len(line) > MAX_PROTOCOL_LINE_BYTES:
        request_id = payload.get("id")
        line = json.dumps(
            {"id": request_id if type(request_id) is int else None, "error": "inference_failed"},
            separators=(",", ":"),
        ).encode("ascii") + b"\n"
    stream.write(line)
    stream.flush()


def _audio_path(value: object) -> Path:
    if not isinstance(value, str) or not value or "\0" in value or len(value) > 32_768:
        raise QwenRuntimeError("request_invalid")
    path = Path(value)
    if not path.is_absolute():
        raise QwenRuntimeError("audio_path_invalid")
    try:
        path = path.resolve(strict=True)
    except (OSError, RuntimeError, ValueError) as error:
        raise QwenRuntimeError("audio_path_invalid") from error
    if not path.is_file():
        raise QwenRuntimeError("audio_path_invalid")
    return path


def serve(infer, input_stream: BinaryIO, output_stream: BinaryIO) -> None:  # noqa: ANN001
    while True:
        line = input_stream.readline(MAX_PROTOCOL_LINE_BYTES + 1)
        if not line:
            return
        if len(line) > MAX_PROTOCOL_LINE_BYTES or not line.endswith(b"\n"):
            _emit(output_stream, {"id": None, "error": "request_invalid"})
            return
        request: object = None
        request_id: int | None = None
        try:
            request = json.loads(line.decode("ascii"))
            if request == {"type": "close"}:
                _emit(output_stream, {"type": "closed"})
                return
            if not isinstance(request, dict) or set(request) != {"id", "audioPath"}:
                raise QwenRuntimeError("request_invalid")
            request_id = request["id"]
            if type(request_id) is not int or request_id < 1:
                request_id = None
                raise QwenRuntimeError("request_invalid")
            segments = infer(str(_audio_path(request["audioPath"])))
            _emit(output_stream, {
                "id": request_id,
                "segments": [
                    {"start": segment.start, "end": segment.end, "text": segment.text}
                    for segment in segments
                ],
            })
        except (UnicodeDecodeError, json.JSONDecodeError):
            _emit(output_stream, {"id": None, "error": "request_invalid"})
        except QwenRuntimeError as error:
            code = error.code if error.code in {
                "audio_path_invalid", "inference_failed", "request_invalid", "sdk_output_invalid",
            } else "inference_failed"
            _emit(output_stream, {"id": request_id, "error": code})
        except Exception:
            _emit(output_stream, {"id": request_id, "error": "inference_failed"})


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--device", required=True, choices=("cpu", "cuda", "mps"))
    return parser


def main(argv: list[str] | None = None) -> int:
    protocol = os.fdopen(os.dup(sys.stdout.fileno()), "wb", buffering=0)
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    try:
        args = _parser().parse_args(argv)
        validate_qwen_device(args.device)
        snapshots = prepare_qwen_models(qwen_manifest_models())
        infer = load_qwen(snapshots, args.device, max(1, os.cpu_count() or 1))
        _emit(protocol, {"type": "ready"})
        serve(infer, sys.stdin.buffer, protocol)
        return 0
    except QwenRuntimeError as error:
        _emit(protocol, {"type": "startup_error", "code": error.code})
        return 2
    except Exception:
        _emit(protocol, {"type": "startup_error", "code": "model_load_failed"})
        return 2
    finally:
        protocol.close()


if __name__ == "__main__":
    raise SystemExit(main())
