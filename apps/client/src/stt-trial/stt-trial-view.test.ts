// @vitest-environment jsdom
import { act, createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { SttTrialPage, SttTrialView, type SttTrialViewProps } from './stt-trial-page';
import { externalUploadLabel } from './messages';

const props: SttTrialViewProps = {
  status: null,
  statusError: null,
  actionError: null,
  file: { name: 'synthetic.wav', size: 1024, type: 'audio/wav' },
  engine: 'qwen3-asr',
  ownedTestRecording: true,
  allowExternalUpload: false,
  blockReason: null,
  trial: null,
  transcript: null,
  transcriptError: null,
  onFileChange: () => {},
  onEngineChange: () => {},
  onOwnedTestRecordingChange: () => {},
  onAllowExternalUploadChange: () => {},
  onSubmit: () => {},
  onRemoveTrial: () => {},
};

function render(patch: Partial<SttTrialViewProps> = {}) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(createElement(SttTrialView, { ...props, ...patch }));
  return container;
}

describe('STT 표시 안전 계약', () => {
  it('파일 메타데이터만으로 표시하고 차단 중 실행을 비활성화한다', () => {
    const ready = render();
    expect(ready.textContent).toContain(props.file!.name);
    const submit = (element: HTMLElement) => element.querySelector<HTMLButtonElement>('#stt-submit-heading')!
      .closest('section')!.querySelectorAll('button')[1]!;
    expect(submit(ready).disabled).toBe(false);
    const blocked = render({ blockReason: 'synthetic-block' });
    expect(submit(blocked).disabled).toBe(true);
    expect(blocked.querySelector('[role="status"]')?.textContent).toBe('synthetic-block');
  });

  it('경고는 발화 구획에서 제외하고 화자 유무 판단에도 쓰지 않는다', () => {
    const warning = { start: 1, end: 2, text: 'synthetic-warning', speaker: 'warning-only-speaker', warning: true };
    const view = render({ transcript: {
      segments: [{ start: 0, end: 1, text: 'synthetic-speech' }, warning],
      repetitionWarnings: [], forcedCuts: 0, qualityEvaluation: 'deferred',
    } });
    const sections = [...view.querySelectorAll('section')];
    const speech = sections.find((section) => section.textContent?.includes('synthetic-speech')
      && !section.querySelector('section'))!;
    const warnings = sections.find((section) => section.textContent?.includes(warning.text)
      && !section.querySelector('section'))!;
    expect(speech.textContent).not.toContain(warning.text);
    expect(warnings).not.toBe(speech);
    expect(view.textContent).not.toContain(warning.speaker);
  });

  it('외부 전송 증거가 없으면 미전송으로 바꾸지 않고 실행 중 삭제를 막는다', () => {
    const trial = { trialId: 'a'.repeat(32), status: 'running' as const, engine: 'azure' as const, externalUploadAttempted: null };
    const running = render({ trial });
    const stateSection = (element: HTMLElement) => element.querySelector('#stt-status-heading')!.closest('section')!;
    expect(stateSection(running).textContent).toContain(externalUploadLabel(null));
    expect(externalUploadLabel(null)).not.toBe(externalUploadLabel(false));
    expect(stateSection(running).querySelector('button')!.disabled).toBe(true);
    expect(stateSection(render({ trial: { ...trial, status: 'completed' } })).querySelector('button')!.disabled).toBe(false);
  });

  it('전사 조회 실패를 결과 카드에 표시하고 사용자 재조회로 복구한다', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let transcriptRequests = 0;
    const trialId = 'b'.repeat(32);
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      if (url.endsWith('/status')) return Response.json({
        engines: { 'qwen3-asr': { configured: true }, azure: { configured: false } },
        upload: { maxBytes: 2048, contentTypes: ['audio/wav'] }, busy: false,
      });
      if (url.endsWith('/transcript')) {
        transcriptRequests++;
        if (transcriptRequests === 1) return Response.json({ error: 'network_unavailable' }, { status: 503 });
        return Response.json({
          segments: [{ start: 0, end: 1, text: 'recovered-synthetic-speech' }],
          repetitionWarnings: [], forcedCuts: 0, qualityEvaluation: 'deferred',
        });
      }
      if (url.endsWith('/trials') && init?.method === 'POST') {
        return Response.json({ trialId, status: 'queued' });
      }
      return Response.json({ trialId, status: 'completed', engine: 'qwen3-asr', externalUploadAttempted: false });
    });
    const container = document.createElement('div');
    document.body.append(container);
    const mounted = createRoot(container);
    try {
      await act(async () => { mounted.render(createElement(SttTrialPage)); });
      const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, 'files', { value: [new File(['synthetic'], 'test.wav', { type: 'audio/wav' })] });
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
        container.querySelector<HTMLInputElement>('#stt-owned')!.click();
      });
      await act(async () => {
        container.querySelector('#stt-submit-heading')!.closest('section')!.querySelectorAll('button')[1]!.click();
      });
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      const result = container.querySelector('#stt-result-heading')!.closest('section')!;
      expect(result.querySelector('[role="alert"]')).not.toBeNull();
      expect(result.querySelector('[role="status"]')).toBeNull();
      expect(container.querySelector('#stt-submit-heading')!.closest('section')!.querySelector('[role="alert"]')).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
      expect(transcriptRequests).toBe(1);
      await act(async () => { result.querySelector('button')!.click(); });
      expect(result.querySelector('[role="alert"]')).toBeNull();
      expect(result.textContent).toContain('recovered-synthetic-speech');
      expect(transcriptRequests).toBe(2);
    } finally {
      await act(async () => { mounted.unmount(); });
      container.remove();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });
});
