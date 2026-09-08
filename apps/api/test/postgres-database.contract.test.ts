import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { inspect } from 'node:util';
import type { Database, DatabaseError, PreparedStatement } from '@ccc/contracts/database';
import { defineDatabaseContract } from './support/database-contract';
import { startPostgresHarness, type PostgresHarness } from './support/postgres';

let harness: PostgresHarness | undefined;

beforeAll(async () => {
  harness = await startPostgresHarness();
}, 240_000);
afterEach(async () => { await harness?.closeDatabases(); }, 30_000);
afterAll(async () => { await harness?.dispose(); }, 150_000);

async function openDatabase() {
  if (!harness) throw new Error('Disposable PostgreSQL harness did not start.');
  return harness.openDatabase();
}

async function rejection(operation: () => unknown | Promise<unknown>): Promise<DatabaseError> {
  try { await operation(); } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect(error).toHaveProperty('kind');
    return error as DatabaseError;
  }
  throw new Error('Expected a structured database rejection.');
}

async function transactionFixture(): Promise<Database> {
  const db = await openDatabase();
  for (const sql of [
    'CREATE TABLE parent_fixture (id BIGINT PRIMARY KEY)',
    `CREATE TABLE mutation_fixture (
      id BIGINT CONSTRAINT deliberately_unconventional_identity PRIMARY KEY,
      marker TEXT NOT NULL UNIQUE,
      parent_id BIGINT REFERENCES parent_fixture(id),
      amount BIGINT NOT NULL CHECK (amount >= 0)
    )`,
    'CREATE TABLE audit_fixture (marker TEXT PRIMARY KEY)',
    'CREATE TABLE rejection_fixture (code TEXT NOT NULL)',
    `CREATE FUNCTION reject_fixture() RETURNS trigger LANGUAGE plpgsql AS '
      BEGIN RAISE EXCEPTION USING MESSAGE = NEW.code; END;
    '`,
    `CREATE TRIGGER reject_fixture BEFORE INSERT ON rejection_fixture
      FOR EACH ROW EXECUTE FUNCTION reject_fixture()`,
  ]) await db.prepare(sql).run();
  await db.prepare('INSERT INTO parent_fixture (id) VALUES (?)').bind(1).run();
  await db.prepare('INSERT INTO mutation_fixture (id, marker, parent_id, amount) VALUES (?, ?, ?, ?)')
    .bind(1, 'existing', 1, 1).run();
  return db;
}

function mutationAndAudit(db: Database, marker: string): PreparedStatement[] {
  return [
    db.prepare('INSERT INTO mutation_fixture (id, marker, parent_id, amount) VALUES (?, ?, ?, ?)')
      .bind(2, marker, 1, 7),
    db.prepare(`INSERT INTO audit_fixture (marker)
      SELECT ? WHERE EXISTS (SELECT 1 FROM mutation_fixture WHERE marker = ?)`)
      .bind(marker, marker),
  ];
}

async function expectRolledBack(db: Database, marker: string): Promise<void> {
  // Read again outside the rejected transaction: committed pool escapes cannot hide.
  expect(await db.prepare('SELECT COUNT(*) AS count FROM mutation_fixture WHERE marker = ?')
    .bind(marker).first('count')).toBe(0);
  expect(await db.prepare('SELECT COUNT(*) AS count FROM audit_fixture WHERE marker = ?')
    .bind(marker).first('count')).toBe(0);
  expect(await db.prepare('SELECT amount FROM mutation_fixture WHERE id = ?')
    .bind(1).first('amount')).toBe(1);
}

defineDatabaseContract('PostgreSQL', openDatabase, { dialect: 'postgres' });

