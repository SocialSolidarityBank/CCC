import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, link, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

import { loadReleaseTrustStore } from './release-trust.mjs';
import { PINNED_RELEASE_ORIGIN } from './release-origin.mjs';
import { verifyReleaseBundle, verifyReleaseManifest } from './release-manifest.mjs';
import { verifyEdgeComponentManifest } from './edge-component-manifest.mjs';

const runFile = promisify(execFile);
const script = new URL('./build-bundle.mjs', import.meta.url);
const sha256 = value => createHash('sha256').update(value).digest('hex');

function signingFixture() {
  const release = generateKeyPairSync('ed25519');
  const root = generateKeyPairSync('ed25519');
  const releaseKeyId = 'release-key-test';
  const trustJson = JSON.stringify({ keys: [{
    keyId: releaseKeyId,
    publicKey: release.publicKey.export({ format: 'jwk' }).x,
    role: 'release',
    status: 'active',
    notBefore: '2020-01-01T00:00:00.000Z',
    notAfter: '2099-01-01T00:00:00.000Z',
  }, {
    keyId: 'root-key-test',
    publicKey: root.publicKey.export({ format: 'jwk' }).x,
    role: 'root',
    status: 'active',
    notBefore: '2020-01-01T00:00:00.000Z',
    notAfter: '2099-01-01T00:00:00.000Z',
  }] });
  return {
    env: {
      ...process.env,
      CCC_RELEASE_SIGNING_PRIVATE_KEY: release.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      CCC_RELEASE_ROOT_SIGNING_PRIVATE_KEY: root.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
      CCC_RELEASE_TRUST_STORE: trustJson,
    },
    trustJson,
  };
}

