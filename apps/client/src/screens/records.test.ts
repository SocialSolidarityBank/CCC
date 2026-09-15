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

describe('first-release AI review surface', () => {
  it('shows only session-goal claims and hides commitment registration while keeping contrast', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const draft = { version: 1, origin: 'agent', creationMode: 'recording', summaryText: '합성 요약',
      claims: [
        { claimKey: 'claim-goal', section: 'session_goal_discussion', text: '목표 논의 내용' },
        { claimKey: 'claim-other', section: 'other_topics', text: '숨길 자유 주제' },
        { claimKey: 'claim-commit', section: 'next_session_commitments', text: '숨길 약속 추출' },
      ],
      questions: [], evidence: [], oneLiner: null, reviewDecision: null,
      contrast: [{ axis: 'missing_from_memo', status: 'applied', findings: [finding('유지되는 대조 인용')] }],
      regenerateAvailable: false, regenerateSourceSnapshotId: null };
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
    expect(container.textContent).toContain('목표 논의 내용');
    expect(container.textContent).not.toContain('숨길 자유 주제');
    expect(container.textContent).not.toContain('숨길 약속 추출');
    expect(container.textContent).toContain('유지되는 대조 인용');
    expect(container.textContent).not.toContain('할 일로 등록');
    expect([...container.querySelectorAll('button')].map((button) => button.textContent)).toContain('승인');
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

describe('audio upload entry', () => {
  async function renderUpload(
    upload: () => Promise<unknown>,
    capabilities: Record<string, unknown> = {
      mode: 'community-cloud', sttMode: 'azure', sttEngine: 'azure-speech-koreacentral',
      agentStatus: 'connected', llmMode: 'off',
    },
  ) {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const session = {
      aiReview: new AiReviewApi({ request: async () => { throw httpError(404, { error: 'not_found' }); } } as never),
      records: { uploadAudio: upload },
      capabilities, auth: { signOut: vi.fn() },
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

  async function pickFileAndSubmit(container: HTMLElement) {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'memo.wav', { type: 'audio/wav' })], configurable: true,
    });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
    await act(async () => {
      [...container.querySelectorAll('button')].find((button) => button.textContent === '녹음 올리기')!.click();
    });
  }

  it('shows the upload section only when STT is on and no draft exists', async () => {
    const on = await renderUpload(async () => ({ sessionId: 'session-1', aiStatus: 'uploaded' }));
    expect(on.querySelector('input[type="file"]')).not.toBeNull();
    expect(on.textContent).toContain('지금 녹음을 올릴 수 있습니다');
    expect(on.textContent).toContain('원음은 처리 직후 지워집니다');
    const off = await renderUpload(async () => ({ sessionId: 'session-1', aiStatus: 'uploaded' }),
      { mode: 'community-cloud', sttMode: 'off', sttEngine: null, agentStatus: 'inactive', llmMode: 'off' });
    expect(off.querySelector('input[type="file"]')).toBeNull();
  });

  it('confirms receipt with the server-fixed lifecycle wording', async () => {
    const container = await renderUpload(async () => ({ sessionId: 'session-1', aiStatus: 'uploaded' }));
    await pickFileAndSubmit(container);
    expect(container.textContent).toContain('녹음을 받았습니다');
    expect(container.textContent).toContain('다음 영업일 처리 기회부터 전사됩니다');
  });

  it.each([
    [422, 'engine_unavailable', '녹음을 처리할 장비가 아직 준비되지 않았습니다'],
    [409, 'consent_not_effective', '녹음 동의와 외부 전사 처리 동의가 모두 필요합니다'],
    [409, 'program_admission_required', '사업의 도입 확인이 녹음 처리를 허용하지 않습니다'],
    [403, 'forbidden', '담당 실무자만 녹음을 올릴 수 있습니다'],
    [409, 'conflict', '이미 처리가 끝났거나 다른 변경이 먼저 저장된 회차입니다'],
    [400, 'invalid_request', '지원하지 않는 파일이거나 회차 상태가 맞지 않습니다'],
  ] as const)('splits HTTP %s / %s into its own wording', async (status, code, expected) => {
    const container = await renderUpload(async () => { throw httpError(status, { error: code }); });
    await pickFileAndSubmit(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(expected);
  });

  it('names only the recording consent on the local route', async () => {
    const container = await renderUpload(async () => { throw httpError(409, { error: 'consent_not_effective' }); },
      { mode: 'local-single', sttMode: 'local', sttEngine: 'qwen3-asr', agentStatus: 'connected', llmMode: 'off' });
    await pickFileAndSubmit(container);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('녹음 동의가 확인되지 않아');
    expect(container.querySelector('[role="alert"]')?.textContent).not.toContain('외부 전사');
  });
});
