import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { observationAuthorization } from './fixtures/authorization.mjs';
import { fingerprint } from './hosted-inspector.mjs';
import { providerInventoryFingerprint } from './provider-inventory.mjs';

import {
  PlanFailure,
  buildSupabasePlan as buildPlan,
  buildSupabaseDoctor as buildDoctor,
  installationStateFingerprint as stateFingerprint,
  expectedSupabaseResources,
} from './plan.mjs';

function providerFixture({ objectCount = 101, grantCount = 903 } = {}) {
  const objects = Array.from({ length: objectCount }, (_, index) => ({
    kind: 'catalog',
    schema: 'auth',
    identity: `provider-object-must-not-escape-${String(index).padStart(3, '0')}`,
    owner: 'supabase_admin',
    definitionSha256: createHash('sha256').update(`object-${index}`).digest('hex'),
    provenance: 'supabase_managed',
  }));
  const grants = Array.from({ length: grantCount }, (_, index) => ({
    kind: 'role',
    schema: '',
    objectIdentity: `provider-role-must-not-escape-${String(index).padStart(3, '0')}`,
    grantor: 'supabase_admin',
    grantee: 'authenticated',
    privilege: 'MEMBER',
    grantable: false,
    provenance: 'supabase_managed',
  }));
  return { objects, grants, ...providerInventoryFingerprint({ objects, grants }) };
}

const providerInventory = providerFixture();

function verifiedProviderFixture(inventory = providerInventory, overrides = {}) {
  return {
    baselineVersion: 'supabase-hosted-pg17-20260911-v1',
    projectRefSha256: observationAuthorization().projectRefHash,
    ownerOrgIdSha256: observationAuthorization().expectedOwnerOrgIdHash,
    region: 'ap-northeast-2',
    databaseVersion: '17.4',
    objects: inventory.objects,
    grants: inventory.grants,
    objectInventorySha256: inventory.objectInventorySha256,
    grantInventorySha256: inventory.grantInventorySha256,
    baselineSha256: 'b'.repeat(64),
    releaseTrustSha256: 'c'.repeat(64),
    expiresAt: observationAuthorization().expiresAt,
    ...overrides,
  };
}

function buildSupabasePlan(options) {
  return buildPlan({
    ...options,
    ...(options.target === 'hosted' && !Object.hasOwn(options, 'providerBaseline')
      ? { providerBaseline: verifiedProviderFixture() }
      : {}),
  });
}

function buildSupabaseDoctor(options) {
  return buildDoctor({
    ...options,
    ...(options.target === 'hosted' && !Object.hasOwn(options, 'providerBaseline')
      ? { providerBaseline: verifiedProviderFixture() }
      : {}),
  });
}

function installationStateFingerprint(snapshot, baseline = verifiedProviderFixture()) {
  return stateFingerprint(snapshot, baseline);
}

const stableState = Object.freeze({
  schemaFingerprint: 'schema-empty',
  policyFingerprint: 'policies-empty',
  bucketFingerprint: 'buckets-empty',
  authFingerprint: 'auth-invite-mfa',
  institutionDataFingerprint: 'data-empty',
  userTableCount: 0,
  userRowEstimate: 0,
  rlsEnabledTableCount: 0,
  policyCount: 0,
  authUserCount: 0,
  bucketCount: 0,
  storageObjectCount: 0,
  userRoutineCount: 0,
  userTypeCount: 0,
  unknownObjectCount: 101,
  customSchemaCount: 0,
  auxiliaryRelationCount: 0,
  unownedObjectCount: 101,
  unexpectedGrantCount: 903,
  privateTableNames: [],
  privateSchemaExists: false,
  legacyLedgerPresent: false,
  buckets: [],
  bucket: { exists: false, public: null },
});

function snapshot(overrides = {}) {
  return {
    project: {
      region: 'ap-northeast-2',
      databaseVersion: '17.4',
      status: 'ACTIVE_HEALTHY',
      ownerOrgIdHash: observationAuthorization().expectedOwnerOrgIdHash,
    },
    connection: {
      readOnly: true,
      databaseReadable: true,
      authReadable: true,
      storageReadable: true,
    },
    installed: {
      ledger: 'absent',
      version: null,
      checksum: null,
    },
    auth: {
      emailEnabled: true,
      openSignupDisabled: true,
      totpEnabled: true,
      refreshTokenRotationEnabled: true,
    },
    state: stableState,
    cronJobCount: 0,
    providerInventory,
    ...overrides,
  };
}

function inspector(...snapshots) {
  let index = 0;
  return {
    async inspect() {
      const value = snapshots[Math.min(index, snapshots.length - 1)];
      index += 1;
      return structuredClone(value);
    },
  };
}

function snapshotWithProviderInventory(inventory, overrides = {}) {
  return snapshot({
    ...overrides,
    state: {
      ...stableState,
      unownedObjectCount: inventory.objects.length,
      unknownObjectCount: inventory.objects.length,
      customSchemaCount: inventory.objects.filter(({ kind }) => kind === 'schema').length,
      unexpectedGrantCount: inventory.grants.length,
      ...(overrides.state ?? {}),
    },
    providerInventory: inventory,
  });
}

