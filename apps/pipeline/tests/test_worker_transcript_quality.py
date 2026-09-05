"""전사 품질 구조화 필드 전송 테스트 (CCC-124 · S5 §2.7).

경고는 전사 텍스트 안 문장이 아니라 `transcriptReliable`·`transcriptWarnings` 구조화
필드로 나간다. v2 는 옛 형식 재전송(legacy payload fallback)을 두지 않는다.
"""

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

from ccc_pipeline.repetition import REASON_REPETITION, RepetitionRun
from ccc_pipeline.speaker_mapping import Segment, Turn
from ccc_pipeline.transcribe import TranscriptionResult
from ccc_pipeline.worker import process_audio_job
from test_api_client_worker import audio_job, dictionary_client, make_config


def unreliable_transcription() -> TranscriptionResult:
    # collapse_runs 를 거친 뒤 모양: 반복 구간은 반복된 문장 한 줄로 접혀 있다(CCC-124).
    return TranscriptionResult(
        [
            Segment(0.0, 5.0, "정상 문장입니다."),
            Segment(5.0, 65.0, "같은 문장", warning=True),
        ],
        [RepetitionRun(start_index=1, end_index=254, start=5.0, end=65.0, count=254, text="같은 문장")],
    )


def run_audio_job(client, transcription: TranscriptionResult, config) -> None:
    def fake_download(job_id: str, claim_token: str, attempt: int, dest: Path) -> Path:
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
        process_audio_job(client, config, audio_job())


class StructuredTranscriptQualityTest(unittest.TestCase):
    def test_unreliable_transcript_posts_structured_quality_fields(self):
        client = dictionary_client()
        with TemporaryDirectory() as tmp:
            run_audio_job(client, unreliable_transcription(), make_config(Path(tmp)))

        result = client.post_result.call_args.args[1]["result"]
        self.assertIs(result["transcriptReliable"], False)
        self.assertEqual(
            result["transcriptWarnings"],
            [{"startSeconds": 5.0, "endSeconds": 65.0, "reason": REASON_REPETITION}],
        )
        # 반복된 문장은 구조화 필드에 싣지 않는다 — 2차 마스킹을 거치지 않은 전사다(R3).
        self.assertNotIn("같은 문장", str(result["transcriptWarnings"]))

    def test_reliable_transcript_reports_no_warning_spans(self):
        client = dictionary_client()
        with TemporaryDirectory() as tmp:
            run_audio_job(client, TranscriptionResult([Segment(0.0, 2.0, "정상 문장입니다.")]), make_config(Path(tmp)))

        result = client.post_result.call_args.args[1]["result"]
        self.assertIs(result["transcriptReliable"], True)
        self.assertEqual(result["transcriptWarnings"], [])


if __name__ == "__main__":
    unittest.main()
