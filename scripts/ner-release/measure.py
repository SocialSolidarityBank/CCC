"""E5-4 release qualification measurement (offline, spec-faithful).

Implements docs/specs/S6-privacy-packet.md:60 (span-exact TP/FP/FN, precision,
recall, overgeneralizationRate) and :79 (Wilson 95% lower precision/recall
>= 0.90, overgeneralization Wilson 95% upper <= 0.05).

Span extraction mirrors ccc_pipeline/masking.py `_build_span_ner`/`_span_fn`:
transformers token-classification pipeline, revision-pinned model,
entity_group uppercased and prefix-matched to the manifest labels
PRIVATE_PERSON / PRIVATE_ADDRESS. The deployed pipeline uses
aggregation_strategy="simple"; that strategy is the verdict. "first" and "max"
are measured alongside as diagnostics to separate model capability from
aggregation artifacts.

The spec names "Wilson 95%" without a formula; the standard Wilson score
interval with z=1.959963984540054 is used.

Usage on mini:
  HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
    /Users/barq/.local/share/ccc-pipeline/venv/bin/python measure.py corpus.jsonl out.json
"""

from __future__ import annotations

import hashlib
import json
import math
import sys

MODEL_ID = "FrameByFrame/korean-pii-e5-base"
MODEL_REVISION = "a308c54b4407819624a5661e31e162a269f39818"
PERSON_LABEL = "PRIVATE_PERSON"
ADDRESS_LABEL = "PRIVATE_ADDRESS"
LABEL_SET_HASH = "b645305b068070375d95b18979ead77ec584833f6670dd82554605e9ccf4a4fc"
Z = 1.959963984540054  # 95% two-sided
STRATEGIES = ["simple", "first", "max"]


def canonical_json(value) -> str:
    def canon(v):
        if isinstance(v, float) and float(v).is_integer():
            return int(v)
        if isinstance(v, dict):
            return {k: canon(v[k]) for k in sorted(v)}
        if isinstance(v, list):
            return [canon(x) for x in v]
        return v
    return json.dumps(canon(value), separators=(",", ":"), ensure_ascii=False, sort_keys=True)


def sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def wilson(k: int, n: int) -> tuple[float, float]:
    if n == 0:
        return float("nan"), float("nan")
    p = k / n
    denom = 1 + Z * Z / n
    centre = p + Z * Z / (2 * n)
    margin = Z * math.sqrt(p * (1 - p) / n + Z * Z / (4 * n * n))
    return (centre - margin) / denom, (centre + margin) / denom


def gold_spans(row: dict, label: str) -> set[tuple[int, int]]:
    spans = set()
    for gold in row[label]:
        start = row["text"].index(gold)  # code points; verified unique by generator
        spans.add((start, start + len(gold)))
    return spans


