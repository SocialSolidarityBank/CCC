"""Raw-free diagnostics for the synthetic CCC-237 full-masking measurement."""
from __future__ import annotations

import sys
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any, NoReturn

_ROOT = Path(__file__).resolve().parents[3]
_PRIVACY_SCRIPTS = str(_ROOT / "scripts" / "privacy")
if _PRIVACY_SCRIPTS not in sys.path:
    sys.path.insert(0, _PRIVACY_SCRIPTS)

from qualify_ner import (  # noqa: E402
    ADDRESS_LABEL,
    LABELS,
    PERSON_LABEL,
    QualificationError,
    _score_row,
    measurement_passes,
    point_metrics,
    wilson_metrics,
)
from ccc_pipeline.masking import ADDRESS_TOKEN, PERSON_TOKEN  # noqa: E402

_COUNT_KEYS = ("tp", "fp", "fn")
_COVERAGE_KEYS = (
    "goldSpans",
    "goldNonspaceCodepoints",
    "opaqueNonspaceCodepoints",
    "generalizedNonspaceCodepoints",
    "literalNonspaceCodepoints",
    "fullyOpaqueSpans",
    "generalizedNoLiteralSpans",
    "partiallyLiteralSpans",
    "fullyLiteralSpans",
    "exactGoldLostAfterMerge",
    "exactGoldGainedAfterMerge",
    "goldStringsPresentInOutputNonOriginSpecific",
)
_TRACE_KEYS = {
    "output",
    "spans",
    "opaque_indices",
    "generalized_indices",
    "literal_indices",
    "report_counts",
}


def _fail(code: str) -> NoReturn:
    raise QualificationError(code)


def _gold_coordinates(
    item: Any,
) -> tuple[str, dict[str, tuple[tuple[str, int, int], ...]]]:
    if not isinstance(item, dict) or set(item) not in (
        {"id", "text", "person", "address"},
        {"id", "text", "person", "address", "strata"},
    ):
        _fail("invalid_row_schema")
    if not isinstance(item["id"], str) or not item["id"].strip():
        _fail("invalid_id")
    text = item["text"]
    if not isinstance(text, str) or not text.strip():
        _fail("invalid_text")
    if "strata" in item and (
        not isinstance(item["strata"], list)
        or not item["strata"]
        or any(not isinstance(value, str) or not value.strip() for value in item["strata"])
        or len(item["strata"]) != len(set(item["strata"]))
    ):
        _fail("invalid_strata")

    gold: dict[str, tuple[tuple[str, int, int], ...]] = {}
    all_spans: list[tuple[int, int]] = []
    for field, label in (("person", PERSON_LABEL), ("address", ADDRESS_LABEL)):
        values = item[field]
        if not isinstance(values, list):
            _fail(f"invalid_{field}_list")
        if (
            any(not isinstance(value, str) or not value.strip() for value in values)
            or len(values) != len(set(values))
        ):
            _fail("ambiguous_gold_substring")
        labeled: list[tuple[str, int, int]] = []
        for value in values:
            start = text.find(value)
            if start < 0 or text.find(value, start + 1) >= 0:
                _fail("ambiguous_gold_substring")
            end = start + len(value)
            labeled.append((value, start, end))
            all_spans.append((start, end))
        gold[label] = tuple(labeled)

    ordered = sorted(all_spans)
    if any(right_start < left_end for (_, left_end), (right_start, _) in zip(ordered, ordered[1:])):
        _fail("overlapping_gold_spans")
    return text, gold


def _validated_indices(value: Any, text_length: int) -> frozenset[int]:
    if not isinstance(value, frozenset) or any(
        not isinstance(index, int)
        or isinstance(index, bool)
        or index < 0
        or index >= text_length
        for index in value
    ):
        _fail("invalid_trace_partition")
    return value


