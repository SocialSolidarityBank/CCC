import { afterEach, describe, it, expect, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { ReactElement } from 'react';
import ParticipantPage, { participantHeroDetails } from './page';
import { ConsentEditor } from '../new/register-form';
import type { ParticipantHubDetail } from '../../lib/api';
import {
  CONSENT_COPY,
  CONSENT_DOMAINS,
  type ConsentDisclosureSnapshot,
  type ConsentDomain,
  type ConsentState,
  type CurrentConsentState,
} from '@ccc/contracts/consent';

// page.tsx 가 lib/api 를 import 하므로 모듈 로드가 server-only·@opennextjs/cloudflare 변환에
// 걸린다. ConsentEditor 는 API 를 쓰지 않으므로 최소 목만 둔다(settings/page.test.tsx 패턴).
vi.mock('../../lib/api', () => ({
  ApiError: class extends Error { constructor(readonly code: string) { super(code); } },
  getParticipantHubDetail: vi.fn(async () => ({
    beneficiaryId: 'swallow-003',
    name: '홍서희',
    phone: '010-1234-5678',
    email: 'participant@example.test',
    programs: [],
  })),
  getParticipantGoalTree: vi.fn(async () => []),
  getSupportCaseConsent: vi.fn(),
  issueSupportCaseConsentDisclosures: vi.fn(),
}));
vi.mock('../../lib/display-labels', () => ({
  getDisplayLabels: vi.fn(async () => ({ programLabels: { financial_support_v1: '금융지원' } })),
}));
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

const DISCLOSURES: ConsentDisclosureSnapshot[] = CONSENT_DOMAINS.map((domain, index) => ({
  snapshotId: `support-snapshot-${index + 1}`,
  scopeBinding: {
    orgId: 'org-1',
    programId: 'program-1',
    issuerId: 'user-1',
    supportCaseId: '11111111-1111-4111-8111-111111111111',
  },
  domain,
  fullKoreanCopy: `케이스에서 발급한 ${index + 1}번째 고지 전문`,
  provider: CONSENT_COPY[domain].provider,
  providerLegalRecipient: '사회연대은행',
  country: 'KR',
  purpose: CONSENT_COPY[domain].purpose,
  retentionProfile: 'default_temporary_d85',
  retentionDuration: 'default_temporary_d85',
  copyVersion: 'server-copy-v1',
  copyHash: `support-copy-hash-${index + 1}`,
  issuedAt: '2026-09-16T00:00:00.000Z',
  expiresAt: '2026-09-16T00:30:00.000Z',
}));


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

describe('당사자 정보 동의 오류', () => {
  it('동의 제출 입력이 불완전하면 redirect error를 화면에 표시한다', async () => {
    const page = await ParticipantPage({
      params: Promise.resolve({ beneficiaryId: 'swallow-003' }),
      searchParams: Promise.resolve({ error: 'invalid_request' }),
    });
    const content = (page.props as { children: ReactElement }).children;
    const contentResolved = await (
      content.type as (props: typeof content.props) => Promise<ReactElement>
    )(content.props);
    const hub = contentResolved as ReactElement;
    const hubResolved = await (
      hub.type as (props: typeof hub.props) => Promise<ReactElement>
    )(hub.props);
    const view = render(hubResolved);
    expect(view.queryByRole('alert')?.textContent).toContain('동의 변경 내용을 다시 확인해 주세요.');
  });
});

describe('동의 수정 허브 여섯 영역', () => {
  it('현재 상태와 서버 고지를 보여 주되 사용자가 바꾸기 전에는 결정 pair를 제출하지 않는다', () => {
    const states = consentStates({
      personal_data_collection_use: 'granted',
      sensitive_information_processing: 'not_granted',
    });
    const { container } = render(
      <ConsentEditor
        beneficiaryId="swallow-003"
        supportCaseId="11111111-1111-4111-8111-111111111111"
        formId="consent-form"
        recordedAtLabel="2026년 7월 16일 오후 6시"
        currentStates={states}
        disclosures={DISCLOSURES}
        action={() => {}}
      />,
    );
    const sections = [...container.querySelectorAll('.consent-fieldset .wire-card-section')];
    expect(sections.map((section) => section.querySelector('h3')?.textContent)).toEqual([
      `${CONSENT_COPY.personal_data_collection_use.label}동의함`,
      `${CONSENT_COPY.sensitive_information_processing.label}동의하지 않음`,
      ...CONSENT_DOMAINS.slice(2).map((domain) => `${CONSENT_COPY[domain].label}미기록`),
    ]);
    const data = new FormData(container.querySelector('form') as HTMLFormElement);
    for (const [index, domain] of CONSENT_DOMAINS.entries()) {
      expect(sections[index]?.textContent).toContain(DISCLOSURES[index]!.fullKoreanCopy);
      expect(sections[index]?.textContent).not.toContain(CONSENT_COPY[domain].copy);
      expect(container.querySelectorAll(`input[name="consentDecision_${domain}"]`)).toHaveLength(2);
      expect(data.get(`consentDecision_${domain}`)).toBeNull();
      expect(data.get(`consentSnapshot_${domain}`)).toBeNull();
    }
  });

  it('바꾼 영역만 decline 결정과 화면에서 읽은 snapshot JSON을 함께 제출한다', () => {
    const states = consentStates({ personal_data_collection_use: 'granted' });
    const { container } = render(
      <ConsentEditor
        beneficiaryId="swallow-003"
        supportCaseId="11111111-1111-4111-8111-111111111111"
        formId="consent-form"
        recordedAtLabel="2026년 7월 16일 오후 6시"
        currentStates={states}
        disclosures={DISCLOSURES}
        action={() => {}}
      />,
    );
    fireEvent.click(container.querySelector(
      'input[name="consentDecision_personal_data_collection_use"][value="decline"]',
    ) as HTMLInputElement);
    const data = new FormData(container.querySelector('form') as HTMLFormElement);
    expect(data.get('consentDecision_personal_data_collection_use')).toBe('decline');
    expect(data.get('consentSnapshot_personal_data_collection_use')).toBe(JSON.stringify(DISCLOSURES[0]));
    expect(data.get('consentDecision_sensitive_information_processing')).toBeNull();
    expect(data.get('consentSnapshot_sensitive_information_processing')).toBeNull();
    expect(container.querySelector('input[value="withdraw"]')).toBeNull();
  });
});
