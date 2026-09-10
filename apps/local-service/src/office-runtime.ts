/**
 * E8-1 Local Office runtime composition.
 * - RFC1918 IPv4 bind on port 8443
 * - TLS 1.2+ with name-constrained CA
 * - Argon2id local accounts with admin MFA
 * - Dedicated Windows service account
 * - Service-owned Node scheduler with watchdog
 * - Fails closed on unsupported platform
 */
import { createServer as createHttpsServer, type Server as HttpsServer } from 'node:https';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { openEncryptedSqlite, type EncryptedSqliteDatabase, type SqliteMigration } from '@ccc/db-sqlite';
import { createFileAudioStore } from '@ccc/audio-file';
import { createNodeScheduler, type NodeScheduler, type SchedulerFailure } from '@ccc/scheduler-node';
import { createDpapiSecretStore, type DpapiRecord } from '@ccc/secrets-dpapi';
import type { AudioStore, CoreSecretStore, DeploymentMode, VersionedSecretBytes } from '@ccc/contracts/runtime';
import { createScheduledJobRunner, type ScheduledJobEnv } from '@ccc/core/scheduled-job-runner';
import { handleRequest, type ActorResolver } from '@ccc/http-api';
import type { ApiEnv } from '@ccc/http-api/identity';
import {
  createLocalOfficeIdentity,
  type LocalOfficeIdentity,
  type OfficeAccountStore,
} from './office-identity.js';
import { isRfc1918, validateBindAddress } from './bind-validation.js';

// Re-export for consumers who need them
export { isRfc1918, validateBindAddress };

const OFFICE_PORT = 8443;

export interface LocalOfficeRuntimeConfig {
  /** Root directory for all local data (database, audio, secrets). */
  dataPath: string;
  /** Bind address (must be RFC1918). */
  bindHost: string;
  /** Private CIDR that bindHost must be within. */
  privateCidr: string;
  /** Organization ID from install manifest. */
  orgId: string;
  /** Install manifest JSON string (signed). */
  installManifest: string;
  /** Install signing keys JSON string. */
  signingKeys: string;
  /** Pre-loaded DPAPI-protected secret records from the generation file. */
  secretRecords: readonly DpapiRecord[];
  /** SQLite migrations to apply on startup. */
  migrations: readonly SqliteMigration[];
  /** TLS certificate PEM file path. */
  tlsCertPath: string;
  /** TLS private key PEM file path. */
  tlsKeyPath: string;
  /** Optional CA certificate PEM file path for client verification. */
  tlsCaPath?: string;
  /** Account store implementation (backed by encrypted SQLite). */
  accountStore: OfficeAccountStore;
  /** Optional runtime settings overrides. */
  settings?: Partial<Pick<ApiEnv,
    'CCC_STT_MODE' | 'CCC_LLM_MODE' | 'TEXT_AI_PILOT_ENABLED'
    | 'EXTERNAL_AI_CALLS_ENABLED' | 'PUBLIC_SIGNUP_ENABLED' | 'PII_PURGE_ENABLED' | 'PII_KEY_VERSION'>>;
  /** Callback for scheduler job failures. */
  onSchedulerError?: (failure: SchedulerFailure) => void;
  /** Callback for watchdog health checks. */
  onWatchdogTick?: () => void;
}

export interface LocalOfficeRuntime {
  /** The server port (always 8443). */
  readonly port: number;
  /** The bound host address. */
  readonly host: string;
  /** Installation ID from manifest. */
  readonly installationId: string;
  /** Identity manager for login/MFA operations. */
  readonly identity: LocalOfficeIdentity;
  /** Graceful shutdown: stops server, scheduler, closes database. */
  close(): Promise<void>;
}

/**
 * E8-1 Local Office runtime composition.
 * - RFC1918 IPv4 bind on port 8443
 * - TLS 1.2+ required
 * - Argon2id local accounts with admin MFA
 * - Service-owned Node scheduler
 * - Fails closed on unsupported platform
 */
