import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import postgres from 'postgres';
import { INSTALLER_SESSION_TIMEOUTS } from './installer-connection.mjs';
import {
  applyJournaledMigration,
  bootstrapInstall,
  completeInstallStep,
  ensureAuthorization,
  readInstallState,
  readDatabaseInstallFingerprint,
  reconcileAuthConfigJournal,
  recordInstallFailure,
  recordInstallResource,
  startInstallStep,
  updateInstallPhase,
  withInstallLock,
} from './install-journal.mjs';
import { hashCanonical } from './manifest-preflight.mjs';

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

async function withBlockingTransaction(sql, acquire, run, waitForOperation) {
  const blocker = await sql.reserve();
  let transactionOpen = false;
  let failSafe;
  const rollback = async () => {
    if (!transactionOpen) return;
    try {
      await blocker.unsafe('ROLLBACK');
    } finally {
      transactionOpen = false;
    }
  };
  try {
    await blocker.unsafe('BEGIN');
    transactionOpen = true;
    await acquire(blocker);
    const operation = Promise.resolve().then(() => run(blocker));
    if (waitForOperation) await waitForOperation(blocker, operation);
    const escaped = new Promise(resolve => {
      failSafe = setTimeout(() => resolve(true), 10_000);
    });
    const completed = operation.then(() => false, () => false);
    if (await Promise.race([completed, escaped])) {
      await rollback();
      await operation.catch(() => {});
      throw new Error('SERVER_LOCK_TIMEOUT_MISSING');
    }
    return await operation;
  } finally {
    clearTimeout(failSafe);
    try {
      await rollback();
    } finally {
      await blocker.release();
    }
  }
}

async function observeBlockedMigrationRelation(session, attempt) {
  let settled = false;
  let failure;
  attempt.then(
    () => { settled = true; },
    error => { settled = true; failure = error; },
  );
  for (;;) {
    const [{ waiting }] = await session.unsafe(`SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_locks
      WHERE relation = 'public.ccc_install_journal_test_lock_target'::regclass
        AND mode = 'AccessExclusiveLock'
        AND NOT granted
        AND pid <> pg_backend_pid()
    ) AS waiting`);
    if (waiting) return;
    if (settled) {
      if (failure) throw failure;
      throw new Error('MIGRATION_DID_NOT_WAIT_FOR_RELATION_LOCK');
    }
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function assertAdvisoryLocksReleased(installerBackendPid) {
  assert.ok(Number.isInteger(installerBackendPid));
  const probe = postgres(databaseUrl, {
    max: 1,
    connection: INSTALLER_SESSION_TIMEOUTS,
    onnotice: () => {},
  });
  try {
    const [{ backend_exists, held }] = await probe.unsafe(`SELECT
      EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE pid = $1) AS backend_exists,
      (SELECT count(*)::integer FROM pg_catalog.pg_locks
        WHERE pid = $1 AND locktype = 'advisory' AND granted) AS held`, [installerBackendPid]);
    assert.equal(backend_exists, true);
    assert.equal(held, 0);
  } finally {
    await probe.end();
  }
}

const fixtureCleanup = `DROP TABLE IF EXISTS
  public.ccc_install_journal_test_reconcile,
  public.ccc_install_journal_test_transaction_commit,
  public.ccc_install_journal_test_transaction_rollback,
  public.ccc_install_journal_test_rollback,
  public.ccc_install_journal_test_replay,
  public.ccc_install_journal_test_expiry,
  public.ccc_install_journal_test_revocation,
  public.ccc_install_journal_test_renewal,
  public.ccc_install_journal_test_lock_target,
  public.ccc_install_journal_test_drift CASCADE;
DROP TYPE IF EXISTS
  public.ccc_install_journal_test_enum,
  public.ccc_install_journal_test_domain,
  public.ccc_install_journal_oid_type,
  private.ccc_install_journal_test_composite,
  private.ccc_install_journal_test_range CASCADE`;

async function withDatabase(run) {
  const sql = postgres(databaseUrl, {
    max: 4,
    connection: INSTALLER_SESSION_TIMEOUTS,
    onnotice: () => {},
  });
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

databaseTest('installer sessions enforce positive bounded server lock deadlines', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      const [settings] = await session.unsafe(`SELECT
        (extract(epoch FROM current_setting('lock_timeout')::interval) * 1000)::integer AS lock_timeout_ms,
        (extract(epoch FROM current_setting('statement_timeout')::interval) * 1000)::integer AS statement_timeout_ms`);
      assert.ok(settings.lock_timeout_ms > 0 && settings.lock_timeout_ms <= 5_000);
      assert.ok(settings.statement_timeout_ms > 0 && settings.statement_timeout_ms <= 60_000);
      assert.ok(settings.statement_timeout_ms > settings.lock_timeout_ms);
    } finally {
      await session.release();
    }
  });
});

