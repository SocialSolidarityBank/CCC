// D86 participant request-link HTTP contract. Synthetic organization and PII only.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { openEncryptedSqlite } from '@ccc/db-sqlite';
import type { Database, PreparedStatement } from '@ccc/contracts/database';
import {
  CONSENT_DOMAINS,
  type AppendConsentEventInput,
  type ConsentDisclosureSnapshot,
  type ConsentDomain,
  type ProviderId,
} from '@ccc/contracts/consent';
import type { Actor } from '@ccc/core/gateway';
import type { ApiEnv } from '@ccc/http-api/identity';
import worker from './support/local-worker';
import { setupD1, testActors, testProgramId } from './support/d1';
import { checkpointSources, proveParticipantRequestLinksSchema } from './support/migration-parity';

const { counselor, unassignedCounselor } = testActors;
const t = setupD1();
const LINK_TTL_MS = 7 * 24 * 60 * 60_000;
const DISCLOSURE_TTL_MS = 30 * 60_000;
const ORG_NAME = '합성 사회연대기관';
const COUNSELOR_NAME = '발급 실무자';

const REGISTRY: Record<ProviderId, { recipient: string; country: string }> = {
  institution: { recipient: 'Synthetic institution recipient', country: 'KR' },
  institution_recording: { recipient: 'Synthetic recording recipient', country: 'KR' },
  institution_private_storage: { recipient: 'Synthetic storage recipient', country: 'KR' },
  azure: { recipient: 'Synthetic STT recipient', country: 'KR' },
  openai: { recipient: 'Synthetic LLM recipient', country: 'US' },
};

type IssuedLink = {
  token: string;
  kind: 'participant';
  orgId: string;
  programId: string;
  programType: string;
  issuedBy: string;
  status: 'issued';
  issuedAt: string;
  expiresAt: string;
};

function openEnv(): ApiEnv {
  return { ...t.env, PUBLIC_SIGNUP_ENABLED: '1' };
}

function headersFor(actor: Actor): Record<string, string> {
  return {
    'content-type': 'application/json',
    'X-CCC-User-Id': actor.userId,
    'X-CCC-Org-Id': actor.orgId,
    'X-CCC-Role': actor.role,
  };
}

async function ready(): Promise<void> {
  await t.reset();
  for (const [provider, entry] of Object.entries(REGISTRY)) {
    await t.db.prepare(
      `INSERT INTO consent_provider_registry_snapshots (
         id, org_id, provider, legal_recipient, country, approved_at
       ) VALUES (?, ?, ?, ?, ?, '2025-01-01T00:00:00.000Z')`,
    ).bind(
      `participant-link-registry-${provider}`,
      counselor.orgId,
      provider,
      entry.recipient,
      entry.country,
    ).run();
  }
  await t.db.prepare('UPDATE organization_settings SET org_name = ? WHERE org_id = ?')
    .bind(ORG_NAME, counselor.orgId).run();
  await t.db.prepare('UPDATE users SET name = ? WHERE id = ? AND org_id = ?')
    .bind(COUNSELOR_NAME, counselor.userId, counselor.orgId).run();
}

async function issueLink(actor: Actor = counselor): Promise<IssuedLink> {
  const response = await worker.fetch(new Request('http://localhost/invites/participant', {
    method: 'POST',
    headers: headersFor(actor),
    body: JSON.stringify({ programId: testProgramId(actor.orgId) }),
  }), openEnv());
  expect(response.status).toBe(201);
  return response.json() as Promise<IssuedLink>;
}

async function getDisclosures(token: string): Promise<ConsentDisclosureSnapshot[]> {
  const response = await worker.fetch(new Request(
    `http://localhost/invites/participant/${encodeURIComponent(token)}/consent/disclosures`,
  ), openEnv());
  expect(response.status).toBe(200);
  const body = await response.json() as { disclosures: ConsentDisclosureSnapshot[] };
  expect(body.disclosures).toHaveLength(CONSENT_DOMAINS.length);
  return body.disclosures;
}

