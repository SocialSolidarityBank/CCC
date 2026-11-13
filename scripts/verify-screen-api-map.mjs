import ts from 'typescript';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs'];
const PUBLIC_KINDS = new Set(['public']);
const RESPONSE_KINDS = new Set(['object', 'array', 'scalar', 'void', 'binary-or-object']);
const PROJECTION_KINDS = new Set(['object', 'array', 'scalar', 'void', 'none']);
const DYNAMIC = '__E2_DYNAMIC__';
const ERROR = (code, message, extra = {}) => ({ code, message, ...extra });

function hasFixtureSentinel(value) {
  if (Array.isArray(value)) return value.some(hasFixtureSentinel);
  if (value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => key === 'fixture' || hasFixtureSentinel(nested));
}

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile() && SOURCE_EXTENSIONS.includes(extname(entry.name))) files.push(path);
  }
  return files;
}

async function readSource(path) {
  return readFile(path, 'utf8').catch(() => '');
}

function scriptKind(path) {
  if (path.endsWith('.tsx') || path.endsWith('.jsx') || path.endsWith('.js')) return ts.ScriptKind.TSX;
  return ts.ScriptKind.TS;
}

function astFile(file) {
  return ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, scriptKind(file.path));
}

function walk(node, visit, { crossFunctions = true } = {}) {
  visit(node);
  node.forEachChild((child) => {
    if (!crossFunctions && child !== node && ts.isFunctionLike(child)) return;
    walk(child, visit, { crossFunctions });
  });
}

function literalText(node) {
  if (!node) return null;
  if (ts.isNumericLiteral(node)) return node.text;
  if (node.kind === ts.SyntaxKind.TrueKeyword) return 'true';
  if (node.kind === ts.SyntaxKind.FalseKeyword) return 'false';
  if (node.kind === ts.SyntaxKind.NullKeyword) return 'null';
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((span) => `${DYNAMIC}${span.literal.text}`).join('');
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = literalText(node.left);
    const right = literalText(node.right);
    return left !== null && right !== null ? left + right : null;
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isTypeAssertionExpression(node)) {
    return literalText(node.expression);
  }
  return null;
}

function propertyName(node) {
  if (!node) return null;
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) return node.text;
  return null;
}

function callName(call) {
  if (!call || !call.expression) return null;
  if (ts.isIdentifier(call.expression)) return call.expression.text;
  if (ts.isPropertyAccessExpression(call.expression)) return call.expression.name.text;
  return null;
}

function callsInNode(node, options = {}) {
  const calls = [];
  walk(node, (candidate) => {
    if (ts.isCallExpression(candidate)) calls.push(candidate);
  }, options);
  return calls;
}

function unwrapExpression(expression) {
  let value = expression;
  while (value && (
    ts.isAwaitExpression(value)
    || ts.isParenthesizedExpression(value)
    || ts.isAsExpression(value)
    || ts.isTypeAssertionExpression(value)
    || ts.isNonNullExpression(value)
  )) value = value.expression;
  return value;
}

function canonicalPath(value) {
  const input = String(value ?? '').replace(/\\/g, '/');
  const separator = input.indexOf('?');
  const rawPath = separator === -1 ? input : input.slice(0, separator);
  const rawQuery = separator === -1 ? '' : input.slice(separator + 1);
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
    if (query.length > 0) result += `?${query.join('&')}`;
  }
  return result;
}

function endpointKey(method, path) {
  return `${String(method ?? 'GET').toUpperCase()} ${canonicalPath(path)}`;
}

function endpointIdentity(endpoint) {
  return `${endpointKey(endpoint.method, endpoint.path)} [${endpoint.wireDto}]`;
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
  const candidates = [
    rawBase,
    base,
    ...SOURCE_EXTENSIONS.map((item) => `${base}${item}`),
    ...SOURCE_EXTENSIONS.map((item) => join(base, `index${item}`)),
  ];
  for (const candidate of candidates) {
    if (!candidate.startsWith(resolve(root)) || candidate === resolve(root)) continue;
    try {
      await readFile(candidate);
      return candidate;
    } catch {}
  }
  return null;
}

async function moduleInfo(path, text, root) {
  const source = astFile({ path, text });
  const imports = new Map();
  const sideEffects = [];
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const target = await sourcePathFromImport(path, statement.moduleSpecifier.text, root);
    if (!target) continue;
    const clause = statement.importClause;
    if (!clause) {
      sideEffects.push(target);
      continue;
    }
    if (clause.name) imports.set(clause.name.text, { target, imported: 'default', typeOnly: clause.isTypeOnly });
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        imports.set(element.name.text, {
          target,
          imported: element.propertyName?.text ?? element.name.text,
          typeOnly: clause.isTypeOnly || element.isTypeOnly,
        });
      }
    }
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      imports.set(clause.namedBindings.name.text, { target, imported: '*', typeOnly: clause.isTypeOnly });
    }
  }
  const renderedImports = new Set();
  walk(source, (node) => {
    if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) return;
    const tag = node.tagName;
    if (ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text) && imports.has(tag.text)) renderedImports.add(tag.text);
  });
  return { path, text, source, imports, sideEffects, renderedImports };
}

async function buildModules(paths, root) {
  const modules = new Map();
  for (const path of paths) modules.set(path, await moduleInfo(path, await readSource(path), root));
  return modules;
}

function functionNodes(source, filePath) {
  const result = [];
  walk(source, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      result.push({ name: node.name.text, node, file: filePath, exported: node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false });
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      const declaration = node.parent?.parent;
      result.push({
        name: node.name.text,
        node: node.initializer,
        file: filePath,
        exported: declaration?.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false,
      });
    }
    if (ts.isMethodDeclaration(node) && node.name && propertyName(node.name) && node.body) {
      result.push({ name: propertyName(node.name), node, file: filePath, exported: false });
    }
  });
  return result;
}

function requestPath(call) {
  let argument = call.arguments[0];
  if (callName(call) === 'fetchApi' && argument && ts.isCallExpression(argument)) argument = argument.arguments[0];
  if (argument && ts.isCallExpression(argument) && callName(argument) === 'endpoint') argument = argument.arguments[0];
  return literalText(argument);
}

function objectProperty(object, name) {
  if (!object || !ts.isObjectLiteralExpression(object)) return null;
  return object.properties.find((property) => (
    ts.isPropertyAssignment(property)
    && propertyName(property.name) === name
  )) ?? null;
}

function requestMethod(call) {
  const name = callName(call);
  if (name === 'jsonRequest') return literalText(call.arguments[1]) ?? 'GET';
  const init = call.arguments[1];
  const property = objectProperty(init, 'method');
  return property && ts.isPropertyAssignment(property) ? literalText(property.initializer) ?? 'GET' : 'GET';
}

function apiRequestFromCall(call) {
  const name = callName(call);
  if (!['requestJson', 'jsonRequest', 'fetchApi'].includes(name)) return null;
  const path = requestPath(call);
  if (path === null) return null;
  return { method: requestMethod(call), path: canonicalPath(path) };
}

function uniqueCalls(calls) {
  return [...new Map(calls.map((call) => [`${endpointKey(call.method, call.path)}|${call.client ?? ''}`, call])).values()];
}

function typeNodeIdentity(typeNode) {
  if (!typeNode) return 'inferred';
  if (ts.isTypeReferenceNode(typeNode) && typeNode.typeName.getText() === 'Promise' && typeNode.typeArguments?.length === 1) {
    return typeNodeIdentity(typeNode.typeArguments[0]);
  }
  if (ts.isArrayTypeNode(typeNode)) return `${typeNodeIdentity(typeNode.elementType)}[]`;
  if (ts.isTypeLiteralNode(typeNode)) return 'object';
  return typeNode.getText().replace(/\s+/g, '').replace(/\|undefined/g, '').replace(/undefined\|/g, '');
}

