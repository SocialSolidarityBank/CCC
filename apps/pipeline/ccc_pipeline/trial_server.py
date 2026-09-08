"""Local internal STT trial server: same-origin 127.0.0.1 only, no product path.

Scope is operator-owned, non-sensitive test audio. This server never touches the
business database, sessions, consent, NER receipts or the signed engine registry,
never activates product STT, and never accepts a file path, model selector,
provider URL, command or credential from the browser.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import secrets
import shutil
import signal
import socket
import sys
import tempfile
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

from . import stt_trial
from .azure_stt import AZURE_STT_ENDPOINT, AzureSttError
from .model_registry import ModelRegistryError, role_spec
# Package-internal reuse: the same absolute/executable check the Qwen engine runs.
from .qwen_runtime import QwenRuntimeError, _validated_python
from .repetition import REASON_REPETITION
from .transcribe import ENGINE_AZURE, ENGINE_QWEN

# S8 and adapters/audio-r2 use the same product ceiling, so a file this server
# accepts is never rejected later by the product upload path or by Azure's own
# 250,000,000 byte guard.
MAX_UPLOAD_BYTES = 200 * 1024 * 1024
AUDIO_CONTENT_TYPES = (
    "audio/mp4",
    "audio/mpeg",
    "audio/wav",
    "audio/webm",
    "audio/x-m4a",
    "audio/x-wav",
)
TRIAL_ENGINES = (ENGINE_QWEN, ENGINE_AZURE)
DEFAULT_PORT = 8790
DEFAULT_ROOT = Path.home() / ".local/state/ccc-stt-trials"
DEFAULT_WORK_DIR = Path.home() / ".cache/ccc-pipeline"
SHUTDOWN_GRACE_SECONDS = 30.0
SIDECAR_NAME = "server-trial.json"
LOCK_NAME = ".server.lock"
_READ_CHUNK = 1024 * 1024
_TRIAL_ID = re.compile(r"^[0-9a-f]{32}$")
_DIGITS = re.compile(r"^[0-9]+$")
_DEVICES = ("cpu", "cuda", "mps")

# The built client ships the shared Wire CSS as an inline <style>, the same way
# apps/web's RootLayout does, so inline styles are allowed. Script stays 'self'
# only: no inline script, no external origin, no framing.
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; "
    "connect-src 'self'; img-src 'self' data:; object-src 'none'; "
    "base-uri 'none'; frame-ancestors 'none'"
)

_AZURE_URL = urlsplit(AZURE_STT_ENDPOINT)
AZURE_REGION = (_AZURE_URL.hostname or "").split(".")[0]
AZURE_API_VERSION = parse_qs(_AZURE_URL.query).get("api-version", [""])[0]

_STATIC_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webmanifest": "application/manifest+json",
    ".woff2": "font/woff2",
}

_QWEN_NOT_READY = frozenset((
    "dependency_missing",
    "device_unavailable",
    "device_unsupported",
    "model_file_missing",
    "model_hash_mismatch",
    "model_load_failed",
    "model_manifest_invalid",
    "model_snapshot_missing",
    "qwen_child_start_failed",
    "qwen_python_invalid",
))
_QWEN_RESULT_INVALID = frozenset(("qwen_protocol_invalid", "request_invalid", "sdk_output_invalid"))
_AZURE_AUDIO_REJECTED = frozenset((
    "audio_duration_limit",
    "audio_duration_unavailable",
    "audio_hash_mismatch",
    "audio_size_limit",
    "audio_unavailable",
))


class HttpError(Exception):
    """A fixed response code. Never carries provider text, paths or secrets."""

    def __init__(self, status: int, code: str, *, close: bool = False):
        super().__init__(code)
        self.status = status
        self.code = code
        self.close = close


def classify_failure(error: BaseException) -> str:
    """Map a known runtime failure to one fixed code. Unknown causes stay unknown."""
    code = getattr(error, "code", None)
    if isinstance(error, stt_trial.TrialError):
        return code
    if isinstance(error, QwenRuntimeError):
        if code == "qwen_child_timeout":
            return "engine_timeout"
        if code in _QWEN_NOT_READY:
            return "engine_not_ready"
        if code in _QWEN_RESULT_INVALID:
            return "engine_result_invalid"
        if code == "audio_path_invalid":
            return "audio_rejected"
        return "engine_execution_failed"
    if isinstance(error, AzureSttError):
        if code == "credential_unavailable":
            return "engine_not_ready"
        if code == "malformed_response":
            return "engine_result_invalid"
        if code == "provider_http_error":
            return "provider_rejected"
        # The adapter folds timeout, DNS and socket errors into one transport code,
        # so calling this a timeout would be a guess.
        if code == "provider_transport_error":
            return "provider_unavailable"
        if code in _AZURE_AUDIO_REJECTED:
            return "audio_rejected"
        return "engine_execution_failed"
    if isinstance(error, ModelRegistryError):
        return "engine_not_ready"
    return "stt_execution_failed"


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write_json_exclusive(path: Path, value: dict) -> None:
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        return
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(value, output, ensure_ascii=True, indent=2, allow_nan=False)
        output.write("\n")


def _read_json(path: Path) -> dict | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return value if isinstance(value, dict) else None


class TrialService:
    """One heavy STT run at a time, opaque trial ids, owner-only result directories."""

    def __init__(
        self,
        root: Path,
        work_dir: Path,
        client_dir: Path | None = None,
        runner=None,
        device: str | None = None,
    ):
        self.root = Path(root).expanduser().resolve()
        if any((parent / ".git").exists() for parent in (self.root, *self.root.parents)):
            raise ValueError("trial root inside a git repository")
        self.root.mkdir(mode=0o700, parents=True, exist_ok=True)
        # Namespaced by results root: the process lock is scoped to that root, so a
        # server with a different root must never sweep this one's live upload.
        digest = hashlib.sha256(str(self.root).encode("utf-8")).hexdigest()[:12]
        self.uploads = Path(work_dir).expanduser().resolve() / "stt-trial-uploads" / digest
        self.uploads.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.client_dir = Path(client_dir).expanduser().resolve() if client_dir else None
        self._runner = runner or stt_trial.run_trial
        self._device = (device or os.environ.get("CCC_STT_DEVICE", "").strip().lower() or "cpu")
        self._slot = threading.Lock()
        self._guard = threading.Lock()
        self._active: dict | None = None
        self._worker: threading.Thread | None = None
        self._closing = False
        # Verdicts that could not be persisted. Memory only, so a restart falls back
        # to the interrupted sweep.
        self._unsaved: dict[str, dict] = {}

    # ----- lifecycle -----

    def sweep(self) -> list[str]:
        """Close out directories left behind by an interrupted server. No reruns."""
        marked: list[str] = []
        for output in sorted(self.root.glob("api-*")):
            if output.is_symlink() or not output.is_dir():
                continue
            for leftover in output.glob("chunks-*"):
                if leftover.is_dir() and not leftover.is_symlink():
                    shutil.rmtree(leftover, ignore_errors=True)
            sidecar = output / SIDECAR_NAME
            if _read_json(sidecar) is not None:
                continue
            # A kill mid-write leaves an unreadable sidecar. Treat it as absent,
            # otherwise this trial answers 409 forever and never gets a verdict.
            sidecar.unlink(missing_ok=True)
            trial = _read_json(output / "trial.json") or {}
            status = trial.get("status")
            if status == "completed":
                code = None
            elif status == "failed":
                status, code = "failed", trial.get("errorCode") or "stt_execution_failed"
            else:
                status, code = "failed", "interrupted"
            if self._write_sidecar(
                output,
                output.name[len("api-"):],
                trial.get("engine") if trial.get("engine") in TRIAL_ENGINES else None,
                status,
                code,
                _counts(output),
            ):
                marked.append(output.name)
        return marked

    def clear_stale_uploads(self) -> int:
        """Drop upload copies a killed server never got to delete.

        Only the lock holder calls this, so nothing here is being written.
        """
        removed = 0
        for leftover in self.uploads.glob("upload-*"):
            if leftover.is_symlink() or not leftover.is_file():
                continue
            try:
                leftover.unlink()
            except OSError:
                continue
            removed += 1
        return removed

    def busy(self) -> bool:
        """True while a heavy run is reserved or its thread is still alive."""
        with self._guard:
            if self._active is not None:
                return True
        worker = self._worker
        return worker is not None and worker.is_alive()

    def join(self, timeout: float) -> None:
        worker = self._worker
        if worker is not None:
            worker.join(timeout)

    # ----- submission -----

    def device(self) -> str:
        return self._device

    def close(self) -> None:
        """Refuse new reservations. Handlers on open connections outlive the listener."""
        with self._guard:
            self._closing = True

    def reserve(self, engine: str) -> str:
        # Closing check and slot claim share one guard: a handler must not slip a
        # reservation between the shutdown freeze and the idle check.
        with self._guard:
            if self._closing:
                raise HttpError(503, "server_shutting_down", close=True)
            if not self._slot.acquire(blocking=False):
                raise HttpError(409, "trial_already_running", close=True)
            trial_id = secrets.token_hex(16)
            self._active = {"trialId": trial_id, "engine": engine, "status": "queued"}
            return trial_id

    def abort(self, trial_id: str) -> None:
        with self._guard:
            if self._active is not None and self._active["trialId"] == trial_id:
                self._active = None
                self._slot.release()

    def start(self, trial_id: str, engine: str, audio_path: Path) -> None:
        worker = threading.Thread(
            target=self._run, args=(trial_id, engine, audio_path), daemon=True,
        )
        self._worker = worker
        worker.start()

    def _run(self, trial_id: str, engine: str, audio_path: Path) -> None:
        output = self.root / f"api-{trial_id}"
        status, code = "completed", None
        try:
            with self._guard:
                if self._active is not None:
                    self._active["status"] = "running"
            self._runner(argparse.Namespace(
                audio=audio_path,
                engine=engine,
                model=None,
                stt_python=os.environ.get("CCC_STT_PYTHON"),
                device=self._device,
                output_dir=output,
                owned_test_recording=True,
                allow_azure_upload=engine == ENGINE_AZURE,
            ))
        except BaseException as error:  # noqa: BLE001 - every failure becomes a fixed code
            status, code = "failed", classify_failure(error)
        finally:
            # The uploaded copy is the only server-side original and never survives.
            try:
                audio_path.unlink(missing_ok=True)
            except OSError:
                pass
            counts = _counts(output)
            if not self._write_sidecar(output, trial_id, engine, status, code, counts):
                # The verdict cannot be stored, so it becomes an observable failure
                # held in memory instead of an escaping exception. A restart finds no
                # sidecar and marks the trial interrupted.
                status, code, counts = "failed", "result_storage_failed", {}
            with self._guard:
                if status == "failed" and code == "result_storage_failed":
                    self._unsaved[trial_id] = {
                        "trialId": trial_id,
                        "status": status,
                        "engine": engine,
                        "errorCode": code,
                        "externalUploadAttempted": _external_upload(output, engine),
                    }
                self._active = None
            self._slot.release()

    def _write_sidecar(
        self,
        output: Path,
        trial_id: str,
        engine: str | None,
        status: str,
        code: str | None,
        counts: dict,
    ) -> bool:
        """Persist the verdict. Returns False instead of raising: a storage failure
        must not escape the worker thread as a traceback with paths and errno text."""
        try:
            output.mkdir(mode=0o700, parents=True, exist_ok=True)
            _write_json_exclusive(output / SIDECAR_NAME, {
                "schemaVersion": 1,
                "trialId": trial_id,
                "engine": engine,
                "status": status,
                "errorCode": code,
                "segmentCount": counts.get("segmentCount"),
                "repetitionWarningCount": counts.get("repetitionWarningCount"),
                "externalUploadAttempted": _external_upload(output, engine),
                "finishedAt": _now(),
            })
        except (OSError, ValueError):
            return False
        return True

    # ----- reads -----

    def _directory(self, trial_id: str) -> Path:
        output = self.root / f"api-{trial_id}"
        if output.is_symlink() or not output.is_dir():
            raise HttpError(404, "not_found")
        return output

    def _assert_not_active(self, trial_id: str) -> None:
        with self._guard:
            active = self._active
            if active is not None and active["trialId"] == trial_id:
                raise HttpError(409, "trial_not_completed")

    def _sidecar(self, trial_id: str) -> tuple[Path, dict]:
        # A queued or running trial has no result directory yet, so the live slot
        # answers before the filesystem does.
        self._assert_not_active(trial_id)
        output = self._directory(trial_id)
        sidecar = _read_json(output / SIDECAR_NAME)
        if sidecar is None:
            raise HttpError(409, "trial_not_completed")
        return output, sidecar

    def status(self, trial_id: str) -> dict:
        with self._guard:
            if self._active is not None and self._active["trialId"] == trial_id:
                active = dict(self._active)
                active["externalUploadAttempted"] = _external_upload(
                    self.root / f"api-{trial_id}", active.get("engine"),
                )
                return active
            unsaved = self._unsaved.get(trial_id)
        if unsaved is not None:
            return dict(unsaved)
        _, sidecar = self._sidecar(trial_id)
        recorded = sidecar.get("externalUploadAttempted")
        payload = {
            "trialId": trial_id,
            "status": sidecar.get("status"),
            "engine": sidecar.get("engine"),
            # Unknown stays null: a missing record must not read as "nothing was sent".
            "externalUploadAttempted": recorded if isinstance(recorded, bool) else None,
        }
        if sidecar.get("status") == "completed":
            payload["segmentCount"] = sidecar.get("segmentCount")
            payload["repetitionWarningCount"] = sidecar.get("repetitionWarningCount")
            payload["qualityEvaluation"] = "deferred"
        else:
            payload["errorCode"] = sidecar.get("errorCode")
        return payload

    def transcript(self, trial_id: str) -> dict:
        output, sidecar = self._sidecar(trial_id)
        if sidecar.get("status") != "completed":
            raise HttpError(409, "trial_not_completed")
        raw = _read_json(output / "transcript.json")
        if raw is None:
            raise HttpError(500, "trial_result_invalid")
        return _normalize_transcript(raw)

    def delete(self, trial_id: str) -> None:
        with self._guard:
            active = self._active
            if active is not None and active["trialId"] == trial_id:
                raise HttpError(409, "trial_running")
            unsaved = trial_id in self._unsaved
        output = self._directory(trial_id)
        # An unstorable verdict is still terminal, so it stays deletable.
        if not (output / SIDECAR_NAME).is_file() and not unsaved:
            raise HttpError(409, "trial_not_completed")
        shutil.rmtree(output)
        with self._guard:
            self._unsaved.pop(trial_id, None)

    def status_payload(self) -> dict:
        with self._guard:
            active = dict(self._active) if self._active is not None else None
        return {
            "purpose": "internal-stt-trial",
            "internal": True,
            "productActivation": False,
            "engines": {
                ENGINE_QWEN: self._qwen_status(),
                ENGINE_AZURE: _azure_status(),
            },
            "upload": {
                "maxBytes": MAX_UPLOAD_BYTES,
                "contentTypes": list(AUDIO_CONTENT_TYPES),
            },
            "busy": active is not None,
            "activeTrialId": active["trialId"] if active is not None else None,
        }

    def _qwen_status(self) -> dict:
        # `configured` means the settings exist. It is not readiness, quality or approval.
        entry = {
            "configured": False,
            "reason": None,
            "device": self._device,
            "modelId": None,
            "modelRevision": None,
            "alignerId": None,
            "alignerRevision": None,
        }
        try:
            asr = role_spec("qwen-asr")
            aligner = role_spec("qwen-aligner")
        except (ModelRegistryError, QwenRuntimeError):
            entry["reason"] = "model_manifest_invalid"
            return entry
        entry.update(
            modelId=asr.name,
            modelRevision=asr.revision,
            alignerId=aligner.name,
            alignerRevision=aligner.revision,
        )
        if self._device not in _DEVICES:
            entry["reason"] = "invalid_device"
            return entry
        python = os.environ.get("CCC_STT_PYTHON", "").strip()
        if not python:
            entry["reason"] = "qwen_python_required"
            return entry
        try:
            _validated_python(python)
        except QwenRuntimeError:
            entry["reason"] = "qwen_python_invalid"
            return entry
        entry["configured"] = True
        return entry


def _azure_status() -> dict:
    configured = bool(os.environ.get("AZURE_SPEECH_KEY", "").strip())
    return {
        "configured": configured,
        "reason": None if configured else "azure_speech_key_missing",
        "region": AZURE_REGION,
        "apiVersion": AZURE_API_VERSION,
        "externalUploadAuthorizationRequired": True,
    }


def _external_upload(output: Path, engine: str | None) -> bool | None:
    """Was anything sent outside? Local never sends. Azure is only what the recorded
    run says: no readable record means unknown, which is never dressed up as False."""
    if engine == ENGINE_QWEN:
        return False
    if engine != ENGINE_AZURE:
        return None
    recorded = (_read_json(output / "trial.json") or {}).get("externalUploadAttempted")
    return recorded if isinstance(recorded, bool) else None


def _counts(output: Path) -> dict:
    trial = _read_json(output / "trial.json") or {}
    return {
        key: trial[key]
        for key in ("segmentCount", "repetitionWarningCount")
        if isinstance(trial.get(key), int)
    }


def _normalize_transcript(raw: dict) -> dict:
    try:
        segments = []
        for item in raw.get("segments") or []:
            segment = {
                "start": float(item["start"]),
                "end": float(item["end"]),
                "text": str(item["text"]),
            }
            speaker = item.get("speaker")
            if isinstance(speaker, str) and speaker:
                segment["speaker"] = speaker
            if item.get("warning") is True:
                segment["warning"] = True
            segments.append(segment)
        warnings = [
            {
                "start": float(item["start"]),
                "end": float(item["end"]),
                "count": int(item["count"]),
                "reason": REASON_REPETITION,
            }
            for item in raw.get("repetitionWarnings") or []
        ]
    except (AttributeError, KeyError, TypeError, ValueError):
        raise HttpError(500, "trial_result_invalid") from None
    return {
        "segments": segments,
        "repetitionWarnings": warnings,
        "forcedCuts": int(raw.get("forcedCuts") or 0),
        "qualityEvaluation": "deferred",
    }


class TrialRequestHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "ccc-stt-trial"
    sys_version = ""
    timeout = 120

    # ----- routing -----

    def do_GET(self) -> None:
        self._dispatch("GET")

    def do_HEAD(self) -> None:
        self._dispatch("HEAD")

    def do_POST(self) -> None:
        self._dispatch("POST")

    def do_DELETE(self) -> None:
        self._dispatch("DELETE")

    def do_OPTIONS(self) -> None:
        self._dispatch("OPTIONS")

    def do_PUT(self) -> None:
        self._dispatch("PUT")

    def _dispatch(self, method: str) -> None:
        self._label = "invalid"
        try:
            self._guard_boundary()
            path = urlsplit(self.path).path
            if path == "/internal/stt/status":
                self._label = "status"
                self._require(method, ("GET", "HEAD"))
                self._send_json(200, self._service().status_payload(), body=method != "HEAD")
                return
            if path == "/internal/stt/trials":
                self._label = "submit"
                self._require(method, ("POST",))
                self._submit()
                return
            trial = re.fullmatch(r"/internal/stt/trials/([^/]+)(/transcript)?", path)
            if trial is not None:
                trial_id, suffix = trial.group(1), trial.group(2)
                self._label = "transcript" if suffix else "trial"
                if _TRIAL_ID.fullmatch(trial_id) is None:
                    raise HttpError(404, "not_found")
                if suffix:
                    self._require(method, ("GET", "HEAD"))
                    payload = self._service().transcript(trial_id)
                elif method == "DELETE":
                    self._label = "delete"
                    self._service().delete(trial_id)
                    self._send_json(204, None)
                    return
                else:
                    self._require(method, ("GET", "HEAD"))
                    payload = self._service().status(trial_id)
                self._send_json(200, payload, body=method != "HEAD")
                return
            if path.startswith("/internal/"):
                raise HttpError(404, "not_found")
            self._label = "static"
            self._require(method, ("GET", "HEAD"))
            self._serve_static(path, body=method != "HEAD")
        except HttpError as error:
            self._send_json(
                error.status,
                {"error": error.code},
                body=method != "HEAD",
                close=error.close or method in ("POST", "PUT"),
            )
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception:  # noqa: BLE001 - never leak an exception message
            self._send_json(500, {"error": "internal_error"}, body=method != "HEAD", close=True)

    def send_error(self, code: int, message: str | None = None, explain: str | None = None) -> None:
        # Every stdlib-generated error (bad request line, unsupported method, long
        # URI) answers with the same fixed JSON and headers instead of an HTML page
        # that echoes the request.
        self._label = "invalid"
        self._send_json(
            code,
            {"error": "method_not_allowed" if code == 501 else "bad_request"},
            body=self.command != "HEAD",
            close=True,
        )

    def _service(self) -> TrialService:
        return self.server.service  # type: ignore[attr-defined]

    def _require(self, method: str, allowed: tuple[str, ...]) -> None:
        if method not in allowed:
            raise HttpError(405, "method_not_allowed")

    def _guard_boundary(self) -> None:
        port = self.server.server_address[1]
        host = (self.headers.get("Host") or "").strip().lower()
        if host not in (f"127.0.0.1:{port}", f"localhost:{port}"):
            raise HttpError(403, "host_not_allowed", close=True)
        origin = self.headers.get("Origin")
        # Compare against the accepted Host, not a second allowlist: 127.0.0.1 and
        # localhost are different origins, so the alias pairs must not cross.
        if origin is not None and origin.strip().lower() != f"http://{host}":
            raise HttpError(403, "origin_not_allowed", close=True)

    # ----- submission -----

    def _submit(self) -> None:
        service = self._service()
        engine = (self.headers.get("X-CCC-Trial-Engine") or "").strip()
        if engine not in TRIAL_ENGINES:
            raise HttpError(400, "engine_invalid", close=True)
        if (self.headers.get("X-CCC-Owned-Test-Recording") or "").strip() != "1":
            raise HttpError(400, "owned_test_recording_declaration_required", close=True)
        external = (self.headers.get("X-CCC-Allow-External-Upload") or "").strip()
        if engine == ENGINE_AZURE:
            if external != "1":
                raise HttpError(400, "external_upload_not_authorized", close=True)
        elif external:
            raise HttpError(400, "external_upload_flag_requires_azure", close=True)
        media = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if media not in AUDIO_CONTENT_TYPES:
            raise HttpError(400, "content_type_not_allowed", close=True)
        length = self._declared_length()
        self._assert_configured(engine, service)
        trial_id = service.reserve(engine)
        try:
            audio = self._read_body(length, service)
        except BaseException:
            service.abort(trial_id)
            raise
        service.start(trial_id, engine, audio)
        self._send_json(202, {"trialId": trial_id, "status": "queued", "engine": engine})

    def _declared_length(self) -> int:
        # Trust the framing header, not the stream: reading past the declared
        # frame on a keep-alive connection deadlocks a browser that is already
        # waiting for the response.
        if self.headers.get_all("Transfer-Encoding"):
            # Presence, not truthiness: an empty or duplicated header still leaves
            # the framing ambiguous.
            raise HttpError(400, "chunked_body_not_supported", close=True)
        declared = self.headers.get_all("Content-Length") or []
        if len(declared) != 1 or _DIGITS.fullmatch(declared[0].strip()) is None:
            raise HttpError(400, "content_length_required", close=True)
        length = int(declared[0].strip())
        if length < 1:
            raise HttpError(400, "audio_body_empty", close=True)
        if length > MAX_UPLOAD_BYTES:
            raise HttpError(413, "audio_too_large", close=True)
        return length

    def _assert_configured(self, engine: str, service: TrialService) -> None:
        if service.device() not in _DEVICES:
            raise HttpError(409, "invalid_device", close=True)
        if engine == ENGINE_AZURE:
            if not os.environ.get("AZURE_SPEECH_KEY", "").strip():
                raise HttpError(409, "azure_speech_key_missing", close=True)
            return
        python = os.environ.get("CCC_STT_PYTHON", "").strip()
        if not python:
            raise HttpError(409, "qwen_python_required", close=True)
        try:
            _validated_python(python)
        except QwenRuntimeError:
            raise HttpError(409, "qwen_python_invalid", close=True) from None

    def _read_body(self, length: int, service: TrialService) -> Path:
        descriptor, name = tempfile.mkstemp(prefix="upload-", dir=service.uploads)
        audio = Path(name)
        remaining = length
        try:
            with os.fdopen(descriptor, "wb") as sink:
                while remaining > 0:
                    chunk = self.rfile.read(min(_READ_CHUNK, remaining))
                    if not chunk:
                        raise HttpError(400, "audio_body_incomplete", close=True)
                    sink.write(chunk)
                    remaining -= len(chunk)
        except BaseException as error:
            audio.unlink(missing_ok=True)
            if isinstance(error, (socket.timeout, TimeoutError)):
                raise HttpError(408, "upload_timeout", close=True) from None
            if isinstance(error, HttpError):
                raise
            if isinstance(error, OSError):
                raise HttpError(400, "audio_body_incomplete", close=True) from None
            raise
        return audio

    # ----- static -----

    def _serve_static(self, path: str, *, body: bool) -> None:
        root = self._service().client_dir
        if root is None:
            raise HttpError(404, "not_found")
        relative = unquote(path).lstrip("/") or "index.html"
        if relative.endswith("/"):
            relative += "index.html"
        if "\x00" in relative:
            raise HttpError(404, "not_found")
        target = (root / relative).resolve()
        if not target.is_relative_to(root) or not target.is_file():
            raise HttpError(404, "not_found")
        try:
            payload = target.read_bytes()
        except OSError:
            raise HttpError(404, "not_found") from None
        self._respond(
            200,
            payload if body else b"",
            _STATIC_TYPES.get(target.suffix.lower(), "application/octet-stream"),
            len(payload),
        )

    # ----- output -----

    def _send_json(self, status: int, payload: dict | None, *, body: bool = True, close: bool = False) -> None:
        encoded = b"" if payload is None else json.dumps(
            payload, ensure_ascii=True, allow_nan=False,
        ).encode("ascii")
        self._respond(
            status,
            encoded if body else b"",
            "application/json; charset=utf-8",
            len(encoded),
            close=close,
        )

    def _respond(
        self,
        status: int,
        payload: bytes,
        content_type: str,
        declared: int,
        *,
        close: bool = False,
    ) -> None:
        try:
            self.send_response(status)
            if status != 204:
                self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(declared if status != 204 else 0))
            self.send_header("Cache-Control", "no-store, private")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
            self.send_header("Referrer-Policy", "no-referrer")
            if close:
                self.send_header("Connection", "close")
            self.end_headers()
            if payload:
                self.wfile.write(payload)
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
            return
        sys.stderr.write(f"ccc-stt-trial {self.command} {self._label} {status}\n")

    def log_message(self, format: str, *args) -> None:  # noqa: A002 - stdlib signature
        # Default logging echoes the raw request line. Responses log a fixed label instead.
        return


class TrialHTTPServer(ThreadingHTTPServer):
    # SO_REUSEADDR here only skips TIME_WAIT on rebind; a live listener still wins
    # with EADDRINUSE. Windows lets it steal a bound port, so it stays off there,
    # and the single-run boundary is `.server.lock` either way.
    allow_reuse_address = os.name != "nt"

    def __init__(self, address: tuple[str, int], service: TrialService):
        self.service = service
        super().__init__(address, TrialRequestHandler)


def acquire_single_instance(root: Path, port: int) -> Path:
    """One server process at a time, so a restart can never start a second heavy run."""
    lock = root / LOCK_NAME
    try:
        descriptor = os.open(lock, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise HttpError(409, "trial_server_already_running") from None
    with os.fdopen(descriptor, "w", encoding="utf-8") as sink:
        json.dump({"pid": os.getpid(), "port": port, "startedAt": _now()}, sink)
        sink.write("\n")
    return lock


def main(argv: list[str] | None = None) -> int:
    if argv:
        sys.stderr.write("trial_server: no arguments; configure with environment variables\n")
        return 2
    port_raw = os.environ.get("CCC_STT_TRIAL_PORT", "").strip()
    if port_raw and _DIGITS.fullmatch(port_raw) is None:
        sys.stderr.write("trial_server: CCC_STT_TRIAL_PORT is invalid\n")
        return 2
    port = int(port_raw) if port_raw else DEFAULT_PORT
    root = Path(os.environ.get("CCC_STT_TRIAL_DIR", "").strip() or DEFAULT_ROOT)
    work_dir = Path(os.environ.get("CCC_WORK_DIR", "").strip() or DEFAULT_WORK_DIR)
    client_raw = os.environ.get("CCC_STT_TRIAL_CLIENT_DIR", "").strip()
    try:
        service = TrialService(
            root=root,
            work_dir=work_dir,
            client_dir=Path(client_raw) if client_raw else None,
        )
    except (OSError, ValueError) as error:
        sys.stderr.write(f"trial_server: cannot use trial directories ({type(error).__name__})\n")
        return 2
    try:
        lock = acquire_single_instance(service.root, port)
    except HttpError:
        sys.stderr.write(
            "trial_server: another trial server holds the lock. If no server runs, "
            f"remove {service.root / LOCK_NAME} after confirming no STT child process remains.\n"
        )
        return 3
    leaked = False
    try:
        interrupted = service.sweep()
        if interrupted:
            sys.stderr.write(f"ccc-stt-trial interrupted results marked: {len(interrupted)}\n")
        stale = service.clear_stale_uploads()
        if stale:
            sys.stderr.write(f"ccc-stt-trial stale upload copies removed: {stale}\n")
        server = TrialHTTPServer(("127.0.0.1", port), service)
        signal.signal(signal.SIGTERM, _raise_interrupt)
        sys.stderr.write(
            f"ccc-stt-trial listening on http://127.0.0.1:{port} "
            f"(static={'on' if service.client_dir else 'off'})\n"
        )
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            # Freeze first: closing the listener does not stop handler threads that
            # are already on an open keep-alive connection, and one of those could
            # otherwise reserve work after the idle check below.
            service.close()
            server.server_close()
            service.join(SHUTDOWN_GRACE_SECONDS)
    finally:
        # Past the grace window the daemon worker dies with the interpreter and its
        # isolated STT child can outlive us. Releasing the lock here would let a
        # second server start a second heavy run beside that orphan, so we keep it.
        if service.busy():
            leaked = True
            sys.stderr.write(
                "trial_server: a trial was still running at shutdown. Keeping "
                f"{lock} so no second server starts. Remove it after confirming no "
                "STT child process remains.\n"
            )
        else:
            lock.unlink(missing_ok=True)
    return 4 if leaked else 0


def _raise_interrupt(signum, frame) -> None:  # noqa: ANN001 - stdlib signature
    raise KeyboardInterrupt


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
