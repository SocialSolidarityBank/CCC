import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { createPostgresDatabase, type PostgresDatabase } from '@ccc/db-postgres';

const execFileAsync = promisify(execFile);
const IMAGE = 'postgres@sha256:18cfe3ef5e6815560c98237d6216d1e5119702fb0f3894c8785dd58b8bbe5d73';

async function docker(args: string[], env?: NodeJS.ProcessEnv, timeout = 120_000): Promise<string> {
  try {
    const { stdout } = await execFileAsync('docker', args, {
      encoding: 'utf8', timeout, maxBuffer: 1024 * 1024, env,
    });
    return stdout.trim();
  } catch {
    // execFile errors include arguments and vendor output. Never forward them.
    throw new Error('Disposable PostgreSQL Docker command failed; Docker must be available.');
  }
}

export interface PostgresHarness {
  openDatabase(): Promise<PostgresDatabase>;
  /** Contract-only trusted DDL. Never accepts an external connection or runtime bindings. */
  applyMigration(database: PostgresDatabase, sql: string): Promise<void>;
  closeDatabases(): Promise<void>;
  dispose(): Promise<void>;
}

/** No caller-supplied URL: every database lives in this invocation's container. */
export async function startPostgresHarness(): Promise<PostgresHarness> {
  const name = `ccc-pg-contract-${randomUUID()}`;
  const password = randomBytes(32).toString('hex');
  let containerId: string | undefined;
  let admin: PostgresDatabase | undefined;
  const databases = new Set<PostgresDatabase>();
  const databaseNames = new Map<PostgresDatabase, string>();
  let disposed = false;

  async function closeDatabases(): Promise<void> {
    const results = await Promise.allSettled([...databases].map((db) => db.close()));
    databases.clear();
    databaseNames.clear();
    if (results.some((result) => result.status === 'rejected')) {
      throw new Error('Disposable PostgreSQL pool cleanup failed.');
    }
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    try {
      await closeDatabases();
    } finally {
      try {
        await admin?.close();
      } finally {
        // Use only the ID returned by our successful create, never a name lookup.
        if (containerId) await docker(['rm', '--force', '--volumes', containerId]);
      }
    }
  }

  try {
    containerId = await docker([
      'create', '--name', name, '--publish', '127.0.0.1::5432',
      '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_USER=ccc_contract',
      '--env', 'POSTGRES_DB=ccc_contract', IMAGE,
    ], { ...process.env, POSTGRES_PASSWORD: password });
    await docker(['start', containerId]);
    const mapping = await docker(['port', containerId, '5432/tcp']);
    const match = /^127\.0\.0\.1:(\d+)$/.exec(mapping);
    if (!match) throw new Error('Disposable PostgreSQL did not bind an isolated loopback port.');

    const deadline = Date.now() + 60_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        await docker(
          ['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', 'ccc_contract', '-d', 'ccc_contract', '-t', '1'],
          undefined, Math.min(2_000, Math.max(1, deadline - Date.now())),
        );
        ready = true;
        break;
      } catch {
        await delay(100);
      }
    }
    if (!ready) throw new Error('Disposable PostgreSQL readiness timed out; contracts are unavailable, not passed.');
    const origin = `postgres://ccc_contract:${password}@127.0.0.1:${match[1]}`;
    admin = createPostgresDatabase({ connectionString: `${origin}/ccc_contract`, ssl: false, maxConnections: 1 });

    async function openDatabase(): Promise<PostgresDatabase> {
      if (disposed || !admin) throw new Error('Disposable PostgreSQL harness is closed.');
      const databaseName = `contract_${randomBytes(12).toString('hex')}`;
      // Generated identifiers only; fixture provisioning, not runtime SQL translation.
      await admin.prepare(`CREATE DATABASE ${databaseName}`).run();
      const database = createPostgresDatabase({
        connectionString: `${origin}/${databaseName}`, ssl: false, maxConnections: 4,
      });
      databases.add(database);
      databaseNames.set(database, databaseName);
      return database;
    }

    async function applyMigration(database: PostgresDatabase, sql: string): Promise<void> {
      const databaseName = databaseNames.get(database);
      if (disposed || !containerId || !databaseName || !sql.trim()) {
        throw new Error('Trusted migration requires an open database owned by this harness.');
      }
      // psql's parser handles function bodies and complete migration scripts. Do not
      // split on semicolons or widen the runtime adapter's single-statement protocol.
      await new Promise<void>((resolve, reject) => {
        const child = spawn('docker', [
          'exec', '-i', containerId!, 'psql', '-X', '--no-password',
          '--set=ON_ERROR_STOP=1', '--set=VERBOSITY=sqlstate', '--single-transaction', '--quiet',
          '-U', 'ccc_contract', '-d', databaseName, '-f', '-',
        ], { stdio: ['pipe', 'ignore', 'pipe'] });
        let diagnostics = '';
        child.stderr.on('data', (chunk: Buffer) => {
          diagnostics = (diagnostics + chunk.toString('utf8')).slice(-2_048);
        });
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Disposable PostgreSQL trusted migration timed out.'));
        }, 120_000);
        child.once('error', () => {
          clearTimeout(timer);
          reject(new Error('Disposable PostgreSQL trusted migration could not start.'));
        });
        child.once('close', (code) => {
          clearTimeout(timer);
          if (code === 0) resolve();
          else {
            const position = /<stdin>:(\d+):\s+ERROR:\s+([0-9A-Z]{5})\b/.exec(diagnostics);
            const location = position ? ` at line ${position[1]} (SQLSTATE ${position[2]})` : '';
            reject(new Error(`Disposable PostgreSQL trusted migration failed${location}.`));
          }
        });
        child.stdin.on('error', () => {
          // EPIPE is reported by close; neither SQL nor provider stderr is reflected.
        });
        child.stdin.end(sql);
      });
    }

    return { openDatabase, applyMigration, closeDatabases, dispose };
  } catch {
    await dispose();
    throw new Error('Disposable PostgreSQL startup failed; ensure Docker and the pinned image are available.');
  }
}
