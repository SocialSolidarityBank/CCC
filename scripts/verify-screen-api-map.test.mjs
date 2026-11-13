import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';

import { verifyScreenApiMap } from './verify-screen-api-map.mjs';

const repoRoot = resolve(new URL('..', import.meta.url).pathname);
const fixturePath = new URL('./fixtures/e2-1-screen-api-fixture.json', import.meta.url);

async function fixtureMap() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

function callKey(call) {
  return `${call.method} ${call.path}`;
}

function parseKeySpec(raw) {
  let value = raw;
  let nullable = false;
  let optional = false;
  if (value.endsWith('|null')) {
    nullable = true;
    value = value.slice(0, -5);
  }
  if (value.endsWith('?')) {
    optional = true;
    value = value.slice(0, -1);
  }
  return {
    segments: value.split('.').map((segment) => ({ name: segment.replace(/\[\]$/, ''), array: segment.endsWith('[]') })),
    nullable,
    optional,
  };
}

function contractTree(keys) {
  const root = { children: new Map(), array: false, nullable: false, optional: false };
  for (const raw of keys) {
    const spec = parseKeySpec(raw);
    let current = root;
    for (let index = 0; index < spec.segments.length; index += 1) {
      const segment = spec.segments[index];
      if (!current.children.has(segment.name)) current.children.set(segment.name, { children: new Map(), array: false, nullable: false, optional: false });
      current = current.children.get(segment.name);
      current.array ||= segment.array;
      if (index === spec.segments.length - 1) {
        current.nullable = spec.nullable;
        current.optional = spec.optional;
      }
    }
  }
  return root;
}

function typeForNode(node) {
  const base = node.children.size === 0
    ? 'string'
    : `{ ${[...node.children].map(([name, child]) => `${JSON.stringify(name)}${child.optional ? '?' : ''}: ${typeForNode(child)}`).join('; ')} }`;
  const array = node.array ? `Array<${base}>` : base;
  return node.nullable ? `${array} | null` : array;
}

function expressionForNode(node) {
  let base;
  if (node.children.size === 0) base = node.nullable ? 'null' : "'value'";
  else base = `{ ${[...node.children].map(([name, child]) => `${JSON.stringify(name)}: ${expressionForNode(child)}`).join(', ')} }`;
  return node.array ? `[${base}]` : base;
}

function contractType(kind, keys) {
  if (kind === 'void') return 'void';
  if (kind === 'scalar') return 'number';
  const object = keys.length === 0 ? '{}' : typeForNode(contractTree(keys));
  return kind === 'array' ? `Array<${object}>` : object;
}

function contractExpression(kind, keys) {
  if (kind === 'void') return '';
  if (kind === 'scalar') return '1';
  const object = keys.length === 0 ? '{}' : expressionForNode(contractTree(keys));
  return kind === 'array' ? `[${object}]` : object;
}

function validTypeName(value) {
  const match = /^([A-Za-z_$][\w$]*)(\[\])?$/.exec(value ?? '');
  return match ? { name: match[1], array: Boolean(match[2]) } : null;
}

function importSpecifier(fromDirectory, target) {
  const value = relative(fromDirectory, target).replace(/\\/g, '/').replace(/\.(ts|tsx)$/, '');
  return value.startsWith('.') ? value : `./${value}`;
}

function headerObject(headers) {
  return `{ ${headers.map((header) => {
    const separator = header.indexOf(':');
    return `${JSON.stringify(header.slice(0, separator))}: ${JSON.stringify(header.slice(separator + 1))}`;
  }).join(', ')} }`;
}

