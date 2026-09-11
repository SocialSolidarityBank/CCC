import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { applyProviderSteps } from './provider-steps.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const installationId = 'installation-fixture-0001';
const tag = `ccc.installation_id=${installationId}`;
const schedulerSecret = 'scheduler-secret-must-not-escape';
const serviceRoleKey = 'service-role-key-must-not-escape';
const installManifestJson = '{"installationId":"installation-fixture-0001"}';
const signingKeysJson = '{"keys":[{"keyId":"install-key","publicKey":"cHVibGlj"}]}';
const signerBytes = new TextEncoder().encode('export default () => new Response("ok");\n');
const stagedFunction = Object.freeze({
  path: 'functions/ccc-storage-signer/index.js',
  bytes: signerBytes,
  sha256: sha256(signerBytes),
});
const apiBase = 'https://api.must-not-escape.test';
const apiBaseWithPrefix = 'https://api.must-not-escape.test/api';
const supabaseOrigin = 'https://project.must-not-escape.test';
const hashes = Object.freeze({
  institution: '1'.repeat(64),
  project: '2'.repeat(64),
  owner: '3'.repeat(64),
  manifest: '4'.repeat(64),
  approval: '5'.repeat(64),
  configuration: '6'.repeat(64),
  resources: '7'.repeat(64),
  migrations: '8'.repeat(64),
  plan: '9'.repeat(64),
});
const expiresAt = new Date(Date.now() + 600_000).toISOString();

function authorization() {
  return {
    installationId,
    institutionIdHash: hashes.institution,
    projectRefHash: hashes.project,
    expectedOwnerOrgIdHash: hashes.owner,
    runtimeManifestSha256: hashes.manifest,
    approvalSha256: hashes.approval,
    runtimeConfigurationSha256: hashes.configuration,
    contractVersion: 'S11-install-approval-v1',
    runtimeSequence: 1,
    expiresAt,
  };
}

function journalRow() {
  return {
    installation_id: installationId,
    institution_id_hash: hashes.institution,
    project_ref_hash: hashes.project,
    expected_owner_org_id_hash: hashes.owner,
    runtime_manifest_sha256: hashes.manifest,
    approval_sha256: hashes.approval,
    runtime_configuration_sha256: hashes.configuration,
    contract_version: 'S11-install-approval-v1',
    runtime_sequence: 1,
    expires_at: expiresAt,
    resources_sha256: hashes.resources,
    migrations_sha256: hashes.migrations,
    plan_fingerprint: hashes.plan,
    phase: 'installing',
  };
}

const desiredBucket = Object.freeze({
  public: false,
  file_size_limit: '209715200',
  allowed_mime_types: ['audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/x-m4a', 'audio/x-wav'],
});

/**
 * 설치 연결 SQL의 기록 seam. 실제 Postgres 없이 journal 원시 연산과 provider 문장을 그대로 받고,
 * 무엇이 SQL 문자열로 갔고 무엇이 바인딩으로 갔는지 남긴다.
 */
