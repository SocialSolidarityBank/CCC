import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { lstat, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { gzipSync } from 'node:zlib';

import { create as createTar } from 'tar';
import postgres from 'postgres';

import { canonicalizeJcs } from '@ccc/contracts/jcs';

import { buildEdgeComponentManifest } from '../release/edge-component-manifest.mjs';
import { extractReleaseArchive } from '../release/safe-extract.mjs';
import { PINNED_RELEASE_ORIGIN } from '../release/release-origin.mjs';
import { loadReleaseTrustStore } from '../release/release-trust.mjs';
import {
  applyInstallation,
  createInstallJournalSession,
  createTrustedClock,
  createVerifiedRelease,
} from './apply.mjs';
import {
  applyJournaledMigration,
  readInstallState,
} from './install-journal.mjs';

const runFile = promisify(execFile);

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

function fixture({ failAt, observed = emptyObservation(), health: healthOverrides = {} } = {}) {
  const events = [];
  const journal = { status: 'absent', prepared: null, installed: null, failure: null };
  let promotions = 0;
  let journalWrites = 0;
  let providerStepRuns = 0;
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
        kind: 'function',
        path: 'functions/ccc-storage-signer/index.js',
        artifactSha256: '1'.repeat(64),
      }, {
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
    verifyDeploymentPrerequisites: gate('deployment_prerequisites', { ready: true }),
    async promote() {
      events.push('promote');
      if (failAt === 'promote') throw Object.assign(new Error('promote'), { code: 'PROMOTION_FAILED' });
      promotions += 1;
      return {
        artifactSetDigest: 'c'.repeat(64),
        databaseFingerprint: 'e'.repeat(64),
        responseRegion: 'ap-northeast-2',
        providerResourceDigests: {},
      };
    },
    async applyProviderSteps() {
      events.push('provider_steps');
      if (failAt === 'provider_steps') {
        throw Object.assign(new Error('provider'), { code: 'RESOURCE_OWNERSHIP_MISMATCH' });
      }
      providerStepRuns += 1;
      return {
        steps: [{
          step: 'storage_bucket',
          resourceIdHashes: ['7'.repeat(64)],
          resourceDigests: ['8'.repeat(64)],
        }],
      };
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
        healthy: healthOverrides.runtimeReady !== false,
        installedHealthy: true,
        runtimeReady: healthOverrides.runtimeReady !== false,
        stateFingerprint: 'd'.repeat(64),
        observedOwnerOrgIdHash: '3'.repeat(64),
        storageSignerHealthy: true,
        edgeRegionEvidence: {
          requestedRegion: 'ap-northeast-2',
          responseRegion: 'ap-northeast-2',
          functionRegion: 'ap-northeast-2',
          mismatch: false,
        },
        restrictedDatabase: {
          connected: true,
          role: 'ccc_api',
          superuser: false,
          bypassRls: false,
        },
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
      const { now, ...record } = input;
      journal.installed = { ...structuredClone(record), recordedAt: now() };
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
    providerStepRuns: () => providerStepRuns,
  };
}

test('verifies every release layer before locking, then prepares, promotes, checks health and installs', async () => {
  const f = fixture();
  const result = await applyInstallation(f.input);

  assert.deepEqual(f.events, [
    'bundle', 'manifest', 'tuple', 'artifact_hash', 'edge_component_set',
    'deployment_prerequisites', 'bundle', 'manifest',
    'lock', 'inspect_first_install',
    'bundle', 'manifest', 'tuple', 'artifact_hash', 'edge_component_set',
    'deployment_prerequisites', 'bundle', 'manifest',
    'journal_prepared', 'promote', 'journal_promoted', 'provider_steps', 'health',
    'bundle', 'manifest', 'tuple', 'artifact_hash', 'edge_component_set',
    'deployment_prerequisites', 'bundle', 'manifest',
    'journal_installed',
  ]);
  assert.equal(result.receipt.releaseSequence, 7);
  assert.equal(f.providerStepRuns(), 1);
  assert.deepEqual(f.journal.installed.providerSteps.steps[0].step, 'storage_bucket');
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
  const gates = [
    'bundle', 'manifest', 'tuple', 'artifact_hash', 'edge_component_set',
    'deployment_prerequisites',
  ];
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
test('a missing provider capability stops under the lock before any journal write', async () => {
  const f = fixture();
  f.input.release.probeProviderCapabilities = async () => {
    f.events.push('provider_probe');
    throw Object.assign(new Error('probe'), { code: 'PROVIDER_UNREADABLE' });
  };
  await assert.rejects(
    applyInstallation(f.input),
    error => error?.code === 'PROVIDER_UNREADABLE',
  );
  assert.equal(f.events.includes('lock'), true);
  assert.equal(f.events.includes('provider_probe'), true);
  assert.equal(f.events.includes('journal_prepared'), false);
  assert.equal(f.journal.status, 'absent');
  assert.equal(f.journalWrites(), 0);
  assert.equal(f.promotions(), 0);
});
test('receipt sequence must fit the durable integer contract before the lock', async () => {
  const f = fixture();
  const verifyBundle = f.input.release.verifyBundle;
  f.input.release.verifyBundle = async input => ({
    ...await verifyBundle(input),
    sequence: '9007199254740992',
  });
  await assert.rejects(
    applyInstallation(f.input),
    error => error?.code === 'BUNDLE_ENTRY_INVALID',
  );
  assert.equal(f.events.includes('lock'), false);
  assert.equal(f.journalWrites(), 0);
});

test('post-promotion failures write no installed receipt and leave an explicit incomplete journal', async t => {
  for (const failAt of ['journal_prepared', 'promote', 'provider_steps', 'health', 'journal_installed']) {
    await t.test(failAt, async () => {
      const f = fixture({ failAt });
      await assert.rejects(
        applyInstallation(f.input),
        error => failAt === 'journal_prepared'
          ? error?.code === 'INSTALL_JOURNAL_INVALID'
          : error?.code === 'INSTALL_POST_PROMOTION_FAILED',
      );
      assert.notEqual(f.journal.status, 'installed');
      assert.equal(f.promotions(), failAt === 'journal_prepared' || failAt === 'promote' ? 0 : 1);
      assert.equal(f.providerStepRuns(), failAt === 'health' || failAt === 'journal_installed' ? 1 : 0);
      if (failAt !== 'journal_prepared') {
        assert.ok(f.journalWrites() >= 2);
        assert.ok(f.journal.failure);
      }
    });
  }
});

test('doctor-rejected Edge and restricted-role evidence never reaches installed', async t => {
  const cases = [
    ['StorageSigner unavailable', health => { health.storageSignerHealthy = false; }],
    ['function region absent', health => { health.edgeRegionEvidence.functionRegion = 'not_run'; }],
    ['region mismatch', health => { health.edgeRegionEvidence.mismatch = true; }],
    ['restricted connection absent', health => { health.restrictedDatabase.connected = false; }],
    ['installer connection substituted', health => { health.restrictedDatabase.role = 'postgres'; }],
    ['installation health refused', health => { health.installedHealthy = false; }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const f = fixture();
      const healthy = f.input.inspector.health;
      f.input.inspector.health = async (...args) => {
        const health = await healthy(...args);
        mutate(health);
        return health;
      };
      await assert.rejects(
        applyInstallation(f.input),
        error => error?.code === 'INSTALL_POST_PROMOTION_FAILED',
      );
      assert.notEqual(f.journal.status, 'installed');
      assert.equal(f.promotions(), 1);
    });
  }
});

test('a first install records itself without runtime readiness and is not production ready', async () => {
  const f = fixture({ health: { runtimeReady: false } });
  const result = await applyInstallation(f.input);

  assert.equal(f.journal.status, 'installed');
  assert.equal(result.ready, true);
  assert.equal(result.productionReady, false);
  assert.equal(result.receipt.productionReady, false);
  assert.equal(result.receipt.runtimeReady, false);
  assert.equal(f.journal.installed.productionReady, false);
  assert.equal(f.journal.installed.runtimeReady, false);
  assert.equal(f.journal.installed.receipt.runtimeReady, false);
});

test('a first install whose runtime is already ready still records the runtime stage as unproven', async () => {
  const f = fixture();
  const result = await applyInstallation(f.input);

  // /readyz는 첫 설치의 증거가 아니므로 통과해도 기록하지 않는다.
  assert.equal(result.receipt.runtimeReady, false);
  assert.equal(result.productionReady, false);
});

test('the component set must be the planned migrations plus exactly one signer function', async t => {
  const signer = {
    kind: 'function',
    path: 'functions/ccc-storage-signer/index.js',
    artifactSha256: '1'.repeat(64),
  };
  const migration = {
    kind: 'migration',
    path: 'migrations/0001_baseline.sql',
    artifactSha256: 'f'.repeat(64),
  };
  const cases = [
    ['template component', [signer, migration, {
      kind: 'template', path: 'templates/config.json', artifactSha256: 'f'.repeat(64),
    }], 'EDGE_COMPONENT_SET_MISMATCH'],
    ['signer absent', [migration], 'EDGE_COMPONENT_SET_MISMATCH'],
    ['second function', [signer, {
      kind: 'function', path: 'functions/other/index.js', artifactSha256: 'f'.repeat(64),
    }, migration], 'EDGE_COMPONENT_SET_MISMATCH'],
    ['unexpected function path', [{ ...signer, path: 'functions/other/index.js' }, migration],
      'EDGE_COMPONENT_SET_MISMATCH'],
    ['migration absent', [signer], 'MIGRATION_CHECKSUM_MISMATCH'],
    ['migration checksum changed', [signer, { ...migration, artifactSha256: 'e'.repeat(64) }],
      'MIGRATION_CHECKSUM_MISMATCH'],
  ];
  for (const [name, components, code] of cases) {
    await t.test(name, async () => {
      const f = fixture();
      f.input.release.verifyEdgeComponentSet = async () => ({
        edgeArtifactSha256: 'b'.repeat(64),
        components,
      });
      await assert.rejects(applyInstallation(f.input), error => error?.code === code);
      assert.equal(f.journalWrites(), 0);
      assert.equal(f.events.includes('lock'), false);
      assert.equal(f.journal.status, 'absent');
      assert.equal(f.promotions(), 0);
      assert.equal(f.providerStepRuns(), 0);
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

test('an incomplete journal is blocked before the lock without reusing first-install evidence', async () => {
  const f = fixture();
  f.input.plan.installed = { state: 'installing', migrationHead: null };
  f.input.plan.ready = false;
  f.input.plan.blockers = [{ code: 'DRIFT_BLOCKED' }];
  await assert.rejects(
    applyInstallation(f.input),
    error => error?.code === 'BACKUP_FAILED',
  );
  assert.deepEqual(f.events, []);
  assert.equal(f.journalWrites(), 0);
  assert.equal(f.promotions(), 0);
});

test('trusted time expiry during locked revalidation prevents the first journal write', async () => {
  let monotonic = 0n;
  const clock = createTrustedClock(NOW, { monotonicNow: () => monotonic });
  const f = fixture();
  f.input.now = clock;
  const inspect = f.input.inspector.revalidate;
  f.input.inspector.revalidate = async (...args) => {
    const observed = await inspect(...args);
    monotonic += 12n * 60n * 60n * 1_000_000_000n;
    return observed;
  };
  const verifyBundle = f.input.release.verifyBundle;
  f.input.release.verifyBundle = async input => {
    if (input.now >= new Date('2026-09-12T00:00:00.000Z')) {
      throw Object.assign(new Error('expired'), { code: 'BUNDLE_LIFETIME_INVALID' });
    }
    return verifyBundle(input);
  };
  await assert.rejects(
    applyInstallation(f.input),
    error => error?.code === 'BUNDLE_LIFETIME_INVALID',
  );
  assert.equal(f.journalWrites(), 0);
  assert.equal(f.promotions(), 0);
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
    await mkdir(join(root, 'functions', 'ccc-storage-signer'), { recursive: true });
    await mkdir(join(root, 'migrations'));
    const signerBytes = 'Deno.serve(() => new Response(null, { status: 401 }));';
    await writeFile(join(root, 'functions', 'ccc-storage-signer', 'index.js'), signerBytes);
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
    const secrets = {
      schedulerSecret: 'scheduler-secret-value',
      serviceRoleKey: 'service-role-value',
      installManifestJson: '{"schemaVersion":1}',
      signingKeysJson: '{"synthetic-key":"public"}',
      apiDatabasePassword: 'api-role-password-value',
    };
    const plan = {
      ready: true,
      installed: { state: 'not-installed', migrationHead: null },
      migrations: [{
        id: '0001.sql',
        checksum: createHash('sha256').update(await readFile(join(root, 'migrations', '0001.sql'))).digest('hex'),
      }],
    };
    let deployed = null;
    const releaseOptions = {
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
      authorize: async () => authorization(),
      management: { fetch: () => { throw new Error('unused'); }, accessToken: 'token' },
      apiBase: 'https://api.example.invalid/api',
      supabaseOrigin: 'https://test-project.supabase.co',
      providerSteps: async input => {
        deployed = input;
        return { steps: [] };
      },
    };
    const release = createVerifiedRelease({ ...releaseOptions, secrets });
    const verifiedBundle = await release.verifyBundle({ now: NOW });
    const verifiedManifest = await release.verifyManifest({ bundle: verifiedBundle, now: NOW });
    await release.verifyTuple({ manifest: verifiedManifest });
    await release.verifyArtifactHash({ manifest: verifiedManifest });
    const verifiedEdge = await release.verifyEdgeComponentSet({ now: NOW });
    assert.deepEqual(verifiedEdge, edge);
    assert.deepEqual(
      await release.verifyDeploymentPrerequisites({ edge: verifiedEdge, plan }),
      {
        ready: true,
        backup: 'not_applicable',
        signerComponentSha256: createHash('sha256').update(signerBytes).digest('hex'),
      },
    );

    // Only the verified staged bytes reach the deployer, and nothing else.
    await release.applyProviderSteps({
      session: {}, authorization: authorization(), plan, now: NOW,
    });
    assert.equal(deployed.stagedFunction.path, 'functions/ccc-storage-signer/index.js');
    assert.equal(deployed.stagedFunction.bytes.toString('utf8'), signerBytes);
    assert.equal(deployed.stagedFunction.sha256, createHash('sha256').update(signerBytes).digest('hex'));
    assert.equal(deployed.secrets, secrets);
    assert.equal(deployed.apiBase, 'https://api.example.invalid/api');
    assert.equal(deployed.supabaseOrigin, 'https://test-project.supabase.co');

    // Without an injected deployer the real provider-step module is used, and
    // it refuses an unusable session before touching any provider.
    const wired = createVerifiedRelease({ ...releaseOptions, secrets, providerSteps: undefined });
    await wired.verifyManifest({ bundle: await wired.verifyBundle({ now: NOW }), now: NOW });
    await wired.verifyEdgeComponentSet({ now: NOW });
    await assert.rejects(
      wired.applyProviderSteps({
        session: {}, authorization: authorization(), plan, now: NOW,
      }),
      error => error?.code === 'PROVIDER_UNREADABLE',
    );

    for (const missing of [
      'schedulerSecret', 'serviceRoleKey', 'installManifestJson', 'signingKeysJson',
      'apiDatabasePassword',
    ]) {
      const withoutSecret = createVerifiedRelease({
        ...releaseOptions,
        secrets: { ...secrets, [missing]: undefined },
      });
      await withoutSecret.verifyManifest({
        bundle: await withoutSecret.verifyBundle({ now: NOW }), now: NOW,
      });
      const candidateEdge = await withoutSecret.verifyEdgeComponentSet({ now: NOW });
      await assert.rejects(
        withoutSecret.verifyDeploymentPrerequisites({ edge: candidateEdge, plan }),
        error => error?.code === 'RELEASE_PREREQUISITES_MISSING',
      );
    }

    // A resumed or second installation has no verified backup to fall back on.
    await assert.rejects(
      release.verifyDeploymentPrerequisites({
        edge: verifiedEdge,
        plan: { ...plan, installed: { state: 'installing', migrationHead: null } },
      }),
      error => error?.code === 'BACKUP_FAILED',
    );

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

test('trusted release time advances only by monotonic elapsed time', () => {
  let monotonic = 10_000n;
  const now = createTrustedClock(NOW, { monotonicNow: () => monotonic });
  assert.equal(now().toISOString(), NOW.toISOString());
  monotonic += 2_345_000_000n;
  assert.equal(now().toISOString(), '2026-09-11T12:00:02.345Z');
  monotonic -= 1n;
  assert.throws(now, error => error?.code === 'TRUSTED_TIME_UNAVAILABLE');
});

test('archive preflight rejects unsafe entries and expansion before creating output', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ccc-safe-extract-'));
  try {
    const cases = [{
      name: 'symbolic link',
      async prepare(source) {
        await writeFile(join(source, 'target'), 'safe');
        await symlink('target', join(source, 'link'));
        return { cwd: source, files: ['link'] };
      },
    }, {
      name: 'FIFO',
      async prepare(source) {
        await runFile('mkfifo', [join(source, 'pipe')]);
        return { cwd: source, files: ['pipe'] };
      },
    }, {
      name: 'path traversal',
      async prepare(source) {
        await writeFile(join(root, 'outside'), 'escape');
        return { cwd: source, files: ['../outside'], preservePaths: true };
      },
    }, {
      name: 'raw backslash',
      async prepare(source) {
        await writeFile(join(source, 'bad\\name'), 'escape');
        return { cwd: source, files: ['bad\\name'] };
      },
    }, {
      name: 'duplicate path',
      async prepare(source) {
        await writeFile(join(source, 'duplicate'), 'twice');
        return { cwd: source, files: ['duplicate', 'duplicate'] };
      },
    }, {
      name: 'decompression bomb',
      async prepare(source) {
        const file = await open(join(source, 'oversized'), 'w');
        try {
          await file.truncate(16 * 1024 * 1024 + 1);
        } finally {
          await file.close();
        }
        return { cwd: source, files: ['oversized'] };
      },
    }];

    for (const [index, item] of cases.entries()) {
      await t.test(item.name, async () => {
        const source = join(root, `source-${index}`);
        const archivePath = join(root, `unsafe-${index}.tar.gz`);
        const destination = join(root, `output-${index}`);
        await mkdir(source);
        const archive = await item.prepare(source);
        await createTar({
          cwd: archive.cwd,
          file: archivePath,
          gzip: true,
          preservePaths: archive.preservePaths === true,
        }, archive.files);
        await assert.rejects(
          extractReleaseArchive({ archivePath, destination }),
          error => error?.code === 'EDGE_COMPONENT_SET_MISMATCH',
        );
        await assert.rejects(lstat(destination), error => error?.code === 'ENOENT');
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('archive policy violation aborts compressed input before draining trailing bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccc-safe-extract-abort-'));
  try {
    const source = join(root, 'source');
    const archivePath = join(root, 'unsafe.tar.gz');
    const destination = join(root, 'output');
    await mkdir(source);
    await writeFile(join(source, 'target'), 'safe');
    await symlink('target', join(source, 'link'));
    await writeFile(join(source, 'trailing'), randomBytes(2 * 1024 * 1024));
    await createTar({ cwd: source, file: archivePath, gzip: true }, ['link', 'trailing']);
    const archive = await readFile(archivePath);
    const chunks = [];
    for (let offset = 0; offset < archive.length; offset += 256) {
      chunks.push(archive.subarray(offset, Math.min(offset + 256, archive.length)));
    }
    let yielded = 0;
    const sourceFactory = () => Readable.from((async function* streamChunks() {
      for (const chunk of chunks) {
        yielded += 1;
        yield chunk;
        await new Promise(resolve => setImmediate(resolve));
      }
    })());
    await assert.rejects(
      extractReleaseArchive({ archivePath, destination }, { sourceFactory }),
      error => error?.code === 'EDGE_COMPONENT_SET_MISMATCH',
    );
    assert.ok(yielded < chunks.length, `${yielded} of ${chunks.length} chunks were consumed`);
    await assert.rejects(lstat(destination), error => error?.code === 'ENOENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});


test('nested gzip with PAX metadata is rejected before its compressed tail is drained', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ccc-safe-extract-nested-'));
  try {
    const source = join(root, 'source');
    const innerPath = join(root, 'inner.tar.gz');
    const archivePath = join(root, 'nested.tar.gz');
    const destination = join(root, 'output');
    const longPath = join('m'.repeat(120), 'n'.repeat(120), `${'p'.repeat(120)}.txt`);
    await mkdir(join(source, longPath, '..'), { recursive: true });
    await writeFile(join(source, longPath), 'pax metadata');
    await writeFile(join(source, 'trailing'), randomBytes(2 * 1024 * 1024));
    await createTar({ cwd: source, file: innerPath, gzip: true }, [longPath, 'trailing']);
    const inner = await readFile(innerPath);
    await writeFile(archivePath, Buffer.concat([
      gzipSync(inner.subarray(0, 1)),
      gzipSync(inner.subarray(1, 2)),
      gzipSync(inner.subarray(2)),
    ]));
    const archive = await readFile(archivePath);
    const chunks = [
      archive.subarray(0, 1),
      archive.subarray(1, 2),
    ];
    for (let offset = 2; offset < archive.length; offset += 256) {
      chunks.push(archive.subarray(offset, Math.min(offset + 256, archive.length)));
    }
    let yielded = 0;
    const sourceFactory = () => Readable.from((async function* streamChunks() {
      for (const chunk of chunks) {
        yielded += 1;
        yield chunk;
        await new Promise(resolve => setImmediate(resolve));
      }
    })());
    await assert.rejects(
      extractReleaseArchive({ archivePath, destination }, { sourceFactory }),
      error => error?.code === 'EDGE_COMPONENT_SET_MISMATCH',
    );
    assert.ok(yielded < chunks.length, `${yielded} of ${chunks.length} chunks were consumed`);
    await assert.rejects(lstat(destination), error => error?.code === 'ENOENT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
const disposableDatabaseUrl = process.env.CCC_INSTALL_JOURNAL_TEST_DATABASE_URL;
const databaseTest = disposableDatabaseUrl === undefined ? test.skip : test;
databaseTest('production journal and receipt adapter commit real SQL success and roll back real SQL failure', async () => {
  const parsed = new URL(disposableDatabaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
    || !/(^|[_-])(test|fixture|disposable)([_-]|$)/iu.test(databaseName)
    || /(^|[_-])(prod|production)([_-]|$)/iu.test(databaseName)
    || parsed.search !== '' || parsed.hash !== '') {
    throw new Error('INVALID_DISPOSABLE_POSTGRES_FIXTURE');
  }
  const sql = postgres(disposableDatabaseUrl, { max: 1, onnotice: () => {} });
  const session = await sql.reserve();
  const verified = authorization();
  const plan = {
    resourcesSha256: '8'.repeat(64),
    migrationsSha256: '9'.repeat(64),
    planFingerprint: '7'.repeat(64),
    stateFingerprint: 'a'.repeat(64),
    migrations: [{
      id: '0001_apply_recovery_success.sql',
      checksum: null,
    }],
  };
  const authorize = async () => verified;
  const journal = createInstallJournalSession({ sql, authorization: verified, authorize });
  const idempotencyKey = 'b'.repeat(64);
  const backup = {
    backup: 'not_applicable',
    evidence: {
      businessTableCount: 0,
      businessRowCount: 0,
      authUserCount: 0,
      bucketCount: 0,
      storageObjectCount: 0,
      publicRoutineCount: 0,
      publicTypeCount: 0,
      privateInstallerTableCount: 0,
      installJournalCount: 0,
    },
  };
  let admitted = false;
  try {
    const [safety] = await session.unsafe(`SELECT
      current_database() AS database_name,
      to_regnamespace('private') IS NOT NULL OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relkind IN ('r','p','v','m','S','f')
      ) AS unsafe_objects`);
    if (safety.database_name !== databaseName || safety.unsafe_objects) {
      throw new Error('NONEMPTY_DISPOSABLE_POSTGRES_FIXTURE');
    }
    admitted = true;
    const successSql = `CREATE TABLE public.ccc_apply_recovery_success (
      id integer PRIMARY KEY
    ); INSERT INTO public.ccc_apply_recovery_success VALUES (1)`;
    plan.migrations[0].checksum = createHash('sha256').update(successSql).digest('hex');
    await journal.prepare(session, { plan, backup, idempotencyKey });
    await applyJournaledMigration(session, verified, {
      id: plan.migrations[0].id,
      checksum: plan.migrations[0].checksum,
      sql: successSql,
    }, { authorize });
    const brokenSql = `CREATE TABLE public.ccc_apply_recovery_failure (
      id integer PRIMARY KEY
    ); SELECT missing_column FROM public.ccc_apply_recovery_failure`;
    await assert.rejects(
      applyJournaledMigration(session, verified, {
        id: '0002_apply_recovery_failure.sql',
        checksum: createHash('sha256').update(brokenSql).digest('hex'),
        sql: brokenSql,
      }, { authorize }),
      error => error?.code === 'MIGRATION_APPLY_FAILED',
    );
    const incomplete = await readInstallState(session, verified.installationId);
    assert.equal(incomplete.journal.phase, 'installing');
    assert.equal(incomplete.journal.lastErrorCode, 'MIGRATION_APPLY_FAILED');
    assert.deepEqual(incomplete.migrations.map(({ id }) => id), [plan.migrations[0].id]);
    assert.equal(incomplete.currentReceipt, null);
    assert.deepEqual(incomplete.releaseHistory, []);
    const promotion = {
      artifactSetDigest: 'c'.repeat(64),
      databaseFingerprint: incomplete.journal.databaseFingerprint,
      stateFingerprint: incomplete.journal.databaseFingerprint,
      providerResourceDigests: {},
    };
    await journal.promoted(session, { idempotencyKey, promotion });
    const edgeRegionEvidence = {
      requestedRegion: 'ap-northeast-2',
      responseRegion: 'ap-northeast-2',
      functionRegion: 'ap-northeast-2',
      mismatch: false,
    };
    const health = {
      healthy: true,
      stateFingerprint: promotion.stateFingerprint,
      observedOwnerOrgIdHash: verified.expectedOwnerOrgIdHash,
      storageSignerHealthy: true,
      edgeRegionEvidence,
      restrictedDatabase: {
        connected: true,
        role: 'ccc_api',
        superuser: false,
        bypassRls: false,
      },
    };
    const edge = { edgeArtifactSha256: 'd'.repeat(64) };
    const receipt = {
      releaseSequence: 7,
      manifestDigest: 'e'.repeat(64),
      artifactSetDigest: promotion.artifactSetDigest,
      edgeArtifactSha256: edge.edgeArtifactSha256,
      backup,
    };
    await journal.complete(session, {
      authorization: verified,
      plan,
      bundle: { version: '0.9.0-dev.1', sequence: '7' },
      edge,
      promotion,
      health,
      receipt,
      now: createTrustedClock(NOW),
    });
    const installed = await readInstallState(session, verified.installationId);
    assert.equal(installed.journal.phase, 'installed');
    assert.equal(installed.currentReceipt.releaseSequence, 7);
    assert.deepEqual(installed.currentReceipt.edgeRegionEvidence, edgeRegionEvidence);
    assert.equal(installed.releaseHistory.length, 1);
    const [observed] = await session.unsafe(`SELECT
      (SELECT count(*)::integer FROM public.ccc_apply_recovery_success) AS row_count,
      to_regclass('public.ccc_apply_recovery_failure') IS NOT NULL AS failed_table_exists`);
    assert.deepEqual(observed, { row_count: 1, failed_table_exists: false });
  } finally {
    if (admitted) {
      await session.unsafe(`DROP TABLE IF EXISTS
        public.ccc_apply_recovery_success,
        public.ccc_apply_recovery_failure CASCADE`);
      await session.unsafe('DROP SCHEMA IF EXISTS private CASCADE');
    }
    await session.release();
    await sql.end();
  }
});
