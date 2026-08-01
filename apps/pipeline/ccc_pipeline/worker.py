"""폴링 워커 — 파이프라인 전 구간을 잇는 오케스트레이션 (CLAUDE.md §5 순서).

D13: 중간 파일(오디오·전사)은 작업별 디렉터리에 두고 성공/실패와 무관하게 즉시 삭제.
R3: 로그에는 세션 ID·건수·소요 시간·예외 유형만 남긴다. 전사 내용·PII·시크릿 금지.
"""

from __future__ import annotations

import hashlib
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
from .transcribe import build_engine, transcribe_audio

logger = logging.getLogger("ccc_pipeline")


def _build_person_and_address_ner(config: Config):  # noqa: ANN202
    """인명 NER 계층. **없으면 진행하지 않는다** (2026-07-31 Q 결정).

    구 동작은 경고만 남기고 통과였는데, 그러면 금고에 없는 제3자("아들 김철수")가 마스킹
    없이 그대로 사업자에게 나간다 — 2차 방어의 한 겹이 통째로 빈 채로 파이프라인이 도는
    것이라 R3 위반이다. 늦는 것(D8 SLA · 브리핑은 수기 메모 폴백 D5)이 새는 것보다 낫다.
    """
    if config.ner_model_id is None:
        raise masking.MaskingConfigError("CCC_NER_MODEL_ID is not set — person-name masking is unavailable")
    # 인명과 주소는 같은 모델이 잡는다 — 한 번만 올린다(장비 메모리는 STT·감정과 나눠 쓴다).
    return masking.build_person_and_address_ner(config.ner_model_id, config.ner_labels, config.address_labels)


def _build_condition_ner_or_none(config: Config):  # noqa: ANN202
    if config.condition_ner_model_id is None:
        # 사전 계층(G3)은 항상 동작한다 — NER 은 사전이 놓친 표기를 줍는 보완재다.
        # 인명과 달리 여기는 없어도 진행한다: 사전이 대체재가 아니라 **주 계층**이다.
        logger.info("CCC_CONDITION_NER_MODEL_ID is not set — condition masking uses the dictionary only")
        return None
    return masking.build_condition_ner(config.condition_ner_model_id, config.condition_ner_labels)


def process_job(client: ApiClient, config: Config, job_id: str) -> None:
    """작업 1건: 다운로드 → 전사 → 화자 분리 → 역할 추정 → 감정 → 마스킹 → 전송."""
    # ML 모듈은 여기서만 임포트한다 — 미설치 환경에서도 워커 모듈 자체는 로드 가능하게.
    from .diarize import diarize  # noqa: PLC0415
    from .emotion import build_speech_scorer, build_text_scorer  # noqa: PLC0415

    work_dir = config.work_dir / f"{job_id}-{uuid.uuid4().hex[:8]}"
    started = time.monotonic()
    try:
        audio_path = client.download_audio(job_id, work_dir / "audio.bin")
        logger.info("job %s: audio downloaded", job_id)

        # 조각 분할 + 반복 검사를 거친다 (D53). 반복이 남으면 그 구간은 접히고
        # 경고가 전사에 실려 승인 화면에서 실무자가 본다 — 조용히 통과시키지 않는다.
        transcription = transcribe_audio(
            str(audio_path),
            work_dir,
            build_engine(config.stt_engine, config.whisper_model),
            max_chunk_seconds=config.stt_max_chunk_seconds,
            min_chunk_seconds=config.stt_min_chunk_seconds,
            repeat_threshold=config.stt_repeat_threshold,
        )
        segments = transcription.segments
        if not transcription.reliable:
            logger.warning("job %s: transcript incomplete — repetition runs=%d", job_id, len(transcription.warnings))
        turns = diarize(str(audio_path), config.hf_token)
        segments = assign_speakers(segments, turns)
        roles = estimate_roles(segments)
        logger.info("job %s: transcribed segments=%d speakers=%d", job_id, len(segments), len(roles))

        # 감정은 수혜자 발화만 (D11). 점수는 숫자만 (R4).
        # 경고 줄은 사람 발화가 아니므로 감정 집계에서 뺀다 (D53 · R4).
        beneficiary_segments = [
            s for s in segments if not s.warning and roles.get(s.speaker or "") == BENEFICIARY
        ]
        text_scores = build_text_scorer()([s.text for s in beneficiary_segments]) if beneficiary_segments else []
        speech_scores = (
            build_speech_scorer()(str(audio_path), [(s.start, s.end) for s in beneficiary_segments])
            if beneficiary_segments
            else []
        )
        emotion_scores = aggregate_scores(speech_scores, text_scores)

        # 2차 PII 마스킹(D2) — 이 지점 이후의 텍스트만 장비를 떠날 수 있다.
        person_ner, address_ner = _build_person_and_address_ner(config)
        transcript, mask_report = masking.mask_text_with_report(
            format_transcript(segments, roles),
            person_ner,
            _build_condition_ner_or_none(config),
            address_ner,
        )
        # 마스킹 집계는 **건수만** 남긴다 — 치환된 원문은 로그에도 쓰지 않는다(R3, G3 검증용).
        logger.info("job %s: masked total=%d detail=%s", job_id, mask_report.total, mask_report.as_mapping())

        client.post_artifacts(job_id, build_artifacts(transcript, emotion_scores))
        logger.info("job %s: artifacts posted (%.1fs)", job_id, time.monotonic() - started)
    finally:
        # D13: 성공·실패와 무관하게 오디오·중간 파일을 즉시 삭제한다.
        shutil.rmtree(work_dir, ignore_errors=True)


