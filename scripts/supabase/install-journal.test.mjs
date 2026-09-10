import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';
import {
  applyJournaledMigration,
  bootstrapInstall,
  completeInstallStep,
  ensureAuthorization,
  readInstallState,
  readDatabaseInstallFingerprint,
  recordInstallFailure,
  recordInstallResource,
  startInstallStep,
  updateInstallPhase,
  withInstallLock,
} from './install-journal.mjs';

function disposableDatabaseUrl(value) {
  if (typeof value !== 'string' || value.length === 0) throw new Error('MISSING_DISPOSABLE_POSTGRES_FIXTURE');
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('INVALID_DISPOSABLE_POSTGRES_FIXTURE');
  }
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const localHost = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
  const testDatabaseName = /(^|[_-])(test|fixture|disposable)([_-]|$)/iu.test(databaseName);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !localHost || !testDatabaseName || parsed.search !== '' || parsed.hash !== ''
    || /(^|[_-])(prod|production)([_-]|$)/iu.test(databaseName)) {
    throw new Error('INVALID_DISPOSABLE_POSTGRES_FIXTURE');
  }
  return { databaseName, url: value };
}

const disposableDatabase = disposableDatabaseUrl(process.env.CCC_INSTALL_JOURNAL_TEST_DATABASE_URL);
const databaseUrl = disposableDatabase.url;
const databaseTest = test;
const hashes = Object.freeze({
  institution: '1'.repeat(64),
  project: '2'.repeat(64),
  owner: '3'.repeat(64),
  manifest: '4'.repeat(64),
  approval: '5'.repeat(64),
  configuration: '6'.repeat(64),
  resources: '7'.repeat(64),
  migrations: '8'.repeat(64),
  plan: '9'.repeat(64),
  state: 'a'.repeat(64),
  resourceId: 'b'.repeat(64),
  resource: 'c'.repeat(64),
});

const initialExpiresAt = new Date(Date.now() + 600_000).toISOString();

function authorization(overrides = {}) {
  return {
    installationId: 'installation-fixture-0001',
    institutionId: 'never-persist-institution',
    projectRef: 'never-persist-project',
    expectedOwnerOrgId: 'never-persist-owner',
    institutionIdHash: hashes.institution,
    projectRefHash: hashes.project,
    expectedOwnerOrgIdHash: hashes.owner,
    runtimeManifestSha256: hashes.manifest,
    approvalSha256: hashes.approval,
    runtimeConfigurationSha256: hashes.configuration,
    contractVersion: 'S11-install-approval-v1',
    runtimeSequence: 1,
    expiresAt: initialExpiresAt,
    ...overrides,
  };
}

function desired(overrides = {}) {
  return {
    resourcesSha256: hashes.resources,
    migrationsSha256: hashes.migrations,
    planFingerprint: hashes.plan,
    ...overrides,
  };
}

function migration(id, sql) {
  return { id, sql, checksum: createHash('sha256').update(sql, 'utf8').digest('hex') };
}

const providerStepKey = 'd'.repeat(64);
const authorizeFresh = async () => authorization();
function bootstrap(session, verified = authorization(), target = desired(), options = {}) {
  return bootstrapInstall(session, verified, target, {
    authorize: options.authorize ?? (async () => verified),
  });
}

function ensure(session, verified = authorization(), target = desired(), options = {}) {
  return ensureAuthorization(session, verified, target, {
    ...options,
    authorize: options.authorize ?? (async () => verified),
  });
}
async function privateSchemaExists(session) {
  const [{ exists }] = await session.unsafe(
    "SELECT to_regnamespace('private') IS NOT NULL AS exists",
  );
  return exists;
}

const fixtureCleanup = `DROP TABLE IF EXISTS
  public.ccc_install_journal_test_transaction_commit,
  public.ccc_install_journal_test_transaction_rollback,
  public.ccc_install_journal_test_rollback,
  public.ccc_install_journal_test_replay,
  public.ccc_install_journal_test_expiry,
  public.ccc_install_journal_test_revocation,
  public.ccc_install_journal_test_renewal,
  public.ccc_install_journal_test_drift CASCADE;
DROP TYPE IF EXISTS
  public.ccc_install_journal_test_enum,
  public.ccc_install_journal_test_domain,
  private.ccc_install_journal_test_composite,
  private.ccc_install_journal_test_range CASCADE`;

