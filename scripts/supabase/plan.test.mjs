import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { observationAuthorization } from './fixtures/authorization.mjs';
import { fingerprint } from './hosted-inspector.mjs';

import {
  PlanFailure,
  buildSupabasePlan,
  buildSupabaseDoctor,
  installationStateFingerprint,
  expectedSupabaseResources,
} from './plan.mjs';

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
  unknownObjectCount: 0,
  customSchemaCount: 0,
  auxiliaryRelationCount: 0,
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
  return {
    authorization,
    desired,
    observed: snapshot({
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
      },
    }),
  };
}

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
  });
  const result = await buildSupabasePlan({
    target: 'local',
    inspector: inspector(local, local),
  });

  assert.equal(result.ready, true);
  assert.equal(result.productionReady, false);
  assert.ok(result.notes.some((note) => note.includes('로컬')));
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
