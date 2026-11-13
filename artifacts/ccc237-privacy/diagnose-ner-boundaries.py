#!/usr/bin/env python3
"""Synthetic-only diagnostic, never a qualification or production decoder.

Reference behavior: pinned model card (MIT):
https://huggingface.co/FrameByFrame/korean-pii-e5-base/raw/a308c54b4407819624a5661e31e162a269f39818/README.md
The four arms reuse identical token predictions; neither gold nor thresholds change.
No source text, predicted substrings, token arrays or offsets enter the report.
"""
from __future__ import annotations

import json
import os
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "apps/pipeline"), str(ROOT / "scripts/privacy")]
import qualify_ner as q
from ccc_pipeline import masking
from ccc_pipeline.results import canonical_sha256

# Ordered suffixes and two-pass policy from the pinned model card, not our gold.
JOSA = ("이에요", "이라고", "입니다", "이야", "이랑", "한테", "에게", "으로", "이가", "이는",
        "에서", "이고", "예요", "씨", "님", "이", "가", "은", "는", "을", "를", "야", "아", "에", "의", "랑", "께", "고")
ARMS = ("bioes_v1", "author_grouping_only", "author_normalization_only", "author_grouping_and_normalization")
CORPORA = (
    ("health", "scripts/privacy/fixtures/s6-ner-health-ko-conversation-v2.json", q.HEALTH_CORPUS_HASH,
     "artifacts/ccc237-privacy/install-health-v2-bioes-v1.json"),
    ("release", "scripts/privacy/fixtures/s6-release-ko-v1.json",
     "8fe927f79ad4e84d6ed1440b069e099e15c50618226c6727781e73f00ee321f4",
     "artifacts/ccc237-privacy/release-qualification-v1-bioes-v1.json"),
)


def author_groups(tokens):
    """Model-card transition policy: B/S, O, type changes and zero-width reset.

    In contrast to strict BIOES, E does not itself close the active span.
    """
    groups, active = [], None
    for token in tokens:
        label = token["entity"].upper()
        start, end = int(token["start"]), int(token["end"])
        if start == end or label == "O":
            active = None
            continue
        tag, category = label.split("-", 1)
        if active is None or tag in ("B", "S") or active["entity_group"] != category:
            active = {"entity_group": category, "start": start, "end": end}
            groups.append(active)
        else:
            active["end"] = end
    return groups


def normalize(text, entities):
    result = []
    for entity in entities:
        label, start, end = entity["entity_group"], entity["start"], entity["end"]
        if label not in q.LABELS:
            continue
        while start < end and text[start] in " .,\t\n":
            start += 1
        while end > start and text[end - 1] in " .,\t\n":
            end -= 1
        for _ in range(2):
            suffix = next((j for j in JOSA if text[start:end].endswith(j) and end - start - len(j) >= 2), None)
            if suffix is None:
                break
            end -= len(suffix)
        if text[start:end].strip():
            result.append({"entity_group": label, "start": start, "end": end})
    return result


def spans(item, label):
    field = "person" if label == q.PERSON_LABEL else "address"
    return {(item["text"].index(value), item["text"].index(value) + len(value)) for value in item[field]}


def covered(text, gold, actual):
    expected = {i for start, end in gold for i in range(start, end) if not text[i].isspace()}
    found = {i for start, end in actual for i in range(start, end) if i in expected}
    return expected, found


def classify(item, predictions, label):
    text = item["text"]
    gold = spans(item, label)
    actual = {(s, e) for cat, s, e in predictions if cat == label}
    other = {(s, e) for cat, s, e in predictions if cat != label}
    gold_buckets, fp_buckets = Counter(), Counter()
    for gs, ge in gold:
        if (gs, ge) in actual:
            reason = "exact"
        else:
            overlapping = {(s, e) for s, e in actual if s < ge and gs < e}
            expected, found = covered(text, {(gs, ge)}, overlapping)
            if not overlapping:
                reason = "other_target_label_only" if any(s < ge and gs < e for s, e in other) else "no_same_label_overlap"
            elif any({i for i in range(s, e) if not text[i].isspace()} == expected for s, e in overlapping):
                reason = "whitespace_boundary_only"
            elif any(s <= gs and e >= ge for s, e in overlapping):
                reason = "superset_with_extra_context"
            elif len(overlapping) > 1 and found == expected:
                reason = "fragmented_full_nonspace_coverage"
            else:
                reason = "partial_coverage"
        gold_buckets[reason] += 1
    true_negative = not item["person"] and not item["address"]
    for ps, pe in actual - gold:
        reason = "overlaps_same_label_gold" if any(ps < e and s < pe for s, e in gold) else (
            "prediction_on_true_negative" if true_negative else "outside_same_label_gold_in_positive_row"
        )
        fp_buckets[reason] += 1
    expected, found = covered(text, gold, actual)
    return gold_buckets, fp_buckets, len(expected), len(found)


def self_check():
    tokens = [{"entity": tag, "start": i, "end": i + 1} for i, tag in enumerate(
        ["B-private_address", "E-private_address", "I-private_address", "E-private_address"])]
    assert len(masking.decode_ner_entities(tokens, 4)) == 2
    assert [(e["start"], e["end"]) for e in author_groups(tokens)] == [(0, 4)]
    item = {"text": "가나다라", "person": [], "address": ["가나다라"]}
    pred = [(q.ADDRESS_LABEL, 0, 2), (q.ADDRESS_LABEL, 2, 4)]
    assert classify(item, pred, q.ADDRESS_LABEL)[0] == {"fragmented_full_nonspace_coverage": 1}
    # A suffix can be part of a genuine name. Record this risk, never hide it.
    entity = [{"entity_group": q.PERSON_LABEL, "start": 0, "end": 3}]
    assert normalize("정하은", entity)[0]["end"] == 2
    assert covered("정하은", {(0, 3)}, {(0, 2)})[1] == {0, 1}
    print(json.dumps({"selfCheck": "passed", "diagnosticOnly": True}))


