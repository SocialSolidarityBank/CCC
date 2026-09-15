"""E5-4 release qualification corpus generator (deterministic, synthetic-only).

Spec basis: docs/specs/S6-privacy-packet.md:79 — non-empty conversational
synthetic corpus, >=500 items, stratified over Korean surnames / name lengths /
honorifics / spacing / romanized names / organization-name ambiguity and
road-name / lot-number / building / dong-ho / postal-code address forms;
>=200 hard negatives.

Row schema follows the health corpus N (S6-privacy-packet.md:58):
{"id", "text", "person", "address"} — gold values are verbatim substrings.

All names are fabricated combinations of common Korean surname + given-name
morphemes (no real person is referenced). Phone numbers use the unallocated
012/013/014 prefixes or malformed digit groupings, so no in-service number can
appear. Addresses use real city/district names with fabricated road names,
numbers, and building names.

Usage: python3 gen_corpus.py [--seed N] [--out corpus.jsonl]
Prints the corpus JCS SHA-256 (corpusHash) to stdout.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import random

SEED = 20260915

SURNAMES = [
    "김", "이", "박", "최", "정", "강", "조", "윤", "장", "임",
    "한", "오", "서", "신", "권", "황", "안", "송", "류", "홍",
    "전", "고", "문", "양", "손", "배", "백", "허", "유", "남",
    "심", "노", "하", "곽", "성", "차", "주", "우", "구", "민",
]
COMPOUND_SURNAMES = ["남궁", "황보", "선우", "독고", "제갈"]
GIVEN1 = [
    "서", "지", "민", "도", "하", "예", "준", "수", "현", "은",
    "태", "재", "유", "채", "건", "영", "성", "정", "동", "혜",
    "나", "윤", "승", "진", "아", "소", "한", "경", "병", "미",
]
GIVEN2 = [
    "연", "우", "서", "현", "윤", "아", "준", "빈", "호", "훈",
    "영", "수", "미", "정", "진", "원", "경", "희", "람", "솔",
    "겸", "결", "온", "봄", "별", "샘", "들", "누리", "가람", "하늘",
]
# 이름 길이 1~3 + 로마자 + 성씨만(단자 성) 케이스를 만든다.
ROMAN = ["Minjun", "Seoyeon", "Jiho", "Haeun", "Doyun", "Sua", "Yejun", "Chaewon"]

SIDO = ["서울특별시", "부산광역시", "대구광역시", "인천광역시", "경기도", "강원특별자치도", "충청북도", "전라남도", "경상북도", "제주특별자치도"]
SIGUNGU = ["마포구", "은평구", "수원시", "성남시", "해운대구", "달서구", "연수구", "춘천시", "청주시", "순천시", "포항시", "제주시", "고양시", "용인시", "천안시"]
ROAD = ["중앙로", "희망로", "평화로", "새싹로", "한빛로", "나래로", "민들레길", "도토리길", "은행나무로", "물결로", "솔바람길", "아침로"]
DONG = ["신흥동", "맑은동", "고요동", "푸른동", "밝은동", "새날동", "한울동", "여울동"]
APT = ["희망아파트", "한빛아파트", "평화타운", "새롬빌라", "나래주택", "민들레맨션", "솔빛아파트", "아침마을아파트"]
BLDG = ["중앙빌딩", "한빛타워", "평화프라자", "새싹센터", "나래빌딩", "민들레상가", "희망타워"]
ORG = ["희망복지재단", "중앙상담센터", "평화의료원", "한빛주민센터", "새롬복지관", "나래요양원", "민들레자활센터", "대한돌봄재단", "솔빛가정지원센터", "아침심리상담소"]
# 기관명 모호성: 사람 이름처럼 보이는 기관 접미 조합.
ORG_AMBIG = ["희망센터", "중앙복지관", "한결상담소", "바람의료원", "새봄재단"]

HONORIFIC = ["님", "씨", "선생님", "선생", "님께서", "어르신"]

def korean_name(rng: random.Random) -> str:
    r = rng.random()
    surname = rng.choice(COMPOUND_SURNAMES) if r < 0.04 else rng.choice(SURNAMES)
    n = rng.random()
    if n < 0.12:
        given = rng.choice(GIVEN1)  # 외자 이름
    elif n < 0.20:
        given = rng.choice(GIVEN1) + rng.choice(GIVEN1) + rng.choice(GIVEN2)  # 3자 이름
    else:
        given = rng.choice(GIVEN1) + rng.choice(GIVEN2)
    return surname + given

def spaced_name(rng: random.Random) -> str:
    """띄어쓰기 이름: 성과 이름 사이 공백."""
    return rng.choice(SURNAMES) + " " + rng.choice(GIVEN1) + rng.choice(GIVEN2)

def road_addr(rng: random.Random) -> str:
    base = f"{rng.choice(SIDO)} {rng.choice(SIGUNGU)} {rng.choice(ROAD)} {rng.randint(1, 300)}"
    r = rng.random()
    if r < 0.30:
        return base + f" {rng.randint(1, 20)}층"
    if r < 0.55:
        return base + f"-{rng.randint(1, 30)}"
    if r < 0.75:
        return base + f" {rng.choice(BLDG)} {rng.randint(1, 15)}층 {rng.randint(101, 1502)}호"
    return base

def jibun_addr(rng: random.Random) -> str:
    return f"{rng.choice(SIDO)} {rng.choice(SIGUNGU)} {rng.choice(DONG)} {rng.randint(1, 999)}-{rng.randint(1, 99)}"

def dongho_addr(rng: random.Random) -> str:
    return f"{rng.choice(SIDO)} {rng.choice(SIGUNGU)} {rng.choice(ROAD)} {rng.randint(1, 200)} {rng.choice(APT)} {rng.randint(101, 120)}동 {rng.randint(101, 2504)}호"

def postal_addr(rng: random.Random) -> str:
    return road_addr(rng) + f" ({rng.randint(10000, 69999)})"

def postal_only(rng: random.Random) -> str:
    return str(rng.randint(10000, 69999))

def fake_phone(rng: random.Random) -> str:
    """사용되지 않는 대역(012/013/014) 또는 자릿수가 깨진 번호만 만든다."""
    r = rng.random()
    if r < 0.6:
        return f"0{rng.choice([12, 13, 14])}-{rng.randint(1000, 9999)}-{rng.randint(1000, 9999)}"
    if r < 0.8:
        return f"0{rng.choice([12, 13, 14])}{rng.randint(10000000, 99999999)}"  # 구분자 없음
    return f"010-{rng.randint(100, 999)}-{rng.randint(10000, 99999)}"  # 자릿수 붕괴

def fake_account(rng: random.Random) -> str:
    return f"{rng.randint(100, 999)}-{rng.randint(10, 99)}-{rng.randint(100000, 999999)}"

def fake_email(rng: random.Random) -> str:
    return f"user{rng.randint(1000, 9999)}@example.invalid"


def _row(rid: str, text: str, person=None, address=None) -> dict:
    return {"id": rid, "text": text, "person": person or [], "address": address or []}


def build(rng: random.Random) -> list[dict]:
    rows: list[dict] = []
    i = 0

    def nid(prefix: str) -> str:
        nonlocal i
        i += 1
        return f"{prefix}{i:04d}"

    # --- 긍정 층: 인명 ---
    person_templates = [
        "{p}님이 오늘 첫 상담을 시작했다.",
        "상담사가 {p}에게 지난주 과제를 확인했다.",
        "{p} 씨는 요즘 수면 시간이 불규칙하다고 말했다.",
        "{p} 선생님이 다음 주 화요일에 다시 오기로 했다.",
        "보호자가 {p}의 상태를 물어봤다.",
        "{p}이(가) 기관 방문 일정을 변경하고 싶다고 했다.",
        "오늘 {p} 어르신과 가족 관계 이야기를 나눴다.",
        "{p}님께서 상담 기록 열람을 요청했다.",
    ]
    for _ in range(150):
        p = korean_name(rng)
        rows.append(_row(nid("p"), rng.choice(person_templates).format(p=p), person=[p]))

    # 띄어쓰기 이름
    for _ in range(40):
        p = spaced_name(rng)
        rows.append(_row(nid("p"), rng.choice(person_templates).format(p=p), person=[p]))

    # 로마자 이름
    roman_templates = [
        "{p} 님이 영어 상담을 신청했다.",
        "입국한 {p} 씨가 통역 지원을 요청했다.",
        "{p}에게 안내 문자를 보냈다.",
    ]
    for _ in range(40):
        p = rng.choice(ROMAN)
        rows.append(_row(nid("p"), rng.choice(roman_templates).format(p=p), person=[p]))

    # 기관명 모호성: 기관명과 인명이 같은 문장에 나오는 경우
    org_person_templates = [
        "{org} 소속 {p} 담당자와 통화했다.",
        "{p} 씨가 {org}에 서류를 제출했다.",
        "{org}에서 {p} 선생님을 소개받았다.",
        "{p}님이 {org} 방문 상담을 요청했다.",
    ]
    for _ in range(70):
        p = korean_name(rng)
        org = rng.choice(ORG + ORG_AMBIG)
        rows.append(_row(nid("p"), rng.choice(org_person_templates).format(p=p, org=org), person=[p]))

    # --- 긍정 층: 주소 ---
    addr_templates = [
        "당사자가 {a}에 거주한다고 확인했다.",
        "방문 상담지는 {a}로 정했다.",
        "서류를 {a}로 보내 달라고 요청했다.",
        "{a}에서 자택 방문을 진행했다.",
        "이사한 곳이 {a}라고 말했다.",
    ]
    addr_gens = [road_addr, jibun_addr, dongho_addr, postal_addr]
    for _ in range(200):
        a = rng.choice(addr_gens)(rng)
        rows.append(_row(nid("a"), rng.choice(addr_templates).format(a=a), address=[a]))
    # 우편번호 단독
    for _ in range(20):
        a = postal_only(rng)
        rows.append(_row(nid("a"), f"우편번호는 {a}로 확인했다.", address=[a]))

    # 인명+주소 동시
    both_templates = [
        "{p} 님이 {a}로 이사했다고 알렸다.",
        "{a}에 사는 {p} 씨와 전화 상담을 했다.",
        "{p} 선생님 댁({a})을 방문했다.",
    ]
    for _ in range(80):
        p = korean_name(rng)
        a = rng.choice(addr_gens)(rng)
        rows.append(_row(nid("b"), rng.choice(both_templates).format(p=p, a=a), person=[p], address=[a]))

    # --- hard negative 층 (>=200): 금 라벨 없음 ---
    hn = []
    # 1) 이름처럼 보이지만 이름이 아닌 것: 기관명 단독, 호칭만, 지명
    hn_templates_org = [
        "{org}에 전화를 걸었다.",
        "{org}에서 안내를 받았다.",
        "다음 일정은 {org}와 협의한다.",
        "{org} 담당 부서에 문의했다.",
    ]
    for _ in range(60):
        hn.append(rng.choice(hn_templates_org).format(org=rng.choice(ORG + ORG_AMBIG)))
    hn_misc = [
        "어머니가 병원에 다녀오셨다.", "아버지와 통화했다.", "누나가 서류를 챙겼다.",
        "할머니 댁에 다녀왔다.", "담당자가 안내해 줬다.", "선생님이 말씀하셨다.",
        "누군가 문을 두드렸다.", "가족이 함께 왔다.", "보호자 동의를 받았다.",
        "친구가 소개해 줬다.", "직원이 응대했다.", "대표가 결재했다.",
        "서울에서 올라왔다.", "부산으로 이사 갔다.", "제주에서 귀농했다.",
        "경기도 쪽으로 출퇴근한다.", "강원도에 별장이 있다.", "인천 공항에서 만났다.",
        "마포 쪽에서 일한다.", "해운대에서 휴가를 보냈다.",
    ]
    hn.extend(hn_misc * 2)  # 42
    # 2) 숫자만 보면 전화번호 같은 것: 미할당 대역·자릿수 붕괴·계좌형
    for _ in range(60):
        hn.append(f"연락처는 {fake_phone(rng)}로 남겼다.")
    for _ in range(30):
        hn.append(f"계좌 {fake_account(rng)}로 후원금을 보냈다.")
    for _ in range(20):
        hn.append(f"이메일은 {fake_email(rng)}로 안내했다.")
    # 3) 주소처럼 보이지만 주소가 아닌 것: 지역명만, 동·호 없는 건물 언급
    hn_addr = [
        "동네가 조용해서 좋다고 했다.", "근처 공원을 산책한다.", "시내 쪽 병원에 다닌다.",
        "고향이 남쪽이라고 했다.", "집 근처 마트에서 일한다.", "역 앞에서 만났다.",
        "3층 회의실에서 기다렸다.", "2번 출구로 나왔다.", "건물 뒤편에서 전화했다.",
        "복도 끝 방에서 상담했다.", "주민센터 앞에서 내렸다.", "버스 정류장에서 만났다.",
    ]
    hn.extend(hn_addr * 3)  # 36
    # 4) 일반 상담 문장 (식별자 없음)
    hn_plain = [
        "오늘은 감정 일기를 함께 읽었다.", "다음 주 같은 시간에 다시 만난다.",
        "수면 위생 교육을 진행했다.", "호흡 훈련을 복습했다.",
        "목표를 세 가지로 줄이기로 했다.", "가족 회의 일정을 잡았다.",
        "약물 복용 여부를 확인했다.", "위기 대응 계획을 점검했다.",
    ]
    hn.extend(hn_plain * 3)  # 24
    rng.shuffle(hn)
    for text in hn:
        rows.append(_row(nid("n"), text))

    rng.shuffle(rows)
    return rows


def canonical_json(value) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False, sort_keys=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=SEED)
    ap.add_argument("--out", default="corpus.jsonl")
    args = ap.parse_args()

    rng = random.Random(args.seed)
    rows = build(rng)

    # gold 문자열이 text에 정확히 한 번씩 나타나는지 검증한다.
    for row in rows:
        for key in ("person", "address"):
            for gold in row[key]:
                assert row["text"].count(gold) == 1, (row["id"], gold)

    with open(args.out, "w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")

    corpus_hash = hashlib.sha256(canonical_json(rows).encode("utf-8")).hexdigest()
    hard_neg = sum(1 for r in rows if not r["person"] and not r["address"])
    print(json.dumps({
        "items": len(rows),
        "hardNegatives": hard_neg,
        "corpusHash": corpus_hash,
        "seed": args.seed,
    }))


if __name__ == "__main__":
    main()
