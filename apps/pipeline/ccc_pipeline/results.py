"""처리 장비가 Workers에 제출할 마스킹 완료 결과 계약."""

from __future__ import annotations

import hashlib
import uuid
from typing import Any


def build_recording_result(
    masked_transcript: str,
    emotion_scores: dict[str, float],
    masking_pipeline_version: str,
    transcript_reliable: bool | None = None,
    transcript_warnings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """자리표시 AI 산출물 없이 마스킹된 원천과 숫자형 감정값만 조립한다.

    CCC-124: 전사 품질은 텍스트에 경고 문장을 끼워 넣는 대신 구조화 필드로 싣는다.
    `transcript_reliable=None` 이면 구조화 필드를 아예 넣지 않는다 — 구조화 필드를
    모르는 구 서버(`requireOnlyKeys` 가 미지의 키를 400 으로 거부한다)에 보내는
    레거시 페이로드가 이 모양이다.
    """
    if masked_transcript.strip() == "":
        raise ValueError("masked transcript must not be empty")
    if transcript_reliable is None and transcript_warnings:
        raise ValueError("transcript warnings require an explicit reliability flag")
    digest = hashlib.sha256(masked_transcript.encode("utf-8")).hexdigest()
    result: dict[str, Any] = {
        "maskedText": masked_transcript,
        "sha256": digest,
        "maskingPipelineVersion": masking_pipeline_version,
        "evidence": [{
            "id": str(uuid.uuid4()),
            "sourceRef": "recording-transcript",
            "sourceSha256": digest,
            "evidenceQuote": masked_transcript,
            "sourceStart": 0,
            "sourceEnd": len(masked_transcript),
        }],
        "emotionScores": emotion_scores,
    }
    if transcript_reliable is not None:
        result["transcriptReliable"] = transcript_reliable
        result["transcriptWarnings"] = list(transcript_warnings or [])
    return result
