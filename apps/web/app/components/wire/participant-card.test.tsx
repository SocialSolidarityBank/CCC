import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ParticipantCard } from './participant-card';

afterEach(cleanup);

describe('ParticipantCard', () => {
  it('일정 카드에서 이름 옆 ID와 한 행 정보만 표시한다', () => {
    const { container } = render(
      <ParticipantCard
        href="/participants/swallow-003"
        schedule={{
          date: '8월 27일 (목)',
          time: '14:00',
          kind: 'regular',
        }}
        name="김민서"
        beneficiaryId="swallow-003"
        phone="010-0000-1234"
      />,
    );

    const header = container.querySelector('.participant-card-header');
    const fields = container.querySelector('.participant-card-fields');
    expect(header?.textContent).toContain('김민서');
    expect(header?.querySelector('.participant-card-id')?.textContent).toBe('swallow-003');
    expect(header?.textContent).toContain('기본 상담');
    expect(header?.querySelector('.wire-badge')?.getAttribute('data-tone')).toBe('mint');
    expect(fields?.textContent).toContain('상담 일시8월 27일 (목) 14:00');
    expect(fields?.textContent).toContain('연락처010-0000-1234');
    expect(fields?.textContent).not.toContain('가명 ID');
    expect(fields?.textContent).not.toContain('swallow-003');
    expect(fields?.textContent).not.toContain('참여 사업');
    expect(fields?.querySelector('[data-layout="stack"]')).toBeNull();
    expect([...fields?.querySelectorAll('.wire-field-row') ?? []].every((row) => (
      row.getAttribute('data-compact') === 'true'
      && row.getAttribute('data-truncate') === 'true'
      && row.getAttribute('data-size') === 'sm'
    ))).toBe(true);
    expect([...container.querySelectorAll('.wire-badge')].every((badge) => (
      badge.getAttribute('data-size') === 'sm'
    ))).toBe(true);
    expect(container.querySelector('.participant-card .wire-card-divider')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('aria-label'))
      .toBe('김민서, 8월 27일 (목) 14:00 기본 상담');
  });

  it('인테이크 일정 카드는 lavender 유형 배지를 표시한다', () => {
    const { container } = render(
      <ParticipantCard
        href="/participants/swallow-003"
        schedule={{
          date: '8월 27일 (목)',
          time: '14:00',
          kind: 'intake',
        }}
        name="김민서"
        beneficiaryId="swallow-003"
      />,
    );

    const badge = container.querySelector('.participant-card-header .wire-badge');
    expect(badge?.textContent).toBe('인테이크');
    expect(badge?.getAttribute('data-tone')).toBe('lavender');
  });

  it('당사자 목록 카드에서 이름 옆 ID와 세로 정보행을 표시한다', () => {
    const { container } = render(
      <ParticipantCard
        href="/participants/swallow-003"
        name="김민서"
        beneficiaryId="swallow-003"
        phone="010-0000-1234"
        statusBadge={{ label: '진행 중', tone: 'mint' }}
        programCount={2}
      />,
    );

    const header = container.querySelector('.participant-card-header');
    const fields = container.querySelector('.participant-card-fields');
    expect(header?.textContent).toContain('김민서');
    expect(header?.querySelector('.participant-card-id')?.textContent).toBe('swallow-003');
    expect(header?.textContent).toContain('진행 중');
    expect(fields?.textContent).toContain('참여 사업2개');
    expect(fields?.textContent).toContain('연락처010-0000-1234');
    expect(fields?.textContent).not.toContain('가명 ID');
    expect(fields?.textContent).not.toContain('swallow-003');
    expect(fields?.textContent).not.toContain('상담 일시');
    expect(fields?.textContent).not.toContain('기본 상담');
    expect(fields?.querySelector('[data-layout="stack"]')).toBeNull();
    expect([...fields?.querySelectorAll('.wire-field-row') ?? []].every((row) => (
      row.getAttribute('data-compact') === 'true'
      && row.getAttribute('data-truncate') === 'true'
      && row.getAttribute('data-size') === 'sm'
    ))).toBe(true);
    expect(container.querySelectorAll('.wire-badge')).toHaveLength(1);
    expect(container.querySelector('.wire-badge')?.getAttribute('data-size')).toBe('sm');
    expect(container.querySelector('.participant-card-emphasis')?.textContent).toBe('2개');
    expect(container.querySelector('a')?.getAttribute('aria-label'))
      .toBe('김민서, 참여 사업 2개, 진행 중');
  });

  it('새 가입 상태와 케이스 상태를 헤더 배지로 함께 표시한다', () => {
    const { container } = render(
      <ParticipantCard
        href="/participants/swallow-003"
        name="김민서"
        beneficiaryId="swallow-003"
        statusBadge={{ label: '진행 중', tone: 'mint' }}
        programCount={1}
        newSignup
      />,
    );

    const badges = [...container.querySelectorAll('.participant-card-header .wire-badge')];
    expect(badges.map((badge) => badge.textContent)).toEqual(['새 가입', '진행 중']);
    expect(badges.every((badge) => badge.getAttribute('data-size') === 'sm')).toBe(true);
  });

  it('없는 연락처는 라벨도 표시하지 않는다', () => {
    const { container } = render(
      <ParticipantCard
        href="/participants/otter-001"
        name={null}
        beneficiaryId="otter-001"
        statusBadge={{ label: '종결' }}
        programCount={0}
      />,
    );

    const fields = container.querySelector('.participant-card-fields');
    expect(container.querySelector('.participant-card-name')?.textContent).toBe('otter-001');
    expect(container.querySelector('.participant-card-id')).toBeNull();
    expect(fields?.textContent).toBe('참여 사업0개');
    expect(fields?.textContent).not.toContain('연락처');
    expect(container.querySelector('.wire-badge')?.textContent).toBe('종결');
    expect(container.querySelector('a')?.getAttribute('aria-label'))
      .toBe('otter-001, 참여 사업 0개, 종결');
  });
});
