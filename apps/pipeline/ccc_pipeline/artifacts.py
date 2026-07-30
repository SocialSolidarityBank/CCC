"""POST /pipeline/jobs/:id/artifacts 본문 조립 (docs/api-contract-pipeline.md 계약).

서버 검증 규칙(request-handler parseArtifacts + gateway ingestSessionArtifacts):
- transcript·aiSummary: 비어 있으면 400 (requiredString)
- aiContrast: 세 배열 필수(빈 배열 허용)
- emotionScores: 유한 숫자만 (R4)
- flagProposals·gasEvidence: 배열 필수(빈 배열 허용), 항목이 있으면 인용 필수

AI 대조·요약·플래그 제안은 2단계-c 범위(D16·D18 대기)라 지금은 빈 값/자리표시로
보낸다 — 승인 화면에서 이 문구가 그대로 보이므로, 미생성 사실이 드러나는 문구를 쓴다.
"""

from __future__ import annotations

from typing import Any

# aiSummary는 서버가 비어 있으면 거부한다. 2단계-c(AI 대조 프롬프트) 연결 전까지
# 미생성임이 화면에서 명확히 보이는 고정 문구를 보낸다.
AI_SUMMARY_PLACEHOLDER = "(AI 요약 미생성 — AI 대조·요약은 2단계-c 연결 후 제공)"


def build_artifacts(transcript: str, emotion_scores: dict[str, float]) -> dict[str, Any]:
    if transcript.strip() == "":
        raise ValueError("transcript must not be empty")
    return {
        "transcript": transcript,
        "aiSummary": AI_SUMMARY_PLACEHOLDER,
        "aiSchema": None,  # 확장 슬롯 — 양식 팀 회신 전까지 구조 미정 (D18)
        "aiContrast": {
            "missingFromMemo": [],
            "missingFromAudio": [],
            "undiscussedGoals": [],
        },
        "emotionScores": emotion_scores,
        "flagProposals": [],  # AI 플래그 제안은 전사 인용이 필수(D9) — 사업자 연결(2단계-c) 후
        "gasEvidence": [],  # GAS 근거 발췌도 동일 (D6)
    }
