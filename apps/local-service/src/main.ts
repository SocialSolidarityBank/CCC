import { resolve, join } from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import type { SqliteMigration } from '@ccc/db-sqlite';
import { createProtectedRecordRepository } from '@ccc/secrets-dpapi/records';
import { createLocalIdentityRepository, type SingleInstallData } from '@ccc/secrets-dpapi';
import { createLocalSingleRuntime, type LocalSingleRuntime, type LocalSingleRuntimeConfig } from './runtime.ts';
import { createLocalOfficeRuntime, type LocalOfficeRuntime, type LocalOfficeRuntimeConfig } from './office-runtime.ts';
import { verifyLocalInstallation } from './runtime-resources.ts';
import { generateStableUserId } from './identity.ts';
import { hashPassword } from './office-identity.ts';

const MIGRATION_PATTERN = /^\d{4}_[A-Za-z0-9][A-Za-z0-9_-]*\.sql$/;
export async function loadLocalMigrations(migrationsPath: string): Promise<SqliteMigration[]> {
  const entries = await readdir(migrationsPath);
  const migrations: SqliteMigration[] = [];
  for (const entry of entries.sort()) {
    if (MIGRATION_PATTERN.test(entry)) migrations.push({ name: entry, sql: await readFile(resolve(migrationsPath, entry), 'utf8') });
  }
  return migrations;
}
interface StartupRecords {
  generation: number;
  recordsHash: string;
}
export interface LocalSingleStartupConfig extends Omit<LocalSingleRuntimeConfig, 'secretRecords'>, StartupRecords {}
export interface LocalOfficeStartupConfig extends Omit<LocalOfficeRuntimeConfig, 'secretRecords'>, StartupRecords {}

/** First-install primitive, never called from startup or recovery. The caller provisions this returned UUID in users. */
export async function stageNewSingleIdentity(
  config: Pick<LocalSingleStartupConfig, 'dataPath' | 'orgId' | 'installationId' | 'minSequence' | 'installManifest' | 'signingKeys' | 'generation'>,
  password: Uint8Array,
): Promise<{ stableUserId: string; identityHash: string }> {
  let handshakeKey: Uint8Array | undefined;
  try {
    if (process.platform !== 'win32') throw new Error('platform_unsupported');
    const manifest = await verifyLocalInstallation(config, 'local-single');
    const verifier = await hashPassword(password);
    handshakeKey = new Uint8Array(randomBytes(32));
    const data: SingleInstallData = {
      schemaVersion: 1, installationId: manifest.installationId, sequence: manifest.sequence,
      orgId: config.orgId, stableUserId: generateStableUserId(), passwordHash: verifier.hash, salt: verifier.salt, handshakeKey,
    };
    const repository = await createLocalIdentityRepository(join(config.dataPath, 'identity'));
    return await repository.stageSingle(config.generation, data);
  } finally { password.fill(0); handshakeKey?.fill(0); }
}

export async function startLocalSingle(config: LocalSingleStartupConfig): Promise<LocalSingleRuntime> {
  if (process.platform !== 'win32') throw new Error('platform_unsupported');
  await verifyLocalInstallation(config, 'local-single');
  const repository = await createProtectedRecordRepository(resolve(config.dataPath, 'secrets'), 'local-single');
  const secretRecords = await repository.read(config.generation, config.recordsHash);
  try {
    return await createLocalSingleRuntime({ ...config, secretRecords });
  } finally { for (const record of secretRecords) record.blob.fill(0); }
}

export async function startLocalOffice(config: LocalOfficeStartupConfig): Promise<LocalOfficeRuntime> {
  if (process.platform !== 'win32') throw new Error('platform_unsupported');
  await verifyLocalInstallation(config, 'local-office');
  const repository = await createProtectedRecordRepository(resolve(config.dataPath, 'secrets'), 'local-office');
  const secretRecords = await repository.read(config.generation, config.recordsHash);
  try {
    return await createLocalOfficeRuntime({ ...config, secretRecords });
  } finally { for (const record of secretRecords) record.blob.fill(0); }
}
