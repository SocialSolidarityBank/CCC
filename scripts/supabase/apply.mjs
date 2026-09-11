import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  parseArtifactBasename,
  requireExpectedTuple,
  verifyReleaseBundle,
  verifyReleaseManifest,
} from '../release/release-manifest.mjs';
import { extractReleaseArchive } from '../release/safe-extract.mjs';
import { verifyEdgeComponentManifest } from '../release/edge-component-manifest.mjs';
import { createReleaseFloorStore } from '../release/release-floor.mjs';
import {
  asTrustedClock as trustedClock,
  createTrustedClock,
  fetchPinnedRelease,
  PINNED_RELEASE_ORIGIN,
  trustedTimeNow as currentTrustedTime,
} from '../release/release-origin.mjs';
import { loadReleaseTrustStore } from '../release/release-trust.mjs';
import {
  applyJournaledMigration,
  bootstrapInstall,
  completeInstallStep,
  recordInstallFailure,
  startInstallStep,
  withInstallLock,
} from './install-journal.mjs';
import {
  assertAuthorizationMatches,
  readStrictJsonDocument,
} from './manifest-preflight.mjs';
import { assertProviderBaselineCurrent, installationStateFingerprint } from './plan.mjs';

export { createTrustedClock };

function failure(code) {
  return Object.assign(new Error(code), { code });
}


function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}


function backupEvidenceDigests(evidence) {
  const entries = Object.entries(evidence);
  return {
    ids: entries.map(([name]) => createHash('sha256').update(name).digest('hex')),
    digests: entries.map(([name, value]) =>
      createHash('sha256').update(`${name}:${value}`).digest('hex')),
  };
}

function firstInstallBackup(plan, observation) {
  if (plan?.ready !== true || plan?.installed?.state !== 'not-installed') throw failure('BACKUP_FAILED');
  const state = observation?.state;
  const privateTables = state?.privateTableNames;
  const evidence = {
    businessTableCount: count(state?.userTableCount),
    businessRowCount: count(state?.userRowEstimate),
    authUserCount: count(state?.authUserCount),
    bucketCount: count(state?.bucketCount),
    storageObjectCount: count(state?.storageObjectCount),
    publicRoutineCount: count(state?.userRoutineCount),
    publicTypeCount: count(state?.userTypeCount),
    privateInstallerTableCount: Array.isArray(privateTables) ? privateTables.length : null,
    installJournalCount: observation?.installState === null ? 0 : 1,
  };
  if (Object.values(evidence).some(value => value !== 0)) throw failure('BACKUP_FAILED');
  return Object.freeze({ backup: 'not_applicable', evidence: Object.freeze(evidence) });
}


function requireMethod(owner, name) {
  if (typeof owner?.[name] !== 'function') throw failure('RELEASE_PREREQUISITES_MISSING');
  return owner[name].bind(owner);
}

function failureCode(error) {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/u.test(error.code)
    ? error.code : 'PROVIDER_UNREADABLE';
}


// Presence of the externally injected values only. A secret is never read,
// logged, hashed into an identifier, or compared against a literal here.
function injectedSecrets(secrets) {
  return [
    secrets?.schedulerSecret, secrets?.serviceRoleKey,
    secrets?.installManifestJson, secrets?.signingKeysJson,
    secrets?.apiDatabasePassword,
  ].every(value => typeof value === 'string' && value.length > 0);
}

export const SIGNER_COMPONENT_PATH = 'functions/ccc-storage-signer/index.js';

/**
 * The verified component set is exactly the planned migrations plus the one
 * StorageSigner function this installer can deploy. Anything else is refused
 * before the install lock rather than partially applied.
 */