def _validated_trace(
    trace: Any,
    text: str,
) -> tuple[str, tuple[tuple[str, int, int], ...], frozenset[int], frozenset[int], frozenset[int]]:
    if not isinstance(trace, dict) or set(trace) != _TRACE_KEYS:
        _fail("invalid_trace_schema")
    output = trace["output"]
    spans = trace["spans"]
    report_counts = trace["report_counts"]
    if not isinstance(output, str) or not isinstance(spans, tuple) or not isinstance(report_counts, dict):
        _fail("invalid_trace_schema")

    try:
        _score_row({"text": text, "person": [], "address": []}, spans)
    except (QualificationError, KeyError, TypeError, ValueError):
        _fail("invalid_trace_coordinates")
    if spans != tuple(sorted(spans, key=lambda span: (span[1], span[2], span[0]))):
        _fail("invalid_trace_coordinates")
    if any(right[1] < left[2] for left, right in zip(spans, spans[1:])):
        _fail("invalid_trace_coordinates")

    opaque = _validated_indices(trace["opaque_indices"], len(text))
    generalized = _validated_indices(trace["generalized_indices"], len(text))
    literal = _validated_indices(trace["literal_indices"], len(text))
    if (
        opaque & generalized
        or opaque & literal
        or generalized & literal
        or opaque | generalized | literal != frozenset(range(len(text)))
    ):
        _fail("invalid_trace_partition")
    if any(index not in opaque for _, start, end in spans for index in range(start, end)):
        _fail("inconsistent_trace_partition")

    if any(
        not isinstance(token, str)
        or not token
        or not isinstance(count, int)
        or isinstance(count, bool)
        or count <= 0
        for token, count in report_counts.items()
    ):
        _fail("invalid_trace_counts")
    expected = {
        PERSON_TOKEN: sum(label == PERSON_LABEL for label, _, _ in spans),
        ADDRESS_TOKEN: sum(label == ADDRESS_LABEL for label, _, _ in spans),
    }
    if any(report_counts.get(token, 0) != count for token, count in expected.items()):
        _fail("inconsistent_trace_counts")
    return output, spans, opaque, generalized, literal


def measure_row(item: dict[str, Any], predictions: Sequence[tuple[str, int, int]], trace: dict[str, Any]) -> dict[str, Any]:
    """Measure one row without returning source text, strings, spans, or offsets."""
    text, gold = _gold_coordinates(item)
    if predictions is None:
        _fail("missing_raw_predictions")
    try:
        frozen_predictions = tuple(predictions)
    except TypeError:
        _fail("invalid_prediction")

    ner_counts = _score_row(item, frozen_predictions)
    output, merged_spans, opaque, generalized, literal = _validated_trace(trace, text)
    combined_counts = _score_row(item, merged_spans)

    gold_indices = frozenset(
        index
        for labeled in gold.values()
        for _, start, end in labeled
        for index in range(start, end)
    )
    raw_exact = set(frozen_predictions)
    merged_exact = set(merged_spans)
    coverage: dict[str, dict[str, int]] = {}

    for label in LABELS:
        values = gold[label]
        label_gold = {(label, start, end) for _, start, end in values}
        counts = {key: 0 for key in _COVERAGE_KEYS}
        counts["goldSpans"] = len(values)
        counts["exactGoldLostAfterMerge"] = len((raw_exact & label_gold) - merged_exact)
        counts["exactGoldGainedAfterMerge"] = len((merged_exact & label_gold) - raw_exact)
        counts["goldStringsPresentInOutputNonOriginSpecific"] = sum(
            value in output for value, _, _ in values
        )

        for _, start, end in values:
            nonspace = {index for index in range(start, end) if not text[index].isspace()}
            opaque_count = len(nonspace & opaque)
            generalized_count = len(nonspace & generalized)
            literal_count = len(nonspace & literal)
            counts["goldNonspaceCodepoints"] += len(nonspace)
            counts["opaqueNonspaceCodepoints"] += opaque_count
            counts["generalizedNonspaceCodepoints"] += generalized_count
            counts["literalNonspaceCodepoints"] += literal_count
            if opaque_count == len(nonspace):
                counts["fullyOpaqueSpans"] += 1
            elif literal_count == 0 and generalized_count > 0:
                counts["generalizedNoLiteralSpans"] += 1
            elif literal_count == len(nonspace):
                counts["fullyLiteralSpans"] += 1
            else:
                counts["partiallyLiteralSpans"] += 1
        coverage[label] = counts

    first_stage_nonspace = len(
        {
            index
            for _, start, end in merged_spans
            for index in range(start, end)
            if index not in gold_indices and not text[index].isspace()
        }
    )
    target_negative = int(not gold[PERSON_LABEL] and not gold[ADDRESS_LABEL])
    return {
        "nerCounts": ner_counts,
        "combinedCounts": combined_counts,
        "coverage": coverage,
        "outsideGold": {
            "firstStageNonspace": first_stage_nonspace,
            "finalOpaqueNonspace": len(
                {
                    index
                    for index in opaque
                    if index not in gold_indices and not text[index].isspace()
                }
            ),
        },
        "targetNegative": target_negative,
        "targetNegativeFalsePositive": int(target_negative and bool(merged_spans)),
    }


