import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '@ccc/contracts/database';
import { CONSENT_COPY, CONSENT_DOMAINS, type InstallConsentProviderRegistryInput } from '@ccc/contracts/consent';
import { PROGRAM_ADMISSION_COPY, PROGRAM_ADMISSION_COPY_VERSION } from '@ccc/contracts/program-admission';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import { sha256Hex } from '@ccc/contracts/consent';
import { createProgram, installConsentProviderRegistry, type Actor } from '@ccc/core/gateway';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import type { ApiEnv } from '@ccc/http-api/identity';
import { handleRequest } from '@ccc/http-api';
import { checkpointSources, openParityDatabase, type ParityDatabase } from './support/migration-parity';
import { startPostgresHarness, type PostgresHarness } from './support/postgres';
import type { PostgresDatabase } from '@ccc/db-postgres';

let harness: PostgresHarness;
beforeAll(async () => { harness = await startPostgresHarness(); }, 240_000);
afterAll(async () => { await harness?.dispose(); }, 150_000);

for (const profile of ['sqlite', 'postgres'] as const) {
  describe(`trusted registry installation (${profile})`, () => {
    let fixture: ParityDatabase;
    let requestDb: Database;
    let env: ApiEnv;
    let programId: string;
    let approval: InstallConsentProviderRegistryInput;
    const actor: Actor = { orgId: 'registry-install-org', userId: 'registry-install-admin', role: 'admin' };
    const workerId = '10000000-0000-4000-8000-000000000001';
    const request = (path: string, method = 'GET', body?: unknown) => handleRequest(new Request(`https://localhost${path}`, {
      method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    }), env, async () => actor);

    beforeEach(async () => {
      fixture = await openParityDatabase(profile, harness);
      for (const checkpoint of checkpointSources()) await fixture.apply(profile === 'postgres' ? checkpoint.postgres : checkpoint.sqlite);
      const db = fixture.db;
      await db.prepare("INSERT INTO organization_settings(org_id,time_zone,pii_purge_grace_days,org_name) VALUES (?,'UTC',365,'Install contract institution')")
        .bind(actor.orgId).run();
      await db.prepare("INSERT INTO program_admission_policies(org_id,version,stt_mode,llm_mode) VALUES (?,1,'off','off')").bind(actor.orgId).run();
      await db.prepare("INSERT INTO users(id,org_id,email,role,active) VALUES (?,?,?,'admin',1),(?,?,?,'counselor',1)")
        .bind(actor.userId, actor.orgId, 'registry-admin@example.invalid', workerId, actor.orgId, 'registry-worker@example.invalid').run();
      requestDb = profile === 'postgres'
        ? (await harness.openApiDatabase(db as PostgresDatabase)).forActor({ orgId: actor.orgId, actorId: actor.userId }) : db;
      env = { DB: requestDb, installationMode: 'community-cloud', secretStore: createEnvironmentSecretStore({}), audioStore: null };
      const program = await createProgram(env, actor, {
        displayName: 'Approved program', storageMode: 'supabase_seoul', processingMode: 'external_allowed',
        confirmation: {
          copyVersion: PROGRAM_ADMISSION_COPY_VERSION,
          copyHash: await sha256Hex(canonicalizeJcs(PROGRAM_ADMISSION_COPY)), installationPolicyVersion: 1,
          installationConfigHash: await sha256Hex(canonicalizeJcs({ deploymentMode: 'community-cloud', sttMode: 'off', llmMode: 'off' })),
        },
      });
      programId = program.id;
      await db.prepare('UPDATE organization_settings SET initial_program_id=? WHERE org_id=?').bind(programId, actor.orgId).run();
      approval = {
        schemaVersion: 1, orgId: actor.orgId, approvedBy: 'installation-operator',
        approvedAt: new Date(Date.now() - 60_000).toISOString(), approvalRef: 'institution-approval-2026',
        providers: [...new Set(CONSENT_DOMAINS.map(domain => CONSENT_COPY[domain].provider))].map(provider => ({
          provider, legalRecipient: `Approved contract recipient ${provider}`,
          country: provider === 'openai' ? 'US' : provider === 'azure' ? 'KR' : 'GB', validUntil: null,
        })),
      };
    }, 240_000);
    afterEach(async () => { await fixture?.dispose(); });

    it('unblocks actual readiness, disclosures and registration only after the production installer writes approved recipients', async () => {
      const before = await (await request('/me')).json() as { institution: { consentCopy: { status: string; domains: Array<{ disclosureAvailable: boolean }> } } };
      expect(before.institution.consentCopy.status).toBe('provider_registry_unavailable');
      expect(before.institution.consentCopy.domains.map(domain => domain.disclosureAvailable)).toEqual([false, false, false, false, false, false]);
      expect((await request(`/programs/${encodeURIComponent(programId)}/consent/disclosures`)).status).toBe(409);
      if (profile === 'postgres') await expect(installConsentProviderRegistry(requestDb, approval)).rejects.toThrow();
      const installed = await installConsentProviderRegistry(fixture.db, approval);
      expect(installed.replayed).toBe(false);
      const me = await (await request('/me')).json() as typeof before;
      expect(me.institution.consentCopy.status).toBe('available');
      expect(me.institution.consentCopy.domains.map(domain => domain.disclosureAvailable)).toEqual([true, true, true, true, true, true]);
      const response = await request(`/programs/${encodeURIComponent(programId)}/consent/disclosures`);
      expect(response.status).toBe(200);
      const { disclosures } = await response.json() as { disclosures: Array<{
        domain: typeof CONSENT_DOMAINS[number]; snapshotId: string; provider: string;
        providerLegalRecipient: string; country: string; purpose: string; copyVersion: string; copyHash: string;
      }> };
      expect(disclosures.map(row => row.domain)).toEqual([...CONSENT_DOMAINS]);
      for (const row of disclosures) {
        const supplied = approval.providers.find(entry => entry.provider === row.provider)!;
        expect({ recipient: row.providerLegalRecipient, country: row.country }).toEqual({ recipient: supplied.legalRecipient, country: supplied.country });
      }
      const registration = await request('/participants', 'POST', {
        programId, initialAssigneeUserId: workerId, idempotencyKey: crypto.randomUUID(),
        consentEvents: disclosures.map(row => ({
          domain: row.domain, decision: 'grant', provider: row.provider, providerLegalRecipient: row.providerLegalRecipient,
          providerCountry: row.country, purpose: row.purpose,
          retentionDuration: row.domain === 'voice_original_retention_period' ? 'default_temporary_d85' : null,
          copyVersion: row.copyVersion, copyHash: row.copyHash, disclosureSnapshotId: row.snapshotId,
          effectiveAt: new Date().toISOString(), idempotencyKey: crypto.randomUUID(), correctionOfEventId: null, expectedRevision: null,
        })),
      });
      expect(registration.status).toBe(201);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM consent_events WHERE org_id=?').bind(actor.orgId).first()).toEqual({ n: 6 });
    });

    it('replays identical approvals and appends renewals without rewriting snapshots or widening request-role grants', async () => {
      const first = await installConsentProviderRegistry(fixture.db, approval);
      expect(await installConsentProviderRegistry(fixture.db, approval)).toEqual({ ...first, replayed: true });
      await expect(installConsentProviderRegistry(fixture.db, { ...approval,
        providers: approval.providers.map((entry, index) => index === 0 ? { ...entry, legalRecipient: 'Conflicting recipient' } : entry),
      })).rejects.toThrow();
      const renewed = { ...approval, approvedAt: new Date(Date.now() - 30_000).toISOString(),
        providers: approval.providers.map(entry => ({ ...entry, legalRecipient: `${entry.legalRecipient} renewed` })),
      };
      if (profile === 'postgres') await expect(installConsentProviderRegistry(requestDb, renewed)).rejects.toThrow();
      await installConsentProviderRegistry(fixture.db, renewed);
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM consent_provider_registry_snapshots WHERE org_id=?').bind(actor.orgId).first())
        .toEqual({ n: 10 });
      for (const statement of [
        fixture.db.prepare('UPDATE consent_provider_registry_snapshots SET country=? WHERE id=?').bind('CA', first.snapshotIds[0]!),
        fixture.db.prepare('DELETE FROM consent_provider_registry_snapshots WHERE id=?').bind(first.snapshotIds[0]!),
      ]) await expect(statement.run()).rejects.toThrow();
      expect(await fixture.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE org_id=? AND action='consent_provider_registry_installed'")
        .bind(actor.orgId).first()).toEqual({ n: 2 });
      if (profile === 'postgres') {
        expect(await fixture.db.prepare("SELECT has_table_privilege('ccc_api','consent_provider_registry_snapshots','INSERT,UPDATE,DELETE') AS writable").first())
          .toEqual({ writable: 0 });
      }
    });

    it('rejects incomplete, duplicate, invalid and future approvals before any registry write', async () => {
      for (const invalid of [
        { ...approval, providers: approval.providers.slice(1) },
        { ...approval, providers: approval.providers.map(() => approval.providers[0]!) },
        { ...approval, approvedAt: new Date(Date.now() + 60_000).toISOString() },
        { ...approval, providers: approval.providers.map(entry => ({ ...entry, country: 'invalid' })) },
        { ...approval, providers: approval.providers.map(entry => ({ ...entry, legalRecipient: '' })) },
        { ...approval, providers: approval.providers.map(entry => ({ ...entry, validUntil: approval.approvedAt })) },
      ]) await expect(installConsentProviderRegistry(fixture.db, invalid)).rejects.toThrow();
      expect(await fixture.db.prepare('SELECT COUNT(*) AS n FROM consent_provider_registry_snapshots').first()).toEqual({ n: 0 });
    });

    it('rolls back the complete approved set when the audit transaction fails and keeps other organizations unavailable', async () => {
      const db = fixture.db;
      const aborting: Database = {
        prepare: sql => db.prepare(sql),
        batch: statements => db.batch([...statements, db.prepare("INSERT INTO consent_provider_registry_snapshots(id) VALUES ('injected-abort')")]),
      };
      await expect(installConsentProviderRegistry(aborting, approval)).rejects.toThrow();
      expect(await db.prepare('SELECT COUNT(*) AS n FROM consent_provider_registry_snapshots').first()).toEqual({ n: 0 });
      await installConsentProviderRegistry(db, { ...approval, orgId: 'other-install-org' });
      const me = await (await request('/me')).json() as { institution: { consentCopy: { status: string } } };
      expect(me.institution.consentCopy.status).toBe('provider_registry_unavailable');
      if (profile === 'postgres') expect((await requestDb.prepare('SELECT id FROM consent_provider_registry_snapshots').all()).results).toEqual([]);
    });
  });
}
