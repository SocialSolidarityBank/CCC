import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';
import {
  configuredInstallTrust, hashCanonical, requireSignedOwnerPreflight,
} from '../supabase/manifest-preflight.mjs';
import { assertSameApprovedStage, viewFromSupabaseResult } from './flow.mjs';
import { assertSafeOutput } from '../supabase/report.mjs';

const HASH = /^[a-f0-9]{64}$/u;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const REQUEST_KEYS = [
  'schemaVersion', 'requestId', 'institutionId', 'accountSha256', 'ownerOrgId',
  'ownerOrgSlug', 'region', 'plan', 'instanceSize', 'monthlyEstimateUsdCents',
];
const JOURNAL_KEYS = ['schemaVersion', 'requestSha256', 'approved', 'phase', 'projectRefSha256'];
const hash = value => createHash('sha256').update(value).digest('hex');
const failure = code => Object.assign(new Error(code), { code });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Reflect.ownKeys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));

function checkedRequest(value) {
  if (!exact(value, REQUEST_KEYS) || value.schemaVersion !== 1
    || typeof value.requestId !== 'string' || !UUID.test(value.requestId)
    || typeof value.accountSha256 !== 'string' || !HASH.test(value.accountSha256)
    || !['institutionId', 'ownerOrgId', 'ownerOrgSlug'].every(key =>
      typeof value[key] === 'string' && IDENTIFIER.test(value[key]))
    || value.region !== 'ap-northeast-2' || value.plan !== 'pro' || value.instanceSize !== 'micro'
    || !Number.isSafeInteger(value.monthlyEstimateUsdCents) || value.monthlyEstimateUsdCents < 0) {
    throw failure('CLOUD_REQUEST_INVALID');
  }
  return Object.freeze({ ...value });
}

function checkedInstallation(value) {
  const keys = ['projectRef', 'installManifest', 'installApproval', 'manifestUrl'];
  if (!record(value) || Reflect.ownKeys(value).some(key => !keys.includes(key))
    || typeof value.projectRef !== 'string' || !/^[a-z]{20}$/u.test(value.projectRef)
    // Signed documents are JSON text or a file path, the only shapes readStrictJsonDocument accepts.
    || ['installManifest', 'installApproval', 'manifestUrl'].some(key => value[key] !== undefined
      && (typeof value[key] !== 'string' || value[key].length === 0))) throw failure('CLOUD_REQUEST_INVALID');
  return Object.freeze({ ...value });
}

function context(options) {
  const request = checkedRequest(options.request);
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const accessToken = env.SUPABASE_ACCESS_TOKEN;
  if (typeof fetchImpl !== 'function' || typeof accessToken !== 'string'
    || !accessToken || /[^\x21-\x7e]/u.test(accessToken)) throw failure('CREDENTIAL_MISSING');
  return { request, env, fetchImpl, accessToken, projectName: `relayer-${request.requestId}` };
}

async function management(context, path, body) {
  let response;
  try {
    response = await context.fetchImpl(`https://api.supabase.com${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { Authorization: `Bearer ${context.accessToken}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== (body === undefined ? 200 : 201)) throw failure('PROVIDER_UNREADABLE');
    const reader = response.body?.getReader();
    if (!reader) throw failure('PROVIDER_UNREADABLE');
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 1_048_576) {
          await reader.cancel();
          throw failure('PROVIDER_UNREADABLE');
        }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
  } catch {
    // A failed POST may already have created a project. Never retry it here.
    throw failure(body === undefined ? 'PROVIDER_UNREADABLE' : 'CLOUD_CREATION_OUTCOME_UNKNOWN');
  }
}

