import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const listSupportCaseRecords = vi.hoisted(() => vi.fn());
const getParticipantDetail = vi.hoisted(() => vi.fn());
const getAiDraft = vi.hoisted(() => vi.fn());

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

beforeEach(() => {
  listSupportCaseRecords.mockReset();
  getParticipantDetail.mockReset();
  getAiDraft.mockReset();
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
  });
});

afterEach(cleanup);

async function renderContent() {
  const { ReviewContent } = await import('./page');
  return render(await ReviewContent({
    beneficiaryId: 'swallow-003',
    supportCaseId: 'case-1',
    sessionId: 'session-1',
  }));
}

describe('FixtureDraftReviewPage', () => {
  it('loads a fixture draft only after session and participant scope match', async () => {
    await renderContent();

    expect(listSupportCaseRecords).toHaveBeenCalledWith('swallow-003', 'case-1');
    expect(getParticipantDetail).toHaveBeenCalledWith('swallow-003');
    expect(getAiDraft).toHaveBeenCalledWith('session-1');
    expect(screen.getByTestId('fixture-review')).toBeTruthy();
    expect(screen.getByTestId('fixture-origin-badge').dataset.tone).toBe('lavender');
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
    expect(screen.queryByTestId('fixture-review')).toBeNull();
    expect(document.body.textContent).not.toContain('fixture summary sentinel');
  });

  it('does not expose a real provider draft on the fixture-only route', async () => {
    getAiDraft.mockResolvedValue({
      version: 1,
      origin: 'generated',
      creationMode: 'provider_generated',
      summaryText: 'provider summary sentinel',
      oneLiner: null,
      questions: [],
      reviewDecision: null,
      evidence: [],
    });
    await renderContent();

    expect(screen.queryByTestId('fixture-review')).toBeNull();
    expect(document.body.textContent).not.toContain('provider summary sentinel');
  });
});
