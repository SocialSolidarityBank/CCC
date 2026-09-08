// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SttTrialView, type SttTrialViewProps } from './stt-trial-page';
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
});
