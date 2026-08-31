import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ParticipantHeroCard } from './participant-hero-card';

// vitest 전역(globals) 미설정이라 자동 언마운트가 걸리지 않는다. 정리하지 않으면 파일이 끝난 뒤
// jsdom 이 내려가는 동안 React 가 남은 작업을 돌려 'window is not defined' 가 던져지고,
// 테스트는 전부 통과해도 `pnpm test` 가 1 로 끝난다(CI 실패).
afterEach(cleanup);

const participantPageSource = readFileSync(
  resolve(process.cwd(), 'app/participants/[beneficiaryId]/page.tsx'),
  'utf8',
);

// ParticipantHeroCard 계약 (D38 · DESIGN.md §5).
// 고정 1층(이름) + 슬롯 3층(상태 태그·메타·행동).
// 이 부품이 당사자 중심 화면 전부의 머리이므로, 계약이 깨지면 화면 전체가 어긋난다.

describe('ParticipantHeroCard', () => {
  it('이름은 항상 있다 — 실명 하나, 가명 ID 는 화면에 없다 (D59)', () => {
    const { container } = render(
      <ParticipantHeroCard name="김미영" beneficiaryId="swallow-003" />,
    );
    expect(container.querySelector('h1 .participant-name')?.textContent).toBe('김미영');
    expect(container.textContent).not.toContain('swallow-003');
  });

  it('연락처 슬롯은 구분선 아래에 서고 이름은 반응형 data-size 계약을 쓴다', () => {
    const { container } = render(
      <ParticipantHeroCard name="김미영" beneficiaryId="swallow-003" contact="010-1234-5678" />,
    );
    expect(container.querySelector('h1 .participant-hero-contact')).toBeNull();
    expect(
      container.querySelector('.participant-hero-meta .participant-hero-contact')?.textContent,
    ).toBe('010-1234-5678');
    expect(container.querySelector('.participant-hero-divider')).not.toBeNull();
    expect(container.querySelector('h1 .participant-name-group')?.getAttribute('data-size')).toBe('hero');
    expect(container.querySelector('h1 .participant-name')?.getAttribute('style')).toBeNull();
  });

  it('당사자 정보 허브: 이름과 ID는 한 줄, 연락처는 다음 정보 줄에 둔다', () => {
    const { container } = render(
      <ParticipantHeroCard
        name="김미영"
        beneficiaryId="swallow-003"
        contact="010-1234-5678"
        showId
        nameSize="hub"
      />,
    );

    expect(container.querySelector('h1 .participant-name')?.textContent).toBe('김미영');
    expect(container.querySelector('h1 .participant-hero-id')?.textContent).toBe('swallow-003');
    expect(container.querySelector('h1 .participant-hero-contact')).toBeNull();
    expect(container.querySelector('.participant-hero-meta .participant-hero-contact')?.textContent)
      .toBe('010-1234-5678');
    expect(container.querySelectorAll('.participant-hero-separator')).toHaveLength(0);
    expect(container.querySelector('h1 .participant-hero-id')?.parentElement?.classList).toContain('participant-hero-inline-item');
    expect(container.querySelector('h1 .participant-hero-id')?.parentElement?.previousElementSibling?.classList)
      .toContain('participant-name-group');
    expect(container.querySelector('.participant-hero-divider')).not.toBeNull();
    expect(container.querySelector('h1 .participant-name-group')?.getAttribute('data-size')).toBe('hub');
    expect(container.querySelector('h1 .participant-name')?.getAttribute('style')).toBeNull();
  });

  it('참여 사업 행은 전체 사업명을 보존하고 배지와 종결 버튼을 같은 머리에 둔다', () => {
    expect(participantPageSource).toMatch(
      /participant-program-head-main[\s\S]*<h3 title=\{programTitle\}>[\s\S]*<WireBadge[\s\S]*variant="secondary"/,
    );
  });

  it('상태 태그는 슬롯이다 — 넘기면 보이고 넘기지 않으면 없다 (허브)', () => {
    // 케이스 1개 화면(브리핑·기록)은 태그를 넘긴다.
    const withTag = render(
      <ParticipantHeroCard name="김미영" beneficiaryId="swallow-003" stageTag="15초 페이지" />,
    );
    expect(withTag.container.querySelector('.wire-status-tag')?.textContent).toBe('15초 페이지');

    // 허브는 케이스가 교차해 단일 상태가 없다 — 태그 없이도 부품이 완전해야 한다.
    const withoutTag = render(
      <ParticipantHeroCard name="김미영" beneficiaryId="swallow-003" />,
    );
    expect(withoutTag.container.querySelector('.wire-status-tag')).toBeNull();
  });

  it('상태 태그 색 계열 — 기본은 neutral이고 AI 상태만 lavender다', () => {
    const defaultTone = render(
      <ParticipantHeroCard name="김미영" beneficiaryId="swallow-003" stageTag="15초 페이지" />,
    );
    expect(defaultTone.container.querySelector('.wire-status-tag')?.getAttribute('data-tone')).toBe('neutral');

    const lavenderTone = render(
      <ParticipantHeroCard
        name="김미영"
        beneficiaryId="swallow-003"
        stageTag="검토 대기"
        stageTagTone="lavender"
      />,
    );
    expect(lavenderTone.container.querySelector('.wire-status-tag')?.getAttribute('data-tone')).toBe('lavender');
  });

  it('메타와 행동도 슬롯이다 — 없으면 빈 자리 없이 접힌다', () => {
    const bare = render(<ParticipantHeroCard name="김미영" beneficiaryId="swallow-003" />);
    expect(bare.container.querySelector('.participant-hero-meta')).toBeNull();
    expect(bare.container.querySelector('.page-actions')).toBeNull();

    const full = render(
      <ParticipantHeroCard
        name="김미영"
        beneficiaryId="swallow-003"
        meta={<span>희망키움통장</span>}
        actions={<a href="/x">상담 시작</a>}
      />,
    );
    expect(full.container.querySelector('.participant-hero-meta')?.textContent).toBe('희망키움통장');
    expect(full.container.querySelector('.page-actions a')?.textContent).toBe('상담 시작');
  });

  it('HERO 도 카드다 — surface-card 계약 클래스를 단다 (D37 §4-5)', () => {
    const { container } = render(
      <ParticipantHeroCard name="김미영" beneficiaryId="swallow-003" />,
    );
    expect(container.querySelector('header.surface-card')).not.toBeNull();
  });
});
