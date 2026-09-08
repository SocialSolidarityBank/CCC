import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { Miniflare } from 'miniflare';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { createD1Database } from '@ccc/db-d1';
import { openEncryptedSqlite } from '@ccc/db-sqlite';
import type { Database, DatabaseError } from '@ccc/contracts/database';
import type { PostgresHarness } from './postgres';
import { SQLITE_MIGRATIONS_PATH } from './d1';

export const POSTGRES_MIGRATIONS_PATH = fileURLToPath(new URL('../../../../migrations/postgres/', import.meta.url));
export const PARITY_MANIFEST_PATH = fileURLToPath(new URL('../../../../migrations/parity.yaml', import.meta.url));
export const checkpoints = [
  { id: 'baseline-0045', sqlite: '0045_identity_revocation.sql', postgres: '0001_baseline.sql' },
  { id: 'sql-portability', sqlite: '0046_sql_portability.sql', postgres: '0002_sql_portability.sql' },
  { id: 'timestamp-normalization', sqlite: '0047_timestamp_normalization.sql', postgres: '0003_timestamp_normalization.sql' },
  { id: 'agent-jobs', sqlite: '0048_agent_jobs.sql', postgres: '0004_agent_jobs.sql' },
  { id: 'counseling-memory', sqlite: '0049_counseling_memory.sql', postgres: '0005_counseling_memory.sql' },
] as const;
export type Profile = 'd1' | 'sqlite' | 'postgres';
type Row = Record<string, unknown>;
export interface MigrationSource { name: string; sql: string; sha256: string }
export interface ParityDatabase {
  profile: Profile;
  db: Database;
  apply(sources: readonly MigrationSource[]): Promise<void>;
  dispose(): Promise<void>;
}
export function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
export function identifier(value: string): string {
  if (!/^[a-zA-Z_][a-zA-Z_0-9]*$/.test(value)) throw new Error('Unexpected catalog identifier.');
  return `"${value}"`;
}
export function migrationSources(dialect: 'sqlite' | 'postgres'): MigrationSource[] {
  const directory = dialect === 'sqlite' ? SQLITE_MIGRATIONS_PATH : POSTGRES_MIGRATIONS_PATH;
  return readdirSync(directory).filter((name) => name.endsWith('.sql')).sort().map((name) => {
    const sql = readFileSync(join(directory, name), 'utf8');
    return { name, sql, sha256: hash(sql) };
  });
}
export function checkpointSources() {
  const sqlite = migrationSources('sqlite');
  const postgres = migrationSources('postgres');
  expect(postgres.map((source) => source.name)).toEqual(checkpoints.map((checkpoint) => checkpoint.postgres));
  const boundary = sqlite.findIndex((source) => source.name === checkpoints[0].sqlite);
  expect(boundary).toBeGreaterThan(0);
  // 0009 has two historical files and 0018/0019 were never numbered files.
  // File identity, rather than a fabricated contiguous numeric sequence, is authoritative.
  expect(sqlite.slice(0, boundary + 1).map((source) => source.name)).toEqual([
    '0001_init.sql', '0002_users.sql', '0003_phase1_ai_expand.sql',
    '0004_phase1_ai_cutover.sql', '0005_participant_support_case_expand.sql',
    '0006_participant_support_case_cutover.sql', '0007_beneficiary_animal_slug_expand.sql',
    '0008_participant_consent_records.sql', '0009_participant_pii_email.sql',
    '0009_schedule_session_plan.sql', '0010_schedule_kind_channel.sql',
    '0011_user_display_name.sql', '0012_action_item_resolution.sql',
    '0013_session_life_area_snapshots.sql', '0014_session_intake_record.sql',
    '0015_participant_pii_intake_fields.sql', '0016_session_record_details.sql',
    '0017_user_last_program_type.sql', '0020_support_case_consent_privacy.sql',
    '0021_invite_tokens.sql', '0022_participant_self_signup.sql',
    '0023_organization_onboarding_names.sql', '0024_support_case_overall_goal.sql',
    '0025_ai_draft_one_liner.sql', '0026_ai_briefing_structured_suggestions.sql',
    '0027_session_discrepancies.sql', '0028_support_case_emergency_registration.sql',
    '0029_ai_text_work_queue.sql', '0030_support_case_intake_at_repair.sql',
    '0031_goal_revisions_d62.sql', '0032_recording_result_commits.sql',
    '0033_preview_fixture_ai_drafts.sql', '0034_text_work_goal_revised.sql',
    '0035_ai_draft_materials_contrast.sql', '0036_text_work_lease.sql',
    '0037_recording_result_transcript_quality.sql', '0038_ai_draft_claim_sections.sql',
    '0039_risk_flag_types_d72.sql', '0040_roles_team_scope.sql',
    '0041_pii_retention_lifecycle.sql', '0042_practitioner_assignment_guard.sql',
    '0043_privacy_consent_notice_evidence.sql', '0044_assignment_lifecycle.sql',
    '0045_identity_revocation.sql',
  ]);
  expect(sqlite.slice(boundary + 1).map((source) => source.name)).toEqual(checkpoints.slice(1).map((checkpoint) => checkpoint.sqlite));
  expect(new Set(sqlite.map((source) => source.name)).size).toBe(sqlite.length);
  return checkpoints.map((checkpoint, index) => ({
    id: checkpoint.id,
    sqlite: index === 0 ? sqlite.slice(0, boundary + 1) : [sqlite[boundary + index]!],
    postgres: [postgres[index]!],
  }));
}
export async function openParityDatabase(profile: Profile, harness: PostgresHarness): Promise<ParityDatabase> {
  if (profile === 'postgres') {
    const db = await harness.openDatabase();
    return { profile, db, apply: async (sources) => {
      for (const source of sources) await harness.applyMigration(db, source.sql);
    }, dispose: () => db.close() };
  }
  if (profile === 'sqlite') {
    const directory = mkdtempSync(join(tmpdir(), 'ccc-migration-parity-'));
    try {
      const db = openEncryptedSqlite({ filename: join(directory, 'parity.db'), key: new Uint8Array(randomBytes(32)) });
      return { profile, db, apply: async (sources) => db.applyMigrations(sources), dispose: async () => {
        try { db.close(); } finally { rmSync(directory, { recursive: true, force: true }); }
      } };
    } catch {
      rmSync(directory, { recursive: true, force: true });
      throw new Error('Encrypted SQLite parity provisioning failed.');
    }
  }
  const miniflare = new Miniflare({ compatibilityDate: '2026-07-06', d1Databases: ['DB'], modules: true,
    script: 'export default { fetch() { return new Response("ok"); } };' });
  try {
    const native = await miniflare.getD1Database('DB');
    const parsed = await readD1Migrations(SQLITE_MIGRATIONS_PATH);
    return { profile, db: createD1Database(native), apply: async (sources) => {
      for (const source of sources) {
        const migration = parsed.find((entry) => entry.name === source.name || `${entry.name}.sql` === source.name);
        if (!migration) throw new Error(`D1 migration parser did not return ${source.name}.`);
        await native.batch(migration.queries.map((sql) => native.prepare(sql)));
      }
    }, dispose: () => miniflare.dispose() };
  } catch {
    await miniflare.dispose();
    throw new Error('D1 parity provisioning failed.');
  }
}

