import type { CSSProperties } from 'react';

// 이름 표기 계약 (D59 · 2026-08-04 — 구 D34 "어디서나 이름 (가명 ID) 한 줄"을 대체).
//
// **가명 ID 는 화면에 표시하지 않는다** — 백엔드 전용 식별자로 회귀한다(D31 의 원래 정의).
// 화면 표기는 실명 하나이고, 동명이인 구분은 전화번호가 맡는다(붙이는 자리는 화면이 정한다).
//
// 예외(폴백) 두 가지에만 ID 가 이름 자리에 나온다 — 그 경우 화면에 남는 유일한 식별자다:
//  1. 이름 무응답 등록(D41 무응답 원칙) — 실명이 금고에 없다.
//  2. 보존 기간 경과로 금고가 파기된 당사자(D10·D32) — 실명·연락처가 영구 소실됐다.
//
// 실명은 그 자리의 제목 크기를 물려받는다(hero 28 · h2 20 · row 16) — 크기는 호출부가 정한다.

export interface ParticipantNameProps {
  /** 복호화된 실명. 미기입이거나 파기됐으면 null. */
  name: string | null;
  /** 가명 ID(동물 슬러그, D20). 실명이 없을 때만 화면에 나온다(위 폴백 2경우). */
  beneficiaryId: string;
  /** 실명 크기. 자리마다 다르므로 호출부가 정한다(기본 = 리스트 행 16/600). */
  size?: 'hero' | 'h2' | 'row';
  className?: string;
}

const nameSize: Record<'hero' | 'h2' | 'row', CSSProperties> = {
  hero: { fontSize: 28, lineHeight: 1.25 },
  // 당사자 정보 페이지의 이름 크기(2026-08-04 Q — HERO 28 이 아니라 제목 단으로 낮춘다.
  // 2026-08-08 Q "+2px" 로 18 → 20: 계단 18 과 24 사이의 광학 예외다, §2-1 형식).
  h2: { fontSize: 20, lineHeight: 1.35 },
  row: { fontSize: 16, lineHeight: 1.55 },
};

export function ParticipantName({ name, beneficiaryId, size = 'row', className }: ParticipantNameProps) {
  const classes = ['participant-name-group', className].filter(Boolean).join(' ');
  const hasName = typeof name === 'string' && name.length > 0;
  return (
    <span className={classes}>
      <span className="participant-name" style={nameSize[size]}>
        {hasName ? name : beneficiaryId}
      </span>
    </span>
  );
}
