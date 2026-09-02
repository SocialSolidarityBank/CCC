import hashlib
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
from ccc_pipeline.worker import run_once


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
        runtime_environment="production",
        backup_policy=BackupPolicy(),
    )


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
        request = client._request("GET", "/pipeline/jobs")
        # Cloudflare 1010 차단 회피: 기본 python UA 대신 명시 UA
        self.assertEqual(request.get_header("User-agent"), USER_AGENT)
        self.assertEqual(request.get_header("Cf-access-client-id"), "cid")
        self.assertEqual(request.get_header("Cf-access-client-secret"), "csec")
        self.assertEqual(request.full_url, "https://api.example/pipeline/jobs")

    def test_preview_unlocks_with_preview_code_and_never_sends_access_headers(self):
        client = ApiClient(
            "https://ccc-api-preview.account-855.workers.dev",
            runtime_environment="preview",
            preview_access_code="preview-fixture-code",
        )
        unlock = FakeResponse(json.dumps({"token": "preview-token", "maxAgeSeconds": 604800}).encode())
        jobs = FakeResponse(json.dumps({"jobs": []}).encode())
        with mock.patch.object(api_client_module.urllib.request, "urlopen", side_effect=[unlock, jobs]) as open_url:
            self.assertEqual(client.list_jobs(), [])

        unlock_request = open_url.call_args_list[0].args[0]
        jobs_request = open_url.call_args_list[1].args[0]
        self.assertEqual(unlock_request.full_url, "https://ccc-api-preview.account-855.workers.dev/preview/unlock")
        self.assertNotIn("Cf-access-client-id", jobs_request.headers)
        self.assertNotIn("Cf-access-client-secret", jobs_request.headers)
        self.assertEqual(jobs_request.get_header("Cookie"), "ccc_preview=preview-token")

    def test_list_jobs_parses_jobs(self):
        client = ApiClient("https://api.example", "cid", "csec", runtime_environment="production")
        payload = json.dumps({"jobs": [{"id": "s1", "audioAvailable": True}]}).encode()
        with mock.patch.object(api_client_module.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            jobs = client.list_jobs()
        self.assertEqual(jobs[0]["id"], "s1")

    def test_http_error_maps_to_api_error_without_body_leak(self):
        client = ApiClient("https://api.example", "cid", "csec", runtime_environment="production")
        error = api_client_module.urllib.error.HTTPError(
            "https://api.example/x", 403, "Forbidden", None, io.BytesIO(b'{"error":"forbidden","secret":"x"}')
        )
        with mock.patch.object(api_client_module.urllib.request, "urlopen", side_effect=error):
            with self.assertRaises(ApiError) as caught:
                client.list_jobs()
        self.assertEqual(caught.exception.status, 403)
        # 서버 error 코드만 담기고 나머지 본문은 예외 메시지에 실리지 않는다 (R3)
        self.assertNotIn("secret", str(caught.exception))

    def test_download_audio_writes_bytes(self):
        client = ApiClient("https://api.example", "cid", "csec", runtime_environment="production")
        with TemporaryDirectory() as tmp:
            dest = Path(tmp) / "nested" / "audio.bin"
            with mock.patch.object(api_client_module.urllib.request, "urlopen", return_value=FakeResponse(b"RIFFdata")):
                client.download_audio("s1", dest)
            self.assertEqual(dest.read_bytes(), b"RIFFdata")


class RunOnceTest(unittest.TestCase):
    def test_no_jobs_returns_zero(self):
        client = mock.Mock()
        client.list_jobs.return_value = []
        client.list_text_jobs.return_value = []
        with TemporaryDirectory() as tmp:
            self.assertEqual(run_once(client, make_config(Path(tmp))), 0)

    def test_processes_available_jobs_and_survives_one_failure(self):
        client = mock.Mock()
        client.list_text_jobs.return_value = []
        client.list_jobs.return_value = [
            {"id": "bad", "audioAvailable": True},
            {"id": "good", "audioAvailable": True},
            {"id": "skip", "audioAvailable": False},
        ]
        with TemporaryDirectory() as tmp:
            config = make_config(Path(tmp))
            with mock.patch("ccc_pipeline.worker.process_job") as process_job:
                process_job.side_effect = [ApiError(400, "validation"), None]
                self.assertEqual(run_once(client, config), 1)
                # audioAvailable=False는 시도조차 하지 않는다
                self.assertEqual(process_job.call_count, 2)

    def test_process_job_cleans_work_dir_on_failure(self):
        # D13: 다운로드 후 어떤 단계가 실패해도 중간 파일은 남지 않는다.
        from ccc_pipeline.worker import process_job

        client = mock.Mock()
        created_dirs: list[Path] = []

        def fake_download(job_id: str, dest: Path) -> Path:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(b"audio")
            created_dirs.append(dest.parent)
            return dest

        client.download_audio.side_effect = fake_download
        with TemporaryDirectory() as tmp:
            config = make_config(Path(tmp))
            # 워커가 이름으로 가져다 쓰므로 워커 쪽 이름을 바꿔 끼운다(D53 이후 전사 진입점).
            with mock.patch("ccc_pipeline.worker.transcribe_audio", side_effect=RuntimeError("gpu oom")):
                with self.assertRaises(RuntimeError):
                    process_job(client, config, "s1")
        self.assertTrue(created_dirs, "download should have run")
        for directory in created_dirs:
            self.assertFalse(directory.exists(), "work dir must be deleted (D13)")

    def test_backup_adapter_failure_does_not_block_result_submission(self):
        from ccc_pipeline.speaker_mapping import Segment, Turn
        from ccc_pipeline.transcribe import TranscriptionResult
        from ccc_pipeline.worker import process_job

        client = mock.Mock()

        def fake_download(job_id: str, dest: Path) -> Path:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(b"synthetic-audio")
            return dest

        class FailingBackupAdapter:
            environment = "preview"
            destination_ref = "approved:archive"

            def copy_original(self, source: Path, *, job_id: str, retention_days: int) -> None:
                raise RuntimeError("fixture backup outage")

        client.download_audio.side_effect = fake_download
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
                process_job(
                    client,
                    config,
                    "job-1",
                    {"approved:archive": FailingBackupAdapter()},
                )

        client.post_recording_result.assert_called_once()
        # D64: 감정 보류 중에는 계산 없이 빈 dict 를 보낸다 — `{}` 가 아니면 회귀다.
        body = client.post_recording_result.call_args.args[1]
        self.assertEqual(body["emotionScores"], {})


class EnvironmentIsolationTest(unittest.TestCase):
    def base_env(self) -> dict[str, str]:
        return {
            "CCC_NER_MODEL_ID": "FrameByFrame/korean-pii-e5-base",
            "CCC_ORIGINAL_BACKUP_ENABLED": "off",
        }

    def test_runtime_environment_is_explicit(self):
        with mock.patch.dict("os.environ", self.base_env(), clear=True):
            with self.assertRaisesRegex(ConfigError, "CCC_RUNTIME_ENVIRONMENT is required"):
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


class TextJobTest(unittest.TestCase):
    """텍스트 일감 (D51 · ADR-0027) — 오디오 없는 회차의 2차 마스킹."""

    def test_masks_source_and_posts_snapshot_then_completes(self):
        from ccc_pipeline.worker import process_text_job

        client = mock.Mock()
        client.get_text_job_source.return_value = "아들 김철수에게 010-1234-5678 로 연락한다고 함"

        # 인명 NER 대역 — 실제 모델 대신 "김철수" 스팬만 돌려준다(transformers 미설치 환경).
        def fake_person_ner(text: str):
            start = text.find("김철수")
            return [] if start < 0 else [(start, start + len("김철수"))]

        with TemporaryDirectory() as tmp:
            with mock.patch(
                "ccc_pipeline.worker._build_person_and_address_ner",
                return_value=(fake_person_ner, None),
            ):
                process_text_job(client, make_config(Path(tmp)), "item-1", "session-1")

        session_id, snapshot = client.post_masked_source.call_args.args
        self.assertEqual(session_id, "session-1")
        # 2차 마스킹을 거치지 않은 원문은 절대 나가지 않는다 (R3).
        self.assertNotIn("010-1234-5678", snapshot["maskedText"])
        self.assertIn("[전화번호]", snapshot["maskedText"])
        # 금고에 없는 제3자 이름도 가려진다 — 이 계층이 빠지면 그대로 나간다(R3).
        self.assertNotIn("김철수", snapshot["maskedText"])
        self.assertIn("[인명]", snapshot["maskedText"])
        # 해시는 보내는 본문 그대로여야 서버 검증을 통과한다.
        expected = hashlib.sha256(snapshot["maskedText"].encode("utf-8")).hexdigest()
        self.assertEqual(snapshot["sha256"], expected)
        # 근거 한 조각이 본문 전체를 덮는다 — 구간은 코드 포인트 기준.
        evidence = snapshot["evidence"][0]
        self.assertEqual(evidence["evidenceQuote"], snapshot["maskedText"])
        self.assertEqual(evidence["sourceEnd"], len(snapshot["maskedText"]))
        client.complete_text_job.assert_called_once_with("item-1")

    def test_goal_revised_reason_is_processed_like_any_other_reason(self):
        """큐 reason 값(D69 · CCC-103 의 goal_revised 포함)은 처리 여부에 영향을 주지 않는다.

        run_once 는 큐 항목에서 id·sessionId 만 읽고 reason 은 아예 보지 않는다(worker.py).
        이 테스트는 reason 이 무엇이든 결과가 같다는 것을 대조군으로 고정한다. 워커 루프에
        reason 분기가 생기면 이 테스트가 깨진다.
        """
        client = mock.Mock()
        client.list_jobs.return_value = []
        client.list_text_jobs.return_value = [
            {"id": "item-1", "sessionId": "session-1", "reason": "goal_revised"},
        ]
        client.get_text_job_source.return_value = "아들 김철수에게 010-1234-5678 로 연락한다고 함"

        def fake_person_ner(text: str):
            start = text.find("김철수")
            return [] if start < 0 else [(start, start + len("김철수"))]

        with TemporaryDirectory() as tmp:
            with mock.patch(
                "ccc_pipeline.worker._build_person_and_address_ner",
                return_value=(fake_person_ner, None),
            ):
                self.assertEqual(run_once(client, make_config(Path(tmp))), 1)

        client.get_text_job_source.assert_called_once_with("item-1")
        session_id, snapshot = client.post_masked_source.call_args.args
        self.assertEqual(session_id, "session-1")
        self.assertNotIn("010-1234-5678", snapshot["maskedText"])
        self.assertNotIn("김철수", snapshot["maskedText"])
        client.complete_text_job.assert_called_once_with("item-1")

    def test_goal_section_labels_survive_masking_and_goal_text_is_masked(self):
        """CCC-103 이 원문에 싣는 목표 구획 라벨은 살아남고, 목표 문구 속 PII 는 가려진다.

        getTextWorkItemSource(db/gateway.ts)가 만드는 `[전체 목표]`·`[세부 목표]`·`[회기 목표]`
        라벨은 NER 스팬이 아니라 원문 그대로 실린다. 마스킹이 라벨 자체를 지우면 안 되고,
        라벨 뒤 목표 문구 속 인명은 다른 본문과 똑같이 가려져야 한다(R3).
        """
        from ccc_pipeline.worker import process_text_job

        client = mock.Mock()
        client.get_text_job_source.return_value = (
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
                idx = text.find(name, start)
                if idx < 0:
                    break
                spans.append((idx, idx + len(name)))
                start = idx + len(name)
            return spans

        with TemporaryDirectory() as tmp:
            with mock.patch(
                "ccc_pipeline.worker._build_person_and_address_ner",
                return_value=(fake_person_ner, None),
            ):
                process_text_job(client, make_config(Path(tmp)), "item-1", "session-1")

        _, snapshot = client.post_masked_source.call_args.args
        masked = snapshot["maskedText"]
        # 구획 라벨은 마스킹 대상이 아니라 원문 그대로 남는다.
        self.assertIn("[전체 목표]", masked)
        self.assertIn("[세부 목표]", masked)
        self.assertIn("[회기 목표]", masked)
        # 라벨 뒤 목표 문구 속 인명은 다른 본문과 동일하게 가려진다.
        self.assertNotIn("김영희", masked)
        self.assertEqual(masked.count("[인명]"), 2)
        client.complete_text_job.assert_called_once_with("item-1")

    def test_failed_text_job_is_not_completed_and_does_not_stop_the_rest(self):
        client = mock.Mock()
        client.list_jobs.return_value = []
        client.list_text_jobs.return_value = [
            {"id": "bad", "sessionId": "s1"},
            {"id": "good", "sessionId": "s2"},
        ]
        with TemporaryDirectory() as tmp:
            with mock.patch("ccc_pipeline.worker.process_text_job") as process_text_job:
                process_text_job.side_effect = [ApiError(409, "conflict"), None]
                self.assertEqual(run_once(client, make_config(Path(tmp))), 1)
                self.assertEqual(process_text_job.call_count, 2)


class DeviceReadinessTest(unittest.TestCase):
    """기동 전 설치 점검 — 설정이 틀린 채로 도는 것을 처음부터 막는다."""

    def test_missing_ffmpeg_stops_startup(self):
        from ccc_pipeline.masking import MaskingConfigError
        from ccc_pipeline.worker import assert_device_ready

        with TemporaryDirectory() as tmp:
            with mock.patch("ccc_pipeline.worker.shutil.which", return_value=None):
                with self.assertRaises(MaskingConfigError):
                    assert_device_ready(make_config(Path(tmp)))

    def test_missing_person_ner_stops_startup(self):
        from ccc_pipeline.masking import MaskingConfigError
        from ccc_pipeline.worker import assert_device_ready

        with TemporaryDirectory() as tmp:
            config = replace(make_config(Path(tmp)), ner_model_id=None)
            with mock.patch("ccc_pipeline.worker.shutil.which", return_value="/usr/bin/ffmpeg"):
                with self.assertRaises(MaskingConfigError):
                    assert_device_ready(config)

    def test_masking_version_records_which_layers_ran(self):
        from ccc_pipeline.worker import masking_pipeline_version

        with TemporaryDirectory() as tmp:
            base = make_config(Path(tmp))
            # 어느 계층이 실제로 돌았는지가 스냅샷 기록에서 구분돼야 한다 —
            # 주소를 가렸는지, 질병명을 사전으로만 걸렀는지까지.
            self.assertEqual(masking_pipeline_version(base), "ner-mask-v1+addr+cond-dict")
            with_cond = replace(base, condition_ner_model_id="fixture/cond-ner")
            self.assertEqual(masking_pipeline_version(with_cond), "ner-mask-v1+addr+cond-ner")
            no_addr = replace(base, address_labels=())
            self.assertEqual(masking_pipeline_version(no_addr), "ner-mask-v1-addr+cond-dict")


class PersonNerFailClosedTest(unittest.TestCase):
    """인명 NER 계층이 없으면 진행하지 않는다 (2026-07-31 Q 결정 · R3).

    구 동작(경고 후 통과)이면 금고에 없는 제3자가 마스킹 없이 사업자로 나간다.
    """

    def _config_without_ner(self, tmp: str) -> Config:
        base = make_config(Path(tmp))
        return replace(base, ner_model_id=None)

    def test_text_job_refuses_to_run_without_person_ner(self):
        from ccc_pipeline.masking import MaskingConfigError
        from ccc_pipeline.worker import process_text_job

        client = mock.Mock()
        client.get_text_job_source.return_value = "아들 김철수가 보증을 섰다고 함."
        with TemporaryDirectory() as tmp:
            with self.assertRaises(MaskingConfigError):
                process_text_job(client, self._config_without_ner(tmp), "item-1", "session-1")
        # 스냅샷도 완료도 일어나지 않는다 — 일감은 대기로 남아 다음 폴링에서 다시 잡힌다.
        client.post_masked_source.assert_not_called()
        client.complete_text_job.assert_not_called()

    def test_run_once_survives_and_leaves_the_item_pending(self):
        client = mock.Mock()
        client.list_jobs.return_value = []
        client.list_text_jobs.return_value = [{"id": "i1", "sessionId": "s1"}]
        client.get_text_job_source.return_value = "아들 김철수가 보증을 섰다고 함."
        with TemporaryDirectory() as tmp:
            # 폴링 루프는 죽지 않고 0건 처리로 넘어간다(D8) — 큐에는 그대로 남는다.
            self.assertEqual(run_once(client, self._config_without_ner(tmp)), 0)
        client.complete_text_job.assert_not_called()


if __name__ == "__main__":
    unittest.main()
