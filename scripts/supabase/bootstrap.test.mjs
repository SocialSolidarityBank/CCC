import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import {
  createHostedInspector,
  createInstallationHealth,
  DATABASE_STATE_QUERY,
  RESTRICTED_ROLE_QUERY,
} from './hosted-inspector.mjs';
import {
  assertProviderBaselineCurrent,
  buildSupabasePlan,
  buildSupabaseDoctor,
  installationStateFingerprint,
} from './plan.mjs';
import {
  BETA_TRUST_DOMAIN,
  PROVIDER_BASELINE_DOMAIN,
  requireProviderBaseline,
} from './provider-baseline.mjs';
import {
  normalizeProviderInventory,
  providerInventoryFingerprint,
  PROVIDER_INVENTORY_QUERY,
} from './provider-inventory.mjs';
import { hashDatabaseInstallFingerprint, INSTALL_METADATA_TABLES } from './install-journal.mjs';
import { loadReleaseIndexForDoctor } from './apply.mjs';
import { PINNED_RELEASE_ORIGIN } from '../release/release-origin.mjs';
import { observationAuthorization } from './fixtures/authorization.mjs';
import { canonicalizeJcs, sha256Jcs } from '../../apps/community-cloud/dist/install-manifest-verifier.js';

const repoRoot = resolve(import.meta.dirname, '../..');
const cliPath = resolve(import.meta.dirname, 'bootstrap.mjs');
const fetchShim = pathToFileURL(resolve(import.meta.dirname, 'bootstrap-fetch-shim.test.mjs')).href;
const accessToken = 'sbp_black_box_secret_1234567890';

const emptyProviderInventory = {
  objects: [],
  grants: [],
  ...providerInventoryFingerprint({ objects: [], grants: [] }),
};
function verifiedProviderBaseline(inventory = emptyProviderInventory) {
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
  };
}

function databaseSnapshot(overrides = {}) {
  return {
    schema_fingerprint: 'schema-empty',
    policy_fingerprint: 'policy-empty',
    bucket_fingerprint: 'bucket-empty',
    bucket_inventory: [],
    user_table_names: [],
    user_table_count: 0,
    user_row_estimate: 0,
    rls_enabled_table_count: 0,
    policy_count: 0,
    bucket_exists: false,
    bucket_public: null,
    ledger_exists: false,
    auth_user_count: 0, bucket_count: 0, storage_object_count: 0, user_routine_count: 0,
    user_type_count: 0, unknown_object_count: 0, custom_schema_count: 0, user_auxiliary_relation_count: 0,
    unowned_object_count: 0, installation_unowned_object_count: 0, installation_unowned_schema_count: 0,
    unexpected_grant_count: 0, installation_unexpected_grant_count: 0, private_table_names: [],
    provider_object_count: 0, provider_grant_count: 0,
    private_schema_exists: false, private_install_metadata_exists: false, cron_exists: false,
    database_version: '17.4',
    database_version_num: '170004',
    read_only: true,
    database_readable: true,
    ...overrides,
  };
}

function providerInventorySnapshot(overrides = {}) {
  return {
    objects: [],
    grants: [],
    ...overrides,
  };
}

function objectRowForInspector() {
  return {
    object_kind: 'schema', namespace_name: 'auth', object_identity: 'auth',
    owner_name: 'supabase_admin', definition_text: '{"name":"auth"}',
    provenance: 'supabase_managed',
  };
}

function grantRowForInspector() {
  return {
    grant_kind: 'schema', namespace_name: 'auth', object_identity: 'auth',
    grantor_name: 'supabase_admin', grantee_name: 'ROLE:authenticated', privilege: 'USAGE',
    is_grantable: false, provenance: 'supabase_managed',
  };
}

