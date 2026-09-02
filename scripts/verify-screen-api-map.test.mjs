import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';

import { readFile } from 'node:fs/promises';


// Intentionally absent in the RED stage. The implementation ticket must add this module.
import { verifyScreenApiMap } from './verify-screen-api-map.mjs';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const fixturePath = new URL('./fixtures/e2-1-screen-api-fixture.json', import.meta.url);

async function fixtureMap() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

function callKey(call) {
  return `${call.method} ${call.path}`;
}
function pageSource(root, route, index, apiNames, actionNames) {
  const pageDirectory = dirname(join(root, route.page));
  const apiImport = relative(pageDirectory, join(root, 'apps/web/app/lib/api.ts')).replace(/\.ts$/, '.js');
  const actionsImport = relative(pageDirectory, join(root, 'apps/web/app/actions.ts')).replace(/\.ts$/, '.js');
  const imports = apiNames.length > 0
    ? `import { ${apiNames.join(', ')} } from '${apiImport.startsWith('.') ? apiImport : `./${apiImport}`}';\n`
    : '';
  const actionImport = actionNames.length > 0
    ? `import { ${actionNames.join(', ')} } from '${actionsImport.startsWith('.') ? actionsImport : `./${actionsImport}`}';\n`
    : '';
  const apiCalls = apiNames.map((name) => `  await ${name}();`).join('\n');
  const forms = actionNames.map((name) => `  return <form action={${name}} data-action="${name}" />;`).join('\n');
  return `${imports}${actionImport}export default async function Page() {\n${apiCalls}\n${forms || '  return <main data-route="' + route.routePattern + '" />;'}\n}\n// fixture page ${index}\n`;
}

