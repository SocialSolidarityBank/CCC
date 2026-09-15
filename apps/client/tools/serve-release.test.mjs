// Native only; no packages, provider calls or real credentials.
// deno test --no-config --no-lock --no-remote --allow-read --allow-write --allow-run=deno,bun --allow-env=PATH --allow-net=127.0.0.1 \
//   apps/client/tools/serve-release.test.mjs
// These are shape-only artifacts. Main separately exercises build:release with a
// synthetic SIGNED manifest + PUBLIC verification keys before image verification.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createStaticReleaseHandler } from './serve-release.mjs';

const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; connect-src 'self' https://api.example.invalid/ https://auth.example.invalid; object-src 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
};
const manifest = {
  schemaVersion: 1, mode: 'community-cloud', apiBase: 'https://api.example.invalid',
  clientOrigin: 'https://client.example.invalid', allowedOrigins: ['https://client.example.invalid'],
  supabaseAuthOrigin: 'https://auth.example.invalid', signingKeyId: 'synthetic-public-key-id',
  ed25519Signature: `${'A'.repeat(86)}==`,
};
const metadata = { clientOrigin: manifest.clientOrigin, allowedOrigins: manifest.allowedOrigins,
  apiBase: manifest.apiBase, supabaseAuthOrigin: manifest.supabaseAuthOrigin, headers: securityHeaders };
const index = '<!doctype html><html><head><link rel="stylesheet" href="/assets/index-1234ABcd.css"></head><body><div id="root"></div><script type="module" src="/assets/index-1234ABcd.js"></script></body></html>';

async function fixture(run) {
  const root = await Deno.makeTempDir({ prefix: 'ccc-static-release-' });
  try {
    await Deno.mkdir(join(root, 'assets'));
    const files = {
      'index.html': index,
      'ccc-install-manifest.json': JSON.stringify(manifest),
      'ccc-bootstrap.json': JSON.stringify({ mode: manifest.mode, apiBase: manifest.apiBase }),
      'ccc-deploy-headers.json': JSON.stringify(metadata),
      'manifest.webmanifest': JSON.stringify({ name: 'Synthetic', start_url: '/schedule' }),
      'sw.js': '// shell worker', 'icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      'assets/index-1234ABcd.js': 'globalThis.syntheticRelease = true;',
      'assets/index-1234ABcd.css': 'body { color: black; }',
      'assets/font-1234ABcd.woff2': 'synthetic-font-bytes',
      'assets/unhashed.png': 'synthetic-image-bytes',
      'assets/code.js.map': 'SOURCE_MAP_SENTINEL',
      'ccc-bootstrap.json.example': 'EXAMPLE_SENTINEL',
      '.env': 'SECRET_SENTINEL',
    };
    for (const [path, content] of Object.entries(files)) await Deno.writeTextFile(join(root, path), content);
    await run(root);
  } finally { await Deno.remove(root, { recursive: true }); }
}
const request = (path, method = 'GET') => new Request(`http://localhost${path}`, { method });
function checkSecurity(response) {
  for (const name of ['Content-Security-Policy', 'Referrer-Policy', 'X-Content-Type-Options']) {
    assert.equal(response.headers.get(name), securityHeaders[name]);
  }
}

Deno.test('GET/HEAD and SPA deep links send actual security headers and no-store entry bytes', () => fixture(async (root) => {
  const serve = await createStaticReleaseHandler(root);
  for (const path of ['/', '/index.html', '/participants/swallow-003/programs/case-1/records/intake?from=registration']) {
    const response = serve(request(path));
    assert.equal(response.status, 200);
    assert.equal(await response.text(), index);
    assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    checkSecurity(response);
    const head = serve(request(path, 'HEAD'));
    assert.equal(await head.text(), '');
    assert.equal(head.headers.get('Content-Length'), String(new TextEncoder().encode(index).length));
    assert.deepEqual([...head.headers], [...response.headers]);
  }
  for (const path of ['/ccc-bootstrap.json', '/ccc-install-manifest.json', '/sw.js', '/manifest.webmanifest']) {
    const response = serve(request(path));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    checkSecurity(response);
  }
}));

