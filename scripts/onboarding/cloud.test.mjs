import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import postgres from 'postgres';
import test from 'node:test';
import {
  cloudResultExitCode,
  createSupabaseProject,
  planSupabaseProject,
  verifyCreatedInstallation,
} from './cloud.mjs';
import {
  configuredInstallTrust,
  hashCanonical,
  requireSignedOwnerPreflight,
} from '../supabase/manifest-preflight.mjs';
import {
  BETA_TRUST_DOMAIN,
  PROVIDER_BASELINE_DOMAIN,
  requireProviderBaseline,
} from '../supabase/provider-baseline.mjs';
import {
  normalizeProviderInventory,
  providerInventoryFingerprint,
} from '../supabase/provider-inventory.mjs';
import {
  bootstrapInstall,
  hashDatabaseInstallFingerprint,
  updateInstallPhase,
} from '../supabase/install-journal.mjs';
import {
  expectedSupabaseResources,
  installationStateFingerprint,
  postgresMigrationPlan,
} from '../supabase/plan.mjs';
import { inspectAuthConfig, RELAYER_INVITE_TEMPLATE_HTML } from '../supabase/auth-config.mjs';
import { PINNED_RELEASE_ORIGIN } from '../release/release-origin.mjs';
import { canonicalizeJcs, sha256Jcs } from '../../apps/community-cloud/dist/install-manifest-verifier.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const request = {
  schemaVersion: 1,
  requestId: '3b5b8dd3-bf36-42bf-b7cf-5d6f67708269',
  institutionId: 'synthetic-institution',
  accountSha256: hash('synthetic-account'),
  ownerOrgId: 'synthetic-org',
  ownerOrgSlug: 'synthetic-org',
  region: 'ap-northeast-2',
  plan: 'pro',
  instanceSize: 'micro',
  monthlyEstimateUsdCents: 4500,
};
const env = {
  SUPABASE_ACCESS_TOKEN: 'synthetic-management-token',
  CCC_ONBOARDING_DATABASE_PASSWORD: 'synthetic-database-password',
};

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'relayer-onboarding-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const state = {
    projects: [], writes: 0, reads: 0, loseResponse: false, invisible: false,
    ownerOrgId: request.ownerOrgId, plan: 'pro', blockCreate: null,
  };
  const options = {
    request, journalPath: join(directory, 'creation.json'), env,
    async fetchImpl(url, init) {
      const parsed = new URL(url);
      assert.equal(parsed.origin, 'https://api.supabase.com');
      assert.equal(init.redirect, 'error');
      assert.equal(init.headers.Authorization, 'Bearer synthetic-management-token');
      if (init.method === 'POST') {
        assert.equal(parsed.pathname, '/v1/projects');
        state.writes += 1;
        const journal = JSON.parse(await readFile(options.journalPath, 'utf8'));
        assert.equal(journal.phase, 'submitted');
        const body = JSON.parse(init.body);
        assert.equal(body.db_pass, env.CCC_ONBOARDING_DATABASE_PASSWORD);
        assert.equal(body.organization_slug, request.ownerOrgSlug);
        assert.deepEqual(body.region_selection, { type: 'specific', code: 'ap-northeast-2' });
        assert.equal(body.desired_instance_size, 'micro');
        assert.equal(Object.hasOwn(body, 'plan'), false);
        const resource = {
          id: 'abcdefghijklmnopqrst', ref: 'abcdefghijklmnopqrst',
          organization_id: state.ownerOrgId, organization_slug: request.ownerOrgSlug,
          name: body.name, region: 'ap-northeast-2',
          created_at: new Date().toISOString(), status: 'ACTIVE_HEALTHY',
        };
        state.projects.push(resource);
        state.onCreate?.();
        if (state.blockCreate) await state.blockCreate;
        if (state.loseResponse) throw new Error('private provider error https://private.invalid');
        return Response.json(resource, { status: 201 });
      }
      assert.equal(init.method, 'GET');
      state.reads += 1;
      if (parsed.pathname === '/v1/profile') {
        return Response.json({ gotrue_id: 'synthetic-account', primary_email: 'test@example.org', username: 'test' });
      }
      if (parsed.pathname === '/v1/organizations/synthetic-org') {
        return Response.json({ id: state.ownerOrgId, name: 'Synthetic', plan: state.plan });
      }
      if (parsed.pathname === '/v1/organizations/synthetic-org/members') {
        return Response.json([{ user_id: 'synthetic-account', user_name: 'test', email: 'test@example.org', role_name: 'Owner', mfa_enabled: false, avatar_url: null }]);
      }
      if (parsed.pathname === '/v1/projects') {
        await state.onInventory?.();
        return Response.json(state.invisible ? [] : state.projects);
      }
      assert.fail(`Unexpected test request: ${parsed.pathname}`);
    },
  };
  return { options, state };
}

