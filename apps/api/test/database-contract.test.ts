import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Database, DatabaseError } from '@ccc/contracts/database';
import { createD1Database } from '@ccc/db-d1';
import type { Env } from '../../../db/gateway';
import { setupD1 } from './support/d1';

const t = setupD1({ provisionDirectory: false });


async function openFixture(): Promise<Database> {
  await t.reset();
  const db = createD1Database(t.db);
  await db.prepare(`
    CREATE TABLE database_port_fixture (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT,
      payload BLOB,
      marker TEXT NOT NULL UNIQUE
    )
  `).run();
  await db.prepare('CREATE TABLE database_port_primary (id INTEGER PRIMARY KEY, value TEXT)').run();
  await db.prepare('CREATE TABLE database_port_trigger (id INTEGER PRIMARY KEY, value TEXT)').run();
  await db.prepare(`
    CREATE TRIGGER database_port_unknown_trigger
    BEFORE INSERT ON database_port_trigger
    BEGIN
      SELECT RAISE(ABORT, 'unknown_trigger_code');
    END
  `).run();
  await db.prepare('CREATE TABLE database_port_allowed_trigger (id INTEGER PRIMARY KEY)').run();
  await db.prepare(`
    CREATE TRIGGER database_port_allowed_trigger_check
    BEFORE INSERT ON database_port_allowed_trigger
    BEGIN
      SELECT RAISE(ABORT, 'invite_token_already_used');
    END
  `).run();
  return db;
}

function asDatabaseError(error: unknown): DatabaseError {
  if (typeof error !== 'object' || error === null || !('kind' in error)) {
    throw new Error(`expected a structured DatabaseError, got ${String(error)}`);
  }
  return error as DatabaseError;
}

async function expectDatabaseError(operation: Promise<unknown>): Promise<DatabaseError> {
  try {
    await operation;
  } catch (error) {
    return asDatabaseError(error);
  }
  throw new Error('expected database operation to fail');
}

// This assignment is intentionally a compile-time consumer of the port. It must
// compile once Env.DB is changed from D1Database to Database in db/gateway.ts.
const gatewayEnvWithPort: Pick<Env, 'DB'> = { DB: {} as Database };

beforeAll(async () => {
  await t.reset();
}, 30_000);

