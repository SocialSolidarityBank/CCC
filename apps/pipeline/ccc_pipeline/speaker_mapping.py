"""전사 구간 ↔ 화자 분리 결과 정렬 + 수혜자/상담사 자동 추정 (D11).

여기는 순수 로직만 둔다(ML 없음) — 자동 추정은 어디까지나 초안이고,
최종 확인은 검토 화면에서 상담사가 1회 수행한다 (D11). 여기서 역할을
확정하거나 판단하지 않는다 (R5).
"""

from __future__ import annotations

from dataclasses import dataclass

BENEFICIARY = "beneficiary"
COUNSELOR = "counselor"


@dataclass(frozen=True)
class Segment:
    """전사 구간(Whisper 출력 1개)."""

    start: float
    end: float
    text: str
    speaker: str | None = None  # 화자 분리 라벨 (예: SPEAKER_00)


@dataclass(frozen=True)
class Turn:
    """화자 분리 구간(pyannote 출력 1개)."""

    start: float
    end: float
    speaker: str


def _overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    return max(0.0, min(a_end, b_end) - max(a_start, b_start))


def assign_speakers(segments: list[Segment], turns: list[Turn]) -> list[Segment]:
    """각 전사 구간에 겹치는 시간이 가장 긴 화자 라벨을 붙인다. 겹침이 없으면 None 유지."""
    assigned: list[Segment] = []
    for segment in segments:
        best_speaker: str | None = None
        best_overlap = 0.0
        for turn in turns:
            overlap = _overlap(segment.start, segment.end, turn.start, turn.end)
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = turn.speaker
        assigned.append(Segment(segment.start, segment.end, segment.text, best_speaker))
    return assigned


def estimate_roles(segments: list[Segment]) -> dict[str, str]:
    """발화량 기준 자동 추정: 총 발화 시간이 가장 긴 화자를 수혜자로 본다.

    1:1 대면 상담에서 수혜자가 주로 말한다는 가정의 초안 휴리스틱이다.
    화자가 1명뿐이면(분리 실패 포함) 그 화자를 수혜자로 두고, 3명 이상이면
    최다 발화자만 수혜자, 나머지는 전부 상담사(=감정 집계 제외) 처리한다.
    """
    durations: dict[str, float] = {}
    for segment in segments:
        if segment.speaker is None:
            continue
        durations[segment.speaker] = durations.get(segment.speaker, 0.0) + (segment.end - segment.start)

    if not durations:
        return {}

    beneficiary = max(durations, key=lambda speaker: durations[speaker])
    return {speaker: (BENEFICIARY if speaker == beneficiary else COUNSELOR) for speaker in durations}


def format_transcript(segments: list[Segment], roles: dict[str, str]) -> str:
    """검토 화면용 전사 텍스트. 줄마다 역할 라벨을 붙인다 — 자동 추정임이 전제(D11)."""
    labels = {BENEFICIARY: "[수혜자?]", COUNSELOR: "[상담사?]"}
    lines: list[str] = []
    for segment in segments:
        text = segment.text.strip()
        if text == "":
            continue
        role = roles.get(segment.speaker or "", "")
        prefix = labels.get(role, "[화자?]")
        lines.append(f"{prefix} {text}")
    return "\n".join(lines)
