import sys
import types
import unittest
from unittest import mock

from ccc_pipeline.diarize import DEFAULT_PIPELINE_ID, build_diarizer, diarize
from ccc_pipeline.model_registry import role_spec

def fake_runtime_modules(pipeline_type):
    pyannote = types.ModuleType("pyannote")
    audio = types.ModuleType("pyannote.audio")
    audio.Pipeline = pipeline_type
    pyannote.audio = audio
    core = types.ModuleType("pyannote.audio.core")
    task = types.ModuleType("pyannote.audio.core.task")
    task.Problem = type("Problem", (), {})
    task.Resolution = type("Resolution", (), {})
    task.Specifications = type("Specifications", (), {})
    torch = types.ModuleType("torch")
    torch.serialization = types.SimpleNamespace(add_safe_globals=lambda _items: None)
    torch_version = types.ModuleType("torch.torch_version")
    torch_version.TorchVersion = type("TorchVersion", (), {})
    hub = types.ModuleType("huggingface_hub")
    hub.constants = types.SimpleNamespace(HF_HUB_CACHE="/private/cache/hub")
    return {
        "pyannote": pyannote,
        "pyannote.audio": audio,
        "pyannote.audio.core": core,
        "pyannote.audio.core.task": task,
        "torch": torch,
        "huggingface_hub": hub,
        "torch.torch_version": torch_version,
    }



class DiarizeModelPinTest(unittest.TestCase):
    def test_resolves_all_pinned_dependencies_from_verified_local_files(self):
        loads = []
        verified = []

        class FakePipeline:
            @staticmethod
            def from_pretrained(identifier, **kwargs):
                with open(identifier, encoding="utf-8") as config_file:
                    loads.append((config_file.read(), kwargs))

                def run(_audio_path, **_options):
                    return types.SimpleNamespace(itertracks=lambda **_kwargs: [])

                return run

        modules = fake_runtime_modules(FakePipeline)
        config = (
            "pipeline:\n"
            "  params:\n"
            "    segmentation: pyannote/segmentation-3.0\n"
            "    embedding: pyannote/wespeaker-voxceleb-resnet34-LM\n"
        )

        def verified_file(spec, filename):
            verified.append((spec.name, filename))
            return f"/private/cache #1/{spec.name.replace('/', '--')}-{filename}"

        with (
            mock.patch.dict(sys.modules, modules),
            mock.patch("ccc_pipeline.diarize._verified_hub_file", side_effect=verified_file),
            mock.patch("ccc_pipeline.diarize.Path.read_text", return_value=config),
        ):
            self.assertEqual(diarize("audio.wav", "hf-fixture"), [])

        self.assertEqual(verified, [
            ("pyannote/speaker-diarization-3.1", "config.yaml"),
            ("pyannote/segmentation-3.0", "pytorch_model.bin"),
            ("pyannote/wespeaker-voxceleb-resnet34-LM", "pytorch_model.bin"),
        ])
        pinned_config, kwargs = loads[0]
        self.assertIn(
            'segmentation: "/private/cache #1/pyannote--segmentation-3.0-pytorch_model.bin"',
            pinned_config,
        )
        self.assertIn(
            'embedding: "/private/cache #1/pyannote--wespeaker-voxceleb-resnet34-LM-pytorch_model.bin"',
            pinned_config,
        )
        self.assertEqual(kwargs, {"use_auth_token": "hf-fixture"})

    def test_build_diarizer_loads_once_for_reusable_runtime(self):
        loads = []
        calls = []

        class FakePipeline:
            @staticmethod
            def from_pretrained(identifier, **kwargs):
                loads.append((identifier, kwargs))

                def run(audio_path, **options):
                    calls.append((audio_path, options))
                    return types.SimpleNamespace(itertracks=lambda **_kwargs: [])
                return run

        modules = fake_runtime_modules(FakePipeline)
        with (
            mock.patch.dict(sys.modules, modules),
            mock.patch("ccc_pipeline.diarize._verified_hub_file", return_value="/private/cache/model"),
            mock.patch("ccc_pipeline.diarize.Path.read_text", return_value=(
                "pipeline:\n  params:\n"
                "    segmentation: pyannote/segmentation-3.0\n"
                "    embedding: pyannote/wespeaker-voxceleb-resnet34-LM\n"
            )),
        ):
            run = build_diarizer("hf-fixture")
            self.assertEqual(run("one.wav"), [])
            self.assertEqual(run("two.wav"), [])

        self.assertEqual(len(loads), 1)
        self.assertEqual(calls, [
            ("one.wav", {"max_speakers": 2}),
            ("two.wav", {"max_speakers": 2}),
        ])

    def test_rejects_unlisted_pipeline(self):
        with self.assertRaises(ValueError):
            diarize("audio.wav", None, "unlisted/model")


if __name__ == "__main__":
    unittest.main()
