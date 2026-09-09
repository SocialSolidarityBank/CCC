import { fileURLToPath } from 'node:url';

const clientEntry = fileURLToPath(new URL('./client.tsx', import.meta.url));
const output = fileURLToPath(new URL('./client.js', import.meta.url));
const noWriteDraft = fileURLToPath(new URL('./no-write-draft.ts', import.meta.url));
const linkShim = fileURLToPath(new URL('./next-link-shim.tsx', import.meta.url));

const prototypeAdapters = {
  name: 'ccc-workflow-prototype-adapters',
  setup(build) {
    build.onResolve({ filter: /use-dom-draft$/ }, () => ({ path: noWriteDraft }));
    build.onResolve({ filter: /^next\/link$/ }, () => ({ path: linkShim }));
  },
};

const result = await Bun.build({
  entrypoints: [clientEntry],
  outfile: output,
  target: 'browser',
  format: 'iife',
  minify: false,
  sourcemap: 'none',
  plugins: [prototypeAdapters],
});

if (!result.success) throw new AggregateError(result.logs, 'Prototype client bundle failed');
await Bun.write(output, result.outputs[0]);
console.log('client.js: bundled with no-write draft and plain-anchor adapters');