async function serveProvider(t, options) {
  const server = createServer(async (req, res) => {
    try {
      let body = '';
      for await (const chunk of req) body += chunk;
      const response = await options.fetchImpl(`https://api.supabase.com${req.url}`, {
        method: req.method, redirect: 'error',
        headers: { Authorization: req.headers.authorization },
        ...(body ? { body } : {}),
      });
      res.writeHead(response.status, { 'Content-Type': 'application/json' });
      res.end(await response.text());
    } catch { res.destroy(); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('취소와 잘못된 소유자는 생성 요청이나 생성 기록을 남기지 않는다', async t => {
  const { options, state } = await fixture(t);
  await assert.rejects(createSupabaseProject({ ...options, approved: null }), { code: 'CLOUD_CREATION_CANCELLED' });
  assert.equal(state.reads, 0);
  state.ownerOrgId = 'foreign-org';
  await assert.rejects(planSupabaseProject(options), { code: 'OWNER_MISMATCH' });
  assert.equal(state.writes, 0);
  await assert.rejects(stat(options.journalPath), { code: 'ENOENT' });
});

test('승인 후 과금 구성이나 프로젝트 목록이 바뀌면 생성하지 않는다', async t => {
  const { options, state } = await fixture(t);
  const plan = await planSupabaseProject(options);
  assert.equal(plan.summary.projectCount, 1);
  assert.equal(plan.summary.monthlyEstimateUsdCents, 4500);
  assert.equal(state.writes, 0);
  await assert.rejects(createSupabaseProject({
    ...options, request: { ...request, monthlyEstimateUsdCents: 5500 }, approved: plan.binding,
  }), { code: 'PLAN_STATE_CHANGED' });
  state.projects.push({ id: 'zyxwvutsrqponmlkjihgf', ref: 'zyxwvutsrqponmlkjihgf', organization_id: request.ownerOrgId, organization_slug: request.ownerOrgSlug, name: 'unrelated', region: request.region, status: 'ACTIVE_HEALTHY' });
  await assert.rejects(createSupabaseProject({ ...options, approved: plan.binding }), { code: 'PLAN_STATE_CHANGED' });
  assert.equal(state.writes, 0);
  assert.equal(state.projects[0].name, 'unrelated');
});

test('Free 조직을 Pro 승인으로 간주하거나 자동 업그레이드하지 않는다', async t => {
  const { options, state } = await fixture(t);
  state.plan = 'free';
  await assert.rejects(planSupabaseProject(options), { code: 'CLOUD_BILLING_PLAN_MISMATCH' });
  assert.equal(state.writes, 0);
});

test('생성 응답 유실 뒤 재개는 관찰만 하며 결국 프로젝트 한 개만 남긴다', async t => {
  const { options, state } = await fixture(t);
  const plan = await planSupabaseProject(options);
  state.loseResponse = true;
  state.invisible = true;
  await assert.rejects(createSupabaseProject({ ...options, approved: plan.binding }), { code: 'CLOUD_CREATION_OUTCOME_UNKNOWN' });
  await assert.rejects(createSupabaseProject({ ...options, approved: plan.binding }), { code: 'CLOUD_CREATION_OUTCOME_UNKNOWN' });
  assert.equal(state.writes, 1);
  state.invisible = false;
  const result = await createSupabaseProject({ ...options, approved: plan.binding });
  assert.equal(result.state, 'observed');
  assert.equal(result.projectRefSha256, hash('abcdefghijklmnopqrst'));
  assert.equal(state.writes, 1);
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].organization_id, request.ownerOrgId);
  const journal = await readFile(options.journalPath, 'utf8');
  const output = JSON.stringify({ plan, result });
  for (const secret of [...Object.values(env), request.institutionId, request.ownerOrgId, 'abcdefghijklmnopqrst', 'https://']) {
    assert.equal(journal.includes(secret), false);
    assert.equal(output.includes(secret), false);
  }
  assert.equal((await stat(options.journalPath)).mode & 0o777, 0o600);
});

test('관찰된 생성 자원이 다른 소유자로 바뀌면 재생성하지 않고 거부한다', async t => {
  const { options, state } = await fixture(t);
  const plan = await planSupabaseProject(options);
  await createSupabaseProject({ ...options, approved: plan.binding });
  state.projects[0].organization_id = 'foreign-owner';
  await assert.rejects(createSupabaseProject({ ...options, approved: plan.binding }), { code: 'RESOURCE_OWNERSHIP_MISMATCH' });
  assert.equal(state.writes, 1);
  assert.equal(state.projects[0].organization_id, 'foreign-owner');
});

test('응답 대기 중 두 번째 호출은 새로 생성하지 않고 같은 자원을 관찰한다', async t => {
  const { options, state } = await fixture(t);
  const plan = await planSupabaseProject(options);
  let release;
  state.blockCreate = new Promise(resolve => { release = resolve; });
  const created = Promise.withResolvers();
  state.onCreate = created.resolve;
  const first = createSupabaseProject({ ...options, approved: plan.binding });
  try {
    await created.promise;
    assert.equal(state.writes, 1);
    const concurrent = await createSupabaseProject({ ...options, approved: plan.binding });
    assert.equal(concurrent.state, 'observed');
  } finally { release(); }
  await first;
  assert.equal(state.writes, 1);
  assert.equal(state.projects.length, 1);
});

test('생성 기록이 있어도 서명된 S11 승인 없이는 설치 권한을 만들지 않는다', async t => {
  const { options } = await fixture(t);
  const plan = await planSupabaseProject(options);
  await createSupabaseProject({ ...options, approved: plan.binding });
  await assert.rejects(verifyCreatedInstallation({
    ...options, installation: { projectRef: 'abcdefghijklmnopqrst' },
  }), { code: 'OWNER_EVIDENCE_MISSING' });
});

test('승인한 기록 위치를 바꾸어 같은 생성 승인을 재사용할 수 없다', async t => {
  const { options, state } = await fixture(t);
  const plan = await planSupabaseProject(options);
  await assert.rejects(createSupabaseProject({
    ...options, journalPath: join(dirname(options.journalPath), 'different.json'), approved: plan.binding,
  }), { code: 'PLAN_STATE_CHANGED' });
  assert.equal(state.writes, 0);
});

test('설치기 import는 CLI를 실행하지 않고 잘못된 승인 지문을 공급자 접근 전에 거부한다', () => {
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; throw new Error('unexpected provider access'); };
    const { runSupabaseBootstrap } = await import('./scripts/supabase/bootstrap.mjs');
    try {
      await runSupabaseBootstrap({ operation: 'apply', target: 'hosted' }, { expectedPlanFingerprint: 'invalid' });
      console.log(JSON.stringify({ accepted: true, calls }));
    } catch (error) { console.log(JSON.stringify({ code: error.code ?? 'unexpected', calls })); }
  `], { cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf8' });
  assert.equal(child.status, 0);
  assert.equal(child.stderr, '');
  assert.deepEqual(JSON.parse(child.stdout), { code: 'PLAN_STATE_CHANGED', calls: 0 });
});

test('생성 중 프로세스가 종료돼도 같은 요청은 관찰만 재개한다', { timeout: 10_000 }, async t => {
  const { options, state } = await fixture(t);
  const plan = await planSupabaseProject(options);
  const created = Promise.withResolvers();
  const release = Promise.withResolvers();
  state.onCreate = created.resolve;
  state.blockCreate = release.promise;
  const origin = await serveProvider(t, options);
  t.after(() => release.resolve());
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { createSupabaseProject } from './scripts/onboarding/cloud.mjs';
    await createSupabaseProject({
      request: ${JSON.stringify(request)}, env: ${JSON.stringify(env)},
      journalPath: ${JSON.stringify(options.journalPath)}, approved: ${JSON.stringify(plan.binding)},
      fetchImpl: (url, init) => fetch(${JSON.stringify(origin)} + new URL(url).pathname, init),
    });
  `], { cwd: resolve(import.meta.dirname, '../..'), stdio: ['ignore', 'ignore', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const exited = once(child, 'exit');
  await created.promise;
  assert.equal(state.writes, 1);
  child.kill('SIGKILL');
  await exited;
  release.resolve();
  const resumed = await createSupabaseProject({ ...options, approved: plan.binding });
  assert.equal(resumed.state, 'observed');
  assert.equal(state.writes, 1);
  assert.equal(state.projects.length, 1);
});

test('동시 최초 실행은 원자적 생성 기록을 선점한 한 호출만 전송한다', async t => {
  const { options, state } = await fixture(t);
  const plan = await planSupabaseProject(options);
  const together = Promise.withResolvers();
  let inventories = 0;
  state.onInventory = () => {
    inventories += 1;
    if (inventories === 2) { delete state.onInventory; together.resolve(); }
    return together.promise;
  };
  const outcomes = await Promise.allSettled([
    createSupabaseProject({ ...options, approved: plan.binding }),
    createSupabaseProject({ ...options, approved: plan.binding }),
  ]);
  assert.ok(outcomes.some(outcome => outcome.status === 'fulfilled'));
  for (const outcome of outcomes) {
    if (outcome.status === 'rejected') assert.equal(outcome.reason.code, 'CLOUD_CREATION_IN_PROGRESS');
  }
  assert.equal(state.writes, 1);
  assert.equal(state.projects.length, 1);
  assert.equal((await createSupabaseProject({ ...options, approved: plan.binding })).state, 'observed');
});

test('Cloud CLI는 설치 입력이 없으면 비밀값 없는 차단 코드로 종료한다', () => {
  const child = spawnSync(process.execPath, ['scripts/onboarding/cloud.mjs', 'create'], {
    cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf8',
    env: { ...process.env, CCC_ONBOARDING_REQUEST: '', CCC_ONBOARDING_JOURNAL: '', SUPABASE_ACCESS_TOKEN: '' },
  });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.deepEqual(JSON.parse(child.stderr), { error: { code: 'CLOUD_REQUEST_INVALID' } });
});

test('Cloud CLI는 요약 후 입력을 받아 취소와 생성 승인을 구분한다', { timeout: 10_000 }, async t => {
  for (const [answer, writes] of [['cancel', 0], ['이대로 생성', 1]]) {
    await t.test(answer, async t => {
      const { options, state } = await fixture(t);
      const origin = await serveProvider(t, options);
      const child = spawn(process.execPath, ['--input-type=module', '-e', `
        const realFetch = globalThis.fetch;
        globalThis.fetch = (url, init) => realFetch(${JSON.stringify(origin)} + new URL(url).pathname, init);
        process.argv = [process.execPath, ${JSON.stringify(resolve(import.meta.dirname, 'cloud.mjs'))}, 'create'];
        await import('./scripts/onboarding/cloud.mjs');
      `], {
        cwd: resolve(import.meta.dirname, '../..'), stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env, ...env, CCC_ONBOARDING_REQUEST: JSON.stringify(request),
          CCC_ONBOARDING_JOURNAL: options.journalPath,
        },
      });
      t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
      let stdout = '';
      let stderr = '';
      let answered = false;
      child.stdout.on('data', chunk => {
        stdout += chunk;
        if (!answered && stdout.includes('"binding"')) {
          answered = true;
          assert.equal(state.writes, 0);
          child.stdin.end(`${answer}\n`);
        }
      });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const [code] = await once(child, 'exit');
      assert.equal(answered, true);
      assert.equal(code, writes === 1 ? 0 : 1);
      assert.equal(state.writes, writes);
      assert.equal(state.projects.length, writes);
      if (writes === 0) assert.deepEqual(JSON.parse(stderr), { error: { code: 'CLOUD_CREATION_CANCELLED' } });
      else assert.equal(stderr, '');
      for (const secret of Object.values(env)) assert.equal((stdout + stderr).includes(secret), false);
    });
  }
});

// ── Task 4: reconcile-auth-config 공개 명령 (loopback disposable journal) ────

const CLOUD_PROJECT_REF = 'abcdefghijklmnopqrst';
const CLOUD_INSTALLATION_ID = 'synthetic-installation';

const CLOUD_AUTH_CONFIG = Object.freeze({
  disable_signup: true,
  external_email_enabled: true,
  jwt_exp: 3600,
  mailer_autoconfirm: true,
  mfa_max_enrolled_factors: 10,
  mfa_totp_enroll_enabled: true,
  mfa_totp_verify_enabled: true,
  refresh_token_rotation_enabled: true,
  security_captcha_enabled: true,
  sessions_single_per_user: false,
  site_url: 'https://must-not-escape.test',
  smtp_pass: 'must-not-escape',
  mailer_templates_invite_content: RELAYER_INVITE_TEMPLATE_HTML,
});
const RECONCILE_FIXTURE_LOCK = 4_117_404;


function cloudDisposableJournalUrl() {
  const value = process.env.CCC_INSTALL_JOURNAL_TEST_DATABASE_URL;
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error('MISSING_CCC_INSTALL_JOURNAL_TEST_DATABASE_URL');
  }
  const url = new URL(value);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    || databaseName === ''
    || /prod|production/i.test(databaseName)
    || !/test|fixture|disposable/i.test(databaseName)
    || url.search !== '' || url.hash !== '') {
    throw new Error('DISALLOWED_CCC_INSTALL_JOURNAL_TEST_DATABASE_URL');
  }
  return url;
}

