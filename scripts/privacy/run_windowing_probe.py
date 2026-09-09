#!/usr/bin/env python3
"""Measure the bounded NER windowing correction without qualification claims.

This runner is deliberately diagnostic.  It loads one fixed, offline model,
feeds each row through ``masking.recognize_ner_tokens`` once, and records only
aggregate metrics, hashes, timings, and counts.  It does not run the full
masking observer: that harness monkey-patches several product layers and is
not a safe measurement dependency for this correction.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import statistics
import sys
import time
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_SCRIPT_DIR = Path(__file__).resolve().parent
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

MODEL_ID = "FrameByFrame/korean-pii-e5-base"
MODEL_REVISION = "a308c54b4407819624a5661e31e162a269f39818"
PERSON_LABEL = "PRIVATE_PERSON"
ADDRESS_LABEL = "PRIVATE_ADDRESS"
LABELS = (PERSON_LABEL, ADDRESS_LABEL)
THREADS = 2
EXPECTED_TORCH_VERSION = "2.8.0"
EXPECTED_TRANSFORMERS_VERSION = "4.53.3"
MAX_TEXT_CODEPOINTS = 24_000
MAX_SHORT_TOKENS = 512
EXPECTED_HEALTH_HASH = "35565215b87909aad5a44c3124a7240ea80151136c9a12846fde05b861b7be59"
EXPECTED_RELEASE_HASH = "8fe927f79ad4e84d6ed1440b069e099e15c50618226c6727781e73f00ee321f4"
PIPELINE_VERSION = "ner-mask-v5"
WINDOW_POLICY = "bounded-24000-codepoint-512-token-overlap128-maxcontext-earlier-tie-v1"
EXPECTED_SOURCE_HASHES = {
    "scripts/privacy/fixtures/s6-ner-health-ko-conversation-v2.json": "d39a4ce278316623bc046f9332e86e99e78f6f75d534e8390e359f375f116592",
    "scripts/privacy/fixtures/s6-release-ko-v1.json": "6e3cb9a53b07926d86a3ea701288e2b73553e07ab4433b91d12a2aee174d0ba1",
    "artifacts/ccc237-privacy/ner-comparison/development.json": "26f8a31d72221b237051d88b368a837766f4c837abf751873fae7b466eb245d2",
    "artifacts/ccc237-privacy/ner-comparison/heldout.json": "9c3c2518b9814344dab6c477cfe7117d61e195d4fa47285b12bd00d3d81b6730",
    "artifacts/ccc237-privacy/full-masking/long-probes.json": "1f427c9e14eedbb5195d6052cde004a4ba58cb57a666674380c04c6a9b21a542",
}


class ProbeError(ValueError):
    """Sanitized runner failure; never carries source or exception text."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass
class _Trace:
    forward_count: int = 0
    forward_seconds: float = 0.0
    window_sizes: list[int] = field(default_factory=list)
    preprocess_windows: int = 0
    covered_indices: set[int] = field(default_factory=set)
    source_text: str = ""
    expected_windows: list[tuple] = field(default_factory=list)

    def reset(self, text: str) -> None:
        self.forward_count = 0
        self.forward_seconds = 0.0
        self.window_sizes.clear()
        self.preprocess_windows = 0
        self.covered_indices.clear()
        self.source_text = text
        self.expected_windows.clear()


@dataclass(frozen=True)
class _Dataset:
    name: str
    kind: str
    path: Path
    payload: tuple[dict[str, Any], ...]
    source_hash: str
    corpus_hash: str
    gold_hash: str


def _canonical(value: Any) -> str:
    # Imported lazily so validation-only argument failures do not import ML.
    from qualify_ner import canonical_sha256

    return canonical_sha256(value)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    except (OSError, UnicodeError):
        raise ProbeError("corpus_read_failed") from None
    return digest.hexdigest()