function headerInitializerLiterals(node) {
  const value = unwrapExpression(node);
  if (!value) return [];
  if (ts.isNewExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === 'Headers') {
    return headerInitializerLiterals(value.arguments?.[0]);
  }
  if (ts.isObjectLiteralExpression(value)) {
    return value.properties.flatMap((property) => {
      if (!ts.isPropertyAssignment(property)) return [];
      const name = propertyName(property.name);
      return name === null ? [] : [{ name: name.toLowerCase(), value: literalText(property.initializer) ?? DYNAMIC }];
    });
  }
  if (ts.isArrayLiteralExpression(value)) {
    return value.elements.flatMap((element) => {
      const tuple = unwrapExpression(element);
      if (!tuple || !ts.isArrayLiteralExpression(tuple) || tuple.elements.length < 2) return [];
      const name = literalText(tuple.elements[0]);
      return name === null ? [] : [{ name: name.toLowerCase(), value: literalText(tuple.elements[1]) ?? DYNAMIC }];
    });
  }
  return [];
}

function collectHeaderLiterals(node) {
  const headers = [];
  walk(node, (candidate) => {
    if (ts.isNewExpression(candidate) && ts.isIdentifier(candidate.expression) && candidate.expression.text === 'Headers') {
      headers.push(...headerInitializerLiterals(candidate.arguments?.[0]));
    }
    if (ts.isPropertyAssignment(candidate) && propertyName(candidate.name)?.toLowerCase() === 'headers') {
      headers.push(...headerInitializerLiterals(candidate.initializer));
    }
    if (ts.isVariableDeclaration(candidate) && ts.isIdentifier(candidate.name) && /headers?/i.test(candidate.name.text)) {
      headers.push(...headerInitializerLiterals(candidate.initializer));
    }
    if (ts.isCallExpression(candidate)) {
      for (const argument of candidate.arguments.slice(1)) {
        const init = unwrapExpression(argument);
        const property = objectProperty(init, 'headers');
        if (property && ts.isPropertyAssignment(property)) headers.push(...headerInitializerLiterals(property.initializer));
      }
    }
    if (!ts.isCallExpression(candidate) || !ts.isPropertyAccessExpression(candidate.expression)) return;
    if (candidate.expression.name.text !== 'set' && candidate.expression.name.text !== 'append') return;
    const name = literalText(candidate.arguments[0]);
    if (name === null) return;
    headers.push({ name: name.toLowerCase(), value: literalText(candidate.arguments[1]) ?? DYNAMIC });
  });
  return headers;
}

function expressionHasPublicMarker(node) {
  let marker = false;
  let enabledValue = false;
  walk(node, (candidate) => {
    if (
      ts.isCallExpression(candidate)
      && ts.isPropertyAccessExpression(candidate.expression)
      && candidate.expression.name.text === 'get'
      && literalText(candidate.arguments[0])?.toLowerCase() === 'x-ccc-public'
    ) marker = true;
    if (literalText(candidate) === '1') enabledValue = true;
  }, { crossFunctions: false });
  return marker && enabledValue;
}

function hasRootPublicShellBypass(module) {
  const publicVariables = new Set();
  walk(module.source, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && expressionHasPublicMarker(node.initializer)) {
      publicVariables.add(node.name.text);
    }
  });
  let bypass = false;
  walk(module.source, (node) => {
    if (!ts.isIfStatement(node)) return;
    const directMarker = expressionHasPublicMarker(node.expression);
    let referencesMarker = false;
    walk(node.expression, (candidate) => {
      if (ts.isIdentifier(candidate) && publicVariables.has(candidate.text)) referencesMarker = true;
    }, { crossFunctions: false });
    if (!directMarker && !referencesMarker) return;
    walk(node.thenStatement, (candidate) => {
      if (ts.isReturnStatement(candidate)) bypass = true;
    }, { crossFunctions: false });
  });
  return bypass;
}

function parseApiFunctions(apiModule) {
  const raw = new Map();
  for (const entry of functionNodes(apiModule.source, apiModule.path)) {
    const calls = callsInNode(entry.node);
    const direct = calls.map(apiRequestFromCall).filter(Boolean).map((call) => ({ ...call, client: entry.name }));
    raw.set(entry.name, {
      ...entry,
      direct,
      refs: calls.map(callName).filter(Boolean),
      returnIdentity: typeNodeIdentity(entry.node.type),
      ownHeaders: collectHeaderLiterals(entry.node),
    });
  }
  const resolved = new Map();
  function resolveFunction(name, stack = new Set()) {
    if (resolved.has(name)) return resolved.get(name);
    const entry = raw.get(name);
    if (!entry || stack.has(name)) return { calls: [], refs: [], headers: [], usesAccessHeaders: false };
    const next = new Set(stack).add(name);
    const nested = entry.refs.filter((ref) => raw.has(ref)).map((ref) => resolveFunction(ref, next));
    const result = {
      calls: uniqueCalls([...entry.direct, ...nested.flatMap((item) => item.calls)]),
      refs: [...new Set([...entry.refs, ...nested.flatMap((item) => item.refs)])],
      headers: [...entry.ownHeaders, ...nested.flatMap((item) => item.headers)],
      usesAccessHeaders: entry.refs.includes('accessHeaders') || nested.some((item) => item.usesAccessHeaders),
    };
    resolved.set(name, result);
    return result;
  }
  for (const [name, entry] of raw) Object.assign(entry, resolveFunction(name));
  return raw;
}

function apiCallsInAst(source, apiFunctions) {
  const calls = [];
  for (const call of callsInNode(source)) {
    const name = callName(call);
    if (name && apiFunctions.has(name)) calls.push(...apiFunctions.get(name).calls);
  }
  return uniqueCalls(calls);
}

function parseActionFunctions(actionModules, apiFunctions) {
  const raw = new Map();
  for (const actionModule of actionModules) {
    for (const entry of functionNodes(actionModule.source, actionModule.path)) {
      const calls = callsInNode(entry.node);
      raw.set(entry.name, {
        ...entry,
        refs: calls.map(callName).filter(Boolean),
        direct: apiCallsInAst(entry.node, apiFunctions),
      });
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
    const result = uniqueCalls(calls);
    resolved.set(name, result);
    return result;
  }
  return new Map([...raw].filter(([, entry]) => entry.exported).map(([name, entry]) => [name, { ...entry, calls: resolveAction(name) }]));
}

function referencedImports(module, targetPaths, names) {
  const result = new Set();
  walk(module.source, (node) => {
    if (!ts.isIdentifier(node) || !names.has(node.text)) return;
    const imported = module.imports.get(node.text);
    if (!imported || !targetPaths.has(imported.target) || imported.typeOnly) return;
    let current = node.parent;
    while (current && (
      ts.isImportSpecifier(current)
      || ts.isImportClause(current)
      || ts.isNamedImports(current)
      || ts.isImportDeclaration(current)
    )) current = current.parent;
    if (current && !ts.isImportDeclaration(current)) result.add(node.text);
  });
  return result;
}

function renderedModulePaths(entryPath, modules) {
  const seen = new Set();
  const result = [];
  function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const module = modules.get(path);
    if (!module) return;
    result.push(path);
    for (const localName of module.renderedImports) {
      const imported = module.imports.get(localName);
      if (imported && !imported.typeOnly) visit(imported.target);
    }
  }
  visit(entryPath);
  return result;
}

function loaderModulePaths(entryPath, modules) {
  const seen = new Set();
  const result = [];
  function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const module = modules.get(path);
    if (!module) return;
    result.push(path);
    for (const [localName, imported] of module.imports) {
      if (imported.typeOnly || module.renderedImports.has(localName)) continue;
      visit(imported.target);
    }
    for (const target of module.sideEffects) visit(target);
  }
  visit(entryPath);
  return result;
}

function defaultExportFunction(source) {
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.body && statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword)) {
      return statement;
    }
    if (ts.isExportAssignment(statement)) {
      const expression = unwrapExpression(statement.expression);
      if (expression && (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression))) return expression;
    }
  }
  return null;
}

function loaderCallsInEntry(module, apiFunctions) {
  const entry = defaultExportFunction(module.source);
  if (!entry) return apiCallsInAst(module.source, apiFunctions);
  const localFunctions = new Map(functionNodes(module.source, module.path).map((item) => [item.name, item]));
  const seen = new Set();
  function callsFrom(node, name) {
    if (seen.has(name)) return [];
    seen.add(name);
    const calls = callsInNode(node, { crossFunctions: false });
    const direct = [];
    for (const call of calls) {
      const called = callName(call);
      if (called && apiFunctions.has(called)) direct.push(...apiFunctions.get(called).calls);
      else if (called && localFunctions.has(called)) direct.push(...callsFrom(localFunctions.get(called).node, called));
    }
    return direct;
  }
  return uniqueCalls(callsFrom(entry, '<default>'));
}

