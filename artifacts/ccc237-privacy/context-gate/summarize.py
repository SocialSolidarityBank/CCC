"""Summarize raw-free results without treating rejected partial work as delivered output."""
from __future__ import annotations

import json
import statistics
from collections import Counter
from pathlib import Path

from run_gate import checked_freeze, load, q

HERE = Path(__file__).resolve().parent


def main():
    frozen = checked_freeze()
    measurement = load(HERE / "measurement.json")
    body = dict(measurement)
    expected = body.pop("reportHash")
    if q.canonical_sha256(body) != expected or measurement["freezeHash"] != frozen["reportHash"]:
        raise ValueError("measurement_hash_mismatch")
    cases = measurement["cases"]
    completed = [row for row in cases if row["maskingCompleted"]]
    corpus = {row["id"]: row for row in load(HERE / "corpus.json")}

    def coverage(selected, key, kinds):
        return {kind: {
            "goldSpans": sum(gold["kind"] == kind for row in selected for gold in corpus[row["id"]]["gold"]),
            "fullyOpaqueSpans": sum(row[key]["completelyMaskedSpans"][kind] for row in selected),
            "nonOpaqueGoldCharacters": sum(row[key]["goldNonspaceNonOpaqueChars"][kind]["after"] for row in selected),
        } for kind in kinds}

    def ids(predicate, selected=completed):
        return [row["id"] for row in selected if predicate(row)]

    stage = "diagnosticPartialOrFinalMasking"
    direct = ("person", "address", "identifier")
    defect_rows = {
        "residualDirectIdentifiersAfterCompletedMasking": ids(lambda r: any(r[stage]["goldNonspaceNonOpaqueChars"][k]["after"] for k in direct)),
        "newMaskingInTargetNegativeRows": ids(lambda r: r["negative"] and r[stage]["extraNonGoldMaskingChars"] > 0),
        "newNonGoldMaskingInPositiveRowsNeedsAdjudication": ids(lambda r: not r["negative"] and r[stage]["extraNonGoldMaskingChars"] > 0),
        "protectedPhraseLossInBaseline": ids(lambda r: r["baseline"]["protectedPreserveStringsLost"] > 0, cases),
        "protectedPhraseLossAfterCompletedMasking": ids(lambda r: r[stage]["protectedPreserveStringsLost"] > 0),
        "rejected": ids(lambda r: r["status"] == "rejected", cases),
    }
    latencies = [row["seconds"] for row in cases]
    report = {
        "measurementHash": measurement["reportHash"], "freezeHash": frozen["reportHash"],
        "status": "diagnostic_only", "decision": "do_not_adopt_from_this_evidence",
        "attemptedCases": len(cases), "plannedCases": len(corpus),
        "maskingCompletedCases": len(completed), "unapprovedDraftsStaged": sum(row["draftStaged"] for row in cases),
        "rejectedCases": sum(row["status"] == "rejected" for row in cases),
        "rejectionsByCode": dict(Counter(str(row.get("code") or row.get("errorClass")) for row in cases if row["status"] == "rejected")),
        "baselineDirectCoverageAllAttemptedCases": coverage(cases, "baseline", direct),
        "finalDirectCoverageMaskingCompletedCasesOnly": coverage(completed, stage, direct),
        "contextualStrictOpacityNotPrivacyRecall": {
            "baselineAllAttempted": coverage(cases, "baseline", ("contextual",)),
            "maskingCompletedOnly": coverage(completed, stage, ("contextual",)),
        },
        "protectedNonspaceCharactersLost": {
            "baselineAllAttempted": sum(row["baseline"]["protectedPreserveNonspaceCharsLost"]["after"] for row in cases),
            "afterMaskingCompletedOnly": sum(row[stage]["protectedPreserveNonspaceCharsLost"]["after"] for row in completed),
        },
        "defectRows": defect_rows,
        "requests": len(measurement["calls"]),
        "caseLatencySeconds": ({"median": statistics.median(latencies), "maximum": max(latencies)} if latencies else None),
        "requestLatency": measurement.get("callLatency"),
        "baselineInputsOverTokenizerLimit": [r["id"] for r in measurement["baselineCases"] if r["inputTokens"] > r["modelMaxTokens"]],
        "runnerPeakRssBytes": measurement["runnerPeakRssBytes"],
        "scopeLimits": [
            "Rejected partial edits are not delivered text; final coverage denominator contains only completed masking phases.",
            "Contextual component removal is not a validated re-identification-risk score.",
            "Protected source phrases and exact summary evidence do not establish semantic summary fidelity.",
            "Summary exact-gold-match counters mix direct and contextual spans and are not a confirmed leakage rate.",
            "No human-adjudicated qualification, real participant data, Windows/user-PC usability or CCC gateway integration measured.",
            "One CPU-only 4B quantized candidate with two threads does not represent all local LLMs.",
            "External comparison was not executed because both existing credential checks returned401.",
        ],
        "productChanged": False, "qualificationIssued": False,
    }
    written = q.write_new_report(HERE / "summary.json", report)
    print(json.dumps({"status": "summarized", "reportHash": written["reportHash"],
                      "attemptedCases": len(cases), "maskingCompletedCases": len(completed),
                      "unapprovedDraftsStaged": report["unapprovedDraftsStaged"], "rejectedCases": report["rejectedCases"]}))


if __name__ == "__main__":
    main()