describe('PostgreSQL transaction and decoding contracts', () => {
  it('preserves nullable legacy primary keys and distinguishes their marked constraint from ordinary uniqueness', async () => {
    const db = await openDatabase();
    await db.prepare(`CREATE TABLE legacy_primary_fixture (
      id TEXT CONSTRAINT legacy_nullable_key UNIQUE,
      natural_key TEXT CONSTRAINT legacy_primary_fixture_pkey UNIQUE
    )`).run();
    await db.prepare(`COMMENT ON CONSTRAINT legacy_nullable_key ON legacy_primary_fixture IS 'ccc:sqlite-primary-key'`).run();
    for (const [id, naturalKey] of [[null, 'first-null'], [null, 'second-null'], ['existing', 'natural']] as const) {
      await db.prepare('INSERT INTO legacy_primary_fixture (id, natural_key) VALUES (?, ?)').bind(id, naturalKey).run();
    }
    expect(await db.prepare('SELECT COUNT(*) AS count FROM legacy_primary_fixture WHERE id IS NULL').first('count')).toBe(2);
    expect(await rejection(() => db.prepare('INSERT INTO legacy_primary_fixture (id, natural_key) VALUES (?, ?)')
      .bind('existing', 'another').run())).toMatchObject({ kind: 'constraint', constraintSubtype: 'primary_key' });
    expect(await rejection(() => db.prepare('INSERT INTO legacy_primary_fixture (id, natural_key) VALUES (?, ?)')
      .bind('another', 'natural').run())).toMatchObject({ kind: 'constraint', constraintSubtype: 'unique' });
    await db.prepare(`COMMENT ON CONSTRAINT legacy_nullable_key ON legacy_primary_fixture IS 'ccc:sqlite-primary-key-unrecognized'`).run();
    expect(await rejection(() => db.prepare('INSERT INTO legacy_primary_fixture (id, natural_key) VALUES (?, ?)')
      .bind('existing', 'another').run())).toMatchObject({ kind: 'constraint', constraintSubtype: 'unique' });
  });

  it('preserves quoted placeholders and rejects arity without sending a mutation', async () => {
    const db = await openDatabase();
    await db.prepare('CREATE TABLE scanner_fixture ("question?column" TEXT, "question?""column" TEXT)').run();
    await db.prepare('INSERT INTO scanner_fixture ("question?column", "question?""column") VALUES (?, ?)')
      .bind('existing', 'existing-double').run();
    expect(await db.prepare(`SELECT 'it''s ?' AS literal, "question?""column" AS doubled_identifier,
      "question?column" AS identifier, CAST(? AS TEXT) AS value FROM scanner_fixture -- ?
      /* ? */`).bind('bound').first()).toEqual({
      literal: "it's ?", doubled_identifier: 'existing-double', identifier: 'existing', value: 'bound',
    });
    const insert = db.prepare('INSERT INTO scanner_fixture ("question?column") VALUES (?)');
    expect(await rejection(() => insert.run())).toMatchObject({ kind: 'bind_arity' });
    expect(await rejection(() => insert.bind('one', 'two').run())).toMatchObject({ kind: 'bind_arity' });
    expect(await db.prepare('SELECT COUNT(*) AS count FROM scanner_fixture').first('count')).toBe(1);
  });

  it('normalizes only the row or column returned by first', async () => {
    const db = await openDatabase();
    const rows = db.prepare('SELECT 1::bigint AS value UNION ALL SELECT 9007199254740993::bigint AS value');
    expect(await rows.first()).toEqual({ value: 1 });
    expect(await rows.first('value')).toBe(1);
    const columns = db.prepare('SELECT 1::bigint AS value, 9007199254740993::bigint AS unused');
    expect(await columns.first('value')).toBe(1);
    expect(await rejection(() => columns.first())).toMatchObject({ kind: 'unsupported' });
    expect(await rejection(() => rows.all())).toMatchObject({ kind: 'unsupported' });
  });

  it('round-trips safe bigint, real, NULL, ISO text and numeric aggregate/window results', async () => {
    const db = await openDatabase();
    await db.prepare('CREATE TABLE numeric_fixture (id TEXT PRIMARY KEY, ordinal BIGINT, group_key TEXT)').run();
    for (const [id, ordinal, group] of [
      ['n', null, 'g2'], ['b', 2, 'g1'], ['a', 1, 'g1'], ['c', 1, 'g2'],
    ] as const) {
      await db.prepare('INSERT INTO numeric_fixture (id, ordinal, group_key) VALUES (?, ?, ?)')
        .bind(id, ordinal, group).run();
    }
    expect((await db.prepare(`SELECT id, ROW_NUMBER() OVER (ORDER BY ordinal NULLS LAST, id) AS position
      FROM numeric_fixture ORDER BY ordinal NULLS LAST, id`).all()).results).toEqual([
      { id: 'a', position: 1 }, { id: 'c', position: 2 }, { id: 'b', position: 3 }, { id: 'n', position: 4 },
    ]);
    expect(await db.prepare(`SELECT COUNT(*) AS count, COUNT(DISTINCT group_key) AS groups,
      SUM(ordinal) AS total, MAX(ordinal) AS maximum, MIN(ordinal) AS minimum FROM numeric_fixture`).first())
      .toEqual({ count: 4, groups: 2, total: 4, maximum: 2, minimum: 1 });
    const iso = '2026-09-08T04:00:00.123Z';
    expect(await db.prepare(`SELECT CAST(? AS BIGINT) AS maximum, CAST(? AS BIGINT) AS minimum,
      CAST(? AS DOUBLE PRECISION) AS real, CAST(? AS TEXT) AS timestamp, CAST(? AS TEXT) AS nullable`)
      .bind(Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 1.25, iso, null).first()).toEqual({
      maximum: Number.MAX_SAFE_INTEGER, minimum: Number.MIN_SAFE_INTEGER, real: 1.25, timestamp: iso, nullable: null,
    });
    expect(await db.prepare('SELECT SUM(ordinal) AS total FROM numeric_fixture WHERE id = ?')
      .bind('absent').first('total')).toBeNull();
  });

  it('rejects unsafe bigint and SUM decoding instead of silently rounding', async () => {
    const db = await openDatabase();
    for (const sql of [
      'SELECT CAST(9007199254740992 AS BIGINT) AS value',
      'SELECT CAST(-9007199254740992 AS BIGINT) AS value',
      'SELECT SUM(value) AS value FROM (VALUES (CAST(9007199254740991 AS BIGINT)), (CAST(1 AS BIGINT))) AS source(value)',
    ]) {
      expect(await rejection(() => db.prepare(sql).first())).toMatchObject({ kind: 'unsupported' });
    }
    expect(await db.prepare('SELECT CAST(7 AS BIGINT) AS value').first('value')).toBe(7);
  });

  it('preserves RETURNING rows and batch order while run discards rows but counts changes', async () => {
    const db = await openDatabase();
    await db.prepare('CREATE TABLE returning_fixture (id BIGINT PRIMARY KEY, value TEXT)').run();
    const result = await db.batch([
      db.prepare('INSERT INTO returning_fixture (id, value) VALUES (?, ?) RETURNING id, value').bind(1, 'before'),
      db.prepare('UPDATE returning_fixture SET value = ? WHERE id = ? RETURNING id, value').bind('after', 1),
      db.prepare('SELECT id, value FROM returning_fixture ORDER BY id'),
    ]);
    expect(result.map((entry) => entry.results)).toEqual([
      [{ id: 1, value: 'before' }], [{ id: 1, value: 'after' }], [{ id: 1, value: 'after' }],
    ]);
    expect(result.slice(0, 2).map((entry) => entry.meta.changes)).toEqual([1, 1]);
    expect(await db.prepare('DELETE FROM returning_fixture WHERE id = ? RETURNING id').bind(1).run())
      .toMatchObject({ success: true, results: [], meta: { changes: 1 } });
    expect(await db.prepare('DELETE FROM returning_fixture WHERE id = ?').bind(1).run())
      .toMatchObject({ success: true, results: [], meta: { changes: 0 } });
    expect(await db.batch([])).toEqual([]);
  });

  it('commits a mutation and its matching audit together without auditing another marker', async () => {
    const db = await transactionFixture();
    const committed = await db.batch([
      ...mutationAndAudit(db, 'committed'),
      db.prepare(`INSERT INTO audit_fixture (marker)
        SELECT ? WHERE EXISTS (SELECT 1 FROM mutation_fixture WHERE marker = ?)`)
        .bind('wrong-audit', 'wrong-mutation'),
    ]);
    expect(committed.map((entry) => entry.meta.changes)).toEqual([1, 1, 0]);
    expect(await db.prepare('SELECT amount FROM mutation_fixture WHERE marker = ?')
      .bind('committed').first('amount')).toBe(7);
    expect((await db.prepare('SELECT marker FROM audit_fixture ORDER BY marker').all()).results)
      .toEqual([{ marker: 'committed' }]);
  });

  const failures = [
    { name: 'unique', subtype: 'unique', sql: "INSERT INTO mutation_fixture (id, marker, amount) VALUES (3, 'existing', 1)" },
    { name: 'custom-named primary key', subtype: 'primary_key', sql: "INSERT INTO mutation_fixture (id, marker, amount) VALUES (1, 'new-marker', 1)" },
    { name: 'foreign key', subtype: 'foreign_key', sql: "INSERT INTO mutation_fixture (id, marker, parent_id, amount) VALUES (3, 'fk', 999, 1)" },
    { name: 'check', subtype: 'check', sql: "INSERT INTO mutation_fixture (id, marker, amount) VALUES (3, 'check', -1)" },
    { name: 'not null', subtype: 'check', sql: "INSERT INTO mutation_fixture (id, marker, amount) VALUES (3, 'null', NULL)" },
    { name: 'unknown trigger', subtype: 'trigger', sql: "INSERT INTO rejection_fixture (code) VALUES ('synthetic-private-trigger-detail')" },
  ];
  for (const failure of failures) {
    it(`rolls back both mutation and audit on ${failure.name} failure`, async () => {
      const db = await transactionFixture();
      const error = await rejection(() => db.batch([
        ...mutationAndAudit(db, 'rolled-back'), db.prepare(failure.sql),
      ]));
      expect(error).toMatchObject({ kind: 'constraint', constraintSubtype: failure.subtype });
      expect(error.applicationCode).toBeUndefined();
      expect(inspect(error, { showHidden: true, depth: 8 })).not.toContain('synthetic-private-trigger-detail');
      await expectRolledBack(db, 'rolled-back');
    });
  }

  for (const code of ['stale_draft_version', 'invite_token_already_used', 'participant_schema_violation', 'counseling_memory_fence']) {
    it(`preserves ${code} while rolling back the whole transaction`, async () => {
      const db = await transactionFixture();
      expect(await rejection(() => db.batch([
        ...mutationAndAudit(db, 'trigger-rollback'),
        db.prepare('INSERT INTO rejection_fixture (code) VALUES (?)').bind(code),
      ]))).toMatchObject({ kind: 'constraint', constraintSubtype: 'trigger', applicationCode: code });
      await expectRolledBack(db, 'trigger-rollback');
    });
  }

  it('preserves the named memory check fence while rolling back mutation and audit', async () => {
    const db = await transactionFixture();
    await db.prepare(`CREATE TABLE counseling_memory_guards (
      id TEXT PRIMARY KEY, ok INTEGER NOT NULL CONSTRAINT counseling_memory_fence CHECK (ok = 1)
    )`).run();
    expect(await rejection(() => db.batch([
      ...mutationAndAudit(db, 'fence-rollback'),
      db.prepare('INSERT INTO counseling_memory_guards (id, ok) VALUES (?, ?)').bind('stale-work', 0),
    ]))).toMatchObject({
      kind: 'constraint', constraintSubtype: 'check', applicationCode: 'counseling_memory_fence',
    });
    await expectRolledBack(db, 'fence-rollback');
  });

  it('rolls back mutation and audit when decoding a later batch result fails', async () => {
    const db = await transactionFixture();
    expect(await rejection(() => db.batch([
      ...mutationAndAudit(db, 'unsafe-rollback'),
      db.prepare('SELECT CAST(9007199254740992 AS BIGINT) AS unsafe_value'),
    ]))).toMatchObject({ kind: 'unsupported' });
    await expectRolledBack(db, 'unsafe-rollback');
  });

  it('rolls back mutation and audit on a server-side SQL error', async () => {
    const db = await transactionFixture();
    expect(await rejection(() => db.batch([
      ...mutationAndAudit(db, 'syntax-rollback'),
      db.prepare('SELECT value FROM absent_contract_table'),
    ]))).toMatchObject({ kind: 'syntax' });
    await expectRolledBack(db, 'syntax-rollback');
  });

  it('isolates concurrent successful and rejected mutation/audit transactions', async () => {
    const db = await transactionFixture();
    await db.prepare('CREATE TABLE counter_fixture (id BIGINT PRIMARY KEY, version BIGINT NOT NULL)').run();
    await db.prepare('CREATE TABLE counter_audit (marker TEXT PRIMARY KEY, version BIGINT NOT NULL)').run();
    await db.prepare('INSERT INTO counter_fixture (id, version) VALUES (1, 0)').run();
    const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, index) => db.batch([
      db.prepare('UPDATE counter_fixture SET version = version + 1 WHERE id = 1 RETURNING version'),
      db.prepare('INSERT INTO counter_audit (marker, version) SELECT ?, version FROM counter_fixture WHERE id = 1 RETURNING version')
        .bind(`operation-${index}`),
      ...(index % 2 === 0 ? [db.prepare('INSERT INTO rejection_fixture (code) VALUES (?)').bind('stale_draft_version')] : []),
    ])));
    for (const [index, outcome] of outcomes.entries()) {
      if (index % 2 === 0) {
        expect(outcome.status).toBe('rejected');
        if (outcome.status === 'rejected') expect(outcome.reason).toMatchObject({ applicationCode: 'stale_draft_version' });
      } else {
        expect(outcome.status).toBe('fulfilled');
        if (outcome.status === 'fulfilled') {
          const [mutation, audit] = outcome.value;
          if (mutation === undefined || audit === undefined) throw new Error('missing committed transaction results');
          expect(mutation.results).toEqual(audit.results);
        }
      }
    }
    expect(await db.prepare('SELECT version FROM counter_fixture WHERE id = 1').first('version')).toBe(6);
    expect((await db.prepare('SELECT version FROM counter_audit ORDER BY version').all()).results)
      .toEqual([1, 2, 3, 4, 5, 6].map((version) => ({ version })));
    expect((await db.prepare('SELECT marker FROM counter_audit ORDER BY marker').all()).results)
      .toEqual(['operation-1', 'operation-11', 'operation-3', 'operation-5', 'operation-7', 'operation-9'].map((marker) => ({ marker })));
  });

  it('rejects a foreign statement before any batch statement can commit', async () => {
    const db = await transactionFixture();
    const other = await openDatabase();
    expect(await rejection(() => db.batch([
      ...mutationAndAudit(db, 'foreign-rollback'), other.prepare('SELECT 1 AS value'),
    ]))).toMatchObject({ kind: 'unsupported' });
    await expectRolledBack(db, 'foreign-rollback');
    expect(await other.prepare('SELECT CAST(1 AS BIGINT) AS value').first('value')).toBe(1);
  });

  it('rejects execution after closing its pool, including previously prepared statements', async () => {
    const db = await openDatabase();
    const prepared = db.prepare('SELECT CAST(? AS BIGINT) AS value').bind(7);
    expect(await prepared.first('value')).toBe(7);
    await db.close();
    expect(await rejection(() => prepared.first())).toMatchObject({ kind: 'unsupported' });
    expect(await rejection(() => db.batch([prepared]))).toMatchObject({ kind: 'unsupported' });
  });

  it('does not expose synthetic sensitive values or vendor detail on public errors', async () => {
    const db = await transactionFixture();
    const secret = 'synthetic-person-010-9999-1234-account-987654';
    await db.prepare('INSERT INTO mutation_fixture (id, marker, amount) VALUES (?, ?, ?)').bind(9, secret, 1).run();
    const error = await rejection(() => db.prepare('INSERT INTO mutation_fixture (id, marker, amount) VALUES (?, ?, ?)')
      .bind(10, secret, 1).run());
    expect(error).toMatchObject({ kind: 'constraint', constraintSubtype: 'unique' });
    const publicError = inspect(error, { showHidden: true, depth: 8 });
    for (const forbidden of [secret, 'mutation_fixture', 'Key (marker)', 'postgres://', 'duplicate key value']) {
      expect(publicError).not.toContain(forbidden);
    }
    expect(error).not.toHaveProperty('cause');
  });
});