function fakeSession(options = {}) {
  const state = {
    bucket: options.bucket ?? null,
    cronJob: options.cronJob ?? null,
    vaultSecret: options.vaultSecret ?? null,
    vaultWrites: [],
    extensions: { cron: true, net: true, vault: true, storage: true, ...(options.extensions ?? {}) },
    steps: new Map(),
    resources: new Map(),
  };
  const log = [];

  async function unsafe(sql, params = []) {
    log.push({ sql, params });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return [];
    if (sql.includes('FROM private.ccc_install_journal')) return [journalRow()];
    if (sql.startsWith('UPDATE private.ccc_install_journal')) return [];
    if (sql.startsWith('SELECT provider_resource_id_hashes')) {
      const row = state.steps.get(params[1]);
      if (row === undefined || row.idempotencyKey !== params[2] || row.status !== 'completed') return [];
      return [{
        provider_resource_id_hashes: row.providerResourceIdHashes,
        provider_resource_digests: row.providerResourceDigests,
      }];
    }
    if (sql.startsWith('SELECT idempotency_key, status')) {
      const row = state.steps.get(params[1]);
      return row === undefined ? [] : [{ idempotency_key: row.idempotencyKey, status: row.status }];
    }
    if (sql.startsWith('SELECT status, ownership_tags')) {
      const row = state.steps.get(params[1]);
      if (row === undefined || row.idempotencyKey !== params[2]) return [];
      return [{
        status: row.status,
        ownership_tags: row.ownershipTags,
        provider_resource_id_hashes: row.providerResourceIdHashes,
        provider_resource_digests: row.providerResourceDigests,
        state_fingerprint: row.stateFingerprint,
      }];
    }
    if (sql.startsWith('INSERT INTO private.ccc_install_steps')) {
      state.steps.set(params[1], {
        idempotencyKey: params[2],
        status: 'started',
        ownershipTags: null,
        providerResourceIdHashes: null,
        providerResourceDigests: null,
        stateFingerprint: null,
      });
      return [];
    }
    if (sql.startsWith('UPDATE private.ccc_install_steps')) {
      state.steps.set(params[1], {
        idempotencyKey: params[2],
        status: 'completed',
        ownershipTags: params[3],
        providerResourceIdHashes: params[4],
        providerResourceDigests: params[5],
        stateFingerprint: params[6],
      });
      return [];
    }
    if (sql.includes('FROM private.ccc_install_resources')) {
      const row = state.resources.get(`${params[1]}:${params[2]}`);
      return row === undefined ? [] : [{ resource_digest: row.digest, ownership_tag: row.tag }];
    }
    if (sql.startsWith('INSERT INTO private.ccc_install_resources')) {
      state.resources.set(`${params[1]}:${params[2]}`, { digest: params[3], tag: params[4] });
      return [];
    }
    if (sql.includes('cron_ready')) {
      return [{
        cron_ready: state.extensions.cron,
        net_ready: state.extensions.net,
        vault_ready: state.extensions.vault,
        storage_ready: state.extensions.storage,
      }];
    }
    if (sql.includes('FROM storage.buckets')) return state.bucket === null ? [] : [state.bucket];
    if (sql.startsWith('INSERT INTO storage.buckets')) {
      state.bucket = {
        public: false,
        file_size_limit: String(params[1]),
        allowed_mime_types: [...params[2]],
      };
      return [];
    }
    if (sql.includes('FROM vault.secrets')) {
      return state.vaultSecret === null ? [] : [{ id: state.vaultSecret.id }];
    }
    if (sql.includes('vault.create_secret')) {
      state.vaultSecret = { id: '00000000-0000-4000-8000-000000000001', value: params[0] };
      state.vaultWrites.push({ kind: 'create', params });
      return [{ id: state.vaultSecret.id }];
    }
    if (sql.includes('vault.update_secret')) {
      state.vaultSecret = { id: params[0], value: params[1] };
      state.vaultWrites.push({ kind: 'update', params });
      return [{ updated: state.vaultSecret.id }];
    }
    if (sql.includes('FROM cron.job')) return state.cronJob === null ? [] : [state.cronJob];
    if (sql.includes('cron.schedule(')) {
      state.cronJob = { jobid: '1', schedule: params[1], command: params[2] };
      return [{ jobid: '1' }];
    }
    throw new Error(`unexpected statement: ${sql}`);
  }

  return { state, log, unsafe, release: async () => {} };
}

