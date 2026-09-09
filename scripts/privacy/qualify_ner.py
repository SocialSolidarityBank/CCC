#!/usr/bin/env python3
"""Hash-locked S6 NER health and release qualification runner.

The corpus hash is SHA-256 over canonical JSON (sorted keys, compact UTF-8).
A health ``resultHash`` hashes only S6's canonical five point metrics. A
release ``resultHash`` hashes its aggregate counts, five point metrics, and
Wilson bounds. ``reportHash`` hashes the complete report except the
``reportHash`` field itself, so it can be independently reproduced. Output is
created with exclusive mode and is never overwritten.

Validation-only mode parses, validates, and hash-locks the corpus without
importing or loading torch, transformers, the model registry, or masking. A
passing measurement may contain an attestation or receipt *candidate*; this
program never registers, enables, or claims issuance of either artifact.
Reports never contain corpus text, gold strings, predicted entity strings, or
spans.
"""

from __future__ import annotations

import argparse
import importlib.metadata
import json
import math
import operator
import os
import platform
import re
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Sequence

MODEL_ID = "FrameByFrame/korean-pii-e5-base"
MODEL_REVISION = "a308c54b4407819624a5661e31e162a269f39818"
PERSON_LABEL = "PRIVATE_PERSON"
ADDRESS_LABEL = "PRIVATE_ADDRESS"
LABELS = (PERSON_LABEL, ADDRESS_LABEL)
LABEL_SET_HASH = "b645305b068070375d95b18979ead77ec584833f6670dd82554605e9ccf4a4fc"
HEALTH_CORPUS_HASH = "35565215b87909aad5a44c3124a7240ea80151136c9a12846fde05b861b7be59"
HEALTH_METRICS_HASH = "fd02b5efd65f04f9814959875cefb76b1fa9596e34bd0441aa452be7224f1c72"
WILSON_Z = 1.959963984540054
THREADS = 2
PIPELINE_VERSION = "ner-mask-v5"
WINDOW_POLICY = "bounded-24000-codepoint-512-token-overlap128-maxcontext-earlier-tie-v1"
REQUIRED_TORCH_VERSION = "2.8.0"
REQUIRED_TRANSFORMERS_VERSION = "4.53.3"
_HASH_RE = re.compile(r"[0-9a-f]{64}")
_ROOT = Path(__file__).resolve().parents[2]
_PIPELINE_ROOT = _ROOT / "apps" / "pipeline"
sys.path.insert(0, str(_PIPELINE_ROOT))
from ccc_pipeline.results import canonical_sha256
# 평가기의 기대 계약이다. 실제 검사 때 런타임 선언과 대조한다.
AGGREGATION_STRATEGY = "none"
NER_DECODER_VERSION = "bioes-v1"

Counts = dict[str, dict[str, int]]
Prediction = tuple[str, int, int]