def score(rows, entities_per_row) -> dict:
    counts = {
        PERSON_LABEL: {"tp": 0, "fp": 0, "fn": 0},
        ADDRESS_LABEL: {"tp": 0, "fp": 0, "fn": 0},
    }
    for row, entities in zip(rows, entities_per_row):
        pred = {PERSON_LABEL: set(), ADDRESS_LABEL: set()}
        for ent in entities:
            group = str(ent.get("entity_group", "")).upper()
            if group in pred:
                pred[group].add((int(ent["start"]), int(ent["end"])))
        for label, key in ((PERSON_LABEL, "person"), (ADDRESS_LABEL, "address")):
            gold = gold_spans(row, key)
            c = counts[label]
            c["tp"] += len(gold & pred[label])
            c["fp"] += len(pred[label] - gold)
            c["fn"] += len(gold - pred[label])

    def pr(label: str) -> tuple[float, float]:
        c = counts[label]
        if c["tp"] + c["fp"] == 0 or c["tp"] + c["fn"] == 0:
            return float("nan"), float("nan")  # spec: zero denominator never passes
        return c["tp"] / (c["tp"] + c["fp"]), c["tp"] / (c["tp"] + c["fn"])

    person_p, person_r = pr(PERSON_LABEL)
    addr_p, addr_r = pr(ADDRESS_LABEL)
    tp_all = counts[PERSON_LABEL]["tp"] + counts[ADDRESS_LABEL]["tp"]
    fp_all = counts[PERSON_LABEL]["fp"] + counts[ADDRESS_LABEL]["fp"]
    overgen = fp_all / (tp_all + fp_all) if tp_all + fp_all else float("nan")

    metrics = {
        "addressPrecision": addr_p,
        "addressRecall": addr_r,
        "overgeneralizationRate": overgen,
        "personPrecision": person_p,
        "personRecall": person_r,
    }
    w = {
        "personPrecisionLower": wilson(counts[PERSON_LABEL]["tp"], counts[PERSON_LABEL]["tp"] + counts[PERSON_LABEL]["fp"])[0],
        "personRecallLower": wilson(counts[PERSON_LABEL]["tp"], counts[PERSON_LABEL]["tp"] + counts[PERSON_LABEL]["fn"])[0],
        "addressPrecisionLower": wilson(counts[ADDRESS_LABEL]["tp"], counts[ADDRESS_LABEL]["tp"] + counts[ADDRESS_LABEL]["fp"])[0],
        "addressRecallLower": wilson(counts[ADDRESS_LABEL]["tp"], counts[ADDRESS_LABEL]["tp"] + counts[ADDRESS_LABEL]["fn"])[0],
        "overgeneralizationUpper": wilson(fp_all, tp_all + fp_all)[1],
    }
    verdict = "passed" if (
        w["personPrecisionLower"] >= 0.90 and w["personRecallLower"] >= 0.90
        and w["addressPrecisionLower"] >= 0.90 and w["addressRecallLower"] >= 0.90
        and w["overgeneralizationUpper"] <= 0.05
        and all(not math.isnan(v) for v in metrics.values())
    ) else "failed"
    return {
        "counts": counts,
        "metrics": metrics,
        "resultHash": sha256_hex(canonical_json(metrics)),
        "wilson": w,
        "verdict": verdict,
    }


def main() -> None:
    corpus_path, out_path = sys.argv[1], sys.argv[2]

    # Sanity: JCS implementation must reproduce the spec's labelSetHash.
    assert sha256_hex(canonical_json(["PRIVATE_ADDRESS", "PRIVATE_PERSON"])) == LABEL_SET_HASH

    rows = [json.loads(line) for line in open(corpus_path, encoding="utf-8")]
    corpus_hash = sha256_hex(canonical_json(rows))

    from transformers import pipeline  # noqa: PLC0415

    report = {
        "modelId": MODEL_ID,
        "modelRevision": MODEL_REVISION,
        "labelSetHash": LABEL_SET_HASH,
        "corpusHash": corpus_hash,
        "items": len(rows),
        "strategies": {},
    }
    for agg in STRATEGIES:
        recognizer = pipeline(
            "token-classification",
            model=MODEL_ID,
            revision=MODEL_REVISION,
            aggregation_strategy=agg,
        )
        entities_per_row = [recognizer(row["text"]) for row in rows]
        report["strategies"][agg] = score(rows, entities_per_row)
        print(agg, report["strategies"][agg]["verdict"], report["strategies"][agg]["counts"], flush=True)

    # Deployed strategy is the verdict-bearing measurement.
    report["deployedStrategy"] = "simple"
    report["verdict"] = report["strategies"]["simple"]["verdict"]
    report["resultHash"] = report["strategies"]["simple"]["resultHash"]

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, ensure_ascii=False, indent=2)
    print(json.dumps({"verdict": report["verdict"], "resultHash": report["resultHash"], "corpusHash": corpus_hash}))


if __name__ == "__main__":
    main()
