import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync, appendFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const harness = dirname(fileURLToPath(import.meta.url));
const out = join(harness, '..');
const { snapshot } = JSON.parse(readFileSync(join(out, 'runtime-setup.json'), 'utf8'));
const require = createRequire(join(snapshot, 'package.json'));
const aliases = {
  'fixture-errors': 'apps/client/src/business/errors.ts',
  'fixture-transport': 'apps/client/src/business/transport.ts',
  'fixture-installation': 'apps/client/src/business/installation.ts',
  'fixture-test-support': 'apps/client/src/business/test-support.ts',
  'fixture-api': 'apps/client/src/business/api.ts',
  'fixture-participants': 'apps/client/src/business/participants.ts',
  'fixture-capabilities': 'packages/contracts/src/capabilities.ts',
  'fixture-install-manifest': 'packages/contracts/src/install-manifest.ts',
  'fixture-install-support': 'apps/api/test/support/install-manifest.ts',
  'fixture-community-runtime': 'apps/community-cloud/src/runtime.ts',
  'fixture-secrets': 'adapters/secrets-env/src/index.ts',
};

export default {
  root: snapshot,
  cacheDir: join(snapshot, 'node_modules/.vite-ccc212'),
  resolve: { alias: [
    { find: /^vitest$/, replacement: join(dirname(require.resolve('vitest/package.json')), 'dist/index.js') },
    ...Object.entries(aliases).map(([find, path]) => ({ find, replacement: join(snapshot, path) })),
  ] },
  plugins: [{ name: 'record-pinned-ccc212-imports', transform(code, id) {
    const path = id.split('?')[0];
    if (path.startsWith(snapshot + '/') && !path.includes('/node_modules/')) {
      appendFileSync(join(out, 'fixture-imports.jsonl'), JSON.stringify({
        path: relative(snapshot, path), sha256: createHash('sha256').update(readFileSync(path)).digest('hex'),
      }) + '\n');
    } else if (path.startsWith('/') && !path.includes('/node_modules/') && !path.startsWith(out + '/')) {
      throw new Error('fixture_import_outside_owned_snapshot');
    }
    return null;
  } }],
  test: {
    include: [join(harness, 'audit.test.ts')], environment: 'node', maxWorkers: 1, fileParallelism: false,
    testTimeout: 120_000, hookTimeout: 60_000, silent: false,
  },
};