function requireInstallComponents(edge, plan) {
  const components = Array.isArray(edge?.components) ? edge.components : [];
  const migrations = components.filter(component => component?.kind === 'migration');
  const functions = components.filter(component => component?.kind === 'function');
  if (components.length === 0
    || migrations.length + functions.length !== components.length
    || functions.length !== 1
    || functions[0].path !== SIGNER_COMPONENT_PATH
    || !/^[a-f0-9]{64}$/u.test(functions[0].artifactSha256 ?? '')) {
    throw failure('EDGE_COMPONENT_SET_MISMATCH');
  }
  const expected = plan?.migrations?.map(migration => ({
    path: `migrations/${migration.id}`,
    artifactSha256: migration.checksum,
  }));
  if (!Array.isArray(expected) || expected.length !== migrations.length
    || expected.some((item, index) => item.path !== migrations[index]?.path
      || item.artifactSha256 !== migrations[index]?.artifactSha256)) {
    throw failure('MIGRATION_CHECKSUM_MISMATCH');
  }
  return { migrations, signer: functions[0] };
}

async function readVerifiedComponent(stagedRoot, component) {
  const path = join(stagedRoot, ...component.path.split('/'));
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1 || before.size > 16 * 1024 * 1024) {
      throw failure('EDGE_COMPONENT_SET_MISMATCH');
    }
    const bytes = await file.readFile();
    const after = await file.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs
      || createHash('sha256').update(bytes).digest('hex') !== component.artifactSha256) {
      throw failure('EDGE_COMPONENT_SET_MISMATCH');
    }
    return bytes;
  } finally {
    await file.close();
  }
}


async function pinnedBytes(url, maximumBytes, fetchImpl) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw failure('RELEASE_ORIGIN_INVALID');
  }
  if (parsed.origin !== PINNED_RELEASE_ORIGIN || parsed.username !== '' || parsed.password !== '') {
    throw failure('RELEASE_ORIGIN_INVALID');
  }
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'error' });
  } catch {
    throw failure('ARTIFACT_NOT_INDEXED');
  }
  if (response.ok !== true) throw failure('ARTIFACT_NOT_INDEXED');
  if (response.url !== url) throw failure('RELEASE_ORIGIN_INVALID');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) throw failure('ARTIFACT_NOT_INDEXED');
  return bytes;
}

function releaseTarget() {
  if (process.platform === 'darwin' && ['arm64', 'x64'].includes(process.arch)) {
    return { family: 'community-cloud-cli', mode: 'community-cloud', platform: 'macos', arch: process.arch };
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return { family: 'community-cloud-cli', mode: 'community-cloud', platform: 'ubuntu', arch: 'x64' };
  }
  throw failure('ARTIFACT_IDENTITY_MISMATCH');
}