function observedBucket(id = 'ccc-audio', metadata = {
  public: false,
  fileSizeLimit: null,
  allowedMimeTypes: null,
}) {
  return {
    resourceType: 'storage_bucket',
    resourceIdHash: createHash('sha256').update(id, 'utf8').digest('hex'),
    resourceDigest: fingerprint(metadata),
  };
}

async function installedSnapshot({
  state = {},
  resources = [],
  migrations = [],
  journal = {},
} = {}) {
  const authorization = observationAuthorization();
  const desired = await buildSupabasePlan({
    target: 'hosted',
    authorization,
    inspector: inspector(snapshot(), snapshot()),
  });
  const journalAuthorization = {
    installationId: authorization.installationId,
    institutionIdHash: authorization.institutionIdHash,
    projectRefHash: authorization.projectRefHash,
    expectedOwnerOrgIdHash: authorization.expectedOwnerOrgIdHash,
    runtimeManifestSha256: authorization.runtimeManifestSha256,
    approvalSha256: authorization.approvalSha256,
    runtimeConfigurationSha256: authorization.runtimeConfigurationSha256,
    contractVersion: authorization.contractVersion,
    runtimeSequence: authorization.runtimeSequence,
    expiresAt: authorization.expiresAt,
  };
  const observed = snapshot({
    state: { ...stableState, ...state },
    installState: {
      journal: {
        ...journalAuthorization,
        resourcesSha256: desired.resourcesSha256,
        migrationsSha256: desired.migrationsSha256,
        phase: 'installed',
        databaseFingerprint: null,
        ...journal,
      },
      migrations,
      resources,
      completedSteps: [],
      currentReceipt: null,
      releaseHistory: [],
    },
  });
  if (!Object.hasOwn(journal, 'stateFingerprint')) {
    observed.installState.journal.stateFingerprint = await installationStateFingerprint(observed);
  }
  return { authorization, desired, observed };
}

async function installedReceiptSnapshot({ state = {}, resources = [] } = {}) {
  const fixture = await installedSnapshot({ state, resources });
  fixture.observed.installState.migrations = structuredClone(fixture.desired.migrations);
  fixture.observed.databaseFingerprint =
    createHash('sha256').update('installed-catalog').digest('hex');
  fixture.observed.installState.journal.databaseFingerprint = fixture.observed.databaseFingerprint;
  fixture.observed.installState.journal.stateFingerprint =
    await installationStateFingerprint(fixture.observed);
  const receipt = {
    contract: 'S11',
    contractVersion: '0.3',
    installationId: fixture.authorization.installationId,
    institutionIdHash: fixture.authorization.institutionIdHash,
    rollbackTarget: null,
    expectedOwnerOrgIdHash: fixture.authorization.expectedOwnerOrgIdHash,
    observedOwnerOrgIdHash: fixture.authorization.expectedOwnerOrgIdHash,
    releaseVersion: '1.0.0',
    releaseSequence: 1,
    manifestDigest: createHash('sha256').update('release-manifest').digest('hex'),
    artifactSetDigest: createHash('sha256').update('artifact-set').digest('hex'),
    migrationHead: fixture.desired.migrations.at(-1).id,
    schemaFingerprint: fixture.observed.databaseFingerprint,
    edgeRegionEvidence: {
      requestedRegion: 'ap-northeast-2',
      responseRegion: 'ap-northeast-2',
      functionRegion: 'ap-northeast-2',
      mismatch: false,
    },
    providerResourceDigests: Object.fromEntries(
      resources.map(resource => [resource.resourceIdHash, resource.resourceDigest]),
    ),
    backupId: null,
    backupDigest: null,
    priorReceiptDigest: null,
    recordedAt: '2026-09-11T00:00:00.000Z',
    status: 'installed',
  };
  fixture.observed.installState.currentReceipt = receipt;
  fixture.observed.installState.releaseHistory = [structuredClone(receipt)];
  return fixture;
}

function blockerCodes(result) {
  return result.blockers.map(blocker => blocker.code);
}

test('exact signed provider baseline approves only managed inventory', async () => {
  const observed = snapshotWithProviderInventory(providerInventory);
  const result = await buildPlan({
    target: 'hosted',
    authorization: observationAuthorization(),
    providerBaseline: verifiedProviderFixture(),
    inspector: inspector(observed, observed),
  });

  assert.equal(result.ready, true);
  assert.deepEqual(result.providerBaseline, {
    matched: true,
    baselineVersion: 'supabase-hosted-pg17-20260911-v1',
    expectedObjectCount: 101,
    observedObjectCount: 101,
    expectedGrantCount: 903,
    observedGrantCount: 903,
    objectInventorySha256: providerInventory.objectInventorySha256,
    grantInventorySha256: providerInventory.grantInventorySha256,
  });
  assert.equal(result.observed.userTableCount, 0);
  assert.equal(result.observed.userRowEstimate, 0);
  assert.doesNotMatch(JSON.stringify(result), /provider-(?:object|role)-must-not-escape|ed25519Signature/u);
});

