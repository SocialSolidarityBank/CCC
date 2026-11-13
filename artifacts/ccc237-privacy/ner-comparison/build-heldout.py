#!/usr/bin/env python3
"""Build the blinded, synthetic CCC-237 NER holdout corpus."""

from __future__ import annotations

import json
from pathlib import Path

OUTPUT = Path(__file__).with_name("heldout.json")

PERSON_TEMPLATES = [
    "어제 이모 {person}에게 안부 전화를 드렸다.",
    "제 친구 {person}{subject} 다음 주에 반찬을 가져오겠다고 했다.",
    "언니는 ‘{person} 씨가 먼저 연락했어’라고 전했다.",
    "옆집에 사는 {person}님께서 우산을 빌려 주셨다.",
    "형부의 동료 {person}한테 서류 전달을 부탁했다.",
    "상담 메모에는 보호자의 지인 {person}{subject} 동행한다고 적혀 있다.",
    "동생이 \"{person}에게 일정부터 물어볼게\"라고 말했다.",
    "대학 선배 {person}{with_particle} 오랜만에 점심을 먹었다.",
    "사촌 {person}{topic} 주말에 아이를 돌봐 주기로 했다.",
    "예전에 함께 일하던 {person}에게 소식을 들었다.",
    "‘연락할 사람은 {person}{copula}.’라고 조카가 알려 줬다.",
    "고모가 아는 분인 {person}께 도움을 청했다.",
    "{person} 씨는 제 동네 모임에서 알게 된 이웃이다.",
    "아버지의 친구 {person}{subject} 병문안을 오겠다고 했다.",
    "오랜 이웃인 {person}하고 장을 보러 가기로 했다.",
    "메모에는 ‘비상 연락은 {person}에게’라고만 적혀 있었다.",
    "\"누가 같이 간대?\" \"우리 형의 동료 {person}.\"",
    "{person}님이 할머니께 책을 읽어 드렸다고 들었다.",
    "선생님은 제자 {person}{object_particle} 기억한다고 말씀하셨다.",
    "연락할분은{person} 님이라고 안내받았다.",
]

PERSON_TAGS = [
    "relative",
    "acquaintance",
    "reported-speech",
    "honorific",
    "acquaintance",
    "briefing-note",
    "dialogue",
    "acquaintance",
    "relative",
    "acquaintance",
    "quoted-speech",
    "relative",
    "particle",
    "relative",
    "acquaintance",
    "quoted-note",
    "dialogue",
    "honorific",
    "reported-speech",
    "no-space",
]

ADDRESS_TEMPLATES = [
    "전입 신고할 새집의 상세 주소는 {address}입니다.",
    "택배를 받을 집은 ‘{address}’예요.",
    "보호자가 현재 거주하는 곳은 {address}로 확인했다.",
    "이사 계약서에 적힌 주택 소재지는 {address}이다.",
    "\"어디로 찾아가면 돼?\" \"우리 집은 {address}야.\"",
    "상담 메모: 가족이 머무는 주거지는 {address}임.",
    "아이가 방과 후 귀가할 집 주소를 {address}로 등록했다.",
    "등기우편은 자택인 {address}로 보내 주세요.",
    "지인이 알려 준 새 보금자리 주소는 {address}였다.",
    "내년부터 살 집은 {address}에 있다.",
    "배송지는{address}로 적어 주세요.",
    "세대주의 실제 거주지는 ‘{address}’로 기재되어 있다.",
    "동생 부부가 입주한 아파트 주소는 {address}이다.",
    "야간 귀가 때 도착할 집을 {address}로 설정했다.",
    "어머니는 \"우리 집은 {address}란다\"라고 말씀하셨다.",
    "전입 예정자의 거주 확인 주소가 {address}로 바뀌었다.",
    "생활지원 방문을 할 가정은 {address}에 거주한다.",
    "어머니께서 최근 옮기신 자택은 {address}이다.",
    "계약자가 우편물을 받을 주거 주소는 {address}로 정했다.",
    "새집주소는‘{address}’라고 가족에게 알렸다.",
]

ADDRESS_TAGS = [
    "residential",
    "quoted-address",
    "reported-address",
    "contract-note",
    "dialogue",
    "briefing-note",
    "registered-home",
    "residential-mail",
    "acquaintance-home",
    "future-home",
    "no-space",
    "household-record",
    "relative-home",
    "navigation-home",
    "reported-speech",
    "residency-record",
    "home-visit",
    "relative-home",
    "residential-mail",
    "no-space",
]

