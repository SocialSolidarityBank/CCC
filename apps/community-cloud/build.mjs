import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  format: 'esm',
  // Deno implements these node: built-ins; bundle postgres so the image needs no npm install.
  platform: 'node',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'warning',
});

await build({
  entryPoints: ['src/install-consent-registry.ts'],
  outfile: 'dist/install-consent-registry.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  external: ['postgres'],
  sourcemap: false,
  logLevel: 'warning',
});

await build({
  entryPoints: ['src/install-manifest-verifier.ts'],
  outfile: 'dist/install-manifest-verifier.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'warning',
});

// The StorageSigner is a separate deployment unit, never part of the business runtime.
await build({
  entryPoints: ['src/storage-signer.ts'],
  outfile: 'dist/storage-signer.js',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  sourcemap: false,
  logLevel: 'warning',
});
