"""Pure S13 STT benchmark metrics.

Returned values contain numeric measurements, offsets, and fixed status/type codes only.
Reference and hypothesis text never leave this module in a metric result.
"""

from __future__ import annotations

import math
import re
import unicodedata
from itertools import product
from typing import Any

THRESHOLDS = {
    "cer": 0.15,
    "repetition": 0.01,
    "windowsCpuRtf": 1.0,
    "der": 0.20,
    "safetyEventCount": 0,
}
_INSERTION_EVENT_LENGTH = 20
_DELETED_TURNS_EVENT_SECONDS = 10.0
_REPETITION_PUNCTUATION = str.maketrans("", "", ".?!。？！…\r\n")
_WHITESPACE = re.compile(r"\s+")


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFC", text.replace("\r\n", "\n").replace("\r", "\n"))
    return _WHITESPACE.sub(" ", text).strip()


def _status(value: float | None, threshold: float) -> str:
    if value is None:
        return "UNMEASURED"
    return "PASS" if value <= threshold else "FAIL"


def _number(value: Any, name: str, *, positive: bool = False) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a finite number")
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    if positive and value <= 0:
        raise ValueError(f"{name} must be greater than zero")
    if not positive and value < 0:
        raise ValueError(f"{name} must not be negative")
    return value


def _validate_turns(
    turns: Any,
    duration_seconds: float,
    *,
    reference: bool,
) -> list[dict[str, Any]]:
    if not isinstance(turns, list):
        raise ValueError("turns must be a list")
    validated: list[dict[str, Any]] = []
    previous_start = -1.0
    for index, turn in enumerate(turns):
        if not isinstance(turn, dict):
            raise ValueError(f"turn {index} must be an object")
        start = _number(turn.get("start"), f"turn {index} start")
        end = _number(turn.get("end"), f"turn {index} end")
        if end <= start:
            raise ValueError(f"turn {index} end must be greater than start")
        if end > duration_seconds:
            raise ValueError(f"turn {index} exceeds audio duration")
        if reference and start < previous_start:
            raise ValueError("reference turns must be ordered by start")
        speaker = turn.get("speaker")
        if not isinstance(speaker, str) or not speaker:
            raise ValueError(f"turn {index} speaker must be a non-empty string")
        item = {"start": start, "end": end, "speaker": speaker}
        if reference:
            text = turn.get("text")
            if not isinstance(text, str):
                raise ValueError(f"reference turn {index} text must be a string")
            item["text"] = text
        validated.append(item)
        previous_start = start
    return validated


def _alignment(reference: str, hypothesis: str) -> list[tuple[str, int | None, int | None]]:
    """Return a deterministic minimum edit alignment.

    Equal/diagonal, substitution, deletion, then insertion is the fixed tie order.
    Indices are Unicode codepoint offsets in the normalized strings.
    """
    rows = len(reference) + 1
    columns = len(hypothesis) + 1
    distance = [[0] * columns for _ in range(rows)]
    for i in range(rows):
        distance[i][0] = i
    for j in range(columns):
        distance[0][j] = j
    for i in range(1, rows):
        for j in range(1, columns):
            distance[i][j] = min(
                distance[i - 1][j] + 1,
                distance[i][j - 1] + 1,
                distance[i - 1][j - 1] + (reference[i - 1] != hypothesis[j - 1]),
            )

    operations: list[tuple[str, int | None, int | None]] = []
    i, j = len(reference), len(hypothesis)
    while i or j:
        if i and j and reference[i - 1] == hypothesis[j - 1] and distance[i][j] == distance[i - 1][j - 1]:
            operations.append(("equal", i - 1, j - 1))
            i -= 1
            j -= 1
        elif i and j and distance[i][j] == distance[i - 1][j - 1] + 1:
            operations.append(("substitution", i - 1, j - 1))
            i -= 1
            j -= 1
        elif i and distance[i][j] == distance[i - 1][j] + 1:
            operations.append(("deletion", i - 1, None))
            i -= 1
        else:
            operations.append(("insertion", None, j - 1))
            j -= 1
    operations.reverse()
    return operations


