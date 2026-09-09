"""Workers API 클라이언트 — 처리 장비의 유일한 외부 통로다 (D13).

표준 라이브러리 urllib만 쓴다. 운영 API 앞 Cloudflare가 기본 python UA를
차단(오류 1010)하므로 모든 요청에 ccc-pipeline UA를 명시한다.
로그·예외 메시지에 전사 내용이나 시크릿을 넣지 않는다 (R3).
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, BinaryIO
from urllib.parse import urlsplit

from . import __version__
from .secure_memory import SecureMemoryError, load_sensitive_json

USER_AGENT = f"ccc-pipeline/{__version__}"
_TIMEOUT_SECONDS = 120
_MAX_AUDIO_BYTES = 200 * 1024 * 1024
_MAX_SIGNED_TARGET_BYTES = 16 * 1024
_SIGNED_TARGET_TTL_SECONDS = 600
# Wire codes from packages/contracts/src/agent-jobs.ts, never provider error text.
_API_ERROR_CODES = frozenset({
    "authentication_required", "forbidden", "job_not_found", "lease_expired",
    "stale_claim", "consent_not_effective", "audio_object_missing",
    "audio_hash_mismatch", "audio_deleted", "route_mismatch", "engine_unavailable",
    "masking_snapshot_missing", "local_ner_unavailable", "registered_pii_detected",
    "unmasked_identifier_detected", "evidence_hash_mismatch",
    "masking_pipeline_version_mismatch", "dictionary_already_consumed",
    "result_schema_invalid", "result_conflict", "retry_exhausted",
})


class _RejectRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Credentials and claim bodies are valid only at the configured endpoint.
        return None


def _https_origin(value: str) -> str:
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError) as error:
        raise ValueError("invalid HTTPS origin") from error
    if (
        parsed.scheme != "https"
        or parsed.hostname is None
        or parsed.username is not None
        or parsed.password is not None
    ):
        raise ValueError("invalid HTTPS origin")
    host = parsed.hostname.lower()
    authority = f"[{host}]" if ":" in host else host
    if port is not None and port != 443:
        authority += f":{port}"
    return f"https://{authority}"


def _copy_bounded(source: BinaryIO, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    total = 0
    descriptor = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, "wb") as file:
            descriptor = -1
            while chunk := source.read(1024 * 1024):
                total += len(chunk)
                if total > _MAX_AUDIO_BYTES:
                    raise AudioDownloadError("permanent_failure")
                file.write(chunk)
        if total == 0:
            raise AudioDownloadError("permanent_failure")
    except Exception:
        if descriptor >= 0:
            os.close(descriptor)
        dest.unlink(missing_ok=True)
        raise


class ApiError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(f"API error {status}: {detail}")
        self.status = status
        # 서버 error 코드. 서버가 닫지 않는 형식 거부만 Agent 가 스스로 닫는다.
        self.code = detail


def _read_json_response(response, invalid_code: str):  # noqa: ANN001, ANN202
    invalid = False
    try:
        return load_sensitive_json(response)
    except (json.JSONDecodeError, UnicodeDecodeError):
        invalid = True
    if invalid:
        # JSONDecodeError가 보관하는 원문 doc의 traceback과 연결하지 않는다.
        raise ApiError(200, invalid_code)


class AudioDownloadError(Exception):
    def __init__(self, reason: str, *, transient: bool = False):
        super().__init__(f"audio download failed: {reason}")
        self.reason = reason
        self.transient = transient


class ApiClient:
    def __init__(
        self,
        base_url: str,
        client_id: str | None = None,
        client_secret: str | None = None,
        *,
        runtime_environment: str,
        preview_access_code: str | None = None,
        audio_download_origin: str | None = None,
    ):
        if runtime_environment not in ("preview", "production"):
            raise ValueError("runtime environment must be preview or production")
        if runtime_environment == "preview":
            if preview_access_code is None or client_id is not None or client_secret is not None:
                raise ValueError("preview client requires only the Preview credential")
        elif preview_access_code is not None or client_id is None or client_secret is None:
            raise ValueError("production client requires only Access credentials")
        self._base_url = base_url.rstrip("/")
        self._client_id = client_id
        self._client_secret = client_secret
        self._runtime_environment = runtime_environment
        self._preview_access_code = preview_access_code
        self._preview_token: str | None = None
        self._preview_token_expires_at = 0.0
        self._opener = urllib.request.build_opener(_RejectRedirects())
        if audio_download_origin is not None:
            parsed_origin = urlsplit(audio_download_origin)
            if (
                _https_origin(audio_download_origin) != audio_download_origin.rstrip("/")
                or parsed_origin.path not in ("", "/")
                or parsed_origin.query
                or parsed_origin.fragment
            ):
                raise ValueError("audio download origin must be an exact HTTPS origin")
        self._audio_download_origin = (
            None if audio_download_origin is None else audio_download_origin.rstrip("/")
        )
        self._storage_opener = urllib.request.build_opener(_RejectRedirects())

    def _unlock_preview(self) -> str:
        if self._preview_access_code is None:
            raise ApiError(401, "preview credential unavailable")
        request = urllib.request.Request(
            self._base_url + "/preview/unlock",
            data=json.dumps({"code": self._preview_access_code}).encode("utf-8"),
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
            method="POST",
        )
        with self._open(request) as response:
            payload = json.load(response)
        token = payload.get("token") if isinstance(payload, dict) else None
        max_age = payload.get("maxAgeSeconds") if isinstance(payload, dict) else None
        if not isinstance(token, str) or token == "":
            raise ApiError(200, "malformed preview unlock response")
        self._preview_token = token
        # 서버 TTL보다 60초 먼저 갱신해 장기 폴링 중 만료 경계에 걸리지 않게 한다.
        self._preview_token_expires_at = time.monotonic() + max(0, max_age - 60) if isinstance(max_age, int) else 0.0
        return token

    def _preview_session_token(self) -> str:
        if self._preview_token is None or time.monotonic() >= self._preview_token_expires_at:
            return self._unlock_preview()
        return self._preview_token

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        claim: tuple[str, int] | None = None,
    ) -> urllib.request.Request:
        data = None
        headers = {
            "User-Agent": USER_AGENT,
        }
        if self._runtime_environment == "preview":
            headers["Cookie"] = f"ccc_preview={self._preview_session_token()}"
        else:
            if self._client_id is None or self._client_secret is None:
                raise ApiError(401, "production credential unavailable")
            headers["CF-Access-Client-Id"] = self._client_id
            headers["CF-Access-Client-Secret"] = self._client_secret
        # GET 은 본문이 없어 claim 자격을 헤더로 싣는다. URL 에는 토큰을 넣지 않는다(S5 §2.5).
        if claim is not None:
            headers["X-CCC-Job-Claim"] = claim[0]
            headers["X-CCC-Job-Attempt"] = str(claim[1])
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        return urllib.request.Request(self._base_url + path, data=data, headers=headers, method=method)

    def _open(self, request: urllib.request.Request, *, masking_input: bool = False):  # noqa: ANN202
        mapped_error: ApiError | None = None
        try:
            return self._opener.open(request, timeout=_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as error:
            # Accept only protocol codes; an upstream error may echo credentials.
            detail = "unknown"
            payload: Any = None
            try:
                payload = load_sensitive_json(error)
                candidate = payload.get("error") if isinstance(payload, dict) else None
                if isinstance(candidate, str) and candidate in _API_ERROR_CODES:
                    detail = candidate
                candidate = None
            except SecureMemoryError:
                if masking_input:
                    detail = "masking_input_invalid"
            except Exception:  # noqa: BLE001 — 오류 본문을 해석하지 못하면 상태 코드만 보존한다
                pass
            finally:
                if isinstance(payload, (dict, list)):
                    payload.clear()
                payload = None
                try:
                    error.close()
                except Exception:  # noqa: BLE001 — 닫기 실패도 원래 HTTP 응답을 밖으로 내보내지 않는다
                    pass
            mapped_error = ApiError(error.code, detail)
        # except 바깥에서 올려 HTTPError traceback/stream을 __context__로 붙이지 않는다.
        if mapped_error is not None:
            raise mapped_error
        raise AssertionError("unreachable")

    # ------------------------------------------------------------------
    # Agent 작업 계약 v2 (S5). 모든 후속 요청은 claim token 과 attempt 를 함께 보낸다.
    # ------------------------------------------------------------------

    def claim_jobs(self, claim_request: dict[str, Any]) -> list[dict[str, Any]]:
        """POST /pipeline/jobs/claim — 호출 자체가 D8 폴링 신호(audit poll_pipeline)다."""
        with self._open(self._request("POST", "/pipeline/jobs/claim", claim_request)) as response:
            payload = json.load(response)
        if not isinstance(payload, dict) or payload.get("schemaVersion") != 2:
            raise ApiError(200, "unexpected claim schema version")
        jobs = payload.get("jobs")
        if (
            not isinstance(jobs, list)
            or any(
                not isinstance(job, dict)
                or "sttEngine" not in job
                or "sttEngineId" not in job
                for job in jobs
            )
        ):
            raise ApiError(200, "malformed claim response")
        return jobs

    def heartbeat(self, job_id: str, claim_token: str, attempt: int) -> dict[str, Any]:
        body = {"claimToken": claim_token, "attempt": attempt}
        with self._open(self._request("POST", f"/pipeline/jobs/{job_id}/heartbeat", body)) as response:
            return json.load(response)

    def release(self, job_id: str, claim_token: str, attempt: int, outcome: str, reason: str) -> None:
        """종료 신호. 결과를 보낸 claim 에는 보내지 않는다 (terminal 은 정확히 하나)."""
        body = {"claimToken": claim_token, "attempt": attempt, "outcome": outcome, "reason": reason}
        with self._open(self._request("POST", f"/pipeline/jobs/{job_id}/release", body)) as response:
            if response.status != 204:
                raise ApiError(response.status, "unexpected release response")

    def get_source(self, job_id: str, claim_token: str, attempt: int) -> str:
        """GET /pipeline/jobs/:id/source — 1차 치환까지 끝난 공식 텍스트(text claim 전용)."""
        request = self._request("GET", f"/pipeline/jobs/{job_id}/source", claim=(claim_token, attempt))
        with self._open(request, masking_input=True) as response:
            payload = _read_json_response(response, "masking_input_invalid")
        text = payload.get("text") if isinstance(payload, dict) else None
        if isinstance(payload, dict):
            payload.clear()
        payload = None
        if not isinstance(text, str) or text == "":
            text = None
            raise ApiError(200, "masking_input_invalid")
        return text

    def download_audio(
        self,
        job_id: str,
        claim_token: str,
        attempt: int,
        dest: Path,
        *,
        delivery: str,
    ) -> Path:
        """Fetch a claim-bound stream or a credential-free bounded signed target."""
        if delivery not in ("api-stream", "protected-get"):
            raise AudioDownloadError("route_mismatch")
        request = self._request("GET", f"/pipeline/jobs/{job_id}/audio", claim=(claim_token, attempt))
        with self._open(request) as response:
            if delivery == "api-stream":
                _copy_bounded(response, dest)
                return dest
            raw_target = response.read(_MAX_SIGNED_TARGET_BYTES + 1)
        if len(raw_target) > _MAX_SIGNED_TARGET_BYTES:
            raise AudioDownloadError("route_mismatch")
        try:
            target = json.loads(raw_target.decode("utf-8"))
            if not isinstance(target, dict) or set(target) != {"delivery", "url", "expiresAt"}:
                raise ValueError
            url = target["url"]
            expires_raw = target["expiresAt"]
            if (
                target["delivery"] != "signed-get"
                or not isinstance(url, str)
                or not isinstance(expires_raw, str)
                or self._audio_download_origin is None
            ):
                raise ValueError
            parsed_url = urlsplit(url)
            if parsed_url.fragment or _https_origin(url) != self._audio_download_origin:
                raise ValueError
            expires_at = datetime.fromisoformat(expires_raw.replace("Z", "+00:00"))
            now = datetime.now(timezone.utc)
            if (
                expires_at.tzinfo is None
                or expires_at <= now
                or expires_at > now + timedelta(seconds=_SIGNED_TARGET_TTL_SECONDS)
            ):
                raise ValueError
        except (KeyError, TypeError, ValueError):
            raise AudioDownloadError("route_mismatch") from None
        storage_request = urllib.request.Request(
            url,
            headers={"User-Agent": USER_AGENT},
            method="GET",
        )
        try:
            with self._storage_opener.open(storage_request, timeout=_TIMEOUT_SECONDS) as response:
                status = getattr(response, "status", None)
                if status != 200:
                    raise AudioDownloadError(
                        "audio_object_missing" if status == 404 else "route_mismatch",
                    )
                _copy_bounded(response, dest)
        except urllib.error.HTTPError as error:
            status = error.code
            error.close()
            if status == 429 or status >= 500:
                raise AudioDownloadError("engine_unavailable", transient=True) from None
            raise AudioDownloadError(
                "audio_object_missing" if status == 404 else "route_mismatch",
            ) from None
        except (TimeoutError, urllib.error.URLError, OSError):
            raise AudioDownloadError("engine_unavailable", transient=True) from None
        return dest

    def verify_audio(self, job_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """POST /pipeline/jobs/:id/audio/verify - 스트림 재해시 결과를 코어가 확인한다."""
        with self._open(self._request("POST", f"/pipeline/jobs/{job_id}/audio/verify", body)) as response:
            return json.load(response)

    def authorize_egress(self, job_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """POST /pipeline/jobs/:id/egress/authorize — verified Azure upload authorization."""
        with self._open(self._request("POST", f"/pipeline/jobs/{job_id}/egress/authorize", body)) as response:
            return json.loads(response.read().decode("utf-8"))

    def start_egress(self, job_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """POST /pipeline/jobs/:id/egress/in-flight — provider-call linearization CAS."""
        with self._open(self._request("POST", f"/pipeline/jobs/{job_id}/egress/in-flight", body)) as response:
            return json.loads(response.read().decode("utf-8"))

    def get_mask_dictionary(self, job_id: str, claim_token: str, attempt: int) -> dict[str, Any]:
        """POST /pipeline/jobs/:id/mask-dictionary — 일회성 치환 사전. 메모리에서만 쓴다(R3)."""
        body = {"claimToken": claim_token, "attempt": attempt}
        with self._open(self._request("POST", f"/pipeline/jobs/{job_id}/mask-dictionary", body), masking_input=True) as response:
            return _read_json_response(response, "masking_input_invalid")

    def post_result(self, job_id: str, result_request: dict[str, Any]) -> None:
        """POST /pipeline/jobs/:id/result — 성공 시 204. 400 은 재구성 신호가 아니다(S5 §2.7)."""
        with self._open(self._request("POST", f"/pipeline/jobs/{job_id}/result", result_request)) as response:
            if response.status != 204:
                raise ApiError(response.status, "unexpected result response")

    def report_readiness(
        self,
        stt_mode: str,
        stt_engine_id: str | None,
        state: str,
        capacity: int,
    ) -> None:
        expected_engine = {
            "off": None,
            "local": "qwen3-asr",
            "azure": "azure-speech-koreacentral",
        }.get(stt_mode, object())
        if (
            stt_engine_id != expected_engine
            or (stt_mode == "off" and (state != "unavailable" or capacity != 0))
            or state not in ("ready", "unavailable")
            or type(capacity) is not int
            or capacity not in (0, 1)
            or (state == "unavailable" and capacity != 0)
        ):
            raise ValueError("invalid readiness report")
        body = {
            "schemaVersion": 1,
            "sttMode": stt_mode,
            "sttEngineId": stt_engine_id,
            "state": state,
            "capacity": capacity,
        }
        with self._open(self._request("POST", "/pipeline/readiness", body)) as response:
            try:
                payload = json.loads(response.read().decode("utf-8"))
            except (UnicodeError, ValueError):
                raise ApiError(response.status, "malformed readiness response") from None
        if payload != {"accepted": True}:
            raise ApiError(200, "malformed readiness response")


class MemoryApiClient(ApiClient):
    """Same text masking protocol, isolated from ordinary session snapshot jobs."""

    def __init__(self, client: ApiClient):
        self._client = client

    def _request(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        claim: tuple[str, int] | None = None,
    ) -> urllib.request.Request:
        if not path.startswith("/pipeline/jobs/"):
            raise ValueError("invalid memory job path")
        return self._client._request(
            method, "/pipeline/memory/" + path[len("/pipeline/jobs/"):], body, claim
        )

    def _open(self, request: urllib.request.Request):  # noqa: ANN202
        return self._client._open(request)
