import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { wireStyles } from '../../apps/web/app/components/wire/wire-styles.ts';
import { composeSharedCss } from '../../apps/client/build/shared-styles.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');

const SHARED_CSS_ID = 'virtual:proto-shared-css';
const RESOLVED = `\0${SHARED_CSS_ID}`;

export default defineConfig({
  root: here,
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: {
      'next/link': join(here, 'src/shims/next-link.tsx'),
      'next/navigation': join(here, 'src/shims/next-navigation.ts'),
      'next/headers': join(here, 'src/shims/next-headers.ts'),
    },
  },
  plugins: [
    {
      name: 'proto-shared-css',
      resolveId: (id) => (id === SHARED_CSS_ID ? RESOLVED : null),
      load: (id) =>
        id === RESOLVED
          ? `export default ${JSON.stringify(composeSharedCss(wireStyles))};`
          : null,
    },
  ],
  server: {
    host: '127.0.0.1',
    port: 5199,
    fs: { allow: [repoRoot] },
    proxy: {
      '/api': { target: 'http://127.0.0.1:8792', changeOrigin: true },
    },
  },
});
