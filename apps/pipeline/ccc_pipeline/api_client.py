"""Workers API 클라이언트 — 처리 장비의 유일한 외부 통로다 (D13).

표준 라이브러리 urllib만 쓴다. 운영 API 앞 Cloudflare가 기본 python UA를
차단(오류 1010)하므로 모든 요청에 ccc-pipeline UA를 명시한다.
로그·예외 메시지에 전사 내용이나 시크릿을 넣지 않는다 (R3).
"""

from __future__ import annotations

import json
import shutil
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
    def __init__(self, base_url: str, client_id: str, client_secret: str):
        self._base_url = base_url.rstrip("/")
        self._client_id = client_id
        self._client_secret = client_secret

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> urllib.request.Request:
        data = None
        headers = {
            "User-Agent": USER_AGENT,
            "CF-Access-Client-Id": self._client_id,
            "CF-Access-Client-Secret": self._client_secret,
        }
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

    def post_artifacts(self, job_id: str, artifacts: dict[str, Any]) -> None:
        """POST /pipeline/jobs/:id/artifacts — 성공 시 204, 세션은 review_ready로 바뀐다."""
        with self._open(self._request("POST", f"/pipeline/jobs/{job_id}/artifacts", artifacts)) as response:
            if response.status != 204:
                raise ApiError(response.status, "unexpected artifacts response")
