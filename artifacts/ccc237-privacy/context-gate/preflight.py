"""Synthetic experiment preflight. Never loads models or exposes credentials."""
from __future__ import annotations

import hashlib
import json
import platform
import subprocess
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
WEIGHTS = Path.home() / ".cache/ccc-privacy-tests/Qwen3-4B-Instruct-2507-Q4_K_M.gguf"


def memory_state():
    if platform.system() != "Darwin":
        return {"status": "unsupported_host", "modelLoadAllowed": False}
    pressure = int(subprocess.check_output(
        ["sysctl", "-n", "kern.memorystatus_vm_pressure_level"], text=True).strip())
    swap = subprocess.check_output(["sysctl", "-n", "vm.swapusage"], text=True).strip()
    return {"status": "measured", "pressureLevel": pressure, "swap": swap,
            "modelLoadAllowed": pressure == 1,
            "policy": "Load only at normal Darwin VM pressure (1); never close unrelated applications."}


def main():
    design = json.loads((HERE / "measurement-design.json").read_text())
    expected = design["localCandidate"]
    weight = {"status": "absent"}
    if WEIGHTS.exists():
        size = WEIGHTS.stat().st_size
        weight = {"status": "incomplete", "bytes": size}
        if size == expected["bytes"]:
            with WEIGHTS.open("rb") as source:
                digest = hashlib.file_digest(source, "sha256").hexdigest()
            weight.update(status="verified" if digest == expected["sha256"] else "hash_mismatch",
                          sha256=digest)
    report = {"checkedAt": datetime.now(timezone.utc).isoformat(), "host": platform.platform(),
              "weights": weight, "memory": memory_state(),
              "externalArm": design["externalArm"], "inferenceExecuted": False,
              "productChanged": False, "qualificationIssued": False}
    print(json.dumps(report, ensure_ascii=True))


if __name__ == "__main__":
    main()