function fakeManagement(options = {}) {
  const requests = [];
  const deployPayload = {
    id: 'signer-function-id',
    slug: 'ccc-storage-signer',
    name: 'ccc-storage-signer',
    status: 'ACTIVE',
    version: 1,
    verify_jwt: false,
    import_map: false,
    entrypoint_path: 'index.js',
    ...(options.deployPayload ?? {}),
  };
  const management = {
    accessToken: 'sbp_test_access_token',
    async fetch(url, init) {
      const request = new Request(url, init);
      const body = Buffer.from(await request.arrayBuffer());
      requests.push({
        url,
        method: request.method,
        authorization: request.headers.get('authorization'),
        contentType: request.headers.get('content-type') ?? '',
        body,
      });
      if (url.includes('/secrets')) {
        return new Response(null, { status: options.secretsStatus ?? 201 });
      }
      if (url.includes('/functions/deploy')) {
        return new Response(JSON.stringify(deployPayload), {
          status: options.deployStatus ?? 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/functions/ccc-storage-signer')) {
        if (options.installedFunction === undefined) return new Response(null, { status: 404 });
        return new Response(JSON.stringify({ ...deployPayload, ...options.installedFunction }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(null, { status: 404 });
    },
  };
  return { management, requests, deployPayload };
}

function input({ session, management, secrets = {}, staged = stagedFunction, bases = {} }) {
  return {
    session,
    authorization: authorization(),
    management,
    apiBase,
    supabaseOrigin,
    ...bases,
    projectRef: 'test-project',
    installationId,
    stagedFunction: staged,
    secrets: {
      schedulerSecret, serviceRoleKey, installManifestJson, signingKeysJson, ...secrets,
    },
    authorize: async () => authorization(),
    now: new Date(),
  };
}

/** 파트별 헤더까지 돌려준다 — metadata 가 파일 파트로 새지 않는지가 계약이다. */
function multipart(request) {
  const text = request.body.toString('utf8');
  const boundary = /boundary=(.+)$/u.exec(request.contentType)[1];
  const parts = text.split(`--${boundary}`).slice(1, -1).map(chunk => {
    const [headers, ...body] = chunk.replace(/^\r\n/u, '').split('\r\n\r\n');
    return { headers, body: body.join('\r\n\r\n').replace(/\r\n$/u, '') };
  });
  const part = name => parts.find(entry => entry.headers.includes(`name="${name}"`));
  return { text, part, metadata: JSON.parse(part('metadata').body) };
}

function assertNoSecretValues(session, requests) {
  for (const entry of session.log) {
    assert.equal(entry.sql.includes(schedulerSecret), false, entry.sql);
    assert.equal(entry.sql.includes(serviceRoleKey), false, entry.sql);
    assert.equal(JSON.stringify(entry.params).includes(serviceRoleKey), false, entry.sql);
  }
  for (const request of requests) {
    const body = request.body.toString('utf8');
    assert.equal(body.includes(schedulerSecret), false, request.url);
    assert.equal(body.includes(serviceRoleKey), false, request.url);
    assert.equal(request.url.includes(schedulerSecret), false);
  }
}

test('the cron command carries the signed route prefix and only an exact https base is accepted', async () => {
  const session = fakeSession();
  await applyProviderSteps(input({
    session,
    management: fakeManagement().management,
    bases: { apiBase: apiBaseWithPrefix, supabaseOrigin },
  }));
  assert.match(
    session.state.cronJob.command,
    /url := 'https:\/\/api\.must-not-escape\.test\/api\/internal\/scheduler\/run'/u,
  );

  for (const bases of [
    { apiBase: 'http://api.must-not-escape.test' },
    { apiBase: 'https://api.must-not-escape.test/api/' },
    { apiBase: "https://api.must-not-escape.test/a'--" },
    { apiBase: 'https://api.must-not-escape.test/api?x=1' },
    { apiBase: 'https://user:pass@api.must-not-escape.test' },
    { supabaseOrigin: 'https://project.must-not-escape.test/functions' },
  ]) {
    const refused = fakeSession();
    await assert.rejects(
      applyProviderSteps(input({
        session: refused, management: fakeManagement().management, bases,
      })),
      error => error.code === 'PROVIDER_UNREADABLE',
    );
    assert.deepEqual(refused.log, []);
  }
});

test('runs bucket, cron and edge steps once and records only hashes', async () => {
  const session = fakeSession();
  const api = fakeManagement();
  const result = await applyProviderSteps(input({ session, management: api.management }));

  assert.deepEqual(result.steps.map(step => step.step), [
    'storage_bucket', 'cron_job', 'edge_secret_binding',
  ]);
  assert.deepEqual(session.state.bucket, {
    public: false,
    file_size_limit: '209715200',
    allowed_mime_types: desiredBucket.allowed_mime_types,
  });
  assert.equal(session.state.cronJob.schedule, '* * * * *');
  assert.match(session.state.cronJob.command, /vault\.decrypted_secrets where name = 'ccc_scheduler_secret'/u);
  assert.match(session.state.cronJob.command, /'x-region', 'ap-northeast-2'/u);
  assert.match(session.state.cronJob.command, /https:\/\/api\.must-not-escape\.test\/internal\/scheduler\/run/u);

  // 값은 SQL 문자열이 아니라 바인딩으로만 간다.
  assert.deepEqual(session.state.vaultWrites.map(write => write.kind), ['create']);
  assert.deepEqual(session.state.vaultWrites[0].params, [schedulerSecret, 'ccc_scheduler_secret']);
  assertNoSecretValues(session, api.requests);

  // journal에는 hash, 소유 태그, state fingerprint만 남는다.
  for (const step of result.steps) {
    const row = session.state.steps.get(step.step);
    assert.equal(row.status, 'completed');
    assert.deepEqual(row.ownershipTags, [tag]);
    assert.deepEqual(row.providerResourceIdHashes, step.resourceIdHashes);
    assert.match(row.stateFingerprint, /^[0-9a-f]{64}$/u);
    for (const value of [...step.resourceIdHashes, ...step.resourceDigests]) {
      assert.match(value, /^[0-9a-f]{64}$/u);
    }
  }
  assert.deepEqual([...session.state.resources.keys()].sort(), [
    `cron_job:${sha256('ccc_scheduler_tick')}`,
    `edge_function:${sha256('signer-function-id')}`,
    `edge_secret_binding:${sha256('CCC_INSTALL_MANIFEST,CCC_INSTALL_SIGNING_KEYS')}`,
    `storage_bucket:${sha256('ccc-audio')}`,
  ]);
  for (const resource of session.state.resources.values()) assert.equal(resource.tag, tag);

  // 재실행은 완료 step을 관찰만 하고 어떤 provider 쓰기도 하지 않는다.
  const observed = fakeManagement({ installedFunction: { id: 'signer-function-id' } });
  const before = session.log.length;
  const again = await applyProviderSteps(input({ session, management: observed.management }));
  assert.deepEqual(again, result);
  assert.deepEqual(observed.requests.map(request => request.method), ['GET']);
  assert.deepEqual(
    session.log.slice(before).filter(entry => /^(INSERT|UPDATE)/u.test(entry.sql)
      || entry.sql.includes('cron.schedule(') || entry.sql.includes('vault.')),
    [],
  );
});

test('deploys the staged signer as multipart with verify_jwt false', async () => {
  const session = fakeSession();
  const api = fakeManagement();
  await applyProviderSteps(input({ session, management: api.management }));

  const secretsRequest = api.requests.find(request => request.url.includes('/secrets'));
  assert.equal(secretsRequest.url, 'https://api.supabase.com/v1/projects/test-project/secrets');
  assert.equal(secretsRequest.method, 'POST');
  assert.equal(secretsRequest.authorization, 'Bearer sbp_test_access_token');
  assert.deepEqual(JSON.parse(secretsRequest.body.toString('utf8')), [
    { name: 'CCC_INSTALL_MANIFEST', value: installManifestJson },
    { name: 'CCC_INSTALL_SIGNING_KEYS', value: signingKeysJson },
  ]);

  const deployRequest = api.requests.find(request => request.url.includes('/functions/deploy'));
  assert.equal(
    deployRequest.url,
    'https://api.supabase.com/v1/projects/test-project/functions/deploy?slug=ccc-storage-signer',
  );
  assert.match(deployRequest.contentType, /^multipart\/form-data; boundary=/u);
  const { text, part, metadata } = multipart(deployRequest);
  assert.deepEqual(metadata, {
    entrypoint_path: 'index.js',
    name: 'ccc-storage-signer',
    verify_jwt: false,
  });
  // metadata 는 filename 도 content-type 도 없는 평문 필드여야 한다(파일 파트로 분류되면
  // Management API 가 객체 필드를 못 읽고 배포를 거절한다).
  assert.equal(part('metadata').headers, 'Content-Disposition: form-data; name="metadata"');
  assert.match(text, /name="file"; filename="index\.js"/u);
  assert.ok(deployRequest.body.includes(Buffer.from(signerBytes)));
});

test('a bucket that predates our ownership record stops the install', async () => {
  const session = fakeSession({ bucket: { ...desiredBucket } });
  const api = fakeManagement();
  await assert.rejects(
    applyProviderSteps(input({ session, management: api.management })),
    error => error.code === 'RESOURCE_OWNERSHIP_MISMATCH',
  );
  assert.equal(session.state.cronJob, null);
  assert.equal(session.state.vaultSecret, null);
  assert.deepEqual(api.requests, []);
  assert.equal(session.state.steps.get('storage_bucket').status, 'started');
});

test('a public or wrongly limited bucket stops the install', async () => {
  for (const bucket of [
    { ...desiredBucket, public: true },
    { ...desiredBucket, file_size_limit: '1048576' },
    { ...desiredBucket, allowed_mime_types: ['audio/wav'] },
  ]) {
    const session = fakeSession({ bucket });
    session.state.resources.set(`storage_bucket:${sha256('ccc-audio')}`, {
      digest: sha256(['ccc-audio', 'private', '209715200', desiredBucket.allowed_mime_types.join(',')].join('\n')),
      tag,
    });
    await assert.rejects(
      applyProviderSteps(input({ session, management: fakeManagement().management })),
      error => error.code === 'RESOURCE_OWNERSHIP_MISMATCH',
    );
  }
});

test('an existing cron job with another command hash stops the install', async () => {
  const session = fakeSession({
    cronJob: { jobid: '9', schedule: '* * * * *', command: 'select net.http_post(url := \'https://elsewhere.test\');' },
  });
  await assert.rejects(
    applyProviderSteps(input({ session, management: fakeManagement().management })),
    error => error.code === 'RESOURCE_OWNERSHIP_MISMATCH',
  );
  assert.equal(session.state.cronJob.jobid, '9');
});

test('an existing vault secret is rebound by id without leaking the value', async () => {
  const session = fakeSession({ vaultSecret: { id: '00000000-0000-4000-8000-0000000000ff', value: 'previous' } });
  const api = fakeManagement();
  await applyProviderSteps(input({ session, management: api.management }));
  assert.deepEqual(session.state.vaultWrites.map(write => write.kind), ['update']);
  assert.deepEqual(session.state.vaultWrites[0].params, [
    '00000000-0000-4000-8000-0000000000ff', schedulerSecret,
  ]);
  assertNoSecretValues(session, api.requests);
});

test('missing pg_cron, pg_net, Vault or Storage stops before any write', async () => {
  for (const extensions of [{ cron: false }, { net: false }, { vault: false }, { storage: false }]) {
    const session = fakeSession({ extensions });
    const api = fakeManagement();
    await assert.rejects(
      applyProviderSteps(input({ session, management: api.management })),
      error => error.code === 'PROVIDER_UNREADABLE',
    );
    assert.deepEqual(session.log.filter(entry => /^(INSERT|UPDATE)/u.test(entry.sql)), []);
    assert.deepEqual(api.requests, []);
  }
});

test('a staged signer over the 20 MB edge bundle limit never reaches the provider', async () => {
  const bytes = new Uint8Array(20 * 1024 * 1024 + 1);
  const session = fakeSession();
  const api = fakeManagement();
  await assert.rejects(
    applyProviderSteps(input({
      session,
      management: api.management,
      staged: { path: stagedFunction.path, bytes, sha256: sha256(bytes) },
    })),
    error => error.code === 'EDGE_BUNDLE_LIMIT',
  );
  assert.deepEqual(session.log, []);
  assert.deepEqual(api.requests, []);
});

test('staged bytes that do not match the manifest hash or path are refused', async () => {
  for (const staged of [
    { path: stagedFunction.path, bytes: signerBytes, sha256: '0'.repeat(64) },
    { path: 'functions/other/index.js', bytes: signerBytes, sha256: stagedFunction.sha256 },
    { path: stagedFunction.path, bytes: new Uint8Array(0), sha256: sha256(new Uint8Array(0)) },
  ]) {
    const session = fakeSession();
    await assert.rejects(
      applyProviderSteps(input({ session, management: fakeManagement().management, staged })),
      error => error.code === 'EDGE_COMPONENT_DEPLOYER_UNAVAILABLE',
    );
    assert.deepEqual(session.log, []);
  }
});

test('a deploy response that does not prove an active verify_jwt false function is refused', async () => {
  for (const deployPayload of [
    { verify_jwt: true },
    { status: 'THROTTLED' },
    { import_map: true },
    { id: '' },
    { version: 0 },
    { slug: 'other-function' },
  ]) {
    const session = fakeSession();
    const api = fakeManagement({ deployPayload });
    await assert.rejects(
      applyProviderSteps(input({ session, management: api.management })),
      error => error.code === 'EDGE_COMPONENT_DEPLOYER_UNAVAILABLE',
    );
    assert.equal(session.state.steps.get('edge_secret_binding').status, 'started');
  }
});

test('provider write failures and missing management credentials close with fixed codes', async () => {
  const refused = fakeManagement({ secretsStatus: 500 });
  await assert.rejects(
    applyProviderSteps(input({ session: fakeSession(), management: refused.management })),
    error => error.code === 'EDGE_COMPONENT_DEPLOYER_UNAVAILABLE',
  );
  await assert.rejects(
    applyProviderSteps(input({ session: fakeSession(), management: { accessToken: '' } })),
    error => error.code === 'EDGE_COMPONENT_DEPLOYER_UNAVAILABLE',
  );
  await assert.rejects(
    applyProviderSteps(input({
      session: fakeSession(), management: fakeManagement().management, secrets: { schedulerSecret: '' },
    })),
    error => error.code === 'EDGE_COMPONENT_DEPLOYER_UNAVAILABLE',
  );
});

test('a completed edge step whose deployed function disappeared stops the install', async () => {
  const session = fakeSession();
  await applyProviderSteps(input({ session, management: fakeManagement().management }));
  await assert.rejects(
    applyProviderSteps(input({ session, management: fakeManagement().management })),
    error => error.code === 'RESOURCE_OWNERSHIP_MISMATCH',
  );
});

test('a completed edge step whose function was redeployed under a new version stops the install', async () => {
  const session = fakeSession();
  await applyProviderSteps(input({ session, management: fakeManagement().management }));
  const redeployed = fakeManagement({ installedFunction: { id: 'signer-function-id', version: 2 } });
  await assert.rejects(
    applyProviderSteps(input({ session, management: redeployed.management })),
    error => error.code === 'RESOURCE_OWNERSHIP_MISMATCH',
  );
});
