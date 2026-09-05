import NativeDatabase, { type Statement as NativeStatement } from 'better-sqlite3-multiple-ciphers';
import type {
  Bindable,
  Database,
  DatabaseError,
  DatabaseResult,
  PreparedStatement,
} from '@ccc/contracts/database';
import { scanSqlPlaceholders } from '@ccc/contracts/sql';

const APPLICATION_TRIGGER_CODES = [
  'stale_draft_version',
  'invite_token_already_used',
  'participant_schema_violation',
] as const;
const MIGRATION_NAME = /^\d{4}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/;

type NativeConnection = InstanceType<typeof NativeDatabase>;
type ConstraintSubtype = NonNullable<DatabaseError['constraintSubtype']>;

export interface SqliteMigration {
  name: string;
  sql: string;
}

export interface EncryptedSqliteOptions {
  filename: string;
  key: Uint8Array;
  fileMustExist?: boolean;
  timeoutMs?: number;
}

export interface EncryptedSqliteDatabase extends Database {
  applyMigrations(migrations: readonly SqliteMigration[]): void;
  close(): void;
}

export class SqliteDatabaseError extends Error implements DatabaseError {
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string {
  return typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
}

function normalizeError(error: unknown, fallback: DatabaseError['kind'] = 'unsupported'): SqliteDatabaseError {
  if (error instanceof SqliteDatabaseError) return error;
  const code = errorCode(error);
  const text = errorText(error);
  const lower = text.toLowerCase();
  if (text === 'Too few parameter values were provided'
    || text === 'Too many parameter values were provided') {
    return new SqliteDatabaseError('bind_arity');
  }

  const subtype: ConstraintSubtype | undefined = code.includes('PRIMARYKEY') ? 'primary_key'
    : code.includes('UNIQUE') ? 'unique'
      : code.includes('FOREIGNKEY') ? 'foreign_key'
        : code.includes('CHECK') || code.includes('NOTNULL') ? 'check'
          : code.includes('TRIGGER') ? 'trigger'
            : undefined;
  if (subtype !== undefined || code.startsWith('SQLITE_CONSTRAINT')) {
    const resolved = subtype ?? 'trigger';
    const applicationCode = resolved === 'trigger'
      ? APPLICATION_TRIGGER_CODES.find((candidate) => text.match(/\b[a-z][a-z0-9_]*\b/g)?.includes(candidate))
      : undefined;
    return new SqliteDatabaseError('constraint', resolved, applicationCode);
  }
  if (code === 'SQLITE_ERROR' || lower.includes('syntax') || lower.includes('no such table')
    || lower.includes('no such column') || lower.includes('wrong number of arguments')) {
    return new SqliteDatabaseError('syntax');
  }
  return new SqliteDatabaseError(fallback);
}

function copyBinding(value: Bindable): Bindable {
  const candidate = value as unknown;
  if (candidate instanceof ArrayBuffer) return new Uint8Array(candidate.slice(0));
  return value instanceof Uint8Array ? new Uint8Array(value) : value;
}

function nativeBinding(value: Bindable): string | number | null | Buffer {
  return value instanceof Uint8Array ? Buffer.from(value) : value;
}

function normalizeValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (typeof value === 'bigint') {
    const number = Number(value);
    if (!Number.isSafeInteger(number)) throw new SqliteDatabaseError('unsupported');
    return number;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new SqliteDatabaseError('unsupported');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeValue(entry)]));
  }
  return value;
}

function result<T>(rows: T[], changes?: number, lastRowId?: number): DatabaseResult<T> {
  return {
    results: rows.map((row) => normalizeValue(row)) as T[],
    success: true,
    meta: {
      ...(changes === undefined ? {} : { changes }),
      ...(lastRowId === undefined ? {} : { last_row_id: lastRowId }),
    },
  };
}

class SqlitePreparedStatement implements PreparedStatement {
  constructor(
    private readonly owner: SqliteDatabaseAdapter,
    private readonly sql: string,
    private readonly bindings: readonly Bindable[] = [],
  ) {}

  bind(...values: Bindable[]): PreparedStatement {
    return new SqlitePreparedStatement(this.owner, this.sql, values.map(copyBinding));
  }

  private statement(): NativeStatement {
    return this.owner.native().prepare(this.sql);
  }

