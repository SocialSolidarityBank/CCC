"""Immutable runtime model registry generated from the release manifest.

The release manifest is the only source of model identity, revision, and
checkpoint evidence. Environment variables may select a declared role only;
they cannot introduce a second model registry at runtime.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


class ModelRegistryError(ValueError):
    """Raised when a runtime model is not exactly present in the manifest."""


@dataclass(frozen=True)
class ModelSpec:
    name: str
    version: str
    revision: str
    license: str
    source: str
    checkpoint_url: str | None = None
    checkpoint_sha256: str | None = None


_MANIFEST_PATH = Path(__file__).resolve().parents[3] / "supply-chain" / "model-license-manifest.json"


def _read_manifest() -> tuple[ModelSpec, ...]:
    try:
        payload = json.loads(_MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ModelRegistryError("model license manifest cannot be loaded") from error
    if payload.get("schemaVersion") != 1 or not isinstance(payload.get("models"), list):
        raise ModelRegistryError("model license manifest schema is invalid")
    specs: list[ModelSpec] = []
    identities: set[tuple[str, str]] = set()
    for model in payload["models"]:
        if not isinstance(model, dict):
            raise ModelRegistryError("model license manifest contains an invalid model")
        required = ("name", "version", "revision", "license", "source")
        if any(not isinstance(model.get(field), str) or not model[field] for field in required):
            raise ModelRegistryError("model license manifest contains an incomplete model")
        revision = model["revision"]
        if len(revision) != 40 or any(char not in "0123456789abcdefABCDEF" for char in revision):
            raise ModelRegistryError(f"model revision is not an immutable commit hash: {model['name']}")
        identity = (model["name"], model["version"])
        if identity in identities:
            raise ModelRegistryError(f"duplicate model manifest identity: {model['name']}@{model['version']}")
        identities.add(identity)
        checkpoint_url = model.get("checkpointUrl")
        checkpoint_sha256 = model.get("checkpointSha256")
        if checkpoint_url is not None and not isinstance(checkpoint_url, str):
            raise ModelRegistryError(f"checkpoint URL is invalid: {model['name']}")
        if checkpoint_sha256 is not None and (
            not isinstance(checkpoint_sha256, str)
            or len(checkpoint_sha256) != 64
            or any(char not in "0123456789abcdefABCDEF" for char in checkpoint_sha256)
        ):
            raise ModelRegistryError(f"checkpoint SHA-256 is invalid: {model['name']}")
        specs.append(ModelSpec(
            name=model["name"],
            version=model["version"],
            revision=revision,
            license=model["license"],
            source=model["source"],
            checkpoint_url=checkpoint_url,
            checkpoint_sha256=checkpoint_sha256,
        ))
    if not specs:
        raise ModelRegistryError("model license manifest is empty")
    return tuple(specs)


MODEL_REGISTRY = _read_manifest()
_BY_NAME_VERSION = {(spec.name, spec.version): spec for spec in MODEL_REGISTRY}
_BY_NAME = {spec.name: spec for spec in MODEL_REGISTRY}


def model_spec(name: str, version: str | None = None) -> ModelSpec:
    """Return the exact manifest row, rejecting unlisted names/versions."""
    spec = _BY_NAME_VERSION.get((name, version)) if version is not None else _BY_NAME.get(name)
    if spec is None:
        suffix = f"@{version}" if version is not None else ""
        raise ModelRegistryError(f"runtime model is not declared in manifest: {name}{suffix}")
    return spec


def role_spec(role: str, selected: str | None = None) -> ModelSpec:
    """Resolve a runtime role to its one manifest-bound model.

    Both Whisper roles use the manifest version (``medium``) as the user-facing
    model selector. Other roles use the Hugging Face repository name directly.
    """
    roles = {
        "whisper": ("openai/whisper", "medium"),
        "faster-whisper": ("Systran/faster-whisper-medium", "medium"),
        "diarization": ("pyannote/speaker-diarization-3.1", "3.1"),
        "speech-emotion": (
            "jungjongho/wav2vec2-xlsr-korean-speech-emotion-recognition", "latest-approved",
        ),
        "text-emotion": ("LimYeri/HowRU-KoELECTRA-Emotion-Classifier", "latest-approved"),
        "person-ner": ("FrameByFrame/korean-pii-e5-base", "latest-approved"),
    }
    expected_name, expected_version = roles[role]
    allowed_selection = (expected_version,) if role in ("whisper", "faster-whisper") else (expected_name,)
    if selected is not None and selected not in allowed_selection:
        raise ModelRegistryError(f"{role} model selection is not manifest-bound: {selected}")
    return model_spec(expected_name, expected_version)


def validate_optional_model(name: str | None, role: str) -> ModelSpec | None:
    if name is None:
        return None
    return role_spec(role, name)
