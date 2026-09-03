import type {
  Bindable,
  Database,
  DatabaseError,
  DatabaseResult,
  PreparedStatement,
} from '@ccc/contracts/database';

const APPLICATION_TRIGGER_CODES = [
  'stale_draft_version',
  'invite_token_already_used',
  'participant_schema_violation',
] as const;

type ConstraintSubtype = NonNullable<DatabaseError['constraintSubtype']>;
type D1Statement = D1PreparedStatement;
type D1Value = string | number | null | ArrayBuffer | Uint8Array;

type DatabaseEnvironment<T extends { DB: unknown }> = Omit<T, 'DB'> & { DB: Database };

interface D1ResultLike<T> {
  results: T[];
  success: boolean;
  meta?: { changes?: number; last_row_id?: number };
}

class NormalizedDatabaseError extends Error implements DatabaseError {
  override readonly name = 'DatabaseError';
  readonly kind: DatabaseError['kind'];
  readonly constraintSubtype?: ConstraintSubtype;
  readonly applicationCode?: string;

  constructor(kind: DatabaseError['kind'], subtype?: ConstraintSubtype, applicationCode?: string) {
    super(kind === 'constraint' ? 'database constraint failed' : `database ${kind} failed`);
    this.kind = kind;
    if (subtype !== undefined) this.constraintSubtype = subtype;
    if (applicationCode !== undefined) this.applicationCode = applicationCode;
  }
}

function copyBytes(value: Uint8Array): Uint8Array {
  return new Uint8Array(value);
}

function normalizeBinding(value: Bindable): D1Value {
  if (value instanceof Uint8Array) return copyBytes(value);
  const candidate = value as unknown;
  if (candidate instanceof ArrayBuffer) return copyBytes(new Uint8Array(candidate));
  return value;
}

function isByteArray(value: unknown): value is number[] {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === 'number'
      && Number.isInteger(entry)
      && entry >= 0
      && entry <= 255);
}

function normalizeValue(value: unknown): unknown {
  if (value instanceof ArrayBuffer) return copyBytes(new Uint8Array(value));
  if (value instanceof Uint8Array) return copyBytes(value);
  if (isByteArray(value)) return new Uint8Array(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new NormalizedDatabaseError('unsupported');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)]));
  }
  return value;
}

