#!/usr/bin/env python3
"""Synthetic-only helpers for the CCC-237 contextual-remasking experiment.

Exports:
``validate_corpus(items)`` validates and returns the exact 24-row corpus;
``numbered_lines(text)`` returns 1-based line dictionaries; ``chunks(lines)``
returns four-line windows with one-line overlap; ``validate_edits(lines,
payload)`` returns absolute ``(start, end, kind)`` spans; ``apply_edits(text,
spans)`` applies only fixed mask tokens; ``validate_summary(final_text,
payload)`` validates a bounded summary and frozen-source evidence;
``baseline_trace(text, predictions)`` runs the existing observer and adds
output-character-to-original-coordinate lineage; ``score_case(item, trace,
extra_spans)`` returns raw-free provenance counts; ``stage_draft(final_text,
payload)`` performs an isolated in-memory SQLite staging check. ``self_check``
is synthetic and intentionally never executed on import.

This module is an experiment, not the CCC gateway or a release qualification.
Its evidence checks source consistency, not independent semantic truth.
"""
from __future__ import annotations

import hashlib
import importlib.util
import sqlite3
from collections.abc import Sequence
from pathlib import Path
from types import ModuleType
from typing import Any, NoReturn

__all__ = [
    "validate_corpus",
    "numbered_lines",
    "chunks",
    "validate_edits",
    "apply_edits",
    "validate_summary",
    "baseline_trace",
    "score_case",
    "stage_draft",
    "self_check",
]

KINDS = ("person", "address", "identifier", "contextual")
MASK_TOKENS = {
    "person": "[인명]",
    "address": "[주소]",
    "identifier": "[식별자]",
    "contextual": "[맥락정보]",
}
_KIND_PRIORITY = {kind: index for index, kind in enumerate(KINDS)}
_MAX_DOCUMENT_CHARS = 12_000
_MAX_SUMMARY_CHARS = 500
_MAX_EVIDENCE = 8
_ROOT = Path(__file__).resolve().parents[3]
_OBSERVER_PATH = _ROOT / "artifacts" / "ccc237-privacy" / "full-masking" / "observe_mask.py"
_OBSERVER: ModuleType | None = None


