import { CONSENT_DOMAINS } from '@ccc/contracts/consent';
import { describe, expect, it } from 'vitest';
import { consentUpdateEvent, decodeCurrentConsentStates } from './consent-contract';

const SUPPORT_CASE_ID = '11111111-1111-4111-8111-111111111111';
const currentGrant = {
  domain: 'personal_data_collection_use',
  state: 'granted',
  provider: 'institution',
  providerLegalRecipient: '사회연대은행',
  providerCountry: 'KR',
  purpose: 'case_management',
  retentionDuration: null,
  effectiveAt: '2026-09-16T00:00:00.000Z',
  eventId: '22222222-2222-4222-8222-222222222222',
  revision: 7,
  eventSequence: 11,
} as const;
const snapshot = {
  snapshotId: '33333333-3333-4333-8333-333333333333',
  scopeBinding: {
    orgId: 'org-1',
    programId: 'program-1',
    issuerId: 'user-1',
    supportCaseId: SUPPORT_CASE_ID,
  },
  domain: 'personal_data_collection_use',
  fullKoreanCopy: '개인정보를 상담과 사례관리 제공 및 상담 기록 관리 목적으로 수집·이용합니다.',
  provider: 'institution',
  providerLegalRecipient: '사회연대은행',
  country: 'KR',
  purpose: 'case_management',
  retentionProfile: 'default_temporary_d85',
  retentionDuration: 'default_temporary_d85',
  copyVersion: 'consent-six-domains-v1',
  copyHash: 'copy-hash',
  issuedAt: '2026-09-16T00:01:00.000Z',
  expiresAt: '2026-09-16T00:31:00.000Z',
} as const;

function currentConsentResponse(): unknown {
  return {
    consent: CONSENT_DOMAINS.map((domain) => domain === currentGrant.domain
      ? currentGrant
      : {
          domain,
          state: 'unconfirmed',
          provider: null,
          providerLegalRecipient: null,
          providerCountry: null,
          purpose: null,
          retentionDuration: null,
          effectiveAt: null,
          eventId: null,
          revision: null,
          eventSequence: null,
        }),
  };
}

describe('consent update contract', () => {
  it('현재 grant를 철회할 때 서버 응답의 provider 범위와 최신 revision을 보낸다', () => {
    const current = decodeCurrentConsentStates(currentConsentResponse())
      .find((state) => state.domain === currentGrant.domain);

    const event = consentUpdateEvent(
      current,
      'decline',
      snapshot,
      '2026-09-16T00:02:00.000Z',
      '44444444-4444-4444-8444-444444444444',
    );

    expect(event).toMatchObject({
      domain: 'personal_data_collection_use',
      decision: 'withdraw',
      provider: 'institution',
      providerLegalRecipient: '사회연대은행',
      providerCountry: 'KR',
      purpose: 'case_management',
      retentionDuration: null,
      expectedRevision: 7,
    });
  });
});
