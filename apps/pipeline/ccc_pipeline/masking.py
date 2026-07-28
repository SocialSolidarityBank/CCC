"""2차 PII 마스킹 (D2, R3).

1차(등록 PII 값 → 가명 ID 치환)는 gateway(ingestSessionArtifacts)가 서버에서 수행한다.
여기는 2차 — 대화에 등장하는 제3자 인명·전화번호 등 패턴을 로컬에서 마스킹한 뒤에만
텍스트가 장비를 떠난다.

- 정규식 계층(항상 동작): 전화번호·주민등록번호·이메일·계좌형 숫자열
- NER 계층(선택): CCC_NER_MODEL_ID 설정 시 한국어 개체명 인식으로 인명을 추가 마스킹.
  모델은 라이선스 표기를 확인한 것만 지정한다 (CLAUDE.md §5 규칙).
"""

from __future__ import annotations

import re
from collections.abc import Callable

# 치환 토큰 — 검토 화면에서 마스킹 사실이 보이도록 각괄호 한글 라벨을 쓴다.
PHONE_TOKEN = "[전화번호]"
RRN_TOKEN = "[주민번호]"
EMAIL_TOKEN = "[이메일]"
ACCOUNT_TOKEN = "[계좌번호]"
PERSON_TOKEN = "[인명]"

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

# 인명 NER 함수 시그니처: 텍스트 → (시작, 끝) 문자 오프셋 목록.
NerFn = Callable[[str], list[tuple[int, int]]]


def mask_patterns(text: str) -> str:
    """정규식 계층만 적용한다. NER 없이도 항상 이 최소선은 보장된다."""
    for pattern, token in _REGEX_LAYERS:
        text = pattern.sub(token, text)
    return text


def mask_text(text: str, ner: NerFn | None = None) -> str:
    """정규식 + (있으면) NER 인명 마스킹. NER 스팬을 먼저 치환해 오프셋이 어긋나지 않게 한다."""
    if ner is not None:
        spans = sorted(ner(text), key=lambda span: span[0], reverse=True)
        for start, end in spans:
            if 0 <= start < end <= len(text):
                text = text[:start] + PERSON_TOKEN + text[end:]
    return mask_patterns(text)


def build_ner(model_id: str):  # noqa: ANN201 — 반환은 NerFn
    """transformers NER 파이프라인을 인명 스팬 함수로 감싼다 (지연 임포트 — ML 설치 환경 전용).

    인명 계열 라벨(PS/PER/PERSON 접두)만 마스킹 대상으로 본다. 라벨 체계는 모델마다
    달라서, 노트북 세팅 때 실제 모델의 라벨 목록을 확인하고 필요하면 여기를 보정한다.
    """
    from transformers import pipeline  # noqa: PLC0415

    recognizer = pipeline("token-classification", model=model_id, aggregation_strategy="simple")

    def ner(text: str) -> list[tuple[int, int]]:
        spans: list[tuple[int, int]] = []
        for entity in recognizer(text):
            group = str(entity.get("entity_group", "")).upper()
            if group.startswith(("PS", "PER")):
                spans.append((int(entity["start"]), int(entity["end"])))
        return spans

    return ner
