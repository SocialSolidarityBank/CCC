import { describe, expect, it, vi } from 'vitest';
import type { Database, DatabaseError } from '@ccc/contracts/database';
import { createD1Database } from '@ccc/db-d1';
import type { Env } from '../../../db/gateway';
import { setupD1 } from './support/d1';

const t = setupD1({ provisionDirectory: false });

type FixtureRow = {
  id: number;
  value: string | null;
  payload: Uint8Array;
  marker: string;
};

async function openFixture(): Promise<Database> {
  await t.reset();
  await t.db.prepare(`
    CREATE TABLE database_port_fixture (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT,
      payload BLOB,
      marker TEXT NOT NULL UNIQUE
    )
  `).run();
  return createD1Database(t.db);
}

function asDatabaseError(error: unknown): DatabaseError {
  if (typeof error !== 'object' || error === null || !('kind' in error)) {
    throw new Error(`expected a structured DatabaseError, got ${String(error)}`);
  }
  return error as DatabaseError;
}

// This assignment is intentionally a compile-time consumer of the port. It must
// compile once Env.DB is changed from D1Database to Database in db/gateway.ts.
const gatewayEnvWithPort: Pick<Env, 'DB'> = { DB: {} as Database };

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

    const missingColumn = await db.prepare(
      'SELECT value FROM database_port_fixture WHERE marker = ?',
    ).bind('nullable').first('does_not_exist').catch((error: unknown) => asDatabaseError(error));
    expect(missingColumn.kind).toBe('syntax');
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

    const syntax = await db.prepare('SELECT * FROM table_that_does_not_exist').all()
      .catch((error: unknown) => asDatabaseError(error));
    expect(syntax.kind).toBe('syntax');
    expect(syntax.message).not.toContain('table_that_does_not_exist');

    const arity = await db.prepare('SELECT ? AS value').first()
      .catch((error: unknown) => asDatabaseError(error));
    expect(arity.kind).toBe('bind_arity');

    await db.prepare(
      'INSERT INTO database_port_fixture (value, marker) VALUES (?, ?)',
    ).bind('unique', 'stable-marker').run();
    const unique = await db.prepare(
      'INSERT INTO database_port_fixture (value, marker) VALUES (?, ?)',
    ).bind('duplicate', 'stable-marker').run()
      .catch((error: unknown) => asDatabaseError(error));
    expect(unique.kind).toBe('constraint');
    expect(unique.constraintSubtype).toBe('unique');
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