function loaderCalls(entryPath, modules, apiFunctions, excludedPaths) {
  return uniqueCalls(loaderModulePaths(entryPath, modules)
    .filter((path) => !excludedPaths.has(path))
    .flatMap((path) => {
      const module = modules.get(path);
      if (!module) return [];
      return path === entryPath ? loaderCallsInEntry(module, apiFunctions) : apiCallsInAst(module.source, apiFunctions);
    }));
}

function componentActionSurfaces(entryPath, modules, actionRoot, actionPaths, actionFunctions) {
  const surfaces = [];
  for (const path of renderedModulePaths(entryPath, modules).slice(1)) {
    const module = modules.get(path);
    if (!module) continue;
    const actions = [...referencedImports(module, actionPaths, new Set(actionFunctions.keys()))].sort();
    if (actions.length > 0) surfaces.push({ component: relative(actionRoot, path).split('\\').join('/'), actions });
  }
  return surfaces.sort((left, right) => left.component.localeCompare(right.component));
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
  if (field && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && right !== null) return [{ [field]: right }];
  if (field && node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken && ts.isIdentifier(node.right) && node.right.text === 'undefined') {
    return [{ [field]: DYNAMIC }];
  }
  return null;
}

function conditionAlternatives(node) {
  if (ts.isParenthesizedExpression(node)) return conditionAlternatives(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    const left = conditionAlternatives(node.left);
    const right = conditionAlternatives(node.right);
    if (!left || !right) return null;
    return left.flatMap((a) => right.map((b) => ({ ...a, ...b })));
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
    const left = conditionAlternatives(node.left);
    const right = conditionAlternatives(node.right);
    if (!left || !right) return null;
    return [...left, ...right];
  }
  return parseConditionAtom(node) ?? [{}];
}

function queryKeysIn(node) {
  const result = [];
  walk(node, (candidate) => {
    if (!ts.isCallExpression(candidate) || callName(candidate) !== 'requestQuery') return;
    const argument = candidate.arguments[1];
    if (!argument || !ts.isArrayLiteralExpression(argument)) return;
    for (const element of argument.elements) {
      const value = literalText(element);
      if (value !== null) result.push(value);
    }
  }, { crossFunctions: false });
  return [...new Set(result)];
}

function pathFromConstraints(constraints) {
  if (constraints.pathname) return constraints.pathname;
  const length = constraints['parts.length'] ?? constraints['pubParts.length'];
  const sourceVar = constraints['pubParts.length'] !== undefined ? 'pubParts' : 'parts';
  const count = Number(length);
  if (!constraints.method || !Number.isInteger(count) || count < 1) return null;
  const segments = [];
  for (let index = 0; index < count; index += 1) segments.push(constraints[`${sourceVar}[${index}]`] ?? DYNAMIC);
  return `/${segments.join('/')}`;
}

function statusFromResponseCall(call) {
  const literal = literalText(call.arguments[1]);
  if (literal === null) return 200;
  const value = Number(literal);
  return Number.isInteger(value) ? value : 200;
}

function responsePayloads(node, functionIndex, seen = new Set()) {
  const payloads = [];
  function inspectReturn(statement) {
    const expression = unwrapExpression(statement.expression);
    if (!expression) return;
    if (ts.isNewExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === 'Response') {
      const body = unwrapExpression(expression.arguments?.[0]);
      const options = expression.arguments?.[1];
      const statusProperty = objectProperty(options, 'status');
      const status = statusProperty && ts.isPropertyAssignment(statusProperty) ? Number(literalText(statusProperty.initializer)) : 200;
      if (body?.kind === ts.SyntaxKind.NullKeyword && status === 204) payloads.push({ kind: 'void', node: body, status });
      else if (status < 400) payloads.push({ kind: 'binary', node: body, status });
      return;
    }
    if (!ts.isCallExpression(expression)) return;
    const name = callName(expression);
    if (name === 'json' || name === 'jsonResponse') {
      const status = statusFromResponseCall(expression);
      payloads.push({ kind: 'json', node: unwrapExpression(expression.arguments[0]), status });
      return;
    }
    const target = functionIndex.get(name);
    if (target && !seen.has(name)) {
      payloads.push(...responsePayloads(target.node.body ?? target.node, functionIndex, new Set(seen).add(name)));
    }
  }
  function visit(current) {
    if (current !== node && ts.isFunctionLike(current)) return;
    if (ts.isReturnStatement(current)) {
      inspectReturn(current);
      return;
    }
    current.forEachChild(visit);
  }
  visit(node);
  return payloads;
}

function typeParts(type) {
  if (type.flags & ts.TypeFlags.Null) return { type, nullable: true, optional: false };
  if (type.flags & ts.TypeFlags.Undefined) return { type, nullable: false, optional: true };
  if (!type.isUnion()) return { type, nullable: false, optional: false };
  let nullable = false;
  let optional = false;
  const remaining = [];
  for (const part of type.types) {
    if (part.flags & ts.TypeFlags.Null) nullable = true;
    else if (part.flags & ts.TypeFlags.Undefined) optional = true;
    else remaining.push(part);
  }
  return { type: remaining.length === 1 ? remaining[0] : type, nullable, optional };
}

function descriptorFromType(checker, rawType, depth = 0, seen = new Set()) {
  const parts = typeParts(rawType);
  const type = parts.type;
  const base = { nullable: parts.nullable, optional: parts.optional };
  if (type.flags & (ts.TypeFlags.Void | ts.TypeFlags.Never)) return { kind: 'void', ...base };
  const scalarFlags = ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.EnumLike;
  const unionValues = rawType.isUnion()
    ? rawType.types.filter((item) => !(item.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined)))
    : [type];
  if ((type.flags & scalarFlags) || (unionValues.length > 0 && unionValues.every((item) => Boolean(item.flags & scalarFlags)))) {
    return { kind: 'scalar', ...base };
  }
  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    const arguments_ = checker.getTypeArguments(type);
    const element = arguments_[0] ?? checker.getIndexTypeOfType(type, ts.IndexKind.Number);
    return { kind: 'array', ...base, element: element ? descriptorFromType(checker, element, depth + 1, seen) : { kind: 'opaque' } };
  }
  if (depth > 8 || seen.has(type)) return { kind: 'opaque', ...base };
  const properties = checker.getPropertiesOfType(type);
  if (properties.length === 0) {
    return type.flags & ts.TypeFlags.Object ? { kind: 'object', ...base, fields: {} } : { kind: 'opaque', ...base };
  }
  const nextSeen = new Set(seen).add(type);
  const fields = {};
  for (const symbol of properties) {
    const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declaration) continue;
    const propertyType = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const descriptor = descriptorFromType(checker, propertyType, depth + 1, nextSeen);
    descriptor.optional = descriptor.optional || Boolean(symbol.flags & ts.SymbolFlags.Optional);
    fields[symbol.name] = descriptor;
  }
  return { kind: 'object', ...base, fields };
}

function descriptorFromNode(checker, node) {
  if (!node) return { kind: 'unknown' };
  const type = checker.getTypeAtLocation(node);
  return descriptorFromType(checker, checker.getAwaitedType(type) ?? type);
}

function parseKeySpec(spec) {
  let value = spec;
  let optional = false;
  let nullable = false;
  if (value.endsWith('|null')) {
    nullable = true;
    value = value.slice(0, -5);
  }
  if (value.endsWith('?')) {
    optional = true;
    value = value.slice(0, -1);
  }
  const segments = value.split('.').map((segment) => ({
    name: segment.replace(/\[\]$/, ''),
    array: segment.endsWith('[]'),
  }));
  return { spec, segments, optional, nullable };
}

function expectedScopes(keySpecs) {
  const scopes = new Map();
  for (const raw of keySpecs) {
    const parsed = parseKeySpec(raw);
    let scope = '';
    for (let index = 0; index < parsed.segments.length; index += 1) {
      const segment = parsed.segments[index];
      if (!scopes.has(scope)) scopes.set(scope, new Set());
      scopes.get(scope).add(segment.name);
      scope = scope ? `${scope}.${segment.name}${segment.array ? '[]' : ''}` : `${segment.name}${segment.array ? '[]' : ''}`;
    }
  }
  return scopes;
}

