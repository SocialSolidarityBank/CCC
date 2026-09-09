"""Azure fast-transcription adapter with one authorized client-side HTTP upload."""

from __future__ import annotations

import hashlib
import http.client
import json
import os
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable, Iterator
from typing import BinaryIO

from .chunking import detect_silences
from .repetition import DEFAULT_REPEAT_THRESHOLD, collapse_runs, find_repetition_runs
from .speaker_mapping import Segment
from .transcribe import TranscriptionResult

AZURE_STT_ENDPOINT = (
    "https://koreacentral.api.cognitive.microsoft.com/"
    "speechtotext/transcriptions:transcribe?api-version=2025-10-15"
)
AZURE_TOKEN_ENDPOINT = "https://koreacentral.api.cognitive.microsoft.com/sts/v1.0/issueToken"
MAX_AUDIO_BYTES = 250_000_000
MAX_AUDIO_SECONDS = 2 * 60 * 60
_TIMEOUT_SECONDS = 120
_MAX_RESPONSE_BYTES = 10 * 1024 * 1024
_DEFINITION = json.dumps(
    {"locales": ["ko-KR"], "diarization": {"enabled": True, "maxSpeakers": 2}},
    separators=(",", ":"),
).encode("utf-8")


class AzureSttError(Exception):
    """Sanitized provider/preflight failure safe for logs and release classification."""

    def __init__(self, code: str, *, transient: bool = False, status: int | None = None):
        super().__init__(f"Azure STT failed: {code}")
        self.code = code
        self.transient = transient
        self.status = status