async function materializeFixture(map, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ccc-e2-1-'));
  const apiPath = join(root, 'apps/web/app/lib/api.ts');
  const actionsPath = join(root, 'apps/web/app/actions.ts');
  const endpointByClient = new Map();
  for (const endpoint of map.endpoints) {
    for (const projection of endpoint.projections) {
      if (projection.client) endpointByClient.set(projection.client, { endpoint, projection });
    }
  }

  const declarations = new Map();
  for (const { projection } of endpointByClient.values()) {
    const named = validTypeName(projection.sourceDto);
    if (!named || ['void', 'number'].includes(named.name)) continue;
    const declaration = contractType(projection.projectionKind, projection.projectionKeys);
    const base = named.array && declaration.startsWith('Array<') ? declaration.slice(6, -1) : declaration;
    if (!declarations.has(named.name)) declarations.set(named.name, base);
  }
  if (options.dtoMutation) declarations.set('WrongIdentity', declarations.get('MyIdentity'));
  if (options.projectionMutation) declarations.set('OrganizationProfile', `${declarations.get('OrganizationProfile')} & { projectionMutation: string }`);
  if (options.projectionKindMutation) declarations.set('OrganizationProfile', `Array<${declarations.get('OrganizationProfile')}>`);
  if (options.emptyObjectProjectionMutation) declarations.set('EmptyObject', `{ unexpected: string }`);
  if (options.projectionNullMutation) declarations.set('MyIdentity', declarations.get('MyIdentity').replace(' | null', ''));

  const apiFunctions = [];
  for (const [client, { endpoint, projection }] of endpointByClient) {
    const returnType = options.dtoMutation && client === 'getMyIdentity' ? 'WrongIdentity' : projection.sourceDto;
    const request = projection.auth === 'public-token' || projection.auth === 'public-code'
      ? `const requestHeaders = new Headers(${headerObject(projection.headers)}); await fetchApi(endpoint(${JSON.stringify(endpoint.path)}), { method: ${JSON.stringify(endpoint.method)}, headers: requestHeaders });`
      : `await requestJson(${JSON.stringify(endpoint.path)}, { method: ${JSON.stringify(endpoint.method)} });`;
    const expression = contractExpression(projection.projectionKind, projection.projectionKeys);
    const body = projection.projectionKind === 'void'
      ? `${request} return;`
      : `${request} const result: ${returnType} = ${expression}; return result;`;
    const exported = client === 'loadScheduleSessionPlan' ? '' : 'export ';
    apiFunctions.push(`${exported}async function ${client}(): Promise<${returnType}> { ${body} }`);
  }
  const apiSource = [
    ...[...declarations].map(([name, body]) => `export type ${name} = ${body};`),
    `async function accessHeaders(): Promise<Headers> { return new Headers({ accept: 'application/json' }); }`,
    `async function requestJson(path: string, init: object): Promise<unknown> { await accessHeaders(); return { path, init }; }`,
    `function endpoint(path: string): URL { return new URL(path, 'https://example.invalid'); }`,
    `async function fetchApi(url: URL, init: object): Promise<unknown> { return { url, init }; }`,
    ...apiFunctions,
  ].join('\n');

  const actions = new Map();
  for (const route of map.routes) {
    for (const action of [...route.pageActions, ...route.componentActions.flatMap((surface) => surface.actions)]) actions.set(action.name, action);
  }
  const actionClients = [...new Set([...actions.values()].flatMap((action) => action.calls.map((call) => call.client)))];
  const actionSource = [
    `import { ${actionClients.join(', ')} } from './lib/api';`,
    ...[...actions.values()].map((action) => `export async function ${action.name}(): Promise<void> { ${action.calls.map((call) => `await ${call.client}();`).join(' ')} }`),
  ].join('\n');

  const componentFiles = new Map();
  function componentSource(component, componentActions) {
    const fullPath = join(root, 'apps/web/app', component);
    const specifier = importSpecifier(dirname(fullPath), actionsPath);
    const names = componentActions.map((action) => action.name);
    const componentName = `Component${componentFiles.size}`;
    return {
      fullPath,
      componentName,
      source: `import { ${names.join(', ')} } from ${JSON.stringify(specifier)}; export function ${componentName}() { ${names.map((name) => `void ${name};`).join(' ')} return <div>${names.map((name) => `<form action={${name}} />`).join('')}</div>; }`,
    };
  }
  for (const route of map.routes) {
    for (const surface of route.componentActions) componentFiles.set(surface.component, componentSource(surface.component, surface.actions));
  }
  for (const surface of map.inherited.root.componentActions) componentFiles.set(surface.component, componentSource(surface.component, surface.actions));

  const displayLabelsPath = join(root, 'apps/web/app/lib/display-labels.ts');
  const rootLoaderClient = map.inherited.root.pageLoaderCalls.find((call) => call.path === '/organization/profile').client;
  const displayLabelsSource = `import { ${rootLoaderClient} } from './api'; export async function getDisplayLabels() { return ${rootLoaderClient}(); }`;
  const rootComponents = map.inherited.root.componentActions.map((surface) => componentFiles.get(surface.component));
  const rootLayoutSource = [
    `import { getDisplayLabels } from './lib/display-labels';`,
    `import { getNewSignupCount } from './lib/api';`,
    ...rootComponents.map((component) => `import { ${component.componentName} } from ${JSON.stringify(importSpecifier(join(root, 'apps/web/app'), component.fullPath))};`),
    `export default async function RootLayout({ children }) { const hdrs = new Headers(); const isPublic = hdrs.get('x-ccc-public') === '1'; if (isPublic) return children; await getDisplayLabels(); await getNewSignupCount(); return <div>${rootComponents.map((component) => `<${component.componentName} />`).join('')}{children}</div>; }`,
  ].join('\n');
  const adminLayoutSource = `import { getMyIdentity } from '../lib/api'; export default async function AdminLayout({ children }) { await getMyIdentity(); return children; }`;

  for (const [index, route] of map.routes.entries()) {
    const pagePath = join(root, route.page);
    const apiClients = [...new Set(route.pageLoaderCalls.map((call) => call.client))];
    const pageActionNames = route.pageActions.map((action) => action.name);
    const imports = [];
    if (apiClients.length > 0) imports.push(`import { ${apiClients.join(', ')} } from ${JSON.stringify(importSpecifier(dirname(pagePath), apiPath))};`);
    if (pageActionNames.length > 0 && !(options.crossSurfaceSubstitution && route.routePattern === '/settings')) {
      imports.push(`import { ${pageActionNames.join(', ')} } from ${JSON.stringify(importSpecifier(dirname(pagePath), actionsPath))};`);
    }
    const rendered = [];
    for (const surface of route.componentActions) {
      const component = componentFiles.get(surface.component);
      imports.push(`import { ${component.componentName} } from ${JSON.stringify(importSpecifier(dirname(pagePath), component.fullPath))};`);
      rendered.push(`<${component.componentName} />`);
    }
    if (options.crossSurfaceSubstitution && route.routePattern === '/settings') {
      const moved = componentSource('settings/action-substitute.tsx', route.pageActions);
      componentFiles.set('settings/action-substitute.tsx', moved);
      imports.push(`import { ${moved.componentName} } from ${JSON.stringify(importSpecifier(dirname(pagePath), moved.fullPath))};`);
      rendered.push(`<${moved.componentName} />`);
    }
    const calls = apiClients.map((client) => `await ${client}();`).join(' ');
    const directActions = pageActionNames.map((name) => `void ${name};`).join(' ');
    const source = `${imports.join('\n')} export default async function Page${index}() { ${calls} ${directActions} return <main>${rendered.join('')}</main>; }`;
    await mkdir(dirname(pagePath), { recursive: true });
    await writeFile(pagePath, source);
  }

  const gatewayCalls = new Map();
  const guards = new Set();
  const endpointGateways = new Map();
  for (const row of map.pii) {
    for (const trace of row.traces) {
      const endpointKey = callKey(trace);
      const names = endpointGateways.get(endpointKey) ?? new Set();
      for (const gateway of trace.gatewayFunctions) {
        names.add(gateway);
        const calls = gatewayCalls.get(gateway) ?? new Set();
        for (const guard of trace.guardSymbols) {
          calls.add(guard);
          guards.add(guard);
        }
        gatewayCalls.set(gateway, calls);
      }
      endpointGateways.set(endpointKey, names);
    }
  }
  if (options.actorMutation) {
    const target = [...gatewayCalls.values()].find((called) => called.has('assertAdmin'));
    target?.delete('assertAdmin');
    target?.add('assertUnauthorizedActor');
    guards.add('assertUnauthorizedActor');
  }
  const gatewaySource = [
    ...[...guards].map((guard) => `function ${guard}(): void {}`),
    ...[...gatewayCalls].map(([gateway, called]) => `export async function ${gateway}(): Promise<void> { ${[...called].map((guard) => `${guard}();`).join(' ')} }`),
  ].join('\n');

  const handlerBranches = map.endpoints.map((endpoint, index) => {
    const pathOnly = endpoint.path.split('?')[0];
    const query = endpoint.path.includes('official=true')
      ? ` requestQuery(url, ['official']);`
      : endpoint.path.includes('focusSupportCaseId=') ? ` requestQuery(url, ['focusSupportCaseId']);` : '';
    const gateways = [...(endpointGateways.get(callKey(endpoint)) ?? [])].map((name) => `await ${name}();`).join(' ');
    if (endpoint.responseKind === 'void') {
      return `if (request.method === ${JSON.stringify(endpoint.method)} && url.pathname === ${JSON.stringify(pathOnly)}) {${query} ${gateways} return new Response(null, { status: 204 }); }`;
    }
    if (endpoint.responseKind === 'binary-or-object') {
      const errorType = contractType('object', endpoint.wireKeys);
      const errorBody = contractExpression('object', endpoint.wireKeys);
      return `if (request.method === ${JSON.stringify(endpoint.method)} && url.pathname === ${JSON.stringify(pathOnly)}) { ${gateways} if (request.headers.get('x-missing') === '1') { const missing${index}: ${errorType} = ${errorBody}; return json(missing${index}, 404); } return new Response(new Uint8Array(), { status: 200 }); }`;
    }
    let wireKeys = options.unauthorizedPiiMutation && endpoint.method === 'GET' && endpoint.path === '/invites/participant/:token'
      ? [...endpoint.wireKeys, 'email']
      : endpoint.wireKeys;
    if (options.emptyObjectWireMutation && endpoint.method === 'GET' && endpoint.path === '/health') {
      wireKeys = ['unexpected'];
    }
    if (options.wireNullMutation && endpoint.method === 'GET' && endpoint.path === '/me') {
      wireKeys = wireKeys.map((key) => key === 'lastProgramType|null' ? 'lastProgramType' : key);
    }
    const observedKind = options.wireKindMutation && endpoint.method === 'GET' && endpoint.path === '/health'
      ? 'array'
      : endpoint.responseKind;
    const type = contractType(observedKind, wireKeys);
    const body = contractExpression(observedKind, wireKeys);
    return `if (request.method === ${JSON.stringify(endpoint.method)} && url.pathname === ${JSON.stringify(pathOnly)}) {${query} ${gateways} const body${index}: ${type} = ${body}; return json(body${index}); }`;
  });
  let handlerSource = `function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status }); } function requestQuery(url: URL, allowed: string[]): void { void url; void allowed; } export async function handleRequest(request: Request): Promise<Response> { const url = new URL(request.url); ${handlerBranches.join('\n')} return json({ error: 'not_found' }, 404); }`;
  if (options.methodPathMutation) handlerSource = handlerSource.replace(`request.method === "GET" && url.pathname === "/me"`, `request.method === "PATCH" && url.pathname === "/wrong-me"`);
  if (options.wireMutation) handlerSource = handlerSource.replace('"lastProgramType":', '"wireMutation":');

  const routeHandlerPath = join(root, 'apps/web/app/preview/unlock/route.ts');
  const routeHandlerSource = `import { requestPreviewUnlock } from '../../lib/api'; export async function POST() { return requestPreviewUnlock(); }`;

  const files = new Map([
    [apiPath, apiSource],
    [actionsPath, actionSource],
    [join(root, 'apps/web/app/theme-action.ts'), `export async function toggleThemeAction(): Promise<void> {}`],
    [join(root, 'apps/web/app/logout-action.ts'), `export async function logoutAction(): Promise<void> {}`],
    [displayLabelsPath, displayLabelsSource],
    [join(root, 'apps/web/app/layout.tsx'), rootLayoutSource],
    [join(root, 'apps/web/app/admin/layout.tsx'), adminLayoutSource],
    [routeHandlerPath, routeHandlerSource],
    [join(root, 'apps/api/src/request-handler.ts'), handlerSource],
    [join(root, 'db/gateway.ts'), gatewaySource],
  ]);
  for (const component of componentFiles.values()) files.set(component.fullPath, component.source);
  for (const [filePath, source] of files) {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, source);
  }
  return root;
}

