import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan } from './test-suite.mjs';

test('unknown kind and unknown suite flag are usage errors', () => {
  assert.equal(plan(['nope']).code, 1);
  assert.equal(plan(['contracts', '--jwt']).code, 1);
});

test('selecting all suites deduplicates shared files while preserving their order', () => {
  const decision = plan(['contracts'], {
    contracts: { first: ['shared.test.ts', 'first.test.ts'], second: ['shared.test.ts', 'second.test.ts'] },
  });
  assert.equal(decision.status, 'run');
  assert.deepEqual(decision.argv.slice(-3), ['shared.test.ts', 'first.test.ts', 'second.test.ts']);
});

test('one suite may run multiple contract files', () => {
  const decision = plan(['contracts', '--auth'], {
    contracts: { auth: ['access.test.ts', 'identity.test.ts'] },
  });
  assert.equal(decision.status, 'run');
  assert.deepEqual(decision.argv.slice(-2), ['access.test.ts', 'identity.test.ts']);
});

test('database profile flags select D1, encrypted SQLite, PostgreSQL, or SQL portability contracts', () => {
  assert.deepEqual(plan(['contracts', '--db=d1']).argv.slice(-1), ['apps/api/test/database-contract.test.ts']);
  assert.deepEqual(plan(['contracts', '--db=sqlite']).argv.slice(-1), ['apps/api/test/sqlite-database.contract.test.ts']);
  assert.deepEqual(plan(['contracts', '--db=postgres']).argv.slice(-1), ['apps/api/test/postgres-database.contract.test.ts']);
  assert.deepEqual(plan(['contracts', '--sql']).argv.slice(-3), [
    'apps/api/test/sql-placeholder-scanner.test.ts',
    'apps/api/test/sql-operation-marker.test.ts',
    'apps/api/test/sql-portability-migration.test.ts',
  ]);
});

test('migration guard refuses catalog update mode before launching any engine', async () => {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync(process.execPath, ['scripts/test-suite.mjs', 'migration-parity'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, CCC_UPDATE_MIGRATION_PARITY: '1', PATH: '' },
    encoding: 'utf8',
    timeout: 5_000,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /migration guard is read-only/);
});
