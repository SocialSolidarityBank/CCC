"""전사 오케스트레이션 — 조각 분할 · 반복 검사 · 엔진 교체 (D53 · ADR-0024).

엔진은 **갈아끼울 수 있게** 둔다. 지금 기본값은 Whisper 지만 조사 1순위는
Qwen3-ASR-1.7B 이고, 확정은 실측 게이트 G1~G3 통과 후다(그 세션은 처리 장비
앞에서 해야 한다). 그래서 여기서는 엔진을 고르지 않고 **고를 수 있는 자리**만
만든다 — `CCC_STT_ENGINE` 설정값으로 바꾼다.

엔진 구현체는 지연 임포트한다(ML 미설치 환경에서도 이 모듈은 로드된다).
오케스트레이션 자체는 순수 로직이라 가짜 엔진으로 테스트한다.
"""

from __future__ import annotations

import hashlib
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path

from .chunking import (
    DEFAULT_MAX_CHUNK_SECONDS,
    DEFAULT_MIN_CHUNK_SECONDS,
    Chunk,
    detect_silences,
    extract_chunk,
    plan_chunks,
)
from .repetition import DEFAULT_REPEAT_THRESHOLD, RepetitionRun, collapse_runs, find_repetition_runs
from .model_registry import ModelRegistryError, role_spec
from .speaker_mapping import Segment

logger = logging.getLogger("ccc_pipeline")

ENGINE_WHISPER = "whisper"
KNOWN_ENGINES = (ENGINE_WHISPER,)

# 엔진: 오디오 파일 경로 → 전사 구간 목록(그 파일 기준 상대 시각).
Engine = Callable[[str], list[Segment]]


@dataclass
class TranscriptionResult:
    """전사 결과 + 실패 표시. `warnings` 가 비어 있지 않으면 전사가 불완전하다."""

    segments: list[Segment]
    warnings: list[RepetitionRun] = field(default_factory=list)
    forced_cuts: int = 0

    @property
    def reliable(self) -> bool:
        return not self.warnings


def build_engine(name: str, model_name: str) -> Engine:
    """설정값으로 엔진을 만든다. 모델도 manifest에 고정된 항목만 허용한다."""
    if name == ENGINE_WHISPER:
        try:
            role_spec("whisper", model_name)
        except ModelRegistryError as error:
            raise ValueError("Whisper model is not declared in model manifest") from error
        return _build_whisper(model_name)
    raise ValueError(f"unknown STT engine: {name!r} (known: {', '.join(KNOWN_ENGINES)})")


def _verified_checkpoint(path: Path, expected_sha256: str) -> None:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected_sha256.lower():
        raise RuntimeError("Whisper checkpoint SHA-256 does not match the release manifest")


def _build_whisper(model_name: str) -> Engine:
    spec = role_spec("whisper", model_name)

    def run(audio_path: str) -> list[Segment]:
        import whisper  # noqa: PLC0415 — ML 지연 임포트

        models = getattr(whisper, "_MODELS", {})
        model_url = models.get(spec.version)
        if model_url != spec.checkpoint_url or spec.checkpoint_sha256 is None:
            raise RuntimeError("Whisper checkpoint URL is not the manifest-approved medium checkpoint")
        downloader = getattr(whisper, "_download", None)
        if not callable(downloader):
            raise RuntimeError("Whisper downloader is unavailable; checkpoint cannot be verified")
        cache_root = Path.home() / ".cache" / "whisper"
        checkpoint = Path(downloader(spec.checkpoint_url, cache_root, in_memory=False))
        _verified_checkpoint(checkpoint, spec.checkpoint_sha256)
        model = whisper.load_model(spec.version, download_root=str(cache_root))
        result = model.transcribe(audio_path, language="ko")  # 한국어 고정(상담 언어)
        return [
            Segment(start=float(s["start"]), end=float(s["end"]), text=str(s["text"]))
            for s in result.get("segments", [])
        ]

    return run


