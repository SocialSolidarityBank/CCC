import postgres from 'postgres';
import type {
  Bindable,
  Database,
  DatabaseError,
  DatabaseResult,
  PreparedStatement,
} from '@ccc/contracts/database';
import { scanSqlPlaceholders, type ScannedSql } from '@ccc/contracts/sql';

const APPLICATION_TRIGGER_CODES = [
  'stale_draft_version',
  'invite_token_already_used',
  'participant_schema_violation',
  'counseling_memory_fence',
] as const;
// Extended protocol also rejects multiple commands in an unbound statement.
const QUERY_OPTIONS = { prepare: false, simple: false };
type ConstraintSubtype = NonNullable<DatabaseError['constraintSubtype']>;
type Row = Record<string, unknown>;

export interface PostgresDatabaseOptions {
  connectionString: string;
  maxConnections?: number;
  /** Disable TLS only for isolated loopback fixtures or an authenticated local tunnel. */
  ssl?: 'verify-full' | false;
}

export interface PostgresDatabase extends Database {
  close(): Promise<void>;
}

class PostgresDatabaseError extends Error implements DatabaseError {
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

function normalizeError(error: unknown): PostgresDatabaseError {
  if (error instanceof PostgresDatabaseError) return error;
  if (!(error instanceof postgres.PostgresError)) return new PostgresDatabaseError('unsupported');
  switch (error.code) {
    case '23503': return new PostgresDatabaseError('constraint', 'foreign_key');
    case '23502': return new PostgresDatabaseError('constraint', 'check');
    case '23514':
      return new PostgresDatabaseError('constraint', 'check',
        APPLICATION_TRIGGER_CODES.find((code) => error.constraint_name === code));
    case 'P0001':
      return new PostgresDatabaseError('constraint', 'trigger',
        APPLICATION_TRIGGER_CODES.find((code) => error.message === code));
    default:
      return new PostgresDatabaseError(error.code.startsWith('42') ? 'syntax' : 'unsupported');
  }
}

function copyBinding(value: Bindable): Bindable {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value === null || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)
    && (!Number.isInteger(value) || Number.isSafeInteger(value))) return value;
  throw new PostgresDatabaseError('unsupported');
}

function normalizeValue(value: unknown, oid: number): unknown {
  if (value === null) return null;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  // int8 and numeric (including SUM(bigint)) arrive as text, not rounded numbers.
  if ((oid === 20 || oid === 1700) && typeof value === 'string') {
    const decimal = /^[+-]?(\d+)(?:\.(\d+))?$/.exec(value);
    if (decimal !== null) {
      const whole = BigInt(decimal[1]!);
      const limit = BigInt(Number.MAX_SAFE_INTEGER);
      if (whole > limit || (whole === limit && /[1-9]/.test(decimal[2] ?? ''))) {
        throw new PostgresDatabaseError('unsupported');
      }
    }
    value = Number(value);
  }
  if (typeof value === 'number'
    && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) {
    throw new PostgresDatabaseError('unsupported');
  }
  return value;
}

function normalizeRow(nativeRow: Row, columns: postgres.RowList<Row[]>['columns']): Row {
  const row: Row = {};
  for (const column of columns) {
    Object.defineProperty(row, column.name, {
      value: normalizeValue(nativeRow[column.name], column.type),
      enumerable: true, writable: true, configurable: true,
    });
  }
  return row;
}

