#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import tarfile
import tempfile
import unicodedata
import urllib.request
from pathlib import Path, PurePosixPath
from typing import BinaryIO

from fixture_tools import MAX_ARCHIVE_BYTES, MAX_EXTRACTED_BYTES, MAX_WAV_BYTES, read_json

REPOSITORY = "SocialSolidarityBank/CCC"
MAX_RELEASE_JSON_BYTES = 1_000_000


def _copy_bounded(
    source: BinaryIO,
    output: BinaryIO,
    *,
    max_bytes: int,
    expected_size: int | None,
) -> tuple[int, str]:
    digest = hashlib.sha256()
    total = 0
    while True:
        chunk = source.read(min(1024 * 1024, max_bytes - total + 1))
        if not chunk:
            break
        if total + len(chunk) > max_bytes:
            raise ValueError("input exceeds byte limit")
        output.write(chunk)
        digest.update(chunk)
        total += len(chunk)
    if expected_size is not None and total != expected_size:
        raise ValueError(f"input size mismatch: expected {expected_size}, received {total}")
    return total, digest.hexdigest()


def _canonical_audio_name(value: object, session_id: object) -> str:
    if not isinstance(value, str) or not isinstance(session_id, str):
        raise ValueError("manifest audio path and session ID must be strings")
    path = PurePosixPath(value)
    if (
        value != path.name
        or value != unicodedata.normalize("NFC", value)
        or "/" in value
        or "\\" in value
        or value != f"{session_id}.wav"
    ):
        raise ValueError(f"audioPath must be the canonical basename for {session_id}")
    return value


def _declared_audio(manifest: dict) -> dict[str, tuple[str, int]]:
    sessions = manifest.get("sessions")
    if not isinstance(sessions, list) or not sessions:
        raise ValueError("manifest sessions must be a non-empty array")
    declared: dict[str, tuple[str, int]] = {}
    casefolded: set[str] = set()
    for session in sessions:
        if not isinstance(session, dict):
            raise ValueError("manifest session must be an object")
        path = _canonical_audio_name(session.get("audioPath"), session.get("sessionId"))
        digest = session.get("audioSha256")
        size = session.get("audioSizeBytes")
        if not isinstance(digest, str) or len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
            raise ValueError(f"manifest audio hash is invalid: {path}")
        if not isinstance(size, int) or not 0 < size <= MAX_WAV_BYTES:
            raise ValueError(f"audio size limit exceeded: {path}")
        folded = path.casefold()
        if path in declared or folded in casefolded:
            raise ValueError(f"manifest audio paths must be unique: {path}")
        declared[path] = (digest, size)
        casefolded.add(folded)
    return declared


def _archive_contract(manifest: dict) -> dict:
    contract = manifest.get("audioArchive")
    if not isinstance(contract, dict) or set(contract) != {"name", "sha256", "sizeBytes"}:
        raise ValueError("manifest audioArchive must contain name, sha256, and sizeBytes")
    if contract["name"] != "s13-fixture-v1.tar.gz":
        raise ValueError("manifest archive name is invalid")
    if not isinstance(contract["sizeBytes"], int) or not 0 < contract["sizeBytes"] <= MAX_ARCHIVE_BYTES:
        raise ValueError("archive size limit exceeded")
    digest = contract["sha256"]
    if not isinstance(digest, str) or len(digest) != 64 or any(character not in "0123456789abcdef" for character in digest):
        raise ValueError("manifest archive SHA-256 is invalid")
    return contract