databaseTest('a blocked journal row times out without mutation and releases the project lock', { timeout: 30_000 }, async () => {
  await withDatabase(async sql => {
    const setup = await sql.reserve();
    let before;
    try {
      await bootstrap(setup, authorization(), desired());
      before = await readInstallState(setup, authorization().installationId);
    } finally {
      await setup.release();
    }
    const renewed = authorization({
      runtimeManifestSha256: 'e'.repeat(64),
      approvalSha256: 'f'.repeat(64),
      runtimeSequence: 2,
      expiresAt: new Date(Date.now() + 1_200_000).toISOString(),
    });
    let installerBackendPid;
    await withBlockingTransaction(
      sql,
      async blocker => {
        const rows = await blocker.unsafe(
          'SELECT installation_id FROM private.ccc_install_journal WHERE installation_id = $1 FOR UPDATE',
          [authorization().installationId],
        );
        assert.equal(rows.length, 1);
      },
      () => assert.rejects(
        withInstallLock(sql, hashes.project, async session => {
          const [{ pid }] = await session.unsafe('SELECT pg_backend_pid() AS pid');
          installerBackendPid = pid;
          return ensure(
            session,
            renewed,
            desired(),
            { renewAuthorization: true },
          );
        }),
        error => error?.code === '55P03',
      ),
    );
    const observer = await sql.reserve();
    try {
      assert.deepEqual(await readInstallState(observer, authorization().installationId), before);
      const [journal] = await observer.unsafe(`SELECT
        runtime_sequence::integer AS runtime_sequence,
        runtime_manifest_sha256,
        approval_sha256
        FROM private.ccc_install_journal
        WHERE installation_id = $1`, [authorization().installationId]);
      const [{ authorization_count }] = await observer.unsafe(`SELECT count(*)::integer AS authorization_count
        FROM private.ccc_install_authorizations
        WHERE installation_id = $1`, [authorization().installationId]);
      assert.deepEqual(journal, {
        runtime_sequence: 1,
        runtime_manifest_sha256: hashes.manifest,
        approval_sha256: hashes.approval,
      });
      assert.equal(authorization_count, 1);
    } finally {
      await observer.release();
    }
    await assertAdvisoryLocksReleased(installerBackendPid);
  });
});

