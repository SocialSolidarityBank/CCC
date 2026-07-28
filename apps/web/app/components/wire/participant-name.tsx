import type { CSSProperties } from 'react';

// 이름 표기 계약 (D34 · DESIGN.md §5 '이름 표기'). 어디서나 `이름 (가명 ID)` 한 줄이다.
//
// 구현 규칙 2개가 계약에 박혀 있다.
//  1. **띄어쓰기를 문자열에 넣지 않는다** — 텍스트 노드 2개 + 간격 4(--space-1)로 만든다.
//     가명 ID의 색·굵기가 실명과 달라야 해서 한 문자열로는 표현할 수 없다.
//  2. 실명은 **그 자리의 제목 크기**(HERO 28/700 · 리스트 행 16/700) --ink 를 물려받고,
//     가명 ID는 **자리와 무관하게 항상 16/400 --sub** 다.
//
// 실명이 없으면 가명 ID 하나만 남긴다 — D31 폴백(실명 기본, 없으면 슬러그).

export interface ParticipantNameProps {
  /** 복호화된 실명. 미기입이거나 권한 밖이면 null. */
  name: string | null;
  /** 가명 ID(동물 슬러그, D20). 실명이 없을 때 이 값이 대신 제목이 된다. */
  beneficiaryId: string;
  /** 실명 크기. 자리마다 다르므로 호출부가 정한다(기본 = 리스트 행 16/700). */
  size?: 'hero' | 'row';
  className?: string;
}

const nameSize: Record<'hero' | 'row', CSSProperties> = {
  hero: { fontSize: 28, lineHeight: 1.25 },
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
      {hasName && <span className="participant-pseudonym">({beneficiaryId})</span>}
    </span>
  );
}
