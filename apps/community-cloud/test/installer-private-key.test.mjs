import assert from 'node:assert/strict';
import test from 'node:test';

// Main builds dist/index.js before running this source-only handoff's scenarios.
// Module loading must occur after the synthetic Deno boundary is installed.
for (const [index, value] of ['', 'synthetic-not-a-signing-key'].entries()) {
  test(`installer private-key presence exits before DB initialization (${index})`, async () => {
    const previousDeno = globalThis.Deno;
    const previousError = console.error;
    const diagnostics = [];
    let databaseReads = 0;
    let served = false;
    let exitCode;
    const exit = new Error('synthetic-process-exit');
    globalThis.Deno = {
      env: {
        has: name => name === 'CCC_INSTALL_SIGNING_PRIVATE_KEY',
        get: name => {
          if (name === 'CCC_DATABASE_URL') { databaseReads += 1; throw new Error('database-initialization-reached'); }
          if (name === 'CCC_INSTALL_SIGNING_PRIVATE_KEY') return value;
          return undefined;
        },
      },
      serve: () => { served = true; },
      exit: code => { exitCode = code; throw exit; },
    };
    console.error = (...values) => { diagnostics.push(values); };
    try {
      const entry = new URL('../dist/index.js', import.meta.url);
      entry.searchParams.set('scenario', String(index));
      await assert.rejects(import(entry.href), error => error === exit);
      assert.equal(exitCode, 1);
      assert.equal(databaseReads, 0);
      assert.equal(served, false);
      assert.deepEqual(diagnostics, [['installation_unavailable']]);
    } finally {
      console.error = previousError;
      if (previousDeno === undefined) delete globalThis.Deno;
      else globalThis.Deno = previousDeno;
    }
  });
}
