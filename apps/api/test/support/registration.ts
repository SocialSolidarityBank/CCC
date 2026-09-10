// 등록 6종 동의 픽스처(S7). 합성 기관·합성 provider registry 만 심고 실제 PII·수신자는 없다.
import {
  issueRegistrationConsentDisclosures,
  type Actor,
  type Env,
} from '@ccc/core/gateway';
import {
  CONSENT_COPY,
  CONSENT_DOMAINS,
  type AppendConsentEventInput,
  type ConsentDomain,
  type ProviderId,
} from '@ccc/contracts/consent';

/** 6종 고지가 참조하는 provider 집합. 국외 처리 고지가 실제로 국가를 실어 나르는지 보려고 openai 만 US 다. */
const PROVIDERS: ProviderId[] = [...new Set(CONSENT_DOMAINS.map((domain) => CONSENT_COPY[domain].provider))];

/** 승인된 합성 registry. 같은 기관에 여러 번 불려도 안전하도록 OR IGNORE 다(행은 immutable). */
async function seedProviderRegistry(env: Env, orgId: string): Promise<void> {
  for (const provider of PROVIDERS) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO consent_provider_registry_snapshots (
         id, org_id, provider, legal_recipient, country, approved_at
       ) VALUES (?, ?, ?, ?, ?, '2025-01-01T00:00:00.000Z')`,
    ).bind(
      `fixture-registry-${orgId}-${provider}`,
      orgId,
      provider,
      `Synthetic ${provider} recipient`,
      provider === 'openai' ? 'US' : 'KR',
    ).run();
  }
}

/**
 * 등록에 실을 6종 동의 이벤트. 고지를 실제로 발급받아 그 스냅샷에 묶으므로
 * copyHash·provider 범위가 계약과 어긋나면 테스트가 아니라 게이트웨이가 거부한다.
 * `decisions` 로 도메인별 결정을 바꾼다(기본 전부 grant). decline 은 provider 를 비운다 —
 * 어디로도 보내지 않겠다는 결정이라 수신자·목적·보유기간이 없다.
 */
export async function registrationConsentEvents(
  env: Env,
  actor: Actor,
  programId: string,
  decisions: Partial<Record<ConsentDomain, 'grant' | 'decline'>> = {},
): Promise<AppendConsentEventInput[]> {
  await seedProviderRegistry(env, actor.orgId);
  const snapshots = await issueRegistrationConsentDisclosures(env, actor, programId);
  // 고지 발급 직후를 동의 시각으로 쓴다 — 게이트웨이가 미래·5분 초과 소급을 모두 거부한다.
  const effectiveAt = new Date().toISOString();
  return CONSENT_DOMAINS.map((domain) => {
    const snapshot = snapshots.find((item) => item.domain === domain);
    if (snapshot === undefined) throw new Error(`missing consent disclosure fixture for ${domain}`);
    const granted = (decisions[domain] ?? 'grant') === 'grant';
    return {
      domain,
      decision: granted ? 'grant' : 'decline',
      provider: granted ? snapshot.provider : null,
      providerLegalRecipient: granted ? snapshot.providerLegalRecipient : null,
      providerCountry: granted ? snapshot.country : null,
      purpose: granted ? snapshot.purpose : null,
      retentionDuration: granted && domain === 'voice_original_retention_period'
        ? 'default_temporary_d85' : null,
      copyVersion: snapshot.copyVersion,
      copyHash: snapshot.copyHash,
      disclosureSnapshotId: snapshot.snapshotId,
      effectiveAt,
      idempotencyKey: `${snapshot.snapshotId}:${domain}`,
      correctionOfEventId: null,
      expectedRevision: null,
    };
  });
}

/**
 * 등록 입력 한 벌. 주어진 입력에 재시도 키와 6종 동의를 얹는다. 재시도(replay)를 보는
 * 테스트는 이 결과를 **한 번 만들어 두고 재사용**해야 한다 — 다시 부르면 키도 고지도 새것이다.
 */
export async function registrationInput<T extends { programId: string }>(
  env: Env,
  actor: Actor,
  input: T,
  decisions?: Partial<Record<ConsentDomain, 'grant' | 'decline'>>,
): Promise<T & { idempotencyKey: string; consentEvents: AppendConsentEventInput[] }> {
  return {
    ...input,
    idempotencyKey: crypto.randomUUID(),
    consentEvents: await registrationConsentEvents(env, actor, input.programId, decisions),
  };
}
