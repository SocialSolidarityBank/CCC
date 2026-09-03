#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import tarfile
import tempfile
import urllib.request
from pathlib import Path, PurePosixPath

from fixture_tools import read_json, sha256_file

REPOSITORY = "SocialSolidarityBank/CCC"


def _declared_audio(manifest: dict) -> dict[str, str]:
    sessions = manifest.get("sessions")
    if not isinstance(sessions, list) or not sessions:
        raise ValueError("manifest sessions must be a non-empty array")
    declared: dict[str, str] = {}
    for session in sessions:
        if not isinstance(session, dict):
            raise ValueError("manifest session must be an object")
        path = session.get("audioPath")
        digest = session.get("audioSha256")
        if not isinstance(path, str) or not isinstance(digest, str) or path in declared:
            raise ValueError("manifest audio paths and hashes must be unique strings")
        declared[path] = digest
    return declared


def extract_archive(archive_path: Path, manifest_path: Path, audio_dir: Path) -> None:
    manifest = read_json(manifest_path)
    archive_contract = manifest.get("audioArchive")
    if not isinstance(archive_contract, dict):
        raise ValueError("manifest audioArchive is required")
    expected_hash = archive_contract.get("sha256")
    if not isinstance(expected_hash, str) or sha256_file(archive_path) != expected_hash:
        raise ValueError("archive SHA-256 mismatch")
    declared = _declared_audio(manifest)

    audio_dir = audio_dir.resolve()
    audio_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f".{audio_dir.name}-", dir=audio_dir.parent) as temp_name:
        temp_dir = Path(temp_name)
        with tarfile.open(archive_path, "r:gz") as archive:
            members = archive.getmembers()
            names: set[str] = set()
            for member in members:
                path = PurePosixPath(member.name)
                if path.is_absolute() or ".." in path.parts:
                    raise ValueError(f"unsafe archive member: {member.name}")
                if not member.isfile():
                    raise ValueError(f"archive members must be regular files: {member.name}")
                if member.name in names:
                    raise ValueError(f"duplicate archive member: {member.name}")
                names.add(member.name)
            if names != set(declared):
                raise ValueError("archive members do not match manifest")
            for member in members:
                source = archive.extractfile(member)
                if source is None:
                    raise ValueError(f"archive member is unreadable: {member.name}")
                target = temp_dir / member.name
                with source, target.open("wb") as output:
                    shutil.copyfileobj(source, output, length=1024 * 1024)
                if sha256_file(target) != declared[member.name]:
                    raise ValueError(f"audio SHA-256 mismatch: {member.name}")

        backup = audio_dir.with_name(f".{audio_dir.name}-previous")
        if backup.exists():
            shutil.rmtree(backup)
        if audio_dir.exists():
            os.replace(audio_dir, backup)
        try:
            os.replace(temp_dir, audio_dir)
        except Exception:
            if backup.exists() and not audio_dir.exists():
                os.replace(backup, audio_dir)
            raise
        if backup.exists():
            shutil.rmtree(backup)


def _download_release_archive(manifest: dict, release_tag: str, destination: Path) -> None:
    url = f"https://api.github.com/repos/{REPOSITORY}/releases/tags/{release_tag}"
    request = urllib.request.Request(url, headers={"Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
        release = json.load(response)
    archive_name = manifest["audioArchive"]["name"]
    assets = [asset for asset in release.get("assets", []) if asset.get("name") == archive_name]
    if len(assets) != 1:
        raise ValueError(f"release must contain exactly one {archive_name} asset")
    download = urllib.request.Request(
        assets[0]["browser_download_url"],
        headers={"Accept": "application/octet-stream"},
    )
    with urllib.request.urlopen(download, timeout=60) as response, destination.open("wb") as output:  # noqa: S310
        shutil.copyfileobj(response, output, length=1024 * 1024)


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
    archive_contract = manifest.get("audioArchive")
    if not isinstance(archive_contract, dict) or not isinstance(archive_contract.get("name"), str):
        raise ValueError("manifest audioArchive is invalid")
    if archive_path is not None:
        extract_archive(archive_path, manifest_path, audio_dir)
        return
    with tempfile.TemporaryDirectory(prefix="s13-fixture-download-") as temp_name:
        archive = Path(temp_name) / archive_contract["name"]
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
