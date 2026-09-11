/**
 * 설치 apply의 provider 단계: storage_bucket → cron_job → edge_secret_binding (S11 §2 84-94, §2.8).
 *
 * bucket과 cron은 설치 연결 SQL(postgres.js session)로만 쓰고, Edge secret과 Signer 배포만
 * Management API로 쓴다. secret 값은 언제나 파라미터 바인딩으로만 전달하며 SQL 문자열, journal,
 * 반환값, 오류 코드에 넣지 않는다. 완료된 step은 다시 실행하지 않고 관찰만 한다.
 */
import { createHash } from 'node:crypto';

import {
  EDGE_BUNDLE_MAX_BYTES,
  SIGNER_COMPONENT_PATH,
} from '../release/edge-component-manifest.mjs';
import {
  completeInstallStep,
  recordInstallResource,
  startInstallStep,
} from './install-journal.mjs';
import {
  bindEdgeSecrets,
  deployEdgeFunction,
  readEdgeFunction,
} from './management-writes.mjs';

const BUCKET_ID = 'ccc-audio';
const BUCKET_FILE_SIZE_LIMIT = 209715200;
const BUCKET_MIME_TYPES = Object.freeze([
  'audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/webm', 'audio/x-m4a', 'audio/x-wav',
]);
const CRON_JOB_NAME = 'ccc_scheduler_tick';
const CRON_SCHEDULE = '* * * * *';
const VAULT_SECRET_NAME = 'ccc_scheduler_secret';
const SIGNER_SLUG = 'ccc-storage-signer';
const SIGNER_ENTRYPOINT = 'index.js';
const EDGE_SECRET_NAMES = Object.freeze(['CCC_INSTALL_MANIFEST', 'CCC_INSTALL_SIGNING_KEYS']);
const REGION = 'ap-northeast-2';
// cron command에 그대로 들어가므로 서명된 manifest의 apiBase도 여기서 다시 좁힌다
// (storage-signer.ts의 exactApiBase와 같은 규칙 + SQL literal에 안전한 문자만).
const SAFE_URL = /^[A-Za-z0-9:/._~-]{1,512}$/u;
const HASH = /^[0-9a-f]{64}$/u;

const EXTENSION_PROBE_QUERY = `SELECT
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'cron' AND routine.proname = 'schedule') AS cron_ready,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'net' AND routine.proname = 'http_post') AS net_ready,
  EXISTS(SELECT 1 FROM pg_catalog.pg_proc AS routine
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = routine.pronamespace
    WHERE namespace.nspname = 'vault' AND routine.proname = 'create_secret') AS vault_ready,
  to_regclass('storage.buckets') IS NOT NULL AS storage_ready`;

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function sha256(...parts) {
  const digest = createHash('sha256');
  for (const part of parts) digest.update(part);
  return digest.digest('hex');
}

function ownershipTag(installationId) {
  return `ccc.installation_id=${installationId}`;
}

function requireSecret(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 24_576) {
    throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  }
  return value;
}

function exactBase(value, { originOnly = false } = {}) {
  if (typeof value !== 'string' || !SAFE_URL.test(value)) throw failure('PROVIDER_UNREADABLE');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw failure('PROVIDER_UNREADABLE');
  }
  const path = url.pathname === '/' ? '' : url.pathname;
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.search !== '' || url.hash !== '' || path.endsWith('/')
    || (originOnly && path !== '')
    || (value !== url.origin && value !== `${url.origin}${url.pathname}`)) {
    throw failure('PROVIDER_UNREADABLE');
  }
  return `${url.origin}${path}`;
}