async function observe(context) {
  const { request } = context;
  const orgPath = `/v1/organizations/${request.ownerOrgSlug}`;
  const [profile, organization, members, projects] = await Promise.all([
    management(context, '/v1/profile'), management(context, orgPath),
    management(context, `${orgPath}/members`), management(context, '/v1/projects'),
  ]);
  if (typeof profile?.gotrue_id !== 'string' || hash(profile.gotrue_id) !== request.accountSha256
    || organization?.id !== request.ownerOrgId) throw failure('OWNER_MISMATCH');
  if (!Array.isArray(members) || !members.some(member => member?.user_id === profile.gotrue_id
    && ['owner', 'administrator'].includes(String(member.role_name).toLowerCase()))) {
    throw failure('CREDENTIAL_INSUFFICIENT');
  }
  if (organization.plan !== request.plan) throw failure('CLOUD_BILLING_PLAN_MISMATCH');
  if (!Array.isArray(projects) || projects.some(project => !record(project)
    || typeof project.id !== 'string' || typeof project.name !== 'string'
    || typeof project.organization_id !== 'string' || typeof project.region !== 'string'
    || typeof project.status !== 'string')) throw failure('PROVIDER_UNREADABLE');
  return projects;
}

async function binding(context, projects, path) {
  const { request } = context;
  return {
    mode: 'community-cloud', stageId: 'cloud-resources',
    targetSha256: await hashCanonical({
      accountSha256: request.accountSha256, institutionId: request.institutionId,
      ownerOrgId: request.ownerOrgId, ownerOrgSlug: request.ownerOrgSlug,
      journalPathSha256: hash(path),
    }),
    desiredSha256: await hashCanonical(request),
    observedSha256: await hashCanonical(projects.filter(project =>
      project.organization_id === request.ownerOrgId).map(project => ({
      id: project.id, name: project.name, region: project.region, status: project.status,
    })).sort((a, b) => a.id.localeCompare(b.id))),
  };
}

function summary(request) {
  return {
    accountSha256: request.accountSha256, institutionSha256: hash(request.institutionId),
    ownerOrgSha256: hash(request.ownerOrgId), projectCount: 1,
    region: request.region, plan: request.plan, instanceSize: request.instanceSize,
    monthlyEstimateUsdCents: request.monthlyEstimateUsdCents,
    estimateIsBillingCap: false,
    externalTransfers: ['supabase_project_configuration', 'supabase_database_password'],
  };
}

/** A preview only. The caller must display the summary and obtain this stage's approval. */
export async function planSupabaseProject(options) {
  const ctx = context(options);
  const path = await journalPath(options.journalPath);
  const projects = await observe(ctx);
  if (projects.some(project => project.name === ctx.projectName)) {
    throw failure('RESOURCE_OWNERSHIP_MISMATCH');
  }
  return { summary: summary(ctx.request), binding: await binding(ctx, projects, path) };
}

async function journalPath(input) {
  if (typeof input !== 'string' || !input) throw failure('CLOUD_JOURNAL_INVALID');
  try {
    const parent = await realpath(dirname(resolve(input)));
    const info = await lstat(parent);
    if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0) {
      throw failure('CLOUD_JOURNAL_INVALID');
    }
    return join(parent, basename(input));
  } catch { throw failure('CLOUD_JOURNAL_INVALID'); }
}

async function readJournal(path) {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid?.()
      || (info.mode & 0o077) !== 0 || info.size > 4096) throw failure('CLOUD_JOURNAL_INVALID');
    const value = JSON.parse(await file.readFile('utf8'));
    if (!exact(value, JOURNAL_KEYS) || value.schemaVersion !== 1
      || typeof value.requestSha256 !== 'string' || !HASH.test(value.requestSha256)
      || value.approved?.mode !== 'community-cloud' || value.approved?.stageId !== 'cloud-resources'
      || value.approved?.desiredSha256 !== value.requestSha256
      || !['submitted', 'observed'].includes(value.phase)
      || (value.phase === 'submitted' ? value.projectRefSha256 !== null
        : typeof value.projectRefSha256 !== 'string' || !HASH.test(value.projectRefSha256))) {
      throw failure('CLOUD_JOURNAL_INVALID');
    }
    assertSameApprovedStage(value.approved, value.approved, value.approved);
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw failure('CLOUD_JOURNAL_INVALID');
  } finally { await file?.close().catch(() => { throw failure('CLOUD_JOURNAL_INVALID'); }); }
}

