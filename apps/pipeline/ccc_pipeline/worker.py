"""claim 기반 워커 — Agent 작업 계약 v2 (S5)의 Agent 쪽 절반이다.

한 번의 claim 이 오디오·텍스트 작업을 순서대로 내려주고, 각 claim 은 성공 `result`
또는 실패 `release` 를 정확히 한 번만 수행한다. provider 는 attempt 당 최대 1회 부르고
실패 시 다른 provider 로 갈아타지 않는다(D8 · D77).

D13: 중간 파일(오디오·전사)은 작업별 디렉터리에 두고 성공/실패와 무관하게 즉시 삭제.
R3: 로그에는 작업 ID·건수·소요 시간·예외 유형만 남긴다. 전사 내용·PII·시크릿 금지.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
import logging
import os
import shutil
import threading
import time
import uuid
from collections.abc import Callable
from typing import Any

from . import masking, repetition
from .api_client import ApiClient, ApiError, MemoryApiClient
from .azure_stt import AzureSttError, transcribe_azure
from .backup import BACKUP_ADAPTERS, backup_original_if_enabled
from .config import Config
from .emotion import aggregate_scores
from .model_registry import model_spec
from .results import build_result, build_result_request, canonical_sha256
from .speaker_mapping import BENEFICIARY, assign_speakers, estimate_roles, format_transcript
from .secure_memory import SecureMemoryError
from .transcribe import ENGINE_AZURE, ENGINE_OFF, build_engine, transcribe_audio

logger = logging.getLogger("ccc_pipeline")

EMOTION_DEFERRED = True  # D64: 감정 분석 보류. 켜려면 False. 스키마·모델·테스트는 그대로 둔다.

# 재시도할 값어치가 있는 서버 응답만 transient 로 본다. 나머지 4xx 는 서버가 이미
# 작업 상태를 정했으므로(409·422) Agent 가 release 로 덧쓰지 않는다.
_TRANSIENT_STATUSES = (408, 429)
_MASK_DICTIONARY_TTL = timedelta(minutes=5)


class MaskDictionaryError(Exception):
    """사용 경계에서 거부한 사전. 원문 값을 예외에 담지 않는다."""


def _validate_mask_dictionary(
    dictionary: Any,
    job_id: str,
    *,
    current_time: datetime | None = None,
) -> list[dict[str, str]]:
    now = current_time or datetime.now(timezone.utc)
    if not isinstance(dictionary, dict):
        raise MaskDictionaryError("mask dictionary is malformed")
    dictionary_id = dictionary.get("dictionaryId")
    expires_at = dictionary.get("expiresAt")
    if (
        not isinstance(dictionary_id, str)
        or dictionary_id.strip() == ""
        or dictionary.get("jobId") != job_id
        or dictionary.get("oneTime") is not True
        or not isinstance(expires_at, str)
        or not expires_at.endswith("Z")
    ):
        raise MaskDictionaryError("mask dictionary is malformed")
    try:
        expiry = datetime.fromisoformat(expires_at[:-1] + "+00:00")
    except ValueError:
        expiry = None
    if (
        expiry is None
        or expiry.tzinfo is None
        or expiry.utcoffset() != timedelta(0)
        or expiry <= now
        or expiry > now + _MASK_DICTIONARY_TTL
    ):
        raise MaskDictionaryError("mask dictionary is expired or out of scope")
    entries = dictionary.get("entries")
    if not isinstance(entries, list):
        raise MaskDictionaryError("mask dictionary is malformed")
    invalid_entry = any(
        not isinstance(entry, dict)
        or not isinstance(entry.get("field"), str)
        or entry["field"] == ""
        or not isinstance(entry.get("sourceValue"), str)
        or entry["sourceValue"] == ""
        or not isinstance(entry.get("replacement"), str)
        or entry["replacement"] == ""
        for entry in entries
    )
    if invalid_entry:
        entries.clear()
        raise MaskDictionaryError("mask dictionary entry is malformed")
    return entries

_HEARTBEAT_INTERVAL_SECONDS = 5 * 60


class _RouteMismatchError(Exception):
    pass


class _LeaseHeartbeat:
    """Keep a live claim renewed and surface any observed lease loss to the worker."""

    def __init__(self, client: ApiClient, job_id: str, claim_token: str, attempt: int):
        self._client = client
        self._job_id = job_id
        self._claim_token = claim_token
        self._attempt = attempt
        self._stop = threading.Event()
        self._error: Exception | None = None
        self._thread = threading.Thread(target=self._run, name=f"heartbeat-{job_id}", daemon=True)

    def __enter__(self) -> _LeaseHeartbeat:
        self._beat()
        self._thread.start()
        return self

    def __exit__(self, *_args: object) -> None:
        self._stop.set()
        self._thread.join()

    def _beat(self) -> None:
        self._client.heartbeat(self._job_id, self._claim_token, self._attempt)

    def _run(self) -> None:
        while not self._stop.wait(_HEARTBEAT_INTERVAL_SECONDS):
            try:
                self._beat()
            except Exception as error:  # noqa: BLE001 — main path must stop before result/provider work
                self._error = error
                return

    def assert_owned(self) -> None:
        if self._error is not None:
            raise self._error


def _verified_raw_sha256(
    response: object,
    *,
    job_id: str,
    generation_id: object,
    computed_sha256: str,
) -> str:
    if (
        not isinstance(response, dict)
        or response.get("jobId") != job_id
        or response.get("generationId") != generation_id
        or response.get("rawAudioSha256") != computed_sha256
        or not isinstance(response.get("verifiedAt"), str)
        or response["verifiedAt"] == ""
    ):
        raise RuntimeError("malformed audio verification response")
    return computed_sha256


def _parse_future_expiry(value: object) -> datetime:
    if not isinstance(value, str) or value == "":
        raise AzureSttError("authorization_invalid")
    try:
        expires_at = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise AzureSttError("authorization_invalid") from None
    if expires_at.tzinfo is None or expires_at <= datetime.now(timezone.utc):
        raise AzureSttError("authorization_expired")
    return expires_at


def _validate_azure_authorization(
    authorization: object,
    *,
    job_id: str,
    claim_token: str,
    attempt: int,
    raw_audio_sha256: str,
) -> str:
    if not isinstance(authorization, dict):
        raise AzureSttError("authorization_invalid")
    authorization_id = authorization.get("egressAuthorizationId")
    item = authorization.get("tuple")
    if (
        not isinstance(authorization_id, str)
        or authorization_id == ""
        or authorization.get("status") != "authorized"
        or not isinstance(item, dict)
        or not isinstance(item.get("orgId"), str)
        or item["orgId"] == ""
        or item.get("jobId") != job_id
        or item.get("claimTokenHash") != hashlib.sha256(claim_token.encode("utf-8")).hexdigest()
        or item.get("attempt") != attempt
        or item.get("rawAudioSha256") != raw_audio_sha256
        or not isinstance(item.get("consentRevision"), str)
        or item["consentRevision"] == ""
        or item.get("provider") != "azure"
    ):
        raise AzureSttError("authorization_invalid")
    _parse_future_expiry(authorization.get("expiresAt"))
    return authorization_id


def _azure_attempt_marker_path(work_root, job_id: str, attempt: int):  # noqa: ANN001, ANN202
    marker_name = hashlib.sha256(f"{job_id}\0{attempt}".encode("utf-8")).hexdigest()
    return work_root / ".azure-egress-attempts" / marker_name


def _assert_azure_attempt_not_started(work_root, job_id: str, attempt: int) -> None:  # noqa: ANN001
    if _azure_attempt_marker_path(work_root, job_id, attempt).exists():
        raise AzureSttError("egress_attempt_already_started", transient=True)


def _persist_azure_attempt_marker(work_root, job_id: str, attempt: int) -> None:  # noqa: ANN001
    """Durably consume this job attempt before the core in-flight CAS and upload."""
    marker_path = _azure_attempt_marker_path(work_root, job_id, attempt)
    marker_dir = marker_path.parent
    marker_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(marker_dir, 0o700)
    try:
        descriptor = os.open(marker_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError:
        raise AzureSttError("egress_attempt_already_started", transient=True) from None
    try:
        os.write(descriptor, b"started\n")
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    # Windows fsync uses the CRT file commit; directories are not CRT file descriptors.
    if os.name != "nt":
        # Persist both the marker entry and a newly created marker-directory entry.
        for directory in (marker_dir, marker_dir.parent):
            directory_descriptor = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(directory_descriptor)
            finally:
                os.close(directory_descriptor)


def _validate_egress_started(response: object, authorization_id: str) -> None:
    if (
        not isinstance(response, dict)
        or response.get("egressAuthorizationId") != authorization_id
        or response.get("provider") != "azure"
        or response.get("state") != "in_flight"
        or not isinstance(response.get("startedAt"), str)
        or response["startedAt"] == ""
    ):
        raise AzureSttError("in_flight_response_invalid")


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


def masking_pipeline_version(config: Config) -> str:
    """실제 구성과 설치 증명이 S6와 일치할 때만 해당 버전을 사용한다."""
    expected = {
        "modelId": "FrameByFrame/korean-pii-e5-base",
        "modelRevision": "a308c54b4407819624a5661e31e162a269f39818",
        "labelSetHash": "b645305b068070375d95b18979ead77ec584833f6670dd82554605e9ccf4a4fc",
        "corpusHash": "35565215b87909aad5a44c3124a7240ea80151136c9a12846fde05b861b7be59",
        "resultHash": "fd02b5efd65f04f9814959875cefb76b1fa9596e34bd0441aa452be7224f1c72",
        "status": "passed",
    }
    if (
        config.ner_model_id != expected["modelId"]
        or config.ner_labels != ("PRIVATE_PERSON",)
        or config.address_labels != ("PRIVATE_ADDRESS",)
        or config.condition_ner_model_id is not None
        or any(config.ner_attestation.get(key) != value for key, value in expected.items())
        or model_spec(expected["modelId"]).revision != expected["modelRevision"]
    ):
        raise masking.MaskingConfigError("masking configuration does not match S6")
    return "ner-mask-v5"


def masking_pipeline_hash(config: Config) -> str:
    """일반화 규칙과 실제 설치 검사에 묶인 S6 manifest를 해시한다."""
    return canonical_sha256({
        "schemaVersion": 1,
        "maskingPipelineVersion": masking_pipeline_version(config),
        "directIdentifierRulesVersion": "direct-v2",
        "quasiIdentifierRulesVersion": "quasi-v1",
        "regexRulesVersion": "regex-v3",
        "nerDecoderVersion": masking.NER_DECODER_VERSION,
        "nerRuntime": {
            "torch": masking.NER_TORCH_VERSION,
            "transformers": masking.NER_TRANSFORMERS_VERSION,
        },
        "nerWindowing": {
            "maxInputCodepoints": masking.NER_MAX_INPUT_CHARS,
            "windowTokens": masking.NER_WINDOW_TOKENS,
            "overlapTokens": masking.NER_WINDOW_OVERLAP_TOKENS,
            "maxWindows": masking.NER_MAX_WINDOWS,
            "selection": "max-context-earlier-tie-v1",
            "batchSize": 1,
        },
        "nerModelId": config.ner_model_id,
        "nerModelRevision": config.ner_attestation["modelRevision"],
        "labelSetHash": config.ner_attestation["labelSetHash"],
        "nerHealthCorpusHash": config.ner_attestation["corpusHash"],
        "nerHealthResultHash": config.ner_attestation["resultHash"],
        "conditionDictionaryVersion": "condition-dict-v1",
    })


def claim_request(config: Config, limit: int | None = None) -> dict[str, Any]:
    """claim 본문. NER attestation 과 release 영수증이 없으면 claim 자체가 성립하지 않는다."""
    return {
        **({} if limit is None else {"limit": limit}),
        "nerAttestation": config.ner_attestation,
        "releaseQualificationReceiptId": config.ner_release_receipt_id,
    }


class MaskingLayers:
    """마스킹 계층 묶음. 모델은 작업당 한 번만 올린다(장비 메모리는 STT 와 나눠 쓴다)."""

    def __init__(self, config: Config):
        masking_pipeline_version(config)
        self.person_ner, self.address_ner = _build_person_and_address_ner(config)
        self.condition_ner = _build_condition_ner_or_none(config)


def _mask_with_dictionary(
    client: ApiClient,
    layers: MaskingLayers,
    job: dict[str, Any],
    text: str,
) -> tuple[str, masking.MaskingReport]:
    """claim 범위 사전의 등록 PII를 먼저 치환하고 나머지 마스킹 계층을 적용한다."""
    dictionary: Any = None
    entries: list[dict[str, str]] | None = None
    entry: dict[str, str] | None = None
    replaced: str | None = None
    source_value: str | None = None
    replacement: str | None = None
    replacements: dict[str, str] = {}
    spans: list[tuple[int, int, str, int]] = []
    merged: list[tuple[int, int, str, int]] = []
    pieces: list[str] = []
    try:
        dictionary = client.get_mask_dictionary(job["jobId"], job["claimToken"], job["attempt"])
        entries = _validate_mask_dictionary(dictionary, job["jobId"])
        for entry in entries:
            source_value, replacement = entry["sourceValue"], entry["replacement"]
            if source_value.strip() == "" or (
                source_value in replacements and replacements[source_value] != replacement
            ):
                raise MaskDictionaryError("mask dictionary replacements conflict")
            replacements[source_value] = replacement
        if any(source in value for source in replacements for value in replacements.values()):
            raise MaskDictionaryError("mask dictionary replacement contains a registered value")
        # 원문을 담은 정규식을 compile하면 re의 전역 cache에 PII가 남는다.
        # 최대 11종의 등록값은 원문 구간만 찾고 겹친 구간을 한 번에 덮는다.
        for source_value, replacement in replacements.items():
            start = text.find(source_value)
            while start >= 0:
                spans.append((start, start + len(source_value), replacement, len(source_value)))
                start = text.find(source_value, start + 1)
        for start, end, replacement, length in sorted(spans, key=lambda span: (span[0], -span[3])):
            if merged and start < merged[-1][1]:
                previous_start, previous_end, previous_replacement, previous_length = merged[-1]
                if length <= previous_length:
                    replacement, length = previous_replacement, previous_length
                merged[-1] = (previous_start, max(previous_end, end), replacement, length)
            else:
                merged.append((start, end, replacement, length))
        cursor = 0
        for start, end, replacement, _length in merged:
            pieces.extend((text[cursor:start], replacement))
            cursor = end
        pieces.append(text[cursor:])
        replaced = "".join(pieces)
        if any(source in replaced for source in replacements):
            raise MaskDictionaryError("registered value remains after dictionary replacement")
        return masking.mask_text_with_report(
            replaced,
            layers.person_ner,
            layers.condition_ner,
            layers.address_ner,
        )
    finally:
        # 응답 객체와 entry 컨테이너는 이 함수가 단독 소유한다. immutable str와
        # NER 런타임 내부 복사본의 물리적 덮어쓰기는 Python에서 보장할 수 없다.
        if entries is not None:
            entries.clear()
        if isinstance(dictionary, (dict, list)):
            dictionary.clear()
        replacements.clear()
        spans.clear()
        merged.clear()
        pieces.clear()
        dictionary = entries = entry = replaced = source_value = replacement = text = None


def process_audio_job(
    client: ApiClient,
    config: Config,
    job: dict[str, Any],
    backup_adapters=BACKUP_ADAPTERS,  # noqa: ANN001 - 테스트와 향후 adapter 등록을 위한 경계
) -> None:
    """오디오 작업 1건: route/NER → 원음 검증 → 한 provider → 마스킹 → 결과."""
    job_id = job["jobId"]
    claim_token = job["claimToken"]
    attempt = job["attempt"]
    configured_route = "azure" if config.stt_engine == ENGINE_AZURE else "local"
    if config.stt_engine == ENGINE_OFF:
        raise ValueError("STT is disabled")
    if job.get("sttEngine") != configured_route:
        raise _RouteMismatchError
    if configured_route == "azure" and config.azure_speech_key is None:
        raise AzureSttError("credential_unavailable")
    if configured_route == "azure":
        _assert_azure_attempt_not_started(config.work_dir, job_id, attempt)

    audio = job.get("audio") or {}
    work_dir = config.work_dir / f"{job_id}-{uuid.uuid4().hex[:8]}"
    started = time.monotonic()
    engine = None
    layers = None
    transcription = None
    segments = None
    roles = None
    beneficiary_segments = None
    text_scores = None
    speech_scores = None
    chunk = None
    try:
        with _LeaseHeartbeat(client, job_id, claim_token, attempt) as lease:
            # NER health precedes download/model/provider work: a blocked claim makes zero provider calls.
            layers = MaskingLayers(config)
            if configured_route == "local":
                engine = build_engine(
                    config.stt_engine,
                    config.stt_model,
                    python_executable=config.stt_python,
                    device=config.stt_device,
                )

            audio_path = client.download_audio(job_id, claim_token, attempt, work_dir / "audio.bin")
            logger.info("job %s: audio downloaded", job_id)

            digest = hashlib.sha256()
            with open(audio_path, "rb") as file:
                for chunk in iter(lambda: file.read(1024 * 1024), b""):
                    digest.update(chunk)
            computed_sha256 = digest.hexdigest()
            verification = client.verify_audio(job_id, {
                "claimToken": claim_token,
                "attempt": attempt,
                "generationId": audio.get("generationId"),
                "agentComputedSha256": computed_sha256,
            })
            raw_audio_sha256 = _verified_raw_sha256(
                verification,
                job_id=job_id,
                generation_id=audio.get("generationId"),
                computed_sha256=computed_sha256,
            )
            lease.assert_owned()

            backup_status = backup_original_if_enabled(
                config.backup_policy,
                config.runtime_environment,
                audio_path,
                job_id,
                backup_adapters,
            )
            logger.info("job %s: original backup status=%s", job_id, backup_status)

            if configured_route == "azure":

                def before_send() -> None:
                    lease.assert_owned()
                    authorization = client.authorize_egress(job_id, {
                        "claimToken": claim_token,
                        "attempt": attempt,
                        "rawAudioSha256": raw_audio_sha256,
                        "provider": "azure",
                    })
                    authorization_id = _validate_azure_authorization(
                        authorization,
                        job_id=job_id,
                        claim_token=claim_token,
                        attempt=attempt,
                        raw_audio_sha256=raw_audio_sha256,
                    )
                    _persist_azure_attempt_marker(config.work_dir, job_id, attempt)
                    lease.assert_owned()
                    started_egress = client.start_egress(job_id, {
                        "egressAuthorizationId": authorization_id,
                        "claimToken": claim_token,
                        "attempt": attempt,
                    })
                    _validate_egress_started(started_egress, authorization_id)
                    lease.assert_owned()

                transcription = transcribe_azure(
                    str(audio_path),
                    api_key=config.azure_speech_key,
                    before_send=before_send,
                    expected_sha256=raw_audio_sha256,
                )
                segments = transcription.segments
            else:
                # ML imports stay local-only; Azure's provider speaker labels must not be overwritten.
                from .diarize import diarize  # noqa: PLC0415

                transcription = transcribe_audio(
                    str(audio_path),
                    work_dir,
                    engine,
                    max_chunk_seconds=config.stt_max_chunk_seconds,
                    min_chunk_seconds=config.stt_min_chunk_seconds,
                    repeat_threshold=config.stt_repeat_threshold,
                )
                segments = assign_speakers(
                    transcription.segments,
                    diarize(str(audio_path), config.hf_token),
                )
                close = getattr(engine, "close", None)
                if callable(close):
                    close()
                engine = None
            lease.assert_owned()
            if not transcription.reliable:
                logger.warning(
                    "job %s: transcript incomplete — repetition runs=%d",
                    job_id,
                    len(transcription.warnings),
                )

            roles = estimate_roles(segments)
            logger.info("job %s: transcribed segments=%d speakers=%d", job_id, len(segments), len(roles))

            if EMOTION_DEFERRED:
                emotion_scores = {}
            else:
                from .emotion import build_speech_scorer, build_text_scorer  # noqa: PLC0415

                beneficiary_segments = [
                    s for s in segments if not s.warning and roles.get(s.speaker or "") == BENEFICIARY
                ]
                text_scores = (
                    build_text_scorer()([s.text for s in beneficiary_segments])
                    if beneficiary_segments
                    else []
                )
                speech_scores = (
                    build_speech_scorer()(str(audio_path), [(s.start, s.end) for s in beneficiary_segments])
                    if beneficiary_segments
                    else []
                )
                emotion_scores = aggregate_scores(speech_scores, text_scores)

            transcript, mask_report = _mask_with_dictionary(
                client,
                layers,
                job,
                format_transcript(segments, roles),
            )
            logger.info("job %s: masked total=%d detail=%s", job_id, mask_report.total, mask_report.as_mapping())

            result = build_result(
                "audio",
                transcript,
                masking_pipeline_version=masking_pipeline_version(config),
                masking_pipeline_hash=masking_pipeline_hash(config),
                ner_attestation=config.ner_attestation,
                release_qualification_receipt_id=config.ner_release_receipt_id,
                source_ref=f"audio:{job_id}",
                emotion_scores=emotion_scores,
                transcript_reliable=transcription.reliable,
                transcript_warnings=repetition.warning_spans(transcription.warnings),
            )
            _submit_result(
                client,
                job_id,
                build_result_request(claim_token, attempt, result),
                before_first_attempt=lease.assert_owned,
            )
            logger.info("job %s: result posted (%.1fs)", job_id, time.monotonic() - started)
    finally:
        try:
            close = getattr(engine, "close", None)
            if callable(close):
                close()
        finally:
            # Frozen Segment objects cannot be overwritten. Drop mutable container and
            # traceback-local references before deleting the per-job work directory.
            for collection in (beneficiary_segments, text_scores, speech_scores, segments):
                if isinstance(collection, list):
                    collection.clear()
            if isinstance(roles, dict):
                roles.clear()
            if transcription is not None:
                transcription.segments.clear()
                transcription.warnings.clear()
            transcription = segments = roles = beneficiary_segments = None
            text_scores = speech_scores = chunk = None
            layers = None
            # Only the per-job directory is removed; durable egress markers live under work_dir.
            shutil.rmtree(work_dir, ignore_errors=True)


def process_text_job(client: ApiClient, config: Config, job: dict[str, Any]) -> None:
    """텍스트 작업 1건: 원문 받기 → 2차 마스킹 → 결과 제출.

    받는 텍스트는 서버가 1차 치환(등록 PII → 가명 ID)을 끝낸 공식 기록이다. 여기서
    NER·사전·정규식 계층을 얹어야만 그 텍스트가 사업자에게 나갈 수 있다(R3 · D2).
    오디오가 없으므로 전사·감정은 건너뛰고 중간 파일도 만들지 않는다.
    """
    job_id = job["jobId"]
    claim_token = job["claimToken"]
    attempt = job["attempt"]
    layers = MaskingLayers(config)
    source = None
    masked = None
    result = None
    try:
        source = client.get_source(job_id, claim_token, attempt)
        masked, report = _mask_with_dictionary(client, layers, job, source)
        # 건수만 남긴다. 치환된 원문은 로그에 쓰지 않는다(R3, G3 검증용).
        logger.info("text job %s: masked total=%d detail=%s", job_id, report.total, report.as_mapping())

        result = build_result(
            "text",
            masked,
            masking_pipeline_version=masking_pipeline_version(config),
            masking_pipeline_hash=masking_pipeline_hash(config),
            ner_attestation=config.ner_attestation,
            release_qualification_receipt_id=config.ner_release_receipt_id,
            source_ref=f"text:{job_id}",
        )
        _submit_result(client, job_id, build_result_request(claim_token, attempt, result))
    finally:
        # immutable str는 덮어쓸 수 없지만, 예외 traceback의 이 프레임이 원문을
        # 장기 보관하지 않도록 소유 참조를 성공과 실패 양쪽에서 끊는다.
        source = masked = result = layers = None


def _submit_result(
    client: ApiClient,
    job_id: str,
    result_request: dict[str, Any],
    *,
    before_first_attempt: Callable[[], None] | None = None,
) -> None:
    """Check ownership before the first send; let the core adjudicate identical replays."""
    if before_first_attempt is not None:
        before_first_attempt()
    try:
        client.post_result(job_id, result_request)
        return
    except ApiError as error:
        if error.status not in _TRANSIENT_STATUSES and error.status < 500:
            raise
        logger.warning("job %s: result submission retrying after status=%d", job_id, error.status)
    # The core may have committed before returning 5xx, making heartbeats stale.
    # Replay the same payload; its claim/hash checks decide whether it is accepted.
    client.post_result(job_id, result_request)


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


def _release_failed_job(client: ApiClient, job: dict[str, Any], error: Exception) -> None:
    """실패한 claim을 정확히 한 번 닫는다. 성공 결과를 보낸 claim에는 호출하지 않는다."""
    job_id = job["jobId"]
    claim_token = job["claimToken"]
    attempt = job["attempt"]
    try:
        if isinstance(error, masking.MaskingConfigError):
            client.release(job_id, claim_token, attempt, "blocked", "local_ner_unavailable")
            return
        if isinstance(error, _RouteMismatchError):
            client.release(job_id, claim_token, attempt, "permanent", "route_mismatch")
            return
        if isinstance(error, AzureSttError):
            if error.transient:
                client.release(job_id, claim_token, attempt, "transient", "engine_unavailable")
            else:
                client.release(job_id, claim_token, attempt, "permanent", "permanent_failure")
            return
        if isinstance(error, (MaskDictionaryError, SecureMemoryError)):
            client.release(job_id, claim_token, attempt, "permanent", "masking_failed")
            return
        if isinstance(error, ApiError):
            if error.code in ("dictionary_already_consumed", "masking_input_invalid"):
                # 서버가 닫지 않은 dictionary 실패를 STT 재시도로 바꾸지 않는다.
                client.release(job_id, claim_token, attempt, "permanent", "masking_failed")
            elif error.status in _TRANSIENT_STATUSES or error.status >= 500:
                client.release(job_id, claim_token, attempt, "transient", "engine_unavailable")
            elif error.code == "result_schema_invalid":
                client.release(job_id, claim_token, attempt, "permanent", "result_schema_invalid")
            # 나머지 4xx는 서버가 이미 닫은 결과 거부이므로 덧쓰지 않는다.
            return
        client.release(job_id, claim_token, attempt, "transient", "engine_unavailable")
    except ApiError as release_error:
        logger.error("job %s: release failed status=%d", job_id, release_error.status)
    except Exception as release_error:  # noqa: BLE001 - 다음 claim과 원문 traceback을 격리한다
        logger.error("job %s: release failed type=%s", job_id, type(release_error).__name__)


def run_once(client: ApiClient, config: Config) -> int:
    """claim 1회: 받은 순서대로 처리한다. 성공한 건수를 돌려준다."""
    jobs = client.claim_jobs(claim_request(config))
    if not jobs:
        logger.info("no jobs")
        return 0

    processed = 0
    for job in jobs:
        job_id = str(job.get("jobId", ""))
        kind = job.get("kind")
        if job_id == "" or job.get("claimToken") is None or kind not in ("audio", "text"):
            logger.error("claim response contained an unusable job")
            continue
        failure: Exception | None = None
        try:
            if kind == "audio":
                process_audio_job(client, config, job)
            else:
                process_text_job(client, config, job)
            processed += 1
        except Exception as error:  # noqa: BLE001 - 한 작업 실패가 다음 작업을 막지 않는다
            failure = error
        if failure is not None:
            # except 바깥에서 release해 새 오류가 원문 traceback을 context로 붙잡지 않게 한다.
            try:
                logger.error("job %s: %s", job_id, type(failure).__name__)
                _release_failed_job(client, job, failure)
            finally:
                failure.__traceback__ = None
                failure.__context__ = None
                failure.__cause__ = None
                failure = None
    return processed


def run_memory_once(client: ApiClient, config: Config) -> int:
    scoped = MemoryApiClient(client)
    jobs = scoped.claim_jobs(claim_request(config))
    processed = 0
    for job in jobs:
        if job.get("purpose") != "counseling_memory" or job.get("kind") != "text":
            raise ApiError(200, "malformed memory job")
        try:
            process_text_job(scoped, config, job)
            processed += 1
        except Exception as error:  # noqa: BLE001
            logger.error("memory job %s: %s", job.get("jobId"), type(error).__name__)
            _release_failed_job(scoped, job, error)
    return processed


def run_forever(client: ApiClient, config: Config) -> None:
    logger.info("claiming every %ds against %s", config.poll_interval_seconds, config.api_base_url)
    while True:
        try:
            run_once(client, config)
        except Exception as error:  # noqa: BLE001 — claim 자체 실패(네트워크 등)도 루프를 죽이지 않는다
            logger.error("claim failed: %s", type(error).__name__)
        try:
            run_memory_once(client, config)
        except Exception as error:  # noqa: BLE001
            logger.error("memory claim failed: %s", type(error).__name__)
        time.sleep(config.poll_interval_seconds)
