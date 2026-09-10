import { afterAll, beforeAll, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { createEnvironmentSecretStore } from '@ccc/secrets-env';
import { closeSupportCase, createBeneficiaryWithInitialSupportCase, createCounselingRecord, createOrganizationSettings, resolveDirectoryActorByPrincipal, revokeActorSessions, revokeIdentitySession, type SupportCaseCreationResult, type Env, type Actor } from '@ccc/core/gateway';
import { startPostgresHarness, type PostgresHarness } from './support/postgres';
import { assertPostgresIdentityBoundary, type PostgresDatabase } from '@ccc/db-postgres';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import { PROGRAM_ADMISSION_COPY, PROGRAM_ADMISSION_COPY_VERSION } from '@ccc/contracts/program-admission';
import { registrationInput } from './support/registration';
let harness: PostgresHarness;
let admin: PostgresDatabase;
let api: PostgresDatabase;
let beforeMigrationRows: Array<{ org_id: string }>;
let caseA: SupportCaseCreationResult;
let caseB: SupportCaseCreationResult;

const actorA: Actor = { orgId: 'org-a', userId: 'actor-a', role: 'admin' };
const actorB: Actor = { orgId: 'org-b', userId: 'actor-b', role: 'admin' };
const contextA = { orgId: actorA.orgId, actorId: actorA.userId };
const contextB = { orgId: actorB.orgId, actorId: actorB.userId };
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function applyMigrationsThrough(name: string): Promise<void> {
  const directory = new URL('../../../migrations/postgres/', import.meta.url);
  for (const migrationName of readdirSync(directory).filter((entry) => entry.endsWith('.sql')).sort()) {
    await harness.applyMigration(admin, readFileSync(new URL(migrationName, directory), 'utf8'));
    if (migrationName === name) return;
  }
  throw new Error(`migration ${name} was not found`);
}

beforeAll(async () => {
  harness = await startPostgresHarness();
  admin = await harness.openDatabase();

  // A deliberately unprotected pre-migration fixture proves the red boundary
  // was real.  The migration later revokes this role's direct relation grant.
  await admin.prepare('CREATE ROLE ccc_before_probe NOLOGIN').run();
  await admin.prepare('CREATE ROLE anon NOLOGIN').run();
  await admin.prepare('CREATE ROLE authenticated NOLOGIN').run();
  await applyMigrationsThrough('0005_counseling_memory.sql');
  await admin.prepare('GRANT SELECT ON organization_settings TO ccc_before_probe, anon, authenticated').run();
  await admin.prepare('CREATE ROLE ccc_legacy_service NOLOGIN BYPASSRLS').run();
  await admin.prepare('GRANT USAGE ON SCHEMA public TO ccc_before_probe, ccc_legacy_service').run();
  await admin.prepare('GRANT SELECT ON organization_settings TO ccc_legacy_service').run();
  await admin.prepare('GRANT SELECT (time_zone) ON organization_settings TO ccc_legacy_service').run();
  await admin.prepare('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ccc_legacy_service').run();
  await admin.prepare('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ccc_legacy_service').run();
  await admin.prepare(
    `INSERT INTO organization_settings(org_id,time_zone,pii_purge_grace_days,version)
     VALUES ('org-a','UTC',365,1),('org-b','UTC',365,1)`,
  ).run();
  const before = await admin.batch([
    admin.prepare('SET LOCAL ROLE ccc_before_probe'),
    admin.prepare('SELECT org_id FROM organization_settings ORDER BY org_id'),
  ]);
  beforeMigrationRows = before[1]!.results as Array<{ org_id: string }>;
  const directory = new URL('../../../migrations/postgres/', import.meta.url);
  for (const name of readdirSync(directory).filter(name => name.endsWith('.sql') && name >= '0006_rls_default_deny.sql').sort()) {
    await harness.applyMigration(admin, readFileSync(new URL(name, directory), 'utf8'));
  }
  const copyHash = await sha256Hex(canonicalizeJcs(PROGRAM_ADMISSION_COPY));
  const installationConfigHash = await sha256Hex(canonicalizeJcs({
    deploymentMode: 'community-cloud',
    sttMode: 'off',
    llmMode: 'off',
  }));
  await admin.prepare(
    `UPDATE programs
     SET storage_mode = 'supabase_seoul', processing_mode = 'external_allowed',
         admission_confirmed_by = CASE org_id WHEN 'org-a' THEN 'actor-a' ELSE 'actor-b' END,
         admission_confirmed_at = '2026-09-08T00:00:00.000Z',
         admission_confirmed_storage_mode = 'supabase_seoul',
         admission_confirmed_processing_mode = 'external_allowed',
         admission_copy_version = ?, admission_copy_hash = ?,
         admission_installation_config_hash = ?,
         admission_installation_policy_version = 1
     WHERE org_id IN ('org-a', 'org-b')`,
  ).bind(PROGRAM_ADMISSION_COPY_VERSION, copyHash, installationConfigHash).run();
  await admin.prepare(
    `INSERT INTO users(id,org_id,email,role,active,created_at)
     VALUES ('actor-a','org-a','actor-a@example.invalid','admin',1,'2026-09-08T00:00:00.000Z'),
            ('actor-b','org-b','actor-b@example.invalid','admin',1,'2026-09-08T00:00:00.000Z'),
            ('actor-c','org-c','actor-c@example.invalid','admin',1,'2026-09-08T00:00:00.000Z')`,
  ).run();
  await admin.prepare(
    `INSERT INTO user_role_assignments(id,org_id,user_id,role,source,granted_by,granted_at)
     VALUES ('actor-a-practitioner','org-a','actor-a','practitioner','manual','actor-a','2026-09-08T00:00:00.000Z'),
            ('actor-b-practitioner','org-b','actor-b','practitioner','manual','actor-b','2026-09-08T00:00:00.000Z')`,
  ).run();
  api = await harness.openApiDatabase(admin, 2);
  for (const actor of [actorA, actorB]) {
    const env: Env = {
      DB: api.forActor({ orgId: actor.orgId, actorId: actor.userId }),
      installationMode: 'community-cloud',
      secretStore: createEnvironmentSecretStore({}),
    };
    const created = await createBeneficiaryWithInitialSupportCase(env, actor, await registrationInput(env, actor, {
      programId: `legacy-program:${actor.orgId}`,
      initialAssigneeUserId: actor.userId,
      intakeAt: null,
    }));
    if (actor === actorA) caseA = created;
    else caseB = created;
    const session = await createCounselingRecord(env, actor, created.supportCaseId, {
      submissionId: crypto.randomUUID(), heldAt: '2026-09-08T00:00:00.000Z',
      channel: 'in_person', memo: 'Synthetic RLS fixture', gasScores: [], actionItems: [], flags: [],
    });
    await admin.prepare(`INSERT INTO ner_release_qualification_receipts
      (id,org_id,model_id,model_revision,label_set_hash,corpus_hash,result_hash,validated_at,expires_at,status,created_at)
      VALUES (?,?,'synthetic','v1',?,?,?,'2026-09-08T00:00:00.000Z','2027-09-08T00:00:00.000Z','passed','2026-09-08T00:00:00.000Z')`)
      .bind(`receipt-${actor.orgId}`, actor.orgId, 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64)).run();
    await admin.prepare(
      `INSERT INTO ai_text_work_queue(
         id,org_id,support_case_id,session_id,reason,status,enqueued_at
       ) VALUES (?,?,?,?,'manual_record','pending','2026-09-08T00:00:00.000Z')`,
    ).bind(`text-work-${actor.orgId}`, actor.orgId, created.supportCaseId, session.record.id).run();
    await admin.prepare(
      `INSERT INTO agent_jobs(
         id,org_id,support_case_id,session_id,source_text_work_item_id,
         kind,state,enqueued_at,required_consent,attempt,updated_at
       ) VALUES (?,?,?,?,?,'text','pending','2026-09-08T00:00:00.000Z','[]',0,'2026-09-08T00:00:00.000Z')`,
    ).bind(
      actor === actorA ? 'job-a' : 'job-b',
      actor.orgId,
      created.supportCaseId,
      session.record.id,
      `text-work-${actor.orgId}`,
    ).run();
    await admin.prepare(`UPDATE agent_jobs SET state='leased',attempt=1,lease_owner='synthetic-agent',
      claim_token_hash=?,claimed_at='2026-09-08T00:00:00.000Z',lease_expires_at='2027-09-08T00:00:00.000Z',
      ner_attestation_id='synthetic',ner_model_id='synthetic',ner_model_revision='v1',
      ner_label_set_hash=?,ner_corpus_hash=?,ner_attestation_result_hash=?,
      ner_attestation_validated_at='2026-09-08T00:00:00.000Z',ner_attestation_expires_at='2027-09-08T00:00:00.000Z',
      release_qualification_receipt_id=? WHERE org_id=?`)
      .bind('a'.repeat(64), 'a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), `receipt-${actor.orgId}`, actor.orgId).run();
  }
}, 240_000);

afterAll(async () => { await harness?.dispose(); });

it('demonstrates the old unprotected read before migration', () => {
  expect(beforeMigrationRows).toEqual([{ org_id: 'org-a' }, { org_id: 'org-b' }]);
});

it('denies anonymous and authenticated database roles', async () => {
  for (const role of ['anon', 'authenticated']) {
    await expect(admin.batch([
      admin.prepare(`SET LOCAL ROLE ${role}`),
      admin.prepare('SELECT org_id FROM organization_settings'),
    ])).rejects.toThrow();
  }
});
it('denies browser access to every application table and view', async () => {
  const relations = await admin.prepare(
    `SELECT n.nspname AS schema,c.relname AS name
     FROM pg_class AS c
     JOIN pg_namespace AS n ON n.oid = c.relnamespace
     WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m')`,
  ).all<{ schema: string; name: string }>();
  expect(relations.results).toContainEqual({ schema: 'public', name: 'participant_pii_vault' });
  for (const role of ['anon', 'authenticated']) {
    for (const relation of relations.results) {
      await expect(admin.batch([
        admin.prepare(`SET LOCAL ROLE ${role}`),
        admin.prepare(`SELECT * FROM "${relation.schema}"."${relation.name.replaceAll('"', '""')}" LIMIT 1`),
      ])).rejects.toThrow();
    }
  }
});

it('requires protected ownership and RLS for all API-visible business relations', async () => {
  const unprotected = await admin.prepare(
    `SELECT n.nspname AS schema,c.relname AS name
     FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m')
       AND (n.nspname='public' OR has_table_privilege('ccc_api',c.oid,'SELECT,INSERT,UPDATE,DELETE'))
       AND (c.relowner<>'ccc_schema_owner'::regrole
         OR (c.relkind IN ('r','p') AND NOT (c.relrowsecurity AND c.relforcerowsecurity))
         OR (c.relkind='v' AND NOT ('security_invoker=true'=ANY(COALESCE(c.reloptions,ARRAY[]::text[]))))
         OR (c.relkind='m' AND has_table_privilege('ccc_api',c.oid,'SELECT')))`,
  ).all();
  expect(unprotected.results).toEqual([]);
});

it('isolates a restricted API connection and denies context-free access', async () => {
  const unscoped = await api.prepare('SELECT org_id FROM organization_settings ORDER BY org_id').all();
  expect(unscoped.results).toEqual([]);

  const scopedA = api.forActor(contextA);
  const scopedB = api.forActor(contextB);
  const [rowsA, rowsB] = await Promise.all([
    scopedA.prepare('SELECT org_id FROM organization_settings ORDER BY org_id').all(),
    scopedB.prepare('SELECT org_id FROM organization_settings ORDER BY org_id').all(),
  ]);
  expect(rowsA.results).toEqual([{ org_id: 'org-a' }]);
  expect(rowsB.results).toEqual([{ org_id: 'org-b' }]);
});

it('enforces tenant scope for insert, update, delete, and memory guards', async () => {
  const scopedA = api.forActor(contextA);
  await expect(scopedA.prepare(
    `INSERT INTO organization_settings(org_id,time_zone,pii_purge_grace_days,version)
     VALUES ('org-b','UTC',365,1)`,
  ).run()).rejects.toThrow();

  const update = await scopedA.prepare("UPDATE organization_settings SET time_zone='Asia/Seoul'").run();
  const remove = await scopedA.prepare("DELETE FROM organization_settings WHERE org_id='org-b'").run();
  expect(update.meta.changes).toBe(1);
  expect(remove.meta.changes).toBe(0);
  expect(await admin.prepare('SELECT time_zone FROM organization_settings WHERE org_id=\'org-b\'').first())
    .toMatchObject({ time_zone: 'UTC' });

  await scopedA.prepare(
    "INSERT INTO counseling_memory_guards(id,ok,org_id) VALUES ('same-org-fence',1,'org-a')",
  ).run();
  await expect(scopedA.prepare(
    "INSERT INTO counseling_memory_guards(id,ok,org_id) VALUES ('cross-org-fence',1,'org-b')",
  ).run()).rejects.toThrow();
  expect((await scopedA.prepare('SELECT org_id FROM counseling_memory_guards').all()).results)
    .toEqual([{ org_id: 'org-a' }]);
});

it('scopes compatibility views and indirect child tables through protected parents', async () => {
  const scopedA = api.forActor(contextA);
  expect((await scopedA.prepare('SELECT org_id FROM cases ORDER BY org_id').all()).results)
    .toEqual([{ org_id: 'org-a' }]);
  expect((await scopedA.prepare('SELECT org_id FROM case_assignees ORDER BY org_id').all()).results)
    .toEqual([{ org_id: 'org-a' }]);

  // agent_job_result_acceptances has no org_id: its policy must follow the
  // agent_jobs parent rather than defaulting to an unscoped allow rule.
  await expect(scopedA.prepare(
    `INSERT INTO agent_job_result_acceptances(job_id,attempt,claim_token_hash,payload_sha256,accepted_at)
     VALUES ('job-b',1,repeat('a',64),repeat('b',64),'2026-09-08T00:00:00.000Z')`,
  ).run()).rejects.toThrow();
  for (const [context, jobId] of [[contextA, 'job-a'], [contextB, 'job-b']] as const) {
    await api.forActor(context).prepare(
      `INSERT INTO agent_job_result_acceptances(job_id,attempt,claim_token_hash,payload_sha256,accepted_at)
       VALUES (?,1,?,?,'2026-09-08T00:00:00.000Z')`,
    ).bind(jobId, 'a'.repeat(64), 'b'.repeat(64)).run();
  }
  expect((await scopedA.prepare('SELECT job_id FROM agent_job_result_acceptances').all()).results)
    .toEqual([{ job_id: 'job-a' }]);
});
it('reaches retention helpers through a restricted close-case gateway write', async () => {
  const env: Env = { DB: api.forActor(contextA), secretStore: createEnvironmentSecretStore({}) };
  const closed = await closeSupportCase(env, actorA, caseA.supportCaseId, 'retention helper witness');
  expect(closed.status).toBe('closed');
  const vault = await env.DB.prepare(
    'SELECT purge_due FROM participant_pii_vault WHERE beneficiary_id = ?',
  ).bind(caseA.beneficiaryId).first<{ purge_due: string | null }>();
  expect(vault?.purge_due).toBe(new Date(Date.parse(closed.closedAt!) + 365 * 86_400_000).toISOString());
});

it('performs a same-organization gateway write with an audit sequence row', async () => {
  const actor: Actor = { orgId: 'org-c', userId: 'actor-c', role: 'admin' };
  const env: Env = { DB: api.forActor({ orgId: actor.orgId, actorId: actor.userId }), secretStore: createEnvironmentSecretStore({}) };
  await createOrganizationSettings(env, actor, { timeZone: 'UTC', piiPurgeGraceDays: 365 });
  const settings = await env.DB.prepare('SELECT org_id FROM organization_settings').all();
  const audits = await env.DB.prepare(
    "SELECT org_id,actor_id,action FROM audit_log WHERE org_id='org-c' ORDER BY id",
  ).all();
  expect(settings.results).toEqual([{ org_id: 'org-c' }]);
  expect(audits.results).toEqual([{ org_id: 'org-c', actor_id: 'actor-c', action: 'create' }]);
});

it('keeps audit allocation global across organizations and blocks escalation', async () => {
  const scopedA = api.forActor(contextA);
  const scopedB = api.forActor(contextB);
  await scopedA.prepare(
    `INSERT INTO audit_log(org_id,actor_id,actor_role,action,target_table,created_at)
     VALUES ('org-a','actor-a','admin','rls_allocator_probe','users','2026-09-08T00:00:00.000Z')`,
  ).run();
  await scopedB.prepare(
    `INSERT INTO audit_log(org_id,actor_id,actor_role,action,target_table,created_at)
     VALUES ('org-b','actor-b','admin','rls_allocator_probe','users','2026-09-08T00:00:00.000Z')`,
  ).run();
  const ids = await admin.prepare(
    "SELECT id FROM audit_log WHERE action='rls_allocator_probe' ORDER BY id",
  ).all<{ id: number }>();
  expect(ids.results).toHaveLength(2);
  expect(ids.results[0]!.id).not.toBe(ids.results[1]!.id);
  await expect(scopedA.prepare('SET ROLE ccc_schema_owner').run()).rejects.toThrow();
  await expect(scopedA.prepare('CREATE TABLE ccc_escalation_probe(id integer)').run()).rejects.toThrow();
  await expect(scopedA.prepare('DELETE FROM audit_log WHERE org_id=\'org-a\'').run()).rejects.toThrow();
});
it('bounds actor revocations by tenant and permits write-only session revocation', async () => {
  const scopedA = api.forActor(contextA);
  const scopedB = api.forActor(contextB);
  const envA: Env = { DB: scopedA, secretStore: createEnvironmentSecretStore({}) };
  const authn = { source: 'cloudflare-access', assurance: 'none', sessionId: null } as const;

  const before = await resolveDirectoryActorByPrincipal(envA, 'actor-a@example.invalid', authn, '2000-01-01T00:00:00.000Z');
  expect(before?.userId).toBe('actor-a');
  await revokeActorSessions(envA, 'actor-a', 'admin-disable');
  await expect(scopedA.prepare(
    `INSERT INTO auth_revocations(id,kind,subject,revoked_at,reason)
     VALUES ('cross-org-actor-revocation','actor','actor-b','2026-09-08T00:00:00.000Z','admin-disable')`,
  ).run()).rejects.toThrow();
  await revokeIdentitySession(envA, 'opaque-session-a', 'logout');

  expect((await scopedA.prepare(
    "SELECT kind,subject FROM auth_revocations ORDER BY kind,subject",
  ).all()).results).toEqual([{ kind: 'actor', subject: 'actor-a' }]);
  expect((await scopedB.prepare('SELECT kind,subject FROM auth_revocations').all()).results).toEqual([]);
  expect((await admin.prepare(
    "SELECT kind,subject FROM auth_revocations WHERE subject='opaque-session-a'",
  ).all()).results).toEqual([{ kind: 'session', subject: 'opaque-session-a' }]);
  expect((await resolveDirectoryActorByPrincipal(envA, 'actor-a@example.invalid', authn, '2000-01-01T00:00:00.000Z')))
    .toBeNull();
  await expect(scopedA.prepare("UPDATE auth_revocations SET reason='logout'").run()).rejects.toThrow();
  await expect(scopedA.prepare("DELETE FROM auth_revocations WHERE kind='actor'").run()).rejects.toThrow();
});

it('limits session revocation reads to verified transaction context and clears it before pool reuse', async () => {
  await assertPostgresIdentityBoundary(api);
  await expect(assertPostgresIdentityBoundary(admin)).rejects.toThrow();
  const single = await harness.openApiDatabase(admin, 1);
  try {
    const current = single.forActor({ ...contextB, sessionId: 'verified-current-session' });
    const env: Env = { DB: current, secretStore: createEnvironmentSecretStore({}) };
    await revokeIdentitySession(env, 'verified-current-session', 'logout');
    await revokeIdentitySession(env, 'different-session', 'logout');
    expect((await current.prepare("SELECT subject FROM auth_revocations WHERE kind = 'session'").all()).results)
      .toEqual([{ subject: 'verified-current-session' }]);
    expect((await single.forActor(contextB).prepare("SELECT subject FROM auth_revocations WHERE kind = 'session'").all()).results)
      .toEqual([]);
    expect((await single.prepare("SELECT subject FROM auth_revocations WHERE kind = 'session'").all()).results)
      .toEqual([]);
  } finally {
    await single.close();
  }
});

it('registers different organizations without global participant reads or duplicate pseudonyms', async () => {
  expect(caseA.beneficiaryId).not.toBe(caseB.beneficiaryId);
  expect((await api.forActor(contextA).prepare('SELECT id FROM beneficiaries').all()).results)
    .toEqual([{ id: caseA.beneficiaryId }]);
  expect((await api.forActor(contextB).prepare('SELECT id FROM beneficiaries').all()).results)
    .toEqual([{ id: caseB.beneficiaryId }]);
});

it('does not restore browser execution on newly created helpers', async () => {
  for (const role of ['ccc_contract', 'ccc_schema_owner']) {
    await admin.batch([
      admin.prepare(`SET LOCAL ROLE ${role}`),
      admin.prepare("CREATE FUNCTION public.ccc_default_acl_probe() RETURNS integer LANGUAGE sql AS 'SELECT 1'"),
      admin.prepare('CREATE TABLE public.ccc_default_acl_table(id integer)'),
    ]);
    try {
      for (const browserRole of ['anon', 'authenticated', 'ccc_legacy_service']) {
        const allowed = await admin.prepare("SELECT has_function_privilege(?, 'public.ccc_default_acl_probe()', 'EXECUTE') AS allowed")
          .bind(browserRole).first('allowed');
        expect(allowed).toBe(0);
        expect(await admin.prepare("SELECT has_table_privilege(?, 'public.ccc_default_acl_table', 'SELECT') AS allowed")
          .bind(browserRole).first('allowed')).toBe(0);
      }
    } finally {
      await admin.prepare('DROP FUNCTION public.ccc_default_acl_probe()').run();
      await admin.prepare('DROP TABLE public.ccc_default_acl_table').run();
    }
  }
});

it('removes inherited legacy grants even when a service role bypasses RLS', async () => {
  for (const role of ['ccc_before_probe', 'ccc_legacy_service']) {
    expect(await admin.prepare("SELECT has_table_privilege(?, 'organization_settings', 'SELECT') AS allowed")
      .bind(role).first('allowed')).toBe(0);
    expect(await admin.prepare("SELECT has_column_privilege(?, 'organization_settings', 'time_zone', 'SELECT') AS allowed")
      .bind(role).first('allowed')).toBe(0);
    await expect(admin.batch([
      admin.prepare(`SET LOCAL ROLE ${role}`),
      admin.prepare('SELECT org_id FROM organization_settings'),
    ])).rejects.toThrow();
  }
});

it('installs through a non-superuser schema owner with CREATEROLE', async () => {
  const isolated = await startPostgresHarness();
  try {
    const fixture = await isolated.openDatabase();
    await fixture.prepare('CREATE ROLE anon NOLOGIN').run();
    await fixture.prepare('CREATE ROLE authenticated NOLOGIN').run();
    await fixture.prepare('CREATE ROLE ccc_installer NOLOGIN NOSUPERUSER CREATEROLE INHERIT').run();
    await fixture.prepare('ALTER SCHEMA public OWNER TO ccc_installer').run();
    const directory = new URL('../../../migrations/postgres/', import.meta.url);
    for (const name of readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
      await isolated.applyMigration(fixture, `SET LOCAL ROLE ccc_installer;\n${readFileSync(new URL(name, directory), 'utf8')}`);
    }
    const identity = await fixture.batch([
      fixture.prepare('SET LOCAL ROLE ccc_installer'),
      fixture.prepare('SELECT rolsuper FROM pg_roles WHERE rolname=current_user'),
    ]);
    expect(identity[1]!.results).toEqual([{ rolsuper: 0 }]);
    for (const role of ['anon', 'authenticated']) {
      expect(await fixture.prepare("SELECT has_schema_privilege(?, 'public', 'USAGE') AS allowed").bind(role).first('allowed')).toBe(0);
      await expect(fixture.batch([
        fixture.prepare(`SET LOCAL ROLE ${role}`),
        fixture.prepare('SELECT * FROM organization_settings'),
      ])).rejects.toThrow();
    }
    const restricted = await isolated.openApiDatabase(fixture, 1);
    const db = restricted.forActor({ orgId: 'installer-proof', actorId: 'installer-actor' });
    await db.prepare("INSERT INTO organization_settings(org_id,time_zone,pii_purge_grace_days) VALUES('installer-proof','UTC',365)").run();
    expect((await db.prepare('SELECT org_id FROM organization_settings').all()).results)
      .toEqual([{ org_id: 'installer-proof' }]);
  } finally {
    await isolated.dispose();
  }
}, 240_000);

it.each([
  ['ccc_schema_owner', ''],
  ['ccc_api', ''],
  ['ccc_schema_owner', 'WITH ADMIN TRUE, INHERIT FALSE, SET FALSE'],
])('rejects an unexpected member of %s %s without repairing privileges', async (protectedRole, membershipOptions) => {
  const isolated = await startPostgresHarness();
  try {
    const fixture = await isolated.openDatabase();
    const directory = new URL('../../../migrations/postgres/', import.meta.url);
    for (const name of readdirSync(directory).filter(name => name.endsWith('.sql') && name < '0006').sort()) {
      await isolated.applyMigration(fixture, readFileSync(new URL(name, directory), 'utf8'));
    }
    await fixture.prepare(`CREATE ROLE ${protectedRole} ${protectedRole === 'ccc_api' ? 'LOGIN' : 'NOLOGIN'} NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB`).run();
    await fixture.prepare('CREATE ROLE ccc_untrusted NOLOGIN').run();
    await fixture.prepare(`GRANT ${protectedRole} TO ccc_untrusted ${membershipOptions}`).run();
    await expect(isolated.applyMigration(fixture, readFileSync(new URL('0006_rls_default_deny.sql', directory), 'utf8'))).rejects.toThrow();
    expect(await fixture.prepare("SELECT to_regclass('public.beneficiary_id_counters') AS relation").first('relation')).toBeNull();
    expect(await fixture.prepare("SELECT EXISTS (SELECT 1 FROM pg_auth_members WHERE roleid=?::regrole AND member='ccc_untrusted'::regrole) AS member")
      .bind(protectedRole).first('member')).toBe(1);
  } finally {
    await isolated.dispose();
  }
}, 240_000);

it('rejects installation without public-schema ownership atomically', async () => {
  const isolated = await startPostgresHarness();
  try {
    const fixture = await isolated.openDatabase();
    await fixture.prepare('CREATE ROLE ccc_installer NOLOGIN NOSUPERUSER CREATEROLE INHERIT').run();
    await fixture.prepare('GRANT USAGE, CREATE ON SCHEMA public TO ccc_installer WITH GRANT OPTION').run();
    const directory = new URL('../../../migrations/postgres/', import.meta.url);
    for (const name of readdirSync(directory).filter(name => name.endsWith('.sql') && name < '0006').sort()) {
      await isolated.applyMigration(fixture, `SET LOCAL ROLE ccc_installer;\n${readFileSync(new URL(name, directory), 'utf8')}`);
    }
    await expect(isolated.applyMigration(fixture,
      `SET LOCAL ROLE ccc_installer;\n${readFileSync(new URL('0006_rls_default_deny.sql', directory), 'utf8')}`)).rejects.toThrow();
    expect(await fixture.prepare("SELECT to_regclass('public.beneficiary_id_counters') AS relation").first('relation')).toBeNull();
  } finally {
    await isolated.dispose();
  }
}, 240_000);
