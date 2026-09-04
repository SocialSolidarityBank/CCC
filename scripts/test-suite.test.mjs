import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plan, SUITES } from './test-suite.mjs';

test('unknown kind and unknown suite flag are usage errors', () => {
  assert.equal(plan(['nope']).code, 1);
  assert.equal(plan(['contracts', '--jwt']).code, 1);
});

test('a named suite runs exactly its file; no flag runs every file of the kind', () => {
  const one = plan(['security', '--bootstrap']);
  assert.equal(one.status, 'run');
  assert.deepEqual(one.argv.slice(-1), [SUITES.security.bootstrap]);
  const all = plan(['contracts']);
  assert.deepEqual(
    all.argv.slice(-5),
    ['apps/api/test/capabilities.contract.test.ts', 'apps/api/test/database-contract.test.ts', 'apps/api/test/audio-store.contract.test.ts', 'apps/api/test/access-jwt.test.ts', 'apps/api/test/identity-access.contract.test.ts'],
  );
});

test('one suite may run multiple contract files', () => {
  const decision = plan(['contracts', '--auth'], {
    contracts: { auth: ['access.test.ts', 'identity.test.ts'] },
  });
  assert.equal(decision.status, 'run');
  assert.deepEqual(decision.argv.slice(-2), ['access.test.ts', 'identity.test.ts']);
});
