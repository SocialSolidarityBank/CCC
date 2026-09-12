import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { canonicalizeJcs } from '@ccc/contracts/jcs';

import {
  parseArtifactBasename,
  requireExpectedTuple,
  verifyReleaseBundle,
  verifyReleaseManifest,
} from './release-manifest.mjs';
import { loadReleaseTrustStore } from './release-trust.mjs';
import { PINNED_RELEASE_ORIGIN } from './release-origin.mjs';

const NOW = new Date('2026-09-11T12:00:00.000Z');
const HASH_A = '11'.repeat(32);
const HASH_B = '22'.repeat(32);
const HASH_C = '33'.repeat(32);
const ABSENT_MODEL_MANIFEST = '0'.repeat(64);
const MANIFEST_DOMAIN = 'CCC-RELEASE-MANIFEST-V1\0';
const BUNDLE_DOMAIN = 'CCC-RELEASE-BUNDLE-V1\0';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function keyPair(keyId) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const jwk = publicKey.export({ format: 'jwk' });
  return { keyId, privateKey, publicKey: jwk.x };
}

function signed(value, signatureField, domain, privateKey) {
  const { [signatureField]: _signature, ...unsigned } = value;
  const message = Buffer.concat([
    Buffer.from(domain, 'ascii'),
    Buffer.from(canonicalizeJcs(unsigned), 'utf8'),
  ]);
  return {
    ...unsigned,
    [signatureField]: sign(null, message, privateKey).toString('base64url'),
  };
}

const releaseKey = keyPair('release-key-1');
const rootKey = keyPair('root-key-1');
const expectedTuple = Object.freeze({
  family: 'community-cloud-cli',
  mode: 'community-cloud',
  platform: 'macos',
  arch: 'arm64',
});
const bundleEntry = Object.freeze({
  family: expectedTuple.family,
  manifestUrl: `${PINNED_RELEASE_ORIGIN}/manifests/community-cloud-cli.json`,
  manifestSha256: sha256(JSON.stringify(manifest())),
  edgeComponentManifestSha256: HASH_C,
  mode: expectedTuple.mode,
  platform: expectedTuple.platform,
  arch: expectedTuple.arch,
  artifactSha256: HASH_A,
  artifactBytes: 1234,
  minSchemaVersion: 1,
  maxSchemaVersion: 3,
});

const activeTrustStore = await loadReleaseTrustStore(JSON.stringify({ keys: [{
  keyId: releaseKey.keyId,
  publicKey: releaseKey.publicKey,
  role: 'release',
  status: 'active',
  notBefore: '2026-09-01T00:00:00.000Z',
  notAfter: '2026-10-01T00:00:00.000Z',
}, {
  keyId: rootKey.keyId,
  publicKey: rootKey.publicKey,
  role: 'root',
  status: 'active',
  notBefore: '2026-09-01T00:00:00.000Z',
  notAfter: '2026-10-01T00:00:00.000Z',
}] }));

function trustStore() {
  return activeTrustStore;
}

function manifest(overrides = {}) {
  return signed({
    version: '1.2.3-dev.1',
    sequence: '7',
    channel: 'dev',
    artifactUrl: `${PINNED_RELEASE_ORIGIN}/artifacts/community-cloud-cli-community-cloud-1.2.3-dev.1-macos-arm64.tar.gz`,
    artifactSha256: HASH_A,
    artifactBytes: 1234,
    minSchemaVersion: 1,
    maxSchemaVersion: 3,
    publishedAt: '2026-09-11T00:00:00.000Z',
    expiresAt: '2026-09-20T00:00:00.000Z',
    signingKeyId: releaseKey.keyId,
    ...overrides,
  }, 'ed25519Signature', MANIFEST_DOMAIN, releaseKey.privateKey);
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => error instanceof Error && error.code === code && error.message === code);
}

function mutateSignedManifest(change) {
  const value = manifest();
  const { ed25519Signature: _signature, ...unsigned } = value;
  change(unsigned);
  return signed(unsigned, 'ed25519Signature', MANIFEST_DOMAIN, releaseKey.privateKey);
}