async function withDatabase(run) {
  const sql = postgres(databaseUrl, { max: 4, onnotice: () => {} });
  let admitted = false;
  try {
    const [safety] = await sql.unsafe(`SELECT
      current_database() AS database_name,
      to_regnamespace('private') IS NOT NULL OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend AS dependency
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = dependency.refobjid
        WHERE dependency.refclassid = 'pg_namespace'::regclass
          AND namespace.nspname = 'public'
      ) AS unsafe_objects`);
    if (safety.database_name !== disposableDatabase.databaseName || safety.unsafe_objects) {
      throw new Error('NONEMPTY_DISPOSABLE_POSTGRES_FIXTURE');
    }
    admitted = true;
    await run(sql);
  } finally {
    try {
      if (admitted) {
        await sql.unsafe(fixtureCleanup);
        await sql.unsafe('DROP SCHEMA IF EXISTS private CASCADE');
      }
    } finally {
      await sql.end();
    }
  }
}

databaseTest('project advisory lock is exclusive and is released after the callback', async () => {
  await withDatabase(async sql => {
    let release;
    const held = withInstallLock(sql, hashes.project, async () => new Promise(resolve => { release = resolve; }));
    while (release === undefined) await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(withInstallLock(sql, hashes.project, async () => {}), error => error.code === 'INSTALL_LOCK_BUSY');
    release();
    await held;
    assert.equal(await withInstallLock(sql, hashes.project, async () => 'released'), 'released');
  });
});

databaseTest('partial or foreign metadata is rejected instead of adopted', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      await session.unsafe('CREATE SCHEMA private; CREATE TABLE private.ccc_install_journal (foreign_value text)');
      await assert.rejects(
        readInstallState(session, authorization().installationId),
        error => error.code === 'INSTALL_JOURNAL_INVALID',
      );
      await assert.rejects(
        bootstrap(session, authorization(), desired()),
        error => error.code === 'EXISTING_PROJECT_NOT_CLEAN',
      );
    } finally {
      await session.release();
    }
  });
});

databaseTest('bootstrap is atomic, protected, and remains durable when a later migration rolls back', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      assert.equal(await readInstallState(session, authorization().installationId), null);
      await bootstrap(session, authorization(), desired());
      const initialFingerprint = (await readInstallState(session, authorization().installationId)).journal.databaseFingerprint;
      const [{ exposed }] = await session.unsafe(`SELECT count(*)::integer AS exposed
        FROM information_schema.table_privileges
        WHERE table_schema = 'private' AND grantee IN ('PUBLIC','anon','authenticated','ccc_api')`);
      assert.equal(exposed, 0);
      const broken = migration('0001_broken.sql', 'CREATE TABLE public.ccc_install_journal_test_rollback (id integer); SELECT missing_column FROM public.ccc_install_journal_test_rollback;');
      await assert.rejects(
        applyJournaledMigration(session, authorization(), broken, { authorize: async () => authorization() }),
        error => error.code === 'MIGRATION_APPLY_FAILED',
      );
      const state = await readInstallState(session, authorization().installationId);
      assert.equal(state.journal.phase, 'installing');
      assert.equal(state.journal.currentStep, 'baseline');
      assert.equal(state.journal.lastErrorCode, 'MIGRATION_APPLY_FAILED');
      assert.deepEqual(state.migrations, []);
      assert.deepEqual(state.completedSteps, []);
      const [{ exists }] = await session.unsafe("SELECT to_regclass('public.ccc_install_journal_test_rollback') IS NOT NULL AS exists");
      assert.equal(exists, false);
      assert.equal(state.currentReceipt, null);
      assert.deepEqual(state.releaseHistory, []);
      assert.equal(state.journal.databaseFingerprint, initialFingerprint);
    } finally {
      await session.release();
    }
  });
});

