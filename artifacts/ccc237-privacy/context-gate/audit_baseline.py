"""Re-measure baseline-only non-gold masking omitted from the original summary."""
from __future__ import annotations

import json
from pathlib import Path

from run_gate import baseline, checked_freeze, gate, load, now, q

HERE = Path(__file__).resolve().parent


def main():
    frozen = checked_freeze()
    corpus = load(HERE / "corpus.json")
    original = {row["id"]: row for row in load(HERE / "measurement.json")["cases"]}
    runtime = {"baselineCases": []}
    traces = baseline(corpus, load(HERE / "measurement-design.json"), runtime)
    rows = []
    for item, trace in zip(corpus, traces, strict=True):
        repeated_score = gate.score_case(item, trace, [])
        if repeated_score != original[item["id"]]["baseline"]:
            raise ValueError("baseline_reproduction_mismatch")
        gold = set()
        for entry in item["gold"]:
            start = item["text"].index(entry["quote"])
            gold.update(range(start, start + len(entry["quote"])))
        nongold = {i for i, char in enumerate(item["text"]) if not char.isspace() and i not in gold}
        rows.append({"id": item["id"], "negative": not item["gold"],
                     "opaqueNonGoldChars": len(nongold & trace["opaque_indices"]),
                     "generalizedNonGoldChars": len(nongold & trace["generalized_indices"])})
    report = q.write_new_report(HERE / "baseline-audit.json", {
        "measuredAt": now(), "freezeHash": frozen["reportHash"], "baselineScoresReproducedExactly": True,
        "kind": "post_run_baseline_metric_audit_not_new_qualification", "rows": rows,
        "negativeRowsWithOpaqueMasking": [row["id"] for row in rows if row["negative"] and row["opaqueNonGoldChars"]],
        "limits": "Non-gold removal can include policy-required generalization or harmless suffix removal. It is not automatically a privacy false-positive rate or total semantic loss.",
        "runtime": runtime, "localLlmRerun": False, "productChanged": False})
    print(json.dumps({"status": "audited", "baselineScoresReproducedExactly": True,
                      "negativeRowsWithOpaqueMasking": report["negativeRowsWithOpaqueMasking"], "reportHash": report["reportHash"]}))


if __name__ == "__main__":
    main()
