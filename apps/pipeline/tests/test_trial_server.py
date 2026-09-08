"""Network contract tests for the internal STT trial server.

The processor is mocked: no model load, no download, no provider call, no credential
lookup. Every assertion here is about the HTTP boundary, the lifecycle and the
fixed error codes.
"""

import json
import os
import signal
import socket
import sys
import tempfile
import threading
import time
import unittest
from http.client import HTTPConnection
from pathlib import Path
from unittest import mock

from ccc_pipeline import trial_server
from ccc_pipeline.azure_stt import AzureSttError
from ccc_pipeline.qwen_runtime import QwenRuntimeError

AZURE_KEY_SENTINEL = "sentinel-azure-key-must-never-be-returned"
WAV = "audio/wav"


def _drain(raw: socket.socket) -> str:
    """Read a Connection: close response to the end, headers and body together."""
    answer = b""
    while True:
        block = raw.recv(4096)
        if not block:
            return answer.decode("ascii")
        answer += block


class TrialServerTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        base = Path(self.temp.name)
        self.root = base / "trials"
        self.work = base / "work"
        self.client_dir = base / "client"
        self.client_dir.mkdir()
        (self.client_dir / "index.html").write_text("<!doctype html>trial", encoding="utf-8")
        outside = base / "outside.txt"
        outside.write_text("must not be served", encoding="utf-8")

        self.calls = []
        self.failure = None
        self.external_evidence = None
        self.release = threading.Event()
        self.release.set()

        self.environment = mock.patch.dict(
            os.environ,
            {"CCC_STT_PYTHON": sys.executable, "CCC_STT_DEVICE": "cpu", "AZURE_SPEECH_KEY": ""},
        )
        self.environment.start()
        self.addCleanup(self.environment.stop)

        self.service = trial_server.TrialService(
            root=self.root,
            work_dir=self.work,
            client_dir=self.client_dir,
            runner=self.runner,
            device="cpu",
        )
        self.server = trial_server.TrialHTTPServer(("127.0.0.1", 0), self.service)
        self.port = self.server.server_address[1]
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.release.set()
        self.service.join(5)
        self.server.shutdown()
        self.thread.join(5)
        self.server.server_close()
        self.temp.cleanup()

    # ----- mocked processor -----

    def runner(self, args):
        audio = Path(args.audio)
        self.calls.append({
            "engine": args.engine,
            "model": args.model,
            "device": args.device,
            "outputDir": Path(args.output_dir),
            "audio": audio,
            "bytes": audio.read_bytes(),
            "declared": args.owned_test_recording,
            "allowAzureUpload": args.allow_azure_upload,
            "sttPython": args.stt_python,
        })
        self.release.wait(10)
        if self.failure is not None:
            raise self.failure
        output = Path(args.output_dir)
        output.mkdir(mode=0o700, parents=True, exist_ok=False)
        (output / "transcript.json").write_text(json.dumps({
            "segments": [
                {"start": 0.0, "end": 1.5, "text": "안녕하세요", "speaker": None, "warning": False},
                {"start": 1.5, "end": 2.0, "text": "SPEAKER_01 발화", "speaker": "SPEAKER_01",
                 "warning": False},
                {"start": 2.0, "end": 2.5, "text": "[반복 4회 접힘]", "speaker": None,
                 "warning": True},
            ],
            "repetitionWarnings": [
                {"start_index": 2, "end_index": 5, "count": 4, "start": 2.0, "end": 2.5,
                 "text": "접힌 원문은 응답에 나가지 않는다"},
            ],
            "forcedCuts": 1,
            "qualityEvaluation": "deferred",
        }), encoding="utf-8")
        trial = {
            "status": "completed",
            "engine": args.engine,
            "segmentCount": 3,
            "repetitionWarningCount": 1,
        }
        if self.external_evidence is not None:
            trial["externalUploadAttempted"] = self.external_evidence
        (output / "trial.json").write_text(json.dumps(trial), encoding="utf-8")
        return {"status": "completed", "outputDirectory": str(output), "segmentCount": 3}

    # ----- helpers -----

    def call(self, method, path, body=None, headers=None, connection=None):
        conn = connection or HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request(method, path, body=body, headers=headers or {})
        response = conn.getresponse()
        payload = response.read()
        result = (response.status, dict(response.getheaders()), payload)
        if connection is None:
            conn.close()
        return result

    def submit(self, engine="qwen3-asr", body=b"RIFFfake", extra=None, content_type=WAV,
               connection=None):
        headers = {
            "Content-Type": content_type,
            "X-CCC-Trial-Engine": engine,
            "X-CCC-Owned-Test-Recording": "1",
        }
        if engine == "azure":
            headers["X-CCC-Allow-External-Upload"] = "1"
        headers.update(extra or {})
        return self.call("POST", "/internal/stt/trials", body=body, headers=headers,
                         connection=connection)

    def wait_terminal(self, trial_id, connection=None):
        for _ in range(200):
            status, _, payload = self.call("GET", f"/internal/stt/trials/{trial_id}",
                                           connection=connection)
            self.assertEqual(200, status)
            body = json.loads(payload)
            if body["status"] in ("completed", "failed"):
                return body
            threading.Event().wait(0.05)
        self.fail("trial did not reach a terminal state")

    def uploads(self):
        return sorted(path.name for path in self.service.uploads.iterdir())

    # ----- boundary -----

    def test_cross_origin_submission_is_refused_before_any_processing(self):
        status, headers, payload = self.submit(extra={"Origin": "http://evil.example"})
        self.assertEqual(403, status)
        self.assertEqual({"error": "origin_not_allowed"}, json.loads(payload))
        self.assertEqual([], self.calls)
        self.assertNotIn("access-control-allow-origin", {key.lower() for key in headers})

    def test_same_origin_header_is_accepted(self):
        status, _, _ = self.submit(extra={"Origin": f"http://127.0.0.1:{self.port}"})
        self.assertEqual(202, status)

    def test_alias_origin_against_a_different_host_alias_is_refused(self):
        # 127.0.0.1 and localhost are different origins; the pair must not cross.
        status, _, payload = self.submit(extra={"Origin": f"http://localhost:{self.port}"})
        self.assertEqual(403, status)
        self.assertEqual({"error": "origin_not_allowed"}, json.loads(payload))
        self.assertEqual([], self.calls)

    def test_foreign_host_header_is_refused(self):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.putrequest("GET", "/internal/stt/status", skip_host=True)
        conn.putheader("Host", "evil.example")
        conn.endheaders()
        response = conn.getresponse()
        payload = response.read()
        conn.close()
        self.assertEqual(403, response.status)
        self.assertEqual({"error": "host_not_allowed"}, json.loads(payload))

    def test_no_cors_or_cache_leak_on_any_response(self):
        for method, path in (("GET", "/internal/stt/status"), ("GET", "/index.html")):
            status, headers, _ = self.call(method, path)
            lowered = {key.lower(): value for key, value in headers.items()}
            self.assertEqual(200, status)
            self.assertNotIn("access-control-allow-origin", lowered)
            self.assertEqual("no-store, private", lowered["cache-control"])
            self.assertEqual("nosniff", lowered["x-content-type-options"])
            policy = lowered["content-security-policy"]
            directives = dict(
                (part.split(" ", 1) + [""])[:2]
                for part in (item.strip() for item in policy.split(";"))
                if part
            )
            # The built client inlines the shared Wire CSS, so style is open and
            # script is not.
            self.assertIn("'unsafe-inline'", directives["style-src"])
            self.assertEqual("'self'", directives["script-src"])
            self.assertEqual("'none'", directives["frame-ancestors"])

    def test_options_is_not_a_preflight_surface(self):
        status, _, payload = self.call("OPTIONS", "/internal/stt/trials")
        self.assertEqual(405, status)
        self.assertEqual({"error": "method_not_allowed"}, json.loads(payload))

    def test_unsupported_method_answers_a_fixed_code_not_an_html_page(self):
        status, headers, payload = self.call("PATCH", "/internal/stt/status")
        self.assertEqual(501, status)
        self.assertEqual({"error": "method_not_allowed"}, json.loads(payload))
        lowered = {key.lower(): value for key, value in headers.items()}
        self.assertIn("content-security-policy", lowered)
        self.assertNotIn("PATCH", payload.decode("ascii"))

    def test_head_error_sends_no_body_so_the_next_response_stays_aligned(self):
        # One socket, no reconnect: a stray HEAD body would be read as the status
        # line of the following response.
        with socket.create_connection(("127.0.0.1", self.port), timeout=10) as raw:
            head = (
                f"HEAD /internal/stt/trials/{'f' * 32} HTTP/1.1\r\n"
                f"Host: 127.0.0.1:{self.port}\r\n\r\n"
            )
            follow = (
                f"GET /internal/stt/status HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n"
                "Connection: close\r\n\r\n"
            )
            raw.sendall(head.encode("ascii"))
            first = b""
            while b"\r\n\r\n" not in first:
                first += raw.recv(4096)
            self.assertIn(" 404 ", first.decode("ascii").splitlines()[0])
            self.assertTrue(first.endswith(b"\r\n\r\n"), first)
            raw.sendall(follow.encode("ascii"))
            second = _drain(raw)
        self.assertIn(" 200 ", second.splitlines()[0])
        self.assertIn('"internal-stt-trial"', second)

    # ----- status -----

    def test_status_reports_exact_engine_identity_without_secrets(self):
        with mock.patch.dict(os.environ, {"AZURE_SPEECH_KEY": AZURE_KEY_SENTINEL}):
            status, _, payload = self.call("GET", "/internal/stt/status")
        self.assertEqual(200, status)
        self.assertNotIn(AZURE_KEY_SENTINEL, payload.decode("ascii"))
        body = json.loads(payload)
        self.assertEqual("internal-stt-trial", body["purpose"])
        self.assertTrue(body["internal"])
        self.assertFalse(body["productActivation"])
        self.assertEqual(209715200, body["upload"]["maxBytes"])
        self.assertEqual(
            ["audio/mp4", "audio/mpeg", "audio/wav", "audio/webm", "audio/x-m4a", "audio/x-wav"],
            body["upload"]["contentTypes"],
        )
        self.assertFalse(body["busy"])
        self.assertIsNone(body["activeTrialId"])
        qwen = body["engines"]["qwen3-asr"]
        self.assertTrue(qwen["configured"])
        self.assertIsNone(qwen["reason"])
        self.assertEqual("Qwen/Qwen3-ASR-1.7B", qwen["modelId"])
        self.assertEqual("Qwen/Qwen3-ForcedAligner-0.6B", qwen["alignerId"])
        self.assertRegex(qwen["modelRevision"], r"^[0-9a-f]{40}$")
        self.assertRegex(qwen["alignerRevision"], r"^[0-9a-f]{40}$")
        azure = body["engines"]["azure"]
        self.assertTrue(azure["configured"])
        self.assertEqual("koreacentral", azure["region"])
        self.assertEqual("2025-10-15", azure["apiVersion"])
        self.assertTrue(azure["externalUploadAuthorizationRequired"])

    def test_status_marks_missing_configuration_without_claiming_readiness(self):
        with mock.patch.dict(os.environ, {"CCC_STT_PYTHON": "", "AZURE_SPEECH_KEY": ""}):
            _, _, payload = self.call("GET", "/internal/stt/status")
        body = json.loads(payload)
        self.assertFalse(body["engines"]["qwen3-asr"]["configured"])
        self.assertEqual("qwen_python_required", body["engines"]["qwen3-asr"]["reason"])
        self.assertFalse(body["engines"]["azure"]["configured"])
        self.assertEqual("azure_speech_key_missing", body["engines"]["azure"]["reason"])

    def test_status_reports_the_active_trial(self):
        self.release.clear()
        _, _, payload = self.submit()
        trial_id = json.loads(payload)["trialId"]
        _, _, status_payload = self.call("GET", "/internal/stt/status")
        body = json.loads(status_payload)
        self.assertTrue(body["busy"])
        self.assertEqual(trial_id, body["activeTrialId"])
        self.release.set()
        self.wait_terminal(trial_id)

    # ----- submission validation -----

    def test_missing_owned_recording_declaration_is_refused(self):
        status, _, payload = self.submit(extra={"X-CCC-Owned-Test-Recording": "0"})
        self.assertEqual(400, status)
        self.assertEqual({"error": "owned_test_recording_declaration_required"}, json.loads(payload))
        self.assertEqual([], self.calls)

    def test_azure_without_external_upload_authorization_is_refused(self):
        status, _, payload = self.submit(
            engine="azure", extra={"X-CCC-Allow-External-Upload": ""},
        )
        self.assertEqual(400, status)
        self.assertEqual({"error": "external_upload_not_authorized"}, json.loads(payload))
        self.assertEqual([], self.calls)

    def test_external_upload_flag_requires_azure(self):
        status, _, payload = self.submit(extra={"X-CCC-Allow-External-Upload": "1"})
        self.assertEqual(400, status)
        self.assertEqual({"error": "external_upload_flag_requires_azure"}, json.loads(payload))

    def test_azure_without_server_key_is_refused_as_configuration(self):
        status, _, payload = self.submit(engine="azure")
        self.assertEqual(409, status)
        self.assertEqual({"error": "azure_speech_key_missing"}, json.loads(payload))
        self.assertEqual([], self.calls)

    def test_qwen_without_isolated_python_is_refused_as_configuration(self):
        with mock.patch.dict(os.environ, {"CCC_STT_PYTHON": ""}):
            status, _, payload = self.submit()
        self.assertEqual(409, status)
        self.assertEqual({"error": "qwen_python_required"}, json.loads(payload))

    def test_unknown_engine_is_refused(self):
        status, _, payload = self.submit(engine="whisper")
        self.assertEqual(400, status)
        self.assertEqual({"error": "engine_invalid"}, json.loads(payload))

    def test_content_type_allowlist(self):
        status, _, payload = self.submit(content_type="audio/ogg")
        self.assertEqual(400, status)
        self.assertEqual({"error": "content_type_not_allowed"}, json.loads(payload))
        status, _, _ = self.submit(content_type="audio/webm;codecs=opus")
        self.assertEqual(202, status)

    def test_empty_body_is_refused(self):
        status, _, payload = self.submit(body=b"")
        self.assertEqual(400, status)
        self.assertEqual({"error": "audio_body_empty"}, json.loads(payload))

    def test_oversized_declaration_is_refused_without_reading_the_body(self):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.putrequest("POST", "/internal/stt/trials")
        conn.putheader("Content-Type", WAV)
        conn.putheader("Content-Length", str(trial_server.MAX_UPLOAD_BYTES + 1))
        conn.putheader("X-CCC-Trial-Engine", "qwen3-asr")
        conn.putheader("X-CCC-Owned-Test-Recording", "1")
        conn.endheaders()
        response = conn.getresponse()
        payload = response.read()
        conn.close()
        self.assertEqual(413, response.status)
        self.assertEqual({"error": "audio_too_large"}, json.loads(payload))
        self.assertEqual([], self.calls)
        self.assertEqual([], self.uploads())

    def test_ambiguous_framing_headers_are_refused(self):
        # Empty and duplicated values still leave the framing ambiguous, so
        # presence alone must reject.
        for framing in ("Transfer-Encoding: chunked\r\n",
                        "Transfer-Encoding: \r\n",
                        "Transfer-Encoding: \r\nTransfer-Encoding: chunked\r\n"):
            with self.subTest(framing=framing.strip()):
                with socket.create_connection(("127.0.0.1", self.port), timeout=10) as raw:
                    raw.sendall(
                        f"POST /internal/stt/trials HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n"
                        f"Content-Type: {WAV}\r\nContent-Length: 4\r\n{framing}"
                        "X-CCC-Trial-Engine: qwen3-asr\r\nX-CCC-Owned-Test-Recording: 1\r\n\r\n"
                        .encode("ascii") + b"RIFF"
                    )
                    answer = _drain(raw)
                self.assertIn(" 400 ", answer.splitlines()[0])
                self.assertIn('"chunked_body_not_supported"', answer)
                self.assertIn("Connection: close", answer)
                self.assertEqual([], self.calls)

    def test_short_body_is_reported_and_cleaned_up(self):
        with socket.create_connection(("127.0.0.1", self.port), timeout=10) as raw:
            raw.sendall(
                f"POST /internal/stt/trials HTTP/1.1\r\nHost: 127.0.0.1:{self.port}\r\n"
                f"Content-Type: {WAV}\r\nContent-Length: 4096\r\n"
                "X-CCC-Trial-Engine: qwen3-asr\r\nX-CCC-Owned-Test-Recording: 1\r\n\r\n"
                .encode("ascii") + b"RIFF"
            )
            raw.shutdown(socket.SHUT_WR)
            text = _drain(raw)
        self.assertIn(" 400 ", text.splitlines()[0])
        self.assertIn('"audio_body_incomplete"', text)
        self.assertEqual([], self.calls)
        self.assertEqual([], self.uploads())

    def test_second_submission_while_running_is_refused(self):
        self.release.clear()
        first_status, _, payload = self.submit()
        self.assertEqual(202, first_status)
        trial_id = json.loads(payload)["trialId"]
        second_status, _, second_payload = self.submit()
        self.assertEqual(409, second_status)
        self.assertEqual({"error": "trial_already_running"}, json.loads(second_payload))
        self.release.set()
        self.assertEqual("completed", self.wait_terminal(trial_id)["status"])
        self.assertEqual(1, len(self.calls))

    def test_a_frozen_service_refuses_new_work_on_an_open_connection(self):
        # Closing the listener does not stop handler threads, so the freeze must
        # be what stops a late reservation.
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            self.assertEqual(200, self.call("GET", "/internal/stt/status", connection=conn)[0])
            self.service.close()
            status, _, payload = self.submit(connection=conn)
        finally:
            conn.close()
        self.assertEqual(503, status)
        self.assertEqual({"error": "server_shutting_down"}, json.loads(payload))
        self.assertEqual([], self.calls)
        self.assertFalse(self.service.busy())

    # ----- run lifecycle -----

    def test_completed_trial_exposes_normalized_transcript(self):
        _, _, payload = self.submit(body=b"RIFFexample-bytes")
        submitted = json.loads(payload)
        self.assertEqual("queued", submitted["status"])
        self.assertRegex(submitted["trialId"], r"^[0-9a-f]{32}$")
        terminal = self.wait_terminal(submitted["trialId"])
        self.assertEqual("completed", terminal["status"])
        self.assertEqual(3, terminal["segmentCount"])
        self.assertEqual(1, terminal["repetitionWarningCount"])
        self.assertEqual("deferred", terminal["qualityEvaluation"])

        status, _, transcript_payload = self.call(
            "GET", f"/internal/stt/trials/{submitted['trialId']}/transcript",
        )
        self.assertEqual(200, status)
        transcript = json.loads(transcript_payload)
        self.assertEqual(1, transcript["forcedCuts"])
        self.assertEqual("deferred", transcript["qualityEvaluation"])
        self.assertNotIn("speaker", transcript["segments"][0])
        self.assertEqual("SPEAKER_01", transcript["segments"][1]["speaker"])
        self.assertTrue(transcript["segments"][2]["warning"])
        self.assertEqual(
            [{"start": 2.0, "end": 2.5, "count": 4, "reason": "repetition"}],
            transcript["repetitionWarnings"],
        )

        call = self.calls[0]
        self.assertEqual(b"RIFFexample-bytes", call["bytes"])
        self.assertIsNone(call["model"])
        self.assertTrue(call["declared"])
        self.assertFalse(call["allowAzureUpload"])
        self.assertEqual([], self.uploads())

    def test_unstorable_verdict_becomes_a_fixed_failure_not_a_thread_traceback(self):
        escaped = []
        with mock.patch.object(threading, "excepthook", escaped.append), \
             mock.patch.object(trial_server, "_write_json_exclusive",
                               side_effect=OSError("No space left on device")):
            _, _, payload = self.submit()
            trial_id = json.loads(payload)["trialId"]
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline and self.service.busy():
                time.sleep(0.05)
        # A storage failure must not surface as an unhandled worker exception.
        self.assertEqual([], escaped)
        self.assertFalse(self.service.busy())

        status, _, terminal = self.call("GET", f"/internal/stt/trials/{trial_id}")
        self.assertEqual(200, status)
        self.assertEqual(
            {"trialId": trial_id, "status": "failed", "engine": "qwen3-asr",
             "errorCode": "result_storage_failed", "externalUploadAttempted": False},
            json.loads(terminal),
        )
        self.assertNotIn("No space left", terminal.decode("ascii"))
        self.assertEqual(
            409,
            self.call("GET", f"/internal/stt/trials/{trial_id}/transcript")[0],
        )
        self.assertEqual(204, self.call("DELETE", f"/internal/stt/trials/{trial_id}")[0])

        # The next trial still runs and stores its own verdict.
        _, _, next_payload = self.submit()
        next_id = json.loads(next_payload)["trialId"]
        self.assertEqual("completed", self.wait_terminal(next_id)["status"])
        self.assertEqual([], escaped)

    def test_external_upload_is_false_for_local_and_only_recorded_for_azure(self):
        self.release.clear()
        _, _, payload = self.submit()
        running_id = json.loads(payload)["trialId"]
        _, _, running = self.call("GET", f"/internal/stt/trials/{running_id}")
        self.assertIs(False, json.loads(running)["externalUploadAttempted"])
        self.release.set()
        self.assertIs(False, self.wait_terminal(running_id)["externalUploadAttempted"])

        with mock.patch.dict(os.environ, {"AZURE_SPEECH_KEY": AZURE_KEY_SENTINEL}):
            self.external_evidence = True
            _, _, payload = self.submit(engine="azure")
            sent_id = json.loads(payload)["trialId"]
            self.assertIs(True, self.wait_terminal(sent_id)["externalUploadAttempted"])

            self.external_evidence = False
            _, _, payload = self.submit(engine="azure")
            held_id = json.loads(payload)["trialId"]
            self.assertIs(False, self.wait_terminal(held_id)["externalUploadAttempted"])

            # No readable record: unknown must stay null, never a reassuring False.
            self.external_evidence = None
            self.failure = AzureSttError("provider_transport_error", transient=True)
            _, _, payload = self.submit(engine="azure")
            unknown_id = json.loads(payload)["trialId"]
            terminal = self.wait_terminal(unknown_id)
            self.assertIsNone(terminal["externalUploadAttempted"])
            self.assertEqual("provider_unavailable", terminal["errorCode"])

            with mock.patch.object(trial_server, "_write_json_exclusive",
                                   side_effect=OSError("full")):
                _, _, payload = self.submit(engine="azure")
                unsaved_id = json.loads(payload)["trialId"]
                deadline = time.monotonic() + 10
                while time.monotonic() < deadline and self.service.busy():
                    time.sleep(0.05)
            self.assertIsNone(self.service.status(unsaved_id)["externalUploadAttempted"])
        self.failure = None

    def test_transcript_before_completion_is_refused(self):
        self.release.clear()
        _, _, payload = self.submit()
        trial_id = json.loads(payload)["trialId"]
        status, _, error = self.call("GET", f"/internal/stt/trials/{trial_id}/transcript")
        self.assertEqual(409, status)
        self.assertEqual({"error": "trial_not_completed"}, json.loads(error))
        self.release.set()
        self.wait_terminal(trial_id)

    def test_failures_map_to_fixed_codes_without_provider_text(self):
        cases = (
            (QwenRuntimeError("qwen_child_timeout"), "engine_timeout"),
            (QwenRuntimeError("model_snapshot_missing"), "engine_not_ready"),
            (QwenRuntimeError("sdk_output_invalid"), "engine_result_invalid"),
            (AzureSttError("provider_http_error", status=403), "provider_rejected"),
            (AzureSttError("malformed_response"), "engine_result_invalid"),
            (RuntimeError("raw provider text 40x must not surface"), "stt_execution_failed"),
        )
        for error, expected in cases:
            with self.subTest(expected=expected):
                self.failure = error
                _, _, payload = self.submit()
                trial_id = json.loads(payload)["trialId"]
                terminal = self.wait_terminal(trial_id)
                self.assertEqual("failed", terminal["status"])
                self.assertEqual(expected, terminal["errorCode"])
                self.assertNotIn("raw provider text", json.dumps(terminal))
                self.assertEqual([], self.uploads())
        self.failure = None

    def test_upload_copy_is_removed_after_failure(self):
        self.failure = QwenRuntimeError("inference_failed")
        _, _, payload = self.submit()
        trial_id = json.loads(payload)["trialId"]
        self.assertEqual("engine_execution_failed", self.wait_terminal(trial_id)["errorCode"])
        self.assertEqual([], self.uploads())
        self.assertFalse(self.calls[0]["audio"].exists())

    def test_a_second_trial_is_accepted_after_the_first_completes(self):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        try:
            first = json.loads(self.submit(connection=conn)[2])
            self.wait_terminal(first["trialId"], connection=conn)
            status, _, payload = self.submit(connection=conn)
            self.assertEqual(202, status)
            self.assertNotEqual(first["trialId"], json.loads(payload)["trialId"])
        finally:
            conn.close()

    # ----- deletion -----

    def test_delete_removes_only_terminal_results(self):
        self.release.clear()
        _, _, payload = self.submit()
        trial_id = json.loads(payload)["trialId"]
        status, _, error = self.call("DELETE", f"/internal/stt/trials/{trial_id}")
        self.assertEqual(409, status)
        self.assertEqual({"error": "trial_running"}, json.loads(error))
        self.release.set()
        self.wait_terminal(trial_id)

        status, _, body = self.call("DELETE", f"/internal/stt/trials/{trial_id}")
        self.assertEqual(204, status)
        self.assertEqual(b"", body)
        self.assertFalse((self.root / f"api-{trial_id}").exists())
        self.assertEqual(404, self.call("GET", f"/internal/stt/trials/{trial_id}")[0])

    def test_delete_of_unknown_or_malformed_id_is_not_found(self):
        self.assertEqual(404, self.call("DELETE", f"/internal/stt/trials/{'a' * 32}")[0])
        self.assertEqual(404, self.call("DELETE", "/internal/stt/trials/not-a-trial")[0])

    # ----- path safety -----

    def test_trial_path_traversal_is_not_found(self):
        for path in (
            "/internal/stt/trials/../../etc/passwd",
            "/internal/stt/trials/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
            "/internal/stt/unknown",
        ):
            with self.subTest(path=path):
                status, _, payload = self.call("GET", path)
                self.assertEqual(404, status)
                self.assertEqual({"error": "not_found"}, json.loads(payload))

    def test_static_serving_stays_inside_the_client_directory(self):
        status, headers, payload = self.call("GET", "/")
        self.assertEqual(200, status)
        self.assertIn("trial", payload.decode("utf-8"))
        self.assertEqual("text/html; charset=utf-8", headers["Content-Type"])
        for path in ("/../outside.txt", "/%2e%2e/outside.txt", "/missing.js"):
            with self.subTest(path=path):
                self.assertEqual(404, self.call("GET", path)[0])

    def test_static_symlink_escape_is_not_served(self):
        try:
            (self.client_dir / "escape.txt").symlink_to(Path(self.temp.name) / "outside.txt")
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable")
        self.assertEqual(404, self.call("GET", "/escape.txt")[0])


class LifecycleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)

    def service(self, runner=None):
        return trial_server.TrialService(
            root=self.base / "trials",
            work_dir=self.base / "work",
            runner=runner or (lambda args: self.fail("runner must not run")),
            device="cpu",
        )

    def test_upload_cleanup_never_touches_another_results_root(self):
        first = self.service()
        second = trial_server.TrialService(
            root=self.base / "other-trials",
            work_dir=self.base / "work",
            device="cpu",
        )
        live = first.uploads / "upload-live"
        live.write_bytes(b"another server is transcribing this")
        self.assertNotEqual(first.uploads, second.uploads)
        self.assertEqual(0, second.clear_stale_uploads())
        self.assertTrue(live.is_file())

    def test_interrupted_result_is_marked_failed_without_rerun(self):
        service = self.service()
        output = service.root / f"api-{'b' * 32}"
        (output / "chunks-left").mkdir(mode=0o700, parents=True)
        self.assertEqual([output.name], service.sweep())
        sidecar = json.loads((output / trial_server.SIDECAR_NAME).read_text(encoding="utf-8"))
        self.assertEqual("failed", sidecar["status"])
        self.assertEqual("interrupted", sidecar["errorCode"])
        self.assertFalse((output / "chunks-left").exists())
        self.assertEqual("interrupted", service.status("b" * 32)["errorCode"])

    def test_unreadable_sidecar_is_replaced_at_startup(self):
        service = self.service()
        output = service.root / f"api-{'e' * 32}"
        output.mkdir(mode=0o700, parents=True)
        # A kill mid-write leaves a truncated file that must not pass for a verdict.
        (output / trial_server.SIDECAR_NAME).write_text('{"status": "comp', encoding="utf-8")
        self.assertEqual([output.name], service.sweep())
        self.assertEqual("interrupted", service.status("e" * 32)["errorCode"])

    def test_sweep_keeps_a_finished_run_that_lost_its_sidecar(self):
        service = self.service()
        output = service.root / f"api-{'c' * 32}"
        output.mkdir(mode=0o700, parents=True)
        (output / "trial.json").write_text(json.dumps({
            "status": "completed", "engine": "qwen3-asr",
            "segmentCount": 7, "repetitionWarningCount": 0,
        }), encoding="utf-8")
        service.sweep()
        state = service.status("c" * 32)
        self.assertEqual("completed", state["status"])
        self.assertEqual(7, state["segmentCount"])

    def test_sweep_is_idempotent(self):
        service = self.service()
        output = service.root / f"api-{'d' * 32}"
        output.mkdir(mode=0o700, parents=True)
        self.assertEqual([output.name], service.sweep())
        self.assertEqual([], service.sweep())

    def test_single_instance_lock_refuses_a_second_server(self):
        service = self.service()
        lock = trial_server.acquire_single_instance(service.root, 8790)
        self.addCleanup(lock.unlink, True)
        with self.assertRaises(trial_server.HttpError) as raised:
            trial_server.acquire_single_instance(service.root, 8790)
        self.assertEqual("trial_server_already_running", raised.exception.code)

    def test_trial_root_inside_a_git_worktree_is_refused(self):
        checkout = self.base / "checkout"
        (checkout / ".git").mkdir(parents=True)
        with self.assertRaises(ValueError):
            trial_server.TrialService(root=checkout / "trials", work_dir=self.base / "work")

    def test_main_rejects_arguments(self):
        self.assertEqual(2, trial_server.main(["--port", "1"]))

    def test_stale_upload_copies_are_removed_at_startup(self):
        service = self.service()
        (service.uploads / "upload-dead").write_bytes(b"leftover original")
        (service.uploads / "keep.bin").write_bytes(b"not an upload")
        self.assertEqual(1, service.clear_stale_uploads())
        self.assertFalse((service.uploads / "upload-dead").exists())
        self.assertTrue((service.uploads / "keep.bin").exists())
        self.assertEqual(0, service.clear_stale_uploads())

    def test_shutdown_keeps_the_lock_while_a_trial_is_still_running(self):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        started = threading.Event()
        blocker = threading.Event()
        self.addCleanup(blocker.set)

        def slow_runner(args):
            started.set()
            blocker.wait(30)
            return {"status": "completed", "outputDirectory": str(args.output_dir),
                    "segmentCount": 0}

        def drive():
            deadline = time.monotonic() + 10
            while time.monotonic() < deadline:
                try:
                    conn = HTTPConnection("127.0.0.1", port, timeout=5)
                    conn.request("POST", "/internal/stt/trials", body=b"RIFFslow", headers={
                        "Content-Type": WAV,
                        "X-CCC-Trial-Engine": "qwen3-asr",
                        "X-CCC-Owned-Test-Recording": "1",
                    })
                    response = conn.getresponse()
                    response.read()
                    conn.close()
                    if response.status == 202:
                        break
                except OSError:
                    time.sleep(0.05)
            if not started.wait(10):
                return
            os.kill(os.getpid(), signal.SIGTERM)

        previous = signal.getsignal(signal.SIGTERM)
        self.addCleanup(signal.signal, signal.SIGTERM, previous)
        driver = threading.Thread(target=drive, daemon=True)
        with mock.patch.object(trial_server, "SHUTDOWN_GRACE_SECONDS", 0.3), \
             mock.patch.object(trial_server.stt_trial, "run_trial", slow_runner), \
             mock.patch.dict(os.environ, {
                 "CCC_STT_TRIAL_DIR": str(self.base / "live"),
                 "CCC_WORK_DIR": str(self.base / "livework"),
                 "CCC_STT_TRIAL_CLIENT_DIR": "",
                 "CCC_STT_TRIAL_PORT": str(port),
                 "CCC_STT_PYTHON": sys.executable,
                 "CCC_STT_DEVICE": "cpu",
             }):
            driver.start()
            code = trial_server.main([])
        driver.join(5)
        lock = self.base / "live" / trial_server.LOCK_NAME
        self.assertEqual(4, code)
        # Releasing the lock here would let a second server run beside the orphan.
        self.assertTrue(lock.is_file())
        with self.assertRaises(trial_server.HttpError):
            trial_server.acquire_single_instance(self.base / "live", port)
        # The abandoned worker outlives main(), so let it finish before teardown
        # removes the directory underneath it.
        blocker.set()
        deadline = time.monotonic() + 5
        results = self.base / "live"
        while time.monotonic() < deadline and not any(results.glob("api-*/server-trial.json")):
            time.sleep(0.05)


if __name__ == "__main__":
    unittest.main()