async function writeJournal(path, value, exclusive = false) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let file;
  let created = false;
  try {
    file = await open(temporary, 'wx', 0o600);
    created = true;
    await file.writeFile(JSON.stringify(value));
    await file.sync();
    await file.close();
    file = null;
    if (exclusive) await link(temporary, path);
    else await rename(temporary, path);
    const directory = await open(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY);
    try { await directory.sync(); } finally { await directory.close(); }
  } catch (error) {
    throw failure(exclusive && error?.code === 'EEXIST' ? 'CLOUD_CREATION_IN_PROGRESS' : 'CLOUD_JOURNAL_INVALID');
  }
  finally {
    await file?.close().catch(() => { throw failure('CLOUD_JOURNAL_INVALID'); });
    if (created) await unlink(temporary).catch(() => {});
  }
}


async function ownedResult(ctx, projects, journal) {
  const matches = projects.filter(project => project.name === ctx.projectName);
  if (matches.length === 0 && journal.phase === 'submitted') throw failure('CLOUD_CREATION_OUTCOME_UNKNOWN');
  if (matches.length !== 1) throw failure('RESOURCE_OWNERSHIP_MISMATCH');
  const project = matches[0];
  if (project.organization_id !== ctx.request.ownerOrgId || project.region !== ctx.request.region
    || (project.organization_slug !== undefined && project.organization_slug !== ctx.request.ownerOrgSlug)
    || !/^[a-z]{20}$/u.test(project.id)
    || (project.ref !== undefined && project.ref !== project.id)
    || (journal.projectRefSha256 !== null && journal.projectRefSha256 !== hash(project.id))) {
    throw failure('RESOURCE_OWNERSHIP_MISMATCH');
  }
  return { state: 'observed', projectRefSha256: hash(project.id), requestSha256: journal.requestSha256 };
}

/** The intent is durable before POST. Resume only observes, even if no project is visible yet. */
export async function createSupabaseProject(options) {
  if (!options.approved) throw failure('CLOUD_CREATION_CANCELLED');
  const ctx = context(options);
  const approved = { ...options.approved };
  assertSameApprovedStage(approved, approved, approved);
  const requestSha256 = await hashCanonical(ctx.request);
  const path = await journalPath(options.journalPath);
  let journal = await readJournal(path);
  if (journal) {
    if (journal.requestSha256 !== requestSha256) throw failure('PLAN_STATE_CHANGED');
    assertSameApprovedStage(approved, journal.approved, journal.approved);
  }
  let projects = await observe(ctx);
  const current = await binding(ctx, projects, path);
  if (journal) {
    // Resume changes no provider resources. Its own creation changed the observed inventory.
    assertSameApprovedStage(approved, journal.approved, {
      ...current, observedSha256: journal.approved.observedSha256,
    });
  } else {
    assertSameApprovedStage(approved, current, current);
    if (projects.some(project => project.name === ctx.projectName)) throw failure('RESOURCE_OWNERSHIP_MISMATCH');
    const password = ctx.env.CCC_ONBOARDING_DATABASE_PASSWORD;
    if (typeof password !== 'string' || password.length < 16 || password.length > 256) {
      throw failure('CREDENTIAL_MISSING');
    }
    journal = { schemaVersion: 1, requestSha256, approved, phase: 'submitted', projectRefSha256: null };
    // Exclusive publication, not a persistent mutex: only its winner may send once.
    await writeJournal(path, journal, true);
    try {
      await management(ctx, '/v1/projects', {
        db_pass: password, name: ctx.projectName, organization_slug: ctx.request.ownerOrgSlug,
        region_selection: { type: 'specific', code: ctx.request.region },
        desired_instance_size: ctx.request.instanceSize,
      });
    } catch {
      // The recorded attempt is never cleared, including provider rejection or a timeout.
    }
    projects = await observe(ctx);
  }
  const result = await ownedResult(ctx, projects, journal);
  if (journal.phase !== 'observed') {
    await writeJournal(path, { ...journal, phase: 'observed', projectRefSha256: result.projectRefSha256 });
  }
  return result;
}

