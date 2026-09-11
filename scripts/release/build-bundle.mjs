#!/usr/bin/env node

import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import {
  createHash, createPrivateKey, createPublicKey, sign,
} from 'node:crypto';
import {
  copyFile, link, lstat, mkdir, mkdtemp, open, readdir, rm, writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { canonicalizeJcs } from '@ccc/contracts/jcs';

import {
  EDGE_PROTOCOL_VERSION,
  buildEdgeComponentManifest,
  verifyEdgeComponentManifest,
} from './edge-component-manifest.mjs';
import {
  parseArtifactBasename,
  verifyReleaseBundle,
  verifyReleaseManifest,
} from './release-manifest.mjs';
import { PINNED_RELEASE_ORIGIN } from './release-origin.mjs';
import { loadReleaseTrustStore, selectSigningKey } from './release-trust.mjs';

const execFileAsync = promisify(execFile);
const MANIFEST_DOMAIN = 'CCC-RELEASE-MANIFEST-V1\0';
const BUNDLE_DOMAIN = 'CCC-RELEASE-BUNDLE-V1\0';
const FLAGS = new Set(['--component-root', '--out-dir', '--version', '--sequence', '--channel']);
const MAX_UINT64 = (1n << 64n) - 1n;
const CONTRACTS_ROOT = fileURLToPath(new URL('../../packages/contracts/src/', import.meta.url));
const TAR_PATH = '/usr/bin/tar';
const TAR_ENV = Object.freeze({
  COPYFILE_DISABLE: '1',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
  PATH: '/usr/bin:/bin',
});

class BuildBundleError extends Error {
  constructor() {
    super('BUILD_FAILED');
    this.name = 'BuildBundleError';
    this.code = 'BUILD_FAILED';
  }
}

function fail() {
  throw new BuildBundleError();
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function document(value) {
  return canonicalizeJcs(value);
}

function signatureMessage(domain, value) {
  return Buffer.concat([
    Buffer.from(domain, 'ascii'),
    Buffer.from(document(value), 'utf8'),
  ]);
}

function signed(value, signatureField, domain, privateKey) {
  return {
    ...value,
    [signatureField]: sign(null, signatureMessage(domain, value), privateKey).toString('base64url'),
  };
}

function parseFlags(argv) {
  if (argv.length !== FLAGS.size * 2) fail();
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!FLAGS.has(flag) || Object.hasOwn(values, flag)
      || typeof value !== 'string' || value.length === 0) fail();
    values[flag] = value;
  }
  if (Object.keys(values).length !== FLAGS.size) fail();
  return values;
}

function releaseTarget() {
  if (process.platform === 'darwin' && (process.arch === 'arm64' || process.arch === 'x64')) {
    return { platform: 'macos', arch: process.arch };
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return { platform: 'ubuntu', arch: 'x64' };
  }
  fail();
}

function validateInputs({ version, sequence, channel, target }) {
  if (channel !== 'dev' && channel !== 'beta') fail();
  if (!/^[1-9][0-9]*$/u.test(sequence)) fail();
  try {
    if (BigInt(sequence) > MAX_UINT64) fail();
  } catch {
    fail();
  }
  const basename = `community-cloud-cli-community-cloud-${version}-${target.platform}-${target.arch}.tar.gz`;
  const parsed = parseArtifactBasename(`${PINNED_RELEASE_ORIGIN}/artifacts/${basename}`);
  if (parsed.version !== version || !version.includes(`-${channel}`)) fail();
  return basename;
}

function privateKeyFromEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) fail();
  try {
    const key = createPrivateKey(value);
    if (key.asymmetricKeyType !== 'ed25519') fail();
    return key;
  } catch (error) {
    if (error instanceof BuildBundleError) throw error;
    fail();
  }
}

async function signingState(edgeManifest) {
  try {
    const trustValue = process.env.CCC_RELEASE_TRUST_STORE;
    if (typeof trustValue !== 'string' || trustValue.length === 0) fail();
    const trustStore = await loadReleaseTrustStore(trustValue);
    const releasePrivateKey = privateKeyFromEnvironment('CCC_RELEASE_SIGNING_PRIVATE_KEY');
    const releasePublicKey = createPublicKey(releasePrivateKey).export({ format: 'jwk' }).x;
    const releaseRecord = trustStore.keys.find(record => record.publicKey === releasePublicKey);
    if (releaseRecord === undefined || releaseRecord.keyId !== edgeManifest.signingKeyId) fail();
    selectSigningKey(trustStore, releaseRecord.keyId, new Date());

    const rootPrivateKey = privateKeyFromEnvironment('CCC_RELEASE_ROOT_SIGNING_PRIVATE_KEY');
    const rootPublicKey = createPublicKey(rootPrivateKey).export({ format: 'jwk' }).x;
    return { trustStore, releasePrivateKey, releaseKeyId: releaseRecord.keyId, rootPrivateKey, rootPublicKey };
  } catch (error) {
    if (error instanceof BuildBundleError) throw error;
    fail();
  }
}