databaseTest('a blocked migration DDL times out without a receipt and releases the project lock', { timeout: 60_000 }, async () => {
  await withDatabase(async sql => {
    const setup = await sql.reserve();
    let before;
    try {
      await bootstrap(setup, authorization(), desired());
      await applyJournaledMigration(
        setup,
        authorization(),
        migration(
          '0001_lock_target.sql',
          'CREATE TABLE public.ccc_install_journal_test_lock_target (id integer PRIMARY KEY)',
        ),
        { authorize: authorizeFresh },
      );
      before = await readInstallState(setup, authorization().installationId);
    } finally {
      await setup.release();
    }
    let installerBackendPid;
    await withBlockingTransaction(
      sql,
      blocker => blocker.unsafe(
        'LOCK TABLE public.ccc_install_journal_test_lock_target IN ACCESS SHARE MODE',
      ),
      async () => {
        const attempt = withInstallLock(sql, hashes.project, async session => {
          const [{ pid }] = await session.unsafe('SELECT pg_backend_pid() AS pid');
          const [settings] = await session.unsafe(`SELECT
            (extract(epoch FROM current_setting('lock_timeout')::interval) * 1000)::integer AS lock_timeout_ms,
            (extract(epoch FROM current_setting('statement_timeout')::interval) * 1000)::integer AS statement_timeout_ms`);
          assert.ok(settings.lock_timeout_ms > 0 && settings.lock_timeout_ms <= 5_000);
          assert.ok(settings.statement_timeout_ms > settings.lock_timeout_ms
            && settings.statement_timeout_ms <= 60_000);
          installerBackendPid = pid;
          return applyJournaledMigration(
            session,
            authorization(),
            migration(
              '0002_lock_target.sql',
              'ALTER TABLE public.ccc_install_journal_test_lock_target ADD COLUMN blocked integer',
            ),
            { authorize: authorizeFresh },
          );
        });
        await assert.rejects(
          attempt,
          error => error?.code === 'MIGRATION_APPLY_FAILED',
        );
      },
      (blocker, operation) => observeBlockedMigrationRelation(blocker, operation),
    );
    const observer = await sql.reserve();
    try {
      const after = await readInstallState(observer, authorization().installationId);
      assert.equal(after.journal.currentStep, 'platform_migration');
      assert.equal(after.journal.lastErrorCode, 'MIGRATION_APPLY_FAILED');
      assert.deepEqual({
        ...after,
        journal: {
          ...after.journal,
          currentStep: before.journal.currentStep,
          lastErrorCode: before.journal.lastErrorCode,
          updatedAt: before.journal.updatedAt,
        },
      }, before);
      const [{ changed }] = await observer.unsafe(`SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'ccc_install_journal_test_lock_target'
          AND column_name = 'blocked'
      ) AS changed`);
      assert.equal(changed, false);
      const [{ receipt_count }] = await observer.unsafe(`SELECT count(*)::integer AS receipt_count
        FROM private.ccc_schema_migrations WHERE id = '0002_lock_target.sql'`);
      assert.equal(receipt_count, 0);
    } finally {
      await observer.release();
    }
    await assertAdvisoryLocksReleased(installerBackendPid);
  });
});

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

