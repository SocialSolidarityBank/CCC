import { app } from 'electron';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEncryptedSqlite } from '../dist/index.js';

const SENTINEL = 'CCC_ELECTRON_SQLITE_SENTINEL';
const MIGRATIONS = fileURLToPath(new URL('../../../migrations/sqlite/', import.meta.url));

async function smoke() {
  const evidencePath = process.env.SQLITE_EVIDENCE_PATH;
  if (!evidencePath) throw new Error('evidence path missing');
  const directory = mkdtempSync(join(tmpdir(), 'ccc-electron-sqlite-'));
  const filename = join(directory, 'ccc.db');
  const key = randomBytes(32);
  const wrongKey = randomBytes(32);
  let database;
  const evidence = {
    schemaVersion: 1,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron ?? null,
    napi: process.versions.napi ?? null,
    encryptedHeaderAbsent: false,
    plaintextSentinelAbsent: false,
    walInspected: false,
    shmInspected: false,
    wrongKeyRejected: false,
    reopenRead: false,
    migration0045: false,
    cleanup: false,
  };

  try {
    if (evidence.platform !== 'win32' || evidence.arch !== 'x64' || !evidence.electron?.startsWith('44.')) {
      throw new Error('runtime mismatch');
    }
    database = openEncryptedSqlite({ filename, key });
    database.applyMigrations(
      readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()
        .map((name) => ({ name, sql: readFileSync(join(MIGRATIONS, name), 'utf8') })),
    );
    evidence.migration0045 = await database.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_schema WHERE name IN ('auth_revocations', 'agent_installations')",
    ).first('count') === 2;
    await database.prepare('CREATE TABLE electron_probe (value TEXT NOT NULL)').run();
    await database.prepare('INSERT INTO electron_probe (value) VALUES (?)').bind(SENTINEL).run();
    const liveSidecars = readdirSync(directory).filter((name) => name === 'ccc.db-wal' || name === 'ccc.db-shm');
    evidence.walInspected = liveSidecars.includes('ccc.db-wal');
    evidence.shmInspected = liveSidecars.includes('ccc.db-shm');
    const liveBytes = Buffer.concat(liveSidecars.map((name) => readFileSync(join(directory, name))));
    const liveSentinelAbsent = !liveBytes.includes(Buffer.from(SENTINEL));
    database.close();
    database = undefined;

    const persisted = Buffer.concat(
      readdirSync(directory).filter((name) => name.startsWith('ccc.db')).map((name) => readFileSync(join(directory, name))),
    );
    evidence.encryptedHeaderAbsent = persisted.subarray(0, 16).toString('utf8') !== 'SQLite format 3\0';
    evidence.plaintextSentinelAbsent = liveSentinelAbsent && !persisted.includes(Buffer.from(SENTINEL));
    try {
      openEncryptedSqlite({ filename, key: wrongKey, fileMustExist: true });
    } catch (error) {
      evidence.wrongKeyRejected = error?.kind === 'unsupported';
    }
    database = openEncryptedSqlite({ filename, key, fileMustExist: true });
    evidence.reopenRead = await database.prepare('SELECT value FROM electron_probe').first('value') === SENTINEL;
    database.close();
    database = undefined;
  } finally {
    try { database?.close(); } catch { /* fixed failure output below */ }
    key.fill(0);
    wrongKey.fill(0);
    rmSync(directory, { recursive: true, force: true });
    evidence.cleanup = !readdirSync(tmpdir()).includes(directory.split(/[\\/]/).pop());
  }

  if (!evidence.encryptedHeaderAbsent || !evidence.plaintextSentinelAbsent || !evidence.walInspected
    || !evidence.shmInspected || !evidence.wrongKeyRejected || !evidence.reopenRead
    || !evidence.migration0045 || !evidence.cleanup) {
    throw new Error('evidence incomplete');
  }
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
}

app.whenReady().then(smoke).then(() => app.quit()).catch((error) => {
  console.error(`sqlite-windows-smoke-failed:${error?.kind ?? error?.name ?? 'Error'}`);
  app.exit(1);
});
