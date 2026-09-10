// 등록 전 6종 동의 고지·등록 계약 (S7). 합성 기관·합성 provider registry 만 쓰고 실제 PII 는 없다.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openEncryptedSqlite } from '@ccc/db-sqlite';
import {
  checkpointSources, seedPreregistrationConsentSchema, provePreregistrationConsentSchema,
} from './support/migration-parity';
import worker from './support/local-worker';
import {
  CONSENT_COPY,
  CONSENT_COPY_VERSION,
  CONSENT_DOMAINS,
  consentCopyPreimage,
  sha256Hex,
  type AppendConsentEventInput,
  type ConsentDisclosureSnapshot,
  type ConsentDomain,
  type CurrentConsentState,
  type ProviderId,
} from '@ccc/contracts/consent';
import type { PreparedStatement } from '@ccc/contracts/database';
import type { ApiEnv } from '@ccc/http-api/identity';
import { setupD1, testActors, testProgramId } from './support/d1';
import { assertConsentGate, ConsentContractError } from '@ccc/core/gateway';

const { counselor, unassignedCounselor, otherOrgCounselor } = testActors;
const t = setupD1();

/**
 * 승인된 합성 provider registry. 국외 처리 고지가 국가를 실제로 실어 나르는지 보려고
 * openai만 US이고 나머지는 국내 수신자다.
 */
const REGISTRY: Record<ProviderId, { recipient: string; country: string }> = {
  institution: { recipient: 'Synthetic institution recipient', country: 'KR' },
  institution_recording: { recipient: 'Synthetic recording recipient', country: 'KR' },
  institution_private_storage: { recipient: 'Synthetic storage recipient', country: 'KR' },
  azure: { recipient: 'Synthetic STT recipient', country: 'KR' },
  openai: { recipient: 'Synthetic LLM recipient', country: 'US' },
};

async function seedProviderRegistry(orgId: string): Promise<void> {
  for (const [provider, entry] of Object.entries(REGISTRY)) {
    await t.db.prepare(
      `INSERT INTO consent_provider_registry_snapshots (
         id, org_id, provider, legal_recipient, country, approved_at
       ) VALUES (?, ?, ?, ?, ?, '2025-01-01T00:00:00.000Z')`,
    ).bind(`fixture-registry-${orgId}-${provider}`, orgId, provider, entry.recipient, entry.country).run();
  }
}

async function ready(): Promise<void> {
  await t.reset();
  await seedProviderRegistry(counselor.orgId);
  await seedProviderRegistry(otherOrgCounselor.orgId);
}

/** 고지 hash 의 전문(preimage)은 도메인·provider·수신자·국가·목적·보유기간을 함께 접는다. */
function expectedCopyHash(domain: ConsentDomain): Promise<string> {
  const canonical = CONSENT_COPY[domain];
  return sha256Hex(consentCopyPreimage({
    domain,
    provider: canonical.provider,
    providerLegalRecipient: REGISTRY[canonical.provider].recipient,
    providerCountry: REGISTRY[canonical.provider].country,
    purpose: canonical.purpose,
    retentionDuration: domain === 'voice_original_retention_period' ? 'default_temporary_d85' : null,
  }));
}

function disclosureRequest(actor: typeof counselor, programId: string): Promise<Response> {
  return worker.fetch(new Request(
    `http://localhost/programs/${encodeURIComponent(programId)}/consent/disclosures`,
    {
      headers: {
        'X-CCC-User-Id': actor.userId,
        'X-CCC-Org-Id': actor.orgId,
        'X-CCC-Role': actor.role,
      },
    },
  ), t.env);
}

async function issuedDisclosures(
  actor: typeof counselor,
  programId: string,
): Promise<Record<ConsentDomain, ConsentDisclosureSnapshot>> {
  const response = await disclosureRequest(actor, programId);
  if (response.status !== 200) throw new Error(`disclosure issuance failed: ${response.status}`);
  const body = await response.json() as { disclosures: ConsentDisclosureSnapshot[] };
  const issued = {} as Record<ConsentDomain, ConsentDisclosureSnapshot>;
  for (const snapshot of body.disclosures) issued[snapshot.domain] = snapshot;
  for (const domain of CONSENT_DOMAINS) {
    if (issued[domain] === undefined) throw new Error(`missing disclosure snapshot for ${domain}`);
  }
  return issued;
}