def _checked_nonnegative_int(value: Any) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        _fail("invalid_diagnostic_row")
    return value


def summarize_rows(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate raw-free rows and report both q-score arms as diagnostics only."""
    if not isinstance(rows, (list, tuple)):
        _fail("invalid_diagnostic_rows")

    ner_counts = {label: {key: 0 for key in _COUNT_KEYS} for label in LABELS}
    combined_counts = {label: {key: 0 for key in _COUNT_KEYS} for label in LABELS}
    coverage = {label: {key: 0 for key in _COVERAGE_KEYS} for label in LABELS}
    outside_gold = {
        "firstStageNonspace": 0,
        "finalOpaqueNonspace": 0,
    }
    target_negative_rows = 0
    target_negative_false_positive_rows = 0

    for row in rows:
        if not isinstance(row, dict) or set(row) != {
            "nerCounts",
            "combinedCounts",
            "coverage",
            "outsideGold",
            "targetNegative",
            "targetNegativeFalsePositive",
        }:
            _fail("invalid_diagnostic_row")
        if any(not isinstance(row[key], dict) or set(row[key]) != set(LABELS) for key in ("nerCounts", "combinedCounts", "coverage")):
            _fail("invalid_diagnostic_row")
        outside = row["outsideGold"]
        if not isinstance(outside, dict) or set(outside) != {
            "firstStageNonspace",
            "finalOpaqueNonspace",
        }:
            _fail("invalid_diagnostic_row")

        for label in LABELS:
            for arm_key, total in (("nerCounts", ner_counts), ("combinedCounts", combined_counts)):
                values = row[arm_key][label]
                if not isinstance(values, dict) or set(values) != set(_COUNT_KEYS):
                    _fail("invalid_diagnostic_row")
                for key in _COUNT_KEYS:
                    total[label][key] += _checked_nonnegative_int(values[key])

            values = row["coverage"][label]
            if not isinstance(values, dict) or set(values) != set(_COVERAGE_KEYS):
                _fail("invalid_diagnostic_row")
            for key in _COVERAGE_KEYS:
                coverage[label][key] += _checked_nonnegative_int(values[key])
            if values["goldSpans"] != sum(
                values[key]
                for key in (
                    "fullyOpaqueSpans",
                    "generalizedNoLiteralSpans",
                    "partiallyLiteralSpans",
                    "fullyLiteralSpans",
                )
            ):
                _fail("inconsistent_coverage_counts")
            if values["goldNonspaceCodepoints"] != sum(
                values[key]
                for key in (
                    "opaqueNonspaceCodepoints",
                    "generalizedNonspaceCodepoints",
                    "literalNonspaceCodepoints",
                )
            ):
                _fail("inconsistent_coverage_counts")
            if (
                row["nerCounts"][label]["tp"] + row["nerCounts"][label]["fn"] != values["goldSpans"]
                or row["combinedCounts"][label]["tp"] + row["combinedCounts"][label]["fn"] != values["goldSpans"]
                or row["combinedCounts"][label]["tp"]
                != row["nerCounts"][label]["tp"]
                - values["exactGoldLostAfterMerge"]
                + values["exactGoldGainedAfterMerge"]
                or values["goldStringsPresentInOutputNonOriginSpecific"] > values["goldSpans"]
            ):
                _fail("inconsistent_diagnostic_counts")
        outside_gold["firstStageNonspace"] += _checked_nonnegative_int(
            outside["firstStageNonspace"]
        )

        outside_gold["finalOpaqueNonspace"] += _checked_nonnegative_int(outside["finalOpaqueNonspace"])
        target_negative = _checked_nonnegative_int(row["targetNegative"])
        target_negative_false_positive = _checked_nonnegative_int(row["targetNegativeFalsePositive"])
        if target_negative not in (0, 1) or target_negative_false_positive not in (0, 1):
            _fail("invalid_diagnostic_row")
        expected_target_negative = int(sum(row["coverage"][label]["goldSpans"] for label in LABELS) == 0)
        expected_negative_fp = int(
            expected_target_negative
            and any(
                row["combinedCounts"][label]["tp"] + row["combinedCounts"][label]["fp"]
                for label in LABELS
            )
        )
        if target_negative != expected_target_negative or target_negative_false_positive != expected_negative_fp:
            _fail("inconsistent_diagnostic_counts")
        target_negative_rows += target_negative
        target_negative_false_positive_rows += target_negative_false_positive

    arms: dict[str, dict[str, Any]] = {}
    for name, counts in (("ner", ner_counts), ("mergedNameAddress", combined_counts)):
        metrics = point_metrics(counts)
        bounds = wilson_metrics(counts)
        arms[name] = {
            "counts": counts,
            "pointMetrics": metrics,
            "wilson95": bounds,
            "numericGatePassed": int(measurement_passes("release", counts, metrics, bounds)),
        }
    return {
        "rowCount": len(rows),
        "arms": arms,
        "coverage": coverage,
        "outsideGold": outside_gold,
        "targetNegativeRows": target_negative_rows,
        "targetNegativeFalsePositiveRows": target_negative_false_positive_rows,
    }


def self_check() -> None:
    """Exercise hand-computed provenance, merge, negative-row, and Unicode cases."""
    def item(text: str, *, person: list[str] | None = None, address: list[str] | None = None) -> dict[str, Any]:
        return {"id": "synthetic", "text": text, "person": person or [], "address": address or []}

    def trace(
        text: str,
        output: str,
        spans: tuple[tuple[str, int, int], ...],
        *,
        opaque: Sequence[int] = (),
        generalized: Sequence[int] = (),
        report_counts: dict[str, int] | None = None,
    ) -> dict[str, Any]:
        opaque_set = frozenset(opaque)
        generalized_set = frozenset(generalized)
        if report_counts is None:
            report_counts = {}
            for label, _, _ in spans:
                token = PERSON_TOKEN if label == PERSON_LABEL else ADDRESS_TOKEN
                report_counts[token] = report_counts.get(token, 0) + 1
        return {
            "output": output,
            "spans": spans,
            "opaque_indices": opaque_set,
            "generalized_indices": generalized_set,
            "literal_indices": frozenset(range(len(text))) - opaque_set - generalized_set,
            "report_counts": report_counts,
        }

    def expect_error(code: str, call: Callable[[], Any]) -> None:
        try:
            call()
        except ValueError as error:
            assert str(error) == code
        else:
            raise AssertionError(f"expected sanitized error: {code}")

    exact_item = item("김민수 방문", person=["김민수"])
    exact_trace = trace(
        exact_item["text"],
        "[인명] 방문",
        ((PERSON_LABEL, 0, 3),),
        opaque=range(3),
    )
    exact = measure_row(exact_item, ((PERSON_LABEL, 0, 3),), exact_trace)
    assert exact["nerCounts"][PERSON_LABEL] == {"tp": 1, "fp": 0, "fn": 0}
    assert exact["combinedCounts"][PERSON_LABEL] == {"tp": 1, "fp": 0, "fn": 0}
    assert exact["coverage"][PERSON_LABEL] == {
        "goldSpans": 1,
        "goldNonspaceCodepoints": 3,
        "opaqueNonspaceCodepoints": 3,
        "generalizedNonspaceCodepoints": 0,
        "literalNonspaceCodepoints": 0,
        "fullyOpaqueSpans": 1,
        "generalizedNoLiteralSpans": 0,
        "partiallyLiteralSpans": 0,
        "fullyLiteralSpans": 0,
        "exactGoldLostAfterMerge": 0,
        "exactGoldGainedAfterMerge": 0,
        "goldStringsPresentInOutputNonOriginSpecific": 0,
    }

    wrong_label_item = item("김민수", person=["김민수"])
    wrong_label = measure_row(
        wrong_label_item,
        ((ADDRESS_LABEL, 0, 3),),
        trace(wrong_label_item["text"], "[주소]", ((ADDRESS_LABEL, 0, 3),), opaque=range(3)),
    )
    assert wrong_label["combinedCounts"][PERSON_LABEL] == {"tp": 0, "fp": 0, "fn": 1}
    assert wrong_label["combinedCounts"][ADDRESS_LABEL] == {"tp": 0, "fp": 1, "fn": 0}
    assert wrong_label["coverage"][PERSON_LABEL]["fullyOpaqueSpans"] == 1

    fragmented_item = item("가나다", person=["가나다"])
    fragmented = measure_row(
        fragmented_item,
        ((PERSON_LABEL, 0, 1), (PERSON_LABEL, 2, 3)),
        trace(
            fragmented_item["text"],
            "[인명]나[인명]",
            ((PERSON_LABEL, 0, 1), (PERSON_LABEL, 2, 3)),
            opaque=(0, 2),
        ),
    )
    assert fragmented["coverage"][PERSON_LABEL]["opaqueNonspaceCodepoints"] == 2
    assert fragmented["coverage"][PERSON_LABEL]["literalNonspaceCodepoints"] == 1
    assert fragmented["coverage"][PERSON_LABEL]["partiallyLiteralSpans"] == 1

    partial_item = item("박하늘", person=["박하늘"])
    partial = measure_row(
        partial_item,
        ((PERSON_LABEL, 0, 1),),
        trace(partial_item["text"], "[인명]하늘", ((PERSON_LABEL, 0, 1),), opaque=(0,)),
    )
    assert partial["coverage"][PERSON_LABEL]["literalNonspaceCodepoints"] == 2
    assert partial["coverage"][PERSON_LABEL]["partiallyLiteralSpans"] == 1

    literal_item = item("이서준", person=["이서준"])
    fully_literal = measure_row(
        literal_item,
        (),
        trace(literal_item["text"], "이서준", ()),
    )
    assert fully_literal["coverage"][PERSON_LABEL]["fullyLiteralSpans"] == 1
    assert fully_literal["coverage"][PERSON_LABEL]["literalNonspaceCodepoints"] == 3

    generalized_item = item("서울특별시", address=["서울특별시"])
    generalized_only = measure_row(
        generalized_item,
        (),
        trace(generalized_item["text"], "서울", (), generalized=range(5)),
    )
    assert generalized_only["coverage"][ADDRESS_LABEL]["generalizedNoLiteralSpans"] == 1
    assert generalized_only["coverage"][ADDRESS_LABEL]["generalizedNonspaceCodepoints"] == 5
    assert generalized_only["coverage"][ADDRESS_LABEL]["goldStringsPresentInOutputNonOriginSpecific"] == 0

    unicode_item = item("🙂김 민", person=["김 민"])
    unicode_row = measure_row(
        unicode_item,
        ((PERSON_LABEL, 1, 4),),
        trace(unicode_item["text"], "🙂[인명]", ((PERSON_LABEL, 1, 4),), opaque=(1, 2, 3)),
    )
    assert unicode_row["coverage"][PERSON_LABEL]["goldNonspaceCodepoints"] == 2
    assert unicode_row["coverage"][PERSON_LABEL]["opaqueNonspaceCodepoints"] == 2
    assert unicode_row["nerCounts"][PERSON_LABEL]["tp"] == 1

    negative_item = item("상담사 010-1234-5678")
    negative = measure_row(
        negative_item,
        ((PERSON_LABEL, 0, 3),),
        trace(
            negative_item["text"],
            "[인명] [전화번호]",
            ((PERSON_LABEL, 0, 3),),
            opaque=(*range(3), *range(4, 17)),
            report_counts={PERSON_TOKEN: 1, "[전화번호]": 1},
        ),
    )
    assert negative["targetNegative"] == 1
    assert negative["targetNegativeFalsePositive"] == 1
    assert negative["outsideGold"] == {
        "firstStageNonspace": 3,
        "finalOpaqueNonspace": 16,
    }

    reappearance_item = item("서울특별시", address=["서울"])
    reappearance = measure_row(
        reappearance_item,
        (),
        trace(reappearance_item["text"], "서울", (), generalized=range(5)),
    )
    assert reappearance["coverage"][ADDRESS_LABEL]["literalNonspaceCodepoints"] == 0
    assert reappearance["coverage"][ADDRESS_LABEL]["goldStringsPresentInOutputNonOriginSpecific"] == 1

    lost_item = item("가나다", person=["가나"])
    lost = measure_row(
        lost_item,
        ((PERSON_LABEL, 0, 2),),
        trace(lost_item["text"], "[인명]", ((PERSON_LABEL, 0, 3),), opaque=range(3)),
    )
    assert lost["coverage"][PERSON_LABEL]["exactGoldLostAfterMerge"] == 1
    assert lost["coverage"][PERSON_LABEL]["exactGoldGainedAfterMerge"] == 0

    gained_item = item("가나다", address=["가나다"])
    gained = measure_row(
        gained_item,
        ((ADDRESS_LABEL, 0, 2), (ADDRESS_LABEL, 1, 3)),
        trace(gained_item["text"], "[주소]", ((ADDRESS_LABEL, 0, 3),), opaque=range(3)),
    )
    assert gained["coverage"][ADDRESS_LABEL]["exactGoldLostAfterMerge"] == 0
    assert gained["coverage"][ADDRESS_LABEL]["exactGoldGainedAfterMerge"] == 1

    summary = summarize_rows((exact, wrong_label))
    expected_counts = {
        PERSON_LABEL: {"tp": 1, "fp": 0, "fn": 1},
        ADDRESS_LABEL: {"tp": 0, "fp": 1, "fn": 0},
    }
    assert summary["rowCount"] == 2
    assert summary["arms"]["ner"]["counts"] == expected_counts
    assert summary["arms"]["mergedNameAddress"]["counts"] == expected_counts
    assert summary["arms"]["ner"]["pointMetrics"] == {
        "personPrecision": 1.0,
        "personRecall": 0.5,
        "addressPrecision": 0.0,
        "addressRecall": None,
        "overgeneralizationRate": 0.5,
    }
    assert summary["arms"]["ner"]["wilson95"] == wilson_metrics(expected_counts)
    assert summary["arms"]["ner"]["numericGatePassed"] == 0
    assert summary["targetNegativeRows"] == 0
    assert summary["targetNegativeFalsePositiveRows"] == 0

    def assert_numeric_rows(value: Any) -> None:
        if isinstance(value, dict):
            for child in value.values():
                assert_numeric_rows(child)
        else:
            assert isinstance(value, int) and not isinstance(value, bool)

    for row in (
        exact,
        wrong_label,
        fragmented,
        partial,
        fully_literal,
        generalized_only,
        unicode_row,
        negative,
        reappearance,
        lost,
        gained,
    ):
        assert_numeric_rows(row)

    missing_partition = dict(exact_trace)
    missing_partition["literal_indices"] = frozenset()
    expect_error(
        "invalid_trace_partition",
        lambda: measure_row(exact_item, ((PERSON_LABEL, 0, 3),), missing_partition),
    )
    bad_coordinates = dict(exact_trace)
    bad_coordinates["spans"] = ((PERSON_LABEL, 0, 99),)
    expect_error(
        "invalid_trace_coordinates",
        lambda: measure_row(exact_item, ((PERSON_LABEL, 0, 3),), bad_coordinates),
    )
    inconsistent_counts = dict(exact_trace)
    inconsistent_counts["report_counts"] = {PERSON_TOKEN: 2}
    expect_error(
        "inconsistent_trace_counts",
        lambda: measure_row(exact_item, ((PERSON_LABEL, 0, 3),), inconsistent_counts),
    )
    expect_error("missing_raw_predictions", lambda: measure_row(exact_item, None, exact_trace))  # type: ignore[arg-type]
