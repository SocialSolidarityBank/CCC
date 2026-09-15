import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ConsentEditor, participantHeroDetails } from './page';
import type { ParticipantHubDetail, ParticipantProgram } from '../../lib/api';
import {
  CONSENT_COPY,
  CONSENT_COPY_VERSION,
  CONSENT_DOMAINS,
  type ConsentDomain,
  type ConsentState,
  type CurrentConsentState,
} from '@ccc/contracts/consent';

// page.tsx 가 lib/api 를 import 하므로 모듈 로드가 server-only·@opennextjs/cloudflare 변환에
// 걸린다. ConsentEditor 는 API 를 쓰지 않으므로 최소 목만 둔다(settings/page.test.tsx 패턴).
vi.mock('../../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  getParticipantHubDetail: vi.fn(),
}));
vi.mock('../../lib/display-labels', () => ({ getDisplayLabels: vi.fn() }));
vi.mock('../../actions', () => ({ updateParticipantConsentAction: vi.fn() }));

afterEach(cleanup);

function consentStates(overrides: Partial<Record<ConsentDomain, ConsentState>> = {}): CurrentConsentState[] {
  return CONSENT_DOMAINS.map((domain) => ({
    domain,
    state: overrides[domain] ?? 'unconfirmed',
    provider: CONSENT_COPY[domain].provider,
    providerLegalRecipient: null,
    providerCountry: null,
    purpose: CONSENT_COPY[domain].purpose,
    retentionDuration: domain === 'voice_original_retention_period' ? 'default_temporary_d85' : null,
    effectiveAt: null,
    eventId: null,
    revision: null,
    eventSequence: null,
  }));
}

function program(consent: CurrentConsentState[]): ParticipantProgram {
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
    upcomingSchedule: null,
  } as unknown as ParticipantProgram;
}

describe('당사자 정보 HERO 항목', () => {
  it('이름이 없으면 제목 폴백과 같은 가명 ID를 정보 격자에 반복하지 않는다', () => {
    const detail: ParticipantHubDetail = {
      beneficiaryId: 'swallow-003',
      name: null,
      phone: '010-1234-5678',
      email: 'participant@example.test',
      programs: [],
    };

    expect(participantHeroDetails(detail).map((item) => item.label)).toEqual(['연락처', '이메일']);
  });
});

describe('동의 수정 허브 여섯 영역', () => {
  it('정본 순서와 문안으로 여섯 영역과 결정 라디오를 그린다', () => {
    const { container } = render(
      <ConsentEditor beneficiaryId="swallow-003" program={program(consentStates())} />,
    );
    const sections = [...container.querySelectorAll('.consent-fieldset .wire-card-section')];
    expect(sections.map((section) => section.querySelector('h3')?.textContent)).toEqual(
      CONSENT_DOMAINS.map((domain) => CONSENT_COPY[domain].label),
    );
    for (const domain of CONSENT_DOMAINS) {
      expect(container.querySelectorAll(`input[name="consent-${domain}"]`)).toHaveLength(2);
      expect(container.textContent).toContain(CONSENT_COPY[domain].copy);
      expect(container.querySelector(
        `[role="radiogroup"][aria-label="${CONSENT_COPY[domain].label}"]`,
      )).not.toBeNull();
    }
    expect((container.querySelector('input[name="consentCopyVersion"]') as HTMLInputElement).value)
      .toBe(CONSENT_COPY_VERSION);
    expect(container.querySelector('input[name="consentPrivacy"]')).toBeNull();
    expect(container.querySelector('input[name="consentRecordingAi"]')).toBeNull();
  });

  it('저장된 결정만 선택하고 미확정 영역은 선택하지 않는다', () => {
    const states = consentStates({
      personal_data_collection_use: 'granted',
      sensitive_information_processing: 'not_granted',
    });
    const { container } = render(
      <ConsentEditor beneficiaryId="swallow-003" program={program(states)} />,
    );
    expect((container.querySelector(
      'input[name="consent-personal_data_collection_use"][value="grant"]',
    ) as HTMLInputElement).checked).toBe(true);
    expect((container.querySelector(
      'input[name="consent-personal_data_collection_use"][value="withdraw"]',
    ) as HTMLInputElement).checked).toBe(false);
    expect((container.querySelector(
      'input[name="consent-sensitive_information_processing"][value="decline"]',
    ) as HTMLInputElement).checked).toBe(true);
    const unconfirmed = container.querySelectorAll('input[name="consent-counseling_recording"]');
    expect([...unconfirmed].every((input) => !(input as HTMLInputElement).checked)).toBe(true);
  });
});
