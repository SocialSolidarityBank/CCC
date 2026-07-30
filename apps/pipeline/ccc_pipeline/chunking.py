"""긴 녹음을 무음 경계에서 잘라 조각으로 나눈다 (D53 · ADR-0024).

왜 자르는가: 실측에서 whisper large-v3 가 34분 대화의 48%를 같은 문장 254번
반복으로 잃었는데, **같은 구간을 3분으로 잘라 넣으니 반복하지 않았다**
(`docs/aside/맥북-녹음-배치-전사-3엔진-비교-2026-07-12.md`). 통짜 입력 자체가
원인의 일부다.

왜 무음에서 자르는가: 고정 길이로 자르면 문장 한가운데가 잘려 경계에서 말이
깨진다. 사람이 말을 쉬는 자리를 찾아 그 자리에서 자른다.

경계 계산(`plan_chunks`)과 출력 파싱은 순수 로직이라 ML 설치 없이 테스트한다.
ffmpeg 에 의존하는 것은 무음 탐지(`detect_silences`)와 조각 추출(`extract_chunk`)
둘뿐이며, ffmpeg 이 없으면 조각 하나(=통짜)로 폴백하고 경고를 남긴다 — 전사가
멈추는 것보다 낫고, 반복 검사가 그 뒤를 받는다.
"""

from __future__ import annotations

import logging
import re
import shutil
import subprocess  # noqa: S404 — ffmpeg 호출 전용, 사용자 입력을 셸에 넘기지 않는다
from dataclasses import dataclass

logger = logging.getLogger("ccc_pipeline")

DEFAULT_MAX_CHUNK_SECONDS = 180.0
DEFAULT_MIN_CHUNK_SECONDS = 30.0
DEFAULT_SILENCE_DB = -35.0
DEFAULT_SILENCE_DURATION = 0.6

_SILENCE_START = re.compile(r"silence_start:\s*(-?\d+(?:\.\d+)?)")
_SILENCE_END = re.compile(r"silence_end:\s*(-?\d+(?:\.\d+)?)")
_DURATION = re.compile(r"Duration:\s*(\d+):(\d\d):(\d\d(?:\.\d+)?)")


@dataclass(frozen=True)
class Chunk:
    """전사에 넣을 조각 하나. `forced` 는 무음을 못 찾아 그냥 끊었다는 뜻이다."""

    start: float
    end: float
    forced: bool = False

    @property
    def duration(self) -> float:
        return self.end - self.start


def plan_chunks(
    silences: list[tuple[float, float]],
    duration: float,
    max_seconds: float = DEFAULT_MAX_CHUNK_SECONDS,
    min_seconds: float = DEFAULT_MIN_CHUNK_SECONDS,
) -> list[Chunk]:
    """무음 구간 목록과 전체 길이로 조각 경계를 정한다.

    규칙: 커서에서 `max_seconds` 안에 있는 무음 중 **가장 늦은 것**의 한가운데를
    자른다(조각을 최대한 길게 가져가 문맥을 보존한다). 단 `min_seconds` 보다 짧게
    자르지는 않는다 — 너무 잘게 나누면 조각마다 문맥이 없어져 정확도가 떨어진다.
    쓸 수 있는 무음이 없으면 `max_seconds` 에서 그냥 끊고 `forced=True` 로 표시한다.
    """
    if duration <= 0:
        return []
    if duration <= max_seconds:
        return [Chunk(0.0, duration)]

    # 무음의 한가운데를 자름점 후보로 쓴다 — 무음 시작에서 자르면 다음 조각이
    # 침묵으로 시작하고, 끝에서 자르면 앞 조각이 말끝에 바짝 붙는다.
    cuts = sorted(
        (start + end) / 2.0
        for start, end in silences
        if end > start and 0.0 < (start + end) / 2.0 < duration
    )

    chunks: list[Chunk] = []
    cursor = 0.0
    while duration - cursor > max_seconds:
        window_end = cursor + max_seconds
        window_start = cursor + min_seconds
        usable = [cut for cut in cuts if window_start <= cut <= window_end]
        if usable:
            chunks.append(Chunk(cursor, usable[-1]))
            cursor = usable[-1]
        else:
            chunks.append(Chunk(cursor, window_end, forced=True))
            cursor = window_end

    # 마지막 조각이 너무 짧으면 앞 조각에 합친다(꼬리 조각은 문맥이 없어 잘 틀린다).
    tail = Chunk(cursor, duration)
    if chunks and tail.duration < min_seconds:
        previous = chunks.pop()
        chunks.append(Chunk(previous.start, duration, forced=previous.forced))
    else:
        chunks.append(tail)
    return chunks