export async function loadReleaseForApply({
  manifestUrl,
  authorize,
  inspector,
  management,
  secrets,
  apiBase,
  supabaseOrigin,
  floorStore = createReleaseFloorStore(),
  localNow,
  fetchImpl = fetch,
}) {
  const trustStore = await loadReleaseTrustStore(process.env.CCC_RELEASE_TRUST_STORE);
  const fetched = await fetchPinnedRelease({
    fetchImpl,
    floorStore,
    now: localNow,
    verifyBundle: async (document, trustedDate) => {
      const candidate = await readStrictJsonDocument(document);
      if (!['dev', 'beta'].includes(candidate?.channel)) throw failure('BUNDLE_ENTRY_INVALID');
      return verifyReleaseBundle({
        document,
        trustStore,
        now: trustedDate,
        channel: candidate.channel,
      });
    },
  });
  const trustedTime = fetched.trustedTime;
  const target = releaseTarget();
  const entry = fetched.bundle.entries.find(candidate => candidate.family === target.family);
  const row = entry?.artifacts?.find(candidate => candidate.manifestUrl === manifestUrl);
  if (row === undefined) throw failure('ARTIFACT_NOT_INDEXED');
  requireExpectedTuple({
    family: entry.family,
    mode: row.mode,
    platform: row.platform,
    arch: row.arch,
  }, target);

  const manifestBytes = await pinnedBytes(manifestUrl, 1_048_576, fetchImpl);
  const manifestDocument = new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes);
  const verifiedManifest = await verifyReleaseManifest({
    document: manifestDocument,
    trustStore,
    now: currentTrustedTime(trustedTime),
    expectedTuple: target,
    bundleEntry: { family: entry.family, ...row },
  });
  const artifactBytes = await pinnedBytes(
    verifiedManifest.artifactUrl,
    verifiedManifest.artifactBytes,
    fetchImpl,
  );
  if (artifactBytes.byteLength !== verifiedManifest.artifactBytes
    || createHash('sha256').update(artifactBytes).digest('hex') !== verifiedManifest.artifactSha256) {
    throw failure('HASH_MISMATCH');
  }

  const stagingRoot = await mkdtemp(join(tmpdir(), 'ccc-release-apply-'));
  const artifactPath = join(stagingRoot, basename(new URL(verifiedManifest.artifactUrl).pathname));
  const extractedRoot = join(stagingRoot, 'staged');
  try {
    await writeFile(artifactPath, artifactBytes, { mode: 0o600, flag: 'wx' });
    await extractReleaseArchive({ archivePath: artifactPath, destination: extractedRoot });
    const edgeDocument = await readFile(join(extractedRoot, 'edge-component-manifest.json'), 'utf8');
    return {
      release: createVerifiedRelease({
        bundleDocument: canonicalDocument(fetched.bundle),
        manifestDocument,
        artifactBytes,
        edgeDocument,
        stagedRoot: extractedRoot,
        manifestUrl,
        trustStore,
        channel: fetched.bundle.channel,
        expectedTuple: target,
        authorize,
        inspector,
        management,
        secrets,
        apiBase,
        supabaseOrigin,
      }),
      trustedTime,
      cleanup: () => rm(stagingRoot, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

function canonicalDocument(value) {
  return JSON.stringify(value);
}

export function createVerifiedRelease({
  bundleDocument,
  manifestDocument,
  artifactBytes,
  edgeDocument,
  stagedRoot,
  manifestUrl,
  trustStore,
  channel,
  expectedTuple,
  promote,
  authorize,
  inspector,
  management,
  secrets,
  apiBase,
  supabaseOrigin,
  providerSteps,
  providerProbe,
}) {
  let bundleRow;
  let edgeManifest;
  return {
    async verifyBundle({ now }) {
      return verifyReleaseBundle({
        document: bundleDocument, trustStore, now, channel,
      });
    },
    async verifyManifest({ bundle, now }) {
      const entry = bundle.entries.find(candidate => candidate.family === 'community-cloud-cli');
      const artifact = entry?.artifacts?.find(candidate => candidate.manifestUrl === manifestUrl);
      if (artifact === undefined) throw failure('ARTIFACT_NOT_INDEXED');
      bundleRow = { family: entry.family, ...artifact };
      const tuple = {
        family: entry.family,
        mode: artifact.mode,
        platform: artifact.platform,
        arch: artifact.arch,
      };
      const verified = await verifyReleaseManifest({
        document: manifestDocument, trustStore, now, expectedTuple: tuple, bundleEntry: bundleRow,
      });
      return Object.freeze({ ...verified, manifestSha256: artifact.manifestSha256 });
    },
    async verifyTuple({ manifest }) {
      return requireExpectedTuple(parseArtifactBasename(manifest.artifactUrl), expectedTuple);
    },
    async verifyArtifactHash({ manifest }) {
      if (!(artifactBytes instanceof Uint8Array)
        || artifactBytes.byteLength !== manifest.artifactBytes
        || createHash('sha256').update(artifactBytes).digest('hex') !== manifest.artifactSha256) {
        throw failure('HASH_MISMATCH');
      }
      return true;
    },
    async verifyEdgeComponentSet({ now }) {
      if (bundleRow === undefined) throw failure('EDGE_COMPONENT_SET_MISMATCH');
      edgeManifest = await verifyEdgeComponentManifest({
        document: edgeDocument, stagedRoot, bundleRow, trustStore, now,
      });
      return edgeManifest;
    },
    /**
     * S12 §6: the one deployable function plus either a verified backup or the
     * 2026-09-11 first-install exemption, and both provider-step secrets
     * actually injected. Presence only; no value is read, compared or emitted.
     */
    async verifyDeploymentPrerequisites({ edge, plan }) {
      if (edgeManifest === undefined || edge !== edgeManifest || bundleRow === undefined) {
        throw failure('EDGE_COMPONENT_SET_MISMATCH');
      }
      const { signer } = requireInstallComponents(edge, plan);
      // No E6-7 verified backup catalog exists, so only the empty first
      // install may proceed. Resume and update are not exempt.
      if (plan?.ready !== true || plan?.installed?.state !== 'not-installed') {
        throw failure('BACKUP_FAILED');
      }
      if (!injectedSecrets(secrets)) throw failure('RELEASE_PREREQUISITES_MISSING');
      return Object.freeze({
        ready: true,
        backup: 'not_applicable',
        signerComponentSha256: signer.artifactSha256,
      });
    },
    /** Read-only capability probe, run before the journal exists so a missing extension never strands a project. */
    async probeProviderCapabilities(session) {
      const probe = providerProbe ?? (await import('./provider-steps.mjs')).probeProviderCapabilities;
      await probe(session);
    },
    /** Provider resources are applied from staged bytes only, after migrations. */
    async applyProviderSteps(input) {
      if (edgeManifest === undefined || typeof authorize !== 'function'
        || !injectedSecrets(secrets)) throw failure('RELEASE_PREREQUISITES_MISSING');
      const { signer } = requireInstallComponents(edgeManifest, input.plan);
      const run = providerSteps ?? (await import('./provider-steps.mjs')).applyProviderSteps;
      return run({
        session: input.session,
        authorization: input.authorization,
        management,
        apiBase,
        supabaseOrigin,
        projectRef: input.authorization.projectRef,
        installationId: input.authorization.installationId,
        stagedFunction: {
          path: signer.path,
          bytes: await readVerifiedComponent(stagedRoot, signer),
          sha256: signer.artifactSha256,
        },
        secrets,
        authorize,
        now: input.now,
      });
    },
    async promote(input) {
      if (typeof promote === 'function') return promote(input);
      if (typeof authorize !== 'function' || typeof inspector?.inspect !== 'function'
        || edgeManifest === undefined) throw failure('RELEASE_PREREQUISITES_MISSING');
      const now = trustedClock(input.now);
      const authorizeMigration = async () => {
        const fresh = await authorize();
        assertProviderBaselineCurrent(
          input.providerBaseline,
          fresh,
          currentTrustedTime(now),
        );
        return fresh;
      };
      const { migrations } = requireInstallComponents(edgeManifest, input.plan);
      for (const [index, component] of migrations.entries()) {
        const at = currentTrustedTime(now);
        await verifyReleaseBundle({
          document: bundleDocument, trustStore, now: at, channel,
        });
        await verifyReleaseManifest({
          document: manifestDocument,
          trustStore,
          now: at,
          expectedTuple,
          bundleEntry: bundleRow,
        });
        await verifyEdgeComponentManifest({
          document: edgeDocument, stagedRoot, bundleRow, trustStore, now: at,
        });
        const planned = input.plan.migrations[index];
        await applyJournaledMigration(input.session, input.authorization, {
          id: planned.id,
          checksum: planned.checksum,
          sql: (await readVerifiedComponent(stagedRoot, component)).toString('utf8'),
        }, { authorize: authorizeMigration });
      }
      const observation = await inspector.inspect();
      return {
        artifactSetDigest: edgeManifest.edgeArtifactSha256,
        stateFingerprint: await installationStateFingerprint(
          observation,
          input.providerBaseline,
        ),
        databaseFingerprint: observation.databaseFingerprint,
        responseRegion: observation.project.region,
        providerResourceDigests: Object.fromEntries(
          (observation.installState?.resources ?? []).map(resource => [
            resource.resourceIdHash,
            resource.resourceDigest,
          ]),
        ),
      };
    },
  };
}
async function requireFreshAuthorization(authorization, plan, authorize, now) {
  const previous = {
    ...authorization,
    resourcesSha256: plan.resourcesSha256,
    migrationsSha256: plan.migrationsSha256,
  };
  const fresh = {
    ...await authorize(),
    resourcesSha256: plan.resourcesSha256,
    migrationsSha256: plan.migrationsSha256,
  };
  assertAuthorizationMatches(previous, fresh, {
    resourcesSha256: plan.resourcesSha256,
    migrationsSha256: plan.migrationsSha256,
    now,
  });
}

/** Hash-only resource evidence from the provider steps; never a resource value. */
function providerStepDigests(result) {
  const steps = Array.isArray(result?.steps) ? result.steps : [];
  return Object.fromEntries(steps.flatMap(step => {
    const ids = Array.isArray(step?.resourceIdHashes) ? step.resourceIdHashes : [];
    const digests = Array.isArray(step?.resourceDigests) ? step.resourceDigests : [];
    if (ids.length !== digests.length) throw failure('RESOURCE_OWNERSHIP_MISMATCH');
    return ids.map((id, index) => {
      if (!/^[a-f0-9]{64}$/u.test(id ?? '') || !/^[a-f0-9]{64}$/u.test(digests[index] ?? '')) {
        throw failure('RESOURCE_OWNERSHIP_MISMATCH');
      }
      return [id, digests[index]];
    });
  }));
}

async function recordInstalled(session, input, authorize) {
  const {
    authorization, plan, bundle, promotion, health, receipt, now,
  } = input;
  const stateFingerprint = health?.stateFingerprint;
  const schemaFingerprint = promotion?.databaseFingerprint;
  const observedOwnerOrgIdHash = health?.observedOwnerOrgIdHash;
  const migrationHead = plan.migrations?.at(-1)?.id;
  const firstInstall = firstInstallOnly(plan, receipt.backup);
  requireHealthyInstallation(health, authorization, { runtimeRequired: !firstInstall });
  // 첫 설치는 /readyz를 증거로 요구하지 않으므로 기록도 하지 않는다. 실제 기동 여부는
  // runtime 배포 뒤 doctor가 읽는다(S12 §6 2026-09-12).
  if (receipt.productionReady !== !firstInstall || receipt.runtimeReady !== !firstInstall
    || input.productionReady !== receipt.productionReady
    || input.runtimeReady !== receipt.runtimeReady) {
    throw failure('HEALTH_FAILED');
  }
  if (receipt.releaseSequence !== installationSequence(bundle.sequence)
    || receipt.artifactSetDigest !== (promotion?.artifactSetDigest ?? input.edge?.edgeArtifactSha256)
    || receipt.edgeArtifactSha256 !== input.edge?.edgeArtifactSha256) {
    throw failure('HEALTH_FAILED');
  }
  if (!/^[a-f0-9]{64}$/u.test(stateFingerprint ?? '')
    || !/^[a-f0-9]{64}$/u.test(schemaFingerprint ?? '')
    || observedOwnerOrgIdHash !== authorization.expectedOwnerOrgIdHash
    || typeof migrationHead !== 'string' || migrationHead.length === 0
    || !/^[a-f0-9]{64}$/u.test(receipt.manifestDigest ?? '')
    || !/^[a-f0-9]{64}$/u.test(receipt.artifactSetDigest ?? '')) {
    throw failure('HEALTH_FAILED');
  }
  const backupDigest = createHash('sha256')
    .update(JSON.stringify(receipt.backup.evidence))
    .digest('hex');
  const edgeRegionEvidence = health.edgeRegionEvidence;
  const providerResourceDigests = {
    ...(promotion?.providerResourceDigests ?? {}),
    ...providerStepDigests(input.providerSteps),
  };
  await requireFreshAuthorization(
    authorization,
    plan,
    authorize,
    currentTrustedTime(now),
  );
  await session.unsafe('BEGIN');
  try {
    const rows = await session.unsafe(
      `SELECT phase, current_step FROM private.ccc_install_journal
       WHERE installation_id = $1 FOR UPDATE`,
      [authorization.installationId],
    );
    if (rows.length !== 1 || rows[0].phase !== 'installing') {
      throw failure('INSTALL_JOURNAL_INVALID');
    }
    const [{ recorded_at: recordedAt }] = await session.unsafe(
      'SELECT clock_timestamp() AS recorded_at',
    );
    const values = [
      authorization.installationId,
      authorization.institutionIdHash,
      authorization.expectedOwnerOrgIdHash,
      observedOwnerOrgIdHash,
      bundle.version,
      receipt.releaseSequence,
      receipt.manifestDigest,
      receipt.artifactSetDigest,
      migrationHead,
      schemaFingerprint,
      edgeRegionEvidence,
      providerResourceDigests,
      'not_applicable',
      backupDigest,
      recordedAt,
    ];
    const columns = `(
      installation_id, contract, contract_version, institution_id_hash, rollback_target,
      expected_owner_org_id_hash, observed_owner_org_id_hash, release_version, release_sequence,
      manifest_digest, artifact_set_digest, migration_head, schema_fingerprint,
      edge_region_evidence, provider_resource_digests, backup_id, backup_digest,
      prior_receipt_digest, status, recorded_at
    )`;
    const row = `($1,'S11','0.3',$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10,
      $11::jsonb,$12::jsonb,$13,$14,NULL,'installed',$15)`;
    await session.unsafe(
      `INSERT INTO private.ccc_release_history ${columns} VALUES ${row}`,
      values,
    );
    await session.unsafe(
      `INSERT INTO private.ccc_install_receipt ${columns} VALUES ${row}`,
      values,
    );
    await session.unsafe(`UPDATE private.ccc_install_journal SET
      phase = 'installed', current_step = NULL, state_fingerprint = $2,
      last_error_code = NULL, updated_at = clock_timestamp()
      WHERE installation_id = $1`, [authorization.installationId, stateFingerprint]);
    await requireFreshAuthorization(
      authorization,
      plan,
      authorize,
      currentTrustedTime(now),
    );
    await session.unsafe('COMMIT');
  } catch (error) {
    await session.unsafe('ROLLBACK').catch(() => {});
    throw error;
  }
}

export function createInstallJournalSession({ sql, authorization, authorize }) {
  if (typeof authorize !== 'function') throw failure('OWNER_EVIDENCE_MISSING');
  return {
    withInstallLock: callback => withInstallLock(sql, authorization.projectRefHash, callback),
    async prepare(session, input) {
      await bootstrapInstall(session, authorization, {
        resourcesSha256: input.plan.resourcesSha256,
        migrationsSha256: input.plan.migrationsSha256,
        planFingerprint: input.plan.planFingerprint,
      }, { authorize });
      const backupEvidence = backupEvidenceDigests(input.backup.evidence);
      const backupKey = createHash('sha256')
        .update(JSON.stringify(input.backup))
        .digest('hex');
      await startInstallStep(session, authorization, {
        step: 'prepare_backup',
        idempotencyKey: backupKey,
      }, { authorize });
      await completeInstallStep(session, authorization, {
        step: 'prepare_backup',
        idempotencyKey: backupKey,
        ownershipTags: [`ccc.installation_id=${authorization.installationId}`],
        providerResourceIdHashes: backupEvidence.ids,
        providerResourceDigests: backupEvidence.digests,
        stateFingerprint: input.plan.stateFingerprint,
      }, { authorize });
      await startInstallStep(session, authorization, {
        step: 'switch_release',
        idempotencyKey: input.idempotencyKey,
      }, { authorize });
    },
    async promoted(session, input) {
      await completeInstallStep(session, authorization, {
        step: 'switch_release',
        idempotencyKey: input.idempotencyKey,
        ownershipTags: [`ccc.installation_id=${authorization.installationId}`],
        providerResourceIdHashes: [],
        providerResourceDigests: [],
        stateFingerprint: input.promotion.stateFingerprint,
      }, { authorize });
    },
    async complete(session, input) {
      await recordInstalled(session, input, authorize);
    },
    fail: (session, input) => recordInstallFailure(session, authorization, {
      step: input.step,
      code: input.code,
    }, { authorize }),
  };
}

function installationSequence(value) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value)) {
    throw failure('BUNDLE_ENTRY_INVALID');
  }
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence)) throw failure('BUNDLE_ENTRY_INVALID');
  return sequence;
}

