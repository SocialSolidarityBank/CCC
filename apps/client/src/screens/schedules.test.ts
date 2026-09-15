// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Outlet, RouterProvider, createMemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Briefing } from '../business/schedules';
import type { Session } from '../business/session';
import { BriefingScreen } from './schedules';

const roots = new Set<{ root: Root; container: HTMLElement }>();
afterEach(async () => {
  for (const { root, container } of roots) {
    await act(async () => { root.unmount(); });
    container.remove();
  }
  roots.clear();
  vi.unstubAllGlobals();
});

async function renderBriefing(discrepancies: Briefing['focus']['discrepancies']) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const briefing: Briefing = {
    beneficiaryId: 'swallow-003', focusSupportCaseId: 'case-1', overallGoal: null, canEditOverallGoal: false,
    activeGoals: [], participant: { name: '합성 당사자', phone: null },
    focus: { aiSuggestions: [], sessionRows: [], discrepancies, openActionItems: [], confirmedFlags: [], pendingReviewSessionIds: [] },
    upcoming: null,
  };
  const session = {
    schedules: { briefing: async () => briefing }, auth: { signOut: vi.fn() },
  } as unknown as Session;
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.add({ root, container });
  const router = createMemoryRouter([{
    element: createElement(() => createElement(Outlet, { context: session })),
    children: [{ path: '/participants/:beneficiaryId/programs/:supportCaseId/briefing', element: createElement(BriefingScreen) }],
  }], { initialEntries: ['/participants/swallow-003/programs/case-1/briefing'] });
  await act(async () => { root.render(createElement(RouterProvider, { router })); });
  return container;
}

describe('first-release briefing discrepancies', () => {
  it('shows within-session contradictions and hides cross-session AI comparison', async () => {
    const container = await renderBriefing([
      { id: 'disc-1', kind: 'within_session', left: '보이는 왼쪽', right: '보이는 오른쪽', resolution: null },
      { id: 'disc-2', kind: 'cross_session', left: '숨길 회차 간 왼쪽', right: '숨길 회차 간 오른쪽', resolution: null },
    ]);
    expect(container.textContent).toContain('보이는 왼쪽');
    expect(container.textContent).toContain('회차 안 모순');
    expect(container.textContent).not.toContain('숨길 회차 간 왼쪽');
    expect(container.textContent).not.toContain('회차 간 불일치');
  });

  it('reports no discrepancies when only cross-session items exist', async () => {
    const container = await renderBriefing([
      { id: 'disc-2', kind: 'cross_session', left: '숨길 회차 간 왼쪽', right: '숨길 회차 간 오른쪽', resolution: null },
    ]);
    expect(container.textContent).toContain('검출된 불일치가 없습니다.');
    expect(container.textContent).not.toContain('숨길 회차 간 왼쪽');
  });
});
