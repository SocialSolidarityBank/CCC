"""환경 변수 → 설정. 시크릿은 Infisical 주입으로만 들어온다 — 코드·레포에 값을 두지 않는다 (CLAUDE.md §10)."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit

from . import chunking, repetition, transcribe  # 기본값 정본은 각 모듈에 둔다(중복 금지)
from .backup import BACKUP_ADAPTERS, BackupPolicy, assert_backup_destination_available, validate_backup_policy
from .masking_manifest import MaskingPipelineManifestError, load_active_masking_pipeline
from .model_registry import ModelRegistryError, model_spec, role_spec


PRODUCTION_API_BASE_URL = "https://ccc-api.account-855.workers.dev"
PREVIEW_API_BASE_URL = "https://ccc-api-preview.account-855.workers.dev"


class ConfigError(Exception):
    """필수 환경 변수 누락 등 설정 오류. 메시지에 시크릿 값을 절대 넣지 않는다 (R3)."""


@dataclass(frozen=True)
class Config:
    api_base_url: str
    client_id: str | None = field(repr=False)
    client_secret: str | None = field(repr=False)
    preview_access_code: str | None = field(repr=False)
    poll_interval_seconds: int
    work_dir: Path
    stt_model: str
    stt_python: Path | None
    stt_device: str
    azure_speech_key: str | None = field(repr=False)
    # STT 엔진은 갈아끼울 수 있게 둔다 — 확정은 실측 게이트 G1~G3 후다(D53).
    stt_engine: str
    stt_max_chunk_seconds: float
    stt_min_chunk_seconds: float
    stt_repeat_threshold: int
    masking_pipeline_version: str
    masking_pipeline_hash: str
    ner_model_id: str
    # 모델, revision, 라벨은 canonical masking manifest의 한 tuple이다. 개별 환경
    # 변수로 덮어쓰지 않아야 서버가 허용한 identity와 실제 실행이 갈라지지 않는다.
    ner_labels: tuple[str, ...]
    address_labels: tuple[str, ...]
    # 질병명 NER은 같은 manifest 안에서 독립 모델 tuple로 선언한다. 모델이 없을 때도
    # versioned 사전 계층은 항상 동작한다(G3).
    condition_ner_model_id: str | None
    condition_ner_labels: tuple[str, ...]
    hf_token: str | None = field(repr=False)
    runtime_environment: str
    # S5 claim 이 요구하는 S6 attestation 과 E5-4 release 영수증. 값의 정본은 서버가 갖고
    # Agent 는 그대로 실어 보낸다. 없으면 claim 자체가 성립하지 않아 워커가 뜨지 않는다(R3).
    ner_attestation: dict[str, str]
    ner_release_receipt_id: str
    audio_download_origin: str | None
    # E6-4: 운영 자격이 페어링 Bearer 인지(True) E2-7 까지의 legacy Access 서비스
    # 토큰인지(False) 가른다. refresh 값 자체는 Config 에 두지 않는다 — 출처는
    # `api_client.AgentCredentialSource` 이고 이 플래그는 어느 레인인지만 말한다.
    agent_bearer_auth: bool
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




def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if value == "":
        raise ConfigError(f"environment variable {name} is required")
    return value


def _optional(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def _optional_https_origin(name: str) -> str | None:
    value = _optional(name)
    if value is None:
        return None
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as error:
        raise ConfigError(f"environment variable {name} is invalid") from error
    if (
        parsed.scheme != "https"
        or parsed.hostname is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ConfigError(f"environment variable {name} must be an HTTPS origin")
    host = parsed.hostname.lower()
    authority = f"[{host}]" if ":" in host else host
    if port is not None and port != 443:
        authority += f":{port}"
    return f"https://{authority}"


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


_NER_ATTESTATION_FIELDS = (
    "id",
    "modelId",
    "modelRevision",
    "labelSetHash",
    "corpusHash",
    "resultHash",
    "validatedAt",
    "expiresAt",
)


def _ner_attestation() -> dict[str, str]:
    """`CCC_NER_ATTESTATION` 은 S5 `NerAttestation` 그대로의 JSON 이다.

    필드를 환경 변수 8개로 쪼개지 않는다 — 서버가 정본을 갖고 Agent 는 통째로 옮기므로
    한 값이 낫다. 모양이 어긋나면 claim 이 `local_ner_unavailable` 로 닫히기 전에 여기서 뜬다.
    """
    raw = _required("CCC_NER_ATTESTATION")
    try:
        parsed = json.loads(raw)
    except ValueError as error:
        raise ConfigError("environment variable CCC_NER_ATTESTATION is not valid JSON") from error
    if not isinstance(parsed, dict) or any(
        not isinstance(parsed.get(field), str) or parsed.get(field) == "" for field in _NER_ATTESTATION_FIELDS
    ):
        raise ConfigError("environment variable CCC_NER_ATTESTATION is incomplete")
    if parsed.get("status") != "passed":
        raise ConfigError("environment variable CCC_NER_ATTESTATION must carry a passed status")
    return {**{field: parsed[field] for field in _NER_ATTESTATION_FIELDS}, "status": "passed"}


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
    # 값은 읽지 않는다. 이 자리에서는 페어링 자격이 주입됐는지만 본다 (R3).
    agent_bearer_auth = "CCC_AGENT_REFRESH_TOKEN" in os.environ and bool(
        os.environ["CCC_AGENT_REFRESH_TOKEN"].strip()
    )
    if runtime_environment == "preview":
        api_base_url = (configured_url or PREVIEW_API_BASE_URL).rstrip("/")
        if api_base_url != PREVIEW_API_BASE_URL:
            raise ConfigError("preview runtime requires the Preview API URL")
        if client_id is not None or client_secret is not None:
            raise ConfigError("preview runtime must not receive production Access credentials")
        if agent_bearer_auth:
            raise ConfigError("preview runtime must not receive the Agent pairing credential")
        if preview_access_code is None:
            raise ConfigError("environment variable CCC_PREVIEW_E2E_ACCESS_CODE is required")
    else:
        api_base_url = (configured_url or PRODUCTION_API_BASE_URL).rstrip("/")
        if api_base_url != PRODUCTION_API_BASE_URL:
            raise ConfigError("production runtime requires the production API URL")
        if preview_access_code is not None:
            raise ConfigError("production runtime must not receive Preview credentials")
        # 두 레인은 배타적이다: 페어링 Bearer 하나, 또는 legacy Access 자격 한 쌍.
        if agent_bearer_auth:
            if client_id is not None or client_secret is not None:
                raise ConfigError("Agent pairing credential excludes production Access credentials")
        elif client_id is None:
            raise ConfigError("environment variable CCC_PIPELINE_CLIENT_ID is required")
        elif client_secret is None:
            raise ConfigError("environment variable CCC_PIPELINE_CLIENT_SECRET is required")
    backup_policy = _backup_policy()
    try:
        validate_backup_policy(backup_policy, runtime_environment)
        assert_backup_destination_available(backup_policy, BACKUP_ADAPTERS)
    except Exception as error:
        raise ConfigError("original recording backup policy is invalid") from error
    stt_engine = os.environ.get("CCC_STT_ENGINE", "").strip() or transcribe.ENGINE_OFF
    if stt_engine not in transcribe.BUSINESS_ENGINES:
        raise ConfigError("environment variable CCC_STT_ENGINE is invalid")
    if stt_engine == transcribe.ENGINE_QWEN and runtime_environment != "preview":
        raise ConfigError("unapproved local STT candidate is restricted to Preview")
    configured_stt_model = _optional("CCC_STT_MODEL")
    if configured_stt_model is not None and configured_stt_model != transcribe.QWEN_MODEL_ID:
        raise ConfigError("environment variable CCC_STT_MODEL cannot override the fixed business engine")
    stt_model = (
        transcribe.QWEN_MODEL_ID
        if stt_engine == transcribe.ENGINE_QWEN
        else configured_stt_model or ""
    )
    stt_python_raw = os.environ.get("CCC_STT_PYTHON", "").strip()
    stt_python = Path(stt_python_raw) if stt_python_raw else None
    stt_device = os.environ.get("CCC_STT_DEVICE", "").strip().lower() or "cpu"
    if stt_device not in ("cpu", "cuda", "mps"):
        raise ConfigError("environment variable CCC_STT_DEVICE is invalid")
    if stt_engine == transcribe.ENGINE_QWEN and stt_python is None:
        raise ConfigError("environment variable CCC_STT_PYTHON is required for qwen3-asr")
    azure_speech_key = _optional("AZURE_SPEECH_KEY")
    if stt_engine == transcribe.ENGINE_AZURE and azure_speech_key is None:
        raise ConfigError("environment variable AZURE_SPEECH_KEY is required for Azure STT")
    try:
        masking_manifest = load_active_masking_pipeline(_required("MEMORY_MASKING_PIPELINES"))
        ner_model = model_spec(masking_manifest.ner_model_id)
        if ner_model.revision != masking_manifest.ner_model_revision:
            raise MaskingPipelineManifestError("masking pipeline NER revision does not match model manifest")
        if masking_manifest.condition_ner_model_id is not None:
            condition_model = model_spec(masking_manifest.condition_ner_model_id)
            if condition_model.revision != masking_manifest.condition_ner_model_revision:
                raise MaskingPipelineManifestError("masking pipeline condition NER revision does not match")
        ner_attestation = _ner_attestation()
        if (
            ner_attestation["modelId"] != masking_manifest.ner_model_id
            or ner_attestation["modelRevision"] != masking_manifest.ner_model_revision
            or ner_attestation["labelSetHash"] != masking_manifest.label_set_hash
            or ner_attestation["corpusHash"] != masking_manifest.ner_health_corpus_hash
            or ner_attestation["resultHash"] != masking_manifest.ner_health_result_hash
        ):
            raise MaskingPipelineManifestError("masking pipeline health attestation does not match")
        if stt_engine == transcribe.ENGINE_QWEN:
            role_spec("qwen-asr", stt_model)
    except (MaskingPipelineManifestError, ModelRegistryError) as error:
        raise ConfigError("environment variable MEMORY_MASKING_PIPELINES is invalid") from error
    audio_download_origin = _optional_https_origin("CCC_AUDIO_DOWNLOAD_ORIGIN")


    return Config(
        api_base_url=api_base_url,
        client_id=client_id,
        client_secret=client_secret,
        preview_access_code=preview_access_code,
        poll_interval_seconds=interval,
        work_dir=work_dir,
        stt_model=stt_model,
        stt_python=stt_python,
        stt_device=stt_device,
        azure_speech_key=azure_speech_key,
        stt_engine=stt_engine,
        stt_max_chunk_seconds=_positive_float("CCC_STT_MAX_CHUNK_SECONDS", chunking.DEFAULT_MAX_CHUNK_SECONDS),
        stt_min_chunk_seconds=_positive_float("CCC_STT_MIN_CHUNK_SECONDS", chunking.DEFAULT_MIN_CHUNK_SECONDS),
        stt_repeat_threshold=_positive_int("CCC_STT_REPEAT_THRESHOLD", repetition.DEFAULT_REPEAT_THRESHOLD, minimum=2),
        masking_pipeline_version=masking_manifest.masking_pipeline_version,
        masking_pipeline_hash=masking_manifest.masking_pipeline_hash,
        ner_model_id=masking_manifest.ner_model_id,
        ner_labels=masking_manifest.person_labels,
        address_labels=masking_manifest.address_labels,
        condition_ner_model_id=masking_manifest.condition_ner_model_id,
        condition_ner_labels=masking_manifest.condition_labels,
        hf_token=os.environ.get("HF_TOKEN", "").strip() or None,
        ner_attestation=ner_attestation,
        ner_release_receipt_id=_required("CCC_NER_RELEASE_RECEIPT_ID"),
        runtime_environment=runtime_environment,
        audio_download_origin=audio_download_origin,
        agent_bearer_auth=agent_bearer_auth,
        backup_policy=backup_policy,
    )
