/**
 * E7-1b Local Single service entry point.
 * This file is the Electron main process entry or standalone Node service.
 * It reads DPAPI-protected records and starts the local runtime.
 */
import { resolve } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import type { SqliteMigration } from '@ccc/db-sqlite';
import { createProtectedRecordRepository } from '@ccc/secrets-dpapi/records';
import { createLocalSingleRuntime, type LocalSingleRuntime } from './runtime.js';

const MIGRATION_PATTERN = /^(\d{4})_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/;

async function loadMigrations(migrationsPath: string): Promise<SqliteMigration[]> {
  const entries = await readdir(migrationsPath);
  const migrations: SqliteMigration[] = [];

  for (const entry of entries.sort()) {
    if (!MIGRATION_PATTERN.test(entry)) continue;
    const sql = await readFile(resolve(migrationsPath, entry), 'utf-8');
    migrations.push({ name: entry, sql });
  }

  return migrations;
}

export interface LocalSingleStartupConfig {
  /** Root directory for all local data. */
  dataPath: string;
  /** Path to SQLite migrations directory. */
  migrationsPath: string;
  /** Windows interactive username. */
  interactiveUsername: string;
  /** Organization ID from install manifest. */
  orgId: string;
  /** Install manifest JSON string (signed). */
  installManifest: string;
  /** Install signing keys JSON string. */
  signingKeys: string;
  /** Generation number for DPAPI records. */
  generation: number;
  /** Expected SHA-256 hash of the generation records file. */
  recordsHash: string;
  /** Optional runtime settings. */
  settings?: Parameters<typeof createLocalSingleRuntime>[0]['settings'];
}

/**
 * Start the Local Single service.
 * Loads DPAPI-protected secrets, applies migrations, and starts the server.
 */
export async function startLocalSingle(config: LocalSingleStartupConfig): Promise<LocalSingleRuntime> {
  // Fail closed on non-Windows
  if (process.platform !== 'win32') {
    throw new Error('platform_unsupported');
  }

  // Load DPAPI-protected records
  const recordsPath = resolve(config.dataPath, 'secrets');
  const recordRepo = await createProtectedRecordRepository(recordsPath, 'local-single');
  const secretRecords = await recordRepo.read(config.generation, config.recordsHash);

  try {
    // Load migrations
    const migrations = await loadMigrations(config.migrationsPath);

    // Start runtime
    return await createLocalSingleRuntime({
      dataPath: config.dataPath,
      interactiveUsername: config.interactiveUsername,
      orgId: config.orgId,
      installManifest: config.installManifest,
      signingKeys: config.signingKeys,
      secretRecords,
      migrations,
      ...(config.settings !== undefined ? { settings: config.settings } : {}),
    });
  } finally {
    // Wipe loaded records
    for (const record of secretRecords) {
      record.blob.fill(0);
    }
  }
}

export { createLocalSingleRuntime, readEndpointRecord } from './runtime.js';
export { createLocalSingleIdentity, type LocalSingleIdentity } from './identity.js';