class QualificationError(ValueError):
    """A sanitized evaluator error safe to include in a report."""

    def __init__(
        self,
        code: str,
        *,
        rows: Sequence[dict[str, Any]] = (),
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(code)
        self.code = code
        self.rows = list(rows)
        self.details = dict(details or {})


@dataclass(frozen=True)
class ValidatedCorpus:
    items: tuple[dict[str, Any], ...]
    corpus_hash: str
    person_count: int
    address_count: int
    negative_count: int
    strata: tuple[str, ...]
    rows: tuple[dict[str, Any], ...]




def _safe_row_id(item: Any, index: int) -> str:
    if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"].strip():
        return item["id"]
    return f"row-{index + 1:06d}"


def _row_errors(item: Any, index: int, kind: str) -> dict[str, Any]:
    errors: set[str] = set()
    safe_id = _safe_row_id(item, index)
    if not isinstance(item, dict):
        return {"id": safe_id, "status": "invalid", "errorCodes": ["invalid_row_schema"]}

    expected_keys = {"id", "text", "person", "address"}
    if kind == "release":
        expected_keys.add("strata")
    if set(item) != expected_keys:
        errors.add("invalid_row_schema")

    identifier = item.get("id")
    text = item.get("text")
    if not isinstance(identifier, str) or not identifier.strip():
        errors.add("invalid_id")
    if not isinstance(text, str) or not text.strip():
        errors.add("invalid_text")

    spans: list[tuple[int, int]] = []
    for field in ("person", "address"):
        values = item.get(field)
        if not isinstance(values, list):
            errors.add(f"invalid_{field}_list")
            continue
        if any(not isinstance(value, str) or not value.strip() for value in values):
            errors.add(f"invalid_{field}_value")
            continue
        if len(values) != len(set(values)):
            errors.add("ambiguous_gold_substring")
        if isinstance(text, str):
            for value in values:
                start = text.find(value)
                if start < 0 or text.find(value, start + 1) >= 0:
                    errors.add("ambiguous_gold_substring")
                    continue
                spans.append((start, start + len(value)))

    if kind == "release":
        strata = item.get("strata")
        if (
            not isinstance(strata, list)
            or not strata
            or any(not isinstance(value, str) or not value.strip() for value in strata)
            or len(strata) != len(set(strata))
        ):
            errors.add("invalid_strata")

    ordered_spans = sorted(spans)
    if any(right_start < left_end for (_, left_end), (right_start, _) in zip(ordered_spans, ordered_spans[1:])):
        errors.add("overlapping_gold_spans")
    if errors:
        return {"id": safe_id, "status": "invalid", "errorCodes": sorted(errors)}
    return {"id": safe_id, "status": "validated"}


def validate_corpus(payload: Any, kind: str, expected_hash: str) -> ValidatedCorpus:
    """Validate schema, gold uniqueness, size gates, and the caller-pinned hash."""
    if kind not in ("health", "release"):
        raise QualificationError("invalid_kind")
    if not isinstance(expected_hash, str) or _HASH_RE.fullmatch(expected_hash) is None:
        raise QualificationError("invalid_expected_corpus_hash")
    if kind == "health" and expected_hash != HEALTH_CORPUS_HASH:
        raise QualificationError("unapproved_health_corpus_hash")
    if not isinstance(payload, list) or not payload:
        raise QualificationError("corpus_invalid")

    try:
        corpus_hash = canonical_sha256(payload)
    except (TypeError, ValueError):
        raise QualificationError("corpus_invalid") from None
    row_reports: list[dict[str, Any]] = []
    ids: dict[str, list[int]] = {}
    texts: dict[str, list[int]] = {}
    for index, item in enumerate(payload):
        row = _row_errors(item, index, kind)
        row_reports.append(row)
        if isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"].strip():
            ids.setdefault(item["id"], []).append(index)
        if isinstance(item, dict) and isinstance(item.get("text"), str) and item["text"].strip():
            texts.setdefault(item["text"], []).append(index)

    for code, duplicates in (("duplicate_id", ids), ("duplicate_text", texts)):
        for indexes in duplicates.values():
            if len(indexes) <= 1:
                continue
            for index in indexes:
                errors = set(row_reports[index].get("errorCodes", []))
                errors.add(code)
                row_reports[index] = {
                    "id": row_reports[index]["id"],
                    "status": "invalid",
                    "errorCodes": sorted(errors),
                }

    if any(row["status"] == "invalid" for row in row_reports):
        raise QualificationError(
            "corpus_invalid",
            rows=row_reports,
            details={"corpusHash": corpus_hash, "corpusCount": len(payload)},
        )

    if corpus_hash != expected_hash:
        raise QualificationError(
            "corpus_hash_mismatch",
            rows=row_reports,
            details={"corpusHash": corpus_hash, "corpusCount": len(payload)},
        )

    person_count = sum(len(item["person"]) for item in payload)
    address_count = sum(len(item["address"]) for item in payload)
    negative_count = sum(not item["person"] and not item["address"] for item in payload)
    strata = tuple(sorted({value for item in payload for value in item.get("strata", [])}))
    details = {
        "corpusHash": corpus_hash,
        "corpusCount": len(payload),
        "personGoldCount": person_count,
        "addressGoldCount": address_count,
        "negativeItemCount": negative_count,
        "strataCount": len(strata),
    }
    if kind == "health" and (len(payload), person_count, address_count) != (7, 4, 4):
        raise QualificationError("health_corpus_counts_invalid", rows=row_reports, details=details)
    if kind == "release" and (len(payload) < 500 or negative_count < 200 or not strata):
        raise QualificationError("release_corpus_counts_invalid", rows=row_reports, details=details)

    return ValidatedCorpus(
        items=tuple(payload),
        corpus_hash=corpus_hash,
        person_count=person_count,
        address_count=address_count,
        negative_count=negative_count,
        strata=strata,
        rows=tuple(row_reports),
    )


def _empty_counts() -> Counts:
    return {label: {"tp": 0, "fp": 0, "fn": 0} for label in LABELS}


def _gold_spans(item: dict[str, Any], field: str) -> set[tuple[int, int]]:
    text = item["text"]
    return {(text.index(value), text.index(value) + len(value)) for value in item[field]}


def _validate_prediction_row(
    predictions: Sequence[Prediction],
    text_length: int,
) -> tuple[Prediction, ...]:
    frozen: list[Prediction] = []
    seen: set[Prediction] = set()
    for prediction in predictions:
        if not isinstance(prediction, tuple) or len(prediction) != 3:
            raise QualificationError("invalid_prediction")
        label, start, end = prediction
        if (
            label not in LABELS
            or not isinstance(start, int)
            or isinstance(start, bool)
            or not isinstance(end, int)
            or isinstance(end, bool)
            or start < 0
            or start >= end
            or end > text_length
        ):
            raise QualificationError("invalid_prediction")
        if prediction in seen:
            raise QualificationError("duplicate_prediction")
        seen.add(prediction)
        frozen.append(prediction)
    return tuple(frozen)


def _score_row(item: dict[str, Any], predictions: Sequence[Prediction]) -> dict[str, dict[str, int]]:
    frozen = _validate_prediction_row(predictions, len(item["text"]))
    counts: dict[str, dict[str, int]] = {}
    for field, label in (("person", PERSON_LABEL), ("address", ADDRESS_LABEL)):
        gold = _gold_spans(item, field)
        actual = {(start, end) for predicted_label, start, end in frozen if predicted_label == label}
        counts[label] = {
            "tp": len(gold & actual),
            "fp": len(actual - gold),
            "fn": len(gold - actual),
        }
    return counts


def score_predictions(
    corpus: Sequence[dict[str, Any]],
    predictions: Sequence[Sequence[Prediction]],
) -> tuple[Counts, list[dict[str, Any]]]:
    """Score already-frozen predictions by exact label and code-point span."""
    if len(predictions) != len(corpus):
        raise QualificationError("prediction_count_mismatch")

    total = _empty_counts()
    rows: list[dict[str, Any]] = []
    for item, item_predictions in zip(corpus, predictions):
        item_counts = _score_row(item, item_predictions)
        for label in LABELS:
            for field in ("tp", "fp", "fn"):
                total[label][field] += item_counts[label][field]
        rows.append({"id": item["id"], "status": "measured", "counts": item_counts})
    return total, rows


def point_metrics(counts: Counts) -> dict[str, float | None]:
    metrics: dict[str, float | None] = {}
    for label, prefix in ((PERSON_LABEL, "person"), (ADDRESS_LABEL, "address")):
        values = counts[label]
        precision_total = values["tp"] + values["fp"]
        recall_total = values["tp"] + values["fn"]
        metrics[f"{prefix}Precision"] = values["tp"] / precision_total if precision_total else None
        metrics[f"{prefix}Recall"] = values["tp"] / recall_total if recall_total else None
    true_positives = sum(counts[label]["tp"] for label in LABELS)
    false_positives = sum(counts[label]["fp"] for label in LABELS)
    total_predictions = true_positives + false_positives
    metrics["overgeneralizationRate"] = false_positives / total_predictions if total_predictions else None
    return metrics


def wilson_interval(successes: int, total: int) -> tuple[float | None, float | None]:
    """Return the two-sided 95% Wilson interval using S6's pinned z value."""
    if total == 0:
        return None, None
    if successes < 0 or successes > total:
        raise QualificationError("invalid_wilson_counts")
    proportion = successes / total
    z_squared = WILSON_Z * WILSON_Z
    denominator = 1 + z_squared / total
    center = (proportion + z_squared / (2 * total)) / denominator
    margin = WILSON_Z * math.sqrt(
        (proportion * (1 - proportion) + z_squared / (4 * total)) / total,
    ) / denominator
    lower = max(0.0, center - margin)
    upper = min(1.0, center + margin)
    if successes == 0:
        lower = 0.0
    if successes == total:
        upper = 1.0
    return lower, upper


def wilson_metrics(counts: Counts) -> dict[str, float | None]:
    bounds: dict[str, float | None] = {}
    for label, prefix in ((PERSON_LABEL, "person"), (ADDRESS_LABEL, "address")):
        values = counts[label]
        precision_lower, _ = wilson_interval(values["tp"], values["tp"] + values["fp"])
        recall_lower, _ = wilson_interval(values["tp"], values["tp"] + values["fn"])
        bounds[f"{prefix}PrecisionLower"] = precision_lower
        bounds[f"{prefix}RecallLower"] = recall_lower
    true_positives = sum(counts[label]["tp"] for label in LABELS)
    false_positives = sum(counts[label]["fp"] for label in LABELS)
    _, overgeneralization_upper = wilson_interval(false_positives, true_positives + false_positives)
    bounds["overgeneralizationUpper"] = overgeneralization_upper
    return bounds


def measurement_passes(
    kind: str,
    counts: Counts,
    metrics: dict[str, float | None],
    bounds: dict[str, float | None],
) -> bool:
    if kind == "health":
        return all(counts[label] == {"tp": 4, "fp": 0, "fn": 0} for label in LABELS)
    if kind != "release":
        return False
    required = (
        bounds["personPrecisionLower"],
        bounds["personRecallLower"],
        bounds["addressPrecisionLower"],
        bounds["addressRecallLower"],
    )
    overgeneralization = bounds["overgeneralizationUpper"]
    return (
        all(value is not None and value >= 0.90 for value in required)
        and overgeneralization is not None
        and overgeneralization <= 0.05
        and all(value is not None for value in metrics.values())
    )


def _package_version(name: str) -> str | None:
    try:
        return importlib.metadata.version(name)
    except Exception:
        return None


def _runtime_metadata(*, model_loaded: bool) -> dict[str, Any]:
    return {
        "python": platform.python_version(),
        "torch": _package_version("torch"),
        "transformers": _package_version("transformers"),
        "device": "cpu",
        "threads": THREADS,
        "pipelineVersion": PIPELINE_VERSION,
        "windowPolicy": WINDOW_POLICY,
        "aggregationStrategy": AGGREGATION_STRATEGY,
        "decoderPolicy": NER_DECODER_VERSION,
        "offline": True,
        "modelLoaded": model_loaded,
    }


def _load_recognizer() -> Any:
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["HF_HUB_DISABLE_IMPLICIT_TOKEN"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    os.environ["OMP_NUM_THREADS"] = str(THREADS)

    try:
        import torch
        from transformers import pipeline

        from ccc_pipeline import masking
        from ccc_pipeline.model_registry import model_spec
        if (masking.NER_AGGREGATION_STRATEGY != AGGREGATION_STRATEGY
                or masking.NER_DECODER_VERSION != NER_DECODER_VERSION):
            raise QualificationError("decoder_policy_mismatch")
        spec = model_spec(MODEL_ID)
        if spec.name != MODEL_ID or spec.revision != MODEL_REVISION:
            raise QualificationError("model_registry_mismatch")
        torch_version = _package_version("torch")
        transformers_version = _package_version("transformers")
        if (
            torch_version is None
            or transformers_version is None
            or torch_version.split("+", 1)[0] != REQUIRED_TORCH_VERSION
            or transformers_version.split("+", 1)[0] != REQUIRED_TRANSFORMERS_VERSION
        ):
            raise QualificationError("runtime_version_mismatch")
        torch.set_num_threads(THREADS)
        torch.manual_seed(0)
        recognizer = pipeline(
            "token-classification",
            model=spec.name,
            revision=spec.revision,
            aggregation_strategy=AGGREGATION_STRATEGY,
            ignore_labels=[],
            device="cpu",
        )
        masking._assert_labels_exist(recognizer, spec.name, (PERSON_LABEL,))
        masking._assert_labels_exist(recognizer, spec.name, (ADDRESS_LABEL,))
        return lambda text: masking.decode_ner_entities(
            masking.recognize_ner_tokens(recognizer, text),
            len(text),
        )
    except QualificationError:
        raise
    except Exception:
        raise QualificationError("model_load_failed") from None


def _freeze_prediction(raw: Any, text_length: int) -> tuple[Prediction, ...]:
    if not isinstance(raw, (list, tuple)):
        raise QualificationError("invalid_prediction")
    predictions: list[Prediction] = []
    for entity in raw:
        if not isinstance(entity, dict):
            raise QualificationError("invalid_prediction")
        group = entity.get("entity_group")
        if not isinstance(group, str):
            continue
        normalized = group.upper()
        label = next((candidate for candidate in LABELS if normalized.startswith(candidate)), None)
        if label is None:
            continue
        try:
            start = operator.index(entity.get("start"))
            end = operator.index(entity.get("end"))
        except TypeError:
            raise QualificationError("invalid_prediction") from None
        predictions.append((label, start, end))
    return _validate_prediction_row(tuple(predictions), text_length)


def _predict_all(recognizer: Any, texts: Sequence[str]) -> tuple[list[tuple[Prediction, ...] | None], list[str | None]]:
    predictions: list[tuple[Prediction, ...] | None] = []
    errors: list[str | None] = []
    for text in texts:
        try:
            predictions.append(_freeze_prediction(recognizer(text), len(text)))
            errors.append(None)
        except QualificationError as error:
            predictions.append(None)
            errors.append(error.code)
        except Exception:
            predictions.append(None)
            errors.append("prediction_failed")
    return predictions, errors


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _timestamp(value: datetime) -> str:
    return value.isoformat().replace("+00:00", "Z")


def _base_report(kind: str, expected_hash: str | None) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "kind": kind,
        "modelId": MODEL_ID,
        "modelRevision": MODEL_REVISION,
        "labelSetHash": LABEL_SET_HASH,
        "pipelineVersion": PIPELINE_VERSION,
        "windowPolicy": WINDOW_POLICY,
        "expectedCorpusHash": expected_hash,
        "attestationIssued": False,
        "releaseReceiptIssued": False,
    }


def _corpus_summary(corpus: ValidatedCorpus) -> dict[str, Any]:
    return {
        "corpusHash": corpus.corpus_hash,
        "corpusCount": len(corpus.items),
        "personGoldCount": corpus.person_count,
        "addressGoldCount": corpus.address_count,
        "negativeItemCount": corpus.negative_count,
        "strataCount": len(corpus.strata),
    }


def validation_report(corpus: ValidatedCorpus, kind: str, expected_hash: str) -> dict[str, Any]:
    report = _base_report(kind, expected_hash)
    report.update(_corpus_summary(corpus))
    report.update({
        "status": "validated",
        "modelExecuted": False,
        "validatedAt": _timestamp(_now()),
        "runtime": _runtime_metadata(model_loaded=False),
        "rows": list(corpus.rows),
    })
    return report


def _candidate(kind: str, corpus_hash: str, result_hash: str, measured_at: datetime) -> dict[str, str]:
    common = {
        "modelId": MODEL_ID,
        "modelRevision": MODEL_REVISION,
        "labelSetHash": LABEL_SET_HASH,
        "pipelineVersion": PIPELINE_VERSION,
        "windowPolicy": WINDOW_POLICY,
        "corpusHash": corpus_hash,
        "resultHash": result_hash,
        "validatedAt": _timestamp(measured_at),
        "expiresAt": _timestamp(measured_at + timedelta(hours=24)),
        "status": "passed",
    }
    if kind == "health":
        return {"id": f"{PIPELINE_VERSION}-ner-attest-{corpus_hash[:16]}-{result_hash[:16]}", **common}
    return {"receiptId": f"{PIPELINE_VERSION}-ner-release-{corpus_hash[:16]}-{result_hash[:16]}", **common}


def measurement_report(
    corpus: ValidatedCorpus,
    kind: str,
    expected_hash: str,
    recognizer: Any,
) -> dict[str, Any]:
    measured_at = _now()
    report = _base_report(kind, expected_hash)
    report.update(_corpus_summary(corpus))
    report.update({
        "modelExecuted": True,
        "measuredAt": _timestamp(measured_at),
        "runtime": _runtime_metadata(model_loaded=True),
    })

    # Freeze the complete model output before consulting any item's gold spans.
    predictions, errors = _predict_all(recognizer, tuple(item["text"] for item in corpus.items))
    if any(error is not None for error in errors):
        rows: list[dict[str, Any]] = []
        measured_rows = 0
        for item, prediction, error in zip(corpus.items, predictions, errors):
            if error is None and prediction is not None:
                measured_rows += 1
                rows.append({"id": item["id"], "status": "measured", "counts": _score_row(item, prediction)})
            else:
                rows.append({"id": item["id"], "status": "error", "counts": None, "errorCode": error})
        report.update({
            "status": "incomplete",
            "measuredRowCount": measured_rows,
            "counts": None,
            "metrics": None,
            "rows": rows,
        })
        return report

    frozen = tuple(prediction for prediction in predictions if prediction is not None)
    counts, rows = score_predictions(corpus.items, frozen)
    metrics = point_metrics(counts)
    bounds = wilson_metrics(counts)
    passed = measurement_passes(kind, counts, metrics, bounds)
    result_material: dict[str, Any]
    if kind == "health":
        result_material = metrics
    else:
        result_material = {"counts": counts, "metrics": metrics, "wilsonBounds": bounds}
    try:
        result_hash = canonical_sha256(result_material)
    except (TypeError, ValueError):
        raise QualificationError("result_not_canonical") from None
    if passed and kind == "health" and result_hash != HEALTH_METRICS_HASH:
        raise QualificationError("health_result_hash_mismatch")

    report.update({
        "status": "passed" if passed else "failed",
        "counts": counts,
        "metrics": metrics,
        "resultHash": result_hash,
        "rows": rows,
    })
    if kind == "release":
        report["wilsonBounds"] = bounds
    if passed:
        key = "attestationCandidate" if kind == "health" else "receiptCandidate"
        report[key] = _candidate(kind, corpus.corpus_hash, result_hash, measured_at)
    return report


def error_report(
    kind: str,
    expected_hash: str,
    error: QualificationError,
    *,
    model_executed: bool = False,
) -> dict[str, Any]:
    safe_expected_hash = expected_hash if _HASH_RE.fullmatch(expected_hash) else None
    report = _base_report(kind, safe_expected_hash)
    report.update(error.details)
    report.update({
        "status": "error",
        "errorCode": error.code,
        "modelExecuted": model_executed,
        "createdAt": _timestamp(_now()),
        "runtime": _runtime_metadata(model_loaded=model_executed),
        "rows": error.rows,
    })
    return report


def write_new_report(path: Path, report: dict[str, Any]) -> dict[str, Any]:
    document = dict(report)
    document.pop("reportHash", None)
    try:
        document["reportHash"] = canonical_sha256(document)
    except (TypeError, ValueError):
        raise QualificationError("report_not_canonical") from None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("x", encoding="utf-8") as output:
            json.dump(document, output, ensure_ascii=True, sort_keys=True, indent=2, allow_nan=False)
            output.write("\n")
    except FileExistsError:
        raise QualificationError("output_exists") from None
    except (OSError, TypeError, ValueError):
        raise QualificationError("output_write_failed") from None
    return document


def _print_summary(report: dict[str, Any], *, stream: Any = sys.stdout) -> None:
    keys = (
        "status",
        "kind",
        "corpusHash",
        "corpusCount",
        "counts",
        "metrics",
        "wilsonBounds",
        "resultHash",
        "reportHash",
        "errorCode",
        "attestationIssued",
        "releaseReceiptIssued",
    )
    print(json.dumps({key: report[key] for key in keys if key in report}, sort_keys=True), file=stream)


class _SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        del message
        print('{"errorCode":"invalid_arguments","status":"error"}', file=sys.stderr)
        raise SystemExit(1)


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = _SafeArgumentParser(description=__doc__)
    parser.add_argument("--kind", choices=("health", "release"), required=True)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--expected-corpus-hash", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--validate-only", action="store_true")
    return parser.parse_args(argv)


