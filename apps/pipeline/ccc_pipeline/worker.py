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

from . import masking, repetition
from .api_client import ApiClient, ApiError
from .backup import BACKUP_ADAPTERS, backup_original_if_enabled
from .config import Config
from .emotion import aggregate_scores
from .results import build_recording_result
from .speaker_mapping import BENEFICIARY, assign_speakers, estimate_roles, format_transcript
from .transcribe import build_engine, transcribe_audio

logger = logging.getLogger("ccc_pipeline")

EMOTION_DEFERRED = True  # D64: 감정 분석 보류. 켜려면 False. 스키마·모델·테스트는 그대로 둔다.


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


def process_job(
    client: ApiClient,
    config: Config,
    job_id: str,
    backup_adapters=BACKUP_ADAPTERS,  # noqa: ANN001 - 테스트와 향후 adapter 등록을 위한 경계
) -> None:
    """작업 1건: 다운로드 → 전사 → 화자 분리 → 역할 추정 → 감정 → 마스킹 → 전송."""
    # ML 모듈은 여기서만 임포트한다 — 미설치 환경에서도 워커 모듈 자체는 로드 가능하게.
    from .diarize import diarize  # noqa: PLC0415
    from .emotion import build_speech_scorer, build_text_scorer  # noqa: PLC0415

    work_dir = config.work_dir / f"{job_id}-{uuid.uuid4().hex[:8]}"
    started = time.monotonic()
    try:
        audio_path = client.download_audio(job_id, work_dir / "audio.bin")
        logger.info("job %s: audio downloaded", job_id)

        # 선택형 원본 백업은 전사·마스킹의 성공 경로를 막지 않는다. 현재 adapter 등록은
        # 비어 있어 기본 OFF만 동작하며, ON 설정은 목적지가 실제로 붙기 전 fail closed한다.
        backup_status = backup_original_if_enabled(
            config.backup_policy,
            config.runtime_environment,
            audio_path,
            job_id,
            backup_adapters,
        )
        logger.info("job %s: original backup status=%s", job_id, backup_status)

        # 조각 분할 + 반복 검사를 거친다 (D53). 반복이 남으면 그 구간은 접히고, 시간
        # 구간·사유가 구조화 필드로 API 에 실려 승인 화면에서 실무자가 본다 (CCC-124)
        # — 조용히 통과시키지 않는다.
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
        # 접힌 반복 구간(warning)은 믿을 수 없는 전사라 감정 집계에서 뺀다 (D53 · R4).
        if EMOTION_DEFERRED:
            emotion_scores = {}
        else:
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
        condition_ner = _build_condition_ner_or_none(config)
        transcript, mask_report = masking.mask_text_with_report(
            format_transcript(segments, roles),
            person_ner,
            condition_ner,
            address_ner,
        )
        # 마스킹 집계는 **건수만** 남긴다 — 치환된 원문은 로그에도 쓰지 않는다(R3, G3 검증용).
        logger.info("job %s: masked total=%d detail=%s", job_id, mask_report.total, mask_report.as_mapping())

        # 전사 품질은 텍스트 안 경고 문장이 아니라 구조화 필드로 싣는다 (CCC-124).
        # 구조화 필드에는 시간 구간·사유 코드만 담는다 — 반복된 문장은 넣지 않는다(R3).
        result = build_recording_result(
            transcript,
            emotion_scores,
            masking_pipeline_version(config),
            transcript_reliable=transcription.reliable,
            transcript_warnings=repetition.warning_spans(transcription.warnings),
        )
        try:
            client.post_recording_result(job_id, result)
        except ApiError as error:
            # 구조화 필드를 모르는 구 서버는 미지의 키를 400 으로 거부한다(requireOnlyKeys).
            # 그때만 옛 형식 — 경고 문장을 전사에 끼워 넣은 레거시 페이로드 — 로 한 번
            # 재시도한다. 진짜 검증 실패(PII 잔존 등)라면 재시도도 같은 400 으로 떨어진다.
            if error.status != 400:
                raise
            logger.warning(
                "job %s: structured transcript fields rejected (400) — retrying with legacy payload", job_id,
            )
            legacy_segments = repetition.inject_legacy_warnings(segments, transcription.warnings)
            legacy_transcript, _ = masking.mask_text_with_report(
                format_transcript(legacy_segments, roles),
                person_ner,
                condition_ner,
                address_ner,
            )
            client.post_recording_result(
                job_id,
                build_recording_result(legacy_transcript, emotion_scores, masking_pipeline_version(config)),
            )
        logger.info("job %s: result posted (%.1fs)", job_id, time.monotonic() - started)
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
