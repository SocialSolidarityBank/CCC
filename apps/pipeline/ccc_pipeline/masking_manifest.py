"""Canonical masking pipeline registry shared by Agent and server configuration.

`MEMORY_MASKING_PIPELINES` is the only data source. The Agent derives its model,
labels, health binding and emitted version/hash from its active manifest. The
server accepts only exact manifest rows from the same registry.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from .results import SCHEMA_VERSION, canonical_sha256

_HEX_40 = re.compile(r"[0-9a-f]{40}")
_HEX_64 = re.compile(r"[0-9a-f]{64}")
_VERSION_IDENTIFIER = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
_LABEL = re.compile(r"[A-Z][A-Z0-9_]*")
_REGISTRY_KEYS = frozenset({"schemaVersion", "activeMaskingPipelineVersion", "pipelines"})
_MANIFEST_KEYS = frozenset({
    "schemaVersion",
    "resultSchemaVersion",
    "maskingPipelineVersion",
    "maskingPipelineHash",
    "directIdentifierRulesVersion",
    "regexRulesVersion",
    "conditionDictionaryVersion",
    "quasiIdentifierRulesVersion",
    "g7RelativeDateRulesVersion",
    "nerModelId",
    "nerModelRevision",
    "personLabels",
    "addressLabels",
    "conditionNerModelId",
    "conditionNerModelRevision",
    "conditionLabels",
    "labelSetHash",
    "nerHealthCorpusHash",
    "nerHealthResultHash",
})


class MaskingPipelineManifestError(ValueError):
    """The registry is malformed, unsupported, or not self-consistent."""


@dataclass(frozen=True)
class MaskingPipelineManifest:
    masking_pipeline_version: str
    masking_pipeline_hash: str
    ner_model_id: str
    ner_model_revision: str
    person_labels: tuple[str, ...]
    address_labels: tuple[str, ...]
    condition_ner_model_id: str | None
    condition_ner_model_revision: str | None
    condition_labels: tuple[str, ...]
    label_set_hash: str
    ner_health_corpus_hash: str
    ner_health_result_hash: str


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise MaskingPipelineManifestError("masking pipeline manifest has duplicate keys")
        result[key] = value
    return result


def _labels(value: object, *, allow_empty: bool = False) -> tuple[str, ...]:
    if (
        not isinstance(value, list)
        or (not allow_empty and not value)
        or any(not isinstance(item, str) or _LABEL.fullmatch(item) is None for item in value)
        or len(set(value)) != len(value)
    ):
        raise MaskingPipelineManifestError("masking pipeline labels are invalid")
    return tuple(value)


def _hex(value: object, pattern: re.Pattern[str]) -> str:
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise MaskingPipelineManifestError("masking pipeline digest is invalid")
    return value


def _decode_manifest(value: object) -> MaskingPipelineManifest:
    if not isinstance(value, dict) or frozenset(value) != _MANIFEST_KEYS:
        raise MaskingPipelineManifestError("masking pipeline manifest keys are invalid")
    if (
        value["schemaVersion"] != 2
        or value["resultSchemaVersion"] != SCHEMA_VERSION
        or value["directIdentifierRulesVersion"] != "direct-v1"
        or value["regexRulesVersion"] != "regex-v2"
        or value["conditionDictionaryVersion"] != "condition-dict-v1"
        or value["quasiIdentifierRulesVersion"] != "quasi-v1"
        or value["g7RelativeDateRulesVersion"] != "calendar-day-v1"
    ):
        raise MaskingPipelineManifestError("masking pipeline static rule tuple is unsupported")
    version = value["maskingPipelineVersion"]
    if not isinstance(version, str) or _VERSION_IDENTIFIER.fullmatch(version) is None:
        raise MaskingPipelineManifestError("masking pipeline version is invalid")
    digest = _hex(value["maskingPipelineHash"], _HEX_64)
    model_id = value["nerModelId"]
    if not isinstance(model_id, str) or not model_id:
        raise MaskingPipelineManifestError("masking pipeline NER model is invalid")
    model_revision = _hex(value["nerModelRevision"], _HEX_40)
    person_labels = _labels(value["personLabels"])
    address_labels = _labels(value["addressLabels"])
    condition_labels = _labels(value["conditionLabels"], allow_empty=True)
    condition_model_id = value["conditionNerModelId"]
    condition_model_revision = value["conditionNerModelRevision"]
    has_condition_model = isinstance(condition_model_id, str) and bool(condition_model_id)
    if (
        (condition_model_id is not None and not has_condition_model)
        or (condition_model_revision is not None and (
            not isinstance(condition_model_revision, str)
            or _HEX_40.fullmatch(condition_model_revision) is None
        ))
        or has_condition_model != (condition_model_revision is not None)
        or has_condition_model != bool(condition_labels)
    ):
        raise MaskingPipelineManifestError("masking pipeline condition NER tuple is invalid")
    label_set_hash = _hex(value["labelSetHash"], _HEX_64)
    if canonical_sha256(sorted((*person_labels, *address_labels))) != label_set_hash:
        raise MaskingPipelineManifestError("masking pipeline label set hash does not match")
    unsigned = {key: item for key, item in value.items() if key != "maskingPipelineHash"}
    if canonical_sha256(unsigned) != digest:
        raise MaskingPipelineManifestError("masking pipeline manifest hash does not match")
    return MaskingPipelineManifest(
        masking_pipeline_version=version,
        masking_pipeline_hash=digest,
        ner_model_id=model_id,
        ner_model_revision=model_revision,
        person_labels=person_labels,
        address_labels=address_labels,
        condition_ner_model_id=condition_model_id,
        condition_ner_model_revision=condition_model_revision,
        condition_labels=condition_labels,
        label_set_hash=label_set_hash,
        ner_health_corpus_hash=_hex(value["nerHealthCorpusHash"], _HEX_64),
        ner_health_result_hash=_hex(value["nerHealthResultHash"], _HEX_64),
    )


def load_active_masking_pipeline(raw: str) -> MaskingPipelineManifest:
    try:
        value = json.loads(raw, object_pairs_hook=_reject_duplicate_keys)
    except (json.JSONDecodeError, TypeError) as error:
        raise MaskingPipelineManifestError("masking pipeline registry is not valid JSON") from error
    if (
        not isinstance(value, dict)
        or frozenset(value) != _REGISTRY_KEYS
        or isinstance(value["schemaVersion"], bool)
        or value["schemaVersion"] != 1
        or not isinstance(value["activeMaskingPipelineVersion"], str)
        or _VERSION_IDENTIFIER.fullmatch(value["activeMaskingPipelineVersion"]) is None
        or not isinstance(value["pipelines"], list)
        or not value["pipelines"]
    ):
        raise MaskingPipelineManifestError("masking pipeline registry is invalid")
    manifests = tuple(_decode_manifest(item) for item in value["pipelines"])
    versions = {manifest.masking_pipeline_version for manifest in manifests}
    if len(versions) != len(manifests):
        raise MaskingPipelineManifestError("masking pipeline versions must be unique")
    active = next(
        (manifest for manifest in manifests
         if manifest.masking_pipeline_version == value["activeMaskingPipelineVersion"]),
        None,
    )
    if active is None:
        raise MaskingPipelineManifestError("active masking pipeline is not registered")
    return active
