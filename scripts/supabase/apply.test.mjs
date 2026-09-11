import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { canonicalizeJcs } from '@ccc/contracts/jcs';

import { buildEdgeComponentManifest } from '../release/edge-component-manifest.mjs';
import { PINNED_RELEASE_ORIGIN } from '../release/release-origin.mjs';
import { loadReleaseTrustStore } from '../release/release-trust.mjs';
import { applyInstallation, createVerifiedRelease } from './apply.mjs';

const HASH = 'a'.repeat(64);
const NOW = new Date('2026-09-11T12:00:00.000Z');

function authorization() {
  return {
    installationId: 'installation-test',
    institutionIdHash: '1'.repeat(64),
    projectRefHash: '2'.repeat(64),
    expectedOwnerOrgIdHash: '3'.repeat(64),
    runtimeManifestSha256: '4'.repeat(64),
    approvalSha256: '5'.repeat(64),
    runtimeConfigurationSha256: '6'.repeat(64),
    contractVersion: 'S11-install-approval-v1',
    runtimeSequence: 1,
    expiresAt: '2026-09-12T00:00:00.000Z',
  };
}

function emptyObservation(overrides = {}) {
  return {
    installState: null,
    state: {
      userTableCount: 0,
      userRowEstimate: 0,
      authUserCount: 0,
      bucketCount: 0,
      storageObjectCount: 0,
      userRoutineCount: 0,
      userTypeCount: 0,
      privateTableNames: [],
      ...overrides,
    },
  };
}

function resumableObservation() {
  const observation = emptyObservation();
  const evidence = {
    businessTableCount: 0,
    businessRowCount: 0,
    authUserCount: 0,
    bucketCount: 0,
    storageObjectCount: 0,
    publicRoutineCount: 0,
    publicTypeCount: 0,
    privateInstallerTableCount: 0,
    installJournalCount: 0,
  };
  observation.installState = {
    journal: { phase: 'installing' },
    completedSteps: [{
      step: 'prepare_backup',
      ownershipTags: ['ccc.installation_id=installation-test'],
      providerResourceIdHashes: Object.keys(evidence).map(name =>
        createHash('sha256').update(name).digest('hex')),
      providerResourceDigests: Object.entries(evidence).map(([name, value]) =>
        createHash('sha256').update(`${name}:${value}`).digest('hex')),
    }],
  };
  return observation;
}

function providerBaseline() {
  return {
    baselineVersion: 'test-v1',
    projectRefSha256: '2'.repeat(64),
    ownerOrgIdSha256: '3'.repeat(64),
    region: 'ap-northeast-2',
    databaseVersion: '17.4',
    objects: [],
    grants: [],
    objectInventorySha256: 'a'.repeat(64),
    grantInventorySha256: 'b'.repeat(64),
    baselineSha256: 'c'.repeat(64),
    releaseTrustSha256: 'd'.repeat(64),
    expiresAt: '2026-09-12T00:00:00.000Z',
  };
}