async function materializeFixture(map, { omitPage, publicAccessLeak = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ccc-e2-1-'));
  const apiCalls = new Map();
  const actionCalls = new Map();
  let apiIndex = 0;

  for (const route of map.routes) {
    for (const api of route.pageApis) {
      const key = callKey(api);
      if (!apiCalls.has(key)) apiCalls.set(key, `apiCall${apiIndex++}`);
    }
    for (const action of [...route.actions, ...(route.routeHandler ? [route.routeHandler] : [])]) {
      if (action.name !== 'previewUnlockRouteHandler' && !actionCalls.has(action.name)) {
        actionCalls.set(action.name, action);
      }
      for (const api of action.calls) {
        const key = callKey(api);
        if (!apiCalls.has(key)) apiCalls.set(key, `apiCall${apiIndex++}`);
      }
    }
  }
  for (const api of map.inherited.root.apis) {
    const key = callKey(api);
    if (!apiCalls.has(key)) apiCalls.set(key, `apiCall${apiIndex++}`);
  }
  for (const api of map.inherited.admin.apis) {
    const key = callKey(api);
    if (!apiCalls.has(key)) apiCalls.set(key, `apiCall${apiIndex++}`);
  }

  const files = new Map();
  files.set('apps/web/app/layout.tsx', `import { getOrganizationProfile, getNewSignupCount } from './lib/api.js';\nimport { AppHeader } from './components/wire/app-header.js';\nimport { AppSidebar } from './components/wire/app-sidebar.js';\nimport { BackLink } from './components/wire/back-link.js';\nexport default async function RootLayout({ children }) {\n  const isPublic = false;\n  if (isPublic) return children;\n  await getOrganizationProfile();\n  await getNewSignupCount();\n  return <><AppHeader /><AppSidebar /><BackLink />{children}</>;\n}\n`);
  files.set('apps/web/app/admin/layout.tsx', `import { getMyIdentity } from '../lib/api.js';\nexport default async function AdminLayout({ children }) {\n  await getMyIdentity();\n  return children;\n}\n`);
  files.set('apps/web/app/lib/api.ts', `${[
    `export async function getOrganizationProfile() { return requestJson('/organization/profile'); }`,
    `export async function getNewSignupCount() { return requestJson('/participants/new-signup-count'); }`,
    `export async function getMyIdentity() { return requestJson('/me'); }`,
    `export async function requestPreviewUnlock() { return requestJson('/preview/unlock'); }`,
    ...[...apiCalls.entries()].map(([key, name]) => {
      const [, path] = key.split(' ');
      const endpoint = map.endpoints.find((candidate) => callKey(candidate) === key);
      const projectionKeys = endpoint?.projectionKeys ?? [];
      return `/* endpoint ${key}; projectionKeys=${JSON.stringify(projectionKeys)} */\nexport async function ${name}() { return requestJson('${path}'); }`;
    }),
  ].join('\n')}\n`);

  files.set('apps/web/app/actions.ts', `${[...actionCalls.entries()].map(([name, action]) => {
    const calls = action.calls.map((call) => `await ${apiCalls.get(callKey(call))}();`).join(' ');
    return `export async function ${name}() { ${calls} }`;
  }).join('\n')}\n`);

  files.set('apps/web/app/components/wire/app-header.tsx', `import { toggleThemeAction } from '../../theme-action.js';\nimport { logoutAction } from '../../logout-action.js';\nexport function AppHeader() { return <><form action={toggleThemeAction} /><form action={logoutAction} /></>; }\n`);
  files.set('apps/web/app/components/wire/app-sidebar.tsx', `import { toggleThemeAction } from '../../theme-action.js';\nimport { logoutAction } from '../../logout-action.js';\nexport function AppSidebar() { return <><form action={toggleThemeAction} /><form action={logoutAction} /></>; }\n`);
  files.set('apps/web/app/components/wire/back-link.tsx', `export function BackLink() { return <a href="/">back</a>; }\n`);
  files.set('apps/web/app/theme-action.ts', `export async function toggleThemeAction() {}\n`);
  files.set('apps/web/app/logout-action.ts', `export async function logoutAction() {}\n`);
  files.set('apps/web/app/preview/unlock/route.ts', `export async function POST() { return requestPreviewUnlock(); }\n`);
  files.set('apps/api/src/request-handler.ts', `${map.endpoints.map((endpoint) => {
    const keys = endpoint.wireKeys.map((key) => `'${key}'`).join(', ');
    return `router.register('${endpoint.method}', '${endpoint.path}', async () => ({ ${keys} }));`;
  }).join('\n')}\n`);

  for (const [relativePath, source] of files) {
    const path = join(root, relativePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source);
  }


  for (let index = 0; index < map.routes.length; index += 1) {
    const route = map.routes[index];
    if (route.page === omitPage) continue;
    const apiNames = route.pageApis.map((api) => apiCalls.get(callKey(api)));
    const actionNames = route.actions.map((action) => action.name);
    let source = pageSource(root, route, index, apiNames, actionNames);
    if (publicAccessLeak && route.kind === 'public') source += '\nimport { accessHeaders } from "../../lib/api.js";\n';
    const path = join(root, route.page);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, source);
  }
  return root;
}

function codes(result) {
  return new Set((result.errors ?? []).map((error) => error.code));
}

const expectedSummary = { routes: 30, operating: 22, public: 5, redirect: 2, kit: 1 };

test('valid fixture finds all 30 routes and expands inherited root/admin surfaces once', async () => {
  const map = await fixtureMap();
  const root = await materializeFixture(map);
  const result = await verifyScreenApiMap({ rootDir: root, map });

  assert.equal(result.ok, true, (result.errors ?? []).map((error) => error.message).join('\n'));
  assert.deepEqual(result.summary, expectedSummary);
  assert.equal(result.routes.length, 30);

  const admin = result.routes.find((row) => row.routePattern === '/admin');
  const adminChild = result.routes.find((row) => row.routePattern === '/admin/users/:id');
  const publicJoin = result.routes.find((row) => row.routePattern === '/join/participant/:token');
  assert.deepEqual(admin.inherited.root.actions.sort(), ['logoutAction', 'toggleThemeAction']);
  assert.deepEqual(admin.inherited.admin.apis.map(callKey), ['GET /me']);
  assert.deepEqual(adminChild.inherited.root.actions.sort(), ['logoutAction', 'toggleThemeAction']);
  assert.deepEqual(adminChild.inherited.admin.apis.map(callKey), ['GET /me']);
  assert.equal(publicJoin.inherited.root.apis.length, 0);
  assert.equal(publicJoin.inherited.root.actions.length, 0);
});

