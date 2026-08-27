import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repoRoot = new URL('../../', import.meta.url);
const appRoot = new URL('../../apps/web/app/', import.meta.url);
const inventoryUrl = new URL('./route-inventory.json', import.meta.url);

async function pageFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return pageFiles(path);
    return entry.isFile() && entry.name === 'page.tsx' ? [path] : [];
  }));
  return nested.flat();
}

function posixRelative(path) {
  return relative(repoRoot.pathname, path).split(sep).join('/');
}

function routePattern(pageFile) {
  const relativePage = pageFile
    .replace(/^apps\/web\/app\/?/, '')
    .replace(/\/?page\.tsx$/, '');
  if (relativePage === '') return '/';
  return `/${relativePage.split('/').map((part) => /^\[.*\]$/.test(part) ? `:${part.slice(1, -1)}` : part).join('/')}`;
}

async function inventory() {
  return JSON.parse(await readFile(inventoryUrl, 'utf8'));
}

test('inventory maps every Next page exactly once', async () => {
  const data = await inventory();
  const actual = (await pageFiles(appRoot.pathname)).map(posixRelative).sort();
  const declared = data.routes.map((route) => route.page).sort();

  assert.deepEqual(declared, actual);
  assert.equal(new Set(declared).size, declared.length);
  assert.equal(new Set(data.routes.map((route) => route.routePattern)).size, data.routes.length);
  assert.deepEqual(data.measurementMatrix.viewports.map(({ width }) => width), [1280, 767, 390]);
  assert.deepEqual(data.measurementMatrix.themes.map(({ name }) => name), ['light', 'dark']);

  for (const route of data.routes) {
    assert.equal(route.routePattern, routePattern(route.page));
    assert.match(route.representativeUrl, /^\/(?!\/)/);
    assert.equal(typeof route.seedFixture, 'string');
    assert.equal(typeof route.permission?.state, 'string');
    assert.equal(typeof route.permission?.actor, 'string');
    assert.equal(typeof route.unification, 'boolean');
    for (const name of route.representativeUrl.matchAll(/\{\{([^}]+)\}\}/g)) {
      assert.ok(data.fixtureDefaults[name[1]] || data.fixtureEnvironment[name[1]], `${route.page}: unknown fixture ${name[1]}`);
    }
  }
});

test('static inventory check and IA plan both cover six measurements per route', async () => {
  const data = await inventory();
  const check = spawnSync('python3', ['scripts/design/shots.py', '--check-inventory'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(check.status, 0, check.stderr);

  const plan = spawnSync('python3', ['scripts/design/ia-shots.py', '--plan'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      SHOT_SUPPORT_CASE_ID: 'test-support-case',
      SHOT_PARTICIPANT_INVITE_TOKEN: 'test-participant-token',
      SHOT_WORKER_INVITE_TOKEN: 'test-worker-token',
      SHOT_SESSION_ID: 'test-session',
      SHOT_SCHEDULE_ID: 'test-schedule',
    },
  });
  assert.equal(plan.status, 0, plan.stderr);
  const rows = JSON.parse(plan.stdout);
  assert.equal(rows.length, data.routes.length * 2 * 3);
  assert.deepEqual(new Set(rows.map((row) => row.page)), new Set(data.routes.map((route) => route.page)));
  assert.deepEqual(new Set(rows.map((row) => row.theme)), new Set(['light', 'dark']));
  assert.deepEqual(new Set(rows.map((row) => row.width)), new Set([1280, 767, 390]));
  assert.ok(rows.every((row) => !/[{}]/.test(row.resolvedUrl)));
});

test('kit remains inventoried as the non-unification control route', async () => {
  const data = await inventory();
  const kit = data.routes.find((route) => route.routePattern === '/kit');
  assert.ok(kit);
  assert.equal(kit.unification, false);
  assert.equal(data.routes.filter((route) => !route.unification).length, 1);
});
