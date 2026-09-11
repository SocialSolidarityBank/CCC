import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import {
  BETA_TRUST_DOMAIN,
  PROVIDER_BASELINE_DOMAIN,
  compareProviderInventory,
  requireProviderBaseline,
} from './provider-baseline.mjs';
import * as verifier from '../../apps/community-cloud/dist/install-manifest-verifier.js';

const NOW = new Date('2026-09-11T12:00:00.000Z');
const PROJECT_REF_SHA256 = '11'.repeat(32);
const OWNER_ORG_ID_SHA256 = '22'.repeat(32);
const encoder = new TextEncoder();

const OVERSIZED_NOT_BEFORE = `Fri,${' '.repeat(1_025)}11 Sep 2026 00:00:00 GMT`;
const OVERSIZED_BASELINE_EXPIRY = `Sat,${' '.repeat(1_025)}19 Sep 2026 00:00:00 GMT`;
const OVERSIZED_TRUST_EXPIRY = `Sun,${' '.repeat(1_025)}20 Sep 2026 00:00:00 GMT`;

function base64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

async function signer(keyId) {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return {
    keyId,
    privateKey: pair.privateKey,
    publicKey: base64(await crypto.subtle.exportKey('raw', pair.publicKey)),
  };
}

async function signDomain(value, key, domain) {
  const message = Buffer.concat([
    Buffer.from(domain, 'ascii'),
    Buffer.from(verifier.canonicalizeJcs(value), 'utf8'),
  ]);
  return {
    ...value,
    ed25519Signature: base64(await crypto.subtle.sign('Ed25519', key.privateKey, message)),
  };
}

async function inventorySha256(records) {
  return verifier.sha256Jcs(records);
}

function validObjects() {
  return [
    {
      kind: 'relation',
      schema: 'auth',
      identity: 'auth.users TABLE',
      owner: 'supabase_auth_admin',
      definitionSha256: '33'.repeat(32),
      provenance: 'supabase_managed',
    },
    {
      kind: 'schema',
      schema: 'auth',
      identity: 'auth',
      owner: 'supabase_admin',
      definitionSha256: '44'.repeat(32),
      provenance: 'supabase_managed',
    },
  ];
}

function validGrants() {
  return [{
    kind: 'relation',
    schema: 'auth',
    objectIdentity: 'auth.users TABLE',
    grantor: 'supabase_auth_admin',
    grantee: 'ROLE:authenticated',
    privilege: 'SELECT',
    grantable: false,
    inheritOption: null,
    setOption: null,
    provenance: 'supabase_managed',
  }];
}