databaseTest('equivalent restored catalog keeps its fingerprint across new OIDs', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      await bootstrap(session, authorization(), desired());
      const createEquivalentCatalog = () => session.unsafe(`
        CREATE TYPE public.ccc_install_journal_oid_type AS ENUM ('first', 'second');
        CREATE FUNCTION public.ccc_install_journal_oid_identity(
          value public.ccc_install_journal_oid_type
        ) RETURNS public.ccc_install_journal_oid_type
        LANGUAGE sql IMMUTABLE AS 'SELECT value'
      `);
      await createEquivalentCatalog();
      const before = await readDatabaseInstallFingerprint(session);
      await session.unsafe(
        'DROP TYPE public.ccc_install_journal_oid_type CASCADE',
      );
      await createEquivalentCatalog();
      const after = await readDatabaseInstallFingerprint(session);
      assert.equal(after, before);
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

const reconciliationEvidence = Object.freeze({
  priorStateFingerprint: '1a'.repeat(32),
  currentStateFingerprint: '2b'.repeat(32),
  inviteTemplateSha256: '3c'.repeat(32),
});

const reconciliationTables = Object.freeze([
  'ccc_install_authorizations',
  'ccc_install_journal',
  'ccc_install_receipt',
  'ccc_install_resources',
  'ccc_install_steps',
  'ccc_release_history',
  'ccc_schema_migrations',
]);

const journalStableColumns = Object.freeze([
  'installation_id', 'institution_id_hash', 'project_ref_hash',
  'expected_owner_org_id_hash', 'runtime_configuration_sha256', 'contract_version',
  'resources_sha256', 'migrations_sha256', 'phase', 'current_step',
  'plan_fingerprint', 'database_fingerprint', 'last_error_code', 'created_at',
]);

async function snapshotTables(session) {
  const snapshot = {};
  for (const table of reconciliationTables) {
    const rows = await session.unsafe(
      `SELECT row_to_json(row) AS row FROM private.${table} AS row`,
    );
    snapshot[table] = rows.map(entry => JSON.stringify(entry.row)).sort();
  }
  return snapshot;
}

function assertTablesByteEqual(before, after) {
  for (const table of reconciliationTables) {
    assert.deepEqual(after[table], before[table], table);
  }
}

function assertRowsPreserved(before, after, added = {}) {
  for (const table of reconciliationTables) {
    if (table === 'ccc_install_journal') {
      assert.equal(after[table].length, before[table].length, table);
      continue;
    }
    const extra = [...after[table]];
    for (const row of before[table]) {
      const index = extra.indexOf(row);
      assert.notEqual(index, -1, `${table} lost or mutated a row`);
      extra.splice(index, 1);
    }
    assert.equal(extra.length, added[table] ?? 0, table);
  }
}

function assertJournalStableColumns(before, after) {
  const pick = row => Object.fromEntries(
    journalStableColumns.map(column => [
      column,
      column.endsWith('_at')
        ? new Date(row[column]).toISOString()
        : JSON.stringify(row[column] ?? null),
    ]),
  );
  assert.deepEqual(pick(after), pick(before));
}

async function insertReceiptRow(session, installationId, releaseSequence) {
  const row = {
    contract: 'S11',
    contractVersion: '0.3',
    institutionIdHash: hashes.institution,
    expectedOwnerOrgIdHash: hashes.owner,
    observedOwnerOrgIdHash: hashes.owner,
    releaseVersion: 'fixture-release',
    releaseSequence,
    manifestDigest: '7a'.repeat(32),
    artifactSetDigest: '8b'.repeat(32),
    migrationHead: '0001_reconcile.sql',
    schemaFingerprint: '9c'.repeat(32),
    edgeRegionEvidence: { region: 'fixture' },
    providerResourceDigests: [],
    status: 'installed',
  };
  for (const table of ['ccc_install_receipt', 'ccc_release_history']) {
    await session.unsafe(`INSERT INTO private.${table} (
      installation_id, contract, contract_version, institution_id_hash,
      expected_owner_org_id_hash, observed_owner_org_id_hash, release_version,
      release_sequence, manifest_digest, artifact_set_digest, migration_head,
      schema_fingerprint, edge_region_evidence, provider_resource_digests, status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, [
      installationId, row.contract, row.contractVersion, row.institutionIdHash,
      row.expectedOwnerOrgIdHash, row.observedOwnerOrgIdHash, row.releaseVersion,
      row.releaseSequence, row.manifestDigest, row.artifactSetDigest, row.migrationHead,
      row.schemaFingerprint, JSON.stringify(row.edgeRegionEvidence),
      JSON.stringify(row.providerResourceDigests), row.status,
    ]);
  }
}

async function installedAuthReconciliationFixture(session, overrides = {}) {
  const initial = authorization();
  await bootstrap(session, initial, desired());
  await applyJournaledMigration(
    session,
    initial,
    migration('0001_reconcile.sql', 'CREATE TABLE public.ccc_install_journal_test_reconcile (id integer)'),
    { authorize: authorizeFresh },
  );
  await recordInstallResource(session, initial, {
    resourceType: 'storage_bucket', resourceIdHash: hashes.resourceId,
    resourceDigest: hashes.resource,
    ownershipTag: `ccc.installation_id=${initial.installationId}`,
  }, { authorize: authorizeFresh });
  await updateInstallPhase(session, initial, {
    phase: 'installed', currentStep: null,
    stateFingerprint: reconciliationEvidence.priorStateFingerprint,
  }, { authorize: authorizeFresh });
  await insertReceiptRow(session, initial.installationId, 1);
  const renewed = authorization({
    runtimeManifestSha256: 'e'.repeat(64),
    approvalSha256: 'f'.repeat(64),
    runtimeSequence: 2,
    expiresAt: new Date(Date.now() + 1_200_000).toISOString(),
    ...overrides,
  });
  const evidence = { ...reconciliationEvidence };
  const idempotencyKey = await hashCanonical({
    operation: 'reconcile-auth-config',
    installationId: initial.installationId,
    priorStateFingerprint: evidence.priorStateFingerprint,
    currentStateFingerprint: evidence.currentStateFingerprint,
    inviteTemplateSha256: evidence.inviteTemplateSha256,
  });
  return {
    initial,
    renewed,
    evidence,
    idempotencyKey,
    before: await snapshotTables(session),
  };
}

function reconcile(session, pair, evidence, options = {}) {
  return reconcileAuthConfigJournal(session, pair, evidence, {
    authorize: options.authorize ?? (async () => pair),
  });
}

async function insertReconciliationStep(session, installationId, idempotencyKey, overrides = {}) {
  const step = {
    status: 'completed',
    ownershipTags: [],
    providerResourceIdHashes: [],
    providerResourceDigests: [
      reconciliationEvidence.priorStateFingerprint,
      reconciliationEvidence.currentStateFingerprint,
      reconciliationEvidence.inviteTemplateSha256,
    ],
    stateFingerprint: reconciliationEvidence.currentStateFingerprint,
    startedAt: 'clock_timestamp()',
    completedAt: 'clock_timestamp()',
    ...overrides,
  };
  await session.unsafe(`INSERT INTO private.ccc_install_steps (
    installation_id, step, idempotency_key, status, ownership_tags,
    provider_resource_id_hashes, provider_resource_digests, state_fingerprint,
    started_at, completed_at
  ) VALUES ($1,'auth_config',$2,$3,$4,$5,$6,$7,${step.startedAt},${step.completedAt})`, [
    installationId, idempotencyKey, step.status, step.ownershipTags,
    step.providerResourceIdHashes, step.providerResourceDigests, step.stateFingerprint,
  ]);
}

async function adoptRenewedJournalPointer(session, fixture, { authorizationRow = true } = {}) {
  const { renewed, evidence } = fixture;
  if (authorizationRow) {
    await session.unsafe(`INSERT INTO private.ccc_install_authorizations (
      installation_id, runtime_sequence, runtime_manifest_sha256, approval_sha256,
      runtime_configuration_sha256, contract_version, expires_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
      renewed.installationId, renewed.runtimeSequence, renewed.runtimeManifestSha256,
      renewed.approvalSha256, renewed.runtimeConfigurationSha256, renewed.contractVersion,
      renewed.expiresAt,
    ]);
  }
  await session.unsafe(`UPDATE private.ccc_install_journal SET
    runtime_manifest_sha256 = $2, approval_sha256 = $3, runtime_sequence = $4,
    expires_at = $5, state_fingerprint = $6, updated_at = clock_timestamp()
    WHERE installation_id = $1`, [
    renewed.installationId, renewed.runtimeManifestSha256, renewed.approvalSha256,
    renewed.runtimeSequence, renewed.expiresAt, evidence.currentStateFingerprint,
  ]);
}

databaseTest('Auth reconciliation appends one authorization and completed step atomically', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      const fixture = await installedAuthReconciliationFixture(session);
      assert.deepEqual(
        await reconcile(session, fixture.renewed, fixture.evidence),
        { code: 'AUTH_CONFIG_RECONCILED', changed: true },
      );
      const after = await snapshotTables(session);
      assertRowsPreserved(fixture.before, after, {
        ccc_install_authorizations: 1,
        ccc_install_steps: 1,
      });
      const [journal] = await session.unsafe(
        'SELECT * FROM private.ccc_install_journal WHERE installation_id = $1',
        [fixture.renewed.installationId],
      );
      assertJournalStableColumns(
        JSON.parse(fixture.before.ccc_install_journal[0]),
        journal,
      );
      assert.equal(journal.runtime_manifest_sha256, fixture.renewed.runtimeManifestSha256);
      assert.equal(journal.approval_sha256, fixture.renewed.approvalSha256);
      assert.equal(Number(journal.runtime_sequence), fixture.renewed.runtimeSequence);
      assert.equal(journal.state_fingerprint, fixture.evidence.currentStateFingerprint);
      const [authorizationRow] = await session.unsafe(
        'SELECT * FROM private.ccc_install_authorizations WHERE installation_id = $1 AND runtime_sequence = $2',
        [fixture.renewed.installationId, fixture.renewed.runtimeSequence],
      );
      assert.equal(authorizationRow.runtime_manifest_sha256, fixture.renewed.runtimeManifestSha256);
      assert.equal(authorizationRow.approval_sha256, fixture.renewed.approvalSha256);
      const [step] = await session.unsafe(
        'SELECT * FROM private.ccc_install_steps WHERE installation_id = $1 AND idempotency_key = $2',
        [fixture.renewed.installationId, fixture.idempotencyKey],
      );
      assert.equal(step.step, 'auth_config');
      assert.equal(step.status, 'completed');
      assert.deepEqual(step.ownership_tags, []);
      assert.deepEqual(step.provider_resource_id_hashes, []);
      assert.deepEqual(step.provider_resource_digests, [
        fixture.evidence.priorStateFingerprint,
        fixture.evidence.currentStateFingerprint,
        fixture.evidence.inviteTemplateSha256,
      ]);
      assert.equal(step.state_fingerprint, fixture.evidence.currentStateFingerprint);
      assert.equal(step.started_at.toISOString(), step.completed_at.toISOString());
      const state = await readInstallState(session, fixture.renewed.installationId);
      const reconcileStep = state.completedSteps.find(
        item => item.idempotencyKey === fixture.idempotencyKey,
      );
      assert.equal(reconcileStep.startedAt, reconcileStep.completedAt);
      assert.equal(state.journal.phase, 'installed');
      assert.equal(state.journal.currentStep, null);
    } finally {
      await session.release();
    }
  });
});

