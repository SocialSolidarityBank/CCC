import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { DraftReviewView, type DraftReviewViewProps } from './fixture-draft-view';
import type { AiDraftContrastAxis } from '../../../../../../../lib/api';

afterEach(cleanup);

// 재료가 하나(텍스트)뿐일 때의 축 상태(D69 · ADR-0036 결정 2) — 대조 두 축은 전사가 없고,
// 미논의 목표 축은 회기 목표가 없다. 기본 fixture 는 이 상태로 둔다.
const singleTextMaterialContrast: AiDraftContrastAxis[] = [
  { axis: 'missing_from_memo', status: 'no_transcript', findings: [] },
  { axis: 'missing_from_transcript', status: 'no_transcript', findings: [] },
  { axis: 'undiscussed_session_goal', status: 'no_session_goal', findings: [] },
];

function props(overrides: Partial<DraftReviewViewProps> = {}): DraftReviewViewProps {
  return {
    beneficiaryId: 'swallow-003',
    supportCaseId: 'case-1',
    sessionId: 'session-1',
    participantName: '김테스트',
    stageTag: '검토 대기',
    metaItems: ['기본 상담', '2026년 8월 15일'],
    recordsHref: '/participants/swallow-003/programs/case-1/records',
    draft: {
      origin: 'fixture_generated',
      creationMode: 'fixture_generated',
      version: 1,
      summaryText: '요약 값',
      claims: [
        { claimKey: 'goal-1', section: 'session_goal_discussion', text: '회기 목표를 점검했다.' },
        { claimKey: 'other-1', section: 'other_topics', text: '주거비 변화를 확인했다.' },
        { claimKey: 'commitment-1', section: 'next_session_commitments', text: '상환 계획을 적어 보기로 했다.' },
      ],
      oneLiner: '핵심 한 줄 값',
      questions: [{ title: '질문 제목', reason: '질문 이유' }],
      evidence: [{ id: 'evidence-1', claimKey: 'fixture-claim', quote: '근거 인용 값' }],
      reviewDecision: null,
      contrast: singleTextMaterialContrast,
      regenerateAvailable: false,
      regenerateSourceSnapshotId: null,
      transcriptQuality: null,
    },
    ...overrides,
  };
}

describe('DraftReviewView transcript quality (CCC-124)', () => {
  it('shows warning spans when the transcript is not reliable', () => {
    render(<DraftReviewView {...props({
      draft: {
        ...props().draft,
        transcriptQuality: {
          transcriptReliable: false,
          warnings: [
            { startSeconds: 305, endSeconds: 512, reason: 'repetition' },
            { startSeconds: 1000, endSeconds: 1090, reason: 'unknown_future_reason' },
          ],
        },
      },
    })} />);

    const callout = screen.getByTestId('transcript-quality-warning');
    expect(callout.textContent).toContain('전사를 신뢰할 수 없는 구간이 있습니다');
    const spans = within(screen.getByTestId('transcript-quality-warning-spans')).getAllByRole('listitem');
    expect(spans).toHaveLength(2);
    expect(spans[0]?.textContent).toContain('05:05~08:32');
    expect(spans[0]?.textContent).toContain('같은 문장 반복(전사 붕괴)');
    // 모르는 사유 코드는 숨기지 않고 코드 그대로 보여준다.
    expect(spans[1]?.textContent).toContain('16:40~18:10');
    expect(spans[1]?.textContent).toContain('unknown_future_reason');
  });

  it('shows no warning when the transcript is reliable', () => {
    render(<DraftReviewView {...props({
      draft: {
        ...props().draft,
        transcriptQuality: { transcriptReliable: true, warnings: [] },
      },
    })} />);
    expect(screen.queryByTestId('transcript-quality-warning')).toBeNull();
  });

  it('shows no warning for legacy results without quality data', () => {
    render(<DraftReviewView {...props()} />);
    expect(screen.queryByTestId('transcript-quality-warning')).toBeNull();
  });
});