/**
 * S12 §6 (2026-09-12): a first install proves the installation itself — signer
 * refusal for this installation, Seoul edge region, owner and a restricted
 * `ccc_api` role — but not `/readyz`, because the business runtime logs in as
 * `ccc_api` only after this apply set that password. Resume and update keep
 * requiring the runtime evidence too.
 */
function firstInstallOnly(plan, backup) {
  return backup?.backup === 'not_applicable' && plan?.installed?.state === 'not-installed';
}

function requireHealthyInstallation(health, authorization, { runtimeRequired }) {
  const region = health?.edgeRegionEvidence;
  const database = health?.restrictedDatabase;
  if (health?.installedHealthy !== true
    || (runtimeRequired && health.healthy !== true)
    || health.observedOwnerOrgIdHash !== authorization.expectedOwnerOrgIdHash
    || health.storageSignerHealthy !== true
    || region?.requestedRegion !== 'ap-northeast-2'
    || region.responseRegion !== region.requestedRegion
    || region.functionRegion !== region.requestedRegion
    || region.mismatch !== false
    || database?.connected !== true
    || database.role !== 'ccc_api'
    || database.superuser !== false
    || database.bypassRls !== false) {
    throw failure('HEALTH_FAILED');
  }
}

async function verifyCandidate({
  authorization,
  providerBaseline,
  plan,
  release,
  clock,
}) {
  const bundle = await requireMethod(release, 'verifyBundle')({
    authorization, providerBaseline, plan, now: currentTrustedTime(clock),
  });
  const manifest = await requireMethod(release, 'verifyManifest')({
    bundle, authorization, plan, now: currentTrustedTime(clock),
  });
  await requireMethod(release, 'verifyTuple')({
    bundle, manifest, authorization, plan, now: currentTrustedTime(clock),
  });
  await requireMethod(release, 'verifyArtifactHash')({
    bundle, manifest, authorization, plan, now: currentTrustedTime(clock),
  });
  const edge = await requireMethod(release, 'verifyEdgeComponentSet')({
    bundle, manifest, authorization, plan, now: currentTrustedTime(clock),
  });
  requireInstallComponents(edge, plan);
  const deployment = await requireMethod(release, 'verifyDeploymentPrerequisites')({
    bundle, manifest, edge, authorization, providerBaseline, plan,
    now: currentTrustedTime(clock),
  });
  if (deployment?.ready !== true) throw failure('RELEASE_PREREQUISITES_MISSING');
  const currentBundle = await requireMethod(release, 'verifyBundle')({
    authorization, providerBaseline, plan, now: currentTrustedTime(clock),
  });
  const currentManifest = await requireMethod(release, 'verifyManifest')({
    bundle: currentBundle,
    authorization,
    plan,
    now: currentTrustedTime(clock),
  });
  assertProviderBaselineCurrent(
    providerBaseline,
    authorization,
    currentTrustedTime(clock),
  );
  return {
    bundle: currentBundle,
    manifest: currentManifest,
    edge,
    releaseSequence: installationSequence(currentBundle.sequence),
  };
}