function descriptorAt(descriptor, segments) {
  let current = descriptor;
  for (const segment of segments) {
    if (current.kind !== 'object') return null;
    const field = current.fields?.[segment.name];
    if (!field) return null;
    if (segment.array) {
      if (field.kind !== 'array') return null;
      current = field.element;
    } else current = field;
  }
  return current;
}

function fieldDescriptorAt(descriptor, segments) {
  let current = descriptor;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (current.kind !== 'object') return null;
    const field = current.fields?.[segment.name];
    if (!field) return null;
    if (index === segments.length - 1) return field;
    if (segment.array) {
      if (field.kind !== 'array') return null;
      current = field.element;
    } else current = field;
  }
  return null;
}

function descriptorScope(descriptor, scope) {
  if (scope === '') return descriptor;
  const segments = scope.split('.').map((segment) => ({ name: segment.replace(/\[\]$/, ''), array: segment.endsWith('[]') }));
  return descriptorAt(descriptor, segments);
}

function shapeDifferences(kind, keys, descriptor) {
  const differences = [];
  if (kind === 'void') {
    if (descriptor.kind !== 'void') differences.push(`kind expected void observed ${descriptor.kind}`);
    return differences;
  }
  if (kind === 'binary') {
    if (descriptor.kind !== 'binary') differences.push(`kind expected binary observed ${descriptor.kind}`);
    return differences;
  }
  if (kind === 'scalar') {
    if (descriptor.kind !== 'scalar') differences.push(`kind expected scalar observed ${descriptor.kind}`);
    return differences;
  }
  const root = kind === 'array' ? descriptor.element : descriptor;
  if (descriptor.kind !== kind) differences.push(`kind expected ${kind} observed ${descriptor.kind}`);
  if (!root || root.kind !== 'object') {
    differences.push('keys unavailable');
    return differences;
  }
  const scopes = expectedScopes(keys);
  if (!scopes.has('')) scopes.set('', new Set());
  for (const [scope, names] of scopes) {
    const observedScope = descriptorScope(root, scope);
    if (!observedScope || observedScope.kind !== 'object') {
      differences.push(`${scope || '<root>'} is not an object`);
      continue;
    }
    const observedNames = Object.keys(observedScope.fields ?? {}).sort();
    const expectedNames = [...names].sort();
    if (JSON.stringify(observedNames) !== JSON.stringify(expectedNames)) {
      differences.push(`${scope || '<root>'} keys expected ${expectedNames.join(',')} observed ${observedNames.join(',')}`);
    }
  }
  for (const raw of keys) {
    const parsed = parseKeySpec(raw);
    const observed = fieldDescriptorAt(root, parsed.segments);
    if (!observed) continue;
    const expectsArray = parsed.segments.at(-1)?.array ?? false;
    if (expectsArray && observed.kind !== 'array') differences.push(`${raw} array expected true observed false`);
    if (observed.optional !== parsed.optional) differences.push(`${raw} optional expected ${parsed.optional} observed ${Boolean(observed.optional)}`);
    if (observed.nullable !== parsed.nullable) differences.push(`${raw} nullable expected ${parsed.nullable} observed ${Boolean(observed.nullable)}`);
  }
  return differences;
}

function functionIndexFor(files) {
  const index = new Map();
  for (const file of files) {
    for (const entry of functionNodes(file.source, file.path)) {
      if (!index.has(entry.name)) index.set(entry.name, entry);
    }
  }
  return index;
}

function functionEntriesByName(files, predicate = () => true) {
  const index = new Map();
  for (const file of files) {
    if (!predicate(file)) continue;
    for (const entry of functionNodes(file.source, file.path)) {
      const entries = index.get(entry.name) ?? [];
      entries.push(entry);
      index.set(entry.name, entries);
    }
  }
  return index;
}

function transitiveCallsAcross(startNames, entriesByName) {
  const seen = new Set();
  function visit(name) {
    if (!name || seen.has(name)) return;
    seen.add(name);
    for (const entry of entriesByName.get(name) ?? []) {
      for (const call of callsInNode(entry.node, { crossFunctions: false })) visit(callName(call));
    }
  }
  for (const name of startNames) visit(name);
  return seen;
}

function transitiveCalls(startNames, functionIndex) {
  const seen = new Set();
  function visit(name) {
    if (!name || seen.has(name)) return;
    seen.add(name);
    const entry = functionIndex.get(name);
    if (!entry) return;
    for (const call of callsInNode(entry.node, { crossFunctions: false })) visit(callName(call));
  }
  for (const name of startNames) visit(name);
  return seen;
}

function parseRequestHandlerEndpoints(handlerFiles, checker, functionIndex) {
  const endpoints = new Map();
  for (const file of handlerFiles) {
    function visit(node, context) {
      if (!ts.isIfStatement(node)) {
        node.forEachChild((child) => visit(child, context));
        return;
      }
      const alternatives = conditionAlternatives(node.expression) ?? [{}];
      for (const alternative of alternatives) {
        const constraints = { ...context, ...alternative };
        const method = constraints.method;
        let path = pathFromConstraints(constraints);
        const newlyComplete = method && path && !context.__endpoint;
        if (newlyComplete) {
          const queries = queryKeysIn(node.thenStatement)
            .filter((key) => key === 'official' || key === 'focusSupportCaseId')
            .map((key) => `${key}=${key === 'official' ? 'true' : DYNAMIC}`);
          if (queries.length > 0) path += `?${queries.join('&')}`;
          const payloads = responsePayloads(node.thenStatement, functionIndex);
          const descriptors = payloads.map((payload) => ({
            ...payload,
            descriptor: payload.kind === 'json'
              ? descriptorFromNode(checker, payload.node)
              : { kind: payload.kind },
          }));
          const sourceText = file.text.slice(node.getStart(), node.getEnd());
          const calls = transitiveCalls(callsInNode(node.thenStatement, { crossFunctions: false }).map(callName), functionIndex);
          endpoints.set(endpointKey(method, path), {
            method,
            path: canonicalPath(path),
            payloads: descriptors,
            calls,
            branchHash: createHash('sha1').update(sourceText).digest('hex').slice(0, 12),
          });
          continue;
        }
        visit(node.thenStatement, constraints);
      }
      if (node.elseStatement) visit(node.elseStatement, context);
    }
    visit(file.source, {});
  }
  return endpoints;
}

function projectionDescriptor(client, checker, functionIndex, seen = new Set()) {
  const entry = functionIndex.get(client);
  if (!entry || seen.has(client)) return null;
  const next = new Set(seen).add(client);
  let candidate = null;
  function inspect(node) {
    if (node !== entry.node && ts.isFunctionLike(node)) return;
    if (ts.isReturnStatement(node) && node.expression && candidate === null) {
      const expression = unwrapExpression(node.expression);
      if (ts.isCallExpression(expression)) {
        const name = callName(expression);
        if (name === 'requestJson' || name === 'jsonRequest' || name === 'fetchApi') {
          candidate = descriptorFromNode(checker, expression);
          return;
        }
        const nested = functionIndex.get(name);
        candidate = nested ? projectionDescriptor(nested.name, checker, functionIndex, next) : descriptorFromNode(checker, expression);
      } else candidate = descriptorFromNode(checker, expression);
      return;
    }
    node.forEachChild(inspect);
  }
  inspect(entry.node.body ?? entry.node);
  if (candidate) return candidate;
  const signature = checker.getSignatureFromDeclaration(entry.node);
  if (!signature) return null;
  const awaited = checker.getAwaitedType(checker.getReturnTypeOfSignature(signature));
  return descriptorFromType(checker, awaited);
}

function sameCall(left, right) {
  return endpointKey(left.method, left.path) === endpointKey(right.method, right.path)
    && (!left.client || !right.client || left.client === right.client);
}

