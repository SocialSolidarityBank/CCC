"""Agent 작업 계약 v2 (S5 · E5-1a) — client 자격, claim 순서 처리, 종료 신호 1회,
2차 마스킹, fail-closed 경로를 고정한다."""

import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from dataclasses import replace
from unittest import mock

from ccc_pipeline import api_client as api_client_module
from ccc_pipeline.api_client import ApiClient, ApiError, USER_AGENT
from ccc_pipeline.backup import BackupPolicy
from ccc_pipeline.config import Config, ConfigError, load_config
from ccc_pipeline.masking import MaskingConfigError
from ccc_pipeline.results import canonical_sha256, sha256_hex
from ccc_pipeline.worker import (
    claim_request,
    masking_pipeline_hash,
    masking_pipeline_version,
    process_text_job,
    run_once,
)

ATTESTATION = {
    "id": "attestation-fixture",
    "modelId": "FrameByFrame/korean-pii-e5-base",
    "modelRevision": "fixture-rev-1",
    "labelSetHash": "a" * 64,
    "corpusHash": "b" * 64,
    "resultHash": "c" * 64,
    "validatedAt": "2026-09-01T00:00:00.000Z",
    "expiresAt": "2099-01-01T00:00:00.000Z",
    "status": "passed",
}
RECEIPT_ID = "receipt-fixture"


def make_config(work_dir: Path) -> Config:
    return Config(
        api_base_url="https://api.example",
        client_id="cid",
        client_secret="csec",
        preview_access_code=None,
        poll_interval_seconds=1,
        work_dir=work_dir,
        whisper_model="medium",
        stt_engine="whisper",
        stt_max_chunk_seconds=180.0,
        stt_min_chunk_seconds=30.0,
        stt_repeat_threshold=4,
        ner_model_id="fixture/person-ner",
        ner_labels=("PS", "PER", "NAME"),
        address_labels=("LC", "ADDRESS", "PRIVATE_ADDRESS"),
        condition_ner_model_id=None,
        condition_ner_labels=("DS",),
        hf_token=None,
        ner_attestation=dict(ATTESTATION),
        ner_release_receipt_id=RECEIPT_ID,
        runtime_environment="production",
        backup_policy=BackupPolicy(),
    )


def text_job(job_id: str = "job-text-1", attempt: int = 1) -> dict:
    return {
        "jobId": job_id,
        "sessionId": "session-1",
        "kind": "text",
        "state": "leased",
        "attempt": attempt,
        "claimToken": "t" * 64,
        "audio": None,
    }


def audio_job(job_id: str = "job-audio-1", attempt: int = 1) -> dict:
    return {
        "jobId": job_id,
        "sessionId": "session-2",
        "kind": "audio",
        "state": "leased",
        "attempt": attempt,
        "claimToken": "u" * 64,
        "audio": {"generationId": "generation-1", "delivery": "api-stream"},
    }


def dictionary_client(entries: list[dict] | None = None) -> mock.Mock:
    client = mock.Mock()
    client.get_mask_dictionary.return_value = {
        "dictionaryId": "dictionary-1",
        "jobId": "job-text-1",
        "expiresAt": "2099-01-01T00:00:00.000Z",
        "oneTime": True,
        "entries": entries or [],
    }
    return client


class FakeResponse(io.BytesIO):
    def __init__(self, payload: bytes, status: int = 200):
        super().__init__(payload)
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
        return False


