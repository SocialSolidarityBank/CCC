import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  generateProviderBaseline,
  runProviderBaselineCli,
} from './provider-baseline-generate.mjs';
import {
  BETA_TRUST_DOMAIN,
  requireProviderBaseline,
} from './provider-baseline.mjs';
import * as verifier from '../../apps/community-cloud/dist/install-manifest-verifier.js';

const NOW = new Date('2026-09-11T12:00:00.000Z');
const HASH = value => verifier.sha256Utf8(value);

function base64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function keyPair(keyId) {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return {
    keyId,
    privateKey: pair.privateKey,
    publicKey: base64(await crypto.subtle.exportKey('raw', pair.publicKey)),
  };
}

async function sourceIdentity(record) {
  const { provenance: _provenance, ...identity } = record;
  return verifier.sha256Jcs(identity);
}

function objects() {
  return [{
    kind: 'relation',
    schema: 'auth',
    identity: 'auth.users TABLE',
    owner: 'supabase_auth_admin',
    definitionSha256: '33'.repeat(32),
    provenance: 'supabase_managed',
  }, {
    kind: 'schema',
    schema: 'extensions',
    identity: 'extensions',
    owner: 'postgres',
    definitionSha256: '44'.repeat(32),
    provenance: 'extension',
  }];
}

function grants() {
  return [{
    kind: 'relation',
    schema: 'auth',
    objectIdentity: 'auth.users TABLE',
    grantor: 'supabase_auth_admin',
    grantee: 'authenticated',
    privilege: 'SELECT',
    grantable: false,
    provenance: 'supabase_managed',
  }, {
    kind: 'schema',
    schema: 'extensions',
    objectIdentity: 'extensions',
    grantor: 'postgres',
    grantee: 'postgres',
    privilege: 'USAGE',
    grantable: true,
    provenance: 'initial_privilege',
  }];
}

async function inventory(overrides = {}) {
  const currentObjects = overrides.objects ?? objects();
  const currentGrants = overrides.grants ?? grants();
  return {
    objects: currentObjects,
    grants: currentGrants,
    objectInventorySha256: await verifier.sha256Jcs(currentObjects),
    grantInventorySha256: await verifier.sha256Jcs(currentGrants),
    ...overrides,
  };
}

async function snapshot(overrides = {}) {
  return {
    project: {
      region: 'ap-northeast-2',
      ownerOrgIdHash: await HASH('owner'),
      databaseVersion: '17.4',
    },
    connection: { readOnly: true },
    state: {
      userTableCount: 0,
      userRowEstimate: 0,
      authUserCount: 0,
      bucketCount: 0,
      storageObjectCount: 0,
      ...(overrides.state ?? {}),
    },
    providerInventory: overrides.providerInventory ?? await inventory(),
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => !['state', 'providerInventory'].includes(key))),
  };
}

async function sourceEvidence(records = [...objects(), ...grants()].filter(record => record.provenance === 'supabase_managed')) {
  return {
    schemaVersion: 1,
    provider: 'supabase',
    sourceRevision: '55'.repeat(20),
    databaseVersion: '17.4',
    records: await Promise.all(records.map(async (record, index) => ({
      kind: record.kind,
      identitySha256: await sourceIdentity(record),
      sourceUrl: index % 2 === 0
        ? 'https://github.com/supabase/supabase'
        : 'https://github.com/supabase/postgres',
      sourcePath: index % 2 === 0 ? 'apps/studio/schema.sql' : 'migrations/grants.sql',
      sourceSha256: `${index + 6}`.repeat(64),
    }))),
  };
}

