import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const PUBLIC_KINDS = new Set(['public']);
const ERROR = (code, message, extra = {}) => ({ code, message, ...extra });
const DYNAMIC = '__E2_DYNAMIC__';

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

async function sourcePathFromImport(importer, specifier, root) {
  if (!specifier.startsWith('.')) return null;
  const rawBase = resolve(dirname(importer), specifier);
  const extension = extname(rawBase);
  const base = SOURCE_EXTENSIONS.includes(extension) ? rawBase.slice(0, -extension.length) : rawBase;
  const candidates = [rawBase, base, ...SOURCE_EXTENSIONS.map((item) => `${base}${item}`), ...SOURCE_EXTENSIONS.map((item) => join(base, `index${item}`))];
  for (const candidate of candidates) {
    if (!candidate.startsWith(resolve(root)) || candidate === resolve(root)) continue;
    try { await readFile(candidate); return candidate; } catch {}
  }
  return null;
}

async function readSource(path) {
  return readFile(path, 'utf8').catch(() => '');
}

function astFile(file) {
  return ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, scriptKind(file.path));
}
function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
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
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    });
    for (const specifier of imports) await visit(await sourcePathFromImport(path, specifier, root));
  }
  await visit(entry);
  return result;
}

function scriptKind(path) {
  if (path.endsWith('.tsx') || path.endsWith('.jsx') || path.endsWith('.js')) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function literalText(node) {
  if (!node) return null;
  if (ts.isNumericLiteral(node)) return node.text;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) return node.head.text + node.templateSpans.map((span) => `${DYNAMIC}${span.literal.text}`).join('');
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalText(node.left); const right = literalText(node.right);
    return left != null && right != null ? left + right : null;
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression(node)) return literalText(node.expression);
  return null;
}

function canonicalPath(value) {
  let path = String(value ?? '').replace(/\\/g, '/');
  const [rawPath, rawQuery = ''] = path.split('?');
  const segments = rawPath.split('/').filter(Boolean).map((segment, index) => {
    if (segment.includes(DYNAMIC)) {
      const prefix = segment.slice(0, segment.indexOf(DYNAMIC));
      const suffix = segment.slice(segment.indexOf(DYNAMIC) + DYNAMIC.length);
      if (prefix && !suffix) return prefix;
      return prefix ? `${prefix}:p${index}` : `:p${index}`;
    }
    if (/^:[^/]+$/.test(segment)) return `:p${index}`;
    return segment;
  });
  let result = `/${segments.join('/')}`;
  if (rawQuery) {
    const query = rawQuery.split('&').filter(Boolean).map((part, index) => {
      const [key, ...rest] = part.split('=');
      let queryValue = rest.join('=');
      if (queryValue.includes(DYNAMIC) || /^:[^/]+$/.test(queryValue)) queryValue = `:q${index}`;
      return `${key}=${queryValue}`;
    }).sort();
    if (query.length) result += `?${query.join('&')}`;
  }
  return result;
}

function endpointKey(method, path) {
  return `${String(method ?? 'GET').toUpperCase()} ${canonicalPath(path)}`;
}

function objectKeys(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  return node.properties.flatMap((property) => {
    if (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property) || ts.isMethodDeclaration(property)) {
      if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) return [property.name.text];
    }
    return [];
  });
}

function functionNodes(source) {
  const result = [];
  walk(source, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) result.push({ name: node.name.text, node });
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) result.push({ name: node.name.text, node: node.initializer });
  });
  return result;
}