NEGATIVE_TEMPLATES = [
    "회의는 {month}월 {day}일 {hour}시에 시작한다.",
    "이번 달 운영비 잔액은 {amount:,}원이다.",
    "이번 주 목표는 상담 기록 {count}건을 정리하는 것이다.",
    "창고 선반에 종이 상자가 {count}개 남아 있다.",
    "오늘 낮 기온은 {temp}도까지 오를 전망이다.",
    "열차가 점검 때문에 {minute}분 늦게 출발했다.",
    "도서관 안내대는 {floor}층에 있고 {hour}시에 닫는다.",
    "중앙공원 산책로는 {month}월 {day}일 {hour}시부터 정비한다.",
    "문서에서 {page}쪽까지 검토를 마쳤다.",
    "급식실에 쌀 {weight}킬로그램이 남아 있다.",
    "설문 응답 목표를 {count}건으로 조정했다.",
    "안내 지도는 실제 거리의 {scale:,}분의 1로 축소되어 있다.",
    "강변 산책길의 공공 구간은 약 {distance}킬로미터다.",
    "지난달 전기 사용량은 {energy}킬로와트시였다.",
    "달력에는 제출 마감이 {month}월 {day}일로 표시되어 있다.",
    "오늘 점심은 보리밥과 채소국을 {count}인분 준비했다.",
    "팀 점검 회의는 {duration}분 동안 진행됐다.",
    "프린터 용지함에 종이 {count}장이 들어 있다.",
    "강의실에는 빈 의자가 {count}개 놓여 있다.",
    "보관실 습도는 {percent}퍼센트로 측정됐다.",
    "시청 앞 광장의 분수는 {month}월 {day}일 {hour}시에 작동한다.",
    "남부 지역의 이번 주 누적 강수량은 {rain}밀리미터다.",
    "생활용품 할인율이 {discount}퍼센트로 바뀌었다.",
    "휴대용 배터리 충전량은 {percent}퍼센트다.",
    "파란 컵 {count}개와 흰 접시 세 개를 식탁에 놓았다.",
]

NEGATIVE_TAGS = [
    "date-time",
    "amount",
    "goal",
    "ordinary-object",
    "weather",
    "duration",
    "public-place",
    "public-geography",
    "document",
    "inventory",
    "goal",
    "map-scale",
    "public-geography",
    "utility",
    "date",
    "ordinary-nouns",
    "duration",
    "inventory",
    "ordinary-object",
    "measurement",
    "public-geography",
    "weather",
    "amount",
    "measurement",
    "ordinary-nouns",
]


def person_entities() -> list[str]:
    surnames = ["강", "문", "안", "장", "윤", "오"]
    given_names = [
        "가람",
        "나린",
        "다온",
        "라윤",
        "마루",
        "보민",
        "서린",
        "소율",
        "아람",
        "여진",
        "예린",
        "유담",
        "이든",
        "지안",
        "채린",
        "하람",
        "가온",
        "나윤",
        "다인",
        "로운",
        "민서",
        "봄이",
        "서우",
        "수현",
        "아인",
        "연우",
        "예담",
        "윤서",
        "지율",
        "초아",
        "태린",
        "해원",
    ]
    korean = [surname + given for surname in surnames for given in given_names][:188]
    mixed = [
        "Aven Mercer",
        "Brell Mercer",
        "Corin Mercer",
        "Daro Mercer",
        "Elva Mercer",
        "Fenn Mercer",
        "Aro Cole",
        "Bex Cole",
        "Cyra Cole",
        "Doven Cole",
        "Eira Cole",
        "Falin Cole",
    ]
    return korean + mixed

def person_particles(person: str) -> dict[str, str]:
    if person.endswith(" Mercer"):
        has_final_consonant = False
    elif person.endswith(" Cole"):
        has_final_consonant = True
    else:
        final = ord(person[-1]) - 0xAC00
        assert 0 <= final <= 0xD7A3 - 0xAC00
        has_final_consonant = final % 28 != 0

    if has_final_consonant:
        return {
            "subject": "이",
            "with_particle": "과",
            "topic": "은",
            "copula": "이야",
            "object_particle": "을",
        }
    return {
        "subject": "가",
        "with_particle": "와",
        "topic": "는",
        "copula": "야",
        "object_particle": "를",
    }


