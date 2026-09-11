import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { readdirSync } from 'node:fs';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mock, test } from 'node:test';

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
  const records = [{
    kind: 'relation',
    schema: 'auth',
    objectIdentity: 'auth.users TABLE',
    grantor: 'supabase_auth_admin',
    grantee: 'authenticated',
    privilege: 'SELECT',
    grantable: false,
    inheritOption: null,
    setOption: null,
    provenance: 'supabase_managed',
  }, {
    kind: 'routine',
    schema: 'auth',
    objectIdentity: 'auth.uid() FUNCTION RETURNS uuid',
    grantor: 'supabase_auth_admin',
    grantee: 'authenticated',
    privilege: 'EXECUTE',
    grantable: false,
    inheritOption: null,
    setOption: null,
    provenance: 'supabase_managed',
  }, {
    kind: 'type',
    schema: 'storage',
    objectIdentity: 'storage.bucket_type',
    grantor: 'supabase_storage_admin',
    grantee: 'authenticated',
    privilege: 'USAGE',
    grantable: false,
    inheritOption: null,
    setOption: null,
    provenance: 'supabase_managed',
  }, {
    kind: 'schema',
    schema: 'extensions',
    objectIdentity: 'extensions',
    grantor: 'postgres',
    grantee: 'postgres',
    privilege: 'USAGE',
    grantable: true,
    inheritOption: null,
    setOption: null,
    provenance: 'initial_privilege',
  }];
  return records.sort((left, right) => Buffer.compare(
    Buffer.from(verifier.canonicalizeJcs(left), 'utf8'),
    Buffer.from(verifier.canonicalizeJcs(right), 'utf8'),
  ));
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
  const sourceUrls = [
    'https://github.com/supabase/auth',
    'https://github.com/supabase/storage',
    'https://github.com/supabase/realtime',
    'https://github.com/postgres/postgres',
    'https://github.com/supabase/supabase',
    'https://github.com/supabase/postgres',
  ];
  return {
    schemaVersion: 1,
    provider: 'supabase',
    databaseVersion: '17.4',
    records: await Promise.all(records.map(async (record, index) => ({
      kind: record.kind,
      identitySha256: await sourceIdentity(record),
      sourceUrl: sourceUrls[index % sourceUrls.length],
      sourceRevision: (await HASH(`revision-${index}`)).slice(0, 40),
      sourcePath: index % 2 === 0 ? 'apps/studio/schema.sql' : 'migrations/grants.sql',
      sourceSha256: await HASH(`source-${index}`),
    }))),
  };
}

function canonicalSort(records) {
  return [...records].sort((left, right) => Buffer.compare(
    Buffer.from(verifier.canonicalizeJcs(left), 'utf8'),
    Buffer.from(verifier.canonicalizeJcs(right), 'utf8'),
  ));
}

function longRoutineIdentity(byteLength) {
  const prefix = 'extensions.';
  const suffix = '(text) FUNCTION RETURNS text';
  return `${prefix}${'r'.repeat(byteLength - prefix.length - suffix.length)}${suffix}`;
}

function sourcePathOfLength(byteLength) {
  const prefix = 'migrations/';
  const suffix = '.sql';
  return `${prefix}${'s'.repeat(byteLength - prefix.length - suffix.length)}${suffix}`;
}

