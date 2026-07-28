import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ScheduleCards, type ScheduleCardItem } from './schedule-cards';

const cards: ScheduleCardItem[] = [
  {
    id: 's1',
    href: '/participants/swallow-003/programs/case-1/briefing',
    when: '7월 17일 (목) 10:00',
    participantName: '김철수',
    beneficiaryId: 'swallow-003',
    participantPhone: '010-1234-5678',
  },
  {
    id: 's2',
    href: '/participants/otter-001/programs/case-2/briefing',
    when: '7월 18일 (금) 14:00',
    participantName: null,
    beneficiaryId: 'otter-001',
    participantPhone: null,
  },
];

/** 각 카드의 '이름' WireField 값(실명 또는 가명 ID 폴백)을 렌더 순서대로 뽑는다. */
function cardNames(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('.wire-field-row'))
    .filter((row) => row.querySelector('.wire-field-label')?.textContent === '이름')
    .map((row) => row.querySelector('.wire-field-value')?.textContent ?? null);
}

function fieldValues(container: HTMLElement): (string | null)[] {
  return Array.from(container.querySelectorAll('.wire-field-value')).map((el) => el.textContent);
}

describe('ScheduleCards', () => {
  it('실명이 있으면 실명을, 없으면 가명 ID로 폴백해 이름 필드에 표시하고 연락처도 폴백한다', () => {
    const { container } = render(<ScheduleCards cards={cards} />);
    const names = cardNames(container);
    expect(names).toContain('김철수'); // 실명(T2 응답)
    expect(names).toContain('otter-001'); // participantName=null → 가명 ID 폴백

    const values = fieldValues(container);
    expect(values).toContain('010-1234-5678'); // 연락처 있음
    expect(values).toContain('미기입'); // participantPhone=null → 폴백

    // 일시는 카드 헤더(구분선)로 표시된다.
    const headers = Array.from(container.querySelectorAll('.wire-card-title')).map((el) => el.textContent);
    expect(headers).toContain('7월 17일 (목) 10:00');

    // 카드는 상담 준비(브리핑)로 링크된다.
    // 열 수는 .card-grid 가 정한다 — 예전에는 링크마다 wire-col-6 이 박혀 있어 카드가
    // 1장일 때도 화면 절반만 차지했다(2026-07-26).
    const links = Array.from(container.querySelectorAll('.card-grid > a')).map((el) => el.getAttribute('href'));
    expect(links).toContain('/participants/swallow-003/programs/case-1/briefing');
  });

  it('시간순 정렬 토글을 누르면 카드 순서가 뒤집힌다', () => {
    const { container } = render(<ScheduleCards cards={cards} />);
    expect(cardNames(container)).toEqual(['김철수', 'otter-001']); // 기본 오름차순

    const toggle = container.querySelector('button.wire-button');
    expect(toggle).not.toBeNull();
    fireEvent.click(toggle as HTMLButtonElement);
    expect(cardNames(container)).toEqual(['otter-001', '김철수']); // 내림차순
  });
});
