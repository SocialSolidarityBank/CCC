"""Read-only S6 feasibility probe. No receipt or attestation is issued."""
import hashlib
import importlib.metadata
import json
import platform
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

root = Path(sys.argv[1])
sys.path.insert(0, str(root / "apps/pipeline"))
from ccc_pipeline import masking
from ccc_pipeline.model_registry import model_spec
from ccc_pipeline.results import canonical_sha256

spec_text = (root / "docs/specs/S6-privacy-packet.md").read_text()
spec_sha256 = hashlib.sha256(spec_text.encode()).hexdigest()
assert spec_sha256 == "2073e8074cc26a84faf98b6197ef0a273f0907dff0d73d5f4df1090091da68b4", "S6 changed; review before rerunning this evidence probe"
blocks = re.findall(r"```json\n(.*?)\n```", spec_text, re.S)
corpus = json.loads(blocks[0])
spec = model_spec("FrameByFrame/korean-pii-e5-base")
assert spec.revision == "a308c54b4407819624a5661e31e162a269f39818"
assert canonical_sha256(corpus) == "10265475ed38dbdc8f902cd78fb29654a948c96ddb9c9daeda3b485d4cdd46a5"
import torch
torch.set_num_threads(2)
torch.manual_seed(0)
from transformers import pipeline
recognizer = pipeline("token-classification", model=spec.name, revision=spec.revision, aggregation_strategy="simple", device="cpu")
masking._assert_labels_exist(recognizer, spec.name, ("PRIVATE_PERSON",))
masking._assert_labels_exist(recognizer, spec.name, ("PRIVATE_ADDRESS",))
counts = {label: {"tp": 0, "fp": 0, "fn": 0} for label in ("PRIVATE_PERSON", "PRIVATE_ADDRESS")}
rows = []
for item in corpus:
    # Model output is measured before consulting truth. Never log text or entity words.
    predicted = recognizer(item["text"])
    labels = [{"label": str(entity["entity_group"]).upper(), "start": int(entity["start"]), "end": int(entity["end"])} for entity in predicted]
    row = {"id": item["id"], "predictions": labels, "counts": {}}
    for field, label in (("person", "PRIVATE_PERSON"), ("address", "PRIVATE_ADDRESS")):
        gold = set()
        for value in item[field]:
            start = item["text"].index(value)
            assert item["text"].count(value) == 1
            gold.add((start, start + len(value)))
        actual = {(entry["start"], entry["end"]) for entry in labels if entry["label"].startswith((label,))}
        row["counts"][label] = {"tp": len(gold & actual), "fp": len(actual - gold), "fn": len(gold - actual)}
        for name, value in row["counts"][label].items():
            counts[label][name] += value
    rows.append(row)
metrics = {}
for label, prefix in (("PRIVATE_PERSON", "person"), ("PRIVATE_ADDRESS", "address")):
    c = counts[label]
    metrics[prefix + "Precision"] = c["tp"] / (c["tp"] + c["fp"]) if c["tp"] + c["fp"] else None
    metrics[prefix + "Recall"] = c["tp"] / (c["tp"] + c["fn"]) if c["tp"] + c["fn"] else None
fp = sum(c["fp"] for c in counts.values())
tp = sum(c["tp"] for c in counts.values())
metrics["overgeneralizationRate"] = fp / (tp + fp) if tp + fp else None
result = {
    "purpose": "S6 literal install-health feasibility; not production qualification",
    "modelId": spec.name, "modelRevision": spec.revision,
    "labelSetHash": canonical_sha256(["PRIVATE_ADDRESS", "PRIVATE_PERSON"]),
    "sourceSpecSha256": spec_sha256,
    "probeSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    "corpusHash": canonical_sha256(corpus), "corpusCount": len(corpus),
    "counts": counts, "metrics": metrics, "resultHash": canonical_sha256(metrics),
    "status": "passed" if all(c == {"tp": 4, "fp": 0, "fn": 0} for c in counts.values()) else "failed",
    "measuredAt": datetime.now(timezone.utc).isoformat(),
    "runtime": {"python": platform.python_version(), "torch": importlib.metadata.version("torch"), "transformers": importlib.metadata.version("transformers"), "device": "cpu", "threads": 2, "aggregationStrategy": "simple"},
    "rows": [{"id": row["id"], "counts": row["counts"]} for row in rows],
    "attestationIssued": False, "releaseReceiptIssued": False,
}
result["reportHash"] = canonical_sha256(result)
destination = Path(sys.argv[2])
destination.parent.mkdir(parents=True, exist_ok=True)
destination.write_text(json.dumps(result, ensure_ascii=True, sort_keys=True, indent=2) + "\n")
print(json.dumps({key: result[key] for key in ["status", "counts", "metrics", "resultHash", "reportHash", "attestationIssued", "releaseReceiptIssued"]}, ensure_ascii=True))

sys.exit(0 if result["status"] == "passed" else 2)