for (const transactionCommand of ['COMMIT', 'ROLLBACK']) {
  databaseTest(`migration source cannot ${transactionCommand} outside its journal transaction`, async () => {
    await withDatabase(async sql => {
      const session = await sql.reserve();
      try {
        await bootstrap(session, authorization(), desired());
        const tableName = `ccc_install_journal_test_transaction_${transactionCommand.toLowerCase()}`;
        const source = `CREATE TABLE public.${tableName} (id integer); INSERT INTO public.${tableName} VALUES (1); ${transactionCommand}; INSERT INTO public.${tableName} VALUES (2);`;
        await assert.rejects(
          applyJournaledMigration(
            session,
            authorization(),
            migration(`0002_transaction_${transactionCommand.toLowerCase()}.sql`, source),
            { authorize: authorizeFresh },
          ),
          error => error.code === 'MIGRATION_APPLY_FAILED',
        );
        const state = await readInstallState(session, authorization().installationId);
        const [{ exists }] = await session.unsafe(
          'SELECT to_regclass($1) IS NOT NULL AS exists',
          [`public.${tableName}`],
        );
        assert.equal(exists, false);
        assert.deepEqual(state.migrations, []);
        assert.deepEqual(state.completedSteps, []);
      } finally {
        await session.release();
      }
    });
  });
}

databaseTest('a committed migration receipt prevents replay and checksum drift', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      await bootstrap(session, authorization(), desired());
      const before = (await readInstallState(session, authorization().installationId)).journal.databaseFingerprint;
      const item = migration('0001_baseline.sql', 'CREATE TABLE public.ccc_install_journal_test_replay (id integer PRIMARY KEY); INSERT INTO public.ccc_install_journal_test_replay VALUES (1); UPDATE public.ccc_install_journal_test_replay SET id = 2 WHERE id = 1; SELECT id FROM public.ccc_install_journal_test_replay;');
      assert.deepEqual(
        await applyJournaledMigration(session, authorization(), item, { authorize: async () => authorization() }),
        { applied: true },
      );
      assert.deepEqual(
        await applyJournaledMigration(session, authorization(), item, { authorize: async () => authorization() }),
        { applied: false },
      );
      const [{ id }] = await session.unsafe('SELECT id FROM public.ccc_install_journal_test_replay');
      assert.equal(id, 2);
      const after = (await readInstallState(session, authorization().installationId)).journal.databaseFingerprint;
      assert.notEqual(after, before);
      assert.equal(after, await readDatabaseInstallFingerprint(session));
      await assert.rejects(
        session.unsafe("UPDATE private.ccc_schema_migrations SET checksum = '0' || substr(checksum, 2)"),
      );
      await assert.rejects(
        applyJournaledMigration(
          session,
          authorization(),
          migration('0001_baseline.sql', 'SELECT 1;'),
          { authorize: authorizeFresh },
        ),
        error => error.code === 'MIGRATION_CHECKSUM_MISMATCH',
      );
    } finally {
      await session.release();
    }
  });
});

