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
from typing import Any, BinaryIO, Protocol
from urllib.parse import urlsplit

from . import __version__

USER_AGENT = f"ccc-pipeline/{__version__}"
_TIMEOUT_SECONDS = 120
_MAX_AUDIO_BYTES = 200 * 1024 * 1024
_MAX_SIGNED_TARGET_BYTES = 16 * 1024
_SIGNED_TARGET_TTL_SECONDS = 600
# S2 §2.4 L135-136: bearer 900초, refresh 30일 rotate-on-use. 서버 만료보다 60초 먼저
# 갱신해 긴 폴링 중 경계에 걸리지 않게 한다(preview 세션과 같은 규약).
_CREDENTIAL_RENEWAL_MARGIN_SECONDS = 60
_MAX_TOKEN_BYTES = 4096
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


class AudioDownloadError(Exception):
    def __init__(self, reason: str, *, transient: bool = False):
        super().__init__(f"audio download failed: {reason}")
        self.reason = reason
        self.transient = transient


class AgentCredentialSource(Protocol):
    """Agent refresh 자격의 출처(S9 · E6-4).

    회전한 값을 돌려주는 자리도 이 인터페이스다 — 클라이언트는 자격을 어디에 두는지
    모른 채 읽고 되돌려 쓴다. DPAPI CurrentUser backend 는 E5-1b 몫이라 여기 없다.
    """

    def refresh_token(self) -> str:
        ...

    def store_refresh_token(self, token: str) -> None:
        ...