Deno.test('hashed release assets have correct MIME and immutable caching; unhashed assets do not', () => fixture(async (root) => {
  const serve = await createStaticReleaseHandler(root);
  for (const [name, type] of [['js', 'text/javascript; charset=utf-8'], ['css', 'text/css; charset=utf-8']]) {
    const response = serve(request(`/assets/index-1234ABcd.${name}`));
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), type);
    assert.equal(response.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    checkSecurity(response);
  }
  assert.equal(serve(request('/assets/font-1234ABcd.woff2')).headers.get('Content-Type'), 'font/woff2');
  assert.equal(serve(request('/assets/unhashed.png')).headers.get('Cache-Control'), 'no-store');
  const head = serve(request('/assets/index-1234ABcd.js', 'HEAD'));
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('Content-Length'), String('globalThis.syntheticRelease = true;'.length));
}));

Deno.test('missing assets, directories, metadata and source files never fall back to HTML', () => fixture(async (root) => {
  const serve = await createStaticReleaseHandler(root);
  for (const path of ['/assets/', '/assets/missing', '/assets/missing.js', '/missing.css', '/ccc-deploy-headers.json',
    '/ccc-bootstrap.json.example', '/assets/code.js.map', '/tools/serve-release.mjs', '/src/main.tsx']) {
    const response = serve(request(path));
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), 'Not found');
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    checkSecurity(response);
  }
  for (const path of ['/assets/%2e%2e%2f.env', '/assets/%252e%252e/file.js', '/assets/%5cfile.js', '/%00', '/%ZZ', '/.env']) {
    const response = serve(request(path));
    assert.equal(response.status, 400, path);
    assert.equal(await response.text(), 'Invalid path');
    checkSecurity(response);
  }
  // A Request URL parser may normalize literal dot segments before the handler.
  // Even then there is no request-controlled filesystem access.
  assert.equal(serve(request('/assets/../outside.js')).status, 404);
  const denied = serve(new Request('http://localhost/schedule', { method: 'POST', body: 'DO_NOT_ECHO_BODY' }));
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.get('Allow'), 'GET, HEAD');
  assert.equal(await denied.text(), 'Method not allowed');
  checkSecurity(denied);
}));

Deno.test('startup rejects missing or malformed release metadata and unbuilt or broken HTML', async () => {
  for (const file of ['index.html', 'ccc-bootstrap.json', 'ccc-install-manifest.json', 'ccc-deploy-headers.json']) {
    await fixture(async (root) => {
      await Deno.remove(join(root, file));
      await assert.rejects(createStaticReleaseHandler(root), { message: 'static_release_invalid' });
    });
  }
  for (const [file, content] of [
    ['ccc-deploy-headers.json', '{'],
    ['ccc-deploy-headers.json', JSON.stringify({ ...metadata, headers: {} })],
    ['ccc-deploy-headers.json', JSON.stringify({ ...metadata, headers: { ...securityHeaders, 'Referrer-Policy': 'unsafe-url' } })],
    ['ccc-bootstrap.json', JSON.stringify({ mode: 'community-cloud', apiBase: 'https://other.example.invalid' })],
    ['ccc-install-manifest.json', JSON.stringify({ ...manifest, ed25519Signature: 'unsigned' })],
    ['index.html', ''],
    ['index.html', index.replace('/assets/index-1234ABcd.js', '/src/main.tsx')],
    ['index.html', index.replace('/assets/index-1234ABcd.css', '/assets/missing.css')],
  ]) await fixture(async (root) => {
    await Deno.writeTextFile(join(root, file), content);
    await assert.rejects(createStaticReleaseHandler(root), { message: 'static_release_invalid' });
  });
});

