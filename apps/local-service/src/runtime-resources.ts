import { join } from 'node:path';
import { openEncryptedSqlite, type EncryptedSqliteDatabase } from '@ccc/db-sqlite';
import { createFileAudioStore } from '@ccc/audio-file';
import { createDpapiSecretStore, type DpapiRecord } from '@ccc/secrets-dpapi';
import { createNodeScheduler, type NodeScheduler, type SchedulerFailure } from '@ccc/scheduler-node';
import { createScheduledJobRunner } from '@ccc/core/scheduled-job-runner';
import { verifySignedInstallManifest, type InstallSigningKeys } from '@ccc/contracts/install-manifest';
import type { DeploymentMode, VersionedSecretBytes, SignedInstallManifest } from '@ccc/contracts/runtime';
import type { ApiEnv } from '@ccc/http-api/identity';

export interface LocalRuntimeConfig {
  dataPath: string;
  orgId: string;
  installationId: string;
  minSequence: number;
  installManifest: string;
  signingKeys: InstallSigningKeys;
  secretRecords: readonly DpapiRecord[];
  settings?: Partial<Pick<ApiEnv, 'CCC_STT_MODE' | 'CCC_LLM_MODE' | 'TEXT_AI_PILOT_ENABLED' | 'EXTERNAL_AI_CALLS_ENABLED' | 'PUBLIC_SIGNUP_ENABLED' | 'PII_PURGE_ENABLED' | 'PII_KEY_VERSION'>>;
  onSchedulerError?: (failure: SchedulerFailure) => void;
}

export interface LocalRuntimeResources {
  baseEnv: ApiEnv;
  close(): Promise<void>;
}

export async function verifyLocalInstallation(config: Pick<LocalRuntimeConfig, 'installationId' | 'minSequence' | 'installManifest' | 'signingKeys'>, mode: DeploymentMode): Promise<SignedInstallManifest> {
  if (!config.installationId || !Number.isSafeInteger(config.minSequence) || config.minSequence < 1) throw new Error('installation_invalid');
  const manifest = await verifySignedInstallManifest(JSON.parse(config.installManifest), {
    ...config.signingKeys, now: new Date(), expectedInstallationId: config.installationId, minSequence: config.minSequence,
  });
  if (manifest.mode !== mode || (mode === 'local-single' && manifest.host !== '127.0.0.1')) throw new Error('installation_invalid');
  return manifest;
}

/** Only called after install/bind/TLS verification. It never provisions an empty replacement database. */
export async function openLocalResources(config: LocalRuntimeConfig, manifest: SignedInstallManifest): Promise<LocalRuntimeResources> {
  if (manifest.mode !== 'local-single' && manifest.mode !== 'local-office') throw new Error('installation_invalid');
  const store = createDpapiSecretStore(manifest.mode, config.secretRecords);
  let dbKey: VersionedSecretBytes | null = null, fileKey: VersionedSecretBytes | null = null, piiKey: VersionedSecretBytes | null = null;
  let database: EncryptedSqliteDatabase | undefined, scheduler: NodeScheduler | undefined;
  try {
    dbKey = await store.getBytesWithVersion('DB_MASTER_KEY');
    fileKey = await store.getBytesWithVersion('FILE_ENC_KEY');
    piiKey = await store.getBytesWithVersion('PII_ENC_KEY');
    if (dbKey === null || fileKey === null || piiKey === null) throw new Error('secret_access_denied');
    database = openEncryptedSqlite({ filename: join(config.dataPath, 'database.sqlite'), key: dbKey.bytes, fileMustExist: true });
    const audioStore = await createFileAudioStore(join(config.dataPath, 'audio'), fileKey);
    const retainedPiiKey = piiKey;
    const baseEnv: ApiEnv = {
      ...config.settings, installationMode: manifest.mode, DB: database, audioStore,
      CCC_INSTALL_MANIFEST: config.installManifest,
      CCC_INSTALL_SIGNING_KEYS: JSON.stringify(config.signingKeys.publicKeys),
      PII_KEY_VERSION: String(piiKey.version),
      secretStore: {
        async get() { return null; },
        async getBytesWithVersion() { return { bytes: new Uint8Array(retainedPiiKey.bytes), version: retainedPiiKey.version }; },
      },
    };
    scheduler = createNodeScheduler(createScheduledJobRunner({ ...baseEnv, audioStore }), config.onSchedulerError ?? (() => {}));
    await scheduler.schedule('pipeline_watchdog', '*/5 * * * *');
    await scheduler.schedule('pii_retention', '0 2 * * *');
    await scheduler.schedule('audio_expiry', '*/30 * * * *');
    return {
      baseEnv,
      async close() {
        try { await scheduler?.close(); }
        finally { database?.close(); retainedPiiKey.bytes.fill(0); store.close(); }
      },
    };
  } catch (error) {
    try { await scheduler?.close(); } finally { database?.close(); piiKey?.bytes.fill(0); store.close(); }
    throw error;
  } finally { dbKey?.bytes.fill(0); fileKey?.bytes.fill(0); }
}