test('missing page entries, duplicated inherited shell edges, and omitted calls are diagnostics', async () => {
  const map = await fixtureMap();
  const sourceMap = structuredClone(map);
  sourceMap.routes.find((row) => row.routePattern === '/admin/ai-provider').pageApis = [];
  const root = await materializeFixture(sourceMap, { omitPage: 'apps/web/app/admin/users/page.tsx' });
  const broken = structuredClone(map);
  broken.inherited.root.actions.push('logoutAction');
  const result = await verifyScreenApiMap({ rootDir: root, map: broken });
  const errorCodes = codes(result);

  assert.equal(result.ok, false);
  assert.ok(errorCodes.has('route-not-found'));
  assert.ok(errorCodes.has('inherited-duplicate'));
  assert.ok(errorCodes.has('page-api-missing'));
});

test('endpoint method/path, exact wire keys, and client projection are checked independently', async () => {
  const map = await fixtureMap();
  const root = await materializeFixture(map);
  const broken = structuredClone(map);
  const me = broken.endpoints.find((endpoint) => endpoint.method === 'GET' && endpoint.path === '/me');
  me.wireKeys = ['id', 'orgId', 'email'];
  me.projectionKeys = ['id', 'lastProgramType', 'unexpected'];
  broken.routes.find((row) => row.routePattern === '/').pageApis[0].path = '/wrong-me';
  const result = await verifyScreenApiMap({ rootDir: root, map: broken });
  const errorCodes = codes(result);

  assert.equal(result.ok, false);
  assert.ok(errorCodes.has('endpoint-wire-keys-mismatch'));
  assert.ok(errorCodes.has('endpoint-projection-mismatch'));
  assert.ok(errorCodes.has('endpoint-method-path-mismatch'));
});

test('redirect exceptions are explicit and public/Preview Actor boundaries stay distinct', async () => {
  const map = await fixtureMap();
  const root = await materializeFixture(map, { publicAccessLeak: true });
  const result = await verifyScreenApiMap({ rootDir: root, map });
  const errorCodes = codes(result);

  assert.equal(result.ok, false);
  assert.ok(errorCodes.has('public-auth-leak'));
  assert.deepEqual(result.redirectExceptions, [
    { routePattern: '/', allowed: ['GET /me'], reason: 'destination prerequisite' },
    { routePattern: '/programs/:programType/schedule/all', allowed: [], reason: 'canonical redirect' },
  ]);
  assert.deepEqual(result.actorSurfaces.publicJoin, {
    actor: 'none-or-preview-actor',
    credentials: ['participant-or-worker-token', 'ccc_preview in preview mode'],
    forbidden: ['CF_Authorization', 'Bearer', 'business shell'],
  });
  assert.deepEqual(result.actorSurfaces.publicPreview, { actor: 'none', credentials: ['code'], unlock: 'ccc_preview' });
});

test('orphan endpoints, PII authorization matrix, and declared current gaps remain visible', async () => {
  const map = await fixtureMap();
  const root = await materializeFixture(map);
  const result = await verifyScreenApiMap({ rootDir: root, map });

  assert.deepEqual(result.orphans.map((row) => `${row.method} ${row.path}`), [
    'GET /health',
    'POST /cases/:id/pilot-text-ai-consent',
  ]);
  assert.deepEqual(result.piiMatrix, map.pii);
  assert.deepEqual(result.gaps, map.gaps);
  assert.equal(result.implementedGaps?.length ?? 0, 0);
});

test('real-repository smoke uses the same checked map without network or runtime rendering', async () => {
  const map = await fixtureMap();
  const result = await verifyScreenApiMap({
    rootDir: repoRoot,
    map,
    sourceRoot: 'apps/web/app',
    apiSourceRoot: 'apps/api/src',
  });

  assert.equal(typeof result.ok, 'boolean');
  assert.equal(result.observed.routeCount, 30);
  assert.ok(result.observed.endpointCount > 0);
  assert.equal(result.observed.networkRequests, 0);
});
