import copy
import hashlib
import io
import json
import tarfile
import sys
import unittest
import wave
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixture_tools import (  # noqa: E402
    canonical_json_bytes,
    sha256_bytes,
    verify_fixture,
    verify_tracked_metadata,
)
from fetch_fixture import MAX_WAV_BYTES, _copy_bounded, extract_archive, fetch_fixture  # noqa: E402
from generate_fixture import (  # noqa: E402
    build_session_plans,
    contains_pii_like,
    generate,
    mix_pcm,
    parse_espeak_details,
    parse_espeak_version,
    plan_timeline,
    validate_espeak_toolchain,
    write_deterministic_archive,
)


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
        self.expected_session_ids = {"case-001-session-01", "case-002-session-01"}

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
        licenses = {
            "schemaVersion": 1,
            "fixtureId": "s13-v1",
            "generator": {
                "deterministicRandom": True,
                "executableSha256": "28ad475cf514f8ff947e87276bf1586fcdc07249bbf2c081678f6f035eaabd64",
                "license": "GPL-3.0-or-later",
                "name": "eSpeak NG",
                "source": "https://github.com/espeak-ng/espeak-ng",
                "version": "1.52.0",
                "voice": "ko with built-in m3/f3 variants",
                "voiceCloning": False,
                "voiceConfig": {
                    "SPEAKER_00": {"pitch": "42", "speed": "155", "voice": "ko+m3"},
                    "SPEAKER_01": {"pitch": "58", "speed": "165", "voice": "ko+f3"},
                },
                "voiceDataSha256": "7cd7c4ffae34fad329d84631288be270db5eeb48446d732db70510c4e7b6b96f",
            },
            "assets": [],
        }
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
                "transcript": "상담 목표를 확인했습니다\n지원 계획을 함께 정했습니다",
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
                "audioSizeBytes": audio_path.stat().st_size,
                "transcriptSha256": sha256_bytes(reference["transcript"].encode("utf-8")),
                "speakerTruthSha256": sha256_bytes(canonical_json_bytes(reference["speakerTurns"])),
                "durationSeconds": 60.0,
                "silenceRanges": reference["silenceRanges"],
                "overlapRanges": reference["overlapRanges"],
            })
            licenses["assets"].append({
                "assetId": session_id,
                "tool": "eSpeak NG",
                "toolVersion": "1.52.0",
                "toolLicense": "GPL-3.0-or-later",
                "toolSource": "https://github.com/espeak-ng/espeak-ng",
                "spdxLicense": "CC-BY-4.0",
                "licenseUrl": "https://creativecommons.org/licenses/by/4.0/",
                "redistributionAllowed": True,
                "attribution": "Synthetic CCC S13 fixture generated with eSpeak NG.",
            })
        self._write_json(self.licenses_path, licenses)
        license_hash = hashlib.sha256(self.licenses_path.read_bytes()).hexdigest()
        for session in sessions:
            session["licenseManifestSha256"] = license_hash
        manifest = {
            "schemaVersion": 1,
            "fixtureId": "s13-v1",
            "sourceType": "synthetic",
            "audioReleaseTag": "s13-fixture-v1",
            "audioArchive": {
                "name": "s13-fixture-v1.tar.gz",
                "sha256": "0" * 64,
                "sizeBytes": 1,
            },
            "licenseManifestSha256": license_hash,
            "sessions": sessions,
            "trainCaseIds": [],
        }
        self._write_json(self.manifest_path, manifest)
        return manifest

    def _rewrite_manifest(self, mutate) -> None:  # noqa: ANN001
        value = copy.deepcopy(self.manifest)
        mutate(value)
        self._write_json(self.manifest_path, value)

    def _rewrite_licenses(self, mutate) -> None:  # noqa: ANN001
        licenses = json.loads(self.licenses_path.read_text())
        mutate(licenses)
        self._write_json(self.licenses_path, licenses)
        license_hash = hashlib.sha256(self.licenses_path.read_bytes()).hexdigest()

        def update_hashes(value: dict) -> None:
            value["licenseManifestSha256"] = license_hash
            for session in value["sessions"]:
                session["licenseManifestSha256"] = license_hash

        self._rewrite_manifest(update_hashes)

    def assert_invalid(self, expected: str) -> None:
        with self.assertRaisesRegex(ValueError, expected):
            verify_fixture(
                self.manifest_path,
                self.audio_dir,
                expected_session_count=2,
                expected_session_ids=self.expected_session_ids,
            )

    def test_valid_fixture_emits_privacy_safe_pass_receipt(self) -> None:
        receipt = verify_fixture(
            self.manifest_path,
            self.audio_dir,
            expected_session_count=2,
            expected_session_ids=self.expected_session_ids,
        )
        self.assertEqual(receipt["status"], "PASS")
        self.assertEqual(receipt["sessionCount"], 2)
        self.assertEqual(receipt["archiveSha256"], "0" * 64)
        self.assertEqual(receipt["audioReleaseTag"], "s13-fixture-v1")
        self.assertEqual(receipt["audioArchiveName"], "s13-fixture-v1.tar.gz")
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

    def test_rejects_wrong_case_session_matrix(self) -> None:
        def replace_last_session(value: dict) -> None:
            value["sessions"][-1]["caseId"] = "case-029"
            value["sessions"][-1]["sessionId"] = "case-029-session-06"

        self._rewrite_manifest(replace_last_session)
        self.assert_invalid("case/session matrix")

    def test_rejects_ranges_that_disagree_with_speaker_truth(self) -> None:
        session = self.manifest["sessions"][0]
        reference_path = self.fixture_dir / session["referencePath"]
        reference = json.loads(reference_path.read_text())
        wrong_overlap = [{"start": 10.0, "end": 11.0}]
        reference["overlapRanges"] = wrong_overlap
        self._write_json(reference_path, reference)

        def replace_overlap(value: dict) -> None:
            value["sessions"][0]["overlapRanges"] = wrong_overlap

        self._rewrite_manifest(replace_overlap)
        self.assert_invalid("overlapRanges.*speaker truth")

    def test_rejects_speaker_turn_outside_duration(self) -> None:
        session = self.manifest["sessions"][0]
        reference_path = self.fixture_dir / session["referencePath"]
        reference = json.loads(reference_path.read_text())
        reference["speakerTurns"][1]["end"] = 61.0
        self._write_json(reference_path, reference)

        def replace_speaker_hash(value: dict) -> None:
            value["sessions"][0]["speakerTruthSha256"] = sha256_bytes(
                canonical_json_bytes(reference["speakerTurns"]),
            )

        self._rewrite_manifest(replace_speaker_hash)
        self.assert_invalid("speakerTurns.*duration")

    def test_rejects_transcript_that_differs_from_ordered_turn_text(self) -> None:
        session = self.manifest["sessions"][0]
        reference_path = self.fixture_dir / session["referencePath"]
        reference = json.loads(reference_path.read_text())
        reference["transcript"] = "서로 관련 없는 정답 문장"
        self._write_json(reference_path, reference)

        def replace_transcript_hash(value: dict) -> None:
            value["sessions"][0]["transcriptSha256"] = sha256_bytes(
                reference["transcript"].encode("utf-8"),
            )

        self._rewrite_manifest(replace_transcript_hash)
        self.assert_invalid("transcript.*speaker turn")

    def test_rejects_invalid_range(self) -> None:
        self._rewrite_manifest(
            lambda value: value["sessions"][0].update(silenceRanges=[{"start": 61.0, "end": 62.0}]),
        )
        self.assert_invalid("silenceRanges")

    def test_rejects_missing_license_entry(self) -> None:
        licenses = json.loads(self.licenses_path.read_text())
        licenses["assets"].pop()
        self._write_json(self.licenses_path, licenses)
        license_hash = hashlib.sha256(self.licenses_path.read_bytes()).hexdigest()

        def update_hashes(value: dict) -> None:
            value["licenseManifestSha256"] = license_hash
            for session in value["sessions"]:
                session["licenseManifestSha256"] = license_hash

        self._rewrite_manifest(update_hashes)
        self.assert_invalid("license entry")

    def test_rejects_missing_generator_license_provenance(self) -> None:
        self._rewrite_licenses(lambda value: value["generator"].pop("voiceDataSha256"))
        self.assert_invalid("generator license provenance")

    def test_rejects_incomplete_asset_license_provenance(self) -> None:
        self._rewrite_licenses(lambda value: value["assets"][0].pop("attribution"))
        self.assert_invalid("asset license provenance")

    def test_rejects_session_license_hash_mismatch(self) -> None:
        self._rewrite_manifest(
            lambda value: value["sessions"][0].update(licenseManifestSha256="f" * 64),
        )
        self.assert_invalid("session licenseManifestSha256")

    def test_rejects_actual_wav_duration_mismatch(self) -> None:
        self._write_wav(self.audio_dir / "case-001-session-01.wav", seconds=61)
        self._rewrite_manifest(
            lambda value: value["sessions"][0].update(
                audioSha256=hashlib.sha256((self.audio_dir / "case-001-session-01.wav").read_bytes()).hexdigest(),
                audioSizeBytes=(self.audio_dir / "case-001-session-01.wav").stat().st_size,
            ),
        )
        self.assert_invalid("WAV duration")