def extract_archive(archive_path: Path, manifest_path: Path, audio_dir: Path) -> None:
    manifest = read_json(manifest_path)
    contract = _archive_contract(manifest)
    declared = _declared_audio(manifest)
    archive_path = archive_path.resolve()
    if archive_path.stat().st_size != contract["sizeBytes"]:
        raise ValueError("archive size mismatch")

    audio_dir = audio_dir.resolve()
    if audio_dir.exists():
        raise ValueError(f"destination already exists: {audio_dir}")
    audio_dir.parent.mkdir(parents=True, exist_ok=True)

    with archive_path.open("rb") as raw:
        digest = hashlib.sha256()
        remaining = contract["sizeBytes"]
        while remaining:
            chunk = raw.read(min(1024 * 1024, remaining))
            if not chunk:
                raise ValueError("archive ended before declared size")
            digest.update(chunk)
            remaining -= len(chunk)
        if raw.read(1):
            raise ValueError("archive exceeds declared size")
        if digest.hexdigest() != contract["sha256"]:
            raise ValueError("archive SHA-256 mismatch")
        raw.seek(0)

        with tempfile.TemporaryDirectory(prefix=f".{audio_dir.name}-", dir=audio_dir.parent) as temp_name:
            temp_dir = Path(temp_name)
            with tarfile.open(fileobj=raw, mode="r:gz") as archive:
                members = archive.getmembers()
                names: set[str] = set()
                casefolded: set[str] = set()
                total_size = 0
                for member in members:
                    path = PurePosixPath(member.name)
                    if (
                        member.name != path.name
                        or member.name != unicodedata.normalize("NFC", member.name)
                        or path.is_absolute()
                        or ".." in path.parts
                        or "/" in member.name
                        or "\\" in member.name
                    ):
                        raise ValueError(f"unsafe archive member: {member.name}")
                    if not member.isfile():
                        raise ValueError(f"archive members must be regular files: {member.name}")
                    folded = member.name.casefold()
                    if member.name in names or folded in casefolded:
                        raise ValueError(f"duplicate archive member: {member.name}")
                    if member.name not in declared or member.size != declared[member.name][1]:
                        raise ValueError(f"archive member size mismatch: {member.name}")
                    total_size += member.size
                    if total_size > MAX_EXTRACTED_BYTES:
                        raise ValueError("extracted fixture exceeds size limit")
                    names.add(member.name)
                    casefolded.add(folded)
                if names != set(declared):
                    raise ValueError("archive members do not match manifest")

                for member in members:
                    source = archive.extractfile(member)
                    if source is None:
                        raise ValueError(f"archive member is unreadable: {member.name}")
                    target = temp_dir / member.name
                    with source, target.open("wb") as output:
                        _, member_hash = _copy_bounded(
                            source,
                            output,
                            max_bytes=declared[member.name][1],
                            expected_size=declared[member.name][1],
                        )
                    if member_hash != declared[member.name][0]:
                        raise ValueError(f"audio SHA-256 mismatch: {member.name}")
            os.replace(temp_dir, audio_dir)


def _download_release_archive(manifest: dict, release_tag: str, destination: Path) -> None:
    contract = _archive_contract(manifest)
    url = f"https://api.github.com/repos/{REPOSITORY}/releases/tags/{release_tag}"
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        raw_release = response.read(MAX_RELEASE_JSON_BYTES + 1)
    if len(raw_release) > MAX_RELEASE_JSON_BYTES:
        raise ValueError("release metadata exceeds byte limit")
    release = json.loads(raw_release)
    assets = [asset for asset in release.get("assets", []) if asset.get("name") == contract["name"]]
    if len(assets) != 1 or assets[0].get("size") != contract["sizeBytes"]:
        raise ValueError(f"release must contain one size-matched {contract['name']} asset")
    download = urllib.request.Request(
        assets[0]["browser_download_url"],
        headers={"Accept": "application/octet-stream"},
    )
    with urllib.request.urlopen(download, timeout=60) as response, destination.open("wb") as output:  # noqa: S310
        content_length = response.headers.get("Content-Length")
        if content_length is not None and int(content_length) != contract["sizeBytes"]:
            raise ValueError("release Content-Length does not match manifest")
        _, digest = _copy_bounded(
            response,
            output,
            max_bytes=contract["sizeBytes"],
            expected_size=contract["sizeBytes"],
        )
    if digest != contract["sha256"]:
        raise ValueError("downloaded archive SHA-256 mismatch")


def fetch_fixture(
    manifest_path: Path,
    release_tag: str,
    audio_dir: Path,
    *,
    archive_path: Path | None = None,
) -> None:
    manifest = read_json(manifest_path)
    if release_tag != manifest.get("audioReleaseTag"):
        raise ValueError("release tag does not match manifest")
    _archive_contract(manifest)
    if archive_path is not None:
        extract_archive(archive_path, manifest_path, audio_dir)
        return
    with tempfile.TemporaryDirectory(prefix="s13-fixture-download-") as temp_name:
        archive = Path(temp_name) / manifest["audioArchive"]["name"]
        _download_release_archive(manifest, release_tag, archive)
        extract_archive(archive, manifest_path, audio_dir)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch the CCC S13 synthetic STT fixture.")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--release-tag", required=True)
    parser.add_argument(
        "--audio-dir",
        type=Path,
        default=Path("artifacts/pilot/fixtures/s13-v1/audio"),
    )
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    fetch_fixture(args.manifest, args.release_tag, args.audio_dir, archive_path=args.archive)
    print(f"S13 fixture fetch PASS: {args.audio_dir}")


if __name__ == "__main__":
    main()
