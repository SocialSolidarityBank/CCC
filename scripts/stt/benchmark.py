#!/usr/bin/env python3
"""Run audio-only candidates against S13; persist numerical evidence, never transcripts."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import platform
import re
import subprocess
import sys

from fixture_tools import canonical_json_bytes, read_json, sha256_file, verify_fixture
from metrics import THRESHOLDS, pool_sessions, score_session

ROOT = Path(__file__).resolve().parents[2]
ENGINES = ("faster-whisper", "qwen3-asr")
TOKEN = re.compile(r"^[A-Za-z0-9_.:/@+\-]{1,200}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
REVISION = re.compile(r"^[0-9a-f]{40}$")


def safe_metadata(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {"engine", "models", "packages", "backend", "device", "threads"}:
        raise ValueError("invalid worker metadata")
    if value["engine"] not in (*ENGINES, "diarization") or value["device"] not in ("cpu", "mps", "cuda"):
        raise ValueError("invalid worker target")
    if not isinstance(value["backend"], str) or not TOKEN.fullmatch(value["backend"]):
        raise ValueError("invalid backend")
    if type(value["threads"]) is not int or value["threads"] < 1:
        raise ValueError("invalid threads")
    if not isinstance(value["packages"], dict) or not value["packages"]:
        raise ValueError("missing package provenance")
    for key, version in value["packages"].items():
        if not isinstance(key, str) or not isinstance(version, str) or not TOKEN.fullmatch(key) or not TOKEN.fullmatch(version):
            raise ValueError("invalid package provenance")
    if not isinstance(value["models"], list) or not value["models"]:
        raise ValueError("missing model provenance")
    for model in value["models"]:
        if not isinstance(model, dict) or set(model) != {"name", "revision", "files"}:
            raise ValueError("invalid model provenance")
        if not isinstance(model["name"], str) or not TOKEN.fullmatch(model["name"]) or not isinstance(model["revision"], str) or not REVISION.fullmatch(model["revision"]):
            raise ValueError("unpinned model")
        if not isinstance(model["files"], list) or not model["files"]:
            raise ValueError("missing model integrity")
        for file in model["files"]:
            if not isinstance(file, dict) or set(file) != {"name", "sha256"} or not isinstance(file["name"], str) or not TOKEN.fullmatch(file["name"]) or not isinstance(file["sha256"], str) or not SHA256.fullmatch(file["sha256"]):
                raise ValueError("invalid model integrity")
    return value


def worker_responses(command: list[str], sessions: list[dict]):
    """The subprocess sees only audio identifiers. Its stderr is never published."""
    try:
        process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8")
    except OSError:
        for session in sessions:
            yield {"sessionId": session["sessionId"], "errorCode": "worker_start_failed"}
        return
    failed = False
    try:
        for session in sessions:
            session_id = session["sessionId"]
            if failed:
                yield {"sessionId": session_id, "errorCode": "worker_protocol_failed"}
                continue
            try:
                process.stdin.write(json.dumps({"sessionId": session_id, "audioPath": session["audioPath"]}) + "\n")
                process.stdin.flush()
                line = process.stdout.readline(2_000_001)
                if len(line) > 2_000_000:
                    raise ValueError("worker response too large")
                response = json.loads(line)
                if not isinstance(response, dict) or response.get("sessionId") != session_id:
                    raise ValueError("worker identity mismatch")
                if "errorCode" in response:
                    yield {"sessionId": session_id, "errorCode": "worker_failed"}
                else:
                    yield response
            except (OSError, ValueError, UnicodeError):
                failed = True
                if process.poll() is None:
                    process.terminate()
                yield {"sessionId": session_id, "errorCode": "worker_protocol_failed"}
    finally:
        try:
            process.stdin.close()
            if failed and process.poll() is None:
                process.terminate()
            try:
                exit_code = process.wait(timeout=30)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                raise RuntimeError("worker_exit_failed") from None
            if not failed and (exit_code or process.stdout.read(1)):
                raise RuntimeError("worker_exit_failed")
        finally:
            process.stdout.close()


def _command_output(command: list[str]) -> str | None:
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=15)
        return result.stdout.strip() if result.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def hardware() -> dict:
    system = platform.system()
    cpu = platform.processor() or None
    memory = None
    gpu = None
    if system == "Darwin":
        cpu = _command_output(["sysctl", "-n", "machdep.cpu.brand_string"])
        memory = _command_output(["sysctl", "-n", "hw.memsize"])
        display_info = _command_output(["system_profiler", "SPDisplaysDataType", "-json"])
        if display_info:
            try:
                gpu = [row["sppci_model"] for row in json.loads(display_info)["SPDisplaysDataType"]]
            except (ValueError, KeyError, TypeError):
                pass
    elif system == "Windows":
        memory = _command_output(["powershell", "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory"])
        names = _command_output(["powershell", "-NoProfile", "-Command", "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"])
        gpu = names.splitlines() if names else None
    else:
        try:
            memory = os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE")
        except (OSError, ValueError, AttributeError):
            pass
    return {"system": system, "release": platform.release(), "architecture": platform.machine(), "cpu": cpu, "ramBytes": int(memory) if memory and str(memory).isdigit() else None, "gpu": gpu, "logicalCpuCount": os.cpu_count()}


def _write_report(out: Path, report: dict) -> None:
    (out / "stt-metrics.json").write_bytes(canonical_json_bytes(report))


def _source_hashes() -> dict:
    paths = [*Path(__file__).parent.glob("*.py"), Path(__file__).with_name("benchmark-models.json"), ROOT / "supply-chain/model-license-manifest.json"]
    paths += [ROOT / "apps/pipeline/ccc_pipeline" / name for name in ("transcribe.py", "chunking.py", "repetition.py", "model_registry.py")]
    return {str(path.relative_to(ROOT)): sha256_file(path) for path in sorted(paths) if path.is_file()}


def run_benchmark(manifest_path: Path, audio_dir: Path, receipt_path: Path, out: Path, commands: dict[str, list[str]]) -> dict:
    out.mkdir(parents=True, exist_ok=False)
    report = {"schemaVersion": 1, "runId": out.name, "createdAt": datetime.now(timezone.utc).isoformat(), "status": "FAIL", "executionScope": "offline-engine-benchmark", "deploymentModesExercised": [], "policy": {"automaticSelection": False, "requiresUserApproval": True}, "engines": {}}
    try:
        verification = verify_fixture(manifest_path, audio_dir)
        if read_json(receipt_path) != verification:
            raise ValueError("receipt mismatch")
    except (OSError, ValueError):
        report["errorCode"] = "fixture_integrity_failed"
        _write_report(out, report)
        return report
    manifest = read_json(manifest_path)
    sessions = manifest["sessions"]
    target = hardware()
    report.update(fixtureId=manifest["fixtureId"], fixtureManifestSha256=verification["manifestSha256"], verification=verification, hardware=target, gitCommit=_command_output(["git", "-C", str(ROOT), "rev-parse", "HEAD"]), sourceHashes=_source_hashes())
    report["thresholds"] = THRESHOLDS
    report["hypothesisStage"] = "selected-after-retry-before-collapse"
    diarization = {}
    diarization_metadata = None
    try:
        for response in worker_responses(commands["diarization"], sessions):
            if "errorCode" not in response:
                metadata = safe_metadata(response.get("metadata"))
                if metadata["engine"] != "diarization" or (diarization_metadata is not None and metadata != diarization_metadata):
                    raise ValueError("diarization provenance mismatch")
                diarization_metadata = metadata
                diarization[response["sessionId"]] = response["turns"]
            print(json.dumps({"stage": "diarization", "sessionId": response["sessionId"], "status": "FAIL" if "errorCode" in response else "MEASURED"}), flush=True)
    except (OSError, ValueError, RuntimeError, KeyError, TypeError):
        report["diarizationErrorCode"] = "diarization_failed"
    report["diarization"] = {"sharedAcrossCandidates": True, "measuredSessionCount": len(diarization), "metadata": diarization_metadata}
    for engine in ENGINES:
        rows = []
        metadata = None
        worker_failed = False
        engine_dir = out / engine
        engine_dir.mkdir()
        try:
            for session, response in zip(sessions, worker_responses(commands[engine], sessions), strict=True):
                row = {"caseId": session["caseId"], "sessionId": session["sessionId"], "audioSha256": session["audioSha256"], "transcriptSha256": session["transcriptSha256"], "speakerTruthSha256": session["speakerTruthSha256"]}
                try:
                    if "errorCode" in response or session["sessionId"] not in diarization:
                        raise ValueError("prediction missing")
                    observed = safe_metadata(response.get("metadata"))
                    if observed["engine"] != engine or (metadata is not None and observed != metadata):
                        raise ValueError("candidate provenance mismatch")
                    if not isinstance(response.get("text"), str) or type(response.get("engineWallSeconds")) not in (float, int) or not math.isfinite(response["engineWallSeconds"]) or response["engineWallSeconds"] <= 0:
                        raise ValueError("candidate prediction malformed")
                    metadata = observed
                    reference = read_json(manifest_path.parent / session["referencePath"])
                    row.update(score_session(reference, response["text"], diarization[session["sessionId"]], response["engineWallSeconds"], session["durationSeconds"], target["system"] == "Windows" and metadata["device"] == "cpu"))
                except (OSError, ValueError, KeyError, TypeError):
                    row["errorCode"] = "prediction_missing_or_invalid"
                    row["status"] = "UNMEASURED"
                rows.append(row)
                (engine_dir / f"{session['sessionId']}.json").write_bytes(canonical_json_bytes(row))
                print(json.dumps({"stage": engine, "sessionId": session["sessionId"], "status": "UNMEASURED" if "errorCode" in row else "MEASURED"}), flush=True)
        except (OSError, ValueError, RuntimeError, KeyError, TypeError):
            worker_failed = True
        scored = [row for row in rows if "errorCode" not in row]
        complete = len(scored) == len(sessions) == 150 and not worker_failed and "diarizationErrorCode" not in report
        pooled = pool_sessions(scored, target["system"] == "Windows" and metadata is not None and metadata["device"] == "cpu") if scored else None
        states = [metric["status"] for metric in pooled.values()] if pooled else []
        status = "FAIL" if not complete or "FAIL" in states else "UNMEASURED" if "UNMEASURED" in states else "PASS"
        report["engines"][engine] = {"status": status, "complete": complete, "recordedSessionCount": len(rows), "measuredSessionCount": len(scored), "expectedSessionCount": 150, "metadata": metadata, "pooled": pooled, "errorCode": "incomplete_predictions" if not complete else None}
        report["engines"][engine]["measuredSessionIds"] = [row["sessionId"] for row in scored]
        _write_report(out, report)
    states = [row["status"] for row in report["engines"].values()]
    report["status"] = "FAIL" if "FAIL" in states else "UNMEASURED" if "UNMEASURED" in states else "PASS"
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    _write_report(out, report)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--audio-dir", type=Path, default=ROOT / "artifacts/pilot/fixtures/s13-v1/audio")
    parser.add_argument("--verification", type=Path, default=ROOT / "artifacts/pilot/fixtures/s13-v1-verification.json")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--engines", default=",".join(ENGINES), choices=[",".join(ENGINES)])
    parser.add_argument("--pipeline-python", default=sys.executable)
    parser.add_argument("--qwen-python", default=sys.executable)
    parser.add_argument("--qwen-device", choices=["cpu", "mps", "cuda"], default="cpu")
    parser.add_argument("--diarization-device", choices=["cpu", "mps", "cuda"], default="cpu")
    parser.add_argument("--threads", type=int, default=4)
    args = parser.parse_args()
    if args.threads < 1:
        parser.error("--threads must be positive")
    commands = {}
    for engine, python, device in (("diarization", args.pipeline_python, args.diarization_device), ("faster-whisper", args.pipeline_python, "cpu"), ("qwen3-asr", args.qwen_python, args.qwen_device)):
        commands[engine] = [python, str(Path(__file__).with_name("benchmark_engines.py")), "--engine", engine, "--audio-dir", str(args.audio_dir.resolve()), "--device", device, "--threads", str(args.threads)]
    try:
        report = run_benchmark(args.manifest.resolve(), args.audio_dir.resolve(), args.verification.resolve(), args.out, commands)
    except FileExistsError:
        print("benchmark_output_already_exists", file=sys.stderr)
        return 1
    except (OSError, ValueError, RuntimeError):
        print("benchmark_execution_failed", file=sys.stderr)
        return 1
    print(json.dumps({"status": report["status"], "runId": report["runId"]}))
    return 0 if report["status"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
