import ts from 'typescript';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const PUBLIC_KINDS = new Set(['public']);
const ERROR = (code, message, extra = {}) => ({ code, message, ...extra });

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function sourceFiles(root, sourceRoot) {
  return filesBelow(resolve(root, sourceRoot));
}

function routePatternForPage(root, page) {
  const relativePage = relative(resolve(root), page).split('\\').join('/');
  const withoutRoot = relativePage.replace(/^apps\/web\/app\/?/, '').replace(/\/?page\.[^.]+$/, '');
  if (withoutRoot === '') return '/';
  return `/${withoutRoot.split('/').map((part) => /^\[.*\]$/.test(part) ? `:${part.slice(1, -1)}` : part).join('/')}`;
}

function sourcePathFromImport(importer, specifier, root) {
  if (!specifier.startsWith('.')) return null;
  const rawBase = resolve(dirname(importer), specifier);
  const extension = extname(rawBase);
  const base = SOURCE_EXTENSIONS.includes(extension) ? rawBase.slice(0, -extension.length) : rawBase;
  const candidates = [rawBase, base, ...SOURCE_EXTENSIONS.map((item) => `${base}${item}`), ...SOURCE_EXTENSIONS.map((item) => join(base, `index${item}`))];
  return candidates.find((candidate) => candidate.startsWith(resolve(root)) && candidate !== resolve(root)) ?? null;
}

async function readSource(path) {
  return readFile(path, 'utf8').catch(() => '');
}

async function importClosure(entry, root) {
  const seen = new Set();
  const result = [];
  async function visit(path) {
    if (!path || seen.has(path)) return;
    seen.add(path);
    const text = await readSource(path);
    result.push({ path, text });
    const imports = [];
    walk(astFile({ path, text }), (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        imports.push(node.moduleSpecifier.text);
      }
    });
    for (const specifier of imports) await visit(sourcePathFromImport(path, specifier, root));
  }
  await visit(entry);
  return result;
}

function normalizePath(path) {
  let normalized = String(path).replace(/\\/g, '/');
  normalized = normalized.replace(/\$\{[^}]+\}/g, ':id');
  normalized = normalized.replace(/\/+/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function parseJson(value, fallback) {
  try { return JSON.parse(value); } catch { return fallback; }
}

function scriptKind(path) {
  return path.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function astFile(file) {
  return ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, scriptKind(file.path));
}

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

function functionNodes(source) {
  const result = [];
  walk(source, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) result.push({ name: node.name.text, node });
    if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      result.push({ name: node.name.text, node: node.initializer });
    }
  });
  return result;
}

function literalText(node) {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => `:param${span.literal.text}`).join('');
  return null;
}

function objectKeys(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  return node.properties.flatMap((property) => {
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) {
      if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) return [property.name.text];
    }
    return [];
  });
}

function callsInNode(node) {
  const calls = [];
  walk(node, (candidate) => {
    if (ts.isCallExpression(candidate) && ts.isIdentifier(candidate.expression)) calls.push(candidate);
  });
  return calls;
}
function referencedIdentifiers(source, names) {
  const found = new Set();
  walk(source, (node) => {
    if (ts.isIdentifier(node) && names.has(node.text)) found.add(node.text);
  });
  return found;
}


function apiCallFromExpression(call, apiFunctions) {
  if (!ts.isIdentifier(call.expression)) return null;
  const endpoint = apiFunctions.get(call.expression.text);
  return endpoint ? { ...endpoint } : null;
}

function apiCallsInAst(source, apiFunctions) {
  const calls = [];
  for (const call of callsInNode(source)) {
    const endpoint = apiCallFromExpression(call, apiFunctions);
    if (endpoint) calls.push(endpoint);
  }
  return calls;
}