def transcribe_audio(
    audio_path: str,
    work_dir: Path,
    engine: Engine,
    max_chunk_seconds: float = DEFAULT_MAX_CHUNK_SECONDS,
    min_chunk_seconds: float = DEFAULT_MIN_CHUNK_SECONDS,
    repeat_threshold: int = DEFAULT_REPEAT_THRESHOLD,
) -> TranscriptionResult:
    """오디오 파일 → 전사 구간 목록.

    순서: 무음 탐지 → 조각 분할 → 조각별 전사 → 반복 검사 → (반복이면) 반으로
    잘라 1회 재시도 → 그래도 반복이면 접어서 경고. 조각이 하나뿐이면(짧은 녹음
    이거나 ffmpeg 부재) 원본을 그대로 넣는다.
    """
    silences, duration = detect_silences(audio_path)
    chunks = plan_chunks(silences, duration, max_chunk_seconds, min_chunk_seconds)
    if not chunks:
        # 길이를 못 구했다(ffmpeg 부재·분석 실패) — 통짜로 넣고 반복 검사에 맡긴다.
        chunks = [Chunk(0.0, 0.0, forced=True)]

    segments: list[Segment] = []
    warnings: list[RepetitionRun] = []
    whole_file = len(chunks) == 1
    for index, chunk in enumerate(chunks):
        chunk_segments = _transcribe_chunk(
            audio_path, work_dir, engine, chunk, index,
            repeat_threshold=repeat_threshold,
            min_chunk_seconds=min_chunk_seconds,
            whole_file=whole_file,
        )
        runs = find_repetition_runs(chunk_segments, repeat_threshold)
        if runs:
            warnings.extend(runs)
            chunk_segments = collapse_runs(chunk_segments, runs)
        segments.extend(chunk_segments)

    forced = sum(1 for chunk in chunks if chunk.forced)
    # 로그에는 건수·시각만 남긴다 — 전사 내용은 금지(R3).
    logger.info(
        "transcribed chunks=%d forced_cuts=%d segments=%d repetition_warnings=%d",
        len(chunks), forced, len(segments), len(warnings),
    )
    return TranscriptionResult(segments=segments, warnings=warnings, forced_cuts=forced)


def _transcribe_chunk(
    audio_path: str,
    work_dir: Path,
    engine: Engine,
    chunk: Chunk,
    index: int,
    repeat_threshold: int,
    min_chunk_seconds: float,
    whole_file: bool,
) -> list[Segment]:
    """조각 하나를 전사한다. 반복이 나오면 **반으로 잘라 한 번만** 다시 시도한다.

    재시도를 한 번으로 제한하는 이유: 실측에서 같은 구간을 짧게 잘라 넣으니 반복이
    사라졌지만, 무한히 쪼개면 조각마다 문맥이 없어져 정확도가 떨어진다. 한 번에
    안 되면 사람에게 넘기는 편이 낫다(D5 — 수기 메모 폴백).
    """
    segments = _run_engine(audio_path, work_dir, engine, chunk, str(index), whole_file)
    before = find_repetition_runs(segments, repeat_threshold)
    if not before:
        return segments
    if whole_file or chunk.duration < min_chunk_seconds * 2:
        # 통짜 폴백은 자를 근거(길이)가 없고, 더 자르면 조각이 최소 길이보다 짧아진다.
        return segments

    middle = (chunk.start + chunk.end) / 2.0
    retried: list[Segment] = []
    for half_index, half in enumerate((Chunk(chunk.start, middle), Chunk(middle, chunk.end))):
        retried.extend(_run_engine(audio_path, work_dir, engine, half, f"{index}r{half_index}", False))

    # 재시도가 반복을 줄였을 때만 채택한다 — 더 나빠졌으면 원래 결과를 둔다.
    if len(find_repetition_runs(retried, repeat_threshold)) < len(before):
        logger.info("chunk %d: retried in halves after repetition", index)
        return retried
    return segments


def _run_engine(
    audio_path: str,
    work_dir: Path,
    engine: Engine,
    chunk: Chunk,
    label: str,
    whole_file: bool,
) -> list[Segment]:
    """조각을 잘라 엔진에 넣고, 결과 시각을 전체 파일 기준으로 되돌린다."""
    if whole_file:
        target = audio_path
    else:
        suffix = Path(audio_path).suffix or ".wav"
        target = extract_chunk(audio_path, chunk, str(work_dir / f"chunk-{label}{suffix}"))
    # 추출이 실패해 원본이 돌아왔으면 시각이 이미 전체 기준이라 offset 을 더하지 않는다.
    offset = 0.0 if target == audio_path else chunk.start
    return [
        Segment(start=s.start + offset, end=s.end + offset, text=s.text, speaker=s.speaker)
        for s in engine(target)
    ]