async function cloudSignedInputs(origin) {
  const install = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const root = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const release = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = async pair =>
    Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64');
  const signDoc = async (value, pair, domain = '') => ({
    ...value,
    ed25519Signature: Buffer.from(await crypto.subtle.sign(
      'Ed25519', pair.privateKey,
      domain === ''
        ? Buffer.from(canonicalizeJcs(value), 'utf8')
        : Buffer.concat([Buffer.from(domain, 'ascii'), Buffer.from(canonicalizeJcs(value), 'utf8')]),
    )).toString('base64'),
  });
  const now = Date.now();
  const manifestExpiresAt = new Date(now + 600_000).toISOString();
  const pairFor = async runtimeSequence => {
    const manifest = await signDoc({
      schemaVersion: 1, mode: 'community-cloud', apiBase: 'https://api.example.invalid/api',
      clientOrigin: 'https://client.example.invalid', allowedOrigins: ['https://client.example.invalid'],
      host: 'client.example.invalid', scheme: 'https', endpointDiscovery: 'static',
      installationId: CLOUD_INSTALLATION_ID, sequence: runtimeSequence,
      publishedAt: new Date(now - 60_000).toISOString(), expiresAt: manifestExpiresAt,
      approvedSttEngineIds: [], supabaseProjectRef: CLOUD_PROJECT_REF,
      supabaseAuthOrigin: `https://${CLOUD_PROJECT_REF}.supabase.co`,
      supabasePublishableKey: 'sb_publishable_synthetic', signingKeyId: 'synthetic-key',
    }, install);
    const approval = await signDoc({
      schemaVersion: 1, institutionId: request.institutionId, projectRef: CLOUD_PROJECT_REF,
      expectedOwnerOrgId: request.ownerOrgId,
      installationId: manifest.installationId, runtimeManifestSha256: await sha256Jcs(manifest),
      contractVersion: 'S11-install-approval-v1', expiresAt: manifest.expiresAt,
      signingKeyId: 'synthetic-key',
    }, install);
    return { manifest, approval };
  };
  const { manifest, approval } = await pairFor(2);
  const projectRefSha256 = hash(CLOUD_PROJECT_REF);
  const ownerOrgIdSha256 = hash(request.ownerOrgId);
  const releaseTrust = await signDoc({
    schemaVersion: 1, profile: 'development', channel: 'beta', provider: 'supabase',
    projectRefSha256, ownerOrgIdSha256, region: 'ap-northeast-2',
    rootKeyId: 'synthetic-beta-root', releaseKeyId: 'synthetic-beta-release',
    releasePublicKey: await publicKey(release),
    notBefore: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 300_000).toISOString(),
  }, root, BETA_TRUST_DOMAIN);
  const inventory = {
    objects: [], grants: [],
    ...providerInventoryFingerprint({ objects: [], grants: [] }),
  };
  const providerBaseline = await signDoc({
    schemaVersion: 1, profile: 'development', channel: 'beta', provider: 'supabase',
    baselineVersion: 'supabase-hosted-pg17-20260911-v1',
    projectRefSha256, ownerOrgIdSha256, region: 'ap-northeast-2', databaseVersion: '17.4',
    sourceEvidenceSha256: 'd'.repeat(64),
    emptyBusinessState: {
      userTableCount: 0, userRowEstimate: 0, authUserCount: 0, bucketCount: 0, storageObjectCount: 0,
    },
    objects: inventory.objects, grants: inventory.grants,
    objectInventorySha256: inventory.objectInventorySha256,
    grantInventorySha256: inventory.grantInventorySha256,
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 240_000).toISOString(),
    signingKeyId: 'synthetic-beta-release',
  }, release, PROVIDER_BASELINE_DOMAIN);
  const inputs = {
    CCC_INSTALL_MANIFEST: JSON.stringify(manifest),
    CCC_INSTALL_APPROVAL: JSON.stringify(approval),
    CCC_ORGANIZATION_ID: request.institutionId,
    CCC_INSTALL_SIGNING_KEYS: JSON.stringify({ 'synthetic-key': await publicKey(install) }),
    CCC_INSTALL_REVOKED_KEY_IDS: '[]',
    CCC_BETA_TRUST_ROOT_KEYS: JSON.stringify({ 'synthetic-beta-root': await publicKey(root) }),
    CCC_BETA_REVOKED_ROOT_KEY_IDS: '[]',
    CCC_BETA_RELEASE_TRUST: JSON.stringify(releaseTrust),
    CCC_PROVIDER_BASELINE: JSON.stringify(providerBaseline),
  };
  Object.defineProperty(inputs, 'pairFor', { value: pairFor, enumerable: false });
  return inputs;
}

