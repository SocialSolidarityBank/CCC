import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { wireStyles } from '@ccc/wire/styles';
import { composeSharedCss, repoRoot, shellStylesPath, tokensPath } from '@ccc/wire/build/shared-styles';

const here = dirname(fileURLToPath(import.meta.url));
const cssId = 'virtual:ccc-shared.css';
const configId = 'virtual:ccc-site-config';

export default defineConfig(({ mode }) => {
  const config = loadEnv(mode, here, 'CCC_');
  return {
    root: here,
    appType: 'mpa',
    oxc: { jsx: { runtime: 'automatic' } },
    server: { host: '127.0.0.1', fs: { allow: [repoRoot] } },
    build: {
      rolldownOptions: {
        input: { index: join(here, 'index.html'), welcome: join(here, 'welcome.html') },
      },
    },
    plugins: [{
      name: 'ccc-site-public-assets',
      resolveId(id) {
        return id === cssId || id === configId ? `\0${id}` : null;
      },
      load(id) {
        if (id === `\0${configId}`) {
          // Only this nonsecret value is public, never the environment object.
          return `export default ${JSON.stringify(config.CCC_BUSINESS_CLIENT_ORIGIN ?? '')};`;
        }
        if (id !== `\0${cssId}`) return null;
        this.addWatchFile(tokensPath);
        this.addWatchFile(shellStylesPath);
        this.addWatchFile(join(repoRoot, 'packages/wire/src/wire-styles.ts'));
        // A CSS module emits an external stylesheet in the production build.
        return composeSharedCss(wireStyles);
      },
    }],
  };
});