describe('Database port', () => {
  it('keeps prepare/bind immutable across independently bound statements', async () => {
    const db = await openFixture();
    const prepared = db.prepare('SELECT ? AS value');

    const alpha = prepared.bind('alpha');
    const beta = prepared.bind('beta');

    await expect(alpha.first<string>('value')).resolves.toBe('alpha');
    await expect(beta.first<string>('value')).resolves.toBe('beta');
    await expect(prepared.bind('gamma').first<string>('value')).resolves.toBe('gamma');
  });

  it('normalizes D1 binary values to owned Uint8Array copies for input and output', async () => {
    const db = await openFixture();
    const input = new Uint8Array([0x00, 0xff]);
    const bound = db.prepare(
      'INSERT INTO database_port_fixture (value, payload, marker) VALUES (?, ?, ?)',
    ).bind('bytes', input, 'input-copy');

    input[0] = 0x7f;
    await bound.run();

    const arrayBuffer = new Uint8Array([0x00, 0xff]).buffer;
    // D1 accepts ArrayBuffer at its native boundary; the adapter must normalize
    // it before forwarding so the public port still owns a byte copy.
    await db.prepare(
      'INSERT INTO database_port_fixture (value, payload, marker) VALUES (?, ?, ?)',
    ).bind('array-buffer', arrayBuffer as unknown as Uint8Array, 'array-buffer-copy').run();

    const row = await db.prepare(
      'SELECT payload FROM database_port_fixture WHERE marker = ?',
    ).bind('input-copy').first<{ payload: Uint8Array }>();
    expect(row?.payload).toBeInstanceOf(Uint8Array);
    expect(Array.from(row?.payload ?? [])).toEqual([0x00, 0xff]);

    const returned = row?.payload;
    if (returned === undefined) throw new Error('expected a returned payload');
    returned[0] = 0x7f;
    const reread = await db.prepare(
      'SELECT payload FROM database_port_fixture WHERE marker = ?',
    ).bind('input-copy').first<{ payload: Uint8Array }>();
    expect(Array.from(reread?.payload ?? [])).toEqual([0x00, 0xff]);

    const arrayBufferRow = await db.prepare(
      'SELECT payload FROM database_port_fixture WHERE marker = ?',
    ).bind('array-buffer-copy').first<{ payload: Uint8Array }>();
    expect(Array.from(arrayBufferRow?.payload ?? [])).toEqual([0x00, 0xff]);
  });

  it('preserves first no-row, NULL, value, and missing-column semantics', async () => {
    const db = await openFixture();

    await expect(db.prepare(
      'SELECT value FROM database_port_fixture WHERE marker = ?',
    ).bind('absent').first<string>('value')).resolves.toBeNull();
    await expect(db.prepare(
      'SELECT value FROM database_port_fixture WHERE marker = ?',
    ).bind('absent').all()).resolves.toMatchObject({ success: true, results: [] });

    await db.prepare(
      'INSERT INTO database_port_fixture (value, marker) VALUES (?, ?)',
    ).bind(null, 'nullable').run();
    await expect(db.prepare(
      'SELECT value FROM database_port_fixture WHERE marker = ?',
    ).bind('nullable').first<string>('value')).resolves.toBeNull();

    await db.prepare(
      'UPDATE database_port_fixture SET value = ? WHERE marker = ?',
    ).bind('present', 'nullable').run();
    await expect(db.prepare(
      'SELECT value FROM database_port_fixture WHERE marker = ?',
    ).bind('nullable').first<string>('value')).resolves.toBe('present');

    const missingColumn = await expectDatabaseError(db.prepare(
      'SELECT value FROM database_port_fixture WHERE marker = ?',
    ).bind('nullable').first('does_not_exist'));
  });

  it('returns D1-compatible all/run results and changes metadata', async () => {
    const db = await openFixture();

    const insert = await db.prepare(
      'INSERT INTO database_port_fixture (value, marker) VALUES (?, ?)',
    ).bind('before', 'metadata').run();
    expect(insert).toMatchObject({ results: [], success: true, meta: { changes: 1 } });

    const update = await db.prepare(
      'UPDATE database_port_fixture SET value = ? WHERE marker = ?',
    ).bind('after', 'metadata').run();
    expect(update).toMatchObject({ results: [], success: true, meta: { changes: 1 } });

    const remove = await db.prepare(
      'DELETE FROM database_port_fixture WHERE marker = ?',
    ).bind('metadata').run();
    expect(remove).toMatchObject({ results: [], success: true, meta: { changes: 1 } });
  });

  it('passes successful batches through in order and rolls back a failed batch', async () => {
    const db = await openFixture();

    const results = await db.batch([
      db.prepare(
        'INSERT INTO database_port_fixture (value, marker) VALUES (?, ?)',
      ).bind('one', 'batch-one'),
      db.prepare(
        'INSERT INTO database_port_fixture (value, marker) VALUES (?, ?)',
      ).bind('two', 'batch-two'),
    ]);
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.success)).toBe(true);
    expect(results.map((result) => result.meta.changes)).toEqual([1, 1]);

    await expect(db.batch([
      db.prepare(
        'INSERT INTO database_port_fixture (value, marker) VALUES (?, ?)',
      ).bind('rolled-back', 'batch-three'),
      db.prepare(
        'INSERT INTO database_port_fixture (value, marker) VALUES (?, ?)',
      ).bind('duplicate', 'batch-one'),
    ])).rejects.toMatchObject({ kind: 'constraint', constraintSubtype: 'unique' });

    const afterRollback = await db.prepare(
      'SELECT COUNT(*) AS count FROM database_port_fixture WHERE marker = ?',
    ).bind('batch-three').first<number>('count');
    expect(afterRollback).toBe(0);
  });

  it('maps D1 rejection boundaries without leaking vendor errors', async () => {
    const db = await openFixture();

    const syntax = await expectDatabaseError(db.prepare('SELECT * FROM table_that_does_not_exist').all());
    expect(syntax.kind).toBe('syntax');
    expect(syntax.message).not.toContain('table_that_does_not_exist');
    const syntaxWithTriggerCode = await expectDatabaseError(
      db.prepare('SELECT stale_draft_version FROM table_that_does_not_exist').all(),
    );
    expect(syntaxWithTriggerCode.kind).toBe('syntax');
    expect(syntaxWithTriggerCode.applicationCode).toBeUndefined();

    const arityZero = await expectDatabaseError(db.prepare('SELECT ? AS value').first());
    expect(arityZero.kind).toBe('bind_arity');
    const arityTwo = await expectDatabaseError(db.prepare('SELECT ? AS value').bind('one', 'two').first());
    expect(arityTwo.kind).toBe('bind_arity');
    const functionArity = await expectDatabaseError(db.prepare("SELECT substr('x', 1, 2, 3)").first());
    expect(functionArity.kind).toBe('syntax');

    await db.prepare(
      'INSERT INTO database_port_fixture (value, marker) VALUES (?, ?)',
    ).bind('unique', 'stable-marker').run();
    const unique = await expectDatabaseError(db.prepare(
      'INSERT INTO database_port_fixture (value, marker) VALUES (?, ?)',
    ).bind('duplicate', 'stable-marker').run());
    expect(unique.kind).toBe('constraint');
    expect(unique.constraintSubtype).toBe('unique');
  });

  it('maps real primary-key and unknown-trigger constraints without leaking codes', async () => {
    const db = await openFixture();
    await db.prepare('INSERT INTO database_port_primary (id, value) VALUES (?, ?)')
      .bind(1, 'first').run();
    const primary = await expectDatabaseError(
      db.prepare('INSERT INTO database_port_primary (id, value) VALUES (?, ?)')
        .bind(1, 'duplicate').run(),
    );
    expect(primary).toMatchObject({ kind: 'constraint', constraintSubtype: 'primary_key' });
    const allowed = await expectDatabaseError(
      db.prepare('INSERT INTO database_port_allowed_trigger (id) VALUES (?)')
        .bind(1).run(),
    );
    expect(allowed).toMatchObject({
      kind: 'constraint',
      constraintSubtype: 'trigger',
      applicationCode: 'invite_token_already_used',
    });

    const trigger = await expectDatabaseError(
      db.prepare('INSERT INTO database_port_trigger (id, value) VALUES (?, ?)')
        .bind(1, 'blocked').run(),
    );
    expect(trigger).toMatchObject({ kind: 'constraint', constraintSubtype: 'trigger' });
    expect(trigger.applicationCode).toBeUndefined();
  });

  it('does not translate SQL at the D1 adapter boundary', () => {
    const makePrepared = (sql: string) => ({
      bind: (..._values: unknown[]) => makePrepared(sql),
      first: async () => null,
      all: async () => ({ results: [], success: true, meta: {} }),
      run: async () => ({ results: [], success: true, meta: { changes: 0 } }),
    });
    const prepare = vi.fn(makePrepared);
    const d1 = {
      prepare,
      batch: async () => [],
    } as unknown as D1Database;
    const db = createD1Database(d1);

    db.prepare('SELECT $1 AS value');
    expect(prepare).toHaveBeenCalledWith('SELECT $1 AS value');
  });

  it('keeps the gateway environment assignable from the public port', () => {
    expect(gatewayEnvWithPort.DB).toBeDefined();
  });
});
