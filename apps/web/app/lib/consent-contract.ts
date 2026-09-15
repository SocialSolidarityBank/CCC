import {
  CONSENT_COPY,
  CONSENT_DOMAINS,
  type AppendConsentEventInput,
  type ConsentDisclosureSnapshot,
  type ConsentDomain,
  type CurrentConsentState,
} from '@ccc/contracts/consent';

const consentProviders = [...new Set(CONSENT_DOMAINS.map((domain) => CONSENT_COPY[domain].provider))];
const consentPurposes = [...new Set(CONSENT_DOMAINS.map((domain) => CONSENT_COPY[domain].purpose))];

function contractViolation(): never {
  throw new Error('API response did not match the declared contract.');
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') contractViolation();
  return value as Record<string, unknown>;
}

function nullableString(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') contractViolation();
  return value;
}

function nullablePositiveInteger(value: unknown): number | null {
  if (value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1)) {
    contractViolation();
  }
  return value;
}

export function decodeCurrentConsentStates(value: unknown): CurrentConsentState[] {
  const response = object(value);
  if (!Array.isArray(response.consent) || response.consent.length !== CONSENT_DOMAINS.length) {
    contractViolation();
  }
  const states = response.consent.map((entry): CurrentConsentState => {
    const state = object(entry);
    if (typeof state.domain !== 'string' || !CONSENT_DOMAINS.includes(state.domain as ConsentDomain)
      || (state.state !== 'unconfirmed' && state.state !== 'granted' && state.state !== 'not_granted')) {
      contractViolation();
    }
    const provider = nullableString(state.provider);
    const purpose = nullableString(state.purpose);
    const retentionDuration = nullableString(state.retentionDuration);
    if ((provider !== null && !consentProviders.includes(provider as typeof consentProviders[number]))
      || (purpose !== null && !consentPurposes.includes(purpose as typeof consentPurposes[number]))
      || (retentionDuration !== null && retentionDuration !== 'default_temporary_d85')) {
      contractViolation();
    }
    return {
      domain: state.domain as ConsentDomain,
      state: state.state,
      provider: provider as CurrentConsentState['provider'],
      providerLegalRecipient: nullableString(state.providerLegalRecipient),
      providerCountry: nullableString(state.providerCountry),
      purpose: purpose as CurrentConsentState['purpose'],
      retentionDuration: retentionDuration as CurrentConsentState['retentionDuration'],
      effectiveAt: nullableString(state.effectiveAt),
      eventId: nullableString(state.eventId),
      revision: nullablePositiveInteger(state.revision),
      eventSequence: nullablePositiveInteger(state.eventSequence),
    };
  });
  if (new Set(states.map((state) => state.domain)).size !== CONSENT_DOMAINS.length) contractViolation();
  return states;
}

export function consentUpdateEvent(
  current: CurrentConsentState | undefined,
  requestedDecision: 'grant' | 'decline',
  snapshot: ConsentDisclosureSnapshot,
  recordedAt: string,
  idempotencyKey: string,
): AppendConsentEventInput {
  const decision = requestedDecision === 'grant' ? 'grant'
    : current?.state === 'granted' ? 'withdraw' : 'decline';
  if (decision === 'withdraw' && current?.revision === null) contractViolation();

  const scope = decision === 'decline'
    ? { provider: null, providerLegalRecipient: null, providerCountry: null, purpose: null, retentionDuration: null }
    : decision === 'withdraw'
      ? {
          provider: current!.provider,
          providerLegalRecipient: current!.providerLegalRecipient,
          providerCountry: current!.providerCountry,
          purpose: current!.purpose,
          retentionDuration: current!.retentionDuration,
        }
      : {
          provider: snapshot.provider,
          providerLegalRecipient: snapshot.providerLegalRecipient,
          providerCountry: snapshot.country,
          purpose: snapshot.purpose,
          retentionDuration: snapshot.domain === 'voice_original_retention_period' ? snapshot.retentionDuration : null,
        };

  return {
    domain: snapshot.domain,
    decision,
    ...scope,
    copyVersion: snapshot.copyVersion,
    copyHash: snapshot.copyHash,
    disclosureSnapshotId: snapshot.snapshotId,
    effectiveAt: recordedAt,
    idempotencyKey,
    correctionOfEventId: null,
    expectedRevision: decision === 'withdraw' ? current!.revision : null,
  };
}
