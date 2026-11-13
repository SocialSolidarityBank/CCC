import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const out = dirname(fileURLToPath(import.meta.url));
const { snapshot } = JSON.parse(readFileSync(join(out, 'runtime-setup.json'), 'utf8'));
const require = createRequire(join(snapshot, 'package.json'));
export default {
  root: snapshot,
  cacheDir: join(snapshot, 'node_modules/.vite-harness'),
  resolve: { alias: [
    { find: /^vitest$/, replacement: join(dirname(require.resolve('vitest/package.json')), 'dist/index.js') },
    ...Object.entries({
      'fixture-d1': 'apps/api/test/support/d1.ts',
      'fixture-install': 'apps/api/test/support/install-manifest.ts',
      'fixture-identity': 'adapters/identity-supabase/src/index.ts',
      'fixture-http': 'packages/http-api/src/request-handler.ts',
      'fixture-capabilities': 'packages/http-api/src/capabilities.ts',
    }).map(([find, path]) => ({ find, replacement: join(snapshot, path) })),
  ] },
  plugins: [{ name: 'record-pinned-fixture-imports', transform(code, id) {
    const path = id.split('?')[0];
    if (path.startsWith(snapshot + '/') && !path.includes('/node_modules/')) {
      appendFileSync(join(out, 'fixture-imports.jsonl'), JSON.stringify({ path: relative(snapshot, path), sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }) + '\n');
    } else if (path.startsWith('/') && !path.includes('/node_modules/') && !path.startsWith(out + '/')) {
      throw Error('fixture_import_outside_owned_snapshot');
    }
    return null;
  } }],
  test: { include: [join(out, 'fixture.test.mjs')], environment: 'node', maxWorkers: 1, fileParallelism: false,
    testTimeout: 0, hookTimeout: 60_000, silent: false },
};