test('provider baseline is required and raw signed input is rejected before observation', async () => {
  let calls = 0;
  const source = { inspect: async () => { calls += 1; return snapshot(); } };
  await assert.rejects(
    buildPlan({ target: 'hosted', authorization: observationAuthorization(), inspector: source }),
    error => error.code === 'PROVIDER_BASELINE_INVALID',
  );
  await assert.rejects(
    buildPlan({
      target: 'hosted',
      authorization: observationAuthorization(),
      providerBaseline: { ...verifiedProviderFixture(), ed25519Signature: 'bad-signature' },
      inspector: source,
    }),
    error => error.code === 'PROVIDER_BASELINE_INVALID',
  );
  assert.equal(calls, 0);
});

test('provider baseline rejects extra or missing exact records', async () => {
  const extra = providerFixture({ objectCount: 102 });
  const missing = {
    objects: providerInventory.objects.slice(0, -1),
    grants: providerInventory.grants,
  };
  Object.assign(missing, providerInventoryFingerprint(missing));
  for (const inventory of [extra, missing]) {
    const observed = snapshotWithProviderInventory(inventory);
    const result = await buildSupabasePlan({
      target: 'hosted',
      authorization: observationAuthorization(),
      inspector: inspector(observed, observed),
    });
    assert.equal(result.ready, false);

    assert.ok(blockerCodes(result).includes('PROVIDER_BASELINE_MISMATCH'));
  }
});

test('provider baseline cannot hide an unproved extra behind an overlapping installation candidate', async () => {
  const baselineInventory = providerFixture({ objectCount: 1, grantCount: 0 });
  baselineInventory.objects[0] = {
    ...baselineInventory.objects[0],
    schema: 'public',
    identity: 'overlapping-baseline-catalog-record',
  };
  Object.assign(baselineInventory, providerInventoryFingerprint(baselineInventory));
  const extra = {
    ...baselineInventory.objects[0],
    schema: 'auth',
    identity: 'unproved-provider-looking-record-must-not-escape',
  };
  const raw = {
    objects: [baselineInventory.objects[0], extra],
    grants: [],
    installationObjects: [baselineInventory.objects[0]],
    installationGrants: [],
  };
  Object.assign(raw, providerInventoryFingerprint(raw));
  const observed = snapshotWithProviderInventory(raw, {
    databaseFingerprint: 'd'.repeat(64),
    state: {
      unownedObjectCount: 1,
      unknownObjectCount: 1,
      customSchemaCount: 0,
      unexpectedGrantCount: 0,
    },
    installState: {
      journal: { databaseFingerprint: 'd'.repeat(64) },
      migrations: [],
      resources: [],
    },
  });
  const result = await buildPlan({
    target: 'hosted',
    authorization: observationAuthorization(),
    providerBaseline: verifiedProviderFixture(baselineInventory),
    inspector: inspector(observed, observed),
  });
  assert.equal(result.providerBaseline.matched, false);
  assert.ok(blockerCodes(result).includes('PROVIDER_BASELINE_MISMATCH'));
  assert.doesNotMatch(JSON.stringify(result), /unproved-provider-looking-record/u);
});

test('provider baseline expiry between observations stops before further access', async () => {
  const baseline = verifiedProviderFixture();
  let calls = 0;
  const source = {
    async inspect() {
      calls += 1;
      if (calls === 1) baseline.expiresAt = new Date(Date.now() - 1).toISOString();
      return snapshot();
    },
  };
  await assert.rejects(
    buildPlan({
      target: 'hosted',
      authorization: observationAuthorization(),
      providerBaseline: baseline,
      inspector: source,
    }),
    error => error.code === 'PROVIDER_BASELINE_INVALID',
  );
  assert.equal(calls, 1);
});

test('provider baseline expiry before doctor observation result is never matched', async () => {
  const baseline = verifiedProviderFixture();
  let calls = 0;
  const source = {
    async inspect() {
      calls += 1;
      if (calls === 3) baseline.expiresAt = new Date(Date.now() - 1).toISOString();
      return snapshot();
    },
  };
  await assert.rejects(
    buildDoctor({
      target: 'hosted',
      authorization: observationAuthorization(),
      providerBaseline: baseline,
      inspector: source,
    }),
    error => error.code === 'PROVIDER_BASELINE_INVALID',
  );
  assert.equal(calls, 3);
});

test('provider baseline detects inventory drift between observations', async () => {
  const changed = providerFixture({ grantCount: 904 });
  const result = await buildSupabasePlan({
    target: 'hosted',
    authorization: observationAuthorization(),
    inspector: inspector(
      snapshotWithProviderInventory(providerInventory),
      snapshotWithProviderInventory(changed),
    ),
  });
  assert.equal(result.ready, false);
  assert.equal(result.unchanged, false);
  assert.ok(blockerCodes(result).includes('PROVIDER_BASELINE_MISMATCH'));
  assert.ok(blockerCodes(result).includes('PLAN_STATE_CHANGED'));
});

test('provider baseline requires the observed database version', async () => {
  const observed = snapshotWithProviderInventory(providerInventory, {
    project: {
      region: 'ap-northeast-2',
      databaseVersion: '17.5',
      status: 'ACTIVE_HEALTHY',
      ownerOrgIdHash: observationAuthorization().expectedOwnerOrgIdHash,
    },
  });
  const result = await buildSupabasePlan({
    target: 'hosted',
    authorization: observationAuthorization(),
    inspector: inspector(observed, observed),
  });
  assert.equal(result.ready, false);
  assert.ok(blockerCodes(result).includes('PROVIDER_BASELINE_MISMATCH'));
});