async function contractsSha256() {
  const records = [];
  async function visit(directory, prefix = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const absolute = join(directory, entry.name);
      const info = await lstat(absolute);
      if (entry.isSymbolicLink() || info.isSymbolicLink()) fail();
      if (entry.isDirectory() && info.isDirectory()) await visit(absolute, path);
      else if (entry.isFile() && info.isFile()) records.push({ path, sha256: sha256(await readFileSafe(absolute)) });
      else fail();
    }
  }
  await visit(CONTRACTS_ROOT);
  records.sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
  return sha256(document(records));
}

async function readFileSafe(path) {
  let handle;
  try {
    handle = await open(path, 'r');
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1) fail();
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || after.nlink !== 1) fail();
    return bytes;
  } finally {
    await handle?.close();
  }
}

async function requireOutputDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) fail();
}

async function requireAbsent(paths) {
  for (const path of paths) {
    try {
      await lstat(path);
      fail();
    } catch (error) {
      if (error instanceof BuildBundleError) throw error;
      if (error?.code !== 'ENOENT') fail();
    }
  }
}

async function syncFile(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function publishExclusive(files, outDir) {
  const destinations = files.map(file => join(outDir, file.name));
  await requireAbsent(destinations);
  const created = [];
  try {
    for (let index = 0; index < files.length; index += 1) {
      await syncFile(files[index].path);
      await link(files[index].path, destinations[index]);
      created.push(destinations[index]);
    }
    const directory = await open(outDir, 'r');
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
    await Promise.all(created.map(path => rm(path, { force: true })));
    fail();
  }
}

async function copyComponents(componentRoot, stagingRoot, components) {
  for (const component of components) {
    const destination = join(stagingRoot, ...component.path.split('/'));
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    await copyFile(join(componentRoot, ...component.path.split('/')), destination);
  }
}

async function build({ componentRoot, outDir, version, sequence, channel }) {
  const target = releaseTarget();
  const artifactName = validateInputs({ version, sequence, channel, target });
  const manifestName = `${artifactName}.manifest.json`;
  await requireOutputDirectory(outDir);
  const workRoot = await mkdtemp(join(outDir, '.ccc-release-'));
  const stagingRoot = join(workRoot, 'staging');
  const artifactPath = join(workRoot, artifactName);
  const manifestPath = join(workRoot, manifestName);
  const bundlePath = join(workRoot, 'release-bundle.json');
  const floorPath = join(workRoot, 'release-floor.json');

  try {
    const edgeManifest = await buildEdgeComponentManifest(componentRoot);
    const keys = await signingState(edgeManifest);
    await mkdir(stagingRoot, { mode: 0o700 });
    await copyComponents(componentRoot, stagingRoot, edgeManifest.components);
    const edgeDocument = document(edgeManifest);
    await writeFile(join(stagingRoot, 'edge-component-manifest.json'), edgeDocument, { mode: 0o600 });
    const edgeComponentManifestSha256 = sha256(edgeDocument);
    await verifyEdgeComponentManifest({
      document: edgeDocument,
      stagedRoot: stagingRoot,
      bundleRow: { edgeComponentManifestSha256 },
      trustStore: keys.trustStore,
    });

    await execFileAsync(TAR_PATH, ['-czf', artifactPath, '-C', stagingRoot, '.'], {
      env: TAR_ENV,
    });
    const artifactBytes = await readFileSafe(artifactPath);
    const artifactSha256 = sha256(artifactBytes);
    const publishedAt = new Date();
    const expiresAt = new Date(publishedAt.getTime() + 7 * 24 * 60 * 60 * 1_000);
    const artifactUrl = `${PINNED_RELEASE_ORIGIN}/artifacts/${artifactName}`;
    const manifestUrl = `${PINNED_RELEASE_ORIGIN}/manifests/${manifestName}`;
    const releaseManifest = signed({
      version,
      sequence,
      channel,
      artifactUrl,
      artifactSha256,
      artifactBytes: artifactBytes.byteLength,
      minSchemaVersion: 0,
      maxSchemaVersion: 0,
      publishedAt: publishedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      signingKeyId: keys.releaseKeyId,
    }, 'ed25519Signature', MANIFEST_DOMAIN, keys.releasePrivateKey);
    const manifestDocument = document(releaseManifest);
    await writeFile(manifestPath, manifestDocument, { mode: 0o600 });
    const manifestSha256 = sha256(manifestDocument);
    const contractsHash = await contractsSha256();
    const bundleRow = {
      family: 'community-cloud-cli',
      manifestUrl,
      manifestSha256,
      edgeComponentManifestSha256,
      mode: 'community-cloud',
      platform: target.platform,
      arch: target.arch,
      artifactSha256,
      artifactBytes: artifactBytes.byteLength,
      minSchemaVersion: 0,
      maxSchemaVersion: 0,
    };
    const sequenceFloor = [{
      family: 'community-cloud-cli',
      mode: 'community-cloud',
      platform: target.platform,
      arch: target.arch,
      minimumSequence: sequence,
    }];
    const releaseBundle = signed({
      schemaVersion: 1,
      bundleId: `ccc-${channel}-${version}-${sequence}-${artifactSha256.slice(0, 12)}`,
      version,
      sequence,
      channel,
      publishedAt: publishedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      protocol: {
        apiName: 'ccc-http-api',
        apiVersion: EDGE_PROTOCOL_VERSION,
        contractsSha256: contractsHash,
        peers: ['cloud-cli', 'edge'].map(name => ({
          name,
          protocolVersion: EDGE_PROTOCOL_VERSION,
          contractsSha256: contractsHash,
        })),
      },
      entries: [{
        family: 'community-cloud-cli',
        artifacts: [{
          manifestUrl: bundleRow.manifestUrl,
          manifestSha256: bundleRow.manifestSha256,
          edgeComponentManifestSha256: bundleRow.edgeComponentManifestSha256,
          mode: bundleRow.mode,
          platform: bundleRow.platform,
          arch: bundleRow.arch,
          artifactSha256: bundleRow.artifactSha256,
          artifactBytes: bundleRow.artifactBytes,
          minSchemaVersion: bundleRow.minSchemaVersion,
          maxSchemaVersion: bundleRow.maxSchemaVersion,
        }],
      }],
      sequenceFloor,
      modelManifestSha256: sha256(document([])),
    }, 'offlineRootSignature', BUNDLE_DOMAIN, keys.rootPrivateKey);
    const bundleDocument = document(releaseBundle);
    await writeFile(bundlePath, bundleDocument, { mode: 0o600 });

    await verifyReleaseBundle({
      document: bundleDocument,
      rootKeys: { injected: keys.rootPublicKey },
      revokedRootKeyIds: [],
      now: publishedAt,
      channel,
    });
    await verifyReleaseManifest({
      document: manifestDocument,
      trustStore: keys.trustStore,
      now: publishedAt,
      expectedTuple: {
        family: 'community-cloud-cli', mode: 'community-cloud',
        platform: target.platform, arch: target.arch,
      },
      bundleEntry: bundleRow,
    });

    const floorDocument = document({
      schemaVersion: 1,
      lastTrustedTime: publishedAt.toISOString(),
      sequenceFloor,
    });
    await writeFile(floorPath, floorDocument, { mode: 0o600 });
    await publishExclusive([
      { name: artifactName, path: artifactPath },
      { name: manifestName, path: manifestPath },
      { name: 'release-bundle.json', path: bundlePath },
      { name: 'release-floor.json', path: floorPath },
    ], outDir);

    return {
      version,
      sequence,
      componentCount: edgeManifest.components.length,
      artifactCount: 1,
      artifactSha256,
      manifestSha256,
      edgeComponentManifestSha256,
      bundleSha256: sha256(bundleDocument),
      floorSha256: sha256(floorDocument),
    };
  } catch (error) {
    if (error instanceof BuildBundleError) throw error;
    fail();
  } finally {
    await rm(workRoot, { recursive: true, force: true });
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const result = await build({
    componentRoot: flags['--component-root'],
    outDir: flags['--out-dir'],
    version: flags['--version'],
    sequence: flags['--sequence'],
    channel: flags['--channel'],
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(() => {
    process.stderr.write('BUILD_FAILED\n');
    process.exitCode = 1;
  });
}
