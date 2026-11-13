#!/usr/bin/env python3
"""Strict, local-only adapter for the pinned OpenAI Privacy Filter runtime."""
from __future__ import annotations

import importlib.util
import math
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any, NoReturn

import torch
import torch.nn.functional as F


__all__ = ["AdapterError", "load", "predict", "self_check"]

_LABEL_TO_KIND = {
    "private_person": "person",
    "private_address": "address",
    "account_number": "identifier",
    "private_email": "identifier",
    "private_phone": "identifier",
    "private_url": "identifier",
    "private_date": "identifier",
    "secret": "identifier",
}
_EXPECTED_SPAN_LABELS = {"O", *_LABEL_TO_KIND}
_GATE_CORE: ModuleType | None = None


class AdapterError(RuntimeError):
    """Sanitized adapter failure containing only a stable machine-readable code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _fail(code: str) -> NoReturn:
    raise AdapterError(code)

try:
    from opf._core.decoding import (
        DEFAULT_VITERBI_CALIBRATION_FILENAME,
        VITERBI_BIAS_KEYS,
        build_sequence_decoder,
    )
    from opf._core.runtime import load_inference_runtime
    from opf._core.sequence_labeling import TokenizedExample, example_to_windows
    from opf._core.spans import decode_text_with_offsets, labels_to_spans
except Exception:
    _OPF_IMPORT_OK = False
else:
    _OPF_IMPORT_OK = True


class _Handle:
    __slots__ = ("runtime", "decoder", "class_count")

    def __init__(self, runtime: Any, decoder: Any, class_count: int) -> None:
        self.runtime = runtime
        self.decoder = decoder
        self.class_count = class_count


def _validate_runtime(runtime: Any) -> int:
    try:
        label_info = runtime.label_info
        span_names = tuple(label_info.span_class_names)
        token_to_span = dict(label_info.token_to_span_label)
        boundary_tags = dict(label_info.token_boundary_tags)
        configuration_is_valid = (
            runtime.device.type == "cpu"
            and runtime.n_ctx == 4096
            and runtime.output_mode == "typed"
            and runtime.trim_span_whitespace is True
            and runtime.discard_overlapping_predicted_spans is False
            and set(span_names) == _EXPECTED_SPAN_LABELS
            and len(span_names) == len(_EXPECTED_SPAN_LABELS)
            and len(token_to_span) == 33
            and set(token_to_span) == set(range(33))
            and set(boundary_tags) == set(range(33))
        )
    except (AttributeError, TypeError, ValueError):
        _fail("opf_api_mismatch")
    if not configuration_is_valid:
        _fail("invalid_runtime")
    return len(token_to_span)


def load(checkpoint: str) -> _Handle:
    """Load the pinned native OPF runtime on CPU with its calibrated decoder."""
    if not isinstance(checkpoint, str) or not checkpoint.strip():
        _fail("invalid_checkpoint")
    if not _OPF_IMPORT_OK:
        _fail("opf_api_mismatch")
    try:
        torch.set_num_threads(2)
        thread_count = torch.get_num_threads()
    except TimeoutError:
        raise
    except Exception:
        _fail("thread_config_failed")
    if thread_count != 2:
        _fail("thread_config_failed")

    try:
        runtime = load_inference_runtime(
            checkpoint=checkpoint,
            device_name="cpu",
            n_ctx_override=4096,
            trim_span_whitespace=True,
            discard_overlapping_predicted_spans=False,
            output_mode="typed",
        )
    except (ImportError, AttributeError):
        _fail("opf_api_mismatch")
    except TimeoutError:
        raise
    except Exception:
        _fail("runtime_load_failed")

    class_count = _validate_runtime(runtime)
    calibration_path = Path(checkpoint) / DEFAULT_VITERBI_CALIBRATION_FILENAME
    if not calibration_path.is_file():
        _fail("missing_default_calibration")
    try:
        decoder, biases = build_sequence_decoder(
            decode_mode="viterbi",
            label_info=runtime.label_info,
            viterbi_calibration_path=str(calibration_path),
            checkpoint_dir=checkpoint,
        )
    except (ImportError, AttributeError):
        _fail("opf_api_mismatch")
    except TimeoutError:
        raise
    except Exception:
        _fail("decoder_load_failed")
    if (
        decoder is None
        or not isinstance(biases, dict)
        or set(biases) != set(VITERBI_BIAS_KEYS)
        or not all(type(value) is float and math.isfinite(value) for value in biases.values())
    ):
        _fail("invalid_decoder")
    return _Handle(runtime=runtime, decoder=decoder, class_count=class_count)


def _gate_core() -> ModuleType:
    global _GATE_CORE
    if _GATE_CORE is not None:
        return _GATE_CORE
    path = Path(__file__).resolve().parent.parent / "context-gate" / "gate_core.py"
    spec = importlib.util.spec_from_file_location("ccc237_context_gate_core", path)
    if spec is None or spec.loader is None:
        _fail("gate_api_mismatch")
    module = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(module)
    except TimeoutError:
        raise
    except Exception:
        _fail("gate_load_failed")
    if not callable(getattr(module, "_mask_ranges", None)):
        _fail("gate_api_mismatch")
    _GATE_CORE = module
    return module


def _mask_ranges(text: str) -> tuple[tuple[int, int], ...]:
    try:
        raw_ranges = _gate_core()._mask_ranges(text)
    except AdapterError:
        raise
    except TimeoutError:
        raise
    except Exception:
        _fail("mask_detection_failed")
    checked: list[tuple[int, int]] = []
    try:
        for item in raw_ranges:
            start, end = item
            if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text):
                _fail("invalid_mask_ranges")
            checked.append((start, end))
    except (TypeError, ValueError):
        _fail("invalid_mask_ranges")
    return tuple(sorted(set(checked)))


def _validate_token_offsets(text: str, starts: Any, ends: Any, count: int) -> None:
    if not isinstance(starts, list) or not isinstance(ends, list) or len(starts) != count or len(ends) != count:
        _fail("invalid_token_offsets")
    if count == 0:
        if starts or ends:
            _fail("invalid_token_offsets")
        return
    previous_end = 0
    for index, (start, end) in enumerate(zip(starts, ends)):
        if (
            type(start) is not int
            or type(end) is not int
            or not 0 <= start < end <= len(text)
            or (index == 0 and start != 0)
            or start > previous_end
            or end < previous_end
        ):
            _fail("invalid_token_offsets")
        previous_end = end
    if previous_end != len(text):
        _fail("invalid_token_offsets")


def _validate_decoder_path(decoder: Any, scores: torch.Tensor, labels: Any) -> list[int]:
    try:
        start_scores = decoder._start_scores
        end_scores = decoder._end_scores
        transitions = decoder._transition_scores
    except AttributeError:
        _fail("opf_api_mismatch")
    if (
        not isinstance(start_scores, torch.Tensor)
        or not isinstance(end_scores, torch.Tensor)
        or not isinstance(transitions, torch.Tensor)
        or start_scores.shape != (scores.shape[1],)
        or end_scores.shape != (scores.shape[1],)
        or transitions.shape != (scores.shape[1], scores.shape[1])
    ):
        _fail("invalid_decoder")

    if not isinstance(labels, list) or not labels or len(labels) != scores.shape[0]:
        _fail("decoder_fallback")
    if any(type(label) is not int or not 0 <= label < scores.shape[1] for label in labels):
        _fail("invalid_decoded_path")
    info = decoder.label_info
    tags = info.token_boundary_tags
    kinds = info.token_to_span_label
    # Native forbidden edges use finite -1e9; finiteness does not validate BIESO.
    if tags[labels[0]] not in (None, "B", "S") or tags[labels[-1]] not in (None, "E", "S"):
        _fail("invalid_decoded_path")
    for previous, current in zip(labels, labels[1:]):
        if tags[previous] in ("B", "I"):
            valid = tags[current] in ("I", "E") and kinds[previous] == kinds[current]
        else:
            valid = tags[current] in (None, "B", "S")
        if not valid:
            _fail("invalid_decoded_path")
    return labels


def _split_lines(text: str, start: int, end: int) -> list[tuple[int, int]]:
    pieces: list[tuple[int, int]] = []
    cursor = start
    for index in range(start, end):
        if text[index] not in "\r\n":
            continue
        if cursor < index:
            pieces.append((cursor, index))
        cursor = index + 1
    if cursor < end:
        pieces.append((cursor, end))
    if not pieces:
        _fail("invalid_char_span")
    return pieces


def predict(handle: _Handle, text: str) -> dict[str, Any]:
    """Return strict gate spans and raw-free coverage metrics for one local string."""
    if type(handle) is not _Handle:
        _fail("invalid_handle")
    if not isinstance(text, str):
        _fail("invalid_text")
    runtime = handle.runtime
    try:
        token_ids = tuple(int(token) for token in runtime.encoding.encode(text, allowed_special="all"))
    except TimeoutError:
        raise
    except Exception:
        _fail("tokenize_failed")
    if not token_ids:
        if text:
            _fail("invalid_tokenization")
        return {
            "spans": [],
            "metrics": {
                "token_count": 0,
                "window_count": 0,
                "window_token_counts": [],
                "uncovered_token_count": 0,
                "native_prediction_count": 0,
                "duplicate_predictions_removed": 0,
                "window_token_observation_count": 0,
                "covered_token_count": 0,
                "overlap_token_count": 0,
                "overlap_observation_count": 0,
                "existing_mask_prediction_count_ignored": 0,
                "existing_mask_token_count_ignored": 0,
            },
        }

    background = runtime.label_info.background_token_label
    example = TokenizedExample(
        tokens=token_ids,
        labels=tuple(background for _ in token_ids),
        example_id="opf-adapter",
        text=text,
    )
    sums: list[torch.Tensor | None] = [None] * len(token_ids)
    counts = [0] * len(token_ids)
    window_count = 0
    window_token_counts: list[int] = []
    observation_count = 0

    try:
        windows = example_to_windows(example, runtime.n_ctx)
        with torch.inference_mode():
            for window in windows:
                window_count += 1
                size = len(window.tokens)
                window_token_counts.append(size)
                if size == 0 or not (
                    len(window.labels) == size
                    and len(window.offsets) == size
                    and len(window.mask) == size
                ):
                    _fail("invalid_window")
                input_tokens = torch.tensor([list(window.tokens)], device=runtime.device, dtype=torch.int32)
                attention_mask = torch.ones_like(input_tokens, dtype=torch.bool)
                logits = runtime.model(input_tokens, attention_mask=attention_mask)
                if not isinstance(logits, torch.Tensor) or logits.shape != (1, size, handle.class_count):
                    _fail("invalid_logits_shape")
                if not bool(torch.isfinite(logits).all().item()):
                    _fail("nonfinite_logits")
                log_probs = F.log_softmax(logits.float(), dim=-1)[0].cpu()
                if not bool(torch.isfinite(log_probs).all().item()):
                    _fail("nonfinite_logits")
                for position, (offset, valid) in enumerate(zip(window.offsets, window.mask)):
                    if type(valid) not in (bool, int) or valid not in (0, 1):
                        _fail("invalid_window")
                    if not valid:
                        continue
                    if type(offset) is not int or not 0 <= offset < len(token_ids):
                        _fail("invalid_window")
                    if int(window.tokens[position]) != token_ids[offset]:
                        _fail("conflicting_token_observation")
                    score = log_probs[position]
                    sums[offset] = score.clone() if sums[offset] is None else torch.logaddexp(sums[offset], score)
                    counts[offset] += 1
                    observation_count += 1
    except AdapterError:
        raise
    except TimeoutError:
        raise
    except Exception:
        _fail("inference_failed")

    if window_count == 0 or any(count == 0 or score is None for count, score in zip(counts, sums)):
        _fail("incomplete_token_coverage")
    averaged = torch.stack(
        [score - math.log(float(count)) for score, count in zip(sums, counts) if score is not None]
    )
    if averaged.shape != (len(token_ids), handle.class_count) or not bool(torch.isfinite(averaged).all().item()):
        _fail("nonfinite_logits")

    try:
        decoded = handle.decoder.decode(averaged)
    except TimeoutError:
        raise
    except Exception:
        _fail("decoder_failed")
    labels = _validate_decoder_path(handle.decoder, averaged, decoded)
    labels_by_index = dict(enumerate(labels))
    try:
        token_spans = labels_to_spans(labels_by_index, runtime.label_info)
        decoded_text, char_starts, char_ends = decode_text_with_offsets(token_ids, runtime.encoding)
    except TimeoutError:
        raise
    except Exception:
        _fail("span_decode_failed")
    if not isinstance(token_spans, list):
        _fail("invalid_token_span")
    if decoded_text != text:
        _fail("decoded_text_mismatch")
    _validate_token_offsets(text, char_starts, char_ends, len(token_ids))

    converted: list[tuple[int, int, int, int, int]] = []
    previous_end = 0
    for span in token_spans:
        if not isinstance(span, tuple) or len(span) != 3:
            _fail("invalid_token_span")
        label_index, token_start, token_end = span
        if (
            type(label_index) is not int
            or type(token_start) is not int
            or type(token_end) is not int
            or not 0 <= token_start < token_end <= len(token_ids)
            or token_start < previous_end
        ):
            _fail("invalid_token_span")
        previous_end = token_end
        start, end = char_starts[token_start], char_ends[token_end - 1]
        while start < end and text[start].isspace():
            start += 1
        while end > start and text[end - 1].isspace():
            end -= 1
        if not 0 <= start < end <= len(text):
            _fail("invalid_char_span")
        converted.append((label_index, token_start, token_end, start, end))

    span_position = 0
    for token_index, token_label in enumerate(labels):
        while (
            span_position < len(token_spans)
            and token_spans[span_position][2] <= token_index
        ):
            span_position += 1
        covering = (
            token_spans[span_position]
            if span_position < len(token_spans)
            and token_spans[span_position][1] <= token_index < token_spans[span_position][2]
            else None
        )
        span_label = runtime.label_info.token_to_span_label.get(token_label)
        if span_label is None or (
            span_label == runtime.label_info.background_span_label
            and covering is not None
        ) or (
            span_label != runtime.label_info.background_span_label
            and (covering is None or covering[0] != span_label)
        ):
            _fail("invalid_token_span")

    for left, right in zip(converted, converted[1:]):
        if right[3] < left[4]:
            _fail("overlapping_predictions")

    masks = _mask_ranges(text)
    output: list[tuple[int, int, str]] = []
    ignored_predictions = 0
    ignored_tokens = 0
    for label_index, token_start, token_end, start, end in converted:
        overlaps = [(mask_start, mask_end) for mask_start, mask_end in masks if max(start, mask_start) < min(end, mask_end)]
        if overlaps:
            if any(mask_start <= start and end <= mask_end for mask_start, mask_end in overlaps):
                ignored_predictions += 1
                ignored_tokens += token_end - token_start
                continue
            _fail("prediction_crosses_existing_mask")
        try:
            label = runtime.label_info.span_class_names[label_index]
        except (IndexError, TypeError):
            _fail("unknown_label")
        kind = _LABEL_TO_KIND.get(label)
        if kind is None:
            _fail("unknown_label")
        output.extend((piece_start, piece_end, kind) for piece_start, piece_end in _split_lines(text, start, end))

    return {
        "spans": output,
        "metrics": {
            "token_count": len(token_ids),
            "window_count": window_count,
            "window_token_counts": window_token_counts,
            "uncovered_token_count": sum(count == 0 for count in counts),
            "native_prediction_count": len(converted),
            "duplicate_predictions_removed": 0,
            "window_token_observation_count": observation_count,
            "covered_token_count": sum(count > 0 for count in counts),
            "overlap_token_count": sum(count > 1 for count in counts),
            "overlap_observation_count": sum(max(0, count - 1) for count in counts),
            "existing_mask_prediction_count_ignored": ignored_predictions,
            "existing_mask_token_count_ignored": ignored_tokens,
        },
    }


def self_check() -> None:
    """Exercise strict boundary helpers with synthetic objects; never runs on import."""
    assert _split_lines("ab\ncd", 0, 5) == [(0, 2), (3, 5)]
    _validate_token_offsets("ab", [0, 1], [1, 2], 2)

    import json
    import tiktoken
    from opf._core.runtime import resolve_label_space_from_config, build_label_info
    checkpoint = Path.home() / ".cache/ccc-privacy-tests/opf/model/original"
    _, _, names = resolve_label_space_from_config(
        json.loads((checkpoint / "config.json").read_text()), context="self-check"
    )
    info = build_label_info(names)
    native_decoder, _biases = build_sequence_decoder(
        decode_mode="viterbi", label_info=info,
        viterbi_calibration_path=str(checkpoint / DEFAULT_VITERBI_CALIBRATION_FILENAME),
        checkpoint_dir=str(checkpoint),
    )
    bad_paths = (
        [info.boundary_label_lookup["private_person"]["I"]],
        [info.boundary_label_lookup["private_person"]["B"], info.background_token_label],
        [info.boundary_label_lookup["private_person"]["B"], info.boundary_label_lookup["private_address"]["E"]],
    )
    for bad_path in bad_paths:
        try:
            _validate_decoder_path(native_decoder, torch.zeros((len(bad_path), 33)), bad_path)
        except AdapterError as error:
            assert error.code == "invalid_decoded_path"
        else:
            raise AssertionError("native finite-sentinel invalid grammar was accepted")
    encoding = tiktoken.get_encoding("o200k_base")
    for text, target, expected, failure in (
        ("가😀\r\n나", None, [], None),
        ("A Alex B", (2, 6), [(2, 6, "person")], None),
        ("A [인명] B", (2, 6), [], None),
        ("A [인명] B", (2, 8), None, "prediction_crosses_existing_mask"),
    ):
        tokens = encoding.encode(text)
        _, starts, ends = decode_text_with_offsets(tokens, encoding)
        labels = [info.background_token_label] * len(tokens)
        if target:
            selected = [i for i, (start, end) in enumerate(zip(starts, ends))
                        if max(start, target[0]) < min(end, target[1])]
            lookup = info.boundary_label_lookup["private_person"]
            for index in selected:
                boundary = "S" if len(selected) == 1 else "B" if index == selected[0] else "E" if index == selected[-1] else "I"
                labels[index] = lookup[boundary]
        logits = torch.full((1, len(tokens), 33), -100.0)
        for index, label in enumerate(labels):
            logits[0, index, label] = 100.0
        runtime = SimpleNamespace(
            encoding=encoding, label_info=info, n_ctx=4096, device=torch.device("cpu"),
            model=lambda _tokens, **_kwargs: logits,
        )
        handle = _Handle(runtime, native_decoder, 33)
        try:
            result = predict(handle, text)
        except AdapterError as error:
            assert error.code == failure
        else:
            assert failure is None and result["spans"] == expected
            assert result["metrics"]["covered_token_count"] == len(tokens)

    def timeout_model(*_args, **_kwargs):
        raise TimeoutError("synthetic_timeout")
    runtime.model = timeout_model
    try:
        predict(handle, text)
    except TimeoutError:
        pass
    else:
        raise AssertionError("inference timeout identity was lost")