function registrationBody(
  snapshots: Record<ConsentDomain, ConsentDisclosureSnapshot>,
  options: {
    programId: string;
    idempotencyKey: string;
    decisions?: Partial<Record<ConsentDomain, 'grant' | 'decline'>>;
    emergencyReason?: string;
    mutate?: (events: AppendConsentEventInput[]) => AppendConsentEventInput[];
  },
): Record<string, unknown> {
  const effectiveAt = new Date().toISOString();
  const events = CONSENT_DOMAINS.map((domain) => {
    const snapshot = snapshots[domain];
    const decision = options.decisions?.[domain] ?? 'grant';
    // 비적용 decline은 수신자와 목적을 지정하지 않는다.
    const applicable = decision === 'grant';
    return {
      domain,
      decision,
      provider: applicable ? snapshot.provider : null,
      providerLegalRecipient: applicable ? snapshot.providerLegalRecipient : null,
      providerCountry: applicable ? snapshot.country : null,
      purpose: applicable ? snapshot.purpose : null,
      retentionDuration: applicable && domain === 'voice_original_retention_period'
        ? 'default_temporary_d85' : null,
      copyVersion: snapshot.copyVersion,
      copyHash: snapshot.copyHash,
      disclosureSnapshotId: snapshot.snapshotId,
      effectiveAt,
      idempotencyKey: `${snapshot.snapshotId}:${domain}`,
      correctionOfEventId: null,
      expectedRevision: null,
    } satisfies AppendConsentEventInput;
  });
  return {
    programId: options.programId,
    idempotencyKey: options.idempotencyKey,
    consentEvents: options.mutate === undefined ? events : options.mutate(events),
    ...(options.emergencyReason === undefined ? {} : { emergencyReason: options.emergencyReason }),
  };
}

function register(
  body: Record<string, unknown>,
  actor: typeof counselor = counselor,
  env: ApiEnv = t.env,
): Promise<Response> {
  return worker.fetch(new Request('http://localhost/participants', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-CCC-User-Id': actor.userId,
      'X-CCC-Org-Id': actor.orgId,
      'X-CCC-Role': actor.role,
    },
    body: JSON.stringify(body),
  }), env);
}

async function countRows(table: string): Promise<number> {
  const row = await t.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  return row?.count ?? -1;
}

/** 거부된 등록은 당사자, 케이스, 동의 사건, 영수증을 남기지 않는다. */
async function expectNothingRegistered(): Promise<void> {
  expect(await countRows('beneficiaries')).toBe(0);
  expect(await countRows('support_cases')).toBe(0);
  expect(await countRows('consent_events')).toBe(0);
  expect(await countRows('participant_registration_receipts')).toBe(0);
}

/** 같은 기관의 다른 사업으로 고지 범위 검사를 분리한다. */
async function secondProgramId(orgId: string): Promise<string> {
  const id = `${testProgramId(orgId)}:second`;
  await t.db.prepare(
    `INSERT INTO programs (
       id, org_id, display_name, program_type, storage_mode, processing_mode, version,
       admission_confirmed_by, admission_confirmed_at, admission_confirmed_storage_mode,
       admission_confirmed_processing_mode, admission_copy_version, admission_copy_hash,
       admission_installation_config_hash, admission_installation_policy_version
     )
     SELECT ?, org_id, '두 번째 테스트 사업', program_type, storage_mode, processing_mode, version,
            admission_confirmed_by, admission_confirmed_at, admission_confirmed_storage_mode,
            admission_confirmed_processing_mode, admission_copy_version, admission_copy_hash,
            admission_installation_config_hash, admission_installation_policy_version
     FROM programs WHERE id = ?`,
  ).bind(id, testProgramId(orgId)).run();
  return id;
}

