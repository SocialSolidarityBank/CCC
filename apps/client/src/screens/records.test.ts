// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiReviewApi, CONTRAST_AXIS_LABELS, CONTRAST_UNAVAILABLE_LABELS } from '../business/ai-review';
import type { Session } from '../business/session';
import { RecordReviewScreen } from './records';

const roots = new Set<{ root: Root; container: HTMLElement }>();
afterEach(async () => {
  for (const { root, container } of roots) {
    await act(async () => { root.unmount(); });
    container.remove();
  }
  roots.clear();
  vi.unstubAllGlobals();
});

async function renderContrast(contrast: unknown[]) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const draft = { version: 1, origin: 'agent', creationMode: 'recording', summaryText: '합성 요약',
    claims: [], questions: [], evidence: [], oneLiner: null, reviewDecision: 'approved', contrast };
  const session = {
    aiReview: new AiReviewApi({ request: async () => draft } as never),
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
