"""claim 기반 워커 — Agent 작업 계약 v2 (S5)의 Agent 쪽 절반이다.

한 번의 claim 이 오디오·텍스트 작업을 순서대로 내려주고, 각 claim 은 성공 `result`
또는 실패 `release` 를 정확히 한 번만 수행한다. provider 는 attempt 당 최대 1회 부르고
실패 시 다른 provider 로 갈아타지 않는다(D8 · D77).

D13: 중간 파일(오디오·전사)은 작업별 디렉터리에 두고 성공/실패와 무관하게 즉시 삭제.
R3: 로그에는 작업 ID·건수·소요 시간·예외 유형만 남긴다. 전사 내용·PII·시크릿 금지.
"""

from __future__ import annotations

import hashlib
import logging
import os
import shutil
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from . import masking, repetition
from .api_client import ApiClient, ApiError, AudioDownloadError, MemoryApiClient
from .azure_stt import AzureSttError, preflight_azure, transcribe_azure
from .backup import BACKUP_ADAPTERS, backup_original_if_enabled
from .config import Config
from .diarize import build_diarizer
from .emotion import aggregate_scores
from .results import build_result, build_result_request, canonical_sha256
from .speaker_mapping import BENEFICIARY, assign_speakers, estimate_roles, format_transcript
from .transcribe import (
    AZURE_ENGINE_ID,
    ENGINE_AZURE,
    ENGINE_OFF,
    ENGINE_QWEN,
    QWEN_MODEL_ID,
    build_engine,
    transcribe_audio,
)

logger = logging.getLogger("ccc_pipeline")

EMOTION_DEFERRED = True  # D64: 감정 분석 보류. 켜려면 False. 스키마·모델·테스트는 그대로 둔다.

# 재시도할 값어치가 있는 서버 응답만 transient 로 본다. 나머지 4xx 는 서버가 이미
# 작업 상태를 정했으므로(409·422) Agent 가 release 로 덧쓰지 않는다.
_TRANSIENT_STATUSES = (408, 429)

_HEARTBEAT_INTERVAL_SECONDS = 5 * 60
_READINESS_INTERVAL_SECONDS = 5 * 60


class _RouteMismatchError(Exception):
    pass

def _engine_binding(config: Config) -> tuple[str, str | None]:
    if config.stt_engine == ENGINE_OFF:
        return "off", None
    if config.stt_engine == ENGINE_QWEN and config.stt_model == QWEN_MODEL_ID:
        return "local", ENGINE_QWEN
    if config.stt_engine == ENGINE_AZURE:
        return "azure", AZURE_ENGINE_ID
    raise _RouteMismatchError


def _validate_job_engine(config: Config, job: dict[str, Any]) -> None:
    if "sttEngine" not in job or "sttEngineId" not in job:
        raise _RouteMismatchError
    kind = job.get("kind")
    if kind == "text":
        if job.get("sttEngine") is not None or job.get("sttEngineId") is not None:
            raise _RouteMismatchError
        return
    if kind != "audio":
        raise _RouteMismatchError
    route, engine_id = _engine_binding(config)
    if route == "off" or job.get("sttEngine") != route or job.get("sttEngineId") != engine_id:
        raise _RouteMismatchError


