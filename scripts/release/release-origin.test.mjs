import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';

import { canonicalizeJcs } from '@ccc/contracts/jcs';

import { verifyReleaseBundle } from './release-manifest.mjs';
import { loadReleaseTrustStore } from './release-trust.mjs';
import { fetchPinnedRelease } from './release-origin.mjs';

const ENDPOINT = 'https://ccc-releases.account-855.workers.dev/.well-known/ccc/release-bundle.json';
const PUBLISHED_AT = '2026-09-11T00:00:00.000Z';
const EXPIRES_AT = '2026-09-12T00:00:00.000Z';
const SERVER_DATE = 'Fri, 11 Sep 2026 12:00:00 GMT';
const FLOOR = [{
  family: 'community-cloud-cli',
  mode: 'community-cloud',
  platform: 'macos',
  arch: 'arm64',
  minimumSequence: '7',
}];
const RAW_BUNDLE = '{"signed":"bundle"}';
const BUNDLE = { publishedAt: PUBLISHED_AT, expiresAt: EXPIRES_AT, sequenceFloor: FLOOR };
const HASH_A = '11'.repeat(32);
const HASH_B = '22'.repeat(32);
const HASH_C = '33'.repeat(32);
const BUNDLE_DOMAIN = 'CCC-RELEASE-BUNDLE-V1\0';
const rootKey = (() => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicKey: publicKey.export({ format: 'jwk' }).x };
})();
const rootTrustStore = await loadReleaseTrustStore(JSON.stringify({ keys: [{
  keyId: 'root-key-1',
  publicKey: rootKey.publicKey,
  role: 'root',
  status: 'active',
  notBefore: '2026-09-01T00:00:00.000Z',
  notAfter: '2026-10-01T00:00:00.000Z',
}] }));

function response({ url = ENDPOINT, date = SERVER_DATE, ok = true, body = RAW_BUNDLE } = {}) {
  return {
    url,
    ok,
    headers: new Headers(date === null ? {} : { date }),
    text: async () => body,
  };
}

function memoryFloorStore(initial = null) {
  let value = initial;
  let writes = 0;
  return {
    read: async () => structuredClone(value),
    updateVerified: async ({ sequenceFloor, trustedTime }) => {
      writes += 1;
      value = { schemaVersion: 1, sequenceFloor: structuredClone(sequenceFloor), lastTrustedTime: trustedTime };
      return structuredClone(value);
    },
    snapshot: () => structuredClone(value),
    writes: () => writes,
  };
}

const NOW = new Date('2026-09-11T12:00:01.000Z');
const verifiedBundle = async (document, trustedDate) => {
  assert.equal(document, RAW_BUNDLE);
  assert.equal(trustedDate instanceof Date, true);
  return structuredClone(BUNDLE);
};

function realSignedBundle(overrides = {}) {
  const unsigned = {
    schemaVersion: 1,
    bundleId: 'bundle-beta-7',
    version: '1.2.3-beta.1',
    sequence: '7',
    channel: 'beta',
    publishedAt: PUBLISHED_AT,
    expiresAt: EXPIRES_AT,
    protocol: {
      apiName: 'ccc-http-api',
      apiVersion: '1.0.0',
      contractsSha256: HASH_A,
      peers: [
        { name: 'cloud-cli', protocolVersion: '1.0.0', contractsSha256: HASH_A },
        { name: 'edge', protocolVersion: '1.0.0', contractsSha256: HASH_A },
      ],
    },
    entries: [{
      family: 'community-cloud-cli',
      artifacts: [{
        manifestUrl: 'https://ccc-releases.account-855.workers.dev/manifests/community-cloud-cli.json',
        manifestSha256: HASH_B,
        edgeComponentManifestSha256: HASH_C,
        mode: 'community-cloud',
        platform: 'macos',
        arch: 'arm64',
        artifactSha256: HASH_A,
        artifactBytes: 1234,
        minSchemaVersion: 1,
        maxSchemaVersion: 3,
      }],
    }],
    sequenceFloor: FLOOR,
    modelManifestSha256: '0'.repeat(64),
    ...overrides,
  };
  const message = Buffer.concat([
    Buffer.from(BUNDLE_DOMAIN, 'ascii'),
    Buffer.from(canonicalizeJcs(unsigned), 'utf8'),
  ]);
  return {
    ...unsigned,
    offlineRootSignature: sign(null, message, rootKey.privateKey).toString('base64url'),
  };
}

function verifyRealBundle(document, trustedDate) {
  return verifyReleaseBundle({
    document,
    trustStore: rootTrustStore,
    now: trustedDate,
    channel: 'beta',
  });
}

async function rejectCode(promise, code) {
  await assert.rejects(promise, error => error?.code === code);
}