/** Creation evidence cannot sign an installation, choose its owner, or authorize SQL. */
export async function verifyCreatedInstallation(options) {
  const installation = checkedInstallation(options.installation);
  const ctx = context(options);
  const journal = await readJournal(await journalPath(options.journalPath));
  if (!journal || journal.phase !== 'observed'
    || journal.requestSha256 !== await hashCanonical(ctx.request)) throw failure('RESOURCE_OWNERSHIP_MISMATCH');
  const created = await ownedResult(ctx, await observe(ctx), journal);
  const authorization = await requireSignedOwnerPreflight({
    installManifest: installation?.installManifest ?? ctx.env.CCC_INSTALL_MANIFEST,
    installApproval: installation?.installApproval ?? ctx.env.CCC_INSTALL_APPROVAL,
    organizationId: ctx.env.CCC_ORGANIZATION_ID,
    projectRef: installation?.projectRef,
    trust: configuredInstallTrust({
      organizationId: ctx.env.CCC_ORGANIZATION_ID,
      publicKeys: ctx.env.CCC_INSTALL_SIGNING_KEYS,
      revokedKeyIds: ctx.env.CCC_INSTALL_REVOKED_KEY_IDS,
    }),
  });
  if (authorization.institutionId !== ctx.request.institutionId
    || authorization.expectedOwnerOrgId !== ctx.request.ownerOrgId
    || authorization.projectRefHash !== created.projectRefSha256) throw failure('OWNER_MISMATCH');
  return {
    projectRefSha256: created.projectRefSha256,
    runtimeManifestSha256: authorization.runtimeManifestSha256,
    approvalSha256: authorization.approvalSha256,
  };
}

/** The existing installer still owns signatures, baseline, SQL, locks, journal, signer and health. */
export async function runCreatedInstallation(options) {
  if (!['plan', 'apply', 'doctor', 'reconcile-auth-config'].includes(options.operation)) throw failure('CLOUD_REQUEST_INVALID');
  if (options.operation === 'apply' && !options.approved) throw failure('CLOUD_INSTALLATION_CANCELLED');
  if (options.env !== undefined && options.env !== process.env) throw failure('CLOUD_REQUEST_INVALID');
  options = {
    ...options, request: checkedRequest(options.request),
    installation: checkedInstallation(options.installation),
    approved: options.approved ? { ...options.approved } : undefined,
  };
  const evidence = await verifyCreatedInstallation(options);
  const expectedAuthorizationSha256 = await hashCanonical({
    runtimeManifestSha256: evidence.runtimeManifestSha256, approvalSha256: evidence.approvalSha256,
  });
  const { runSupabaseBootstrap } = await import('../supabase/bootstrap.mjs');
  const input = {
    target: 'hosted', projectRef: options.installation.projectRef,
    installManifest: options.installation.installManifest,
    installApproval: options.installation.installApproval,
    manifestUrl: options.installation.manifestUrl,
  };
  if (options.operation === 'reconcile-auth-config') {
    // 승인된 Auth drift 정합화는 installer의 좁은 proof와 journal transaction만 쓴다.
    const result = await runSupabaseBootstrap({
      operation: 'reconcile-auth-config',
      target: 'hosted',
      projectRef: options.installation.projectRef,
      installManifest: options.installation.installManifest,
      installApproval: options.installation.installApproval,
    }, { expectedAuthorizationSha256 });
    return { result };
  }
  if (options.operation === 'doctor') {
    const result = await runSupabaseBootstrap({ ...input, operation: 'doctor' }, { expectedAuthorizationSha256 });
    return { view: viewFromSupabaseResult('community-cloud', result), result };
  }
  const { plan, releaseSha256 } = await runSupabaseBootstrap({ ...input, operation: 'plan' }, {
    expectedAuthorizationSha256, includeRelease: true,
  });
  const view = viewFromSupabaseResult('community-cloud', plan);
  if (!plan.ready) return { view, result: plan };
  const planned = {
    mode: 'community-cloud', stageId: 'installation',
    targetSha256: await hashCanonical({ request: await hashCanonical(checkedRequest(options.request)), ...evidence }),
    desiredSha256: await hashCanonical({
      resources: plan.resourcesSha256, migrations: plan.migrationsSha256, releaseSha256,
    }),
    observedSha256: plan.stateFingerprint,
  };
  if (options.operation === 'plan') return { view, result: plan, binding: planned };
  assertSameApprovedStage(options.approved, planned, planned);
  const result = await runSupabaseBootstrap({ ...input, operation: 'apply' }, {
    expectedPlanFingerprint: plan.planFingerprint,
    expectedAuthorizationSha256, expectedReleaseSha256: releaseSha256,
  });
  return { result };
}