describe('GET /programs/:programId/consent/disclosures (S7 등록 전 고지)', () => {
  it('issues six program-scoped snapshots bound to the staff issuer with every server field', async () => {
    await ready();
    const programId = testProgramId(counselor.orgId);

    const response = await disclosureRequest(counselor, programId);
    expect(response.status).toBe(200);
    const body = await response.json() as { disclosures: ConsentDisclosureSnapshot[] };
    expect(body.disclosures).toHaveLength(CONSENT_DOMAINS.length);
    expect(new Set(body.disclosures.map((snapshot) => snapshot.domain)))
      .toEqual(new Set(CONSENT_DOMAINS));
    expect(new Set(body.disclosures.map((snapshot) => snapshot.snapshotId)).size)
      .toBe(CONSENT_DOMAINS.length);

    for (const snapshot of body.disclosures) {
      const canonical = CONSENT_COPY[snapshot.domain];
      // 등록 전이므로 사건 범위는 비어 있고, 발급자는 실제 실무자다.
      expect(snapshot.scopeBinding).toEqual({
        orgId: counselor.orgId,
        programId,
        issuerId: counselor.userId,
        supportCaseId: null,
      });
      expect(snapshot.fullKoreanCopy).toBe(canonical.copy);
      expect(snapshot.provider).toBe(canonical.provider);
      expect(snapshot.providerLegalRecipient).toBe(REGISTRY[canonical.provider].recipient);
      expect(snapshot.country).toBe(REGISTRY[canonical.provider].country);
      expect(snapshot.purpose).toBe(canonical.purpose);
      expect(snapshot.retentionProfile).toBe('default_temporary_d85');
      expect(snapshot.retentionDuration).toBe('default_temporary_d85');
      expect(snapshot.copyVersion).toBe(CONSENT_COPY_VERSION);
      expect(snapshot.copyHash).toBe(await expectedCopyHash(snapshot.domain));
      expect(Date.parse(snapshot.expiresAt)).toBeGreaterThan(Date.parse(snapshot.issuedAt));

      const row = await t.db.prepare(
        `SELECT org_id, program_id, issuer_id, support_case_id, domain, copy_hash, expires_at
         FROM consent_disclosure_snapshots WHERE id = ?`,
      ).bind(snapshot.snapshotId).first<Record<string, unknown>>();
      expect(row).toEqual({
        org_id: counselor.orgId,
        program_id: programId,
        issuer_id: counselor.userId,
        support_case_id: null,
        domain: snapshot.domain,
        copy_hash: snapshot.copyHash,
        expires_at: snapshot.expiresAt,
      });
    }
  });

  it('fails closed when no approved provider registry snapshot exists', async () => {
    await t.reset();
    const response = await disclosureRequest(counselor, testProgramId(counselor.orgId));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'provider_registry_unavailable' });
    expect(await countRows('consent_disclosure_snapshots')).toBe(0);
  });
});

