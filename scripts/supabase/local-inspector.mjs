import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  boolean,
  DATABASE_STATE_QUERY,
  dataFingerprintQuery,
  fingerprint,
  fingerprintPublicData,
  LEDGER_QUERY,
  normalizeDatabaseSnapshot,
  publicDataTableNames,
} from './hosted-inspector.mjs';
import { PlanFailure } from './plan.mjs';

const execFileAsync = promisify(execFile);

function parseStatus(output) {
  if (output !== null && typeof output === 'object') return output;
  const text = String(output ?? '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) throw new PlanFailure('LOCAL_SUPABASE_UNAVAILABLE');
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new PlanFailure('LOCAL_SUPABASE_UNAVAILABLE');
  }
}

async function defaultRunStatus(workdir) {
  try {
    const { stdout } = await execFileAsync('supabase', ['status', '--output', 'json'], {
      cwd: workdir,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    return parseStatus(stdout);
  } catch {
    throw new PlanFailure('LOCAL_SUPABASE_UNAVAILABLE');
  }
}

async function defaultInspectDatabase(databaseUrl) {
  let sql;
  try {
    const postgres = (await import('postgres')).default;
    sql = postgres(databaseUrl, {
      max: 1,
      connect_timeout: 10,
      idle_timeout: 1,
      onnotice: () => {},
    });
    return await sql.begin('read only', async (transaction) => {
      const rows = await transaction.unsafe(DATABASE_STATE_QUERY);
      const database = rows[0];
      if (database === undefined) throw new PlanFailure('LOCAL_SUPABASE_UNAVAILABLE');
      const migration = boolean(database.ledger_exists)
        ? (await transaction.unsafe(LEDGER_QUERY))[0] ?? null
        : null;
      const dataEntries = [];
      for (const tableName of publicDataTableNames(database)) {
        const row = (await transaction.unsafe(dataFingerprintQuery(tableName)))[0];
        if (row === undefined) throw new PlanFailure('LOCAL_SUPABASE_UNAVAILABLE');
        dataEntries.push({ tableName, row });
      }
      return { database, migration, institutionDataFingerprint: fingerprintPublicData(dataEntries) };
    });
  } catch (error) {
    if (error instanceof PlanFailure) throw error;
    throw new PlanFailure('LOCAL_SUPABASE_UNAVAILABLE');
  } finally {
    if (sql !== undefined) await sql.end({ timeout: 1 }).catch(() => {});
  }
}

function parseRelevantAuthConfig(content) {
  const values = new Map();
  let section = '';
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, '').trim();
    if (line === '') continue;
    const sectionMatch = /^\[([A-Za-z0-9_.-]+)\]$/u.exec(line);
    if (sectionMatch !== null) {
      section = sectionMatch[1];
      continue;
    }
    const valueMatch = /^([A-Za-z0-9_]+)\s*=\s*(true|false)$/u.exec(line);
    if (valueMatch !== null) values.set(`${section}.${valueMatch[1]}`, valueMatch[2] === 'true');
  }
  const auth = {
    emailEnabled: values.get('auth.email.enable_signup') === true,
    openSignupDisabled: values.get('auth.enable_signup') === false,
    totpEnabled: values.get('auth.mfa.totp.enroll_enabled') === true
      && values.get('auth.mfa.totp.verify_enabled') === true,
    refreshTokenRotationEnabled: values.get('auth.enable_refresh_token_rotation') === true,
  };
  return auth;
}

export function createLocalInspector({
  workdir,
  runStatus = defaultRunStatus,
  inspectDatabase = defaultInspectDatabase,
}) {
  return {
    async inspect() {
      try {
        const [status, authContent] = await Promise.all([
          runStatus(workdir),
          readFile(join(workdir, 'supabase', 'config.toml'), 'utf8'),
        ]);
        const parsedStatus = parseStatus(status);
        const databaseUrl = parsedStatus.DB_URL ?? parsedStatus.db_url;
        if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
          throw new PlanFailure('LOCAL_SUPABASE_UNAVAILABLE');
        }
        const { database, migration, institutionDataFingerprint } = await inspectDatabase(databaseUrl);
        const auth = parseRelevantAuthConfig(authContent);
        const normalized = normalizeDatabaseSnapshot({
          database,
          migration,
          auth,
          authFingerprint: fingerprint(authContent),
          institutionDataFingerprint,
        });
        return {
          project: {
            region: null,
            databaseVersion: typeof database.database_version === 'string' && /^[0-9.]+$/u.test(database.database_version)
              ? database.database_version
              : null,
            status: 'LOCAL',
          },
          ...normalized,
        };
      } catch (error) {
        if (error instanceof PlanFailure) throw new PlanFailure(error.code);
        throw new PlanFailure('LOCAL_SUPABASE_UNAVAILABLE');
      }
    },
  };
}
