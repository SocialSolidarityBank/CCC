// 이름 표기 계약 (D59 · 2026-08-04 — 구 D34 "어디서나 이름 (가명 ID) 한 줄"을 대체).
//
// **가명 ID 는 화면에 표시하지 않는다** — 백엔드 전용 식별자로 회귀한다(D31 의 원래 정의).
// 화면 표기는 실명 하나이고, 동명이인 구분은 전화번호가 맡는다(붙이는 자리는 화면이 정한다).
//
// 예외(폴백) 두 가지에만 ID 가 이름 자리에 나온다 — 그 경우 화면에 남는 유일한 식별자다:
//  1. 이름 무응답 등록(D41 무응답 원칙) — 실명이 금고에 없다.
//  2. 보존 기간 경과로 금고가 파기된 당사자(D10·D32) — 실명·연락처가 영구 소실됐다.
//
// 실명 크기는 data-size가 CSS 계약을 고른다(2026-08-27 Q 두 단, 구 전역 21 한 벌 대체).
// row(목록·일정 카드)는 카드 내용과 같은 16/600, hero·hub(당사자 정보·HERO)는
// 카드 제목과 같은 18/600이다. 767 이하도 같다.

export type ParticipantNameSize = 'hero' | 'hub' | 'row';

export interface ParticipantNameProps {
  /** 복호화된 실명. 미기입이거나 파기됐으면 null. */
  name: string | null;
  /** 가명 ID(동물 슬러그, D20). 실명이 없을 때만 화면에 나온다(위 폴백 2경우). */
  beneficiaryId: string;
  /** 자리의 의미. row = 16px(카드 내용 단), hero·hub = 18px(카드 제목 단). */
  size?: ParticipantNameSize;
  /** 실제 이름 글자에 붙이는 클래스. 카드의 말줄임·빈 상태처럼 글자 자체 스타일만 확장한다. */
  nameClassName?: string;
  className?: string;
}

export function participantDisplayName(name: string | null, beneficiaryId: string): string {
  return typeof name === 'string' && name.length > 0 ? name : beneficiaryId;
}

export function ParticipantName({
  name,
  beneficiaryId,
  size = 'row',
  nameClassName,
  className,
}: ParticipantNameProps) {
  const classes = ['participant-name-group', className].filter(Boolean).join(' ');
  const nameClasses = ['participant-name', nameClassName].filter(Boolean).join(' ');
  return (
    <span className={classes} data-size={size}>
      <span className={nameClasses}>
        {participantDisplayName(name, beneficiaryId)}
      </span>
    </span>
  );
}