async function signedBaselineFixture({
  trustOverrides = {},
  baselineOverrides = {},
  authorizationOverrides = {},
  manifestExpiresAt = '2026-09-21T00:00:00.000Z',
  rootKeys,
  revokedRootKeyIds = [],
  baselineSigner,
} = {}) {
  const root = await signer('root-20260911');
  const release = await signer('release-20260911');
  const objects = validObjects();
  const grants = validGrants();
  const unsignedTrust = {
    schemaVersion: 1,
    profile: 'development',
    channel: 'beta',
    provider: 'supabase',
    projectRefSha256: PROJECT_REF_SHA256,
    ownerOrgIdSha256: OWNER_ORG_ID_SHA256,
    region: 'ap-northeast-2',
    rootKeyId: root.keyId,
    releaseKeyId: release.keyId,
    releasePublicKey: release.publicKey,
    notBefore: '2026-09-11T00:00:00.000Z',
    expiresAt: '2026-09-20T00:00:00.000Z',
    ...trustOverrides,
  };
  const releaseTrust = await signDomain(unsignedTrust, root, BETA_TRUST_DOMAIN);
  const unsignedBaseline = {
    schemaVersion: 1,
    profile: 'development',
    channel: 'beta',
    provider: 'supabase',
    baselineVersion: 'supabase-hosted-pg17-20260911-v1',
    projectRefSha256: PROJECT_REF_SHA256,
    ownerOrgIdSha256: OWNER_ORG_ID_SHA256,
    region: 'ap-northeast-2',
    databaseVersion: '17.4',
    sourceRevision: '55'.repeat(20),
    sourceEvidenceSha256: '66'.repeat(32),
    emptyBusinessState: {
      userTableCount: 0,
      userRowEstimate: 0,
      authUserCount: 0,
      bucketCount: 0,
      storageObjectCount: 0,
    },
    objects,
    grants,
    objectInventorySha256: await inventorySha256(objects),
    grantInventorySha256: await inventorySha256(grants),
    issuedAt: '2026-09-11T01:00:00.000Z',
    expiresAt: '2026-09-19T00:00:00.000Z',
    signingKeyId: release.keyId,
    ...baselineOverrides,
  };
  const providerBaseline = await signDomain(
    unsignedBaseline,
    baselineSigner ?? release,
    PROVIDER_BASELINE_DOMAIN,
  );
  const authorization = {
    projectRefHash: PROJECT_REF_SHA256,
    expectedOwnerOrgIdHash: OWNER_ORG_ID_SHA256,
    expiresAt: '2026-09-22T00:00:00.000Z',
    ...authorizationOverrides,
  };
  return {
    root,
    release,
    releaseTrust,
    providerBaseline,
    inputs: {
      releaseTrust: JSON.stringify(releaseTrust),
      providerBaseline: JSON.stringify(providerBaseline),
      rootKeys: rootKeys ?? { [root.keyId]: root.publicKey },
      revokedRootKeyIds,
      authorization,
      manifestExpiresAt,
      now: NOW,
      verifier,
    },
  };
}

function rejects(code, promise) {
  return assert.rejects(promise, error => (
    error instanceof Error && error.code === code && error.message === code
  ));
}

async function resignTrust(fixture, overrides) {
  const { ed25519Signature: _signature, ...unsigned } = fixture.releaseTrust;
  const releaseTrust = await signDomain({ ...unsigned, ...overrides }, fixture.root, BETA_TRUST_DOMAIN);
  return { ...fixture.inputs, releaseTrust: JSON.stringify(releaseTrust) };
}

async function resignBaseline(fixture, overrides, key = fixture.release) {
  const { ed25519Signature: _signature, ...unsigned } = fixture.providerBaseline;
  const next = { ...unsigned, ...overrides };
  if (Object.hasOwn(overrides, 'objects') && !Object.hasOwn(overrides, 'objectInventorySha256')) {
    next.objectInventorySha256 = await inventorySha256(next.objects);
  }
  if (Object.hasOwn(overrides, 'grants') && !Object.hasOwn(overrides, 'grantInventorySha256')) {
    next.grantInventorySha256 = await inventorySha256(next.grants);
  }
  const providerBaseline = await signDomain(next, key, PROVIDER_BASELINE_DOMAIN);
  return { ...fixture.inputs, providerBaseline: JSON.stringify(providerBaseline) };
}