describe('DraftReviewView', () => {
  it('renders fixture provenance and draft values without review or regenerate controls', () => {
    const { container } = render(<DraftReviewView {...props()} />);

    expect(screen.getByTestId('ai-draft-review')).toBeTruthy();
    const badge = screen.getByTestId('preview-fixture-badge');
    expect(badge.dataset.tone).toBe('lavender');
    expect(badge.textContent).toBe('테스트 산출물');
    expect(screen.getByTestId('preview-fixture-notice')).toBeTruthy();
    expect(screen.getByTestId('ai-draft-card')).toBeTruthy();
    expect(within(screen.getByTestId('ai-draft-section-one-liner')).getByText('핵심 한 줄 값')).toBeTruthy();
    expect(screen.getByTestId('ai-draft-claims-session_goal_discussion').textContent).toContain('회기 목표를 점검했다.');
    expect(screen.getByTestId('ai-draft-claims-other_topics').textContent).toContain('주거비 변화를 확인했다.');
    expect(screen.getByTestId('ai-draft-claims-next_session_commitments').textContent).toContain('상환 계획을 적어 보기로 했다.');
    expect(within(screen.getByTestId('ai-draft-section-questions')).getByText('질문 제목')).toBeTruthy();
    expect(within(screen.getByTestId('ai-draft-section-questions')).getByText('질문 이유')).toBeTruthy();
    expect(within(screen.getByTestId('ai-draft-section-questions')).getByRole('list')).toBeTruthy();
    expect(within(screen.getByTestId('ai-draft-section-evidence')).getByText('근거 인용 값')).toBeTruthy();
    const evidenceList = within(screen.getByTestId('ai-draft-section-evidence')).getByRole('list');
    expect(within(evidenceList).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('link', { name: '전체 상담 기록' }).getAttribute('href'))
      .toBe('/participants/swallow-003/programs/case-1/records');
    // fixture 는 승인 불가(R2·서버 게이트) — 처리·재생성 폼이 없다.
    expect(screen.queryByRole('button')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('.wire-bullets-single')).toBeNull();
  });

  // CCC-106: HERO 상태 태그는 stageTagTone 을 ParticipantHeroCard 로 그대로 넘긴다.
  it('passes stageTagTone through to the HERO status tag', () => {
    const { container } = render(<DraftReviewView {...props({ stageTagTone: 'lavender' })} />);
    expect(container.querySelector('.wire-status-tag')?.getAttribute('data-tone')).toBe('lavender');
  });

  it('keeps every draft section visible when optional values are empty', () => {
    render(<DraftReviewView {...props({
      draft: {
        ...props().draft,
        oneLiner: null,
        questions: [],
        evidence: [],
      },
    })} />);

    for (const testId of [
      'ai-draft-section-one-liner',
      'ai-draft-section-questions',
      'ai-draft-section-evidence',
    ]) {
      expect(within(screen.getByTestId(testId)).getByRole('status')).toBeTruthy();
    }
    expect(screen.getByTestId('ai-draft-card')).toBeTruthy();
  });

  it('keeps claim and suggestion source quotes collapsed in place with a source-record link (D73)', () => {
    const { container } = render(<DraftReviewView {...props({
      draft: {
        ...props().draft,
        evidence: [
          { id: 'claim-evidence', claimKey: 'goal-1', quote: '목표 주장 근거' },
          { id: 'question-evidence', claimKey: 'question_1', quote: '질문 제안 근거' },
        ],
      },
    })} />);

    const claim = screen.getByText('회기 목표를 점검했다.').closest('li');
    const question = screen.getByText('질문 제목').closest('li');
    for (const item of [claim, question]) {
      const disclosure = item?.querySelector('details[data-source-quotes]');
      expect(disclosure).not.toBeNull();
      expect(disclosure?.hasAttribute('open')).toBe(false);
      expect(disclosure?.querySelector('a')?.getAttribute('href'))
        .toBe('/participants/swallow-003/programs/case-1/records#record-session-1');
    }
    expect(claim?.textContent).toContain('목표 주장 근거');
    expect(question?.textContent).toContain('질문 제안 근거');
    expect(container.textContent).not.toContain('전사 전문');
  });

  it('shows the D62 notice when no session-goal claim section exists', () => {
    render(<DraftReviewView {...props({
      draft: {
        ...props().draft,
        claims: props().draft.claims.filter((claim) => claim.section !== 'session_goal_discussion'),
      },
    })} />);
    expect(screen.getByTestId('ai-draft-claims-session_goal_discussion').textContent)
      .toContain('이번 회기의 세션 목표가 없어 이 구획을 만들지 않았습니다.');
  });

  it('keeps the legacy summary fallback when a pre-v4 draft has no claims', () => {
    render(<DraftReviewView {...props({
      draft: { ...props().draft, claims: [] },
    })} />);
    expect(within(screen.getByTestId('ai-draft-section-summary')).getByText('요약 값')).toBeTruthy();
  });

  // 검수 지적 1·2·3·4 (CCC-100 후속): 카드 제목 계약(.wire-card-title 직계) · 처리·재생성도
  // title 슬롯을 쓰는지 · 본문 값이 --ink 클래스를 받는지를 구조로 확인한다. jsdom 은 외부
  // 스타일시트를 계산하지 않아 실제 픽셀 값은 못 재지만, 계약을 깨는 구조(중첩 h2·title 밖
  // h2·클래스 없는 p)는 여기서 다시 생기면 잡힌다.
  describe('카드 제목·본문 값 계약 (검수 지적 1·2·3·4)', () => {
    it('places the "AI 초안" title directly under .wire-card-title with no h2 escaping the contract', () => {
      const card = render(<DraftReviewView {...props()} />).container.querySelector('[data-testid="ai-draft-card"]');
      expect(card?.querySelector(':scope > .wire-card-title h2')).toBeNull();
      expect(card?.querySelector(':scope > .wire-card-title')?.textContent).toContain('AI 초안');
    });

    it('gives the 핵심 한 줄 paragraph the wire-section-value class (16/400 --ink, margin 0)', () => {
      render(<DraftReviewView {...props()} />);
      const oneLiner = within(screen.getByTestId('ai-draft-section-one-liner')).getByText('핵심 한 줄 값');
      expect(oneLiner.className).toContain('wire-section-value');
    });
  });

  describe('대조 3종 (D69 · ADR-0036)', () => {
    it('shows a not-available notice per axis when its status is not applied', () => {
      render(<DraftReviewView {...props()} />);

      expect(screen.getByTestId('ai-draft-contrast-card')).toBeTruthy();
      expect(within(screen.getByTestId('ai-draft-contrast-missing_from_memo')).getByText('녹음 전사가 없어 이 대조는 만들지 않았습니다.')).toBeTruthy();
      expect(within(screen.getByTestId('ai-draft-contrast-missing_from_transcript')).getByText('녹음 전사가 없어 이 대조는 만들지 않았습니다.')).toBeTruthy();
      expect(within(screen.getByTestId('ai-draft-contrast-undiscussed_session_goal')).getByText('이번 회기의 세션 목표가 없어 이 대조는 만들지 않았습니다.')).toBeTruthy();
    });

    it('shows a no-difference notice when a status is applied but findings are empty', () => {
      render(<DraftReviewView {...props({
        draft: {
          ...props().draft,
          contrast: [
            { axis: 'missing_from_memo', status: 'applied', findings: [] },
            { axis: 'missing_from_transcript', status: 'applied', findings: [] },
            { axis: 'undiscussed_session_goal', status: 'applied', findings: [] },
          ],
        },
      })} />);

      expect(within(screen.getByTestId('ai-draft-contrast-missing_from_memo')).getByText('확인된 차이가 없습니다.')).toBeTruthy();
    });

    it('renders each finding with its description, material-kind badge, and exact quote', () => {
      render(<DraftReviewView {...props({
        draft: {
          ...props().draft,
          contrast: [
            {
              axis: 'missing_from_memo',
              status: 'applied',
              findings: [{ description: '메모에 없던 언급', materialKind: 'transcript', quote: '원문 인용 발췌' }],
            },
            { axis: 'missing_from_transcript', status: 'applied', findings: [] },
            { axis: 'undiscussed_session_goal', status: 'no_session_goal', findings: [] },
          ],
        },
      })} />);

      const axisSection = screen.getByTestId('ai-draft-contrast-missing_from_memo');
      expect(within(axisSection).getByText('메모에 없던 언급')).toBeTruthy();
      expect((within(axisSection).getByText('전사').closest('.wire-badge') as HTMLElement).dataset.tone).toBeUndefined();
      expect(within(axisSection).getByText('원문 인용 발췌')).toBeTruthy();
      const disclosure = axisSection.querySelector('details[data-source-quotes]');
      expect(disclosure?.hasAttribute('open')).toBe(false);
      expect(disclosure?.querySelector('a')?.getAttribute('href'))
        .toBe('/participants/swallow-003/programs/case-1/records#record-session-1');
    });

    // 검수 지적 7: v3 이전 초안(빈 배열)은 "돌리지 못함"류의 사유 있는 문구가 아니라, 사유를
    // 모른다는 별도 문구를 써야 한다 — 재료가 없어서라고 단정하면 없는 사실을 만든 것이다.
    it('shows a distinct "no data" notice — not a fabricated reason — when the whole contrast array is empty (pre-v3 draft)', () => {
      render(<DraftReviewView {...props({ draft: { ...props().draft, contrast: [] } })} />);

      for (const axis of ['missing_from_memo', 'missing_from_transcript', 'undiscussed_session_goal']) {
        const section = screen.getByTestId(`ai-draft-contrast-${axis}`);
        expect(within(section).getByText('이 초안에는 대조 결과가 없습니다.')).toBeTruthy();
        expect(within(section).queryByText('녹음 전사가 없어 이 대조는 만들지 않았습니다.')).toBeNull();
      }
    });

    // 검수 지적 8: 축 상태를 라벨 옆 배지로 올려 "돌리지 못함"과 "돌렸는데 차이 없음"을
    // 옷으로 가른다. 톤은 킷 5종 중에서만 고른다(neutral·mint).
    describe('축 상태 배지 (검수 지적 8)', () => {
      it('marks a not-applied axis with a neutral 돌리지 못함 badge', () => {
        render(<DraftReviewView {...props()} />);
        const label = within(screen.getByTestId('ai-draft-contrast-missing_from_memo')).getByText('돌리지 못함');
        expect((label.closest('.wire-badge') as HTMLElement).dataset.tone).toBeUndefined();
      });

      it('marks an applied axis with no findings with a mint 차이 없음 badge', () => {
        render(<DraftReviewView {...props({
          draft: {
            ...props().draft,
            contrast: [
              { axis: 'missing_from_memo', status: 'applied', findings: [] },
              { axis: 'missing_from_transcript', status: 'applied', findings: [] },
              { axis: 'undiscussed_session_goal', status: 'applied', findings: [] },
            ],
          },
        })} />);
        const label = within(screen.getByTestId('ai-draft-contrast-missing_from_memo')).getByText('차이 없음');
        expect((label.closest('.wire-badge') as HTMLElement).dataset.tone).toBe('mint');
      });

      it('marks an applied axis with findings with a lavender 차이 있음 badge', () => {
        render(<DraftReviewView {...props({
          draft: {
            ...props().draft,
            contrast: [
              {
                axis: 'missing_from_memo',
                status: 'applied',
                findings: [{ description: '메모에 없던 언급', materialKind: 'transcript', quote: '원문 인용 발췌' }],
              },
              { axis: 'missing_from_transcript', status: 'applied', findings: [] },
              { axis: 'undiscussed_session_goal', status: 'no_session_goal', findings: [] },
            ],
          },
        })} />);
        const label = within(screen.getByTestId('ai-draft-contrast-missing_from_memo')).getByText('차이 있음');
        expect((label.closest('.wire-badge') as HTMLElement).dataset.tone).toBe('lavender');
      });

      it('marks a pre-v3 axis (no data) with a neutral 정보 없음 badge, distinct from 돌리지 못함', () => {
        render(<DraftReviewView {...props({ draft: { ...props().draft, contrast: [] } })} />);
        const label = within(screen.getByTestId('ai-draft-contrast-missing_from_memo')).getByText('정보 없음');
        expect((label.closest('.wire-badge') as HTMLElement).dataset.tone).toBeUndefined();
      });
    });
  });

  describe('처리(승인·반려)', () => {
    function reviewProps(overrides: Partial<DraftReviewViewProps> = {}): DraftReviewViewProps {
      return props({
        draft: {
          ...props().draft,
          origin: 'generated',
          creationMode: 'provider_generated',
          version: 3,
        },
        reviewAction: vi.fn(async () => undefined),
        ...overrides,
      });
    }

    it('renders approve and reject as named submit buttons in one form carrying scope and version', () => {
      const { container } = render(<DraftReviewView {...reviewProps()} />);

      const actionsForm = screen.getByTestId('ai-draft-review-actions');
      expect(within(actionsForm).getByRole('button', { name: '승인' })).toBeTruthy();
      expect(within(actionsForm).getByRole('button', { name: '반려' })).toBeTruthy();
      const form = container.querySelector('form[action]');
      expect(form).toBeTruthy();
      const hidden = (name: string) => form?.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
      expect(hidden('beneficiaryId')?.value).toBe('swallow-003');
      expect(hidden('supportCaseId')?.value).toBe('case-1');
      expect(hidden('sessionId')?.value).toBe('session-1');
      expect(hidden('expectedVersion')?.value).toBe('3');
    });

    // 검수 지적 2: 처리 카드도 title 슬롯을 써야 제목 밑 그라데이션 구분선을 받는다.
    it('renders the "처리" title through the card title slot (direct .wire-card-title child)', () => {
      render(<DraftReviewView {...reviewProps()} />);
      const card = screen.getByTestId('ai-draft-review-actions');
      expect(card.querySelector(':scope > .wire-card-title')?.textContent).toBe('처리');
    });

    it('does not render review controls for a fixture draft even when reviewAction is provided', () => {
      render(<DraftReviewView {...reviewProps({ draft: { ...reviewProps().draft, origin: 'fixture_generated', creationMode: 'fixture_generated' } })} />);
      expect(screen.queryByTestId('ai-draft-review-actions')).toBeNull();
    });

    it('does not render review controls when reviewAction is not provided', () => {
      render(<DraftReviewView {...reviewProps({ reviewAction: undefined })} />);
      expect(screen.queryByTestId('ai-draft-review-actions')).toBeNull();
    });

    // 검수 지적 5: 이미 처리된 초안을 다시 처리하는 UI 를 보여주지 않는다.
    it('hides the review-actions card once the draft has already been approved', () => {
      render(<DraftReviewView {...reviewProps({ draft: { ...reviewProps().draft, reviewDecision: 'approved' } })} />);
      expect(screen.queryByTestId('ai-draft-review-actions')).toBeNull();
    });

    it('hides the review-actions card once the draft has already been rejected', () => {
      render(<DraftReviewView {...reviewProps({ draft: { ...reviewProps().draft, reviewDecision: 'rejected' } })} />);
      expect(screen.queryByTestId('ai-draft-review-actions')).toBeNull();
    });

    it('shows the redirected error message when present', () => {
      render(<DraftReviewView {...reviewProps({ errorMessage: '다른 곳에서 이 초안이 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.' })} />);
      expect(screen.getByRole('alert').textContent).toBe('다른 곳에서 이 초안이 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.');
    });

    describe('읽기 전용 대조와 화자 확인 (D71)', () => {
      function contrastReviewProps(overrides: Partial<DraftReviewViewProps> = {}): DraftReviewViewProps {
        return reviewProps({
          draft: {
            ...reviewProps().draft,
            contrast: [
              {
                axis: 'missing_from_memo',
                status: 'applied',
                findings: [
                  { description: '메모에 없던 언급', materialKind: 'transcript', quote: '전사 인용 1' },
                  { description: '메모에 없던 언급 2', materialKind: 'transcript', quote: '전사 인용 2' },
                ],
              },
              {
                axis: 'missing_from_transcript',
                status: 'applied',
                findings: [{ description: '음성에 없던 내용', materialKind: 'text_context', quote: '메모 인용' }],
              },
              { axis: 'undiscussed_session_goal', status: 'no_session_goal', findings: [] },
            ],
          },
          ...overrides,
        });
      }

      it('keeps every contrast finding read-only without resolution controls', () => {
        const { container } = render(<DraftReviewView {...contrastReviewProps()} />);

        const form = container.querySelector('form[action]');
        expect(form?.getAttribute('id')).toBe('ai-draft-review-form');
        expect(container.querySelector('select[name^="contrastResolution."]')).toBeNull();
        expect(screen.getByText('전사 인용 1')).toBeTruthy();
        expect(screen.getByText('메모 인용')).toBeTruthy();
      });

      it('renders the speaker confirmation checkbox when a transcript-based axis was applied', () => {
        const { container } = render(<DraftReviewView {...contrastReviewProps()} />);
        const checkbox = container.querySelector('input[name="speakerMappingConfirmed"]') as HTMLInputElement | null;
        expect(checkbox?.type).toBe('checkbox');
        expect(checkbox?.value).toBe('true');
        // 폼 안에 서므로 체크했을 때만 제출에 실린다(미체크 = 키 부재).
        expect(checkbox?.closest('form')?.getAttribute('id')).toBe('ai-draft-review-form');
      });

      it('renders neither selects nor the checkbox when no axis was applied (text-only draft)', () => {
        const { container } = render(<DraftReviewView {...reviewProps()} />);
        expect(container.querySelector('select')).toBeNull();
        expect(container.querySelector('input[name="speakerMappingConfirmed"]')).toBeNull();
      });

      it('does not introduce resolution selects after the draft has been reviewed', () => {
        const { container } = render(<DraftReviewView {...contrastReviewProps({
          draft: { ...contrastReviewProps().draft, reviewDecision: 'approved' },
        })} />);
        expect(container.querySelector('select')).toBeNull();
      });
    });

    it('prefills a commitment action form while leaving owner and due date to the worker', () => {
      const actionItemAction = vi.fn(async () => undefined);
      const { container } = render(<DraftReviewView {...reviewProps({ actionItemAction })} />);
      const actionForm = screen.getByTestId('ai-commitment-action-commitment-1');
      const field = (name: string) => actionForm.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement | null;
      expect(field('description')?.value).toBe('상환 계획을 적어 보기로 했다.');
      expect(field('sessionId')?.value).toBe('session-1');
      expect(field('owner')?.getAttribute('required')).not.toBeNull();
      expect(field('dueDate')).not.toBeNull();
      expect(within(actionForm).getByRole('button', { name: '액션으로 등록' })).toBeTruthy();
      expect(container.querySelector('[name="owner"] option:checked')?.textContent).toBe('담당 선택');
    });
  });

  describe('재생성 (D69 · ADR-0036 결정 2)', () => {
    function regenerateProps(overrides: Partial<DraftReviewViewProps> = {}): DraftReviewViewProps {
      return props({
        draft: { ...props().draft, regenerateAvailable: true, regenerateSourceSnapshotId: 'snapshot-9' },
        generateAction: vi.fn(async () => undefined),
        ...overrides,
      });
    }

    it('renders the regenerate form with the server-provided snapshot id when available', () => {
      const { container } = render(<DraftReviewView {...regenerateProps()} />);

      const regenerate = screen.getByTestId('ai-draft-regenerate');
      expect(within(regenerate).getByRole('button', { name: '재생성' })).toBeTruthy();
      const form = container.querySelector('[data-testid="ai-draft-regenerate"] form');
      const hidden = (name: string) => form?.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
      expect(hidden('sourceSnapshotId')?.value).toBe('snapshot-9');
      expect(hidden('sessionId')?.value).toBe('session-1');
    });

    it('does not render the regenerate form when the server marks it unavailable', () => {
      render(<DraftReviewView {...props({
        draft: { ...props().draft, regenerateAvailable: false, regenerateSourceSnapshotId: null },
        generateAction: vi.fn(async () => undefined),
      })} />);
      expect(screen.queryByTestId('ai-draft-regenerate')).toBeNull();
    });

    it('does not render the regenerate form when generateAction is not provided, even if available', () => {
      render(<DraftReviewView {...props({
        draft: { ...props().draft, regenerateAvailable: true, regenerateSourceSnapshotId: 'snapshot-9' },
      })} />);
      expect(screen.queryByTestId('ai-draft-regenerate')).toBeNull();
    });

    // 검수 지적 2: 재생성 카드도 title 슬롯을 쓴다.
    it('renders the "재생성" title through the card title slot', () => {
      render(<DraftReviewView {...regenerateProps()} />);
      const card = screen.getByTestId('ai-draft-regenerate');
      expect(card.querySelector(':scope > .wire-card-title')?.textContent).toBe('재생성');
    });

    // 검수 지적 9·11: 안내는 처리 카드보다 위의 콜아웃으로 옮겨 승인 버튼 전에 읽히고,
    // 재생성 카드 자체는 버튼만 남는다. fixture 는 프리뷰에서 지킬 수 없는 약속("공식 기록에
    // 반영")을 하지 않는 문구로 갈라 표시한다.
    describe('재생성 가용 안내 (검수 지적 9·11)', () => {
      it('renders a callout above the 처리 card, worded for a real draft', () => {
        const reviewAction = vi.fn(async () => undefined);
        const { container } = render(<DraftReviewView {...props({
          draft: {
            ...props().draft,
            origin: 'generated',
            creationMode: 'provider_generated',
            regenerateAvailable: true,
            regenerateSourceSnapshotId: 'snapshot-9',
          },
          reviewAction,
          generateAction: vi.fn(async () => undefined),
        })} />);

        const notice = screen.getByTestId('ai-draft-regenerate-notice');
        expect(notice.textContent).toContain('재생성하면 이 재료까지 반영한 새 초안을 만듭니다');
        expect(notice.textContent).not.toContain('공식 기록에는 반영되지 않지만');

        const order = Array.from(container.querySelectorAll('[data-testid]')).map((el) => el.getAttribute('data-testid'));
        expect(order.indexOf('ai-draft-regenerate-notice')).toBeGreaterThan(-1);
        expect(order.indexOf('ai-draft-regenerate-notice')).toBeLessThan(order.indexOf('ai-draft-review-actions'));
      });

      it('words the callout for a fixture draft without promising the official record reflects it', () => {
        render(<DraftReviewView {...regenerateProps()} />);
        const notice = screen.getByTestId('ai-draft-regenerate-notice');
        expect(notice.textContent).toContain('공식 기록에는 반영되지 않지만');
      });

      it('does not render the callout when regenerate itself is unavailable', () => {
        render(<DraftReviewView {...props()} />);
        expect(screen.queryByTestId('ai-draft-regenerate-notice')).toBeNull();
      });

      it('keeps the regenerate card to just the button — the description moved to the callout', () => {
        render(<DraftReviewView {...regenerateProps()} />);
        const card = screen.getByTestId('ai-draft-regenerate');
        expect(card.textContent).not.toContain('더 새로운');
      });
    });
  });
});
