import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertAuthorizationMatches,
  hashCanonical,
  requireSignedOwnerPreflight,
} from './manifest-preflight.mjs';
import {
  canonicalizeJcs,
  verifySignedInstallManifest,
} from '../../apps/community-cloud/dist/install-manifest-verifier.js';

const NOW = new Date('2026-09-10T12:00:00.000Z');
const INSTITUTION_ID = 'institution-synthetic';
const PROJECT_REF = 'abcdefghijklmnopqrst';
const OWNER_ORG_ID = 'owner-org-synthetic';
const INSTALLATION_ID = '6f3a8d0c-2b1e-4f7a-9c5d-0e1f2a3b4c5d';
const RESOURCES_SHA256 = '11'.repeat(32);
const MIGRATIONS_SHA256 = '22'.repeat(32);
const encoder = new TextEncoder();

function base64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

function sha256Jcs(value) {
  return crypto.subtle.digest('SHA-256', encoder.encode(canonicalizeJcs(value)))
    .then(bytes => Buffer.from(bytes).toString('hex'));
}

async function signer(keyId) {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  return {
    keyId,
    privateKey: pair.privateKey,
    publicKey: base64(await crypto.subtle.exportKey('raw', pair.publicKey)),
  };
}

async function sign(value, key) {
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    key.privateKey,
    encoder.encode(canonicalizeJcs(value)),
  );
  return { ...value, ed25519Signature: base64(signature) };
}

function unsignedManifest(keyId, overrides = {}) {
  return {
    schemaVersion: 1,
    mode: 'community-cloud',
    apiBase: 'https://api.example.invalid/api',
    clientOrigin: 'https://ccc.example.invalid',
    allowedOrigins: ['https://ccc.example.invalid'],
    host: 'ccc.example.invalid',
    scheme: 'https',
    endpointDiscovery: 'static',
    installationId: INSTALLATION_ID,
    sequence: 1,
    publishedAt: '2026-09-10T00:00:00.000Z',
    expiresAt: '2026-09-12T00:00:00.000Z',
    approvedSttEngineIds: [],
    supabaseProjectRef: PROJECT_REF,
    supabaseAuthOrigin: `https://${PROJECT_REF}.supabase.co`,
    supabasePublishableKey: 'sb_publishable_synthetic_not_a_real_key',
    signingKeyId: keyId,
    ...overrides,
  };
}

async function signedApproval(manifest, key, overrides = {}) {
  return sign({
    schemaVersion: 1,
    institutionId: INSTITUTION_ID,
    projectRef: PROJECT_REF,
    expectedOwnerOrgId: OWNER_ORG_ID,
    installationId: INSTALLATION_ID,
    runtimeManifestSha256: await sha256Jcs(manifest),
    contractVersion: 'S11-install-approval-v1',
    expiresAt: '2026-09-11T00:00:00.000Z',
    signingKeyId: key.keyId,
    ...overrides,
  }, key);
}

async function fixture() {
  const publicSigner = await signer('public-key');
  const approvalSigner = await signer('approval-key');
  const manifest = await sign(unsignedManifest(publicSigner.keyId), publicSigner);
  const approval = await signedApproval(manifest, approvalSigner);
  const trust = {
    institutionId: INSTITUTION_ID,
    publicKeys: {
      [publicSigner.keyId]: publicSigner.publicKey,
      [approvalSigner.keyId]: approvalSigner.publicKey,
    },
    revokedKeyIds: [],
  };
  return { publicSigner, approvalSigner, manifest, approval, trust };
}

async function authorize(values = {}) {
  const current = values.current ?? await fixture();
  return requireSignedOwnerPreflight({
    installManifest: JSON.stringify(values.manifest ?? current.manifest),
    installApproval: JSON.stringify(values.approval ?? current.approval),
    trust: values.trust ?? current.trust,
    organizationId: values.organizationId ?? INSTITUTION_ID,
    projectRef: values.projectRef ?? PROJECT_REF,
    now: values.now ?? NOW,
  });
}

async function rejectsOwnerEvidence(promise) {
  await assert.rejects(promise, error => (
    error instanceof Error
    && error.code === 'OWNER_EVIDENCE_MISSING'
    && error.message === 'OWNER_EVIDENCE_MISSING'
  ));
}

function rejectsAuthorizationMismatch(callback) {
  assert.throws(callback, error => (
    error instanceof Error
    && error.code === 'INSTALL_AUTHORIZATION_MISMATCH'
    && error.message === 'INSTALL_AUTHORIZATION_MISMATCH'
  ));
}