databaseTest('catalog fingerprint covers both schemas and standalone user types without observer identity', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      await bootstrap(session, authorization(), desired());
      const stored = (await readInstallState(session, authorization().installationId)).journal.databaseFingerprint;

      await session.unsafe(`CREATE TYPE public.ccc_install_journal_test_enum AS ENUM ('first','second');
        CREATE DOMAIN public.ccc_install_journal_test_domain AS text CHECK (VALUE <> '')`);
      const publicTypes = await readDatabaseInstallFingerprint(session);
      assert.notEqual(publicTypes, stored);

      await session.unsafe(`CREATE TYPE private.ccc_install_journal_test_composite AS (id integer, label text);
        CREATE TYPE private.ccc_install_journal_test_range AS RANGE (subtype = integer);
        CREATE FUNCTION private.ccc_install_journal_test_sum_state(state integer, value integer)
          RETURNS integer LANGUAGE sql IMMUTABLE AS 'SELECT state + value';
        CREATE AGGREGATE private.ccc_install_journal_test_sum(integer) (
          SFUNC = private.ccc_install_journal_test_sum_state,
          STYPE = integer,
          INITCOND = '0'
        )`);
      const privateDefinitions = await readDatabaseInstallFingerprint(session);
      assert.notEqual(privateDefinitions, publicTypes);
      await session.unsafe('CREATE COLLATION private.ccc_install_journal_test_collation FROM pg_catalog."C"');
      const collationDefinition = await readDatabaseInstallFingerprint(session);
      assert.notEqual(collationDefinition, privateDefinitions);
      await session.unsafe(`CREATE OPERATOR private.=== (
        LEFTARG = integer,
        RIGHTARG = integer,
        FUNCTION = pg_catalog.int4eq
      )`);
      const namespaceDefinitions = await readDatabaseInstallFingerprint(session);
      assert.notEqual(namespaceDefinitions, collationDefinition);

      await session.unsafe('BEGIN');
      try {
        const privileged = await readDatabaseInstallFingerprint(session);
        await session.unsafe('SET LOCAL ROLE pg_monitor');
        assert.equal(await readDatabaseInstallFingerprint(session), privileged);
      } finally {
        await session.unsafe('ROLLBACK');
      }

      await session.unsafe('GRANT USAGE ON SCHEMA private TO PUBLIC');
      const schemaAcl = await readDatabaseInstallFingerprint(session);
      assert.notEqual(schemaAcl, namespaceDefinitions);
      await session.unsafe(`ALTER TABLE private.ccc_install_authorizations
        DISABLE TRIGGER ccc_install_authorizations_no_change`);
      assert.notEqual(await readDatabaseInstallFingerprint(session), schemaAcl);
      await session.unsafe(`ALTER TABLE private.ccc_install_authorizations
        ENABLE TRIGGER ccc_install_authorizations_no_change`);
      assert.equal(await readDatabaseInstallFingerprint(session), schemaAcl);
      assert.equal((await readInstallState(session, authorization().installationId)).journal.databaseFingerprint, stored);
      await assert.rejects(applyJournaledMigration(
        session, authorization(),
        migration('0002_after_drift.sql', 'CREATE TABLE public.ccc_install_journal_test_drift (id integer)'),
        { authorize: authorizeFresh },
      ), error => error.code === 'DRIFT_BLOCKED');
      assert.equal((await readInstallState(session, authorization().installationId)).migrations.length, 0);
    } finally {
      await session.release();
    }
  });
});

databaseTest('foreign ownership and authorization hash drift are refused without adoption', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      await bootstrap(session, authorization(), desired());
      await assert.rejects(
        ensure(session, authorization({ installationId: 'installation-foreign-0002' }), desired()),
        error => error.code === 'RESOURCE_OWNERSHIP_MISMATCH',
      );
      await assert.rejects(
        ensure(session, authorization({ runtimeManifestSha256: 'e'.repeat(64) }), desired()),
        error => error.code === 'INSTALL_AUTHORIZATION_MISMATCH',
      );
      await assert.rejects(
        recordInstallResource(session, authorization(), {
          resourceType: 'storage_bucket', resourceIdHash: hashes.resourceId,
          resourceDigest: hashes.resource, ownershipTag: 'ccc.installation_id=installation-foreign-0002',
        }, { authorize: authorizeFresh }),
        error => error.code === 'RESOURCE_OWNERSHIP_MISMATCH',
      );
    } finally {
      await session.release();
    }
  });
});

databaseTest('bootstrap requires a fresh matching pair and rolls back withdrawn authorization', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      const initial = authorization();
      await assert.rejects(
        bootstrapInstall(session, initial, desired()),
        error => error.code === 'OWNER_EVIDENCE_MISSING',
      );
      assert.equal(await privateSchemaExists(session), false);

      const revoked = Object.assign(new Error('OWNER_EVIDENCE_MISSING'), {
        code: 'OWNER_EVIDENCE_MISSING',
      });
      for (const [expectedCode, withdrawn] of [
        ['OWNER_EVIDENCE_MISSING', authorization({ expiresAt: new Date(0).toISOString() })],
        ['INSTALL_AUTHORIZATION_MISMATCH', authorization({ approvalSha256: '0'.repeat(64) })],
        ['OWNER_EVIDENCE_MISSING', revoked],
      ]) {
        await assert.rejects(
          bootstrap(session, initial, desired(), {
            authorize: async () => {
              if (!await privateSchemaExists(session)) return initial;
              if (withdrawn instanceof Error) throw withdrawn;
              return withdrawn;
            },
          }),
          error => error.code === expectedCode,
        );
        assert.equal(await privateSchemaExists(session), false);
      }
    } finally {
      await session.release();
    }
  });
});