async function withManagementApi({
  region = 'ap-northeast-2',
  status = 200,
  controlDatabaseVersion = '17.4',
  database = databaseSnapshot(),
  providerInventory = providerInventorySnapshot(),
  mutateAuth = false,
  mutateData = false,
  installState = null,
}, run) {
  const requests = [];
  let authReadCount = 0;
  let dataReadCount = 0;
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, path: request.url, authorization: request.headers.authorization, body });

    if (request.headers.authorization !== `Bearer ${accessToken}`) {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: `invalid ${accessToken}` }));
      return;
    }
    if (status !== 200) {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ message: `provider response contains ${accessToken}` }));
      return;
    }
    response.writeHead(request.url.endsWith('/database/query/read-only') ? 201 : 200, {
      'content-type': 'application/json',
    });
    if (request.url === '/v1/projects/test-project') {
      response.end(JSON.stringify({
        id: 'test-project',
        ref: 'test-project',
        organization_id: 'test-organization',
        organization_slug: 'test-organization',
        name: 'test-project',
        region,
        created_at: '2026-08-31T00:00:00Z',
        status: 'ACTIVE_HEALTHY',
        database: { host: 'db.test.invalid', version: controlDatabaseVersion, postgres_engine: '17', release_channel: 'ga' },
      }));
      return;
    }
    if (request.url === '/v1/projects/test-project/config/auth') {
      authReadCount += 1;
      response.end(JSON.stringify({
        disable_signup: true,
        external_email_enabled: true,
        jwt_exp: 3600,
        mailer_autoconfirm: mutateAuth === 'mailer_autoconfirm' && authReadCount > 1,
        mfa_max_enrolled_factors: mutateAuth === 'mfa_max_enrolled_factors' && authReadCount > 1 ? 9 : 10,
        mfa_totp_enroll_enabled: true,
        mfa_totp_verify_enabled: true,
        refresh_token_rotation_enabled: true,
        security_captcha_enabled: !(mutateAuth === 'security_captcha_enabled' && authReadCount > 1),
        sessions_single_per_user: false,
        site_url: mutateAuth === true && authReadCount > 1 ? 'https://changed-must-not-escape.test' : 'https://must-not-escape.test',
        smtp_pass: 'must-not-escape',
      }));
      return;
    }
    if (request.url === '/v1/projects/test-project/database/query/read-only') {
      const query = JSON.parse(body).query;
      if (query.includes(' AS row_value')) {
        dataReadCount += 1;
        response.end(JSON.stringify([{
          row_count: '1',
          hash_a: mutateData && dataReadCount > 1 ? 'changed-a' : 'stable-a',
          hash_b: mutateData && dataReadCount > 1 ? 'changed-b' : 'stable-b',
        }]));
      } else {
        if (query.includes('provider_object_inventory')) {
          response.end(JSON.stringify([providerInventory]));
          return;
        }
        if (query.includes(' AS install_state')) {
          response.end(JSON.stringify([{ install_state: installState }]));
          return;
        }
        if (query.includes('catalog_state')) {
          response.end(JSON.stringify([{ catalog_state: 'synthetic-public-catalog' }]));
          return;
        }
        response.end(JSON.stringify([database]));
      }
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'not found' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run({ origin: `http://127.0.0.1:${address.port}`, requests });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

async function runCli(origin, {
  token = accessToken, leadingSeparator = false, managementOrigin, operation = 'plan',
  installManifest, manifestUrl, signedInput, extraArgs = [], format = 'json', cwd = repoRoot,
} = {}) {
  const args = [cliPath, ...(leadingSeparator ? ['--'] : []), operation, '--target', 'hosted', '--project-ref', 'test-project'];
  if (format !== null) args.push('--format', format);
  if (manifestUrl !== undefined) args.push('--manifest-url', manifestUrl);
  args.push(...extraArgs);
  if (installManifest !== undefined) args.push('--install-manifest', installManifest);
  const childEnv = {
    ...process.env,
    NODE_OPTIONS: `--import=${fetchShim}`,
    SUPABASE_ACCESS_TOKEN: token,
    CCC_SUPABASE_TEST_ORIGIN: origin,
  };
  delete childEnv.CCC_SUPABASE_MANAGEMENT_ORIGIN;
  delete childEnv.CCC_INSTALL_MANIFEST;
  delete childEnv.CCC_INSTALL_SIGNING_KEYS;
  delete childEnv.CCC_DATABASE_CA_FILE;
  delete childEnv.CCC_INSTALL_APPROVAL;
  delete childEnv.CCC_INSTALL_REVOKED_KEY_IDS;
  delete childEnv.CCC_ORGANIZATION_ID;
  delete childEnv.CCC_BETA_TRUST_ROOT_KEYS;
  delete childEnv.CCC_BETA_REVOKED_ROOT_KEY_IDS;
  delete childEnv.CCC_BETA_RELEASE_TRUST;
  delete childEnv.CCC_PROVIDER_BASELINE;
  delete childEnv.CCC_RELEASE_TRUST_STORE;
  if (signedInput !== undefined) Object.assign(childEnv, signedInput);
  if (managementOrigin !== undefined) childEnv.CCC_SUPABASE_MANAGEMENT_ORIGIN = managementOrigin;
  const child = spawn(process.execPath, args, {
    cwd,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const [exitCode] = await once(child, 'exit');
  return { exitCode, stdout, stderr };
}

function assertNoSensitiveOutput(result, origin) {
  const output = `${result.stdout}\n${result.stderr}`;
  assert.doesNotMatch(output, /https?:\/\//u);
  assert.doesNotMatch(output, /postgres(?:ql)?:\/\//u);
  assert.doesNotMatch(output, /sbp_[A-Za-z0-9_-]+/u);
  assert.doesNotMatch(output, /must-not-escape/u);
  assert.equal(output.includes(origin), false);
}

function hostedInspector(
  origin,
  token = accessToken,
  authorization = observationAuthorization(),
) {
  return createHostedInspector({
    accessToken: token,
    projectRef: 'test-project',
    authorization,
    fetchImpl: (url, options) => {
      assert.equal(new URL(url).origin, 'https://api.supabase.com');
      return fetch(new URL(new URL(url).pathname, origin), options);
    },
  });
}

async function inspectPlan(origin, token = accessToken) {
  const authorization = observationAuthorization();
  return buildSupabasePlan({
    target: 'hosted',
    inspector: hostedInspector(origin, token),
    authorization,
    providerBaseline: verifiedProviderBaseline(),
  });
}

test('owner-aware hosted observation uses only read endpoints and produces a redacted plan', async () => {
  await withManagementApi({}, async ({ origin, requests }) => {
    const output = await inspectPlan(origin);
    assert.equal(output.ready, true);
    assert.equal(output.readOnly, true);
    assert.equal(output.unchanged, true);
    assert.equal(output.project.ownerVerified, true);
    assertNoSensitiveOutput({ stdout: JSON.stringify(output), stderr: '' }, origin);
    assert.ok(requests.length >= 6);
    assert.ok(requests.every(({ method, path }) => method === 'GET' || (method === 'POST' && path.endsWith('/database/query/read-only'))));
    assert.ok(requests.filter(({ path }) => path.endsWith('/database/query/read-only')).every(({ body }) => JSON.parse(body).query.trimStart().startsWith('SELECT')));
  });
});

async function signedCliInputs(expectedOwnerOrgId = 'test-organization', {
  expiredTrust = false,
  expiredBaseline = false,
  baselineInventory = emptyProviderInventory,
} = {}) {
  const install = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const root = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const release = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = async pair =>
    Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64');
  const sign = async (value, pair = install, domain = '') => ({
    ...value,
    ed25519Signature: Buffer.from(await crypto.subtle.sign(
      'Ed25519',
      pair.privateKey,
      Buffer.concat([
        Buffer.from(domain, 'ascii'),
        Buffer.from(canonicalizeJcs(value), 'utf8'),
      ]),
    )).toString('base64'),
  });
  const now = Date.now();
  const manifestExpiresAt = new Date(now + 600_000).toISOString();
  const manifest = await sign({
    schemaVersion: 1, mode: 'community-cloud', apiBase: 'https://api.example.invalid/api',
    clientOrigin: 'https://client.example.invalid', allowedOrigins: ['https://client.example.invalid'],
    host: 'client.example.invalid', scheme: 'https', endpointDiscovery: 'static',
    installationId: 'synthetic-installation', sequence: 1,
    publishedAt: new Date(now - 60_000).toISOString(), expiresAt: manifestExpiresAt,
    approvedSttEngineIds: [], supabaseProjectRef: 'test-project', supabaseAuthOrigin: 'https://test-project.supabase.co',
    supabasePublishableKey: 'sb_publishable_synthetic', signingKeyId: 'synthetic-key',
  });
  const approval = await sign({
    schemaVersion: 1, institutionId: 'synthetic-institution', projectRef: 'test-project', expectedOwnerOrgId,
    installationId: manifest.installationId, runtimeManifestSha256: await sha256Jcs(manifest),
    contractVersion: 'S11-install-approval-v1', expiresAt: manifest.expiresAt, signingKeyId: 'synthetic-key',
  });
  const projectRefSha256 = createHash('sha256').update('test-project').digest('hex');
  const ownerOrgIdSha256 = createHash('sha256').update(expectedOwnerOrgId).digest('hex');
  const trustExpiresAt = new Date(expiredTrust ? now - 1_000 : now + 300_000).toISOString();
  const releaseTrust = await sign({
    schemaVersion: 1,
    profile: 'development',
    channel: 'beta',
    provider: 'supabase',
    projectRefSha256,
    ownerOrgIdSha256,
    region: 'ap-northeast-2',
    rootKeyId: 'synthetic-beta-root',
    releaseKeyId: 'synthetic-beta-release',
    releasePublicKey: await publicKey(release),
    notBefore: new Date(expiredTrust ? now - 120_000 : now - 60_000).toISOString(),
    expiresAt: trustExpiresAt,
  }, root, BETA_TRUST_DOMAIN);
  const baselineExpiresAt = new Date(
    expiredBaseline ? now - 1_000 : Math.min(Date.parse(trustExpiresAt), now + 240_000),
  ).toISOString();
  const providerBaseline = await sign({
    schemaVersion: 1,
    profile: 'development',
    channel: 'beta',
    provider: 'supabase',
    baselineVersion: 'supabase-hosted-pg17-20260911-v1',
    projectRefSha256,
    ownerOrgIdSha256,
    region: 'ap-northeast-2',
    databaseVersion: '17.4',
    sourceEvidenceSha256: 'd'.repeat(64),
    emptyBusinessState: {
      userTableCount: 0,
      userRowEstimate: 0,
      authUserCount: 0,
      bucketCount: 0,
      storageObjectCount: 0,
    },
    objects: baselineInventory.objects,
    grants: baselineInventory.grants,
    objectInventorySha256: baselineInventory.objectInventorySha256,
    grantInventorySha256: baselineInventory.grantInventorySha256,
    issuedAt: new Date(expiredBaseline ? now - 120_000 : now - 60_000).toISOString(),
    expiresAt: baselineExpiresAt,
    signingKeyId: 'synthetic-beta-release',
  }, release, PROVIDER_BASELINE_DOMAIN);
  return {
    CCC_INSTALL_MANIFEST: JSON.stringify(manifest),
    CCC_INSTALL_APPROVAL: JSON.stringify(approval),
    CCC_ORGANIZATION_ID: 'synthetic-institution',
    CCC_INSTALL_SIGNING_KEYS: JSON.stringify({ 'synthetic-key': await publicKey(install) }),
    CCC_INSTALL_REVOKED_KEY_IDS: '[]',
    CCC_BETA_TRUST_ROOT_KEYS: JSON.stringify({ 'synthetic-beta-root': await publicKey(root) }),
    CCC_BETA_REVOKED_ROOT_KEY_IDS: '[]',
    CCC_BETA_RELEASE_TRUST: JSON.stringify(releaseTrust),
    CCC_PROVIDER_BASELINE: JSON.stringify(providerBaseline),
  };
}

test('report CLI writes a private read-only diagnostic and preserves an existing report', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'ccc-report-cli-'));
  const outputPath = resolve(directory, 'diagnostic.json');
  try {
    await withManagementApi({}, async ({ origin, requests }) => {
      const signedInput = await signedCliInputs();
      const result = await runCli(origin, {
        operation: 'report', signedInput, extraArgs: ['--output', outputPath],
      });
      assert.equal(result.exitCode, 6, result.stderr);
      const saved = await readFile(outputPath, 'utf8');
      const report = JSON.parse(saved);
      assert.deepEqual(JSON.parse(result.stdout), report);
      assert.ok(report.checks.some(check => check.code === 'INSTALL_NOT_FOUND' && check.status === 'NOT_RUN'));
      assert.equal(report.installedVersion, '');
      assert.equal(report.installedSequence, '');
      assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
      assertNoSensitiveOutput(result, origin);
      assert.equal(saved.includes(outputPath), false);
      assert.equal(saved.includes('synthetic-institution'), false);
      assert.ok(requests.every(({ method, path }) => method === 'GET'
        || path.endsWith('/database/query/read-only')));
      const second = await runCli(origin, {
        operation: 'report', signedInput, extraArgs: ['--output', outputPath],
      });
      assert.equal(second.exitCode, 5);
      assert.equal(JSON.parse(second.stderr).error.code, 'OUTPUT_REDACTION_FAILED');
      assert.equal(await readFile(outputPath, 'utf8'), saved);
      assert.deepEqual(await readdir(directory), ['diagnostic.json']);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('report CLI rejects invalid scope and absent output before provider access', async () => {
  await withManagementApi({}, async ({ origin, requests }) => {
    for (const options of [
      { operation: 'report' },
      { operation: 'plan', extraArgs: ['--output', '/unused/report.json'] },
      { operation: 'report', extraArgs: ['--output', '/unused/report.json', '--output', '/unused/other.json'] },
    ]) {
      const result = await runCli(origin, options);
      assert.equal(JSON.parse(result.stderr).error.code, 'OPERATION_UNSUPPORTED');
    }
    assert.deepEqual(requests, []);
  });
});

test('report JSON alias preserves parser errors and rejects an option token as output before provider access', async () => {
  await withManagementApi({}, async ({ origin, requests }) => {
    for (const extraArgs of [
      ['--json'],
      ['--json', '--unknown'],
      ['--output', '--json'],
    ]) {
      const result = await runCli(origin, {
        operation: 'report',
        format: null,
        extraArgs,
      });
      assert.equal(result.exitCode, 2, result.stderr);
      assert.equal(JSON.parse(result.stderr).error.code, 'OPERATION_UNSUPPORTED');
    }
    assert.deepEqual(requests, []);
  });
});

test('report accepts an explicitly prefixed --json output filename', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'ccc-report-option-name-'));
  try {
    await withManagementApi({}, async ({ origin }) => {
      const result = await runCli(origin, {
        operation: 'report',
        format: null,
        signedInput: await signedCliInputs(),
        extraArgs: ['--json', '--output', './--json'],
        cwd: directory,
      });
      assert.equal(result.exitCode, 6, result.stderr);
      const saved = JSON.parse(await readFile(resolve(directory, '--json'), 'utf8'));
      assert.deepEqual(JSON.parse(result.stdout), saved);
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('real CLI accepts both signed documents and observes the approved owner read-only', async () => {
  await withManagementApi({}, async ({ origin, requests }) => {
    const result = await runCli(origin, { signedInput: await signedCliInputs() });
    assert.equal(result.exitCode, 0, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.equal(output.ready, true);
    assert.equal(output.readOnly, true);
    assert.equal(output.project.ownerVerified, true);
    assert.equal(output.productionReady, false);
    assert.ok(requests.every(({ method, path }) => method === 'GET' || path.endsWith('/database/query/read-only')));
    assertNoSensitiveOutput(result, origin);
    assert.equal(result.stdout.includes('test-organization'), false);
    assert.equal(result.stdout.includes('synthetic-institution'), false);
  });
});

test('beta trust and provider baseline fail before token use or provider access', async () => {
  await withManagementApi({}, async ({ origin, requests }) => {
    const invalidTrust = await signedCliInputs();
    invalidTrust.CCC_BETA_RELEASE_TRUST = '{invalid';
    const invalidBaseline = await signedCliInputs();
    const baseline = JSON.parse(invalidBaseline.CCC_PROVIDER_BASELINE);
    baseline.ed25519Signature = `${baseline.ed25519Signature[0] === 'A' ? 'B' : 'A'}${baseline.ed25519Signature.slice(1)}`;
    invalidBaseline.CCC_PROVIDER_BASELINE = JSON.stringify(baseline);
    for (const [signedInput, code] of [
      [{ ...invalidTrust, SUPABASE_ACCESS_TOKEN: '' }, 'BETA_TRUST_INVALID'],
      [{ ...invalidBaseline, SUPABASE_ACCESS_TOKEN: '' }, 'PROVIDER_BASELINE_INVALID'],
      [await signedCliInputs('test-organization', { expiredTrust: true }), 'BETA_TRUST_INVALID'],
      [await signedCliInputs('test-organization', { expiredBaseline: true }), 'PROVIDER_BASELINE_INVALID'],
    ]) {
      const result = await runCli(origin, { token: '', signedInput });
      assert.equal(result.exitCode, 6);
      const error = JSON.parse(result.stderr).error;
      assert.equal(error.code, code);
      assert.match(error.message, /[가-힣]/u);
      assert.doesNotMatch(error.message, /—/u);
      assertNoSensitiveOutput(result, origin);
    }
    assert.equal(requests.length, 0);
  });
});


test('per-request authorization blocks an expired baseline before another fetch', async () => {
  const authorization = observationAuthorization();
  const baseline = verifiedProviderBaseline();
  const expiry = Date.parse(baseline.expiresAt);
  let now = expiry - 1;
  let fetchCalls = 0;
  const inspector = createHostedInspector({
    accessToken,
    projectRef: authorization.projectRef,
    authorization,
    authorize: async () => {
      assertProviderBaselineCurrent(baseline, authorization, now);
      return authorization;
    },
    fetchImpl: async () => {
      fetchCalls += 1;
      now = expiry;
      return new Response(JSON.stringify({
        id: authorization.projectRef,
        organization_id: authorization.expectedOwnerOrgId,
        region: 'ap-northeast-2',
        status: 'ACTIVE_HEALTHY',
        database: { version: '17.4' },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  await assert.rejects(
    inspector.inspect(),
    error => error.code === 'PROVIDER_BASELINE_INVALID',
  );
  assert.equal(fetchCalls, 1);
});

test('durable installation fingerprint covers replica identity in proved records', () => {
  const inventory = replicaIdentity => normalizeProviderInventory({
    objects: [{
      object_kind: 'relation',
      namespace_name: 'public',
      object_identity: 'public.installation_table TABLE',
      owner_name: 'ccc_schema_owner',
      definition_text: JSON.stringify({ relkind: 'r', replicaIdentity }),
      provenance: 'supabase_managed',
    }],
    grants: [],
    installation_objects: [{
      object_kind: 'relation',
      namespace_name: 'public',
      object_identity: 'public.installation_table TABLE',
      owner_name: 'ccc_schema_owner',
      definition_text: JSON.stringify({ relkind: 'r', replicaIdentity }),
      provenance: 'supabase_managed',
    }],
    installation_grants: [],
  });
  const rows = [{ catalog_state: 'same-catalog-state-without-relreplident' }];
  assert.notEqual(
    hashDatabaseInstallFingerprint(rows, inventory('d')),
    hashDatabaseInstallFingerprint(rows, inventory('f')),
  );
});

test('durable installation fingerprint covers grantor in proved grants', () => {
  const inventory = grantor => normalizeProviderInventory({
    objects: [],
    grants: [{
      grant_kind: 'role',
      namespace_name: '',
      object_identity: 'ccc_schema_owner',
      grantor_name: grantor,
      grantee_name: 'ROLE:postgres',
      privilege: 'MEMBER',
      is_grantable: false,
      inherit_option: true,
      set_option: true,
      provenance: 'supabase_managed',
    }],
    installation_objects: [],
    installation_grants: [{
      grant_kind: 'role',
      namespace_name: '',
      object_identity: 'ccc_schema_owner',
      grantor_name: grantor,
      grantee_name: 'ROLE:postgres',
      privilege: 'MEMBER',
      is_grantable: false,
      inherit_option: true,
      set_option: true,
      provenance: 'supabase_managed',
    }],
  });
  const rows = [{ catalog_state: 'same-catalog-state-without-grantor' }];
  assert.notEqual(
    hashDatabaseInstallFingerprint(rows, inventory('postgres')),
    hashDatabaseInstallFingerprint(rows, inventory('supabase_admin')),
  );
});
test('provider baseline mismatch is redacted and uses the fixed recovery code', async () => {
  const objectName = 'provider-object-name-must-not-escape';
  await withManagementApi({
    database: databaseSnapshot({
      unknown_object_count: 1,
      unowned_object_count: 1,
      provider_object_count: 1,
    }),
    providerInventory: providerInventorySnapshot({
      objects: [{
        object_kind: 'catalog',
        namespace_name: 'auth',
        object_identity: objectName,
        owner_name: 'supabase_admin',
        definition_text: '{"provider":"changed"}',
        provenance: 'supabase_managed',
      }],
    }),
  }, async ({ origin }) => {
    const signedInput = await signedCliInputs();
    const signature = JSON.parse(signedInput.CCC_PROVIDER_BASELINE).ed25519Signature;
    const result = await runCli(origin, { signedInput });
    assert.equal(result.exitCode, 6, result.stderr);
    const output = JSON.parse(result.stdout);
    assert.ok(output.blockers.some(({ code }) => code === 'PROVIDER_BASELINE_MISMATCH'));
    assert.equal(output.providerBaseline.matched, false);
    const serialized = JSON.stringify(output);
    assert.equal(serialized.includes(objectName), false);
    assert.equal(serialized.includes(signature), false);
    assertNoSensitiveOutput(result, origin);
  });
});

test('real inspector reconciles complete provider and journal-owned installation inventory', async t => {
  const providerObjects = [
    objectRowForInspector(),
    {
      object_kind: 'routine', namespace_name: 'auth',
      object_identity: 'auth.extension_routine() FUNCTION RETURNS void',
      owner_name: 'supabase_admin', definition_text: 'extension routine definition',
      provenance: 'extension',
    },
    {
      object_kind: 'type', namespace_name: 'storage',
      object_identity: 'storage.initial_type', owner_name: 'supabase_storage_admin',
      definition_text: 'initial type definition', provenance: 'initial_privilege',
    },
  ];
  const providerGrants = [
    {
      grant_kind: 'schema', namespace_name: 'auth', object_identity: 'auth',
      grantor_name: 'supabase_admin', grantee_name: 'ROLE:supabase_admin',
      privilege: 'USAGE', is_grantable: false, inherit_option: null, set_option: null,
      provenance: 'supabase_managed',
    },
    {
      grant_kind: 'routine', namespace_name: 'auth',
      object_identity: 'auth.extension_routine() FUNCTION RETURNS void',
      grantor_name: 'supabase_admin', grantee_name: 'PUBLIC',
      privilege: 'EXECUTE', is_grantable: false, inherit_option: null, set_option: null,
      provenance: 'initial_privilege',
    },
    {
      grant_kind: 'type', namespace_name: 'storage', object_identity: 'storage.initial_type',
      grantor_name: 'supabase_storage_admin', grantee_name: 'ROLE:authenticated',
      privilege: 'USAGE', is_grantable: false, inherit_option: null, set_option: null,
      provenance: 'supabase_managed',
    },
  ];
  const installationObjects = [
    {
      object_kind: 'relation', namespace_name: 'private',
      object_identity: 'private.ccc_install_journal TABLE', owner_name: 'ccc_schema_owner',
      definition_text: '{"relkind":"r","replicaIdentity":"d"}',
      provenance: 'supabase_managed',
    },
    {
      object_kind: 'routine', namespace_name: 'public',
      object_identity: 'public.ccc_program_admission_write() FUNCTION RETURNS void',
      owner_name: 'ccc_schema_owner', definition_text: 'installation routine definition',
      provenance: 'supabase_managed',
    },
    {
      object_kind: 'type', namespace_name: 'public',
      object_identity: 'public.ccc_program_state', owner_name: 'ccc_schema_owner',
      definition_text: 'installation type definition', provenance: 'supabase_managed',
    },
  ];
  const installationGrants = [
    {
      grant_kind: 'relation', namespace_name: 'private',
      object_identity: 'private.ccc_install_journal TABLE',
      grantor_name: 'ccc_schema_owner', grantee_name: 'ROLE:ccc_schema_owner',
      privilege: 'SELECT', is_grantable: false, inherit_option: null, set_option: null,
      provenance: 'supabase_managed',
    },
    {
      grant_kind: 'routine', namespace_name: 'public',
      object_identity: 'public.ccc_program_admission_write() FUNCTION RETURNS void',
      grantor_name: 'ccc_schema_owner', grantee_name: 'ROLE:ccc_api',
      privilege: 'EXECUTE', is_grantable: false, inherit_option: null, set_option: null,
      provenance: 'supabase_managed',
    },
    {
      grant_kind: 'type', namespace_name: 'public', object_identity: 'public.ccc_program_state',
      grantor_name: 'ccc_schema_owner', grantee_name: 'ROLE:ccc_schema_owner',
      privilege: 'USAGE', is_grantable: false, inherit_option: null, set_option: null,
      provenance: 'supabase_managed',
    },
    {
      grant_kind: 'role', namespace_name: '', object_identity: 'ccc_schema_owner',
      grantor_name: 'postgres', grantee_name: 'ROLE:postgres',
      privilege: 'MEMBER', is_grantable: false, inherit_option: true, set_option: true,
      provenance: 'supabase_managed',
    },
  ];
  const baselineInventory = normalizeProviderInventory({
    objects: providerObjects,
    grants: providerGrants,
  });
  const rawInventory = {
    objects: [...providerObjects, ...installationObjects],
    grants: [...providerGrants, ...installationGrants],
    installation_objects: installationObjects,
    installation_grants: installationGrants,
  };
  const signedInput = await signedCliInputs('test-organization', { baselineInventory });
  const authorization = {
    ...observationAuthorization(),
    expiresAt: JSON.parse(signedInput.CCC_INSTALL_APPROVAL).expiresAt,
  };
  const baseline = await requireProviderBaseline({
    releaseTrust: signedInput.CCC_BETA_RELEASE_TRUST,
    providerBaseline: signedInput.CCC_PROVIDER_BASELINE,
    rootKeys: JSON.parse(signedInput.CCC_BETA_TRUST_ROOT_KEYS),
    revokedRootKeyIds: JSON.parse(signedInput.CCC_BETA_REVOKED_ROOT_KEY_IDS),
    authorization,
    manifestExpiresAt: JSON.parse(signedInput.CCC_INSTALL_APPROVAL).expiresAt,
    now: new Date(),
  });
  const databaseFingerprint = hashDatabaseInstallFingerprint(
    [{ catalog_state: 'synthetic-public-catalog' }],
    normalizeProviderInventory(rawInventory),
  );
  const installState = {
    journal: {
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
      resourcesSha256: '0'.repeat(64),
      migrationsSha256: '0'.repeat(64),
      phase: 'installed',
      databaseFingerprint,
      stateFingerprint: '0'.repeat(64),
    },
    migrations: [],
    resources: [],
    completedSteps: [],
    currentReceipt: null,
    releaseHistory: [],
  };
  await withManagementApi({
    database: databaseSnapshot({
      ledger_exists: true,
      private_table_names: [...INSTALL_METADATA_TABLES],
      private_schema_exists: true,
      unowned_object_count: 4,
      unknown_object_count: 4,
      installation_unowned_object_count: 3,
      custom_schema_count: 1,
      unexpected_grant_count: 1,
      installation_unexpected_grant_count: 1,
      provider_object_count: rawInventory.objects.length,
      provider_grant_count: rawInventory.grants.length,
    }),
    providerInventory: rawInventory,
    installState,
  }, async ({ origin }) => {
    const first = await hostedInspector(origin).inspect();
    assert.equal(first.providerInventory.installationObjects.length, 3);
    assert.equal(first.providerInventory.installationGrants.length, 4);
    assert.equal(first.state.unownedObjectCount, 1);
    assert.equal(first.state.unexpectedGrantCount, 0);
    assert.equal(first.state.providerObjectCount, 6);
    assert.equal(first.state.providerGrantCount, 7);

    const fresh = structuredClone(first);
    fresh.installed = { ledger: 'absent', version: null, checksum: null };
    fresh.installState = null;
    fresh.providerInventory = baselineInventory;
    fresh.state = {
      ...fresh.state,
      providerObjectCount: baselineInventory.objects.length,
      providerGrantCount: baselineInventory.grants.length,
      privateTableNames: [],
      privateSchemaExists: false,
    };
    const desired = await buildSupabasePlan({
      target: 'hosted',
      authorization,
      providerBaseline: baseline,
      inspector: { inspect: async () => structuredClone(fresh) },
    });
    installState.journal.resourcesSha256 = desired.resourcesSha256;
    installState.journal.migrationsSha256 = desired.migrationsSha256;
    installState.journal.stateFingerprint =
      await installationStateFingerprint(first, baseline);

    const resumed = await buildSupabasePlan({
      target: 'hosted',
      authorization,
      providerBaseline: baseline,
      inspector: hostedInspector(origin),
    });
    assert.equal(resumed.ready, true, JSON.stringify(resumed.blockers));
    assert.equal(resumed.providerBaseline.matched, true);

    await t.test('provider object drift remains a baseline mismatch', async () => {
      providerObjects[1].definition_text = 'drifted extension routine definition';
      const drifted = await buildSupabasePlan({
        target: 'hosted',
        authorization,
        providerBaseline: baseline,
        inspector: hostedInspector(origin),
      });
      assert.equal(drifted.providerBaseline.matched, false);
      assert.ok(drifted.blockers.some(({ code }) => code === 'PROVIDER_BASELINE_MISMATCH'));
      providerObjects[1].definition_text = 'extension routine definition';
    });
    await t.test('installation routine grant drift remains unproved', async () => {
      installationGrants[1].grantee_name = 'ROLE:unrelated';
      const drifted = await buildSupabasePlan({
        target: 'hosted',
        authorization,
        providerBaseline: baseline,
        inspector: hostedInspector(origin),
      });
      assert.equal(drifted.providerBaseline.matched, false);
      assert.ok(drifted.blockers.some(({ code }) => code === 'PROVIDER_BASELINE_MISMATCH'));
      installationGrants[1].grantee_name = 'ROLE:ccc_api';
    });
  });
});

test('signed owner mismatch stops after the project observation and before other access', async () => {
  await withManagementApi({}, async ({ origin, requests }) => {
    const result = await runCli(origin, { signedInput: await signedCliInputs('different-approved-owner') });
    assert.equal(result.exitCode, 6);
    assert.equal(JSON.parse(result.stderr).error.code, 'OWNER_MISMATCH');
    assert.deepEqual(requests.map(({ method, path }) => ({ method, path })), [{ method: 'GET', path: '/v1/projects/test-project' }]);
    assertNoSensitiveOutput(result, origin);
  });
});

test('public hosted preflight rejects absent ownership before credentials or provider access', async () => {
  await withManagementApi({}, async ({ origin, requests }) => {
    for (const options of [{}, { token: '' }, { managementOrigin: origin }, { leadingSeparator: true }]) {
      const result = await runCli(origin, options);
      assert.equal(result.exitCode, 6);
      assert.equal(JSON.parse(result.stderr).error.code, 'OWNER_EVIDENCE_MISSING');
      assertNoSensitiveOutput(result, origin);
    }
    assert.equal(requests.length, 0);
  });
});

test('manifest argument is recognized but malformed input cannot authorize observation', async () => {
  await withManagementApi({}, async ({ origin, requests }) => {
    const result = await runCli(origin, { installManifest: '{invalid' });
    assert.equal(result.exitCode, 6);
    assert.equal(JSON.parse(result.stderr).error.code, 'OWNER_EVIDENCE_MISSING');
    assert.equal(requests.length, 0);
    assertNoSensitiveOutput(result, origin);
  });
});

test('manifest URL is accepted only once by apply and the strict flag whitelist remains closed', async () => {
  await withManagementApi({}, async ({ origin, requests }) => {
    const accepted = await runCli(origin, {
      operation: 'apply',
      manifestUrl: 'https://ccc-releases.account-855.workers.dev/manifests/release.json',
    });
    assert.equal(JSON.parse(accepted.stderr).error.code, 'OWNER_EVIDENCE_MISSING');

    for (const options of [
      { operation: 'plan', manifestUrl: 'https://ccc-releases.account-855.workers.dev/manifests/release.json' },
      {
        operation: 'apply',
        manifestUrl: 'https://ccc-releases.account-855.workers.dev/manifests/release.json',
        extraArgs: ['--manifest-url', 'https://ccc-releases.account-855.workers.dev/manifests/other.json'],
      },
      { operation: 'apply', extraArgs: ['--unknown-release-flag', 'value'] },
    ]) {
      const rejected = await runCli(origin, options);
      assert.equal(rejected.exitCode, 2);
      assert.equal(JSON.parse(rejected.stderr).error.code, 'OPERATION_UNSUPPORTED');
    }
    assert.equal(requests.length, 0);
  });
});

test('every installation operation requires authorization before provider access', async () => {
  await withManagementApi({}, async ({ origin, requests }) => {
    for (const operation of ['apply', 'doctor', 'rollback']) {
      const result = await runCli(origin, {
        operation,
        ...(operation === 'apply' ? {
          manifestUrl: 'https://ccc-releases.account-855.workers.dev/manifests/release.json',
        } : {}),
      });
      assert.equal(result.exitCode, 6);
      assert.equal(JSON.parse(result.stderr).error.code, 'OWNER_EVIDENCE_MISSING');
      assertNoSensitiveOutput(result, origin);
    }
    assert.equal(requests.length, 0);
  });
});

test('read-only observations detect every allowlisted Auth drift without fingerprinting institution row values', async () => {
  for (const mutateAuth of [true, 'mailer_autoconfirm', 'mfa_max_enrolled_factors', 'security_captcha_enabled']) {
    await withManagementApi({ mutateAuth }, async ({ origin }) => {
      const output = await inspectPlan(origin);
      assert.equal(output.unchanged, false);
      assert.ok(output.blockers.some(({ code }) => code === 'PLAN_STATE_CHANGED'));
      assertNoSensitiveOutput({ stdout: JSON.stringify(output), stderr: '' }, origin);
    });
  }
  await withManagementApi({
    database: databaseSnapshot({ user_table_names: ['participants'], user_table_count: 1, user_row_estimate: 1 }),
    mutateData: true,
  }, async ({ origin, requests }) => {
    const output = await inspectPlan(origin);
    assert.equal(output.ready, false);
    assert.ok(output.blockers.some(({ code }) => code === 'EXISTING_PROJECT_NOT_CLEAN'));
    assert.ok(requests.every(({ body }) => !body.includes('AS row_value')));
  });
});

test('read-only observations preserve region and unowned-project denials', async () => {
  await withManagementApi({ region: 'ap-southeast-1' }, async ({ origin }) => {
    const output = await inspectPlan(origin);
    assert.ok(output.blockers.some(({ code }) => code === 'REGION_MISMATCH'));
  });
  await withManagementApi({ database: databaseSnapshot({ user_table_count: 3, user_row_estimate: 12 }) }, async ({ origin }) => {
    const output = await inspectPlan(origin);
    assert.equal(output.blockers[0].code, 'EXISTING_PROJECT_NOT_CLEAN');
    assertNoSensitiveOutput({ stdout: JSON.stringify(output), stderr: '' }, origin);
  });
  await withManagementApi({ database: databaseSnapshot({ user_type_count: 1 }) }, async ({ origin }) => {
    const output = await inspectPlan(origin);
    assert.equal(output.observed.userTypeCount, 1);
    assert.equal(output.blockers[0].code, 'EXISTING_PROJECT_NOT_CLEAN');
    assertNoSensitiveOutput({ stdout: JSON.stringify(output), stderr: '' }, origin);
  });
});

test('hosted inventory retains extension and initial-privilege records outside unowned counters', async () => {
  const objects = [{
    object_kind: 'routine', namespace_name: 'auth',
    object_identity: 'auth.extension_routine() FUNCTION RETURNS void',
    owner_name: 'supabase_admin', definition_text: 'extension routine definition',
    provenance: 'extension',
  }];
  const grants = [{
    grant_kind: 'routine', namespace_name: 'auth',
    object_identity: 'auth.extension_routine() FUNCTION RETURNS void',
    grantor_name: 'supabase_admin', grantee_name: 'ROLE:authenticated',
    privilege: 'EXECUTE', is_grantable: false, inherit_option: null, set_option: null,
    provenance: 'initial_privilege',
  }];
  await withManagementApi({
    database: databaseSnapshot({
      provider_object_count: objects.length,
      provider_grant_count: grants.length,
      unowned_object_count: 0,
      unexpected_grant_count: 0,
    }),
    providerInventory: providerInventorySnapshot({ objects, grants }),
  }, async ({ origin }) => {
    const snapshot = await hostedInspector(origin).inspect();
    assert.equal(snapshot.providerInventory.objects[0].provenance, 'extension');
    assert.equal(snapshot.providerInventory.grants[0].provenance, 'initial_privilege');
    assert.equal(snapshot.state.unownedObjectCount, 0);
    assert.equal(snapshot.state.unexpectedGrantCount, 0);
  });
});

test('SQL version number is authoritative across real PostgreSQL and Supabase version vocabularies', async () => {
  await withManagementApi({
    controlDatabaseVersion: '17.6.1.166',
    database: databaseSnapshot({
      database_version: '17.9 (Debian 17.9-1.pgdg13+1)',
      database_version_num: '170009',
    }),
  }, async ({ origin }) => {
    assert.equal((await hostedInspector(origin).inspect()).project.databaseVersion, '17.9');
  });
  await withManagementApi({
    controlDatabaseVersion: '18.1.0.7',
    database: databaseSnapshot({
      database_version: '17.9 (Debian 17.9-1.pgdg13+1)',
      database_version_num: '170009',
    }),
  }, async ({ origin }) => {
    await assert.rejects(hostedInspector(origin).inspect(), error => error.code === 'PROVIDER_UNREADABLE');
  });
  for (const database of [
    databaseSnapshot({
      database_version: '17.8 (Debian 17.8-1.pgdg13+1)',
      database_version_num: '170009',
    }),
    databaseSnapshot({
      database_version: '17.9 (Debian 17.9-1.pgdg13+1)',
      database_version_num: 'not-a-version-number',
    }),
  ]) {
    await withManagementApi({ controlDatabaseVersion: '17.6.1.166', database }, async ({ origin }) => {
      await assert.rejects(hostedInspector(origin).inspect(), error => error.code === 'PROVIDER_UNREADABLE');
    });
  }
});

test('database policy fingerprint uses tagged stable role names instead of role OIDs', () => {
  const policyFingerprint = DATABASE_STATE_QUERY.slice(
    DATABASE_STATE_QUERY.indexOf('AS policy_fingerprint') - 900,
    DATABASE_STATE_QUERY.indexOf('AS policy_fingerprint'),
  );
  assert.match(policyFingerprint, /CASE WHEN role_oid = 0 THEN 'PUBLIC'/u);
  assert.match(policyFingerprint, /ELSE 'ROLE:' \|\| pg_catalog\.pg_get_userbyid\(role_oid\)/u);
  assert.doesNotMatch(policyFingerprint, /policy\.polroles::text/u);
});

test('initial-privilege types are excluded consistently from both filtered counters', () => {
  const hostedUnowned = DATABASE_STATE_QUERY.slice(
    DATABASE_STATE_QUERY.indexOf('unowned_object AS MATERIALIZED'),
    DATABASE_STATE_QUERY.indexOf('installation_unowned_object AS MATERIALIZED'),
  );
  const inventoryUnowned = PROVIDER_INVENTORY_QUERY.slice(
    PROVIDER_INVENTORY_QUERY.indexOf('unowned_object AS MATERIALIZED'),
    PROVIDER_INVENTORY_QUERY.indexOf('provider_object_candidate AS MATERIALIZED'),
  );
  for (const query of [hostedUnowned, inventoryUnowned]) {
    const typeBranch = query.slice(
      query.indexOf("SELECT 'type'"),
      query.indexOf("SELECT DISTINCT 'catalog"),
    );
    assert.match(typeBranch, /initial\.classoid = 'pg_catalog\.pg_type'::regclass/u);
    assert.match(typeBranch, /initial\.objoid = type_value\.oid/u);
    assert.match(typeBranch, /initial\.privtype IN \('i', 'e'\)/u);
  }
});

test('hosted inventory preserves provider-looking tables, routines, and types as exact untrusted candidates', async () => {
  const objects = [
    {
      object_kind: 'relation', namespace_name: 'extensions',
      object_identity: 'extensions.legacy_business TABLE', owner_name: 'postgres',
      definition_text: '{"relkind":"r"}', provenance: 'supabase_managed',
    },
    {
      object_kind: 'routine', namespace_name: 'auth',
      object_identity: 'auth.hidden() RETURNS void', owner_name: 'postgres',
      definition_text: 'CREATE FUNCTION auth.hidden() RETURNS void LANGUAGE sql AS $$ SELECT $$',
      provenance: 'supabase_managed',
    },
    {
      object_kind: 'type', namespace_name: 'storage',
      object_identity: 'storage.unverified_type', owner_name: 'postgres',
      definition_text: '{"typtype":"e"}', provenance: 'supabase_managed',
    },
  ];
  await withManagementApi({
    database: databaseSnapshot({
      unowned_object_count: objects.length,
      provider_object_count: objects.length,
    }),
    providerInventory: providerInventorySnapshot({ objects }),
  }, async ({ origin, requests }) => {
    const snapshot = await hostedInspector(origin).inspect();
    assert.equal(snapshot.providerInventory.objects.length, 3);
    assert.deepEqual(
      snapshot.providerInventory.objects.map(({ kind, schema, identity, provenance }) => (
        { kind, schema, identity, provenance }
      )).sort((left, right) => left.kind.localeCompare(right.kind)),
      [
        {
          kind: 'relation', schema: 'extensions', identity: 'extensions.legacy_business TABLE',
          provenance: 'supabase_managed',
        },
        {
          kind: 'routine', schema: 'auth', identity: 'auth.hidden() RETURNS void',
          provenance: 'supabase_managed',
        },
        {
          kind: 'type', schema: 'storage', identity: 'storage.unverified_type',
          provenance: 'supabase_managed',
        },
      ],
    );
    assert.ok(requests.every(({ body }) => !body.includes('AS row_value')));
    const output = await inspectPlan(origin);
    assert.equal(output.ready, false);
    assert.ok(output.blockers.some(({ code }) => code === 'EXISTING_PROJECT_NOT_CLEAN'));
    assert.doesNotMatch(JSON.stringify(output), /legacy_business|hidden|unverified_type/u);
  });
});

test('hosted inventory preserves default grants and role memberships as separate stable records', async () => {
  const grants = [
    {
      grant_kind: 'default', namespace_name: 'auth',
      object_identity: 'default privileges for role postgres in schema auth',
      grantor_name: 'postgres', grantee_name: 'ROLE:unrelated_reader_must_not_escape',
      privilege: 'SELECT', is_grantable: false, provenance: 'supabase_managed',
    },
    {
      grant_kind: 'role', namespace_name: '', object_identity: 'authenticator',
      grantor_name: 'postgres', grantee_name: 'ROLE:unrelated_member_must_not_escape',
      privilege: 'MEMBER', is_grantable: true, provenance: 'supabase_managed',
      inherit_option: false, set_option: true,
    },
  ];
  await withManagementApi({
    database: databaseSnapshot({
      unexpected_grant_count: grants.length,
      provider_grant_count: grants.length,
    }),
    providerInventory: providerInventorySnapshot({ grants }),
  }, async ({ origin }) => {
    const snapshot = await hostedInspector(origin).inspect();
    assert.equal(snapshot.providerInventory.grants.length, 2);
    assert.deepEqual(
      snapshot.providerInventory.grants.map(({ kind, objectIdentity, privilege, grantable }) => (
        { kind, objectIdentity, privilege, grantable }
      )).sort((left, right) => left.kind.localeCompare(right.kind)),
      [
        {
          kind: 'default', objectIdentity: 'default privileges for role postgres in schema auth',
          privilege: 'SELECT', grantable: false,
        },
        {
          kind: 'role', objectIdentity: 'authenticator', privilege: 'MEMBER', grantable: true,
        },
      ],
    );
    const output = await inspectPlan(origin);
    assert.equal(output.ready, false);
    assert.ok(output.blockers.some(({ code }) => code === 'EXISTING_PROJECT_NOT_CLEAN'));
    assert.doesNotMatch(JSON.stringify(output), /unrelated_(?:reader|member)_must_not_escape/u);
  });
});

test('hosted inventory rejects an opaque object in a non-system schema', async () => {
  const objectName = 'extensions.legacy_collation';
  await withManagementApi({
    database: databaseSnapshot({ unowned_object_count: 1, provider_object_count: 1 }),
    providerInventory: providerInventorySnapshot({
      objects: [{
        object_kind: 'catalog', namespace_name: 'extensions', object_identity: objectName,
        owner_name: '', definition_text: '{"provider":"i"}', provenance: 'supabase_managed',
      }],
    }),
  }, async ({ origin }) => {
    const output = await inspectPlan(origin);
    assert.equal(output.ready, false);
    assert.ok(output.blockers.some(({ code }) => code === 'EXISTING_PROJECT_NOT_CLEAN'));
    assert.equal(JSON.stringify(output).includes(objectName), false);
  });
});

test('hosted inventory accepts exact provider metadata and extension ownership evidence', async () => {
  await withManagementApi({
    database: databaseSnapshot({
      unowned_object_count: 0,
      unexpected_grant_count: 0,
      provider_inventory_evidence: {
        exactProviderObject: 'provider_object_must_not_escape',
        extensionObject: 'extension_object_must_not_escape',
      },
    }),
  }, async ({ origin }) => {
    const output = await inspectPlan(origin);
    assert.equal(output.ready, true);
    assert.doesNotMatch(JSON.stringify(output), /(?:provider|extension)_object_must_not_escape/u);
  });
});

test('hosted inventory rejects object and grant records that disagree with counted candidates', async () => {
  for (const providerInventory of [
    providerInventorySnapshot({ objects: [objectRowForInspector()] }),
    providerInventorySnapshot({ grants: [grantRowForInspector()] }),
  ]) {
    await withManagementApi({ providerInventory }, async ({ origin }) => {
      await assert.rejects(hostedInspector(origin).inspect(), error => error.code === 'PROVIDER_UNREADABLE');
    });
  }
});

test('hosted inventory fails closed when object or grant counts are malformed', async () => {
  for (const overrides of [
    { unowned_object_count: undefined },
    { unowned_object_count: '-1' },
    { unexpected_grant_count: '1.5' },
    { unexpected_grant_count: Number.MAX_SAFE_INTEGER + 1 },
    { installation_unowned_object_count: undefined },
    { installation_unowned_schema_count: '-1' },
    { installation_unexpected_grant_count: 'invalid' },
    { provider_object_count: undefined },
    { provider_grant_count: '-1' },
  ]) {
    await withManagementApi({
      database: databaseSnapshot(overrides),
    }, async ({ origin }) => {
      await assert.rejects(hostedInspector(origin).inspect(), error => error.code === 'PROVIDER_UNREADABLE');
    });
  }
});

test('observed storage identifiers and metadata remain internal to the redacted plan', async () => {
  const bucketId = 'provider-bucket-id-must-not-escape';
  await withManagementApi({
    database: databaseSnapshot({
      bucket_count: 1,
      bucket_inventory: [{
        id: bucketId,
        public: false,
        fileSizeLimit: null,
        allowedMimeTypes: ['audio/wav'],
      }],
    }),
  }, async ({ origin }) => {
    const output = await inspectPlan(origin);
    assert.ok(output.blockers.some(({ code }) => code === 'EXISTING_PROJECT_NOT_CLEAN'));
    assert.equal(JSON.stringify(output).includes(bucketId), false);
    assert.equal(JSON.stringify(output).includes('audio/wav'), false);
  });
});

test('observed bucket ownership digests reproduce the digest the installer recorded', async () => {
  const allowedMimeTypes = [
    'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/x-m4a', 'audio/x-wav',
  ];
  await withManagementApi({
    database: databaseSnapshot({
      bucket_count: 1,
      bucket_exists: true,
      bucket_public: false,
      bucket_inventory: [{
        id: 'ccc-audio',
        public: false,
        fileSizeLimit: '209715200',
        allowedMimeTypes: [...allowedMimeTypes].reverse(),
      }],
    }),
  }, async ({ origin }) => {
    const observation = await hostedInspector(origin).inspect();
    // apply의 storage_bucket 단계가 기록하는 digest와 같은 식이어야 doctor가 소유권을
    // 대조할 수 있다(provider-steps.mjs bucketDigest).
    assert.deepEqual(observation.state.buckets, [{
      resourceType: 'storage_bucket',
      resourceIdHash: createHash('sha256').update('ccc-audio', 'utf8').digest('hex'),
      resourceDigest: createHash('sha256').update([
        'ccc-audio', 'private', '209715200', allowedMimeTypes.join(','),
      ].join('\n'), 'utf8').digest('hex'),
    }]);
  });
});

test('inspector credential errors retain fixed codes without provider response text', async () => {
  await withManagementApi({}, async ({ origin }) => {
    await assert.rejects(inspectPlan(origin, ''), error => error.code === 'CREDENTIAL_MISSING');
  });
  for (const [status, code] of [[401, 'CREDENTIAL_INVALID'], [403, 'CREDENTIAL_INSUFFICIENT']]) {
    await withManagementApi({ status }, async ({ origin }) => {
      await assert.rejects(inspectPlan(origin), error => {
        assert.equal(error.code, code);
        assertNoSensitiveOutput({ stdout: '', stderr: error.message }, origin);
        return true;
      });
    });
  }
});

const installationId = 'synthetic-installation';

/**
 * Stands in for the promoted deployment: the runtime readiness route and the
 * StorageSigner Edge Function, on one loopback origin per lane.
 */
async function withDeployment({
  ready = { status: 200, body: { status: 'ready' } },
  signer = {
    status: 401,
    body: { code: 'UNAUTHORIZED' },
    installationId,
    region: 'ap-northeast-2',
  },
}, run) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ method: request.method, path: request.url, body });
    if (request.url === '/readyz') {
      response.writeHead(ready.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(ready.body));
      return;
    }
    if (request.url === '/functions/v1/ccc-storage-signer') {
      response.writeHead(signer.status, {
        'content-type': 'application/json',
        ...(signer.installationId === null
          ? {} : { 'x-ccc-installation-id': signer.installationId }),
        ...(signer.region === null ? {} : { 'x-sb-edge-region': signer.region }),
      });
      response.end(JSON.stringify(signer.body));
      return;
    }
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end('{}');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    await run({ origin: `http://127.0.0.1:${address.port}`, requests });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function health(origin, {
  role = { rolsuper: false, rolbypassrls: false },
  readRestrictedRole,
} = {}) {
  return createInstallationHealth({
    apiBase: `${origin}/api`,
    supabaseAuthOrigin: origin,
    installationId,
    readRestrictedRole: readRestrictedRole ?? (async () => role),
  });
}

test('health evidence comes only from the readiness route, the signer refusal and the restricted role', async () => {
  await withDeployment({}, async ({ origin, requests }) => {
    const evidence = await health(origin)({});
    assert.equal(evidence.healthy, true);
    assert.equal(evidence.installedHealthy, true);
    assert.equal(evidence.runtimeReady, true);
    assert.equal(evidence.storageSignerHealthy, true);
    assert.deepEqual(evidence.edgeRegionEvidence, {
      requestedRegion: 'ap-northeast-2',
      responseRegion: 'ap-northeast-2',
      functionRegion: 'ap-northeast-2',
      mismatch: false,
    });
    assert.deepEqual(evidence.restrictedDatabase, {
      connected: true,
      role: 'ccc_api',
      superuser: false,
      bypassRls: false,
    });
    assert.equal(evidence.stateFingerprint, null);
    assert.deepEqual(requests, [
      { method: 'GET', path: '/readyz', body: '' },
      { method: 'POST', path: '/functions/v1/ccc-storage-signer', body: '' },
    ]);
    assertNoSensitiveOutput({ stdout: JSON.stringify(evidence), stderr: '' }, origin);
  });
});

test('a signer answering for another installation is never read as healthy', async () => {
  await withDeployment({
    signer: {
      status: 401,
      body: { code: 'UNAUTHORIZED' },
      installationId: 'other-installation',
      region: 'ap-northeast-2',
    },
  }, async ({ origin }) => {
    const evidence = await health(origin)({});
    assert.equal(evidence.storageSignerHealthy, false);
    assert.equal(evidence.healthy, false);
  });
});

test('each absent health dimension fails closed without inventing evidence', async t => {
  const cases = [
    ['signer identity header absent', {
      signer: { status: 401, body: { code: 'UNAUTHORIZED' }, installationId: null, region: 'ap-northeast-2' },
    }, {}, evidence => assert.equal(evidence.storageSignerHealthy, false)],
    ['signer accepts an unauthenticated call', {
      signer: { status: 200, body: { url: 'https://must-not-escape.test' }, installationId, region: 'ap-northeast-2' },
    }, {}, evidence => assert.equal(evidence.storageSignerHealthy, false)],
    ['signer failure code is not the refusal contract', {
      signer: { status: 401, body: { code: 'INSTALLATION_UNAVAILABLE' }, installationId, region: 'ap-northeast-2' },
    }, {}, evidence => assert.equal(evidence.storageSignerHealthy, false)],
    ['edge region absent', {
      signer: { status: 401, body: { code: 'UNAUTHORIZED' }, installationId, region: null },
    }, {}, evidence => assert.deepEqual(evidence.edgeRegionEvidence, {
      requestedRegion: 'ap-northeast-2',
      responseRegion: 'not_run',
      functionRegion: 'not_run',
      mismatch: true,
    })],
    ['edge region outside Seoul', {
      signer: { status: 401, body: { code: 'UNAUTHORIZED' }, installationId, region: 'us-east-1' },
    }, {}, evidence => assert.equal(evidence.edgeRegionEvidence.mismatch, true)],
    // 설치 증거는 그대로 서 있고 runtime 기동만 아직 없는 경우다.
    ['runtime not ready', { ready: { status: 503, body: { status: 'unavailable' } } }, {},
      evidence => {
        assert.equal(evidence.runtimeReady, false);
        assert.equal(evidence.installedHealthy, true);
        assert.equal(evidence.restrictedDatabase.connected, true);
      }],
    ['restricted role unreadable', {}, {
      readRestrictedRole: async () => { throw new Error('unreadable'); },
    }, evidence => assert.deepEqual(evidence.restrictedDatabase, {
      connected: false, role: null, superuser: true, bypassRls: true,
    })],
    ['runtime role is a superuser', {}, { role: { rolsuper: true, rolbypassrls: false } },
      evidence => assert.equal(evidence.restrictedDatabase.superuser, true)],
    ['runtime role bypasses RLS', {}, { role: { rolsuper: false, rolbypassrls: true } },
      evidence => assert.equal(evidence.restrictedDatabase.bypassRls, true)],
  ];
  for (const [name, deployment, options, check] of cases) {
    await t.test(name, async () => {
      await withDeployment(deployment, async ({ origin }) => {
        const evidence = await health(origin, options)({});
        assert.equal(evidence.healthy, false);
        check(evidence);
        assertNoSensitiveOutput({ stdout: JSON.stringify(evidence), stderr: '' }, origin);
      });
    });
  }
});

test('health reads the restricted role from the installer session it is given', async () => {
  await withDeployment({}, async ({ origin }) => {
    const queries = [];
    const session = {
      unsafe: async query => {
        queries.push(query);
        return [{ rolsuper: false, rolbypassrls: false }];
      },
    };
    const evidence = await createInstallationHealth({
      apiBase: `${origin}/api`,
      supabaseAuthOrigin: origin,
      installationId,
    })({ session });
    assert.equal(evidence.healthy, true);
    assert.deepEqual(queries, [RESTRICTED_ROLE_QUERY]);
    assert.match(queries[0], /^SELECT rolsuper, rolbypassrls FROM pg_catalog\.pg_roles/u);
  });
});

test('doctor reports the same health read-only and blocks on its failure', async () => {
  await withManagementApi({}, async ({ origin: managementOrigin }) => {
    await withDeployment({
      signer: {
        status: 401,
        body: { code: 'UNAUTHORIZED' },
        installationId: 'other-installation',
        region: 'ap-northeast-2',
      },
    }, async ({ origin }) => {
      const doctor = await buildSupabaseDoctor({
        target: 'hosted',
        inspector: hostedInspector(managementOrigin),
        authorization: observationAuthorization(),
        providerBaseline: verifiedProviderBaseline(),
        health: health(origin),
      });
      assert.equal(doctor.readOnly, true);
      assert.equal(doctor.health.installedHealthy, false);
      assert.equal(doctor.health.runtimeReady, true);
      assert.equal(doctor.health.storageSignerHealthy, false);
      assert.ok(doctor.blockers.some(({ code }) => code === 'HEALTH_FAILED'));
      assertNoSensitiveOutput({ stdout: JSON.stringify(doctor), stderr: '' }, origin);
    });
  });
});

// 고정 원본을 흉내 내는 서명된 묶음이다. doctor는 이 index만 받고 trust store는 받지 않는다.
function pinnedOriginFixture({ sequence = '7', version = '0.9.0-dev.1' } = {}) {
  const rootKeys = generateKeyPairSync('ed25519');
  const trustDocument = JSON.stringify({ keys: [{
    keyId: 'root-key-doctor',
    publicKey: rootKeys.publicKey.export({ format: 'jwk' }).x,
    role: 'root',
    status: 'active',
    notBefore: '2026-09-01T00:00:00.000Z',
    notAfter: '2026-10-01T00:00:00.000Z',
  }] });
  const contractsSha256 = 'e'.repeat(64);
  const unsigned = {
    schemaVersion: 1,
    bundleId: 'bundle-dev-7',
    version,
    sequence,
    channel: 'dev',
    publishedAt: '2026-09-11T00:00:00.000Z',
    expiresAt: '2026-09-20T00:00:00.000Z',
    protocol: {
      apiName: 'ccc-http-api',
      apiVersion: '1.0.0',
      contractsSha256,
      peers: ['cloud-cli', 'edge'].map(name => ({
        name, protocolVersion: '1.0.0', contractsSha256,
      })),
    },
    entries: [{
      family: 'community-cloud-cli',
      artifacts: [{
        manifestUrl: `${PINNED_RELEASE_ORIGIN}/manifests/community-cloud-cli.json`,
        manifestSha256: 'a'.repeat(64),
        edgeComponentManifestSha256: 'b'.repeat(64),
        mode: 'community-cloud',
        platform: 'macos',
        arch: 'arm64',
        artifactSha256: 'c'.repeat(64),
        artifactBytes: 1234,
        minSchemaVersion: 0,
        maxSchemaVersion: 0,
      }],
    }],
    sequenceFloor: [{
      family: 'community-cloud-cli',
      mode: 'community-cloud',
      platform: 'macos',
      arch: 'arm64',
      minimumSequence: sequence,
    }],
    modelManifestSha256: '0'.repeat(64),
  };
  const document = JSON.stringify({
    ...unsigned,
    offlineRootSignature: sign(null, Buffer.concat([
      Buffer.from('CCC-RELEASE-BUNDLE-V1\0', 'ascii'),
      Buffer.from(canonicalizeJcs(unsigned), 'utf8'),
    ]), rootKeys.privateKey).toString('base64url'),
  });
  const requested = [];
  let stored = null;
  return {
    trustDocument,
    requested,
    options: {
      now: new Date('2026-09-11T12:00:01.000Z'),
      fetchImpl: async url => {
        requested.push(url);
        return {
          url,
          ok: true,
          headers: new Headers({ date: 'Fri, 11 Sep 2026 12:00:00 GMT' }),
          text: async () => document,
        };
      },
      floorStore: {
        read: async () => structuredClone(stored),
        updateVerified: async ({ sequenceFloor, trustedTime }) => {
          stored = { schemaVersion: 1, sequenceFloor, lastTrustedTime: trustedTime };
          return structuredClone(stored);
        },
      },
    },
  };
}

test('doctor reads the pinned release index only with an injected trust store and never exposes it', async () => {
  const previous = process.env.CCC_RELEASE_TRUST_STORE;
  const fixture = pinnedOriginFixture();
  try {
    // ① trust store가 없으면 고정 원본을 부르지도 않는다.
    delete process.env.CCC_RELEASE_TRUST_STORE;
    assert.equal(await loadReleaseIndexForDoctor(fixture.options), undefined);
    assert.deepEqual(fixture.requested, []);

    // ② trust store가 있으면 서명된 묶음과 색인된 행만 돌려준다.
    process.env.CCC_RELEASE_TRUST_STORE = fixture.trustDocument;
    const index = await loadReleaseIndexForDoctor(fixture.options);
    assert.deepEqual(fixture.requested, [
      `${PINNED_RELEASE_ORIGIN}/.well-known/ccc/release-bundle.json`,
    ]);
    assert.deepEqual(Object.keys(index).sort(), ['bundle', 'rows']);
    assert.equal(index.bundle.bundleId, 'bundle-dev-7');
    assert.equal(index.bundle.sequence, '7');
    assert.deepEqual(index.rows.map(row => row.family), ['community-cloud-cli']);
    assert.equal(index.rows[0].manifestSha256, 'a'.repeat(64));
    assert.equal(index.rows[0].edgeComponentManifestSha256, 'b'.repeat(64));
    const rendered = JSON.stringify(index);
    assert.equal(rendered.includes(JSON.parse(fixture.trustDocument).keys[0].publicKey), false);
    assert.doesNotMatch(rendered, /trustStore|publicKey|privateKey/u);

    // ③ 원본을 읽지 못하면 doctor는 실패하지 않고 릴리스 차단 사유를 그대로 남긴다.
    assert.equal(await loadReleaseIndexForDoctor({
      ...fixture.options,
      fetchImpl: async () => { throw new Error('offline'); },
    }), undefined);
  } finally {
    if (previous === undefined) delete process.env.CCC_RELEASE_TRUST_STORE;
    else process.env.CCC_RELEASE_TRUST_STORE = previous;
  }
});
