"""Synthetic local OPF diagnostic. Never calls a provider or writes business data."""
from __future__ import annotations

import gc
import hashlib
import importlib.metadata
import json
import multiprocessing
import platform
import resource
import signal
import socket
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PRIOR = HERE.parent / "context-gate"
CACHE = Path.home() / ".cache/ccc-privacy-tests/opf"
CODE = CACHE / "privacy-filter-f7f00ca7fb869683eb732c010299d901457f19c3"
sys.path[:0] = [str(HERE), str(PRIOR), str(ROOT / "apps/pipeline"), str(ROOT / "scripts/privacy"), str(CODE)]
import gate_core as gate
import run_gate as prior
from preflight import memory_state as observed_memory_state


def memory_state():
    state = observed_memory_state()
    state["checkedAt"] = now()
    state["modelLoadAllowed"] = state.get("status") == "measured" and state.get("pressureLevel") in (1, 2)
    state["policy"] = "Inspect before loading; normal and warning permit a bounded sequential run. Critical or unknown pressure blocks. Never close unrelated applications."
    return state


def sha(path):
    with Path(path).open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def load_json(path):
    return json.loads(Path(path).read_text())


def save_new(path, value):
    document = {**value}
    document["reportHash"] = hashlib.sha256(json.dumps(document, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()).hexdigest()
    with Path(path).open("x") as handle:
        json.dump(document, handle, ensure_ascii=True, indent=2, sort_keys=True)
        handle.write("\n")
    return document["reportHash"]


def now():
    return datetime.now(timezone.utc).isoformat()


def deny_network_check():
    # The OS sandbox must reject network connect, not merely encounter a closed port.
    import errno
    with socket.socket() as sock:
        sock.settimeout(1)
        try:
            sock.connect(("127.0.0.1", 9))
        except OSError as error:
            if error.errno not in (errno.EPERM, errno.EACCES):
                raise RuntimeError("network_sandbox_not_proven") from None
        else:
            raise RuntimeError("network_sandbox_not_active")
    return {"mechanism": "Darwin sandbox-exec deny network*", "connectDeniedByOS": True}


def deadline(_signum, _frame):
    raise TimeoutError("case_timeout")


def baseline_child(connection, rows, design):
    report = {"baselineCases": []}
    try:
        prior.memory_state = memory_state
        traces = prior.baseline(rows, design, report)
        report["baselineProcessPeakRssBytes"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        connection.send((traces, report))
    except Exception as error:
        report["baselineFailure"] = {"errorClass": type(error).__name__, "code": getattr(error, "code", "baseline_failed")}
        connection.send((None, report))
    finally:
        connection.close()


def isolated_baseline(rows, design, report):
    context = multiprocessing.get_context("spawn")
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=baseline_child, args=(sender, rows, design))
    process.start()
    sender.close()
    try:
        if not receiver.poll(180):
            raise RuntimeError("baseline_process_timeout")
        traces, detail = receiver.recv()
        report.update(detail)
        process.join(10)
        if traces is None or process.exitcode != 0:
            raise RuntimeError("baseline_process_failed")
        return traces
    finally:
        receiver.close()
        if process.is_alive():
            process.terminate()
            process.join(10)
        process.close()


def span_states(row, trace, extra_spans):
    source, gold, _preserve = gate._item_coordinates(row)
    removed = frozenset(index for start, end, _kind in extra_spans for index in range(start, end))
    states = {}
    for moment, indices in (("before", frozenset()), ("after", removed)):
        opaque, _generalized, _literal = gate._trace_partition(trace, source, indices)
        states[moment] = {}
        for kind, spans in gold.items():
            counts = {"full": 0, "partial": 0, "none": 0}
            for start, end in spans:
                gold_indices = {i for i in range(start, end) if not source[i].isspace()}
                key = "full" if gold_indices <= opaque else "partial" if gold_indices & opaque else "none"
                counts[key] += 1
            states[moment][kind] = counts
    return states

def freeze():
    import opf_adapter
    gate.self_check()
    opf_adapter.self_check()
    inputs = [HERE / "run_experiment.py", HERE / "opf_adapter.py", HERE / "experiment-design.json", HERE / "offline.sb",
              HERE / "resumption-amendment.json",
              HERE / "asset-provenance.json", PRIOR / "corpus.json", PRIOR / "gate_core.py", PRIOR / "run_gate.py",
              PRIOR / "preflight.py", PRIOR / "measurement-design.json", PRIOR / "measurement.json",
              PRIOR / "human-review-clarifications.json", HERE.parent / "full-masking/observe_mask.py",
              ROOT / "apps/pipeline/ccc_pipeline/masking.py", ROOT / "scripts/privacy/qualify_ner.py",
              HERE.parent / "ner-comparison/weight-provenance.json"]
    design = load_json(HERE / "experiment-design.json")
    for path, expected in design["designSources"]["files"].items():
        if sha(ROOT / path) != expected:
            raise RuntimeError("source_hash_mismatch")
        inputs.append(ROOT / path)
    hashes = {str(path.relative_to(ROOT)): sha(path) for path in inputs}
    output = {"frozenAt": now(), "status": "frozen_before_model_inference", "inputs": hashes,
              "selfChecks": "passed", "productChanged": False, "qualificationIssued": False}
    digest = save_new(HERE / "freeze.json", output)
    print(json.dumps({"status": "frozen", "reportHash": digest}))


def verify_freeze():
    frozen = load_json(HERE / "freeze.json")
    for path, expected in frozen["inputs"].items():
        if sha(ROOT / path) != expected:
            raise RuntimeError("frozen_input_changed")
    assets = load_json(HERE / "asset-provenance.json")
    for path, expected in assets["files"].items():
        full = CACHE / path
        if full.stat().st_size != expected["bytes"] or sha(full) != expected["sha256"]:
            raise RuntimeError("model_asset_changed")
    for path, expected in assets["codeFiles"].items():
        if sha(CODE / path) != expected:
            raise RuntimeError("upstream_code_changed")
    return frozen


def run():
    import opf_adapter
    if (HERE / "measurement.json").exists():
        raise RuntimeError("output_exists")
    frozen = verify_freeze()
    rows = load_json(PRIOR / "corpus.json")
    gate.validate_corpus(rows)
    report = {"startedAt": now(), "status": "running", "freezeHash": frozen["reportHash"],
              "host": platform.platform(), "cpu": "Apple M4 Pro", "threads": 2,
              "baselineCases": [], "cases": [], "engineeringProbes": [],
              "network": deny_network_check(), "productChanged": False, "qualificationIssued": False,
              "summaryExecuted": False, "databaseAccessed": False,
              "roleInferenceGate": {"status": "unadjudicated", "reason": "No independent workplace-identification evidence for the role-only examples; original contextual gold opacity is descriptive only."},
              "dependencies": {name: importlib.metadata.version(name) for name in
                               ("torch", "transformers", "huggingface-hub", "tiktoken", "safetensors", "numpy")}}
    stage = "baseline"
    try:
        traces = isolated_baseline(rows, load_json(PRIOR / "measurement-design.json"), report)
        saved = {item["id"]: item for item in load_json(PRIOR / "measurement.json")["cases"]}
        for row, trace in zip(rows, traces):
            if gate.score_case(row, trace, []) != saved[row["id"]]["baseline"]:
                raise RuntimeError("baseline_score_changed")
        report["baselineReproducedCases"] = len(rows)
        gc.collect()
        stage = "opf_load"
        report["memoryBeforeOpfLoad"] = memory_state()
        if not report["memoryBeforeOpfLoad"]["modelLoadAllowed"]:
            raise RuntimeError("opf_load_blocked_memory_pressure")
        started = time.perf_counter()
        signal.signal(signal.SIGALRM, deadline)
        signal.alarm(180)
        try:
            handle = opf_adapter.load(str(CACHE / "model/original"))
        finally:
            signal.alarm(0)
            report["opfLoadSeconds"] = time.perf_counter() - started
        stage = "comparison"
        for row, trace in zip(rows, traces):
            if not memory_state()["modelLoadAllowed"]:
                raise RuntimeError("critical_memory_pressure")
            item = {"id": row["id"], "negative": not row["gold"], "inputChars": len(trace["output"]),
                    "baseline": gate.score_case(row, trace, []), "status": "started",
                    "sourceHash": hashlib.sha256(row["text"].encode()).hexdigest(),
                    "inputHash": hashlib.sha256(trace["output"].encode()).hexdigest()}
            started = time.perf_counter()
            signal.alarm(180)
            try:
                inference_started = time.perf_counter()
                try:
                    result = opf_adapter.predict(handle, trace["output"])
                finally:
                    item["inferenceSeconds"] = time.perf_counter() - inference_started
                    signal.alarm(0)
                final_text = gate.apply_edits(trace["output"], result["spans"])
                item.update(status="completed", metrics=result["metrics"],
                            score=gate.score_case(row, trace, result["spans"]),
                            spanStates=span_states(row, trace, result["spans"]),
                            addedSpanCount=len(result["spans"]),
                            addedSpansByKind={kind: sum(span[2] == kind for span in result["spans"]) for kind in gate.KINDS},
                            finalHash=hashlib.sha256(final_text.encode()).hexdigest())
            except Exception as error:
                item.update(status="blocked", code=getattr(error, "code", "case_timeout" if isinstance(error, TimeoutError) else "prediction_failed"), errorClass=type(error).__name__)
            finally:
                signal.alarm(0)
                item["caseWallSeconds"] = time.perf_counter() - started
                item["seconds"] = item["inferenceSeconds"]
                item["processCumulativePeakRssBytes"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                report["cases"].append(item)
            print(json.dumps({"id": row["id"], "status": item["status"], "seconds": round(item["seconds"], 3)}), flush=True)
        stage = "coverage_probe"
        if not memory_state()["modelLoadAllowed"]:
            raise RuntimeError("critical_memory_pressure")
        # Bounded engineering input, not independent evidence of quality or role privacy.
        seed = traces[6]["output"]
        filler = "상담자: 다음 상담에서 생활 계획을 함께 확인합니다.\n"
        count = 24000 - len(seed) * 2 - 2
        probe_text = seed + "\n" + (filler * (count // len(filler) + 1))[:count] + "\n" + seed
        if len(probe_text) != 24000:
            raise RuntimeError("invalid_probe_size")
        started = time.perf_counter()
        probe = {"id": "engineering-24000", "inputChars": len(probe_text), "qualityDenominator": False,
                 "source": "Repeated baseline cg-007 plus synthetic neutral filler", "status": "started",
                 "constructionHash": hashlib.sha256(probe_text.encode()).hexdigest()}
        signal.alarm(180)
        try:
            inference_started = time.perf_counter()
            try:
                result = opf_adapter.predict(handle, probe_text)
            finally:
                probe["inferenceSeconds"] = time.perf_counter() - inference_started
                signal.alarm(0)
            probe.update(status="completed", metrics=result["metrics"], spanCount=len(result["spans"]))
        except Exception as error:
            probe.update(status="blocked", code=getattr(error, "code", "case_timeout" if isinstance(error, TimeoutError) else "prediction_failed"), errorClass=type(error).__name__)
        finally:
            signal.alarm(0)
            probe["caseWallSeconds"] = time.perf_counter() - started
            probe["seconds"] = probe["inferenceSeconds"]
            report["engineeringProbes"].append(probe)
        del handle, traces
        gc.collect()
        report["status"] = "diagnostic_complete_not_qualified"
    except Exception as error:
        report.update(status="experiment_blocked", blockedStage=stage,
                      code=getattr(error, "code", str(error) if isinstance(error, RuntimeError) and str(error).replace("_", "").isalnum() else "stage_failed"),
                      errorClass=type(error).__name__)
    finally:
        attempted_ids = {item["id"] for item in report["cases"]}
        report["notAttemptedIds"] = [row["id"] for row in rows if row["id"] not in attempted_ids]
        report["caseAccounting"] = {
            "eligible": len(rows),
            "eligiblePositive": sum(bool(row["gold"]) for row in rows),
            "eligibleTargetNegative": sum(not row["gold"] for row in rows),
            "attempted": len(attempted_ids),
            "successful": sum(item["status"] == "completed" for item in report["cases"]),
            "failed": sum(item["status"] == "blocked" for item in report["cases"]),
            "notAttempted": len(report["notAttemptedIds"]),
        }
        report["finishedAt"] = now()
        report["processPeakRssBytes"] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        report["memoryAfter"] = memory_state()
        report["memoryInterpretation"] = "Darwin ru_maxrss is bytes. Candidate process peak includes imports, IPC traces, OPF load and inference. Baseline model runs in a separate exited subprocess with its own peak. Neither figure is incremental model RAM or Windows minimum specification."
        report["rawTextsPredictionsAndOffsetsPersisted"] = False
        report["reportHash"] = save_new(HERE / "measurement.json", report)
    print(json.dumps({"status": report["status"], "completedCases": sum(item["status"] == "completed" for item in report["cases"]),
                      "caseCount": len(report["cases"]), "reportHash": report["reportHash"]}))
    return 0 if report["status"] == "diagnostic_complete_not_qualified" else 2


if __name__ == "__main__":
    try:
        if sys.argv[1:] == ["freeze"]:
            freeze()
        elif sys.argv[1:] == ["run"]:
            sys.exit(run())
        else:
            raise RuntimeError("choose_freeze_or_run")
    except Exception as error:
        print(json.dumps({"status": "failed", "errorClass": type(error).__name__, "code": "experiment_preflight_failed"}), file=sys.stderr)
        sys.exit(2)
