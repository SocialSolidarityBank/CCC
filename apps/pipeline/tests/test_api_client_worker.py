import io
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
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
        ner_model_id=None,
        condition_ner_model_id=None,
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
        with TemporaryDirectory() as tmp:
            self.assertEqual(run_once(client, make_config(Path(tmp))), 0)

    def test_processes_available_jobs_and_survives_one_failure(self):
        client = mock.Mock()
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
            with mock.patch("ccc_pipeline.transcribe.transcribe", side_effect=RuntimeError("gpu oom")):
                with self.assertRaises(RuntimeError):
                    process_job(client, config, "s1")
        self.assertTrue(created_dirs, "download should have run")
        for directory in created_dirs:
            self.assertFalse(directory.exists(), "work dir must be deleted (D13)")


if __name__ == "__main__":
    unittest.main()