function codes(result) {
  return new Set(result.errors.map((error) => error.code));
}

test('checked map has explicit complete route, endpoint, response, projection, and PII counts', async () => {
  const map = await fixtureMap();
  const inventory = JSON.parse(await readFile(new URL('./design/route-inventory.json', import.meta.url), 'utf8'));

  assert.deepEqual(map.routes.map(({ page, routePattern }) => ({ page, routePattern })), inventory.routes.map(({ page, routePattern }) => ({ page, routePattern })));
  assert.deepEqual(map.counts, { routes: 30, operating: 22, public: 5, redirect: 2, kit: 1, endpoints: 93, piiFields: 47 });
  assert.equal(map.endpoints.length, 93);
  assert.equal(map.pii.length, 47);
  assert.ok(map.endpoints.every((endpoint) => typeof endpoint.responseKind === 'string' && Array.isArray(endpoint.wireKeys) && endpoint.projections.length > 0));
  assert.ok(map.endpoints.every((endpoint) => endpoint.projections.every((projection) => typeof projection.projectionKind === 'string' && Array.isArray(projection.projectionKeys))));
  assert.deepEqual(map.endpoints.filter((endpoint) => endpoint.responseKind === 'void').map(callKey).sort(), [
    'POST /pipeline/jobs/:sessionId/result',
    'POST /pipeline/text-jobs/:item/complete',
  ]);
  assert.equal(JSON.stringify(map).includes('"fixture":'), false);

  const activation = map.endpoints.find((endpoint) => callKey(endpoint) === 'POST /ai/provider/activate-runtime');
  assert.equal(activation.responseKind, 'object');
  assert.equal(activation.wireDto, 'AiProviderActivationWire');
  assert.deepEqual(activation.wireKeys, ['enabled', 'adapterId|null', 'adapterVersion|null', 'configHash|null', 'replayed']);
  assert.deepEqual(activation.projections.map(({ client, dto, projectionKind }) => ({ client, dto, projectionKind })), [
    { client: 'activateAiProviderRuntime', dto: 'void', projectionKind: 'void' },
  ]);
});

