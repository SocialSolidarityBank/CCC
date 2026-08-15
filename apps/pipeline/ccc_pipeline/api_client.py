"""Workers API 클라이언트 — 처리 장비의 유일한 외부 통로다 (D13).

표준 라이브러리 urllib만 쓴다. 운영 API 앞 Cloudflare가 기본 python UA를
차단(오류 1010)하므로 모든 요청에 ccc-pipeline UA를 명시한다.
로그·예외 메시지에 전사 내용이나 시크릿을 넣지 않는다 (R3).
"""

from __future__ import annotations

import json
import shutil
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from . import __version__

USER_AGENT = f"ccc-pipeline/{__version__}"
_TIMEOUT_SECONDS = 120


class ApiError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(f"API error {status}: {detail}")
        self.status = status


class ApiClient:
    def __init__(
        self,
        base_url: str,
        client_id: str | None = None,
        client_secret: str | None = None,
        *,
        runtime_environment: str,
        preview_access_code: str | None = None,
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

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> urllib.request.Request:
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
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        return urllib.request.Request(self._base_url + path, data=data, headers=headers, method=method)

    def _open(self, request: urllib.request.Request):  # noqa: ANN202 — http.client.HTTPResponse
        try:
            return urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS)
        except urllib.error.HTTPError as error:
            # 본문에서 서버 오류 코드(JSON error 필드)만 추린다 — 전사·PII가 섞일 수 있는
            # 원문 전체를 예외 메시지로 올리지 않는다 (R3).
            detail = "unknown"
            try:
                payload = json.loads(error.read().decode("utf-8"))
                if isinstance(payload, dict) and isinstance(payload.get("error"), str):
                    detail = payload["error"]
            except Exception:  # noqa: BLE001 — 본문이 JSON이 아니면 상태 코드만 보고한다
                pass
            raise ApiError(error.code, detail) from None

    def list_jobs(self) -> list[dict[str, Any]]:
        """GET /pipeline/jobs — 호출 자체가 D8 폴링 신호(audit poll_pipeline)가 된다."""
        with self._open(self._request("GET", "/pipeline/jobs")) as response:
            payload = json.loads(response.read().decode("utf-8"))
        jobs = payload.get("jobs")
        if not isinstance(jobs, list):
            raise ApiError(200, "malformed jobs response")
        return jobs

    def download_audio(self, job_id: str, dest: Path) -> Path:
        """GET /pipeline/jobs/:id/audio — 원본 바이트를 작업 디렉터리에 저장한다."""
        with self._open(self._request("GET", f"/pipeline/jobs/{job_id}/audio")) as response:
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as file:
                shutil.copyfileobj(response, file)
        return dest

    def post_recording_result(self, job_id: str, result: dict[str, Any]) -> None:
        """POST /pipeline/jobs/:id/result — 마스킹된 녹음 결과를 멱등 제출한다."""
        with self._open(self._request("POST", f"/pipeline/jobs/{job_id}/result", result)) as response:
            if response.status != 204:
                raise ApiError(response.status, "unexpected recording result response")

    # ------------------------------------------------------------------
    # 텍스트 일감 (D51 · ADR-0027) — 오디오 없는 회차의 2차 마스킹.
    # ------------------------------------------------------------------

    def list_text_jobs(self) -> list[dict[str, Any]]:
        """GET /pipeline/text-jobs — 오디오 큐와 함께 D8 무폴링 감시에 합산된다."""
        with self._open(self._request("GET", "/pipeline/text-jobs")) as response:
            payload = json.loads(response.read().decode("utf-8"))
        jobs = payload.get("jobs")
        if not isinstance(jobs, list):
            raise ApiError(200, "malformed text jobs response")
        return jobs

    def get_text_job_source(self, item_id: str) -> str:
        """GET /pipeline/text-jobs/:id/source — 1차 치환까지 끝난 공식 텍스트."""
        with self._open(self._request("GET", f"/pipeline/text-jobs/{item_id}/source")) as response:
            payload = json.loads(response.read().decode("utf-8"))
        text = payload.get("text")
        if not isinstance(text, str) or text == "":
            raise ApiError(200, "malformed text job source response")
        return text

    def post_masked_source(self, session_id: str, snapshot: dict[str, Any]) -> None:
        """POST /sessions/:id/ai/source — 2차 마스킹 스냅샷. 성공 시 201."""
        with self._open(self._request("POST", f"/sessions/{session_id}/ai/source", snapshot)) as response:
            if response.status != 201:
                raise ApiError(response.status, "unexpected masked source response")

    def complete_text_job(self, item_id: str) -> None:
        """POST /pipeline/text-jobs/:id/complete — 성공 시 204."""
        with self._open(self._request("POST", f"/pipeline/text-jobs/{item_id}/complete", {})) as response:
            if response.status != 204:
                raise ApiError(response.status, "unexpected text job completion response")