def main():
    self_check()
    if sys.argv[1:] == ["--self-check"]:
        return
    if len(sys.argv) != 2 or Path(sys.argv[1]).exists():
        raise SystemExit("new_output_path_required")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1",
                      HF_HUB_DISABLE_IMPLICIT_TOKEN="1", TOKENIZERS_PARALLELISM="false",
                      OMP_NUM_THREADS=str(q.THREADS))
    import torch
    from transformers import pipeline
    torch.set_num_threads(q.THREADS)
    torch.manual_seed(0)
    model = pipeline("token-classification", model=q.MODEL_ID, revision=q.MODEL_REVISION,
                     aggregation_strategy="none", ignore_labels=[], device="cpu")
    masking._assert_labels_exist(model, q.MODEL_ID, (q.PERSON_LABEL,))
    masking._assert_labels_exist(model, q.MODEL_ID, (q.ADDRESS_LABEL,))
    reports = []
    for kind, corpus_path, expected_hash, baseline_path in CORPORA:
        corpus = q.validate_corpus(json.loads((ROOT / corpus_path).read_text()), kind, expected_hash)
        predictions = {arm: [] for arm in ARMS}
        max_tokens = 0
        over_256 = 0
        # Predict all texts and arms before any gold-dependent score or taxonomy.
        for item in corpus.items:
            text = item["text"]
            token_count = len(model.tokenizer(text)["input_ids"])
            max_tokens = max(max_tokens, token_count)
            over_256 += token_count > 256
            tokens = model(text)
            strict = masking.decode_ner_entities(tokens, len(text))
            author = author_groups(tokens)
            outputs = (strict, author, normalize(text, strict), normalize(text, author))
            for arm, output in zip(ARMS, outputs):
                predictions[arm].append(q._freeze_prediction(output, len(text)))
        arms = {}
        for arm in ARMS:
            counts, rows = q.score_predictions(corpus.items, predictions[arm])
            details = {}
            for label in q.LABELS:
                gold_buckets, fp_buckets = Counter(), Counter()
                total_chars = found_chars = 0
                for item, prediction in zip(corpus.items, predictions[arm]):
                    gb, fb, total, found = classify(item, prediction, label)
                    gold_buckets.update(gb)
                    fp_buckets.update(fb)
                    total_chars += total
                    found_chars += found
                assert sum(gold_buckets.values()) == counts[label]["tp"] + counts[label]["fn"]
                assert gold_buckets["exact"] == counts[label]["tp"]
                assert sum(fp_buckets.values()) == counts[label]["fp"]
                details[label] = {"goldBuckets": dict(gold_buckets), "falsePositiveBuckets": dict(fp_buckets),
                                  "goldNonspaceCodePoints": total_chars, "coveredGoldNonspaceCodePoints": found_chars}
            arms[arm] = {"counts": counts, "pointMetrics": q.point_metrics(counts), "diagnosis": details}
        assert arms["bioes_v1"]["counts"] == json.loads((ROOT / baseline_path).read_text())["counts"], "baseline_drift"
        effects = {}
        for before, after in (("bioes_v1", "author_normalization_only"),
                              ("author_grouping_only", "author_grouping_and_normalization")):
            effect = {label: Counter() for label in q.LABELS}
            for item, old, new in zip(corpus.items, predictions[before], predictions[after]):
                for label in q.LABELS:
                    gold = spans(item, label)
                    a = {(s, e) for cat, s, e in old if cat == label}
                    b = {(s, e) for cat, s, e in new if cat == label}
                    effect[label]["exactGoldGains"] += len((gold & b) - a)
                    effect[label]["exactGoldLosses"] += len((gold & a) - b)
                    effect[label]["removedGoldNonspaceCodePoints"] += len(covered(item["text"], gold, a)[1] - covered(item["text"], gold, b)[1])
            effects[after] = {label: dict(value) for label, value in effect.items()}
        reports.append({"kind": kind, "corpusHash": expected_hash, "corpusCount": len(corpus.items),
                        "maxTokenCountIncludingSpecial": max_tokens, "rowsOverAuthorMaxLength256": over_256,
                        "arms": arms, "normalizationEffects": effects})
    report = {"schemaVersion": 1, "measuredAt": datetime.now(timezone.utc).isoformat(),
              "purpose": "Residual error diagnosis; NOT release requalification or production policy",
              "modelId": q.MODEL_ID, "modelRevision": q.MODEL_REVISION,
              "runtime": {**q._runtime_metadata(model_loaded=True),
                          "decoderPolicy": "four-arm same-token diagnostic comparison",
                          "dtype": str(model.model.dtype)},
              "referenceScope": "Grouping and target-label normalization policies only; not reproduction of the author's bf16 benchmark",
              "modelLoads": 1,
              "syntheticOnly": True, "providerCalls": 0, "productCodeChanged": False,
              "goldOrThresholdsChanged": False, "rawTextTokensOrOffsetsRetained": False,
              "attestationIssued": False, "receiptIssued": False, "reports": reports}
    report["reportHash"] = canonical_sha256(report)
    with Path(sys.argv[1]).open("x") as target:
        json.dump(report, target, ensure_ascii=True, sort_keys=True, indent=2)
        target.write("\n")
    print(json.dumps({"status": "diagnosed", "reportHash": report["reportHash"],
                      "corpora": [{"kind": r["kind"], "items": r["corpusCount"],
                                   "countsByArm": {a: v["counts"] for a, v in r["arms"].items()}} for r in reports]}))


if __name__ == "__main__":
    main()
