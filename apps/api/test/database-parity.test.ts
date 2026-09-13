import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database } from '@ccc/contracts/database';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import { getCounselingMemorySettings, setCounselingMemorySettings, type Actor, type Env } from '@ccc/core/gateway';
import { startPostgresHarness, type PostgresHarness } from './support/postgres';
import { checkpointSources, dialectSemantics, openParityDatabase, rejection, type ParityDatabase } from './support/migration-parity';

let harness: PostgresHarness;
beforeAll(async () => { harness = await startPostgresHarness(); }, 240_000);
afterAll(async () => { await harness?.dispose(); }, 150_000);
const actor: Actor = { userId: 'parity-admin', orgId: 'parity-org', role: 'admin' };
const now = '2026-01-01T09:00:00.500Z';

async function businessFixture(fixture: ParityDatabase) {
  const db = fixture.db;
  const env: Env = { DB: db, secretStore: createEnvironmentSecretStore({}) };
  await db.prepare(`INSERT INTO organization_settings(org_id,time_zone,pii_purge_grace_days,created_at,updated_at) VALUES (?,'UTC',180,?,?)`)
    .bind(actor.orgId, now, now).run();
  await db.prepare(`INSERT INTO users(id,org_id,email,role,active,created_at) VALUES (?,?,?,'admin',1,?)`)
    .bind(actor.userId, actor.orgId, 'parity-admin@example.invalid', now).run();
  const saved = await setCounselingMemorySettings(env, actor, { enabled: false, expectedVersion: 1 });
  const reread = await getCounselingMemorySettings(env, actor);
  expect(saved).toEqual({ enabled: false, version: 2, pendingCases: 0, blockedCases: 0, failedCases: 0, lastSuccessAt: null });
  expect(reread).toEqual(saved);
  const businessAudit = await db.prepare(`SELECT actor_id,actor_role,action,target_table,target_id,detail,created_at FROM audit_log WHERE target_table='counseling_memory_settings' ORDER BY created_at,id`).all();
  expect(businessAudit.results).toHaveLength(3);
  expect(businessAudit.results[0]).toMatchObject({ action: 'update', actor_id: actor.userId, detail: JSON.stringify({ enabled: false, version: 2 }), created_at: now });
  // A stale gateway version rejects the transaction without persistence or an audit supplement.
  const beforeFailure = await observableState(db);
  await expect(setCounselingMemorySettings(env, actor, { enabled: true, expectedVersion: 1 })).rejects.toThrow();
  const afterFailure = await observableState(db);
  expect(afterFailure).toEqual(beforeFailure);

  // F10: a marker and its audit share one atomic batch. A mismatched marker emits zero audits.
  const guardedMutation = async (marker: string, expectedMarker: string) => db.batch([
    db.prepare(`INSERT INTO counseling_memory_guards(id,org_id,ok) VALUES (?,?,1)`).bind(marker, actor.orgId),
    db.prepare(`INSERT INTO audit_log(org_id,actor_id,actor_role,action,target_table,target_id,created_at)
      SELECT ?,?,'admin','parity_marker','counseling_memory_guards',?,?
      WHERE EXISTS(SELECT 1 FROM counseling_memory_guards WHERE id=? AND ok=1)`)
      .bind(actor.orgId, actor.userId, marker, now, expectedMarker),
  ]);
  const matching = await guardedMutation('marker-match', 'marker-match');
  const mismatched = await guardedMutation('marker-mismatch', 'different-marker');
  expect(matching.map((result) => result.meta.changes)).toEqual([1, 1]);
  expect(mismatched.map((result) => result.meta.changes)).toEqual([1, 0]);

  await db.prepare(`INSERT INTO counseling_memory_history(id,org_id,support_case_id,revision,item_json) VALUES ('history',?,'synthetic-case',1,'{}')`).bind(actor.orgId).run();
  await db.prepare(`INSERT INTO invite_tokens(token,org_id,kind,program_type,issued_by,status,used_at,issued_at)
    VALUES ('used-token',?,'counselor',NULL,?,'used',?,?)`).bind(actor.orgId, actor.userId, now, now).run();
  const failures = [
    { subtype: 'unique', statement: db.prepare(`INSERT INTO users(id,org_id,email,role,created_at) VALUES ('duplicate-email',?,?,'admin',?)`).bind(actor.orgId, 'parity-admin@example.invalid', now) },
    // Keep (id, org_id) and email distinct so only the logical primary key collides.
    { subtype: 'primary_key', statement: db.prepare(`INSERT INTO users(id,org_id,email,role,created_at) VALUES (?,?,'other-parity@example.invalid','admin',?)`).bind(actor.userId, 'parity-pk-other-org', now) },
    { subtype: 'primary_key', statement: db.prepare(`INSERT INTO counseling_memory_history(id,org_id,support_case_id,revision,item_json) VALUES ('history',?,'synthetic-case',1,'{}')`).bind(actor.orgId) },
    { subtype: 'foreign_key', statement: db.prepare(`INSERT INTO counseling_memory_cases(support_case_id,org_id) VALUES ('missing-support-case',?)`).bind(actor.orgId) },
    { subtype: 'check', statement: db.prepare(`INSERT INTO counseling_memory_settings(org_id,enabled) VALUES ('bad-check',2)`) },
    { subtype: 'trigger', code: 'invite_token_already_used', statement: db.prepare(`UPDATE invite_tokens SET status='used' WHERE token='used-token'`) },
    { subtype: 'trigger', code: 'stale_draft_version', statement: db.prepare(`INSERT INTO ai_draft_versions(id,work_item_id,version,summary_text,questions_json,origin,creation_mode,grounding_status,
      source_snapshot_id,source_snapshot_hash,consent_evidence_id,provider_config_id,model_id,prompt_version,schema_version,created_by,created_at)
      VALUES ('bad-draft','missing-work',2,'synthetic','["first","second"]','generated','provider_generated','grounded',
      'missing-snapshot',?,'missing-consent','missing-provider','synthetic','v1','v1',?,?)`).bind('a'.repeat(64), actor.userId, now) },
    { subtype: 'trigger', code: 'participant_schema_violation', statement: db.prepare(`INSERT INTO participant_consent_records(id,org_id,beneficiary_id,support_case_id,consent_recording_at,recorded_by,created_at)
      VALUES ('bad-consent',?,'missing-beneficiary','missing-case',?,?,?)`).bind(actor.orgId, now, actor.userId, now) },
  ];
  const errors = [];
  for (const [index, failure] of failures.entries()) {
    const marker = `rollback-${index}`;
    const before = await observableState(db);
    const error = await rejection(db.batch([
      db.prepare('INSERT INTO counseling_memory_guards(id,org_id,ok) VALUES (?,?,1)').bind(marker, actor.orgId),
      failure.statement,
      db.prepare(`INSERT INTO audit_log(org_id,actor_id,actor_role,action,target_table,target_id,created_at) VALUES (?,?,'admin','must_rollback','fixture',?,?)`).bind(actor.orgId, actor.userId, marker, now),
    ]));
    expect(error).toEqual({ kind: 'constraint', constraintSubtype: failure.subtype,
      ...(failure.code === undefined ? {} : { applicationCode: failure.code }) });
    expect(await observableState(db)).toEqual(before);
    errors.push(error);
  }
  const semantics = await dialectSemantics(fixture);
  return { saved, reread, businessAudit: businessAudit.results, matching: matching.map(({ success, results, meta }) => ({ success, results, changes: meta.changes })), mismatched: mismatched.map(({ success, results, meta }) => ({ success, results, changes: meta.changes })), errors, semantics, state: await observableState(db) };
}
async function observableState(db: Database) {
  const settings = (await db.prepare('SELECT org_id,enabled,version FROM counseling_memory_settings ORDER BY org_id').all()).results;
  const guards = (await db.prepare('SELECT id,org_id,ok FROM counseling_memory_guards ORDER BY id').all()).results;
  // Auto-increment/sequence gaps after rollback are not a portable business value.
  const audit = (await db.prepare('SELECT org_id,actor_id,actor_role,action,target_table,target_id,detail,created_at FROM audit_log ORDER BY created_at,id').all()).results;
  return { settings, guards, audit };
}

describe('S1 three-profile observable gateway parity', () => {
  it('persists, re-reads, audits and rolls back identical business operations on all three real engines', async () => {
    const results = [];
    for (const profile of ['d1', 'sqlite', 'postgres'] as const) {
      const fixture = await openParityDatabase(profile, harness);
      try {
        for (const checkpoint of checkpointSources()) await fixture.apply(profile === 'postgres' ? checkpoint.postgres : checkpoint.sqlite);
        // Freeze only the business operation. Miniflare validates compatibility
        // against today's date while provisioning, before the fixture's old clock.
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date(now));
        results.push(await businessFixture(fixture));
      } finally {
        vi.useRealTimers();
        await fixture.dispose();
      }
    }
    const [normalizedD1Result, normalizedSqliteResult, normalizedPostgresResult] = results;
    expect(normalizedPostgresResult).toEqual(normalizedSqliteResult);
    expect(normalizedD1Result).toEqual(normalizedSqliteResult);
  }, 600_000);
});