async function fixture() {
  const root = await keyPair('root-20260911');
  const release = await keyPair('release-20260911');
  const projectRefHash = await HASH('project');
  const expectedOwnerOrgIdHash = await HASH('owner');
  const authorization = {
    installationId: 'synthetic-installation',
    institutionIdHash: await HASH('institution'),
    projectRefHash,
    expectedOwnerOrgIdHash,
    runtimeManifestSha256: await HASH('manifest'),
    approvalSha256: await HASH('approval'),
    runtimeConfigurationSha256: await HASH('configuration'),
    contractVersion: 'S11-install-approval-v1',
    runtimeSequence: 1,
    expiresAt: '2026-09-21T00:00:00.000Z',
  };
  const releaseTrustUnsigned = {
    schemaVersion: 1,
    profile: 'development',
    channel: 'beta',
    provider: 'supabase',
    projectRefSha256: projectRefHash,
    ownerOrgIdSha256: expectedOwnerOrgIdHash,
    region: 'ap-northeast-2',
    rootKeyId: root.keyId,
    releaseKeyId: release.keyId,
    releasePublicKey: release.publicKey,
    notBefore: '2026-09-11T00:00:00.000Z',
    expiresAt: '2026-09-20T00:00:00.000Z',
  };
  const directory = await mkdtemp(join(tmpdir(), 'ccc-provider-baseline-'));
  const outputPaths = {
    releaseTrust: join(directory, 'release-trust.json'),
    baseline: join(directory, 'provider-baseline.json'),
  };
  return {
    root,
    release,
    authorization,
    releaseTrustUnsigned,
    rootKeys: { [root.keyId]: root.publicKey },
    revokedRootKeyIds: [],
    sourceEvidenceInput: JSON.stringify(await sourceEvidence()),
    now: NOW,
    outputPaths,
    directory,
  };
}

function fakeInspector(...observations) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async inspect() {
      const observation = observations[calls];
      calls += 1;
      return observation;
    },
  };
}

async function generationInputs(current, before, after) {
  const first = before ?? await snapshot();
  const second = after ?? first;
  return {
    authorization: current.authorization,
    releaseTrustUnsigned: current.releaseTrustUnsigned,
    rootPrivateKey: current.root.privateKey,
    releasePrivateKey: current.release.privateKey,
    rootKeys: current.rootKeys,
    revokedRootKeyIds: current.revokedRootKeyIds,
    sourceEvidenceInput: current.sourceEvidenceInput,
    inspector: fakeInspector(first, second),
    now: current.now,
    outputPaths: current.outputPaths,
  };
}

async function assertAbsent(paths) {
  for (const path of Object.values(paths)) {
    await assert.rejects(stat(path), error => error?.code === 'ENOENT');
  }
}

async function assertGenerationFailure(inputs, code = 'PROVIDER_BASELINE_INVALID') {
  await assert.rejects(generateProviderBaseline(inputs), error => error?.code === code && error.message === code);
  await assertAbsent(inputs.outputPaths);
}

async function withFixture(run) {
  const current = await fixture();
  try {
    await run(current);
  } finally {
    await rm(current.directory, { recursive: true, force: true });
  }
}

test('signs verified stable empty observations and writes owner-only verified documents', async () => {
  await withFixture(async current => {
    const observed = await snapshot();
    const inputs = await generationInputs(current, observed, structuredClone(observed));
    const result = await generateProviderBaseline(inputs);

    assert.deepEqual(Object.keys(result), [
      'releaseTrustSha256', 'baselineSha256', 'baselineVersion',
      'objectCount', 'grantCount', 'sourceEvidenceSha256',
    ]);
    assert.equal(result.baselineVersion, 'supabase-hosted-pg17-20260911-v1');
    assert.equal(result.objectCount, 2);
    assert.equal(result.grantCount, 2);
    assert.match(result.releaseTrustSha256, /^[0-9a-f]{64}$/u);
    assert.match(result.baselineSha256, /^[0-9a-f]{64}$/u);
    assert.match(result.sourceEvidenceSha256, /^[0-9a-f]{64}$/u);
    assert.equal((await stat(current.outputPaths.releaseTrust)).mode & 0o777, 0o600);
    assert.equal((await stat(current.outputPaths.baseline)).mode & 0o777, 0o600);

    const releaseTrust = await readFile(current.outputPaths.releaseTrust, 'utf8');
    const providerBaseline = await readFile(current.outputPaths.baseline, 'utf8');
    const verified = await requireProviderBaseline({
      releaseTrust,
      providerBaseline,
      rootKeys: current.rootKeys,
      revokedRootKeyIds: [],
      authorization: current.authorization,
      manifestExpiresAt: current.authorization.expiresAt,
      now: NOW,
      verifier,
    });
    assert.equal(verified.releaseTrustSha256, result.releaseTrustSha256);
    assert.equal(verified.baselineSha256, result.baselineSha256);
  });
});