test('provider baseline never exempts business tables, users, buckets or storage objects', async () => {
  for (const state of [
    { userTableCount: 1 },
    { userRowEstimate: 1 },
    { authUserCount: 1 },
    { bucketCount: 1 },
    { storageObjectCount: 1 },
  ]) {
    const observed = snapshotWithProviderInventory(providerInventory, { state });
    const result = await buildSupabasePlan({
      target: 'hosted',
      authorization: observationAuthorization(),
      inspector: inspector(observed, observed),
    });
    assert.equal(result.ready, false);
    assert.ok(blockerCodes(result).includes('EXISTING_PROJECT_NOT_CLEAN'));
  }
});

test('provider baseline identity binds state, resources and plan fingerprints', async () => {
  const observed = snapshotWithProviderInventory(providerInventory);
  const first = await buildPlan({
    target: 'hosted',
    authorization: observationAuthorization(),
    providerBaseline: verifiedProviderFixture(),
    inspector: inspector(observed, observed),
  });
  const second = await buildPlan({
    target: 'hosted',
    authorization: observationAuthorization(),
    providerBaseline: verifiedProviderFixture(providerInventory, {
      baselineVersion: 'supabase-hosted-pg17-20260911-v2',
      baselineSha256: 'd'.repeat(64),
    }),
    inspector: inspector(observed, observed),
  });
  assert.notEqual(first.stateFingerprint, second.stateFingerprint);
  assert.notEqual(first.resourcesSha256, second.resourcesSha256);
  assert.notEqual(first.planFingerprint, second.planFingerprint);
});

test('provider baseline doctor reports only redacted latest inventory evidence', async () => {
  const changed = providerFixture({ objectCount: 102 });
  const result = await buildSupabaseDoctor({
    target: 'hosted',
    authorization: observationAuthorization(),
    inspector: inspector(
      snapshotWithProviderInventory(providerInventory),
      snapshotWithProviderInventory(providerInventory),
      snapshotWithProviderInventory(changed),
    ),
  });
  assert.equal(result.providerBaseline.matched, false);
  assert.equal(result.providerBaseline.observedObjectCount, 102);
  assert.ok(blockerCodes(result).includes('PROVIDER_BASELINE_MISMATCH'));
  assert.doesNotMatch(JSON.stringify(result), /provider-(?:object|role)-must-not-escape/u);
});

test('fresh Seoul project with verified authorization returns a full read-only owner-aware plan', async () => {
  const result = await buildSupabasePlan({
    target: 'hosted',
    authorization: observationAuthorization(),
    inspector: inspector(snapshot(), snapshot()),
  });

  assert.equal(result.operation, 'plan');
  assert.equal(result.readOnly, true);
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
  assert.equal(result.installed.state, 'not-installed');
  assert.deepEqual(
    result.plannedResources.map(({ name }) => name),
    expectedSupabaseResources.map(({ name }) => name),
  );
  assert.ok(result.plannedResources.some(resource => resource.kind === 'storage-bucket' && resource.name === 'ccc-audio (private)'));
  assert.ok(result.plannedResources.some(resource => resource.kind === 'database-role' && resource.name.startsWith('ccc_api ')));
  assert.ok(result.migrations.every(migration => /^\d{4}_[A-Za-z0-9_-]+\.sql$/.test(migration.id) && /^[a-f0-9]{64}$/.test(migration.checksum)));
});

test('hosted project with missing or non-Seoul region evidence is blocked before apply', async () => {
  for (const [region, code] of [
    [null, 'REGION_MISMATCH'],
    ['ap-southeast-1', 'REGION_MISMATCH'],
    ['seoul', 'REGION_MISMATCH'],
  ]) {
    const observed = snapshot({
      project: { region, databaseVersion: '17.4', status: 'ACTIVE_HEALTHY' },
    });
    const result = await buildSupabasePlan({
      target: 'hosted',
      authorization: observationAuthorization(),
      inspector: inspector(observed, observed),
    });

    assert.equal(result.ready, false);
    assert.ok(result.blockers.some((blocker) => blocker.code === code));
    assert.ok(result.blockers.every((blocker) => blocker.recovery.length > 0));
  }
});

test('existing data and any legacy ledger are rejected without S11 installation ownership', async () => {
  const existing = snapshot({
    state: { ...stableState, institutionDataFingerprint: 'data-present', userTableCount: 2, userRowEstimate: 8 },
  });
  const existingPlan = await buildSupabasePlan({
    target: 'hosted',
    authorization: observationAuthorization(),
    inspector: inspector(existing, existing),
  });
  assert.equal(existingPlan.blockers[0].code, 'EXISTING_PROJECT_NOT_CLEAN');
  assert.match(existingPlan.blockers[0].recovery, /소유 승인/u);

  const ahead = snapshot({
    installed: { ledger: 'present', version: 99, checksum: 'newer-checksum' },
  });
  const aheadPlan = await buildSupabasePlan({
    target: 'hosted',
    authorization: observationAuthorization(),
    inspector: inspector(ahead, ahead),
  });
  assert.equal(aheadPlan.blockers[0].code, 'RESOURCE_OWNERSHIP_MISMATCH');
  assert.equal(aheadPlan.installed.state, 'unverified');

  const behind = snapshot({
    installed: { ledger: 'present', version: 0, checksum: 'older-checksum' },
  });
  const behindPlan = await buildSupabasePlan({
    target: 'hosted',
    authorization: observationAuthorization(),
    inspector: inspector(behind, behind),
  });
  assert.equal(behindPlan.blockers[0].code, 'RESOURCE_OWNERSHIP_MISMATCH');
});

