"""폴링 워커 — 파이프라인 전 구간을 잇는 오케스트레이션 (CLAUDE.md §5 순서).

D13: 중간 파일(오디오·전사)은 작업별 디렉터리에 두고 성공/실패와 무관하게 즉시 삭제.
R3: 로그에는 세션 ID·건수·소요 시간·예외 유형만 남긴다. 전사 내용·PII·시크릿 금지.
"""

from __future__ import annotations

import logging
import shutil
import time
import uuid
from pathlib import Path

from . import masking
from .api_client import ApiClient, ApiError
from .artifacts import build_artifacts
from .config import Config
from .emotion import aggregate_scores
from .speaker_mapping import BENEFICIARY, assign_speakers, estimate_roles, format_transcript

logger = logging.getLogger("ccc_pipeline")


def _build_ner_or_none(config: Config):  # noqa: ANN202
    if config.ner_model_id is None:
        # 정규식 마스킹은 항상 동작하지만, 인명 마스킹이 빠지면 2차 방어가 얇아진다(D2).
        logger.warning("CCC_NER_MODEL_ID is not set — masking runs regex-only (no person-name NER)")
        return None
    return masking.build_ner(config.ner_model_id)


def process_job(client: ApiClient, config: Config, job_id: str) -> None:
    """작업 1건: 다운로드 → 전사 → 화자 분리 → 역할 추정 → 감정 → 마스킹 → 전송."""
    # ML 모듈은 여기서만 임포트한다 — 미설치 환경에서도 워커 모듈 자체는 로드 가능하게.
    from .diarize import diarize  # noqa: PLC0415
    from .emotion import build_speech_scorer, build_text_scorer  # noqa: PLC0415
    from .transcribe import transcribe  # noqa: PLC0415

    work_dir = config.work_dir / f"{job_id}-{uuid.uuid4().hex[:8]}"
    started = time.monotonic()
    try:
        audio_path = client.download_audio(job_id, work_dir / "audio.bin")
        logger.info("job %s: audio downloaded", job_id)

        segments = transcribe(str(audio_path), config.whisper_model)
        turns = diarize(str(audio_path), config.hf_token)
        segments = assign_speakers(segments, turns)
        roles = estimate_roles(segments)
        logger.info("job %s: transcribed segments=%d speakers=%d", job_id, len(segments), len(roles))

        # 감정은 수혜자 발화만 (D11). 점수는 숫자만 (R4).
        beneficiary_segments = [s for s in segments if roles.get(s.speaker or "") == BENEFICIARY]
        text_scores = build_text_scorer()([s.text for s in beneficiary_segments]) if beneficiary_segments else []
        speech_scores = (
            build_speech_scorer()(str(audio_path), [(s.start, s.end) for s in beneficiary_segments])
            if beneficiary_segments
            else []
        )
        emotion_scores = aggregate_scores(speech_scores, text_scores)

        # 2차 PII 마스킹(D2) — 이 지점 이후의 텍스트만 장비를 떠날 수 있다.
        transcript = masking.mask_text(format_transcript(segments, roles), _build_ner_or_none(config))

        client.post_artifacts(job_id, build_artifacts(transcript, emotion_scores))
        logger.info("job %s: artifacts posted (%.1fs)", job_id, time.monotonic() - started)
    finally:
        # D13: 성공·실패와 무관하게 오디오·중간 파일을 즉시 삭제한다.
        shutil.rmtree(work_dir, ignore_errors=True)


def run_once(client: ApiClient, config: Config) -> int:
    """폴링 1회: 대기 작업을 순차 처리(VRAM 직렬화). 처리한 건수를 돌려준다."""
    jobs = client.list_jobs()
    if not jobs:
        logger.info("no jobs")
        return 0

    processed = 0
    for job in jobs:
        job_id = str(job.get("id", ""))
        if job_id == "" or job.get("audioAvailable") is not True:
            continue
        try:
            process_job(client, config, job_id)
            processed += 1
        except ApiError as error:
            # 한 작업의 실패가 나머지 처리를 막지 않는다. 상태 코드만 기록(R3).
            logger.error("job %s: api error status=%d", job_id, error.status)
        except Exception as error:  # noqa: BLE001
            logger.error("job %s: %s", job_id, type(error).__name__)
    return processed


def run_forever(client: ApiClient, config: Config) -> None:
    logger.info("polling every %ds against %s", config.poll_interval_seconds, config.api_base_url)
    while True:
        try:
            run_once(client, config)
        except Exception as error:  # noqa: BLE001 — 폴링 자체 실패(네트워크 등)도 루프를 죽이지 않는다
            logger.error("poll failed: %s", type(error).__name__)
        time.sleep(config.poll_interval_seconds)