function parseApiFunctions(files) {
  const functions = new Map();
  for (const file of files) {
    if (!file.path.includes('/lib/api.') && !file.path.endsWith('/api.ts')) continue;
    const source = astFile(file);
    for (const { name, node } of functionNodes(source)) {
      const request = callsInNode(node).find((call) => ts.isIdentifier(call.expression)
        && ['requestJson', 'jsonRequest', 'fetchApi'].includes(call.expression.text));
      if (!request) continue;
      let path = literalText(request.arguments[0]);
      if (!path && request.arguments[0] && ts.isCallExpression(request.arguments[0])) {
        path = literalText(request.arguments[0].arguments[0]);
      }
      if (!path) continue;
      const method = literalText(request.arguments[1]) ?? (() => {
        const init = request.arguments[1];
        if (!init || !ts.isObjectLiteralExpression(init)) return 'GET';
        const methodProperty = init.properties.find((property) => ts.isPropertyAssignment(property)
          && ts.isIdentifier(property.name) && property.name.text === 'method');
        return literalText(methodProperty?.initializer) ?? 'GET';
      })();
      let projectionKeys;
      for (const statement of node.body?.statements ?? []) {
        if (!ts.isReturnStatement(statement)) continue;
        projectionKeys = objectKeys(statement.expression);
        if (projectionKeys) break;
      }
      functions.set(name, { name, method, path: normalizePath(path), projectionKeys });
    }
  }
  return functions;
}

function apiCallsIn(text, apiFunctions) {
  return apiCallsInAst(ts.createSourceFile('__inline.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), apiFunctions);
}

function parseActionFunctions(files, apiFunctions) {
  const actions = new Map();
  for (const file of files) {
    if (!file.path.endsWith('/actions.ts') && !file.path.endsWith('/actions.js')) continue;
    for (const { name, node } of functionNodes(astFile(file))) {
      actions.set(name, { name, calls: apiCallsInAst(node, apiFunctions), file: file.path });
    }
  }
  return actions;
}

function allCallsForAction(action) {
  return action?.calls ?? [];
}

function duplicates(values) {
  const seen = new Set();
  const result = new Set();
  for (const value of values) {
    if (seen.has(value)) result.add(value);
    seen.add(value);
  }
  return result;
}

function sameKeys(left = [], right = []) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function parseRequestHandlerEndpoints(files) {
  const endpoints = new Map();
  for (const file of files) {
    if (!file.path.endsWith('/request-handler.ts') && !file.path.endsWith('/request-handler.js') && !file.path.endsWith('/index.ts')) continue;
    const source = astFile(file);
    walk(source, (node) => {
      if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)
        || node.expression.name.text !== 'register' || node.arguments.length < 3) return;
      const method = literalText(node.arguments[0]);
      const path = literalText(node.arguments[1]);
      if (!method || !path) return;
      const callback = node.arguments[2];
      let wireKeys = ts.isArrowFunction(callback) ? objectKeys(callback.body) : null;
      if (!wireKeys) {
        walk(callback, (candidate) => {
          if (!ts.isReturnStatement(candidate) || wireKeys) return;
          wireKeys = objectKeys(candidate.expression);
        });
      }
    });
    walk(source, (node) => {
      if (!ts.isIfStatement(node)) return;
      const literals = [];
      walk(node.expression, (candidate) => {
        if (!ts.isBinaryExpression(candidate) || candidate.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken) return;
        const left = ts.isIdentifier(candidate.left)
          ? candidate.left.text
          : ts.isPropertyAccessExpression(candidate.left) ? candidate.left.name.text : '';
        const right = literalText(candidate.right);
        if ((left === 'method' || left === 'pathname' || left === 'path') && right) literals.push([left, right]);
      });
      const method = literals.find(([name]) => name === 'method')?.[1];
      const path = literals.find(([name]) => name === 'pathname' || name === 'path')?.[1];
      if (!method || !path) return;
      let wireKeys = null;
      walk(node.thenStatement, (candidate) => {
        if (!ts.isReturnStatement(candidate) || wireKeys) return;
        wireKeys = objectKeys(candidate.expression);
      });
      endpoints.set(`${method} ${normalizePath(path)}`, { method, path: normalizePath(path), wireKeys });
    });
  }
  return endpoints;
}

