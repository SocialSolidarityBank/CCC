"""Run an explicitly declared, operator-owned STT trial without a business API.

This command never creates records or changes product consent/engine settings.
Transcripts stay in an owner-only output directory outside a Git worktree.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import tempfile
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from .transcribe import (
    ENGINE_AZURE,
    ENGINE_FASTER_WHISPER,
    ENGINE_QWEN,
    ENGINE_WHISPER,
    build_engine,
    transcribe_audio,
)


class TrialError(ValueError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


class _Parser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        # argparse's default includes unexpected argument values, which may be secrets.
        self.exit(2, "stt_trial: invalid_arguments (see --help)\n")


def _parser() -> argparse.ArgumentParser:
    parser = _Parser(description=__doc__)
    parser.add_argument("--audio", type=Path, required=True)
    parser.add_argument(
        "--engine", required=True,
        choices=(ENGINE_QWEN, ENGINE_FASTER_WHISPER, ENGINE_WHISPER, ENGINE_AZURE),
    )
    parser.add_argument("--model", help="Exact manifest-bound local model selector")
    parser.add_argument("--stt-python", default=os.environ.get("CCC_STT_PYTHON"))
    parser.add_argument(
        "--device", choices=("cpu", "cuda", "mps"),
        default=os.environ.get("CCC_STT_DEVICE", "cpu"),
    )
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument(
        "--owned-test-recording", action="store_true",
        help="Declare operator-owned, non-sensitive test audio, not participant/third-party audio",
    )
    parser.add_argument(
        "--allow-azure-upload", action="store_true",
        help="Explicitly allow this test recording's paid external Azure upload",
    )
    return parser


def _output_directory(requested: Path | None) -> Path:
    run_id = datetime.now(timezone.utc).strftime("e5-8-internal-%Y%m%dT%H%M%SZ")
    output = (requested or Path.home() / ".local/state/ccc-stt-trials" / run_id).expanduser().resolve()
    if any((parent / ".git").exists() for parent in (output, *output.parents)):
        raise TrialError("output_inside_git_repository")
    if output.exists():
        raise TrialError("output_already_exists")
    return output


def _write_json(path: Path, value: dict) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=False, indent=2, allow_nan=False)
        output.write("\n")


def run_trial(args: argparse.Namespace) -> dict:
    if not args.owned_test_recording:
        raise TrialError("owned_test_recording_declaration_required")
    if args.engine == ENGINE_AZURE and not args.allow_azure_upload:
        raise TrialError("external_upload_not_authorized")
    if args.engine != ENGINE_AZURE and args.allow_azure_upload:
        raise TrialError("external_upload_flag_requires_azure")
    if args.device not in ("cpu", "cuda", "mps"):
        raise TrialError("invalid_device")
    azure_key = os.environ.get("AZURE_SPEECH_KEY", "").strip() if args.engine == ENGINE_AZURE else None
    if args.engine == ENGINE_AZURE and not azure_key:
        raise TrialError("azure_speech_key_missing")
    if args.engine == ENGINE_QWEN and not args.stt_python:
        raise TrialError("qwen_python_required")
    if args.engine == ENGINE_AZURE and args.model is not None:
        raise TrialError("azure_model_override_not_supported")
    audio = args.audio.expanduser().resolve()
    if not audio.is_file():
        raise TrialError("audio_file_missing")
    output = _output_directory(args.output_dir)
    digest = hashlib.sha256()
    with audio.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    model = args.model or ("Qwen/Qwen3-ASR-1.7B" if args.engine == ENGINE_QWEN else "medium")
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    metadata = {
        "schemaVersion": 1,
        "trialId": output.name,
        "purpose": "internal-stt-trial",
        "inputDeclaration": "operator-owned-nonsensitive-test",
        "inputSha256": digest.hexdigest(),
        "engine": args.engine,
        "model": None if args.engine == ENGINE_AZURE else model,
        "qualityEvaluation": "deferred",
        "externalUploadAttempted": False,
    }
    try:
        if args.engine == ENGINE_AZURE:
            from .azure_stt import transcribe_azure

            def authorize_test_upload() -> None:
                # This is an explicit standalone trial, never a business job authorization.
                if not args.allow_azure_upload or not args.owned_test_recording:
                    raise TrialError("external_upload_not_authorized")
                metadata["externalUploadAttempted"] = True

            transcription = transcribe_azure(
                str(audio),
                api_key=azure_key,
                before_send=authorize_test_upload,
                expected_sha256=digest.hexdigest(),
            )
        else:
            engine = build_engine(
                args.engine, model, python_executable=args.stt_python, device=args.device,
            )
            try:
                with tempfile.TemporaryDirectory(prefix="chunks-", dir=output) as work_dir:
                    transcription = transcribe_audio(str(audio), Path(work_dir), engine)
            finally:
                close = getattr(engine, "close", None)
                if callable(close):
                    close()
        _write_json(output / "transcript.json", {
            "segments": [asdict(segment) for segment in transcription.segments],
            "repetitionWarnings": [asdict(warning) for warning in transcription.warnings],
            "forcedCuts": transcription.forced_cuts,
            "qualityEvaluation": "deferred",
        })
        metadata.update({
            "status": "completed",
            "segmentCount": len(transcription.segments),
            "repetitionWarningCount": len(transcription.warnings),
        })
        _write_json(output / "trial.json", metadata)
    except Exception as error:
        metadata.update({
            "status": "failed",
            "errorCode": error.code if isinstance(error, TrialError) else "stt_execution_failed",
            "errorType": type(error).__name__,
        })
        # Keep a failed run separate; never overwrite it or emit provider exception text.
        try:
            _write_json(output / "trial.json", metadata)
        except OSError:
            pass
        raise
    return {"status": "completed", "outputDirectory": str(output), "segmentCount": metadata["segmentCount"]}


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        print(json.dumps(run_trial(args), ensure_ascii=True))
        return 0
    except Exception as error:
        print(json.dumps({
            "status": "failed",
            "errorCode": error.code if isinstance(error, TrialError) else "stt_execution_failed",
            "errorType": type(error).__name__,
        }), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
