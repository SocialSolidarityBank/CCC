"""E6-4 Agent 페어링 client 경로. 합성 자격만 쓰고 가짜 서버로 실제 HTTP 를 돈다.

고정하는 계약은 넷이다. 업무 요청은 `Authorization: Bearer` 로만 가고, bearer 가
끊기면 refresh 를 한 번 회전해 한 번만 다시 보내고, 회전된 refresh 는 출처를 통해서만
돌아오며, 어떤 자격 값도 예외 메시지에 들어가지 않는다.
"""

import contextlib
import json
import os
import threading
import unittest
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock

from ccc_pipeline.api_client import ApiClient, ApiError, EnvAgentCredentialSource

REFRESH_ONE = "synthetic-refresh-one"
REFRESH_TWO = "synthetic-refresh-two"
REFRESH_THREE = "synthetic-refresh-three"
BEARER_ONE = "synthetic-bearer-one"
BEARER_TWO = "synthetic-bearer-two"


class MemorySource:
    """테스트용 `AgentCredentialSource`. 회전 값이 출처로만 돌아오는지 관찰한다."""

    def __init__(self, token: str):
        self.token = token
        self.writes: list[str] = []

    def refresh_token(self) -> str:
        return self.token

    def store_refresh_token(self, token: str) -> None:
        self.token = token
        self.writes.append(token)


class PairingHandler(BaseHTTPRequestHandler):
    exchanges: list[str] = []
    authorizations: list[str | None] = []
    reject_first_business_call = False
    reject_every_business_call = False

    def log_message(self, *_args):
        pass

    def _respond(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):  # noqa: N802 — BaseHTTPRequestHandler contract
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length) or b"{}")
        state = type(self)
        if self.path == "/agents/token":
            # 교환 자체는 자격이 refresh 라 Authorization 을 싣지 않는다.
            if self.headers.get("Authorization") is not None:
                self._respond(400, {"error": "unexpected_authorization"})
                return
            state.exchanges.append(body["refreshToken"])
            issued = len(state.exchanges)
            expires_at = datetime.now(timezone.utc) + timedelta(seconds=900)
            self._respond(201, {
                "installationId": "install-fixture",
                "bearerToken": BEARER_ONE if issued == 1 else BEARER_TWO,
                "bearerExpiresAt": expires_at.isoformat().replace("+00:00", "Z"),
                "refreshToken": REFRESH_TWO if issued == 1 else REFRESH_THREE,
                "refreshExpiresAt": (expires_at + timedelta(days=30)).isoformat().replace("+00:00", "Z"),
            })
            return
        state.authorizations.append(self.headers.get("Authorization"))
        first_call = len(state.authorizations) == 1
        if state.reject_every_business_call or (state.reject_first_business_call and first_call):
            self._respond(401, {"error": "authentication_required"})
            return
        self._respond(200, {"accepted": True})


@contextlib.contextmanager
def pairing_server():
    PairingHandler.exchanges = []
    PairingHandler.authorizations = []
    PairingHandler.reject_first_business_call = False
    PairingHandler.reject_every_business_call = False
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), PairingHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_port}"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join()


