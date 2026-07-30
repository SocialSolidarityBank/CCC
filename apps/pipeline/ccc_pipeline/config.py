"""환경 변수 → 설정. 시크릿은 Infisical 주입으로만 들어온다 — 코드·레포에 값을 두지 않는다 (CLAUDE.md §10)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from . import chunking, repetition, transcribe  # 기본값 정본은 각 모듈에 둔다(중복 금지)

DEFAULT_API_BASE_URL = "https://ccc-api.account-855.workers.dev"


class ConfigError(Exception):
    """필수 환경 변수 누락 등 설정 오류. 메시지에 시크릿 값을 절대 넣지 않는다 (R3)."""


@dataclass(frozen=True)
class Config:
    api_base_url: str
    client_id: str
    client_secret: str
    poll_interval_seconds: int
    work_dir: Path
    whisper_model: str
    # STT 엔진은 갈아끼울 수 있게 둔다 — 확정은 실측 게이트 G1~G3 후다(D53).
    stt_engine: str
    stt_max_chunk_seconds: float
    stt_min_chunk_seconds: float
    stt_repeat_threshold: int
    ner_model_id: str | None
    # 질병명 NER 은 인명 NER 과 다른 모델이라 설정을 따로 둔다. 없어도 사전 계층은 항상 동작한다(G3).
    condition_ner_model_id: str | None
    hf_token: str | None


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


def load_config() -> Config:
    interval_raw = os.environ.get("CCC_POLL_INTERVAL_SECONDS", "600").strip()
    try:
        interval = int(interval_raw)
        if interval <= 0:
            raise ValueError
    except ValueError:
        interval = 600

    work_dir = Path(os.environ.get("CCC_WORK_DIR", "").strip() or Path.home() / ".cache" / "ccc-pipeline")

    return Config(
        api_base_url=os.environ.get("CCC_API_BASE_URL", "").strip().rstrip("/") or DEFAULT_API_BASE_URL,
        client_id=_required("CCC_PIPELINE_CLIENT_ID"),
        client_secret=_required("CCC_PIPELINE_CLIENT_SECRET"),
        poll_interval_seconds=interval,
        work_dir=work_dir,
        whisper_model=os.environ.get("CCC_WHISPER_MODEL", "").strip() or "medium",
        stt_engine=os.environ.get("CCC_STT_ENGINE", "").strip() or transcribe.ENGINE_WHISPER,
        stt_max_chunk_seconds=_positive_float("CCC_STT_MAX_CHUNK_SECONDS", chunking.DEFAULT_MAX_CHUNK_SECONDS),
        stt_min_chunk_seconds=_positive_float("CCC_STT_MIN_CHUNK_SECONDS", chunking.DEFAULT_MIN_CHUNK_SECONDS),
        stt_repeat_threshold=_positive_int("CCC_STT_REPEAT_THRESHOLD", repetition.DEFAULT_REPEAT_THRESHOLD, minimum=2),
        ner_model_id=os.environ.get("CCC_NER_MODEL_ID", "").strip() or None,
        condition_ner_model_id=os.environ.get("CCC_CONDITION_NER_MODEL_ID", "").strip() or None,
        hf_token=os.environ.get("HF_TOKEN", "").strip() or None,
    )