def _read_corpus(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as source:
            return json.load(source)
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise QualificationError("corpus_read_failed") from None


def main(argv: Sequence[str] | None = None) -> int:
    args = _parse_args(argv)
    if args.output.exists():
        _print_summary({"status": "error", "errorCode": "output_exists"}, stream=sys.stderr)
        return 1

    try:
        payload = _read_corpus(args.corpus)
        corpus = validate_corpus(payload, args.kind, args.expected_corpus_hash)
    except QualificationError as error:
        try:
            report = write_new_report(
                args.output,
                error_report(args.kind, args.expected_corpus_hash, error),
            )
        except QualificationError as write_error:
            _print_summary({"status": "error", "errorCode": write_error.code}, stream=sys.stderr)
            return 1
        _print_summary(report, stream=sys.stderr)
        return 1

    if args.validate_only:
        try:
            report = write_new_report(
                args.output,
                validation_report(corpus, args.kind, args.expected_corpus_hash),
            )
        except QualificationError as error:
            _print_summary({"status": "error", "errorCode": error.code}, stream=sys.stderr)
            return 1
        _print_summary(report)
        return 0

    model_executed = False
    try:
        recognizer = _load_recognizer()
        model_executed = True
        report = measurement_report(corpus, args.kind, args.expected_corpus_hash, recognizer)
    except QualificationError as error:
        if not error.rows:
            error = QualificationError(
                error.code,
                rows=[
                    {"id": item["id"], "status": "error", "counts": None, "errorCode": error.code}
                    for item in corpus.items
                ],
                details=_corpus_summary(corpus),
            )
        try:
            report = write_new_report(
                args.output,
                error_report(
                    args.kind,
                    args.expected_corpus_hash,
                    error,
                    model_executed=model_executed,
                ),
            )
        except QualificationError as write_error:
            _print_summary({"status": "error", "errorCode": write_error.code}, stream=sys.stderr)
            return 1
        _print_summary(report, stream=sys.stderr)
        return 1

    try:
        report = write_new_report(args.output, report)
    except QualificationError as error:
        _print_summary({"status": "error", "errorCode": error.code}, stream=sys.stderr)
        return 1
    _print_summary(report, stream=sys.stdout if report["status"] == "passed" else sys.stderr)
    if report["status"] == "passed":
        return 0
    if report["status"] == "failed":
        return 2
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