databaseTest('Auth reconciliation preserves every existing append-only installation row', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      const fixture = await installedAuthReconciliationFixture(session);
      await reconcile(session, fixture.renewed, fixture.evidence);
      const after = await snapshotTables(session);
      assertRowsPreserved(fixture.before, after, {
        ccc_install_authorizations: 1,
        ccc_install_steps: 1,
      });
      const [journal] = await session.unsafe(
        'SELECT * FROM private.ccc_install_journal WHERE installation_id = $1',
        [fixture.renewed.installationId],
      );
      assertJournalStableColumns(JSON.parse(fixture.before.ccc_install_journal[0]), journal);
      await assert.rejects(
        session.unsafe('DELETE FROM private.ccc_install_authorizations'),
      );
      await assert.rejects(
        session.unsafe('DELETE FROM private.ccc_release_history'),
      );
    } finally {
      await session.release();
    }
  });
});

databaseTest('Auth reconciliation rolls back all three mutations when authorization changes before commit', async () => {
  for (const [expectedCode, withdrawn] of [
    ['OWNER_EVIDENCE_MISSING', authorization({
      runtimeManifestSha256: 'e'.repeat(64),
      approvalSha256: 'f'.repeat(64),
      runtimeSequence: 2,
      expiresAt: new Date(0).toISOString(),
    })],
    ['INSTALL_AUTHORIZATION_MISMATCH', authorization({
      runtimeManifestSha256: 'e'.repeat(64),
      approvalSha256: '0'.repeat(64),
      runtimeSequence: 2,
      expiresAt: new Date(Date.now() + 1_200_000).toISOString(),
    })],
    ['OWNER_EVIDENCE_MISSING', Object.assign(new Error('OWNER_EVIDENCE_MISSING'), {
      code: 'OWNER_EVIDENCE_MISSING',
    })],
  ]) {
    await withDatabase(async sql => {
      const session = await sql.reserve();
      try {
        const fixture = await installedAuthReconciliationFixture(session);
        let calls = 0;
        await assert.rejects(
          reconcile(session, fixture.renewed, fixture.evidence, {
            authorize: async () => {
              calls += 1;
              if (calls === 1) return fixture.renewed;
              if (withdrawn instanceof Error) throw withdrawn;
              return withdrawn;
            },
          }),
          error => error.code === expectedCode,
        );
        assert.equal(calls, 2);
        assertTablesByteEqual(fixture.before, await snapshotTables(session));
      } finally {
        await session.release();
      }
    });
  }
});

