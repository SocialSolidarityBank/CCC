#!/usr/bin/env python3
"""Diagnostic only: self-check, prepare, measure. Never modifies production code."""
from __future__ import annotations

import hashlib
import json
import os
import platform
import resource
import statistics
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path[:0] = [str(HERE), str(ROOT / "apps/pipeline"), str(ROOT / "scripts/privacy")]
import qualify_ner as q
from ccc_pipeline import masking
from observe_mask import observe_mask, self_check as observer_check
from diagnostics import measure_row, summarize_rows, self_check as metrics_check


def load(path):
    return json.loads(Path(path).read_text())


def digest(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def checked(path):
    document = load(path)
    content = dict(document)
    expected = content.pop("reportHash")
    if q.canonical_sha256(content) != expected:
        raise ValueError("evidence_hash_mismatch")
    return document


def probes(design):
    health = load(ROOT / design["corpora"][0]["path"])
    filler = design["longInputProbes"]["filler"] * design["longInputProbes"]["repeatCount"]
    rows = []
    for item in health:
        if not item["person"] and not item["address"]:
            continue
        for location in ("head", "tail"):
            text = item["text"] + "\n" + filler if location == "head" else filler + "\n" + item["text"]
            rows.append({"id": f"long-{location}-{item['id']}", "text": text,
                         "person": list(item["person"]), "address": list(item["address"]),
                         "strata": ["diagnostic-long", location]})
    rows.append({"id": "long-negative", "text": filler, "person": [], "address": [],
                 "strata": ["diagnostic-long", "negative"]})
    for index, item in enumerate(rows):
        if q._row_errors(item, index, "release")["status"] != "validated":
            raise ValueError("invalid_probe")
    return rows


def prepare():
    design = load(HERE / "measurement-design.json")
    probe_rows = probes(design)
    probe_path = HERE / "long-probes.json"
    with probe_path.open("x") as output:
        json.dump(probe_rows, output, ensure_ascii=True, indent=2)
        output.write("\n")
    paths = [str(path.relative_to(ROOT)) for path in (HERE / "measurement-design.json",
             HERE / "run_baseline.py", HERE / "observe_mask.py", HERE / "diagnostics.py", probe_path)]
    paths += ["apps/pipeline/ccc_pipeline/" + name for name in
              ("masking.py", "worker.py", "condition_terms.py", "model_registry.py", "results.py")]
    paths += ["scripts/privacy/qualify_ner.py", "artifacts/ccc237-privacy/ner-comparison/weight-provenance.json"]
    corpus_records = []
    for source in design["corpora"]:
        path = ROOT / source["path"]
        payload = load(path)
        corpus_hash = q.canonical_sha256(payload)
        corpus = q.validate_corpus(payload, source["kind"], corpus_hash)
        corpus_records.append({**source, "corpusHash": corpus_hash, "rows": len(corpus.items)})
        paths.append(source["path"])
    controls = {
        "health-reference": "artifacts/ccc237-privacy/install-health-v2-bioes-v1.json",
        "original-release-reference": "artifacts/ccc237-privacy/release-qualification-v1-bioes-v1.json",
        "previous-development-reference": "artifacts/ccc237-privacy/ner-comparison/development-baseline.json",
        "previous-heldout-reference": "artifacts/ccc237-privacy/ner-comparison/heldout-baseline.json",
    }
    paths += list(controls.values())
    report = q.write_new_report(HERE / "freeze.json", {
        "schemaVersion": 1, "frozenAt": datetime.now(timezone.utc).isoformat(),
        "purpose": "Existing masking diagnostic, not new independent qualification",
        "fileHashes": {path: digest(ROOT / path) for path in paths},
        "corpora": corpus_records, "probeHash": q.canonical_sha256(probe_rows),
        "probeRows": len(probe_rows), "nerControls": controls,
        "productChanged": False, "qualificationIssued": False,
    })
    print(json.dumps({"status": "frozen", "corpora": len(corpus_records),
                      "probeRows": len(probe_rows), "reportHash": report["reportHash"]}))


def measure():
    destination = HERE / "measurement.json"
    if destination.exists():
        raise ValueError("output_exists")
    freeze = checked(HERE / "freeze.json")
    for path, expected in freeze["fileHashes"].items():
        if digest(ROOT / path) != expected:
            raise ValueError("frozen_file_changed")
    design = load(HERE / "measurement-design.json")
    datasets = [(source["name"], load(ROOT / source["path"])) for source in freeze["corpora"]]
    datasets.append(("long-input-probes", load(HERE / "long-probes.json")))
    if q.canonical_sha256(datasets[-1][1]) != freeze["probeHash"]:
        raise ValueError("probe_hash_mismatch")
    report = {"schemaVersion": 1, "purpose": design["purpose"], "freezeHash": freeze["reportHash"],
              "startedAt": datetime.now(timezone.utc).isoformat(), "model": design["model"],
              "productChanged": False, "qualificationIssued": False, "providerCalls": 0,
              "rawTextTokensOffsetsRetained": False, "scopeLimits": design["scopeLimits"]}
    durations, trace_durations, completed = [], [], []
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1",
                      HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false", OMP_NUM_THREADS="2")
    try:
        from huggingface_hub import snapshot_download
        snapshot = Path(snapshot_download(design["model"]["id"], revision=design["model"]["revision"],
                                          token=False, local_files_only=True))
        if snapshot.name != design["model"]["revision"]:
            raise ValueError("revision_mismatch")
        provenance = load(ROOT / "artifacts/ccc237-privacy/ner-comparison/weight-provenance.json")["baseline"]
        for filename, expected in provenance["files"].items():
            path = snapshot / filename
            if path.stat().st_size != expected["bytes"] or digest(path) != expected["sha256"]:
                raise ValueError("cached_model_bytes_changed")
        import torch
        from transformers import AutoTokenizer, pipeline
        torch.set_num_threads(2)
        torch.manual_seed(0)
        started = time.perf_counter()
        tokenizer = AutoTokenizer.from_pretrained(snapshot, local_files_only=True,
                                                  trust_remote_code=False, use_fast=True)
        recognizer = pipeline("token-classification", model=str(snapshot), tokenizer=tokenizer,
                              model_kwargs={"local_files_only": True, "use_safetensors": True},
                              trust_remote_code=False, aggregation_strategy="none", ignore_labels=[], device="cpu")
        masking._assert_labels_exist(recognizer, design["model"]["id"], q.LABELS)
        load_seconds = time.perf_counter() - started
        actual_token_indices = set()
        window_count = 0
        original_preprocess = recognizer.preprocess

        def capture_preprocess(sentence, **kwargs):
            nonlocal window_count
            for model_input in original_preprocess(sentence, **kwargs):
                window_count += 1
                for start, end in model_input["offset_mapping"][0].tolist():
                    actual_token_indices.update(range(start, end))
                yield model_input

        recognizer.preprocess = capture_preprocess
        context_limit = min(tokenizer.model_max_length, recognizer.model.config.max_position_embeddings)
        for corpus_name, items in datasets:
            frozen_rows = []
            for item in items:
                text = item["text"]
                input_tokens = len(tokenizer(text, truncation=False)["input_ids"])
                if corpus_name != "long-input-probes" and input_tokens > context_limit:
                    raise ValueError("reference_input_exceeds_context")
                actual_token_indices.clear()
                window_count = 0
                started = time.perf_counter()
                entities = masking.decode_ner_entities(recognizer(text), len(text))
                predictions = q._validate_prediction_row(tuple((entity["entity_group"], entity["start"], entity["end"])
                    for entity in entities if entity["entity_group"] in q.LABELS), len(text))
                durations.append(time.perf_counter() - started)
                started = time.perf_counter()
                trace = observe_mask(text, predictions)
                trace_durations.append(time.perf_counter() - started)
                frozen_rows.append((item, predictions, trace, frozenset(actual_token_indices), input_tokens, window_count))
            completed.append((corpus_name, frozen_rows))
        # All actual predictions and final outputs are frozen before reading gold for scores.
        results = []
        for corpus_name, frozen_rows in completed:
            rows = []
            for item, predictions, trace, token_indices, input_tokens, windows in frozen_rows:
                values = measure_row(item, predictions, trace)
                gold_indices = {index for field in ("person", "address") for start, end in q._gold_spans(item, field)
                                for index in range(start, end) if not item["text"][index].isspace()}
                rows.append({"id": item["id"], "diagnostics": values,
                    "inputTokens": input_tokens, "actualPreprocessWindows": windows,
                    "exceedsContext": input_tokens > context_limit,
                    "unprocessedNonspaceCodepoints": sum(not ch.isspace() and i not in token_indices for i, ch in enumerate(item["text"])),
                    "targetNonspaceCodepointsNotFedToModel": len(gold_indices - token_indices)})
            summary = summarize_rows([row["diagnostics"] for row in rows])
            control_path = freeze["nerControls"].get(corpus_name)
            control_equal = summary["arms"]["ner"]["counts"] == checked(ROOT / control_path)["counts"] if control_path else None
            if control_equal is False:
                raise ValueError("ner_control_count_mismatch")
            results.append({"name": corpus_name, "summary": summary, "rows": rows,
                            "sameNerCountsAsPriorReport": control_equal,
                            "maxInputTokens": max(row["inputTokens"] for row in rows)})
        for path, expected in freeze["fileHashes"].items():
            if digest(ROOT / path) != expected:
                raise ValueError("frozen_file_changed_during_measurement")
        report.update(status="measured", corpora=results, finishedAt=datetime.now(timezone.utc).isoformat(),
            runtime={**q._runtime_metadata(model_loaded=True), "contextLimit": context_limit,
                     "dtype": str(recognizer.model.dtype), "modelLoads": 1, "loadSeconds": load_seconds,
                     "inferenceSeconds": sum(durations), "observerSeconds": sum(trace_durations),
                     "medianInferenceSeconds": statistics.median(durations),
                     "peakRssMiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024 if platform.system() == "Darwin" else 1024),
                     "scope": "Single CPU run; observer overhead and cached real NER callbacks; not worker/Windows throughput"})
    except Exception as error:
        frames = traceback.extract_tb(error.__traceback__)
        report.update(status="incomplete", errorClass=type(error).__name__,
                      errorLocation={"file": Path(frames[-1].filename).name, "line": frames[-1].lineno} if frames else None,
                      completedCorpora=len(completed), measuredRows=len(durations))
    report = q.write_new_report(destination, report)
    print(json.dumps({"status": report["status"], "measuredRows": len(durations), "reportHash": report["reportHash"],
                      "qualificationIssued": False}))
    return 0 if report["status"] == "measured" else 2


def main():
    mode = sys.argv[1] if len(sys.argv) == 2 else None
    if mode == "self-check":
        observer_check()
        metrics_check()
        rows = probes(load(HERE / "measurement-design.json"))
        assert "torch" not in sys.modules
        print(json.dumps({"status": "self_checks_passed", "probeRows": len(rows), "modelLoaded": False}))
        return 0
    if mode == "prepare":
        prepare()
        return 0
    if mode == "measure":
        return measure()
    raise SystemExit("expected_self-check_prepare_or_measure")


if __name__ == "__main__":
    raise SystemExit(main())
