import copy
import hashlib
import json
import tarfile
import sys
import unittest
import wave
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixture_tools import canonical_json_bytes, sha256_bytes, verify_fixture  # noqa: E402
from fetch_fixture import extract_archive, fetch_fixture  # noqa: E402


class VerifyFixtureTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.fixture_dir = self.root / "scripts" / "stt" / "fixtures"
        self.reference_dir = self.fixture_dir / "reference"
        self.audio_dir = self.root / "audio"
        self.reference_dir.mkdir(parents=True)
        self.audio_dir.mkdir()
        self.licenses_path = self.fixture_dir / "licenses.json"
        self.manifest_path = self.fixture_dir / "manifest.json"
        self.manifest = self._build_valid_fixture()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write_json(self, path: Path, value: object) -> None:
        path.write_bytes(canonical_json_bytes(value))

    def _write_wav(self, path: Path, seconds: int = 60) -> None:
        sample_rate = 8000
        with wave.open(str(path), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(sample_rate)
            output.writeframes(b"\0\0" * sample_rate * seconds)

    def _build_valid_fixture(self) -> dict:
        sessions = []
        licenses = {"schemaVersion": 1, "fixtureId": "s13-v1", "assets": []}
        for case_number in (1, 2):
            case_id = f"case-{case_number:03d}"
            session_id = f"{case_id}-session-01"
            audio_path = self.audio_dir / f"{session_id}.wav"
            self._write_wav(audio_path)
            reference = {
                "schemaVersion": 1,
                "fixtureId": "s13-v1",
                "caseId": case_id,
                "sessionId": session_id,
                "transcript": "상담 목표를 확인했습니다 지원 계획을 함께 정했습니다",
                "speakerTurns": [
                    {"speaker": "SPEAKER_00", "start": 0.0, "end": 12.0, "text": "상담 목표를 확인했습니다"},
                    {"speaker": "SPEAKER_01", "start": 11.0, "end": 24.0, "text": "지원 계획을 함께 정했습니다"},
                ],
                "silenceRanges": [{"start": 24.0, "end": 60.0}],
                "overlapRanges": [{"start": 11.0, "end": 12.0}],
            }
            reference_path = self.reference_dir / f"{session_id}.json"
            self._write_json(reference_path, reference)
            sessions.append({
                "caseId": case_id,
                "sessionId": session_id,
                "speakerCount": 2,
                "audioPath": f"{session_id}.wav",
                "referencePath": f"reference/{session_id}.json",
                "audioSha256": hashlib.sha256(audio_path.read_bytes()).hexdigest(),
                "transcriptSha256": sha256_bytes(reference["transcript"].encode("utf-8")),
                "speakerTruthSha256": sha256_bytes(canonical_json_bytes(reference["speakerTurns"])),
                "durationSeconds": 60.0,
                "silenceRanges": reference["silenceRanges"],
                "overlapRanges": reference["overlapRanges"],
            })
            licenses["assets"].append({
                "assetId": session_id,
                "tool": "eSpeak NG",
                "toolVersion": "test",
                "toolLicense": "GPL-3.0-or-later",
                "toolSource": "https://github.com/espeak-ng/espeak-ng",
                "spdxLicense": "CC-BY-4.0",
                "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
                "redistributionAllowed": True,
                "attribution": "Synthetic CCC S13 fixture generated with eSpeak NG.",
            })
        self._write_json(self.licenses_path, licenses)
        manifest = {
            "schemaVersion": 1,
            "fixtureId": "s13-v1",
            "sourceType": "synthetic",
            "audioReleaseTag": "s13-fixture-v1",
            "audioArchive": {"name": "s13-fixture-v1.tar.gz", "sha256": "0" * 64},
            "licenseManifestSha256": hashlib.sha256(self.licenses_path.read_bytes()).hexdigest(),
            "sessions": sessions,
            "trainCaseIds": [],
        }
        self._write_json(self.manifest_path, manifest)
        return manifest

    def _rewrite_manifest(self, mutate) -> None:  # noqa: ANN001
        value = copy.deepcopy(self.manifest)
        mutate(value)
        self._write_json(self.manifest_path, value)

    def assert_invalid(self, expected: str) -> None:
        with self.assertRaisesRegex(ValueError, expected):
            verify_fixture(self.manifest_path, self.audio_dir, expected_session_count=2)

    def test_valid_fixture_emits_privacy_safe_pass_receipt(self) -> None:
        receipt = verify_fixture(self.manifest_path, self.audio_dir, expected_session_count=2)
        self.assertEqual(receipt["status"], "PASS")
        self.assertEqual(receipt["sessionCount"], 2)
        self.assertEqual(receipt["twoSpeakerSessionCount"], 2)
        self.assertEqual(receipt["silenceSessionCount"], 2)
        self.assertEqual(receipt["overlapSessionCount"], 2)
        self.assertEqual(receipt["checkedFileCount"], 5)
        self.assertNotIn("transcript", json.dumps(receipt))
        self.assertNotIn("상담", json.dumps(receipt, ensure_ascii=False))

    def test_rejects_missing_session(self) -> None:
        self._rewrite_manifest(lambda value: value["sessions"].pop())
        self.assert_invalid("exactly 2 sessions")

    def test_rejects_wrong_audio_hash(self) -> None:
        self._rewrite_manifest(lambda value: value["sessions"][0].update(audioSha256="f" * 64))
        self.assert_invalid("audioSha256")

    def test_rejects_manifest_duration_outside_contract(self) -> None:
        self._rewrite_manifest(lambda value: value["sessions"][0].update(durationSeconds=59.0))
        self.assert_invalid("60.*180")

    def test_rejects_non_two_speaker_session(self) -> None:
        self._rewrite_manifest(lambda value: value["sessions"][0].update(speakerCount=1))
        self.assert_invalid("speakerCount")

    def test_rejects_missing_silence_or_overlap(self) -> None:
        for field in ("silenceRanges", "overlapRanges"):
            with self.subTest(field=field):
                self._write_json(self.manifest_path, self.manifest)
                self._rewrite_manifest(lambda value, field=field: value["sessions"][0].update({field: []}))
                self.assert_invalid(field)

    def test_rejects_invalid_range(self) -> None:
        self._rewrite_manifest(
            lambda value: value["sessions"][0].update(silenceRanges=[{"start": 61.0, "end": 62.0}]),
        )
        self.assert_invalid("silenceRanges")

    def test_rejects_missing_license_entry(self) -> None:
        licenses = json.loads(self.licenses_path.read_text())
        licenses["assets"].pop()
        self._write_json(self.licenses_path, licenses)
        self._rewrite_manifest(
            lambda value: value.update(
                licenseManifestSha256=hashlib.sha256(self.licenses_path.read_bytes()).hexdigest(),
            ),
        )
        self.assert_invalid("license entry")

    def test_rejects_actual_wav_duration_mismatch(self) -> None:
        self._write_wav(self.audio_dir / "case-001-session-01.wav", seconds=61)
        self._rewrite_manifest(
            lambda value: value["sessions"][0].update(
                audioSha256=hashlib.sha256((self.audio_dir / "case-001-session-01.wav").read_bytes()).hexdigest(),
            ),
        )
        self.assert_invalid("WAV duration")


class FetchFixtureTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.manifest_path = self.root / "manifest.json"
        self.archive_path = self.root / "s13-fixture-v1.tar.gz"
        self.destination = self.root / "audio"
        self.files = {
            "case-001-session-01.wav": b"first audio",
            "case-002-session-01.wav": b"second audio",
        }
        self._write_archive([(name, data, None) for name, data in self.files.items()])
        self.manifest = {
            "fixtureId": "s13-v1",
            "audioReleaseTag": "s13-fixture-v1",
            "audioArchive": {
                "name": self.archive_path.name,
                "sha256": hashlib.sha256(self.archive_path.read_bytes()).hexdigest(),
            },
            "sessions": [
                {
                    "sessionId": Path(name).stem,
                    "audioPath": name,
                    "audioSha256": hashlib.sha256(data).hexdigest(),
                }
                for name, data in self.files.items()
            ],
        }
        self._write_manifest()

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write_manifest(self) -> None:
        self.manifest_path.write_bytes(canonical_json_bytes(self.manifest))

    def _write_archive(self, members: list[tuple[str, bytes, str | None]]) -> None:
        with tarfile.open(self.archive_path, "w:gz") as archive:
            for name, data, link_name in members:
                info = tarfile.TarInfo(name)
                info.mtime = 0
                if link_name is not None:
                    info.type = tarfile.SYMTYPE
                    info.linkname = link_name
                    archive.addfile(info)
                else:
                    info.size = len(data)
                    archive.addfile(info, __import__("io").BytesIO(data))

    def _refresh_archive_hash(self) -> None:
        self.manifest["audioArchive"]["sha256"] = hashlib.sha256(self.archive_path.read_bytes()).hexdigest()
        self._write_manifest()

    def test_valid_archive_extracts_declared_audio(self) -> None:
        extract_archive(self.archive_path, self.manifest_path, self.destination)
        self.assertEqual(
            {path.name: path.read_bytes() for path in self.destination.iterdir()},
            self.files,
        )

    def test_rejects_archive_hash_mismatch(self) -> None:
        self.manifest["audioArchive"]["sha256"] = "f" * 64
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "archive SHA-256"):
            extract_archive(self.archive_path, self.manifest_path, self.destination)

    def test_rejects_unsafe_archive_members(self) -> None:
        unsafe = [
            ("../escape.wav", b"x", None),
            ("/absolute.wav", b"x", None),
            ("case-001-session-01.wav", b"", "target.wav"),
        ]
        for member in unsafe:
            with self.subTest(member=member[0]):
                self._write_archive([(name, data, None) for name, data in self.files.items()] + [member])
                self._refresh_archive_hash()
                with self.assertRaisesRegex(ValueError, "unsafe|unexpected|regular files"):
                    extract_archive(self.archive_path, self.manifest_path, self.destination)
                self.assertFalse(self.destination.exists())

    def test_rejects_missing_or_unexpected_members(self) -> None:
        cases = [
            [("case-001-session-01.wav", self.files["case-001-session-01.wav"], None)],
            [(name, data, None) for name, data in self.files.items()] + [("extra.wav", b"x", None)],
        ]
        for members in cases:
            with self.subTest(names=[member[0] for member in members]):
                self._write_archive(members)
                self._refresh_archive_hash()
                with self.assertRaisesRegex(ValueError, "members"):
                    extract_archive(self.archive_path, self.manifest_path, self.destination)
                self.assertFalse(self.destination.exists())

    def test_failure_preserves_existing_destination(self) -> None:
        self.destination.mkdir()
        sentinel = self.destination / "keep.txt"
        sentinel.write_text("keep")
        self.manifest["audioArchive"]["sha256"] = "f" * 64
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "archive SHA-256"):
            extract_archive(self.archive_path, self.manifest_path, self.destination)
        self.assertEqual(sentinel.read_text(), "keep")

    def test_rejects_release_tag_mismatch_before_local_extract(self) -> None:
        with self.assertRaisesRegex(ValueError, "release tag"):
            fetch_fixture(
                self.manifest_path,
                "wrong-tag",
                self.destination,
                archive_path=self.archive_path,
            )


if __name__ == "__main__":
    unittest.main()