databaseTest('Auth reconciliation exact repeat reads durable evidence without writes', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      const fixture = await installedAuthReconciliationFixture(session);
      await reconcile(session, fixture.renewed, fixture.evidence);
      const committed = await snapshotTables(session);
      assert.deepEqual(
        await reconcile(session, fixture.renewed, fixture.evidence),
        { code: 'AUTH_CONFIG_ALREADY_RECONCILED', changed: false },
      );
      assertTablesByteEqual(committed, await snapshotTables(session));
    } finally {
      await session.release();
    }
  });
});

databaseTest('Auth reconciliation recovers a lost response from durable evidence without duplicate writes', async () => {
  await withDatabase(async sql => {
    const session = await sql.reserve();
    try {
      const fixture = await installedAuthReconciliationFixture(session);
      const lostResponse = {
        release: async () => {},
        unsafe: async (query, parameters) => {
          const result = await session.unsafe(query, parameters);
          if (typeof query === 'string' && query.trim() === 'COMMIT') {
            throw Object.assign(new Error('RESPONSE_LOST'), { code: 'RESPONSE_LOST' });
          }
          return result;
        },
      };
      await assert.rejects(
        reconcile(lostResponse, fixture.renewed, fixture.evidence),
        error => error.code === 'RESPONSE_LOST',
      );
      const committed = await snapshotTables(session);
      assert.deepEqual(
        await reconcile(session, fixture.renewed, fixture.evidence),
        { code: 'AUTH_CONFIG_ALREADY_RECONCILED', changed: false },
      );
      assertTablesByteEqual(committed, await snapshotTables(session));
    } finally {
      await session.release();
    }
  });
});