function expectedEndpoint(map, method, path) {
  const normalized = normalizePath(path);
  return map.endpoints.find((endpoint) => endpoint.method === method && normalizePath(endpoint.path) === normalized);
}
function addError(errors, code, message, extra = {}) {
  errors.push(ERROR(code, message, extra));
}

function routeUsesPublicCredentials(routeFiles) {
  const text = routeFiles.map((file) => file.text).join('\n');
  return /accessHeaders|CF_Authorization|Bearer|OrganizationProfile|new-signup-count|AppHeader|AppSidebar/.test(text);
}

function routeActionNames(pageText, actionFunctions) {
  const identifiers = referencedIdentifiers(
    astFile({ path: '__page.tsx', text: pageText }),
    new Set(actionFunctions.keys()),
  );
  return [...identifiers];
}

function routeByPage(map, page) {
  return map.routes.find((route) => route.page === page);
}

function inheritedSurface(map, route, rootFiles, adminFiles, shellActions) {
  if (PUBLIC_KINDS.has(route.kind)) return { root: { apis: [], actions: [] }, admin: { apis: [] } };
  const rootApis = map.inherited.root.apis.map((api) => ({ ...api }));
  const adminApis = route.routePattern === '/admin' || route.routePattern.startsWith('/admin/')
    ? map.inherited.admin.apis.map((api) => ({ ...api }))
    : [];
  const actions = [...new Set(shellActions)];
  return { root: { apis: rootApis, actions }, admin: { apis: adminApis } };
}

function actorSurfaces() {
  return {
    publicJoin: {
      actor: 'none-or-preview-actor',
      credentials: ['participant-or-worker-token', 'ccc_preview in preview mode'],
      forbidden: ['CF_Authorization', 'Bearer', 'business shell'],
    },
    publicPreview: { actor: 'none', credentials: ['code'], unlock: 'ccc_preview' },
  };
}