function cloudPinnedRelease() {
  const rootKeys = generateKeyPairSync('ed25519');
  const trustDocument = JSON.stringify({ keys: [{
    keyId: 'root-key-doctor',
    publicKey: rootKeys.publicKey.export({ format: 'jwk' }).x,
    role: 'root', status: 'active',
    notBefore: '2026-09-01T00:00:00.000Z', notAfter: '2026-10-01T00:00:00.000Z',
  }] });
  const contractsSha256 = 'e'.repeat(64);
  const unsigned = {
    schemaVersion: 1, bundleId: 'bundle-dev-7', version: '0.9.0-dev.1', sequence: '7',
    channel: 'dev', publishedAt: '2026-09-11T00:00:00.000Z', expiresAt: '2026-09-20T00:00:00.000Z',
    protocol: {
      apiName: 'ccc-http-api', apiVersion: '1.0.0', contractsSha256,
      peers: ['cloud-cli', 'edge'].map(name => ({ name, protocolVersion: '1.0.0', contractsSha256 })),
    },
    entries: [{
      family: 'community-cloud-cli',
      artifacts: [{
        manifestUrl: `${PINNED_RELEASE_ORIGIN}/manifests/community-cloud-cli.json`,
        manifestSha256: 'a'.repeat(64), edgeComponentManifestSha256: 'b'.repeat(64),
        mode: 'community-cloud', platform: 'macos', arch: 'arm64',
        artifactSha256: 'c'.repeat(64), artifactBytes: 1234,
        minSchemaVersion: 0, maxSchemaVersion: 0,
      }],
    }],
    sequenceFloor: [{
      family: 'community-cloud-cli', mode: 'community-cloud', platform: 'macos', arch: 'arm64',
      minimumSequence: '7',
    }],
    modelManifestSha256: '0'.repeat(64),
  };
  return {
    trustDocument,
    document: JSON.stringify({
      ...unsigned,
      offlineRootSignature: sign(null, Buffer.concat([
        Buffer.from('CCC-RELEASE-BUNDLE-V1\0', 'ascii'),
        Buffer.from(canonicalizeJcs(unsigned), 'utf8'),
      ]), rootKeys.privateKey).toString('base64url'),
    }),
  };
}