test('verifies the exact twelve-field signed ReleaseManifestV1', async () => {
  const value = manifest();
  const document = JSON.stringify(Object.fromEntries(Object.entries(value).reverse()));
  const result = await verifyReleaseManifest({
    document, trustStore: trustStore(), now: NOW, expectedTuple,
    bundleEntry: { ...bundleEntry, manifestSha256: sha256(document) },
  });
  assert.deepEqual(result, value);
  assert.equal(Object.keys(result).length, 12);
});

test('rejects a manifest signed by an active root-role key', async () => {
  const value = signed(manifest({
    signingKeyId: rootKey.keyId,
  }), 'ed25519Signature', MANIFEST_DOMAIN, rootKey.privateKey);
  const document = JSON.stringify(value);
  await rejectsCode(verifyReleaseManifest({
    document, trustStore: trustStore(), now: NOW, expectedTuple,
    bundleEntry: { ...bundleEntry, manifestSha256: sha256(document) },
  }), 'SIGNATURE_INVALID');
});

test('rejects missing, extra, wrong-typed and unknown-enum manifest fields', async t => {
  const cases = [
    ['missing', value => { delete value.artifactBytes; }],
    ['extra', value => { value.extra = true; }],
    ['wrong type', value => { value.artifactBytes = '1234'; }],
    ['unknown channel', value => { value.channel = 'nightly'; }],
  ];
  for (const [name, change] of cases) {
    await t.test(name, async () => rejectsCode(verifyReleaseManifest({
      document: JSON.stringify(mutateSignedManifest(change)), trustStore: trustStore(), now: NOW,
      expectedTuple, bundleEntry,
    }), 'SIGNATURE_INVALID'));
  }
});

test('rejects duplicate JSON keys and oversized documents before verification', async () => {
  const value = manifest();
  const duplicate = JSON.stringify(value).replace('{', `{"version":"${value.version}",`);
  await rejectsCode(verifyReleaseManifest({
    document: duplicate, trustStore: trustStore(), now: NOW, expectedTuple, bundleEntry,
  }), 'SIGNATURE_INVALID');
  await rejectsCode(verifyReleaseManifest({
    document: `{"padding":"${'x'.repeat(1_048_576)}"}`, trustStore: trustStore(), now: NOW,
    expectedTuple, bundleEntry,
  }), 'SIGNATURE_INVALID');
});

test('enforces manifest sequence, SemVer, channel prerelease and UTF-8 string limits', async t => {
  const cases = [
    ['zero sequence', value => { value.sequence = '0'; }],
    ['noncanonical sequence', value => { value.sequence = '07'; }],
    ['uint64 overflow', value => { value.sequence = '18446744073709551616'; }],
    ['invalid semver', value => { value.version = '01.2.3-dev.1'; }],
    ['numeric prerelease leading zero', value => { value.version = '1.2.3-dev.01'; }],
    ['wrong prerelease channel', value => { value.version = '1.2.3-beta.1'; }],
    ['stable prerelease', value => { value.channel = 'stable'; value.version = '1.2.3-dev.1'; }],
    ['oversized string', value => { value.signingKeyId = '가'.repeat(1366); }],
  ];
  for (const [name, change] of cases) {
    await t.test(name, async () => rejectsCode(verifyReleaseManifest({
      document: JSON.stringify(mutateSignedManifest(change)), trustStore: trustStore(), now: NOW,
      expectedTuple, bundleEntry,
    }), 'SIGNATURE_INVALID'));
  }
});

test('accepts digit-leading alphanumeric SemVer prerelease identifiers', async () => {
  const value = manifest({
    version: '1.2.3-dev.1a',
    artifactUrl: `${PINNED_RELEASE_ORIGIN}/artifacts/community-cloud-cli-community-cloud-1.2.3-dev.1a-macos-arm64.tar.gz`,
  });
  const document = JSON.stringify(value);
  assert.deepEqual(await verifyReleaseManifest({
    document, trustStore: trustStore(), now: NOW, expectedTuple,
    bundleEntry: { ...bundleEntry, manifestSha256: sha256(document) },
  }), value);
});

