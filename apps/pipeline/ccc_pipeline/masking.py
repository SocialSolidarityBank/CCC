"""2차 PII 마스킹 (D2, R3).

1차(등록 PII 값 → 가명 ID 치환)는 gateway(ingestSessionArtifacts)가 서버에서 수행한다.
여기는 2차 — 대화에 등장하는 제3자 인명·전화번호 등 패턴을 로컬에서 마스킹한 뒤에만
텍스트가 장비를 떠난다.

- 정규식 계층(항상 동작): 전화번호·주민등록번호·이메일·계좌형 숫자열
- 질병명 사전 계층(항상 동작, G3): 구체 병명·진단명을 `[질환]` 으로 치환. 사전은
  `condition_terms.py` — 무엇을 일부러 뺐는지도 거기 적혀 있다.
- NER 계층(선택): CCC_NER_MODEL_ID 설정 시 한국어 개체명 인식으로 인명을 추가 마스킹.
  질병명도 NER 을 병행할 수 있다(`build_condition_ner`) — 사전이 놓친 표기를 잡는 몫이다.
  모델은 라이선스 표기를 확인한 것만 지정한다 (CLAUDE.md §5 규칙).

**집계만 남긴다(R3)**: `mask_text_with_report` 는 "어떤 토큰을 몇 건 치환했는지" 숫자만
돌려준다. 치환된 원문은 보고서에 담지 않는다 — 그걸 담으면 마스킹의 의미가 없어진다.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from .condition_terms import ALL_TERMS

# 치환 토큰 — 검토 화면에서 마스킹 사실이 보이도록 각괄호 한글 라벨을 쓴다.
PHONE_TOKEN = "[전화번호]"
RRN_TOKEN = "[주민번호]"
EMAIL_TOKEN = "[이메일]"
ACCOUNT_TOKEN = "[계좌번호]"
PERSON_TOKEN = "[인명]"
CONDITION_TOKEN = "[질환]"

# 태깅 접두(BIO·BIOES·BILOU). 라벨 대조 전에 떼어 낸다.
_TAG_PREFIXES = ("B-", "I-", "E-", "S-", "L-", "U-")

# 라벨 접두 기본값 — **여러 계열을 함께 담는다.** 모델마다 이름이 달라서다:
#   KLUE·모두의 말뭉치 계열 → PS / PER
#   PII 전용 모델 → NAME 또는 PRIVATE_PERSON (채택 모델 korean-pii-e5-base 가 후자)
# 접두가 그 모델과 하나도 안 맞으면 로드 단계에서 죽으므로(_assert_labels_exist),
# 기본값이 넓어도 조용히 어긋난 채 도는 일은 없다. 모델을 정하면 CCC_NER_LABELS 로
# 그 모델의 라벨만 명시하는 쪽이 더 안전하다 — 의도한 라벨이 문서에 남는다.
DEFAULT_PERSON_LABELS = ("PS", "PER", "NAME", "PRIVATE_PERSON")
DEFAULT_CONDITION_LABELS = ("DS", "DISEASE", "SYMPTOM", "CV_DISEASE", "TRM")

# 경계 주의: 파이썬 re의 \b는 한글도 단어 문자로 봐서 "1234로"처럼 조사가 붙으면
# 매칭이 깨진다. 숫자 패턴은 앞뒤에 숫자·하이픈이 없다는 룩어라운드로 경계를 잡는다.
# 주민등록번호: 생년월일 6자리 + 성별 자리 1~4 + 6자리. 구분자 유무 모두.
_RRN = re.compile(r"(?<![\d-])\d{6}[-\s]?[1-4]\d{6}(?![\d-])")
# 휴대전화·유선: 01x 또는 지역번호(0으로 시작)의 9~11자리(구분자 유무).
_PHONE = re.compile(r"(?<![\d-])0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}(?![\d-])")
# 이메일: ASCII만 — 한글 조사가 붙어도("…co.kr로") 도메인까지만 매칭되게 한다.
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+")
# 계좌형: 하이픈으로 묶인 숫자 3그룹 이상(예: 110-123-456789). 금액·날짜 오탐을 줄이기
# 위해 그룹 구분이 있는 형태만 잡는다. 하이픈 없는 긴 숫자열은 전화·주민 패턴이 담당.
_ACCOUNT = re.compile(r"(?<![\d-])\d{2,6}-\d{2,6}-\d{2,8}(?:-\d{2,8})?(?![\d-])")

# 적용 순서 중요: 주민번호 → 전화(0 시작) → 계좌(나머지 하이픈 숫자열) 순으로,
# 앞 패턴이 뒤 패턴에 부분 매칭되지 않게 한다.
_REGEX_LAYERS: list[tuple[re.Pattern[str], str]] = [
    (_RRN, RRN_TOKEN),
    (_PHONE, PHONE_TOKEN),
    (_ACCOUNT, ACCOUNT_TOKEN),
    (_EMAIL, EMAIL_TOKEN),
]

# 질병명 사전 → 정규식 1개. **긴 항목이 먼저** 와야 "제2형 당뇨병"이 "당뇨병"·"당뇨"에
# 먼저 잡혀 조각나지 않는다(파이썬 re 는 같은 위치에서 앞선 대안을 택한다).
# 사전의 공백은 `\s*` 로 바꿔, 한 항목이 붙여 쓴 형태와 띄어 쓴 형태를 둘 다 잡는다.
# IGNORECASE 는 ASCII 약어(ADHD·PTSD·HIV) 때문이며 한글에는 영향이 없다.
_CONDITION = re.compile(
    "|".join(
        r"\s*".join(re.escape(part) for part in term.split())
        for term in sorted(ALL_TERMS, key=lambda term: len(term.replace(" ", "")), reverse=True)
    ),
    re.IGNORECASE,
)

# 인명 NER 함수 시그니처: 텍스트 → (시작, 끝) 문자 오프셋 목록.
NerFn = Callable[[str], list[tuple[int, int]]]


@dataclass
class MaskingReport:
    """무엇을 몇 건 치환했는지 — **숫자만**. 치환된 원문은 담지 않는다 (R3)."""

    counts: dict[str, int] = field(default_factory=dict)

    def add(self, token: str, amount: int = 1) -> None:
        if amount > 0:
            self.counts[token] = self.counts.get(token, 0) + amount

    @property
    def total(self) -> int:
        return sum(self.counts.values())

    def as_mapping(self) -> Mapping[str, int]:
        return dict(self.counts)


def _sub_counting(pattern: re.Pattern[str], token: str, text: str, report: MaskingReport) -> str:
    def replace(_match: re.Match[str]) -> str:
        report.add(token)
        return token

    return pattern.sub(replace, text)


def mask_patterns(text: str) -> str:
    """숫자·형식 정규식 계층만 적용한다. 사전·NER 없이도 항상 이 최소선은 보장된다."""
    for pattern, token in _REGEX_LAYERS:
        text = pattern.sub(token, text)
    return text


def mask_conditions(text: str) -> str:
    """질병명 사전 계층만 적용한다 (G3). 상담 맥락 문장은 건드리지 않는다."""
    return _CONDITION.sub(CONDITION_TOKEN, text)


def mask_text(text: str, ner: NerFn | None = None, condition_ner: NerFn | None = None) -> str:
    """전 계층 마스킹. 보고서가 필요하면 `mask_text_with_report` 를 쓴다."""
    masked, _report = mask_text_with_report(text, ner, condition_ner)
    return masked


def mask_text_with_report(
    text: str,
    ner: NerFn | None = None,
    condition_ner: NerFn | None = None,
) -> tuple[str, MaskingReport]:
    """전 계층 마스킹 + 집계.

    순서: NER 스팬(오프셋 기반이라 먼저) → 질병명 사전 → 숫자·형식 정규식.
    NER 스팬은 **뒤에서 앞으로** 치환해 앞선 치환이 뒤 스팬의 오프셋을 밀지 않게 한다.
    인명·질병명 두 목록은 **합쳐서 한 번에** 정렬한다 — 목록별로 따로 치환하면 앞 목록의
    치환이 뒤 목록 스팬의 오프셋을 밀어 엉뚱한 자리를 지운다.
    """
    report = MaskingReport()
    spans: list[tuple[int, int, str]] = []
    for span_fn, token in ((ner, PERSON_TOKEN), (condition_ner, CONDITION_TOKEN)):
        if span_fn is None:
            continue
        spans.extend((start, end, token) for start, end in span_fn(text))

    previous_start = len(text)
    for start, end, token in sorted(spans, key=lambda span: span[0], reverse=True):
        # 겹치는 스팬은 뒤쪽만 살린다 — 앞 스팬이 이미 치환한 자리를 다시 자르지 않는다.
        if 0 <= start < end <= previous_start:
            text = text[:start] + token + text[end:]
            report.add(token)
            previous_start = start

    text = _sub_counting(_CONDITION, CONDITION_TOKEN, text, report)
    for pattern, token in _REGEX_LAYERS:
        text = _sub_counting(pattern, token, text, report)
    return text, report


class MaskingConfigError(Exception):
    """마스킹 계층 설정 오류. 메시지에 전사 내용·시크릿을 넣지 않는다 (R3)."""


def _assert_labels_exist(recognizer, model_id: str, label_prefixes: tuple[str, ...]) -> None:  # noqa: ANN001
    """모델이 **선언한** 라벨 목록과 설정한 접두를 대조한다.

    왜 필요한가: 라벨 체계는 모델마다 다르다(KLUE 계열 `PS`/`PER` vs PII 전용 모델 `NAME` 계열).
    접두가 어긋나면 파이프라인은 정상 동작하는데 **치환만 0건**이 되고, 로그에도 아무것도 남지
    않는다 — "이름이 없는 상담 기록"과 구분할 방법이 없다. 그 조용한 실패가 곧 PII 유출이라
    (R3), 여기서 시끄럽게 죽인다. 이 검사는 연결이 맞는지까지만 본다 — 그 모델이 한국어
    상담체에서 인명을 **잘 찾는지**는 실측 게이트의 몫이다.
    """
    declared = getattr(getattr(recognizer, "model", None), "config", None)
    id2label = getattr(declared, "id2label", None)
    if not isinstance(id2label, dict) or not id2label:
        # 라벨 목록을 못 읽는 모델이면 대조 자체가 불가능하다 — 통과시키지 않는다.
        raise MaskingConfigError(f"NER model {model_id} does not declare a label set")

    labels = {str(value).upper() for value in id2label.values()}
    # 파이프라인의 aggregation 이 태깅 접두를 떼므로 여기서도 떼고 비교한다.
    # BIO 뿐 아니라 BIOES(E-·S-)·BILOU(L-·U-)도 쓴다 — 실제로 채택한 모델
    # (korean-pii-e5-base)이 BIOES 다. 접두 목록이 좁으면 멀쩡한 모델을 거부한다.
    stripped = {label.split("-", 1)[1] if label[:2] in _TAG_PREFIXES else label for label in labels}
    if not any(label.startswith(label_prefixes) for label in stripped):
        raise MaskingConfigError(
            f"NER model {model_id} declares no label starting with {label_prefixes} "
            f"(declared: {sorted(stripped)})",
        )


def _build_span_ner(model_id: str, label_prefixes: tuple[str, ...]):  # noqa: ANN202 — 반환은 NerFn
    """transformers NER 파이프라인을 스팬 함수로 감싼다 (지연 임포트 — ML 설치 환경 전용).

    라벨 체계는 모델마다 다르므로 **모델과 라벨 접두를 한 쌍으로 설정**하고(config.py),
    여기서 모델이 선언한 라벨과 대조한다. 어긋나면 뜨지 않는다.
    """
    from transformers import pipeline  # noqa: PLC0415

    recognizer = pipeline("token-classification", model=model_id, aggregation_strategy="simple")
    _assert_labels_exist(recognizer, model_id, label_prefixes)

    def ner(text: str) -> list[tuple[int, int]]:
        spans: list[tuple[int, int]] = []
        for entity in recognizer(text):
            group = str(entity.get("entity_group", "")).upper()
            if group.startswith(label_prefixes):
                spans.append((int(entity["start"]), int(entity["end"])))
        return spans

    return ner


def build_ner(model_id: str, label_prefixes: tuple[str, ...] = DEFAULT_PERSON_LABELS):  # noqa: ANN201
    """인명 스팬 NER. 어느 라벨을 인명으로 볼지는 **모델과 함께 설정**한다(config.ner_labels)."""
    return _build_span_ner(model_id, label_prefixes)


def build_condition_ner(model_id: str, label_prefixes: tuple[str, ...] = DEFAULT_CONDITION_LABELS):  # noqa: ANN201
    """질병명 스팬 NER (G3) — **사전의 보완재이지 대체재가 아니다.**

    사전(`condition_terms.py`)이 항상 먼저 동작하고, 이 계층은 사전에 없는 표기·오탈자를
    줍는 몫이다. 라벨 접두는 모델과 함께 설정한다(config.condition_ner_labels).
    """
    return _build_span_ner(model_id, label_prefixes)
