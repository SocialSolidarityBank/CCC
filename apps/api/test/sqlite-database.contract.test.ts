import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  openEncryptedSqlite,
  type EncryptedSqliteDatabase,
  type SqliteMigration,
} from '@ccc/db-sqlite';
import { defineDatabaseContract } from './support/database-contract';
import { SQLITE_MIGRATIONS_PATH } from './support/d1';

const openDatabases: EncryptedSqliteDatabase[] = [];
const tempDirectories: string[] = [];

function tempDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'ccc-encrypted-sqlite-'));
  tempDirectories.push(directory);
  return { directory, filename: join(directory, 'ccc.db'), key: new Uint8Array(randomBytes(32)) };
}

function open(options: Parameters<typeof openEncryptedSqlite>[0]): EncryptedSqliteDatabase {
  const database = openEncryptedSqlite(options);
  openDatabases.push(database);
  return database;
}

function migrations(): SqliteMigration[] {
  return readdirSync(SQLITE_MIGRATIONS_PATH)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(SQLITE_MIGRATIONS_PATH, name), 'utf8') }));
}

afterEach(() => {
  for (const database of openDatabases.splice(0)) database.close();
  for (const directory of tempDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

defineDatabaseContract('encrypted SQLite', async () => {
  const { filename, key } = tempDatabase();
  return open({ filename, key });
});

describe('encrypted SQLite file lifecycle', () => {
  it('applies the exact migration set, hides plaintext, rejects a wrong key, and reopens with the right key', async () => {
    const { directory, filename, key } = tempDatabase();
    const callerKey = new Uint8Array(key);
    const database = open({ filename, key });
    expect(key).toEqual(callerKey);
    database.applyMigrations(migrations());
    await database.prepare('CREATE TABLE local_adapter_probe (value TEXT NOT NULL)').run();
    await database.prepare('INSERT INTO local_adapter_probe (value) VALUES (?)').bind('CCC_SQLITE_PLAINTEXT_SENTINEL').run();
    await expect(database.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name IN ('auth_revocations', 'agent_installations')").first('count'))
      .resolves.toBe(2);
    const liveSidecars = readdirSync(directory).filter((name) => name === 'ccc.db-wal' || name === 'ccc.db-shm');
    expect(liveSidecars).toEqual(expect.arrayContaining(['ccc.db-wal', 'ccc.db-shm']));
    for (const name of liveSidecars) {
      const sidecar = readFileSync(join(directory, name));
      expect(sidecar.includes(Buffer.from('CCC_SQLITE_PLAINTEXT_SENTINEL'))).toBe(false);
    }
    database.close();

    const persisted = readdirSync(directory)
      .filter((name) => name.startsWith('ccc.db'))
      .flatMap((name) => [...readFileSync(join(directory, name))]);
    const bytes = Buffer.from(persisted);
    expect(bytes.subarray(0, 16).toString('utf8')).not.toBe('SQLite format 3\0');
    expect(bytes.includes(Buffer.from('CCC_SQLITE_PLAINTEXT_SENTINEL'))).toBe(false);

    expect(() => openEncryptedSqlite({ filename, key: new Uint8Array(randomBytes(32)), fileMustExist: true }))
      .toThrowError(expect.objectContaining({ kind: 'unsupported' }));
    const reopened = open({ filename, key: callerKey, fileMustExist: true });
    await expect(reopened.prepare('SELECT value FROM local_adapter_probe').first('value'))
      .resolves.toBe('CCC_SQLITE_PLAINTEXT_SENTINEL');
  });

  it('rejects missing durability or encryption inputs instead of opening plaintext', () => {
    const { filename } = tempDatabase();
    expect(() => openEncryptedSqlite({ filename: '', key: new Uint8Array(32) })).toThrow();
    expect(() => openEncryptedSqlite({ filename: '   ', key: new Uint8Array(32) })).toThrow();
    expect(() => openEncryptedSqlite({ filename: ':memory:', key: new Uint8Array(32) })).toThrow();
    expect(() => openEncryptedSqlite({ filename, key: new Uint8Array(0) })).toThrow();
    expect(() => openEncryptedSqlite({ filename, key: new Uint8Array(31) })).toThrow();
    expect(() => openEncryptedSqlite({ filename, key: new Uint8Array(33) })).toThrow();
  });

  it('rejects out-of-order or duplicate migration identities before mutation', async () => {
    const { filename, key } = tempDatabase();
    const database = open({ filename, key });
    expect(() => database.applyMigrations([
      { name: '0002_second.sql', sql: 'CREATE TABLE second (id INTEGER);' },
      { name: '0001_first.sql', sql: 'CREATE TABLE first (id INTEGER);' },
    ])).toThrow();
    expect(() => database.applyMigrations([
      { name: '0001_first.sql', sql: 'CREATE TABLE first (id INTEGER);' },
      { name: '0001_first.sql', sql: 'CREATE TABLE duplicate (id INTEGER);' },
    ])).toThrow();
    await expect(database.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE type = 'table' AND name IN ('first', 'second', 'duplicate')").first('count'))
      .resolves.toBe(0);
  });

  it('rejects unsafe integers and statements owned by another adapter', async () => {
    const first = tempDatabase();
    const second = tempDatabase();
    const database = open({ filename: first.filename, key: first.key });
    const other = open({ filename: second.filename, key: second.key });
    await expect(database.prepare('SELECT 9007199254740992 AS value').first('value'))
      .rejects.toMatchObject({ kind: 'unsupported' });
    await expect(database.prepare('SELECT ? AS value').bind(Number.MAX_SAFE_INTEGER + 1).first('value'))
      .rejects.toMatchObject({ kind: 'unsupported' });
    await expect(database.batch([other.prepare('CREATE TABLE wrong_owner (id INTEGER)')]))
      .rejects.toMatchObject({ kind: 'unsupported' });
  });
});