function requireContext(input) {
  const session = input?.session;
  const authorization = input?.authorization;
  const installationId = input?.installationId;
  if (typeof session?.unsafe !== 'function' || typeof input?.authorize !== 'function'
    || authorization === null || typeof authorization !== 'object'
    || typeof installationId !== 'string' || installationId.length === 0
    || authorization.installationId !== installationId
    || !(input?.now instanceof Date) || Number.isNaN(input.now.getTime())) {
    throw failure('PROVIDER_UNREADABLE');
  }
  const apiBase = exactBase(input.apiBase);
  exactBase(input.supabaseOrigin, { originOnly: true });
  const staged = input?.stagedFunction;
  if (staged?.path !== SIGNER_COMPONENT_PATH || !(staged?.bytes instanceof Uint8Array)
    || typeof staged?.sha256 !== 'string' || !HASH.test(staged.sha256)
    || staged.bytes.byteLength === 0
    || sha256(staged.bytes) !== staged.sha256) {
    throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  }
  // S11 §3.1: bundle 20 MB 초과는 deploy 전에 거른다.
  if (staged.bytes.byteLength > EDGE_BUNDLE_MAX_BYTES) throw failure('EDGE_BUNDLE_LIMIT');
  return {
    session,
    authorization,
    installationId,
    authorize: input.authorize,
    management: input.management,
    projectRef: input.projectRef,
    apiBase,
    stagedFunction: staged,
    secrets: {
      schedulerSecret: requireSecret(input?.secrets?.schedulerSecret),
      // Signer의 SUPABASE_SERVICE_ROLE_KEY는 Supabase가 Edge runtime에 주입한다. Management API의
      // CreateSecretBody는 `^(?!SUPABASE_).*` 이름만 받으므로 이 값은 묶을 수 없고, 주입 여부만 요구한다.
      serviceRoleKey: requireSecret(input?.secrets?.serviceRoleKey),
      installManifestJson: requireSecret(input?.secrets?.installManifestJson),
      signingKeysJson: requireSecret(input?.secrets?.signingKeysJson),
    },
    tag: ownershipTag(installationId),
  };
}

function journalOptions(context) {
  return { authorize: context.authorize };
}

function stepKey(context, step, desiredDigest) {
  return sha256(context.installationId, step, desiredDigest);
}

function stateFingerprint(context, step, desiredDigest, resources) {
  return sha256(
    context.installationId, step, desiredDigest,
    resources.map(resource => `${resource.resourceIdHash}:${resource.resourceDigest}`).join(','),
  );
}

async function firstRow(context, sql, params) {
  let rows;
  try {
    rows = await context.session.unsafe(sql, params);
  } catch {
    throw failure('PROVIDER_UNREADABLE');
  }
  if (!Array.isArray(rows)) throw failure('PROVIDER_UNREADABLE');
  return rows[0] ?? null;
}

async function claimResource(context, resourceType, resourceName, resourceDigest) {
  const resourceIdHash = sha256(resourceName);
  const claim = await recordInstallResource(context.session, context.authorization, {
    resourceType,
    resourceIdHash,
    resourceDigest,
    ownershipTag: context.tag,
  }, journalOptions(context));
  return { resourceType, resourceIdHash, resourceDigest, recorded: claim.recorded === true };
}

async function completeStep(context, step, key, desiredDigest, resources) {
  const resourceIdHashes = resources.map(resource => resource.resourceIdHash);
  const resourceDigests = resources.map(resource => resource.resourceDigest);
  await completeInstallStep(context.session, context.authorization, {
    step,
    idempotencyKey: key,
    ownershipTags: [context.tag],
    providerResourceIdHashes: resourceIdHashes,
    providerResourceDigests: resourceDigests,
    stateFingerprint: stateFingerprint(context, step, desiredDigest, resources),
  }, journalOptions(context));
  return { step, resourceIdHashes, resourceDigests };
}

async function recordedStep(context, step, key) {
  const row = await firstRow(context, `SELECT provider_resource_id_hashes, provider_resource_digests
    FROM private.ccc_install_steps
    WHERE installation_id = $1 AND step = $2 AND idempotency_key = $3 AND status = 'completed'`, [
    context.installationId, step, key,
  ]);
  const resourceIdHashes = row?.provider_resource_id_hashes;
  const resourceDigests = row?.provider_resource_digests;
  if (!Array.isArray(resourceIdHashes) || !Array.isArray(resourceDigests)
    || resourceIdHashes.length !== resourceDigests.length
    || [...resourceIdHashes, ...resourceDigests].some(value => !HASH.test(String(value)))) {
    throw failure('RESOURCE_OWNERSHIP_MISMATCH');
  }
  return { step, resourceIdHashes, resourceDigests };
}