test('a state change observed during planning fails instead of claiming read-only stability', async () => {
  const changed = snapshot({
    state: { ...stableState, policyFingerprint: 'policy-changed' },
  });
  const result = await buildSupabasePlan({
    target: 'hosted',
    authorization: observationAuthorization(),
    inspector: inspector(snapshot(), changed),
  });

  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(({ code }) => code === 'PLAN_STATE_CHANGED'));
  assert.equal(result.unchanged, false);
});

test('a migration ledger change during planning invalidates the earlier version decision', async () => {
  const after = snapshot({
    installed: { ledger: 'present', version: 99, checksum: 'advanced-during-plan' },
  });
  const result = await buildSupabasePlan({
    target: 'hosted',
    inspector: inspector(snapshot(), after),
    authorization: observationAuthorization(),
  });

  assert.equal(result.unchanged, false);
  assert.ok(result.blockers.some(({ code }) => code === 'PLAN_STATE_CHANGED'));
});

test('cleanliness and stability cover safety state added only by the second observation', async () => {
  for (const stateChange of [
    { authUserCount: 1 },
    { customSchemaCount: 1 },
    { userTypeCount: 1 },
    { privateSchemaExists: true, privateTableNames: ['foreign_private_table'] },
  ]) {
    const after = snapshot({ state: { ...stableState, ...stateChange } });
    const result = await buildSupabasePlan({
      target: 'hosted',
      authorization: observationAuthorization(),
      inspector: inspector(snapshot(), after),
    });
    assert.equal(result.ready, false);
    assert.ok(result.blockers.some(({ code }) => code === 'EXISTING_PROJECT_NOT_CLEAN'));
    assert.ok(result.blockers.some(({ code }) => code === 'PLAN_STATE_CHANGED'));
    assert.equal(result.unchanged, false);
  }
});

test('installed bucket ownership requires exact observed ID and metadata digest reconciliation', async () => {
  const bucket = observedBucket();
  const owned = await installedSnapshot({
    state: {
      bucketCount: 1,
      buckets: [bucket],
      bucket: { exists: true, public: false },
    },
    resources: [{ ...bucket, ownershipTag: 'ccc.installation_id=synthetic-installation' }],
  });
  const accepted = await buildSupabasePlan({
    target: 'hosted',
    authorization: owned.authorization,
    inspector: inspector(owned.observed, owned.observed),
  });
  assert.equal(accepted.ready, true);

  for (const [name, state, resources] of [
    ['unowned', { bucketCount: 1, buckets: [bucket] }, []],
    ['deleted', { bucketCount: 0, buckets: [] }, [{
      ...bucket, ownershipTag: 'ccc.installation_id=synthetic-installation',
    }]],
    ['digest-mismatch', { bucketCount: 1, buckets: [bucket] }, [{
      ...bucket,
      resourceDigest: 'f'.repeat(64),
      ownershipTag: 'ccc.installation_id=synthetic-installation',
    }]],
    ['unsupported-type', { bucketCount: 0, buckets: [] }, [{
      ...bucket,
      resourceType: 'foreign_provider_resource',
      ownershipTag: 'ccc.installation_id=synthetic-installation',
    }]],
  ]) {
    const fixture = await installedSnapshot({ state, resources });
    const result = await buildSupabasePlan({
      target: 'hosted',
      authorization: fixture.authorization,
      inspector: inspector(fixture.observed, fixture.observed),
    });
    assert.ok(result.blockers.some(({ code }) => code === 'RESOURCE_OWNERSHIP_MISMATCH'), name);
  }
});

test('installed journals do not authorize unknown custom schemas or standalone user types', async () => {
  for (const state of [{ customSchemaCount: 1 }, { userTypeCount: 1 }]) {
    const fixture = await installedSnapshot({ state });
    const result = await buildSupabasePlan({
      target: 'hosted',
      authorization: fixture.authorization,
      inspector: inspector(fixture.observed, fixture.observed),
    });
    assert.ok(result.blockers.some(({ code }) => code === 'RESOURCE_OWNERSHIP_MISMATCH'));
  }
});