function compareCalls(expected, observed, errors, code, surface, routePattern) {
  for (const call of expected) {
    if (!observed.some((candidate) => sameCall(call, candidate))) {
      errors.push(ERROR(code, `${routePattern} ${surface} omits ${endpointKey(call.method, call.path)} via ${call.client ?? 'unknown client'}`, { routePattern, surface, endpoint: endpointKey(call.method, call.path) }));
    }
  }
  for (const call of observed) {
    if (!expected.some((candidate) => sameCall(candidate, call))) {
      errors.push(ERROR('page-api-unmapped', `${routePattern} ${surface} has unexpected ${endpointKey(call.method, call.path)} via ${call.client ?? 'unknown client'}`, { routePattern, surface, endpoint: endpointKey(call.method, call.path) }));
    }
  }
}

function compareActionSurfaces(expected, observed, actionFunctions, errors, routePattern, surface) {
  const expectedNames = expected.map((item) => item.name).sort();
  const observedNames = observed.map((item) => item.name).sort();
  if (JSON.stringify(expectedNames) !== JSON.stringify(observedNames)) {
    errors.push(ERROR('route-action-surface-mismatch', `${routePattern} ${surface} actions expected ${expectedNames.join(',')} observed ${observedNames.join(',')}`, { routePattern, surface }));
  }
  for (const action of expected) {
    const implementation = actionFunctions.get(action.name);
    if (!implementation) {
      errors.push(ERROR('action-not-found', `${routePattern} action not found: ${action.name}`, { routePattern, action: action.name }));
      continue;
    }
    compareCalls(action.calls, implementation.calls, errors, 'action-call-missing', `${surface}:${action.name}`, routePattern);
  }
}

function publicAuthLeak(client) {
  if (!client) return false;
  if (client.usesAccessHeaders) return true;
  return client.headers.some(({ name, value }) => {
    const lower = String(value).toLowerCase();
    return name === 'authorization'
      || name === 'cf-authorization'
      || name === 'cf-access-jwt-assertion'
      || name === 'x-ccc-access-jwt'
      || lower.includes('bearer ')
      || lower.includes('cf_authorization');
  });
}

function normalizeHeaders(headers) {
  return [...new Set(headers.map(({ name, value }) => `${name.toLowerCase()}:${value}`))].sort();
}

function mapClientBySymbol(map) {
  const result = new Map();
  for (const endpoint of map.endpoints) {
    for (const projection of endpoint.projections) {
      if (projection.client) result.set(projection.client, { endpoint, projection });
    }
  }
  return result;
}

function endpointSuccessDescriptors(endpoint, expectedKind) {
  if (!endpoint) return [];
  if (expectedKind === 'binary-or-object') {
    return endpoint.payloads.filter((payload) => payload.kind === 'binary' || payload.kind === 'json');
  }
  return endpoint.payloads.filter((payload) => payload.status < 400);
}

function compareEndpointShape(expected, observed, errors) {
  const identity = endpointIdentity(expected);
  const candidates = endpointSuccessDescriptors(observed, expected.responseKind);
  if (expected.responseKind === 'binary-or-object') {
    const binary = candidates.find((item) => item.kind === 'binary');
    const object = candidates.find((item) => item.kind === 'json');
    if (!binary || !object) {
      errors.push(ERROR('endpoint-wire-shape-mismatch', `${identity} must expose binary and object variants`, { endpoint: identity }));
      return;
    }
    const differences = shapeDifferences('object', expected.wireKeys, object.descriptor);
    if (differences.length > 0) errors.push(ERROR('endpoint-wire-shape-mismatch', `${identity} wire ${differences.join('; ')}`, { endpoint: identity, differences }));
    return;
  }
  if (candidates.length === 0) {
    errors.push(ERROR('endpoint-wire-shape-mismatch', `${identity} has no ${expected.responseKind} success response`, { endpoint: identity }));
    return;
  }
  for (const candidate of candidates) {
    const descriptor = candidate.kind === 'json' ? candidate.descriptor : { kind: candidate.kind };
    const differences = shapeDifferences(expected.responseKind, expected.wireKeys, descriptor);
    if (differences.length > 0) {
      errors.push(ERROR('endpoint-wire-shape-mismatch', `${identity} wire ${differences.join('; ')}`, { endpoint: identity, differences }));
      return;
    }
  }
}

function piiKey(row) {
  return `${row.dto}.${row.field}`;
}

function piiFieldMatches(expected, observed) {
  return expected.replace(/\[\]/g, '') === observed.replace(/\[\]/g, '');
}

function descriptorFieldPaths(descriptor, prefix = '', seen = new Set()) {
  if (!descriptor || seen.has(descriptor)) return [];
  const nextSeen = new Set(seen).add(descriptor);
  if (descriptor.kind === 'array') return descriptorFieldPaths(descriptor.element, prefix, nextSeen);
  if (descriptor.kind !== 'object') return [];
  const paths = [];
  for (const [name, field] of Object.entries(descriptor.fields ?? {})) {
    const path = prefix ? `${prefix}.${name}` : name;
    paths.push(path);
    paths.push(...descriptorFieldPaths(field.kind === 'array' ? field.element : field, path, nextSeen));
  }
  return paths;
}

function traceWireField(row, trace) {
  return trace.wireField ?? row.wireField ?? row.field;
}

function declaredEndpointHasPiiField(row, trace, endpoint) {
  if (!endpoint) return false;
  const expectedField = traceWireField(row, trace);
  return endpoint.wireKeys.some((key) => {
    const observedField = parseKeySpec(key).segments.map((segment) => segment.name).join('.');
    return piiFieldMatches(expectedField, observedField);
  });
}

function observedEndpointHasPiiField(row, trace, endpoint, expectedKind) {
  const expectedField = traceWireField(row, trace);
  return endpointSuccessDescriptors(endpoint, expectedKind)
    .flatMap((candidate) => descriptorFieldPaths(candidate.descriptor))
    .some((field) => piiFieldMatches(expectedField, field));
}

function routeDeclaredCallKeys(route, map) {
  const calls = [
    ...route.pageLoaderCalls,
    ...route.pageActions.flatMap((action) => action.calls),
    ...route.componentActions.flatMap((surface) => surface.actions.flatMap((action) => action.calls)),
  ];
  if (!PUBLIC_KINDS.has(route.kind)) {
    calls.push(...map.inherited.root.pageLoaderCalls);
    calls.push(...map.inherited.root.componentActions.flatMap((surface) => surface.actions.flatMap((action) => action.calls)));
    if (route.routePattern === '/admin' || route.routePattern.startsWith('/admin/')) {
      calls.push(...map.inherited.admin.pageLoaderCalls);
      calls.push(...map.inherited.admin.componentActions.flatMap((surface) => surface.actions.flatMap((action) => action.calls)));
    }
  }
  return new Set(calls.map((call) => endpointKey(call.method, call.path)));
}