test('valid signatures authorize only the private in-memory bindings and hashes', async () => {
  const current = await fixture();
  const authorization = await authorize({ current });
  assert.deepEqual(Object.keys(authorization).sort(), [
    'approvalSha256', 'contractVersion', 'expectedOwnerOrgId', 'expectedOwnerOrgIdHash',
    'expiresAt', 'installationId', 'institutionId', 'institutionIdHash', 'projectRef',
    'projectRefHash', 'runtimeConfigurationSha256', 'runtimeManifestSha256', 'runtimeSequence',
  ].sort());
  assert.equal(authorization.installationId, INSTALLATION_ID);
  assert.equal(authorization.institutionId, INSTITUTION_ID);
  assert.equal(authorization.projectRef, PROJECT_REF);
  assert.equal(authorization.expectedOwnerOrgId, OWNER_ORG_ID);
  assert.equal(authorization.runtimeManifestSha256, await sha256Jcs(current.manifest));
  assert.equal(await hashCanonical(current.manifest), authorization.runtimeManifestSha256);
  assert.equal(authorization.approvalSha256, await sha256Jcs(current.approval));
  assert.equal(authorization.expiresAt, current.approval.expiresAt);
  assert.match(authorization.runtimeConfigurationSha256, /^[a-f0-9]{64}$/);
});