def _repetition_runs(text: str) -> list[dict[str, int]]:
    candidates: list[dict[str, int]] = []
    length = len(text)
    for period in range(1, min(80, length // 4) + 1):
        for start in range(length - 4 * period + 1):
            unit = text[start : start + period]
            if start >= period and text[start - period : start] == unit:
                continue
            repeats = 1
            while (
                start + (repeats + 1) * period <= length
                and text[start + repeats * period : start + (repeats + 1) * period] == unit
            ):
                repeats += 1
            if repeats >= 4:
                candidates.append(
                    {
                        "period": period,
                        "repeats": repeats,
                        "start": start,
                        "end": start + repeats * period,
                        "excess": (repeats - 1) * period,
                    }
                )

    selected: list[dict[str, int]] = []
    for candidate in sorted(candidates, key=lambda run: (-run["excess"], run["period"], run["start"])):
        if all(candidate["end"] <= run["start"] or candidate["start"] >= run["end"] for run in selected):
            selected.append(candidate)
    return selected


def _turn_spans(reference_text: str, turns: list[dict[str, Any]]) -> list[tuple[int, int] | None]:
    parts = [_normalize(turn["text"]) for turn in turns]
    if _normalize(" ".join(parts)) != reference_text:
        raise ValueError("reference transcript does not match ordered speaker turn text")
    spans: list[tuple[int, int] | None] = []
    cursor = 0
    for part in parts:
        if not part:
            spans.append(None)
            continue
        start = reference_text.find(part, cursor)
        if start < 0:
            raise ValueError("reference turn text cannot be located in transcript")
        spans.append((start, start + len(part)))
        cursor = start + len(part)
    return spans


def _safety_events(
    operations: list[tuple[str, int | None, int | None]],
    reference_text: str,
    turns: list[dict[str, Any]],
) -> list[dict[str, int | float | str]]:
    events: list[dict[str, int | float | str]] = []
    insertion_start: int | None = None
    insertion_end = 0
    for kind, _, hypothesis_index in operations + [("end", None, None)]:
        if kind == "insertion":
            assert hypothesis_index is not None
            if insertion_start is None:
                insertion_start = hypothesis_index
            insertion_end = hypothesis_index + 1
        elif insertion_start is not None:
            if insertion_end - insertion_start >= _INSERTION_EVENT_LENGTH:
                events.append({"type": "insertion", "start": insertion_start, "end": insertion_end})
            insertion_start = None

    deleted = {reference_index for kind, reference_index, _ in operations if kind == "deletion"}
    deleted_turns = []
    for span in _turn_spans(reference_text, turns):
        deleted_turns.append(span is not None and all(index in deleted for index in range(*span)))

    run_start: int | None = None
    duration = 0.0
    for index, is_deleted in enumerate(deleted_turns + [False]):
        if is_deleted:
            if run_start is None:
                run_start = index
            duration += turns[index]["end"] - turns[index]["start"]
        elif run_start is not None:
            if duration >= _DELETED_TURNS_EVENT_SECONDS:
                events.append(
                    {
                        "type": "deletedReferenceTurns",
                        "start": turns[run_start]["start"],
                        "end": max(turns[turn_index]["end"] for turn_index in range(run_start, index)),
                    }
                )
            run_start = None
            duration = 0.0
    return events


def _best_speaker_mapping(
    reference_turns: list[dict[str, Any]],
    predicted_turns: list[dict[str, Any]],
    reference_labels: list[str],
) -> dict[str, str]:
    predicted_labels = sorted({turn["speaker"] for turn in predicted_turns})
    overlap = {(predicted, reference): 0.0 for predicted in predicted_labels for reference in reference_labels}
    boundaries = sorted(
        {point for turn in reference_turns + predicted_turns for point in (turn["start"], turn["end"])}
    )
    for start, end in zip(boundaries, boundaries[1:]):
        if end == start:
            continue
        midpoint = (start + end) / 2
        active_reference = {turn["speaker"] for turn in reference_turns if turn["start"] <= midpoint < turn["end"]}
        active_predicted = {turn["speaker"] for turn in predicted_turns if turn["start"] <= midpoint < turn["end"]}
        for predicted in active_predicted:
            for reference in active_reference:
                overlap[predicted, reference] += end - start

    best_score = 0.0
    best: dict[str, str] = {}
    choices: list[str | None] = [None, *predicted_labels]
    for first, second in product(choices, repeat=2):
        if first is not None and first == second:
            continue
        mapping = {}
        if first is not None:
            mapping[first] = reference_labels[0]
        if second is not None:
            mapping[second] = reference_labels[1]
        score = sum(overlap[predicted, reference] for predicted, reference in mapping.items())
        if score > best_score:
            best_score = score
            best = mapping
    return best


def _der_components(
    reference_turns: list[dict[str, Any]],
    predicted_turns: list[dict[str, Any]],
    duration_seconds: float,
) -> tuple[float, float, float, float]:
    reference_labels = sorted({turn["speaker"] for turn in reference_turns})
    mapping = _best_speaker_mapping(reference_turns, predicted_turns, reference_labels)
    boundaries = sorted(
        {0.0, duration_seconds, *(point for turn in reference_turns + predicted_turns for point in (turn["start"], turn["end"]))}
    )
    false_alarm = missed = confusion = reference_speech = 0.0
    for start, end in zip(boundaries, boundaries[1:]):
        if end == start:
            continue
        midpoint = (start + end) / 2
        active_reference = {turn["speaker"] for turn in reference_turns if turn["start"] <= midpoint < turn["end"]}
        active_predicted = {turn["speaker"] for turn in predicted_turns if turn["start"] <= midpoint < turn["end"]}
        seconds = end - start
        reference_speech += len(active_reference) * seconds
        false_alarm += max(0, len(active_predicted) - len(active_reference)) * seconds
        missed += max(0, len(active_reference) - len(active_predicted)) * seconds
        correctly_mapped = len(active_reference & {mapping[label] for label in active_predicted if label in mapping})
        confusion += (min(len(active_reference), len(active_predicted)) - correctly_mapped) * seconds
    return false_alarm, missed, max(0.0, confusion), reference_speech


def score_session(
    reference: dict,
    hypothesis: str,
    predicted_turns: list[dict],
    engine_wall_seconds: float,
    duration_seconds: float,
    windows_cpu: bool,
) -> dict:
    """Score one S13 session without returning source text."""
    if not isinstance(reference, dict):
        raise ValueError("reference must be an object")
    transcript = reference.get("transcript")
    if not isinstance(transcript, str):
        raise ValueError("reference transcript must be a string")
    if not isinstance(hypothesis, str):
        raise ValueError("hypothesis must be a string")
    if not isinstance(windows_cpu, bool):
        raise ValueError("windows_cpu must be a boolean")
    duration = _number(duration_seconds, "duration_seconds", positive=True)
    wall = _number(engine_wall_seconds, "engine_wall_seconds")
    reference_turns = _validate_turns(reference.get("speakerTurns"), duration, reference=True)
    if len({turn["speaker"] for turn in reference_turns}) != 2:
        raise ValueError("reference must contain exactly two speakers")
    predictions = _validate_turns(predicted_turns, duration, reference=False)

    normalized_reference = _normalize(transcript)
    normalized_hypothesis = _normalize(hypothesis)
    operations = _alignment(normalized_reference, normalized_hypothesis)
    substitutions = sum(kind == "substitution" for kind, _, _ in operations)
    deletions = sum(kind == "deletion" for kind, _, _ in operations)
    insertions = sum(kind == "insertion" for kind, _, _ in operations)
    errors = substitutions + deletions + insertions
    reference_characters = len(normalized_reference)
    cer_value = errors / reference_characters if reference_characters else None

    hypothesis_characters = len(normalized_hypothesis)
    detection_text = normalized_hypothesis.translate(_REPETITION_PUNCTUATION)
    selected_runs = _repetition_runs(detection_text)
    excess = sum(run["excess"] for run in selected_runs)
    repetition_value = excess / hypothesis_characters if hypothesis_characters else None
    reported_runs = [
        {key: run[key] for key in ("period", "repeats", "start", "end")}
        for run in selected_runs
    ]

    rtf_value = wall / duration
    false_alarm, missed, confusion, reference_speech = _der_components(
        reference_turns, predictions, duration
    )
    der_value = (false_alarm + missed + confusion) / reference_speech if reference_speech else None
    safety_events = _safety_events(operations, normalized_reference, reference_turns)

    return {
        "cer": {
            "substitutions": substitutions,
            "deletions": deletions,
            "insertions": insertions,
            "errors": errors,
            "referenceCharacters": reference_characters,
            "value": cer_value,
            "status": _status(cer_value, THRESHOLDS["cer"]),
        },
        "repetition": {
            "excess": excess,
            "hypothesisCharacters": hypothesis_characters,
            "runs": reported_runs,
            "value": repetition_value,
            "status": _status(repetition_value, THRESHOLDS["repetition"]),
        },
        "rtf": {
            "engineWallSeconds": wall,
            "audioDurationSeconds": duration,
            "value": rtf_value,
            "status": _status(rtf_value, THRESHOLDS["windowsCpuRtf"]) if windows_cpu else "UNMEASURED",
        },
        "der": {
            "falseAlarmSeconds": false_alarm,
            "missedSeconds": missed,
            "confusionSeconds": confusion,
            "referenceSpeechSeconds": reference_speech,
            "value": der_value,
            "status": _status(der_value, THRESHOLDS["der"]),
        },
        "safety": {
            "eventCount": len(safety_events),
            "events": safety_events,
            "status": "PASS" if len(safety_events) <= THRESHOLDS["safetyEventCount"] else "FAIL",
        },
    }


def _component_sum(rows: list[dict], metric: str, field: str) -> float:
    total = 0.0
    for index, row in enumerate(rows):
        try:
            value = row[metric][field]
        except (KeyError, TypeError) as error:
            raise ValueError(f"row {index} is missing {metric}.{field}") from error
        total += _number(value, f"row {index} {metric}.{field}")
    return total


def _integer_component_sum(rows: list[dict], metric: str, field: str) -> int:
    total = _component_sum(rows, metric, field)
    if not total.is_integer() or any(
        not _number(row[metric][field], f"{metric}.{field}").is_integer() for row in rows
    ):
        raise ValueError(f"{metric}.{field} must contain integers")
    return int(total)


def pool_sessions(rows: list[dict], windows_cpu: bool) -> dict:
    """Pool session components; never average per-session ratios."""
    if not isinstance(rows, list):
        raise ValueError("rows must be a list")
    if not isinstance(windows_cpu, bool):
        raise ValueError("windows_cpu must be a boolean")

    substitutions = _integer_component_sum(rows, "cer", "substitutions")
    deletions = _integer_component_sum(rows, "cer", "deletions")
    insertions = _integer_component_sum(rows, "cer", "insertions")
    errors = substitutions + deletions + insertions
    reference_characters = _integer_component_sum(rows, "cer", "referenceCharacters")
    cer_value = errors / reference_characters if reference_characters else None

    excess = _integer_component_sum(rows, "repetition", "excess")
    hypothesis_characters = _integer_component_sum(rows, "repetition", "hypothesisCharacters")
    repetition_value = excess / hypothesis_characters if hypothesis_characters else None
    runs = []
    for session_index, row in enumerate(rows):
        raw_runs = row["repetition"].get("runs")
        if not isinstance(raw_runs, list):
            raise ValueError(f"row {session_index} repetition.runs must be a list")
        for run_index, run in enumerate(raw_runs):
            if not isinstance(run, dict):
                raise ValueError(f"row {session_index} repetition run {run_index} must be an object")
            values = {
                field: _number(run.get(field), f"row {session_index} repetition run {run_index} {field}")
                for field in ("period", "repeats", "start", "end")
            }
            if any(not value.is_integer() for value in values.values()):
                raise ValueError(f"row {session_index} repetition run {run_index} fields must be integers")
            clean = {field: int(value) for field, value in values.items()}
            if not 1 <= clean["period"] <= 80 or clean["repeats"] < 4 or clean["end"] <= clean["start"]:
                raise ValueError(f"row {session_index} repetition run {run_index} is invalid")
            runs.append({**clean, "sessionIndex": session_index})

    wall = _component_sum(rows, "rtf", "engineWallSeconds")
    duration = _component_sum(rows, "rtf", "audioDurationSeconds")
    rtf_value = wall / duration if duration else None

    false_alarm = _component_sum(rows, "der", "falseAlarmSeconds")
    missed = _component_sum(rows, "der", "missedSeconds")
    confusion = _component_sum(rows, "der", "confusionSeconds")
    reference_speech = _component_sum(rows, "der", "referenceSpeechSeconds")
    der_value = (false_alarm + missed + confusion) / reference_speech if reference_speech else None

    event_count = _integer_component_sum(rows, "safety", "eventCount")
    events = []
    for session_index, row in enumerate(rows):
        raw_events = row["safety"].get("events")
        if not isinstance(raw_events, list) or len(raw_events) != row["safety"]["eventCount"]:
            raise ValueError(f"row {session_index} safety events do not match eventCount")
        for event_index, event in enumerate(raw_events):
            if not isinstance(event, dict) or event.get("type") not in {"insertion", "deletedReferenceTurns"}:
                raise ValueError(f"row {session_index} safety event {event_index} is invalid")
            start = _number(event.get("start"), f"row {session_index} safety event {event_index} start")
            end = _number(event.get("end"), f"row {session_index} safety event {event_index} end")
            if end <= start:
                raise ValueError(f"row {session_index} safety event {event_index} range is invalid")
            if event["type"] == "insertion":
                if not start.is_integer() or not end.is_integer():
                    raise ValueError(f"row {session_index} insertion event offsets must be integers")
                start, end = int(start), int(end)
            events.append(
                {"type": event["type"], "start": start, "end": end, "sessionIndex": session_index}
            )
    safety_status = (
        "UNMEASURED"
        if not rows
        else ("PASS" if event_count <= THRESHOLDS["safetyEventCount"] else "FAIL")
    )

    return {
        "cer": {
            "substitutions": substitutions,
            "deletions": deletions,
            "insertions": insertions,
            "errors": errors,
            "referenceCharacters": reference_characters,
            "value": cer_value,
            "status": _status(cer_value, THRESHOLDS["cer"]),
        },
        "repetition": {
            "excess": excess,
            "hypothesisCharacters": hypothesis_characters,
            "runs": runs,
            "value": repetition_value,
            "status": _status(repetition_value, THRESHOLDS["repetition"]),
        },
        "rtf": {
            "engineWallSeconds": wall,
            "audioDurationSeconds": duration,
            "value": rtf_value,
            "status": _status(rtf_value, THRESHOLDS["windowsCpuRtf"]) if windows_cpu else "UNMEASURED",
        },
        "der": {
            "falseAlarmSeconds": false_alarm,
            "missedSeconds": missed,
            "confusionSeconds": confusion,
            "referenceSpeechSeconds": reference_speech,
            "value": der_value,
            "status": _status(der_value, THRESHOLDS["der"]),
        },
        "safety": {"eventCount": event_count, "events": events, "status": safety_status},
    }