class _ReadinessReporter:
    """Refresh liveness independently without touching job leases."""

    def __init__(self, client: ApiClient, config: Config, runtime: WorkerRuntime):
        self._client = client
        self._runtime = runtime
        self._mode, self._engine_id = _engine_binding(config)
        self._state = "unavailable"
        self._capacity = 0
        self._requested_capacity = 0
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._ready_state = "unavailable" if self._mode == "off" else "ready"
        self._idle_capacity = 0 if self._mode == "off" else 1
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="readiness", daemon=True)

    def _report(self) -> None:
        with self._lock:
            state, capacity = self._state, self._capacity
        self._client.report_readiness(self._mode, self._engine_id, state, capacity)

    def start_ready(self) -> None:
        with self._lock:
            self._requested_capacity = self._idle_capacity
            self._state, self._capacity = self._ready_state, self._idle_capacity
        self._report()
        self._thread.start()

    def set_capacity(self, capacity: int) -> None:
        with self._lock:
            self._requested_capacity = min(capacity, self._idle_capacity)
            self._capacity = self._requested_capacity if self._state == "ready" else 0
        self._wake.set()

    def mark_unavailable(self) -> None:
        with self._lock:
            self._state, self._capacity = "unavailable", 0
        self._wake.set()

    def _refresh_runtime(self) -> None:
        if self._mode == "off":
            return
        try:
            self._runtime.check_ready()
        except Exception as error:  # noqa: BLE001
            with self._lock:
                self._state, self._capacity = "unavailable", 0
            logger.error("runtime readiness check failed: %s", type(error).__name__)
            return

    def _run(self) -> None:
        next_healthcheck = time.monotonic() + _READINESS_INTERVAL_SECONDS
        while not self._stop.is_set():
            self._wake.wait(max(0.0, next_healthcheck - time.monotonic()))
            self._wake.clear()
            if self._stop.is_set():
                return
            try:
                if time.monotonic() >= next_healthcheck:
                    self._refresh_runtime()
                    next_healthcheck = time.monotonic() + _READINESS_INTERVAL_SECONDS
                self._report()
            except Exception as error:  # noqa: BLE001
                logger.error("readiness report failed: %s", type(error).__name__)

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread.is_alive():
            self._thread.join()
        with self._lock:
            self._state, self._capacity = "unavailable", 0
        try:
            self._report()
        except Exception as error:  # noqa: BLE001
            logger.error("final readiness report failed: %s", type(error).__name__)


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
    """스냅샷에 남길 마스킹 버전. **실제로 동작한 계층**을 담는다.

    고정 문자열이면 "질병명이 사전으로만 걸러졌는지 NER 까지 거쳤는지" 를 나중에 되짚을 수
    없다 — 마스킹 문제가 발견됐을 때 어느 스냅샷이 영향권인지 가려내는 근거가 이 값이다.
    구분자는 `-` 다: 서버의 버전 식별자 규칙이 `+` 를 받지 않는다.
    """
    parts = ["ner-mask-v1"]
    parts.append("addr" if config.address_labels else "noaddr")
    parts.append("cond-ner" if config.condition_ner_model_id is not None else "cond-dict")
    return "-".join(parts)