test('verifies authorization, external root and root keypair before the first observation', async () => {
  await withFixture(async current => {
    for (const mutate of [
      inputs => { inputs.authorization.expiresAt = '2026-09-11T11:59:59.000Z'; },
      inputs => { inputs.rootKeys = { [current.root.keyId]: current.release.publicKey }; },
      inputs => { inputs.revokedRootKeyIds = [current.root.keyId]; },
      inputs => {
        inputs.releaseTrustUnsigned.notBefore = `Fri,${' '.repeat(1_025)}11 Sep 2026 00:00:00 GMT`;
      },
    ]) {
      const inputs = await generationInputs(current);
      mutate(inputs);
      await assertGenerationFailure(inputs, 'BETA_TRUST_INVALID');
      assert.equal(inputs.inspector.calls, 0);
    }
  });
});

test('rejects strict source evidence failures without partial output', async () => {
  await withFixture(async current => {
    const valid = await sourceEvidence();
    const cases = [
      ['missing mapping', { ...valid, records: valid.records.slice(0, 1) }],
      ['duplicate mapping', { ...valid, records: [...valid.records, valid.records[0]] }],
      ['non-GitHub origin', { ...valid, records: [{ ...valid.records[0], sourceUrl: 'https://example.com/supabase' }, valid.records[1]] }],
      ['moving branch URL', { ...valid, records: [{ ...valid.records[0], sourceUrl: 'https://github.com/supabase/supabase/tree/main' }, valid.records[1]] }],
      ['wrong source hash', { ...valid, records: [{ ...valid.records[0], sourceSha256: 'A'.repeat(64) }, valid.records[1]] }],
      ['wrong identity hash', { ...valid, records: [{ ...valid.records[0], identitySha256: '00'.repeat(32) }, valid.records[1]] }],
      ['nonnormal source path', { ...valid, records: [{ ...valid.records[0], sourcePath: 'schema/../schema.sql' }, valid.records[1]] }],
      ['unknown evidence field', { ...valid, unknown: true }],
    ];
    for (const [name, evidence] of cases) {
      const inputs = await generationInputs(current);
      inputs.sourceEvidenceInput = JSON.stringify(evidence);
      await assertGenerationFailure(inputs).catch(error => { error.message = `${name}: ${error.message}`; throw error; });
    }
  });
});

test('rejects duplicate JSON keys in source evidence without observing or writing', async () => {
  await withFixture(async current => {
    const inputs = await generationInputs(current);
    inputs.sourceEvidenceInput = inputs.sourceEvidenceInput.replace('"schemaVersion":1', '"schemaVersion":1,"schemaVersion":1');
    await assertGenerationFailure(inputs);
    assert.equal(inputs.inspector.calls, 0);
  });
});

test('rejects database version and either inventory hash drift without partial output', async () => {
  await withFixture(async current => {
    const wrongVersion = await snapshot({ project: { region: 'ap-northeast-2', ownerOrgIdHash: await HASH('owner'), databaseVersion: '16.8' } });
    await assertGenerationFailure(await generationInputs(current, wrongVersion, wrongVersion), 'PROVIDER_BASELINE_MISMATCH');

    const before = await snapshot();
    const changedObjects = await inventory({ objects: [...objects(), {
      kind: 'type', schema: 'auth', identity: 'auth.factor_type', owner: 'supabase_auth_admin',
      definitionSha256: '77'.repeat(32), provenance: 'supabase_managed',
    }] });
    await assertGenerationFailure(
      await generationInputs(current, before, await snapshot({ providerInventory: changedObjects })),
      'PROVIDER_BASELINE_MISMATCH',
    );

    const changedGrants = await inventory({ grants: grants().slice(0, 1) });
    await assertGenerationFailure(
      await generationInputs(current, before, await snapshot({ providerInventory: changedGrants })),
      'PROVIDER_BASELINE_MISMATCH',
    );
  });
});