class GateError(ValueError):
    """Sanitized experimental-gate error containing only a stable code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _fail(code: str) -> NoReturn:
    raise GateError(code)


def _unique_location(text: str, quote: str, code: str) -> tuple[int, int]:
    start = text.find(quote)
    if start < 0 or text.find(quote, start + 1) >= 0:
        _fail(code)
    return start, start + len(quote)


def _item_coordinates(item: Any) -> tuple[str, dict[str, tuple[tuple[int, int], ...]], tuple[tuple[int, int], ...]]:
    if not isinstance(item, dict) or set(item) != {"id", "text", "gold", "preserve", "strata"}:
        _fail("invalid_row_schema")
    if not isinstance(item["id"], str) or not item["id"].strip():
        _fail("invalid_id")
    text = item["text"]
    if not isinstance(text, str) or not text.strip() or "\r" in text or len(text) > 1200:
        _fail("invalid_text")
    gold_payload = item["gold"]
    preserve_payload = item["preserve"]
    strata = item["strata"]
    if not isinstance(gold_payload, list):
        _fail("invalid_gold")
    if (
        not isinstance(preserve_payload, list)
        or any(not isinstance(value, str) or not value.strip() for value in preserve_payload)
        or len(preserve_payload) != len(set(preserve_payload))
    ):
        _fail("invalid_preserve")
    if (
        not isinstance(strata, list)
        or not strata
        or any(not isinstance(value, str) or not value.strip() for value in strata)
        or len(strata) != len(set(strata))
    ):
        _fail("invalid_strata")

    by_kind: dict[str, list[tuple[int, int]]] = {kind: [] for kind in KINDS}
    gold_spans: list[tuple[int, int]] = []
    seen_gold: set[tuple[str, str]] = set()
    for entry in gold_payload:
        if not isinstance(entry, dict) or set(entry) != {"quote", "kind"}:
            _fail("invalid_gold")
        quote = entry["quote"]
        kind = entry["kind"]
        if not isinstance(quote, str) or not quote.strip() or kind not in KINDS:
            _fail("invalid_gold")
        if (quote, kind) in seen_gold:
            _fail("duplicate_gold")
        seen_gold.add((quote, kind))
        span = _unique_location(text, quote, "ambiguous_gold_quote")
        by_kind[kind].append(span)
        gold_spans.append(span)

    preserve_spans = tuple(
        _unique_location(text, value, "ambiguous_preserve_quote") for value in preserve_payload
    )
    ordered_gold = sorted(gold_spans)
    if any(right[0] < left[1] for left, right in zip(ordered_gold, ordered_gold[1:])):
        _fail("overlapping_gold")
    if any(max(gold[0], keep[0]) < min(gold[1], keep[1]) for gold in gold_spans for keep in preserve_spans):
        _fail("gold_overlaps_preserve")
    return text, {kind: tuple(by_kind[kind]) for kind in KINDS}, preserve_spans


def validate_corpus(items: Any) -> list[dict[str, Any]]:
    """Validate the exact synthetic corpus contract and return ``items`` unchanged."""
    if not isinstance(items, list) or len(items) != 24:
        _fail("invalid_corpus_size")
    ids: set[str] = set()
    texts: set[str] = set()
    negatives = 0
    for item in items:
        text, by_kind, _preserve = _item_coordinates(item)
        if not 4 <= len(numbered_lines(text)) <= 8:
            _fail("invalid_turn_count")
        identifier = item["id"]
        if identifier in ids:
            _fail("duplicate_id")
        if text in texts:
            _fail("duplicate_text")
        ids.add(identifier)
        texts.add(text)
        negatives += int(not any(by_kind.values()))
    if negatives < 8:
        _fail("insufficient_target_negative_rows")
    return items


def numbered_lines(text: str) -> list[dict[str, Any]]:
    """Return nonempty LF-delimited speaker turns with 1-based ``lineId`` values."""
    if not isinstance(text, str) or not text or len(text) > _MAX_DOCUMENT_CHARS or "\r" in text:
        _fail("invalid_document")
    parts = text.split("\n")
    if parts[-1] == "":
        parts.pop()
    if not parts or any(not part.strip() for part in parts):
        _fail("invalid_document_lines")
    return [{"lineId": index, "text": line} for index, line in enumerate(parts, 1)]


def _validated_lines(lines: Any) -> tuple[list[dict[str, Any]], dict[int, tuple[str, int]]]:
    if not isinstance(lines, list) or not lines:
        _fail("invalid_lines")
    offsets: dict[int, tuple[str, int]] = {}
    absolute = 0
    for expected, line in enumerate(lines, 1):
        if (
            not isinstance(line, dict)
            or set(line) != {"lineId", "text"}
            or type(line["lineId"]) is not int
            or line["lineId"] != expected
            or not isinstance(line["text"], str)
            or not line["text"].strip()
            or "\n" in line["text"]
            or "\r" in line["text"]
        ):
            _fail("invalid_lines")
        offsets[expected] = (line["text"], absolute)
        absolute += len(line["text"]) + 1
    if absolute - 1 > _MAX_DOCUMENT_CHARS:
        _fail("document_too_large")
    return lines, offsets


def chunks(lines: list[dict[str, Any]]) -> list[list[dict[str, Any]]]:
    """Return complete four-line windows, advancing three lines until all are covered."""
    frozen, _offsets = _validated_lines(lines)
    windows: list[list[dict[str, Any]]] = []
    start = 0
    while start < len(frozen):
        window = frozen[start : start + 4]
        windows.append(window)
        if start + 4 >= len(frozen):
            break
        start += 3
    return windows


def _mask_ranges(text: str) -> tuple[tuple[int, int], ...]:
    tokens = set(MASK_TOKENS.values())
    observer = _load_observer()
    tokens.update(
        value
        for name, value in vars(observer.masking).items()
        if name.endswith("_TOKEN") and isinstance(value, str) and value
    )
    ranges: list[tuple[int, int]] = []
    for token in tokens:
        start = text.find(token)
        while start >= 0:
            ranges.append((start, start + len(token)))
            start = text.find(token, start + 1)
    return tuple(ranges)


def _overlaps_mask(start: int, end: int, masks: Sequence[tuple[int, int]]) -> bool:
    return any(max(start, mask_start) < min(end, mask_end) for mask_start, mask_end in masks)


def validate_edits(lines: list[dict[str, Any]], payload: Any) -> list[tuple[int, int, str]]:
    """Validate strict LLM edit JSON and return absolute source spans without rewrites."""
    _frozen, offsets = _validated_lines(lines)
    if not isinstance(payload, dict) or set(payload) != {"edits"} or not isinstance(payload["edits"], list):
        _fail("invalid_edits_schema")
    if len(payload["edits"]) > 32:
        _fail("too_many_edits")
    document = "\n".join(line["text"] for line in lines)
    masks = _mask_ranges(document)
    spans: list[tuple[int, int, str]] = []
    for edit in payload["edits"]:
        if not isinstance(edit, dict) or set(edit) != {"lineId", "quote", "kind"}:
            _fail("invalid_edit")
        line_id = edit["lineId"]
        quote = edit["quote"]
        kind = edit["kind"]
        if type(line_id) is not int or line_id not in offsets:
            _fail("invalid_edit_line")
        if not isinstance(quote, str) or not quote.strip() or "\n" in quote or "\r" in quote:
            _fail("invalid_edit_quote")
        if kind not in KINDS:
            _fail("invalid_edit_kind")
        line_text, line_start = offsets[line_id]
        start, end = _unique_location(line_text, quote, "ambiguous_edit_quote")
        absolute_start, absolute_end = line_start + start, line_start + end
        if _overlaps_mask(absolute_start, absolute_end, masks):
            _fail("edit_overlaps_existing_mask")
        spans.append((absolute_start, absolute_end, kind))
    return spans


def _normalize_spans(text: str, spans: Any) -> list[tuple[int, int, str]]:
    if not isinstance(text, str) or not isinstance(spans, (list, tuple)):
        _fail("invalid_spans")
    masks = _mask_ranges(text)
    checked: list[tuple[int, int, str]] = []
    for span in spans:
        if not isinstance(span, tuple) or len(span) != 3:
            _fail("invalid_span")
        start, end, kind = span
        if (
            type(start) is not int
            or type(end) is not int
            or not 0 <= start < end <= len(text)
            or kind not in KINDS
            or "\n" in text[start:end]
            or "\r" in text[start:end]
        ):
            _fail("invalid_span")
        if _overlaps_mask(start, end, masks):
            _fail("edit_overlaps_existing_mask")
        checked.append(span)

    merged: list[list[Any]] = []
    for start, end, kind in sorted(checked, key=lambda value: (value[0], value[1], _KIND_PRIORITY[value[2]])):
        if merged and start < merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
            if _KIND_PRIORITY[kind] < _KIND_PRIORITY[merged[-1][2]]:
                merged[-1][2] = kind
        else:
            merged.append([start, end, kind])
    return [(start, end, kind) for start, end, kind in merged]


def apply_edits(text: str, spans: Sequence[tuple[int, int, str]]) -> str:
    """Union overlapping spans and replace each union with its deterministic fixed token."""
    merged = _normalize_spans(text, spans)
    parts: list[str] = []
    position = 0
    for start, end, kind in merged:
        parts.extend((text[position:start], MASK_TOKENS[kind]))
        position = end
    parts.append(text[position:])
    return "".join(parts)


def validate_summary(final_text: str, payload: Any) -> dict[str, Any]:
    """Validate bounded summary JSON and exact evidence against the frozen final source."""
    lines = numbered_lines(final_text)
    _frozen, offsets = _validated_lines(lines)
    if not isinstance(payload, dict) or set(payload) != {"summary", "evidence"}:
        _fail("invalid_summary_schema")
    summary = payload["summary"]
    evidence = payload["evidence"]
    if not isinstance(summary, str) or not summary.strip() or len(summary) > _MAX_SUMMARY_CHARS:
        _fail("invalid_summary")
    if not isinstance(evidence, list) or not evidence or len(evidence) > _MAX_EVIDENCE:
        _fail("invalid_evidence")
    frozen_evidence: list[dict[str, Any]] = []
    seen: set[tuple[int, str]] = set()
    for entry in evidence:
        if not isinstance(entry, dict) or set(entry) != {"lineId", "quote"}:
            _fail("invalid_evidence")
        line_id = entry["lineId"]
        quote = entry["quote"]
        if type(line_id) is not int or line_id not in offsets or not isinstance(quote, str) or not quote.strip():
            _fail("invalid_evidence")
        if (line_id, quote) in seen:
            _fail("duplicate_evidence")
        _unique_location(offsets[line_id][0], quote, "ambiguous_evidence_quote")
        seen.add((line_id, quote))
        frozen_evidence.append({"lineId": line_id, "quote": quote})
    return {"summary": summary, "evidence": frozen_evidence}


def _load_observer() -> ModuleType:
    global _OBSERVER
    if _OBSERVER is not None:
        return _OBSERVER
    try:
        spec = importlib.util.spec_from_file_location("_ccc237_context_gate_observer", _OBSERVER_PATH)
        if spec is None or spec.loader is None:
            _fail("observer_load_failed")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    except GateError:
        raise
    except Exception:
        _fail("observer_load_failed")
    _OBSERVER = module
    return module


def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def baseline_trace(text: str, predictions: Sequence[tuple[str, int, int]]) -> dict[str, Any]:
    """Run the actual observer and add one lineage cell per final output character."""
    if not isinstance(text, str):
        _fail("invalid_baseline_text")
    observer = _load_observer()
    if observer._ACTIVE:
        _fail("observer_already_active")
    original_class = observer._Provenance
    captured: list[Any] = []

    class CapturingProvenance(original_class):
        def __init__(self, source: str) -> None:
            super().__init__(source)
            captured.append(self)

    try:
        observer._Provenance = CapturingProvenance
        observed = observer.observe_mask(text, predictions)
    finally:
        observer._Provenance = original_class

    if observer._Provenance is not original_class or len(captured) != 1:
        _fail("observer_restore_failed")
    lineage_instance = captured[0]
    if lineage_instance.text != observed["output"] or len(lineage_instance.cells) != len(observed["output"]):
        _fail("observer_output_mismatch")
    return {
        "output": observed["output"],
        "source_hash": _sha256(text),
        "output_hash": _sha256(observed["output"]),
        "lineage": tuple((origins, state) for origins, state in lineage_instance.cells),
        "opaque_indices": observed["opaque_indices"],
        "generalized_indices": observed["generalized_indices"],
        "literal_indices": observed["literal_indices"],
    }


def _trace_partition(trace: Any, source: str, removed: frozenset[int]) -> tuple[frozenset[int], frozenset[int], frozenset[int]]:
    expected = {
        "output",
        "source_hash",
        "output_hash",
        "lineage",
        "opaque_indices",
        "generalized_indices",
        "literal_indices",
    }
    if not isinstance(trace, dict) or set(trace) != expected:
        _fail("invalid_baseline_trace")
    output = trace["output"]
    lineage = trace["lineage"]
    if (
        not isinstance(output, str)
        or trace["source_hash"] != _sha256(source)
        or trace["output_hash"] != _sha256(output)
        or not isinstance(lineage, tuple)
        or len(lineage) != len(output)
        or any(type(index) is not int or not 0 <= index < len(output) for index in removed)
    ):
        _fail("invalid_baseline_trace")
    for key in ("opaque_indices", "generalized_indices", "literal_indices"):
        indices = trace[key]
        if not isinstance(indices, frozenset) or any(
            type(index) is not int or not 0 <= index < len(source) for index in indices
        ):
            _fail("invalid_baseline_partition")
    if (
        trace["opaque_indices"] & trace["generalized_indices"]
        or trace["opaque_indices"] & trace["literal_indices"]
        or trace["generalized_indices"] & trace["literal_indices"]
        or trace["opaque_indices"] | trace["generalized_indices"] | trace["literal_indices"]
        != frozenset(range(len(source)))
    ):
        _fail("invalid_baseline_partition")

    by_state = {"literal": set(), "generalized": set(), "opaque": set()}
    all_source = set(range(len(source)))
    for output_index, cell in enumerate(lineage):
        if not isinstance(cell, tuple) or len(cell) != 2:
            _fail("invalid_baseline_lineage")
        origins, state = cell
        if (
            not isinstance(origins, frozenset)
            or not origins
            or any(type(index) is not int or index not in all_source for index in origins)
            or state not in by_state
        ):
            _fail("invalid_baseline_lineage")
        by_state["opaque" if output_index in removed else state].update(origins)
    if set().union(*by_state.values()) != all_source:
        _fail("incomplete_baseline_lineage")
    literal = by_state["literal"]
    generalized = by_state["generalized"] - literal
    opaque = by_state["opaque"] - literal - generalized
    if literal | generalized | opaque != all_source:
        _fail("invalid_baseline_partition")
    if not removed and (
        frozenset(opaque) != trace["opaque_indices"]
        or frozenset(generalized) != trace["generalized_indices"]
        or frozenset(literal) != trace["literal_indices"]
    ):
        _fail("inconsistent_baseline_lineage")
    return frozenset(opaque), frozenset(generalized), frozenset(literal)


def score_case(
    item: dict[str, Any],
    baseline_trace: dict[str, Any],
    extra_spans: Sequence[tuple[int, int, str]],
) -> dict[str, Any]:
    """Return raw-free before/after provenance counts for one validated synthetic row."""
    source, gold, preserve = _item_coordinates(item)
    if not isinstance(baseline_trace, dict) or not isinstance(baseline_trace.get("output"), str):
        _fail("invalid_baseline_trace")
    output = baseline_trace["output"]
    merged = _normalize_spans(output, extra_spans)
    removed = frozenset(index for start, end, _kind in merged for index in range(start, end))
    before_opaque, before_generalized, before_literal = _trace_partition(
        baseline_trace, source, frozenset()
    )
    after_opaque, after_generalized, after_literal = _trace_partition(
        baseline_trace, source, removed
    )

    literal_counts: dict[str, dict[str, int]] = {}
    nonopaque_counts: dict[str, dict[str, int]] = {}
    completely_masked_before: dict[str, int] = {}
    completely_masked: dict[str, int] = {}
    diagnostics: set[str] = set()
    gold_indices: set[int] = set()
    for kind in KINDS:
        before = 0
        after = 0
        complete = 0
        nonopaque_before = 0
        nonopaque_after = 0
        complete_before = 0
        for start, end in gold[kind]:
            indices = {index for index in range(start, end) if not source[index].isspace()}
            gold_indices.update(indices)
            before += len(indices & before_literal)
            after += len(indices & after_literal)
            nonopaque_before += len(indices & (before_literal | before_generalized))
            nonopaque_after += len(indices & (after_literal | after_generalized))
            complete_before += int(bool(indices) and indices <= before_opaque)
            complete += int(bool(indices) and indices <= after_opaque)
            if indices & before_literal and not indices <= before_literal:
                diagnostics.add("baseline_gold_partially_literal")
            if not indices & before_literal and indices & before_generalized:
                diagnostics.add("baseline_gold_generalized_only")
        literal_counts[kind] = {"before": before, "after": after}
        nonopaque_counts[kind] = {"before": nonopaque_before, "after": nonopaque_after}
        completely_masked_before[kind] = complete_before
        completely_masked[kind] = complete

    preserve_lost = 0
    for start, end in preserve:
        indices = set(range(start, end))
        if not indices <= before_literal:
            diagnostics.add("baseline_preserve_not_literal")
        preserve_lost += int(not indices <= after_literal)
    preserve_indices = {i for start, end in preserve for i in range(start, end) if not source[i].isspace()}

    newly_opaque = after_opaque - before_opaque
    extra_non_gold = sum(
        index not in gold_indices and not source[index].isspace() for index in newly_opaque
    )
    if after_generalized & after_opaque or after_literal & after_opaque:
        _fail("invalid_after_partition")
    return {
        "goldNonspaceLiteralChars": literal_counts,
        "goldNonspaceNonOpaqueChars": nonopaque_counts,
        "completelyMaskedSpansBefore": completely_masked_before,
        "completelyMaskedSpans": completely_masked,
        "protectedPreserveStringsLost": preserve_lost,
        "protectedPreserveNonspaceChars": len(preserve_indices),
        "protectedPreserveNonspaceCharsLost": {
            "before": len(preserve_indices - before_literal),
            "after": len(preserve_indices - after_literal),
        },
        "extraNonGoldMaskingChars": extra_non_gold,
        "diagnostics": sorted(diagnostics),
    }


_CREATE_DRAFT = """
CREATE TABLE context_gate_draft (
    final_source TEXT NOT NULL,
    final_sha256 TEXT NOT NULL CHECK (length(final_sha256) = 64),
    summary_draft TEXT NOT NULL,
    approved_at TEXT NULL
)
"""


def _stage_with_connection(connection: sqlite3.Connection, final_text: str, payload: Any) -> dict[str, Any]:
    validated = validate_summary(final_text, payload)
    digest = _sha256(final_text)
    try:
        connection.execute(_CREATE_DRAFT)
        connection.execute(
            "INSERT INTO context_gate_draft (final_source, final_sha256, summary_draft, approved_at) VALUES (?, ?, ?, NULL)",
            (final_text, digest, validated["summary"]),
        )
        row = connection.execute(
            "SELECT final_source, final_sha256, summary_draft, approved_at FROM context_gate_draft LIMIT 1"
        ).fetchone()
    except sqlite3.Error:
        _fail("draft_staging_failed")
    if row != (final_text, digest, validated["summary"], None) or _sha256(row[0]) != row[1]:
        _fail("draft_roundtrip_failed")
    return {"finalHash": digest, "approvedAt": None}


def stage_draft(final_text: str, payload: Any) -> dict[str, Any]:
    """Validate and hash-roundtrip one summary draft in an isolated in-memory database."""
    try:
        with sqlite3.connect(":memory:") as connection:
            return _stage_with_connection(connection, final_text, payload)
    except GateError:
        raise
    except sqlite3.Error:
        _fail("draft_staging_failed")


def self_check() -> None:
    """Run synthetic checks for every gate invariant; intentionally not auto-run."""
    corpus: list[dict[str, Any]] = []
    for index in range(24):
        preserve = f"보존문구{index}"
        if index < 16:
            kind = KINDS[index % len(KINDS)]
            quote = f"가상표식{index}"
            text = f"화자는 {quote} 관련 상담을 말하고 {preserve}를 확인했다."
            gold = [{"quote": quote, "kind": kind}]
            strata = ["positive", kind]
        else:
            text = f"화자는 일반 상담 내용을 말하고 {preserve}를 확인했다."
            gold = []
            strata = ["target-negative"]
        text += "\n실무자: 현재 상황을 확인했습니다.\n당사자: 필요한 지원을 이야기했습니다.\n실무자: 다음 행동을 정리하겠습니다."
        corpus.append(
            {"id": f"synthetic-{index:02d}", "text": text, "gold": gold, "preserve": [preserve], "strata": strata}
        )
    assert validate_corpus(corpus) is corpus

    lines = numbered_lines("가나다라마바사\n😀민수와 서울\n셋째 줄\n넷째 줄\n다섯째 줄\n여섯째 줄\n일곱째 줄\n여덟째 줄")
    windows = chunks(lines)
    assert [len(window) for window in windows] == [4, 4, 2]
    assert all(left[-1]["lineId"] == right[0]["lineId"] for left, right in zip(windows, windows[1:]))
    assert {line["lineId"] for window in windows for line in window} == set(range(1, 9))

    edits = validate_edits(
        lines,
        {
            "edits": [
                {"lineId": 1, "quote": "가나다", "kind": "contextual"},
                {"lineId": 1, "quote": "나다라", "kind": "identifier"},
                {"lineId": 2, "quote": "😀민수", "kind": "person"},
                {"lineId": 2, "quote": "😀민수", "kind": "person"},
            ]
        },
    )
    edited = apply_edits("\n".join(line["text"] for line in lines), edits)
    assert edited.startswith("[식별자]마바사\n[인명]와 서울")

    def rejected(code: str, action: Any) -> None:
        try:
            action()
        except GateError as error:
            assert error.code == code
        else:
            raise AssertionError("synthetic rejection missing")

    rejected(
        "ambiguous_edit_quote",
        lambda: validate_edits(numbered_lines("반복 반복"), {"edits": [{"lineId": 1, "quote": "반복", "kind": "contextual"}]}),
    )
    rejected(
        "edit_overlaps_existing_mask",
        lambda: validate_edits(numbered_lines("오늘 [인명] 방문"), {"edits": [{"lineId": 1, "quote": "[인명]", "kind": "person"}]}),
    )

    partial_source = "김민수님 방문"
    partial_trace = baseline_trace(partial_source, (("PRIVATE_PERSON", 0, 3),))
    assert partial_trace["output"] == "[인명]님 방문"
    extra = validate_edits(
        numbered_lines(partial_trace["output"]),
        {"edits": [{"lineId": 1, "quote": "님", "kind": "contextual"}]},
    )
    partial_score = score_case(
        {
            "id": "partial",
            "text": partial_source,
            "gold": [{"quote": "김민수님", "kind": "person"}],
            "preserve": ["방문"],
            "strata": ["partial-gold"],
        },
        partial_trace,
        extra,
    )
    assert partial_score["goldNonspaceLiteralChars"]["person"] == {"before": 1, "after": 0}
    assert partial_score["completelyMaskedSpans"]["person"] == 1
    assert partial_score["protectedPreserveStringsLost"] == 0

    generalized_source = "2026-09-03"
    generalized_score = score_case(
        {
            "id": "generalized",
            "text": generalized_source,
            "gold": [{"quote": generalized_source, "kind": "contextual"}],
            "preserve": [],
            "strata": ["generalized-only"],
        },
        baseline_trace(generalized_source, ()),
        (),
    )
    assert generalized_score["completelyMaskedSpans"]["contextual"] == 0
    assert generalized_score["goldNonspaceNonOpaqueChars"]["contextual"] == {"before": 10, "after": 10}
    assert "baseline_gold_generalized_only" in generalized_score["diagnostics"]

    final_text = "[인명]님 방문\n지원 계획 확인"
    summary = {
        "summary": "방문과 지원 계획을 확인했다.",
        "evidence": [{"lineId": 1, "quote": "방문"}, {"lineId": 2, "quote": "지원 계획"}],
    }
    assert validate_summary(final_text, summary) == summary
    rejected(
        "ambiguous_evidence_quote",
        lambda: validate_summary("동결 문구\n현재 문구", {"summary": "요약", "evidence": [{"lineId": 2, "quote": "동결"}]}),
    )
    staged = stage_draft(final_text, summary)
    assert staged == {"finalHash": _sha256(final_text), "approvedAt": None}

    with sqlite3.connect(":memory:") as connection:
        rejected(
            "ambiguous_evidence_quote",
            lambda: _stage_with_connection(
                connection,
                final_text,
                {"summary": "요약", "evidence": [{"lineId": 1, "quote": "없는 근거"}]},
            ),
        )
        tables = connection.execute(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'context_gate_draft'"
        ).fetchone()[0]
        assert tables == 0
