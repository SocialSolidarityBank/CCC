import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import main


class PrototypeApiBoundaryTest(unittest.TestCase):
    def setUp(self):
        main.SESSIONS.clear()

    def _client(self, role: str) -> TestClient:
        client = TestClient(main.app, base_url="http://127.0.0.1")
        token = main._issue(role)
        client.cookies.set("proto_session", token)
        return client

    @patch("main.sheets.create_participant", return_value={"participant_id": "p-test"})
    def test_admin_cannot_create_participant(self, create_participant):
        response = self._client("admin").post(
            "/api/participants",
            json={"name": "테스트", "phone": "", "email": "", "birth_date": ""},
        )

        self.assertEqual(response.status_code, 403)
        create_participant.assert_not_called()

    @patch("main.sheets.get_session", return_value=({"draft_json": ""}, 2))
    @patch("main.sheets.update_session")
    def test_session_without_ai_draft_cannot_be_approved(self, update_session, get_session):
        response = self._client("staff").post("/api/sessions/s-test/approve")

        self.assertEqual(response.status_code, 409)
        update_session.assert_not_called()

    def test_host_name_must_be_exactly_loopback(self):
        client = TestClient(main.app, base_url="http://localhost.evil")

        response = client.get("/api/me")

        self.assertEqual(response.status_code, 403)


if __name__ == "__main__":
    unittest.main()