async function serveReconcileProvider(t, { journalSql, authConfig = CLOUD_AUTH_CONFIG, installed = true }) {
  const requests = [];
  const writeAttempts = [];
  const database = {
    schema_fingerprint: 'schema-empty', policy_fingerprint: 'policy-empty',
    bucket_fingerprint: 'bucket-empty', bucket_inventory: [],
    user_table_names: [], user_table_count: 0, user_row_estimate: 0,
    rls_enabled_table_count: 0, policy_count: 0, bucket_exists: false, bucket_public: null,
    ledger_exists: false, auth_user_count: 0, bucket_count: 0, storage_object_count: 0,
    user_routine_count: 0, user_type_count: 0, unknown_object_count: 0, custom_schema_count: 0,
    user_auxiliary_relation_count: 0, unowned_object_count: 0,
    installation_unowned_object_count: 0, installation_unowned_schema_count: 0,
    unexpected_grant_count: 0, installation_unexpected_grant_count: 0,
    private_table_names: installed
      ? ['ccc_install_authorizations', 'ccc_install_journal', 'ccc_install_receipt',
        'ccc_install_resources', 'ccc_install_steps', 'ccc_release_history', 'ccc_schema_migrations']
      : [],
    provider_object_count: 0, provider_grant_count: 0,
    private_schema_exists: installed, private_install_metadata_exists: installed,
    cron_exists: false, database_version: '17.4', database_version_num: '170004',
    read_only: true, database_readable: true,
  };
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({ method: req.method, path: req.url, body });
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };
    if (req.url === '/readyz') return send(200, { status: 'ready' });
    if (req.url === '/functions/v1/ccc-storage-signer') {
      res.writeHead(401, {
        'content-type': 'application/json',
        'x-ccc-installation-id': CLOUD_INSTALLATION_ID,
        'x-sb-edge-region': 'ap-northeast-2',
      });
      res.end(JSON.stringify({ code: 'UNAUTHORIZED' }));
      return;
    }
    const isRead = req.method === 'GET'
      || (req.method === 'POST' && req.url.endsWith('/database/query/read-only')
        && (() => {
          try { return JSON.parse(body).query.trimStart().startsWith('SELECT'); } catch { return false; }
        })());
    if (!isRead) {
      writeAttempts.push({ method: req.method, path: req.url });
      return send(500, { message: 'write attempt rejected by fixture' });
    }
    if (req.url === '/v1/profile') {
      return send(200, { gotrue_id: 'synthetic-account', primary_email: 'test@example.org', username: 'test' });
    }
    if (req.url === '/v1/organizations/synthetic-org') {
      return send(200, { id: request.ownerOrgId, name: 'Synthetic', plan: 'pro' });
    }
    if (req.url === '/v1/organizations/synthetic-org/members') {
      return send(200, [{ user_id: 'synthetic-account', user_name: 'test', email: 'test@example.org', role_name: 'Owner', mfa_enabled: false, avatar_url: null }]);
    }
    if (req.url === '/v1/projects') {
      return send(200, [{
        id: CLOUD_PROJECT_REF, ref: CLOUD_PROJECT_REF,
        organization_id: request.ownerOrgId, organization_slug: request.ownerOrgSlug,
        name: `relayer-${request.requestId}`, region: 'ap-northeast-2',
        created_at: '2026-08-31T00:00:00Z', status: 'ACTIVE_HEALTHY',
      }]);
    }
    if (req.url === `/v1/projects/${CLOUD_PROJECT_REF}`) {
      return send(200, {
        id: CLOUD_PROJECT_REF, ref: CLOUD_PROJECT_REF,
        organization_id: request.ownerOrgId, organization_slug: request.ownerOrgSlug,
        name: `relayer-${request.requestId}`, region: 'ap-northeast-2',
        created_at: '2026-08-31T00:00:00Z', status: 'ACTIVE_HEALTHY',
        database: { host: 'db.test.invalid', version: '17.4', postgres_engine: '17', release_channel: 'ga' },
      });
    }
    if (req.url === `/v1/projects/${CLOUD_PROJECT_REF}/config/auth`) {
      return send(200, authConfig);
    }
    if (req.url === `/v1/projects/${CLOUD_PROJECT_REF}/database/query/read-only`) {
      const query = JSON.parse(body).query;
      if (query.includes('provider_object_inventory')) {
        return send(200, [{
          objects: [], grants: [], installation_objects: [], installation_grants: [],
          ...providerInventoryFingerprint({ objects: [], grants: [] }),
        }]);
      }
      if (query.includes(' AS install_state')) {
        return send(200, await journalSql.unsafe(query));
      }
      if (query.includes('rolsuper')) {
        return send(200, [{ rolsuper: false, rolbypassrls: false }]);
      }
      if (query.includes('catalog_state')) {
        return send(200, [{ catalog_state: 'synthetic-public-catalog' }]);
      }
      return send(200, [database]);
    }
    return send(404, { message: 'not found' });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return { origin: `http://127.0.0.1:${server.address().port}`, requests, writeAttempts };
}

