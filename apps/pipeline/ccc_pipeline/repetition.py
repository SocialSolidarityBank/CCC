"""전사 반복 붕괴 검사 (D53 · ADR-0024).

실측된 실패: whisper large-v3 가 34분 대화의 17:44 부터 끝까지 같은 문장을
**254번 연속** 반복하며 내용을 잃었고, 마지막에 녹음에 없던 "다음 영상에서
만나요!"를 지어냈다. 상담에서 이런 산출물이 승인 화면의 '음성에 없는 내용'에
오르면 승인=정합성 검증(R2)의 전제가 무너진다.

여기서 하는 일은 **판단이 아니라 표시**다 — 반복 구간을 지우거나 고치지 않고,
접어서 경고를 붙여 실무자가 보게 한다. 어느 쪽이 맞는지 정하는 것은 사람 몫이다
(R5). 순수 로직이라 ML 설치 없이 테스트한다.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .speaker_mapping import Segment

DEFAULT_REPEAT_THRESHOLD = 4

# 구조화 경고의 사유 코드 (CCC-124). 구조화 페이로드는 2차 마스킹을 거치지 않으므로
# 사유는 자유 문장이 아니라 고정 코드만 쓴다 — 전사 내용을 싣지 않는다(R3).
REASON_REPETITION = "repetition"

_WHITESPACE = re.compile(r"\s+")
_TRAILING = re.compile(r"[.,!?…·~\-\s]+$")


@dataclass(frozen=True)
class RepetitionRun:
    """같은 문장이 연속으로 나온 구간 하나."""

    start_index: int
    end_index: int  # 포함
    count: int
    start: float
    end: float
    text: str


def normalize(text: str) -> str:
    """비교용 정규화 — 공백 정리 + 끝 문장부호 제거.

    엔진마다 같은 발화에 문장부호를 붙였다 뗐다 하므로, 부호 차이로 반복을
    놓치지 않게 끝부분만 떼고 비교한다. 저장·표시에는 원문을 그대로 쓴다.
    """
    return _TRAILING.sub("", _WHITESPACE.sub(" ", text).strip())


def find_repetition_runs(
    segments: list[Segment],
    threshold: int = DEFAULT_REPEAT_THRESHOLD,
) -> list[RepetitionRun]:
    """같은 문장이 `threshold` 회 이상 연속되는 구간을 찾는다.

    빈 문장은 반복으로 세지 않는다 — 무음 구간에서 빈 결과가 줄줄이 나오는 것은
    붕괴가 아니다.
    """
    if threshold < 2:
        raise ValueError("threshold must be at least 2")

    runs: list[RepetitionRun] = []
    index = 0
    while index < len(segments):
        key = normalize(segments[index].text)
        end = index
        while end + 1 < len(segments) and normalize(segments[end + 1].text) == key:
            end += 1
        count = end - index + 1
        if key != "" and count >= threshold:
            runs.append(RepetitionRun(
                start_index=index,
                end_index=end,
                count=count,
                start=segments[index].start,
                end=segments[end].end,
                text=segments[index].text.strip(),
            ))
        index = end + 1
    return runs


def collapse_runs(segments: list[Segment], runs: list[RepetitionRun]) -> list[Segment]:
    """반복 구간을 반복된 문장 한 줄로 접는다 (CCC-124).

    지우지 않는 이유: 그 시간대에 무슨 일이 있었는지(엔진이 무너졌다는 사실 자체)가
    실무자에게 필요한 정보다. 접힌 줄은 원래 구간 전체의 시각을 덮고 `warning=True`
    로 표시된다 — 감정 집계·역할 라벨에서 빠진다. 경고 문장 자체는 더 이상 전사
    텍스트에 끼워 넣지 않는다: 시간 구간·사유는 `warning_spans` 가 만드는 구조화
    필드로 API 에 실리고, 승인 화면이 그 필드를 표시한다. 구 서버(구조화 필드를
    모르는 스키마)로 보낼 때만 `inject_legacy_warnings` 가 옛 경고 문장을 복원한다.
    """
    if not runs:
        return segments

    collapsed: list[Segment] = []
    skip_until = -1
    by_start = {run.start_index: run for run in runs}
    for index, segment in enumerate(segments):
        if index <= skip_until:
            continue
        run = by_start.get(index)
        if run is None:
            collapsed.append(segment)
            continue
        skip_until = run.end_index
        collapsed.append(Segment(
            start=run.start,
            end=run.end,
            text=run.text,
            speaker=segment.speaker,
            warning=True,
        ))
    return collapsed


def warning_spans(runs: list[RepetitionRun]) -> list[dict[str, float | str]]:
    """API 전송용 구조화 경고 (CCC-124): 시작·끝 초와 고정 사유 코드만.

    반복된 문장(`run.text`)은 싣지 않는다 — 이 필드는 2차 마스킹을 거치지 않고
    장비를 떠나므로 전사 내용이 섞이면 R3 가 깨진다.
    """
    return [
        {"startSeconds": run.start, "endSeconds": run.end, "reason": REASON_REPETITION}
        for run in runs
    ]


def legacy_warning_text(run: RepetitionRun) -> str:
    """구 서버 폴백용 경고 문장 — CCC-124 이전에 전사 텍스트에 끼워 넣던 형식 그대로."""
    return (
        f"⚠ 전사 실패 구간 — 같은 문장이 {run.count}회 반복됐습니다"
        f"({_clock(run.start)}~{_clock(run.end)}). 이 구간은 믿을 수 없으니"
        f" 녹음을 직접 확인하거나 수기 메모로 메워 주세요. 반복된 문장: {run.text}"
    )


def inject_legacy_warnings(segments: list[Segment], runs: list[RepetitionRun]) -> list[Segment]:
    """접힌 경고 줄에 옛 경고 문장을 복원한다 — 구조화 필드를 모르는 구 서버 전용.

    `collapse_runs` 는 run 하나당 `warning=True` 세그먼트 하나를 같은 순서로 남기므로
    순서대로 짝을 맞춘다. 경고 문장에는 반복된 문장이 들어가지만, 이 결과는 다른
    전사와 똑같이 2차 마스킹을 거친 뒤에만 전송된다(R3).
    """
    replaced: list[Segment] = []
    pending = iter(runs)
    for segment in segments:
        if not segment.warning:
            replaced.append(segment)
            continue
        run = next(pending, None)
        if run is None:
            replaced.append(segment)
            continue
        replaced.append(Segment(
            start=segment.start,
            end=segment.end,
            text=legacy_warning_text(run),
            speaker=segment.speaker,
            warning=True,
        ))
    return replaced


def _clock(seconds: float) -> str:
    total = int(seconds)
    return f"{total // 60:02d}:{total % 60:02d}"
