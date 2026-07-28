"""Whisper 전사 래퍼 (지연 임포트 — ML 설치 환경 전용)."""

from __future__ import annotations

from .speaker_mapping import Segment


def transcribe(audio_path: str, model_name: str = "medium") -> list[Segment]:
    """오디오 파일 → 전사 구간 목록. 한국어 고정(상담 언어)."""
    import whisper  # noqa: PLC0415

    model = whisper.load_model(model_name)
    result = model.transcribe(audio_path, language="ko")
    return [
        Segment(start=float(s["start"]), end=float(s["end"]), text=str(s["text"]))
        for s in result.get("segments", [])
    ]