class TrackedFixtureMetadataTest(unittest.TestCase):
    def test_checked_in_manifest_references_licenses_and_receipt_agree(self) -> None:
        repo_root = Path(__file__).resolve().parents[3]
        receipt = verify_tracked_metadata(
            repo_root / "scripts/stt/fixtures/manifest.json",
            repo_root / "artifacts/pilot/fixtures/s13-v1-verification.json",
        )
        self.assertEqual(receipt["status"], "PASS")
        self.assertEqual(receipt["sessionCount"], 150)


class GenerateFixturePlanTest(unittest.TestCase):
    def test_builds_exact_deterministic_case_session_matrix(self) -> None:
        first = build_session_plans()
        second = build_session_plans()
        self.assertEqual(first, second)
        self.assertEqual(len(first), 150)
        self.assertEqual({plan["caseId"] for plan in first}, {f"case-{number:03d}" for number in range(1, 31)})
        self.assertEqual(
            {plan["sessionId"] for plan in first},
            {
                f"case-{case_number:03d}-session-{session_number:02d}"
                for case_number in range(1, 31)
                for session_number in range(1, 6)
            },
        )

    def test_every_session_has_two_korean_speakers_silence_and_overlap(self) -> None:
        for plan in build_session_plans():
            with self.subTest(session=plan["sessionId"]):
                turns = plan["turns"]
                self.assertEqual({turn["speaker"] for turn in turns}, {"SPEAKER_00", "SPEAKER_01"})
                self.assertGreaterEqual(len(turns), 16)
                self.assertTrue(any(turn["gapAfterSeconds"] >= 1.0 for turn in turns))
                self.assertTrue(any(turn["overlapPreviousSeconds"] > 0 for turn in turns))
                for turn in turns:
                    self.assertRegex(turn["text"], r"[가-힣]")
                    self.assertTrue(turn["text"].strip())
                    self.assertFalse(contains_pii_like(turn["text"]))

    def test_pii_guard_detects_phone_email_resident_and_account_patterns(self) -> None:
        for text in (
            "전화번호는 010-1234-5678입니다",
            "메일은 person@example.kr입니다",
            "식별번호는 900101-1234567입니다",
            "계좌는 123-456789-01입니다",
        ):
            with self.subTest(text=text):
                self.assertTrue(contains_pii_like(text))
        self.assertFalse(contains_pii_like("다음 회차에는 지출 계획을 다시 확인합니다"))

    def test_timeline_is_sample_based_with_declared_silence_and_overlap(self) -> None:
        plan = build_session_plans()[0]
        timeline = plan_timeline(
            plan["turns"],
            [20] * len(plan["turns"]),
            sample_rate=10,
            minimum_seconds=60,
        )
        self.assertAlmostEqual(
            timeline["overlapRanges"][0]["end"] - timeline["overlapRanges"][0]["start"],
            0.2,
        )
        self.assertEqual(timeline["totalSamples"], 600)
        self.assertEqual(timeline["durationSeconds"], 60.0)
        self.assertGreaterEqual(len(timeline["silenceRanges"]), 1)
        self.assertGreaterEqual(len(timeline["overlapRanges"]), 1)
        self.assertEqual(
            {turn["speaker"] for turn in timeline["speakerTurns"]},
            {"SPEAKER_00", "SPEAKER_01"},
        )

    def test_pcm_mixer_adds_and_clamps_samples(self) -> None:
        mixed = mix_pcm([[30_000, -30_000], [10_000, -10_000]], [0, 0], total_samples=2)
        self.assertEqual(list(mixed), [32_767, -32_768])

    def test_archive_bytes_ignore_source_mtime_and_iteration_order(self) -> None:
        with TemporaryDirectory() as temp:
            root = Path(temp)
            audio = root / "audio"
            audio.mkdir()
            (audio / "b.wav").write_bytes(b"second")
            (audio / "a.wav").write_bytes(b"first")
            first = root / "first.tar.gz"
            second = root / "second.tar.gz"
            write_deterministic_archive(audio, first, ["b.wav", "a.wav"])
            (audio / "a.wav").touch()
            write_deterministic_archive(audio, second, ["a.wav", "b.wav"])
            self.assertEqual(first.read_bytes(), second.read_bytes())

    def test_espeak_version_parser_drops_local_data_path(self) -> None:
        self.assertEqual(
            parse_espeak_version(
                "eSpeak NG text-to-speech: 1.52.0  Data at: /opt/homebrew/share/espeak-ng-data",
            ),
            "1.52.0",
        )

    def test_espeak_details_parser_returns_version_and_data_path(self) -> None:
        self.assertEqual(
            parse_espeak_details(
                "eSpeak NG text-to-speech: 1.52.0  Data at: /opt/homebrew/share/espeak-ng-data",
            ),
            ("1.52.0", Path("/opt/homebrew/share/espeak-ng-data")),
        )

    def test_s13_v1_rejects_unpinned_espeak_toolchain(self) -> None:
        valid = (
            "1.52.0",
            "28ad475cf514f8ff947e87276bf1586fcdc07249bbf2c081678f6f035eaabd64",
            "7cd7c4ffae34fad329d84631288be270db5eeb48446d732db70510c4e7b6b96f",
        )
        validate_espeak_toolchain(*valid)
        for changed in (
            ("1.53.0", valid[1], valid[2]),
            (valid[0], "f" * 64, valid[2]),
            (valid[0], valid[1], "f" * 64),
        ):
            with self.subTest(changed=changed):
                with self.assertRaisesRegex(ValueError, "new fixture version"):
                    validate_espeak_toolchain(*changed)

    def test_generate_rejects_unpinned_executable_before_running_it(self) -> None:
        with TemporaryDirectory() as temp_name:
            root = Path(temp_name)
            executable = root / "espeak-ng"
            executable.write_bytes(b"untrusted executable")
            with patch("generate_fixture._espeak_details") as details:
                with self.assertRaisesRegex(ValueError, "new fixture version"):
                    generate(
                        root / "fixtures",
                        root / "audio",
                        root / "fixture.tar.gz",
                        executable,
                    )
                details.assert_not_called()


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
                "sizeBytes": self.archive_path.stat().st_size,
            },
            "sessions": [
                {
                    "sessionId": Path(name).stem,
                    "audioPath": name,
                    "audioSha256": hashlib.sha256(data).hexdigest(),
                    "audioSizeBytes": len(data),
                }
                for name, data in self.files.items()
            ],
        }
        self.base_manifest = copy.deepcopy(self.manifest)
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
        self.manifest["audioArchive"]["sizeBytes"] = self.archive_path.stat().st_size
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

    def test_rejects_noncanonical_manifest_path(self) -> None:
        self.manifest["sessions"][0]["audioPath"] = "./case-001-session-01.wav"
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "canonical basename"):
            extract_archive(self.archive_path, self.manifest_path, self.destination)

    def test_rejects_wrong_archive_or_member_size(self) -> None:
        mutations = (
            lambda: self.manifest["audioArchive"].update(sizeBytes=self.archive_path.stat().st_size + 1),
            lambda: self.manifest["sessions"][0].update(audioSizeBytes=len(self.files["case-001-session-01.wav"]) + 1),
        )
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                mutate()
                self._write_manifest()
                with self.assertRaisesRegex(ValueError, "size"):
                    extract_archive(self.archive_path, self.manifest_path, self.destination)
                self.manifest = copy.deepcopy(self.base_manifest)

    def test_rejects_member_over_fixed_size_limit(self) -> None:
        oversized = b"x" * (MAX_WAV_BYTES + 1)
        self.files = {"case-001-session-01.wav": oversized}
        self._write_archive([("case-001-session-01.wav", oversized, None)])
        self.manifest["audioArchive"].update(
            sha256=hashlib.sha256(self.archive_path.read_bytes()).hexdigest(),
            sizeBytes=self.archive_path.stat().st_size,
        )
        self.manifest["sessions"] = [{
            "sessionId": "case-001-session-01",
            "audioPath": "case-001-session-01.wav",
            "audioSha256": hashlib.sha256(oversized).hexdigest(),
            "audioSizeBytes": len(oversized),
        }]
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "size limit"):
            extract_archive(self.archive_path, self.manifest_path, self.destination)

    def test_bounded_copy_rejects_extra_bytes_before_writing_them(self) -> None:
        output = io.BytesIO()
        with self.assertRaisesRegex(ValueError, "byte limit"):
            _copy_bounded(io.BytesIO(b"too long"), output, max_bytes=3, expected_size=None)
        self.assertLessEqual(len(output.getvalue()), 3)

    def test_rejects_missing_or_unexpected_members(self) -> None:
        cases = [
            [("case-001-session-01.wav", self.files["case-001-session-01.wav"], None)],
            [(name, data, None) for name, data in self.files.items()] + [("extra.wav", b"x", None)],
        ]
        for members in cases:
            with self.subTest(names=[member[0] for member in members]):
                self._write_archive(members)
                self._refresh_archive_hash()
                with self.assertRaisesRegex(ValueError, "member"):
                    extract_archive(self.archive_path, self.manifest_path, self.destination)
                self.assertFalse(self.destination.exists())

    def test_failure_preserves_existing_destination(self) -> None:
        self.destination.mkdir()
        sentinel = self.destination / "keep.txt"
        sentinel.write_text("keep")
        self.manifest["audioArchive"]["sha256"] = "f" * 64
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "destination already exists"):
            extract_archive(self.archive_path, self.manifest_path, self.destination)
        self.assertEqual(sentinel.read_text(), "keep")

    def test_valid_archive_refuses_existing_destination(self) -> None:
        self.destination.mkdir()
        sentinel = self.destination / "keep.txt"
        sentinel.write_text("keep")
        with self.assertRaisesRegex(ValueError, "destination already exists"):
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