test('uses the pinned HTTPS endpoint even when environment and extra options request another origin', async () => {
  const previous = process.env.CCC_RELEASE_ORIGIN;
  process.env.CCC_RELEASE_ORIGIN = 'https://attacker.invalid';
  const store = memoryFloorStore();
  let requested;
  try {
    const result = await fetchPinnedRelease({
      fetchImpl: async (url, options) => {
        requested = { url, options };
        return response();
      },
      floorStore: store,
      now: NOW,
      verifyBundle: verifiedBundle,
      origin: 'https://attacker.invalid',
    });
    assert.equal(requested.url, ENDPOINT);
    assert.deepEqual(requested.options, { method: 'GET', redirect: 'error' });
    assert.equal(result.trustedTime, '2026-09-11T12:00:00.000Z');
  } finally {
    if (previous === undefined) delete process.env.CCC_RELEASE_ORIGIN;
    else process.env.CCC_RELEASE_ORIGIN = previous;
  }
});

test('rejects a response that resolves to another origin without persisting it', async () => {
  const store = memoryFloorStore();
  await rejectCode(fetchPinnedRelease({
    fetchImpl: async () => response({ url: 'https://attacker.invalid/release-bundle.json' }),
    floorStore: store,
    now: NOW,
    verifyBundle: verifiedBundle,
  }), 'RELEASE_ORIGIN_INVALID');
  assert.equal(store.writes(), 0);
});

test('maps TLS or hostname validation failure from fetch to unavailable trusted time', async () => {
  const store = memoryFloorStore();
  await rejectCode(fetchPinnedRelease({
    fetchImpl: async () => { throw new TypeError('certificate hostname mismatch'); },
    floorStore: store,
    now: NOW,
    verifyBundle: verifiedBundle,
  }), 'TRUSTED_TIME_UNAVAILABLE');
  assert.equal(store.writes(), 0);
});

test('does not use the supplied local clock when the TLS Date header is missing', async () => {
  const store = memoryFloorStore();
  await rejectCode(fetchPinnedRelease({
    fetchImpl: async () => response({ date: null }),
    floorStore: store,
    now: new Date('2026-09-11T12:00:00.000Z'),
    verifyBundle: verifiedBundle,
  }), 'TRUSTED_TIME_UNAVAILABLE');
  assert.equal(store.writes(), 0);
});

test('maps only a real verifier lifetime rejection to unavailable trusted time', async () => {
  const document = JSON.stringify(realSignedBundle());
  for (const date of ['Thu, 10 Sep 2026 23:59:59 GMT', 'Sat, 12 Sep 2026 00:00:00 GMT']) {
    const store = memoryFloorStore();
    await rejectCode(fetchPinnedRelease({
      fetchImpl: async () => response({ date, body: document }),
      floorStore: store,
      now: NOW,
      verifyBundle: verifyRealBundle,
    }), 'TRUSTED_TIME_UNAVAILABLE');
    assert.equal(store.writes(), 0);
  }
});

test('rejects server or local time earlier than persisted trusted time', async () => {
  const persisted = { schemaVersion: 1, sequenceFloor: FLOOR, lastTrustedTime: '2026-09-11T12:00:01.000Z' };
  const cases = [
    { now: NOW, date: SERVER_DATE },
    { now: new Date('2026-09-11T11:59:59.000Z'), date: 'Fri, 11 Sep 2026 12:00:02 GMT' },
  ];
  for (const { now, date } of cases) {
    const store = memoryFloorStore(persisted);
    await rejectCode(fetchPinnedRelease({
      fetchImpl: async () => response({ date }),
      floorStore: store,
      now,
      verifyBundle: verifiedBundle,
    }), 'TRUSTED_TIME_ROLLBACK');
    assert.equal(store.writes(), 0);
  }
});

test('rejects a release document over one MiB before verification or persistence', async () => {
  const store = memoryFloorStore();
  await rejectCode(fetchPinnedRelease({
    fetchImpl: async () => response({ body: 'x'.repeat(1_048_577) }),
    floorStore: store,
    now: NOW,
    verifyBundle: verifiedBundle,
  }), 'BUNDLE_ENTRY_INVALID');
  assert.equal(store.writes(), 0);
});

test('requires successful signed-bundle verification before persisting floor or time', async () => {
  const missingVerifierStore = memoryFloorStore();
  await rejectCode(fetchPinnedRelease({
    fetchImpl: async () => response(),
    floorStore: missingVerifierStore,
    now: NOW,
  }), 'RELEASE_ORIGIN_INVALID');
  assert.equal(missingVerifierStore.writes(), 0);

  for (const code of ['BUNDLE_SIGNATURE_INVALID', 'BUNDLE_ENTRY_INVALID']) {
    const rejectedVerifierStore = memoryFloorStore();
    await rejectCode(fetchPinnedRelease({
      fetchImpl: async () => response(),
      floorStore: rejectedVerifierStore,
      now: NOW,
      verifyBundle: async () => {
        throw Object.assign(new Error(code), { code });
      },
    }), code);
    assert.equal(rejectedVerifierStore.writes(), 0);
  }
});
