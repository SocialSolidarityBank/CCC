"""2차 PII 마스킹 (D2, R3).

1차(등록 PII 값 → 가명 ID 치환)는 gateway(ingestSessionArtifacts)가 서버에서 수행한다.
여기는 2차 — 대화에 등장하는 제3자 인명·전화번호 등 패턴을 로컬에서 마스킹한 뒤에만
텍스트가 장비를 떠난다.

- 준식별자 계층(항상 동작): 날짜·나이·지역 일반화 뒤 상세 주소·우편번호 토큰화
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

import operator
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import date

from .condition_terms import ALL_TERMS
from .model_registry import ModelRegistryError, model_spec

NER_AGGREGATION_STRATEGY = "none"
NER_DECODER_VERSION = "bioes-v1"
NER_TORCH_VERSION = "2.8.0"
NER_TRANSFORMERS_VERSION = "4.53.3"

# 치환 토큰 — 검토 화면에서 마스킹 사실이 보이도록 각괄호 한글 라벨을 쓴다.
PHONE_TOKEN = "[전화번호]"
RRN_TOKEN = "[주민번호]"
EMAIL_TOKEN = "[이메일]"
ACCOUNT_TOKEN = "[계좌번호]"
PERSON_TOKEN = "[인명]"
ADDRESS_TOKEN = "[주소]"
CONDITION_TOKEN = "[질환]"
POSTCODE_TOKEN = "[우편번호]"
REGION_TOKEN = "[지역]"
QUASI_IDENTIFIER_TOKEN = "[준식별자]"

# 태깅 접두(BIO·BIOES·BILOU). 라벨 대조 전에 떼어 낸다.
_TAG_PREFIXES = ("B-", "I-", "E-", "S-", "L-", "U-")

# 라벨 접두 기본값 — **여러 계열을 함께 담는다.** 모델마다 이름이 달라서다:
#   KLUE·모두의 말뭉치 계열 → PS / PER
#   PII 전용 모델 → NAME 또는 PRIVATE_PERSON (채택 모델 korean-pii-e5-base 가 후자)
# 접두가 그 모델과 하나도 안 맞으면 로드 단계에서 죽으므로(_assert_labels_exist),
# 기본값이 넓어도 조용히 어긋난 채 도는 일은 없다. 모델을 정하면 CCC_NER_LABELS 로
# 그 모델의 라벨만 명시하는 쪽이 더 안전하다 — 의도한 라벨이 문서에 남는다.
DEFAULT_PERSON_LABELS = ("PS", "PER", "NAME", "PRIVATE_PERSON")
# 주소 계층(2026-08-01 Q 결정 — 이름과 함께 가린다). "○○아파트 3동" 만으로도 사람이
# 특정되는데, 상담 내용을 이해하는 데는 주소가 없어도 지장이 없다. 빈 튜플로 두면 계층이 꺼진다.
DEFAULT_ADDRESS_LABELS = ("LC", "ADDRESS", "PRIVATE_ADDRESS")
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

# S6 §2.5 준식별자 후보. 날짜는 계좌 패턴보다 먼저 처리한다.
_ISO_DATE = re.compile(
    r"(?<![\d-])(?P<year>\d{4})(?P<separator>[-./])(?P<month>\d{1,2})"
    r"(?P=separator)(?P<day>\d{1,2})(?![\d-])",
)
_KOREAN_DATE = re.compile(
    r"(?<!\d)(?P<year>\d{4})년\s*(?P<month>\d{1,2})월\s*(?P<day>\d{1,2})일(?!\d)",
)
_KOREAN_MONTH_DAY = re.compile(r"(?<![\d년])\d{1,2}월\s*\d{1,2}일(?!\d)")
_EXPLICIT_AGE = re.compile(r"(?<![\d-])(?:만\s*)?(?P<age>\d{1,3})(?:세(?!기|대)|살)")

_METRO_NAMES = (
    "세종특별자치시",
    "서울특별시",
    "부산광역시",
    "대구광역시",
    "인천광역시",
    "광주광역시",
    "대전광역시",
    "울산광역시",
    "강원특별자치도",
    "전북특별자치도",
    "제주특별자치도",
    "전라북도",
    "전라남도",
    "충청북도",
    "충청남도",
    "경상북도",
    "경상남도",
    "경기도",
    "강원도",
    "제주도",
    "서울시",
    "부산시",
    "대구시",
    "인천시",
    "광주시",
    "대전시",
    "울산시",
    "세종시",
    "전북",
    "전남",
    "충북",
    "충남",
    "경북",
    "경남",
)
_METRO = "(?:" + "|".join(map(re.escape, _METRO_NAMES)) + ")"
_CITY_NAMES = (
    "수원시",
    "고양시",
    "용인시",
    "성남시",
    "부천시",
    "화성시",
    "안산시",
    "남양주시",
    "안양시",
    "평택시",
    "시흥시",
    "파주시",
    "의정부시",
    "김포시",
    "광주시",
    "광명시",
    "군포시",
    "하남시",
    "오산시",
    "양주시",
    "이천시",
    "구리시",
    "안성시",
    "포천시",
    "의왕시",
    "여주시",
    "동두천시",
    "과천시",
    "춘천시",
    "원주시",
    "강릉시",
    "동해시",
    "태백시",
    "속초시",
    "삼척시",
    "청주시",
    "충주시",
    "제천시",
    "천안시",
    "공주시",
    "보령시",
    "아산시",
    "서산시",
    "논산시",
    "계룡시",
    "당진시",
    "전주시",
    "군산시",
    "익산시",
    "정읍시",
    "남원시",
    "김제시",
    "목포시",
    "여수시",
    "순천시",
    "나주시",
    "광양시",
    "포항시",
    "경주시",
    "김천시",
    "안동시",
    "구미시",
    "영주시",
    "영천시",
    "상주시",
    "문경시",
    "경산시",
    "창원시",
    "진주시",
    "통영시",
    "사천시",
    "김해시",
    "밀양시",
    "거제시",
    "양산시",
    "제주시",
    "서귀포시",
)
_CITY = "(?:" + "|".join(map(re.escape, _CITY_NAMES)) + ")"
# 읍/면/동/리 접미사와 조사만으로는 지역으로 보지 않는다. 이 하위 이름들은
# 명시된 광역 또는 시/군/구 뒤의 행정구역 계층 안에서만 인식한다.
_LOCAL_ADMIN = r"[가-힣]{1,12}(?:시|군|구|읍|면|동|리)"
_NON_METRO_LOCAL_ADMIN = rf"(?!(?:{_METRO})(?=\s)){_LOCAL_ADMIN}"
_ADMIN_CHAIN = rf"{_NON_METRO_LOCAL_ADMIN}(?:\s+{_NON_METRO_LOCAL_ADMIN}){{0,2}}"
_REGION_END = r"(?=$|[\s,.;:!?)]|(?:에서|으로|까지|부터|에|로|은|는|이|가|을|를|와|과|의)(?=$|[\s,.;:!?)]))"
_NON_REGION_SUFFIX_WORDS = (
    "지역구",
    "선거구",
    "행정구",
    "자치구",
    "출입구",
    "비상구",
    "환기구",
    "환풍구",
    "통풍구",
    "개찰구",
    "투입구",
    "배출구",
    "배수구",
    "하수구",
    "매표구",
    "연합군",
    "정부군",
    "유엔군",
    "예비군",
    "시민군",
    "의용군",
)
_NON_REGION_SUFFIX_WORD = "(?:" + "|".join(map(re.escape, _NON_REGION_SUFFIX_WORDS)) + ")"
_BARE_DISTRICT = (
    rf"(?!(?:{_NON_REGION_SUFFIX_WORD}){_REGION_END})"
    rf"(?:{_CITY}|[가-힣]{{2,12}}(?:군|구)|[중동서남북]구)"
)
_REGION_WITH_SUBREGION = re.compile(
    rf"(?<![가-힣])(?P<metro>{_METRO})\s+"
    rf"(?P<subregions>{_ADMIN_CHAIN}){_REGION_END}",
)
_LOCAL_REGION = re.compile(
    rf"(?<![가-힣])(?!(?:{_METRO}))"
    rf"(?P<region>{_BARE_DISTRICT}(?:\s+{_NON_METRO_LOCAL_ADMIN}){{0,2}}){_REGION_END}",
)

# 대한민국 주소 계층은 광역 1단계 + 하위 3단계로 제한한다. 광역명은 반복 하위 단계에서
# 제외해 "서울시 " 반복 입력에 같은 접두를 여러 방식으로 재해석하는 백트래킹을 막는다.
_ADMIN_PREFIX = rf"(?:{_METRO}\s+)?(?:{_NON_METRO_LOCAL_ADMIN}\s+){{0,3}}"
_ROAD_NAME = r"[가-힣A-Za-z0-9·.-]{1,30}(?:대로|로|길)"
_BUILDING_NAME = (
    r"[가-힣A-Za-z0-9·.-]{1,30}(?:아파트|빌라|오피스텔|빌딩|타워|센터|주택|연립|건물)"
)
_UNIT = r"(?:\d{1,4}동(?:\s*\d{1,5}호)?|\d{1,5}호)"
_ADDRESS_END = _REGION_END
_LOT_NUMBER = r"\d{1,5}(?:-\d{1,5})?(?:번지)?"
_ROAD_BRANCH = r"(?:\s+\d{1,3}(?:번)?길)?"
_ROAD_ADDRESS = (
    rf"{_ADMIN_PREFIX}{_ROAD_NAME}{_ROAD_BRANCH}\s*{_LOT_NUMBER}"
    rf"(?:\s+(?:{_BUILDING_NAME}|{_UNIT})){{0,3}}"
)
_LOT_ADDRESS = (
    rf"{_ADMIN_PREFIX}[가-힣]{{1,12}}(?:읍|면|동|리)\s*(?:산\s*)?"
    rf"{_LOT_NUMBER}(?:\s+{_UNIT})?"
)
_ADMIN_LOT_ADDRESS = (
    rf"(?:{_METRO}\s*)?(?:{_NON_METRO_LOCAL_ADMIN}\s*){{1,3}}(?:산\s*)?"
    rf"{_LOT_NUMBER}(?:\s+{_UNIT})?"
)
_BUILDING_ADDRESS = rf"{_ADMIN_PREFIX}{_BUILDING_NAME}(?:\s*{_UNIT}){{0,2}}"
_UNIT_PAIR = r"\d{1,4}동\s*\d{1,5}호"
_NAMED_UNIT_ADDRESS = (
    rf"{_ADMIN_PREFIX}(?:[가-힣A-Za-z0-9·.-]{{1,30}}\s+)?{_UNIT_PAIR}"
)
_ADDRESS = re.compile(
    rf"(?<![가-힣A-Za-z0-9])(?:{_ROAD_ADDRESS}|{_ADMIN_LOT_ADDRESS}|{_LOT_ADDRESS}|"
    rf"{_BUILDING_ADDRESS}|{_NAMED_UNIT_ADDRESS}){_ADDRESS_END}",
)
_PARENTHETICAL_ADDRESS_REFERENCE = re.compile(
    rf"[ \t]*\([ \t]*(?:[가-힣]{{1,12}}(?:동|리))"
    rf"(?:[ \t]*,?[ \t]*{_BUILDING_NAME})?[ \t]*\)",
)
_QUOTED_ROAD_REFERENCE = re.compile(
    rf"[\"“‘'](?P<road>{_ROAD_NAME})[ \t]+"
    r"(?:근처|인근|부근|일대|방향|주변|쪽)(?=[\s\"”’'.,])",
)
_LOCATION_CONTEXT_BEFORE = re.compile(
    r"(?:거주지|주거지|주소|소재지|방문지|배송지|거처|현재[ \t]+위치|위치[ \t]+표현|"
    r"방문할[ \t]+곳|방향[ \t]+설명)"
    r"(?:[ \t]*(?:설명|표현|정보|란))?(?:에는|에서|은|는|이|가|에|로|:)?[ \t]*$",
)
_NON_LOCATION_CLAUSE = re.compile(
    r"(?:책[ \t]*제목|비유|속담|독서|모임|작품|노선|안건|서식|문서|장소를[ \t]+뜻하지[ \t]+않)",
)
_POSTCODE = re.compile(r"(?<![\d-])\d{5}(?![\d-])")
_STRUCTURED_LAYERS = (*_REGEX_LAYERS, (_POSTCODE, POSTCODE_TOKEN))

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


# 겹친 스팬이 서로 다른 계층일 때 어느 토큰으로 가릴지. 식별력이 큰 쪽이 앞이다.
_TOKEN_PRIORITY = (
    PERSON_TOKEN, ADDRESS_TOKEN, CONDITION_TOKEN,
    *(token for _, token in _STRUCTURED_LAYERS),
)


def _merge_spans(spans: list[tuple[int, int, str]], limit: int) -> list[tuple[int, int, str]]:
    """겹치는 스팬을 **합쳐서** 한 번에 가릴 구간 목록으로 만든다.

    2026-08-01 Q 결정(못 가리는 것보다 과하게 가리는 쪽)의 구현이다. 겹칠 때 한쪽을
    버리면 겹치지 않는 부분이 원문 그대로 남고, 잘라서 치환하면 `[인명][주소]수` 처럼
    조각이 남는다 — 둘 다 유출이다. 합집합을 한 토큰으로 덮으면 남는 조각이 없다.

    계층이 섞이면 식별력이 큰 쪽 토큰을 쓴다(인명 > 주소 > 질환). 모든 원문 오프셋을
    한 번에 적용할 수 있도록 오름차순으로 돌려준다.
    """
    # 범위를 벗어난 스팬은 버린다 — 모델이 텍스트 밖 오프셋을 주면 그건 좌표가 깨진 것이고,
    # 그 좌표로 자르면 엉뚱한 자리가 사라진다. 끝만 넘치면 텍스트 끝까지로 줄여 가린다.
    valid = sorted(
        (
            (start, min(end, limit), token)
            for start, end, token in spans
            if 0 <= start < end and start < limit
        ),
        key=lambda span: span[0],
    )
    merged: list[tuple[int, int, set[str]]] = []
    for start, end, token in valid:
        if merged and start < merged[-1][1]:
            previous_start, previous_end, tokens = merged[-1]
            tokens.add(token)
            merged[-1] = (previous_start, max(previous_end, end), tokens)
            continue
        merged.append((start, end, {token}))

    def pick(tokens: set[str]) -> str:
        for candidate in _TOKEN_PRIORITY:
            if candidate in tokens:
                return candidate
        return next(iter(tokens))

    return [(start, end, pick(tokens)) for start, end, tokens in merged]


def _sub_counting(pattern: re.Pattern[str], token: str, text: str, report: MaskingReport) -> str:
    def replace(_match: re.Match[str]) -> str:
        report.add(token)
        return token

    return pattern.sub(replace, text)


def _generalize_dates(text: str, report: MaskingReport) -> str:
    def replace_iso(match: re.Match[str]) -> str:
        year = int(match["year"])
        month = int(match["month"])
        day = int(match["day"])
        try:
            date(year, month, day)
        except ValueError:
            report.add(QUASI_IDENTIFIER_TOKEN)
            return QUASI_IDENTIFIER_TOKEN
        if match["separator"] != "-":
            report.add(QUASI_IDENTIFIER_TOKEN)
            return QUASI_IDENTIFIER_TOKEN
        return f"{year:04d}-{month:02d}"

    def replace_korean(match: re.Match[str]) -> str:
        year = int(match["year"])
        month = int(match["month"])
        day = int(match["day"])
        try:
            date(year, month, day)
        except ValueError:
            report.add(QUASI_IDENTIFIER_TOKEN)
            return QUASI_IDENTIFIER_TOKEN
        return f"{year:04d}-{month:02d}"

    text = _ISO_DATE.sub(replace_iso, text)
    text = _KOREAN_DATE.sub(replace_korean, text)
    return _sub_counting(_KOREAN_MONTH_DAY, QUASI_IDENTIFIER_TOKEN, text, report)


def _generalize_ages(text: str) -> str:
    def replace(match: re.Match[str]) -> str:
        lower = int(match["age"]) // 5 * 5
        return f"{lower}-{lower + 4}세"

    return _EXPLICIT_AGE.sub(replace, text)


def _strict_context_road_spans(text: str) -> list[tuple[int, int]]:
    spans = []
    for match in _QUOTED_ROAD_REFERENCE.finditer(text):
        sentence_start = max(text.rfind(mark, 0, match.start()) for mark in ".!?\n") + 1
        sentence_end_candidates = [text.find(mark, match.end()) for mark in ".!?\n"]
        sentence_end = min(
            (value for value in sentence_end_candidates if value >= 0),
            default=len(text),
        )
        before = text[sentence_start:match.start()]
        road = match.group("road")
        if len(road) < 3 or road.endswith("으로"):
            continue
        clause = text[sentence_start:sentence_end]
        if _LOCATION_CONTEXT_BEFORE.search(before) and not _NON_LOCATION_CLAUSE.search(clause):
            spans.append(match.span("road"))
    return spans


def _address_spans(text: str) -> list[tuple[int, int]]:
    spans = []
    for match in _ADDRESS.finditer(text):
        start, end = match.span()
        reference = _PARENTHETICAL_ADDRESS_REFERENCE.match(text, end)
        if reference is not None:
            end = reference.end()
        spans.append((start, end))
    spans.extend(_strict_context_road_spans(text))
    return spans



def _generalize_regions(text: str, report: MaskingReport) -> str:
    address_spans = _address_spans(text)

    def inside_address(match: re.Match[str]) -> bool:
        return any(start <= match.start() and match.end() <= end for start, end in address_spans)

    replacements: list[tuple[int, int, str]] = []
    metro_matches = list(_REGION_WITH_SUBREGION.finditer(text))
    for match in metro_matches:
        if not inside_address(match):
            replacements.append((match.start(), match.end(), match["metro"]))

    for match in _LOCAL_REGION.finditer(text):
        if inside_address(match) or any(
            metro.start() <= match.start() and match.end() <= metro.end()
            for metro in metro_matches
        ):
            continue
        replacements.append((match.start(), match.end(), REGION_TOKEN))
        report.add(REGION_TOKEN)

    for start, end, replacement in sorted(replacements, key=lambda item: item[0], reverse=True):
        text = text[:start] + replacement + text[end:]
    return text


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
    address_ner: NerFn | None = None,
) -> tuple[str, MaskingReport]:
    """전 계층 마스킹 + 집계.

    원문의 주소·정형 식별자·NER 구간을 합쳐 한 번에 가린 뒤 날짜·나이·지역을
    일반화하고 질병명 사전을 적용한다. 정형 식별자를 바뀐 문자열에서 다시 찾지
    않으므로 부분 NER가 뒤쪽 숫자나 이메일 조각을 남기지 않는다.
    """
    report = MaskingReport()
    spans = [
        (start, end, ADDRESS_TOKEN)
        for start, end in _address_spans(text)
    ]
    # 계층마다 **자기 토큰**을 쓴다 — 주소를 [인명] 으로 치환하면 검토 화면과 집계가
    # 둘 다 거짓이 된다(무엇이 가려졌는지가 실무자에게 필요한 정보다).
    for span_fn, token in (
        (ner, PERSON_TOKEN),
        (address_ner, ADDRESS_TOKEN),
        (condition_ner, CONDITION_TOKEN),
    ):
        if span_fn is None:
            continue
        spans.extend((start, end, token) for start, end in span_fn(text))

    date_spans = [(date.start(), date.end()) for date in _ISO_DATE.finditer(text)]
    for date_start, date_end in date_spans:
        if any(
            0 <= start < end and start < date_end and date_start < end
            for start, end, _ in spans
        ):
            # 계좌 형식에 기대지 않는다. 한 자리 월·일도 조각 없이 보호한다.
            spans.append((date_start, date_end, QUASI_IDENTIFIER_TOKEN))
    for pattern, token in _STRUCTURED_LAYERS:
        for match in pattern.finditer(text):
            if pattern is _ACCOUNT:
                # 온전한 ISO 날짜의 일반화를 보존한다. 겹친 날짜는 위에서 이미 보호했다.
                if any(start < match.end() and match.start() < end for start, end in date_spans):
                    continue
            spans.append((match.start(), match.end(), token))

    merged_spans = _merge_spans(spans, len(text))
    if merged_spans:
        pieces: list[str] = []
        position = 0
        for start, end, token in merged_spans:
            pieces.extend((text[position:start], token))
            position = end
            report.add(token)
        pieces.append(text[position:])
        text = "".join(pieces)

    text = _generalize_dates(text, report)
    text = _generalize_ages(text)
    text = _generalize_regions(text, report)

    text = _sub_counting(_CONDITION, CONDITION_TOKEN, text, report)
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
    # 선언 라벨도 런타임 디코더와 같은 BIO/BIOES/BILOU 접두를 벗겨 비교한다.
    stripped = {label.split("-", 1)[1] if label[:2] in _TAG_PREFIXES else label for label in labels}
    if not any(label.startswith(label_prefixes) for label in stripped):
        raise MaskingConfigError(
            f"NER model {model_id} declares no label starting with {label_prefixes} "
            f"(declared: {sorted(stripped)})",
        )


def decode_ner_entities(tokens: list[dict], text_length: int) -> list[dict]:
    """토큰의 BIO/BIOES/BILOU 경계를 해석하고 원문 좌표만 돌려준다.

    B는 새 구간, E/L은 끝, S/U는 단독 구간이다. O와 범주 변경은 구간을 끊는다.
    시작 없는 I/E/L도 버리지 않고 새 구간으로 보존하며 정답으로 경계를 보정하지 않는다.
    """
    groups: list[dict] = []
    current = None
    previous_start = -1
    for token in tokens:
        try:
            raw_label = token["entity"]
            if not isinstance(raw_label, str) or not raw_label:
                raise ValueError
            if isinstance(token["start"], bool) or isinstance(token["end"], bool):
                raise ValueError
            start, end = operator.index(token["start"]), operator.index(token["end"])
            if not 0 <= start <= end <= text_length or start < previous_start:
                raise ValueError
        except (KeyError, TypeError, ValueError):
            raise MaskingConfigError("NER token label or coordinates are invalid") from None
        previous_start = start
        label = raw_label.upper()
        if label == "O":
            current = None
            continue
        tag, label = (label[0], label[2:]) if label[:2] in _TAG_PREFIXES else ("S", label)
        if not label:
            raise MaskingConfigError("NER token label or coordinates are invalid")
        if current is None or current["entity_group"] != label or tag in ("B", "S", "U"):
            current = {"entity_group": label, "start": start, "end": end}
            groups.append(current)
        else:
            current["end"] = max(current["end"], end)
        if tag in ("E", "L", "S", "U"):
            current = None
    return [group for group in groups if group["start"] < group["end"]]


NER_MAX_INPUT_CHARS = 24_000
NER_WINDOW_TOKENS = 512
NER_WINDOW_OVERLAP_TOKENS = 128
NER_MAX_WINDOWS = 64


def recognize_ner_tokens(recognizer, text: str) -> list[dict]:  # noqa: ANN001
    """전체 토큰을 검사하고 겹친 구간은 문맥이 더 넓은 예측 하나만 고른다."""
    try:
        if not isinstance(text, str) or len(text) > NER_MAX_INPUT_CHARS:
            raise ValueError
        tokenizer = recognizer.tokenizer
        if not tokenizer.is_fast or tokenizer.model_max_length < NER_WINDOW_TOKENS:
            raise ValueError
        capacity = NER_WINDOW_TOKENS - tokenizer.num_special_tokens_to_add(pair=False)
        if not NER_WINDOW_OVERLAP_TOKENS < capacity <= NER_WINDOW_TOKENS:
            raise ValueError
        windows = []
        original = []
        previous = []
        covered_until = 0
        for chunk in recognizer.preprocess(text, is_split_into_words=False, tokenizer_params={
            "max_length": NER_WINDOW_TOKENS,
            "stride": NER_WINDOW_OVERLAP_TOKENS,
            "return_overflowing_tokens": True,
            "padding": True,
        }):
            if len(windows) >= NER_MAX_WINDOWS:
                raise ValueError
            ids = chunk["input_ids"][0].tolist()
            specials = chunk["special_tokens_mask"][0].tolist()
            offsets = chunk["offset_mapping"][0].tolist()
            if not 0 < len(ids) == len(specials) == len(offsets) <= NER_WINDOW_TOKENS:
                raise ValueError
            positions = []
            tokens = []
            for position, (token_id, special, offset) in enumerate(zip(ids, specials, offsets)):
                if special not in (0, 1):
                    raise ValueError
                if special:
                    continue
                start, end = map(operator.index, offset)
                if not 0 <= start <= end <= len(text):
                    raise ValueError
                if tokens and start < tokens[-1][1]:
                    raise ValueError
                positions.append(position)
                tokens.append((token_id, start, end))
            if len(tokens) > capacity:
                raise ValueError
            overlap = NER_WINDOW_OVERLAP_TOKENS if windows else 0
            if windows and (
                len(previous) != capacity or len(tokens) <= overlap
                or tokens[:overlap] != previous[-overlap:]
            ):
                raise ValueError
            base = len(original) - overlap
            for token in tokens[overlap:]:
                _, start, end = token
                if original and start < original[-1][1]:
                    raise ValueError
                if start > covered_until and not text[covered_until:start].isspace():
                    raise ValueError
                covered_until = max(covered_until, end)
                original.append(token)
            windows.append((chunk, positions, tokens, base))
            previous = tokens
        if not windows or (covered_until < len(text) and not text[covered_until:].isspace()):
            raise ValueError
        if any(chunk["is_last"] != (index == len(windows) - 1)
               for index, (chunk, _, _, _) in enumerate(windows)):
            raise ValueError
        selected = [None] * len(original)
        context = [-1] * len(original)
        for chunk, positions, tokens, base in windows:
            # 각 구간에도 원문 좌표의 참조를 넘긴다. 문자열은 복제하지 않는다.
            chunk["sentence"] = text
            predictions = recognizer.postprocess(
                [recognizer.forward(chunk)],
                aggregation_strategy=NER_AGGREGATION_STRATEGY,
                ignore_labels=[],
            )
            if len(predictions) != len(tokens):
                raise ValueError
            for local, (prediction, position, token) in enumerate(zip(predictions, positions, tokens)):
                _, start, end = token
                if (prediction["index"] != position or prediction["start"] != start
                        or prediction["end"] != end or not isinstance(prediction["entity"], str)
                        or not prediction["entity"]):
                    raise ValueError
                weight = min(local, len(tokens) - local - 1)
                index = base + local
                if weight > context[index]:
                    selected[index] = {"entity": prediction["entity"], "start": start, "end": end}
                    context[index] = weight
        if any(token is None for token in selected):
            raise ValueError
        return selected
    except Exception as error:
        error.__traceback__ = None
        error.__context__ = None
        error.__cause__ = None
    # 오류 경로의 입력 참조를 놓은 뒤 새 예외를 만든다.
    recognizer = tokenizer = text = chunk = windows = None
    ids = specials = offsets = positions = tokens = original = previous = None
    selected = context = predictions = prediction = token = None
    raise MaskingConfigError("local_ner_unavailable")


def _span_fn(recognizer, label_prefixes: tuple[str, ...]):  # noqa: ANN001, ANN202 — 반환은 NerFn
    """공통 토큰 디코더의 결과에서 특정 라벨 접두를 고르는 스팬 함수를 만든다."""

    def ner(text: str) -> list[tuple[int, int]]:
        return [
            (entity["start"], entity["end"])
            for entity in decode_ner_entities(recognizer(text), len(text))
            if entity["entity_group"].startswith(label_prefixes)
        ]

    return ner


def _require_ner_runtime() -> None:
    from importlib.metadata import version  # noqa: PLC0415

    try:
        installed = (version("torch").split("+", 1)[0], version("transformers").split("+", 1)[0])
        if installed != (NER_TORCH_VERSION, NER_TRANSFORMERS_VERSION):
            raise ValueError
    except Exception:
        raise MaskingConfigError("local_ner_unavailable") from None


def _build_span_ner(model_id: str, label_prefixes: tuple[str, ...]):  # noqa: ANN202 — 반환은 NerFn
    """transformers NER 파이프라인을 manifest revision으로 고정한다."""
    _require_ner_runtime()
    from transformers import pipeline  # noqa: PLC0415

    try:
        spec = model_spec(model_id)
    except ModelRegistryError as error:
        raise MaskingConfigError("NER model is not declared in model manifest") from error
    recognizer = pipeline(
        "token-classification",
        model=spec.name,
        revision=spec.revision,
        aggregation_strategy=NER_AGGREGATION_STRATEGY,
        ignore_labels=[],
    )
    _assert_labels_exist(recognizer, model_id, label_prefixes)
    return _span_fn(lambda text: recognize_ner_tokens(recognizer, text), label_prefixes)


def build_ner(model_id: str, label_prefixes: tuple[str, ...] = DEFAULT_PERSON_LABELS):  # noqa: ANN201
    """인명 스팬 NER. 어느 라벨을 인명으로 볼지는 **모델과 함께 설정**한다(config.ner_labels)."""
    return _build_span_ner(model_id, label_prefixes)


def build_person_and_address_ner(  # noqa: ANN201 — 반환은 (NerFn, NerFn | None)
    model_id: str,
    person_prefixes: tuple[str, ...] = DEFAULT_PERSON_LABELS,
    address_prefixes: tuple[str, ...] = DEFAULT_ADDRESS_LABELS,
):
    """인명·주소 두 계층을 **모델 한 번만 불러서** 만든다.

    채택 모델(korean-pii-e5-base)은 인명과 주소를 같은 모델이 잡는다. 계층마다 따로
    부르면 같은 가중치를 두 번 올려 장비 메모리를 낭비한다(장비는 STT·화자 분리·감정과
    자원을 나눠 쓴다).

    `address_prefixes` 가 비면 주소 계층 없이 인명만 돌린다 — 주소를 안 잡는 모델로
    갈아탈 때의 경로다. 비어 있지 **않은데** 모델이 그 라벨을 선언하지 않으면 뜨지 않는다.
    """

    _require_ner_runtime()
    from transformers import pipeline  # noqa: PLC0415
    try:
        spec = model_spec(model_id)
    except ModelRegistryError as error:
        raise MaskingConfigError("NER model is not declared in model manifest") from error
    recognizer = pipeline(
        "token-classification",
        model=spec.name,
        revision=spec.revision,
        aggregation_strategy=NER_AGGREGATION_STRATEGY,
        ignore_labels=[],
    )
    _assert_labels_exist(recognizer, model_id, person_prefixes)
    recognize = lambda text: recognize_ner_tokens(recognizer, text)
    person = _span_fn(recognize, person_prefixes)
    if not address_prefixes:
        return person, None
    _assert_labels_exist(recognizer, model_id, address_prefixes)
    return person, _span_fn(recognize, address_prefixes)


def build_condition_ner(model_id: str, label_prefixes: tuple[str, ...] = DEFAULT_CONDITION_LABELS):  # noqa: ANN201
    """질병명 스팬 NER (G3) — **사전의 보완재이지 대체재가 아니다.**

    사전(`condition_terms.py`)이 항상 먼저 동작하고, 이 계층은 사전에 없는 표기·오탈자를
    줍는 몫이다. 라벨 접두는 모델과 함께 설정한다(config.condition_ner_labels).
    """
    return _build_span_ner(model_id, label_prefixes)
