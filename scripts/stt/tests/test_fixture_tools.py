import copy
import hashlib
import json
import sys
import unittest
import wave
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fixture_tools import canonical_json_bytes, sha256_bytes, verify_fixture  # noqa: E402


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


if __name__ == "__main__":
    unittest.main()
