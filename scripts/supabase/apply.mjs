import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';

import {
  parseArtifactBasename,
  requireExpectedTuple,
  verifyReleaseBundle,
  verifyReleaseManifest,
} from '../release/release-manifest.mjs';
import { verifyEdgeComponentManifest } from '../release/edge-component-manifest.mjs';
import { createReleaseFloorStore } from '../release/release-floor.mjs';
import { fetchPinnedRelease, PINNED_RELEASE_ORIGIN } from '../release/release-origin.mjs';
import { loadReleaseTrustStore } from '../release/release-trust.mjs';
import {
  applyJournaledMigration,
  bootstrapInstall,
  completeInstallStep,
  ensureAuthorization,
  readInstallState,
  recordInstallFailure,
  startInstallStep,
  withInstallLock,
} from './install-journal.mjs';
import {
  assertAuthorizationMatches,
  readStrictJsonDocument,
} from './manifest-preflight.mjs';
import { assertProviderBaselineCurrent, installationStateFingerprint } from './plan.mjs';

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function emptyBackupEvidence() {
  return {
    businessTableCount: 0,
    businessRowCount: 0,
    authUserCount: 0,
    bucketCount: 0,
    storageObjectCount: 0,
    publicRoutineCount: 0,
    publicTypeCount: 0,
    privateInstallerTableCount: 0,
    installJournalCount: 0,
  };
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

function isResumeCandidate(plan) {
  return plan?.installed?.state === 'installing'
    && (plan.ready === true
      || (plan.ready === false
        && Array.isArray(plan.blockers)
        && plan.blockers.length === 1
        && plan.blockers[0]?.code === 'DRIFT_BLOCKED'));
}

function resumedBackup(plan, observation, authorization) {
  if (!isResumeCandidate(plan)
    || observation?.installState?.journal?.phase !== 'installing') {
    throw failure('BACKUP_FAILED');
  }
  const evidence = emptyBackupEvidence();
  const expected = backupEvidenceDigests(evidence);
  const step = observation.installState.completedSteps?.find(item => item?.step === 'prepare_backup');
  if (step === undefined
    || JSON.stringify(step.ownershipTags) !== JSON.stringify([
      `ccc.installation_id=${authorization.installationId}`,
    ])
    || JSON.stringify(step.providerResourceIdHashes) !== JSON.stringify(expected.ids)
    || JSON.stringify(step.providerResourceDigests) !== JSON.stringify(expected.digests)) {
    throw failure('BACKUP_FAILED');
  }
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

function requireMigrationComponents(edge, plan) {
  if (!Array.isArray(edge?.components) || edge.components.length === 0) {
    throw failure('EDGE_COMPONENT_SET_MISMATCH');
  }
  if (edge.components.some(component => component?.kind !== 'migration')) {
    throw failure('EDGE_COMPONENT_DEPLOYER_UNAVAILABLE');
  }
  const expected = plan.migrations?.map(migration => ({
    path: `migrations/${migration.id}`,
    artifactSha256: migration.checksum,
  }));
  if (!Array.isArray(expected) || expected.length !== edge.components.length
    || expected.some((item, index) => item.path !== edge.components[index]?.path
      || item.artifactSha256 !== edge.components[index]?.artifactSha256)) {
    throw failure('MIGRATION_CHECKSUM_MISMATCH');
  }
}

async function readVerifiedMigration(stagedRoot, component) {
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
    return bytes.toString('utf8');
  } finally {
    await file.close();
  }
}

const runFile = promisify(execFile);

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
  const trustedTime = new Date(fetched.trustedTime);
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
    now: trustedTime,
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
    await mkdir(extractedRoot, { mode: 0o700 });
    await runFile('/usr/bin/tar', ['-xzf', artifactPath, '-C', extractedRoot], {
      env: { COPYFILE_DISABLE: '1', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', PATH: '/usr/bin:/bin' },
    });
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
    async promote(input) {
      if (typeof promote === 'function') return promote(input);
      if (typeof authorize !== 'function' || typeof inspector?.inspect !== 'function'
        || edgeManifest === undefined) throw failure('RELEASE_PREREQUISITES_MISSING');
      for (const [index, component] of edgeManifest.components.entries()) {
        const planned = input.plan.migrations[index];
        await applyJournaledMigration(input.session, input.authorization, {
          id: planned.id,
          checksum: planned.checksum,
          sql: await readVerifiedMigration(stagedRoot, component),
        }, { authorize });
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

async function recordInstalled(session, input, authorize) {
  const {
    authorization, plan, bundle, promotion, health, receipt, now,
  } = input;
  const stateFingerprint = health?.stateFingerprint;
  const schemaFingerprint = promotion?.databaseFingerprint;
  const observedOwnerOrgIdHash = health?.observedOwnerOrgIdHash;
  const migrationHead = plan.migrations?.at(-1)?.id;
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
  const edgeRegionEvidence = JSON.stringify({
    requestedRegion: 'ap-northeast-2',
    responseRegion: promotion.responseRegion,
    functionRegion: 'not_run',
    mismatch: true,
    profile: 'development',
    backup: receipt.backup.backup,
    backupEvidence: receipt.backup.evidence,
  });
  const providerResourceDigests = JSON.stringify(promotion?.providerResourceDigests ?? {});
  await requireFreshAuthorization(authorization, plan, authorize, now);
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
      bundle.sequence,
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
    await requireFreshAuthorization(authorization, plan, authorize, now);
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
      if (input.resume) {
        const state = await readInstallState(session, authorization.installationId);
        if (state?.journal?.phase !== 'installing') throw failure('INSTALL_JOURNAL_INVALID');
        await ensureAuthorization(session, authorization, {
          resourcesSha256: input.plan.resourcesSha256,
          migrationsSha256: input.plan.migrationsSha256,
          planFingerprint: state.journal.planFingerprint,
        }, { authorize });
      } else {
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
      }
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

export async function applyInstallation({
  authorization,
  providerBaseline,
  plan,
  release,
  inspector,
  journalSession,
  now,
}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw failure('TRUSTED_TIME_UNAVAILABLE');
  if (plan?.installed?.state === 'not-installed' ? plan.ready !== true : !isResumeCandidate(plan)) {
    throw failure('BACKUP_FAILED');
  }

  const bundle = await requireMethod(release, 'verifyBundle')({ authorization, providerBaseline, plan, now });
  const manifest = await requireMethod(release, 'verifyManifest')({ bundle, authorization, plan, now });
  await requireMethod(release, 'verifyTuple')({ bundle, manifest, authorization, plan, now });
  await requireMethod(release, 'verifyArtifactHash')({ bundle, manifest, authorization, plan, now });
  const edge = await requireMethod(release, 'verifyEdgeComponentSet')({ bundle, manifest, authorization, plan, now });
  requireMigrationComponents(edge, plan);
  assertProviderBaselineCurrent(providerBaseline, authorization, now);

  const withInstallLock = requireMethod(journalSession, 'withInstallLock');
  return withInstallLock(async session => {
    assertProviderBaselineCurrent(providerBaseline, authorization, now);
    const observation = await requireMethod(inspector, 'revalidate')(plan, session);
    const resume = plan.installed.state === 'installing';
    const backup = resume
      ? resumedBackup(plan, observation, authorization)
      : firstInstallBackup(plan, observation);
    const idempotencyKey = createHash('sha256')
      .update(authorization.installationId)
      .update(bundle.bundleId)
      .update(manifest.artifactSha256)
      .update(edge.edgeArtifactSha256)
      .digest('hex');
    let prepared = false;
    let promotionStarted = false;
    try {
      await requireMethod(journalSession, 'prepare')(session, {
        authorization, providerBaseline, plan, bundle, manifest, edge, backup,
        idempotencyKey, now, resume,
      });
      prepared = true;
      promotionStarted = true;
      const promotion = await requireMethod(release, 'promote')({
        session, authorization, providerBaseline, plan, bundle, manifest, edge, backup, now,
      });
      await requireMethod(journalSession, 'promoted')(session, {
        authorization, plan, bundle, manifest, edge, promotion, idempotencyKey, now,
      });
      const health = await requireMethod(inspector, 'health')({
        session, authorization, providerBaseline, plan, bundle, manifest, edge, promotion, now,
      });
      if (health?.healthy !== true
        || health.observedOwnerOrgIdHash !== authorization.expectedOwnerOrgIdHash) {
        throw failure('HEALTH_FAILED');
      }
      const receipt = {
        profile: 'development',
        bundleId: bundle.bundleId,
        releaseVersion: bundle.version,
        releaseSequence: bundle.sequence,
        manifestDigest: manifest.manifestSha256 ?? manifest.artifactSha256,
        artifactSetDigest: promotion?.artifactSetDigest ?? edge.edgeArtifactSha256,
        edgeArtifactSha256: edge.edgeArtifactSha256,
        backup,
      };
      await requireMethod(journalSession, 'complete')(session, {
        authorization, plan, bundle, manifest, edge, promotion, health, receipt, idempotencyKey, now,
      });
      return {
        operation: 'apply', target: 'hosted', ready: true, readOnly: false, productionReady: false,
        profile: 'development', backup, receipt,
        plannedResources: plan.plannedResources ?? [],
        blockers: [],
      };
    } catch (error) {
      if (prepared) {
        try {
          await requireMethod(journalSession, 'fail')(session, {
            authorization, step: 'switch_release', code: failureCode(error), idempotencyKey, now,
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
