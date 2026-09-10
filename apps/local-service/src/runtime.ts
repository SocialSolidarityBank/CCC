import { createServer, type Server } from 'node:http';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { openEncryptedSqlite, type EncryptedSqliteDatabase, type SqliteMigration } from '@ccc/db-sqlite';
import { createFileAudioStore } from '@ccc/audio-file';
import { createNodeScheduler, type NodeScheduler, type SchedulerFailure } from '@ccc/scheduler-node';
import { createDpapiSecretStore, type DpapiRecord } from '@ccc/secrets-dpapi';
import type { AudioStore, CoreSecretStore, DeploymentMode, VersionedSecretBytes } from '@ccc/contracts/runtime';
import type { SingleEndpointRecord } from '@ccc/contracts/install-manifest';
import { createScheduledJobRunner, type ScheduledJobEnv } from '@ccc/core/scheduled-job-runner';
import { handleRequest, type ActorResolver } from '@ccc/http-api';
import type { ApiEnv } from '@ccc/http-api/identity';
import { createLocalSingleIdentity, type LocalSingleIdentity } from './identity.js';

const LOOPBACK = '127.0.0.1';

export interface LocalSingleRuntimeConfig {
  /** Root directory for all local data (database, audio, secrets, endpoint). */
  dataPath: string;
  /** Stable user ID from install. Generated at install and stored in DPAPI. */
  stableUserId: string;
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
  /** Optional runtime settings overrides. */
  settings?: Partial<Pick<ApiEnv,
    'CCC_STT_MODE' | 'CCC_LLM_MODE' | 'TEXT_AI_PILOT_ENABLED'
    | 'EXTERNAL_AI_CALLS_ENABLED' | 'PUBLIC_SIGNUP_ENABLED' | 'PII_PURGE_ENABLED' | 'PII_KEY_VERSION'>>;
  /** Callback for scheduler job failures. */
  onSchedulerError?: (failure: SchedulerFailure) => void;
}

export interface LocalSingleRuntime {
  /** The loopback server port (ephemeral). */
  readonly port: number;
  /** Installation ID from manifest. */
  readonly installationId: string;
  /** The opaque memory-only bearer for Electron IPC. */
  readonly bearer: string;
  /** Graceful shutdown: stops server, scheduler, closes database. */
  close(): Promise<void>;
}

/**
 * E7-1a/E7-1b Local Single runtime composition.
 * - Loopback-only bind with ephemeral port
 * - DPAPI-protected encrypted SQLite and file audio store
 * - Node process scheduler
 * - Opaque memory-only bearer
 * - Fails closed on unsupported platform
 */
export async function createLocalSingleRuntime(config: LocalSingleRuntimeConfig): Promise<LocalSingleRuntime> {
  // Fail closed: Windows only
  if (process.platform !== 'win32') {
    throw new Error('platform_unsupported');
  }

  // Initialize DPAPI secret store with provided records
  const dpapiStore = createDpapiSecretStore('local-single', config.secretRecords);

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
  const endpointPath = join(dataPath, 'endpoint.json');

  // Ensure directories exist (private-files handles permissions on Windows)
  await mkdir(dirname(dbPath), { recursive: true });
  await mkdir(audioPath, { recursive: true });

  let database: EncryptedSqliteDatabase | undefined;
  let audioStore: AudioStore | undefined;
  let scheduler: NodeScheduler | undefined;
  let identity: LocalSingleIdentity | undefined;
  let server: Server | undefined;

  try {
    // Open encrypted database
    database = openEncryptedSqlite({ filename: dbPath, key: dbMasterKey.bytes });
    database.applyMigrations(config.migrations as SqliteMigration[]);

    // Create encrypted audio store
    audioStore = await createFileAudioStore(audioPath, fileEncKey);

    // Create local identity
    identity = createLocalSingleIdentity({
      stableUserId: config.stableUserId,
      orgId: config.orgId,
    });

    // Parse install manifest for installation ID (signature verification is caller's responsibility)
    const manifest = JSON.parse(config.installManifest) as { installationId: string; mode: DeploymentMode };
    if (manifest.mode !== 'local-single') throw new Error('installation_invalid');
    const installationId = manifest.installationId;

    // Build core secret store (read-only, no platform keys)
    const coreSecretStore: CoreSecretStore = {
      async get(_name: 'CODEX_API_KEY' | 'NOTIFY_WEBHOOK_URL'): Promise<string | null> {
        // These are stored differently in local mode; return null for now
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
      installationMode: 'local-single' as DeploymentMode,
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

    // Actor resolver for requests
    const resolveActor: ActorResolver = async (request) => {
      return identity!.resolve(request);
    };

    // Variables to track server state
    let port: number;

    // Create HTTP server bound to loopback only with ephemeral port
    server = createServer(async (req, res) => {
      // Build Request from IncomingMessage
      const url = new URL(req.url ?? '/', `http://${LOOPBACK}:${port}`);
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
        const responseBody = await response.arrayBuffer();
        res.end(new Uint8Array(responseBody));
      } catch {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'internal_error' }));
      }
    });

    // Bind to loopback with ephemeral port
    port = await new Promise<number>((resolve, reject) => {
      server!.listen(0, LOOPBACK, () => {
        const addr = server!.address();
        if (addr && typeof addr === 'object') {
          resolve(addr.port);
        } else {
          reject(new Error('server_bind_failed'));
        }
      });
      server!.on('error', reject);
    });

    // Write DPAPI endpoint record (port discovery for Electron)
    const endpointRecord: SingleEndpointRecord = { installationId, port };
    await writeFile(endpointPath, JSON.stringify(endpointRecord), { mode: 0o600 });

    // Cleanup helper
    async function close(): Promise<void> {
      // Stop accepting new connections
      await new Promise<void>((resolve) => {
        if (server?.listening) {
          server.close(() => resolve());
        } else {
          resolve();
        }
      });

      // Close scheduler (drains in-flight jobs)
      await scheduler?.close();

      // Close identity (zeros memory)
      identity?.close();

      // Close database
      database?.close();

      // Zero key material (non-null: checked at line 72 before try)
      dbMasterKey!.bytes.fill(0);
      fileEncKey!.bytes.fill(0);
      piiEncKey!.bytes.fill(0);

      // Close DPAPI store
      dpapiStore.close();
    }

    return {
      port,
      installationId,
      bearer: identity.bearer,
      close,
    };
  } catch (error) {
    // Cleanup on initialization failure
    if (dbMasterKey !== null) dbMasterKey.bytes.fill(0);
    if (fileEncKey !== null) fileEncKey.bytes.fill(0);
    if (piiEncKey !== null) piiEncKey.bytes.fill(0);
    dpapiStore.close();
    identity?.close();
    database?.close();
    if (server?.listening) {
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    throw error;
  }
}

/** Read DPAPI endpoint record written by the runtime. */
export async function readEndpointRecord(dataPath: string): Promise<SingleEndpointRecord | null> {
  try {
    const content = await readFile(join(dataPath, 'endpoint.json'), 'utf-8');
    const record = JSON.parse(content) as SingleEndpointRecord;
    if (typeof record.installationId !== 'string' || typeof record.port !== 'number') {
      return null;
    }
    return record;
  } catch {
    return null;
  }
}