  private values(): Array<string | number | null | Buffer> {
    return this.bindings.map(nativeBinding);
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    try {
      const row = this.statement().get(...this.values());
      if (row === undefined) return null;
      if (column !== undefined) {
        if (typeof row !== 'object' || row === null || !Object.hasOwn(row, column)) {
          throw new SqliteDatabaseError('syntax');
        }
        return normalizeValue((row as Record<string, unknown>)[column]) as T | null;
      }
      return normalizeValue(row) as T;
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async all<T = unknown>(): Promise<DatabaseResult<T>> {
    try {
      return result(this.statement().all(...this.values()) as T[]);
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async run(): Promise<DatabaseResult<unknown>> {
    try {
      return this.runSync(this.statement());
    } catch (error) {
      throw normalizeError(error);
    }
  }

  executeInBatch<T>(): DatabaseResult<T> {
    const statement = this.statement();
    if (statement.reader) return result(statement.all(...this.values()) as T[]);
    return this.runSync(statement) as DatabaseResult<T>;
  }

  belongsTo(database: SqliteDatabaseAdapter): boolean {
    return this.owner === database;
  }

  private runSync(statement: NativeStatement): DatabaseResult<unknown> {
    const native = statement.run(...this.values());
    const last = Number(native.lastInsertRowid);
    return result([], native.changes, Number.isSafeInteger(last) ? last : undefined);
  }
}

class SqliteDatabaseAdapter implements EncryptedSqliteDatabase {
  private closed = false;

  constructor(private readonly connection: NativeConnection) {}

  prepare(sql: string): PreparedStatement {
    if (this.closed || typeof sql !== 'string') throw new SqliteDatabaseError('syntax');
    try {
      scanSqlPlaceholders(sql);
    } catch {
      throw new SqliteDatabaseError('syntax');
    }
    return new SqlitePreparedStatement(this, sql);
  }

  async batch<T = unknown>(statements: PreparedStatement[]): Promise<DatabaseResult<T>[]> {
    if (this.closed || statements.some((statement) => (
      !(statement instanceof SqlitePreparedStatement) || !statement.belongsTo(this)
    ))) throw new SqliteDatabaseError('unsupported');
    try {
      const execute = this.connection.transaction(() => (
        statements.map((statement) => (statement as SqlitePreparedStatement).executeInBatch<T>())
      ));
      return execute.immediate();
    } catch (error) {
      throw normalizeError(error);
    }
  }

  /** Applies only the caller-supplied, not-yet-applied ordered set. The Application Service owns its migration ledger. */
  applyMigrations(migrations: readonly SqliteMigration[]): void {
    if (this.closed) throw new SqliteDatabaseError('unsupported');
    let previous = '';
    for (const migration of migrations) {
      if (!MIGRATION_NAME.test(migration.name) || migration.name <= previous || migration.sql.length === 0) {
        throw new SqliteDatabaseError('unsupported');
      }
      previous = migration.name;
    }
    for (const migration of migrations) {
      try {
        this.connection.transaction(() => this.connection.exec(migration.sql)).immediate();
      } catch (error) {
        throw normalizeError(error);
      }
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.connection.close();
    } catch (error) {
      throw normalizeError(error);
    }
  }

  native(): NativeConnection {
    if (this.closed) throw new SqliteDatabaseError('unsupported');
    return this.connection;
  }
}

export function openEncryptedSqlite(options: EncryptedSqliteOptions): EncryptedSqliteDatabase {
  const filename = typeof options.filename === 'string' ? options.filename.trim() : '';
  if (filename.length === 0 || filename === ':memory:'
    || !(options.key instanceof Uint8Array) || options.key.byteLength !== 32) {
    throw new SqliteDatabaseError('unsupported');
  }
  let connection: NativeConnection | undefined;
  const key = Buffer.from(options.key);
  try {
    connection = new NativeDatabase(filename, {
      ...(options.fileMustExist === undefined ? {} : { fileMustExist: options.fileMustExist }),
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
    });
    connection.key(key);
    connection.defaultSafeIntegers(true);
    connection.prepare('SELECT COUNT(*) AS count FROM sqlite_schema').get();
    connection.pragma('foreign_keys = ON');
    const journalMode = connection.pragma('journal_mode = WAL', { simple: true });
    if (journalMode !== 'wal') throw new SqliteDatabaseError('unsupported');
    return new SqliteDatabaseAdapter(connection);
  } catch (error) {
    try { connection?.close(); } catch { /* no error detail leaves the adapter */ }
    throw normalizeError(error);
  } finally {
    key.fill(0);
  }
}