class AgentPairingClientTest(unittest.TestCase):
    def test_business_requests_carry_only_the_exchanged_bearer(self):
        source = MemorySource(REFRESH_ONE)
        with pairing_server() as origin:
            client = ApiClient(origin, runtime_environment="production", agent_credentials=source)
            self.assertEqual(client.heartbeat("job-1", "t" * 64, 1), {"accepted": True})
            # 두 번째 호출은 살아 있는 bearer 를 재사용한다 — 교환은 여전히 한 번이다.
            client.heartbeat("job-1", "t" * 64, 1)
            request = client._request("POST", "/pipeline/jobs/claim", {"limit": 1})
        self.assertEqual(PairingHandler.exchanges, [REFRESH_ONE])
        self.assertEqual(PairingHandler.authorizations, [f"Bearer {BEARER_ONE}"] * 2)
        self.assertEqual(request.get_header("Authorization"), f"Bearer {BEARER_ONE}")
        self.assertIsNone(request.get_header("Cf-access-client-id"))
        self.assertIsNone(request.get_header("Cf-access-client-secret"))

    def test_rotated_refresh_returns_only_through_the_source(self):
        source = MemorySource(REFRESH_ONE)
        with pairing_server() as origin:
            client = ApiClient(origin, runtime_environment="production", agent_credentials=source)
            client.heartbeat("job-1", "t" * 64, 1)
            # 만료 경계를 지난 것처럼 두면 다음 요청이 회전된 값으로 교환한다(rotate-on-use).
            client._agent_bearer_expires_at = 0.0
            client.heartbeat("job-1", "t" * 64, 1)
        self.assertEqual(PairingHandler.exchanges, [REFRESH_ONE, REFRESH_TWO])
        self.assertEqual(source.writes, [REFRESH_TWO, REFRESH_THREE])
        self.assertEqual(source.token, REFRESH_THREE)

    def test_unauthorized_business_call_rotates_once_and_retries_once(self):
        source = MemorySource(REFRESH_ONE)
        with pairing_server() as origin:
            PairingHandler.reject_first_business_call = True
            client = ApiClient(origin, runtime_environment="production", agent_credentials=source)
            self.assertEqual(client.heartbeat("job-1", "t" * 64, 1), {"accepted": True})
        self.assertEqual(PairingHandler.exchanges, [REFRESH_ONE, REFRESH_TWO])
        self.assertEqual(
            PairingHandler.authorizations,
            [f"Bearer {BEARER_ONE}", f"Bearer {BEARER_TWO}"],
        )

    def test_second_unauthorized_answer_surfaces_without_another_rotation(self):
        source = MemorySource(REFRESH_ONE)
        with pairing_server() as origin:
            PairingHandler.reject_every_business_call = True
            client = ApiClient(origin, runtime_environment="production", agent_credentials=source)
            with self.assertRaises(ApiError) as caught:
                client.heartbeat("job-1", "t" * 64, 1)
        self.assertEqual(caught.exception.status, 401)
        # 401 두 번, 교환 두 번(최초 발급 + 재시도 앞 회전 1회)에서 멈춘다.
        self.assertEqual(len(PairingHandler.authorizations), 2)
        self.assertEqual(PairingHandler.exchanges, [REFRESH_ONE, REFRESH_TWO])
        for secret in (REFRESH_ONE, REFRESH_TWO, BEARER_ONE, BEARER_TWO):
            self.assertNotIn(secret, str(caught.exception))

    def test_pairing_credential_is_mutually_exclusive_with_legacy_lanes(self):
        source = MemorySource(REFRESH_ONE)
        with self.assertRaises(ValueError):
            ApiClient(
                "https://api.example", "cid", "csec",
                runtime_environment="production", agent_credentials=source,
            )
        with self.assertRaises(ValueError):
            ApiClient(
                "https://api.example",
                runtime_environment="preview",
                preview_access_code="fixture-preview-code",
                agent_credentials=source,
            )
        with self.assertRaises(ValueError):
            ApiClient("https://api.example", runtime_environment="production")

    def test_env_source_reads_once_and_keeps_rotation_in_memory(self):
        with mock.patch.dict(os.environ, {EnvAgentCredentialSource.ENV_NAME: REFRESH_ONE}, clear=False):
            source = EnvAgentCredentialSource()
            self.assertEqual(source.refresh_token(), REFRESH_ONE)
            source.store_refresh_token(REFRESH_TWO)
            self.assertEqual(source.refresh_token(), REFRESH_TWO)
            # 회전 값은 환경으로 되쓰지 않는다 — 다음 프로세스는 다시 주입받는다.
            self.assertEqual(os.environ[EnvAgentCredentialSource.ENV_NAME], REFRESH_ONE)
        with mock.patch.dict(os.environ, {EnvAgentCredentialSource.ENV_NAME: "  "}, clear=False):
            with self.assertRaises(ValueError):
                EnvAgentCredentialSource()


if __name__ == "__main__":
    unittest.main()