function corruptSignature(signature) {
  return `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
}

test('valid beta root delegation verifies one exact provider baseline', async () => {
  const fixture = await signedBaselineFixture();
  const verified = await requireProviderBaseline(fixture.inputs);
  assert.deepEqual(Object.keys(verified), [
    'baselineVersion', 'projectRefSha256', 'ownerOrgIdSha256', 'region',
    'databaseVersion', 'objects', 'grants', 'objectInventorySha256',
    'grantInventorySha256', 'baselineSha256', 'releaseTrustSha256', 'expiresAt',
  ]);
  assert.equal(verified.baselineVersion, 'supabase-hosted-pg17-20260911-v1');
  assert.equal(verified.objects.length, 2);
  assert.equal(verified.grants.length, 1);
  assert.match(verified.baselineSha256, /^[a-f0-9]{64}$/u);
  assert.match(verified.releaseTrustSha256, /^[a-f0-9]{64}$/u);
  assert.equal(verified.expiresAt, '2026-09-19T00:00:00.000Z');
  assert.ok(Object.isFrozen(verified));
  assert.ok(Object.isFrozen(verified.objects));
  assert.ok(Object.isFrozen(verified.objects[0]));
});

test('JCS signature verification keeps false-on-invalid-input behavior', async () => {
  const key = await signer('invalid-jcs-test');
  const signature = base64(new Uint8Array(64));
  assert.equal(await verifier.verifyJcsEd25519Signature({ invalid: Number.NaN }, signature, key.publicKey), false);
  assert.equal(await verifier.verifyJcsEd25519Signature(undefined, signature, key.publicKey), false);
});

test('closed schemas and beta-only trust reject malformed or broadened authority', async t => {
  const fixture = await signedBaselineFixture();
  const alternateRelease = await signer('alternate-release');
  const duplicateTrust = JSON.stringify(fixture.releaseTrust).replace(
    '"schemaVersion":1',
    '"schemaVersion":1,"schemaVersion":1',
  );
  const badTrustSignature = corruptSignature(fixture.releaseTrust.ed25519Signature);
  const cases = [
    ['trust unknown field', 'BETA_TRUST_INVALID', await resignTrust(fixture, { unknown: true })],
    ['duplicate JSON key', 'BETA_TRUST_INVALID', { ...fixture.inputs, releaseTrust: duplicateTrust }],
    ['stable channel', 'BETA_TRUST_INVALID', await resignTrust(fixture, { channel: 'stable' })],
    ['formal profile', 'BETA_TRUST_INVALID', await resignTrust(fixture, { profile: 'formal' })],
    ['wrong project', 'BETA_TRUST_INVALID', await resignTrust(fixture, { projectRefSha256: '77'.repeat(32) })],
    ['wrong owner', 'BETA_TRUST_INVALID', await resignTrust(fixture, { ownerOrgIdSha256: '77'.repeat(32) })],
    ['wrong region', 'BETA_TRUST_INVALID', await resignTrust(fixture, { region: 'us-east-1' })],
    ['unknown root', 'BETA_TRUST_INVALID', { ...fixture.inputs, rootKeys: { other: fixture.root.publicKey } }],
    ['revoked root', 'BETA_TRUST_INVALID', { ...fixture.inputs, revokedRootKeyIds: [fixture.root.keyId] }],
    ['changed release public key', 'PROVIDER_BASELINE_INVALID', await resignTrust(fixture, {
      releasePublicKey: alternateRelease.publicKey,
    })],
    ['future notBefore', 'BETA_TRUST_INVALID', await resignTrust(fixture, { notBefore: '2026-09-11T12:00:00.001Z' })],
    ['expired trust', 'BETA_TRUST_INVALID', await resignTrust(fixture, { expiresAt: NOW.toISOString() })],
    ['oversized trust notBefore', 'BETA_TRUST_INVALID', await resignTrust(fixture, {
      notBefore: OVERSIZED_NOT_BEFORE,
    })],
    ['oversized trust expiresAt', 'BETA_TRUST_INVALID', await resignTrust(fixture, {
      expiresAt: OVERSIZED_TRUST_EXPIRY,
    })],
    ['expired baseline', 'PROVIDER_BASELINE_INVALID', await resignBaseline(fixture, { expiresAt: NOW.toISOString() })],
    ['trust lifetime over 30 days', 'BETA_TRUST_INVALID', await resignTrust(fixture, {
      expiresAt: '2026-10-12T00:00:00.000Z',
    })],
    ['baseline lifetime over 30 days', 'PROVIDER_BASELINE_INVALID', await resignBaseline(fixture, {
      issuedAt: '2026-08-19T00:00:00.000Z',
    })],
    ['baseline expiry beyond trust', 'PROVIDER_BASELINE_INVALID', await resignBaseline(fixture, {
      expiresAt: '2026-09-20T00:00:00.001Z',
    })],
    ['baseline expiry beyond S2 manifest', 'PROVIDER_BASELINE_INVALID', {
      ...await resignTrust(fixture, { expiresAt: '2026-09-18T00:00:00.000Z' }),
      manifestExpiresAt: '2026-09-18T00:00:00.000Z',
    }],
    ['baseline expiry beyond approval', 'PROVIDER_BASELINE_INVALID', {
      ...await resignTrust(fixture, { expiresAt: '2026-09-18T00:00:00.000Z' }),
      authorization: { ...fixture.inputs.authorization, expiresAt: '2026-09-18T00:00:00.000Z' },
    }],
    ['noncanonical Base64 root key', 'BETA_TRUST_INVALID', {
      ...fixture.inputs,
      rootKeys: { [fixture.root.keyId]: `${fixture.root.publicKey.slice(0, -1)}A` },
    }],
    ['bad root signature', 'BETA_TRUST_INVALID', {
      ...fixture.inputs,
      releaseTrust: JSON.stringify({ ...fixture.releaseTrust, ed25519Signature: badTrustSignature }),
    }],
    ['bad baseline signature', 'PROVIDER_BASELINE_INVALID', {
      ...fixture.inputs,
      providerBaseline: JSON.stringify({
        ...fixture.providerBaseline,
        ed25519Signature: corruptSignature(fixture.providerBaseline.ed25519Signature),
      }),
    }],
  ];
  for (const [name, code, inputs] of cases) {
    await t.test(name, () => rejects(code, requireProviderBaseline(inputs)));
  }
});

test('baseline exact schemas, hashes, ordering, bounds, and bindings fail closed', async t => {
  const fixture = await signedBaselineFixture();
  const objectWithUnknownField = { ...fixture.providerBaseline.objects[0], unknown: true };
  const longObject = { ...fixture.providerBaseline.objects[0], identity: '가'.repeat(342) };
  const cases = [
    ['baseline unknown field', { unknown: true }],
    ['empty business state unknown field', {
      emptyBusinessState: { ...fixture.providerBaseline.emptyBusinessState, unknown: 0 },
    }],
    ['object unknown field', { objects: [objectWithUnknownField, fixture.providerBaseline.objects[1]] }],
    ['unsorted objects', { objects: [...fixture.providerBaseline.objects].reverse() }],
    ['duplicate objects', { objects: [fixture.providerBaseline.objects[0], fixture.providerBaseline.objects[0]] }],
    ['unsorted grants', { grants: [
      { ...fixture.providerBaseline.grants[0], privilege: 'UPDATE' },
      fixture.providerBaseline.grants[0],
    ] }],
    ['duplicate grants', { grants: [fixture.providerBaseline.grants[0], fixture.providerBaseline.grants[0]] }],
    ['string over UTF-8 byte limit', { objects: [longObject, fixture.providerBaseline.objects[1]] }],
    ['oversized database version', { databaseVersion: '1'.repeat(1_025) }],
    ['oversized baseline issuedAt', { issuedAt: OVERSIZED_NOT_BEFORE }],
    ['oversized baseline expiresAt', { expiresAt: OVERSIZED_BASELINE_EXPIRY }],
    ['bad object inventory hash', { objectInventorySha256: '00'.repeat(32) }],
    ['bad grant inventory hash', { grantInventorySha256: '00'.repeat(32) }],
    ['wrong baseline project', { projectRefSha256: '77'.repeat(32) }],
    ['wrong baseline owner', { ownerOrgIdSha256: '77'.repeat(32) }],
    ['wrong baseline region', { region: 'us-east-1' }],
    ['release key id mismatch', { signingKeyId: 'other-release' }],
    ['nonempty provider baseline business state', {
      emptyBusinessState: { ...fixture.providerBaseline.emptyBusinessState, authUserCount: 1 },
    }],
  ];
  for (const [name, overrides] of cases) {
    await t.test(name, async () => {
      const inputs = await resignBaseline(fixture, overrides);
      await rejects('PROVIDER_BASELINE_INVALID', requireProviderBaseline(inputs));
    });
  }
});

test('signed baseline admits routine and type grants and binds role membership options', async () => {
  const fixture = await signedBaselineFixture();
  const grants = [
    {
      kind: 'routine',
      schema: 'auth',
      objectIdentity: 'auth.uid() FUNCTION RETURNS uuid',
      grantor: 'supabase_auth_admin',
      grantee: 'ROLE:a_routine',
      privilege: 'EXECUTE',
      grantable: false,
      inheritOption: null,
      setOption: null,
      provenance: 'initial_privilege',
    },
    {
      kind: 'type',
      schema: 'storage',
      objectIdentity: 'storage.bucket_type',
      grantor: 'supabase_storage_admin',
      grantee: 'ROLE:b_type',
      privilege: 'USAGE',
      grantable: false,
      inheritOption: null,
      setOption: null,
      provenance: 'supabase_managed',
    },
    {
      kind: 'role',
      schema: '',
      objectIdentity: 'authenticator',
      grantor: 'postgres',
      grantee: 'ROLE:c_role',
      privilege: 'MEMBER',
      grantable: false,
      inheritOption: true,
      setOption: false,
      provenance: 'supabase_managed',
    },
  ];
  const verified = await requireProviderBaseline(await resignBaseline(fixture, { grants }));
  assert.deepEqual(verified.grants.map(({ kind }) => kind), ['routine', 'type', 'role']);

  for (const invalidGrant of [
    { ...grants[0], inheritOption: true },
    { ...grants[1], setOption: false },
    { ...grants[2], inheritOption: null },
  ]) {
    await rejects('PROVIDER_BASELINE_INVALID', requireProviderBaseline(
      await resignBaseline(fixture, { grants: [invalidGrant] }),
    ));
  }
});

test('inventory comparison requires exact arrays and aggregate hashes without leaking names', async t => {
  const verified = await requireProviderBaseline((await signedBaselineFixture()).inputs);
  const exact = {
    objects: structuredClone(verified.objects),
    grants: structuredClone(verified.grants),
    objectInventorySha256: verified.objectInventorySha256,
    grantInventorySha256: verified.grantInventorySha256,
  };
  assert.deepEqual(compareProviderInventory(verified, exact), {
    matched: true,
    code: null,
    expectedObjectCount: 2,
    observedObjectCount: 2,
    expectedGrantCount: 1,
    observedGrantCount: 1,
  });

  const reorderedKeys = structuredClone(exact);
  reorderedKeys.objects[0] = Object.fromEntries(Object.entries(reorderedKeys.objects[0]).reverse());
  reorderedKeys.grants[0] = Object.fromEntries(Object.entries(reorderedKeys.grants[0]).reverse());
  assert.equal(compareProviderInventory(verified, reorderedKeys).matched, true);

  const mismatches = [
    ['extra object', value => value.objects.push({ ...value.objects[0], identity: 'auth.users_extra TABLE' })],
    ['missing object', value => value.objects.pop()],
    ['definition hash drift', value => { value.objects[0].definitionSha256 = '99'.repeat(32); }],
    ['owner drift', value => { value.objects[0].owner = 'other_owner'; }],
    ['grantor drift', value => { value.grants[0].grantor = 'other_grantor'; }],
    ['grantee drift', value => { value.grants[0].grantee = 'other_grantee'; }],
    ['grantable drift', value => { value.grants[0].grantable = true; }],
    ['changed ordering', value => value.objects.reverse()],
    ['object aggregate hash drift', value => { value.objectInventorySha256 = '00'.repeat(32); }],
    ['grant aggregate hash drift', value => { value.grantInventorySha256 = '00'.repeat(32); }],
  ];
  for (const [name, mutate] of mismatches) {
    await t.test(name, () => {
      const observed = structuredClone(exact);
      mutate(observed);
      const result = compareProviderInventory(verified, observed);
      assert.deepEqual(result, {
        matched: false,
        code: 'PROVIDER_BASELINE_MISMATCH',
        expectedObjectCount: 2,
        observedObjectCount: observed.objects.length,
        expectedGrantCount: 1,
        observedGrantCount: observed.grants.length,
      });
      assert.doesNotMatch(JSON.stringify(result), /auth|users|SELECT|owner/u);
    });
  }
});
