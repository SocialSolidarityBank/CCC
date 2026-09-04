import { readFile, readdir } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const RULES = [
  ['numbered-placeholder', /\?[0-9]+/iu],
  ['insert-or', /\bINSERT\s+OR\s+(?:IGNORE|REPLACE)\b/iu],
  ['replace-into', /\bREPLACE\s+INTO\b/iu],
  ['database-clock', /\b(?:datetime|strftime|julianday)\s*\(/iu],
  ['changes', /\bchanges\s*\(/iu],
  ['glob', /\b(?:NOT\s+)?GLOB\b/iu],
  ['group-concat', /\bGROUP_CONCAT\s*\(/iu],
  ['sqlite-function', /\b(?:instr|char|json_[A-Za-z0-9_]+)\s*\(/iu],
  ['json-operator', /(?:->>|->)/u],
  ['pragma', /\bPRAGMA\b/iu],
  ['boolean-literal', /\b(?:TRUE|FALSE)\b/iu],
  ['transaction', /^\s*(?:BEGIN|COMMIT|ROLLBACK)\b/iu],
  ['non-bare-placeholder', /(?:\$[1-9][0-9]*|:[A-Za-z_][A-Za-z0-9_]*)/u],
];

function normalize(path) {
  return path.split(sep).join('/');
}

function codeOnly(sql) {
  let state = 'code';
  let output = '';
  for (let index = 0; index < sql.length; index += 1) {
    const current = sql[index];
    const next = sql[index + 1];
    if (state === 'single') {
      output += current === '\n' ? '\n' : ' ';
      if (current === "'" && next === "'") {
        output += ' ';
        index += 1;
      } else if (current === "'") state = 'code';
      continue;
    }
    if (state === 'double') {
      output += current === '\n' ? '\n' : ' ';
      if (current === '"' && next === '"') {
        output += ' ';
        index += 1;
      } else if (current === '"') state = 'code';
      continue;
    }
    if (state === 'line-comment') {
      output += current === '\n' ? '\n' : ' ';
      if (current === '\n') state = 'code';
      continue;
    }
    if (state === 'block-comment') {
      output += current === '\n' ? '\n' : ' ';
      if (current === '*' && next === '/') {
        output += ' ';
        index += 1;
        state = 'code';
      }
      continue;
    }
    if (current === "'") state = 'single';
    else if (current === '"') state = 'double';
    else if (current === '-' && next === '-') {
      state = 'line-comment';
      output += ' ';
      index += 1;
    } else if (current === '/' && next === '*') {
      state = 'block-comment';
      output += ' ';
      index += 1;
    }
    output += current === '\n' ? '\n' : state === 'code' ? current : ' ';
  }
  return output;
}
function hasScalarMinMax(sql) {
  const calls = sql.matchAll(/\b(?:min|max)\s*\(/giu);
  for (const call of calls) {
    let depth = 1;
    for (let index = (call.index ?? 0) + call[0].length; index < sql.length; index += 1) {
      if (sql[index] === '(') depth += 1;
      else if (sql[index] === ')') {
        depth -= 1;
        if (depth === 0) break;
      } else if (sql[index] === ',' && depth === 1) {
        return true;
      }
    }
  }
  return false;
}

function orderTerms(sql) {
  const terms = [];
  for (const match of sql.matchAll(/\bORDER\s+BY\b/giu)) {
    let depth = 0;
    let term = '';
    for (let index = (match.index ?? 0) + match[0].length; index < sql.length; index += 1) {
      const rest = sql.slice(index);
      if (depth === 0 && /^(?:LIMIT|OFFSET|RETURNING|UNION|INTERSECT)\b/iu.test(rest)) break;
      const character = sql[index];
      if (character === ';' && depth === 0) break;
      if (character === '(') depth += 1;
      else if (character === ')') {
        if (depth === 0) break;
        depth -= 1;
      }
      if (character === ',' && depth === 0) {
        terms.push(term.trim());
        term = '';
      } else {
        term += character;
      }
    }
    if (term.trim().length > 0) terms.push(term.trim());
  }
  return terms;
}

function hasImplicitNullableOrder(sql, nullableColumns) {
  for (const term of orderTerms(sql)) {
    const direct = term.match(
      /^(?:[A-Za-z_][A-Za-z0-9_]*\.)?([A-Za-z_][A-Za-z0-9_]*)(?:\s+(?:ASC|DESC))?(?:\s+NULLS\s+(?:FIRST|LAST))?$/iu,
    );
    if (
      direct !== null
      && nullableColumns.has(direct[1])
      && !/\s+NULLS\s+(?:FIRST|LAST)$/iu.test(term)
    ) {
      return true;
    }
  }
  return false;
}


function closestDeclaration(name, sourceFile, before) {
  let closest = null;
  const find = (candidate) => {
    if (
      ts.isVariableDeclaration(candidate)
      && ts.isIdentifier(candidate.name)
      && candidate.name.text === name
      && candidate.initializer !== undefined
      && candidate.getStart(sourceFile) < before
      && (closest === null || candidate.getStart(sourceFile) > closest.getStart(sourceFile))
    ) {
      closest = candidate;
    }
    ts.forEachChild(candidate, find);
  };
  find(sourceFile);
  return closest;
}

function objectPropertyText(initializer, propertyName, sourceFile, before) {
  if (ts.isObjectLiteralExpression(initializer)) {
    const property = initializer.properties.find((candidate) => (
      ts.isPropertyAssignment(candidate) && candidate.name.getText(sourceFile) === propertyName
    ));
    return property !== undefined && ts.isPropertyAssignment(property)
      ? sqlText(property.initializer, sourceFile, before)
      : null;
  }
  if (ts.isConditionalExpression(initializer)) {
    const whenTrue = objectPropertyText(initializer.whenTrue, propertyName, sourceFile, before);
    const whenFalse = objectPropertyText(initializer.whenFalse, propertyName, sourceFile, before);
    return whenTrue === null || whenFalse === null ? null : `${whenTrue};\n${whenFalse}`;
  }
  return null;
}

function pushedSql(name, sourceFile, before) {
  const fragments = [];
  let unresolved = false;
  const find = (candidate) => {
    if (
      ts.isCallExpression(candidate)
      && ts.isPropertyAccessExpression(candidate.expression)
      && candidate.expression.name.text === 'push'
      && ts.isIdentifier(candidate.expression.expression)
      && candidate.expression.expression.text === name
      && candidate.getStart(sourceFile) < before
    ) {
      for (const argument of candidate.arguments) {
        const fragment = sqlText(argument, sourceFile, candidate.getStart(sourceFile));
        if (fragment === null) unresolved = true;
        else fragments.push(fragment);
      }
    }
    ts.forEachChild(candidate, find);
  };
  find(sourceFile);
  return unresolved || fragments.length === 0 ? null : fragments.join('\n');
}

function sqlText(node, sourceFile, before = node.getStart(sourceFile)) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return '';
  if (ts.isTemplateExpression(node)) {
    let sql = node.head.text;
    for (const span of node.templateSpans) {
      const fragment = sqlText(span.expression, sourceFile, before);
      if (fragment === null) return null;
      sql += `${fragment}\n${span.literal.text}`;
    }
    return sql;
  }
  if (ts.isParenthesizedExpression(node)) return sqlText(node.expression, sourceFile, before);
  if (ts.isConditionalExpression(node)) {
    const whenTrue = sqlText(node.whenTrue, sourceFile, before);
    const whenFalse = sqlText(node.whenFalse, sourceFile, before);
    return whenTrue === null || whenFalse === null ? null : `${whenTrue};\n${whenFalse}`;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = sqlText(node.left, sourceFile, before);
    const right = sqlText(node.right, sourceFile, before);
    return left === null || right === null ? null : left + right;
  }
  if (ts.isPropertyAccessExpression(node)) {
    if (ts.isIdentifier(node.expression) && node.expression.text === 'postState' && node.name.text === 'sql') {
      return '';
    }
    if (ts.isIdentifier(node.expression)) {
      const declaration = closestDeclaration(node.expression.text, sourceFile, before);
      return declaration === null
        ? null
        : objectPropertyText(declaration.initializer, node.name.text, sourceFile, before);
    }
    return null;
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'join') {
    const receiver = node.expression.expression;
    if (
      ts.isCallExpression(receiver)
      && ts.isPropertyAccessExpression(receiver.expression)
      && receiver.expression.name.text === 'map'
      && receiver.arguments[0] !== undefined
      && ts.isArrowFunction(receiver.arguments[0])
    ) {
      return sqlText(receiver.arguments[0].body, sourceFile, before);
    }
    if (ts.isIdentifier(receiver)) return pushedSql(receiver.text, sourceFile, before);
  }
  if (ts.isIdentifier(node)) {
    const declaration = closestDeclaration(node.text, sourceFile, before);
    return declaration === null ? null : sqlText(declaration.initializer, sourceFile, declaration.getStart(sourceFile));
  }
  return null;
}

function enclosingFunctionName(node) {
  let current = node.parent;
  while (current !== undefined) {
    if (ts.isFunctionDeclaration(current)) return current.name?.text ?? null;
    current = current.parent;
  }
  return null;
}

function runtimeViolations(source, path, nullableColumns) {
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const violations = [];
  const inspect = (node, sqlNode) => {
    const sql = sqlText(sqlNode, sourceFile, node.getStart(sourceFile));
    const line = sourceFile.getLineAndCharacterOfPosition(sqlNode.getStart(sourceFile)).line + 1;
    if (sql === null) {
      violations.push({ path, line, rule: 'unresolved-sql' });
      return;
    }
    const code = codeOnly(sql);
    for (const [rule, pattern] of RULES) {
      if (pattern.test(code)) violations.push({ path, line, rule });
    }
    if (hasScalarMinMax(code)) violations.push({ path, line, rule: 'scalar-min-max' });
    if (hasImplicitNullableOrder(code, nullableColumns)) violations.push({ path, line, rule: 'nullable-order' });
  };
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      if (
        ts.isPropertyAccessExpression(node.expression)
        && node.expression.name.text === 'prepare'
        && node.arguments[0] !== undefined
      ) {
        const wrapper = enclosingFunctionName(node);
        if (wrapper !== 'insertIfAbsent' && wrapper !== 'upsertByKey') {
          inspect(node, node.arguments[0]);
        }
      } else if (
        ts.isIdentifier(node.expression)
        && (node.expression.text === 'insertIfAbsent' || node.expression.text === 'upsertByKey')
        && node.arguments[1] !== undefined
      ) {
        inspect(node, node.arguments[1]);
      } else if (
        ts.isIdentifier(node.expression)
        && node.expression.text === 'conditionalCanonicalAuditStatement'
        && node.arguments[3] !== undefined
      ) {
        const postState = node.arguments[3];
        const sqlProperty = ts.isObjectLiteralExpression(postState)
          ? postState.properties.find((property) => (
            ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === 'sql'
          ))
          : undefined;
        inspect(
          node,
          sqlProperty !== undefined && ts.isPropertyAssignment(sqlProperty)
            ? sqlProperty.initializer
            : postState,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

async function migrationFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => resolve(directory, entry.name)).sort();
}
async function nullableColumnNames(migrations) {
  const database = new DatabaseSync(':memory:');
  try {
    for (const path of migrations) database.exec(await readFile(path, 'utf8'));
    const columnsByName = new Map();
    const tables = database.prepare(
      `SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    ).all();
    for (const table of tables) {
      const columns = database.prepare(
        `SELECT name, "notnull" AS required, pk FROM pragma_table_info(?)`,
      ).all(table.name);
      for (const column of columns) {
        const state = columnsByName.get(column.name) ?? { nullable: false, required: false };
        if (column.required === 0 && column.pk === 0) state.nullable = true;
        else state.required = true;
        columnsByName.set(column.name, state);
      }
    }
    return new Set(
      [...columnsByName].filter(([, state]) => state.nullable && !state.required).map(([name]) => name),
    );
  } finally {
    database.close();
  }
}


export async function auditSqlDialect(workspaceRoot = process.cwd()) {
  const root = resolve(workspaceRoot);
  const gatewayPath = resolve(root, 'packages/core/src/gateway.ts');
  const source = await readFile(gatewayPath, 'utf8');
  const gatewayRelative = normalize(relative(root, gatewayPath));
  const sqliteMigrations = await migrationFiles(resolve(root, 'migrations/sqlite'));
  const nullableColumns = await nullableColumnNames(sqliteMigrations);
  const violations = runtimeViolations(source, gatewayRelative, nullableColumns);
  const migrationInventory = [];
  for (const path of sqliteMigrations) {
    const sql = codeOnly(await readFile(path, 'utf8'));
    const forms = RULES.filter(([, pattern]) => pattern.test(sql)).map(([rule]) => rule);
    if (forms.length > 0) migrationInventory.push({ path: normalize(relative(root, path)), forms });
  }
  const postgresMigrations = await migrationFiles(resolve(root, 'migrations/postgres'));
  for (const [sqliteName, postgresName] of [
    ['0046_sql_portability.sql', '0002_sql_portability.sql'],
    ['0047_timestamp_normalization.sql', '0003_timestamp_normalization.sql'],
  ]) {
    if (
      sqliteMigrations.some((path) => basename(path) === sqliteName)
      && !postgresMigrations.some((path) => basename(path) === postgresName)
    ) {
      violations.push({
        path: `migrations/sqlite/${sqliteName}`,
        line: 1,
        rule: 'missing-migration-pair',
      });
    }
  }
  return { violations, migrationInventory };
}

const invokedPath = process.argv[1] === undefined ? '' : resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await auditSqlDialect();
  if (result.violations.length > 0) {
    console.error('SQL dialect guard failed:');
    for (const violation of result.violations) {
      console.error(`  ${violation.path}:${violation.line}: ${violation.rule}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`SQL dialect guard passed; inventoried ${result.migrationInventory.length} SQLite migration files.`);
  }
}
