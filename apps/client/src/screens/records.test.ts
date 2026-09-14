// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiReviewApi, CONTRAST_AXIS_LABELS, CONTRAST_UNAVAILABLE_LABELS } from '../business/ai-review';
import type { Session } from '../business/session';
import { RecordReviewScreen } from './records';
import { httpError } from '../business/errors';

const roots = new Set<{ root: Root; container: HTMLElement }>();
afterEach(async () => {
  for (const { root, container } of roots) {
    await act(async () => { root.unmount(); });
    container.remove();
  }
  roots.clear();
  vi.unstubAllGlobals();
});

async function renderContrast(contrast: unknown[], failure?: { status: number; code: string; calls: string[] }) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const draft = { version: 1, origin: 'agent', creationMode: 'recording', summaryText: '합성 요약',
    claims: [], questions: [], evidence: [], oneLiner: null, reviewDecision: failure ? null : 'approved', contrast,
    regenerateAvailable: failure !== undefined, regenerateSourceSnapshotId: failure ? 'snapshot-1' : null };
  const session = {
    aiReview: new AiReviewApi({ request: async (_path: string, method = 'GET') => {
      failure?.calls.push(method);
      if (method === 'POST' && failure) throw httpError(failure.status, {
        error: failure.code, message: 'PRIVATE_PROVIDER_RESPONSE_SENTINEL', token: 'PRIVATE_PROVIDER_RESPONSE_SENTINEL',
      });
      return draft;
    } } as never),
    capabilities: { llmMode: 'off' }, auth: { signOut: vi.fn() },
  } as unknown as Session;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.add({ root, container });
  const router = createMemoryRouter([{
    element: createElement(() => createElement(Outlet, { context: session })),
    children: [{ path: '/participants/:beneficiaryId/programs/:supportCaseId/records/:sessionId/review',
      element: createElement(RecordReviewScreen) }],
  }], { initialEntries: ['/participants/swallow-003/programs/case-1/records/session-1/review'] });
  await act(async () => { root.render(createElement(RouterProvider, { router })); });
  return container;
}

const finding = (quote: string, materialKind = 'transcript') => ({
  description: `설명 ${quote}`, materialKind, quote,
});

describe('comparison visibility and unavailable reasons', () => {
  it('shows memo omissions and undiscussed goals but never the negative memo axis', async () => {
    const container = await renderContrast([
      { axis: 'missing_from_memo', status: 'applied', findings: [finding('보이는 녹음 인용')] },
      { axis: 'missing_from_transcript', status: 'applied', findings: [finding('금지된 메모 목록 표식', 'text_context')] },
      { axis: 'undiscussed_session_goal', status: 'applied', findings: [finding('보이는 목표 인용', 'text_context')] },
    ]);
    expect(container.textContent).toContain('보이는 녹음 인용');
    expect(container.textContent).toContain('보이는 목표 인용');
    expect(container.textContent).not.toContain('금지된 메모 목록 표식');
    expect(container.textContent).not.toContain('missing_from_transcript');
    expect(container.textContent).not.toContain('녹음에서 누락된 것');
  });

  it.each(['no_transcript', 'no_text', 'no_session_goal'] as const)('shows the server unavailable reason %s', async (status) => {
    const axis = status === 'no_session_goal' ? 'undiscussed_session_goal' : 'missing_from_memo';
    const container = await renderContrast([{ axis, status, findings: [] }]);
    expect(container.textContent).toContain(CONTRAST_UNAVAILABLE_LABELS[status]);
    expect(container.textContent).toContain(CONTRAST_AXIS_LABELS[axis]);
  });

  it('does not treat a negative-only response as successful checks of the visible axes', async () => {
    const absent = await renderContrast([]);
    const negativeOnly = await renderContrast([
      { axis: 'missing_from_transcript', status: 'applied', findings: [finding('비노출 표식', 'text_context')] },
    ]);
    expect(negativeOnly.textContent).toBe(absent.textContent);
    expect(negativeOnly.textContent).not.toContain('비노출 표식');
  });
});

describe('CCC-212 review recovery', () => {
  it.each([
    [404, 'not_found', 'manual-records'],
    [409, 'consent_not_effective', 'manual-records'],
    [409, 'text_ai_pilot_disabled', 'manual-records'],
    [409, 'ai_provider_not_configured', 'manual-records'],
    [422, 'ai_prohibited_output', 'manual-records'],
    [503, 'ai_provider_unavailable', 'manual-records'],
    [409, 'conflict', 'draft-reload'],
    [409, 'stale_draft_version', 'draft-reload'],
    [409, 'draft_version_required', 'draft-reload'],
  ] as const)('HTTP %s / %s uses %s recovery without retry or approval', async (status, code, recovery) => {
    const calls: string[] = [];
    const container = await renderContrast([], { status, code, calls });
    await act(async () => { container.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(); });
    await act(async () => {
      [...container.querySelectorAll('button')].find((button) => button.textContent === '최신 재료로 다시 만들기')!.click();
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(httpError(status, { error: code }).message);
    const reload = [...container.querySelectorAll('button')].find((button) => button.textContent === '최신 초안 다시 불러오기');
    expect(reload !== undefined).toBe(recovery === 'draft-reload');
    expect(container.querySelector('a[href="/participants/swallow-003/programs/case-1/records"]')).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked).toBe(true);
    expect([...container.querySelectorAll('button')].some((button) => button.textContent === '승인')).toBe(true);
    expect(container.textContent).not.toContain('PRIVATE_PROVIDER_RESPONSE_SENTINEL');
    expect(calls).toEqual(['GET', 'POST']);
  });
});
