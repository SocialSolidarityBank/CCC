import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { ParticipantHeroCard } from './participant-hero-card';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다. 정리하지 않으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 'window is not defined' 가 던져지고,
// 테스트는 전부 통과해도 `pnpm test` 가 1 로 끝난다(CI 실패).
afterEach(cleanup);


// ParticipantHeroCard 계약 (D38 · DESIGN.md §5).
// 구분선 위에는 이름과 행동만, 아래에는 정보 격자와 선택적 상태 배지 행이 선다.
// 이 부품이 당사자 중심 화면 전부의 머리이므로, 계약이 깨지면 화면 전체가 어긋난다.

describe('ParticipantHeroCard', () => {
  it('PageTitle 아래 당사자 이름은 하나의 h2이고 가명 ID는 화면에 없다', () => {
    const { container } = render(
      <ParticipantHeroCard name="김미영" beneficiaryId="swallow-003" />,
    );
    expect(container.querySelector('h2 .participant-name')?.textContent).toBe('김미영');
    expect(container.querySelector('h1')).toBeNull();
    expect(container.textContent).not.toContain('swallow-003');
  });

  it('상세 정보는 구분선 아래에 서고 이름은 반응형 data-size 계약을 쓴다', () => {
    const { container } = render(
      <ParticipantHeroCard
        name="김미영"
        beneficiaryId="swallow-003"
        details={[{ label: '전화번호', value: '010-1234-5678' }]}
      />,
    );
    expect(container.querySelector('h2 .participant-name')?.textContent).toBe('김미영');
    expect(container.querySelector('.participant-hero-details .wire-field-value')?.textContent)
      .toBe('010-1234-5678');
    expect(container.querySelector('.participant-hero-divider')).not.toBeNull();
    expect(container.querySelector('h2 .participant-name-group')?.getAttribute('data-size')).toBe('hero');
    expect(container.querySelector('h2 .participant-name')?.getAttribute('style')).toBeNull();
  });

  it('당사자 정보 허브: 이름 아래 정보 격자에 ID, 연락처, 이메일과 추가 값을 둔다', () => {
    const { container } = render(
      <ParticipantHeroCard
        name="김미영"
        beneficiaryId="swallow-003"
        nameSize="hub"
        details={[
          { label: '당사자 ID', value: 'swallow-003' },
          { label: '연락처', value: '010-1234-5678' },
          { label: '이메일', value: 'miyoung@example.org' },
          { label: '상담일', value: '2026년 9월 3일', tone: 'blue' },
        ]}
      />,
    );

    expect(container.querySelector('h2 .participant-name')?.textContent).toBe('김미영');
    expect(container.querySelectorAll('.participant-hero-details .wire-field-row')).toHaveLength(4);
    expect(
      [...container.querySelectorAll('.participant-hero-details .wire-field-label')].map((node) => node.textContent),
    ).toEqual(['당사자 ID', '연락처', '이메일', '상담일']);
    expect(
      [...container.querySelectorAll('.participant-hero-details .wire-field-value')].map((node) => node.textContent),
    ).toEqual(['swallow-003', '010-1234-5678', 'miyoung@example.org', '2026년 9월 3일']);
    expect(container.querySelector('.participant-hero-divider')).not.toBeNull();
    expect(container.querySelector('h2 .participant-name-group')?.getAttribute('data-size')).toBe('hub');
    expect(container.querySelector('.participant-hero-details .wire-field-row[data-tone="blue"] .wire-field-label')?.textContent).toBe('상담일');
  });

  it('상태 태그를 넘기면 모두 보이고 넘기지 않으면 구분선도 없다', () => {
    const withTags = render(
      <ParticipantHeroCard
        name="김미영"
        beneficiaryId="swallow-003"
        stageTags={[{ label: '15초 페이지' }, { label: '상담 예정', tone: 'lavender' }]}
      />,
    );
    expect([...withTags.container.querySelectorAll('.participant-hero-status .wire-status-tag')]
      .map((tag) => tag.textContent))
      .toEqual(['15초 페이지', '상담 예정']);
    expect(withTags.container.querySelector('.participant-hero-divider')).not.toBeNull();

    const withoutTags = render(
      <ParticipantHeroCard name="김미영" beneficiaryId="swallow-003" />,
    );
    expect(withoutTags.container.querySelector('.participant-hero-status')).toBeNull();
    expect(withoutTags.container.querySelector('.participant-hero-divider')).toBeNull();
  });

  it('상태 태그 색 계열 — 기본은 neutral이고 AI 상태만 lavender다', () => {
    const defaultTone = render(
      <ParticipantHeroCard
        name="김미영"
        beneficiaryId="swallow-003"
        stageTags={[{ label: '15초 페이지' }]}
      />,
    );
    expect(defaultTone.container.querySelector('.wire-status-tag')?.getAttribute('data-tone')).toBe('neutral');

    const lavenderTone = render(
      <ParticipantHeroCard
        name="김미영"
        beneficiaryId="swallow-003"
        stageTags={[{ label: '검토 대기', tone: 'lavender' }]}
      />,
    );
    expect(lavenderTone.container.querySelector('.wire-status-tag')?.getAttribute('data-tone')).toBe('lavender');
  });

  it('구분선 위에는 이름과 행동만, 아래에는 상세 정보 다음 상태가 선다', () => {
    const bare = render(<ParticipantHeroCard name="김미영" beneficiaryId="swallow-003" />);
    expect(bare.container.querySelector('.participant-hero-info')).toBeNull();
    expect(bare.container.querySelector('.participant-hero-divider')).toBeNull();
    expect(bare.container.querySelector('.page-actions')).toBeNull();

    const full = render(
      <ParticipantHeroCard
        name="김미영"
        beneficiaryId="swallow-003"
        stageTags={[{ label: '진행 중' }]}
        details={[{ label: '사업', value: '희망키움통장' }]}
        actions={<a href="/x">상담 시작</a>}
      />,
    );
    const top = full.container.querySelector('.participant-hero-top');
    expect(top?.querySelector('.participant-name')).not.toBeNull();
    expect(top?.querySelector('.page-actions a')?.textContent).toBe('상담 시작');
    expect(top?.querySelector('.wire-status-tag')).toBeNull();
    expect(full.container.querySelector('.participant-hero-status')?.textContent).toBe('진행 중');
    expect(full.container.querySelector('.participant-hero-details')?.textContent).toContain('희망키움통장');
    expect(
      full.getByText('희망키움통장').compareDocumentPosition(full.getByText('진행 중'))
        & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('HERO 도 카드다 — surface-card 계약 클래스를 단다 (D37 §4-5)', () => {
    const { container } = render(
      <ParticipantHeroCard name="김미영" beneficiaryId="swallow-003" />,
    );
    expect(container.querySelector('header.surface-card')).not.toBeNull();
  });
});
