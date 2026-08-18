import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const listSupportCaseRecords = vi.hoisted(() => vi.fn());
const getParticipantDetail = vi.hoisted(() => vi.fn());
const getAiDraft = vi.hoisted(() => vi.fn());
const reviewAiDraftAction = vi.hoisted(() => vi.fn());
const generateAiDraftAction = vi.hoisted(() => vi.fn());

class FakeApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

vi.mock('../../../../../../../lib/api', () => ({
  ApiError: FakeApiError,
  listSupportCaseRecords: (...args: unknown[]) => listSupportCaseRecords(...args),
  getParticipantDetail: (...args: unknown[]) => getParticipantDetail(...args),
  getAiDraft: (...args: unknown[]) => getAiDraft(...args),
}));

vi.mock('../../../../../../../actions', () => ({
  reviewAiDraftAction: (...args: unknown[]) => reviewAiDraftAction(...args),
  generateAiDraftAction: (...args: unknown[]) => generateAiDraftAction(...args),
}));

// 재료가 하나(텍스트)뿐일 때의 축 상태(D69 · ADR-0036 결정 2).
const singleTextMaterialContrast = [
  { axis: 'missing_from_memo', status: 'no_transcript', findings: [] },
  { axis: 'missing_from_transcript', status: 'no_transcript', findings: [] },
  { axis: 'undiscussed_session_goal', status: 'no_session_goal', findings: [] },
];

beforeEach(() => {
  listSupportCaseRecords.mockReset();
  getParticipantDetail.mockReset();
  getAiDraft.mockReset();
  reviewAiDraftAction.mockReset();
  generateAiDraftAction.mockReset();
  listSupportCaseRecords.mockResolvedValue({
    records: [{
      id: 'session-1',
      heldAt: '2026-08-15T09:00:00.000Z',
      channel: 'in_person',
    }],
  });
  getParticipantDetail.mockResolvedValue({
    beneficiaryId: 'swallow-003',
    name: '김테스트',
    phone: null,
    programs: [{
      id: 'case-1',
      beneficiaryId: 'swallow-003',
      programType: 'financial_support_v1',
      status: 'active',
      intakeAt: null,
      creationKind: 'initial',
      sourceSupportCase: null,
      authorized: true,
      assigneeNames: [],
      consent: { privacy: true, recordingAi: true },
      consentRecordedAt: null,
      upcomingSchedule: null,
    }],
  });
  getAiDraft.mockResolvedValue({
    version: 1,
    origin: 'fixture_generated',
    creationMode: 'fixture_generated',
    summaryText: 'fixture summary sentinel',
    oneLiner: 'fixture one-liner sentinel',
    questions: [],
    reviewDecision: null,
    evidence: [],
    contrast: singleTextMaterialContrast,
    regenerateAvailable: false,
    regenerateSourceSnapshotId: null,
  });
});

afterEach(cleanup);

async function renderContent(errorCode?: string, errorSource?: string) {
  const { ReviewContent } = await import('./page');
  return render(await ReviewContent({
    beneficiaryId: 'swallow-003',
    supportCaseId: 'case-1',
    sessionId: 'session-1',
    errorCode,
    errorSource,
  }));
}