test('rejected installed summaries expose only approved migration IDs, phases and hashes', async () => {
  const fixture = await installedSnapshot({
    migrations: [
      { id: 'provider-secret-migration-id', checksum: 'provider-secret-checksum' },
    ],
    journal: {
      phase: 'provider-secret-phase',
      runtimeManifestSha256: 'provider-secret-manifest',
      approvalSha256: 'provider-secret-approval',
    },
  });
  const approvedMigration = fixture.desired.migrations[0];
  fixture.observed.installState.migrations.unshift(approvedMigration);
  const result = await buildSupabasePlan({
    target: 'hosted',
    authorization: fixture.authorization,
    inspector: inspector(fixture.observed, fixture.observed),
  });
  assert.equal(result.ready, false);
  assert.deepEqual(result.installed, {
    state: 'unverified',
    migrationHead: approvedMigration.id,
    runtimeManifestSha256: null,
    approvalSha256: null,
  });
  assert.doesNotMatch(JSON.stringify(result), /provider-secret/u);
});

test('doctor summaries retain only allowlisted steps and hashes and omit receipt contents', async () => {
  const fixture = await installedSnapshot({
    journal: {
      phase: 'provider-secret-phase',
      runtimeManifestSha256: 'provider-secret-manifest',
      approvalSha256: 'provider-secret-approval',
    },
  });
  fixture.observed.installState.completedSteps = [
    { step: 'storage_bucket', idempotencyKey: 'a'.repeat(64) },
    { step: 'provider-secret-step', idempotencyKey: 'provider-secret-key' },
  ];
  fixture.observed.installState.currentReceipt = {
    migrationHead: 'provider-secret-receipt-id',
    providerResourceDigests: { raw: 'provider-secret-receipt-metadata' },
  };
  const result = await buildSupabaseDoctor({
    target: 'hosted',
    authorization: fixture.authorization,
    inspector: inspector(fixture.observed),
  });
  assert.deepEqual(result.installed, {
    state: 'unverified',
    migrationHead: null,
    runtimeManifestSha256: null,
    approvalSha256: null,
  });
  assert.deepEqual(result.completedSteps, [{
    step: 'storage_bucket',
    idempotencyKey: 'a'.repeat(64),
  }]);
  assert.doesNotMatch(JSON.stringify(result), /provider-secret/u);
});

test('credential failures retain stable error codes without provider response text', async () => {
  for (const code of ['CREDENTIAL_MISSING', 'CREDENTIAL_INVALID', 'CREDENTIAL_INSUFFICIENT']) {
    const secret = 'sbp_secret-that-must-never-escape';
    const failingInspector = {
      async inspect() {
        throw new PlanFailure(code, `provider said ${secret}`);
      },
    };

    await assert.rejects(
      buildSupabasePlan({ target: 'hosted', inspector: failingInspector, authorization: observationAuthorization() }),
      (error) => {
        assert.equal(error.code, code);
        assert.doesNotMatch(error.message, new RegExp(secret, 'u'));
        return true;
      },
    );
  }
});

test('local plans are valid without hosted region evidence but are never production-ready', async () => {
  const local = snapshot({
    project: { region: null, databaseVersion: '17.4', status: 'LOCAL' },
    state: {
      ...stableState,
      unknownObjectCount: 0,
      unownedObjectCount: 0,
      unexpectedGrantCount: 0,
    },
  });
  const result = await buildSupabasePlan({
    target: 'local',
    inspector: inspector(local, local),
  });

  assert.equal(result.ready, true);
  assert.equal(result.productionReady, false);
  assert.ok(result.notes.some((note) => note.includes('로컬')));
});

test('local plans retain zero-only provider inventory cleanliness', async () => {
  const local = snapshot({
    project: { region: null, databaseVersion: '17.4', status: 'LOCAL' },
    state: {
      ...stableState,
      unknownObjectCount: 1,
      unownedObjectCount: 1,
      unexpectedGrantCount: 0,
    },
  });
  const result = await buildSupabasePlan({
    target: 'local',
    inspector: inspector(local, local),
  });
  assert.equal(result.ready, false);
  assert.ok(blockerCodes(result).includes('EXISTING_PROJECT_NOT_CLEAN'));
});

test('missing or expired authorization stops before any hosted observation', async () => {
  let calls = 0;
  const source = { inspect: async () => { calls += 1; return snapshot(); } };
  await assert.rejects(buildSupabasePlan({ target: 'hosted', inspector: source }), error => error.code === 'OWNER_EVIDENCE_MISSING');
  await assert.rejects(buildSupabasePlan({
    target: 'hosted', inspector: source,
    authorization: { ...observationAuthorization(), expiresAt: new Date(Date.now() - 1).toISOString() },
  }), error => error.code === 'OWNER_EVIDENCE_MISSING');
  assert.equal(calls, 0);
});

test('doctor separates business activity from configuration drift', async () => {
  const fixture = await installedSnapshot({
    state: { userTableCount: 1, rlsEnabledTableCount: 1, policyCount: 1 },
  });
  fixture.observed.installState.journal.stateFingerprint =
    await installationStateFingerprint(fixture.observed);
  fixture.observed.state = { ...fixture.observed.state, userRowEstimate: 4, authUserCount: 2 };
  const activity = await buildSupabaseDoctor({
    target: 'hosted', authorization: fixture.authorization, inspector: inspector(fixture.observed),
  });
  assert.ok(activity.blockers.some(item => item.code === 'INSTALL_INCOMPLETE'));
  assert.ok(!activity.blockers.some(item => item.code === 'DRIFT_DETECTED'));

  fixture.observed.state.schemaFingerprint = 'changed-schema';
  const drift = await buildSupabaseDoctor({
    target: 'hosted', authorization: fixture.authorization, inspector: inspector(fixture.observed),
  });
  assert.ok(drift.blockers.some(item => item.code === 'DRIFT_DETECTED'));
});

