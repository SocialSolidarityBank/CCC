#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from fixture_tools import canonical_json_bytes, verify_fixture


def main() -> None:
    parser = argparse.ArgumentParser(description="Verify the CCC S13 synthetic STT fixture.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument(
        "--audio-dir",
        type=Path,
        default=Path("artifacts/pilot/fixtures/s13-v1/audio"),
    )
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    receipt = verify_fixture(args.manifest, args.audio_dir)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(canonical_json_bytes(receipt))
    print(f"S13 fixture verification PASS: {receipt['sessionCount']} sessions")


if __name__ == "__main__":
    main()