function fixture({ failAt, observed = emptyObservation() } = {}) {
  const events = [];
  const journal = { status: 'absent', prepared: null, installed: null, failure: null };
  let promotions = 0;
  let journalWrites = 0;
  const gate = (name, value) => async () => {
    events.push(name);
    if (failAt === name) throw Object.assign(new Error(name), { code: `${name.toUpperCase()}_FAILED` });
    return value;
  };
  const bundle = { bundleId: 'bundle-test', version: '0.9.0-dev.1', sequence: '7', channel: 'dev' };
  const manifest = { artifactSha256: HASH };
  const verified = {
    bundle,
    manifest,
    edge: {
      edgeArtifactSha256: 'b'.repeat(64),
      components: [{
        kind: 'migration',
        path: 'migrations/0001_baseline.sql',
        artifactSha256: 'f'.repeat(64),
      }],
    },
  };
  const release = {
    verifyBundle: gate('bundle', bundle),
    verifyManifest: gate('manifest', manifest),
    verifyTuple: gate('tuple', true),
    verifyArtifactHash: gate('artifact_hash', true),
    verifyEdgeComponentSet: gate('edge_component_set', verified.edge),
    async promote() {
      events.push('promote');
      if (failAt === 'promote') throw Object.assign(new Error('promote'), { code: 'PROMOTION_FAILED' });
      promotions += 1;
      return { artifactSetDigest: 'c'.repeat(64) };
    },
  };
  const inspector = {
    async revalidate() {
      events.push('inspect_first_install');
      return structuredClone(observed);
    },
    async health() {
      events.push('health');
      if (failAt === 'health') throw Object.assign(new Error('health'), { code: 'HEALTH_FAILED' });
      return {
        healthy: true,
        stateFingerprint: 'd'.repeat(64),
        observedOwnerOrgIdHash: '3'.repeat(64),
      };
    },
  };
  const journalSession = {
    async withInstallLock(callback) {
      events.push('lock');
      return callback({});
    },
    async prepare(_session, input) {
      events.push('journal_prepared');
      if (failAt === 'journal_prepared') throw Object.assign(new Error('prepared'), { code: 'INSTALL_JOURNAL_INVALID' });
      journalWrites += 1;
      journal.status = 'prepared';
      journal.prepared = structuredClone(input);
    },
    async promoted() {
      events.push('journal_promoted');
      journalWrites += 1;
    },
    async complete(_session, input) {
      events.push('journal_installed');
      if (failAt === 'journal_installed') throw Object.assign(new Error('installed'), { code: 'INSTALL_JOURNAL_INVALID' });
      journalWrites += 1;
      journal.status = 'installed';
      journal.installed = structuredClone(input);
    },
    async fail(_session, input) {
      events.push('journal_failed');
      journalWrites += 1;
      journal.failure = structuredClone(input);
    },
  };
  return {
    input: {
      authorization: authorization(),
      providerBaseline: providerBaseline(),
      plan: {
        ready: true,
        installed: { state: 'not-installed', migrationHead: null },
        planFingerprint: '7'.repeat(64),
        resourcesSha256: '8'.repeat(64),
        migrationsSha256: '9'.repeat(64),
        migrations: [{ id: '0001_baseline.sql', checksum: 'f'.repeat(64) }],
      },
      release,
      inspector,
      journalSession,
      now: NOW,
    },
    journalWrites: () => journalWrites,
    events,
    journal,
    promotions: () => promotions,
  };
}

test('verifies every release layer before locking, then prepares, promotes, checks health and installs', async () => {
  const f = fixture();
  const result = await applyInstallation(f.input);

  assert.deepEqual(f.events, [
    'bundle', 'manifest', 'tuple', 'artifact_hash', 'edge_component_set',
    'lock', 'inspect_first_install', 'journal_prepared', 'promote', 'journal_promoted',
    'health', 'journal_installed',
  ]);
  assert.equal(f.promotions(), 1);
  assert.equal(f.journal.status, 'installed');
  assert.equal(result.backup.backup, 'not_applicable');
  assert.deepEqual(result.backup.evidence, {
    businessTableCount: 0,
    businessRowCount: 0,
    authUserCount: 0,
    bucketCount: 0,
    storageObjectCount: 0,
    publicRoutineCount: 0,
    publicTypeCount: 0,
    privateInstallerTableCount: 0,
    installJournalCount: 0,
  });
  assert.deepEqual(f.journal.prepared.backup, result.backup);
  assert.deepEqual(f.journal.installed.receipt.backup, result.backup);
});