describe('POST /participants 등록과 6종 동의 원자 기록 (S7)', () => {
  it('records six events as the staff actor with revision 1 and one monotonic sequence', async () => {
    await ready();
    const programId = testProgramId(counselor.orgId);
    const snapshots = await issuedDisclosures(counselor, programId);
    const idempotencyKey = crypto.randomUUID();

    const response = await register(registrationBody(snapshots, { programId, idempotencyKey }));
    expect(response.status).toBe(201);
    const created = await response.json() as { beneficiaryId: string; supportCaseId: string };
    expect(created).toEqual({
      beneficiaryId: expect.any(String),
      supportCaseId: expect.any(String),
      assignmentRole: 'primary',
      replayed: false,
    });

    const events = await t.db.prepare(
      `SELECT domain, decision, provider, provider_legal_recipient, provider_country, purpose,
              retention_duration, copy_version, copy_hash, disclosure_snapshot_id, recorded_by,
              revision, event_sequence, beneficiary_id, support_case_id, correction_of_event_id
       FROM consent_events ORDER BY event_sequence`,
    ).all<Record<string, unknown>>();
    expect(events.results).toHaveLength(CONSENT_DOMAINS.length);
    expect(events.results.map((row) => row.event_sequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(events.results.map((row) => row.domain))).toEqual(new Set(CONSENT_DOMAINS));
    for (const row of events.results) {
      const domain = row.domain as ConsentDomain;
      const canonical = CONSENT_COPY[domain];
      expect(row.decision).toBe('grant');
      expect(row.revision).toBe(1);
      expect(row.recorded_by).toBe(counselor.userId);
      expect(row.beneficiary_id).toBe(created.beneficiaryId);
      expect(row.support_case_id).toBe(created.supportCaseId);
      expect(row.provider).toBe(canonical.provider);
      expect(row.provider_legal_recipient).toBe(REGISTRY[canonical.provider].recipient);
      expect(row.provider_country).toBe(REGISTRY[canonical.provider].country);
      expect(row.purpose).toBe(canonical.purpose);
      expect(row.retention_duration).toBe(
        domain === 'voice_original_retention_period' ? 'default_temporary_d85' : null,
      );
      expect(row.copy_version).toBe(CONSENT_COPY_VERSION);
      expect(row.copy_hash).toBe(snapshots[domain].copyHash);
      expect(row.disclosure_snapshot_id).toBe(snapshots[domain].snapshotId);
      expect(row.correction_of_event_id).toBeNull();
    }

    const accepted = await t.db.prepare(
      `SELECT COUNT(*) AS count FROM consent_audit_events
       WHERE org_id = ? AND actor_id = ? AND action = 'consent_append' AND outcome_code = 'accepted'
         AND consent_event_id IN (SELECT id FROM consent_events)`,
    ).bind(counselor.orgId, counselor.userId).first<{ count: number }>();
    expect(accepted?.count).toBe(CONSENT_DOMAINS.length);

    const receipt = await t.db.prepare(
      `SELECT beneficiary_id, support_case_id, request_hash
       FROM participant_registration_receipts
       WHERE org_id = ? AND actor_id = ? AND idempotency_key = ?`,
    ).bind(counselor.orgId, counselor.userId, idempotencyKey).first<Record<string, unknown>>();
    expect(receipt?.beneficiary_id).toBe(created.beneficiaryId);
    expect(receipt?.support_case_id).toBe(created.supportCaseId);
    expect(receipt?.request_hash).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('rejects a tampered disclosure copy hash and writes nothing', async () => {
    await ready();
    const programId = testProgramId(counselor.orgId);
    const snapshots = await issuedDisclosures(counselor, programId);
    const tamperedHash = await sha256Hex('tampered disclosure copy');

    const response = await register(registrationBody(snapshots, {
      programId,
      idempotencyKey: crypto.randomUUID(),
      mutate: (events) => events.map((event) => (
        event.domain === 'counseling_recording' ? { ...event, copyHash: tamperedHash } : event
      )),
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'consent_disclosure_mismatch' });
    await expectNothingRegistered();
  });

  it('rejects snapshots that expired before submission', async () => {
    await ready();
    const programId = testProgramId(counselor.orgId);
    const snapshots = await issuedDisclosures(counselor, programId);
    const { expiresAt } = snapshots.personal_data_collection_use;

    // 불변 고지 행은 유지하고 시계만 옮긴다.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(Date.parse(expiresAt) + 60_000));
      const response = await register(registrationBody(snapshots, {
        programId,
        idempotencyKey: crypto.randomUUID(),
      }));
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: 'consent_disclosure_mismatch' });
    } finally {
      vi.useRealTimers();
    }
    await expectNothingRegistered();
    expect(await countRows('consent_disclosure_snapshots')).toBe(CONSENT_DOMAINS.length);
  });

  it('rejects snapshots issued to another staff actor in the same organization', async () => {
    await ready();
    const programId = testProgramId(counselor.orgId);
    const snapshots = await issuedDisclosures(counselor, programId);

    const response = await register(
      registrationBody(snapshots, { programId, idempotencyKey: crypto.randomUUID() }),
      unassignedCounselor,
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'consent_disclosure_mismatch' });
    await expectNothingRegistered();
  });

  it('rejects snapshots issued in another organization', async () => {
    await ready();
    const foreignSnapshots = await issuedDisclosures(
      otherOrgCounselor,
      testProgramId(otherOrgCounselor.orgId),
    );

    const response = await register(registrationBody(foreignSnapshots, {
      programId: testProgramId(counselor.orgId),
      idempotencyKey: crypto.randomUUID(),
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'consent_disclosure_mismatch' });
    await expectNothingRegistered();
  });

  it('rejects snapshots issued for another program of the same organization', async () => {
    await ready();
    const snapshots = await issuedDisclosures(counselor, testProgramId(counselor.orgId));
    const otherProgramId = await secondProgramId(counselor.orgId);

    const response = await register(registrationBody(snapshots, {
      programId: otherProgramId,
      idempotencyKey: crypto.randomUUID(),
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'consent_disclosure_mismatch' });
    await expectNothingRegistered();
  });

  it('replays the same key and payload, and conflicts on a changed payload', async () => {
    await ready();
    const programId = testProgramId(counselor.orgId);
    const snapshots = await issuedDisclosures(counselor, programId);
    const idempotencyKey = crypto.randomUUID();
    const body = registrationBody(snapshots, { programId, idempotencyKey });

    const first = await register(body);
    expect(first.status).toBe(201);
    const created = await first.json() as { beneficiaryId: string; supportCaseId: string };

    const replay = await register(body);
    expect(replay.status).toBe(201);
    await expect(replay.json()).resolves.toEqual({
      beneficiaryId: created.beneficiaryId,
      supportCaseId: created.supportCaseId,
      assignmentRole: 'primary',
      replayed: true,
    });
    expect(await countRows('beneficiaries')).toBe(1);
    expect(await countRows('consent_events')).toBe(CONSENT_DOMAINS.length);
    expect(await countRows('participant_registration_receipts')).toBe(1);

    const changed = await register(registrationBody(snapshots, {
      programId,
      idempotencyKey,
      decisions: { counseling_recording: 'decline' },
    }));
    expect(changed.status).toBe(409);
    await expect(changed.json()).resolves.toEqual({ error: 'idempotency_conflict' });
    expect(await countRows('beneficiaries')).toBe(1);
    expect(await countRows('consent_events')).toBe(CONSENT_DOMAINS.length);
    expect(await countRows('participant_registration_receipts')).toBe(1);
  });

  it('rolls back the participant, events and receipt when a guard aborts the write', async () => {
    await ready();
    const programId = testProgramId(counselor.orgId);
    const snapshots = await issuedDisclosures(counselor, programId);

    // 그래프 삽입 뒤 같은 배치 안에서 터지는 가드. 배치는 한 트랜잭션이라 통째로 되돌아가야 한다.
    // 배치 밖 쓰기가 있으면 아래 카운트가 잡는다.
    const database = t.env.DB;
    let batches = 0;
    const abortingEnv: ApiEnv = {
      ...t.env,
      DB: {
        prepare: (sql: string) => database.prepare(sql),
        batch: <T>(statements: PreparedStatement[]) => {
          batches += 1;
          return database.batch<T>([
            ...statements,
            database.prepare("INSERT INTO consent_events (id) VALUES ('injected-abort')"),
          ]);
        },
      },
    };

    const response = await register(
      registrationBody(snapshots, { programId, idempotencyKey: crypto.randomUUID() }),
      counselor,
      abortingEnv,
    );
    expect(response.ok).toBe(false);
    expect(batches).toBe(1);
    await expectNothingRegistered();
    expect(await countRows('participant_pii_vault')).toBe(0);
    expect(await countRows('support_case_assignees')).toBe(0);
  });

  it('keeps the emergency reason with a personal-data decline', async () => {
    await ready();
    const programId = testProgramId(counselor.orgId);
    const snapshots = await issuedDisclosures(counselor, programId);
    const emergencyReason = '주민센터 의뢰로 당일 접수, 동의서는 다음 방문에 받는다';

    const response = await register(registrationBody(snapshots, {
      programId,
      idempotencyKey: crypto.randomUUID(),
      decisions: { personal_data_collection_use: 'decline' },
      emergencyReason,
    }));
    expect(response.status).toBe(201);
    const created = await response.json() as { supportCaseId: string };

    const supportCase = await t.db.prepare(
      `SELECT emergency_registration_at, emergency_registration_reason, consent_privacy_due_at,
              consent_privacy_at
       FROM support_cases WHERE id = ?`,
    ).bind(created.supportCaseId).first<Record<string, unknown>>();
    expect(supportCase?.emergency_registration_reason).toBe(emergencyReason);
    expect(supportCase?.emergency_registration_at).not.toBeNull();
    expect(supportCase?.consent_privacy_due_at).not.toBeNull();
    expect(supportCase?.consent_privacy_at).toBeNull();

    const declined = await t.db.prepare(
      `SELECT decision, provider, provider_legal_recipient, provider_country, purpose,
              retention_duration, recorded_by
       FROM consent_events WHERE support_case_id = ? AND domain = 'personal_data_collection_use'`,
    ).bind(created.supportCaseId).first<Record<string, unknown>>();
    expect(declined).toEqual({
      decision: 'decline',
      provider: null,
      provider_legal_recipient: null,
      provider_country: null,
      purpose: null,
      retention_duration: null,
      recorded_by: counselor.userId,
    });
    expect(await countRows('consent_events')).toBe(CONSENT_DOMAINS.length);
  });

  it('rejects legacy registration and consent keys with invalid_request', async () => {
    await ready();
    const programId = testProgramId(counselor.orgId);
    const snapshots = await issuedDisclosures(counselor, programId);
    const legacyKeys: Record<string, unknown> = {
      consentPrivacy: true,
      consentRecordingAi: true,
      privacy: true,
      recordingAi: true,
      consentRecording: true,
      consentTextAi: true,
      consentPrivacyAt: '2026-09-10T00:00:00.000Z',
      intakeAt: '2026-09-10T00:00:00.000Z',
      schemaVersion: 1,
      submissionId: crypto.randomUUID(),
      consent: { privacy: true },
    };

    for (const [key, value] of Object.entries(legacyKeys)) {
      const response = await register({
        ...registrationBody(snapshots, { programId, idempotencyKey: crypto.randomUUID() }),
        [key]: value,
      });
      expect(response.status, key).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    }
    await expectNothingRegistered();
  });
});

describe('현재 상태 fold: 검증 불가한 grant는 권한이 아니다 (S7)', () => {
  /**
   * 등록 성공 뒤 **나중 사건**을 합성으로 심는다. 스키마상 유효하지만 현재 문안 버전이 아니거나
   * 아직 오지 않은 시각이라, 현재 상태로 접으면 grant 로 살아나서는 안 된다.
   * 불변 표를 고치지 않고 append 만 한다.
   */
  async function appendSyntheticGrant(
    scope: { beneficiaryId: string; supportCaseId: string },
    snapshot: ConsentDisclosureSnapshot,
    overrides: { copyVersion: string; effectiveAt: string; eventSequence: number },
  ): Promise<void> {
    const canonical = CONSENT_COPY[snapshot.domain];
    await t.db.prepare(
      `INSERT INTO consent_events (
         id, org_id, beneficiary_id, support_case_id, domain, decision, provider,
         provider_legal_recipient, provider_country, purpose, retention_duration, copy_version,
         copy_hash, disclosure_snapshot_id, effective_at, recorded_by, recorded_at, idempotency_key,
         request_hash, revision, event_sequence, correction_of_event_id, provider_registry_snapshot_id
       ) VALUES (?, ?, ?, ?, ?, 'grant', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, NULL, ?)`,
    ).bind(
      `synthetic-stale-${snapshot.domain}`,
      counselor.orgId,
      scope.beneficiaryId,
      scope.supportCaseId,
      snapshot.domain,
      canonical.provider,
      REGISTRY[canonical.provider].recipient,
      REGISTRY[canonical.provider].country,
      canonical.purpose,
      snapshot.domain === 'voice_original_retention_period' ? 'default_temporary_d85' : null,
      overrides.copyVersion,
      snapshot.copyHash,
      snapshot.snapshotId,
      overrides.effectiveAt,
      counselor.userId,
      new Date().toISOString(),
      `synthetic-stale-${snapshot.domain}`,
      await sha256Hex(`synthetic-stale-${snapshot.domain}`),
      overrides.eventSequence,
      `fixture-registry-${counselor.orgId}-${canonical.provider}`,
    ).run();
  }

  it('folds a stale-copy or not-yet-effective grant to unconfirmed and blocks the gate', async () => {
    await ready();
    const programId = testProgramId(counselor.orgId);
    const snapshots = await issuedDisclosures(counselor, programId);
    const response = await register(registrationBody(snapshots, {
      programId,
      idempotencyKey: crypto.randomUUID(),
    }));
    expect(response.status).toBe(201);
    const scope = await response.json() as { beneficiaryId: string; supportCaseId: string };

    // 지난 문안 버전으로 기록된 grant.
    await appendSyntheticGrant(scope, snapshots.counseling_recording, {
      copyVersion: 'consent-six-domains-v0',
      effectiveAt: new Date().toISOString(),
      eventSequence: CONSENT_DOMAINS.length + 1,
    });
    // 아직 효력 시각이 오지 않은 grant.
    await appendSyntheticGrant(scope, snapshots.external_stt_processing, {
      copyVersion: CONSENT_COPY_VERSION,
      effectiveAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
      eventSequence: CONSENT_DOMAINS.length + 2,
    });

    const current = await worker.fetch(new Request(
      `http://localhost/support-cases/${scope.supportCaseId}/consent`,
      {
        headers: {
          'X-CCC-User-Id': counselor.userId,
          'X-CCC-Org-Id': counselor.orgId,
          'X-CCC-Role': counselor.role,
        },
      },
    ), t.env);
    expect(current.status).toBe(200);
    const body = await current.json() as { consent: CurrentConsentState[] };
    const stateOf = (domain: ConsentDomain) => body.consent.find((entry) => entry.domain === domain);
    expect(stateOf('counseling_recording')?.state).toBe('unconfirmed');
    expect(stateOf('external_stt_processing')?.state).toBe('unconfirmed');
    expect(stateOf('personal_data_collection_use')?.state).toBe('granted');

    await expect(assertConsentGate(t.env, counselor.orgId, scope.supportCaseId, ['counseling_recording']))
      .rejects.toThrow(new ConsentContractError('consent_not_effective'));
    await expect(assertConsentGate(t.env, counselor.orgId, scope.supportCaseId, ['external_stt_processing']))
      .rejects.toThrow(new ConsentContractError('consent_not_effective'));
    await expect(assertConsentGate(
      t.env, counselor.orgId, scope.supportCaseId, ['personal_data_collection_use'],
    )).resolves.toMatchObject({ required: [expect.objectContaining({ decision: 'grant' })] });
  });
});

describe('0057 forward SQLite upgrade', () => {
  it('rebuilds the disclosure parent over live rows and keeps child events bound', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ccc-consent-checkpoint-'));
    const db = openEncryptedSqlite({ filename: join(directory, 'proof.db'), key: new Uint8Array(32).fill(23) });
    try {
      for (const checkpoint of checkpointSources()) {
        if (checkpoint.id === 'preregistration-consent') await seedPreregistrationConsentSchema(db);
        await db.applyMigrations(checkpoint.sqlite);
      }
      await provePreregistrationConsentSchema(db);
      expect(await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'consent_disclosure_snapshots_rebuild%' OR name = 'preregistration_consent_assertions'").first())
        .toEqual({ n: 0 });
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