async function seedCloudAuthDrift({ signedInput, journalSql, providerBaseline }) {
  const pair = await signedInput.pairFor(1);
  const initial = await requireSignedOwnerPreflight({
    installManifest: JSON.stringify(pair.manifest),
    installApproval: JSON.stringify(pair.approval),
    trust: configuredInstallTrust({
      organizationId: signedInput.CCC_ORGANIZATION_ID,
      publicKeys: signedInput.CCC_INSTALL_SIGNING_KEYS,
      revokedKeyIds: signedInput.CCC_INSTALL_REVOKED_KEY_IDS,
    }),
    organizationId: signedInput.CCC_ORGANIZATION_ID,
    projectRef: CLOUD_PROJECT_REF,
  });
  const migrations = postgresMigrationPlan();
  const desired = {
    resourcesSha256: await hashCanonical({
      resources: expectedSupabaseResources,
      providerBaselineVersion: providerBaseline.baselineVersion,
      providerBaselineSha256: providerBaseline.baselineSha256,
      providerObjectsSha256: providerBaseline.objectInventorySha256,
      providerGrantsSha256: providerBaseline.grantInventorySha256,
    }),
    migrationsSha256: await hashCanonical(migrations),
    planFingerprint: 'f'.repeat(64),
  };
  const schemaFingerprint = hashDatabaseInstallFingerprint(
    [{ catalog_state: 'synthetic-public-catalog' }],
    { objects: [], grants: [], installationObjects: [], installationGrants: [] },
  );
  const fingerprintSnapshot = authFingerprint => ({
    project: {
      region: 'ap-northeast-2',
      ownerOrgIdHash: hash(request.ownerOrgId),
    },
    databaseFingerprint: schemaFingerprint,
    state: {
      policyFingerprint: 'policy-empty',
      bucketFingerprint: 'bucket-empty',
      authFingerprint,
    },
    cronJobCount: 0,
    providerInventory: {
      objects: [], grants: [],
      ...providerInventoryFingerprint({ objects: [], grants: [] }),
    },
  });
  const session = await journalSql.reserve();
  try {
    await bootstrapInstall(session, initial, desired, { authorize: async () => initial });
    await updateInstallPhase(session, initial, {
      phase: 'installed',
      stateFingerprint: await installationStateFingerprint(
        fingerprintSnapshot(inspectAuthConfig(CLOUD_AUTH_CONFIG).priorAuthFingerprint),
        providerBaseline,
      ),
    }, { authorize: async () => initial });
    const [phaseCheck] = await journalSql`SELECT phase, state_fingerprint FROM private.ccc_install_journal`;
    console.error('SEEDDBG phase', JSON.stringify(phaseCheck));
  } finally {
    await session.release();
  }
  for (const migration of migrations) {
    await journalSql`INSERT INTO private.ccc_schema_migrations (id, checksum, installation_id)
      VALUES (${migration.id}, ${migration.checksum}, ${initial.installationId})`;
  }
  const receiptRow = {
    installationId: initial.installationId,
    institutionIdHash: initial.institutionIdHash,
    expectedOwnerOrgIdHash: initial.expectedOwnerOrgIdHash,
    observedOwnerOrgIdHash: hash(request.ownerOrgId),
    releaseVersion: '0.9.0-dev.1',
    releaseSequence: '7',
    manifestDigest: 'a'.repeat(64),
    artifactSetDigest: 'b'.repeat(64),
    migrationHead: migrations.at(-1).id,
    schemaFingerprint,
    edgeRegionEvidence: {
      requestedRegion: 'ap-northeast-2', responseRegion: 'ap-northeast-2',
      functionRegion: 'ap-northeast-2', mismatch: false,
    },
    recordedAt: '2026-09-11T12:00:00.000Z',
  };
  for (const table of ['ccc_install_receipt', 'ccc_release_history']) {
    await journalSql.unsafe(`INSERT INTO private.${table} (
      installation_id, contract, contract_version, institution_id_hash, rollback_target,
      expected_owner_org_id_hash, observed_owner_org_id_hash, release_version, release_sequence,
      manifest_digest, artifact_set_digest, migration_head, schema_fingerprint,
      edge_region_evidence, provider_resource_digests, backup_id, backup_digest,
      prior_receipt_digest, recorded_at, status
    ) VALUES ($1,'S11','0.3',$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,$11,'{}',NULL,NULL,NULL,$12,'installed')`, [
      receiptRow.installationId, receiptRow.institutionIdHash,
      receiptRow.expectedOwnerOrgIdHash, receiptRow.observedOwnerOrgIdHash,
      receiptRow.releaseVersion, receiptRow.releaseSequence, receiptRow.manifestDigest,
      receiptRow.artifactSetDigest, receiptRow.migrationHead, receiptRow.schemaFingerprint,
      receiptRow.edgeRegionEvidence, receiptRow.recordedAt,
    ]);
  }
}

