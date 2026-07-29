import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ParticipantName } from './participant-name';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다. 정리하지 않으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 'window is not defined' 가 던져지고,
// 테스트는 전부 통과해도 `pnpm test` 가 1 로 끝난다(CI 실패).
afterEach(cleanup);

// 이름 표기 계약 (D34 · DESIGN.md §5 '이름 표기'). 이 컴포넌트가 브리핑 HERO·당사자 목록·
// 허브 세 곳의 단일 출처라, 계약이 깨지면 화면 세 개가 동시에 어긋난다.

describe('ParticipantName', () => {
  it('실명과 가명 ID를 텍스트 노드 2개로 나눈다 — 띄어쓰기를 문자열에 넣지 않는다', () => {
    // 간격은 CSS(gap 4)가 만든다. 한 문자열로 합치면 ID의 색·굵기를 달리 줄 수 없다.
    const { container } = render(<ParticipantName name="김미영" beneficiaryId="swallow-003" />);
    expect(container.querySelector('.participant-name')?.textContent).toBe('김미영');
    expect(container.querySelector('.participant-pseudonym')?.textContent).toBe('(swallow-003)');
    expect(container.querySelector('.participant-name-group')?.textContent).not.toContain(' (');
  });

  it('실명이 없으면 가명 ID만 남고 괄호를 만들지 않는다 (D31 폴백)', () => {
    const { container } = render(<ParticipantName name={null} beneficiaryId="swallow-003" />);
    expect(container.querySelector('.participant-name')?.textContent).toBe('swallow-003');
    expect(container.querySelector('.participant-pseudonym')).toBeNull();
  });

  it('빈 문자열도 미기입으로 본다 — "()" 만 남는 표기를 만들지 않는다', () => {
    const { container } = render(<ParticipantName name="" beneficiaryId="swallow-003" />);
    expect(container.querySelector('.participant-name')?.textContent).toBe('swallow-003');
    expect(container.querySelector('.participant-pseudonym')).toBeNull();
  });

  it('실명 크기는 자리가 정하고, 가명 ID는 자리와 무관하게 16px이다', () => {
    const hero = render(<ParticipantName name="김미영" beneficiaryId="swallow-003" size="hero" />);
    expect(hero.container.querySelector<HTMLElement>('.participant-name')?.style.fontSize).toBe('28px');
    // 가명 ID 크기는 인라인이 아니라 CSS 계약(.participant-pseudonym 16/400)이 잡는다.
    expect(hero.container.querySelector<HTMLElement>('.participant-pseudonym')?.style.fontSize).toBe('');

    const row = render(<ParticipantName name="김미영" beneficiaryId="swallow-003" />);
    expect(row.container.querySelector<HTMLElement>('.participant-name')?.style.fontSize).toBe('16px');
  });
});
