"""pyannote 화자 분리 래퍼 (지연 임포트 — ML 설치 환경 전용, 게이트 모델은 HF_TOKEN 필요)."""

from __future__ import annotations

from .speaker_mapping import Turn

DEFAULT_PIPELINE_ID = "pyannote/speaker-diarization-3.1"


def diarize(audio_path: str, hf_token: str | None, pipeline_id: str = DEFAULT_PIPELINE_ID) -> list[Turn]:
    """오디오 파일 → 화자 구간 목록. 대면 상담은 2인이 기본이라 화자 수 상한 2를 힌트로 준다."""
    from pyannote.audio import Pipeline  # noqa: PLC0415

    pipeline = Pipeline.from_pretrained(pipeline_id, use_auth_token=hf_token)
    diarization = pipeline(audio_path, max_speakers=2)
    return [
        Turn(start=float(turn.start), end=float(turn.end), speaker=str(speaker))
        for turn, _, speaker in diarization.itertracks(yield_label=True)
    ]