databaseTest('Auth reconciliation rejects partial or conflicting readback without repair', async t => {
  const cases = [
    ['missing authorization history', 'INSTALL_JOURNAL_INVALID', async (session, fixture) => {
      await adoptRenewedJournalPointer(session, fixture, { authorizationRow: false });
      await insertReconciliationStep(session, fixture.initial.installationId, fixture.idempotencyKey);
    }],
    ['missing step', 'INSTALL_JOURNAL_INVALID', async (session, fixture) => {
      await adoptRenewedJournalPointer(session, fixture);
    }],
    ['wrong idempotency key', 'INSTALL_JOURNAL_INVALID', async (session, fixture) => {
      await adoptRenewedJournalPointer(session, fixture);
      await insertReconciliationStep(
        session, fixture.initial.installationId, '9f'.repeat(32),
      );
    }],
    ['wrong digest order', 'INSTALL_STEP_MISMATCH', async (session, fixture) => {
      await adoptRenewedJournalPointer(session, fixture);
      await insertReconciliationStep(session, fixture.initial.installationId, fixture.idempotencyKey, {
        providerResourceDigests: [
          reconciliationEvidence.currentStateFingerprint,
          reconciliationEvidence.priorStateFingerprint,
          reconciliationEvidence.inviteTemplateSha256,
        ],
      });
    }],
    ['wrong state fingerprint', 'INSTALL_STEP_MISMATCH', async (session, fixture) => {
      await adoptRenewedJournalPointer(session, fixture);
      await insertReconciliationStep(session, fixture.initial.installationId, fixture.idempotencyKey, {
        stateFingerprint: '4d'.repeat(32),
      });
    }],
    ['null or unequal timestamps', 'INSTALL_STEP_MISMATCH', async (session, fixture) => {
      await adoptRenewedJournalPointer(session, fixture);
      await insertReconciliationStep(session, fixture.initial.installationId, fixture.idempotencyKey, {
        startedAt: "clock_timestamp() - interval '1 second'",
      });
    }],
    ['same-sequence different manifest and approval', 'INSTALL_AUTHORIZATION_MISMATCH', async (session, fixture) => {
      await adoptRenewedJournalPointer(session, fixture);
      await insertReconciliationStep(session, fixture.initial.installationId, fixture.idempotencyKey);
      await session.unsafe(`UPDATE private.ccc_install_journal SET
        runtime_manifest_sha256 = $2, approval_sha256 = $3
        WHERE installation_id = $1`, [
        fixture.initial.installationId, '5e'.repeat(32), '6f'.repeat(32),
      ]);
    }],
  ];
  for (const [name, expectedCode, corrupt] of cases) {
    await t.test(name, async () => {
      await withDatabase(async sql => {
        const session = await sql.reserve();
        try {
          const fixture = await installedAuthReconciliationFixture(session);
          await corrupt(session, fixture);
          const before = await snapshotTables(session);
          await assert.rejects(
            reconcile(session, fixture.renewed, fixture.evidence),
            error => error.code === expectedCode,
          );
          assertTablesByteEqual(before, await snapshotTables(session));
        } finally {
          await session.release();
        }
      });
    });
  }
});