databaseTest('authorization renewal rolls back expiry, revocation, and pair changes before commit', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      const initial = authorization();
      await bootstrap(session, initial, desired());
      const renewed = authorization({
        runtimeManifestSha256: 'e'.repeat(64),
        approvalSha256: 'f'.repeat(64),
        runtimeSequence: 2,
        expiresAt: new Date(Date.now() + 1_200_000).toISOString(),
      });
      await assert.rejects(
        ensureAuthorization(session, renewed, desired(), { renewAuthorization: true }),
        error => error.code === 'OWNER_EVIDENCE_MISSING',
      );

      const revoked = Object.assign(new Error('OWNER_EVIDENCE_MISSING'), {
        code: 'OWNER_EVIDENCE_MISSING',
      });
      for (const [expectedCode, withdrawn] of [
        ['OWNER_EVIDENCE_MISSING', { ...renewed, expiresAt: new Date(0).toISOString() }],
        ['INSTALL_AUTHORIZATION_MISMATCH', { ...renewed, approvalSha256: '0'.repeat(64) }],
        ['OWNER_EVIDENCE_MISSING', revoked],
      ]) {
        await assert.rejects(
          ensure(session, renewed, desired(), {
            renewAuthorization: true,
            authorize: async () => {
              const state = await readInstallState(session, initial.installationId);
              if (state.journal.runtimeSequence === initial.runtimeSequence) return renewed;
              if (withdrawn instanceof Error) throw withdrawn;
              return withdrawn;
            },
          }),
          error => error.code === expectedCode,
        );
        const state = await readInstallState(session, initial.installationId);
        assert.equal(state.journal.runtimeSequence, initial.runtimeSequence);
        assert.deepEqual(state.authorizationHistory.map(item => item.runtimeSequence), [1]);
      }
    } finally {
      await session.release();
    }
  });
});

databaseTest('explicit renewal appends authorization history and preserves stable bindings', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      await bootstrap(session, authorization(), desired());
      await applyJournaledMigration(
        session,
        authorization(),
        migration('0001_renewal.sql', 'CREATE TABLE public.ccc_install_journal_test_renewal (id integer)'),
        { authorize: authorizeFresh },
      );
      await ensure(session, authorization(), desired());
      const renewed = authorization({
        runtimeManifestSha256: 'e'.repeat(64),
        approvalSha256: 'f'.repeat(64),
        runtimeSequence: 2,
        expiresAt: new Date(Date.now() + 1_200_000).toISOString(),
      });
      await session.unsafe(`UPDATE private.ccc_install_journal
        SET expires_at = clock_timestamp() - interval '1 second'
        WHERE installation_id = $1`, [renewed.installationId]);
      await ensure(session, renewed, desired(), { renewAuthorization: true });
      assert.deepEqual(
        await ensure(session, renewed, desired(), { renewAuthorization: true }),
        { renewed: false },
      );
      for (const mismatchedDesired of [
        desired({ resourcesSha256: '0'.repeat(64) }),
        desired({ migrationsSha256: '0'.repeat(64) }),
        desired({ planFingerprint: '0'.repeat(64) }),
      ]) {
        await assert.rejects(
          ensure(session, renewed, mismatchedDesired, { renewAuthorization: true }),
          error => error.code === 'INSTALL_AUTHORIZATION_MISMATCH',
        );
      }
      const state = await readInstallState(session, renewed.installationId);
      assert.equal(state.journal.runtimeSequence, 2);
      assert.equal(state.journal.planFingerprint, hashes.plan);
      assert.equal(state.authorizationHistory.length, 2);
      assert.deepEqual(state.authorizationHistory.map(item => item.runtimeSequence), [1, 2]);
      assert.equal(state.completedSteps.length, 1);
      await assert.rejects(
        ensure(session, { ...renewed, runtimeSequence: 3, runtimeConfigurationSha256: '0'.repeat(64) }, desired(), { renewAuthorization: true }),
        error => error.code === 'INSTALL_AUTHORIZATION_MISMATCH',
      );
      assert.equal((await readInstallState(session, renewed.installationId)).authorizationHistory.length, 2);
      await assert.rejects(
        session.unsafe('DELETE FROM private.ccc_install_authorizations'),
      );
    } finally {
      await session.release();
    }
  });
});

