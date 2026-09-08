"""pyannote 화자 분리 래퍼 (지연 임포트 — ML 설치 환경 전용, 게이트 모델은 HF_TOKEN 필요)."""

from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from .model_registry import ModelRegistryError, ModelSpec, role_spec
from .speaker_mapping import Turn

DEFAULT_PIPELINE_ID = "pyannote/speaker-diarization-3.1"



def _verified_hub_file(spec: ModelSpec, filename: str) -> Path:
    from huggingface_hub import hf_hub_download  # noqa: PLC0415

    declared = next((item for item in spec.files if item.name == filename), None)
    if declared is None:
        raise RuntimeError("diarization model file is not declared")
    path = Path(hf_hub_download(
        spec.name,
        filename,
        revision=spec.revision,
        local_files_only=True,
    ))
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    if digest.hexdigest() != declared.sha256:
        raise RuntimeError("diarization model file hash mismatch")
    return path

def build_diarizer(hf_token: str | None, pipeline_id: str = DEFAULT_PIPELINE_ID):  # noqa: ANN201
    """Load the pinned pipeline now and return a reusable per-audio callable."""
    try:
        spec = role_spec("diarization", pipeline_id)
        segmentation = role_spec("diarization-segmentation")
        embedding = role_spec("diarization-embedding")
    except ModelRegistryError as error:
        raise ValueError("diarization model is not declared in model manifest") from error
    config_path = _verified_hub_file(spec, "config.yaml")
    segmentation_path = _verified_hub_file(segmentation, "pytorch_model.bin")
    embedding_path = _verified_hub_file(embedding, "pytorch_model.bin")
    import torch  # noqa: PLC0415
    from torch.torch_version import TorchVersion  # noqa: PLC0415
    from pyannote.audio import Pipeline  # noqa: PLC0415
    from pyannote.audio.core.task import Problem, Resolution, Specifications  # noqa: PLC0415
    torch.serialization.add_safe_globals([TorchVersion, Specifications, Problem, Resolution])
    config = Path(config_path).read_text(encoding="utf-8")
    replacements = {
        f"    segmentation: {segmentation.name}": f"    segmentation: {json.dumps(str(segmentation_path))}",
        f"    embedding: {embedding.name}": f"    embedding: {json.dumps(str(embedding_path))}",
    }
    for current, pinned in replacements.items():
        if config.count(current) != 1:
            raise RuntimeError("diarization dependency config is invalid")
        config = config.replace(current, pinned)
    with TemporaryDirectory(prefix="ccc-diarization-") as directory:
        pinned_config = Path(directory) / "config.yaml"
        pinned_config.write_text(config, encoding="utf-8")
        pipeline = Pipeline.from_pretrained(str(pinned_config), use_auth_token=hf_token)
    if not callable(pipeline):
        raise RuntimeError("diarization model unavailable")

    def run(audio_path: str) -> list[Turn]:
        diarization = pipeline(audio_path, max_speakers=2)
        return [
            Turn(start=float(turn.start), end=float(turn.end), speaker=str(speaker))
            for turn, _, speaker in diarization.itertracks(yield_label=True)
        ]

    return run


def diarize(audio_path: str, hf_token: str | None, pipeline_id: str = DEFAULT_PIPELINE_ID) -> list[Turn]:
    """Audio file to speaker turns, loading the fixed pipeline for this call."""
    return build_diarizer(hf_token, pipeline_id)(audio_path)
