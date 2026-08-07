// 날짜 표기 공용 계약 (2026-08-07 Q "표기 규칙이 제각각이다 — 년 월 일 오전/오후 시간으로
// 통일"). 화면에 날짜·시각을 적는 곳은 전부 이 세 함수만 쓴다:
//   formatKoreanDate      "2026년 8월 7일"
//   formatKoreanTime      "오후 1:00"
//   formatKoreanDateTime  "2026년 8월 7일 오후 1:00"
// 요일·24시간제·YYYY-MM-DD 같은 변형을 화면마다 새로 만들지 않는다. 정렬·그룹핑 키가
// 필요한 곳(전체 일정의 날짜 묶음 등)은 표시가 아니라 키이므로 이 계약의 대상이 아니다.
//
// 시간대 기본값은 기관 표준 Asia/Seoul 이다 — 운영 런타임(Cloudflare Workers)의 기본
// 시간대는 UTC 라, 시간대를 안 박으면 서버 렌더 날짜가 통째로 하루 밀릴 수 있다.
// 기관 시간대를 이미 아는 화면(전체 일정 등)은 그 값을 넘긴다.

const DEFAULT_TIME_ZONE = 'Asia/Seoul';

/** 게이트웨이 SQL 표준("YYYY-MM-DD HH:MM:SS")과 ISO 를 모두 Date 로 푼다. 실패 시 null. */
function parse(value: string): Date | null {
  // 날짜만 온 값("YYYY-MM-DD")은 UTC 자정으로 두면 KST 표시에서 그 날짜 그대로 나온다.
  const normalized = /^\d{4}-\d{2}-\d{2} /.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2026년 8월 7일" */
export function formatKoreanDate(value: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const date = parse(value);
  if (date === null) return value;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeZone }).format(date);
}

/** "오후 1:00" */
export function formatKoreanTime(value: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const date = parse(value);
  if (date === null) return value;
  return new Intl.DateTimeFormat('ko-KR', { timeStyle: 'short', timeZone }).format(date);
}

/** "2026년 8월 7일 오후 1:00" */
export function formatKoreanDateTime(value: string, timeZone: string = DEFAULT_TIME_ZONE): string {
  const date = parse(value);
  if (date === null) return value;
  return new Intl.DateTimeFormat('ko-KR', { dateStyle: 'long', timeStyle: 'short', timeZone }).format(date);
}