databaseTest('Auth reconciliation rejects stale and mismatched signed pairs without writes', async t => {
  const cases = [
    ['stale lower sequence', async (session, fixture) => {
      await reconcile(session, fixture.renewed, fixture.evidence);
      return [fixture.initial, fixture.evidence];
    }],
    ['same sequence without completion evidence', async (session, fixture) => [
      fixture.initial, fixture.evidence,
    ]],
    ['same sequence different pair', async (session, fixture) => [
      { ...fixture.initial, approvalSha256: '0'.repeat(64) }, fixture.evidence,
    ]],
    ['stable runtime configuration change', async (session, fixture) => [
      { ...fixture.renewed, runtimeConfigurationSha256: '0'.repeat(64) }, fixture.evidence,
    ]],
    ['prior fingerprint mismatch', async (session, fixture) => [
      fixture.renewed,
      { ...fixture.evidence, priorStateFingerprint: '4d'.repeat(32) },
    ], 'AUTH_RECONCILE_PRIOR_FINGERPRINT_MISMATCH'],
    ['malformed evidence', async (session, fixture) => [
      fixture.renewed,
      { priorStateFingerprint: fixture.evidence.priorStateFingerprint },
    ], 'INSTALL_JOURNAL_INVALID'],
  ];
  for (const [name, arrange, expectedCode = 'INSTALL_AUTHORIZATION_MISMATCH'] of cases) {
    await t.test(name, async () => {
      await withDatabase(async sql => {
        const session = await sql.reserve();
        try {
          const fixture = await installedAuthReconciliationFixture(session);
          const [pair, evidence] = await arrange(session, fixture);
          const before = await snapshotTables(session);
          await assert.rejects(
            reconcile(session, pair, evidence),
            error => error.code === expectedCode,
          );
          assertTablesByteEqual(before, await snapshotTables(session));
        } finally {
          await session.release();
        }
      });
    });
  }
});