test('enforces publishedAt <= now < expiresAt and a maximum thirty-day lifetime', async t => {
  const cases = [
    ['future', { publishedAt: '2026-09-11T12:00:00.001Z' }],
    ['expired', { expiresAt: NOW.toISOString() }],
    ['reversed', { publishedAt: '2026-09-12T00:00:00.000Z', expiresAt: '2026-09-11T00:00:00.000Z' }],
    ['too long', { publishedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-10-02T00:00:00.001Z' }],
    ['non-UTC RFC3339', { publishedAt: '2026-09-11T09:00:00+09:00' }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => rejectsCode(verifyReleaseManifest({
      document: JSON.stringify(manifest(overrides)), trustStore: trustStore(), now: NOW,
      expectedTuple, bundleEntry,
    }), name === 'expired' ? 'MANIFEST_EXPIRED' : 'SIGNATURE_INVALID'));
  }
});

test('rejects invalid or incompatible schema ranges', async () => {
  await rejectsCode(verifyReleaseManifest({
    document: JSON.stringify(manifest({ minSchemaVersion: 4, maxSchemaVersion: 3 })),
    trustStore: trustStore(), now: NOW, expectedTuple, bundleEntry,
  }), 'SCHEMA_INCOMPATIBLE');
  await rejectsCode(verifyReleaseManifest({
    document: JSON.stringify(manifest({ maxSchemaVersion: 4 })),
    trustStore: trustStore(), now: NOW, expectedTuple, bundleEntry,
  }), 'SCHEMA_INCOMPATIBLE');
});

test('pins both manifest and artifact URLs to PINNED_RELEASE_ORIGIN', async () => {
  const basename = 'community-cloud-cli-community-cloud-1.2.3-dev.1-macos-arm64.tar.gz';
  for (const [artifactUrl, manifestUrl] of [
    [`http://${new URL(PINNED_RELEASE_ORIGIN).host}/artifacts/${basename}`, bundleEntry.manifestUrl],
    [`https://other.example.test/artifacts/${basename}`, 'https://other.example.test/manifests/cli.json'],
    [`${PINNED_RELEASE_ORIGIN}/artifacts/${basename}`, 'https://other.example.test/manifests/cli.json'],
    [`${PINNED_RELEASE_ORIGIN.replace('https://', 'https://user:secret@')}/artifacts/${basename}`, bundleEntry.manifestUrl],
  ]) {
    await rejectsCode(verifyReleaseManifest({
      document: JSON.stringify(manifest({ artifactUrl })), trustStore: trustStore(), now: NOW,
      expectedTuple, bundleEntry: { ...bundleEntry, manifestUrl },
    }), 'SIGNATURE_INVALID');
  }
});

test('binds manifest artifact hash, bytes and schema to the selected bundle entry', async t => {
  for (const [name, overrides] of [
    ['hash', { artifactSha256: HASH_B }],
    ['bytes', { artifactBytes: 1235 }],
    ['schema', { maxSchemaVersion: 2 }],
  ]) {
    await t.test(name, async () => rejectsCode(verifyReleaseManifest({
      document: JSON.stringify(manifest(overrides)), trustStore: trustStore(), now: NOW,
      expectedTuple, bundleEntry,
    }), name === 'schema' ? 'SCHEMA_INCOMPATIBLE' : 'ARTIFACT_NOT_INDEXED'));
  }
});

test('rejects an altered and re-signed manifest not indexed by the bundle digest', async () => {
  const altered = manifest({ sequence: '8' });
  await rejectsCode(verifyReleaseManifest({
    document: JSON.stringify(altered), trustStore: trustStore(), now: NOW,
    expectedTuple, bundleEntry,
  }), 'ARTIFACT_NOT_INDEXED');
});

test('rejects a manifest file whose bytes redirect the parser to another file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ccc-release-manifest-'));
  try {
    const target = join(directory, 'target.json');
    const indirect = join(directory, 'indirect.json');
    await writeFile(target, JSON.stringify(manifest()), 'utf8');
    await writeFile(indirect, target, 'utf8');
    await rejectsCode(verifyReleaseManifest({
      document: indirect, trustStore: trustStore(), now: NOW, expectedTuple,
      bundleEntry: { ...bundleEntry, manifestSha256: sha256(target) },
    }), 'SIGNATURE_INVALID');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('binds the signed manifest version to the artifact basename', async () => {
  await rejectsCode(verifyReleaseManifest({
    document: JSON.stringify(manifest({
      artifactUrl: `${PINNED_RELEASE_ORIGIN}/artifacts/community-cloud-cli-community-cloud-1.2.4-dev.1-macos-arm64.tar.gz`,
    })),
    trustStore: trustStore(), now: NOW, expectedTuple, bundleEntry,
  }), 'ARTIFACT_IDENTITY_MISMATCH');
});

test('verifies the fixed manifest domain and canonical unpadded base64url signature', async () => {
  const wrongDomain = signed(manifest(), 'ed25519Signature', 'WRONG\0', releaseKey.privateKey);
  await rejectsCode(verifyReleaseManifest({
    document: JSON.stringify(wrongDomain), trustStore: trustStore(), now: NOW, expectedTuple, bundleEntry,
  }), 'SIGNATURE_INVALID');
  const badEncoding = { ...manifest(), ed25519Signature: `${manifest().ed25519Signature}=` };
  await rejectsCode(verifyReleaseManifest({
    document: JSON.stringify(badEncoding), trustStore: trustStore(), now: NOW, expectedTuple, bundleEntry,
  }), 'SIGNATURE_INVALID');
});

test('parses each allowed artifact basename family and platform suffix', () => {
  const cases = [
    ['community-cloud-cli-community-cloud-1.2.3-dev.1-macos-arm64.tar.gz', 'community-cloud-cli', 'community-cloud', 'macos', 'arm64', 'tar.gz'],
    ['community-cloud-cli-community-cloud-1.2.3-beta.2-ubuntu-x64.tar.gz', 'community-cloud-cli', 'community-cloud', 'ubuntu', 'x64', 'tar.gz'],
    ['local-single-local-single-1.2.3-windows-x64.exe', 'local-single', 'local-single', 'windows', 'x64', 'exe'],
    ['local-office-server-local-office-1.2.3-windows-x64.exe', 'local-office-server', 'local-office', 'windows', 'x64', 'exe'],
    ['local-office-client-local-office-1.2.3-windows-x64.exe', 'local-office-client', 'local-office', 'windows', 'x64', 'exe'],
    ['processing-agent-community-cloud-1.2.3-windows-x64.exe', 'processing-agent', 'community-cloud', 'windows', 'x64', 'exe'],
    ['processing-agent-local-single-1.2.3-windows-x64.exe', 'processing-agent', 'local-single', 'windows', 'x64', 'exe'],
    ['processing-agent-local-office-1.2.3-windows-x64.exe', 'processing-agent', 'local-office', 'windows', 'x64', 'exe'],
  ];
  for (const [basename, family, mode, platform, arch, ext] of cases) {
    assert.deepEqual(parseArtifactBasename(`https://release.example.test/nested/${basename}`), {
      family, mode, version: basename.match(/-(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)-(?:macos|ubuntu|windows)-/u)[1],
      platform, arch, ext,
    });
  }
});

test('percent-decodes exactly once and uses only the last decoded path segment', () => {
  assert.equal(parseArtifactBasename(
    'https://release.example.test/ignored/processing-agent-local-office-%31.2.3-windows-x64.exe',
  ).version, '1.2.3');
  for (const url of [
    'https://release.example.test/a/./community-cloud-cli-community-cloud-1.2.3-macos-arm64.tar.gz',
    'https://release.example.test/a/%2e%2e/community-cloud-cli-community-cloud-1.2.3-macos-arm64.tar.gz',
    'https://release.example.test/a\\../community-cloud-cli-community-cloud-1.2.3-macos-arm64.tar.gz',
    'https://release.example.test/%252e%252e/community-cloud-cli-community-cloud-1.2.3-macos-arm64.tar.gz',
    'https://release.example.test/community-cloud-cli-community-cloud-1.2.3-macos-arm64.tar.gz?download=1',
    'https://release.example.test/community-cloud-cli-community-cloud-1.2.3-macos-arm64.tar.gz#fragment',
  ]) assert.throws(() => parseArtifactBasename(url), error => error.code === 'ARTIFACT_IDENTITY_MISMATCH');
});

test('rejects case variants, unknown families and disallowed family/mode or platform/arch pairs', () => {
  for (const basename of [
    'Community-cloud-cli-community-cloud-1.2.3-macos-arm64.tar.gz',
    'unknown-community-cloud-1.2.3-macos-arm64.tar.gz',
    'community-cloud-cli-local-office-1.2.3-macos-arm64.tar.gz',
    'local-single-local-single-1.2.3-macos-arm64.tar.gz',
    'processing-agent-local-office-1.2.3-ubuntu-arm64.tar.gz',
    'processing-agent-local-office-1.2.3-windows-arm64.exe',
  ]) assert.throws(
    () => parseArtifactBasename(`https://release.example.test/${basename}`),
    error => error.code === 'ARTIFACT_IDENTITY_MISMATCH',
  );
});

test('tuple mismatch is ARTIFACT_IDENTITY_MISMATCH and mutates neither input', () => {
  const parsed = Object.freeze(parseArtifactBasename(
    'https://release.example.test/community-cloud-cli-community-cloud-1.2.3-macos-arm64.tar.gz',
  ));
  const expected = Object.freeze({ ...expectedTuple, arch: 'x64' });
  const before = structuredClone(parsed);
  assert.throws(() => requireExpectedTuple(parsed, expected), error => error.code === 'ARTIFACT_IDENTITY_MISMATCH');
  assert.deepEqual(parsed, before);
});

const familyDefaults = Object.freeze({
  'community-cloud-cli': { mode: 'community-cloud', platform: 'macos', arch: 'arm64' },
  'local-single': { mode: 'local-single', platform: 'windows', arch: 'x64' },
  'local-office-server': { mode: 'local-office', platform: 'windows', arch: 'x64' },
  'local-office-client': { mode: 'local-office', platform: 'windows', arch: 'x64' },
  'processing-agent': { mode: 'community-cloud', platform: 'windows', arch: 'x64' },
});

function artifact(family, overrides = {}) {
  return {
    manifestUrl: `${PINNED_RELEASE_ORIGIN}/manifests/${family}.json`,
    manifestSha256: HASH_B,
    edgeComponentManifestSha256: family === 'community-cloud-cli' ? HASH_C : null,
    ...familyDefaults[family],
    artifactSha256: HASH_A,
    artifactBytes: 1234,
    minSchemaVersion: 1,
    maxSchemaVersion: 3,
    ...overrides,
  };
}

function peer(name) {
  return { name, protocolVersion: '1.0.0', contractsSha256: HASH_A };
}

const peerByFamily = Object.freeze({
  'community-cloud-cli': ['cloud-cli', 'edge'],
  'local-single': [],
  'local-office-server': ['office-server'],
  'local-office-client': ['office-client'],
  'processing-agent': ['agent'],
});

function unsignedBundle(channel = 'stable', families = Object.keys(familyDefaults)) {
  const entries = families.map(family => ({ family, artifacts: [artifact(family)] }));
  return {
    schemaVersion: 1,
    bundleId: `bundle-${channel}-7`,
    version: channel === 'stable' ? '1.2.3' : `1.2.3-${channel}.1`,
    sequence: '7',
    channel,
    publishedAt: '2026-09-11T00:00:00.000Z',
    expiresAt: '2026-09-20T00:00:00.000Z',
    protocol: {
      apiName: 'ccc-http-api',
      apiVersion: '1.0.0',
      contractsSha256: HASH_A,
      peers: [...new Set(families.flatMap(family => peerByFamily[family]))].map(peer),
    },
    entries,
    sequenceFloor: entries.flatMap(entry => entry.artifacts.map(row => ({
      family: entry.family,
      mode: row.mode,
      platform: row.platform,
      arch: row.arch,
      minimumSequence: '7',
    }))),
    modelManifestSha256: families.includes('processing-agent') ? HASH_C : ABSENT_MODEL_MANIFEST,
  };
}

function bundle(channel = 'stable', families) {
  return signed(unsignedBundle(channel, families), 'offlineRootSignature', BUNDLE_DOMAIN, rootKey.privateKey);
}

function verifyBundle(value, options = {}) {
  return verifyReleaseBundle({
    document: JSON.stringify(value),
    trustStore: activeTrustStore,
    now: NOW,
    channel: value.channel,
    ...options,
  });
}

test('verifies stable bundles with exactly five distinct family rows', async () => {
  const value = bundle();
  assert.deepEqual(await verifyBundle(value, {
    document: JSON.stringify(Object.fromEntries(Object.entries(value).reverse())),
  }), value);
  await rejectsCode(verifyBundle(bundle('stable', Object.keys(familyDefaults).slice(0, 4))), 'BUNDLE_ENTRY_INVALID');
});

test('rejects a bundle signed by an active release-role key', async () => {
  const value = signed(
    unsignedBundle('dev', ['community-cloud-cli']),
    'offlineRootSignature',
    BUNDLE_DOMAIN,
    releaseKey.privateKey,
  );
  await rejectsCode(verifyReleaseBundle({
    document: JSON.stringify(value),
    trustStore: activeTrustStore,
    now: NOW,
    channel: 'dev',
  }), 'BUNDLE_SIGNATURE_INVALID');
});

test('allows one through five distinct family rows for dev and beta', async () => {
  for (const channel of ['dev', 'beta']) {
    for (const count of [1, 5]) {
      const value = bundle(channel, Object.keys(familyDefaults).slice(0, count));
      assert.deepEqual(await verifyBundle(value), value);
    }
    await rejectsCode(verifyBundle(bundle(channel, [])), 'BUNDLE_ENTRY_INVALID');
  }
});

test('rejects a same-origin bundle hosted away from PINNED_RELEASE_ORIGIN', async () => {
  const value = unsignedBundle('dev', ['community-cloud-cli']);
  value.entries[0].artifacts[0].manifestUrl = 'https://other.example.test/manifests/cli.json';
  await rejectsCode(verifyBundle(signed(
    value, 'offlineRootSignature', BUNDLE_DOMAIN, rootKey.privateKey,
  )), 'BUNDLE_ENTRY_INVALID');
});

test('rejects duplicate, empty and placeholder family rows', async t => {
  const duplicate = unsignedBundle('dev', ['community-cloud-cli']);
  duplicate.entries.push(structuredClone(duplicate.entries[0]));
  duplicate.sequenceFloor.push(structuredClone(duplicate.sequenceFloor[0]));
  const empty = unsignedBundle('dev', ['community-cloud-cli']);
  empty.entries[0].artifacts = [];
  empty.sequenceFloor = [];
  const placeholder = unsignedBundle('dev', ['community-cloud-cli']);
  placeholder.entries[0].artifacts[0].manifestUrl = '';
  for (const [name, value] of [['duplicate', duplicate], ['empty', empty], ['placeholder', placeholder]]) {
    await t.test(name, async () => rejectsCode(verifyBundle(signed(
      value, 'offlineRootSignature', BUNDLE_DOMAIN, rootKey.privateKey,
    )), 'BUNDLE_ENTRY_INVALID'));
  }
});

test('requires only community-cloud-cli artifact rows to carry an Edge component manifest hash', async () => {
  const missing = unsignedBundle('dev', ['community-cloud-cli']);
  missing.entries[0].artifacts[0].edgeComponentManifestSha256 = null;
  await rejectsCode(verifyBundle(signed(missing, 'offlineRootSignature', BUNDLE_DOMAIN, rootKey.privateKey)), 'BUNDLE_ENTRY_INVALID');
  const extra = unsignedBundle('dev', ['local-single']);
  extra.entries[0].artifacts[0].edgeComponentManifestSha256 = HASH_C;
  await rejectsCode(verifyBundle(signed(extra, 'offlineRootSignature', BUNDLE_DOMAIN, rootKey.privateKey)), 'BUNDLE_ENTRY_INVALID');
});

test('rejects a model digest when the processing-agent family row is absent', async () => {
  const value = unsignedBundle('dev', ['community-cloud-cli']);
  value.modelManifestSha256 = HASH_C;
  await rejectsCode(verifyBundle(signed(
    value, 'offlineRootSignature', BUNDLE_DOMAIN, rootKey.privateKey,
  )), 'BUNDLE_ENTRY_INVALID');
});

test('rejects the absent model marker when the processing-agent family row is present', async () => {
  const value = unsignedBundle('dev', ['processing-agent']);
  value.modelManifestSha256 = ABSENT_MODEL_MANIFEST;
  await rejectsCode(verifyBundle(signed(
    value, 'offlineRootSignature', BUNDLE_DOMAIN, rootKey.privateKey,
  )), 'BUNDLE_ENTRY_INVALID');
});

test('requires exact, duplicate-free sequence floor coverage for every artifact tuple', async t => {
  for (const [name, change] of [
    ['missing', value => value.sequenceFloor.pop()],
    ['duplicate', value => value.sequenceFloor.push(structuredClone(value.sequenceFloor[0]))],
    ['unknown tuple', value => value.sequenceFloor[0].arch = 'x64'],
  ]) {
    const value = unsignedBundle('dev', ['community-cloud-cli']);
    change(value);
    await t.test(name, async () => rejectsCode(verifyBundle(signed(
      value, 'offlineRootSignature', BUNDLE_DOMAIN, rootKey.privateKey,
    )), 'BUNDLE_ENTRY_INVALID'));
  }
});

test('rejects duplicate, unknown and missing protocol peer names', async t => {
  for (const [name, change] of [
    ['duplicate', value => value.protocol.peers.push(structuredClone(value.protocol.peers[0]))],
    ['unknown', value => { value.protocol.peers[0].name = 'unknown'; }],
    ['missing', value => value.protocol.peers.pop()],
  ]) {
    const value = unsignedBundle('dev', ['community-cloud-cli']);
    change(value);
    await t.test(name, async () => rejectsCode(verifyBundle(signed(
      value, 'offlineRootSignature', BUNDLE_DOMAIN, rootKey.privateKey,
    )), 'PEER_PROTOCOL_MISMATCH'));
  }
});

test('rejects bundle unknown fields, nested unknown fields, duplicate keys and wrong enums', async t => {
  const cases = [
    ['top-level extra', value => { value.extra = true; }],
    ['nested extra', value => { value.entries[0].artifacts[0].extra = true; }],
    ['wrong channel', value => { value.channel = 'nightly'; }],
    ['oversized string', value => { value.bundleId = '가'.repeat(1366); }],
  ];
  for (const [name, change] of cases) {
    const value = unsignedBundle('dev', ['community-cloud-cli']);
    change(value);
    await t.test(name, async () => rejectsCode(verifyBundle(signed(
      value, 'offlineRootSignature', BUNDLE_DOMAIN, rootKey.privateKey,
    )), 'BUNDLE_ENTRY_INVALID'));
  }
  const value = bundle('dev', ['community-cloud-cli']);
  const duplicate = JSON.stringify(value).replace('"apiName":', '"apiName":"ccc-http-api","apiName":');
  await rejectsCode(verifyReleaseBundle({
    document: duplicate, trustStore: activeTrustStore, now: NOW, channel: 'dev',
  }), 'BUNDLE_ENTRY_INVALID');
});

test('distinguishes authenticated bundle lifetime failure from shape and signature failure', async () => {
  const future = signed({
    ...unsignedBundle('dev', ['community-cloud-cli']),
    publishedAt: '2026-09-12T00:00:00.000Z',
  }, 'offlineRootSignature', BUNDLE_DOMAIN, rootKey.privateKey);
  await rejectsCode(verifyBundle(future), 'BUNDLE_LIFETIME_INVALID');
  await rejectsCode(verifyBundle(bundle('dev', ['community-cloud-cli']), {
    now: new Date('2026-09-20T00:00:00.000Z'),
  }), 'BUNDLE_LIFETIME_INVALID');
  const invalidSignature = {
    ...future,
    offlineRootSignature: `${future.offlineRootSignature[0] === 'A' ? 'B' : 'A'}${future.offlineRootSignature.slice(1)}`,
  };
  await rejectsCode(verifyBundle(invalidSignature), 'BUNDLE_SIGNATURE_INVALID');
  const reversed = signed({
    ...unsignedBundle('dev', ['community-cloud-cli']),
    publishedAt: '2026-09-12T00:00:00.000Z',
    expiresAt: '2026-09-11T00:00:00.000Z',
  }, 'offlineRootSignature', BUNDLE_DOMAIN, rootKey.privateKey);
  await rejectsCode(verifyBundle(reversed), 'BUNDLE_ENTRY_INVALID');
  await rejectsCode(verifyBundle(bundle('dev', ['community-cloud-cli']), { channel: 'beta' }), 'BUNDLE_ENTRY_INVALID');
  const wrongDomain = signed(unsignedBundle('dev', ['community-cloud-cli']), 'offlineRootSignature', 'WRONG\0', rootKey.privateKey);
  await rejectsCode(verifyBundle(wrongDomain), 'BUNDLE_SIGNATURE_INVALID');
});

test('rejects unknown, revoked and noncanonical offline root keys or signatures', async () => {
  const value = bundle('dev', ['community-cloud-cli']);
  const otherRoot = keyPair('other-root');
  const otherTrustStore = await loadReleaseTrustStore(JSON.stringify({ keys: [{
    keyId: otherRoot.keyId, publicKey: otherRoot.publicKey, role: 'root', status: 'active',
    notBefore: '2026-09-01T00:00:00.000Z', notAfter: '2026-10-01T00:00:00.000Z',
  }] }));
  await rejectsCode(verifyBundle(value, { trustStore: otherTrustStore }), 'BUNDLE_SIGNATURE_INVALID');
  const revokedTrustStore = await loadReleaseTrustStore(JSON.stringify({ keys: [{
    keyId: rootKey.keyId, publicKey: rootKey.publicKey, role: 'root', status: 'revoked',
    notBefore: '2026-09-01T00:00:00.000Z', notAfter: '2026-10-01T00:00:00.000Z',
    revokedAt: '2026-09-10T00:00:00.000Z', revocationReason: 'synthetic compromise',
  }] }));
  await rejectsCode(verifyBundle(value, { trustStore: revokedTrustStore }), 'BUNDLE_SIGNATURE_INVALID');
  const invalidTrustStore = { keys: [{
    keyId: rootKey.keyId, publicKey: `${rootKey.publicKey}=`, role: 'root', status: 'active',
    notBefore: '2026-09-01T00:00:00.000Z', notAfter: '2026-10-01T00:00:00.000Z',
  }] };
  await rejectsCode(verifyBundle(value, { trustStore: invalidTrustStore }), 'BUNDLE_SIGNATURE_INVALID');
  await rejectsCode(verifyBundle({ ...value, offlineRootSignature: `${value.offlineRootSignature}=` }), 'BUNDLE_SIGNATURE_INVALID');
});