export async function applyInstallation({
  authorization,
  providerBaseline,
  plan,
  release,
  inspector,
  journalSession,
  now,
}) {
  const clock = trustedClock(now);
  if (plan?.ready !== true || plan?.installed?.state !== 'not-installed') {
    throw failure('BACKUP_FAILED');
  }

  let candidate = await verifyCandidate({
    authorization, providerBaseline, plan, release, clock,
  });
  const withInstallLock = requireMethod(journalSession, 'withInstallLock');
  return withInstallLock(async session => {
    assertProviderBaselineCurrent(
      providerBaseline,
      authorization,
      currentTrustedTime(clock),
    );
    const observation = await requireMethod(inspector, 'revalidate')(plan, session);
    const backup = firstInstallBackup(plan, observation);
    candidate = await verifyCandidate({
      authorization, providerBaseline, plan, release, clock,
    });
    const {
      bundle, manifest, edge, releaseSequence,
    } = candidate;
    const idempotencyKey = createHash('sha256')
      .update(authorization.installationId)
      .update(bundle.bundleId)
      .update(manifest.artifactSha256)
      .update(edge.edgeArtifactSha256)
      .digest('hex');
    let prepared = false;
    let promotionStarted = false;
    try {
      // Provider capabilities are read before any journal write: a project missing
      // pg_cron, pg_net, Vault or Storage stays untouched instead of stranded.
      if (typeof release.probeProviderCapabilities === 'function') {
        await release.probeProviderCapabilities(session);
      }
      await requireMethod(journalSession, 'prepare')(session, {
        authorization, providerBaseline, plan, bundle, manifest, edge, backup,
        idempotencyKey, now: currentTrustedTime(clock), resume: false,
      });
      prepared = true;
      promotionStarted = true;
      const promotion = await requireMethod(release, 'promote')({
        session, authorization, providerBaseline, plan, bundle, manifest, edge, backup,
        now: clock,
      });
      await requireMethod(journalSession, 'promoted')(session, {
        authorization, plan, bundle, manifest, edge, promotion, idempotencyKey,
        now: currentTrustedTime(clock),
      });
      // Provider resources come after the promoted migrations and before any
      // health evidence is read, so health observes the complete installation.
      const providerSteps = await requireMethod(release, 'applyProviderSteps')({
        session, authorization, providerBaseline, plan, bundle, manifest, edge, promotion,
        now: currentTrustedTime(clock),
      });
      const health = await requireMethod(inspector, 'health')({
        session, authorization, providerBaseline, plan, bundle, manifest, edge, promotion,
        now: currentTrustedTime(clock),
      });
      const firstInstall = firstInstallOnly(plan, backup);
      requireHealthyInstallation(health, authorization, { runtimeRequired: !firstInstall });
      candidate = await verifyCandidate({
        authorization, providerBaseline, plan, release, clock,
      });
      if (candidate.bundle.bundleId !== bundle.bundleId
        || candidate.manifest.artifactSha256 !== manifest.artifactSha256
        || candidate.edge.edgeArtifactSha256 !== edge.edgeArtifactSha256
        || candidate.releaseSequence !== releaseSequence) {
        throw failure('BUNDLE_ENTRY_INVALID');
      }
      const receipt = {
        profile: 'development',
        bundleId: bundle.bundleId,
        releaseVersion: bundle.version,
        releaseSequence,
        manifestDigest: manifest.manifestSha256 ?? manifest.artifactSha256,
        artifactSetDigest: promotion?.artifactSetDigest ?? edge.edgeArtifactSha256,
        edgeArtifactSha256: edge.edgeArtifactSha256,
        backup,
        productionReady: !firstInstall,
        runtimeReady: !firstInstall,
      };
      await requireMethod(journalSession, 'complete')(session, {
        authorization, plan, bundle, manifest, edge, promotion, providerSteps, health, receipt,
        productionReady: receipt.productionReady, runtimeReady: receipt.runtimeReady,
        idempotencyKey, now: clock,
      });
      return {
        operation: 'apply', target: 'hosted', ready: true, readOnly: false,
        productionReady: receipt.productionReady,
        profile: 'development', backup, receipt,
        plannedResources: plan.plannedResources ?? [],
        blockers: [],
      };
    } catch (error) {
      if (prepared) {
        try {
          await requireMethod(journalSession, 'fail')(session, {
            authorization, step: 'switch_release', code: failureCode(error), idempotencyKey,
            now: currentTrustedTime(clock),
          });
        } catch {
          // The prepared state is already incomplete and cannot be read as installed.
        }
      }
      if (promotionStarted) throw failure('INSTALL_POST_PROMOTION_FAILED');
      throw error;
    }
  });
}
