"""Exercise the real worker and HTTP transport with protocol-only NER stubs.

This is not a real NER qualification, backend authorization or whole-process
zeroization proof. It never contacts a provider or a deployed CCC API.
"""
import json
import sys
import threading
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory

from ccc_pipeline import worker
from ccc_pipeline.api_client import ApiClient
from ccc_pipeline.backup import BackupPolicy
from ccc_pipeline.config import Config
from ccc_pipeline.results import canonical_sha256, sha256_hex

VAULT = {"name":"박하늘","phone":"010-5555-1212","email":"synthetic@example.test","account":"110-222-333333","birthDate":"1985-03-27","region":"서울특별시 은평구","gender":"여성","address":"서울특별시 은평구 통일로 1","emergencyContact":"010-5555-3434","beneficiaryId":"beneficiary-raw-7","organizationId":"org-raw-2"}
TITLES = ["이름", "전화", "이메일", "계좌", "생일", "지역", "성별", "주소", "긴급", "당사자키", "기관키"]
REPLACEMENTS = {"birthDate":"[생년월]", "region":"서울시", "gender":"[성별]"}
G1 = "|".join(f"{label}={value}" for label, value in zip(TITLES, VAULT.values()))
G3 = "2026-09-03에 37세인 당사자가 서울시 은평구에서 지난달 이사했다."
EXPECTED_HASHES = {"g1":"e82c1a66fdae5ed181fa1e84055518d800e76cde64fc84971e8f8dac96a31fec", "g3":"5b47d52082471b6328890e2d07d8d205a3d55894ca163c32380d07a442fde237"}
RESULTS = {}
RELEASES = []

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def respond(self, status, value=None):
        payload = b"" if value is None else json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        job_id = self.path.split("/")[-2]
        self.respond(200, {"sessionId":"synthetic-session", "text":G1 if job_id == "g1" else G3})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
        operation = self.path.split("/")[-1]
        if operation == "claim":
            self.respond(200, {"schemaVersion":2, "jobs":[{"jobId":name, "sessionId":"synthetic-session", "kind":"text", "attempt":1, "claimToken":"a"*64} for name in ("g1", "g3", "reject")]})
            return
        job_id = self.path.split("/")[-2]
        if operation == "mask-dictionary":
            entries = [{"field":field,"sourceValue":value,"replacement":REPLACEMENTS.get(field,"swallow-003")} for field,value in VAULT.items()] if job_id == "g1" else []
            if job_id == "reject":
                entries = [{"field":"name","sourceValue":"합성원문","replacement":"다른원문"},{"field":"address","sourceValue":"다른원문","replacement":"swallow-003"}]
            expiry = datetime.now(timezone.utc) + timedelta(minutes=4)
            self.respond(200, {"dictionaryId":"protocol-only-dictionary", "jobId":job_id, "expiresAt":expiry.isoformat().replace("+00:00","Z"), "oneTime":True, "entries":entries})
        elif operation == "result":
            RESULTS[job_id] = body
            self.respond(204)
        elif operation == "release":
            RELEASES.append(body)
            self.respond(204)
        else:
            self.respond(404, {"error":"not_found"})

def main():
    destination = Path(sys.argv[1])
    if destination.exists():
        raise SystemExit("refusing to overwrite evidence")
    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print("PRIVACY_WORKER_SMOKE_READY", flush=True)
    original_builder = worker._build_person_and_address_ner
    worker._build_person_and_address_ner = lambda config: (lambda text: [], lambda text: [])
    try:
        with TemporaryDirectory() as directory:
            now = datetime.now(timezone.utc)
            attestation = {"id":"synthetic-protocol-attestation","modelId":"FrameByFrame/korean-pii-e5-base","modelRevision":"a308c54b4407819624a5661e31e162a269f39818","labelSetHash":"b645305b068070375d95b18979ead77ec584833f6670dd82554605e9ccf4a4fc","corpusHash":"35565215b87909aad5a44c3124a7240ea80151136c9a12846fde05b861b7be59","resultHash":"fd02b5efd65f04f9814959875cefb76b1fa9596e34bd0441aa452be7224f1c72","validatedAt":now.isoformat(),"expiresAt":(now+timedelta(hours=24)).isoformat(),"status":"passed"}
            config = Config(api_base_url=f"http://127.0.0.1:{server.server_port}",client_id="synthetic-id",client_secret="synthetic-secret",preview_access_code=None,poll_interval_seconds=1,work_dir=Path(directory),whisper_model="medium",stt_engine="off",stt_max_chunk_seconds=180,stt_min_chunk_seconds=30,stt_repeat_threshold=4,ner_model_id=attestation["modelId"],ner_labels=("PRIVATE_PERSON",),address_labels=("PRIVATE_ADDRESS",),condition_ner_model_id=None,condition_ner_labels=("DS",),hf_token=None,runtime_environment="production",ner_attestation=attestation,ner_release_receipt_id="synthetic-protocol-receipt",backup_policy=BackupPolicy())
            client = ApiClient(config.api_base_url, config.client_id, config.client_secret, runtime_environment="production")
            assert worker.run_once(client, config) == 2
            assert set(RESULTS) == {"g1", "g3"}
            for job_id, request in RESULTS.items():
                result = request["result"]
                assert sha256_hex(result["maskedText"]) == EXPECTED_HASHES[job_id] == result["sha256"]
                assert result["evidence"][0]["sourceEnd"] == (147 if job_id == "g1" else 37)
                assert result["evidence"][0]["evidenceQuote"] == result["maskedText"]
                assert result["evidenceHash"] == canonical_sha256(result["evidence"])
                assert request["payloadSha256"] == canonical_sha256({"schemaVersion":2,"attempt":1,"result":result})
            assert len(RELEASES) == 1 and RELEASES[0]["outcome"] == "permanent" and RELEASES[0]["reason"] == "masking_failed"
            assert not list(Path(directory).iterdir())
            proof = {"status":"passed","syntheticOnly":True,"transport":"localhost HTTP","actualWorker":True,"nerStubbed":True,"attestationIsSynthetic":True,"modelLoads":0,"providerCalls":0,"sttCalls":0,"postedResults":2,"rejectedResults":1,"g1CodePoints":147,"g3CodePoints":37,"bodyEvidencePayloadHashesVerified":True,"temporaryFiles":0,"nerQualificationProved":False,"wholeProcessZeroizationQualified":False}
            proof["reportHash"] = canonical_sha256(proof)
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(json.dumps(proof, sort_keys=True, indent=2)+"\n")
            print(json.dumps(proof), flush=True)
    finally:
        worker._build_person_and_address_ner = original_builder
        server.shutdown()
        server.server_close()
        thread.join()
        RESULTS.clear()
        RELEASES.clear()

if __name__ == "__main__":
    main()
