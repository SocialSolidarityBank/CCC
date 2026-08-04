import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ParticipantName } from './participant-name';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다. 정리하지 않으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 'window is not defined' 가 던져지고,
// 테스트는 전부 통과해도 `pnpm test` 가 1 로 끝난다(CI 실패).
afterEach(cleanup);

// 이름 표기 계약 (D59 · 2026-08-04). 가명 ID 는 화면에 표시하지 않는다 — 백엔드 전용이고,
// 이름이 없는 두 경우(무응답 등록·파기 후)에만 이름 자리에 폴백으로 나온다.
// 이 컴포넌트가 브리핑 HERO·당사자 목록·허브의 단일 출처라, 계약이 깨지면 화면 세 개가
// 동시에 어긋난다.

describe('ParticipantName', () => {
  it('실명이 있으면 실명 하나만 표시한다 — 가명 ID 는 화면에 없다 (D59)', () => {
    const { container } = render(<ParticipantName name="김미영" beneficiaryId="swallow-003" />);
    expect(container.querySelector('.participant-name')?.textContent).toBe('김미영');
    expect(container.textContent).not.toContain('swallow-003');
  });

  it('실명이 없으면 가명 ID가 이름 자리에 폴백으로 나온다 — 괄호 없이', () => {
    const { container } = render(<ParticipantName name={null} beneficiaryId="swallow-003" />);
    expect(container.querySelector('.participant-name')?.textContent).toBe('swallow-003');
    expect(container.textContent).not.toContain('(');
  });

  it('빈 문자열도 미기입으로 본다 — 폴백이 동작한다', () => {
    const { container } = render(<ParticipantName name="" beneficiaryId="swallow-003" />);
    expect(container.querySelector('.participant-name')?.textContent).toBe('swallow-003');
  });

  it('실명 크기는 자리가 정한다 — hero 28 · h2 18 · row 16', () => {
    const hero = render(<ParticipantName name="김미영" beneficiaryId="swallow-003" size="hero" />);
    expect(hero.container.querySelector<HTMLElement>('.participant-name')?.style.fontSize).toBe('28px');

    const h2 = render(<ParticipantName name="김미영" beneficiaryId="swallow-003" size="h2" />);
    expect(h2.container.querySelector<HTMLElement>('.participant-name')?.style.fontSize).toBe('18px');

    const row = render(<ParticipantName name="김미영" beneficiaryId="swallow-003" />);
    expect(row.container.querySelector<HTMLElement>('.participant-name')?.style.fontSize).toBe('16px');
  });
});
