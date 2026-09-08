"""Synthetic credentials only: exercise real HTTP and diagnostic boundaries."""

import contextlib
import io
import json
import threading
import unittest
from dataclasses import replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from ccc_pipeline.api_client import ApiClient, ApiError
from ccc_pipeline import __main__ as entrypoint
from test_api_client_worker import make_config


@contextlib.contextmanager
def server(handler):
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{httpd.server_port}"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join()


class QuietHandler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class SecretBoundariesTest(unittest.TestCase):
    def test_authenticated_redirect_never_reaches_another_origin(self):
        received = []

        class Destination(QuietHandler):
            def do_GET(self):
                received.append(dict(self.headers))
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b'{"text":"unexpected redirected source"}')

        with server(Destination) as destination:
            class Redirect(QuietHandler):
                def do_GET(self):
                    self.send_response(302)
                    self.send_header("Location", destination + "/stolen")
                    self.end_headers()

            with server(Redirect) as origin:
                client = ApiClient(origin, "synthetic-client", "synthetic-access-secret", runtime_environment="production")
                try:
                    client.get_source("job-1", "synthetic-claim-token", 1)
                except ApiError:
                    pass
        self.assertEqual(received, [], "Authenticated redirect reached a second origin")

    def test_upstream_error_cannot_echo_credentials_into_exception(self):
        class Reflection(QuietHandler):
            def do_POST(self):
                self.send_response(403)
                self.end_headers()
                self.wfile.write(json.dumps({"error": self.headers["CF-Access-Client-Secret"]}).encode())

        with server(Reflection) as origin:
            client = ApiClient(origin, "synthetic-client", "synthetic-reflected-secret", runtime_environment="production")
            with self.assertRaises(ApiError) as caught:
                client.claim_jobs({})
        self.assertEqual(caught.exception.status, 403)
        self.assertNotIn("synthetic-reflected-secret", str(caught.exception))
        self.assertEqual(caught.exception.code, "unknown")

    def test_config_diagnostics_hide_all_credentials(self):
        config = replace(make_config(Path("/tmp/synthetic-unused")), client_id="synthetic-client-id",
                         client_secret="synthetic-access-secret", preview_access_code="synthetic-preview-code",
                         hf_token="synthetic-model-token")
        for credential in (config.client_id, config.client_secret, config.preview_access_code, config.hf_token):
            self.assertNotIn(credential, repr(config))

    def test_once_failure_has_safe_stderr_and_nonzero_exit(self):
        output = io.StringIO()
        with (mock.patch("sys.argv", ["ccc_pipeline", "--once"]),
              mock.patch.object(entrypoint, "load_config", return_value=make_config(Path("/tmp/synthetic-unused"))),
              mock.patch.object(entrypoint, "assert_device_ready"),
              mock.patch.object(entrypoint, "run_once", side_effect=RuntimeError("synthetic-sensitive-failure")),
              contextlib.redirect_stderr(output)):
            result = entrypoint.main()
        self.assertNotEqual(result, 0)
        self.assertNotIn("synthetic-sensitive-failure", output.getvalue())


if __name__ == "__main__":
    unittest.main()