test('opaque schema objects cannot be adopted with or without an installation journal', async () => {
  const fresh = snapshot({ state: { ...stableState, unknownObjectCount: 1 } });
  const initial = await buildSupabasePlan({
    target: 'hosted', authorization: observationAuthorization(), inspector: inspector(fresh),
  });
  assert.ok(initial.blockers.some(item => item.code === 'EXISTING_PROJECT_NOT_CLEAN'));
  const fixture = await installedSnapshot({ state: { unknownObjectCount: 1 } });
  const resumed = await buildSupabasePlan({
    target: 'hosted', authorization: fixture.authorization, inspector: inspector(fixture.observed),
  });
  assert.ok(resumed.blockers.some(item => item.code === 'RESOURCE_OWNERSHIP_MISMATCH'));
});

test('resumed and renewal plans reject stable Auth drift from the durable provider fingerprint', async () => {
  const fixture = await installedSnapshot();
  const drifted = structuredClone(fixture.observed);
  drifted.state.authFingerprint = 'stable-but-changed-auth';

  const resumed = await buildSupabasePlan({
    target: 'hosted',
    authorization: fixture.authorization,
    inspector: inspector(drifted, drifted),
  });
  assert.equal(resumed.ready, false);
  assert.ok(blockerCodes(resumed).includes('DRIFT_BLOCKED'));

  const renewedAuthorization = {
    ...fixture.authorization,
    runtimeManifestSha256: 'a'.repeat(64),
    approvalSha256: 'b'.repeat(64),
    runtimeSequence: fixture.authorization.runtimeSequence + 1,
  };
  const renewal = await buildSupabasePlan({
    target: 'hosted',
    authorization: renewedAuthorization,
    renewAuthorization: true,
    inspector: inspector(drifted, drifted),
  });
  assert.equal(renewal.ready, false);
  assert.ok(blockerCodes(renewal).includes('DRIFT_BLOCKED'));
});

test('resumed plans reject missing or malformed durable provider fingerprints', async () => {
  for (const stateFingerprint of [undefined, null, 'not-a-fingerprint']) {
    const fixture = await installedSnapshot({ journal: { stateFingerprint } });
    const result = await buildSupabasePlan({
      target: 'hosted',
      authorization: fixture.authorization,
      inspector: inspector(fixture.observed, fixture.observed),
    });
    assert.equal(result.ready, false);
    assert.ok(blockerCodes(result).includes('INSTALL_JOURNAL_INVALID'));
  }
});

test('resumed plans compare the durable provider fingerprint with both observations', async () => {
  const fixture = await installedSnapshot();
  const drifted = structuredClone(fixture.observed);
  drifted.state.authFingerprint = 'changed-in-one-observation';
  for (const observations of [
    [drifted, fixture.observed],
    [fixture.observed, drifted],
  ]) {
    const result = await buildSupabasePlan({
      target: 'hosted',
      authorization: fixture.authorization,
      inspector: inspector(...observations),
    });
    assert.ok(blockerCodes(result).includes('DRIFT_BLOCKED'));
  }
});

test('fresh and resumed plans cannot authorize cron before signed cron ownership exists', async () => {
  const fresh = snapshot({ cronJobCount: 1 });
  const freshResult = await buildSupabasePlan({
    target: 'hosted',
    authorization: observationAuthorization(),
    inspector: inspector(fresh, fresh),
  });
  assert.ok(blockerCodes(freshResult).includes('EXISTING_PROJECT_NOT_CLEAN'));

  const fixture = await installedSnapshot();
  fixture.observed.cronJobCount = 1;
  fixture.observed.installState.journal.stateFingerprint =
    await installationStateFingerprint(fixture.observed);
  const result = await buildSupabasePlan({
    target: 'hosted',
    authorization: fixture.authorization,
    inspector: inspector(fixture.observed, fixture.observed),
  });
  assert.equal(result.ready, false);
  assert.ok(blockerCodes(result).includes('RESOURCE_OWNERSHIP_MISMATCH'));
  assert.ok(!blockerCodes(result).includes('DRIFT_BLOCKED'));
});

test('fresh and resumed plans require proved clean object and grant inventories', async () => {
  for (const inventory of [
    { unownedObjectCount: 1, unexpectedGrantCount: 0 },
    { unownedObjectCount: 0, unexpectedGrantCount: 1 },
    { unownedObjectCount: undefined, unexpectedGrantCount: 0 },
    { unownedObjectCount: 0.5, unexpectedGrantCount: 0 },
    { unownedObjectCount: 0, unexpectedGrantCount: -1 },
  ]) {
    const fresh = snapshot({ state: { ...stableState, ...inventory } });
    const freshResult = await buildSupabasePlan({
      target: 'hosted',
      authorization: observationAuthorization(),
      inspector: inspector(fresh, fresh),
    });
    assert.ok(blockerCodes(freshResult).includes('EXISTING_PROJECT_NOT_CLEAN'));

    const fixture = await installedSnapshot({ state: inventory });
    const resumedResult = await buildSupabasePlan({
      target: 'hosted',
      authorization: fixture.authorization,
      inspector: inspector(fixture.observed, fixture.observed),
    });
    assert.ok(blockerCodes(resumedResult).includes('RESOURCE_OWNERSHIP_MISMATCH'));
  }
});

