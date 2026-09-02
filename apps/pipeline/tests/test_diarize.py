import sys
import types
import unittest
from unittest import mock

from ccc_pipeline.diarize import DEFAULT_PIPELINE_ID, diarize
from ccc_pipeline.model_registry import role_spec


class DiarizeModelPinTest(unittest.TestCase):
    def test_passes_exact_repo_revision_identifier_and_token(self):
        spec = role_spec("diarization", DEFAULT_PIPELINE_ID)
        calls = []

        class FakePipeline:
            @staticmethod
            def from_pretrained(identifier, **kwargs):
                calls.append((identifier, kwargs))

                def run(_audio_path, **_options):
                    return types.SimpleNamespace(itertracks=lambda **_kwargs: [])

                return run

        pyannote = types.ModuleType("pyannote")
        audio = types.ModuleType("pyannote.audio")
        audio.Pipeline = FakePipeline
        pyannote.audio = audio
        with mock.patch.dict(sys.modules, {"pyannote": pyannote, "pyannote.audio": audio}):
            self.assertEqual(diarize("audio.wav", "hf-fixture"), [])

        self.assertEqual(calls, [(f"{spec.name}@{spec.revision}", {"use_auth_token": "hf-fixture"})])

    def test_rejects_unlisted_pipeline(self):
        with self.assertRaises(ValueError):
            diarize("audio.wav", None, "unlisted/model")


if __name__ == "__main__":
    unittest.main()
