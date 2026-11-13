#!/usr/bin/env python3
"""Build the synthetic CCC-237 NER development comparison corpus."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

OUTPUT = Path(__file__).with_name("development.json")

PERSON_TEMPLATES = (
    ("{entity}님이 회의 참석 의사를 전달했다.", ("third-party", "honorific")),
    ("팀장은 \"{entity}씨가 오후에 합류합니다\"라고 알렸다.", ("third-party", "quote", "honorific")),
    ("방문자 명단에는 {entity}만 등록되어 있었다.", ("record", "particle")),
    ("상담 기록에 보호자로 {entity}님이 기재되었다.", ("third-party", "record", "honorific")),
    ("발표 순서는 {entity}부터 시작한다고 공지했다.", ("briefing", "particle")),
    ("동료는 {entity}에게 자료를 건넸다고 말했다.", ("third-party", "particle")),
    ("오늘 전화한 분은 {entity}씨라고 안내받았다.", ("conversation", "honorific")),
    ("회의록 의견 제출자: {entity}. 기록 확인을 마쳤다.", ("record", "punctuation")),
    ("접수 창구에서 \"{entity}님, 잠시 기다려 주세요\"라고 불렀다.", ("dialogue", "quote", "honorific")),
    ("업무 인계 메모는 담당자를 {entity}님으로 지정했다.", ("briefing", "honorific")),
    ("참석자:{entity}—확인 완료.", ("record", "no-space", "punctuation")),
    ("관계자는 ({entity})의 방문이 다음 주라고 전했다.", ("third-party", "punctuation", "particle")),
    ("초대장 수신인은 {entity}님 한 분이다.", ("record", "honorific")),
    ("지원 요청자는 {entity}이고, 동행인은 없다고 확인했다.", ("conversation", "particle")),
    ("간사는 \"발언자는 {entity}입니다\"라고 정리했다.", ("briefing", "quote")),
    ("일정표의 인터뷰 대상은 {entity}씨로 표시되었다.", ("record", "honorific", "particle")),
)

ADDRESS_CONTEXTS = (
    ("배송지는 {entity}로 등록해 주세요.", ("request", "particle")),
    ("상담자는 거주지가 \"{entity}\"라고 확인했다.", ("third-party", "quote")),
    ("보호자는 {entity}에서 거주한다고 말했다.", ("third-party", "conversation", "particle")),
    ("전입 안내문을 {entity}로 보내 달라는 요청이 있었다.", ("request", "particle")),
    ("기록된 자택 주소는 {entity}이다.", ("record", "residential")),
    ("담당자는 '현재 사는 곳은 {entity}입니다'라고 받아 적었다.", ("third-party", "quote")),
    ("거주확인란:{entity}—서류와 일치.", ("record", "no-space", "punctuation")),
    ("우편물 수령지는 ({entity})로 지정되었다.", ("record", "punctuation", "particle")),
    ("가족은 방문 장소가 아닌 실제 주거지가 {entity}라고 설명했다.", ("third-party", "residential")),
    ("신청서에는 세대의 거주 주소로 {entity}가 적혀 있다.", ("record", "particle")),
    ("새 보금자리인 {entity}로 이사했다고 알렸다.", ("conversation", "residential", "particle")),
    ("주민은 {entity}에 살고 있다고 답했다.", ("conversation", "particle")),
    ("주거 확인 전화에서 {entity}가 현주소로 확인되었다.", ("record", "particle")),
    ("등기 우편은 {entity}로 발송해 달라고 했다.", ("request", "particle")),
    ("기숙사가 아니라 {entity}가 실제 거처라고 밝혔다.", ("conversation", "residential", "particle")),
    ("문자에는 \"집 주소: {entity}\"라고 적혀 있었다.", ("record", "quote", "punctuation")),
)

NEGATIVE_TEMPLATES = (
    (lambda k: f"회의는 {3 + k}월 {7 + 2 * k}일 오후 {1 + k}시에 열린다.", "date-time"),
    (lambda k: f"이번 분기 예산은 {420 + 35 * k}만 원으로 조정되었다.", "amount"),
    (lambda k: f"창고에는 접이식 의자가 {14 + 3 * k}개 남아 있다.", "ordinary-noun"),
    (lambda k: f"북부 지역의 강수량이 지난달보다 {4 + k}% 늘었다.", "generic-geography"),
    (lambda k: f"남쪽 해안의 바람은 {['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '일요일', '다음 주'][k]} 저녁에 강해질 전망이다.", "generic-geography"),
    (lambda k: f"도서관 평일 운영 안내에는 {['열람실', '자료실', '어린이실', '정기간행물실', '멀티미디어실', '학습실', '보존서고', '전시실'][k]} 개방 시간이 오전 9시부터 오후 6시로 적혀 있다.", "schedule"),
    (lambda k: f"회의실 예약은 {['월요일', '화요일', '수요일', '목요일', '금요일', '토요일', '이번 주', '다음 주'][k]}까지 온라인으로 받는다.", "schedule"),
    (lambda k: f"공유 폴더의 검토함에는 보고서 {['초안', '요약본', '검토본', '수정본', '표지', '부록', '도표', '목차'][k]} 파일이 저장되었다.", "ordinary-noun"),
    (lambda k: f"택배 상자 {2 + k}개는 안내 데스크 옆 보관함에 놓였다.", "generic-place"),
    (lambda k: f"버스는 {['중앙', '북문', '시장', '공원', '박물관', '운동장', '도서관', '터미널'][k]} 정류장을 지나 종점으로 이동한다.", "generic-geography"),
    (lambda k: f"산책로 공사는 다음 달 {3 + k}일에 끝날 예정이다.", "generic-place"),
    (lambda k: f"교육 자료는 {3 + k}개 장으로 나뉘어 있다.", "ordinary-noun"),
    (lambda k: f"기기 점검 결과 배터리 잔량은 {34 + 7 * k}%였다.", "measurement"),
    (lambda k: f"서쪽 권역의 평균 기온이 평년보다 {1 + k}도 낮았다.", "generic-geography"),
    (lambda k: f"동부 산지에는 {['새벽', '아침', '오전', '정오', '오후', '저녁', '밤', '자정'][k]}부터 구름이 많겠다.", "generic-geography"),
    (lambda k: f"회의 안건은 예산 조정과 일정 변경을 포함해 {2 + k}가지다.", "briefing"),
    (lambda k: f"주문 합계는 {18_000 + 4_500 * k}원이며 배송비는 포함되지 않았다.", "amount"),
    (lambda k: f"전시관 입장은 예약 시간 {5 + 5 * k}분 전부터 가능하다.", "schedule"),
    (lambda k: f"파일 이름은 {['검토', '배포', '보관', '공유', '출력', '제출', '백업', '정리'][k]} 규칙에 맞게 바꾸기로 했다.", "ordinary-noun"),
    (lambda k: f"정류장 주변의 보도 정비가 {['이번 주', '다음 주', '이번 달', '다음 달', '봄철', '여름철', '가을철', '겨울철'][k]}에 시작된다.", "generic-geography"),
    (lambda k: f"강 유역의 {['수위', '유속', '수온', '강수', '토양', '습도', '풍향', '적설'][k]} 관측 자료가 공개되었다.", "generic-geography"),
    (lambda k: f"비상 훈련은 {['지하 강당', '실내 체육관', '공용 회의실', '야외 운동장', '중앙 로비', '교육실', '대강당', '주차 광장'][k]}에서 실시한다.", "generic-place"),
    (lambda k: f"메뉴 구성에는 {['계절 채소 수프', '보리빵', '콩 샐러드', '버섯죽', '두부구이', '현미밥', '과일차', '감자전'][k]} 항목도 포함된다.", "ordinary-noun"),
    (lambda k: f"회의실 온도는 섭씨 {19 + k}도로 맞춰 두었다.", "measurement"),
    (lambda k: f"기부금 집계액은 {230_000 + 27_000 * k}원이며 개인별 내역은 없다.", "amount"),
)


def person_names() -> list[str]:
    surnames = ("김", "이", "박", "최", "정", "한")
    given_names = (
        "가온", "나래", "다온", "라온", "마루", "보민", "서온", "아린",
        "여울", "예담", "유안", "이든", "재온", "지안", "채온", "하람",
        "해온", "도윤", "민서", "서윤", "지우", "현우", "수빈", "예준",
        "하린", "은호", "다인", "유진", "시온", "태오", "가람", "온유",
    )
    korean = [surname + given for surname in surnames for given in given_names]
    mixed_script = (
        "Arin Reed", "Juno Hall", "Nari Reed", "Sola Hall",
        "Yuna Reed", "Theo Hall", "Miro Reed", "Elin Hall",
    )
    return korean + list(mixed_script)


def make_address(i: int) -> tuple[str, int]:
    provinces = ("가람도", "온새도", "다별도", "해솔도")
    cities = ("새봄시", "온빛시", "푸름시", "다솜시", "이음시")
    districts = ("가온구", "나래구", "모아구", "윤슬구", "누리구")
    neighborhoods = ("새결동", "모아동", "온새동", "해봄동", "이음동", "다빛동", "누리동", "윤슬동")
    prefixes = ("푸른", "별빛", "솔", "한울")
    road_stems = ("나래", "가람", "여울", "마루", "이음", "새봄", "온빛", "다솜")
    building_stems = ("온채", "누리채", "가람채", "윤슬채", "새결채", "다온채", "모아채", "이음채")

    region = f"{provinces[i % 4]} {cities[(i * 2) % 5]} {districts[(i * 3) % 5]}"
    neighborhood = neighborhoods[(i * 5) % 8]
    road_base = prefixes[i % 4] + road_stems[(i * 3) % 8]
    building = prefixes[(i + 1) % 4] + building_stems[(i * 7) % 8]
    number = 11 + i * 2
    sub = 1 + i % 9
    lot = 70 + i * 3
    dong = 101 + i % 8
    floor = 2 + i % 12
    unit = 201 + (i * 17) % 1800

    forms = (
        lambda: f"{region} {road_base}로 {number}, {building}아파트 {dong}동 {unit}호",
        lambda: f"{region} {road_base}길 {number}-{sub}, {building}빌라 {floor}층 {unit}호",
        lambda: f"{region} {neighborhood} {lot}-{sub}, {building}연립 {unit}호",
        lambda: f"{region} {road_base}로 {number}번길 {sub}, {building}아파트 {dong}동 {unit}호",
        lambda: f"{region} {road_base}길 {number}, {building}주택 {unit}호",
        lambda: f"{region} {neighborhood} {lot}번지, {building}다세대 {floor}층 {unit}호",
        lambda: f"{region} {road_base}로 {number}-{sub}, {building}아파트 {dong}동 {unit}호",
        lambda: f"{region} {road_base}길 {number} ({neighborhood}), {building}빌라 {unit}호",
        lambda: f"{region} {road_base}로 {number}번길 {sub}-{1 + i % 5}, {building}연립 {unit}호",
        lambda: f"{region} {neighborhood} {lot}-{sub}, {building}아파트 {dong}동 {unit}호",
        lambda: f"{region} {road_base}길 {number}, {building}다세대 {floor}층 {unit}호",
        lambda: f"{region} {road_base}로 {number}-{sub} ({neighborhood}), {building}주택 {unit}호",
        lambda: f"{region} {neighborhood} {lot}번지 {building}빌라 {floor}층 {unit}호",
        lambda: f"{region} {road_base}길 {number}-{sub}, {building}아파트 {dong}동 {unit}호",
        lambda: f"{region} {road_base}로 {number}, {building}연립 {dong}동 {floor}층 {unit}호",
        lambda: f"{region} {road_base}길 {number}번길 {sub}, {building}다세대 {unit}호",
    )
    form_index = i % len(forms)
    return forms[form_index](), form_index


def build_rows() -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []

    for i, name in enumerate(person_names()):
        template_index = i % len(PERSON_TEMPLATES)
        template, tags = PERSON_TEMPLATES[template_index]
        rows.append({
            "id": f"dev-person-{i + 1:03d}",
            "text": template.format(entity=name),
            "person": [name],
            "address": [],
            "strata": ["person", f"person-structure-{template_index + 1:02d}", *tags],
        })

    for i in range(200):
        address, form_index = make_address(i)
        context_index = i % len(ADDRESS_CONTEXTS)
        template, tags = ADDRESS_CONTEXTS[context_index]
        rows.append({
            "id": f"dev-address-{i + 1:03d}",
            "text": template.format(entity=address),
            "person": [],
            "address": [address],
            "strata": ["address", f"address-context-{context_index + 1:02d}", f"address-form-{form_index + 1:02d}", *tags],
        })

    for i in range(200):
        template_index = i % len(NEGATIVE_TEMPLATES)
        repetition = i // len(NEGATIVE_TEMPLATES)
        template, category = NEGATIVE_TEMPLATES[template_index]
        rows.append({
            "id": f"dev-negative-{i + 1:03d}",
            "text": template(repetition),
            "person": [],
            "address": [],
            "strata": ["negative", f"negative-structure-{template_index + 1:02d}", category],
        })

    return sorted(rows, key=lambda row: hashlib.sha256(f"ccc237-development:{row['id']}".encode()).digest())


def check_rows(rows: list[dict[str, object]]) -> dict[str, int]:
    required_keys = ["id", "text", "person", "address", "strata"]
    assert len(rows) == 600
    assert len({row["id"] for row in rows}) == 600
    assert len({row["text"] for row in rows}) == 600

    counts = {"person": 0, "address": 0, "negative": 0}
    for row in rows:
        assert list(row) == required_keys
        assert isinstance(row["id"], str) and row["id"]
        assert isinstance(row["text"], str) and row["text"]
        assert isinstance(row["person"], list) and len(row["person"]) <= 1
        assert isinstance(row["address"], list) and len(row["address"]) <= 1
        assert not (row["person"] and row["address"])
        assert isinstance(row["strata"], list) and row["strata"]
        assert all(isinstance(tag, str) and tag for tag in row["strata"])
        for entity in [*row["person"], *row["address"]]:
            assert isinstance(entity, str) and entity == entity.strip()
            assert row["text"].count(entity) == 1
        label = "person" if row["person"] else "address" if row["address"] else "negative"
        counts[label] += 1

    assert counts == {"person": 200, "address": 200, "negative": 200}
    return counts


def main() -> None:
    rows = build_rows()
    counts = check_rows(rows)
    payload = (json.dumps(rows, ensure_ascii=False, indent=2) + "\n").encode()
    OUTPUT.write_bytes(payload)
    print(json.dumps({
        "path": str(OUTPUT),
        "items": len(rows),
        "counts": counts,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bytes": len(payload),
        "person_structures": len(PERSON_TEMPLATES),
        "address_contexts": len(ADDRESS_CONTEXTS),
        "address_forms": 16,
        "negative_structures": len(NEGATIVE_TEMPLATES),
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