def address_entities() -> list[str]:
    regions = [
        "서울특별시 해온구 다솜동",
        "부산광역시 윤슬구 파랑동",
        "대구광역시 늘봄구 고운동",
        "인천광역시 온새미구 미르동",
        "광주광역시 한빛구 라온동",
        "대전광역시 새결구 아람동",
        "울산광역시 보람구 누리동",
        "세종특별자치시 가온동",
        "경기도 다온시 마루구 해솔동",
        "강원특별자치도 온빛시 이든동",
        "충청북도 가람시 소담동",
        "충청남도 여울시 나래동",
        "전북특별자치도 모아시 단비동",
        "전라남도 푸름시 초롱동",
        "경상북도 해든시 봄내동",
        "경상남도 아라시 잎새동",
        "제주특별자치도 다솜시 별하동",
    ]
    roads = [
        "새롬한결로",
        "참빛여울길",
        "노을가온로",
        "물결다솜길",
        "새롬미르로",
        "참빛나래길",
        "노을해솔로",
        "물결소담길",
        "새롬윤슬로",
        "참빛아람길",
        "노을단비로",
        "물결라온길",
        "새롬누리로",
        "참빛이든길",
        "노을초롱로",
        "물결봄내길",
    ]
    buildings = [
        "새롬누리아파트",
        "참빛마루아파트",
        "노을가온아파트",
        "물결다솜아파트",
        "새롬윤슬아파트",
        "참빛해솔아파트",
        "노을소담아파트",
        "물결나래아파트",
        "새롬라온아파트",
        "참빛아람아파트",
        "노을단비아파트",
        "물결이든아파트",
        "새롬초롱아파트",
        "참빛봄내아파트",
        "노을미르아파트",
        "물결한결아파트",
    ]

    addresses = []
    for i in range(200):
        region = regions[i % len(regions)]
        building = buildings[(i * 5 + 3) % len(buildings)]
        building_dong = 101 + i % 9
        unit = 201 + (i * 103) % 1800
        if i % 4 == 3:
            lot = f"{80 + (i * 11) % 700}-{1 + (i * 7) % 49}"
            address = f"{region} {lot}, {building} {building_dong}동 {unit}호"
        else:
            road = roads[(i * 3 + 1) % len(roads)]
            road_number = 10 + (i * 13) % 240
            road_detail = f"{road_number}-{1 + i % 17}" if i % 5 == 2 else str(road_number)
            address = f"{region} {road} {road_detail}, {building} {building_dong}동 {unit}호"
        addresses.append(address)
    return addresses


def build() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []

    for i, person in enumerate(person_entities()):
        text = PERSON_TEMPLATES[i % len(PERSON_TEMPLATES)].format(
            person=person, **person_particles(person)
        )
        rows.append(
            {
                "id": f"heldout-person-{i + 1:03d}",
                "text": text,
                "person": [person],
                "address": [],
                "strata": ["person", PERSON_TAGS[i % len(PERSON_TAGS)]],
            }
        )

    for i, address in enumerate(address_entities()):
        text = ADDRESS_TEMPLATES[i % len(ADDRESS_TEMPLATES)].format(address=address)
        rows.append(
            {
                "id": f"heldout-address-{i + 1:03d}",
                "text": text,
                "person": [],
                "address": [address],
                "strata": ["address", ADDRESS_TAGS[i % len(ADDRESS_TAGS)]],
            }
        )

    for i in range(200):
        values = {
            "month": i % 12 + 1,
            "day": i % 28 + 1,
            "hour": 9 + i % 10,
            "minute": 5 + i % 51,
            "amount": 31_000 + i * 1_379,
            "count": 3 + i,
            "temp": 12 + i % 21,
            "floor": 1 + i % 7,
            "page": 18 + i,
            "weight": 12 + i % 39,
            "scale": 2_000 + i * 50,
            "distance": f"{2 + i % 8}.{i % 10}",
            "energy": 140 + i,
            "duration": 15 + i % 46,
            "percent": 35 + i % 61,
            "rain": 8 + i % 83,
            "discount": 5 + i % 36,
        }
        template_index = i % len(NEGATIVE_TEMPLATES)
        rows.append(
            {
                "id": f"heldout-negative-{i + 1:03d}",
                "text": NEGATIVE_TEMPLATES[template_index].format(**values),
                "person": [],
                "address": [],
                "strata": ["negative", NEGATIVE_TAGS[template_index]],
            }
        )

    expected_keys = {"id", "text", "person", "address", "strata"}
    assert len(rows) == 600
    assert len({row["id"] for row in rows}) == 600
    assert len({row["text"] for row in rows}) == 600
    assert all(set(row) == expected_keys for row in rows)
    assert all(row["strata"] and all(isinstance(value, str) and value for value in row["strata"]) for row in rows)
    assert sum(bool(row["person"]) for row in rows) == 200
    assert sum(bool(row["address"]) for row in rows) == 200
    assert sum(not row["person"] and not row["address"] for row in rows) == 200
    for row in rows:
        gold = [*row["person"], *row["address"]]
        assert len(gold) <= 1
        assert all(row["text"].count(value) == 1 for value in gold)

    return rows


def main() -> None:
    rows = build()
    OUTPUT.write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("wrote 600 rows: 200 person, 200 address, 200 negative")


if __name__ == "__main__":
    main()
