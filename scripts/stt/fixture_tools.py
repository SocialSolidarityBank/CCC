from __future__ import annotations

import hashlib
import json
import math
import re
import wave
from pathlib import Path
from typing import Any

SESSION_ID = re.compile(r"^(case-\d{3})-session-(\d{2})$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def canonical_json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"invalid JSON file: {path}") from error
    if not isinstance(value, dict):
        raise ValueError(f"JSON root must be an object: {path}")
    return value


def _require_sha256(value: object, field: str) -> str:
    if not isinstance(value, str) or not SHA256.fullmatch(value):
        raise ValueError(f"{field} must be lowercase SHA-256")
    return value


def _validate_ranges(value: object, field: str, duration: float) -> list[dict[str, float]]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field} must contain at least one range")
    ranges: list[dict[str, float]] = []
    previous_end = -1.0
    for index, raw in enumerate(value):
        if not isinstance(raw, dict) or set(raw) != {"start", "end"}:
            raise ValueError(f"{field}[{index}] must have start/end only")
        start = raw["start"]
        end = raw["end"]
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            raise ValueError(f"{field}[{index}] boundaries must be numeric")
        start = float(start)
        end = float(end)
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or end <= start or end > duration:
            raise ValueError(f"{field}[{index}] is outside session duration")
        if start < previous_end:
            raise ValueError(f"{field} must be sorted and non-overlapping")
        ranges.append({"start": start, "end": end})
        previous_end = end
    return ranges


def _wav_duration(path: Path) -> float:
    try:
        with wave.open(str(path), "rb") as source:
            if source.getnchannels() != 1 or source.getsampwidth() != 2:
                raise ValueError(f"WAV must be mono signed 16-bit PCM: {path.name}")
            frame_rate = source.getframerate()
            if frame_rate <= 0:
                raise ValueError(f"WAV frame rate must be positive: {path.name}")
            return source.getnframes() / frame_rate
    except (OSError, wave.Error) as error:
        raise ValueError(f"invalid WAV file: {path.name}") from error