function comparePiiMatrix(map, handlerEndpoints, gatewayFunctions, errors) {
  const expectedKeys = new Set();
  const observedRows = [];
  const declaredRouteCalls = new Map(map.routes.map((route) => [route.routePattern, routeDeclaredCallKeys(route, map)]));
  for (const row of map.pii) {
    const key = piiKey(row);
    if (expectedKeys.has(key)) errors.push(ERROR('pii-row-duplicate', `duplicate PII row: ${key}`, { pii: key }));
    expectedKeys.add(key);
    if (
      typeof row.dto !== 'string'
      || typeof row.field !== 'string'
      || typeof row.wireDto !== 'string'
      || !Array.isArray(row.actors)
      || row.actors.length === 0
      || !Array.isArray(row.pageRoutes)
      || !Array.isArray(row.traces)
      || row.traces.length === 0
      || row.traces.some((trace) => !Array.isArray(trace.gatewayFunctions) || trace.gatewayFunctions.length === 0 || !Array.isArray(trace.guardSymbols) || trace.guardSymbols.length === 0)
    ) {
      errors.push(ERROR('pii-row-incomplete', `PII row is incomplete: ${key}`, { pii: key }));
      continue;
    }
    let complete = true;
    const traceKeys = new Set(row.traces.map((trace) => endpointKey(trace.method, trace.path)));
    for (const routePattern of row.pageRoutes) {
      const calls = declaredRouteCalls.get(routePattern);
      if (!calls) {
        complete = false;
        errors.push(ERROR('pii-route-mismatch', `${key} names unknown page route ${routePattern}`, { pii: key, routePattern }));
      } else if (![...traceKeys].some((traceKey) => calls.has(traceKey))) {
        complete = false;
        errors.push(ERROR('pii-route-mismatch', `${key} ${routePattern} does not reach a declared PII trace`, { pii: key, routePattern }));
      }
    }
    for (const trace of row.traces) {
      const traceKey = endpointKey(trace.method, trace.path);
      const declaredEndpoint = map.endpoints.find((candidate) => endpointKey(candidate.method, candidate.path) === traceKey);
      const endpoint = handlerEndpoints.get(traceKey);
      if (!declaredEndpointHasPiiField(row, trace, declaredEndpoint)) {
        complete = false;
        errors.push(ERROR('pii-row-missing', `${key} is absent from declared ${traceKey} wire keys`, { pii: key, endpoint: traceKey }));
      }
      if (!endpoint) {
        complete = false;
        errors.push(ERROR('pii-row-missing', `${key} route is not implemented: ${traceKey}`, { pii: key, endpoint: traceKey }));
        continue;
      }
      if (!observedEndpointHasPiiField(row, trace, endpoint, declaredEndpoint?.responseKind)) {
        complete = false;
        errors.push(ERROR('pii-row-missing', `${key} is not serialized by ${traceKey}`, { pii: key, endpoint: traceKey }));
      }
      const missingGateway = trace.gatewayFunctions.filter((symbol) => !endpoint.calls.has(symbol));
      const gatewayCalls = transitiveCallsAcross(trace.gatewayFunctions, gatewayFunctions);
      const missingGuards = trace.guardSymbols.filter((symbol) => !gatewayCalls.has(symbol));
      const missing = [...missingGateway, ...missingGuards];
      if (missing.length > 0) {
        complete = false;
        errors.push(ERROR('pii-actor-guard-mismatch', `${key} ${endpointKey(trace.method, trace.path)} is missing ${missing.join(',')}`, { pii: key, endpoint: endpointKey(trace.method, trace.path), missing }));
      }
    }
    if (complete) observedRows.push(structuredClone(row));
  }
  const sensitive = new Set(map.sensitiveFieldNames ?? []);
  for (const expectedEndpoint of map.endpoints) {
    const observedEndpoint = handlerEndpoints.get(endpointKey(expectedEndpoint.method, expectedEndpoint.path));
    const candidates = endpointSuccessDescriptors(observedEndpoint, expectedEndpoint.responseKind);
    for (const field of candidates.flatMap((candidate) => descriptorFieldPaths(candidate.descriptor))) {
      const leaf = field.split('.').at(-1);
      if (!sensitive.has(leaf)) continue;
      const authorized = map.pii.some((row) => row.traces.some((trace) => (
        endpointKey(trace.method, trace.path) === endpointKey(expectedEndpoint.method, expectedEndpoint.path)
        && piiFieldMatches(traceWireField(row, trace), field)
      )));
      if (!authorized) errors.push(ERROR('pii-unauthorized-field', `${endpointIdentity(expectedEndpoint)} serializes undeclared PII field ${field}`, { endpoint: endpointIdentity(expectedEndpoint), field }));
    }
  }
  return observedRows;
}

