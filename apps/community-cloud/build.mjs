import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: '../../supabase/functions/ccc-api/index.js',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['postgres'],
  sourcemap: false,
  logLevel: 'warning',
});