def preflight_azure(api_key: str) -> None:
    """Authenticate in Korea Central without sending audio or retaining the issued token."""
    if not isinstance(api_key, str) or api_key.strip() == "":
        raise AzureSttError("credential_unavailable")
    request = urllib.request.Request(
        AZURE_TOKEN_ENDPOINT,
        data=b"",
        headers={
            "Ocp-Apim-Subscription-Key": api_key,
            "Content-Length": "0",
        },
        method="POST",
    )
    opener = urllib.request.build_opener(_RejectRedirects())
    try:
        with opener.open(request, timeout=_TIMEOUT_SECONDS) as response:
            status = getattr(response, "status", None)
            token = response.read(16 * 1024 + 1)
    except urllib.error.HTTPError as error:
        status = error.code
        error.close()
        raise AzureSttError(
            "preflight_failed",
            transient=status == 429 or status >= 500,
            status=status,
        ) from None
    except (TimeoutError, urllib.error.URLError, OSError, http.client.HTTPException):
        raise AzureSttError("preflight_failed", transient=True) from None
    if status != 200 or not token or len(token) > 16 * 1024:
        raise AzureSttError(
            "preflight_failed",
            transient=isinstance(status, int) and (status == 429 or status >= 500),
            status=status if isinstance(status, int) else None,
        )


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class _MultipartBody:
    def __init__(self, audio: BinaryIO, boundary: str, audio_size: int):
        self._audio = audio
        self._prefix = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="definition"\r\n'
            "Content-Type: application/json\r\n\r\n"
        ).encode("ascii") + _DEFINITION + (
            f"\r\n--{boundary}\r\n"
            'Content-Disposition: form-data; name="audio"; filename="audio.bin"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode("ascii")
        self._suffix = f"\r\n--{boundary}--\r\n".encode("ascii")
        self.content_length = len(self._prefix) + audio_size + len(self._suffix)

    def __iter__(self) -> Iterator[bytes]:
        yield self._prefix
        for chunk in iter(lambda: self._audio.read(1024 * 1024), b""):
            yield chunk
        yield self._suffix


def _hash_stream(stream: BinaryIO) -> str:
    digest = hashlib.sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
    stream.seek(0)
    return digest.hexdigest()


def _parse_result(payload: object) -> TranscriptionResult:
    if not isinstance(payload, dict):
        raise AzureSttError("malformed_response")
    duration = payload.get("durationMilliseconds")
    phrases = payload.get("phrases")
    if (
        isinstance(duration, bool)
        or not isinstance(duration, int)
        or duration <= 0
        or duration >= MAX_AUDIO_SECONDS * 1000
        or not isinstance(phrases, list)
    ):
        raise AzureSttError("malformed_response")

    segments: list[Segment] = []
    for phrase in phrases:
        if not isinstance(phrase, dict):
            raise AzureSttError("malformed_response")
        offset = phrase.get("offsetMilliseconds")
        phrase_duration = phrase.get("durationMilliseconds")
        text = phrase.get("text")
        speaker = phrase.get("speaker")
        if (
            isinstance(offset, bool)
            or not isinstance(offset, int)
            or offset < 0
            or isinstance(phrase_duration, bool)
            or not isinstance(phrase_duration, int)
            or phrase_duration < 0
            or offset + phrase_duration > duration
            or not isinstance(text, str)
            or (speaker is not None and (isinstance(speaker, bool) or not isinstance(speaker, int) or speaker < 0))
        ):
            raise AzureSttError("malformed_response")
        segments.append(
            Segment(
                start=offset / 1000,
                end=(offset + phrase_duration) / 1000,
                text=text,
                speaker=None if speaker is None else f"SPEAKER_{speaker:02d}",
            )
        )

    warnings = find_repetition_runs(segments, DEFAULT_REPEAT_THRESHOLD)
    return TranscriptionResult(
        segments=collapse_runs(segments, warnings) if warnings else segments,
        warnings=warnings,
        forced_cuts=0,
    )


def transcribe_azure(
    audio_path: str,
    *,
    api_key: str,
    before_send: Callable[[], object],
    expected_sha256: str | None = None,
) -> TranscriptionResult:
    """Transcribe one Korean file with one client HTTP send and no client retries."""
    if not isinstance(api_key, str) or api_key.strip() == "":
        raise AzureSttError("credential_unavailable")

    try:
        with open(audio_path, "rb") as audio:
            audio_size = os.fstat(audio.fileno()).st_size
            if audio_size <= 0 or audio_size >= MAX_AUDIO_BYTES:
                raise AzureSttError("audio_size_limit")

            actual_sha256 = _hash_stream(audio)
            if expected_sha256 is not None:
                normalized_expected = expected_sha256.lower() if isinstance(expected_sha256, str) else ""
                if (
                    len(normalized_expected) != 64
                    or any(character not in "0123456789abcdef" for character in normalized_expected)
                    or actual_sha256 != normalized_expected
                ):
                    raise AzureSttError("audio_hash_mismatch")

            _, duration = detect_silences(audio_path)
            if duration <= 0:
                raise AzureSttError("audio_duration_unavailable")
            if duration >= MAX_AUDIO_SECONDS:
                raise AzureSttError("audio_duration_limit")

            boundary = f"ccc-{uuid.uuid4().hex}"
            body = _MultipartBody(audio, boundary, audio_size)
            request = urllib.request.Request(
                AZURE_STT_ENDPOINT,
                data=body,
                headers={
                    "Ocp-Apim-Subscription-Key": api_key,
                    "Content-Type": f"multipart/form-data; boundary={boundary}",
                    "Content-Length": str(body.content_length),
                    "Accept": "application/json",
                },
                method="POST",
            )
            opener = urllib.request.build_opener(_RejectRedirects())
            before_send()
            try:
                with opener.open(request, timeout=_TIMEOUT_SECONDS) as response:
                    status = getattr(response, "status", None)
                    if status != 200:
                        raise AzureSttError(
                            "provider_http_error",
                            transient=isinstance(status, int) and (status == 429 or status >= 500),
                            status=status if isinstance(status, int) else None,
                        )
                    raw = response.read(_MAX_RESPONSE_BYTES + 1)
            except urllib.error.HTTPError as error:
                status = error.code
                error.close()
                raise AzureSttError(
                    "provider_http_error",
                    transient=status == 429 or status >= 500,
                    status=status,
                ) from None
            except (TimeoutError, urllib.error.URLError, OSError, http.client.HTTPException):
                raise AzureSttError("provider_transport_error", transient=True) from None
    except AzureSttError:
        raise
    except OSError:
        raise AzureSttError("audio_unavailable") from None

    if len(raw) > _MAX_RESPONSE_BYTES:
        raise AzureSttError("malformed_response")
    try:
        return _parse_result(json.loads(raw.decode("utf-8")))
    except AzureSttError:
        raise
    except (UnicodeError, ValueError):
        raise AzureSttError("malformed_response") from None
