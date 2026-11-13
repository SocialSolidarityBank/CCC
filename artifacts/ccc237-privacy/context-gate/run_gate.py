"""Run a frozen synthetic diagnostic, never the CCC product pipeline."""
from __future__ import annotations

import gc
import hashlib
import json
import os
import resource
import statistics
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path[:0] = [str(HERE), str(ROOT / "apps/pipeline"), str(ROOT / "scripts/privacy")]
import gate_core as gate
import qualify_ner as q
from preflight import memory_state
from ccc_pipeline import masking


def load(path):
    return json.loads(Path(path).read_text())


def digest(path):
    with Path(path).open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def now():
    return datetime.now(timezone.utc).isoformat()


def check():
    gate.self_check()
    rows = gate.validate_corpus(load(HERE / "corpus.json"))
    return {"status": "passed", "corpusRows": len(rows),
            "negativeRows": sum(not row["gold"] for row in rows),
            "goldSpans": sum(len(row["gold"]) for row in rows),
            "scope": "synthetic structural checks only; no model quality measured"}


def freeze():
    checked = check()
    paths = [str((HERE / name).relative_to(ROOT)) for name in
             ("corpus.json", "prompts.json", "measurement-design.json", "gate_core.py", "preflight.py", "run_gate.py")]
    paths += ["artifacts/ccc237-privacy/full-masking/observe_mask.py",
              "artifacts/ccc237-privacy/ner-comparison/weight-provenance.json", "scripts/privacy/qualify_ner.py"]
    paths += ["apps/pipeline/ccc_pipeline/" + name for name in
              ("masking.py", "condition_terms.py", "model_registry.py", "results.py")]
    report = q.write_new_report(HERE / "freeze.json", {
        "frozenAt": now(), "fileHashes": {path: digest(ROOT / path) for path in paths},
        "checks": checked, "productChanged": False, "qualificationIssued": False})
    return {**checked, "status": "frozen", "reportHash": report["reportHash"]}


def checked_freeze():
    frozen = load(HERE / "freeze.json")
    body = dict(frozen)
    expected = body.pop("reportHash")
    if q.canonical_sha256(body) != expected:
        raise gate.GateError("freeze_hash_mismatch")
    for path, expected_hash in frozen["fileHashes"].items():
        if digest(ROOT / path) != expected_hash:
            raise gate.GateError("frozen_file_changed")
    return frozen


def baseline(rows, design, report):
    report["memoryBeforeNerLoad"] = memory_state()
    if not report["memoryBeforeNerLoad"]["modelLoadAllowed"]:
        raise gate.GateError("ner_load_blocked_memory_pressure")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1",
                      HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false", OMP_NUM_THREADS="2")
    from huggingface_hub import snapshot_download
    config = design["baseline"]
    snapshot = Path(snapshot_download(config["model"], revision=config["revision"], token=False, local_files_only=True))
    provenance = load(ROOT / "artifacts/ccc237-privacy/ner-comparison/weight-provenance.json")["baseline"]
    for name, expected in provenance["files"].items():
        path = snapshot / name
        if path.stat().st_size != expected["bytes"] or digest(path) != expected["sha256"]:
            raise gate.GateError("ner_weights_changed")
    import torch
    from transformers import AutoTokenizer, pipeline
    torch.set_num_threads(2)
    torch.manual_seed(0)
    started = time.perf_counter()
    tokenizer = AutoTokenizer.from_pretrained(snapshot, local_files_only=True, trust_remote_code=False, use_fast=True)
    recognizer = pipeline("token-classification", model=str(snapshot), tokenizer=tokenizer,
                          model_kwargs={"local_files_only": True, "use_safetensors": True},
                          trust_remote_code=False, aggregation_strategy="none", ignore_labels=[], device="cpu")
    masking._assert_labels_exist(recognizer, config["model"], q.LABELS)
    report["nerLoadSeconds"] = time.perf_counter() - started
    traces = []
    for row in rows:
        started = time.perf_counter()
        entities = masking.decode_ner_entities(recognizer(row["text"]), len(row["text"]))
        spans = tuple((e["entity_group"], e["start"], e["end"]) for e in entities if e["entity_group"] in q.LABELS)
        traces.append(gate.baseline_trace(row["text"], spans))
        report["baselineCases"].append({"id": row["id"], "seconds": time.perf_counter() - started,
                                         "inputTokens": len(tokenizer(row["text"])["input_ids"]),
                                         "modelMaxTokens": tokenizer.model_max_length})
    del recognizer, tokenizer
    gc.collect()
    return traces


