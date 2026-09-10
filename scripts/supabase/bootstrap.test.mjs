import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createHostedInspector } from './hosted-inspector.mjs';
import { buildSupabasePlan } from './plan.mjs';

const repoRoot = resolve(import.meta.dirname, '../..');
const cliPath = resolve(import.meta.dirname, 'bootstrap.mjs');
const fetchShim = pathToFileURL(resolve(import.meta.dirname, 'bootstrap-fetch-shim.test.mjs')).href;
const accessToken = 'sbp_black_box_secret_1234567890';

function databaseSnapshot(overrides = {}) {
  return {
    schema_fingerprint: 'schema-empty',
    policy_fingerprint: 'policy-empty',
    bucket_fingerprint: 'bucket-empty',
    user_table_names: [],
    user_table_count: 0,
    user_row_estimate: 0,
    rls_enabled_table_count: 0,
    policy_count: 0,
    bucket_exists: false,
    bucket_public: null,
    ledger_exists: false,
    database_version: '17.4',
    read_only: true,
    database_readable: true,
    ...overrides,
  };
}

async function withManagementApi({
  region = 'ap-northeast-2',
  status = 200,
  database = databaseSnapshot(),
  mutateAuth = false,
  mutateData = false,
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
        database: { host: 'db.test.invalid', version: '17.4', postgres_engine: '17', release_channel: 'ga' },
      }));
      return;
    }
    if (request.url === '/v1/projects/test-project/config/auth') {
      authReadCount += 1;
      response.end(JSON.stringify({
        disable_signup: true,
        external_email_enabled: true,
        jwt_exp: 3600,
        mailer_autoconfirm: false,
        mfa_max_enrolled_factors: 10,
        mfa_totp_enroll_enabled: true,
        mfa_totp_verify_enabled: true,
        refresh_token_rotation_enabled: true,
        security_captcha_enabled: true,
        sessions_single_per_user: false,
        site_url: mutateAuth && authReadCount > 1 ? 'https://changed-must-not-escape.test' : 'https://must-not-escape.test',
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

async function runCli(origin, { token = accessToken, leadingSeparator = false, managementOrigin, operation = 'plan', installManifest } = {}) {
  const args = [cliPath, ...(leadingSeparator ? ['--'] : []), operation, '--target', 'hosted', '--project-ref', 'test-project', '--format', 'json'];
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
  if (managementOrigin !== undefined) childEnv.CCC_SUPABASE_MANAGEMENT_ORIGIN = managementOrigin;
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
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

// The observation engine is tested independently of the public CLI trust gate.
// No test invents an approved S11 owner envelope or bypass flag for production.
async function inspectPlan(origin, token = accessToken) {
  const inspector = createHostedInspector({
    accessToken: token, projectRef: 'test-project',
    fetchImpl: (url, options) => {
      assert.equal(new URL(url).origin, 'https://api.supabase.com');
      return fetch(new URL(new URL(url).pathname, origin), options);
    },
  });
  return buildSupabasePlan({ target: 'hosted', inspector });
}

test('hosted observation uses only read endpoints without claiming signed ownership', async () => {
  await withManagementApi({}, async ({ origin, requests }) => {
    const output = await inspectPlan(origin);
    assert.equal(output.ready, false);
    assert.equal(output.readOnly, true);
    assert.equal(output.unchanged, true);
    assert.ok(output.blockers.some(({ code }) => code === 'OWNER_EVIDENCE_MISSING'));
    assertNoSensitiveOutput({ stdout: JSON.stringify(output), stderr: '' }, origin);
    assert.ok(requests.length >= 6);
    assert.ok(requests.every(({ method, path }) => method === 'GET' || (method === 'POST' && path.endsWith('/database/query/read-only'))));
    assert.ok(requests.filter(({ path }) => path.endsWith('/database/query/read-only')).every(({ body }) => JSON.parse(body).query.trimStart().startsWith('SELECT')));
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

test('mutation and receipt commands remain explicitly blocked until owner and journal contracts align', async () => {
  await withManagementApi({}, async ({ origin, requests }) => {
    for (const operation of ['apply', 'doctor', 'rollback']) {
      const result = await runCli(origin, { operation });
      assert.equal(result.exitCode, 6);
      assert.equal(JSON.parse(result.stderr).error.code, 'INSTALLER_CONTRACT_UNRESOLVED');
      assertNoSensitiveOutput(result, origin);
    }
    assert.equal(requests.length, 0);
  });
});

test('read-only observations detect both Auth drift and institution data changing between reads', async () => {
  for (const configuration of [
    { mutateAuth: true },
    { database: databaseSnapshot({ user_table_names: ['participants'], user_table_count: 1, user_row_estimate: 1 }), mutateData: true },
  ]) {
    await withManagementApi(configuration, async ({ origin }) => {
      const output = await inspectPlan(origin);
      assert.equal(output.unchanged, false);
      assert.ok(output.blockers.some(({ code }) => code === 'STATE_CHANGED_DURING_PLAN'));
      assertNoSensitiveOutput({ stdout: JSON.stringify(output), stderr: '' }, origin);
    });
  }
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