async function longRoutineFixture(identityBytes, sourcePathBytes = 32) {
  const identity = longRoutineIdentity(identityBytes);
  const routine = {
    kind: 'routine',
    schema: 'extensions',
    identity,
    owner: 'supabase_admin',
    definitionSha256: '88'.repeat(32),
    provenance: 'supabase_managed',
  };
  const routineGrants = ['anon', 'authenticated', 'service_role'].map(grantee => ({
    kind: 'routine',
    schema: 'extensions',
    objectIdentity: identity,
    grantor: 'supabase_admin',
    grantee,
    privilege: 'EXECUTE',
    grantable: false,
    inheritOption: null,
    setOption: null,
    provenance: 'supabase_managed',
  }));
  const currentObjects = canonicalSort([...objects(), routine]);
  const currentGrants = canonicalSort([...grants(), ...routineGrants]);
  const providerInventory = await inventory({
    objects: currentObjects,
    grants: currentGrants,
  });
  const evidence = await sourceEvidence(
    [...currentObjects, ...currentGrants]
      .filter(record => record.provenance === 'supabase_managed'),
  );
  evidence.records[0].sourcePath = sourcePathOfLength(sourcePathBytes);
  return { identity, providerInventory, evidence };
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
    now: () => new Date(NOW),
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

test('signs verified stable empty observations including routine and type grant evidence', async () => {
  await withFixture(async current => {
    const observed = await snapshot();
    const inputs = await generationInputs(current, observed, structuredClone(observed));
    assert.deepEqual(
      new Set(JSON.parse(current.sourceEvidenceInput).records.map(record => record.sourceUrl)),
      new Set([
        'https://github.com/supabase/auth',
        'https://github.com/supabase/storage',
        'https://github.com/supabase/realtime',
        'https://github.com/postgres/postgres',
      ]),
    );
    assert.equal(
      JSON.parse(current.sourceEvidenceInput).records
        .every(record => /^[0-9a-f]{40}$/u.test(record.sourceRevision)),
      true,
    );
    const result = await generateProviderBaseline(inputs);

    assert.deepEqual(Object.keys(result), [
      'releaseTrustSha256', 'baselineSha256', 'baselineVersion',
      'objectCount', 'grantCount', 'sourceEvidenceSha256',
    ]);
    assert.equal(result.baselineVersion, 'supabase-hosted-pg17-20260911-v1');
    assert.equal(result.objectCount, 2);
    assert.equal(result.grantCount, 4);
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
    assert.deepEqual(
      verified.grants
        .filter(grant => ['routine', 'type'].includes(grant.kind))
        .map(({ kind, objectIdentity, privilege, inheritOption, setOption }) => (
          { kind, objectIdentity, privilege, inheritOption, setOption }
        )),
      [{
        kind: 'routine',
        objectIdentity: 'auth.uid() FUNCTION RETURNS uuid',
        privilege: 'EXECUTE',
        inheritOption: null,
        setOption: null,
      }, {
        kind: 'type',
        objectIdentity: 'storage.bucket_type',
        privilege: 'USAGE',
        inheritOption: null,
        setOption: null,
      }],
    );
  });
});

test('accepts 4096-byte provider identities and evidence paths but rejects larger values', async () => {
  await withFixture(async current => {
    const long = await longRoutineFixture(4_096, 4_096);
    const observed = await snapshot({ providerInventory: long.providerInventory });
    const inputs = await generationInputs(current, observed, structuredClone(observed));
    inputs.sourceEvidenceInput = JSON.stringify(long.evidence);
    await generateProviderBaseline(inputs);
    const verified = await requireProviderBaseline({
      releaseTrust: await readFile(current.outputPaths.releaseTrust, 'utf8'),
      providerBaseline: await readFile(current.outputPaths.baseline, 'utf8'),
      rootKeys: current.rootKeys,
      revokedRootKeyIds: [],
      authorization: current.authorization,
      manifestExpiresAt: current.authorization.expiresAt,
      now: NOW,
      verifier,
    });
    assert.equal(Buffer.byteLength(long.identity, 'utf8'), 4_096);
    assert.equal(
      verified.grants.filter(grant => grant.objectIdentity === long.identity).length,
      3,
    );
  });

  await withFixture(async current => {
    const long = await longRoutineFixture(4_097);
    const observed = await snapshot({ providerInventory: long.providerInventory });
    const inputs = await generationInputs(current, observed, structuredClone(observed));
    inputs.sourceEvidenceInput = JSON.stringify(long.evidence);
    await assertGenerationFailure(inputs);
  });

  await withFixture(async current => {
    const long = await longRoutineFixture(1_654, 4_097);
    const observed = await snapshot({ providerInventory: long.providerInventory });
    const inputs = await generationInputs(current, observed, structuredClone(observed));
    inputs.sourceEvidenceInput = JSON.stringify(long.evidence);
    await assertGenerationFailure(inputs);
  });
});

test('verifies each authorization, external root, keypair and timestamp failure before observation', async () => {
  const mutations = [
    (_current, inputs) => { inputs.authorization.expiresAt = '2026-09-11T11:59:59.000Z'; },
    (current, inputs) => { inputs.rootKeys = { [current.root.keyId]: current.release.publicKey }; },
    (current, inputs) => { inputs.revokedRootKeyIds = [current.root.keyId]; },
    (_current, inputs) => {
      inputs.releaseTrustUnsigned.notBefore = new String('2026-09-11T00:00:00.000Z');
    },
    (_current, inputs) => {
      inputs.releaseTrustUnsigned.notBefore = `Fri,${' '.repeat(1_025)}11 Sep 2026 00:00:00 GMT`;
    },
  ];
  for (const mutate of mutations) {
    await withFixture(async current => {
      const inputs = await generationInputs(current);
      mutate(current, inputs);
      await assertGenerationFailure(inputs, 'BETA_TRUST_INVALID');
      assert.equal(inputs.inspector.calls, 0);
    });
  }
});

test('rejects strict source evidence failures without partial output', async () => {
  await withFixture(async current => {
    const valid = await sourceEvidence();
    const replaceFirst = overrides => [
      { ...valid.records[0], ...overrides },
      ...valid.records.slice(1),
    ];
    const omitFirst = field => {
      const first = { ...valid.records[0] };
      delete first[field];
      return [first, ...valid.records.slice(1)];
    };
    const cases = [
      ['missing mapping', { ...valid, records: valid.records.slice(0, 1) }],
      ['duplicate mapping', { ...valid, records: [...valid.records, valid.records[0]] }],
      ['unlisted repository', { ...valid, records: replaceFirst({ sourceUrl: 'https://github.com/example/supabase' }) }],
      ['moving branch URL', { ...valid, records: replaceFirst({ sourceUrl: 'https://github.com/supabase/supabase/tree/main' }) }],
      ['missing record revision', { ...valid, records: omitFirst('sourceRevision') }],
      ['moving revision', { ...valid, records: replaceFirst({ sourceRevision: 'main' }) }],
      ['malformed revision', { ...valid, records: replaceFirst({ sourceRevision: 'A'.repeat(40) }) }],
      ['wrong source hash', { ...valid, records: replaceFirst({ sourceSha256: 'A'.repeat(64) }) }],
      ['wrong identity hash', { ...valid, records: replaceFirst({ identitySha256: '00'.repeat(32) }) }],
      ['nonnormal source path', { ...valid, records: replaceFirst({ sourcePath: 'schema/../schema.sql' }) }],
      ['parent-only source path', { ...valid, records: replaceFirst({ sourcePath: '..' }) }],
      ['obsolete document revision', { ...valid, sourceRevision: '55'.repeat(20) }],
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

test('expiry reached after the last observation prevents baseline signing and publication', async () => {
  await withFixture(async current => {
    const observed = await snapshot();
    let observationCount = 0;
    let expired = false;
    const inputs = await generationInputs(current, observed, observed);
    inputs.inspector = {
      async inspect() {
        observationCount += 1;
        if (observationCount === 2) expired = true;
        return structuredClone(observed);
      },
    };
    inputs.now = () => new Date(expired ? current.releaseTrustUnsigned.expiresAt : NOW);
    const sign = mock.method(crypto.subtle, 'sign');
    try {
      await assertGenerationFailure(inputs, 'BETA_TRUST_INVALID');
      assert.equal(observationCount, 2);
      assert.equal(sign.mock.callCount(), 3);
    } finally {
      sign.mock.restore();
    }
  });
});

test('expiry reached during final verification prevents publication', async () => {
  await withFixture(async current => {
    let clockReads = 0;
    const inputs = await generationInputs(current);
    inputs.now = () => {
      clockReads += 1;
      return new Date(clockReads >= 11 ? current.releaseTrustUnsigned.expiresAt : NOW);
    };
    await assertGenerationFailure(inputs, 'BETA_TRUST_INVALID');
    assert.equal(clockReads, 11);
  });
});

test('expiry after temporary files exist prevents linking and removes every artifact', async () => {
  await withFixture(async current => {
    let observedTemporaryFiles = false;
    const inputs = await generationInputs(current);
    inputs.now = () => {
      const temporaryFiles = readdirSync(current.directory)
        .filter(name => name.endsWith('.tmp'));
      if (temporaryFiles.length === 2) observedTemporaryFiles = true;
      return new Date(observedTemporaryFiles ? current.releaseTrustUnsigned.expiresAt : NOW);
    };
    await assertGenerationFailure(inputs, 'BETA_TRUST_INVALID');
    assert.equal(observedTemporaryFiles, true);
    assert.deepEqual(readdirSync(current.directory), []);
  });
});

test('expiry immediately before success removes both linked documents', async () => {
  await withFixture(async current => {
    let reachedCompletionBoundary = false;
    const inputs = await generationInputs(current);
    inputs.now = () => {
      const names = readdirSync(current.directory);
      const outputsLinked = names.includes('release-trust.json')
        && names.includes('provider-baseline.json');
      if (outputsLinked && !names.some(name => name.endsWith('.tmp'))) {
        reachedCompletionBoundary = true;
      }
      return new Date(reachedCompletionBoundary ? current.releaseTrustUnsigned.expiresAt : NOW);
    };
    await assertGenerationFailure(inputs, 'BETA_TRUST_INVALID');
    assert.equal(reachedCompletionBoundary, true);
    assert.deepEqual(readdirSync(current.directory), []);
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

test('post-link failures roll back registered destinations or report incomplete cleanup', async () => {
  const actual = await import('node:fs/promises');
  let linkedDestination;
  let failPostLinkValidation = true;
  const bridgeKey = `ccc-provider-output-${randomUUID()}`;
  globalThis[bridgeKey] = {
    ...actual,
    link: async (source, destination) => {
      await actual.link(source, destination);
      linkedDestination = destination;
    },
    lstat: async path => {
      const info = await actual.lstat(path);
      if (path === linkedDestination && failPostLinkValidation) {
        failPostLinkValidation = false;
        return new Proxy(info, {
          get(target, property) {
            if (property === 'mode') return target.mode | 0o044;
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      }
      return info;
    },
  };
  const moduleUrl = new URL(`./provider-baseline-generate.mjs?rollback=${randomUUID()}`, import.meta.url);
  const bridgeSource = ['link', 'lstat', 'open', 'realpath', 'unlink']
    .map(name => `export const ${name}=(...args)=>globalThis[${JSON.stringify(bridgeKey)}].${name}(...args);`)
    .join('\n');
  const bridgeUrl = `data:text/javascript,${encodeURIComponent(bridgeSource)}`;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === 'node:fs/promises' && context.parentURL === moduleUrl.href) {
        return { shortCircuit: true, url: bridgeUrl };
      }
      return nextResolve(specifier, context);
    },
  });
  const current = await fixture();
  try {
    const isolated = await import(moduleUrl.href);
    const inputs = await generationInputs(current);
    await assert.rejects(
      isolated.generateProviderBaseline(inputs),
      error => error?.code === 'PROVIDER_BASELINE_INVALID',
    );
    await assertAbsent(current.outputPaths);

    failPostLinkValidation = true;
    linkedDestination = undefined;
    globalThis[bridgeKey].unlink = async path => {
      if (path === linkedDestination) {
        const error = new Error('blocked cleanup');
        error.code = 'EACCES';
        throw error;
      }
      return actual.unlink(path);
    };
    await assert.rejects(
      isolated.generateProviderBaseline(await generationInputs(current)),
      error => error?.code === 'OUTPUT_CLEANUP_INCOMPLETE'
        && error.message === 'OUTPUT_CLEANUP_INCOMPLETE',
    );
    assert.equal((await stat(current.outputPaths.releaseTrust)).isFile(), true);
    await actual.rm(current.outputPaths.releaseTrust);
    await assertAbsent(current.outputPaths);
  } finally {
    hooks.deregister();
    delete globalThis[bridgeKey];
    await rm(current.directory, { recursive: true, force: true });
  }
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