function print(value) {
  const text = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  assertSafeOutput(text);
  process.stdout.write(text);
}

export function cloudResultExitCode(value) {
  return value?.result?.ready === false ? 6 : 0;
}

function printResult(value) {
  print(value);
  const code = cloudResultExitCode(value);
  if (code !== 0) process.exitCode = code;
}

async function confirmStage(phrase) {
  print(`요약을 승인하려면 '${phrase}'을 입력하세요. 다른 입력이나 종료는 취소합니다.\n`);
  const input = createInterface({
    input: process.stdin,
    output: new Writable({ write(_chunk, _encoding, done) { done(); } }),
    terminal: process.stdin.isTTY === true, historySize: 0,
  });
  const interrupt = () => input.close();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  input.once('SIGINT', interrupt);
  try {
    return await new Promise(resolve => {
      input.once('close', () => resolve(false));
      input.question('', answer => { resolve(answer.trim() === phrase); input.close(); });
    });
  } finally {
    input.close();
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

function jsonInput(value) {
  if (typeof value !== 'string' || value.length > 16_384) throw failure('CLOUD_REQUEST_INVALID');
  try { return JSON.parse(value); } catch { throw failure('CLOUD_REQUEST_INVALID'); }
}

async function main() {
  const [operation = 'plan', ...extra] = process.argv.slice(2);
  if (extra.length) throw failure('CLOUD_REQUEST_INVALID');
  if (operation === '--help') {
    print('relayer Cloud 설치 도구\nnode scripts/onboarding/cloud.mjs [plan|create|resume|install-plan|install|doctor|reconcile-auth-config]\n');
    print('입력: CCC_ONBOARDING_REQUEST(JSON), CCC_ONBOARDING_JOURNAL(기관 소유 비공개 디렉터리의 생성 기록)\n');
    print('설치 입력: CCC_ONBOARDING_INSTALLATION(JSON)과 기존 S11 주입 설정\n');
    print('create와 install은 요약 뒤 별도 승인을 받습니다. resume는 기록된 요청을 관찰할 뿐 다시 생성하지 않습니다.\n');
    print('이 도구는 Pro 결제 전환, ACA 자원 생성과 업무 API 배포를 실행하지 않습니다.\n');
    return;
  }
  if (!['plan', 'create', 'resume', 'install-plan', 'install', 'doctor', 'reconcile-auth-config'].includes(operation)) {
    throw failure('CLOUD_REQUEST_INVALID');
  }
  const options = {
    request: jsonInput(process.env.CCC_ONBOARDING_REQUEST),
    journalPath: process.env.CCC_ONBOARDING_JOURNAL,
  };
  if (operation === 'resume') {
    const journal = await readJournal(await journalPath(options.journalPath));
    if (!journal) throw failure('CLOUD_CREATION_OUTCOME_UNKNOWN');
    print(await createSupabaseProject({ ...options, approved: journal.approved }));
  } else if (operation === 'plan' || operation === 'create') {
    const plan = await planSupabaseProject(options);
    print(plan);
    if (operation === 'create') {
      if (!await confirmStage('이대로 생성')) throw failure('CLOUD_CREATION_CANCELLED');
      print(await createSupabaseProject({ ...options, approved: plan.binding }));
    }
  } else {
    options.installation = jsonInput(process.env.CCC_ONBOARDING_INSTALLATION);
    if (operation === 'reconcile-auth-config') {
      const result = await runCreatedInstallation({ ...options, operation });
      print(result.result);
      return;
    }
    const plan = await runCreatedInstallation({ ...options, operation: operation === 'doctor' ? 'doctor' : 'plan' });
    printResult(plan);
    if (operation === 'install' && plan.binding) {
      if (!await confirmStage('이대로 설치')) throw failure('CLOUD_INSTALLATION_CANCELLED');
      printResult(await runCreatedInstallation({ ...options, operation: 'apply', approved: plan.binding }));
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); }
  catch (error) {
    if (process.env.CCC_DEBUG_CLOUD === '1') process.stderr.write(`${error?.stack ?? error}\n`);
    const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.code)
      ? error.code : 'CLOUD_REQUEST_INVALID';
    process.stderr.write(`${JSON.stringify({ error: { code } })}\n`);
    process.exitCode = 1;
  }
}
