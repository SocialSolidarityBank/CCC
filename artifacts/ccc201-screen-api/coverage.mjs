import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const root = realpathSync(process.argv[2]);
const out = resolve(process.argv[3]);
const require = createRequire(join(root, 'package.json'));
const ts = require('typescript');
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap(e => {
  if (['node_modules', '.next', 'dist'].includes(e.name)) return [];
  const p = join(dir, e.name);
  return e.isDirectory() ? walk(p) : [p];
});
const app = join(root, 'apps/web/app');
const files = walk(app).filter(p => /\.[cm]?[jt]sx?$/.test(p) && !/\.test\./.test(p));
const program = ts.createProgram([...files, join(root, 'packages/http-api/src/request-handler.ts')], { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve, allowJs: true, skipLibCheck: true, types: [] });
const checker = program.getTypeChecker();
const rel = p => relative(root, realpathSync(p)).replaceAll('\\', '/');
const inventory = JSON.parse(readFileSync(join(root, 'scripts/design/route-inventory.json'), 'utf8'));
const pageFiles = files.filter(p => p.endsWith('/page.tsx'));
const pattern = p => '/' + relative(app, p).replace(/(^|\/)page\.tsx$/, '').split('/').filter(Boolean).map(x => /^\[.+\]$/.test(x) ? ':' + x.slice(1, -1) : x).join('/');
const sourceHash = {};
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const literalOperations = new Set();
function closure(entryFiles, names = []) {
  const visited = new Set(), reached = new Set(), apiHelpers = new Set(), actions = new Set(), operations = new Set();
  const edges = new Set(), boundOperations = new Set();
  function visit(node) {
    if (!node || visited.has(node)) return;
    visited.add(node);
    const sf = node.getSourceFile();
    if (!sf || sf.isDeclarationFile) return;
    const path = rel(sf.fileName);
    if (path.startsWith('../') || path.includes('/node_modules/')) return;
    reached.add(path); sourceHash[path] ??= hash(sf.fileName);
    if (ts.isTypeNode(node) || ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isFunctionDeclaration(node) && node.name) {
      if (path === 'apps/web/app/lib/api.ts' && node.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)) apiHelpers.add(node.name.text);
      if ((/Action$/.test(node.name.text) || node.body?.statements.some(s => ts.isExpressionStatement(s)
        && ts.isStringLiteral(s.expression) && s.expression.text === 'use server')) && path.startsWith('apps/web/')) actions.add(node.name.text);
    }
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(sf) === 'form') {
      const attributes = Object.fromEntries(node.attributes.properties.filter(ts.isJsxAttribute)
        .filter(a => a.initializer && ts.isStringLiteral(a.initializer)).map(a => [a.name.getText(sf), a.initializer.text]));
      if (attributes.action?.startsWith('/')) boundOperations.add(`${(attributes.method ?? 'GET').toUpperCase()} ${attributes.action}`);
    }
    if (ts.isCallExpression(node) && /^(requestJson|jsonRequest|fetchApi)$/.test(node.expression.getText(sf))) {
      operations.add(node.getText(sf));
      const callName = node.expression.getText(sf);
      let argument = node.arguments[0];
      if (callName === 'fetchApi' && argument && ts.isCallExpression(argument) && argument.expression.getText(sf) === 'endpoint') argument = argument.arguments[0];
      if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument) || ts.isTemplateExpression(argument))) {
        const path = (ts.isTemplateExpression(argument) ? argument.head.text + argument.templateSpans.map(span => {
          const declaration = checker.getSymbolAtLocation(span.expression)?.valueDeclaration;
          const initializer = declaration && ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
          const alternatives = initializer && ts.isConditionalExpression(initializer) ? [initializer.whenTrue, initializer.whenFalse] : [initializer];
          const queryOnly = alternatives.every(value => value && (
            ((ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) && (value.text === '' || value.text.startsWith('?')))
            || (ts.isTemplateExpression(value) && value.head.text.startsWith('?'))));
          return (queryOnly ? '' : ':param') + span.literal.text;
        }).join('') : argument.text).split('?')[0];
        let method = 'GET';
        if (callName === 'jsonRequest' && node.arguments[1] && ts.isStringLiteral(node.arguments[1])) method = node.arguments[1].text;
        else if (node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
          const property = node.arguments[1].properties.find(p => ts.isPropertyAssignment(p) && p.name.getText(sf) === 'method');
          if (property && ts.isStringLiteral(property.initializer)) method = property.initializer.text;
        }
        if (path.startsWith('/')) { literalOperations.add(`${method} ${path}`); boundOperations.add(`${method} ${path}`); }
      }
    }
    if (ts.isIdentifier(node)) {
      let symbol = checker.getSymbolAtLocation(node);
      if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      for (const decl of symbol?.declarations ?? []) {
        const target = decl.getSourceFile();
        if (target.isDeclarationFile) continue;
        const targetPath = rel(target.fileName);
        if (!targetPath.startsWith('../') && !targetPath.includes('/node_modules/')) {
          edges.add(`${path}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1} -> ${targetPath}:${target.getLineAndCharacterOfPosition(decl.getStart()).line + 1}`);
          visit(decl);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  for (const file of entryFiles) {
    const sf = program.getSourceFile(file);
    assert.ok(sf, file);
    for (const node of sf.statements) {
      if (ts.isExportAssignment(node) || node.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)
        || (node.name && names.includes(node.name.text))) visit(node);
    }
  }
  return { sourceFiles: [...reached].sort(), apiHelpers: [...apiHelpers].sort(), actions: [...actions].sort(), operations: [...operations].sort(), boundOperations: [...boundOperations].sort(), edges: [...edges].sort() };
}
const routes = pageFiles.map(page => {
  const layouts = [];
  for (let dir = dirname(page); dir.startsWith(app); dir = dirname(dir)) {
    const layout = join(dir, 'layout.tsx');
    if (files.includes(layout)) layouts.unshift(layout);
    if (dir === app) break;
  }
  return { route: pattern(page), page: rel(page), layouts: layouts.map(rel),
    inventory: inventory.routes.find(r => r.page === rel(page)) ?? null,
    direct: closure([page]), withLayouts: closure([page, ...layouts]) };
}).sort((a,b) => a.route.localeCompare(b.route));
const handlers = files.filter(p => /\/route\.tsx?$/.test(p)).map(p => ({ path: rel(p), sha256: hash(p) }));
const declared = inventory.routes.map(r => r.page), actual = routes.map(r => r.page);
const httpPath = join(root, 'packages/http-api/src/request-handler.ts');
const httpSource = program.getSourceFile(httpPath);
const httpHandler = httpSource.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'handleRequest');
const httpMethodBranches = [];
function dispatch(node, ancestors = []) {
  if (ts.isIfStatement(node)) {
    const condition = node.expression.getText(httpSource);
    const context = [...ancestors, condition];
    if (condition.includes('request.method')) {
      httpMethodBranches.push({ line: httpSource.getLineAndCharacterOfPosition(node.getStart()).line + 1,
        endLine: httpSource.getLineAndCharacterOfPosition(node.end).line + 1,
        conditions: context });
    }
    dispatch(node.thenStatement, context);
    if (node.elseStatement) dispatch(node.elseStatement, [...ancestors, `NOT (${condition})`]);
    return;
  }
  ts.forEachChild(node, child => dispatch(child, ancestors));
}
dispatch(httpHandler.body);
sourceHash[rel(httpPath)] = hash(httpPath);
const documentPath = resolve(process.argv[4]);
const document = readFileSync(documentPath, 'utf8');
const ledger = JSON.parse(readFileSync(join(dirname(out), 'endpoints.json'), 'utf8'));
const normalize = operation => operation.replace(/:[A-Za-z][A-Za-z0-9]*/g, ':param').split('?')[0];
const liveOperations = new Set(ledger.groups.flatMap(g => g.operations.map(normalize)));
const retiredOperations = [
  'GET /invites/participant/:token/me', 'GET /invites/worker/:token', 'POST /invites/worker',
  'POST /invites/counselor', 'PUT /support-cases/:id/consent', 'POST /cases/:id/pilot-text-ai-consent',
  'POST /sessions/:id/ai/source', 'GET /pipeline/jobs', 'GET /pipeline/text-jobs',
  'GET /pipeline/text-jobs/:item/source', 'POST /pipeline/text-jobs/:item/complete',
  'POST /pipeline/jobs/:sessionId/audio/result',
];
const retired = new Set(retiredOperations.map(normalize));
const documentedRoutes = [...document.matchAll(/^\| \d+ \| `([^`]+)`/gm)].map(m => m[1]);
const actionFiles = ['actions.ts','logout-action.ts','theme-action.ts'].map(p => program.getSourceFile(join(app,p)));
const exportedActions = actionFiles.flatMap(sf => sf.statements.filter(n => ts.isFunctionDeclaration(n) && n.name
  && n.modifiers?.some(m => m.kind === ts.SyntaxKind.ExportKeyword)).map(n => n.name.text));
function mergeClauses(left, right) {
  return left.flatMap(a => right.flatMap(b => Object.keys(b).some(key => key in a && a[key] !== b[key]) ? [] : [{...a,...b}]));
}
function routeClauses(expression, seen = new Set()) {
  if (ts.isParenthesizedExpression(expression)) return routeClauses(expression.expression, seen);
  if (ts.isIdentifier(expression) && !seen.has(expression)) {
    const declaration = checker.getSymbolAtLocation(expression)?.valueDeclaration;
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      return routeClauses(declaration.initializer, new Set([...seen, expression]));
    }
  }
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind;
    if (kind === ts.SyntaxKind.AmpersandAmpersandToken) return mergeClauses(routeClauses(expression.left, seen), routeClauses(expression.right, seen));
    if (kind === ts.SyntaxKind.BarBarToken) return [...routeClauses(expression.left, seen), ...routeClauses(expression.right, seen)];
    if (kind === ts.SyntaxKind.EqualsEqualsEqualsToken && (ts.isStringLiteral(expression.right) || ts.isNumericLiteral(expression.right))) {
      const key = expression.left.getText(httpSource).replace(/\s/g,'').replace(/^pubParts/,'parts');
      if (key === 'request.method' || key === 'url.pathname' || key === 'parts.length' || /^parts\[\d+\]$/.test(key)) {
        return [{[key]:ts.isNumericLiteral(expression.right) ? Number(expression.right.text) : expression.right.text}];
      }
    }
  }
  return [{}];
}
const dispatchReturns = [];
function returnedRoutes(node, clauses = [{}]) {
  if (ts.isIfStatement(node)) {
    returnedRoutes(node.thenStatement, mergeClauses(clauses,routeClauses(node.expression)));
    if (node.elseStatement) returnedRoutes(node.elseStatement, clauses);
    return;
  }
  if (ts.isBlock(node)) {
    let remaining = clauses;
    for (const statement of node.statements) {
      returnedRoutes(statement, remaining);
      if (ts.isIfStatement(statement) && ts.isBinaryExpression(statement.expression)
        && statement.expression.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken
        && statement.expression.left.getText(httpSource) === 'request.method'
        && ts.isStringLiteral(statement.expression.right) && ts.isReturnStatement(statement.thenStatement)) {
        remaining = mergeClauses(remaining,[{'request.method':statement.expression.right.text}]);
      }
    }
    return;
  }
  if (ts.isReturnStatement(node)) {
    for (const clause of clauses) {
      const method = clause['request.method'];
      const length = clause['parts.length'];
      const path = clause['url.pathname'] ?? (typeof length === 'number' && length > 0
        ? '/' + Array.from({length},(_,i) => clause[`parts[${i}]`] ?? ':param').join('/') : null);
      if (method && path && !path.startsWith('/:param')) {
        dispatchReturns.push({operation:`${method} ${path}`,line:httpSource.getLineAndCharacterOfPosition(node.getStart()).line+1,
          expression:node.expression?.getText(httpSource) ?? 'empty'});
      }
    }
    return;
  }
  if (!ts.isFunctionLike(node)) ts.forEachChild(node, child => returnedRoutes(child, clauses));
}
returnedRoutes(httpHandler.body);
const sourceDispatchOperations = new Set(dispatchReturns.map(row => normalize(row.operation)));
const dispatchComparison = {
  sourceOnly:[...sourceDispatchOperations].filter(op => !liveOperations.has(op) && !retired.has(op)),
  ledgerOnly:[...liveOperations].filter(op => !sourceDispatchOperations.has(op)),
  sourceOperationCount:sourceDispatchOperations.size,
  ledgerOperationCount:liveOperations.size,
  limitation:'Route predicates are statically expanded; non-route authorization/data branches may have multiple return sites for one operation.',
};
const rowOperations = row => [...row.matchAll(/`((?:GET|POST|PUT|PATCH|DELETE) \/[^` ]+)`/g)].map(m => normalize(m[1]));
const routeEdges = routes.map(route => {
  const row = document.split('\n').find(line => /^\| \d+ \| `([^`]+)`/.exec(line)?.[1] === route.route) ?? '';
  const publicRoute = route.inventory?.permission.state === 'public';
  const observed = publicRoute ? route.direct : route.withLayouts;
  const declaredOperations = new Set(rowOperations(row));
  const declaredActions = new Set(exportedActions.filter(action => row.includes(action)));
  if (row.includes('+shell-actions')) {
    for (const op of ['GET /organization/profile','GET /participants/new-signup-count']) declaredOperations.add(op);
    declaredActions.add('logoutAction'); declaredActions.add('toggleThemeAction');
  }
  if (row.includes('+admin-layout')) declaredOperations.add('GET /me');
  if (row.includes('submitRecord')) declaredActions.add('submitRecord');
  return { route:route.route, effectiveOperations:observed.boundOperations,
    missingOperations:observed.boundOperations.filter(op => !declaredOperations.has(normalize(op))),
    missingActions:observed.actions.filter(action => !declaredActions.has(action)) };
});
const reachableActions = new Set(routes.flatMap(route => route.withLayouts.actions));
const orphanEdges = actionFiles.flatMap(sf => sf.statements.filter(n => ts.isFunctionDeclaration(n) && n.name
  && exportedActions.includes(n.name.text) && !reachableActions.has(n.name.text)).map(node => {
    const facts = closure([sf.fileName],[node.name.text]);
    const row = document.split('\n').find(line => line.startsWith('| `'+node.name.text+'`')) ?? '';
    const declared = new Set(rowOperations(row));
    return { action:node.name.text, facts, missingOperations:facts.boundOperations.filter(op => !declared.has(normalize(op))) };
  }));
const comparison = {
  documentSha256: hash(documentPath),
  missingDocumentRoutes: routes.filter(r => !documentedRoutes.includes(r.route)).map(r => r.route),
  extraDocumentRoutes: documentedRoutes.filter(r => !routes.some(actual => actual.route === r)),
  duplicateDocumentRoutes: documentedRoutes.filter((r,i) => documentedRoutes.indexOf(r) !== i),
  undocumentedActions: exportedActions.filter(name => !document.includes(name)),
  unmappedLiteralClientOperations: [...literalOperations].filter(op => !liveOperations.has(normalize(op)) && !retired.has(normalize(op))),
  retiredClientOperations: [...literalOperations].filter(op => retired.has(normalize(op))),
  ledgerOperationsMissingFromDocument: ledger.groups.flatMap(g => g.operations).filter(op => !document.includes(op)),
  exportedActionCount: exportedActions.length,
  routeEdgeGaps: routeEdges.filter(row => row.missingOperations.length || row.missingActions.length),
  orphanEdgeGaps: orphanEdges.filter(row => row.missingOperations.length),
  dispatchComparison,
  limitation: 'Literal operation comparison and independent review complement each other; dynamic expressions and branch gates remain in the source closure, not presumed executed.',
};
const report = { evidenceKind: 'static_symbol_reachability_not_runtime', typescriptVersion: ts.version, root,
  pages: actual.length, inventoryEntries: declared.length, uniqueRoutePatterns: new Set(routes.map(r => r.route)).size,
  missingFromInventory: actual.filter(p => !declared.includes(p)), absentPages: declared.filter(p => !actual.includes(p)),
  inventoryDuplicates: declared.filter((p,i) => declared.indexOf(p) !== i), routes, handlers, httpMethodBranches, dispatchReturns, routeEdges, orphanEdges, comparison, sourceHash,
  limitations: ['Symbol reachability overapproximates conditional branches, including public RootLayout. Actual conditional rendering and auth require runtime evidence.', 'Operation text preserves query/template expressions; it is not an inferred runtime URL or response shape.', 'Type-only declarations do not prove serializers or decoders.'] };
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pages: report.pages, inventoryEntries: report.inventoryEntries, missingFromInventory: report.missingFromInventory,
  absentPages: report.absentPages, duplicateCount: report.inventoryDuplicates.length, handlers: handlers.length, sourceFiles: Object.keys(sourceHash).length,
  evidenceKind: report.evidenceKind }, null, 2));
assert.equal(report.uniqueRoutePatterns, report.pages);
assert.equal(report.inventoryDuplicates.length, 0);
assert.deepEqual(comparison.missingDocumentRoutes, []);
assert.deepEqual(comparison.extraDocumentRoutes, []);
assert.deepEqual(comparison.duplicateDocumentRoutes, []);
assert.deepEqual(comparison.undocumentedActions, []);
assert.deepEqual(comparison.unmappedLiteralClientOperations, []);
assert.deepEqual(comparison.ledgerOperationsMissingFromDocument, []);
assert.deepEqual(comparison.routeEdgeGaps, []);
assert.deepEqual(comparison.orphanEdgeGaps, []);
assert.deepEqual(dispatchComparison.sourceOnly, []);
assert.deepEqual(dispatchComparison.ledgerOnly, []);