def verify_fixture(
    manifest_path: Path,
    audio_dir: Path,
    *,
    expected_session_count: int = 150,
) -> dict[str, object]:
    manifest_path = manifest_path.resolve()
    fixture_dir = manifest_path.parent
    manifest = read_json(manifest_path)
    if manifest.get("schemaVersion") != 1 or manifest.get("fixtureId") != "s13-v1":
        raise ValueError("manifest must declare schemaVersion 1 and fixtureId s13-v1")
    if manifest.get("sourceType") != "synthetic" or manifest.get("trainCaseIds") != []:
        raise ValueError("manifest must be synthetic and test-only")
    if manifest.get("audioReleaseTag") != "s13-fixture-v1":
        raise ValueError("audioReleaseTag must be s13-fixture-v1")

    archive = manifest.get("audioArchive")
    if not isinstance(archive, dict) or set(archive) != {"name", "sha256"}:
        raise ValueError("audioArchive must contain name and sha256")
    if archive["name"] != "s13-fixture-v1.tar.gz":
        raise ValueError("audioArchive name must be s13-fixture-v1.tar.gz")
    _require_sha256(archive["sha256"], "audioArchive.sha256")

    sessions = manifest.get("sessions")
    if not isinstance(sessions, list) or len(sessions) != expected_session_count:
        raise ValueError(f"manifest must contain exactly {expected_session_count} sessions")

    licenses_path = fixture_dir / "licenses.json"
    expected_license_hash = _require_sha256(manifest.get("licenseManifestSha256"), "licenseManifestSha256")
    if not licenses_path.is_file() or sha256_file(licenses_path) != expected_license_hash:
        raise ValueError("licenseManifestSha256 does not match licenses.json")
    licenses = read_json(licenses_path)
    if licenses.get("schemaVersion") != 1 or licenses.get("fixtureId") != "s13-v1":
        raise ValueError("licenses.json must match fixture s13-v1")
    assets = licenses.get("assets")
    if not isinstance(assets, list):
        raise ValueError("licenses.json assets must be an array")
    license_by_id: dict[str, dict[str, Any]] = {}
    for asset in assets:
        if not isinstance(asset, dict) or not isinstance(asset.get("assetId"), str):
            raise ValueError("invalid license entry")
        asset_id = asset["assetId"]
        if asset_id in license_by_id:
            raise ValueError(f"duplicate license entry: {asset_id}")
        if asset.get("redistributionAllowed") is not True or not asset.get("spdxLicense") or not asset.get("licenseUrl"):
            raise ValueError(f"incomplete license entry: {asset_id}")
        license_by_id[asset_id] = asset

    seen_sessions: set[str] = set()
    seen_pairs: set[tuple[str, str]] = set()
    durations: list[float] = []
    silence_count = 0
    overlap_count = 0
    for index, session in enumerate(sessions):
        if not isinstance(session, dict):
            raise ValueError(f"sessions[{index}] must be an object")
        session_id = session.get("sessionId")
        case_id = session.get("caseId")
        match = SESSION_ID.fullmatch(session_id) if isinstance(session_id, str) else None
        if match is None or case_id != match.group(1):
            raise ValueError(f"invalid case/session ID at sessions[{index}]")
        pair = (case_id, session_id)
        if session_id in seen_sessions or pair in seen_pairs:
            raise ValueError(f"duplicate session: {session_id}")
        seen_sessions.add(session_id)
        seen_pairs.add(pair)
        if session.get("speakerCount") != 2:
            raise ValueError(f"speakerCount must be 2: {session_id}")
        duration = session.get("durationSeconds")
        if not isinstance(duration, (int, float)) or not 60 <= float(duration) <= 180:
            raise ValueError(f"durationSeconds must be within 60 and 180: {session_id}")
        duration = float(duration)
        silence_ranges = _validate_ranges(session.get("silenceRanges"), "silenceRanges", duration)
        overlap_ranges = _validate_ranges(session.get("overlapRanges"), "overlapRanges", duration)
        silence_count += 1
        overlap_count += 1

        audio_path_value = session.get("audioPath")
        reference_path_value = session.get("referencePath")
        if audio_path_value != f"{session_id}.wav" or reference_path_value != f"reference/{session_id}.json":
            raise ValueError(f"unexpected file path for {session_id}")
        audio_path = audio_dir / audio_path_value
        reference_path = fixture_dir / reference_path_value
        if not audio_path.is_file() or sha256_file(audio_path) != _require_sha256(session.get("audioSha256"), "audioSha256"):
            raise ValueError(f"audioSha256 mismatch: {session_id}")
        actual_duration = _wav_duration(audio_path)
        if abs(actual_duration - duration) > 0.001:
            raise ValueError(f"WAV duration mismatch: {session_id}")
        if not reference_path.is_file():
            raise ValueError(f"missing reference file: {session_id}")
        reference = read_json(reference_path)
        if reference.get("fixtureId") != "s13-v1" or reference.get("caseId") != case_id or reference.get("sessionId") != session_id:
            raise ValueError(f"reference identity mismatch: {session_id}")
        transcript = reference.get("transcript")
        turns = reference.get("speakerTurns")
        if not isinstance(transcript, str) or not transcript.strip() or not isinstance(turns, list) or not turns:
            raise ValueError(f"reference transcript/speakerTurns missing: {session_id}")
        speakers = {turn.get("speaker") for turn in turns if isinstance(turn, dict)}
        if speakers != {"SPEAKER_00", "SPEAKER_01"}:
            raise ValueError(f"speaker truth must contain two fixed labels: {session_id}")
        if reference.get("silenceRanges") != silence_ranges or reference.get("overlapRanges") != overlap_ranges:
            raise ValueError(f"reference ranges mismatch: {session_id}")
        if sha256_bytes(transcript.encode("utf-8")) != _require_sha256(session.get("transcriptSha256"), "transcriptSha256"):
            raise ValueError(f"transcriptSha256 mismatch: {session_id}")
        if sha256_bytes(canonical_json_bytes(turns)) != _require_sha256(session.get("speakerTruthSha256"), "speakerTruthSha256"):
            raise ValueError(f"speakerTruthSha256 mismatch: {session_id}")
        if session_id not in license_by_id:
            raise ValueError(f"missing license entry: {session_id}")
        durations.append(duration)

    if set(license_by_id) != seen_sessions:
        raise ValueError("license entries must match manifest sessions exactly")
    return {
        "fixtureId": "s13-v1",
        "manifestSha256": sha256_file(manifest_path),
        "sessionCount": len(sessions),
        "minDurationSeconds": min(durations),
        "maxDurationSeconds": max(durations),
        "totalDurationSeconds": sum(durations),
        "twoSpeakerSessionCount": len(sessions),
        "silenceSessionCount": silence_count,
        "overlapSessionCount": overlap_count,
        "licenseManifestSha256": expected_license_hash,
        "checkedFileCount": len(sessions) * 2 + 1,
        "status": "PASS",
    }
