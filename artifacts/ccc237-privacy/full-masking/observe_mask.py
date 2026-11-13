#!/usr/bin/env python3
"""Observe source provenance through the unchanged product masking pipeline.

This experiment temporarily instruments module globals and ``sys.settrace`` and is
therefore single-thread only. Provenance is deliberately conservative: when one
replacement combines several source code points, every replacement character
inherits all of them; if later edits split that replacement, literal provenance
wins over generalized, which wins over opaque. This measures source disclosure,
not a character alignment between source and output.
"""
from __future__ import annotations

import re
import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
PIPELINE_ROOT = ROOT / "apps" / "pipeline"
if str(PIPELINE_ROOT) not in sys.path:
    sys.path.insert(0, str(PIPELINE_ROOT))

from ccc_pipeline import masking

PERSON_LABEL = "PRIVATE_PERSON"
ADDRESS_LABEL = "PRIVATE_ADDRESS"
_LABELS = (PERSON_LABEL, ADDRESS_LABEL)
_LITERAL = "literal"
_GENERALIZED = "generalized"
_OPAQUE = "opaque"
_PATCHED_NAMES = (
    "_merge_spans",
    "_generalize_dates",
    "_generalize_ages",
    "_generalize_regions",
    "_sub_counting",
    "_ISO_DATE",
    "_KOREAN_DATE",
    "_EXPLICIT_AGE",
)
_ACTIVE = False


class _Provenance:
    def __init__(self, text: str) -> None:
        self.text = text
        self.cells: list[tuple[frozenset[int], str]] = [
            (frozenset((index,)), _LITERAL) for index in range(len(text))
        ]

    def require(self, actual: str) -> None:
        if self.text != actual:
            raise RuntimeError("masking observation stage mismatch")

    def replace(
        self,
        edits: Sequence[tuple[int, int, str, str]],
        actual: str,
    ) -> None:
        source_text = self.text
        source_cells = self.cells
        text_parts: list[str] = []
        cells: list[tuple[frozenset[int], str]] = []
        position = 0
        for start, end, replacement, kind in sorted(edits, key=lambda edit: edit[0]):
            if (
                type(start) is not int
                or type(end) is not int
                or not position <= start < end <= len(source_text)
                or not isinstance(replacement, str)
                or not replacement
                or kind not in (_GENERALIZED, _OPAQUE)
            ):
                raise RuntimeError("invalid observed masking edit")
            text_parts.append(source_text[position:start])
            cells.extend(source_cells[position:start])
            origins = frozenset().union(*(origin for origin, _kind in source_cells[start:end]))
            if not origins:
                raise RuntimeError("observed masking edit lost provenance")
            text_parts.append(replacement)
            cells.extend((origins, kind) for _character in replacement)
            position = end
        text_parts.append(source_text[position:])
        cells.extend(source_cells[position:])
        reconstructed = "".join(text_parts)
        if reconstructed != actual or len(cells) != len(actual):
            raise RuntimeError("masking observation reconstruction mismatch")
        self.text = reconstructed
        self.cells = cells

    def partition(self, source_length: int) -> tuple[frozenset[int], frozenset[int], frozenset[int]]:
        by_kind = {_LITERAL: set(), _GENERALIZED: set(), _OPAQUE: set()}
        for origins, kind in self.cells:
            by_kind[kind].update(origins)
        all_indices = set(range(source_length))
        if set().union(*by_kind.values()) != all_indices:
            raise RuntimeError("masking observation has incomplete provenance")
        literal = by_kind[_LITERAL]
        generalized = by_kind[_GENERALIZED] - literal
        opaque = by_kind[_OPAQUE] - literal - generalized
        if literal | generalized | opaque != all_indices:
            raise RuntimeError("masking observation partition mismatch")
        return frozenset(opaque), frozenset(generalized), frozenset(literal)


class _PatternProxy:
    def __init__(
        self,
        pattern: re.Pattern[str],
        provenance: _Provenance,
        classify: Callable[[str], str],
    ) -> None:
        self._pattern = pattern
        self._provenance = provenance
        self._classify = classify

    def sub(self, repl: Any, string: str, count: int = 0) -> str:
        self._provenance.require(string)
        edits: list[tuple[int, int, str, str]] = []

        def record(match: re.Match[str]) -> str:
            replacement = repl(match) if callable(repl) else match.expand(repl)
            if not isinstance(replacement, str):
                raise TypeError("masking replacement must be text")
            edits.append((match.start(), match.end(), replacement, self._classify(replacement)))
            return replacement

        result = self._pattern.sub(record, string, count)
        self._provenance.replace(edits, result)
        return result

    def __getattr__(self, name: str) -> Any:
        return getattr(self._pattern, name)