async function startStep(context, step, desiredDigest) {
  const key = stepKey(context, step, desiredDigest);
  const started = await startInstallStep(context.session, context.authorization, {
    step, idempotencyKey: key,
  }, journalOptions(context));
  return { key, completed: started.completed === true };
}

function bucketDigest() {
  return sha256([
    BUCKET_ID, 'private', String(BUCKET_FILE_SIZE_LIMIT), BUCKET_MIME_TYPES.join(','),
  ].join('\n'));
}

async function readBucket(context) {
  return firstRow(context, `SELECT bucket.public, bucket.file_size_limit::text AS file_size_limit,
    COALESCE(bucket.allowed_mime_types, ARRAY[]::text[]) AS allowed_mime_types
    FROM storage.buckets AS bucket WHERE bucket.id = $1`, [BUCKET_ID]);
}

function requireDesiredBucket(row) {
  const mimeTypes = Array.isArray(row?.allowed_mime_types) ? [...row.allowed_mime_types].sort() : null;
  if (row === null || row.public !== false
    || String(row.file_size_limit) !== String(BUCKET_FILE_SIZE_LIMIT)
    || mimeTypes === null || mimeTypes.length !== BUCKET_MIME_TYPES.length
    || mimeTypes.some((value, index) => value !== BUCKET_MIME_TYPES[index])) {
    throw failure('RESOURCE_OWNERSHIP_MISMATCH');
  }
  return row;
}

async function storageBucketStep(context) {
  const desiredDigest = bucketDigest();
  const { key, completed } = await startStep(context, 'storage_bucket', desiredDigest);
  if (completed) {
    requireDesiredBucket(await readBucket(context));
    return recordedStep(context, 'storage_bucket', key);
  }
  // 소유 태그를 provider 쓰기보다 먼저 기록한다. 중단된 실행을 재개할 때 우리가 만든 bucket과
  // 남의 bucket을 이 기록으로 가른다.
  const claim = await claimResource(context, 'storage_bucket', BUCKET_ID, desiredDigest);
  const existing = await readBucket(context);
  if (existing === null) {
    try {
      await context.session.unsafe(`INSERT INTO storage.buckets (
        id, name, public, file_size_limit, allowed_mime_types
      ) VALUES ($1, $1, false, $2, $3) ON CONFLICT (id) DO NOTHING`, [
        BUCKET_ID, BUCKET_FILE_SIZE_LIMIT, [...BUCKET_MIME_TYPES],
      ]);
    } catch {
      throw failure('PROVIDER_UNREADABLE');
    }
    requireDesiredBucket(await readBucket(context));
  } else {
    if (claim.recorded) throw failure('RESOURCE_OWNERSHIP_MISMATCH');
    requireDesiredBucket(existing);
  }
  return completeStep(context, 'storage_bucket', key, desiredDigest, [claim]);
}

function schedulerCommand(apiBase) {
  return `select net.http_post(
  url := '${apiBase}/internal/scheduler/run',
  headers := jsonb_build_object(
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = '${VAULT_SECRET_NAME}'),
    'x-region', '${REGION}',
    'content-type', 'application/json'
  ),
  body := '{}'::jsonb
);`;
}

async function bindSchedulerSecret(context) {
  const existing = await firstRow(
    context, 'SELECT id::text AS id FROM vault.secrets WHERE name = $1', [VAULT_SECRET_NAME],
  );
  try {
    if (existing === null) {
      // 값은 $1 바인딩으로만 넘어간다. SQL 문자열에는 이름만 남는다.
      await context.session.unsafe('SELECT vault.create_secret($1, $2) AS id', [
        context.secrets.schedulerSecret, VAULT_SECRET_NAME,
      ]);
      return;
    }
    await context.session.unsafe('SELECT vault.update_secret($1::uuid, $2) AS updated', [
      existing.id, context.secrets.schedulerSecret,
    ]);
  } catch {
    throw failure('PROVIDER_UNREADABLE');
  }
}