def detect_silences(
    audio_path: str,
    noise_db: float = DEFAULT_SILENCE_DB,
    min_silence: float = DEFAULT_SILENCE_DURATION,
) -> tuple[list[tuple[float, float]], float]:
    """ffmpeg silencedetect 로 무음 구간과 전체 길이를 얻는다.

    반환: (무음 구간 목록, 전체 길이). ffmpeg 이 없거나 실패하면 ([], 0.0) —
    호출부가 통짜 처리로 폴백한다. 로그에는 건수만 남긴다(R3).
    """
    if shutil.which("ffmpeg") is None:
        logger.warning("ffmpeg not found — transcription falls back to a single chunk")
        return [], 0.0

    command = [
        "ffmpeg", "-nostdin", "-hide_banner", "-i", audio_path,
        "-af", f"silencedetect=noise={noise_db}dB:d={min_silence}",
        "-f", "null", "-",
    ]
    try:
        # ffmpeg 은 분석 결과를 stderr 로 낸다. 오디오 내용은 stdout 으로 흘리지 않는다.
        completed = subprocess.run(  # noqa: S603 — 인자 배열 고정, 셸 미사용
            command, capture_output=True, text=True, check=False, timeout=600,
        )
    except (OSError, subprocess.SubprocessError) as error:
        logger.warning("silence detection failed: %s", type(error).__name__)
        return [], 0.0

    return _parse_silence_output(completed.stderr)


def extract_chunk(audio_path: str, chunk: Chunk, out_path: str) -> str:
    """조각 하나를 잘라 새 파일로 쓴다. 실패하면 원본 경로를 그대로 돌려준다.

    중간 파일은 작업 디렉터리 안에 만들고 작업이 끝나면 통째로 지운다(D13 —
    삭제 책임은 `worker.process_job` 의 finally 에 있다).
    """
    command = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-ss", f"{chunk.start:.3f}", "-to", f"{chunk.end:.3f}",
        "-i", audio_path, "-vn", out_path,
    ]
    try:
        completed = subprocess.run(  # noqa: S603 — 인자 배열 고정, 셸 미사용
            command, capture_output=True, text=True, check=False, timeout=600,
        )
    except (OSError, subprocess.SubprocessError) as error:
        logger.warning("chunk extraction failed: %s", type(error).__name__)
        return audio_path
    if completed.returncode != 0:
        logger.warning("chunk extraction failed: ffmpeg exit=%d", completed.returncode)
        return audio_path
    return out_path


def _parse_silence_output(stderr: str) -> tuple[list[tuple[float, float]], float]:
    """silencedetect 출력에서 무음 쌍과 전체 길이를 뽑는다(순수 파싱 — 테스트 대상)."""
    duration = 0.0
    match = _DURATION.search(stderr)
    if match is not None:
        hours, minutes, seconds = match.groups()
        duration = int(hours) * 3600 + int(minutes) * 60 + float(seconds)

    silences: list[tuple[float, float]] = []
    pending: float | None = None
    for line in stderr.splitlines():
        start_match = _SILENCE_START.search(line)
        if start_match is not None:
            pending = float(start_match.group(1))
            continue
        end_match = _SILENCE_END.search(line)
        if end_match is not None and pending is not None:
            silences.append((pending, float(end_match.group(1))))
            pending = None
    return silences, duration