def _freeze_predictions(
    text: str,
    predictions: Sequence[tuple[str, int, int]],
) -> tuple[tuple[str, int, int], ...]:
    frozen: list[tuple[str, int, int]] = []
    seen: set[tuple[str, int, int]] = set()
    for prediction in predictions:
        if not isinstance(prediction, tuple) or len(prediction) != 3:
            raise ValueError("invalid cached prediction")
        label, start, end = prediction
        if (
            label not in _LABELS
            or type(start) is not int
            or type(end) is not int
            or not 0 <= start < end <= len(text)
            or prediction in seen
        ):
            raise ValueError("invalid cached prediction")
        seen.add(prediction)
        frozen.append(prediction)
    return tuple(frozen)


def observe_mask(
    text: str,
    predictions: Sequence[tuple[str, int, int]],
) -> dict[str, Any]:
    """Run real full masking and return output plus original-code-point provenance.

    ``predictions`` must be the already cached, validated model output for this
    exact ``text``. No prediction, source span, or replacement trace is persisted.
    """
    global _ACTIVE
    if not isinstance(text, str):
        raise TypeError("text must be str")
    frozen = _freeze_predictions(text, predictions)
    if _ACTIVE:
        raise RuntimeError("masking observation is single-thread only")
    _ACTIVE = True

    provenance = _Provenance(text)
    originals = {name: getattr(masking, name) for name in _PATCHED_NAMES}
    merged_spans: tuple[tuple[int, int, str], ...] | None = None
    first_stage_spans: tuple[tuple[str, int, int], ...] = ()

    def cached_ner(label: str) -> masking.NerFn:
        spans = tuple((start, end) for found, start, end in frozen if found == label)

        def predict(candidate: str) -> list[tuple[int, int]]:
            if candidate is not text:
                raise RuntimeError("cached NER called with unexpected input")
            return list(spans)

        return predict

    person_ner = cached_ner(PERSON_LABEL)
    address_ner = cached_ner(ADDRESS_LABEL)

    def observed_merge(
        spans: list[tuple[int, int, str]], limit: int
    ) -> list[tuple[int, int, str]]:
        nonlocal merged_spans
        if merged_spans is not None:
            raise RuntimeError("unexpected repeated first-stage merge")
        result = originals["_merge_spans"](spans, limit)
        merged_spans = tuple(result)
        return result

    def synchronize_first_stage(stage_text: str) -> None:
        nonlocal first_stage_spans
        if merged_spans is None:
            raise RuntimeError("first-stage merge was not observed")
        provenance.replace(
            tuple((start, end, token, _OPAQUE) for start, end, token in merged_spans),
            stage_text,
        )
        labels = {
            masking.PERSON_TOKEN: PERSON_LABEL,
            masking.ADDRESS_TOKEN: ADDRESS_LABEL,
        }
        first_stage_spans = tuple(
            (labels[token], start, end)
            for start, end, token in merged_spans
            if token in labels
        )

    def observed_dates(stage_text: str, report: masking.MaskingReport) -> str:
        synchronize_first_stage(stage_text)
        result = originals["_generalize_dates"](stage_text, report)
        provenance.require(result)
        return result

    def observed_ages(stage_text: str) -> str:
        provenance.require(stage_text)
        result = originals["_generalize_ages"](stage_text)
        provenance.require(result)
        return result

    def observed_sub_counting(
        pattern: re.Pattern[str],
        token: str,
        stage_text: str,
        report: masking.MaskingReport,
    ) -> str:
        provenance.require(stage_text)
        proxy = _PatternProxy(pattern, provenance, lambda _replacement: _OPAQUE)
        result = originals["_sub_counting"](proxy, token, stage_text, report)
        provenance.require(result)
        return result

    def observed_regions(stage_text: str, report: masking.MaskingReport) -> str:
        provenance.require(stage_text)
        previous_trace = sys.gettrace()
        captured: tuple[tuple[int, int, str], ...] | None = None
        region_code = originals["_generalize_regions"].__code__

        def trace(frame: Any, event: str, argument: Any) -> Any:
            nonlocal captured
            if frame.f_code is region_code and event == "return" and isinstance(argument, str):
                replacements = frame.f_locals.get("replacements")
                if isinstance(replacements, list):
                    captured = tuple(replacements)
            return trace

        try:
            sys.settrace(trace)
            result = originals["_generalize_regions"](stage_text, report)
        finally:
            sys.settrace(previous_trace)
        if captured is None:
            raise RuntimeError("region replacements were not observed")
        provenance.replace(
            tuple(
                (
                    start,
                    end,
                    replacement,
                    _OPAQUE if replacement == masking.REGION_TOKEN else _GENERALIZED,
                )
                for start, end, replacement in captured
            ),
            result,
        )
        provenance.require(result)
        return result

    try:
        masking._merge_spans = observed_merge
        masking._generalize_dates = observed_dates
        masking._generalize_ages = observed_ages
        masking._generalize_regions = observed_regions
        masking._sub_counting = observed_sub_counting
        masking._ISO_DATE = _PatternProxy(
            originals["_ISO_DATE"],
            provenance,
            lambda replacement: (
                _OPAQUE if replacement == masking.QUASI_IDENTIFIER_TOKEN else _GENERALIZED
            ),
        )
        masking._KOREAN_DATE = _PatternProxy(
            originals["_KOREAN_DATE"],
            provenance,
            lambda replacement: (
                _OPAQUE if replacement == masking.QUASI_IDENTIFIER_TOKEN else _GENERALIZED
            ),
        )
        masking._EXPLICIT_AGE = _PatternProxy(
            originals["_EXPLICIT_AGE"], provenance, lambda _replacement: _GENERALIZED
        )
        observed_output, observed_report = masking.mask_text_with_report(
            text, person_ner, None, address_ner
        )
        provenance.require(observed_output)
    finally:
        for name, original in originals.items():
            setattr(masking, name, original)
        _ACTIVE = False

    check_output, check_report = masking.mask_text_with_report(
        text, person_ner, None, address_ner
    )
    report_counts = dict(observed_report.as_mapping())
    if observed_output != check_output or report_counts != dict(check_report.as_mapping()):
        raise RuntimeError("instrumented masking differs from product masking")

    opaque, generalized, literal = provenance.partition(len(text))
    return {
        "output": observed_output,
        "spans": first_stage_spans,
        "opaque_indices": opaque,
        "generalized_indices": generalized,
        "literal_indices": literal,
        "report_counts": report_counts,
    }