function consentEvents(
  disclosures: ConsentDisclosureSnapshot[],
  decisions: Partial<Record<ConsentDomain, 'grant' | 'decline'>> = {},
): AppendConsentEventInput[] {
  const byDomain = Object.fromEntries(
    disclosures.map((snapshot) => [snapshot.domain, snapshot]),
  ) as Partial<Record<ConsentDomain, ConsentDisclosureSnapshot>>;
  const effectiveAt = new Date().toISOString();
  return CONSENT_DOMAINS.map((domain) => {
    const snapshot = byDomain[domain];
    if (snapshot === undefined) throw new Error(`missing disclosure snapshot for ${domain}`);
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

function signup(body: Record<string, unknown>, env: ApiEnv = openEnv()): Promise<Response> {
  return worker.fetch(new Request('http://localhost/signup/participant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }), env);
}

async function countRows(table: string): Promise<number> {
  const row = await t.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  return row?.count ?? -1;
}

async function expectNoParticipantCreated(): Promise<void> {
  for (const table of [
    'beneficiaries',
    'participant_pii_vault',
    'support_cases',
    'support_case_assignees',
    'consent_events',
  ]) {
    expect(await countRows(table)).toBe(0);
  }
}

describe('D86 participant request-link HTTP contract', () => {
  it('issues a seven-day counselor link and repeated public GETs do not consume it', async () => {
    await ready();
    const link = await issueLink();
    const programId = testProgramId(counselor.orgId);

    expect(link).toMatchObject({
      token: expect.stringMatching(/^[0-9a-f]{64}$/u),
      kind: 'participant',
      orgId: counselor.orgId,
      programId,
      programType: 'financial_support_v1',
      issuedBy: counselor.userId,
      status: 'issued',
      issuedAt: expect.any(String),
      expiresAt: expect.any(String),
    });
    expect(Date.parse(link.expiresAt) - Date.parse(link.issuedAt)).toBe(LINK_TTL_MS);

    const expectedPublicInfo = {
      status: 'issued',
      programType: 'financial_support_v1',
      programId,
      expiresAt: link.expiresAt,
      orgName: ORG_NAME,
    };
    for (let requestNumber = 0; requestNumber < 2; requestNumber += 1) {
      const response = await worker.fetch(new Request(
        `http://localhost/invites/participant/${encodeURIComponent(link.token)}`,
      ), openEnv());
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual(expectedPublicInfo);
    }

    await expect(t.db.prepare(
      `SELECT status, expires_at AS expiresAt, used_at AS usedAt,
              used_by_beneficiary_id AS usedByBeneficiaryId, consumption_id AS consumptionId
       FROM invite_tokens WHERE token = ?`,
    ).bind(link.token).first()).resolves.toEqual({
      status: 'issued',
      expiresAt: link.expiresAt,
      usedAt: null,
      usedByBeneficiaryId: null,
      consumptionId: null,
    });
  });

  it('returns six 30-minute snapshots bound to the link program and issuing counselor', async () => {
    await ready();
    const link = await issueLink();
    const disclosures = await getDisclosures(link.token);

    expect(new Set(disclosures.map((snapshot) => snapshot.domain))).toEqual(new Set(CONSENT_DOMAINS));
    expect(new Set(disclosures.map((snapshot) => snapshot.snapshotId)).size).toBe(CONSENT_DOMAINS.length);
    for (const snapshot of disclosures) {
      expect(snapshot.scopeBinding).toEqual({
        orgId: counselor.orgId,
        programId: link.programId,
        issuerId: counselor.userId,
        supportCaseId: null,
      });
      expect(Date.parse(snapshot.expiresAt) - Date.parse(snapshot.issuedAt)).toBe(DISCLOSURE_TTL_MS);
      await expect(t.db.prepare(
        `SELECT org_id AS orgId, program_id AS programId, issuer_id AS issuerId,
                support_case_id AS supportCaseId
         FROM consent_disclosure_snapshots WHERE id = ?`,
      ).bind(snapshot.snapshotId).first()).resolves.toEqual(snapshot.scopeBinding);
    }
  });

  it('signs up once with six self-recorded events, consumes the link, and retires self-check', async () => {
    await ready();
    const link = await issueLink();
    const events = consentEvents(await getDisclosures(link.token));
    const first = await signup({
      token: link.token,
      name: '합성 당사자',
      phone: '010-0000-0000',
      email: 'participant@example.invalid',
      consentEvents: events,
    });
    expect(first.status).toBe(201);
    const created = await first.json() as { beneficiaryId: string; supportCaseId: string };
    expect(created).toEqual({ beneficiaryId: expect.any(String), supportCaseId: expect.any(String) });

    await expect(t.db.prepare(
      'SELECT id FROM beneficiaries WHERE id = ?',
    ).bind(created.beneficiaryId).first()).resolves.toEqual({ id: created.beneficiaryId });
    await expect(t.db.prepare(
      'SELECT id, beneficiary_id AS beneficiaryId, program_id AS programId FROM support_cases WHERE id = ?',
    ).bind(created.supportCaseId).first()).resolves.toEqual({
      id: created.supportCaseId,
      beneficiaryId: created.beneficiaryId,
      programId: link.programId,
    });

    const storedEvents = await t.db.prepare(
      `SELECT domain, recorded_by AS recordedBy, event_sequence AS eventSequence,
              beneficiary_id AS beneficiaryId, support_case_id AS supportCaseId
       FROM consent_events ORDER BY event_sequence`,
    ).all<Record<string, unknown>>();
    expect(storedEvents.results).toHaveLength(CONSENT_DOMAINS.length);
    expect(storedEvents.results.map((row) => row.eventSequence)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(new Set(storedEvents.results.map((row) => row.domain))).toEqual(new Set(CONSENT_DOMAINS));
    for (const row of storedEvents.results) {
      expect(row).toMatchObject({
        recordedBy: 'self',
        beneficiaryId: created.beneficiaryId,
        supportCaseId: created.supportCaseId,
      });
    }

    await expect(t.db.prepare(
      "SELECT user_id AS userId, role FROM support_case_assignees WHERE support_case_id = ? AND role = 'primary'",
    ).bind(created.supportCaseId).first()).resolves.toEqual({ userId: counselor.userId, role: 'primary' });
    await expect(t.db.prepare(
      `SELECT status, used_by_beneficiary_id AS usedByBeneficiaryId,
              consumption_id AS consumptionId
       FROM invite_tokens WHERE token = ?`,
    ).bind(link.token).first()).resolves.toEqual({
      status: 'used',
      usedByBeneficiaryId: created.beneficiaryId,
      consumptionId: expect.any(String),
    });

    const second = await signup({
      token: link.token,
      name: '두 번째 합성 당사자',
      consentEvents: events,
    });
    expect([404, 409]).toContain(second.status);
    expect(await countRows('beneficiaries')).toBe(1);
    expect(await countRows('support_cases')).toBe(1);
    expect(await countRows('consent_events')).toBe(6);

    const used = await worker.fetch(new Request(
      `http://localhost/invites/participant/${encodeURIComponent(link.token)}`,
    ), openEnv());
    expect(used.status).toBe(200);
    const usedBody = await used.json() as { status: string; counselorName: string | null; message: string };
    expect(usedBody).toEqual({
      status: 'used',
      counselorName: COUNSELOR_NAME,
      message: expect.any(String),
    });
    expect(usedBody.message).toMatch(/\S/u);
    expect(usedBody.message).not.toMatch(/[\r\n]/u);

    const retired = await worker.fetch(new Request(
      `http://localhost/invites/participant/${encodeURIComponent(link.token)}/me`,
    ), openEnv());
    expect(retired.status).toBe(404);
  });

  it('rejects the retired legacy consent object as invalid_request', async () => {
    await ready();
    const link = await issueLink();
    const response = await signup({
      token: link.token,
      name: '구형 본문',
      consent: { privacy: true, recordingAi: true },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_request' });
    await expectNoParticipantCreated();
  });

  it('rejects disclosures minted for another link issuer without creating a participant', async () => {
    await ready();
    const counselorLink = await issueLink(counselor);
    const otherIssuerLink = await issueLink(unassignedCounselor);
    const otherIssuerEvents = consentEvents(await getDisclosures(otherIssuerLink.token));

    const response = await signup({
      token: counselorLink.token,
      name: '범위 불일치',
      consentEvents: otherIssuerEvents,
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: 'consent_disclosure_mismatch' });
    await expectNoParticipantCreated();
    expect(await t.db.prepare(
      "SELECT COUNT(*) AS count FROM invite_tokens WHERE status = 'issued'",
    ).first<{ count: number }>()).toEqual({ count: 2 });
  });

  it('returns 404 for GET and POST after the absolute seven-day expiry', async () => {
    await ready();
    const link = await issueLink();
    const events = consentEvents(await getDisclosures(link.token));

    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(Date.parse(link.expiresAt) + 60_000));
      const get = await worker.fetch(new Request(
        `http://localhost/invites/participant/${encodeURIComponent(link.token)}`,
      ), openEnv());
      expect(get.status).toBe(404);
      await expect(get.json()).resolves.toEqual({ error: 'not_found' });

      const post = await signup({ token: link.token, name: '만료 뒤 제출', consentEvents: events });
      expect(post.status).toBe(404);
      await expect(post.json()).resolves.toEqual({ error: 'not_found' });
    } finally {
      vi.useRealTimers();
    }

    await expectNoParticipantCreated();
    await expect(t.db.prepare(
      'SELECT status, used_by_beneficiary_id AS usedByBeneficiaryId FROM invite_tokens WHERE token = ?',
    ).bind(link.token).first()).resolves.toEqual({ status: 'issued', usedByBeneficiaryId: null });
  });

  it('requires personal-data consent and leaves the request link unused on decline', async () => {
    await ready();
    const link = await issueLink();
    const events = consentEvents(await getDisclosures(link.token), {
      personal_data_collection_use: 'decline',
    });

    const response = await signup({ token: link.token, name: '개인정보 미동의', consentEvents: events });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({ error: 'privacy_consent_required' });
    await expectNoParticipantCreated();
    await expect(t.db.prepare(
      'SELECT status, consumption_id AS consumptionId FROM invite_tokens WHERE token = ?',
    ).bind(link.token).first()).resolves.toEqual({ status: 'issued', consumptionId: null });
  });

  it('rolls back every signup row when its single atomic batch fails', async () => {
    await ready();
    const link = await issueLink();
    const events = consentEvents(await getDisclosures(link.token));
    const baseDb = t.env.DB;
    let batchCalls = 0;
    const failingDb: Database = {
      prepare: baseDb.prepare.bind(baseDb),
      async batch<T = unknown>(statements: PreparedStatement[]) {
        batchCalls += 1;
        return baseDb.batch<T>([
          ...statements,
          baseDb.prepare('INSERT INTO participant_request_link_missing_table (id) VALUES (?)')
            .bind('force-rollback'),
        ]);
      },
    };

    const response = await signup({
      token: link.token,
      name: '원자성 확인',
      consentEvents: events,
    }, { ...openEnv(), DB: failingDb });
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'internal_error' });
    expect(batchCalls).toBe(1);
    await expectNoParticipantCreated();
    await expect(t.db.prepare(
      `SELECT status, used_at AS usedAt, used_by_beneficiary_id AS usedByBeneficiaryId,
              consumption_id AS consumptionId
       FROM invite_tokens WHERE token = ?`,
    ).bind(link.token).first()).resolves.toEqual({
      status: 'issued',
      usedAt: null,
      usedByBeneficiaryId: null,
      consumptionId: null,
    });
  });
});

describe('0059 forward SQLite upgrade', () => {
  it('replays the registered checkpoint through the shared live semantic proof', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'ccc-request-link-checkpoint-'));
    const db = openEncryptedSqlite({ filename: join(directory, 'proof.db'), key: new Uint8Array(32).fill(31) });
    try {
      for (const checkpoint of checkpointSources()) await db.applyMigrations(checkpoint.sqlite);
      await proveParticipantRequestLinksSchema(db);
    } finally { db.close(); rmSync(directory, { recursive: true, force: true }); }
  });
});