test('each release verification failure happens before the lock and every database write', async t => {
  const gates = ['bundle', 'manifest', 'tuple', 'artifact_hash', 'edge_component_set'];
  for (const [index, failAt] of gates.entries()) {
    await t.test(failAt, async () => {
      const f = fixture({ failAt });
      await assert.rejects(applyInstallation(f.input));
      assert.deepEqual(f.events, gates.slice(0, index + 1));
      assert.equal(f.journal.status, 'absent');
      assert.equal(f.journalWrites(), 0);
      assert.equal(f.promotions(), 0);
    });
  }
});
test('post-promotion failures write no installed receipt and leave an explicit incomplete journal', async t => {
  for (const failAt of ['journal_prepared', 'promote', 'health', 'journal_installed']) {
    await t.test(failAt, async () => {
      const f = fixture({ failAt });
      await assert.rejects(
        applyInstallation(f.input),
        error => failAt === 'journal_prepared'
          ? error?.code === 'INSTALL_JOURNAL_INVALID'
          : error?.code === 'INSTALL_POST_PROMOTION_FAILED',
      );
      assert.notEqual(f.journal.status, 'installed');
      assert.equal(f.promotions(), failAt === 'health' || failAt === 'journal_installed' ? 1 : 0);
      if (failAt !== 'journal_prepared') {
        assert.ok(f.journalWrites() >= 2);
        assert.ok(f.journal.failure);
      }
    });
  }
});

test('function and template components are refused before the install lock', async t => {
  for (const kind of ['function', 'template']) {
    await t.test(kind, async () => {
      const f = fixture();
      f.input.release.verifyEdgeComponentSet = async () => ({
        edgeArtifactSha256: 'b'.repeat(64),
        components: [{
          kind,
          path: `${kind}s/not-supported`,
          artifactSha256: 'f'.repeat(64),
        }],
      });
      await assert.rejects(
        applyInstallation(f.input),
        error => error?.code === 'EDGE_COMPONENT_DEPLOYER_UNAVAILABLE',
      );
      assert.equal(f.journalWrites(), 0);
      assert.equal(f.events.includes('lock'), false);
      assert.equal(f.journal.status, 'absent');
      assert.equal(f.promotions(), 0);
    });
  }
});

test('first-install backup exemption rejects every nonempty dimension before journal preparation', async t => {
  const cases = [
    ['businessTableCount', { userTableCount: 1 }],
    ['businessRowCount', { userRowEstimate: 1 }],
    ['authUserCount', { authUserCount: 1 }],
    ['bucketCount', { bucketCount: 1 }],
    ['storageObjectCount', { storageObjectCount: 1 }],
    ['publicRoutineCount', { userRoutineCount: 1 }],
    ['publicTypeCount', { userTypeCount: 1 }],
    ['privateInstallerTableCount', { privateTableNames: ['ccc_install_journal'] }],
  ];
  for (const [name, state] of cases) {
    await t.test(name, async () => {
      const f = fixture({ observed: emptyObservation(state) });
      await assert.rejects(applyInstallation(f.input), error => error?.code === 'BACKUP_FAILED');
      assert.equal(f.journalWrites(), 0);
      assert.equal(f.journal.status, 'absent');
      assert.equal(f.promotions(), 0);
    });
  }
  await t.test('installJournalCount', async () => {
    const observed = emptyObservation();
    observed.installState = { journal: { phase: 'planned' } };
    const f = fixture({ observed });
    await assert.rejects(applyInstallation(f.input), error => error?.code === 'BACKUP_FAILED');
    assert.equal(f.journalWrites(), 0);
    assert.equal(f.journal.status, 'absent');
    assert.equal(f.promotions(), 0);
  });
});

test('not-ready and completed plans cannot claim the first-install exemption', async t => {
  for (const plan of [
    { ready: false, installed: { state: 'not-installed' } },
    { ready: true, installed: { state: 'unverified' } },
    { ready: true, installed: { state: 'installed' } },
  ]) {
    await t.test(String(plan.installed.state), async () => {
      const f = fixture();
      Object.assign(f.input.plan, plan);
      await assert.rejects(applyInstallation(f.input), error => error?.code === 'BACKUP_FAILED');
      assert.equal(f.journal.status, 'absent');
      assert.equal(f.promotions(), 0);
    });
  }
});

