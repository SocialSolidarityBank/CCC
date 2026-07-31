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
from ccc_pipeline.config import Config
from ccc_pipeline.worker import run_once


def make_config(work_dir: Path) -> Config:
    return Config(
        api_base_url="https://api.example",
        client_id="cid",
        client_secret="csec",
        poll_interval_seconds=1,
        work_dir=work_dir,
        whisper_model="tiny",
        stt_engine="whisper",
        stt_max_chunk_seconds=180.0,
        stt_min_chunk_seconds=30.0,
        stt_repeat_threshold=4,
        ner_model_id="fixture/person-ner",
        ner_labels=("PS", "PER", "NAME"),
        condition_ner_model_id=None,
        condition_ner_labels=("DS",),
        hf_token=None,
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
        client = ApiClient("https://api.example/", "cid", "csec")
        request = client._request("GET", "/pipeline/jobs")
        # Cloudflare 1010 차단 회피: 기본 python UA 대신 명시 UA
        self.assertEqual(request.get_header("User-agent"), USER_AGENT)
        self.assertEqual(request.get_header("Cf-access-client-id"), "cid")
        self.assertEqual(request.get_header("Cf-access-client-secret"), "csec")
        self.assertEqual(request.full_url, "https://api.example/pipeline/jobs")

    def test_list_jobs_parses_jobs(self):
        client = ApiClient("https://api.example", "cid", "csec")
        payload = json.dumps({"jobs": [{"id": "s1", "audioAvailable": True}]}).encode()
        with mock.patch.object(api_client_module.urllib.request, "urlopen", return_value=FakeResponse(payload)):
            jobs = client.list_jobs()
        self.assertEqual(jobs[0]["id"], "s1")

    def test_http_error_maps_to_api_error_without_body_leak(self):
        client = ApiClient("https://api.example", "cid", "csec")
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
        client = ApiClient("https://api.example", "cid", "csec")
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


class TextJobTest(unittest.TestCase):
    """텍스트 일감 (D51 · ADR-0025) — 오디오 없는 회차의 2차 마스킹."""

    def test_masks_source_and_posts_snapshot_then_completes(self):
        from ccc_pipeline.worker import process_text_job

        client = mock.Mock()
        client.get_text_job_source.return_value = "아들 김철수에게 010-1234-5678 로 연락한다고 함"

        # 인명 NER 대역 — 실제 모델 대신 "김철수" 스팬만 돌려준다(transformers 미설치 환경).
        def fake_person_ner(text: str):
            start = text.find("김철수")
            return [] if start < 0 else [(start, start + len("김철수"))]

        with TemporaryDirectory() as tmp:
            with mock.patch("ccc_pipeline.worker._build_person_ner", return_value=fake_person_ner):
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
