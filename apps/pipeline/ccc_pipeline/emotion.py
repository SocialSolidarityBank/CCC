"""감정 점수 집계 (R4, D11).

- 숫자만 다룬다. "불안하다" 같은 문장형 서술은 만들지도, 반환하지도 않는다 (R4).
- 수혜자 발화만 집계한다 (D11) — 발화 필터링은 worker가 역할 추정 결과로 수행한다.
- 가중치: 음성 낮게(0.3) + 텍스트 높게(0.7). CLAUDE.md §5 스펙.

모델 래퍼는 지연 임포트로 분리한다. 라벨→점수 매핑(score_from_probs)은 순수 함수라
이 맥에서 테스트하고, 실제 모델의 라벨 체계 확인·보정은 노트북 실측(8장 미결) 때 한다.
"""

from __future__ import annotations

import math

from .model_registry import ModelRegistryError, role_spec
SPEECH_WEIGHT = 0.3
TEXT_WEIGHT = 0.7

# 감정 분류 라벨 → 부호 매핑 초안. 점수는 [-1, +1]: 양수=긍정, 음수=부정.
# 두 모델(wav2vec2-xlsr·HowRU-KoELECTRA)의 실제 라벨 목록을 노트북에서 확인해 보정한다.
POSITIVE_LABELS = frozenset({"happiness", "happy", "joy", "positive", "기쁨", "행복"})
NEGATIVE_LABELS = frozenset({
    "anger", "angry", "sadness", "sad", "fear", "disgust", "negative",
    "분노", "슬픔", "불안", "공포", "혐오", "상처",
})


def score_from_probs(probs: dict[str, float]) -> float:
    """라벨 확률 분포를 단일 점수 [-1, +1]로 접는다: P(긍정) - P(부정). 중립은 0 기여."""
    positive = sum(p for label, p in probs.items() if label.lower() in POSITIVE_LABELS or label in POSITIVE_LABELS)
    negative = sum(p for label, p in probs.items() if label.lower() in NEGATIVE_LABELS or label in NEGATIVE_LABELS)
    return positive - negative


def _mean(values: list[float]) -> float | None:
    finite = [v for v in values if isinstance(v, (int, float)) and math.isfinite(v)]
    if not finite:
        return None
    return sum(finite) / len(finite)


def aggregate_scores(speech_scores: list[float], text_scores: list[float]) -> dict[str, float]:
    """발화별 점수 목록 → 세션 지표. 반환값은 유한 숫자만 담는다(서버 isNumericOnly 검증 통과 조건).

    한 축이 비어 있으면(모델 실패 등) 남은 축만으로 combined를 만든다 — 축 실패가
    세션 전체를 막지 않게 한다.
    """
    speech = _mean(speech_scores)
    text = _mean(text_scores)

    if speech is not None and text is not None:
        combined = SPEECH_WEIGHT * speech + TEXT_WEIGHT * text
    else:
        combined = speech if speech is not None else text

    scores: dict[str, float] = {"utteranceCount": float(max(len(speech_scores), len(text_scores)))}
    if speech is not None:
        scores["speech"] = speech
    if text is not None:
        scores["text"] = text
    if combined is not None:
        scores["combined"] = combined
    return scores


def build_text_scorer(model_id: str = "LimYeri/HowRU-KoELECTRA-Emotion-Classifier"):  # noqa: ANN201
    """텍스트 감정 분류기(MIT) 래퍼 — manifest revision으로 고정한다."""
    from transformers import pipeline  # noqa: PLC0415

    try:
        spec = role_spec("text-emotion", model_id)
    except ModelRegistryError as error:
        raise ValueError("text emotion model is not declared in model manifest") from error
    classifier = pipeline("text-classification", model=spec.name, revision=spec.revision, top_k=None)

    def score(texts: list[str]) -> list[float]:
        results = classifier(texts)
        return [score_from_probs({r["label"]: float(r["score"]) for r in result}) for result in results]

    return score


def build_speech_scorer(model_id: str = "jungjongho/wav2vec2-xlsr-korean-speech-emotion-recognition"):  # noqa: ANN201
    """음성 감정 분류기(Apache-2.0) 래퍼 — manifest revision으로 고정한다."""
    import librosa  # noqa: PLC0415
    from transformers import pipeline  # noqa: PLC0415

    try:
        spec = role_spec("speech-emotion", model_id)
    except ModelRegistryError as error:
        raise ValueError("speech emotion model is not declared in model manifest") from error
    classifier = pipeline("audio-classification", model=spec.name, revision=spec.revision, top_k=None)

    def score(audio_path: str, spans: list[tuple[float, float]]) -> list[float]:
        waveform, rate = librosa.load(audio_path, sr=16000, mono=True)
        scores: list[float] = []
        for start, end in spans:
            if end - start < 0.5:
                continue
            clip = waveform[int(start * rate):int(end * rate)]
            results = classifier({"array": clip, "sampling_rate": rate})
            scores.append(score_from_probs({r["label"]: float(r["score"]) for r in results}))
        return scores

    return score