databaseTest('fresh authorization is checked before migration and again before commit', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      await bootstrap(session, authorization(), desired());
      const expiring = migration('0002_expiring.sql', 'CREATE TABLE public.ccc_install_journal_test_expiry (id integer);');
      await assert.rejects(
        applyJournaledMigration(session, authorization(), expiring, {
          authorize: async () => {
            const [{ changed }] = await session.unsafe("SELECT to_regclass('public.ccc_install_journal_test_expiry') IS NOT NULL AS changed");
            return changed ? authorization({ expiresAt: new Date(0).toISOString() }) : authorization();
          },
        }),
        error => error.code === 'OWNER_EVIDENCE_MISSING',
      );
      assert.equal((await readInstallState(session, authorization().installationId)).migrations.length, 0);

      const revoked = migration('0003_revoked.sql', 'CREATE TABLE public.ccc_install_journal_test_revocation (id integer);');
      await assert.rejects(
        applyJournaledMigration(session, authorization(), revoked, {
          authorize: async () => {
            const [{ changed }] = await session.unsafe("SELECT to_regclass('public.ccc_install_journal_test_revocation') IS NOT NULL AS changed");
            if (changed) throw Object.assign(new Error('OWNER_EVIDENCE_MISSING'), { code: 'OWNER_EVIDENCE_MISSING' });
            return authorization();
          },
        }),
        error => error.code === 'OWNER_EVIDENCE_MISSING',
      );
      const state = await readInstallState(session, authorization().installationId);
      assert.deepEqual(state.migrations, []);
      assert.deepEqual(state.completedSteps, []);
      const [{ expiryExists, revocationExists }] = await session.unsafe(`SELECT
        to_regclass('public.ccc_install_journal_test_expiry') IS NOT NULL AS "expiryExists",
        to_regclass('public.ccc_install_journal_test_revocation') IS NOT NULL AS "revocationExists"`);
      assert.equal(expiryExists, false);
      assert.equal(revocationExists, false);
    } finally {
      await session.release();
    }
  });
});

databaseTest('provider step primitives persist only hashes, ownership tag, and state fingerprint', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      await bootstrap(session, authorization(), desired());
      await updateInstallPhase(
        session, authorization(), { phase: 'installing', currentStep: 'storage_bucket' },
        { authorize: authorizeFresh },
      );
      await startInstallStep(session, authorization(), {
        step: 'storage_bucket', idempotencyKey: providerStepKey,
      }, { authorize: authorizeFresh });
      await recordInstallResource(session, authorization(), {
        resourceType: 'storage_bucket', resourceIdHash: hashes.resourceId,
        resourceDigest: hashes.resource,
        ownershipTag: `ccc.installation_id=${authorization().installationId}`,
      }, { authorize: authorizeFresh });
      await completeInstallStep(session, authorization(), {
        step: 'storage_bucket', idempotencyKey: providerStepKey,
        ownershipTags: [`ccc.installation_id=${authorization().installationId}`],
        providerResourceIdHashes: [hashes.resourceId], providerResourceDigests: [hashes.resource],
        stateFingerprint: hashes.state,
      }, { authorize: authorizeFresh });
      await recordInstallFailure(session, authorization(), {
        step: 'cron_job', code: 'PROVIDER_UNREADABLE', stateFingerprint: hashes.state,
      }, { authorize: authorizeFresh });
      const state = await readInstallState(session, authorization().installationId);
      assert.equal(state.journal.currentStep, 'cron_job');
      assert.equal(state.journal.lastErrorCode, 'PROVIDER_UNREADABLE');
      assert.equal(state.journal.stateFingerprint, hashes.state);
      assert.deepEqual(state.completedSteps[0].providerResourceIdHashes, [hashes.resourceId]);
      assert.equal(state.resources[0].ownershipTag, `ccc.installation_id=${authorization().installationId}`);
      assert.equal(JSON.stringify(state).includes('never-persist'), false);
    } finally {
      await session.release();
    }
  });
});

databaseTest('accepts the public S2 manifest sequence zero without changing its contract', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      const initial = authorization({ runtimeSequence: 0 });
      await bootstrap(session, initial, desired());
      assert.equal((await readInstallState(session, initial.installationId)).journal.runtimeSequence, 0);
    } finally {
      await session.release();
    }
  });
});
