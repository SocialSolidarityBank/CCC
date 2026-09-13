import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  cloudResultExitCode,
  createSupabaseProject,
  planSupabaseProject,
  verifyCreatedInstallation,
} from './cloud.mjs';

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