test('valid source preserves page, named action, rendered component, root, and admin provenance', async () => {
  const map = await fixtureMap();
  const root = await materializeFixture(map);
  const result = await verifyScreenApiMap({ rootDir: root, map });

  assert.equal(result.ok, true, result.errors.map((error) => `${error.code}: ${error.message}`).join('\n'));
  assert.deepEqual(result.summary, { routes: 30, operating: 22, public: 5, redirect: 2, kit: 1, endpoints: 93, piiFields: 47 });
  const aiProvider = result.routes.find((route) => route.routePattern === '/admin/ai-provider');
  assert.deepEqual(aiProvider.observed.pageActions, []);
  assert.deepEqual(aiProvider.observed.componentActions.map(({ component, actions }) => ({ component, actions: actions.map(({ name }) => name) })), [
    { component: 'admin/ai-provider/ai-provider-control.tsx', actions: ['activateAiProviderRuntimeAction'] },
  ]);
  assert.deepEqual(aiProvider.inherited.root.componentActions.map((surface) => surface.component), [
    'components/wire/app-header.tsx',
    'components/wire/app-sidebar.tsx',
  ]);
  assert.deepEqual(aiProvider.inherited.admin.pageLoaderCalls.map(callKey), ['GET /me']);
  const publicJoin = result.routes.find((route) => route.routePattern === '/join/participant/:token');
  assert.deepEqual(publicJoin.inherited, { root: { pageLoaderCalls: [], componentActions: [] }, admin: { pageLoaderCalls: [], componentActions: [] } });
});