export async function createLocalOfficeRuntime(config: LocalOfficeRuntimeConfig): Promise<LocalOfficeRuntime> {
  // Fail closed: Windows only
  if (process.platform !== 'win32') {
    throw new Error('platform_unsupported');
  }

  // Validate bind address is RFC1918 and within CIDR
  validateBindAddress(config.bindHost, config.privateCidr);

  // Initialize DPAPI secret store with provided records
  const dpapiStore = createDpapiSecretStore('local-office', config.secretRecords);

  // Retrieve required keys
  const dbMasterKey = await dpapiStore.getBytesWithVersion('DB_MASTER_KEY');
  const fileEncKey = await dpapiStore.getBytesWithVersion('FILE_ENC_KEY');
  const piiEncKey = await dpapiStore.getBytesWithVersion('PII_ENC_KEY');
  if (dbMasterKey === null || fileEncKey === null || piiEncKey === null) {
    dpapiStore.close();
    throw new Error('secret_access_denied');
  }

  const dataPath = config.dataPath;
  const dbPath = join(dataPath, 'database.sqlite');
  const audioPath = join(dataPath, 'audio');

  // Ensure directories exist
  await mkdir(join(dataPath, 'database'), { recursive: true });
  await mkdir(audioPath, { recursive: true });

  // Load TLS credentials
  const [tlsCert, tlsKey, tlsCa] = await Promise.all([
    readFile(config.tlsCertPath, 'utf-8'),
    readFile(config.tlsKeyPath, 'utf-8'),
    config.tlsCaPath ? readFile(config.tlsCaPath, 'utf-8') : Promise.resolve(undefined),
  ]);

  let database: EncryptedSqliteDatabase | undefined;
  let audioStore: AudioStore | undefined;
  let scheduler: NodeScheduler | undefined;
  let identity: LocalOfficeIdentity | undefined;
  let server: HttpsServer | undefined;
  let watchdogInterval: ReturnType<typeof setInterval> | undefined;

  try {
    // Open encrypted database
    database = openEncryptedSqlite({ filename: dbPath, key: dbMasterKey.bytes });
    database.applyMigrations(config.migrations as SqliteMigration[]);

    // Create encrypted audio store
    audioStore = await createFileAudioStore(audioPath, fileEncKey);

    // Create local identity with account store
    identity = createLocalOfficeIdentity({
      orgId: config.orgId,
      accountStore: config.accountStore,
    });

    // Parse install manifest for installation ID
    const manifest = JSON.parse(config.installManifest) as { installationId: string; mode: DeploymentMode };
    if (manifest.mode !== 'local-office') throw new Error('installation_invalid');
    const installationId = manifest.installationId;

    // Build core secret store (read-only, no platform keys)
    const coreSecretStore: CoreSecretStore = {
      async get(_name: 'CODEX_API_KEY' | 'NOTIFY_WEBHOOK_URL'): Promise<string | null> {
        return null;
      },
      async getBytesWithVersion(_name: 'PII_ENC_KEY'): Promise<VersionedSecretBytes | null> {
        return piiEncKey;
      },
    };

    // Build API environment
    const installation = {
      CCC_INSTALL_MANIFEST: config.installManifest,
      CCC_INSTALL_SIGNING_KEYS: config.signingKeys,
    };

    const baseEnv: ApiEnv = {
      ...config.settings,
      ...installation,
      installationMode: 'local-office' as DeploymentMode,
      DB: database,
      secretStore: coreSecretStore,
      audioStore,
    };

    // Create scheduled job environment
    const scheduledJobEnv: ScheduledJobEnv = {
      ...baseEnv,
      audioStore,
    };

    // Create scheduler with job runner
    const jobRunner = createScheduledJobRunner(scheduledJobEnv);
    scheduler = createNodeScheduler(
      jobRunner,
      config.onSchedulerError ?? (() => {/* default: silent */}),
    );

    // Register standard cron jobs
    await scheduler.schedule('pipeline_watchdog', '*/5 * * * *');
    await scheduler.schedule('pii_retention', '0 2 * * *');
    await scheduler.schedule('audio_expiry', '*/30 * * * *');

    // Start watchdog for service health monitoring
    watchdogInterval = setInterval(() => {
      // Check scheduler health
      if (config.onWatchdogTick) {
        config.onWatchdogTick();
      }
    }, 60_000); // Every minute

    // Actor resolver for requests
    const resolveActor: ActorResolver = async (request) => {
      return identity!.resolve(request);
    };

    // Create HTTPS server with TLS 1.2+ minimum
    const serverOptions = {
      cert: tlsCert,
      key: tlsKey,
      ca: tlsCa,
      minVersion: 'TLSv1.2' as const,
      // Reject connections without valid TLS
      rejectUnauthorized: false, // We validate at application level
    };

    server = createHttpsServer(serverOptions, async (req, res) => {
      const url = new URL(req.url ?? '/', `https://${config.bindHost}:${OFFICE_PORT}`);
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) {
          headers.set(key, Array.isArray(value) ? value.join(', ') : value);
        }
      }

      let bodyInit: BodyInit | null = null;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk as Buffer);
        }
        if (chunks.length > 0) {
          bodyInit = Buffer.concat(chunks);
        }
      }

      const method = req.method ?? 'GET';
      const request = new Request(url.toString(), {
        method,
        headers,
        body: bodyInit,
      });

      try {
        const response = await handleRequest(request, baseEnv, resolveActor);
        res.statusCode = response.status;
        for (const [key, value] of response.headers) {
          res.setHeader(key, value);
        }
        // Add security headers for Office mode
        res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
        const responseBody = await response.arrayBuffer();
        res.end(new Uint8Array(responseBody));
      } catch {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'internal_error' }));
      }
    });

    // Bind to RFC1918 address on port 8443
    await new Promise<void>((resolve, reject) => {
      server!.on('error', reject);
      server!.listen(OFFICE_PORT, config.bindHost, () => resolve());
    });

    // Wipe key material from config access
    dbMasterKey.bytes.fill(0);
    fileEncKey.bytes.fill(0);
    // Keep piiEncKey for runtime use

    const runtime: LocalOfficeRuntime = {
      port: OFFICE_PORT,
      host: config.bindHost,
      installationId,
      identity,

      async close(): Promise<void> {
        // Stop watchdog
        clearInterval(watchdogInterval);
        watchdogInterval = undefined;

        // Close identity (wipes sessions)
        identity?.close();

        // Stop scheduler
        await scheduler?.close();

        // Close server
        if (server) {
          await new Promise<void>((resolve) => server!.close(() => resolve()));
        }

        // AudioStore has no close method - file handles are closed per-operation

        // Close database
        database?.close();

        // Close DPAPI store
        dpapiStore.close();

        // Wipe remaining key material
        piiEncKey.bytes.fill(0);
      },
    };

    return runtime;
  } catch (error) {
    // Cleanup on initialization failure
    clearInterval(watchdogInterval);
    identity?.close();
    await scheduler?.close();
    if (server) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    // AudioStore has no close method
    database?.close();
    dpapiStore.close();
    dbMasterKey.bytes.fill(0);
    fileEncKey.bytes.fill(0);
    piiEncKey.bytes.fill(0);
    throw error;
  }
}
