"""전사 품질 구조화 필드 전송 테스트 (CCC-124).

경고는 전사 텍스트 안 문장이 아니라 `transcriptReliable`·`transcriptWarnings` 구조화
필드로 나간다. 구조화 필드를 모르는 구 서버(400)에는 옛 형식으로 한 번만 재시도한다.
"""

import hashlib
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from ccc_pipeline.api_client import ApiError
from ccc_pipeline.backup import BackupPolicy
from ccc_pipeline.config import Config
from ccc_pipeline.repetition import RepetitionRun
from ccc_pipeline.speaker_mapping import Segment, Turn
from ccc_pipeline.transcribe import TranscriptionResult
from ccc_pipeline.worker import process_job


def make_config(work_dir: Path) -> Config:
    return Config(
        api_base_url="https://api.example",
        client_id="cid",
        client_secret="csec",
        preview_access_code=None,
        poll_interval_seconds=1,
        work_dir=work_dir,
        whisper_model="tiny",
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


def unreliable_transcription() -> TranscriptionResult:
    # collapse_runs 를 거친 뒤 모양: 반복 구간은 반복된 문장 한 줄로 접혀 있다(CCC-124).
    return TranscriptionResult(
        segments=[
            Segment(0.0, 1.0, "앞 발화"),
            Segment(5.0, 30.0, "반복 문장", warning=True),
        ],
        warnings=[RepetitionRun(start_index=1, end_index=5, count=5, start=5.0, end=30.0, text="반복 문장")],
    )


def run_process_job(client, transcription: TranscriptionResult, config: Config) -> None:
    def fake_download(job_id: str, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(b"synthetic-audio")
        return dest

    client.download_audio.side_effect = fake_download
    with (
        mock.patch("ccc_pipeline.worker.build_engine", return_value=mock.Mock()),
        mock.patch("ccc_pipeline.worker.transcribe_audio", return_value=transcription),
        mock.patch("ccc_pipeline.diarize.diarize", return_value=[Turn(0.0, 1.0, "SPEAKER_00")]),
        mock.patch(
            "ccc_pipeline.worker._build_person_and_address_ner",
            return_value=(lambda text: [], None),
        ),
    ):
        process_job(client, config, "job-1")


class StructuredTranscriptQualityTest(unittest.TestCase):
    def test_unreliable_transcript_posts_structured_quality_fields(self):
        client = mock.Mock()
        with TemporaryDirectory() as tmp:
            run_process_job(client, unreliable_transcription(), make_config(Path(tmp)))

        client.post_recording_result.assert_called_once()
        body = client.post_recording_result.call_args.args[1]
        self.assertIs(body["transcriptReliable"], False)
        self.assertEqual(
            body["transcriptWarnings"],
            [{"startSeconds": 5.0, "endSeconds": 30.0, "reason": "repetition"}],
        )
        # 경고 문장 주입은 제거됐다 — 접힌 반복 문장 자체만 본문에 남는다.
        self.assertNotIn("⚠ 전사 실패 구간", body["maskedText"])
        self.assertIn("반복 문장", body["maskedText"])

    def test_reliable_transcript_posts_true_with_empty_warnings(self):
        client = mock.Mock()
        with TemporaryDirectory() as tmp:
            run_process_job(
                client,
                TranscriptionResult([Segment(0.0, 1.0, "합성 문장")]),
                make_config(Path(tmp)),
            )

        body = client.post_recording_result.call_args.args[1]
        self.assertIs(body["transcriptReliable"], True)
        self.assertEqual(body["transcriptWarnings"], [])


class LegacyServerFallbackTest(unittest.TestCase):
    def test_legacy_server_400_falls_back_to_in_text_warnings_once(self):
        # 구 서버는 미지의 키를 400 으로 거부한다(requireOnlyKeys) — 옛 형식으로 한 번 재시도.
        client = mock.Mock()
        client.post_recording_result.side_effect = [ApiError(400, "invalid_request"), None]
        with TemporaryDirectory() as tmp:
            run_process_job(client, unreliable_transcription(), make_config(Path(tmp)))

        self.assertEqual(client.post_recording_result.call_count, 2)
        legacy_body = client.post_recording_result.call_args_list[1].args[1]
        self.assertNotIn("transcriptReliable", legacy_body)
        self.assertNotIn("transcriptWarnings", legacy_body)
        self.assertIn("⚠ 전사 실패 구간", legacy_body["maskedText"])
        self.assertIn("5회 반복", legacy_body["maskedText"])
        # 레거시 본문도 해시가 본문 그대로여야 서버 검증을 통과한다.
        expected = hashlib.sha256(legacy_body["maskedText"].encode("utf-8")).hexdigest()
        self.assertEqual(legacy_body["sha256"], expected)

    def test_non_400_errors_are_not_retried_with_legacy_payload(self):
        client = mock.Mock()
        client.post_recording_result.side_effect = ApiError(409, "recording_result_conflict")
        with TemporaryDirectory() as tmp:
            with self.assertRaises(ApiError):
                run_process_job(client, unreliable_transcription(), make_config(Path(tmp)))
        self.assertEqual(client.post_recording_result.call_count, 1)


if __name__ == "__main__":
    unittest.main()