export interface Column { name: string; type: string; notnull: number; default: string | null; pk: number }
export interface CatalogTable {
  name: string;
  columns: Column[];
  primary: string[];
  /** PostgreSQL physical UNIQUE carrying the exact SQLite-origin constraint comment. */
  nullablePrimary?: string[];
  unique: string[][];
  foreign: Array<{ columns: string[]; table: string; target: string[]; update: string; delete: string }>;
  checks: string[];
}
export interface Catalog {
  engine: 'sqlite' | 'postgres';
  tables: CatalogTable[];
  indexes: Array<{ name: string; table: string; unique: number; columns: string[]; predicate: string | null; definition: string }>;
  triggers: Array<{ name: string; table: string; definition: string; function: string | null }>;
  views: Array<{ name: string; definition: string }>;
  physical: Row[];
}
async function rows(db: Database, sql: string): Promise<Row[]> {
  return (await db.prepare(sql).all<Row>()).results;
}
async function pgRows(db: Database, sql: string): Promise<Row[]> {
  // JSON remains text across the port, avoiding vendor array/OID values or unsafe integers.
  const result = await db.prepare(`SELECT CAST(COALESCE(json_agg(row_to_json(inventory)), '[]'::json) AS text) AS inventory FROM (${sql}) inventory`).first<string>('inventory');
  if (result === null) throw new Error('PostgreSQL catalog query returned no inventory.');
  return JSON.parse(result) as Row[];
}
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('Malformed catalog column vector.');
  return value as string[];
}
/** Extract balanced CHECK expressions, preserving literals, nested calls and every constraint. */
function checks(sql: string): string[] {
  const result: string[] = [];
  let quote = '';
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!;
    if (quote) {
      if (char === quote) { if (sql[i + 1] === quote) i++; else quote = ''; }
      continue;
    }
    if (char === "'" || char === '"') { quote = char; continue; }
    if (sql.slice(i, i + 2) === '--') { const end = sql.indexOf('\n', i); i = end < 0 ? sql.length : end; continue; }
    if (sql.slice(i, i + 2) === '/*') { const end = sql.indexOf('*/', i + 2); i = end < 0 ? sql.length : end + 1; continue; }
    const match = /^CHECK\s*\(/i.exec(sql.slice(i));
    if (!match || (i > 0 && /\w/.test(sql[i - 1]!))) continue;
    const start = i + match[0].length;
    let depth = 1;
    i = start;
    for (; i < sql.length && depth > 0; i++) {
      const next = sql[i]!;
      if (quote) { if (next === quote) { if (sql[i + 1] === quote) i++; else quote = ''; } }
      else if (next === "'" || next === '"') quote = next;
      else if (next === '(') depth++;
      else if (next === ')') depth--;
    }
    if (depth !== 0) throw new Error('Unbalanced live CHECK definition.');
    result.push(sql.slice(start, i - 1));
    i--;
  }
  return result.sort();
}
export async function collectCatalog(fixture: ParityDatabase): Promise<Catalog> {
  return fixture.profile === 'postgres' ? postgresCatalog(fixture.db) : sqliteCatalog(fixture.db);
}
async function sqliteCatalog(db: Database): Promise<Catalog> {
  // Exact engine exclusions, not a blanket underscore-prefix exclusion of app tables.
  const objects = await rows(db, `SELECT type, name, tbl_name, sql FROM sqlite_schema WHERE substr(name,1,7) <> 'sqlite_' AND name NOT IN ('_cf_METADATA', 'd1_migrations') ORDER BY type, name`);
  const catalog: Catalog = { engine: 'sqlite', tables: [], indexes: [], triggers: [], views: [], physical: [...objects] };
  for (const object of objects) {
    const name = String(object.name);
    if (object.type === 'table') {
      const columns = await rows(db, `PRAGMA table_xinfo(${identifier(name)})`);
      const foreign = await rows(db, `PRAGMA foreign_key_list(${identifier(name)})`);
      const indexes = await rows(db, `PRAGMA index_list(${identifier(name)})`);
      catalog.physical.push({ table: name, columns, foreign, indexes: [...indexes].sort((a, b) => String(a.name).localeCompare(String(b.name), 'en')).map(({ seq: _seq, ...index }) => index) });
      const table: CatalogTable = { name, columns: columns.map((column) => ({ name: String(column.name), type: String(column.type).toLowerCase(), notnull: Number(column.notnull), default: column.dflt_value === null ? null : String(column.dflt_value), pk: Number(column.pk) })), primary: columns.filter((column) => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk)).map((column) => String(column.name)), unique: [], foreign: [], checks: checks(String(object.sql)) };
      for (const id of [...new Set(foreign.map((row) => Number(row.id)))].sort((a, b) => a - b)) {
        const key = foreign.filter((row) => Number(row.id) === id).sort((a, b) => Number(a.seq) - Number(b.seq));
        const target = await rows(db, `PRAGMA table_info(${identifier(String(key[0]!.table))})`);
        const primary = target.filter((column) => Number(column.pk) > 0).sort((a, b) => Number(a.pk) - Number(b.pk));
        table.foreign.push({ columns: key.map((row) => String(row.from)), table: String(key[0]!.table), target: key.map((row, i) => String(row.to ?? primary[i]?.name)), update: String(key[0]!.on_update), delete: String(key[0]!.on_delete) });
      }
      for (const index of indexes.sort((a, b) => String(a.name).localeCompare(String(b.name), 'en'))) {
        const detail = await rows(db, `PRAGMA index_xinfo(${identifier(String(index.name))})`);
        catalog.physical.push({ index: index.name, detail });
        const keys = detail.filter((column) => Number(column.key) === 1).map((column) => String(column.name ?? '<expression>'));
        if (index.origin === 'u') table.unique.push(keys);
        if (index.origin !== 'c') continue;
        const definition = String(objects.find((entry) => entry.name === index.name)?.sql);
        catalog.indexes.push({ name: String(index.name), table: name, unique: Number(index.unique), columns: keys, predicate: /\bWHERE\s+([\s\S]+)$/i.exec(definition)?.[1] ?? null, definition });
      }
      catalog.tables.push(table);
    } else if (object.type === 'trigger') catalog.triggers.push({ name, table: String(object.tbl_name), definition: String(object.sql), function: null });
    else if (object.type === 'view') catalog.views.push({ name, definition: String(object.sql) });
  }
  return sortCatalog(catalog);
}
async function postgresCatalog(db: Database): Promise<Catalog> {
  const tables = await pgRows(db, `SELECT c.relname AS name, c.relkind, c.relpersistence, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname`);
  const columns = await pgRows(db, `SELECT c.relname AS table_name,a.attname AS name,a.attnum AS position,format_type(a.atttypid,a.atttypmod) AS type,a.attnotnull AS notnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid) AS "default",coll.collname AS collation FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum LEFT JOIN pg_collation coll ON coll.oid=a.attcollation WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
  const constraints = await pgRows(db, `SELECT c.relname AS table_name,k.conname AS name,k.contype AS kind,k.condeferrable,k.condeferred,k.convalidated,obj_description(k.oid,'pg_constraint') AS comment,pg_get_constraintdef(k.oid,true) AS definition,ARRAY(SELECT a.attname::text FROM unnest(k.conkey) WITH ORDINALITY x(num,ord) JOIN pg_attribute a ON a.attrelid=k.conrelid AND a.attnum=x.num ORDER BY x.ord) AS columns,rc.relname AS target_table,ARRAY(SELECT a.attname::text FROM unnest(k.confkey) WITH ORDINALITY x(num,ord) JOIN pg_attribute a ON a.attrelid=k.confrelid AND a.attnum=x.num ORDER BY x.ord) AS target,k.confupdtype,k.confdeltype FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_class rc ON rc.oid=k.confrelid WHERE n.nspname='public' ORDER BY c.relname,k.conname`);
  const indexes = await pgRows(db, `SELECT t.relname AS table_name,c.relname AS name,i.indisunique,i.indisprimary,i.indisvalid,i.indisready,pg_get_indexdef(i.indexrelid) AS definition,pg_get_expr(i.indpred,i.indrelid) AS predicate,pg_get_expr(i.indexprs,i.indrelid) AS expressions,ARRAY(SELECT pg_get_indexdef(i.indexrelid,s,true) FROM generate_series(1,i.indnkeyatts) s ORDER BY s) AS columns,EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conindid=i.indexrelid AND k.contype IN ('p','u')) AS constraint_owned FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY c.relname`);
  const triggers = await pgRows(db, `SELECT c.relname AS table_name,t.tgname AS name,t.tgenabled,pg_get_triggerdef(t.oid,true) AS definition,pg_get_functiondef(t.tgfoid) AS function FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal ORDER BY c.relname,t.tgname`);
  const views = await pgRows(db, `SELECT c.relname AS name,c.relkind,pg_get_viewdef(c.oid,true) AS definition FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('v','m') ORDER BY c.relname`);
  const functions = await pgRows(db, `SELECT p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p') ORDER BY p.proname,pg_get_function_identity_arguments(p.oid)`);
  const sequences = await pgRows(db, `SELECT c.relname AS name,s.seqtypid::regtype::text AS type,s.seqstart::text,s.seqincrement::text,s.seqmax::text,s.seqmin::text,s.seqcache::text,s.seqcycle FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' ORDER BY c.relname`);
  const actions: Record<string, string> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
  return sortCatalog({ engine: 'postgres', tables: tables.map((table) => {
    const own = constraints.filter((entry) => entry.table_name === table.name);
    const primary = stringArray(own.find((entry) => entry.kind === 'p')?.columns ?? []);
    const marked = own.filter((entry) => entry.comment === 'ccc:sqlite-primary-key');
    expect(marked.length, `${String(table.name)} SQLite key markers`).toBeLessThanOrEqual(1);
    const nullablePrimary = stringArray(marked[0]?.columns ?? []);
    if (marked.length) {
      expect(marked[0]!.kind).toBe('u');
      expect(primary).toEqual([]);
      expect(nullablePrimary).toHaveLength(1);
      expect(columns.find((column) => column.table_name === table.name && column.name === nullablePrimary[0])).toMatchObject({ type: 'text', notnull: false });
    }
    return { name: String(table.name), columns: columns.filter((entry) => entry.table_name === table.name).map((column) => ({ name: String(column.name), type: String(column.type), notnull: column.notnull ? 1 : 0, default: column.default === null ? null : String(column.default), pk: primary.indexOf(String(column.name)) + 1 })), primary, nullablePrimary, unique: own.filter((entry) => entry.kind === 'u' && entry.comment !== 'ccc:sqlite-primary-key').map((entry) => stringArray(entry.columns)), foreign: own.filter((entry) => entry.kind === 'f').map((entry) => ({ columns: stringArray(entry.columns), table: String(entry.target_table), target: stringArray(entry.target), update: actions[String(entry.confupdtype)]!, delete: actions[String(entry.confdeltype)]! })), checks: own.filter((entry) => entry.kind === 'c').map((entry) => String(entry.definition)) };
  }), indexes: indexes.filter((entry) => !entry.constraint_owned).map((entry) => ({ name: String(entry.name), table: String(entry.table_name), unique: entry.indisunique ? 1 : 0, columns: stringArray(entry.columns).map((column) => column.replace(/"/g, '').replace(/\s+(ASC|DESC)(\s+NULLS\s+(FIRST|LAST))?$/i, '')), predicate: entry.predicate === null ? null : String(entry.predicate), definition: String(entry.definition) })), triggers: triggers.map((entry) => ({ name: String(entry.name), table: String(entry.table_name), definition: String(entry.definition), function: String(entry.function) })), views: views.map((entry) => ({ name: String(entry.name), definition: String(entry.definition) })), physical: [{ tables, columns, constraints, indexes, triggers, views, functions, sequences }] });
}
function sortCatalog(catalog: Catalog): Catalog {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'en');
  catalog.tables.sort(byName);
  for (const table of catalog.tables) {
    table.unique.sort((a, b) => canonical(a).localeCompare(canonical(b), 'en'));
    table.foreign.sort((a, b) => canonical(a).localeCompare(canonical(b), 'en'));
    table.checks.sort();
  }
  catalog.indexes.sort(byName); catalog.triggers.sort(byName); catalog.views.sort(byName);
  return catalog;
}

function literalDefaultValue(expression: string, type: string): string | number | null {
  let literal = expression.trim();
  while (literal.startsWith('(') && literal.endsWith(')')) literal = literal.slice(1, -1).trim();
  literal = literal.replace(/::(?:text|bigint|integer|numeric|double precision)$/, '').trim();
  if (/^NULL$/i.test(literal)) return null;
  let value: string | number;
  if (/^'(?:[^']|'')*'$/.test(literal)) value = literal.slice(1, -1).replace(/''/g, "'");
  else if (/^[+-]?\d+(?:\.\d+)?$/.test(literal)) value = Number(literal);
  else throw new Error(`Nonliteral default requires a named semantic witness: ${expression}`);
  if (type === 'text') return String(value);
  const number = Number(value);
  if (!Number.isFinite(number) || (type === 'integer' && !Number.isSafeInteger(number))) {
    throw new Error('Default exceeds the shared numeric contract.');
  }
  return number;
}

export const physicalRules = {
  integer: 'SQLite INTEGER -> PostgreSQL bigint; safe-number decoding remains the adapter contract.',
  real: 'SQLite REAL -> PostgreSQL double precision.',
  blob: 'SQLite BLOB -> PostgreSQL bytea.',
  primary: 'Nullable SQLite TEXT PRIMARY KEY is PostgreSQL UNIQUE only when COMMENT ON CONSTRAINT equals ccc:sqlite-primary-key. The physical constraint remains UNIQUE; marker removal is drift and ordinary UNIQUE is never promoted. True physical primary keys remain unchanged.',
  checks: 'Complete engine CHECK definitions are fingerprinted separately; date, NULL, scalar, JSON and character-class semantics are exercised by live fixtures.',
  defaults: 'Literal defaults are compared by their stored text/numeric values, not just presence. Timestamp expressions remain in physical fingerprints and have live output, rewrite, ordering and statement-clock witnesses.',
  triggers: 'Every trigger and PostgreSQL function body remains in the physical fingerprint. The seven exact *_normalize_timestamp_after_insert triggers are SQLite-specific default normalization; PostgreSQL timestamp helpers provide the corresponding output, checked by every timestamp witness. PostgreSQL ccc_audit_rowid and ccc_goal_revision_rowid implement SQLite integer primary-key allocation and must remain present. All other trigger names must match.',
  triggerOrder: 'Same-event trigger order is not a cross-engine contract: PostgreSQL sorts names; SQLite does not guarantee an order. Overlapping invalid writes may choose different guard codes. Archive approval produces both approval and purge audit facts, but surrogate audit IDs do not define their semantic order.',
  indexes: 'Constraint-owned indexes are represented by primary/unique constraints; explicit indexes retain names, keys, uniqueness, predicates and complete definitions.',
  timestampSnapshots: 'Each inventoried timestamp is read before and after real migrations in separate legal legacy-0ms and modern-500ms databases, then the recovered values are TEXT-ordered by that same engine. The cutover manifest remains a singleton in each snapshot; its default is exercised by replacing that single legal row. No fixture disables constraints or triggers.',
} as const;
export function assertLogicalParity(sqlite: Catalog, postgres: Catalog): void {
  expect(postgres.tables.map((table) => table.name)).toEqual(sqlite.tables.map((table) => table.name));
  const types: Record<string, string> = { integer: 'bigint', real: 'double precision', blob: 'bytea', text: 'text' };
  const timestampDefaults = new Set(timestampInventory(sqlite).map(({ table, column }) => `${table}.${column}`));
  for (const left of sqlite.tables) {
    const right = postgres.tables.find((table) => table.name === left.name)!;
    expect(right.columns.map((column) => ({ name: column.name, type: column.type })), left.name).toEqual(left.columns.map((column) => ({ name: column.name, type: types[column.type] ?? column.type })));
    const legacyNullablePrimary = left.primary.length === 1 && left.columns.some((column) => column.pk === 1 && column.type === 'text' && column.notnull === 0);
    const expectedPrimary = legacyNullablePrimary ? [] : left.primary;
    expect(right.primary, `${left.name} primary`).toEqual(expectedPrimary);
    expect(right.nullablePrimary ?? [], `${left.name} marked nullable primary`).toEqual(legacyNullablePrimary ? left.primary : []);
    const expectedUnique = left.unique;
    // SQLite may coalesce a redundant UNIQUE(id) with its PK's autoindex.
    const uniqueKeys = (keys: string[][]) => [...new Set(keys.map(canonical))].sort();
    expect(uniqueKeys(right.unique), `${left.name} unique`).toEqual(uniqueKeys(expectedUnique));
    expect(right.foreign, `${left.name} foreign`).toEqual(left.foreign);
    expect(right.checks.length, `${left.name} checks`).toBe(left.checks.length);
    for (const column of left.columns) {
      const other = right.columns.find((entry) => entry.name === column.name)!;
      expect(other.notnull, `${left.name}.${column.name} nullability`).toBe(column.notnull || (expectedPrimary.includes(column.name) ? 1 : 0));
      if (!(column.pk && column.type === 'integer')) expect(other.default !== null, `${left.name}.${column.name} default presence`).toBe(column.default !== null);
      if (column.default !== null && other.default !== null && !(column.pk && column.type === 'integer')
        && !timestampDefaults.has(`${left.name}.${column.name}`)) {
        expect(literalDefaultValue(other.default, column.type), `${left.name}.${column.name} default value`)
          .toEqual(literalDefaultValue(column.default, column.type));
      }
    }
  }
  const indexShape = (catalog: Catalog) => catalog.indexes.map((entry) => ({ name: entry.name, table: entry.table, unique: entry.unique, columns: entry.columns, partial: entry.predicate !== null }));
  expect(indexShape(postgres)).toEqual(indexShape(sqlite));
  const sqliteDefaultNormalization: Record<string, true> = {
    'beneficiaries.beneficiaries_normalize_timestamp_after_insert': true,
    'organization_settings.organization_settings_normalize_timestamp_after_insert': true,
    'participant_support_case_cutover_manifest.participant_support_case_cutover_manifest_normalize_timestamp_after_insert': true,
    'schedule_custom_questions.schedule_custom_questions_normalize_timestamp_after_insert': true,
    'schedule_session_goals.schedule_session_goals_normalize_timestamp_after_insert': true,
    'session_life_area_snapshots.session_life_area_snapshots_normalize_timestamp_after_insert': true,
    'users.users_normalize_timestamp_after_insert': true,
  };
  const postgresRowIdAllocation: Record<string, true> = {
    'audit_log.ccc_audit_rowid': true,
    'goal_revisions.ccc_goal_revision_rowid': true,
  };
  expect(postgres.triggers.filter(({ name, table }) => postgresRowIdAllocation[`${table}.${name}`] === true)
    .map(({ name, table }) => `${table}.${name}`).sort()).toEqual(Object.keys(postgresRowIdAllocation).sort());
  const triggerShape = (catalog: Catalog) => catalog.triggers
    .filter(({ name, table }) => catalog.engine === 'sqlite'
      ? sqliteDefaultNormalization[`${table}.${name}`] !== true
      : postgresRowIdAllocation[`${table}.${name}`] !== true)
    .map(({ name, table }) => ({ name, table }));
  expect(triggerShape(postgres)).toEqual(triggerShape(sqlite));
  expect(postgres.views.map(({ name }) => name)).toEqual(sqlite.views.map(({ name }) => name));
}
export interface TimestampColumn { table: string; column: string; default: string | null; triggers: string[] }
export function timestampInventory(catalog: Catalog): TimestampColumn[] {
  return catalog.tables.flatMap((table) => table.columns.filter((column) => column.type === 'text' && (/(?:_at|_due)$/.test(column.name) || /datetime\s*\(|strftime\s*\(/i.test(column.default ?? ''))).map((column) => ({ table: table.name, column: column.name, default: column.default, triggers: catalog.triggers.filter((trigger) => (trigger.table === table.name || new RegExp(`\\b${table.name}\\b`).test(trigger.definition)) && new RegExp(`\\b${column.name}\\b`).test(trigger.definition) && /datetime\s*\(|strftime\s*\(/i.test(trigger.definition)).map((trigger) => trigger.name) })));
}
export function fingerprint(catalog: Catalog): string { return hash(canonical(catalog)); }
export function assertFingerprint(catalog: Catalog, expected: string): void {
  expect(fingerprint(catalog), `${catalog.engine} live catalog drift`).toBe(expected);
}
export async function rejection(operation: Promise<unknown>): Promise<Pick<DatabaseError, 'kind' | 'constraintSubtype' | 'applicationCode'>> {
  try { await operation; } catch (error) {
    if (!error || typeof error !== 'object' || !('kind' in error)) throw new Error('Expected a structured database rejection.');
    const structured = error as DatabaseError;
    return {
      kind: structured.kind,
      ...(structured.constraintSubtype === undefined ? {} : { constraintSubtype: structured.constraintSubtype }),
      ...(structured.applicationCode === undefined ? {} : { applicationCode: structured.applicationCode }),
    };
  }
  throw new Error('Expected database operation to reject.');
}

async function assertPostgresStatementClocks(db: Database): Promise<void> {
  const defaults = (await db.prepare(`SELECT table_name,column_name,column_default
    FROM information_schema.columns WHERE table_schema=current_schema()
    AND data_type='text' AND column_default IS NOT NULL AND column_name ~ '(_at|_due)$'
    ORDER BY table_name,column_name`).all<{ table_name: string; column_name: string; column_default: string }>()).results;
  const expressions = defaults.map(({ column_default }, index) => `(${column_default}) AS observed_${index}`);
  const row = await db.prepare(`SELECT ${[
    ...expressions,
    `to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS statement_iso`,
    `to_char(statement_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS') AS statement_legacy`,
  ].join(',')} FROM pg_sleep(0.02)`).first<Row>();
  if (!row) throw new Error('Statement clock probe returned no row.');
  defaults.forEach(({ table_name, column_name }, index) => {
    const value = row[`observed_${index}`];
    expect(value, `${table_name}.${column_name} statement-stable default`)
      .toBe(row[typeof value === 'string' && value.includes('T') ? 'statement_iso' : 'statement_legacy']);
  });
}

/** Schema-only F09 probes: never used as runtime SQL or a dialect translator. */
export async function dialectSemantics(fixture: ParityDatabase): Promise<Row> {
  const sqlite = fixture.profile !== 'postgres';
  const sql = sqlite ? `SELECT
    strftime('%Y-%m-%dT%H:%M:%fZ',datetime('2024-02-29T00:00:00.000Z','+5 years','-1 day')) AS retention_cap,
    strftime('%Y-%m-%dT%H:%M:%fZ',datetime('2024-02-29T00:00:00.000Z','+1 day')) AS purge_due,
    datetime(NULL,'+1 day') AS null_deadline, strftime('%m-%d','2024-02-29T00:00:00.000Z') AS month_day,
    strftime('%m-%d',NULL) AS null_month_day,min(2,3) AS minimum,max(2,3) AS maximum,min(2,NULL) AS null_minimum,
    datetime('2024-02-29T00:00:00.000Z','+'||CAST(NULL AS TEXT)||' days') AS null_grace,
    CASE WHEN '00ff' NOT GLOB '*[^0-9a-f]*' THEN 1 ELSE 0 END AS valid_hex,
    CASE WHEN '0gff' NOT GLOB '*[^0-9a-f]*' THEN 1 ELSE 0 END AS invalid_hex,
    (NULL IS NULL) AS both_null,(1 IS 1) AS same,(1 IS 2) AS different,
    (NULL IS NOT NULL) AS not_both_null,(1 IS NOT 1) AS not_same,(1 IS NOT 2) AS not_different,
    ((SELECT NULL) IS (SELECT NULL)) AS subquery_null,
    (SELECT group_concat(value,',') FROM (SELECT 'c' AS value UNION ALL SELECT 'a' UNION ALL SELECT 'b' ORDER BY value)) AS ordered_values`
    : `SELECT
    to_char(ccc_retention_cap('2024-02-29T00:00:00.000Z'),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS retention_cap,
    to_char(ccc_timestamp(ccc_retention_due('2024-02-29T00:00:00.000Z',1)),'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS purge_due,
    ccc_retention_due(NULL,1) AS null_deadline,to_char(timestamp '2024-02-29','MM-DD') AS month_day,to_char(CAST(NULL AS timestamp),'MM-DD') AS null_month_day,
    LEAST(2,3) AS minimum,GREATEST(2,3) AS maximum,ccc_nullable_least(timestamp '2024-02-29',NULL) AS null_minimum,
    ccc_retention_due('2024-02-29T00:00:00.000Z',NULL) AS null_grace,
    ('00ff' !~ '[^0-9a-f]') AS valid_hex,('0gff' !~ '[^0-9a-f]') AS invalid_hex,
    (NULL IS NOT DISTINCT FROM NULL) AS both_null,
    (1 IS NOT DISTINCT FROM 1) AS same,(1 IS NOT DISTINCT FROM 2) AS different,
    (NULL IS DISTINCT FROM NULL) AS not_both_null,(1 IS DISTINCT FROM 1) AS not_same,
    (1 IS DISTINCT FROM 2) AS not_different,
    ((SELECT NULL) IS NOT DISTINCT FROM (SELECT NULL)) AS subquery_null,
    (SELECT string_agg(value,',' ORDER BY value) FROM (VALUES ('c'),('a'),('b')) v(value)) AS ordered_values`;
  const result = await fixture.db.prepare(sql).first<Row>();
  expect(result).toEqual({ retention_cap: '2029-02-28T00:00:00.000Z', purge_due: '2024-03-01T00:00:00.000Z', null_deadline: null, month_day: '02-29', null_month_day: null, minimum: 2, maximum: 3, null_minimum: null, null_grace: null, valid_hex: 1, invalid_hex: 0, both_null: 1, same: 1, different: 0, not_both_null: 0, not_same: 0, not_different: 1, subquery_null: 1, ordered_values: 'a,b,c' });
  if (!result) throw new Error('Dialect probe returned no row.');
  const scalarBounds = [];
  for (const [a, b] of [[2, 3], [2, null], [null, 3], [null, null]] as const) {
    scalarBounds.push(await fixture.db.prepare(`SELECT ${sqlite
      ? 'min(a,b) AS minimum,max(a,b) AS maximum'
      : 'CASE WHEN a IS NULL OR b IS NULL THEN NULL ELSE LEAST(a,b) END AS minimum,CASE WHEN a IS NULL OR b IS NULL THEN NULL ELSE GREATEST(a,b) END AS maximum'}
      FROM (SELECT CAST(? AS INTEGER) AS a,CAST(? AS INTEGER) AS b) AS inputs`).bind(a, b).first());
  }
  expect(scalarBounds).toEqual([
    { minimum: 2, maximum: 3 }, { minimum: null, maximum: null },
    { minimum: null, maximum: null }, { minimum: null, maximum: null },
  ]);
  result.scalarBounds = scalarBounds;
  if (!sqlite) {
    await assertPostgresStatementClocks(fixture.db);
    const naive = await fixture.db.prepare(`SELECT to_char(timestamp '2024-02-29' + interval '5 years' - interval '1 day','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS value`).first('value');
    expect(naive).toBe('2029-02-27T00:00:00.000Z');
  }
  await fixture.db.prepare('CREATE TABLE parity_null_source (id INTEGER PRIMARY KEY, value INTEGER)').run();
  try {
    await fixture.db.prepare('CREATE TABLE parity_null_observations (step INTEGER PRIMARY KEY, same INTEGER, different INTEGER)').run();
    try {
      if (sqlite) {
        await fixture.db.prepare(`CREATE TRIGGER parity_null_transition AFTER UPDATE ON parity_null_source BEGIN
          INSERT INTO parity_null_observations(step,same,different)
          VALUES(NEW.id,NEW.value IS OLD.value,NEW.value IS NOT OLD.value); END`).run();
      } else {
        await fixture.db.prepare(`CREATE FUNCTION parity_null_transition_function() RETURNS trigger LANGUAGE plpgsql AS '
          BEGIN INSERT INTO parity_null_observations(step,same,different)
          VALUES(NEW.id,CASE WHEN NEW.value IS NOT DISTINCT FROM OLD.value THEN 1 ELSE 0 END,
          CASE WHEN NEW.value IS DISTINCT FROM OLD.value THEN 1 ELSE 0 END); RETURN NEW; END;'`).run();
        await fixture.db.prepare(`CREATE TRIGGER parity_null_transition AFTER UPDATE ON parity_null_source FOR EACH ROW EXECUTE FUNCTION parity_null_transition_function()`).run();
      }
      for (const [id, oldValue, newValue] of [[1, null, null], [2, 1, 1], [3, 1, 2], [4, null, 1], [5, 1, null]] as const) {
        await fixture.db.prepare('INSERT INTO parity_null_source(id,value) VALUES(?,?)').bind(id, oldValue).run();
        await fixture.db.prepare('UPDATE parity_null_source SET value=? WHERE id=?').bind(newValue, id).run();
      }
      const transitions = (await fixture.db.prepare('SELECT step,same,different FROM parity_null_observations ORDER BY step').all()).results;
      expect(transitions).toEqual([
        { step: 1, same: 1, different: 0 }, { step: 2, same: 1, different: 0 },
        { step: 3, same: 0, different: 1 }, { step: 4, same: 0, different: 1 }, { step: 5, same: 0, different: 1 },
      ]);
      result.transitions = transitions;
    } finally {
      await fixture.db.prepare(`DROP TRIGGER IF EXISTS parity_null_transition${sqlite ? '' : ' ON parity_null_source'}`).run();
      if (!sqlite) await fixture.db.prepare('DROP FUNCTION IF EXISTS parity_null_transition_function()').run();
      await fixture.db.prepare('DROP TABLE parity_null_observations').run();
    }
  } finally { await fixture.db.prepare('DROP TABLE parity_null_source').run(); }
  return result;
}