def measure():
    destination = HERE / "measurement.json"
    if destination.exists():
        raise gate.GateError("output_exists")
    frozen = checked_freeze()
    rows = load(HERE / "corpus.json")
    prompts = load(HERE / "prompts.json")
    design = load(HERE / "measurement-design.json")
    config = design["localCandidate"]
    report = {"startedAt": now(), "freezeHash": frozen["reportHash"], "status": "running",
              "baselineCases": [], "calls": [], "cases": [], "localModel": config,
              "externalArm": design["externalArm"], "productChanged": False,
              "qualificationIssued": False, "rawTextTokensOffsetsRetained": False}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    model_id = None

    def call(row_id, stage, lines):
        started = time.perf_counter()
        metric = {"id": row_id, "stage": stage, "status": "started"}
        try:
            payload = {"model": model_id, "temperature": 0, "seed": 0, "max_tokens": config["maximumOutputTokens"],
                       "messages": [{"role": "system", "content": prompts[stage]},
                                    {"role": "user", "content": json.dumps({"lines": lines}, ensure_ascii=False)}],
                       "response_format": {"type": "json_schema", "json_schema": {
                           "name": stage, "strict": True,
                           "schema": prompts["editSchema" if stage == "masking" else "summarySchema"]}}}
            request = urllib.request.Request("http://127.0.0.1:18974/v1/chat/completions",
                data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"}, method="POST")
            with opener.open(request, timeout=config["perRequestTimeoutSeconds"]) as response:
                answer = json.load(response)
            choice = answer["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise gate.GateError("incomplete_model_output")
            result = json.loads(choice["message"]["content"])
            metric.update(status="response_received", inputTokens=answer.get("usage", {}).get("prompt_tokens"),
                          outputTokens=answer.get("usage", {}).get("completion_tokens"))
            return result
        except Exception as error:
            metric.update(status="failed", errorClass=type(error).__name__, code=getattr(error, "code", None))
            raise
        finally:
            metric["seconds"] = time.perf_counter() - started
            report["calls"].append(metric)

    try:
        traces = baseline(rows, design, report)
        # Models load sequentially. Main starts the supervised LLM only after this signal.
        print(json.dumps({"status": "baseline_ready", "cases": len(traces)}), flush=True)
        if sys.stdin.readline().strip() != "continue":
            raise gate.GateError("measurement_not_resumed")
        with opener.open("http://127.0.0.1:18974/health", timeout=10) as response:
            if json.load(response).get("status") != "ok":
                raise gate.GateError("local_model_not_ready")
        with opener.open("http://127.0.0.1:18974/v1/models", timeout=10) as response:
            model_id = json.load(response)["data"][0]["id"]
        if not model_id.endswith(config["file"]):
            raise gate.GateError("unexpected_local_model")
        outcomes = []
        for row, trace in zip(rows, traces, strict=True):
            started = time.perf_counter()
            extra = []
            result = {"id": row["id"], "status": "running", "maskingCompleted": False, "draftStaged": False}
            summary = None
            try:
                all_lines = gate.numbered_lines(trace["output"])
                for window in [*gate.chunks(all_lines), all_lines]:
                    edits = call(row["id"], "masking", window)
                    spans = gate.validate_edits(all_lines, edits)
                    if any(edit["lineId"] not in {line["lineId"] for line in window} for edit in edits["edits"]):
                        raise gate.GateError("edit_outside_requested_window")
                    extra.extend(spans)
                final_text = gate.apply_edits(trace["output"], extra)
                result["maskingCompleted"] = True
                summary = call(row["id"], "summary", gate.numbered_lines(final_text))
                staged = gate.stage_draft(final_text, summary)
                result.update(status="staged_unapproved", draftStaged=True, **staged)
            except Exception as error:
                result.update(status="rejected", errorClass=type(error).__name__, code=getattr(error, "code", None))
            result["seconds"] = time.perf_counter() - started
            outcomes.append((extra, summary, result))
            print(json.dumps({"id": row["id"], "status": result["status"]}), flush=True)
        # Freeze response-derived decisions before consulting gold labels for scoring.
        report["predictionsFrozenAt"] = now()
        report["predictionHash"] = q.canonical_sha256([
            {"id": row["id"], "edits": [list(span) for span in spans], "summary": summary, "result": result}
            for row, (spans, summary, result) in zip(rows, outcomes, strict=True)])
        for row, trace, (spans, summary, result) in zip(rows, traces, outcomes, strict=True):
            result["baseline"] = gate.score_case(row, trace, [])
            result["diagnosticPartialOrFinalMasking"] = gate.score_case(row, trace, spans)
            result["allGoldSpans"] = len(row["gold"])
            result["negative"] = not row["gold"]
            result["protectedStrings"] = len(row["preserve"])
            result["summaryExactGoldMatches"] = (sum(g["quote"] in summary["summary"] for g in row["gold"])
                if isinstance(summary, dict) and isinstance(summary.get("summary"), str) else None)
            report["cases"].append(result)
        seconds = sorted(call["seconds"] for call in report["calls"])
        report.update(status="measured", completedCases=len(report["cases"]),
                      callLatency={"medianSeconds": statistics.median(seconds), "maximumSeconds": max(seconds)})
    except Exception as error:
        report.update(status="blocked_or_failed", errorClass=type(error).__name__, code=getattr(error, "code", None))
    report.update(finishedAt=now(), runnerPeakRssBytes=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                  finalMemory=memory_state(), stagingScope="isolated SQLite diagnostic, not the CCC gateway")
    written = q.write_new_report(destination, report)
    return {"status": report["status"], "completedCases": len(report["cases"]), "reportHash": written["reportHash"]}


if __name__ == "__main__":
    try:
        action = {"check": check, "freeze": freeze, "measure": measure}[sys.argv[1]]
        result = action()
        print(json.dumps(result))
        sys.exit(0 if result["status"] not in ("blocked_or_failed",) else 2)
    except Exception as error:
        print(json.dumps({"status": "failed", "errorClass": type(error).__name__, "code": getattr(error, "code", None)}))
        sys.exit(2)