def _load_json(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as source:
            return json.load(source)
    except (OSError, UnicodeError, json.JSONDecodeError):
        raise ProbeError("corpus_read_failed") from None


def _gold_hash(payload: Sequence[dict[str, Any]]) -> str:
    return _canonical([
        {"id": item["id"], "person": item["person"], "address": item["address"]}
        for item in payload
    ])


def _load_dataset(root: Path, name: str, kind: str, relative: str, expected: str | None) -> _Dataset:
    path = root / relative
    source_hash = _sha256(path)
    if source_hash != EXPECTED_SOURCE_HASHES.get(relative):
        raise ProbeError("frozen_source_hash_mismatch")
    payload = _load_json(path)
    if not isinstance(payload, list) or not payload:
        raise ProbeError("corpus_invalid")
    corpus_hash = _canonical(payload)
    if expected is not None and corpus_hash != expected:
        raise ProbeError("corpus_hash_mismatch")
    try:
        import qualify_ner as q

        q.validate_corpus(payload, kind, corpus_hash)
    except ProbeError:
        raise
    except Exception as error:
        # QualificationError has a stable sanitized code; all other schema
        # failures are collapsed so reports cannot leak parser details.
        code = getattr(error, "code", None)
        raise ProbeError(code if isinstance(code, str) else "corpus_invalid") from None
    frozen = tuple(payload)
    return _Dataset(name, kind, path, frozen, source_hash, corpus_hash, _gold_hash(frozen))


def _load_long_dataset(root: Path) -> _Dataset:
    relative = "artifacts/ccc237-privacy/full-masking/long-probes.json"
    path = root / relative
    source_hash = _sha256(path)
    if source_hash != EXPECTED_SOURCE_HASHES.get(relative):
        raise ProbeError("frozen_source_hash_mismatch")
    payload = _load_json(path)
    if not isinstance(payload, list) or len(payload) != 11:
        raise ProbeError("long_probe_count_invalid")
    import qualify_ner as q

    rows: list[dict[str, Any]] = []
    for index, item in enumerate(payload):
        if q._row_errors(item, index, "release")["status"] != "validated":
            raise ProbeError("long_probe_invalid")
        rows.append(item)
    frozen = tuple(rows)
    return _Dataset("long-input-probes", "diagnostic", path, frozen, source_hash, _canonical(payload), _gold_hash(frozen))


def _datasets(root: Path) -> tuple[_Dataset, ...]:
    return (
        _load_dataset(root, "health-reference", "health", "scripts/privacy/fixtures/s6-ner-health-ko-conversation-v2.json", EXPECTED_HEALTH_HASH),
        _load_dataset(root, "original-release-reference", "release", "scripts/privacy/fixtures/s6-release-ko-v1.json", EXPECTED_RELEASE_HASH),
        _load_dataset(root, "previous-development-reference", "release", "artifacts/ccc237-privacy/ner-comparison/development.json", None),
        _load_dataset(root, "previous-heldout-reference", "release", "artifacts/ccc237-privacy/ner-comparison/heldout.json", None),
        _load_long_dataset(root),
    )


def _peak_rss_mib() -> float | None:
    """Return process peak RSS using platform-native standard facilities."""
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class _Counters(ctypes.Structure):
                _fields_ = [
                    ("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD),
                    ("PeakWorkingSetSize", ctypes.c_size_t), ("WorkingSetSize", ctypes.c_size_t),
                    ("QuotaPeakPagedPoolUsage", ctypes.c_size_t), ("QuotaPagedPoolUsage", ctypes.c_size_t),
                    ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t), ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                    ("PagefileUsage", ctypes.c_size_t), ("PeakPagefileUsage", ctypes.c_size_t),
                ]

            counters = _Counters()
            counters.cb = ctypes.sizeof(counters)
            kernel32 = ctypes.windll.kernel32
            kernel32.GetCurrentProcess.restype = wintypes.HANDLE
            handle = kernel32.GetCurrentProcess()
            get_info = ctypes.windll.psapi.GetProcessMemoryInfo
            get_info.argtypes = [wintypes.HANDLE, ctypes.POINTER(_Counters), wintypes.DWORD]
            get_info.restype = wintypes.BOOL
            ok = get_info(handle, ctypes.byref(counters), counters.cb)
            if ok:
                return counters.PeakWorkingSetSize / (1024 * 1024)
        except Exception:
            return None
        return None
    try:
        import resource

        value = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        divisor = 1024 * 1024 if platform.system() == "Darwin" else 1024
        return value / divisor
    except Exception:
        return None


def _shape(value: Any) -> tuple[int, ...] | None:
    shape = getattr(value, "shape", None)
    if shape is not None:
        try:
            return tuple(int(item) for item in shape)
        except (TypeError, ValueError):
            return None
    if isinstance(value, (list, tuple)):
        if not value:
            return (0,)
        child = _shape(value[0])
        return (len(value),) + (child or ())
    return None


def _tolist(value: Any) -> Any:
    try:
        return value.tolist()
    except AttributeError:
        return value


def _unwrap_batch(values: Any) -> Any:
    while (
        isinstance(values, list)
        and values
        and isinstance(values[0], list)
        and values[0]
        and isinstance(values[0][0], (list, tuple))
    ):
        values = values[0]
    return values


def _record_offsets(trace: _Trace, offsets: Any) -> None:
    values = _unwrap_batch(_tolist(offsets))
    if not isinstance(values, list):
        raise ProbeError("invalid_forward_offsets")
    for pair in values:
        if (not isinstance(pair, (list, tuple)) or len(pair) != 2
                or any(type(value) is not int for value in pair)):
            raise ProbeError("invalid_forward_offsets")
        start, end = pair
        if not 0 <= start <= end <= len(trace.source_text):
            raise ProbeError("invalid_forward_offsets")
        trace.covered_indices.update(range(start, end))


def _window_signature(model_inputs: Any) -> tuple:
    try:
        return (
            tuple(_tolist(model_inputs["input_ids"])[0]),
            tuple(tuple(pair) for pair in _tolist(model_inputs["offset_mapping"])[0]),
        )
    except Exception:
        raise ProbeError("invalid_window_signature") from None


class _InstrumentedPipeline:
    """Temporary instrumentation for the pipeline's direct preprocess/forward API."""

    def __init__(self, recognizer: Any, trace: _Trace) -> None:
        self.recognizer = recognizer
        self.trace = trace
        self._preprocess = getattr(recognizer, "preprocess", None)
        self._forward = getattr(recognizer, "forward", None)

    def __enter__(self) -> "_InstrumentedPipeline":
        trace = self.trace
        if self._preprocess is not None:
            original_preprocess = self._preprocess

            def preprocess(sentence: Any, *args: Any, **kwargs: Any) -> Iterator[Any]:
                for model_input in original_preprocess(sentence, *args, **kwargs):
                    trace.expected_windows.append(_window_signature(model_input))
                    trace.preprocess_windows += 1
                    yield model_input

            self.recognizer.preprocess = preprocess
        if self._forward is not None:
            original_forward = self._forward

            def forward(model_inputs: Any, *args: Any, **kwargs: Any) -> Any:
                input_ids = model_inputs.get("input_ids") if isinstance(model_inputs, dict) else model_inputs
                shape = _shape(input_ids)
                if not shape or len(shape) != 2 or shape[0] != 1 or not 0 < shape[1] <= 512:
                    raise ProbeError("invalid_forward_shape")
                if (trace.forward_count >= len(trace.expected_windows)
                        or _window_signature(model_inputs) != trace.expected_windows[trace.forward_count]):
                    raise ProbeError("forward_window_mismatch")
                offsets = model_inputs["offset_mapping"]
                trace.forward_count += 1
                trace.window_sizes.append(shape[1])
                started = time.perf_counter()
                try:
                    result = original_forward(model_inputs, *args, **kwargs)
                finally:
                    trace.forward_seconds += time.perf_counter() - started
                _record_offsets(trace, offsets)
                return result

            self.recognizer.forward = forward
        return self

    def __exit__(self, *_: Any) -> None:
        if self._preprocess is not None:
            self.recognizer.preprocess = self._preprocess
        if self._forward is not None:
            self.recognizer.forward = self._forward


def _token_count(tokenizer: Any, text: str) -> int:
    try:
        encoded = tokenizer(text, truncation=False, add_special_tokens=True)
        ids = encoded["input_ids"]
        return len(ids) if isinstance(ids, (list, tuple)) else int(ids.shape[-1])
    except Exception:
        raise ProbeError("tokenization_failed") from None


def _freeze_entities(entities: Any, text_length: int) -> tuple[tuple[str, int, int], ...]:
    import qualify_ner as q

    return q._freeze_prediction(entities, text_length)


def _infer_windowed(masking: Any, recognizer: Any, text: str) -> tuple[tuple[str, int, int], ...]:
    tokens = masking.recognize_ner_tokens(recognizer, text)
    entities = masking.decode_ner_entities(tokens, len(text))
    return _freeze_entities(entities, len(text))


def _infer_original(masking: Any, recognizer: Any, text: str) -> tuple[tuple[str, int, int], ...]:
    entities = masking.decode_ner_entities(recognizer(text), len(text))
    return _freeze_entities(entities, len(text))


def _counts(item: dict[str, Any], predictions: Sequence[tuple[str, int, int]]) -> dict[str, dict[str, int]]:
    import qualify_ner as q

    return q._score_row(item, predictions)


def _coverage(item: dict[str, Any], trace: _Trace) -> dict[str, Any]:
    import qualify_ner as q

    gold_indices = {
        index
        for field in ("person", "address")
        for start, end in q._gold_spans(item, field)
        for index in range(start, end)
        if not item["text"][index].isspace()
    }
    nonspace = {index for index, char in enumerate(item["text"]) if not char.isspace()}
    missing = nonspace - trace.covered_indices
    target_missing = gold_indices - trace.covered_indices
    return {
        "actualPreprocessWindows": trace.preprocess_windows,
        "actualForwardCount": trace.forward_count,
        "preprocessForwardWindowsMatch": trace.preprocess_windows == trace.forward_count,
        "inputWindowSizes": list(trace.window_sizes),
        "coveredNonspaceCodepoints": len(nonspace - missing),
        "unprocessedNonspaceCodepoints": len(missing),
        "targetNonspaceCodepoints": len(gold_indices),
        "targetNonspaceCodepointsNotFedToModel": len(target_missing),
        "targetCoverageComplete": not target_missing,
    }


def _metric_summary(counts: dict[str, dict[str, int]]) -> dict[str, Any]:
    import qualify_ner as q

    return {"counts": counts, "metrics": q.point_metrics(counts), "wilsonBounds": q.wilson_metrics(counts)}


def _empty_counts() -> dict[str, dict[str, int]]:
    return {label: {"tp": 0, "fp": 0, "fn": 0} for label in LABELS}


def _add_counts(total: dict[str, dict[str, int]], item: dict[str, dict[str, int]]) -> None:
    for label in LABELS:
        for key in ("tp", "fp", "fn"):
            total[label][key] += item[label][key]


def _load_model(root: Path) -> tuple[Any, Any, dict[str, Any]]:
    os.environ.update(
        HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1",
        HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false", OMP_NUM_THREADS=str(THREADS),
    )
    try:
        sys.path.insert(0, str(root / "apps/pipeline"))
        import torch
        from transformers import AutoTokenizer, pipeline
        from ccc_pipeline import masking
        from ccc_pipeline.model_registry import model_spec
        spec = model_spec(MODEL_ID)
        if spec.name != MODEL_ID or spec.revision != MODEL_REVISION:
            raise ProbeError("model_registry_mismatch")
        if (masking.NER_DECODER_VERSION != "bioes-v1"
                or masking.NER_AGGREGATION_STRATEGY != "none"):
            raise ProbeError("decoder_policy_mismatch")
        try:
            torch_version = importlib.metadata.version("torch")
            transformers_version = importlib.metadata.version("transformers")
        except importlib.metadata.PackageNotFoundError:
            raise ProbeError("runtime_version_unavailable") from None
        if (
            torch_version.split("+", 1)[0] != EXPECTED_TORCH_VERSION
            or transformers_version.split("+", 1)[0] != EXPECTED_TRANSFORMERS_VERSION
        ):
            raise ProbeError("runtime_version_mismatch")
        torch.set_num_threads(THREADS)
        torch.manual_seed(0)
        tokenizer = AutoTokenizer.from_pretrained(
            spec.name, revision=spec.revision, local_files_only=True,
            trust_remote_code=False, use_fast=True,
        )
        recognizer = pipeline(
            "token-classification", model=spec.name, revision=spec.revision,
            tokenizer=tokenizer, aggregation_strategy="none", ignore_labels=[],
            device="cpu", trust_remote_code=False,
            model_kwargs={"local_files_only": True, "use_safetensors": True},
        )
        masking._assert_labels_exist(recognizer, MODEL_ID, LABELS)
        model = getattr(recognizer, "model", None)
        return recognizer, masking, {
            "modelId": MODEL_ID, "modelRevision": MODEL_REVISION,
            "pipelineVersion": PIPELINE_VERSION, "windowPolicy": WINDOW_POLICY,
            "torch": torch_version, "transformers": transformers_version,
            "dtype": str(getattr(model, "dtype", "unknown")), "device": "cpu", "threads": THREADS,
            "aggregationStrategy": masking.NER_AGGREGATION_STRATEGY,
            "decoderPolicy": masking.NER_DECODER_VERSION, "offline": True,
        }
    except ProbeError:
        raise
    except Exception:
        raise ProbeError("model_load_failed") from None


def _stress(recognizer: Any, masking: Any, trace: _Trace) -> dict[str, Any]:
    unit = "기록을 함께 확인했다. "
    text = (unit * ((MAX_TEXT_CODEPOINTS + len(unit) - 1) // len(unit)))[:MAX_TEXT_CODEPOINTS]
    trace.reset(text)
    started = time.perf_counter()
    try:
        with _InstrumentedPipeline(recognizer, trace):
            _infer_windowed(masking, recognizer, text)
    except Exception:
        raise ProbeError("max_length_stress_failed") from None
    over_limit = False
    try:
        masking.recognize_ner_tokens(recognizer, "기" * (MAX_TEXT_CODEPOINTS + 1))
    except Exception as error:
        over_limit = type(error).__name__ == "MaskingConfigError" and "local_ner_unavailable" in str(error)
    if trace.forward_count <= 1:
        raise ProbeError("max_length_stress_not_windowed")
    coverage = _coverage({"text": text, "person": [], "address": []}, trace)
    if (coverage["unprocessedNonspaceCodepoints"] != 0
            or trace.forward_count != trace.preprocess_windows):
        raise ProbeError("max_length_stress_incomplete")
    return {
        "countedAsAccuracyEvidence": False, "maxCodepoints": len(text),
        "maxWithinLimitAccepted": True, "overLimitRejected": over_limit,
        "overLimitErrorCode": "local_ner_unavailable" if over_limit else None,
        "multipleForwardsObserved": True,
        "unprocessedNonspaceCodepoints": coverage["unprocessedNonspaceCodepoints"],
        "preprocessForwardWindowsMatch": trace.forward_count == trace.preprocess_windows,
        "elapsedSeconds": time.perf_counter() - started,
        "actualPreprocessWindows": trace.preprocess_windows,
        "actualForwardCount": trace.forward_count, "inputWindowSizes": list(trace.window_sizes),
    }

def _implementation_hashes(root: Path) -> dict[str, str]:
    return {
        "masking": _sha256(root / "apps/pipeline/ccc_pipeline/masking.py"),
        "qualifier": _sha256(root / "scripts/privacy/qualify_ner.py"),
        "runner": _sha256(root / "scripts/privacy/run_windowing_probe.py"),
    }


def _measure(root: Path, *, long_only: bool = False) -> dict[str, Any]:
    implementation_hashes = _implementation_hashes(root)
    datasets = (_load_long_dataset(root),) if long_only else _datasets(root)
    started_at = datetime.now(timezone.utc)
    load_started = time.perf_counter()
    recognizer, masking, model_meta = _load_model(root)
    load_seconds = time.perf_counter() - load_started
    tokenizer = getattr(recognizer, "tokenizer", None)
    if tokenizer is None:
        raise ProbeError("tokenizer_unavailable")
    trace = _Trace()
    corpus_reports: list[dict[str, Any]] = []
    comparison_total = {"eligibleRows": 0, "sameDecodedSpanRows": 0, "differentDecodedSpanRows": 0}
    all_window_seconds: list[float] = []
    all_forward_seconds = 0.0
    long_rows: list[dict[str, Any]] = []
    for dataset in datasets:
        total = _empty_counts()
        rows: list[dict[str, Any]] = []
        for item in dataset.payload:
            text = item["text"]
            input_tokens = _token_count(tokenizer, text)
            trace.reset(text)
            infer_started = time.perf_counter()
            try:
                with _InstrumentedPipeline(recognizer, trace):
                    predictions = _infer_windowed(masking, recognizer, text)
            except ProbeError:
                raise
            except Exception:
                raise ProbeError("prediction_failed") from None
            elapsed = time.perf_counter() - infer_started
            all_window_seconds.append(elapsed)
            all_forward_seconds += trace.forward_seconds
            item_counts = _counts(item, predictions)
            _add_counts(total, item_counts)
            row: dict[str, Any] = {"id": item["id"], "inputTokens": input_tokens, "counts": item_counts,
                                   "inferenceSeconds": elapsed, "modelForwardSeconds": trace.forward_seconds,
                                   **_coverage(item, trace)}
            if input_tokens <= MAX_SHORT_TOKENS:
                comparison_total["eligibleRows"] += 1
                comparison_trace = _Trace()
                comparison_trace.reset(text)
                try:
                    with _InstrumentedPipeline(recognizer, comparison_trace):
                        original = _infer_original(masking, recognizer, text)
                except Exception:
                    raise ProbeError("comparison_failed") from None
                same = predictions == original
                comparison_total["sameDecodedSpanRows"] += int(same)
                comparison_total["differentDecodedSpanRows"] += int(not same)
                row["originalSingleWindowComparison"] = {"eligible": True, "sameDecodedSpans": same,
                                                           "originalCounts": _counts(item, original),
                                                           "originalForwardCount": comparison_trace.forward_count,
                                                           "originalInputWindowSizes": list(comparison_trace.window_sizes)}
            else:
                row["originalSingleWindowComparison"] = {"eligible": False}
            if dataset.name == "long-input-probes":
                long_rows.append({"id": item["id"], "inputTokens": input_tokens,
                                  "counts": item_counts, **_coverage(item, trace)})
            rows.append(row)
        corpus_reports.append({"name": dataset.name, "kind": dataset.kind, "rowCount": len(rows),
                               "sourceFileHash": dataset.source_hash, "corpusHash": dataset.corpus_hash,
                               "goldHash": dataset.gold_hash, "nerQuality": _metric_summary(total),
                               "rows": rows})
    long_head = [row for row in long_rows if row["id"].startswith("long-head-")]
    long_tail = [row for row in long_rows if row["id"].startswith("long-tail-")]
    def name_outcome(rows: Sequence[dict[str, Any]]) -> dict[str, int]:
        positives = [row for row in rows if any(row["counts"][PERSON_LABEL][key] for key in ("tp", "fn"))]
        return {"positiveRows": len(positives), "rowsWithExactNameTp": sum(row["counts"][PERSON_LABEL]["tp"] > 0 for row in positives),
                "rowsWithCompleteTargetCoverage": sum(row["targetCoverageComplete"] for row in positives)}
    stress = _stress(recognizer, masking, trace)
    if _implementation_hashes(root) != implementation_hashes:
        raise ProbeError("implementation_changed")
    report = {
        "schemaVersion": 1, "status": "measured", "purpose": "CCC-237 bounded NER windowing measurement; diagnostic only",
        "measurementScope": "long-input-and-stress" if long_only else "full-frozen-corpus",
        "qualificationIssued": False, "releaseQualificationClaim": False, "wholeProcessZeroizationClaim": False,
        "startedAt": started_at.isoformat(), "finishedAt": datetime.now(timezone.utc).isoformat(),
        "implementationHashes": implementation_hashes,
        "corpora": corpus_reports,
        "model": model_meta, "runtime": {**model_meta, "modelLoads": 1, "loadSeconds": load_seconds,
            "platform": platform.platform(), "python": platform.python_version(),
            "measurementSeconds": time.perf_counter() - load_started,
            "windowInferenceSeconds": sum(all_window_seconds), "modelForwardSeconds": all_forward_seconds,
            "medianRowInferenceSeconds": statistics.median(all_window_seconds) if all_window_seconds else None,
            "peakRssMiB": _peak_rss_mib()},
        "windowContract": {"maxCodepoints": MAX_TEXT_CODEPOINTS, "maxTokensIncludingSpecials": 512,
                           "overlapContentTokens": 128, "maxWindows": 64, "batchSize": 1},
        "shortResultComparison": comparison_total,
        "windowProcessing": {
            "longRows": len(long_rows),
            "frontBackNameOutcomes": {"head": name_outcome(long_head), "tail": name_outcome(long_tail)},
            "literalResidualCounts": None,
            "literalResidualMeasurement": "not_measured_observer_not_reused",
            "observerHarness": "not_reused: observe_mask monkey-patches product layers; this CLI records token coverage and exact NER spans only",
            "completeLongInputTokenCoverage": all(
                row["targetCoverageComplete"] and row["unprocessedNonspaceCodepoints"] == 0
                and row["preprocessForwardWindowsMatch"]
                for row in long_rows
            ),
            "longRowsWithCompleteTargetCoverage": sum(row["targetCoverageComplete"] for row in long_rows),
            "longRowsWithCompleteTokenCoverage": sum(
                row["targetCoverageComplete"] and row["unprocessedNonspaceCodepoints"] == 0
                and row["preprocessForwardWindowsMatch"]
                for row in long_rows
            ),
            "longInputRows": long_rows,
        },
        "stress": stress,
        "knownNerQualityFailures": "NER exact-span counts and metrics are reported separately; failures are not attributed to window processing",
    }
    report["reportHash"] = _canonical({key: value for key, value in report.items() if key != "reportHash"})
    return report


def _parse_args(argv: Sequence[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, required=True, help="repository root containing apps/pipeline and frozen corpora")
    parser.add_argument("--output", type=Path, required=True, help="new JSON output path; existing files are never replaced")
    parser.add_argument("--long-only", action="store_true", help="remeasure the frozen 11 long inputs and 24,000-codepoint stress only")
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    try:
        args = _parse_args(argv)
    except SystemExit:
        return 1
    if args.output.exists():
        print(json.dumps({"status": "error", "errorCode": "output_exists"}, sort_keys=True), file=sys.stderr)
        return 1
    report: dict[str, Any]
    try:
        root = args.root.resolve(strict=True)
        if not root.is_dir():
            raise ProbeError("invalid_root")
        report = _measure(root, long_only=args.long_only)
    except ProbeError as error:
        report = {"schemaVersion": 1, "status": "error", "errorCode": error.code,
                  "qualificationIssued": False, "releaseQualificationClaim": False}
    except Exception:
        report = {"schemaVersion": 1, "status": "error", "errorCode": "measurement_failed",
                  "qualificationIssued": False, "releaseQualificationClaim": False}
    try:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("x", encoding="utf-8") as destination:
            json.dump(report, destination, ensure_ascii=True, sort_keys=True, indent=2, allow_nan=False)
            destination.write("\n")
    except FileExistsError:
        print(json.dumps({"status": "error", "errorCode": "output_exists"}, sort_keys=True), file=sys.stderr)
        return 1
    except (OSError, TypeError, ValueError):
        print(json.dumps({"status": "error", "errorCode": "output_write_failed"}, sort_keys=True), file=sys.stderr)
        return 1
    print(json.dumps({"status": report["status"], "errorCode": report.get("errorCode"),
                      "reportHash": report.get("reportHash")}, sort_keys=True),
          file=sys.stdout if report["status"] == "measured" else sys.stderr)
    return 0 if report["status"] == "measured" else 1


if __name__ == "__main__":
    raise SystemExit(main())
