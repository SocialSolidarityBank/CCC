"""E5-4 re-measurement through the PRODUCTION span path (verification rerun).

Purpose: decide whether the failed release qualification measurement
(artifacts/ner-release/measurement.json) reflects a harness/product divergence
or a real model limitation. Span extraction calls the exact production entry
point `ccc_pipeline.masking.build_person_and_address_ner` (the function
worker.py:332 calls) with the manifest label tuples ("PRIVATE_PERSON",) /
("PRIVATE_ADDRESS",). Scoring reuses measure.py `score()`/`gold_spans()`
unchanged — no metric logic is re-implemented here.

Also verifies, per corpus row, that the production NerFn output equals the raw
recognizer output filtered the measure.py way (entity_group uppercased, exact
label match), and records the raw BIOES tag-prefix histogram that explains the
"simple" aggregation fragmentation (transformers 4.53.3 get_tag strips only
B-/I-, so E-/S- tokens split entity groups).

Usage on mini:
  HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
    /Users/barq/.local/share/ccc-pipeline/venv/bin/python \
    rerun_production_path.py corpus.jsonl out.json
"""

from __future__ import annotations

import json
import sys

sys.path.insert(0, "/Users/barq/.local/share/ccc-pipeline/repo/apps/pipeline")

import measure  # noqa: E402  score(), gold_spans(), canonical_json(), sha256_hex()
from ccc_pipeline import masking  # noqa: E402

MODEL_ID = "FrameByFrame/korean-pii-e5-base"


def main() -> None:
    corpus_path, out_path = sys.argv[1], sys.argv[2]
    rows = [json.loads(line) for line in open(corpus_path, encoding="utf-8")]

    # Production span functions — worker.py:332 call signature, manifest labels.
    person_ner, address_ner = masking.build_person_and_address_ner(
        MODEL_ID, ("PRIVATE_PERSON",), ("PRIVATE_ADDRESS",)
    )

    # Raw recognizer with identical construction args, for the equivalence check.
    from transformers import pipeline  # noqa: PLC0415
    from ccc_pipeline.model_registry import model_spec  # noqa: PLC0415

    spec = model_spec(MODEL_ID)
    raw = pipeline(
        "token-classification",
        model=spec.name,
        revision=spec.revision,
        aggregation_strategy="simple",
    )

    entities_per_row = []
    mismatch_rows = 0
    for row in rows:
        text = row["text"]
        p_spans = person_ner(text)
        a_spans = address_ner(text) if address_ner else []
        raw_ents = raw(text)
        raw_p = {
            (int(e["start"]), int(e["end"]))
            for e in raw_ents
            if str(e.get("entity_group", "")).upper() == "PRIVATE_PERSON"
        }
        raw_a = {
            (int(e["start"]), int(e["end"]))
            for e in raw_ents
            if str(e.get("entity_group", "")).upper() == "PRIVATE_ADDRESS"
        }
        if set(p_spans) != raw_p or set(a_spans) != raw_a:
            mismatch_rows += 1
        entities_per_row.append(
            [{"entity_group": "PRIVATE_PERSON", "start": s, "end": e} for s, e in p_spans]
            + [{"entity_group": "PRIVATE_ADDRESS", "start": s, "end": e} for s, e in a_spans]
        )

    result = measure.score(rows, entities_per_row)
    result["spanFnVsRawMismatchedRows"] = mismatch_rows

    # Mechanism check: raw BIOES tag prefixes on the first 10 rows.
    raw_none = pipeline(
        "token-classification",
        model=spec.name,
        revision=spec.revision,
        aggregation_strategy="none",
    )
    tag_prefixes: dict[str, int] = {}
    for row in rows[:10]:
        for ent in raw_none(row["text"]):
            label = str(ent.get("entity", ""))
            prefix = label.split("-", 1)[0] if "-" in label else label
            tag_prefixes[prefix] = tag_prefixes.get(prefix, 0) + 1
    result["rawTagPrefixesFirst10Rows"] = tag_prefixes

    # Smoke: one synthetic line through mask_text_with_report (worker.py:443 path).
    # Report counts and lengths only — never the source sentence (R3).
    smoke_text = "김철수 님이 박영희 씨에게 010-1234-5678 로 연락해 달라고 했다."
    masked, report = masking.mask_text_with_report(smoke_text, person_ner, None, address_ner)
    result["smoke"] = {
        "maskedTokenCounts": report.as_mapping(),
        "maskedTotal": report.total,
        "lenBefore": len(smoke_text),
        "lenAfter": len(masked),
    }

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(result, fh, ensure_ascii=False, indent=2)
    print(json.dumps({"verdict": result["verdict"], "mismatchedRows": mismatch_rows}))


if __name__ == "__main__":
    main()
