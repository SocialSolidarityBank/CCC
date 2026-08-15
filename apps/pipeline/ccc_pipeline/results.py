"""처리 장비가 Workers에 제출할 마스킹 완료 결과 계약."""

from __future__ import annotations

import hashlib
import uuid
from typing import Any


def build_recording_result(
    masked_transcript: str,
    emotion_scores: dict[str, float],
    masking_pipeline_version: str,
) -> dict[str, Any]:
    """자리표시 AI 산출물 없이 마스킹된 원천과 숫자형 감정값만 조립한다."""
    if masked_transcript.strip() == "":
        raise ValueError("masked transcript must not be empty")
    digest = hashlib.sha256(masked_transcript.encode("utf-8")).hexdigest()
    return {
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
