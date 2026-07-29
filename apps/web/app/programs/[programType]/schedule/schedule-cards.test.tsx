import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ScheduleCards, type ScheduleCardItem } from './schedule-cards';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다. 정리하지 않으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 'window is not defined' 가 던져지고,
// **테스트는 전부 통과해도 종료코드가 1** 이 된다(CI 실패). 이 파일이 실제로 CI 를 깨뜨렸다:
// 2026-07-30 PR #16 의 push 런에서 unhandled error 2건으로 verify 실패(같은 커밋의
// pull_request 런은 통과 — 부하에 따라 갈리는 타이밍 의존이라 '플레이크'로 보였던 것이다).
// 같은 누락이 남은 테스트 파일 12개에도 있다(STATUS.md History 참조).
afterEach(cleanup);

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
