import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { auditSqlDialect } from './guard-sql-dialect.mjs';

async function tree(gateway, migration = '') {
  const root = await mkdtemp(join(tmpdir(), 'ccc-sql-guard-'));
  await mkdir(join(root, 'packages/core/src'), { recursive: true });
  await mkdir(join(root, 'migrations/sqlite'), { recursive: true });
  await writeFile(join(root, 'packages/core/src/gateway.ts'), gateway);
  await writeFile(join(root, 'migrations/sqlite/0001_fixture.sql'), migration);
  return root;
}

async function audit(gateway, migration = '', pair = 'none') {
  const root = await tree(gateway, migration);
  try {
    if (pair !== 'none') {
      await writeFile(join(root, 'migrations/sqlite/0046_sql_portability.sql'), 'SELECT 1;');
      await writeFile(join(root, 'migrations/sqlite/0047_timestamp_normalization.sql'), 'SELECT 1;');
      if (pair === 'both') {
        await mkdir(join(root, 'migrations/postgres'), { recursive: true });
        await writeFile(join(root, 'migrations/postgres/0002_sql_portability.sql'), 'SELECT 1;');
        await writeFile(join(root, 'migrations/postgres/0003_timestamp_normalization.sql'), 'SELECT 1;');
      }
    }
    return await auditSqlDialect(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('portable prepared SQL passes without matching TypeScript comments or ordinary strings', async () => {
  const result = await audit(`
    // INSERT OR IGNORE and datetime('now') are documentation here.
    const note = "SELECT ?1 is not passed to prepare";
    db.prepare("SELECT 'datetime(''now'')' AS literal, ? AS value -- INSERT OR IGNORE");
  `);
  assert.deepEqual(result.violations, []);
});

test('reports every forbidden runtime dialect form at its source path', async () => {
  const result = await audit(`
    db.prepare('SELECT ?1');
    db.prepare("INSERT OR IGNORE INTO jobs (id) VALUES (?)");
    db.prepare("SELECT datetime('now'), changes(), id FROM rows WHERE id GLOB '*'");
    db.prepare('SELECT GROUP_CONCAT(id) FROM rows');
    db.prepare('BEGIN');
  `);
  assert.deepEqual(
    result.violations.map((entry) => entry.rule),
    ['numbered-placeholder', 'insert-or', 'database-clock', 'changes', 'glob', 'group-concat', 'transaction'],
  );
  assert.ok(result.violations.every((entry) => entry.path === 'packages/core/src/gateway.ts'));
});

test('requires explicit NULL placement for nullable ordering columns', async () => {
  const result = await audit(`
    db.prepare('SELECT id FROM action_items ORDER BY due_date, id');
    db.prepare('SELECT id FROM action_items ORDER BY due_date NULLS LAST, id');
  `, 'CREATE TABLE action_items (id TEXT PRIMARY KEY, due_date TEXT);');
  assert.deepEqual(result.violations.map((entry) => entry.rule), ['nullable-order']);
});

test('inspects conflict helpers and resolved SQL variables, and rejects unresolved SQL', async () => {
  const result = await audit(`
    function insertIfAbsent(database, sql, bindings) { return database.prepare(sql).bind(...bindings); }
    function upsertByKey(database, sql, bindings) { return database.prepare(sql).bind(...bindings); }
    insertIfAbsent(db, 'SELECT $1', []);
    upsertByKey(db, 'SELECT min(COALESCE(?, ?), ?)', []);
    db.prepare('SELECT json_object(?, ?)');
    const sql = enabled ? 'SELECT ?' : 'SELECT ? AS value';
    db.prepare(sql);
    db.prepare(makeSql());
  `);
  assert.deepEqual(result.violations.map((entry) => entry.rule), [
    'non-bare-placeholder',
    'scalar-min-max',
    'sqlite-function',
    'unresolved-sql',
  ]);
});

test('inspects conditional audit post-state SQL', async () => {
  const result = await audit(`
    conditionalCanonicalAuditStatement(env, actor, entry, {
      sql: 'SELECT 1 FROM rows WHERE id = :id',
      bindings: [],
    }, createdAt);
  `);
  assert.deepEqual(result.violations.map((entry) => entry.rule), ['non-bare-placeholder']);
});

test('inspects constant SQL fragments and rejects unknown template fragments', async () => {
  const result = await audit(`
    const badFragment = 'WHERE changes() = 1';
    db.prepare(\`SELECT 1 \${badFragment}\`);
    const placeholders = ids.map(() => '?').join(', ');
    db.prepare(\`SELECT id FROM rows WHERE id IN (\${placeholders})\`);
    const unknown = makeSql();
    db.prepare(\`SELECT 1 \${unknown}\`);
  `);
  assert.deepEqual(result.violations.map((entry) => entry.rule), ['changes', 'unresolved-sql']);
});


test('requires the E3-2 logical migration pair', async () => {
  const missing = await audit("db.prepare('SELECT ?');", '', 'sqlite-only');
  assert.deepEqual(missing.violations.map((entry) => entry.rule), [
    'missing-migration-pair',
    'missing-migration-pair',
  ]);
  const paired = await audit("db.prepare('SELECT ?');", '', 'both');
  assert.deepEqual(paired.violations, []);
});

test('inventories SQLite-only migration forms without treating them as runtime violations', async () => {
  const result = await audit(
    "db.prepare('SELECT ? AS value');",
    "CREATE TABLE sample (id TEXT, created_at TEXT DEFAULT (datetime('now')));\nCREATE INDEX x ON sample(id) WHERE id GLOB '[0-9]*';\n",
  );
  assert.deepEqual(result.violations, []);
  assert.deepEqual(result.migrationInventory, [{
    path: 'migrations/sqlite/0001_fixture.sql',
    forms: ['database-clock', 'glob'],
  }]);
});
