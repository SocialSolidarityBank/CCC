import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ConsentEditor } from './page';
import type { ParticipantProgram } from '../../lib/api';

// page.tsx 가 lib/api 를 import 하므로 모듈 로드가 server-only·@opennextjs/cloudflare 변환에
// 걸린다. ConsentEditor 는 API 를 쓰지 않으므로 최소 목만 둔다(settings/page.test.tsx 패턴).
vi.mock('../../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  getParticipantDetail: vi.fn(),
}));
vi.mock('../../lib/display-labels', () => ({ getDisplayLabels: vi.fn() }));
vi.mock('../../actions', () => ({ updateParticipantConsentAction: vi.fn() }));

afterEach(cleanup);

function program(consent: ParticipantProgram['consent']): ParticipantProgram {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    beneficiaryId: 'swallow-003',
    programType: 'financial_support_v1',
    status: 'active',
    intakeAt: '2026-07-16T09:00:00.000Z',
    creationKind: 'initial',
    sourceSupportCase: null,
    authorized: true,
    assigneeNames: ['김실무'],
    consent,
    consentRecordedAt: '2026-07-16T09:00:00.000Z',
  };
}

// D49: 동의 수정 허브는 **철회가 사는 유일한 자리**다(D44). 체크박스 이름이 서버 액션의
// `checkbox(formData, 'consentRecordingAi')` 와 어긋나면 값이 빈 것으로 읽혀 조용히 철회가
// 저장되므로, 이름·개수·초기 체크 상태를 DOM 으로 고정한다.
describe('동의 수정 허브 체크박스 (D44 · D49)', () => {
  it('동의 2종만 그리고, 구 3종 시절 이름은 남지 않는다', () => {
    const { container } = render(
      <ConsentEditor beneficiaryId="swallow-003" program={program({ privacy: true, recordingAi: true })} />,
    );
    const boxes = container.querySelectorAll('input[type="checkbox"]');
    expect(boxes).toHaveLength(2);
    expect(container.querySelector('input[name="consentPrivacy"]')).not.toBeNull();
    expect(container.querySelector('input[name="consentRecordingAi"]')).not.toBeNull();
    expect(container.querySelector('input[name="consentRecording"]')).toBeNull();
    expect(container.querySelector('input[name="consentTextAi"]')).toBeNull();
  });

  it('저장된 동의가 체크된 채로 열린다 — 저장을 눌러도 철회가 되지 않는다', () => {
    const { container } = render(
      <ConsentEditor beneficiaryId="swallow-003" program={program({ privacy: true, recordingAi: true })} />,
    );
    for (const name of ['consentPrivacy', 'consentRecordingAi']) {
      const box = container.querySelector(`input[name="${name}"]`) as HTMLInputElement;
      expect(box.checked).toBe(true);
    }
  });

  it('미동의는 미체크로 열린다', () => {
    const { container } = render(
      <ConsentEditor beneficiaryId="swallow-003" program={program({ privacy: true, recordingAi: false })} />,
    );
    const merged = container.querySelector('input[name="consentRecordingAi"]') as HTMLInputElement;
    expect(merged.checked).toBe(false);
  });
});