def self_check() -> None:
    """Synthetic, hand-checkable observer checks; intentionally not run on import."""
    original_globals = {name: getattr(masking, name) for name in _PATCHED_NAMES}
    original_trace = sys.gettrace()

    overlap = observe_mask(
        "가나다라마바사",
        ((ADDRESS_LABEL, 0, 5), (PERSON_LABEL, 4, 7)),
    )
    assert overlap["output"] == masking.PERSON_TOKEN
    assert overlap["spans"] == ((PERSON_LABEL, 0, 7),)
    assert overlap["opaque_indices"] == frozenset(range(7))
    assert not overlap["generalized_indices"] and not overlap["literal_indices"]

    source = "😀 유지 2026-09-03 만 37세 서울시 은평구 연락 010-1234-5678"
    observed = observe_mask(source, ())
    assert observed["output"] == "😀 유지 2026-09 35-39세 서울시 연락 [전화번호]"
    generalized = set()
    for value in ("2026-09-03", "만 37세", "서울시 은평구"):
        start = source.index(value)
        generalized.update(range(start, start + len(value)))
    phone_start = source.index("010-1234-5678")
    opaque = set(range(phone_start, phone_start + len("010-1234-5678")))
    assert observed["generalized_indices"] == frozenset(generalized)
    assert observed["opaque_indices"] == frozenset(opaque)
    assert observed["literal_indices"] == frozenset(set(range(len(source))) - generalized - opaque)
    assert observed["report_counts"] == {masking.PHONE_TOKEN: 1}

    month_day = observe_mask("약속은 9월 3일", ())
    assert month_day["output"] == f"약속은 {masking.QUASI_IDENTIFIER_TOKEN}"
    assert month_day["opaque_indices"] == frozenset(range(4, 9))
    assert month_day["literal_indices"] == frozenset(range(4))
    assert month_day["report_counts"] == {masking.QUASI_IDENTIFIER_TOKEN: 1}

    local_region = observe_mask("구리시", ())
    assert local_region["output"] == masking.REGION_TOKEN
    assert local_region["opaque_indices"] == frozenset(range(3))
    assert local_region["report_counts"] == {masking.REGION_TOKEN: 1}

    def sentinel_trace(frame: Any, event: str, argument: Any) -> Any:
        return sentinel_trace

    product_regions = masking._generalize_regions

    def fail_regions(stage_text: str, report: masking.MaskingReport) -> str:
        raise RuntimeError("synthetic region failure")

    try:
        masking._generalize_regions = fail_regions
        sys.settrace(sentinel_trace)
        try:
            observe_mask("복원 확인", ())
        except RuntimeError as error:
            assert str(error) == "synthetic region failure"
        else:
            raise AssertionError("synthetic failure did not propagate")
        assert sys.gettrace() is sentinel_trace
        assert masking._generalize_regions is fail_regions
        for name, original in original_globals.items():
            if name != "_generalize_regions":
                assert getattr(masking, name) is original
    finally:
        sys.settrace(original_trace)
        masking._generalize_regions = product_regions

    for name, original in original_globals.items():
        assert getattr(masking, name) is original
