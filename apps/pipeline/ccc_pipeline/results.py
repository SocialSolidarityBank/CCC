"""Agent 가 제출하는 v2 결과 payload (S5 §2.1).

hash 3종을 계약대로 계산한다: 본문 `sha256`, 근거 배열의 `evidenceHash`, 그리고
`payloadSha256 = SHA-256(JCS({schemaVersion, attempt, result}))`. 서버가 같은 방식으로
다시 계산해 대조하므로 canonical JSON 규칙(RFC 8785 부분집합)을 여기서 지킨다.
"""

from __future__ import annotations

import hashlib
import json
import uuid
from typing import Any

SCHEMA_VERSION = 2


def _canonical_number(value: float) -> float | int:
    """JSON.stringify 와 같은 표기로 맞춘다 — 1.0 은 `1` 이어야 해시가 일치한다."""
    return int(value) if float(value).is_integer() else value


def _canonical(value: Any) -> Any:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return _canonical_number(value)
    if isinstance(value, list):
        return [_canonical(item) for item in value]
    if isinstance(value, dict):
        return {key: _canonical(value[key]) for key in sorted(value)}
    raise TypeError("canonical JSON value is invalid")


def canonical_json(value: Any) -> str:
    return json.dumps(_canonical(value), separators=(",", ":"), ensure_ascii=False, sort_keys=True)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def canonical_sha256(value: Any) -> str:
    return sha256_hex(canonical_json(value))


def build_result(
    kind: str,
    masked_text: str,
    *,
    masking_pipeline_version: str,
    masking_pipeline_hash: str,
    ner_attestation: dict[str, str],
    release_qualification_receipt_id: str,
    source_ref: str,
    emotion_scores: dict[str, float] | None = None,
    transcript_reliable: bool | None = None,
    transcript_warnings: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """마스킹된 본문 하나를 결과 1건으로 조립한다. 근거는 본문 전체 한 조각이다."""
    if masked_text.strip() == "":
        raise ValueError("masked text must not be empty")
    if kind not in ("audio", "text"):
        raise ValueError("result kind is invalid")
    digest = sha256_hex(masked_text)
    evidence = [{
        "id": str(uuid.uuid4()),
        "sourceRef": source_ref,
        "sourceSha256": digest,
        "evidenceQuote": masked_text,
        "sourceStart": 0,
        "sourceEnd": len(masked_text),
    }]
    result: dict[str, Any] = {
        "kind": kind,
        "maskedText": masked_text,
        "sha256": digest,
        "maskingPipelineVersion": masking_pipeline_version,
        "maskingPipelineHash": masking_pipeline_hash,
        "nerAvailable": True,
        "nerAttestationId": ner_attestation["id"],
        "nerAttestationResultHash": ner_attestation["resultHash"],
        "releaseQualificationReceiptId": release_qualification_receipt_id,
        "evidenceHash": canonical_sha256(evidence),
        "evidence": evidence,
    }
    if kind == "audio":
        if transcript_reliable is None:
            raise ValueError("audio results require a transcript reliability flag")
        result["emotionScores"] = emotion_scores or {}
        result["transcriptReliable"] = transcript_reliable
        result["transcriptWarnings"] = list(transcript_warnings or [])
    return result


def build_result_request(claim_token: str, attempt: int, result: dict[str, Any]) -> dict[str, Any]:
    """결과를 claim 자격과 payload hash 로 감싼다. 같은 hash 재전송은 서버에서 멱등이다."""
    return {
        "schemaVersion": SCHEMA_VERSION,
        "claimToken": claim_token,
        "attempt": attempt,
        "resultId": str(uuid.uuid4()),
        "payloadSha256": canonical_sha256({
            "schemaVersion": SCHEMA_VERSION,
            "attempt": attempt,
            "result": result,
        }),
        "result": result,
    }