class EnvAgentCredentialSource:
    """환경변수 backend. `CCC_AGENT_REFRESH_TOKEN` 을 생성 시 한 번만 읽는다.

    회전된 값은 프로세스 메모리에만 두고(환경변수를 되쓰지 않는다) 다음 교환에 쓴다.
    값은 어떤 로그·예외 메시지에도 넣지 않는다 (R3).
    """

    ENV_NAME = "CCC_AGENT_REFRESH_TOKEN"

    def __init__(self) -> None:
        token = os.environ.get(self.ENV_NAME, "").strip()
        if not token:
            raise ValueError("agent refresh token is unavailable")
        self._token = token

    def refresh_token(self) -> str:
        return self._token

    def store_refresh_token(self, token: str) -> None:
        if not token:
            raise ValueError("agent refresh token is unavailable")
        self._token = token


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
        agent_credentials: AgentCredentialSource | None = None,
    ):
        if runtime_environment not in ("preview", "production"):
            raise ValueError("runtime environment must be preview or production")
        if runtime_environment == "preview":
            if (
                preview_access_code is None
                or client_id is not None
                or client_secret is not None
                or agent_credentials is not None
            ):
                raise ValueError("preview client requires only the Preview credential")
        elif preview_access_code is not None:
            raise ValueError("production client requires only Access credentials")
        # 운영에는 두 자격 방식이 배타적으로 하나만 있다: E6-4 의 canonical Agent Bearer,
        # 또는 E2-7 까지 남는 legacy Cloudflare Access 서비스 토큰(S2 §2.1 L46).
        elif agent_credentials is not None:
            if client_id is not None or client_secret is not None:
                raise ValueError("agent client requires only the pairing credential")
        elif client_id is None or client_secret is None:
            raise ValueError("production client requires only Access credentials")
        self._base_url = base_url.rstrip("/")
        self._client_id = client_id
        self._client_secret = client_secret
        self._runtime_environment = runtime_environment
        self._preview_access_code = preview_access_code
        self._preview_token: str | None = None
        self._preview_token_expires_at = 0.0
        self._agent_credentials = agent_credentials
        self._agent_bearer_token: str | None = None
        self._agent_bearer_expires_at = 0.0
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
            payload = json.loads(response.read().decode("utf-8"))
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

    def _exchange_agent_refresh(self) -> str:
        """POST /agents/token — refresh 를 회전하고 새 bearer 를 받는다(S2 §2.4 L136).

        회전된 refresh 는 반드시 출처를 통해서만 되돌려 쓴다. 교환 요청 자체에는
        Authorization 을 싣지 않으므로 이 경로는 재시도 고리에 들어가지 않는다.
        """
        source = self._agent_credentials
        if source is None:
            raise ApiError(401, "agent credential unavailable")
        request = urllib.request.Request(
            self._base_url + "/agents/token",
            data=json.dumps({"refreshToken": source.refresh_token()}).encode("utf-8"),
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"},
            method="POST",
        )
        self._agent_bearer_token = None
        self._agent_bearer_expires_at = 0.0
        with self._open(request, allow_refresh=False) as response:
            payload = json.loads(response.read(_MAX_TOKEN_BYTES + 1).decode("utf-8"))
        if not isinstance(payload, dict):
            raise ApiError(200, "malformed agent token response")
        bearer = payload.get("bearerToken")
        refresh = payload.get("refreshToken")
        expires_raw = payload.get("bearerExpiresAt")
        if (
            not isinstance(bearer, str) or bearer == ""
            or not isinstance(refresh, str) or refresh == ""
            or not isinstance(expires_raw, str)
        ):
            raise ApiError(200, "malformed agent token response")
        try:
            expires_at = datetime.fromisoformat(expires_raw.replace("Z", "+00:00"))
        except ValueError:
            raise ApiError(200, "malformed agent token response") from None
        if expires_at.tzinfo is None:
            raise ApiError(200, "malformed agent token response")
        lifetime = (expires_at - datetime.now(timezone.utc)).total_seconds()
        source.store_refresh_token(refresh)
        self._agent_bearer_token = bearer
        self._agent_bearer_expires_at = time.monotonic() + max(
            0.0, lifetime - _CREDENTIAL_RENEWAL_MARGIN_SECONDS
        )
        return bearer

    def _agent_bearer(self) -> str:
        if self._agent_bearer_token is None or time.monotonic() >= self._agent_bearer_expires_at:
            return self._exchange_agent_refresh()
        return self._agent_bearer_token

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
        elif self._agent_credentials is not None:
            # E6-4 canonical 경로: 업무 API 는 Authorization Bearer 만 받는다(S2 §2.1 L46).
            headers["Authorization"] = f"Bearer {self._agent_bearer()}"
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

    def _open(self, request: urllib.request.Request, *, allow_refresh: bool = True):  # noqa: ANN202 — http.client.HTTPResponse
        try:
            return self._opener.open(request, timeout=_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as error:
            # Accept only protocol codes; an upstream error may echo credentials.
            detail = "unknown"
            status = error.code
            try:
                payload = json.loads(error.read().decode("utf-8"))
                if isinstance(payload, dict) and isinstance(payload.get("error"), str) and payload["error"] in _API_ERROR_CODES:
                    detail = payload["error"]
            except Exception:  # noqa: BLE001 — 본문이 JSON이 아니면 상태 코드만 보고한다
                pass
            finally:
                error.close()
        # bearer 는 900초짜리다. 만료·폐기 뒤 첫 401 에서만 refresh 를 한 번 돌리고 한 번
        # 다시 보낸다 — 두 번째 401 은 그대로 올린다(재사용 폐기를 되돌릴 길은 없다).
        if (
            status == 401
            and allow_refresh
            and self._agent_credentials is not None
            and request.has_header("Authorization")
        ):
            request.add_header("Authorization", f"Bearer {self._exchange_agent_refresh()}")
            return self._open(request, allow_refresh=False)
        raise ApiError(status, detail)

    # ------------------------------------------------------------------
    # Agent 작업 계약 v2 (S5). 모든 후속 요청은 claim token 과 attempt 를 함께 보낸다.
    # ------------------------------------------------------------------

    def claim_jobs(self, claim_request: dict[str, Any]) -> list[dict[str, Any]]:
        """POST /pipeline/jobs/claim — 호출 자체가 D8 폴링 신호(audit poll_pipeline)다."""
        with self._open(self._request("POST", "/pipeline/jobs/claim", claim_request)) as response:
            payload = json.loads(response.read().decode("utf-8"))
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
            return json.loads(response.read().decode("utf-8"))

    def release(self, job_id: str, claim_token: str, attempt: int, outcome: str, reason: str) -> None:
        """종료 신호. 결과를 보낸 claim 에는 보내지 않는다 (terminal 은 정확히 하나)."""
        body = {"claimToken": claim_token, "attempt": attempt, "outcome": outcome, "reason": reason}
        with self._open(self._request("POST", f"/pipeline/jobs/{job_id}/release", body)) as response:
            if response.status != 204:
                raise ApiError(response.status, "unexpected release response")

    def get_source(self, job_id: str, claim_token: str, attempt: int) -> str:
        """GET /pipeline/jobs/:id/source — 1차 치환까지 끝난 공식 텍스트(text claim 전용)."""
        request = self._request("GET", f"/pipeline/jobs/{job_id}/source", claim=(claim_token, attempt))
        with self._open(request) as response:
            payload = json.loads(response.read().decode("utf-8"))
        text = payload.get("text")
        if not isinstance(text, str) or text == "":
            raise ApiError(200, "malformed job source response")
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
        """POST /pipeline/jobs/:id/audio/verify — 스트림 재해시 결과를 코어가 확인한다."""
        with self._open(self._request("POST", f"/pipeline/jobs/{job_id}/audio/verify", body)) as response:
            return json.loads(response.read().decode("utf-8"))

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
        with self._open(self._request("POST", f"/pipeline/jobs/{job_id}/mask-dictionary", body)) as response:
            return json.loads(response.read().decode("utf-8"))

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

    def _open(self, request: urllib.request.Request, *, allow_refresh: bool = True):  # noqa: ANN202
        return self._client._open(request, allow_refresh=allow_refresh)