function target() {
  if (process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch)) {
    return { platform: 'macos', arch: process.arch };
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return { platform: 'ubuntu', arch: 'x64' };
  }
  throw new Error('test host is not a supported Community Cloud CLI release target');
}

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'ccc-build-bundle-'));
  const componentRoot = join(root, 'components');
  const outDir = join(root, 'out');
  try {
    for (const directory of ['functions', 'templates', 'migrations']) {
      await mkdir(join(componentRoot, directory), { recursive: true });
    }
    await writeFile(join(componentRoot, 'functions', 'apply.ts'), 'export default true;');
    await writeFile(join(componentRoot, 'functions', '😀.ts'), 'export default true;');
    await writeFile(join(componentRoot, 'templates', 'config.json'), '{"safe":true}');
    await writeFile(join(componentRoot, 'migrations', '0001.sql'), 'select 1;');
    await run({ root, componentRoot, outDir, signing: signingFixture() });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function args(componentRoot, outDir, overrides = {}) {
  const values = {
    '--component-root': componentRoot,
    '--out-dir': outDir,
    '--version': '0.9.0-dev.3',
    '--sequence': '12',
    '--channel': 'dev',
    ...overrides,
  };
  return Object.entries(values).flat();
}

async function filesOrEmpty(path) {
  try {
    return await readdir(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function rejectedRun(cliArgs, env) {
  try {
    await runFile(process.execPath, [script.pathname, ...cliArgs], { env });
    assert.fail('builder unexpectedly succeeded');
  } catch (error) {
    assert.equal(error.code, 1);
    return { stdout: error.stdout, stderr: error.stderr };
  }
}

test('builds four development files that pass the Task 1 verifiers in a real round trip', async () => fixture(async ({ root, componentRoot, outDir, signing }) => {
  const hostileBin = join(root, 'hostile-bin');
  await mkdir(hostileBin);
  await writeFile(join(hostileBin, 'tar'), [
    '#!/bin/sh',
    'test -z \"${CCC_RELEASE_SIGNING_PRIVATE_KEY+x}\" || exit 97',
    'exec /usr/bin/tar \"$@\"',
    '',
  ].join('\n'));
  await chmod(join(hostileBin, 'tar'), 0o700);
  const { stdout, stderr } = await runFile(process.execPath, [script.pathname, ...args(componentRoot, outDir)], {
    env: {
      ...signing.env,
      PATH: `${hostileBin}:${signing.env.PATH}`,
      TAR_OPTIONS: '--exclude=./migrations',
    },
  });
  assert.equal(stderr, '');
  const summary = JSON.parse(stdout);
  assert.deepEqual(Object.keys(summary).sort(), [
    'artifactCount', 'artifactSha256', 'bundleSha256', 'componentCount',
    'edgeComponentManifestSha256', 'floorSha256', 'manifestSha256', 'sequence', 'version',
  ].sort());
  assert.equal(summary.version, '0.9.0-dev.3');
  assert.equal(summary.sequence, '12');
  assert.equal(summary.artifactCount, 1);
  assert.equal(summary.componentCount, 4);
  assert.doesNotMatch(stdout, /https?:|PRIVATE KEY|ed25519Signature|offlineRootSignature|release-key-test/u);

  const releaseTarget = target();
  const basename = `community-cloud-cli-community-cloud-0.9.0-dev.3-${releaseTarget.platform}-${releaseTarget.arch}.tar.gz`;
  const manifestName = `${basename}.manifest.json`;
  assert.deepEqual((await readdir(outDir)).sort(), [
    basename, manifestName, 'release-bundle.json', 'release-floor.json',
  ].sort());

  const artifactBytes = await readFile(join(outDir, basename));
  const manifestDocument = await readFile(join(outDir, manifestName), 'utf8');
  const bundleDocument = await readFile(join(outDir, 'release-bundle.json'), 'utf8');
  const floorDocument = await readFile(join(outDir, 'release-floor.json'), 'utf8');
  assert.equal(summary.artifactSha256, sha256(artifactBytes));
  assert.equal(summary.manifestSha256, sha256(manifestDocument));
  assert.equal(summary.bundleSha256, sha256(bundleDocument));
  assert.equal(summary.floorSha256, sha256(floorDocument));

  const bundle = await verifyReleaseBundle({
    document: bundleDocument,
    trustStore: await loadReleaseTrustStore(signing.trustJson),
    now: new Date(JSON.parse(bundleDocument).publishedAt),
    channel: 'dev',
  });
  assert.deepEqual(bundle.entries.map(entry => entry.family), ['community-cloud-cli']);
  assert.deepEqual(bundle.protocol.peers.map(peer => peer.name), ['cloud-cli', 'edge']);
  assert.equal(bundle.modelManifestSha256, '0'.repeat(64));
  const bundleRow = { family: bundle.entries[0].family, ...bundle.entries[0].artifacts[0] };
  assert.equal(bundleRow.manifestUrl, `${PINNED_RELEASE_ORIGIN}/manifests/${manifestName}`);
  assert.equal(bundleRow.edgeComponentManifestSha256, summary.edgeComponentManifestSha256);

  await verifyReleaseManifest({
    document: manifestDocument,
    trustStore: await loadReleaseTrustStore(signing.trustJson),
    now: new Date(bundle.publishedAt),
    expectedTuple: {
      family: 'community-cloud-cli', mode: 'community-cloud',
      platform: releaseTarget.platform, arch: releaseTarget.arch,
    },
    bundleEntry: bundleRow,
  });

  const stagedRoot = join(root, 'staged');
  await mkdir(stagedRoot);
  await runFile('tar', ['-xzf', join(outDir, basename), '-C', stagedRoot]);
  const unicodeName = (await readdir(join(componentRoot, 'functions')))
    .find(name => name !== 'apply.ts');
  const archivePaths = await readdir(stagedRoot, { recursive: true });
  for (const expected of [
    'edge-component-manifest.json',
    'functions/apply.ts',
    `functions/${unicodeName}`,
    'migrations/0001.sql',
    'templates/config.json',
    'ccc-cloud.mjs',
    'cli/scripts/release/safe-extract.mjs',
    'cli/scripts/supabase/bootstrap.mjs',
    'cli/node_modules/postgres/package.json',
    'cli/node_modules/tar/package.json',
    'cli/node_modules/tar/dist/esm/index.min.js',
    'cli/node_modules/@ccc/contracts/src/jcs.js',
  ]) assert.ok(archivePaths.includes(expected), `missing packaged path: ${expected}`);
  const edgeDocument = await readFile(join(stagedRoot, 'edge-component-manifest.json'), 'utf8');
  await verifyEdgeComponentManifest({
    document: edgeDocument,
    stagedRoot,
    bundleRow,
    trustStore: await loadReleaseTrustStore(signing.trustJson),
    now: new Date(bundle.publishedAt),
  });
  assert.equal(sha256(edgeDocument), bundleRow.edgeComponentManifestSha256);

  const protectedRoot = join(root, 'protected-staged');
  const packagedExtractor = await import(pathToFileURL(
    join(stagedRoot, 'cli/scripts/release/safe-extract.mjs'),
  ).href);
  await packagedExtractor.extractReleaseArchive({
    archivePath: join(outDir, basename),
    destination: protectedRoot,
  });
  assert.equal(
    await readFile(join(protectedRoot, 'edge-component-manifest.json'), 'utf8'),
    edgeDocument,
  );

  try {
    await runFile(join(protectedRoot, 'ccc-cloud.mjs'), [], {
      cwd: protectedRoot,
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin` },
    });
    assert.fail('packaged installer unexpectedly succeeded without credentials');
  } catch (error) {
    assert.equal(error.code, 6, error.stderr);
    assert.equal(error.stdout, '');
    assert.match(error.stderr, /^\[OWNER_EVIDENCE_MISSING\] /u);
    assert.doesNotMatch(error.stderr, /ERR_MODULE_NOT_FOUND|Cannot find (module|package)/u);
  }

  const floor = JSON.parse(floorDocument);
  assert.deepEqual(floor, {
    schemaVersion: 1,
    lastTrustedTime: bundle.publishedAt,
    sequenceFloor: bundle.sequenceFloor,
  });
}));

test('accepts exactly the five documented flags and reads signing material only from the environment', async t => fixture(async ({ componentRoot, outDir, signing }) => {
  for (const [name, cliArgs] of [
    ['unknown', [...args(componentRoot, outDir), '--root-key', 'secret']],
    ['duplicate', [...args(componentRoot, outDir), '--channel', 'dev']],
    ['missing', args(componentRoot, outDir).slice(0, -2)],
    ['assignment syntax', args(componentRoot, outDir).map((value, index) => index === 0 ? `${value}=${componentRoot}` : value).slice(0, 9)],
  ]) {
    await t.test(name, async () => {
      const failedOut = `${outDir}-${name}`;
      const result = await rejectedRun(cliArgs.map(value => value === outDir ? failedOut : value), signing.env);
      assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, /PRIVATE KEY|BEGIN PRIVATE|release-key-test/u);
      assert.deepEqual(await filesOrEmpty(failedOut), []);
    });
  }

  for (const variable of [
    'CCC_RELEASE_SIGNING_PRIVATE_KEY',
    'CCC_RELEASE_ROOT_SIGNING_PRIVATE_KEY',
    'CCC_RELEASE_TRUST_STORE',
  ]) {
    await t.test(`missing ${variable}`, async () => {
      const env = { ...signing.env };
      delete env[variable];
      const failedOut = `${outDir}-${variable}`;
      const result = await rejectedRun(args(componentRoot, failedOut), env);
      assert.equal(result.stdout, '');
      assert.doesNotMatch(result.stderr, /PRIVATE KEY|BEGIN PRIVATE|release-key-test/u);
      assert.deepEqual(await filesOrEmpty(failedOut), []);
    });
  }

  await t.test('release key mislabeled as root', async () => {
    const value = JSON.parse(signing.trustJson);
    value.keys.find(key => key.role === 'release').role = 'root';
    const failedOut = `${outDir}-release-role-root`;
    const result = await rejectedRun(args(componentRoot, failedOut), {
      ...signing.env,
      CCC_RELEASE_TRUST_STORE: JSON.stringify(value),
    });
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, 'BUILD_FAILED\n');
    assert.deepEqual(await filesOrEmpty(failedOut), []);
  });
}));

test('never overwrites an existing destination and removes every new output on failure', async () => fixture(async ({ componentRoot, outDir, signing }) => {
  await mkdir(outDir);
  const releaseTarget = target();
  const basename = `community-cloud-cli-community-cloud-0.9.0-dev.3-${releaseTarget.platform}-${releaseTarget.arch}.tar.gz`;
  const manifestPath = join(outDir, `${basename}.manifest.json`);
  await writeFile(manifestPath, 'keep me');

  const result = await rejectedRun(args(componentRoot, outDir), signing.env);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /PRIVATE KEY|BEGIN PRIVATE|release-key-test/u);
  assert.deepEqual(await readdir(outDir), [`${basename}.manifest.json`]);
  assert.equal(await readFile(manifestPath, 'utf8'), 'keep me');
}));

test('removes a partially published output set after a later exclusive link fails', async () => fixture(async ({ root, outDir }) => {
  await mkdir(outDir);
  const first = join(root, 'first');
  const second = join(root, 'second');
  await writeFile(first, 'first');
  await writeFile(second, 'second');
  const release = await import('./build-bundle.mjs');
  let links = 0;
  await assert.rejects(
    release.publishExclusive([
      { name: 'first.out', path: first },
      { name: 'second.out', path: second },
    ], outDir, {
      linkFile: async (source, destination) => {
        links += 1;
        if (links === 2) throw new Error('injected publication failure');
        await link(source, destination);
      },
    }),
    error => error?.code === 'BUILD_FAILED',
  );
  assert.equal(links, 2);
  assert.deepEqual(await readdir(outDir), []);
}));

test('derives the packaged module closure and rejects unknown bare dependencies', async () => fixture(async ({ root }) => {
  const sourceRoot = join(root, 'runtime-source');
  const destinationRoot = join(root, 'runtime-package');
  await mkdir(join(sourceRoot, 'nested'), { recursive: true });
  await writeFile(join(sourceRoot, 'entry.mjs'), "import './nested/new-runtime.mjs';\n");
  await writeFile(join(sourceRoot, 'nested', 'new-runtime.mjs'), 'export const included = true;\n');
  const release = await import('./build-bundle.mjs');
  await release.copyModuleClosure({
    entryPath: join(sourceRoot, 'entry.mjs'),
    sourceRoot,
    destinationRoot,
  });
  assert.equal(
    await readFile(join(destinationRoot, 'nested', 'new-runtime.mjs'), 'utf8'),
    'export const included = true;\n',
  );

  await writeFile(join(sourceRoot, 'unknown.mjs'), "import 'not-vendored';\n");
  await assert.rejects(
    release.copyModuleClosure({
      entryPath: join(sourceRoot, 'unknown.mjs'),
      sourceRoot,
      destinationRoot: join(root, 'unknown-package'),
    }),
    error => error?.code === 'BUILD_FAILED',
  );
}));
