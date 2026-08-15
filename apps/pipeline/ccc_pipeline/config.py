"""환경 변수 → 설정. 시크릿은 Infisical 주입으로만 들어온다 — 코드·레포에 값을 두지 않는다 (CLAUDE.md §10)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from . import chunking, masking, repetition, transcribe  # 기본값 정본은 각 모듈에 둔다(중복 금지)
from .backup import BACKUP_ADAPTERS, BackupPolicy, assert_backup_destination_available, validate_backup_policy

PRODUCTION_API_BASE_URL = "https://ccc-api.account-855.workers.dev"
PREVIEW_API_BASE_URL = "https://ccc-api-preview.account-855.workers.dev"


class ConfigError(Exception):
    """필수 환경 변수 누락 등 설정 오류. 메시지에 시크릿 값을 절대 넣지 않는다 (R3)."""


@dataclass(frozen=True)
class Config:
    api_base_url: str
    client_id: str | None
    client_secret: str | None
    preview_access_code: str | None
    poll_interval_seconds: int
    work_dir: Path
    whisper_model: str
    # STT 엔진은 갈아끼울 수 있게 둔다 — 확정은 실측 게이트 G1~G3 후다(D53).
    stt_engine: str
    stt_max_chunk_seconds: float
    stt_min_chunk_seconds: float
    stt_repeat_threshold: int
    ner_model_id: str | None
    # 모델이 인명에 붙이는 라벨 접두. **모델과 한 쌍**이라 함께 설정한다 — KLUE 계열은
    # PS/PER, PII 전용 모델은 NAME 계열로 서로 다르다. 틀리면 마스킹이 조용히 0건이 되므로,
    # 모델을 불러올 때 그 모델이 선언한 라벨 목록과 대조해 안 맞으면 뜨지 않는다(masking.py).
    ner_labels: tuple[str, ...]
    # 주소 계층 라벨(2026-08-01 Q 결정). 비우면 주소를 가리지 않는다 — 주소를 안 잡는
    # 모델로 갈아탈 때의 경로다. 비어 있지 않은데 모델이 그 라벨이 없으면 뜨지 않는다.
    address_labels: tuple[str, ...]
    # 질병명 NER 은 인명 NER 과 다른 모델이라 설정을 따로 둔다. 없어도 사전 계층은 항상 동작한다(G3).
    condition_ner_model_id: str | None
    condition_ner_labels: tuple[str, ...]
    hf_token: str | None
    runtime_environment: str
    backup_policy: BackupPolicy


def _positive_float(name: str, default: float) -> float:
    """잘못된 값이면 기본값으로 되돌린다 — 설정 오타가 전사를 멈추게 하지 않는다."""
    try:
        value = float(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default
    return value if value > 0 else default


def _positive_int(name: str, default: int, minimum: int = 1) -> int:
    try:
        value = int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default
    return value if value >= minimum else default


def _labels(name: str, default: tuple[str, ...], *, allow_empty: bool = False) -> tuple[str, ...]:
    """쉼표로 나열한 라벨 접두 목록. 미설정이면 기본값.

    인명처럼 **꺼지면 안 되는** 계층은 빈 목록을 만들지 않는다(아무 라벨도 안 맞으면
    마스킹이 0건이 되는데 그건 설정이 아니라 사고다). 주소처럼 끌 수 있는 계층만
    `allow_empty=True` 로 두어, `CCC_NER_ADDRESS_LABELS=none` 같은 명시적 해제를 받는다.
    """
    raw = os.environ.get(name, "").strip()
    if raw == "":
        return default
    if allow_empty and raw.lower() in ("none", "off", "-"):
        return ()
    labels = tuple(part.strip().upper() for part in raw.split(",") if part.strip() != "")
    return labels if labels or allow_empty else default


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value == "":
        raise ConfigError(f"environment variable {name} is required")
    return value


def _optional(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def _backup_policy() -> BackupPolicy:
    enabled_raw = os.environ.get("CCC_ORIGINAL_BACKUP_ENABLED", "off").strip().lower()
    if enabled_raw not in ("off", "false", "0", "on", "true", "1"):
        raise ConfigError("environment variable CCC_ORIGINAL_BACKUP_ENABLED is invalid")
    enabled = enabled_raw in ("on", "true", "1")
    retention_raw = _optional("CCC_ORIGINAL_BACKUP_RETENTION_DAYS")
    retention_days: int | None = None
    if retention_raw is not None:
        try:
            retention_days = int(retention_raw)
        except ValueError as error:
            raise ConfigError("environment variable CCC_ORIGINAL_BACKUP_RETENTION_DAYS is invalid") from error
    return BackupPolicy(
        enabled=enabled,
        environment=_optional("CCC_ORIGINAL_BACKUP_ENVIRONMENT"),
        purpose=_optional("CCC_ORIGINAL_BACKUP_PURPOSE"),
        destination_ref=_optional("CCC_ORIGINAL_BACKUP_DESTINATION_REF"),
        retention_days=retention_days,
        consent_notice_version=_optional("CCC_ORIGINAL_BACKUP_CONSENT_NOTICE_VERSION"),
    )


def load_config() -> Config:
    interval_raw = os.environ.get("CCC_POLL_INTERVAL_SECONDS", "600").strip()
    try:
        interval = int(interval_raw)
        if interval <= 0:
            raise ValueError
    except ValueError:
        interval = 600

    work_dir = Path(os.environ.get("CCC_WORK_DIR", "").strip() or Path.home() / ".cache" / "ccc-pipeline")

    runtime_environment = _required("CCC_RUNTIME_ENVIRONMENT").lower()
    if runtime_environment not in ("preview", "production"):
        raise ConfigError("environment variable CCC_RUNTIME_ENVIRONMENT is invalid")

    configured_url = _optional("CCC_API_BASE_URL")
    client_id = _optional("CCC_PIPELINE_CLIENT_ID")
    client_secret = _optional("CCC_PIPELINE_CLIENT_SECRET")
    preview_access_code = _optional("CCC_PREVIEW_E2E_ACCESS_CODE")
    if runtime_environment == "preview":
        api_base_url = (configured_url or PREVIEW_API_BASE_URL).rstrip("/")
        if api_base_url != PREVIEW_API_BASE_URL:
            raise ConfigError("preview runtime requires the Preview API URL")
        if client_id is not None or client_secret is not None:
            raise ConfigError("preview runtime must not receive production Access credentials")
        if preview_access_code is None:
            raise ConfigError("environment variable CCC_PREVIEW_E2E_ACCESS_CODE is required")
    else:
        api_base_url = (configured_url or PRODUCTION_API_BASE_URL).rstrip("/")
        if api_base_url != PRODUCTION_API_BASE_URL:
            raise ConfigError("production runtime requires the production API URL")
        if preview_access_code is not None:
            raise ConfigError("production runtime must not receive Preview credentials")
        if client_id is None:
            raise ConfigError("environment variable CCC_PIPELINE_CLIENT_ID is required")
        if client_secret is None:
            raise ConfigError("environment variable CCC_PIPELINE_CLIENT_SECRET is required")
    backup_policy = _backup_policy()
    try:
        validate_backup_policy(backup_policy, runtime_environment)
        assert_backup_destination_available(backup_policy, BACKUP_ADAPTERS)
    except Exception as error:
        raise ConfigError("original recording backup policy is invalid") from error

    return Config(
        api_base_url=api_base_url,
        client_id=client_id,
        client_secret=client_secret,
        preview_access_code=preview_access_code,
        poll_interval_seconds=interval,
        work_dir=work_dir,
        whisper_model=os.environ.get("CCC_WHISPER_MODEL", "").strip() or "medium",
        stt_engine=os.environ.get("CCC_STT_ENGINE", "").strip() or transcribe.ENGINE_WHISPER,
        stt_max_chunk_seconds=_positive_float("CCC_STT_MAX_CHUNK_SECONDS", chunking.DEFAULT_MAX_CHUNK_SECONDS),
        stt_min_chunk_seconds=_positive_float("CCC_STT_MIN_CHUNK_SECONDS", chunking.DEFAULT_MIN_CHUNK_SECONDS),
        stt_repeat_threshold=_positive_int("CCC_STT_REPEAT_THRESHOLD", repetition.DEFAULT_REPEAT_THRESHOLD, minimum=2),
        ner_model_id=os.environ.get("CCC_NER_MODEL_ID", "").strip() or None,
        ner_labels=_labels("CCC_NER_LABELS", masking.DEFAULT_PERSON_LABELS),
        address_labels=_labels("CCC_NER_ADDRESS_LABELS", masking.DEFAULT_ADDRESS_LABELS, allow_empty=True),
        condition_ner_model_id=os.environ.get("CCC_CONDITION_NER_MODEL_ID", "").strip() or None,
        condition_ner_labels=_labels("CCC_CONDITION_NER_LABELS", masking.DEFAULT_CONDITION_LABELS),
        hf_token=os.environ.get("HF_TOKEN", "").strip() or None,
        runtime_environment=runtime_environment,
        backup_policy=backup_policy,
    )
