import { describe, expect, it } from 'vitest';
import type { ConsentDisclosureSnapshot } from '@ccc/contracts/consent';
import { consentEventFrom } from './consent';

function disclosure(domain: ConsentDisclosureSnapshot['domain']): ConsentDisclosureSnapshot {
  return {
    snapshotId: 'd0000000-0000-4000-8000-000000000001',
    scopeBinding: { orgId: 'org-1', programId: 'program-1', issuerId: 'user-1', supportCaseId: null },
    domain, fullKoreanCopy: '문안', provider: 'institution', providerLegalRecipient: '기관',
    country: null, purpose: 'case_management',
    retentionProfile: 'default_temporary_d85', retentionDuration: 'default_temporary_d85',
    copyVersion: 'consent-six-domains-v1', copyHash: 'hash', issuedAt: '2026-09-10T00:00:00.000Z',
    expiresAt: '2027-09-10T00:00:00.000Z',
  };
}

describe('동의 사건 만들기', () => {
  it('보유기간은 음성 원본 영역만 값을 갖는다', () => {
    // 서버는 나머지 다섯에 값이 실리면 provider_scope_mismatch 로 거절한다.
    expect(consentEventFrom(disclosure('voice_original_retention_period'), 'grant').retentionDuration)
      .toBe('default_temporary_d85');
    for (const domain of [
      'personal_data_collection_use', 'sensitive_information_processing', 'counseling_recording',
      'external_stt_processing', 'external_llm_cross_border_processing',
    ] as const) {
      expect(consentEventFrom(disclosure(domain), 'grant').retentionDuration).toBeNull();
    }
  });

  it('발행본의 사업자와 문안 값은 그대로 되돌려 보낸다', () => {
    const event = consentEventFrom(disclosure('personal_data_collection_use'), 'decline');
    expect(event).toMatchObject({
      provider: 'institution', providerLegalRecipient: '기관', providerCountry: null,
      purpose: 'case_management', copyVersion: 'consent-six-domains-v1', copyHash: 'hash',
      disclosureSnapshotId: 'd0000000-0000-4000-8000-000000000001', decision: 'decline',
    });
  });
});