describe('AI 초안 검토 페이지', () => {
  it('loads a draft only after session and participant scope match', async () => {
    await renderContent();

    expect(listSupportCaseRecords).toHaveBeenCalledWith('swallow-003', 'case-1');
    expect(getParticipantDetail).toHaveBeenCalledWith('swallow-003');
    expect(getAiDraft).toHaveBeenCalledWith('session-1');
    expect(screen.getByTestId('ai-draft-review')).toBeTruthy();
    expect(screen.getByTestId('preview-fixture-badge').dataset.tone).toBe('lavender');
    expect(document.body.textContent).toContain('대면');
    expect(document.body.textContent).not.toContain('in_person');
  });

  it('does not fetch or expose a draft when the session belongs to another case', async () => {
    listSupportCaseRecords.mockResolvedValue({
      records: [{
        id: 'session-other',
        heldAt: '2026-08-15T09:00:00.000Z',
        channel: 'in_person',
      }],
    });
    await renderContent();

    expect(getAiDraft).not.toHaveBeenCalled();
    expect(screen.queryByTestId('ai-draft-review')).toBeNull();
    expect(document.body.textContent).not.toContain('fixture summary sentinel');
  });

  // D69 · ADR-0036 · CCC-100: 이 화면은 이제 프리뷰 fixture 뿐 아니라 실제 생성 초안도
  // 검토·승인한다(CCC-67 이 지적한 간극을 덮는다) — 구 "실제 초안은 거부" 기대를 대체한다.
  it('renders a real provider-generated draft with review controls wired to reviewAiDraftAction', async () => {
    getAiDraft.mockResolvedValue({
      version: 2,
      origin: 'generated',
      creationMode: 'provider_generated',
      summaryText: 'provider summary sentinel',
      oneLiner: null,
      questions: [],
      reviewDecision: null,
      evidence: [],
      contrast: singleTextMaterialContrast,
      regenerateAvailable: false,
      regenerateSourceSnapshotId: null,
    });
    const { container } = await renderContent();

    expect(screen.getByTestId('ai-draft-review')).toBeTruthy();
    expect(document.body.textContent).toContain('provider summary sentinel');
    expect(screen.queryByTestId('preview-fixture-badge')).toBeNull();
    expect(screen.queryByTestId('preview-fixture-notice')).toBeNull();
    const form = container.querySelector('form[action]');
    expect(form).toBeTruthy();
  });

  // 검수 지적 5: HERO 상태 태그가 처리 사실을 말한다 — 승인·반려된 초안을 '검토 대기'로
  // 잘못 부르지 않는다.
  it('shows an approved stage tag when the draft has already been approved', async () => {
    getAiDraft.mockResolvedValue({
      version: 2,
      origin: 'generated',
      creationMode: 'provider_generated',
      summaryText: 'approved summary sentinel',
      oneLiner: null,
      questions: [],
      reviewDecision: 'approved',
      evidence: [],
      contrast: singleTextMaterialContrast,
      regenerateAvailable: false,
      regenerateSourceSnapshotId: null,
    });
    const { container } = await renderContent();
    expect(container.querySelector('.wire-status-tag')?.textContent).toBe('승인됨');
  });

  it('shows a rejected stage tag when the draft has already been rejected', async () => {
    getAiDraft.mockResolvedValue({
      version: 2,
      origin: 'generated',
      creationMode: 'provider_generated',
      summaryText: 'rejected summary sentinel',
      oneLiner: null,
      questions: [],
      reviewDecision: 'rejected',
      evidence: [],
      contrast: singleTextMaterialContrast,
      regenerateAvailable: false,
      regenerateSourceSnapshotId: null,
    });
    const { container } = await renderContent();
    expect(container.querySelector('.wire-status-tag')?.textContent).toBe('반려됨');
  });

  it('rejects a legacy_import draft — approval and regeneration assume materials this origin never has', async () => {
    getAiDraft.mockResolvedValue({
      version: 1,
      origin: 'legacy_import',
      creationMode: 'legacy_import',
      summaryText: 'legacy summary sentinel',
      oneLiner: null,
      questions: [],
      reviewDecision: 'approved',
      evidence: [],
      contrast: [],
      regenerateAvailable: false,
      regenerateSourceSnapshotId: null,
    });
    await renderContent();

    expect(screen.queryByTestId('ai-draft-review')).toBeNull();
    expect(document.body.textContent).not.toContain('legacy summary sentinel');
  });

  it('shows the error message mapped from the redirected error code', async () => {
    await renderContent('stale_draft_version');
    expect(screen.getByRole('alert').textContent).toBe('다른 곳에서 이 초안이 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.');
  });

  // 검수 지적 6: 재생성 실패는 처리 실패와 같은 기본 문구로 읽히지 않는다 — 같은 error 코드
  // (stale_draft_version)라도 errorSource=regenerate 면 "다시 만들지 못했습니다" 계열로 갈린다.
  // 안내가 서는 자리(role=alert, 같은 화면 상단)는 그대로다.
  it('shows a regenerate-flavored message for the same error code when errorSource=regenerate', async () => {
    await renderContent('stale_draft_version', 'regenerate');
    expect(screen.getByRole('alert').textContent).toBe('이 초안은 이미 처리되어 다시 만들 수 없습니다. 새로고침한 뒤 확인하세요.');
  });

  it('falls back to a regenerate-flavored generic message for an unmapped code when errorSource=regenerate', async () => {
    await renderContent('some_unmapped_code', 'regenerate');
    expect(screen.getByRole('alert').textContent).toBe('다시 만들지 못했습니다. 잠시 후 다시 시도하세요.');
  });
});