async function withCloudReconcile(t, { authConfig, installed = true }, run) {
  const fixture = cloudDisposableJournalUrl();
  const journalUrl = `postgres://${fixture.username}:${fixture.password}@${fixture.hostname}:${fixture.port}/postgres`;
  const journalSql = postgres(journalUrl, { max: 4, onnotice: () => {} });
  const fixtureLock = await journalSql.reserve();
  try {
    await fixtureLock.unsafe('SELECT pg_advisory_lock($1)', [RECONCILE_FIXTURE_LOCK]);
    const [identity] = await journalSql`SELECT current_database() AS name`;
    assert.equal(identity.name, 'postgres');
    const [objects] = await journalSql.unsafe(`SELECT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'private'
    ) AS present`);
    assert.equal(objects.present, false, 'disposable fixture must start without private objects');
    const provider = await serveReconcileProvider(t, { journalSql, authConfig, installed });
    const signedInput = await cloudSignedInputs(provider.origin);
    const pair = await signedInput.pairFor(2);
    const runAuthorization = await requireSignedOwnerPreflight({
      installManifest: JSON.stringify(pair.manifest),
      installApproval: JSON.stringify(pair.approval),
      trust: configuredInstallTrust({
        organizationId: signedInput.CCC_ORGANIZATION_ID,
        publicKeys: signedInput.CCC_INSTALL_SIGNING_KEYS,
        revokedKeyIds: signedInput.CCC_INSTALL_REVOKED_KEY_IDS,
      }),
      organizationId: signedInput.CCC_ORGANIZATION_ID,
      projectRef: CLOUD_PROJECT_REF,
    });
    const providerBaseline = await requireProviderBaseline({
      releaseTrust: signedInput.CCC_BETA_RELEASE_TRUST,
      providerBaseline: signedInput.CCC_PROVIDER_BASELINE,
      rootKeys: JSON.parse(signedInput.CCC_BETA_TRUST_ROOT_KEYS),
      revokedRootKeyIds: JSON.parse(signedInput.CCC_BETA_REVOKED_ROOT_KEY_IDS),
      authorization: runAuthorization,
      manifestExpiresAt: runAuthorization.expiresAt,
    });
    if (installed) {
      await seedCloudAuthDrift({ signedInput, journalSql, providerBaseline });
    }
    const directory = await mkdtemp(join(tmpdir(), 'relayer-onboarding-test-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const journalPath = join(directory, 'creation.json');
    const requestSha256 = await hashCanonical(request);
    await writeFile(journalPath, JSON.stringify({
      schemaVersion: 1,
      requestSha256,
      approved: {
        mode: 'community-cloud', stageId: 'cloud-resources',
        targetSha256: 'a'.repeat(64), desiredSha256: requestSha256, observedSha256: 'b'.repeat(64),
      },
      phase: 'observed',
      projectRefSha256: hash(CLOUD_PROJECT_REF),
    }), { mode: 0o600 });
    const release = cloudPinnedRelease();
    const installerUrl = `postgres://${fixture.username}:${fixture.password}@db.${CLOUD_PROJECT_REF}.supabase.co/postgres`;
    const childEnv = {
      ...process.env, ...env, ...signedInput,
      CCC_ONBOARDING_REQUEST: JSON.stringify(request),
      CCC_ONBOARDING_JOURNAL: journalPath,
      CCC_ONBOARDING_INSTALLATION: JSON.stringify({
        projectRef: CLOUD_PROJECT_REF,
        installManifest: signedInput.CCC_INSTALL_MANIFEST,
        installApproval: signedInput.CCC_INSTALL_APPROVAL,
      }),
      CCC_DEBUG_CLOUD: '1',
      CCC_INSTALL_DATABASE_URL: installerUrl,
      CCC_RELEASE_TRUST_STORE: release.trustDocument,
    };
    delete childEnv.CCC_DATABASE_CA_FILE;
    const runCode = `
      import net from 'node:net';
      import tls from 'node:tls';
      const releaseDocument = ${JSON.stringify(release.document)};
      const providerOrigin = ${JSON.stringify(provider.origin)};
      const realFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => {
        const requested = new URL(input instanceof Request ? input.url : input);
        if (requested.origin === 'https://api.supabase.com'
          || requested.origin === 'https://api.example.invalid'
          || requested.origin === ${'`'}https://${CLOUD_PROJECT_REF}.supabase.co${'`'}) {
          return realFetch(providerOrigin + requested.pathname + requested.search, init);
        }
        if (requested.origin === ${JSON.stringify(PINNED_RELEASE_ORIGIN)}) {
          return Promise.resolve({
            url: requested.href, ok: true, status: 200,
            headers: new Headers({ date: new Date().toUTCString() }),
            arrayBuffer: async () => new TextEncoder().encode(releaseDocument).buffer,
            text: async () => releaseDocument,
          });
        }
        return Promise.reject(new Error('unexpected fetch origin ' + requested.origin));
      };
      const originalConnect = net.Socket.prototype.connect;
      const originalTlsConnect = tls.connect;
      net.Socket.prototype.connect = function connect(port, host) {
        if (typeof host === 'string' && host.endsWith('.supabase.co')) {
          return originalConnect.call(this, ${Number(fixture.port)}, '127.0.0.1');
        }
        return originalConnect.apply(this, arguments);
      };
      tls.connect = options => {
        if (typeof options?.servername === 'string' && options.servername.endsWith('.supabase.co')) {
          const socket = options.socket;
          queueMicrotask(() => socket.emit('secureConnect'));
          return socket;
        }
        return originalTlsConnect(options);
      };
      process.argv = [process.execPath,
        ${JSON.stringify(resolve(import.meta.dirname, 'cloud.mjs'))}, 'reconcile-auth-config'];
      await import('./scripts/onboarding/cloud.mjs');
    `;
    const spawnChild = () => spawn(process.execPath, ['--input-type=module', '-e', runCode], {
      cwd: resolve(import.meta.dirname, '../..'), stdio: ['ignore', 'pipe', 'pipe'], env: childEnv,
    });
    const collect = async child => {
      t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const [exitCode] = await once(child, 'exit');
      return { exitCode, stdout, stderr };
    };
    await run({ provider, journalSql, signedInput, spawnChild, collect });
  } finally {
    await journalSql.unsafe('DROP SCHEMA IF EXISTS private CASCADE').catch(() => {});
    await fixtureLock.unsafe('SELECT pg_advisory_unlock($1)', [RECONCILE_FIXTURE_LOCK]).catch(() => {});
    await fixtureLock.release();
    await journalSql.end({ timeout: 5 }).catch(() => {});
  }
}

test('Cloud CLI routes reconcile-auth-config with the existing N02 inputs only', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'relayer-onboarding-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const journalPath = join(directory, 'creation.json');
  const baseEnv = {
    ...process.env, ...env,
    CCC_ONBOARDING_REQUEST: JSON.stringify(request),
    CCC_ONBOARDING_JOURNAL: journalPath,
  };
  const cases = [
    [{ ...baseEnv, CCC_ONBOARDING_REQUEST: '' }, 'CLOUD_REQUEST_INVALID'],
    [baseEnv, 'CLOUD_REQUEST_INVALID'],
    [{ ...baseEnv, CCC_ONBOARDING_INSTALLATION: JSON.stringify({ projectRef: CLOUD_PROJECT_REF }),
      CCC_ONBOARDING_JOURNAL: join(directory, 'missing-dir', 'creation.json') },
      'CLOUD_JOURNAL_INVALID'],
    [{ ...baseEnv,
      CCC_ONBOARDING_INSTALLATION: JSON.stringify({ projectRef: CLOUD_PROJECT_REF }),
      CCC_ONBOARDING_JOURNAL: join(directory, 'missing.json') },
      'RESOURCE_OWNERSHIP_MISMATCH'],
    [{ ...baseEnv,
      CCC_ONBOARDING_INSTALLATION: JSON.stringify({ projectRef: CLOUD_PROJECT_REF, extra: true }) },
      'CLOUD_REQUEST_INVALID'],
  ];
  for (const [childEnv, code] of cases) {
    const child = spawnSync(process.execPath,
      ['scripts/onboarding/cloud.mjs', 'reconcile-auth-config'], {
        cwd: resolve(import.meta.dirname, '../..'), encoding: 'utf8', env: childEnv,
      });
    assert.equal(child.status, 1, code);
    assert.equal(child.stdout, '');
    assert.deepEqual(JSON.parse(child.stderr), { error: { code } });
  }
});

test('Cloud CLI emits one exact redacted reconciliation result', async t => {
  await withCloudReconcile(t, {}, async ({ provider, spawnChild, collect }) => {
    const result = await collect(spawnChild());
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stderr, '');
    const lines = result.stdout.split('\n').filter(line => line.length > 0);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]);
    assert.deepEqual(Object.keys(parsed).sort(), [
      'changed', 'code', 'installationIdSha256', 'inviteTemplateSha256', 'operation',
      'priorStateFingerprint', 'runtimeSequence', 'schemaVersion', 'stateFingerprint',
      'status', 'target',
    ]);
    assert.equal(parsed.schemaVersion, 1);
    assert.equal(parsed.operation, 'reconcile-auth-config');
    assert.equal(parsed.target, 'hosted');
    assert.equal(parsed.status, 'reconciled');
    assert.equal(parsed.code, 'AUTH_CONFIG_RECONCILED');
    assert.equal(parsed.changed, true);
    assert.equal(parsed.runtimeSequence, 2);
    assert.equal(provider.writeAttempts.length, 0);
    for (const secret of Object.values(env)) {
      assert.equal((result.stdout + result.stderr).includes(secret), false);
    }
    assert.equal(result.stdout.includes(CLOUD_PROJECT_REF), false);
  });
});