function normalizeResult<T>(result: D1ResultLike<T>): DatabaseResult<T> {
  return {
    results: result.results.map((row) => normalizeValue(row)) as T[],
    success: result.success,
    meta: {
      ...(result.meta?.changes === undefined ? {} : { changes: result.meta.changes }),
      ...(result.meta?.last_row_id === undefined ? {} : { last_row_id: result.meta.last_row_id }),
    },
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCodes(error: unknown): unknown[] {
  const codes: unknown[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof current !== 'object' || current === null) break;
    if ('code' in current) codes.push(current.code);
    if ('errno' in current) codes.push(current.errno);
    if (!('cause' in current)) break;
    current = current.cause;
  }
  return codes;
}

function hasCode(error: unknown, ...expected: Array<string | number>): boolean {
  return errorCodes(error).some((code) => expected.some((candidate) => String(code) === String(candidate)));
}

function sqliteConstraintClass(error: unknown, text: string): string | undefined {
  const code = errorCodes(error).find((value) => String(value).startsWith('SQLITE_CONSTRAINT'));
  if (code !== undefined) return String(code);
  return text.match(/\bSQLITE_CONSTRAINT(?:_[A-Z]+)?\b/)?.[0];
}

function findStructuredSubtype(error: unknown, text: string): ConstraintSubtype | undefined {
  if (hasCode(error, 'SQLITE_CONSTRAINT_PRIMARYKEY', 1555) || sqliteConstraintClass(error, text) === 'SQLITE_CONSTRAINT_PRIMARYKEY') return 'primary_key';
  if (hasCode(error, 'SQLITE_CONSTRAINT_TRIGGER', 1811) || sqliteConstraintClass(error, text) === 'SQLITE_CONSTRAINT_TRIGGER') return 'trigger';
  if (hasCode(error, 'SQLITE_CONSTRAINT_UNIQUE', 2067) || sqliteConstraintClass(error, text) === 'SQLITE_CONSTRAINT_UNIQUE') return 'unique';
  if (hasCode(error, 'SQLITE_CONSTRAINT_FOREIGNKEY', 787) || sqliteConstraintClass(error, text) === 'SQLITE_CONSTRAINT_FOREIGNKEY') return 'foreign_key';
  if (hasCode(error, 'SQLITE_CONSTRAINT_CHECK', 275) || sqliteConstraintClass(error, text) === 'SQLITE_CONSTRAINT_CHECK') return 'check';
  if (hasCode(error, 'SQLITE_CONSTRAINT_NOTNULL', 1299) || sqliteConstraintClass(error, text) === 'SQLITE_CONSTRAINT_NOTNULL') return 'check';
  return undefined;
}

function findApplicationCode(text: string): string | undefined {
  const tokens: string[] = text.match(/\b[a-z][a-z0-9_]*\b/g) ?? [];
  return APPLICATION_TRIGGER_CODES.find((code) => tokens.includes(code));
}

function exactBindingCountDiagnostic(lower: string): boolean {
  const bindingWord = lower.includes('bind') || lower.includes('binding') || lower.includes('parameter');
  const countWord = lower.includes('expected') || lower.includes('received') || lower.includes('got')
    || lower.includes('mismatch') || lower.includes('arity') || lower.includes('wrong number')
    || lower.includes('too few') || lower.includes('too many');
  return bindingWord && countWord;
}

function normalizeErrorSync(error: unknown, fallback: DatabaseError['kind'] = 'unsupported'): DatabaseError {
  const text = errorText(error);
  if (exactBindingCountDiagnostic(text.toLowerCase())) return new NormalizedDatabaseError('bind_arity');
  const lower = text.toLowerCase();
  if (lower.includes('syntax') || lower.includes('no such table') || lower.includes('no such column')
    || (lower.includes('column') && (lower.includes('does not exist') || lower.includes('not found')))
    || lower.includes('incomplete input') || lower.includes('near ') || lower.includes('argument')) {
    return new NormalizedDatabaseError('syntax');
  }
  return new NormalizedDatabaseError(fallback);
}

async function primaryKeyMatches(error: unknown, d1: D1Database | undefined): Promise<boolean> {
  if (d1 === undefined) return false;
  const match = errorText(error).match(/UNIQUE constraint failed:\s*([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/i);
  if (match === null) return false;
  const table = match[1];
  const column = match[2];
  if (table === undefined || column === undefined) return false;
  try {
    const info = await d1.prepare(`PRAGMA table_info("${table.replaceAll('"', '""')}")`).all<{ name: string; pk: number }>();
    return info.results.some((row) => row.name === column && row.pk > 0);
  } catch {
    return false;
  }
}

async function normalizeError(
  error: unknown,
  d1: D1Database | undefined,
  fallback: DatabaseError['kind'] = 'unsupported',
): Promise<DatabaseError> {
  const text = errorText(error);
  const lower = text.toLowerCase();
  if (exactBindingCountDiagnostic(lower)) return new NormalizedDatabaseError('bind_arity');
  const structuredSubtype = findStructuredSubtype(error, text);
  if (structuredSubtype !== undefined || lower.includes('constraint failed') || sqliteConstraintClass(error, text) !== undefined) {
    const subtype: ConstraintSubtype = structuredSubtype
      ?? (await primaryKeyMatches(error, d1) ? 'primary_key' : undefined)
      ?? (lower.includes('foreign key') ? 'foreign_key' : undefined)
      ?? (lower.includes('check constraint') || lower.includes('not null') ? 'check' : undefined)
      ?? (lower.includes('unique') ? 'unique' : undefined)
      ?? 'trigger';
    const applicationCode = subtype === 'trigger' ? findApplicationCode(text) : undefined;
    return new NormalizedDatabaseError('constraint', subtype, applicationCode);
  }
  if (lower.includes('syntax') || lower.includes('no such table') || lower.includes('no such column')
    || (lower.includes('column') && (lower.includes('does not exist') || lower.includes('not found')))
    || lower.includes('incomplete input') || lower.includes('near ') || lower.includes('argument')) {
    return new NormalizedDatabaseError('syntax');
  }
  return new NormalizedDatabaseError(fallback);
}

class D1PreparedStatementAdapter implements PreparedStatement {
  constructor(private readonly statement: D1Statement, private readonly d1: D1Database) {}

  bind(...values: Bindable[]): PreparedStatement {
    try {
      return new D1PreparedStatementAdapter(this.statement.bind(...values.map(normalizeBinding)), this.d1);
    } catch (error) {
      throw normalizeErrorSync(error, 'bind_arity');
    }
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    try {
      const result = column === undefined
        ? await this.statement.first<T>()
        : await this.statement.first<T>(column);
      if (column !== undefined && result === undefined) throw new NormalizedDatabaseError('syntax');
      return normalizeValue(result) as T | null;
    } catch (error) {
      if (error instanceof NormalizedDatabaseError) throw error;
      throw await normalizeError(error, this.d1);
    }
  }

  async all<T = unknown>(): Promise<DatabaseResult<T>> {
    try {
      return normalizeResult(await this.statement.all<T>());
    } catch (error) {
      throw await normalizeError(error, this.d1);
    }
  }

  async run(): Promise<DatabaseResult<unknown>> {
    try {
      const result = normalizeResult(await this.statement.run());
      return { ...result, results: [] };
    } catch (error) {
      throw await normalizeError(error, this.d1);
    }
  }

  native(): D1Statement { return this.statement; }
}

function unwrap(statement: PreparedStatement): D1Statement {
  if (!(statement instanceof D1PreparedStatementAdapter)) throw new NormalizedDatabaseError('unsupported');
  return statement.native();
}

export function createD1Database(d1: D1Database): Database {
  return {
    prepare(sql: string): PreparedStatement {
      try { return new D1PreparedStatementAdapter(d1.prepare(sql), d1); }
      catch (error) { throw normalizeErrorSync(error, 'syntax'); }
    },
    async batch<T = unknown>(statements: PreparedStatement[]): Promise<DatabaseResult<T>[]> {
      try {
        const results = await d1.batch<T>(statements.map(unwrap));
        return results.map(normalizeResult);
      } catch (error) {
        throw await normalizeError(error, d1);
      }
    },
  };
}

export function adaptD1Environment<T extends { DB: Database }>(environment: T): DatabaseEnvironment<T>;
export function adaptD1Environment<T extends { DB: D1Database }>(environment: T): DatabaseEnvironment<T>;
export function adaptD1Environment<T extends { DB: unknown }>(environment: T): DatabaseEnvironment<T> {
  const { DB: db } = environment;
  if (typeof db !== 'object' || db === null) throw new Error('database binding is unavailable');
  const candidate = db as { prepare?: unknown; batch?: unknown; exec?: unknown; dump?: unknown };
  if (typeof candidate.prepare !== 'function' || typeof candidate.batch !== 'function') {
    throw new Error('database binding is invalid');
  }
  if (typeof candidate.exec !== 'function' && typeof candidate.dump !== 'function') {
    return environment as DatabaseEnvironment<T>;
  }
  const d1 = db as D1Database;
  return { ...environment, DB: createD1Database(d1) };
}