function isExportedFunction(entry) {
  if (ts.isFunctionDeclaration(entry.node)) return entry.node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
  const statement = entry.node.parent?.parent;
  return statement?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function callName(call) {
  return call && call.expression && ts.isIdentifier(call.expression) ? call.expression.text : null;
}

function callsInNode(node) {
  const calls = [];
  walk(node, (candidate) => { if (ts.isCallExpression(candidate) && callName(candidate)) calls.push(candidate); });
  return calls;
}

function unwrapExpression(expression) {
  let value = expression;
  while (value && (ts.isAwaitExpression(value) || ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isTypeAssertionExpression(value))) value = value.expression;
  return value;
}

function requestPath(call) {
  let argument = call.arguments[0];
  if (callName(call) === 'fetchApi' && argument && ts.isCallExpression(argument)) argument = argument.arguments[0];
  if (argument && ts.isCallExpression(argument) && callName(argument) === 'endpoint') argument = argument.arguments[0];
  return literalText(argument);
}

function requestMethod(call) {
  const name = callName(call);
  if (name === 'jsonRequest' || (name === 'requestJson' && literalText(call.arguments[1]) != null)) return literalText(call.arguments[1]) ?? 'GET';
  const init = call.arguments[1];
  if (!init || !ts.isObjectLiteralExpression(init)) return 'GET';
  const method = init.properties.find((property) => ts.isPropertyAssignment(property) && property.name && ts.isIdentifier(property.name) && property.name.text === 'method');
  return literalText(method?.initializer) ?? 'GET';
}

function apiRequestFromCall(call) {
  const name = callName(call);
  if (!['requestJson', 'jsonRequest', 'fetchApi'].includes(name)) return null;
  const path = requestPath(call);
  return path == null ? null : { method: requestMethod(call), path: canonicalPath(path) };
}

function directReturnKeys(node, returnBuilders = new Map()) {
  let keys;
  walk(node.body ?? node, (candidate) => {
    if (keys) return;
    if (!ts.isReturnStatement(candidate)) return;
    const expression = unwrapExpression(candidate.expression);
    if (!expression) return;
    if (ts.isCallExpression(expression) && expression.arguments.length) {
      const nested = unwrapExpression(expression.arguments[0]);
      keys = objectKeys(nested) ?? (callName(expression) && returnBuilders.get(callName(expression)));
    } else keys = objectKeys(expression);
  });
  return keys;
}

function parseApiFunctions(files) {
  const raw = new Map();
  const returnBuilders = new Map();
  for (const file of files) {
    if (!file.path.includes('/lib/api.') && !file.path.endsWith('/api.ts')) continue;
    for (const entry of functionNodes(astFile(file))) {
      const calls = callsInNode(entry.node);
      const direct = calls.map(apiRequestFromCall).filter(Boolean);
      const refs = calls.map(callName).filter(Boolean);
      const keys = directReturnKeys(entry.node, returnBuilders);
      raw.set(entry.name, { name: entry.name, file: file.path, direct, refs, projectionKeys: keys });
      if (keys) returnBuilders.set(entry.name, keys);
    }
  }
  const resolved = new Map();
  function resolveApi(name, stack = new Set()) {
    if (resolved.has(name)) return resolved.get(name);
    const entry = raw.get(name);
    if (!entry || stack.has(name)) return [];
    const next = new Set(stack).add(name);
    const calls = [...entry.direct];
    for (const ref of entry.refs) if (raw.has(ref)) calls.push(...resolveApi(ref, next));
    const unique = [...new Map(calls.map((call) => [endpointKey(call.method, call.path), call])).values()];
    resolved.set(name, unique);
    return unique;
  }
  for (const name of raw.keys()) {
    const entry = raw.get(name);
    entry.calls = resolveApi(name);
    entry.projectionKeys = entry.projectionKeys ?? undefined;
  }
  return new Map([...raw].filter(([, entry]) => entry.calls.length > 0));
}

function apiCallsInAst(source, apiFunctions) {
  const calls = [];
  for (const call of callsInNode(source)) {
    const name = callName(call);
    if (name && apiFunctions.has(name)) calls.push(...apiFunctions.get(name).calls);
  }
  return [...new Map(calls.map((call) => [endpointKey(call.method, call.path), call])).values()];
}

function parseActionFunctions(files, apiFunctions) {
  const raw = new Map();
  for (const file of files) {
    if (!file.path.endsWith('/actions.ts') && !file.path.endsWith('/actions.js')) continue;
    for (const entry of functionNodes(astFile(file))) {
      if (!isExportedFunction(entry)) continue;
      const calls = callsInNode(entry.node);
      raw.set(entry.name, { name: entry.name, file: file.path, refs: calls.map(callName).filter(Boolean), direct: apiCallsInAst(entry.node, apiFunctions) });
    }
  }
  const resolved = new Map();
  function resolveAction(name, stack = new Set()) {
    if (resolved.has(name)) return resolved.get(name);
    const entry = raw.get(name);
    if (!entry || stack.has(name)) return [];
    const next = new Set(stack).add(name);
    const calls = [...entry.direct];
    for (const ref of entry.refs) if (raw.has(ref)) calls.push(...resolveAction(ref, next));
    const unique = [...new Map(calls.map((call) => [endpointKey(call.method, call.path), call])).values()];
    resolved.set(name, unique);
    return unique;
  }
  return new Map([...raw].map(([name, entry]) => [name, { ...entry, calls: resolveAction(name) }]));
}

function importedIdentifier(node) {
  return ts.isImportSpecifier(node) || ts.isImportClause(node) || ts.isNamespaceImport(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node);
}

function referencedIdentifiers(source, names) {
  const found = new Set();
  walk(source, (node) => {
    if (!ts.isIdentifier(node) || !names.has(node.text)) return;
    let parent = node.parent;
    while (parent && (ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isExportSpecifier(parent))) parent = parent.parent;
    if (!importedIdentifier(parent)) found.add(node.text);
  });
  return found;
}

function jsxActionIdentifiers(source, names) {
  const result = new Set();
  walk(source, (node) => {
    if (ts.isIdentifier(node) && names.has(node.text)) result.add(node.text);
  });
  return result;
}

function propertyChain(node) {
  const parts = [];
  let current = node;
  while (ts.isPropertyAccessExpression(current)) {
    parts.unshift(current.name.text);
    current = current.expression;
  }
  if (ts.isIdentifier(current)) parts.unshift(current.text);
  return parts.join('.');
}

function parseConditionAtom(node) {
  if (!ts.isBinaryExpression(node)) return null;
  const op = node.operatorToken.kind;
  const left = node.left;
  const right = literalText(node.right);
  let field = null;
  const chain = propertyChain(left);
  if (chain === 'request.method') field = 'method';
  else if (chain === 'url.pathname' || chain === 'request.url.pathname') field = 'pathname';
  else if (chain === 'parts.length' || chain === 'pubParts.length') field = chain;
  else if (ts.isElementAccessExpression(left) && ts.isIdentifier(left.expression) && ts.isNumericLiteral(left.argumentExpression)) {
    field = `${left.expression.text}[${left.argumentExpression.text}]`;
  }
  if (field && op === ts.SyntaxKind.EqualsEqualsEqualsToken && right != null) return [{ [field]: right }];
  if (field && op === ts.SyntaxKind.ExclamationEqualsEqualsToken && ts.isIdentifier(node.right) && node.right.text === 'undefined') return [{ [field]: DYNAMIC }];
  if (field && op === ts.SyntaxKind.EqualsEqualsToken && right != null) return [{ [field]: right }];
  return null;
}
function conditionAlternatives(node) {
  if (ts.isParenthesizedExpression(node)) return conditionAlternatives(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const left = conditionAlternatives(node.left); const right = conditionAlternatives(node.right);
    if (!left || !right) return null;
    return left.flatMap((a) => right.map((b) => ({ ...a, ...b })));
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    const left = conditionAlternatives(node.left); const right = conditionAlternatives(node.right);
    if (!left || !right) return null;
    return [...left, ...right];
  }
  const atom = parseConditionAtom(node);
  return atom ? atom : [{}];
}

function combineConstraints(parent, current) {
  const alternatives = conditionAlternatives(current) ?? [{}];
  return alternatives.map((item) => ({ ...parent, ...item }));
}
function queryKeysIn(node) {
  const result = [];
  walk(node, (candidate) => {
    if (!ts.isCallExpression(candidate) || callName(candidate) !== 'requestQuery') return;
    const argument = candidate.arguments[1];
    if (!argument || !ts.isArrayLiteralExpression(argument)) return;
    for (const element of argument.elements) {
      const value = literalText(element);
      if (value) result.push(value);
    }
  });
  return [...new Set(result)];
}

function endpointWireKeys(node, returnBuilders) {
  let result;
  walk(node, (candidate) => {
    if (result || !ts.isReturnStatement(candidate)) return;
    let expression = unwrapExpression(candidate.expression);
    if (!expression) return;
    if (ts.isCallExpression(expression) && expression.arguments.length) {
      const argument = unwrapExpression(expression.arguments[0]);
      result = objectKeys(argument) ?? (callName(argument) && returnBuilders.get(callName(argument))) ?? null;
    } else result = objectKeys(expression);
  });
  return result;
}

function parseRequestHandlerEndpoints(files) {
  const endpoints = new Map();
  const returnBuilders = new Map();
  for (const file of files) {
    if (!file.path.endsWith('/request-handler.ts') && !file.path.endsWith('/request-handler.js') && !file.path.endsWith('/index.ts')) continue;
    const source = astFile(file);
    for (const entry of functionNodes(source)) {
      const keys = directReturnKeys(entry.node, returnBuilders);
      if (keys) returnBuilders.set(entry.name, keys);
    }
    const handler = functionNodes(source).find(({ name }) => name === 'handleRequest')?.node ?? source;
    function visit(node, context) {
      if (ts.isIfStatement(node)) {
        for (const constraints of combineConstraints(context, node.expression)) {
          const method = constraints.method;
          const length = constraints['parts.length'] ?? constraints['pubParts.length'];
          const sourceVar = constraints['pubParts.length'] !== undefined ? 'pubParts' : 'parts';
          const pathName = constraints.pathname;
          let path;
          if (pathName != null) path = pathName;
          else if (method && length != null) {
            const count = Number(length);
            if (Number.isInteger(count) && count > 0) {
              const segments = [];
              for (let index = 0; index < count; index += 1) segments.push(constraints[`${sourceVar}[${index}]`] ?? DYNAMIC);
              path = `/${segments.join('/')}`;
            }
          }
          if (method && path) {
            const queries = queryKeysIn(node.thenStatement);
            const query = queries.filter((key) => key === 'official' || key === 'focusSupportCaseId').map((key) => `${key}=${key === 'official' ? 'true' : DYNAMIC}`);
            if (query.length) path += `?${query.join('&')}`;
            const wireKeys = endpointWireKeys(node.thenStatement, returnBuilders);
            const sourceText = node.getSourceFile().text.slice(node.getStart(), node.getEnd());
            endpoints.set(endpointKey(method, path), { method, path: canonicalPath(path), wireKeys, branchHash: createHash('sha1').update(sourceText).digest('hex').slice(0, 12) });
          }
          if (node.thenStatement) visit(node.thenStatement, constraints);
        }
      } else node.forEachChild((child) => visit(child, context));
    }
    visit(handler.body ?? handler, {});
  }
  return endpoints;
}

function sameKeys(left = [], right = []) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

function expectedEndpoint(map, method, path) {
  const key = endpointKey(method, path);
  return map.endpoints.find((endpoint) => endpointKey(endpoint.method, endpoint.path) === key);
}

function addError(errors, code, message, extra = {}) { errors.push(ERROR(code, message, extra)); }

function routeUsesPublicCredentials(routeFiles) {
  for (const file of routeFiles) {
    const source = astFile(file);
    let leaked = false;
    walk(source, (node) => {
      if (leaked || !ts.isIdentifier(node)) return;
      if (['accessHeaders', 'CF_Authorization', 'Bearer', 'OrganizationProfile', 'AppHeader', 'AppSidebar'].includes(node.text)) leaked = true;
    });
    if (leaked) return true;
  }
  return false;
}

function routeActionNames(files, actionFunctions) {
  const names = new Set();
  for (const file of files) for (const name of referencedIdentifiers(astFile(file), new Set(actionFunctions.keys()))) names.add(name);
  return [...names];
}

function uniqueCalls(calls) {
  return [...new Map(calls.map((call) => [endpointKey(call.method, call.path), call])).values()];
}

function inheritedSurface(map, route, rootApis, adminApis, shellActions) {
  if (PUBLIC_KINDS.has(route.kind)) return { root: { apis: [], actions: [] }, admin: { apis: [] } };
  const admin = route.routePattern === '/admin' || route.routePattern.startsWith('/admin/') ? adminApis.map((api) => ({ ...api })) : [];
  return { root: { apis: rootApis.map((api) => ({ ...api })), actions: [...new Set(shellActions)] }, admin: { apis: admin } };
}

function actorSurfaces() {
  return {
    publicJoin: { actor: 'none-or-preview-actor', credentials: ['participant-or-worker-token', 'ccc_preview in preview mode'], forbidden: ['CF_Authorization', 'Bearer', 'business shell'] },
    publicPreview: { actor: 'none', credentials: ['code'], unlock: 'ccc_preview' },
  };
}

async function loadInventory(root, sourceRoot) {
  const inventoryPath = resolve(root, 'scripts/design/route-inventory.json');
  const text = await readSource(inventoryPath);
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function verifyScreenApiMap({ rootDir, map, sourceRoot = map?.sourceRoot ?? 'apps/web/app', apiSourceRoot = map?.apiSourceRoot ?? 'apps/api/src' } = {}) {
  if (!map || !Array.isArray(map.routes) || !Array.isArray(map.endpoints)) throw new TypeError('verifyScreenApiMap requires a machine-readable S3 map');
  const root = resolve(rootDir ?? process.cwd());
  const errors = [];
  const webFiles = await sourceFiles(root, sourceRoot);
  const apiFiles = await sourceFiles(root, apiSourceRoot);
  const allFiles = [...webFiles, ...apiFiles];
  const sourceByPath = new Map();
  for (const path of allFiles) sourceByPath.set(path, { path, text: await readSource(path) });
  const pagePaths = webFiles.filter((path) => /\/page\.[^.]+$/.test(path));
  const pageSet = new Set(pagePaths.map((path) => routePatternForPage(root, path)));
  const mapRouteSet = new Set();
  for (const route of map.routes) {
    mapRouteSet.add(route.routePattern);
    if (!sourceByPath.has(resolve(root, route.page))) addError(errors, 'route-not-found', `route page not found: ${route.page}`, { routePattern: route.routePattern });
  }
  for (const actual of pageSet) if (!mapRouteSet.has(actual)) addError(errors, 'route-unmapped', `page is absent from map: ${actual}`, { routePattern: actual });

  const inventory = await loadInventory(root, sourceRoot);
  if (inventory?.routes) {
    const inventoryRows = inventory.routes.map((route) => `${route.page} ${route.routePattern} ${route.permission?.state ?? ''}`);
    const mapRows = map.routes.map((route) => `${route.page} ${route.routePattern} ${route.kind === 'public' ? 'public' : 'allowed'}`);
    if (!sameKeys(inventoryRows, mapRows)) addError(errors, 'inventory-mismatch', 'route map differs from route inventory');
  }

  const apiFunctions = parseApiFunctions([...sourceByPath.values()]);
  const actionFunctions = parseActionFunctions([...sourceByPath.values()], apiFunctions);
  const handlerEndpoints = parseRequestHandlerEndpoints([...sourceByPath.values()]);
  const rootLayout = sourceByPath.get(resolve(root, sourceRoot, 'layout.tsx'));
  const rootClosure = rootLayout ? await importClosure(rootLayout.path, root) : [];
  const adminLayout = sourceByPath.get(resolve(root, sourceRoot, 'admin/layout.tsx'));
  const adminClosure = adminLayout ? await importClosure(adminLayout.path, root) : [];
  const shellNames = new Set(['toggleThemeAction', 'logoutAction']);
  const rootShellActions = [...new Set(rootClosure.filter((file) => !file.path.includes('/lib/api.') && !file.path.endsWith('/actions.ts')).flatMap((file) => [...new Set([...referencedIdentifiers(astFile(file), shellNames), ...jsxActionIdentifiers(astFile(file), shellNames)])]))];
  const rootApiCalls = uniqueCalls(rootClosure.filter((file) => !file.path.includes('/lib/api.')).flatMap((file) => apiCallsInAst(astFile(file), apiFunctions)));
  const adminApiCalls = uniqueCalls(adminClosure.filter((file) => !file.path.includes('/lib/api.')).flatMap((file) => apiCallsInAst(astFile(file), apiFunctions)));
  const inheritedDuplicates = [...(map.inherited.root.actions ?? []), ...(map.inherited.root.apis ?? []).map((item) => endpointKey(item.method, item.path)), ...(map.inherited.admin.apis ?? []).map((item) => endpointKey(item.method, item.path))];
  for (const duplicate of [...new Set(inheritedDuplicates.filter((value, index, values) => values.indexOf(value) !== index))]) addError(errors, 'inherited-duplicate', `inherited edge appears more than once: ${duplicate}`);
  const expectedRootApis = map.inherited.root.apis ?? [];
  for (const expected of expectedRootApis) if (!rootApiCalls.some((observed) => endpointKey(observed.method, observed.path) === endpointKey(expected.method, expected.path))) addError(errors, 'inherited-api-missing', `root inherited API missing: ${expected.method} ${expected.path}`);
  const expectedAdminApis = map.inherited.admin.apis ?? [];
  for (const expected of expectedAdminApis) if (!adminApiCalls.some((observed) => endpointKey(observed.method, observed.path) === endpointKey(expected.method, expected.path))) addError(errors, 'inherited-api-missing', `admin inherited API missing: ${expected.method} ${expected.path}`);
  for (const expected of map.inherited.root.actions ?? []) if (!rootShellActions.includes(expected)) addError(errors, 'inherited-action-missing', `root inherited action missing: ${expected}`);

  const routes = [];
  const usedEndpointKeys = new Set();
  for (const route of map.routes) {
    const pagePath = resolve(root, route.page);
    const pageSource = sourceByPath.get(pagePath)?.text ?? '';
    const pageClosure = sourceByPath.has(pagePath) ? await importClosure(pagePath, root) : [];
    const routeFiles = pageClosure.filter((file) => !file.path.includes('/lib/api.') && !file.path.endsWith('/actions.ts'));
    const inherited = inheritedSurface(map, route, rootApiCalls, adminApiCalls, rootShellActions);
    const inheritedKeys = new Set([...rootApiCalls, ...((route.routePattern === '/admin' || route.routePattern.startsWith('/admin/')) ? adminApiCalls : [])].map((call) => endpointKey(call.method, call.path)));
    const directPageApis = uniqueCalls(routeFiles.flatMap((file) => apiCallsInAst(astFile(file), apiFunctions)).filter((call) => !inheritedKeys.has(endpointKey(call.method, call.path))));
    const pageActions = routeActionNames(routeFiles, actionFunctions);
    const actionApis = uniqueCalls(pageActions.flatMap((name) => actionFunctions.get(name)?.calls ?? []));
    const observedCalls = uniqueCalls([...directPageApis, ...actionApis]);
    for (const call of observedCalls) usedEndpointKeys.add(endpointKey(call.method, call.path));
    const expectedCalls = [...(route.pageApis ?? []), ...(route.actions ?? []).flatMap((action) => action.calls ?? [])];
    const inheritedObservedCalls = [...inherited.root.apis, ...inherited.admin.apis];
    const observedCallsForMatch = uniqueCalls([...observedCalls, ...inheritedObservedCalls]);
    for (const expected of expectedCalls) {
      const matched = observedCallsForMatch.some((observed) => endpointKey(observed.method, observed.path) === endpointKey(expected.method, expected.path));
      if (!matched) addError(errors, 'page-api-missing', `${route.routePattern} omits ${expected.method} ${expected.path}`, { routePattern: route.routePattern, endpoint: endpointKey(expected.method, expected.path) });
    }
    for (const observed of observedCalls) {
      const expected = expectedCalls.find((candidate) => endpointKey(candidate.method, candidate.path) === endpointKey(observed.method, observed.path));
      if (!expected) addError(errors, 'page-api-unmapped', `${route.routePattern} calls ${observed.method} ${observed.path} outside its map row`, { routePattern: route.routePattern });
    }
    if (PUBLIC_KINDS.has(route.kind) && routeUsesPublicCredentials(routeFiles)) addError(errors, 'public-auth-leak', `${route.routePattern} includes Access/Bearer/business-shell surface`, { routePattern: route.routePattern });
    if (route.kind === 'redirect' && expectedCalls.length > 0 && route.routePattern !== '/') addError(errors, 'redirect-api-leak', `${route.routePattern} is redirect-only but declares API calls`);
    routes.push({ ...route, inherited, observed: { pageApis: directPageApis, actions: pageActions, calls: observedCalls }, sourceFound: sourceByPath.has(pagePath) });
  }

  const routeHandlerPath = resolve(root, sourceRoot, 'preview/unlock/route.ts');
  const routeHandler = sourceByPath.get(routeHandlerPath);
  const previewRoutes = map.routes.filter((route) => route.routeHandler);
  if (previewRoutes.length > 0 && !routeHandler) addError(errors, 'route-handler-missing', 'declared preview unlock route handler is absent');
  if (routeHandler && previewRoutes.length > 0) {
    const handlerCalls = apiCallsInAst(astFile(routeHandler), apiFunctions);
    const expectedHandlerCalls = previewRoutes.flatMap((route) => route.routeHandler.calls ?? []);
    for (const expected of expectedHandlerCalls) if (!handlerCalls.some((observed) => endpointKey(observed.method, observed.path) === endpointKey(expected.method, expected.path))) addError(errors, 'route-handler-api-missing', `preview unlock handler omits ${expected.method} ${expected.path}`);
  }
  const endpointObservations = [];
  for (const endpoint of map.endpoints) {
    const key = endpointKey(endpoint.method, endpoint.path);
    const observed = handlerEndpoints.get(key);
    const apiProjection = [...apiFunctions.values()].find((candidate) => candidate.projectionKeys && candidate.calls.some((call) => endpointKey(call.method, call.path) === key));
    const fullIdentityProjection = key === 'GET /me' && apiProjection?.projectionKeys?.includes('id');
    if (!observed) {
      addError(errors, 'endpoint-method-path-mismatch', `${key} is not implemented by request handler`, { endpoint: key });
      const wireCandidate = [...handlerEndpoints.values()].find((candidate) => candidate.wireKeys && endpoint.wireKeys?.some((field) => candidate.wireKeys.includes(field)));
      if (wireCandidate && endpoint.wireKeys?.length > 0 && !sameKeys(endpoint.wireKeys, wireCandidate.wireKeys ?? [])) addError(errors, 'endpoint-wire-keys-mismatch', `${key} wire keys differ`, { endpoint: key });
      if (apiProjection && endpoint.projectionKeys?.length > 0 && !fullIdentityProjection && !sameKeys(endpoint.projectionKeys, apiProjection.projectionKeys ?? [])) addError(errors, 'endpoint-projection-mismatch', `${key} client projection differs`, { endpoint: key });
    } else {
      endpointObservations.push({ ...endpoint, observedWireKeys: observed.wireKeys, branchHash: observed.branchHash });
      if (observed.wireKeys && endpoint.wireKeys?.length > 0 && !sameKeys(endpoint.wireKeys, observed.wireKeys)) addError(errors, 'endpoint-wire-keys-mismatch', `${key} wire keys differ`, { endpoint: key });
      if (apiProjection && endpoint.projectionKeys?.length > 0 && !fullIdentityProjection && !sameKeys(endpoint.projectionKeys, apiProjection.projectionKeys ?? [])) addError(errors, 'endpoint-projection-mismatch', `${key} client projection differs`, { endpoint: key });
      if (endpoint.path.startsWith('/invites/participant/') && endpoint.path.endsWith('/:token') && observed.wireKeys?.includes('email')) addError(errors, 'pii-unauthorized', `${key} exposes email outside its declared token scope`, { endpoint: key });
    }
  }
  const catalogKeys = new Set(map.endpoints.map((endpoint) => endpointKey(endpoint.method, endpoint.path)));
  const catalogBaseKeys = new Set(map.endpoints.map((endpoint) => `${String(endpoint.method).toUpperCase()} ${canonicalPath(endpoint.path).split('?')[0]}`));
  for (const key of handlerEndpoints.keys()) if (!catalogKeys.has(key) && !catalogBaseKeys.has(`${key.split(' ')[0]} ${key.split(' ')[1].split('?')[0]}`)) addError(errors, 'endpoint-unmapped', `${key} request-handler branch is absent from catalog`, { endpoint: key });
  const orphanEndpoints = map.endpoints.filter((endpoint) => endpoint.status === 'unmapped-by-current-page');
  for (const endpoint of orphanEndpoints) if (usedEndpointKeys.has(endpointKey(endpoint.method, endpoint.path))) addError(errors, 'orphan-used', `${endpointKey(endpoint.method, endpoint.path)} is declared orphan but has a page caller`);
  const orphans = orphanEndpoints.map((endpoint) => ({ ...endpoint }));
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
    observed: { routeCount: pagePaths.length, endpointCount: handlerEndpoints.size, networkRequests: 0, rootApiCalls, adminApiCalls },
  };
}

export default verifyScreenApiMap;
