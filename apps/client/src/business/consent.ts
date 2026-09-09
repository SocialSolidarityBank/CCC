// 여섯 영역 동의의 API 경계 (S2·D82). 화면은 서버가 발행한 고지문만 보여 주고,
// 그 고지문의 버전과 hash, 스냅샷 ID를 그대로 기록에 되돌려 보낸다. 문안을 화면이 만들지 않는다.
//
// 옛 2종 체크(D44·D49)는 별도 계약이며 여기서 자동으로 승격하지 않는다.

import type {
  ConsentDecision, ConsentDisclosureSnapshot, ConsentDomain, CurrentConsentState,
} from '@ccc/contracts/consent';
import { CONSENT_COPY, CONSENT_DOMAINS } from '@ccc/contracts/consent';
import { isNullableString, isOpaqueIdentifier, record } from './api';
import { BusinessError } from './errors';
import type { BusinessTransport } from './transport';

export const CONSENT_STATE_LABELS: Record<CurrentConsentState['state'], string> = {
  unconfirmed: '확인 전', granted: '동의함', not_granted: '동의 안 함',
};
export const CONSENT_DOMAIN_LABELS: Record<ConsentDomain, string> =
  Object.fromEntries(CONSENT_DOMAINS.map((domain) => [domain, CONSENT_COPY[domain].label])) as Record<ConsentDomain, string>;

function isDomain(value: unknown): value is ConsentDomain {
  return typeof value === 'string' && (CONSENT_DOMAINS as readonly string[]).includes(value);
}

export function decodeConsentStates(value: unknown): CurrentConsentState[] {
  const row = record(value);
  if (!Array.isArray(row.consent)) throw new BusinessError('invalid_response');
  const states = row.consent.map((entry): CurrentConsentState => {
    const item = record(entry);
    const state = item.state;
    if (!isDomain(item.domain)
      || (state !== 'unconfirmed' && state !== 'granted' && state !== 'not_granted')
      || !isNullableString(item.provider) || !isNullableString(item.providerLegalRecipient)
      || !isNullableString(item.providerCountry) || !isNullableString(item.purpose)
      || !isNullableString(item.retentionDuration) || !isNullableString(item.effectiveAt)
      || !isNullableString(item.eventId)) throw new BusinessError('invalid_response');
    return {
      domain: item.domain, state,
      provider: item.provider as CurrentConsentState['provider'],
      providerLegalRecipient: item.providerLegalRecipient, providerCountry: item.providerCountry,
      purpose: item.purpose as CurrentConsentState['purpose'],
      retentionDuration: item.retentionDuration as CurrentConsentState['retentionDuration'],
      effectiveAt: item.effectiveAt, eventId: item.eventId,
      revision: typeof item.revision === 'number' ? item.revision : null,
      eventSequence: typeof item.eventSequence === 'number' ? item.eventSequence : null,
    };
  });
  if (states.length !== CONSENT_DOMAINS.length) throw new BusinessError('invalid_response');
  return states;
}

export function decodeDisclosures(value: unknown): ConsentDisclosureSnapshot[] {
  const row = record(value);
  if (!Array.isArray(row.disclosures)) throw new BusinessError('invalid_response');
  return row.disclosures.map((entry) => {
    const item = record(entry);
    const scope = record(item.scopeBinding);
    if (!isOpaqueIdentifier(item.snapshotId) || !isDomain(item.domain)
      || typeof item.fullKoreanCopy !== 'string' || item.fullKoreanCopy === ''
      || typeof item.copyVersion !== 'string' || typeof item.copyHash !== 'string'
      || typeof item.issuedAt !== 'string' || typeof item.expiresAt !== 'string'
      || typeof scope.orgId !== 'string') throw new BusinessError('invalid_response');
    return {
      snapshotId: item.snapshotId,
      scopeBinding: {
        orgId: scope.orgId,
        programId: typeof scope.programId === 'string' ? scope.programId : '',
        issuerId: typeof scope.issuerId === 'string' ? scope.issuerId : '',
        supportCaseId: isNullableString(scope.supportCaseId) ? scope.supportCaseId : null,
      },
      domain: item.domain, fullKoreanCopy: item.fullKoreanCopy,
      provider: item.provider as ConsentDisclosureSnapshot['provider'],
      providerLegalRecipient: isNullableString(item.providerLegalRecipient) ? item.providerLegalRecipient : null,
      country: isNullableString(item.country) ? item.country : null,
      purpose: item.purpose as ConsentDisclosureSnapshot['purpose'],
      retentionProfile: item.retentionProfile as ConsentDisclosureSnapshot['retentionProfile'],
      retentionDuration: item.retentionDuration as ConsentDisclosureSnapshot['retentionDuration'],
      copyVersion: item.copyVersion, copyHash: item.copyHash,
      issuedAt: item.issuedAt, expiresAt: item.expiresAt,
    };
  });
}

export class ConsentApi {
  constructor(private readonly transport: BusinessTransport) {}

  async states(supportCaseId: string): Promise<CurrentConsentState[]> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    return decodeConsentStates(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/consent`,
    ));
  }

  /** 발행된 고지문. 화면은 이 문안만 보여 주고 자기 문안을 만들지 않는다. */
  async disclosures(supportCaseId: string): Promise<ConsentDisclosureSnapshot[]> {
    if (!isOpaqueIdentifier(supportCaseId)) throw new BusinessError('invalid_request', 400);
    return decodeDisclosures(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/consent/disclosures`,
    ));
  }

  /**
   * 한 영역의 결정을 덧붙인다. 문안 버전과 hash, 스냅샷 ID는 발행본 그대로 보낸다.
   * 같은 `idempotencyKey`로 다시 보내면 서버가 같은 사건을 돌려주고 두 번 기록하지 않는다.
   */
  async record(supportCaseId: string, input: {
    disclosure: ConsentDisclosureSnapshot;
    decision: Extract<ConsentDecision, 'grant' | 'withdraw' | 'decline'>;
    idempotencyKey: string;
    expectedRevision: number | null;
  }): Promise<{ id: string; decision: ConsentDecision; revision: number }> {
    if (!isOpaqueIdentifier(supportCaseId) || !isOpaqueIdentifier(input.idempotencyKey)) {
      throw new BusinessError('invalid_request', 400);
    }
    const value = record(await this.transport.request(
      `/support-cases/${encodeURIComponent(supportCaseId)}/consent-events`, 'POST',
      {
        domain: input.disclosure.domain,
        decision: input.decision,
        provider: input.disclosure.provider,
        providerLegalRecipient: input.disclosure.providerLegalRecipient,
        providerCountry: input.disclosure.country,
        purpose: input.disclosure.purpose,
        retentionDuration: input.disclosure.retentionDuration,
        copyVersion: input.disclosure.copyVersion,
        copyHash: input.disclosure.copyHash,
        disclosureSnapshotId: input.disclosure.snapshotId,
        effectiveAt: new Date().toISOString(),
        idempotencyKey: input.idempotencyKey,
        correctionOfEventId: null,
        expectedRevision: input.expectedRevision,
      },
    ));
    if (!isOpaqueIdentifier(value.id) || typeof value.decision !== 'string'
      || typeof value.revision !== 'number') throw new BusinessError('invalid_response');
    return { id: value.id, decision: value.decision as ConsentDecision, revision: value.revision };
  }
}