export async function verifyScreenApiMap({ rootDir, map, sourceRoot = map?.sourceRoot ?? 'apps/web/app', apiSourceRoot = map?.apiSourceRoot ?? 'apps/api/src' } = {}) {
  if (!map || !Array.isArray(map.routes) || !Array.isArray(map.endpoints)) {
    throw new TypeError('verifyScreenApiMap requires a machine-readable S3 map');
  }
  const root = resolve(rootDir ?? process.cwd());
  const errors = [];
  const webFiles = await sourceFiles(root, sourceRoot);
  const allFiles = [...webFiles, ...(await sourceFiles(root, apiSourceRoot))];
  const sourceByPath = new Map();
  for (const path of allFiles) sourceByPath.set(path, { path, text: await readSource(path) });
  const pagePaths = webFiles.filter((path) => /\/page\.tsx$/.test(path));
  const pageSet = new Set(pagePaths.map((path) => routePatternForPage(root, path)));
  const mapRouteSet = new Set();
  for (const route of map.routes) {
    if (mapRouteSet.has(route.routePattern)) addError(errors, 'route-duplicate', `duplicate routePattern ${route.routePattern}`, { routePattern: route.routePattern });
    mapRouteSet.add(route.routePattern);
    const pagePath = resolve(root, route.page);
    if (!sourceByPath.has(pagePath)) addError(errors, 'route-not-found', `route page not found: ${route.page}`, { routePattern: route.routePattern });
  }
  for (const actual of pageSet) {
    if (!mapRouteSet.has(actual)) addError(errors, 'route-unmapped', `page is absent from map: ${actual}`, { routePattern: actual });
  }

  const apiFunctions = parseApiFunctions([...sourceByPath.values()]);
  const actionFunctions = parseActionFunctions([...sourceByPath.values()], apiFunctions);
  const handlerEndpoints = parseRequestHandlerEndpoints([...sourceByPath.values()]);
  const rootLayout = sourceByPath.get(resolve(root, sourceRoot, 'layout.tsx'));
  const rootClosure = rootLayout ? await importClosure(rootLayout.path, root) : [];
  const adminLayout = sourceByPath.get(resolve(root, sourceRoot, 'admin/layout.tsx'));
  const adminClosure = adminLayout ? await importClosure(adminLayout.path, root) : [];
  const shellNames = new Set(['toggleThemeAction', 'logoutAction']);
  const rootShellActions = rootClosure.flatMap((file) => [...referencedIdentifiers(astFile(file), shellNames)]);
  const rootApiCalls = rootClosure.filter((file) => !file.path.endsWith('/lib/api.ts')).flatMap((file) => apiCallsIn(file.text, apiFunctions));
  const adminApiCalls = adminClosure.filter((file) => !file.path.endsWith('/lib/api.ts')).flatMap((file) => apiCallsIn(file.text, apiFunctions));
  const inheritedDuplicates = duplicates(map.inherited.root.actions ?? []);
  for (const duplicate of inheritedDuplicates) addError(errors, 'inherited-duplicate', `root inherited action appears more than once: ${duplicate}`);

  const observedShellActions = rootShellActions;
  const routes = [];
  for (const route of map.routes) {
    const pagePath = resolve(root, route.page);
    const pageSource = sourceByPath.get(pagePath)?.text ?? '';
    const closure = sourceByPath.has(pagePath) ? await importClosure(pagePath, root) : [];
    const closureText = closure.map((file) => file.text).join('\n');
    const inherited = inheritedSurface(map, route, rootClosure, adminClosure, observedShellActions);
    const directPageApis = apiCallsIn(pageSource, apiFunctions);
    const pageActions = routeActionNames(pageSource, actionFunctions);
    const actionApis = pageActions.flatMap((name) => allCallsForAction(actionFunctions.get(name), apiFunctions));
    const observedCalls = [...directPageApis, ...actionApis];
    const expectedCalls = [...(route.pageApis ?? []), ...(route.actions ?? []).flatMap((action) => action.calls ?? [])];
    for (const expected of expectedCalls) {
      const matched = observedCalls.some((observed) => observed.method === expected.method && observed.path === normalizePath(expected.path));
      if (!matched) addError(errors, 'page-api-missing', `${route.routePattern} omits ${expected.method} ${expected.path}`, { routePattern: route.routePattern, endpoint: `${expected.method} ${expected.path}` });
      if (!expectedEndpoint(map, expected.method, expected.path) && !map.endpoints.some((endpoint) => normalizePath(endpoint.path) === normalizePath(expected.path))) {
      }
    }
    for (const observed of observedCalls) {
      const expected = expectedCalls.find((candidate) => candidate.method === observed.method && normalizePath(candidate.path) === observed.path);
      if (!expected) addError(errors, 'page-api-unmapped', `${route.routePattern} calls ${observed.method} ${observed.path} outside its map row`, { routePattern: route.routePattern });
    }
    if (PUBLIC_KINDS.has(route.kind) && routeUsesPublicCredentials(closure.filter((file) => !file.path.endsWith('/lib/api.ts')))) {
      addError(errors, 'public-auth-leak', `${route.routePattern} includes Access/Bearer/business-shell surface`, { routePattern: route.routePattern });
    }
    routes.push({
      ...route,
      inherited,
      observed: { pageApis: directPageApis, actions: pageActions, calls: observedCalls },
      sourceFound: sourceByPath.has(pagePath),
    });
  }

  // The web adapter is a route handler, not a 31st page. Check it against its explicit map rows.
  const routeHandlerPath = resolve(root, sourceRoot, 'preview/unlock/route.ts');
  const routeHandler = sourceByPath.get(routeHandlerPath);
  const previewRoutes = map.routes.filter((route) => route.routeHandler);
  if (!routeHandler && previewRoutes.length > 0) {
    addError(errors, 'route-handler-missing', 'declared preview unlock route handler is absent');
  }
  if (routeHandler && previewRoutes.length > 0) {
    const handlerCalls = apiCallsIn(routeHandler.text, apiFunctions);
    const expectedHandlerCalls = previewRoutes.flatMap((route) => route.routeHandler.calls ?? []);
    for (const expected of expectedHandlerCalls) {
      if (!handlerCalls.some((observed) => observed.path === normalizePath(expected.path))) addError(errors, 'route-handler-api-missing', `preview unlock handler omits ${expected.method} ${expected.path}`);
    }
  }

  const endpointObservations = [];
  for (const endpoint of map.endpoints) {
    const key = `${endpoint.method} ${normalizePath(endpoint.path)}`;
    const observed = handlerEndpoints.get(key);
    const apiProjection = [...apiFunctions.values()].find((candidate) => candidate.method === endpoint.method && candidate.path === normalizePath(endpoint.path) && candidate.projectionKeys !== undefined);
    if (observed) {
      endpointObservations.push({ ...endpoint, observedWireKeys: observed.wireKeys });
      if (observed.wireKeys && !sameKeys(endpoint.wireKeys, observed.wireKeys)) addError(errors, 'endpoint-wire-keys-mismatch', `${key} wire keys differ`, { endpoint: key });
    }
    if (!observed) addError(errors, 'endpoint-method-path-mismatch', `${key} is not implemented by request handler`, { endpoint: key });
    if (apiProjection?.projectionKeys && !sameKeys(endpoint.projectionKeys, apiProjection.projectionKeys)) {
      addError(errors, 'endpoint-projection-mismatch', `${key} client projection differs`, { endpoint: key });
    }
    if (!observed && !map.endpoints.some((candidate) => candidate.method === endpoint.method && normalizePath(candidate.path) === normalizePath(endpoint.path))) {
      addError(errors, 'endpoint-method-path-mismatch', `${key} method/path differs`, { endpoint: key });
    }
  }
  // A route call with a changed method/path must be visible even when the changed path has no catalog row.
  for (const route of map.routes) {
    for (const call of [...(route.pageApis ?? []), ...(route.actions ?? []).flatMap((action) => action.calls ?? [])]) {
      if (!expectedEndpoint(map, call.method, call.path) && !map.endpoints.some((endpoint) => normalizePath(endpoint.path) === normalizePath(call.path))) {
        addError(errors, 'endpoint-method-path-mismatch', `${route.routePattern} endpoint identity is not in catalog`, { routePattern: route.routePattern });
      }
    }
  }

  const summary = {
    routes: map.routes.length,
    operating: map.routes.filter((route) => route.kind === 'screen').length,
    public: map.routes.filter((route) => route.kind === 'public').length,
    redirect: map.routes.filter((route) => route.kind === 'redirect').length,
    kit: map.routes.filter((route) => route.kind === 'kit').length,
  };
  const redirectExceptions = [
    { routePattern: '/', allowed: ['GET /me'], reason: 'destination prerequisite' },
    { routePattern: '/programs/:programType/schedule/all', allowed: [], reason: 'canonical redirect' },
  ];
  const orphans = map.endpoints.filter((endpoint) => endpoint.status === 'unmapped-by-current-page').map((endpoint) => ({ ...endpoint }));
  return {
    ok: errors.length === 0,
    summary,
    routes,
    errors,
    orphans,
    piiMatrix: (map.pii ?? []).map((row) => ({ ...row })),
    gaps: (map.gaps ?? []).map((gap) => ({ ...gap })),
    implementedGaps: [],
    redirectExceptions,
    actorSurfaces: actorSurfaces(),
    endpointObservations,
    observed: {
      routeCount: pagePaths.length,
      endpointCount: handlerEndpoints.size,
      networkRequests: 0,
      rootApiCalls,
      adminApiCalls,
    },
  };
}

export default verifyScreenApiMap;
