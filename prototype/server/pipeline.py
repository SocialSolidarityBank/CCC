"""처리 파이프라인: STT → 마스킹 → OpenAI 요약.

apps/pipeline/ccc_pipeline 을 sys.path 로 직접 import 한다. 복사하지 않는다.
원음과 원문은 이 모듈 밖으로 나가지 않는다. 반환값은 마스킹된 텍스트와 AI 결과뿐이다.
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / "apps" / "pipeline"))

from ccc_pipeline import azure_stt, masking  # noqa: E402

AI_FLAG_TYPES = (
    "crisis_utterance",
    "contact_loss_risk",
    "housing_livelihood_shock",
    "debt_deterioration",
    "repeated_noncompliance",
    "violence_exploitation",
)


def transcribe(audio_bytes: bytes, suffix: str) -> str:
    """원음 바이트 → 전사문. 임시 파일은 이 함수 안에서만 살고 지워진다.

    운영 어댑터는 diarization 을 켜서 보내는데, 그 응답은 phrase 끝이 총 길이를
    넘는 경우가 있어 strict 검증이 malformed_response 로 거부한다. 프로토타입은
    화자 분리가 필요 없으므로 diarization 없이 보낸다.
    """
    fd, path = tempfile.mkstemp(suffix=suffix or ".bin")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(audio_bytes)
        return _transcribe_no_diarization(path)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def _transcribe_no_diarization(audio_path: str) -> str:
    import json
    import urllib.request
    import uuid

    key = os.environ["AZURE_SPEECH_KEY"]
    with open(audio_path, "rb") as f:
        data = f.read()
    boundary = f"ccc-{uuid.uuid4().hex}"
    definition = json.dumps({"locales": ["ko-KR"]}, separators=(",", ":")).encode()
    body = (
        f"--{boundary}\r\n"
        'Content-Disposition: form-data; name="definition"\r\n'
        "Content-Type: application/json\r\n\r\n"
    ).encode() + definition + (
        f"\r\n--{boundary}\r\n"
        'Content-Disposition: form-data; name="audio"; filename="audio.bin"\r\n'
        "Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        azure_stt.AZURE_STT_ENDPOINT,
        data=body,
        headers={
            "Ocp-Apim-Subscription-Key": key,
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            payload = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise azure_stt.AzureSttError("provider_http_error", status=e.code) from None
    phrases = payload.get("phrases") or []
    return "\n".join(p["text"] for p in phrases if isinstance(p.get("text"), str))


def mask(text: str, participant: dict) -> str:
    """1차 등록값 치환 → 2차 정규식+질병명 사전. NER 은 PROTOTYPE_NER=1 일 때만."""
    masked = text
    for key in ("name", "phone", "email"):
        value = (participant.get(key) or "").strip()
        if value:
            masked = masked.replace(value, f"[{ {'name':'인명','phone':'전화번호','email':'이메일'}[key] }]")
    ner = None
    if os.environ.get("PROTOTYPE_NER") == "1":
        ner, address_ner = masking.build_person_and_address_ner()
        masked, _report = masking.mask_text_with_report(masked, ner=ner, address_ner=address_ner)
    else:
        masked = masking.mask_text(masked)
    return masked


def mask_structure(value: object, participant: dict) -> object:
    """구조화 폼의 모든 문자열을 같은 마스킹 경로로 처리한다."""
    if isinstance(value, str):
        return mask(value, participant)
    if isinstance(value, list):
        return [mask_structure(item, participant) for item in value]
    if isinstance(value, dict):
        return {key: mask_structure(item, participant) for key, item in value.items()}
    return value


def summarize(masked_text: str, memo: str | None) -> dict:
    """마스킹된 텍스트만 OpenAI 로 보낸다. store=False."""
    from openai import OpenAI

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    materials = f"[전사]\n{masked_text}" if masked_text else ""
    if memo:
        materials += f"\n\n[수기 메모]\n{memo}"
    resp = client.responses.create(
        model=os.environ.get("PROTOTYPE_OPENAI_MODEL", "gpt-5-mini"),
        store=False,
        instructions=(
            "당신은 비영리 사례관리 상담 기록을 정리하는 도우미입니다. "
            "제공된 자료만 근거로 삼고, 자료에 없는 사실을 만들지 않습니다. "
            "지원 지속·중단 판단이나 심리 진단은 하지 않습니다."
        ),
        input=(
            "아래 상담 자료를 정리해 JSON으로만 답하세요.\n"
            "- one_liner: 이 회차 핵심 한 줄(120자 이내, 개행 없음)\n"
            "- claims: 목표 중심 정리 3구획: goal_discussions(회기 목표별 논의), "
            "  other_topics(목표 밖 주요 내용, 시간순), promises(다음 회차까지 약속·할 일). 각 항목은 text 하나.\n"
            "- questions: 다음 상담 전 확인할 것 최대 3개: title(80자 이내), reason, evidence(자료 원문 인용)\n"
            "- flag_suggestions: 아래 여섯 식별자 중 해당하는 것만: crisis_utterance, contact_loss_risk, "
            "housing_livelihood_shock, debt_deterioration, repeated_noncompliance, violence_exploitation. "
            "flag_type에는 식별자만 넣고 quote에는 자료 원문 인용을 넣으세요.\n\n"
            f"{materials}"
        ),
        text={
            "format": {
                "type": "json_schema",
                "name": "session_draft",
                "strict": True,
                "schema": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["one_liner", "claims", "questions", "flag_suggestions"],
                    "properties": {
                        "one_liner": {"type": "string", "maxLength": 120},
                        "claims": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["goal_discussions", "other_topics", "promises"],
                            "properties": {
                                "goal_discussions": {"type": "array", "items": {"type": "string"}},
                                "other_topics": {"type": "array", "items": {"type": "string"}},
                                "promises": {"type": "array", "items": {"type": "string"}},
                            },
                        },
                        "questions": {
                            "type": "array",
                            "maxItems": 3,
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["title", "reason", "evidence"],
                                "properties": {
                                    "title": {"type": "string", "maxLength": 80},
                                    "reason": {"type": "string"},
                                    "evidence": {"type": "string"},
                                },
                            },
                        },
                        "flag_suggestions": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["flag_type", "quote"],
                                "properties": {
                                    "flag_type": {"type": "string", "enum": list(AI_FLAG_TYPES)},
                                    "quote": {"type": "string"},
                                },
                            },
                        },
                    },
                },
            }
        },
    )
    import json

    return json.loads(resp.output_text)
