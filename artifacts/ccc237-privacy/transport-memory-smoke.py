"""Synthetic local HTTP and native-memory proof. Does not load NER or call providers."""
import ctypes
import io
import json
import mmap
import resource
import sys
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

from ccc_pipeline.api_client import ApiClient, ApiError
from ccc_pipeline.secure_memory import SensitiveBuffer, SecureMemoryError, load_sensitive_json

CANARY = "RAW_SYNTHETIC_CANARY"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass

    def respond(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if "/error/" in self.path:
            self.respond(403, {"error": CANARY, "detail": CANARY})
        else:
            self.respond(200, {"text": CANARY})

    def do_POST(self):
        if "/error/" in self.path:
            self.respond(409, {"error": "dictionary_already_consumed"})
            return
        self.rfile.read(int(self.headers.get("Content-Length", "0")))
        self.respond(200, {
            "dictionaryId": "synthetic-opaque-id", "jobId": "synthetic-job", "oneTime": True,
            "expiresAt": (datetime.now(timezone.utc) + timedelta(minutes=4)).isoformat().replace("+00:00", "Z"),
            "entries": [{"field": "name", "sourceValue": CANARY, "replacement": "swallow-001"}],
        })


def main():
    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print("SMOKE_READY", flush=True)
    proof = {"syntheticOnly": True, "modelLoads": 0, "providerCalls": 0, "windowsMeasured": False}
    try:
        client = ApiClient(f"http://127.0.0.1:{server.server_port}", "synthetic-id", "synthetic-secret", runtime_environment="production")
        proof["sourceTransport"] = client.get_source("synthetic-job", "synthetic-claim", 1) == CANARY
        dictionary = client.get_mask_dictionary("synthetic-job", "synthetic-claim", 1)
        proof["dictionaryTransport"] = dictionary["entries"][0]["sourceValue"] == CANARY
        dictionary.clear()
        try:
            client.get_source("error", "synthetic-claim", 1)
        except ApiError as error:
            proof["errorSanitized"] = error.code == "unknown" and CANARY not in str(error)
            proof["errorContextDetached"] = error.__context__ is None
        else:
            raise AssertionError("expected sanitized HTTP rejection")

        with SensitiveBuffer(mmap.PAGESIZE) as buffer:
            with buffer.view() as view:
                view[:len(CANARY)] = CANARY.encode()
                address = ctypes.addressof(ctypes.c_char.from_buffer(view))
                proof["nativeLockSucceeded"] = buffer.locked
                buffer.wipe()
                proof["independentNativeReadObservedZeroes"] = ctypes.string_at(address, mmap.PAGESIZE) == bytes(mmap.PAGESIZE)
                proof["ownedMappingDumpExcluded"] = buffer.dump_excluded

        limits = resource.getrlimit(resource.RLIMIT_MEMLOCK)
        unread = io.BytesIO(b'{"value":"RAW_SYNTHETIC_CANARY"}')
        try:
            resource.setrlimit(resource.RLIMIT_MEMLOCK, (0, limits[1]))
            try:
                load_sensitive_json(unread)
            except SecureMemoryError:
                proof["nativeLockFailureClosedBeforeRead"] = unread.tell() == 0
            else:
                raise AssertionError("unlocked input was accepted")
            try:
                client.get_mask_dictionary("error", "synthetic-claim", 1)
            except ApiError as error:
                proof["errorBodyLockFailurePreservesMaskingPhase"] = error.code == "masking_input_invalid"
            else:
                raise AssertionError("expected masking-phase lock rejection")
        finally:
            resource.setrlimit(resource.RLIMIT_MEMLOCK, limits)
        proof["observerLimitRestored"] = resource.getrlimit(resource.RLIMIT_MEMLOCK) == limits
        required = ("sourceTransport", "dictionaryTransport", "errorSanitized", "errorContextDetached", "nativeLockSucceeded", "independentNativeReadObservedZeroes", "nativeLockFailureClosedBeforeRead", "errorBodyLockFailurePreservesMaskingPhase", "observerLimitRestored")
        assert all(proof.get(key) is True for key in required), "smoke contract failed"
        proof["wholeProcessZeroizationQualified"] = False
        proof["note"] = "Heap parser copies are wiped but not page-locked; immutable strings, HTTP/TLS/model internals, dumps and hibernation are outside this proof. RLIMIT fault injection affects only this temporary process and is restored."
        Path(sys.argv[1]).write_text(json.dumps(proof, indent=2) + "\n")
        print(json.dumps(proof), flush=True)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == "__main__":
    main()