test('documents accept bounded UTF-8 local files while trust remains explicit configuration', async () => {
  const current = await fixture();
  const directory = await mkdtemp(join(tmpdir(), 'ccc-install-authorization-'));
  const manifestPath = join(directory, 'manifest.json');
  const approvalPath = join(directory, 'approval.json');
  try {
    await Promise.all([
      writeFile(manifestPath, JSON.stringify(current.manifest), 'utf8'),
      writeFile(approvalPath, JSON.stringify(current.approval), 'utf8'),
    ]);
    const authorization = await requireSignedOwnerPreflight({
      installManifest: manifestPath,
      installApproval: approvalPath,
      trust: JSON.stringify(current.trust),
      organizationId: INSTITUTION_ID,
      projectRef: PROJECT_REF,
      now: NOW,
    });
    assert.equal(authorization.installationId, INSTALLATION_ID);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('approval digest covers the signature-bearing whole public manifest', async () => {
  const current = await fixture();
  const { ed25519Signature: _signature, ...unsigned } = current.manifest;
  const approvalWithUnsignedDigest = await signedApproval(current.manifest, current.approvalSigner, {
    runtimeManifestSha256: await sha256Jcs(unsigned),
  });
  await rejectsOwnerEvidence(authorize({ current, approval: approvalWithUnsignedDigest }));

  const forgedManifest = { ...current.manifest, ed25519Signature: base64(new Uint8Array(64)) };
  const reboundApproval = await signedApproval(forgedManifest, current.approvalSigner);
  await rejectsOwnerEvidence(authorize({ current, manifest: forgedManifest, approval: reboundApproval }));
});

test('private approval rejects forged fields, self-trust, duplicate keys, and unknown fields', async () => {
  const current = await fixture();
  await rejectsOwnerEvidence(authorize({
    current,
    approval: { ...current.approval, expectedOwnerOrgId: 'forged-owner' },
  }));
  await rejectsOwnerEvidence(authorize({
    current,
    approval: { ...current.approval, publicKeys: current.trust.publicKeys },
  }));

  const duplicate = JSON.stringify(current.approval).replace(
    '"institutionId":"institution-synthetic"',
    '"institutionId":"institution-synthetic","institutionId":"institution-synthetic"',
  );
  await rejectsOwnerEvidence(requireSignedOwnerPreflight({
    installManifest: JSON.stringify(current.manifest),
    installApproval: duplicate,
    trust: current.trust,
    organizationId: INSTITUTION_ID,
    projectRef: PROJECT_REF,
    now: NOW,
  }));
});

test('organization, project, installation, and public digest bindings are exact', async () => {
  const current = await fixture();
  await rejectsOwnerEvidence(authorize({ current, organizationId: 'other-institution' }));
  await rejectsOwnerEvidence(authorize({ current, projectRef: 'other-project-ref' }));

  for (const overrides of [
    { institutionId: 'other-institution' },
    { projectRef: 'other-project-ref' },
    { installationId: 'other-installation' },
    { runtimeManifestSha256: '00'.repeat(32) },
  ]) {
    const approval = await signedApproval(current.manifest, current.approvalSigner, overrides);
    await rejectsOwnerEvidence(authorize({ current, approval }));
  }
});

test('expired, future-issued, and revoked public manifests are rejected', async () => {
  const current = await fixture();
  const expired = await sign(unsignedManifest(current.publicSigner.keyId, {
    expiresAt: '2026-09-10T12:00:00.000Z',
  }), current.publicSigner);
  await rejectsOwnerEvidence(authorize({
    current,
    manifest: expired,
    approval: await signedApproval(expired, current.approvalSigner),
  }));

  const future = await sign(unsignedManifest(current.publicSigner.keyId, {
    publishedAt: '2026-09-10T12:00:00.001Z',
  }), current.publicSigner);
  await rejectsOwnerEvidence(authorize({
    current,
    manifest: future,
    approval: await signedApproval(future, current.approvalSigner),
  }));

  await assert.rejects(verifySignedInstallManifest(future, {
    publicKeys: current.trust.publicKeys,
    revokedKeyIds: [],
    now: NOW,
  }), error => error?.code === 'invalid_shape');
  await rejectsOwnerEvidence(authorize({
    current,
    trust: { ...current.trust, revokedKeyIds: [current.publicSigner.keyId] },
  }));
  await assert.rejects(verifySignedInstallManifest(current.manifest, {
    publicKeys: current.trust.publicKeys,
    revokedKeyIds: [current.publicSigner.keyId],
    now: NOW,
  }), error => error?.code === 'key_revoked');
});

test('expired and revoked private approvals are rejected', async () => {
  const current = await fixture();
  const expired = await signedApproval(current.manifest, current.approvalSigner, {
    expiresAt: '2026-09-10T12:00:00.000Z',
  });
  await rejectsOwnerEvidence(authorize({ current, approval: expired }));
  await rejectsOwnerEvidence(authorize({
    current,
    trust: { ...current.trust, revokedKeyIds: [current.approvalSigner.keyId] },
  }));
});

test('ordinary resume requires exact artifacts; renewal accepts metadata-only change with a larger sequence', async () => {
  const current = await fixture();
  const previous = {
    ...await authorize({ current }),
    resourcesSha256: RESOURCES_SHA256,
    migrationsSha256: MIGRATIONS_SHA256,
  };
  assert.equal(assertAuthorizationMatches(previous, previous, {
    renewAuthorization: false,
    resourcesSha256: RESOURCES_SHA256,
    migrationsSha256: MIGRATIONS_SHA256,
    now: NOW,
  }), true);
  rejectsAuthorizationMismatch(() => assertAuthorizationMatches(previous, previous, {
    renewAuthorization: false,
    resourcesSha256: RESOURCES_SHA256,
    migrationsSha256: MIGRATIONS_SHA256,
    now: new Date(previous.expiresAt),
  }));

  const renewedManifest = await sign(unsignedManifest(current.publicSigner.keyId, {
    sequence: 2,
    publishedAt: '2026-09-10T06:00:00.000Z',
    expiresAt: '2026-09-14T00:00:00.000Z',
  }), current.publicSigner);
  const renewed = await authorize({
    current,
    manifest: renewedManifest,
    approval: await signedApproval(renewedManifest, current.approvalSigner, {
      expiresAt: '2026-09-13T00:00:00.000Z',
    }),
  });
  rejectsAuthorizationMismatch(() => assertAuthorizationMatches(previous, renewed, {
    renewAuthorization: false,
    resourcesSha256: RESOURCES_SHA256,
    migrationsSha256: MIGRATIONS_SHA256,
    now: NOW,
  }));
  assert.equal(assertAuthorizationMatches(previous, renewed, {
    renewAuthorization: true,
    resourcesSha256: RESOURCES_SHA256,
    migrationsSha256: MIGRATIONS_SHA256,
    now: NOW,
  }), true);
  rejectsAuthorizationMismatch(() => assertAuthorizationMatches(previous, renewed, {
    renewAuthorization: true,
    resourcesSha256: '33'.repeat(32),
    migrationsSha256: MIGRATIONS_SHA256,
    now: NOW,
  }));
});

test('renewal rejects altered public configuration and a non-increasing sequence', async () => {
  const current = await fixture();
  const previous = {
    ...await authorize({ current }),
    resourcesSha256: RESOURCES_SHA256,
    migrationsSha256: MIGRATIONS_SHA256,
  };
  const changedManifest = await sign(unsignedManifest(current.publicSigner.keyId, {
    apiBase: 'https://other-api.example.invalid/api',
    sequence: 2,
    publishedAt: '2026-09-10T06:00:00.000Z',
  }), current.publicSigner);
  const changed = await authorize({
    current,
    manifest: changedManifest,
    approval: await signedApproval(changedManifest, current.approvalSigner),
  });
  rejectsAuthorizationMismatch(() => assertAuthorizationMatches(previous, changed, {
    renewAuthorization: true,
    resourcesSha256: RESOURCES_SHA256,
    migrationsSha256: MIGRATIONS_SHA256,
    now: NOW,
  }));

  const sameSequenceManifest = await sign(unsignedManifest(current.publicSigner.keyId, {
    expiresAt: '2026-09-14T00:00:00.000Z',
  }), current.publicSigner);
  const sameSequence = await authorize({
    current,
    manifest: sameSequenceManifest,
    approval: await signedApproval(sameSequenceManifest, current.approvalSigner),
  });
  rejectsAuthorizationMismatch(() => assertAuthorizationMatches(previous, sameSequence, {
    renewAuthorization: true,
    resourcesSha256: RESOURCES_SHA256,
    migrationsSha256: MIGRATIONS_SHA256,
    now: NOW,
  }));
});
