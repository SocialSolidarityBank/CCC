import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { FixtureDraftView, type FixtureDraftViewProps } from './fixture-draft-view';

afterEach(cleanup);

function props(overrides: Partial<FixtureDraftViewProps> = {}): FixtureDraftViewProps {
  return {
    beneficiaryId: 'swallow-003',
    participantName: '김테스트',
    stageTag: '검토 대기',
    metaItems: ['기본 상담', '2026년 8월 15일'],
    recordsHref: '/participants/swallow-003/programs/case-1/records',
    draft: {
      origin: 'fixture_generated',
      creationMode: 'fixture_generated',
      summaryText: '요약 값',
      oneLiner: '핵심 한 줄 값',
      questions: [{ title: '질문 제목', reason: '질문 이유' }],
      evidence: [{ id: 'evidence-1', claimKey: 'fixture-claim', quote: '근거 인용 값' }],
    },
    ...overrides,
  };
}

describe('FixtureDraftView', () => {
  it('renders fixture provenance and draft values without review controls', () => {
    const { container } = render(<FixtureDraftView {...props()} />);

    expect(screen.getByTestId('fixture-review')).toBeTruthy();
    const badge = screen.getByTestId('fixture-origin-badge');
    expect(badge.dataset.tone).toBe('lavender');
    expect(badge.textContent).toBe('테스트 산출물');
    expect(screen.getByTestId('fixture-draft-notice')).toBeTruthy();
    expect(screen.getByTestId('fixture-draft')).toBeTruthy();
    expect(within(screen.getByTestId('fixture-section-one-liner')).getByText('핵심 한 줄 값')).toBeTruthy();
    expect(within(screen.getByTestId('fixture-section-summary')).getByText('요약 값')).toBeTruthy();
    expect(within(screen.getByTestId('fixture-section-questions')).getByText('질문 제목')).toBeTruthy();
    expect(within(screen.getByTestId('fixture-section-questions')).getByText('질문 이유')).toBeTruthy();
    expect(within(screen.getByTestId('fixture-section-questions')).getByRole('list')).toBeTruthy();
    expect(within(screen.getByTestId('fixture-section-evidence')).getByText('근거 인용 값')).toBeTruthy();
    const evidenceList = within(screen.getByTestId('fixture-section-evidence')).getByRole('list');
    expect(within(evidenceList).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('link', { name: '전체 상담 기록' }).getAttribute('href'))
      .toBe('/participants/swallow-003/programs/case-1/records');
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('.wire-bullets-single')).toBeNull();
  });

  it('keeps every draft section visible when optional values are empty', () => {
    render(<FixtureDraftView {...props({
      draft: {
        ...props().draft,
        oneLiner: null,
        questions: [],
        evidence: [],
      },
    })} />);

    for (const testId of [
      'fixture-section-one-liner',
      'fixture-section-questions',
      'fixture-section-evidence',
    ]) {
      expect(within(screen.getByTestId(testId)).getByRole('status')).toBeTruthy();
    }
    expect(screen.getByTestId('fixture-draft')).toBeTruthy();
  });
});
