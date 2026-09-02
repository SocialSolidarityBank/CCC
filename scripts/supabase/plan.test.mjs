import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PlanFailure,
  buildSupabasePlan,
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
  bucket: { exists: false, public: null },
});

function snapshot(overrides = {}) {
  return {
    project: {
      region: 'ap-northeast-2',
      databaseVersion: '17.4',
      status: 'ACTIVE_HEALTHY',
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

test('fresh Seoul project returns a read-only plan with named resources and no blocker', async () => {
  const result = await buildSupabasePlan({
    target: 'hosted',
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
});

test('hosted project with missing or non-Seoul region evidence is blocked before apply', async () => {
  for (const [region, code] of [
    [null, 'REGION_UNVERIFIED'],
    ['ap-southeast-1', 'REGION_MISMATCH'],
  ]) {
    const observed = snapshot({
      project: { region, databaseVersion: '17.4', status: 'ACTIVE_HEALTHY' },
    });
    const result = await buildSupabasePlan({
      target: 'hosted',
      inspector: inspector(observed, observed),
    });

    assert.equal(result.ready, false);
    assert.ok(result.blockers.some((blocker) => blocker.code === code));
    assert.ok(result.blockers.every((blocker) => blocker.recovery.length > 0));
  }
});

test('existing project data and unsupported installed versions produce different recovery paths', async () => {
  const existing = snapshot({
    state: { ...stableState, institutionDataFingerprint: 'data-present', userTableCount: 2, userRowEstimate: 8 },
  });
  const existingPlan = await buildSupabasePlan({
    target: 'hosted',
    inspector: inspector(existing, existing),
  });
  assert.equal(existingPlan.blockers[0].code, 'EXISTING_PROJECT');
  assert.match(existingPlan.blockers[0].recovery, /빈 프로젝트/u);

  const ahead = snapshot({
    installed: { ledger: 'present', version: 99, checksum: 'newer-checksum' },
  });
  const aheadPlan = await buildSupabasePlan({
    target: 'hosted',
    inspector: inspector(ahead, ahead),
  });
  assert.equal(aheadPlan.blockers[0].code, 'VERSION_AHEAD');
  assert.doesNotMatch(aheadPlan.blockers[0].recovery, /빈 프로젝트/u);

  const behind = snapshot({
    installed: { ledger: 'present', version: 0, checksum: 'older-checksum' },
  });
  const behindPlan = await buildSupabasePlan({
    target: 'hosted',
    inspector: inspector(behind, behind),
  });
  assert.equal(behindPlan.blockers[0].code, 'VERSION_GAP');
});

test('a state change observed during planning fails instead of claiming read-only stability', async () => {
  const changed = snapshot({
    state: { ...stableState, policyFingerprint: 'policy-changed' },
  });
  const result = await buildSupabasePlan({
    target: 'hosted',
    inspector: inspector(snapshot(), changed),
  });

  assert.equal(result.ready, false);
  assert.ok(result.blockers.some(({ code }) => code === 'STATE_CHANGED_DURING_PLAN'));
  assert.equal(result.unchanged, false);
});

test('a migration ledger change during planning invalidates the earlier version decision', async () => {
  const after = snapshot({
    installed: { ledger: 'present', version: 99, checksum: 'advanced-during-plan' },
  });
  const result = await buildSupabasePlan({
    target: 'hosted',
    inspector: inspector(snapshot(), after),
  });

  assert.equal(result.unchanged, false);
  assert.ok(result.blockers.some(({ code }) => code === 'STATE_CHANGED_DURING_PLAN'));
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
      buildSupabasePlan({ target: 'hosted', inspector: failingInspector }),
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