test('doctor rejects empty, failed, mismatched and history-unmatched receipts without exposing them', async () => {
  for (const mutate of [
    fixture => { fixture.observed.installState.currentReceipt = {}; },
    fixture => {
      fixture.observed.installState.currentReceipt.status = 'rollback_failed';
      fixture.observed.installState.releaseHistory[0].status = 'rollback_failed';
    },
    fixture => {
      fixture.observed.installState.currentReceipt.institutionIdHash = 'f'.repeat(64);
      fixture.observed.installState.releaseHistory[0].institutionIdHash = 'f'.repeat(64);
    },
    fixture => {
      fixture.observed.installState.currentReceipt.installationId = 'other-installation';
      fixture.observed.installState.releaseHistory[0].installationId = 'other-installation';
    },
    fixture => {
      fixture.observed.installState.currentReceipt.observedOwnerOrgIdHash = 'f'.repeat(64);
      fixture.observed.installState.releaseHistory[0].observedOwnerOrgIdHash = 'f'.repeat(64);
    },
    fixture => { fixture.observed.installState.migrations.pop(); },
    fixture => { fixture.observed.installState.currentReceipt.migrationHead = 'provider-secret-head'; },
    fixture => { fixture.observed.installState.releaseHistory = []; },
    fixture => { fixture.observed.installState.releaseHistory[0].manifestDigest = 'e'.repeat(64); },
  ]) {
    const fixture = await installedReceiptSnapshot();
    mutate(fixture);
    const result = await buildSupabaseDoctor({
      target: 'hosted',
      authorization: fixture.authorization,
      inspector: inspector(fixture.observed, fixture.observed, fixture.observed),
    });
    assert.equal(result.ready, false);
    assert.ok(blockerCodes(result).includes('INSTALL_INCOMPLETE'));
    assert.doesNotMatch(JSON.stringify(result), /provider-secret/u);
  }
});

test('doctor rejects catalog and provider receipt fingerprint mismatches as drift', async () => {
  const bucket = observedBucket();
  for (const mutate of [
    fixture => { fixture.observed.installState.currentReceipt.schemaFingerprint = 'f'.repeat(64); },
    fixture => {
      const [resourceIdHash] = Object.keys(
        fixture.observed.installState.currentReceipt.providerResourceDigests,
      );
      fixture.observed.installState.currentReceipt.providerResourceDigests[resourceIdHash] = 'f'.repeat(64);
    },
    fixture => { fixture.observed.installState.currentReceipt.edgeRegionEvidence.mismatch = true; },
  ]) {
    const fixture = await installedReceiptSnapshot({
      state: { bucketCount: 1, buckets: [bucket], bucket: { exists: true, public: false } },
      resources: [{ ...bucket, ownershipTag: 'ccc.installation_id=synthetic-installation' }],
    });
    mutate(fixture);
    fixture.observed.installState.releaseHistory =
      [structuredClone(fixture.observed.installState.currentReceipt)];
    const result = await buildSupabaseDoctor({
      target: 'hosted',
      authorization: fixture.authorization,
      inspector: inspector(fixture.observed, fixture.observed, fixture.observed),
    });
    assert.equal(result.ready, false);
    assert.ok(blockerCodes(result).includes('DRIFT_DETECTED'));
  }
});

test('doctor checks the latest observation rather than blessing a stale two-snapshot plan', async () => {
  const fixture = await installedReceiptSnapshot();
  const latest = structuredClone(fixture.observed);
  latest.state.authFingerprint = 'changed-after-plan';
  const result = await buildSupabaseDoctor({
    target: 'hosted',
    authorization: fixture.authorization,
    inspector: inspector(fixture.observed, fixture.observed, latest),
  });
  assert.equal(result.ready, false);
  assert.ok(blockerCodes(result).includes('PLAN_STATE_CHANGED'));
  assert.ok(blockerCodes(result).includes('DRIFT_DETECTED'));
});

test('doctor checks read-only connection evidence on its latest observation', async () => {
  const fixture = await installedReceiptSnapshot();
  const latest = structuredClone(fixture.observed);
  latest.connection.readOnly = false;
  const result = await buildSupabaseDoctor({
    target: 'hosted',
    authorization: fixture.authorization,
    inspector: inspector(fixture.observed, fixture.observed, latest),
  });
  assert.equal(result.ready, false);
  assert.ok(blockerCodes(result).includes('CONNECTION_NOT_READ_ONLY'));
});

test('internally consistent receipt and history remain incomplete without S12 release trust proof', async () => {
  const fixture = await installedReceiptSnapshot();
  const result = await buildSupabaseDoctor({
    target: 'hosted',
    authorization: fixture.authorization,
    inspector: inspector(fixture.observed, fixture.observed, fixture.observed),
  });
  assert.equal(result.ready, false);
  assert.deepEqual(blockerCodes(result), ['RELEASE_PREREQUISITES_MISSING']);
});