Deno.test('symlink escapes fail startup and loaded files cannot be swapped into arbitrary reads', () => fixture(async (root) => {
  const outside = await Deno.makeTempFile();
  try {
    await Deno.writeTextFile(outside, 'OUTSIDE_SENTINEL');
    const serve = await createStaticReleaseHandler(root);
    await Deno.remove(join(root, 'assets/index-1234ABcd.js'));
    await Deno.symlink(outside, join(root, 'assets/index-1234ABcd.js'));
    assert.equal(await serve(request('/assets/index-1234ABcd.js')).text(), 'globalThis.syntheticRelease = true;');
    await assert.rejects(createStaticReleaseHandler(root), { message: 'static_release_invalid' });
  } finally { await Deno.remove(outside); }
}));

Deno.test('the executable exits closed with a fixed diagnostic before listening', () => fixture(async (root) => {
  await Deno.remove(join(root, 'ccc-deploy-headers.json'));
  const probe = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const port = probe.addr.port;
  probe.close();
  const result = await new Deno.Command(Deno.execPath(), {
    args: ['run', '--no-config', '--no-lock', '--no-remote', '--no-prompt', `--allow-read=${root}`,
      '--allow-env=PORT', '--allow-net=0.0.0.0', new URL('./serve-release.mjs', import.meta.url).pathname, root],
    env: { PORT: String(port) }, stdout: 'piped', stderr: 'piped', signal: AbortSignal.timeout(5000),
  }).output();
  assert.equal(result.code, 1);
  assert.equal(new TextDecoder().decode(result.stdout), '');
  assert.equal(new TextDecoder().decode(result.stderr).trim(), 'static_release_invalid');
}));

Deno.test('release builder rejects closed-trust and manifest mismatches before invoking Vite', async () => {
  const root = await Deno.makeTempDir({ prefix: 'ccc-release-trust-' });
  try {
    const fixtureUrl = new URL('../src/business/test-support.ts', import.meta.url).href;
    const fixtureFile = join(root, 'fixture.json');
    const generated = await new Deno.Command('bun', {
      args: ['--eval', `const {fixture}=await import(${JSON.stringify(fixtureUrl)}); await Bun.write(${JSON.stringify(fixtureFile)}, JSON.stringify(await fixture({sequence:2})));`],
      stdout: 'piped', stderr: 'piped',
    }).output();
    assert.equal(generated.code, 0);
    const { manifest: signed, trust: trustJson } = JSON.parse(await Deno.readTextFile(fixtureFile));
    const trust = JSON.parse(trustJson);
    await Deno.writeTextFile(join(root, 'manifest.json'), JSON.stringify(signed));
    const bin = join(root, 'bin');
    await Deno.mkdir(bin);
    await Deno.writeTextFile(join(bin, 'pnpm'), '#!/bin/sh\nprintf "UNEXPECTED_VITE_INVOCATION\\n"\nexit 99\n');
    await Deno.chmod(join(bin, 'pnpm'), 0o700);
    const privateText = 'PRIVATE_APPROVAL_JOURNAL_BEARER_PII_SENTINEL';
    const cases = [
      { trust: undefined, error: 'trust_missing' },
      { trust: { ...trust, revokedKeyIds: ['test'] }, error: 'key_revoked' },
      { trust: { ...trust, minSequence: 3 }, error: 'sequence_replay' },
      { trust: { ...trust, expectedInstallationId: 'another-installation' }, error: 'wrong_install' },
      { trust: { ...trust, privateApproval: privateText }, error: 'trust_missing' },
    ];
    for (const scenario of cases) {
      const config = join(root, 'release.json');
      await Deno.writeTextFile(config, JSON.stringify({ manifestPath: 'manifest.json', trust: scenario.trust }));
      const result = await new Deno.Command('bun', {
        args: [new URL('./build-release.mjs', import.meta.url).pathname, '--config', config, '--out', join(root, 'dist')],
        env: { PATH: `${bin}:${Deno.env.get('PATH') ?? ''}` }, stdout: 'piped', stderr: 'piped',
      }).output();
      const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
      assert.equal(result.code, 1);
      assert.ok(output.includes(scenario.error));
      assert.ok(!output.includes('UNEXPECTED_VITE_INVOCATION'));
      assert.ok(!output.includes(privateText));
      await assert.rejects(Deno.stat(join(root, 'dist')), Deno.errors.NotFound);
    }
  } finally { await Deno.remove(root, { recursive: true }); }
});