class ApiClientTest(unittest.TestCase):
    def test_requests_carry_service_token_headers_and_ua(self):
        client = ApiClient("https://api.example/", "cid", "csec", runtime_environment="production")
        request = client._request("POST", "/pipeline/jobs/claim", {"limit": 10})
        # Cloudflare 1010 차단 회피: 기본 python UA 대신 명시 UA
        self.assertEqual(request.get_header("User-agent"), USER_AGENT)
        self.assertEqual(request.get_header("Cf-access-client-id"), "cid")
        self.assertEqual(request.get_header("Cf-access-client-secret"), "csec")
        self.assertEqual(request.full_url, "https://api.example/pipeline/jobs/claim")

    def test_claim_bound_get_sends_credentials_in_headers_not_the_url(self):
        client = ApiClient("https://api.example", "cid", "csec", runtime_environment="production")
        request = client._request("GET", "/pipeline/jobs/job-1/source", claim=("t" * 64, 2))
        self.assertEqual(request.get_header("X-ccc-job-claim"), "t" * 64)
        self.assertEqual(request.get_header("X-ccc-job-attempt"), "2")
        self.assertNotIn("t" * 64, request.full_url)

    def test_preview_unlocks_with_preview_code_and_never_sends_access_headers(self):
        client = ApiClient(
            "https://ccc-api-preview.account-855.workers.dev",
            runtime_environment="preview",
            preview_access_code="preview-fixture-code",
        )
        unlock = FakeResponse(json.dumps({"token": "preview-token", "maxAgeSeconds": 604800}).encode())
        claimed = FakeResponse(json.dumps({"schemaVersion": 2, "jobs": []}).encode())
        with mock.patch.object(api_client_module.urllib.request, "urlopen", side_effect=[unlock, claimed]) as open_url:
            self.assertEqual(client.claim_jobs({"limit": 10}), [])

        unlock_request = open_url.call_args_list[0].args[0]
        claim_http_request = open_url.call_args_list[1].args[0]
        self.assertEqual(unlock_request.full_url, "https://ccc-api-preview.account-855.workers.dev/preview/unlock")
        self.assertNotIn("Cf-access-client-id", claim_http_request.headers)
        self.assertNotIn("Cf-access-client-secret", claim_http_request.headers)
        self.assertEqual(claim_http_request.get_header("Cookie"), "ccc_preview=preview-token")

    def test_claim_requires_schema_version_two(self):
        client = ApiClient("https://api.example", "cid", "csec", runtime_environment="production")
        payload = json.dumps({"schemaVersion": 1, "jobs": [{"jobId": "job-1"}]}).encode()
        with mock.patch.object(api_client_module.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            with self.assertRaises(ApiError):
                client.claim_jobs({})

    def test_claim_parses_jobs(self):
        client = ApiClient("https://api.example", "cid", "csec", runtime_environment="production")
        payload = json.dumps({"schemaVersion": 2, "jobs": [text_job()]}).encode()
        with mock.patch.object(api_client_module.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            jobs = client.claim_jobs({})
        self.assertEqual(jobs[0]["jobId"], "job-text-1")

    def test_http_error_maps_to_api_error_without_body_leak(self):
        client = ApiClient("https://api.example", "cid", "csec", runtime_environment="production")
        error = api_client_module.urllib.error.HTTPError(
            "https://api.example/x", 403, "Forbidden", None, io.BytesIO(b'{"error":"forbidden","secret":"x"}')
        )
        with mock.patch.object(api_client_module.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(ApiError) as caught:
                client.claim_jobs({})
        self.assertEqual(caught.exception.status, 403)
        # 서버 error 코드만 담기고 나머지 본문은 예외 메시지에 실리지 않는다 (R3)
        self.assertNotIn("secret", str(caught.exception))

    def test_download_audio_writes_bytes_with_claim_credentials(self):
        client = ApiClient("https://api.example", "cid", "csec", runtime_environment="production")
        with TemporaryDirectory() as tmp:
            dest = Path(tmp) / "nested" / "audio.bin"
            with mock.patch.object(
                api_client_module.urllib.request, "urlopen", return_value=FakeResponse(b"RIFFdata"),
            ) as open_url:
                client.download_audio("job-1", "t" * 64, 1, dest)
            self.assertEqual(dest.read_bytes(), b"RIFFdata")
            self.assertEqual(open_url.call_args.args[0].get_header("X-ccc-job-attempt"), "1")


class ClaimRequestTest(unittest.TestCase):
    def test_claim_request_carries_attestation_and_receipt(self):
        with TemporaryDirectory() as tmp:
            request = claim_request(make_config(Path(tmp)), 4)
        self.assertEqual(request["limit"], 4)
        self.assertEqual(request["nerAttestation"], ATTESTATION)
        self.assertEqual(request["releaseQualificationReceiptId"], RECEIPT_ID)

    def test_masking_version_and_hash_record_which_layers_ran(self):
        with TemporaryDirectory() as tmp:
            base = make_config(Path(tmp))
            # 어느 계층이 실제로 돌았는지가 스냅샷 기록에서 구분돼야 한다.
            self.assertEqual(masking_pipeline_version(base), "ner-mask-v1-addr-cond-dict")
            with_cond = replace(base, condition_ner_model_id="fixture/cond-ner")
            self.assertEqual(masking_pipeline_version(with_cond), "ner-mask-v1-addr-cond-ner")
            no_addr = replace(base, address_labels=())
            self.assertEqual(masking_pipeline_version(no_addr), "ner-mask-v1-noaddr-cond-dict")
            # 서버는 lower-case hex64 만 받는다. 구성이 바뀌면 지문도 바뀐다.
            self.assertRegex(masking_pipeline_hash(base), r"^[0-9a-f]{64}$")
            self.assertNotEqual(masking_pipeline_hash(base), masking_pipeline_hash(with_cond))


class RunOnceTest(unittest.TestCase):
    def test_no_jobs_returns_zero(self):
        client = mock.Mock()
        client.claim_jobs.return_value = []
        with TemporaryDirectory() as tmp:
            self.assertEqual(run_once(client, make_config(Path(tmp))), 0)

    def test_processes_claimed_jobs_in_order_and_survives_one_failure(self):
        client = mock.Mock()
        client.claim_jobs.return_value = [audio_job(), text_job(), {"kind": "text"}]
        with TemporaryDirectory() as tmp:
            config = make_config(Path(tmp))
            with (
                mock.patch("ccc_pipeline.worker.process_audio_job", side_effect=RuntimeError("gpu oom")) as audio,
                mock.patch("ccc_pipeline.worker.process_text_job") as text,
            ):
                self.assertEqual(run_once(client, config), 1)
                self.assertEqual(audio.call_count, 1)
                self.assertEqual(text.call_count, 1)
        # 엔진 실패는 같은 route·engine 으로 재시도할 transient release 다.
        client.release.assert_called_once_with("job-audio-1", "u" * 64, 1, "transient", "engine_unavailable")

    def test_missing_person_ner_releases_blocked_without_spending_an_attempt(self):
        client = dictionary_client()
        client.claim_jobs.return_value = [text_job()]
        client.get_source.return_value = "아들 김철수가 보증을 섰다고 함."
        with TemporaryDirectory() as tmp:
            config = replace(make_config(Path(tmp)), ner_model_id=None)
            self.assertEqual(run_once(client, config), 0)
        client.post_result.assert_not_called()
        client.release.assert_called_once_with("job-text-1", "t" * 64, 1, "blocked", "local_ner_unavailable")

    def test_server_rejection_is_not_overwritten_by_a_release(self):
        client = dictionary_client()
        client.claim_jobs.return_value = [text_job()]
        client.get_source.return_value = "MASKED source"
        client.post_result.side_effect = ApiError(422, "stale_claim")
        with TemporaryDirectory() as tmp:
            with mock.patch(
                "ccc_pipeline.worker._build_person_and_address_ner",
                return_value=(lambda text: [], None),
            ):
                self.assertEqual(run_once(client, make_config(Path(tmp))), 0)
        # 서버가 이미 상태를 정한 코드는 release 로 덧쓰지 않는다(terminal 은 하나).
        client.release.assert_not_called()

    def test_live_lease_rejection_is_closed_by_the_agent(self):
        """422 라도 작업이 임대 중이면 Agent 가 닫는다 — 안 닫으면 attempt 가 타 없어진다."""
        client = dictionary_client()
        client.claim_jobs.return_value = [text_job()]
        client.get_source.return_value = "무응답"
        for code, expected in (
            ("local_ner_unavailable", ("blocked", "local_ner_unavailable")),
            ("result_schema_invalid", ("permanent", "result_schema_invalid")),
            ("evidence_hash_mismatch", ("permanent", "permanent_failure")),
            ("stale_claim", None),
        ):
            client.release.reset_mock()
            client.post_result.side_effect = ApiError(422, code)
            with TemporaryDirectory() as tmp, mock.patch(
                "ccc_pipeline.worker._build_person_and_address_ner",
                return_value=(lambda text: [], None),
            ):
                self.assertEqual(run_once(client, make_config(Path(tmp))), 0)
            if expected is None:
                client.release.assert_not_called()
            else:
                client.release.assert_called_once_with("job-text-1", "t" * 64, 1, *expected)

    def test_masking_layers_load_before_transcription(self):
        """NER 이 없으면 전사·provider 호출 전에 닫힌다 — blocked 경로는 provider 0회다(S5 F7)."""
        client = dictionary_client()
        client.claim_jobs.return_value = [audio_job()]
        with TemporaryDirectory() as tmp:
            config = replace(make_config(Path(tmp)), ner_model_id=None)
            with mock.patch("ccc_pipeline.worker.transcribe_audio") as transcribe:
                self.assertEqual(run_once(client, config), 0)
                transcribe.assert_not_called()
        client.download_audio.assert_not_called()
        client.release.assert_called_once_with("job-audio-1", "u" * 64, 1, "blocked", "local_ner_unavailable")

    def test_result_submission_retries_the_same_payload_after_a_server_error(self):
        client = dictionary_client()
        client.claim_jobs.return_value = [text_job()]
        client.get_source.return_value = "MASKED source"
        client.post_result.side_effect = [ApiError(502, "bad gateway"), None]
        with TemporaryDirectory() as tmp:
            with mock.patch(
                "ccc_pipeline.worker._build_person_and_address_ner",
                return_value=(lambda text: [], None),
            ):
                self.assertEqual(run_once(client, make_config(Path(tmp))), 1)
        # 같은 payload 재전송은 서버에서 멱등이고, 결과 수락 뒤 후속 단계를 이어간다.
        self.assertEqual(client.post_result.call_count, 2)
        first, second = client.post_result.call_args_list
        self.assertEqual(first.args[1]["payloadSha256"], second.args[1]["payloadSha256"])
        client.release.assert_not_called()

    def test_generic_400_does_not_retry_with_a_legacy_payload(self):
        client = dictionary_client()
        client.claim_jobs.return_value = [text_job()]
        client.get_source.return_value = "MASKED source"
        client.post_result.side_effect = ApiError(400, "invalid_request")
        with TemporaryDirectory() as tmp:
            with mock.patch(
                "ccc_pipeline.worker._build_person_and_address_ner",
                return_value=(lambda text: [], None),
            ):
                run_once(client, make_config(Path(tmp)))
        self.assertEqual(client.post_result.call_count, 1)
        # 코드를 알 수 없는 거부도 작업은 임대 중이므로 permanent 로 닫는다.
        client.release.assert_called_once_with("job-text-1", "t" * 64, 1, "permanent", "permanent_failure")


class TextJobTest(unittest.TestCase):
    def test_masks_source_and_posts_a_v2_result_with_contract_hashes(self):
        client = dictionary_client([
            {"field": "phone", "sourceValue": "010-1234-5678", "replacement": "swallow-003"},
        ])
        client.get_source.return_value = "아들 김철수에게 010-1234-5678 로 연락한다고 함"

        # 인명 NER 대역 — 실제 모델 대신 "김철수" 스팬만 돌려준다(transformers 미설치 환경).
        def fake_person_ner(text: str):
            start = text.find("김철수")
            return [] if start < 0 else [(start, start + len("김철수"))]

        with TemporaryDirectory() as tmp:
            with mock.patch(
                "ccc_pipeline.worker._build_person_and_address_ner",
                return_value=(fake_person_ner, None),
            ):
                process_text_job(client, make_config(Path(tmp)), text_job())

        job_id, request = client.post_result.call_args.args
        self.assertEqual(job_id, "job-text-1")
        self.assertEqual(request["schemaVersion"], 2)
        self.assertEqual(request["claimToken"], "t" * 64)
        self.assertEqual(request["attempt"], 1)
        result = request["result"]
        self.assertEqual(result["kind"], "text")
        # 등록 PII 는 일회성 사전이 먼저 치우고, 제3자 이름은 NER 이 가린다(R3 2단 방어).
        self.assertNotIn("010-1234-5678", result["maskedText"])
        self.assertIn("swallow-003", result["maskedText"])
        self.assertNotIn("김철수", result["maskedText"])
        self.assertIn("[인명]", result["maskedText"])
        # hash 3종은 서버가 다시 계산해 대조한다.
        self.assertEqual(result["sha256"], sha256_hex(result["maskedText"]))
        self.assertEqual(result["evidenceHash"], canonical_sha256(result["evidence"]))
        self.assertEqual(request["payloadSha256"], canonical_sha256({
            "schemaVersion": 2,
            "attempt": 1,
            "result": result,
        }))
        # S6 metadata 와 release 영수증이 결과에 함께 실린다.
        self.assertEqual(result["nerAttestationId"], ATTESTATION["id"])
        self.assertEqual(result["nerAttestationResultHash"], ATTESTATION["resultHash"])
        self.assertEqual(result["releaseQualificationReceiptId"], RECEIPT_ID)
        self.assertTrue(result["nerAvailable"])
        # 텍스트 결과에는 오디오 전용 필드가 없다.
        self.assertNotIn("emotionScores", result)
        self.assertNotIn("transcriptWarnings", result)

    def test_goal_section_labels_survive_masking_and_goal_text_is_masked(self):
        """서버가 원문에 싣는 `[전체 목표]`·`[세부 목표]`·`[회기 목표]` 라벨은 남고,
        라벨 뒤 목표 문구 속 인명은 다른 본문과 똑같이 가려져야 한다(R3)."""
        client = dictionary_client()
        client.get_source.return_value = (
            "[전체 목표] 딸 김영희와의 관계 회복\n"
            "[세부 목표] 딸 김영희와 주 1회 연락하기\n"
            "[회기 목표] 이번 주 통화 여부 확인\n"
            "오늘 상담 본문입니다."
        )

        def fake_person_ner(text: str):
            name = "김영희"
            spans = []
            start = 0
            while True:
                index = text.find(name, start)
                if index < 0:
                    break
                spans.append((index, index + len(name)))
                start = index + len(name)
            return spans

        with TemporaryDirectory() as tmp:
            with mock.patch(
                "ccc_pipeline.worker._build_person_and_address_ner",
                return_value=(fake_person_ner, None),
            ):
                process_text_job(client, make_config(Path(tmp)), text_job())

        masked = client.post_result.call_args.args[1]["result"]["maskedText"]
        self.assertIn("[전체 목표]", masked)
        self.assertIn("[세부 목표]", masked)
        self.assertIn("[회기 목표]", masked)
        self.assertNotIn("김영희", masked)
        self.assertEqual(masked.count("[인명]"), 2)

    def test_text_job_refuses_to_run_without_person_ner(self):
        client = dictionary_client()
        client.get_source.return_value = "아들 김철수가 보증을 섰다고 함."
        with TemporaryDirectory() as tmp:
            config = replace(make_config(Path(tmp)), ner_model_id=None)
            with self.assertRaises(MaskingConfigError):
                process_text_job(client, config, text_job())
        # 결과도 완료도 일어나지 않는다 — 작업은 blocked 로 닫히고 NER 회복 뒤 다시 임대된다.
        client.post_result.assert_not_called()


class AudioJobTest(unittest.TestCase):
    def _run_audio_job(self, client: mock.Mock, config: Config, backup_adapters=None) -> None:
        from ccc_pipeline.speaker_mapping import Segment, Turn
        from ccc_pipeline.transcribe import TranscriptionResult
        from ccc_pipeline.worker import process_audio_job

        def fake_download(job_id: str, claim_token: str, attempt: int, dest: Path) -> Path:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(b"synthetic-audio")
            return dest

        client.download_audio.side_effect = fake_download
        with (
            mock.patch("ccc_pipeline.worker.build_engine", return_value=mock.Mock()),
            mock.patch(
                "ccc_pipeline.worker.transcribe_audio",
                return_value=TranscriptionResult([Segment(0.0, 1.0, "합성 문장")]),
            ),
            mock.patch("ccc_pipeline.diarize.diarize", return_value=[Turn(0.0, 1.0, "SPEAKER_00")]),
            mock.patch("ccc_pipeline.emotion.build_text_scorer", return_value=lambda texts: [0.1]),
            mock.patch("ccc_pipeline.emotion.build_speech_scorer", return_value=lambda path, spans: [0.1]),
            mock.patch(
                "ccc_pipeline.worker._build_person_and_address_ner",
                return_value=(lambda text: [], None),
            ),
        ):
            if backup_adapters is None:
                process_audio_job(client, config, audio_job())
            else:
                process_audio_job(client, config, audio_job(), backup_adapters)

    def test_verifies_the_stream_hash_before_submitting_a_result(self):
        client = dictionary_client()
        with TemporaryDirectory() as tmp:
            self._run_audio_job(client, make_config(Path(tmp)))

        verify_job_id, verify_body = client.verify_audio.call_args.args
        self.assertEqual(verify_job_id, "job-audio-1")
        self.assertEqual(verify_body["generationId"], "generation-1")
        self.assertEqual(verify_body["agentComputedSha256"], sha256_hex("synthetic-audio"))
        result = client.post_result.call_args.args[1]["result"]
        self.assertEqual(result["kind"], "audio")
        # D64: 감정 보류 중에는 계산 없이 빈 dict 를 보낸다 — `{}` 가 아니면 회귀다.
        self.assertEqual(result["emotionScores"], {})
        self.assertTrue(result["transcriptReliable"])
        self.assertEqual(result["transcriptWarnings"], [])

    def test_cleans_work_dir_on_failure(self):
        # D13: 다운로드 후 어떤 단계가 실패해도 중간 파일은 남지 않는다.
        from ccc_pipeline.worker import process_audio_job

        client = dictionary_client()
        created_dirs: list[Path] = []

        def fake_download(job_id: str, claim_token: str, attempt: int, dest: Path) -> Path:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(b"audio")
            created_dirs.append(dest.parent)
            return dest

        client.download_audio.side_effect = fake_download
        with TemporaryDirectory() as tmp:
            config = make_config(Path(tmp))
            with (
                mock.patch(
                    "ccc_pipeline.worker._build_person_and_address_ner",
                    return_value=(lambda text: [], None),
                ),
                mock.patch("ccc_pipeline.worker.transcribe_audio", side_effect=RuntimeError("gpu oom")),
            ):
                with self.assertRaises(RuntimeError):
                    process_audio_job(client, config, audio_job())
        self.assertTrue(created_dirs, "download should have run")
        for directory in created_dirs:
            self.assertFalse(directory.exists(), "work dir must be deleted (D13)")

    def test_backup_adapter_failure_does_not_block_result_submission(self):
        class FailingBackupAdapter:
            environment = "preview"
            destination_ref = "approved:archive"

            def copy_original(self, source: Path, *, job_id: str, retention_days: int) -> None:
                raise RuntimeError("fixture backup outage")

        client = dictionary_client()
        policy = BackupPolicy(
            enabled=True,
            environment="preview",
            purpose="approved internal archive",
            destination_ref="approved:archive",
            retention_days=30,
            consent_notice_version="recording-ai-v1",
        )
        with TemporaryDirectory() as tmp:
            config = replace(make_config(Path(tmp)), runtime_environment="preview", backup_policy=policy)
            self._run_audio_job(client, config, {"approved:archive": FailingBackupAdapter()})

        client.post_result.assert_called_once()


class EnvironmentIsolationTest(unittest.TestCase):
    def base_env(self) -> dict[str, str]:
        return {
            "CCC_NER_MODEL_ID": "FrameByFrame/korean-pii-e5-base",
            "CCC_ORIGINAL_BACKUP_ENABLED": "off",
            "CCC_NER_ATTESTATION": json.dumps(ATTESTATION),
            "CCC_NER_RELEASE_RECEIPT_ID": RECEIPT_ID,
        }

    def test_runtime_environment_is_explicit(self):
        with mock.patch.dict("os.environ", self.base_env(), clear=True):
            with self.assertRaisesRegex(ConfigError, "CCC_RUNTIME_ENVIRONMENT is required"):
                load_config()

    def test_ner_attestation_is_required_and_must_be_complete(self):
        env = {
            **self.base_env(),
            "CCC_RUNTIME_ENVIRONMENT": "preview",
            "CCC_PREVIEW_E2E_ACCESS_CODE": "fixture-preview-code",
        }
        del env["CCC_NER_ATTESTATION"]
        with mock.patch.dict("os.environ", env, clear=True):
            with self.assertRaises(ConfigError):
                load_config()
        incomplete = {**env, "CCC_NER_ATTESTATION": json.dumps({"id": "x", "status": "passed"})}
        with mock.patch.dict("os.environ", incomplete, clear=True):
            with self.assertRaises(ConfigError):
                load_config()

    def test_preview_uses_only_preview_api_and_preview_credential(self):
        env = {
            **self.base_env(),
            "CCC_RUNTIME_ENVIRONMENT": "preview",
            "CCC_PREVIEW_E2E_ACCESS_CODE": "fixture-preview-code",
        }
        with mock.patch.dict("os.environ", env, clear=True):
            config = load_config()
        self.assertEqual(config.api_base_url, "https://ccc-api-preview.account-855.workers.dev")
        self.assertIsNone(config.client_id)
        self.assertIsNone(config.client_secret)
        self.assertEqual(config.preview_access_code, "fixture-preview-code")
        self.assertEqual(config.ner_attestation, ATTESTATION)

    def test_preview_rejects_production_credentials_or_url(self):
        for extra in (
            {"CCC_PIPELINE_CLIENT_ID": "prod-id", "CCC_PIPELINE_CLIENT_SECRET": "prod-secret"},
            {"CCC_API_BASE_URL": "https://ccc-api.account-855.workers.dev"},
        ):
            env = {
                **self.base_env(),
                "CCC_RUNTIME_ENVIRONMENT": "preview",
                "CCC_PREVIEW_E2E_ACCESS_CODE": "fixture-preview-code",
                **extra,
            }
            with self.subTest(extra=tuple(extra)):
                with mock.patch.dict("os.environ", env, clear=True):
                    with self.assertRaises(ConfigError):
                        load_config()

    def test_production_rejects_preview_credentials_or_url(self):
        base = {
            **self.base_env(),
            "CCC_RUNTIME_ENVIRONMENT": "production",
            "CCC_PIPELINE_CLIENT_ID": "fixture-id",
            "CCC_PIPELINE_CLIENT_SECRET": "fixture-secret",
        }
        for extra in (
            {"CCC_PREVIEW_E2E_ACCESS_CODE": "preview-code"},
            {"CCC_API_BASE_URL": "https://ccc-api-preview.account-855.workers.dev"},
        ):
            with self.subTest(extra=tuple(extra)):
                with mock.patch.dict("os.environ", {**base, **extra}, clear=True):
                    with self.assertRaises(ConfigError):
                        load_config()


class DeviceReadinessTest(unittest.TestCase):
    """기동 전 설치 점검 — 설정이 틀린 채로 도는 것을 처음부터 막는다."""

    def test_missing_ffmpeg_stops_startup(self):
        from ccc_pipeline.worker import assert_device_ready

        with TemporaryDirectory() as tmp:
            with mock.patch("ccc_pipeline.worker.shutil.which", return_value=None):
                with self.assertRaises(MaskingConfigError):
                    assert_device_ready(make_config(Path(tmp)))

    def test_missing_person_ner_stops_startup(self):
        from ccc_pipeline.worker import assert_device_ready

        with TemporaryDirectory() as tmp:
            config = replace(make_config(Path(tmp)), ner_model_id=None)
            with mock.patch("ccc_pipeline.worker.shutil.which", return_value="/usr/bin/ffmpeg"):
                with self.assertRaises(MaskingConfigError):
                    assert_device_ready(config)


if __name__ == "__main__":
    unittest.main()
