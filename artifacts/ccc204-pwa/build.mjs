import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
const evidence = process.argv[2];
const { snapshot } = JSON.parse(readFileSync(join(evidence, 'runtime-setup.json'), 'utf8'));
const require = createRequire(join(snapshot, 'apps/client/package.json'));
const viteEntry = require.resolve('vite');
const { build } = await import(pathToFileURL(viteEntry));
const digest = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const resolution = Object.fromEntries(['vite', 'react', 'react-dom', 'react-router', '@ccc/wire', '@ccc/contracts/runtime'].map(name => {
  const file = realpathSync(require.resolve(name));
  return [name, { file, sha256: digest(file) }];
}));
if (!resolution['@ccc/wire'].file.startsWith(snapshot + '/') || !resolution['@ccc/contracts/runtime'].file.startsWith(snapshot + '/')) throw Error('workspace_resolution_not_isolated');
writeFileSync(join(evidence, 'resolved-imports.json'), JSON.stringify(resolution, null, 2) + '\n');
await build({
  configFile: join(snapshot, 'apps/client/vite.config.ts'),
  plugins: [{
    name: 'ccc204-observe-import-closure',
    generateBundle() {
      const modules = [...this.getModuleIds()].sort().map(id => {
        const clean = id.split('?')[0];
        if (clean.startsWith(snapshot + '/') && !clean.includes('/node_modules/')) return { path: relative(snapshot, clean), sha256: digest(clean), kind: 'pinned-source' };
        if (clean.includes('/node_modules/')) return { path: clean, sha256: digest(clean), kind: 'installed-dependency' };
        if (clean.startsWith('/') && !clean.startsWith('/@')) throw Error('source_outside_snapshot');
        return { path: id, kind: 'virtual' };
      });
      writeFileSync(join(evidence, 'import-closure.json'), JSON.stringify({ configFile: 'apps/client/vite.config.ts', modules }, null, 2) + '\n');
    },
  }],
});