function result<T>(native: postgres.RowList<Row[]>, discardRows = false): DatabaseResult<T> {
  const rows: Row[] = [];
  for (const nativeRow of native) {
    if (discardRows) {
      for (const column of native.columns) normalizeValue(nativeRow[column.name], column.type);
    } else {
      rows.push(normalizeRow(nativeRow, native.columns));
    }
  }
  return {
    results: rows as T[],
    success: true,
    meta: { changes: ['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(native.command) ? native.count : 0 },
  };
}

interface StatementData {
  scanned: ScannedSql;
  bindings: Bindable[];
}

export function createPostgresDatabase(options: PostgresDatabaseOptions): PostgresDatabase {
  if (typeof options.connectionString !== 'string' || options.connectionString.trim().length === 0
    || (options.maxConnections !== undefined
      && (!Number.isSafeInteger(options.maxConnections) || options.maxConnections < 1))
    || (options.ssl !== undefined && options.ssl !== false
      && options.ssl !== 'verify-full')) {
    throw new PostgresDatabaseError('unsupported');
  }
  let pool: postgres.Sql;
  try {
    pool = postgres(options.connectionString, {
      ssl: options.ssl ?? 'verify-full',
      ...(options.maxConnections === undefined ? {} : { max: options.maxConnections }),
      debug: false,
      onnotice: () => {},
      // Timestamp storage is ISO TEXT; native timestamp results remain text too.
      types: {
        date: {
          to: 1184,
          from: [1082, 1114, 1184],
          serialize: (value: string) => value,
          parse: (value: string) => value,
        },
      },
    });
  } catch (error) {
    throw normalizeError(error);
  }
  const statements = new WeakMap<PreparedStatement, StatementData>();
  let closed = false;
  let closing: Promise<void> | undefined;

  function assertOpen(): void {
    if (closed) throw new PostgresDatabaseError('unsupported');
  }

  function assertArity(data: StatementData): void {
    if (data.bindings.length !== data.scanned.parameterCount) {
      throw new PostgresDatabaseError('bind_arity');
    }
  }

  async function failure(error: unknown): Promise<PostgresDatabaseError> {
    if (!(error instanceof postgres.PostgresError) || error.code !== '23505') return normalizeError(error);
    // PostgreSQL uses 23505 for both kinds. Look up the actual index, never its suffix.
    // batch calls this only after begin() has rolled back and released its connection.
    if (!closed && error.schema_name && error.table_name && error.constraint_name) {
      try {
        const rows = await pool.unsafe<{ primary: boolean }[]>(
          `SELECT i.indisprimary AS primary
           FROM pg_catalog.pg_index i
           JOIN pg_catalog.pg_class ix ON ix.oid = i.indexrelid
           JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
           WHERE n.nspname = $1 AND t.relname = $2 AND ix.relname = $3`,
          [error.schema_name, error.table_name, error.constraint_name], QUERY_OPTIONS,
        );
        if (rows.length === 1) {
          return new PostgresDatabaseError('constraint', rows[0]!.primary ? 'primary_key' : 'unique');
        }
      } catch { /* Catalog failure must not expose vendor detail or guess the constraint kind. */ }
    }
    return new PostgresDatabaseError('constraint');
  }

  async function execute<T>(client: postgres.ISql, data: StatementData, discardRows = false): Promise<DatabaseResult<T>> {
    assertArity(data);
    const native = await client.unsafe<Row[]>(data.scanned.postgresSql, data.bindings, QUERY_OPTIONS);
    return result<T>(native, discardRows);
  }

  async function executeStandalone<T>(data: StatementData, discardRows = false): Promise<DatabaseResult<T>> {
    assertOpen();
    try {
      return await execute<T>(pool, data, discardRows);
    } catch (error) {
      throw await failure(error);
    }
  }

  function statement(data: StatementData): PreparedStatement {
    const prepared: PreparedStatement = {
      bind(...values: Bindable[]): PreparedStatement {
        return statement({ scanned: data.scanned, bindings: values.map(copyBinding) });
      },
      async first<T = unknown>(column?: string): Promise<T | null> {
        assertOpen();
        assertArity(data);
        try {
          const native = await pool.unsafe<Row[]>(data.scanned.postgresSql, data.bindings, QUERY_OPTIONS);
          const row = native[0];
          if (row === undefined) return null;
          if (column === undefined) return normalizeRow(row, native.columns) as T;
          if (!Object.hasOwn(row, column)) throw new PostgresDatabaseError('syntax');
          const descriptor = native.columns.find((candidate) => candidate.name === column)!;
          return normalizeValue(row[column], descriptor.type) as T | null;
        } catch (error) {
          throw await failure(error);
        }
      },
      all<T = unknown>(): Promise<DatabaseResult<T>> {
        return executeStandalone<T>(data);
      },
      run(): Promise<DatabaseResult<unknown>> {
        return executeStandalone(data, true);
      },
    };
    statements.set(prepared, data);
    return prepared;
  }

  return {
    prepare(sql: string): PreparedStatement {
      assertOpen();
      if (typeof sql !== 'string') throw new PostgresDatabaseError('syntax');
      let scanned: ScannedSql;
      try {
        scanned = scanSqlPlaceholders(sql);
      } catch {
        throw new PostgresDatabaseError('syntax');
      }
      return statement({ scanned, bindings: [] });
    },
    async batch<T = unknown>(input: PreparedStatement[]): Promise<DatabaseResult<T>[]> {
      assertOpen();
      const batch = input.map((prepared) => {
        const data = statements.get(prepared);
        if (data === undefined) throw new PostgresDatabaseError('unsupported');
        assertArity(data);
        return data;
      });
      if (batch.length === 0) return [];
      try {
        return await pool.begin(async (transaction) => {
          const results: DatabaseResult<T>[] = [];
          for (const data of batch) results.push(await execute<T>(transaction, data));
          return results;
        });
      } catch (error) {
        throw await failure(error);
      }
    },
    close(): Promise<void> {
      if (closing !== undefined) return closing;
      closed = true;
      closing = pool.end().catch((error: unknown) => { throw normalizeError(error); });
      return closing;
    },
  };
}