test('an incomplete journal resumes only from its recorded all-zero backup exemption evidence', async () => {
  const f = fixture({ observed: resumableObservation() });
  f.input.plan.installed = { state: 'installing', migrationHead: null };
  f.input.plan.ready = false;
  f.input.plan.blockers = [{ code: 'DRIFT_BLOCKED' }];
  const result = await applyInstallation(f.input);
  assert.equal(result.ready, true);
  assert.equal(f.journal.prepared.resume, true);
  assert.equal(f.journal.prepared.backup.backup, 'not_applicable');
});

test('release verifier adapter checks signed documents, target tuple, bytes and Edge components', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccc-apply-release-'));
  const previousKey = process.env.CCC_RELEASE_SIGNING_PRIVATE_KEY;
  const previousTrust = process.env.CCC_RELEASE_TRUST_STORE;
  const releaseKeys = generateKeyPairSync('ed25519');
  const rootKeys = generateKeyPairSync('ed25519');
  const releasePublicKey = releaseKeys.publicKey.export({ format: 'jwk' }).x;
  const rootPublicKey = rootKeys.publicKey.export({ format: 'jwk' }).x;
  const trustDocument = JSON.stringify({ keys: [{
    keyId: 'root-key-test',
    publicKey: rootPublicKey,
    role: 'root',
    status: 'active',
    notBefore: '2026-09-01T00:00:00.000Z',
    notAfter: '2026-10-01T00:00:00.000Z',
  }, {
    keyId: 'release-key-test',
    publicKey: releasePublicKey,
    role: 'release',
    status: 'active',
    notBefore: '2026-09-01T00:00:00.000Z',
    notAfter: '2026-10-01T00:00:00.000Z',
  }] });
  process.env.CCC_RELEASE_SIGNING_PRIVATE_KEY = releaseKeys.privateKey
    .export({ format: 'pem', type: 'pkcs8' }).toString();
  process.env.CCC_RELEASE_TRUST_STORE = trustDocument;
  try {
    for (const directory of ['functions', 'templates', 'migrations']) await mkdir(join(root, directory));
    await writeFile(join(root, 'functions', 'apply.ts'), 'export default true;');
    await writeFile(join(root, 'templates', 'config.json'), '{}');
    await writeFile(join(root, 'migrations', '0001.sql'), 'select 1;');
    const edge = await buildEdgeComponentManifest(root);
    const edgeDocument = canonicalizeJcs(edge);
    await writeFile(join(root, 'edge-component-manifest.json'), edgeDocument);

    const artifactBytes = Buffer.from('signed-artifact-bytes');
    const artifactSha256 = createHash('sha256').update(artifactBytes).digest('hex');
    const artifactUrl = `${PINNED_RELEASE_ORIGIN}/artifacts/community-cloud-cli-community-cloud-0.9.0-dev.1-macos-arm64.tar.gz`;
    const manifestUrl = `${PINNED_RELEASE_ORIGIN}/manifests/community-cloud-cli.json`;
    const signDocument = (value, field, domain, privateKey) => {
      const message = Buffer.concat([
        Buffer.from(domain, 'ascii'),
        Buffer.from(canonicalizeJcs(value), 'utf8'),
      ]);
      return { ...value, [field]: sign(null, message, privateKey).toString('base64url') };
    };
    const manifest = signDocument({
      version: '0.9.0-dev.1',
      sequence: '7',
      channel: 'dev',
      artifactUrl,
      artifactSha256,
      artifactBytes: artifactBytes.byteLength,
      minSchemaVersion: 0,
      maxSchemaVersion: 0,
      publishedAt: '2026-09-11T00:00:00.000Z',
      expiresAt: '2026-09-20T00:00:00.000Z',
      signingKeyId: 'release-key-test',
    }, 'ed25519Signature', 'CCC-RELEASE-MANIFEST-V1\0', releaseKeys.privateKey);
    const manifestDocument = canonicalizeJcs(manifest);
    const row = {
      manifestUrl,
      manifestSha256: createHash('sha256').update(manifestDocument).digest('hex'),
      edgeComponentManifestSha256: createHash('sha256').update(edgeDocument).digest('hex'),
      mode: 'community-cloud',
      platform: 'macos',
      arch: 'arm64',
      artifactSha256,
      artifactBytes: artifactBytes.byteLength,
      minSchemaVersion: 0,
      maxSchemaVersion: 0,
    };
    const contractsSha256 = 'e'.repeat(64);
    const bundle = signDocument({
      schemaVersion: 1,
      bundleId: 'bundle-dev-7',
      version: '0.9.0-dev.1',
      sequence: '7',
      channel: 'dev',
      publishedAt: '2026-09-11T00:00:00.000Z',
      expiresAt: '2026-09-20T00:00:00.000Z',
      protocol: {
        apiName: 'ccc-http-api',
        apiVersion: '1.0.0',
        contractsSha256,
        peers: ['cloud-cli', 'edge'].map(name => ({
          name,
          protocolVersion: '1.0.0',
          contractsSha256,
        })),
      },
      entries: [{ family: 'community-cloud-cli', artifacts: [row] }],
      sequenceFloor: [{
        family: 'community-cloud-cli',
        mode: 'community-cloud',
        platform: 'macos',
        arch: 'arm64',
        minimumSequence: '7',
      }],
      modelManifestSha256: '0'.repeat(64),
    }, 'offlineRootSignature', 'CCC-RELEASE-BUNDLE-V1\0', rootKeys.privateKey);
    const release = createVerifiedRelease({
      bundleDocument: canonicalizeJcs(bundle),
      manifestDocument,
      artifactBytes,
      edgeDocument,
      stagedRoot: root,
      manifestUrl,
      trustStore: await loadReleaseTrustStore(trustDocument),
      channel: 'dev',
      expectedTuple: {
        family: 'community-cloud-cli',
        mode: 'community-cloud',
        platform: 'macos',
        arch: 'arm64',
      },
      promote: async () => ({ artifactSetDigest: edge.edgeArtifactSha256 }),
    });
    const verifiedBundle = await release.verifyBundle({ now: NOW });
    const verifiedManifest = await release.verifyManifest({ bundle: verifiedBundle, now: NOW });
    await release.verifyTuple({ manifest: verifiedManifest });
    await release.verifyArtifactHash({ manifest: verifiedManifest });
    assert.deepEqual(await release.verifyEdgeComponentSet({ now: NOW }), edge);

    const tampered = createVerifiedRelease({
      bundleDocument: canonicalizeJcs(bundle),
      manifestDocument,
      artifactBytes: Buffer.from('tampered'),
      edgeDocument,
      stagedRoot: root,
      manifestUrl,
      trustStore: await loadReleaseTrustStore(trustDocument),
      channel: 'dev',
      expectedTuple: {
        family: 'community-cloud-cli',
        mode: 'community-cloud',
        platform: 'macos',
        arch: 'arm64',
      },
    });
    const tamperedBundle = await tampered.verifyBundle({ now: NOW });
    const tamperedManifest = await tampered.verifyManifest({ bundle: tamperedBundle, now: NOW });
    await assert.rejects(
      tampered.verifyArtifactHash({ manifest: tamperedManifest }),
      error => error?.code === 'HASH_MISMATCH',
    );
  } finally {
    if (previousKey === undefined) delete process.env.CCC_RELEASE_SIGNING_PRIVATE_KEY;
    else process.env.CCC_RELEASE_SIGNING_PRIVATE_KEY = previousKey;
    if (previousTrust === undefined) delete process.env.CCC_RELEASE_TRUST_STORE;
    else process.env.CCC_RELEASE_TRUST_STORE = previousTrust;
    await rm(root, { recursive: true, force: true });
  }
});