test('Cloud CLI emits only the fixed error code and empty stdout on reconciliation failure', async t => {
  await t.test('template mismatch', async t => {
    await withCloudReconcile(t, {
      authConfig: { ...CLOUD_AUTH_CONFIG, mailer_templates_invite_content: '<p>changed</p>' },
    }, async ({ spawnChild, collect }) => {
      const result = await collect(spawnChild());
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '');
      assert.deepEqual(JSON.parse(result.stderr),
        { error: { code: 'AUTH_RECONCILE_TEMPLATE_MISMATCH' } });
    });
  });
  await t.test('missing journal', async t => {
    await withCloudReconcile(t, { installed: false }, async ({ spawnChild, collect }) => {
      const result = await collect(spawnChild());
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, '');
      assert.deepEqual(JSON.parse(result.stderr), { error: { code: 'INSTALL_NOT_FOUND' } });
    });
  });
});

test('설치 입력의 미등록 명령 필드는 공급자 조회 전에 거부한다', async t => {
  const { options, state } = await fixture(t);
  await assert.rejects(verifyCreatedInstallation({
    ...options, installation: { projectRef: 'abcdefghijklmnopqrst', parameters: { command: 'untrusted-command' } },
  }), { code: 'CLOUD_REQUEST_INVALID' });
  assert.equal(state.reads, 0);
  assert.equal(state.writes, 0);
});

test('차단된 설치와 doctor 결과는 성공 종료하지 않는다', () => {
  assert.equal(cloudResultExitCode({ result: { ready: false } }), 6);
  assert.equal(cloudResultExitCode({ result: { ready: true } }), 0);
});
