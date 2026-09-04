/**
 * 가명 ID 동물 슬러그 — 단일 출처 (D20 · ADR-0004 · 티켓 #11).
 *
 * 희망·회복을 상징하는 실존 동물 20종. DB·URL은 영문 슬러그 ID(`swallow-003`),
 * 화면은 한글 표시("제비 003")를 쓴다 — 한글 표시 적용은 후속 티켓 #15 범위이며
 * 이 모듈은 매핑만 보유한다.
 *
 * 규칙 (ADR-0004):
 * - 슬러그는 한 단어 소문자 영문. 가입일자·사업유형 등 의미 정보는 넣지 않는다
 *   (작은 조직에서 역추적 단서가 되어 가명화 취지를 깬다).
 * - 이 목록은 append-only다. 발급된 ID는 영구히 검증을 통과해야 하므로
 *   삭제·개명·순서 변경을 금지하고, 추가는 목록 끝에만 한다(라운드로빈 순서 보존).
 */
export const ANIMAL_SLUG_KOREAN_NAMES = {
  swallow: '제비',      // 봄을 물어오는 새 — 회복의 소식
  crane: '두루미',      // 장수·평안
  dolphin: '돌고래',    // 구조와 동행
  firefly: '반딧불이',  // 어둠 속의 빛
  otter: '수달',        // 되살아난 하천의 상징
  magpie: '까치',       // 반가운 소식
  turtle: '거북',       // 꾸준함·인내
  deer: '사슴',         // 온화한 재기
  whale: '고래',        // 멸종 위기에서 돌아온 귀환
  goose: '기러기',      // 함께 나는 동행
  butterfly: '나비',    // 탈바꿈·재생
  bee: '꿀벌',          // 근면·공생
  salmon: '연어',       // 물길을 거슬러 돌아옴
  egret: '백로',        // 맑아진 물가
  owl: '부엉이',        // 어둠 속의 지혜
  squirrel: '다람쥐',   // 내일을 위한 저축
  beaver: '비버',       // 무너진 곳을 다시 짓기
  robin: '울새',        // 새봄의 첫 노래
  lark: '종달새',       // 아침을 여는 희망
  rabbit: '토끼',       // 다시 뛰어오름
} as const;

export type AnimalSlug = keyof typeof ANIMAL_SLUG_KOREAN_NAMES;

/** 라운드로빈 발급 순서 = 위 선언 순서. */
export const ANIMAL_SLUGS = Object.keys(ANIMAL_SLUG_KOREAN_NAMES) as readonly AnimalSlug[];

/** 레거시 가명 ID 형식 (예: 'A017'). 제거(수축)는 후속 티켓 #15 범위. */
export const LEGACY_BENEFICIARY_ID_PATTERN = /^A[0-9]{3,}$/;

/** 동물 슬러그 가명 ID 형식 (예: 'swallow-003'). 순번은 3자리 제로패딩, 999 초과 시 자릿수 증가. */
export const ANIMAL_SLUG_BENEFICIARY_ID_PATTERN = new RegExp(
  `^(?:${ANIMAL_SLUGS.join('|')})-[0-9]{3,}$`,
);

/** 확장 단계(expand) 검증 — 레거시·슬러그 두 형식을 모두 수용한다 (티켓 #11). */
export function isBeneficiaryId(value: string): boolean {
  return LEGACY_BENEFICIARY_ID_PATTERN.test(value)
    || ANIMAL_SLUG_BENEFICIARY_ID_PATTERN.test(value);
}

/** HTML <input pattern>용 문자열(브라우저가 전체 일치로 앵커). 위 두 정규식과 동치를 유지한다. */
export const BENEFICIARY_ID_HTML_PATTERN = `A[0-9]{3,}|(?:${ANIMAL_SLUGS.join('|')})-[0-9]{3,}`;