test('a flattened-equivalent cross-surface action substitution is rejected', async () => {
  const map = await fixtureMap();
  const root = await materializeFixture(map, { crossSurfaceSubstitution: true });
  const result = await verifyScreenApiMap({ rootDir: root, map });

  assert.equal(result.ok, false);
  assert.ok(codes(result).has('route-action-surface-mismatch'));
});

test('method/path, DTO, wire shape, and projection mutations have distinct diagnostics', async () => {
  const map = await fixtureMap();
  const cases = [
    ['methodPathMutation', 'endpoint-method-path-mismatch'],
    ['dtoMutation', 'endpoint-dto-mismatch'],
    ['wireMutation', 'endpoint-wire-shape-mismatch'],
    ['wireKindMutation', 'endpoint-wire-shape-mismatch'],
    ['wireNullMutation', 'endpoint-wire-shape-mismatch'],
    ['projectionKindMutation', 'endpoint-projection-mismatch'],
    ['projectionNullMutation', 'endpoint-projection-mismatch'],
  ];
  for (const [option, expected] of cases) {
    const root = await materializeFixture(map, { [option]: true });
    const result = await verifyScreenApiMap({ rootDir: root, map });
    assert.ok(codes(result).has(expected), `${option}: ${result.errors.map((error) => error.code).join(',')}`);
  }

  const root = await materializeFixture(map, { projectionMutation: true });
  const projectionResult = await verifyScreenApiMap({ rootDir: root, map });
  assert.ok(codes(projectionResult).has('endpoint-projection-mismatch'));
});

