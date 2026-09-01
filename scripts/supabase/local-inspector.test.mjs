import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createLocalInspector } from './local-inspector.mjs';

const localDatabaseUrl = 'postgresql://postgres:local-secret@127.0.0.1:54322/postgres';

async function localProject() {
  const directory = await mkdtemp(join(tmpdir(), 'ccc-supabase-plan-'));
  await mkdir(join(directory, 'supabase'));
  await writeFile(join(directory, 'supabase', 'config.toml'), `
[auth]
enable_signup = false
enable_refresh_token_rotation = true

[auth.email]
enable_signup = true

[auth.mfa.totp]
enroll_enabled = true
verify_enabled = true
`, 'utf8');
  return directory;
}

function databaseState(overrides = {}) {
  return {
    schema_fingerprint: 'schema-empty',
    policy_fingerprint: 'policy-empty',
    bucket_fingerprint: 'bucket-empty',
    institution_data_fingerprint: 'data-empty',
    user_table_count: 0,
    user_row_estimate: 0,
    rls_enabled_table_count: 0,
    policy_count: 0,
    bucket_exists: false,
    bucket_public: null,
    ledger_exists: false,
    database_version: '17.4',
    read_only: true,
    database_readable: true,
    ...overrides,
  };
}

test('local inspector reads CLI status, database, Auth, and Storage without returning connection secrets', async () => {
  const workdir = await localProject();
  try {
    const inspector = createLocalInspector({
      workdir,
      runStatus: async () => ({ DB_URL: localDatabaseUrl, API_URL: 'http://127.0.0.1:54321' }),
      inspectDatabase: async (databaseUrl) => {
        assert.equal(databaseUrl, localDatabaseUrl);
        return { database: databaseState(), migration: null };
      },
    });

    const observed = await inspector.inspect();
    assert.equal(observed.project.status, 'LOCAL');
    assert.equal(observed.project.databaseVersion, '17.4');
    assert.equal(observed.connection.readOnly, true);
    assert.deepEqual(observed.auth, {
      emailEnabled: true,
      openSignupDisabled: true,
      totpEnabled: true,
      refreshTokenRotationEnabled: true,
    });
    const serialized = JSON.stringify(observed);
    assert.equal(serialized.includes(localDatabaseUrl), false);
    assert.equal(serialized.includes('local-secret'), false);
    assert.equal(serialized.includes('http://'), false);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test('local inspector fails closed when the CLI status has no database connection', async () => {
  const workdir = await localProject();
  try {
    const inspector = createLocalInspector({
      workdir,
      runStatus: async () => ({ API_URL: 'http://127.0.0.1:54321' }),
      inspectDatabase: async () => {
        throw new Error('must not run');
      },
    });

    await assert.rejects(inspector.inspect(), (error) => {
      assert.equal(error.code, 'LOCAL_SUPABASE_UNAVAILABLE');
      assert.doesNotMatch(error.message, /127\.0\.0\.1|http/u);
      return true;
    });
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