def assert_device_ready(config: Config) -> None:
    """기동 전 설치 점검. **실행 중 조건이 아니라 설치 오류**를 여기서 시끄럽게 잡는다.

    이런 것들은 매 회차마다 조용히 품질을 깎는 대신 처음부터 뜨지 않는 게 맞다:
      * ffmpeg 부재 → 무음 경계 분할이 통짜 전사로 폴백한다. ADR-0024 가 그 방식을
        금지한 이유가 반복 붕괴 실측(254회 반복·48% 손실)이다.
      * 인명 NER 미설정 → 2차 방어의 인명 계층이 빈 채로 돈다(R3).
    """
    if shutil.which("ffmpeg") is None:
        raise masking.MaskingConfigError(
            "ffmpeg is not installed — silence-boundary chunking would fall back to whole-file "
            "transcription, which ADR-0024 forbids",
        )
    if config.ner_model_id is None:
        raise masking.MaskingConfigError("CCC_NER_MODEL_ID is not set — person-name masking is unavailable")


def masking_pipeline_version(config: Config) -> str:
    """스냅샷에 남길 마스킹 버전. **실제로 동작한 계층**을 담는다.

    고정 문자열이면 "질병명이 사전으로만 걸러졌는지 NER 까지 거쳤는지" 를 나중에 되짚을 수
    없다 — 마스킹 문제가 발견됐을 때 어느 스냅샷이 영향권인지 가려내는 근거가 이 값이다.
    """
    parts = ["ner-mask-v1"]
    parts.append("+addr" if config.address_labels else "-addr")
    parts.append("+cond-ner" if config.condition_ner_model_id is not None else "+cond-dict")
    return "".join(parts)


def process_text_job(client: ApiClient, config: Config, item_id: str, session_id: str) -> None:
    """텍스트 일감 1건 (D51 · ADR-0027): 원문 받기 → 2차 마스킹 → 스냅샷 전송 → 완료.

    받는 텍스트는 서버가 1차 치환(등록 PII → 가명 ID)을 끝낸 공식 기록이다. 여기서
    NER·사전·정규식 계층을 얹어야만 그 텍스트가 사업자에게 나갈 수 있다(R3 · D2).
    오디오가 없으므로 전사·감정은 건너뛴다. 중간 파일도 만들지 않는다.
    """
    source = client.get_text_job_source(item_id)
    person_ner, address_ner = _build_person_and_address_ner(config)
    masked, report = masking.mask_text_with_report(
        source,
        person_ner,
        _build_condition_ner_or_none(config),
        address_ner,
    )
    # 건수만 남긴다 — 치환된 원문은 로그에 쓰지 않는다(R3, G3 검증용).
    logger.info("text job %s: masked total=%d detail=%s", item_id, report.total, report.as_mapping())

    digest = hashlib.sha256(masked.encode("utf-8")).hexdigest()
    client.post_masked_source(session_id, {
        "maskedText": masked,
        "sha256": digest,
        "maskingPipelineVersion": masking_pipeline_version(config),
        # 텍스트 일감에는 따로 발췌할 근거가 없다 — 마스킹된 본문 전체가 한 조각이다.
        "evidence": [{
            "id": str(uuid.uuid4()),
            "sourceRef": session_id,
            "sourceSha256": digest,
            "evidenceQuote": masked,
            "sourceStart": 0,
            # 서버는 유니코드 코드 포인트 기준으로 구간을 검증한다.
            "sourceEnd": len(masked),
        }],
    })
    client.complete_text_job(item_id)


def run_once(client: ApiClient, config: Config) -> int:
    """폴링 1회: 오디오 큐와 텍스트 큐를 순차 처리. 처리한 건수 합계를 돌려준다."""
    jobs = client.list_jobs()
    text_jobs = client.list_text_jobs()
    if not jobs and not text_jobs:
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

    for item in text_jobs:
        item_id = str(item.get("id", ""))
        session_id = str(item.get("sessionId", ""))
        if item_id == "" or session_id == "":
            continue
        try:
            process_text_job(client, config, item_id, session_id)
            processed += 1
        except ApiError as error:
            logger.error("text job %s: api error status=%d", item_id, error.status)
        except Exception as error:  # noqa: BLE001
            logger.error("text job %s: %s", item_id, type(error).__name__)
    return processed


def run_forever(client: ApiClient, config: Config) -> None:
    logger.info("polling every %ds against %s", config.poll_interval_seconds, config.api_base_url)
    while True:
        try:
            run_once(client, config)
        except Exception as error:  # noqa: BLE001 — 폴링 자체 실패(네트워크 등)도 루프를 죽이지 않는다
            logger.error("poll failed: %s", type(error).__name__)
        time.sleep(config.poll_interval_seconds)
