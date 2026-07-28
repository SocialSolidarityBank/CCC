"""환경 변수 → 설정. 시크릿은 Infisical 주입으로만 들어온다 — 코드·레포에 값을 두지 않는다 (CLAUDE.md §10)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

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
    ner_model_id: str | None
    hf_token: str | None


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
        ner_model_id=os.environ.get("CCC_NER_MODEL_ID", "").strip() or None,
        hf_token=os.environ.get("HF_TOKEN", "").strip() or None,
    )