def masking_pipeline_hash(config: Config) -> str:
    """실제로 동작한 마스킹 구성의 manifest 해시. 버전 문자열보다 정밀한 지문이다.

    S6 가 canonical manifest 모양을 확정하면 그 정의로 바꾼다 — 지금은 Agent 가 쓰는
    모델·라벨 구성이 곧 manifest 다.
    """
    return canonical_sha256({
        "version": masking_pipeline_version(config),
        "personModelId": config.ner_model_id,
        "personLabels": sorted(config.ner_labels),
        "addressLabels": sorted(config.address_labels),
        "conditionModelId": config.condition_ner_model_id,
        "conditionLabels": sorted(config.condition_ner_labels),
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
        self.person_ner, self.address_ner = _build_person_and_address_ner(config)
        self.condition_ner = _build_condition_ner_or_none(config)


@dataclass
class WorkerRuntime:
    layers: MaskingLayers
    engine: Callable[[str], list[Any]] | None = None
    diarizer: Callable[[str], list[Any]] | None = None
    healthcheck: Callable[[], None] | None = None
    failed: bool = False

    def check_ready(self) -> None:
        if self.failed:
            raise RuntimeError("runtime requires preflight")
        try:
            if self.healthcheck is not None:
                self.healthcheck()
        except Exception:
            self.failed = True
            raise

    def close(self) -> None:
        close = getattr(self.engine, "close", None)
        if callable(close):
            close()


def preflight_worker(config: Config) -> WorkerRuntime:
    """Initialize every required runtime before reporting this worker ready."""
    # Readiness verifies installed immutable snapshots; it never downloads models at startup.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    assert_device_ready(config)
    layers = MaskingLayers(config)
    if config.stt_engine == ENGINE_OFF:
        return WorkerRuntime(layers)
    if config.stt_engine == ENGINE_AZURE:
        if config.azure_speech_key is None:
            raise AzureSttError("credential_unavailable")
        azure_key = config.azure_speech_key
        preflight_azure(azure_key)
        return WorkerRuntime(layers, healthcheck=lambda: preflight_azure(azure_key))
    if config.stt_engine != ENGINE_QWEN or config.stt_model != QWEN_MODEL_ID:
        raise _RouteMismatchError
    engine = build_engine(
        ENGINE_QWEN,
        QWEN_MODEL_ID,
        python_executable=config.stt_python,
        device=config.stt_device,
    )
    try:
        start = getattr(engine, "start", None)
        if not callable(start):
            raise RuntimeError("local engine has no startup preflight")
        start()
        diarizer = build_diarizer(config.hf_token)

        def qwen_healthcheck() -> None:
            is_ready = getattr(engine, "is_ready", None)
            if not callable(is_ready) or not is_ready():
                raise RuntimeError("local engine unavailable")

        return WorkerRuntime(layers, engine, diarizer, qwen_healthcheck)
    except Exception:
        close = getattr(engine, "close", None)
        if callable(close):
            close()
        raise


def _mask_with_dictionary(
    client: ApiClient,
    layers: MaskingLayers,
    job: dict[str, Any],
    text: str,
) -> tuple[str, masking.MaskReport]:
    """일회성 사전으로 등록 PII 를 먼저 치환하고, 그 위에 NER·사전·정규식 계층을 얹는다.

    사전 값은 메모리에서만 쓰고 로그·파일에 남기지 않는다(R3 · S5 §2.1).
    """
    dictionary = client.get_mask_dictionary(job["jobId"], job["claimToken"], job["attempt"])
    replaced = text
    for entry in dictionary.get("entries", []):
        source_value = entry.get("sourceValue")
        replacement = entry.get("replacement")
        if isinstance(source_value, str) and source_value != "" and isinstance(replacement, str):
            replaced = replaced.replace(source_value, replacement)
    return masking.mask_text_with_report(
        replaced,
        layers.person_ner,
        layers.condition_ner,
        layers.address_ner,
    )


def process_audio_job(
    client: ApiClient,
    config: Config,
    job: dict[str, Any],
    backup_adapters=BACKUP_ADAPTERS,  # noqa: ANN001 - 테스트와 향후 adapter 등록을 위한 경계
    *,
    runtime: WorkerRuntime | None = None,
) -> None:
    """오디오 작업 1건: exact engine/NER → 원음 검증 → 한 provider → 마스킹 → 결과."""
    _validate_job_engine(config, job)
    job_id = job["jobId"]
    claim_token = job["claimToken"]
    attempt = job["attempt"]
    configured_route, _ = _engine_binding(config)
    if configured_route == "azure" and config.azure_speech_key is None:
        raise AzureSttError("credential_unavailable")
    if configured_route == "azure":
        _assert_azure_attempt_not_started(config.work_dir, job_id, attempt)

    audio = job.get("audio")
    if (
        not isinstance(audio, dict)
        or not isinstance(audio.get("generationId"), str)
        or audio["generationId"] == ""
        or audio.get("delivery") not in ("api-stream", "protected-get")
    ):
        raise _RouteMismatchError
    work_dir = config.work_dir / f"{job_id}-{uuid.uuid4().hex[:8]}"
    started = time.monotonic()
    engine = runtime.engine if runtime is not None else None
    owns_engine = False
    try:
        with _LeaseHeartbeat(client, job_id, claim_token, attempt) as lease:
            # The business entrypoint preloads these before claiming; direct calls retain fail-closed behavior.
            layers = runtime.layers if runtime is not None else MaskingLayers(config)
            if configured_route == "local" and engine is None:
                engine = build_engine(
                    ENGINE_QWEN,
                    QWEN_MODEL_ID,
                    python_executable=config.stt_python,
                    device=config.stt_device,
                )
                owns_engine = True

            audio_path = client.download_audio(
                job_id,
                claim_token,
                attempt,
                work_dir / "audio.bin",
                delivery=audio["delivery"],
            )
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
                if engine is None:
                    raise _RouteMismatchError
                if runtime is None:
                    from .diarize import diarize  # noqa: PLC0415

                    diarizer = lambda path: diarize(path, config.hf_token)
                else:
                    diarizer = runtime.diarizer
                    if diarizer is None:
                        raise _RouteMismatchError
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
                    diarizer(str(audio_path)),
                )
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
            if owns_engine:
                close = getattr(engine, "close", None)
                if callable(close):
                    close()
        finally:
            # Only the per-job directory is removed; durable egress markers live under work_dir.
            shutil.rmtree(work_dir, ignore_errors=True)


def process_text_job(
    client: ApiClient,
    config: Config,
    job: dict[str, Any],
    *,
    runtime: WorkerRuntime | None = None,
) -> None:
    """텍스트 작업 1건: exact null engine binding → 2차 마스킹 → 결과 제출.

    받는 텍스트는 서버가 1차 치환(등록 PII → 가명 ID)을 끝낸 공식 기록이다. 여기서
    NER·사전·정규식 계층을 얹어야만 그 텍스트가 사업자에게 나갈 수 있다(R3 · D2).
    오디오가 없으므로 전사·감정은 건너뛰고 중간 파일도 만들지 않는다.
    """
    _validate_job_engine(config, job)
    job_id = job["jobId"]
    claim_token = job["claimToken"]
    attempt = job["attempt"]
    layers = runtime.layers if runtime is not None else MaskingLayers(config)
    source = client.get_source(job_id, claim_token, attempt)
    masked, report = _mask_with_dictionary(client, layers, job, source)
    # 건수만 남긴다 — 치환된 원문은 로그에 쓰지 않는다(R3, G3 검증용).
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
    if config.stt_engine != ENGINE_OFF and shutil.which("ffmpeg") is None:
        raise masking.MaskingConfigError(
            "ffmpeg is not installed — silence-boundary chunking would fall back to whole-file "
            "transcription, which ADR-0024 forbids",
        )
    if config.ner_model_id is None:
        raise masking.MaskingConfigError("CCC_NER_MODEL_ID is not set — person-name masking is unavailable")


def _release_failed_job(client: ApiClient, job: dict[str, Any], error: Exception) -> None:
    """실패한 claim 을 정확히 한 번 닫는다. 성공 결과를 보낸 claim 은 여기 오지 않는다."""
    job_id = job["jobId"]
    claim_token = job["claimToken"]
    attempt = job["attempt"]
    try:
        if isinstance(error, masking.MaskingConfigError):
            # NER 계층 부재는 attempt 를 소모하지 않는 차단 신호다(S5 F7).
            client.release(job_id, claim_token, attempt, "blocked", "local_ner_unavailable")
            return
        if isinstance(error, _RouteMismatchError):
            client.release(job_id, claim_token, attempt, "permanent", "route_mismatch")
            return
        if isinstance(error, AudioDownloadError):
            client.release(
                job_id,
                claim_token,
                attempt,
                "transient" if error.transient else "permanent",
                "engine_unavailable" if error.transient else error.reason,
            )
            return
        if isinstance(error, AzureSttError):
            if error.transient:
                client.release(job_id, claim_token, attempt, "transient", "engine_unavailable")
            else:
                client.release(job_id, claim_token, attempt, "permanent", "permanent_failure")
            return
        if isinstance(error, ApiError):
            if error.status in _TRANSIENT_STATUSES or error.status >= 500:
                client.release(job_id, claim_token, attempt, "transient", "engine_unavailable")
            elif error.code == "result_schema_invalid":
                # S6 판정이 아닌 형식 거부는 서버가 상태를 바꾸지 않는다. 그 하나만 Agent 가
                # 같은 이름의 permanent 사유로 닫는다 - 안 닫으면 임대 만료 복구가 attempt 를
                # 태우고 사유가 retry_exhausted 로 바뀐다.
                client.release(job_id, claim_token, attempt, "permanent", "result_schema_invalid")
            # 그 밖의 4xx 는 서버가 코드를 저장하고 작업을 닫은 응답이라 덧쓰지 않는다(S5 §2.6).
            return
        # 전사·화자 분리 등 엔진 실패는 같은 route·engine 으로 최대 3회까지 재시도한다.
        client.release(job_id, claim_token, attempt, "transient", "engine_unavailable")
    except ApiError as release_error:
        logger.error("job %s: release failed status=%d", job_id, release_error.status)


def run_once(
    client: ApiClient,
    config: Config,
    *,
    runtime: WorkerRuntime | None = None,
    readiness: _ReadinessReporter | None = None,
) -> int:
    """Claim once; actual entrypoints pass a successfully preflighted runtime."""
    jobs = client.claim_jobs(claim_request(config))
    if not jobs:
        logger.info("no jobs")
        return 0
    if readiness is not None:
        readiness.set_capacity(0)
    try:
        processed = 0
        for job in jobs:
            if not isinstance(job, dict):
                logger.error("claim response contained an unusable job")
                continue
            job_id = str(job.get("jobId", ""))
            kind = job.get("kind")
            if (
                job_id == ""
                or job.get("claimToken") is None
                or kind not in ("audio", "text")
                or "sttEngineId" not in job
            ):
                logger.error("claim response contained an unusable job")
                continue
            try:
                if runtime is not None and runtime.failed:
                    raise RuntimeError("runtime requires preflight")
                if kind == "audio":
                    process_audio_job(client, config, job, runtime=runtime)
                else:
                    process_text_job(client, config, job, runtime=runtime)
                processed += 1
            except Exception as error:  # noqa: BLE001
                if kind == "audio" and not isinstance(error, (ApiError, _RouteMismatchError)):
                    if runtime is not None:
                        runtime.failed = True
                    if readiness is not None:
                        readiness.mark_unavailable()
                logger.error("job %s: %s", job_id, type(error).__name__)
                _release_failed_job(client, job, error)
        return processed
    finally:
        if readiness is not None:
            readiness.set_capacity(1)


def run_memory_once(
    client: ApiClient,
    config: Config,
    *,
    runtime: WorkerRuntime | None = None,
    readiness: _ReadinessReporter | None = None,
) -> int:
    scoped = MemoryApiClient(client)
    jobs = scoped.claim_jobs(claim_request(config))
    if readiness is not None and jobs:
        readiness.set_capacity(0)
    try:
        processed = 0
        for job in jobs:
            if (
                not isinstance(job, dict)
                or job.get("purpose") != "counseling_memory"
                or job.get("kind") != "text"
                or "sttEngineId" not in job
            ):
                raise ApiError(200, "malformed memory job")
            try:
                process_text_job(scoped, config, job, runtime=runtime)
                processed += 1
            except Exception as error:  # noqa: BLE001
                logger.error("memory job %s: %s", job.get("jobId"), type(error).__name__)
                _release_failed_job(scoped, job, error)
        return processed
    finally:
        if readiness is not None and jobs:
            readiness.set_capacity(1)


def _report_unavailable(client: ApiClient, config: Config) -> None:
    mode, engine_id = _engine_binding(config)
    try:
        client.report_readiness(mode, engine_id, "unavailable", 0)
    except Exception as error:  # noqa: BLE001
        logger.error("unavailable readiness report failed: %s", type(error).__name__)


def run_checked_once(client: ApiClient, config: Config) -> int:
    """One business poll with real preflight and bounded readiness lifetime."""
    runtime = None
    reporter = None
    try:
        runtime = preflight_worker(config)
        reporter = _ReadinessReporter(client, config, runtime)
        reporter.start_ready()
        return run_once(client, config, runtime=runtime, readiness=reporter)
    except Exception:
        if reporter is None:
            _report_unavailable(client, config)
        raise
    finally:
        if reporter is not None:
            reporter.stop()
        if runtime is not None:
            runtime.close()


def run_forever(client: ApiClient, config: Config) -> None:
    logger.info("claiming every %ds against %s", config.poll_interval_seconds, config.api_base_url)
    while True:
        runtime = None
        try:
            runtime = preflight_worker(config)
            reporter = _ReadinessReporter(client, config, runtime)
            reporter.start_ready()
        except Exception as error:  # noqa: BLE001
            _report_unavailable(client, config)
            logger.error("runtime preflight failed: %s", type(error).__name__)
            if runtime is not None:
                runtime.close()
            time.sleep(config.poll_interval_seconds)
            continue
        try:
            while not runtime.failed:
                try:
                    run_once(client, config, runtime=runtime, readiness=reporter)
                except Exception as error:  # noqa: BLE001
                    logger.error("claim failed: %s", type(error).__name__)
                if runtime.failed:
                    break
                try:
                    run_memory_once(client, config, runtime=runtime, readiness=reporter)
                except Exception as error:  # noqa: BLE001
                    logger.error("memory claim failed: %s", type(error).__name__)
                time.sleep(config.poll_interval_seconds)
        finally:
            reporter.stop()
            runtime.close()
        time.sleep(config.poll_interval_seconds)
