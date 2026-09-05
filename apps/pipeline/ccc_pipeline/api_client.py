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
        # 서버 error 코드. 같은 422 라도 작업이 아직 임대 중인지 이미 닫혔는지를 이 코드가 가른다.
        self.code = detail


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
        if not isinstance(jobs, list):
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

    def download_audio(self, job_id: str, claim_token: str, attempt: int, dest: Path) -> Path:
        """GET /pipeline/jobs/:id/audio — claim 에 묶인 원음을 작업 디렉터리에 저장한다."""
        request = self._request("GET", f"/pipeline/jobs/{job_id}/audio", claim=(claim_token, attempt))
        with self._open(request) as response:
            dest.parent.mkdir(parents=True, exist_ok=True)
            with open(dest, "wb") as file:
                shutil.copyfileobj(response, file)
        return dest

    def verify_audio(self, job_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """POST /pipeline/jobs/:id/audio/verify — 스트림 재해시 결과를 코어가 확인한다."""
        with self._open(self._request("POST", f"/pipeline/jobs/{job_id}/audio/verify", body)) as response:
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