async function cronJobStep(context) {
  const command = schedulerCommand(context.apiBase);
  const commandHash = sha256(command);
  const desiredDigest = sha256(`${CRON_SCHEDULE}\n${commandHash}`);
  const { key, completed } = await startStep(context, 'cron_job', desiredDigest);
  const observe = async () => {
    const job = await firstRow(
      context, 'SELECT jobid::text AS jobid, schedule, command FROM cron.job WHERE jobname = $1',
      [CRON_JOB_NAME],
    );
    if (job === null) return null;
    if (job.schedule !== CRON_SCHEDULE || sha256(String(job.command)) !== commandHash) {
      throw failure('RESOURCE_OWNERSHIP_MISMATCH');
    }
    return job;
  };
  if (completed) {
    if (await observe() === null) throw failure('RESOURCE_OWNERSHIP_MISMATCH');
    return recordedStep(context, 'cron_job', key);
  }
  const claim = await claimResource(context, 'cron_job', CRON_JOB_NAME, desiredDigest);
  await bindSchedulerSecret(context);
  if (await observe() === null) {
    try {
      await context.session.unsafe('SELECT cron.schedule($1, $2, $3)::text AS jobid', [
        CRON_JOB_NAME, CRON_SCHEDULE, command,
      ]);
    } catch {
      throw failure('PROVIDER_UNREADABLE');
    }
    if (await observe() === null) throw failure('PROVIDER_UNREADABLE');
  }
  return completeStep(context, 'cron_job', key, desiredDigest, [claim]);
}

async function edgeSecretBindingStep(context) {
  const names = [...EDGE_SECRET_NAMES].sort();
  const desiredDigest = sha256([
    SIGNER_SLUG, SIGNER_ENTRYPOINT, names.join(','), context.stagedFunction.sha256,
  ].join('\n'));
  const { key, completed } = await startStep(context, 'edge_secret_binding', desiredDigest);
  const management = {
    management: context.management,
    projectRef: context.projectRef,
    slug: SIGNER_SLUG,
  };
  if (completed) {
    const observed = await readEdgeFunction(management);
    if (observed === null) throw failure('RESOURCE_OWNERSHIP_MISMATCH');
    const recorded = await recordedStep(context, 'edge_secret_binding', key);
    if (!recorded.resourceIdHashes.includes(sha256(observed.id))) {
      throw failure('RESOURCE_OWNERSHIP_MISMATCH');
    }
    return recorded;
  }
  const binding = await claimResource(
    context, 'edge_secret_binding', names.join(','), desiredDigest,
  );
  const bound = await bindEdgeSecrets({
    management: context.management,
    projectRef: context.projectRef,
    secrets: [
      { name: 'CCC_INSTALL_MANIFEST', value: context.secrets.installManifestJson },
      { name: 'CCC_INSTALL_SIGNING_KEYS', value: context.secrets.signingKeysJson },
    ],
  });
  if (bound.length !== names.length || bound.some((name, index) => name !== names[index])) {
    throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  }
  const deployed = await deployEdgeFunction({
    management: context.management,
    projectRef: context.projectRef,
    slug: SIGNER_SLUG,
    functionName: SIGNER_SLUG,
    entrypointPath: SIGNER_ENTRYPOINT,
    bytes: context.stagedFunction.bytes,
  });
  const deployedResource = await claimResource(
    context, 'edge_function', deployed.id,
    sha256(`${deployed.id}:${deployed.version}`),
  );
  return completeStep(context, 'edge_secret_binding', key, desiredDigest, [
    binding, deployedResource,
  ]);
}

export async function applyProviderSteps(input) {
  const context = requireContext(input);
  const probe = await firstRow(context, EXTENSION_PROBE_QUERY, []);
  if (probe?.cron_ready !== true || probe?.net_ready !== true
    || probe?.vault_ready !== true || probe?.storage_ready !== true) {
    throw failure('PROVIDER_UNREADABLE');
  }
  return {
    steps: [
      await storageBucketStep(context),
      await cronJobStep(context),
      await edgeSecretBindingStep(context),
    ],
  };
}
