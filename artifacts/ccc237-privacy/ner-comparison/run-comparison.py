#!/usr/bin/env python3
"""Frozen synthetic comparison only. No product cutover or qualification issuance.

Usage: run-comparison.py baseline|alternative development|heldout NEW_OUTPUT.json
A freeze.json is required; heldout additionally requires a development selection.json.
Raw predictions exist only in this short-lived process, never in output artifacts.
"""
from __future__ import annotations

import hashlib
import json
import os
import platform
import resource
import statistics
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path[:0] = [str(ROOT / "apps/pipeline"), str(ROOT / "scripts/privacy")]
import qualify_ner as q
from ccc_pipeline.masking import decode_ner_entities, _assert_labels_exist
from ccc_pipeline.results import canonical_sha256


def checked_json(path):
    value = json.loads(path.read_text())
    expected = value.pop("reportHash")
    if canonical_sha256(value) != expected:
        raise ValueError("report_hash_mismatch")
    value["reportHash"] = expected
    return value


def main():
    if len(sys.argv) != 4:
        raise SystemExit("model_split_new_output_required")
    key, split, destination = sys.argv[1:]
    output = Path(destination)
    if key not in ("baseline", "alternative") or split not in ("development", "heldout") or output.exists():
        raise SystemExit("invalid_arguments_or_existing_output")
    freeze = checked_json(HERE / "freeze.json")
    for relative, expected in freeze["fileHashes"].items():
        if hashlib.sha256((ROOT / relative).read_bytes()).hexdigest() != expected:
            raise SystemExit("frozen_input_changed")
    registry = json.loads((HERE / "models.json").read_text())
    model_spec = registry["models"][key]
    selection_hash = None
    if split == "heldout":
        selection = checked_json(HERE / "selection.json")
        if selection["freezeHash"] != freeze["reportHash"]:
            raise SystemExit("selection_freeze_mismatch")
        if key != "baseline" and selection["selectedModel"] != model_spec:
            raise SystemExit("model_not_selected")
        for relative, expected in selection["developmentReportHashes"].items():
            if checked_json(ROOT / relative)["reportHash"] != expected:
                raise SystemExit("development_evidence_changed")
        selection_hash = selection["reportHash"]
    corpus = q.validate_corpus(json.loads((HERE / f"{split}.json").read_text()), "release",
                               freeze["corpora"][split]["corpusHash"])
    report = {"schemaVersion": 1, "purpose": "Synthetic candidate comparison, not release qualification",
              "measuredAt": datetime.now(timezone.utc).isoformat(), "modelKey": key,
              "model": model_spec, "split": split, "corpusHash": corpus.corpus_hash,
              "corpusCount": len(corpus.items), "freezeHash": freeze["reportHash"],
              "selectionHash": selection_hash, "productChanged": False,
              "qualificationIssued": False, "rawTextTokensOffsetsRetained": False}
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1",
                      HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false", OMP_NUM_THREADS="2")
    predictions, durations = [], []
    try:
        import torch
        from huggingface_hub import snapshot_download
        from transformers import AutoTokenizer, pipeline
        torch.set_num_threads(2)
        torch.manual_seed(0)
        snapshot = snapshot_download(model_spec["id"], revision=model_spec["revision"],
                                     token=False, local_files_only=True)
        if Path(snapshot).name != model_spec["revision"]:
            raise ValueError("model_revision_mismatch")
        started = time.perf_counter()
        tokenizer = AutoTokenizer.from_pretrained(snapshot, local_files_only=True,
                                                  trust_remote_code=False, use_fast=True)
        recognizer = pipeline(
            "token-classification", model=snapshot, tokenizer=tokenizer,
            model_kwargs={"local_files_only": True, "use_safetensors": True},
            trust_remote_code=False, aggregation_strategy="none", ignore_labels=[], device="cpu")
        model = recognizer.model
        _assert_labels_exist(recognizer, model_spec["id"], tuple(model_spec["labelMap"]))
        load_seconds = time.perf_counter() - started
        max_tokens = 0
        for item in corpus.items:
            text = item["text"]
            length = len(tokenizer(text, truncation=False)["input_ids"])
            max_tokens = max(length, max_tokens)
            if length > min(tokenizer.model_max_length, model.config.max_position_embeddings):
                raise ValueError("input_exceeds_context_without_truncation")
            started = time.perf_counter()
            raw = recognizer(text)
            entities = decode_ner_entities(raw, len(text))
            row = tuple((model_spec["labelMap"][e["entity_group"]], e["start"], e["end"])
                        for e in entities if e["entity_group"] in model_spec["labelMap"])
            predictions.append(q._validate_prediction_row(row, len(text)))
            durations.append(time.perf_counter() - started)
        # All predictions are frozen before exact gold scoring.
        counts, rows = q.score_predictions(corpus.items, predictions)
        metrics = q.point_metrics(counts)
        bounds = q.wilson_metrics(counts)
        report.update(status="measured", counts=counts, pointMetrics=metrics, wilson95=bounds,
                      numericGatePassed=q.measurement_passes("release", counts, metrics, bounds), rows=rows,
                      runtime={**q._runtime_metadata(model_loaded=True), "dtype": str(model.dtype),
                               "parameters": sum(p.numel() for p in model.parameters()),
                               "loadSeconds": load_seconds, "inferenceSeconds": sum(durations),
                               "medianItemSeconds": statistics.median(durations),
                               "p95ItemSeconds": statistics.quantiles(durations, n=100)[94],
                               "maxInputTokens": max_tokens,
                               "peakRssMiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (
                                   1024 * 1024 if platform.system() == "Darwin" else 1024),
                               "timingScope": "CPU tokenizer+model+decoder only; excludes dictionary, STT, network and workflow"})
    except Exception as error:
        # Do not serialize provider/library exception text or a partial score.
        report.update(status="runtime_failed", errorClass=type(error).__name__, measuredRows=len(predictions))
    report["reportHash"] = canonical_sha256(report)
    with output.open("x") as handle:
        json.dump(report, handle, ensure_ascii=True, sort_keys=True, indent=2)
        handle.write("\n")
    print(json.dumps({k: report[k] for k in ("modelKey", "split", "status", "reportHash")}))
    return 0 if report["status"] == "measured" else 2


if __name__ == "__main__":
    raise SystemExit(main())
