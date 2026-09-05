import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

test('rejects production as an unsupported seed destination', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./apply.mjs', import.meta.url)), 'production'], {
    encoding: 'utf8',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /production/);
});