test('an explicit zero-key object projection rejects an added key', async () => {
  const map = await fixtureMap();
  const activation = map.endpoints.find((endpoint) => callKey(endpoint) === 'POST /ai/provider/activate-runtime');
  Object.assign(activation.projections[0], {
    dto: 'EmptyObject',
    sourceDto: 'EmptyObject',
    projectionKind: 'object',
    projectionKeys: [],
  });
  for (const route of map.routes) {
    for (const call of [
      ...route.pageLoaderCalls,
      ...route.pageActions.flatMap((action) => action.calls),
      ...route.componentActions.flatMap((surface) => surface.actions.flatMap((action) => action.calls)),
    ]) {
      if (call.client === 'activateAiProviderRuntime') call.projectionDto = 'EmptyObject';
    }
  }

  const validRoot = await materializeFixture(map);
  const valid = await verifyScreenApiMap({ rootDir: validRoot, map });
  assert.equal(valid.ok, true, valid.errors.map((error) => `${error.code}: ${error.message}`).join('\n'));

  const mutationRoot = await materializeFixture(map, { emptyObjectProjectionMutation: true });
  const mutation = await verifyScreenApiMap({ rootDir: mutationRoot, map });
  assert.ok(codes(mutation).has('endpoint-projection-mismatch'));
});

test('an explicit zero-key wire object rejects an added key', async () => {
  const map = await fixtureMap();
  const health = map.endpoints.find((endpoint) => callKey(endpoint) === 'GET /health');
  Object.assign(health, { wireDto: 'EmptyWire', responseKind: 'object', wireKeys: [] });

  const validRoot = await materializeFixture(map);
  const valid = await verifyScreenApiMap({ rootDir: validRoot, map });
  assert.equal(valid.ok, true, valid.errors.map((error) => `${error.code}: ${error.message}`).join('\n'));

  const mutationRoot = await materializeFixture(map, { emptyObjectWireMutation: true });
  const mutation = await verifyScreenApiMap({ rootDir: mutationRoot, map });
  assert.ok(codes(mutation).has('endpoint-wire-shape-mismatch'));
});

test('all 47 PII fields trace to response routes and gateway Actor guards in both directions', async () => {
  const map = await fixtureMap();
  const root = await materializeFixture(map);
  const result = await verifyScreenApiMap({ rootDir: root, map });

  assert.deepEqual(result.observedPiiMatrix, map.pii);
  assert.equal(result.piiMatrix.length, 47);

  const unauthorizedRoot = await materializeFixture(map, { unauthorizedPiiMutation: true });
  const unauthorized = await verifyScreenApiMap({ rootDir: unauthorizedRoot, map });
  assert.ok(codes(unauthorized).has('pii-unauthorized-field'));

  const actorRoot = await materializeFixture(map, { actorMutation: true });
  const actor = await verifyScreenApiMap({ rootDir: actorRoot, map });
  assert.ok(codes(actor).has('pii-actor-guard-mismatch'));
});

test('public clients are checked from literal header names, values, and call arguments', async () => {
  const map = await fixtureMap();
  const root = await materializeFixture(map);
  const apiPath = join(root, 'apps/web/app/lib/api.ts');
  const source = await readFile(apiPath, 'utf8');
  await writeFile(apiPath, source.replace(`new Headers({ "accept": "application/json" })`, `new Headers({ "Authorization": "Bearer source-only-regression" })`));
  const result = await verifyScreenApiMap({ rootDir: root, map });

  assert.equal(result.ok, false);
  assert.ok(codes(result).has('public-auth-leak'));
  assert.ok(codes(result).has('public-header-mismatch'));
  assert.deepEqual(result.actorSurfaces.publicJoin.preview, {
    actor: 'preview-actor',
    credential: 'token+ccc_preview',
    status: 'declared-current-gap',
    forbidden: ['CF_Authorization', 'Bearer'],
  });
});

test('real-repository smoke is offline and satisfies the same checked map', async () => {
  const map = await fixtureMap();
  const result = await verifyScreenApiMap({ rootDir: repoRoot, map });

  assert.equal(result.ok, true, result.errors.map((error) => `${error.code}: ${error.message}`).join('\n'));
  assert.deepEqual(result.endpointObservations.map(({ method, path, wireDto }) => `${method} ${path} [${wireDto}]`).sort(), map.endpoints.map(({ method, path, wireDto }) => `${method} ${path} [${wireDto}]`).sort());
  assert.equal(result.observed.routeCount, 30);
  assert.equal(result.observed.networkRequests, 0);
});