async function loadInventory(root) {
  const text = await readSource(resolve(root, 'scripts/design/route-inventory.json'));
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

export async function verifyScreenApiMap({ rootDir, map, sourceRoot = map?.sourceRoot ?? 'apps/web/app', apiSourceRoot = map?.apiSourceRoot ?? 'apps/api/src' } = {}) {
  if (!map || !Array.isArray(map.routes) || !Array.isArray(map.endpoints) || !Array.isArray(map.pii)) {
    throw new TypeError('verifyScreenApiMap requires a complete machine-readable S3 map');
  }
  const root = resolve(rootDir ?? process.cwd());
  const errors = [];
  const webPaths = await filesBelow(resolve(root, sourceRoot));
  const apiPaths = await filesBelow(resolve(root, apiSourceRoot));
  const tracePaths = (map.traceSourceRoots ?? []).flatMap((path) => {
    const absolute = resolve(root, path);
    return SOURCE_EXTENSIONS.includes(extname(absolute)) ? [absolute] : [];
  });
  const allPaths = [...new Set([...webPaths, ...apiPaths, ...tracePaths])];
  const modules = await buildModules(allPaths, root);
  const program = ts.createProgram({
    rootNames: allPaths,
    options: { allowJs: true, checkJs: false, jsx: ts.JsxEmit.Preserve, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, skipLibCheck: true, strictNullChecks: true },
  });
  const checker = program.getTypeChecker();
  const typedFiles = allPaths.map((path) => ({ path, text: modules.get(path)?.text ?? '', source: program.getSourceFile(path) ?? modules.get(path)?.source })).filter((file) => file.source);
  const functionIndex = functionIndexFor(typedFiles);
  const gatewayFunctions = functionEntriesByName(typedFiles, (file) => file.path.endsWith('/db/gateway.ts'));
  const apiPath = resolve(root, sourceRoot, 'lib/api.ts');
  const actionPath = resolve(root, sourceRoot, 'actions.ts');
  const actionRoot = resolve(root, sourceRoot);
  const apiModule = modules.get(apiPath);
  const actionModules = [...modules.values()].filter((module) => (
    module.path === actionPath
    || module.path.endsWith('/theme-action.ts')
    || module.path.endsWith('/logout-action.ts')
  ));
  if (!apiModule || actionModules.length === 0) throw new TypeError('screen API verifier requires apps/web/app/lib/api.ts and server action modules');
  const apiFunctions = parseApiFunctions(apiModule);
  const actionFunctions = parseActionFunctions(actionModules, apiFunctions);
  const actionPaths = new Set(actionModules.map((module) => module.path));
  const loaderExclusions = new Set([apiPath, ...actionPaths]);
  const handlerFiles = typedFiles.filter((file) => file.path.endsWith('/request-handler.ts') || file.path.endsWith('/index.ts'));
  const handlerEndpoints = parseRequestHandlerEndpoints(handlerFiles, checker, functionIndex);

  if (hasFixtureSentinel(map)) errors.push(ERROR('fixture-sentinel-forbidden', 'checked map contains a fixture sentinel'));
  const endpointIdentities = new Set();
  const endpointDtosByRequest = new Map();
  for (const endpoint of map.endpoints) {
    if (!RESPONSE_KINDS.has(endpoint.responseKind) || !Array.isArray(endpoint.wireKeys) || !Array.isArray(endpoint.projections) || endpoint.projections.length === 0) {
      errors.push(ERROR('endpoint-contract-incomplete', `${endpoint.method} ${endpoint.path} lacks explicit kind, keys, or projections`));
      continue;
    }
    if (endpoint.responseKind === 'void' && endpoint.wireKeys.length !== 0) {
      errors.push(ERROR('endpoint-contract-incomplete', `${endpoint.method} ${endpoint.path} void response must have zero wire keys`));
    }
    for (const projection of endpoint.projections) {
      if (!PROJECTION_KINDS.has(projection.projectionKind) || !Array.isArray(projection.projectionKeys)) {
        errors.push(ERROR('endpoint-contract-incomplete', `${endpoint.method} ${endpoint.path} has an incomplete projection contract`));
      }
      if (['void', 'none', 'scalar'].includes(projection.projectionKind) && projection.projectionKeys.length !== 0) {
        errors.push(ERROR('endpoint-contract-incomplete', `${endpoint.method} ${endpoint.path} ${projection.projectionKind} projection must have zero keys`));
      }
    }
    const identity = endpointIdentity(endpoint);
    if (endpointIdentities.has(identity)) errors.push(ERROR('endpoint-duplicate', `duplicate endpoint identity: ${identity}`, { endpoint: identity }));
    endpointIdentities.add(identity);
    const requestIdentity = endpointKey(endpoint.method, endpoint.path);
    const previousDto = endpointDtosByRequest.get(requestIdentity);
    if (previousDto && previousDto !== endpoint.wireDto) {
      errors.push(ERROR('endpoint-dto-mismatch', `${requestIdentity} maps to both ${previousDto} and ${endpoint.wireDto}`, { endpoint: identity }));
    }
    endpointDtosByRequest.set(requestIdentity, endpoint.wireDto);
  }

  const pagePaths = webPaths.filter((path) => /\/page\.[^.]+$/.test(path));
  const pageSet = new Set(pagePaths.map((path) => routePatternForPage(root, path)));
  const mapRouteSet = new Set(map.routes.map((route) => route.routePattern));
  for (const route of map.routes) {
    if (!modules.has(resolve(root, route.page))) errors.push(ERROR('route-not-found', `route page not found: ${route.page}`, { routePattern: route.routePattern }));
  }
  for (const actual of pageSet) if (!mapRouteSet.has(actual)) errors.push(ERROR('route-unmapped', `page is absent from map: ${actual}`, { routePattern: actual }));

  const inventory = await loadInventory(root);
  if (inventory?.routes) {
    const inventoryRows = inventory.routes.map((route) => `${route.page} ${route.routePattern}`).sort();
    const mapRows = map.routes.map((route) => `${route.page} ${route.routePattern}`).sort();
    if (JSON.stringify(inventoryRows) !== JSON.stringify(mapRows)) errors.push(ERROR('inventory-mismatch', 'route map differs from route inventory'));
  }

  const rootLayoutPath = resolve(root, sourceRoot, 'layout.tsx');
  const adminLayoutPath = resolve(root, sourceRoot, 'admin/layout.tsx');
  const rootModule = modules.get(rootLayoutPath);
  const adminModule = modules.get(adminLayoutPath);
  if (map.routes.some((route) => PUBLIC_KINDS.has(route.kind)) && rootModule && !hasRootPublicShellBypass(rootModule)) {
    errors.push(ERROR('public-shell-leak', 'root layout does not return before business shell work for x-ccc-public=1'));
  }
  const rootLoaderCalls = rootModule ? loaderCalls(rootLayoutPath, modules, apiFunctions, loaderExclusions) : [];
  const adminLoaderCalls = adminModule ? loaderCalls(adminLayoutPath, modules, apiFunctions, loaderExclusions) : [];
  const rootComponentSurfaces = rootModule ? componentActionSurfaces(rootLayoutPath, modules, actionRoot, actionPaths, actionFunctions) : [];
  const adminComponentSurfaces = adminModule ? componentActionSurfaces(adminLayoutPath, modules, actionRoot, actionPaths, actionFunctions) : [];
  compareCalls(map.inherited.root.pageLoaderCalls, rootLoaderCalls, errors, 'inherited-api-missing', 'root-loader', '<root-layout>');
  compareCalls(map.inherited.admin.pageLoaderCalls, adminLoaderCalls, errors, 'inherited-api-missing', 'admin-loader', '<admin-layout>');
  const expectedRootComponents = map.inherited.root.componentActions.map((item) => ({ component: item.component, actions: item.actions.map((action) => action.name).sort() })).sort((a, b) => a.component.localeCompare(b.component));
  const expectedAdminComponents = map.inherited.admin.componentActions.map((item) => ({ component: item.component, actions: item.actions.map((action) => action.name).sort() })).sort((a, b) => a.component.localeCompare(b.component));
  if (JSON.stringify(rootComponentSurfaces) !== JSON.stringify(expectedRootComponents)) errors.push(ERROR('inherited-component-action-mismatch', 'root inherited component actions differ'));
  if (JSON.stringify(adminComponentSurfaces) !== JSON.stringify(expectedAdminComponents)) errors.push(ERROR('inherited-component-action-mismatch', 'admin inherited component actions differ'));
  for (const surface of map.inherited.root.componentActions) compareActionSurfaces(surface.actions, surface.actions, actionFunctions, errors, '<root-layout>', `component:${surface.component}`);
  for (const surface of map.inherited.admin.componentActions) compareActionSurfaces(surface.actions, surface.actions, actionFunctions, errors, '<admin-layout>', `component:${surface.component}`);

  const clientCatalog = mapClientBySymbol(map);
  for (const [name, client] of apiFunctions) {
    if (!client.exported || client.direct.length === 0) continue;
    if (!clientCatalog.has(name)) errors.push(ERROR('endpoint-projection-unmapped', `API client ${name} has no endpoint projection contract`, { client: name }));
  }

  const routes = [];
  const usedEndpointIdentities = new Set();
  for (const route of map.routes) {
    const pagePath = resolve(root, route.page);
    const pageModule = modules.get(pagePath);
    const pageLoaderCalls = pageModule ? loaderCalls(pagePath, modules, apiFunctions, loaderExclusions) : [];
    const directPageActions = pageModule ? [...referencedImports(pageModule, actionPaths, new Set(actionFunctions.keys()))].sort() : [];
    const pageActions = directPageActions.map((name) => ({ name, calls: actionFunctions.get(name)?.calls ?? [] }));
    const componentSurfaces = pageModule ? componentActionSurfaces(pagePath, modules, actionRoot, actionPaths, actionFunctions) : [];
    const componentActions = componentSurfaces.map((surface) => ({
      component: surface.component,
      actions: surface.actions.map((name) => ({ name, calls: actionFunctions.get(name)?.calls ?? [] })),
    }));
    compareCalls(route.pageLoaderCalls, pageLoaderCalls, errors, 'page-api-missing', 'page-loader', route.routePattern);
    compareActionSurfaces(route.pageActions, pageActions, actionFunctions, errors, route.routePattern, 'page-actions');
    const expectedComponentSummary = route.componentActions.map((surface) => ({ component: surface.component, actions: surface.actions.map((action) => action.name).sort() })).sort((a, b) => a.component.localeCompare(b.component));
    const observedComponentSummary = componentActions.map((surface) => ({ component: surface.component, actions: surface.actions.map((action) => action.name).sort() })).sort((a, b) => a.component.localeCompare(b.component));
    if (JSON.stringify(expectedComponentSummary) !== JSON.stringify(observedComponentSummary)) {
      errors.push(ERROR('route-action-surface-mismatch', `${route.routePattern} rendered component action surface differs`, { routePattern: route.routePattern }));
    }
    for (const surface of route.componentActions) compareActionSurfaces(surface.actions, surface.actions, actionFunctions, errors, route.routePattern, `component:${surface.component}`);
    const inherited = PUBLIC_KINDS.has(route.kind)
      ? { root: { pageLoaderCalls: [], componentActions: [] }, admin: { pageLoaderCalls: [], componentActions: [] } }
      : {
        root: structuredClone(map.inherited.root),
        admin: route.routePattern === '/admin' || route.routePattern.startsWith('/admin/') ? structuredClone(map.inherited.admin) : { pageLoaderCalls: [], componentActions: [] },
      };
    for (const call of [...route.pageLoaderCalls, ...route.pageActions.flatMap((action) => action.calls), ...route.componentActions.flatMap((surface) => surface.actions.flatMap((action) => action.calls))]) {
      const endpoint = map.endpoints.find((candidate) => endpointKey(candidate.method, candidate.path) === endpointKey(call.method, call.path));
      if (!endpoint) {
        errors.push(ERROR('endpoint-method-path-mismatch', `${route.routePattern} references missing ${endpointKey(call.method, call.path)}`, { routePattern: route.routePattern }));
        continue;
      }
      if (call.wireDto !== endpoint.wireDto) errors.push(ERROR('endpoint-dto-mismatch', `${route.routePattern} expected ${call.wireDto} but endpoint is ${endpoint.wireDto}`, { routePattern: route.routePattern, endpoint: endpointIdentity(endpoint) }));
      const projection = endpoint.projections.find((candidate) => candidate.client === call.client);
      if (!projection || projection.dto !== call.projectionDto) errors.push(ERROR('endpoint-dto-mismatch', `${route.routePattern} projection ${call.client} is not ${call.projectionDto}`, { routePattern: route.routePattern, endpoint: endpointIdentity(endpoint) }));
      usedEndpointIdentities.add(endpointIdentity(endpoint));
    }
    if (PUBLIC_KINDS.has(route.kind)) {
      for (const call of [...pageLoaderCalls, ...pageActions.flatMap((action) => action.calls), ...componentActions.flatMap((surface) => surface.actions.flatMap((action) => action.calls))]) {
        if (publicAuthLeak(apiFunctions.get(call.client))) errors.push(ERROR('public-auth-leak', `${route.routePattern} client ${call.client} uses business authentication`, { routePattern: route.routePattern, client: call.client }));
      }
    }
    if (route.kind === 'redirect' && route.routePattern !== '/' && route.pageLoaderCalls.length > 0) errors.push(ERROR('redirect-api-leak', `${route.routePattern} is redirect-only but declares loader calls`));
    routes.push({ ...route, inherited, observed: { pageLoaderCalls, pageActions, componentActions }, sourceFound: Boolean(pageModule) });
  }

  const routeHandlerPath = resolve(root, sourceRoot, 'preview/unlock/route.ts');
  const routeHandlerModule = modules.get(routeHandlerPath);
  const expectedHandler = map.routeHandlers?.find((handler) => handler.routePattern === '/preview/unlock');
  if (expectedHandler && !routeHandlerModule) errors.push(ERROR('route-handler-missing', 'declared preview unlock route handler is absent'));
  if (expectedHandler && routeHandlerModule) {
    const observedCalls = apiCallsInAst(routeHandlerModule.source, apiFunctions);
    compareCalls(expectedHandler.calls, observedCalls, errors, 'route-handler-api-missing', 'route-handler', '/preview/unlock');
    for (const call of expectedHandler.calls) {
      const endpoint = map.endpoints.find((candidate) => endpointKey(candidate.method, candidate.path) === endpointKey(call.method, call.path));
      if (!endpoint) {
        errors.push(ERROR('endpoint-method-path-mismatch', `/preview/unlock references missing ${endpointKey(call.method, call.path)}`));
        continue;
      }
      if (call.wireDto !== endpoint.wireDto) errors.push(ERROR('endpoint-dto-mismatch', `/preview/unlock expected ${call.wireDto} but endpoint is ${endpoint.wireDto}`, { endpoint: endpointIdentity(endpoint) }));
      const projection = endpoint.projections.find((candidate) => candidate.client === call.client);
      if (!projection || projection.dto !== call.projectionDto) errors.push(ERROR('endpoint-dto-mismatch', `/preview/unlock projection ${call.client} is not ${call.projectionDto}`, { endpoint: endpointIdentity(endpoint) }));
      usedEndpointIdentities.add(endpointIdentity(endpoint));
    }
  }

  const endpointObservations = [];
  for (const endpoint of map.endpoints) {
    const key = endpointKey(endpoint.method, endpoint.path);
    const observed = handlerEndpoints.get(key);
    if (!observed) {
      errors.push(ERROR('endpoint-method-path-mismatch', `${endpointIdentity(endpoint)} is not implemented by a request handler`, { endpoint: endpointIdentity(endpoint) }));
    } else {
      compareEndpointShape(endpoint, observed, errors);
      endpointObservations.push({ method: endpoint.method, path: endpoint.path, wireDto: endpoint.wireDto, responseKind: endpoint.responseKind, wireKeys: endpoint.wireKeys, branchHash: observed.branchHash });
    }
    for (const projection of endpoint.projections) {
      if (projection.projectionKind === 'none') {
        if (projection.client !== null) errors.push(ERROR('endpoint-contract-incomplete', `${endpointIdentity(endpoint)} none projection must use client:null`));
        continue;
      }
      const client = apiFunctions.get(projection.client);
      if (!client) {
        errors.push(ERROR('endpoint-projection-mismatch', `${endpointIdentity(endpoint)} client not found: ${projection.client}`, { endpoint: endpointIdentity(endpoint), client: projection.client }));
        continue;
      }
      if (!client.direct.some((call) => endpointKey(call.method, call.path) === key)) {
        errors.push(ERROR('endpoint-method-path-mismatch', `${projection.client} no longer calls ${key}`, { endpoint: endpointIdentity(endpoint), client: projection.client }));
      }
      if (client.returnIdentity !== projection.sourceDto) {
        errors.push(ERROR('endpoint-dto-mismatch', `${projection.client} return DTO expected ${projection.sourceDto} observed ${client.returnIdentity}`, { endpoint: endpointIdentity(endpoint), client: projection.client }));
      }
      const descriptor = projectionDescriptor(projection.client, checker, functionIndex);
      const differences = descriptor ? shapeDifferences(projection.projectionKind, projection.projectionKeys, descriptor) : ['projection unavailable'];
      if (differences.length > 0) errors.push(ERROR('endpoint-projection-mismatch', `${endpointIdentity(endpoint)} ${projection.client} projection ${differences.join('; ')}`, { endpoint: endpointIdentity(endpoint), client: projection.client, differences }));
      if (projection.auth === 'public-token' || projection.auth === 'public-code') {
        if (publicAuthLeak(client)) errors.push(ERROR('public-auth-leak', `${projection.client} uses Access/Bearer headers`, { client: projection.client }));
        const observedHeaders = normalizeHeaders(client.ownHeaders);
        const expectedHeaders = [...projection.headers].sort();
        if (JSON.stringify(observedHeaders) !== JSON.stringify(expectedHeaders)) errors.push(ERROR('public-header-mismatch', `${projection.client} headers expected ${expectedHeaders.join(',')} observed ${observedHeaders.join(',')}`, { client: projection.client }));
      }
    }
  }

  const catalogKeys = new Set(map.endpoints.map((endpoint) => endpointKey(endpoint.method, endpoint.path)));
  for (const key of handlerEndpoints.keys()) {
    if (!catalogKeys.has(key)) errors.push(ERROR('endpoint-unmapped', `${key} request-handler branch is absent from catalog`, { endpoint: key }));
  }

  for (const endpoint of map.endpoints.filter((item) => item.status !== 'unmapped-by-current-page')) {
    const hasMappedClient = endpoint.projections.some((projection) => projection.client !== null);
    if (hasMappedClient && !usedEndpointIdentities.has(endpointIdentity(endpoint)) && !endpoint.sharedOnly) {
      errors.push(ERROR('endpoint-route-missing', `${endpointIdentity(endpoint)} has no route surface`, { endpoint: endpointIdentity(endpoint) }));
    }
  }
  const orphans = map.endpoints.filter((endpoint) => endpoint.status === 'unmapped-by-current-page').map((endpoint) => structuredClone(endpoint));
  for (const endpoint of orphans) if (usedEndpointIdentities.has(endpointIdentity(endpoint))) errors.push(ERROR('orphan-used', `${endpointIdentity(endpoint)} is declared orphan but has a page caller`, { endpoint: endpointIdentity(endpoint) }));

  const observedPii = comparePiiMatrix(map, handlerEndpoints, gatewayFunctions, errors);
  if (observedPii.length !== map.pii.length) errors.push(ERROR('pii-matrix-mismatch', `PII matrix expected ${map.pii.length} observed ${observedPii.length}`));

  const counts = map.counts ?? {};
  const summary = {
    routes: map.routes.length,
    operating: map.routes.filter((route) => route.kind === 'screen').length,
    public: map.routes.filter((route) => route.kind === 'public').length,
    redirect: map.routes.filter((route) => route.kind === 'redirect').length,
    kit: map.routes.filter((route) => route.kind === 'kit').length,
    endpoints: map.endpoints.length,
    piiFields: map.pii.length,
  };
  for (const [name, actual] of Object.entries(summary)) {
    if (!Number.isInteger(counts[name]) || counts[name] !== actual) {
      errors.push(ERROR('explicit-count-mismatch', `${name} count expected ${counts[name] ?? '<missing>'} actual ${actual}`));
    }
  }
  return {
    ok: errors.length === 0,
    summary,
    routes,
    errors,
    orphans,
    piiMatrix: structuredClone(map.pii),
    observedPiiMatrix: observedPii,
    gaps: structuredClone(map.gaps ?? []),
    implementedGaps: [],
    redirectExceptions: structuredClone(map.redirectExceptions ?? []),
    actorSurfaces: structuredClone(map.actorSurfaces ?? {}),
    endpointObservations,
    observed: {
      routeCount: pagePaths.length,
      endpointCount: handlerEndpoints.size,
      networkRequests: 0,
      root: { pageLoaderCalls: rootLoaderCalls, componentActions: rootComponentSurfaces },
      admin: { pageLoaderCalls: adminLoaderCalls, componentActions: adminComponentSurfaces },
    },
  };
}

export default verifyScreenApiMap;