test('rejects every nonempty business counter in either observation without partial output', async () => {
  await withFixture(async current => {
    for (const counter of ['userTableCount', 'userRowEstimate', 'authUserCount', 'bucketCount', 'storageObjectCount']) {
      for (const observationIndex of [0, 1]) {
        const observations = [await snapshot(), await snapshot()];
        observations[observationIndex].state[counter] = 1;
        await assertGenerationFailure(
          await generationInputs(current, observations[0], observations[1]),
          'PROVIDER_BASELINE_MISMATCH',
        );
      }
    }
  });
});

test('never overwrites either existing output or leaves the other output behind', async () => {
  await withFixture(async current => {
    for (const existing of ['releaseTrust', 'baseline']) {
      await writeFile(current.outputPaths[existing], 'owner-data', { mode: 0o600 });
      const inputs = await generationInputs(current);
      await assert.rejects(generateProviderBaseline(inputs), error => error?.code === 'PROVIDER_BASELINE_INVALID');
      assert.equal(await readFile(current.outputPaths[existing], 'utf8'), 'owner-data');
      const other = existing === 'releaseTrust' ? 'baseline' : 'releaseTrust';
      await assert.rejects(stat(current.outputPaths[other]), error => error?.code === 'ENOENT');
      await rm(current.outputPaths[existing]);
    }
  });
});

test('CLI accepts only the three documented flags and emits only redacted result fields', async () => {
  await withFixture(async current => {
    const observed = await snapshot();
    const secretText = [
      'https://api.supabase.com', 'synthetic-project-ref', 'auth.users TABLE',
      current.root.publicKey, current.release.publicKey, 'postgresql://owner:secret@db.invalid/postgres',
      'Bearer synthetic-token',
    ];
    const argv = [
      '--source-evidence', 'ignored-by-loader.json',
      '--release-trust-output', current.outputPaths.releaseTrust,
      '--baseline-output', current.outputPaths.baseline,
    ];
    let stdout = '';
    let stderr = '';
    const exitCode = await runProviderBaselineCli(argv, {
      stdout: { write: value => { stdout += value; } },
      stderr: { write: value => { stderr += value; } },
      loadInputs: async ({ sourceEvidenceInput, outputPaths }) => ({
        ...await generationInputs(current, observed, structuredClone(observed)),
        sourceEvidenceInput: current.sourceEvidenceInput,
        outputPaths,
      }),
    });
    assert.equal(exitCode, 0);
    assert.equal(stderr, '');
    const output = JSON.parse(stdout);
    assert.deepEqual(Object.keys(output), [
      'baselineVersion', 'objectCount', 'grantCount', 'sourceEvidenceSha256',
      'releaseTrustSha256', 'baselineSha256',
    ]);
    assert.deepEqual(Object.keys(output).sort(), [
      'baselineVersion', 'objectCount', 'grantCount', 'sourceEvidenceSha256',
      'releaseTrustSha256', 'baselineSha256',
    ].sort());
    for (const forbidden of secretText) assert.doesNotMatch(`${stdout}${stderr}`, new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

    for (const forbiddenFlag of ['--url', '--project', '--owner', '--root-key', '--release-key']) {
      stdout = '';
      stderr = '';
      let loaded = false;
      const rejected = await runProviderBaselineCli([...argv, forbiddenFlag, 'secret'], {
        stdout: { write: value => { stdout += value; } },
        stderr: { write: value => { stderr += value; } },
        loadInputs: async () => { loaded = true; },
      });
      assert.equal(rejected, 1);
      assert.equal(loaded, false);
      assert.equal(stdout, '');
      assert.equal(stderr, '');
    }
  });
});

test('generated trust signature uses the beta trust domain', async () => {
  await withFixture(async current => {
    const inputs = await generationInputs(current);
    await generateProviderBaseline(inputs);
    const trust = JSON.parse(await readFile(current.outputPaths.releaseTrust, 'utf8'));
    const { ed25519Signature, ...unsigned } = trust;
    const message = Buffer.concat([
      Buffer.from(BETA_TRUST_DOMAIN, 'ascii'),
      Buffer.from(verifier.canonicalizeJcs(unsigned), 'utf8'),
    ]);
    assert.equal(await verifier.verifyEd25519Bytes(message, ed25519Signature, current.root.publicKey), true);
  });
});
