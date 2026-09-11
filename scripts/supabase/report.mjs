import { constants } from 'node:fs';
import { link, lstat, open, realpath, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, dirname, resolve } from 'node:path';

const SHA256 = /^[a-f0-9]{64}$/u;
const DECIMAL = /^(0|[1-9][0-9]*)$/u;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const MODES = new Set(['community-cloud', 'local-single', 'local-office']);
const FAMILIES = new Set([
  'community-cloud-cli', 'local-single', 'local-office-server',
  'local-office-client', 'processing-agent',
]);
const CHANNELS = new Set(['stable', 'beta', 'dev']);
const STATUSES = new Set(['PASS', 'FAIL', 'NOT_RUN']);
const AUTHENTICODE = new Set(['valid', 'invalid', 'not_applicable']);
const FIXED_CODES = new Set([
  // S12 §7.2 release diagnostics.
  'MANIFEST_EXPIRED', 'TRUSTED_TIME_UNAVAILABLE', 'TRUSTED_TIME_ROLLBACK',
  'SIGNING_KEY_UNKNOWN', 'SIGNING_KEY_REVOKED', 'SIGNATURE_INVALID',
  'BUNDLE_SIGNATURE_INVALID', 'BUNDLE_ENTRY_INVALID', 'EDGE_COMPONENT_SET_MISMATCH',
  'EDGE_COMPONENT_DEPLOYER_UNAVAILABLE', 'EDGE_BUNDLE_LIMIT',
  'AUTHENTICODE_INVALID', 'ARTIFACT_IDENTITY_MISMATCH', 'ARTIFACT_NOT_INDEXED',
  'HASH_MISMATCH', 'SCHEMA_INCOMPATIBLE', 'DOWNGRADE_BLOCKED',
  'PEER_PROTOCOL_MISMATCH', 'MAINTENANCE_DRAIN_TIMEOUT', 'BACKUP_FAILED',
  'HEALTH_FAILED', 'RUNTIME_NOT_READY', 'ROLLBACK_FAILED', 'TRUST_UPDATE_INVALID',
  'MODEL_MANIFEST_INVALID', 'SBOM_MISSING', 'LICENSE_EVIDENCE_MISSING',
  'RESTORE_DRILL_MISSING', 'CREDENTIAL_MISSING', 'CREDENTIAL_INVALID',
  'CREDENTIAL_INSUFFICIENT',
  // Stable codes emitted by the current Supabase plan/doctor contract.
  'PROJECT_REF_MISSING', 'PROVIDER_UNREADABLE', 'LOCAL_SUPABASE_UNAVAILABLE',
  'OUTPUT_REDACTION_FAILED', 'OPERATION_UNSUPPORTED', 'TARGET_UNSUPPORTED',
  'OWNER_EVIDENCE_MISSING', 'MANIFEST_VERIFIER_UNAVAILABLE',
  'MIGRATION_CHECKSUM_MISMATCH', 'CA_TRUST_UNAVAILABLE', 'BETA_TRUST_INVALID',
  'PROVIDER_BASELINE_INVALID', 'PROVIDER_BASELINE_MISMATCH', 'OWNER_MISMATCH',
  'INSTALL_AUTHORIZATION_MISMATCH', 'INSTALL_LOCK_BUSY',
  'RESOURCE_OWNERSHIP_MISMATCH', 'PLAN_STATE_CHANGED', 'DRIFT_DETECTED',
  'DRIFT_BLOCKED', 'INSTALL_NOT_FOUND', 'INSTALL_INCOMPLETE',
  'RELEASE_PREREQUISITES_MISSING', 'ROLLBACK_PREREQUISITES_MISSING',
  'INSTALL_JOURNAL_INVALID', 'INSTALL_JOURNAL_MISSING', 'INSTALL_STEP_MISMATCH',
  'MIGRATION_APPLY_FAILED', 'REGION_UNVERIFIED', 'REGION_MISMATCH',
  'EXISTING_PROJECT_NOT_CLEAN', 'CONNECTION_NOT_READ_ONLY',
  'STATE_CHANGED_DURING_PLAN',
]);
const REPORT_KEYS = [
  'artifacts', 'channel', 'checks', 'family', 'generatedAt', 'installedSequence',
  'installedVersion', 'mode', 'redaction', 'schemaVersion',
].sort();
const CHECK_KEYS = ['code', 'name', 'status'].sort();
const ARTIFACT_KEYS = ['authenticode', 'sequence', 'sha256', 'signingKeyId', 'version'].sort();
const REDACTION_KEYS = ['algorithm', 'scope', 'secrets', 'urls'].sort();

const RECEIPT_REJECTION_CODES = new Set([
  'INSTALL_AUTHORIZATION_MISMATCH', 'INSTALL_INCOMPLETE', 'INSTALL_JOURNAL_INVALID',
  'INSTALL_JOURNAL_MISSING', 'MIGRATION_CHECKSUM_MISMATCH', 'OWNER_MISMATCH',
  'RESOURCE_OWNERSHIP_MISMATCH', 'PLAN_STATE_CHANGED', 'DRIFT_DETECTED',
  'DRIFT_BLOCKED', 'CONNECTION_NOT_READ_ONLY', 'PROVIDER_BASELINE_MISMATCH',
]);
const FORBIDDEN_OUTPUT = [
  /https?:\/\//iu,
  /postgres(?:ql)?:\/\//iu,
  /\bsbp_[A-Za-z0-9_-]+\b/u,
  /\bsb_(?:secret|service_role)_[A-Za-z0-9_-]+\b/iu,
  /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/u,
  /"(?:ed25519Signature|releasePublicKey|objects|grants)"\s*:/iu,
];
export class ReportFailure extends Error {
  constructor() {
    super('안전한 출력 형식을 만들지 못했습니다.');
    this.name = 'ReportFailure';
    this.code = 'OUTPUT_REDACTION_FAILED';
  }
}

function fail() {
  throw new ReportFailure();
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join('\0') === keys.join('\0');
}


export function assertSafeOutput(text) {
  if (typeof text !== 'string' || FORBIDDEN_OUTPUT.some(pattern => pattern.test(text))) fail();
}
function validSequence(value) {
  if (typeof value !== 'string' || !DECIMAL.test(value)) return false;
  try {
    const parsed = BigInt(value);
    return parsed > 0n && parsed <= MAX_UINT64;
  } catch {
    return false;
  }
}

function channelFor(version) {
  const prerelease = typeof version === 'string' ? SEMVER.exec(version)?.[4] : undefined;
  if (prerelease === undefined) return typeof version === 'string' && SEMVER.test(version) ? 'stable' : null;
  const channel = prerelease.split('.')[0];
  return channel === 'beta' || channel === 'dev' ? channel : null;
}

function matchingReceipt(receipt, journal, history) {
  if (!isRecord(receipt) || !isRecord(journal) || !Array.isArray(history)
    || journal.phase !== 'installed' || receipt.status !== 'installed'
    || receipt.contract !== 'S11' || receipt.contractVersion !== '0.3'
    || receipt.installationId !== journal.installationId
    || typeof receipt.releaseVersion !== 'string'
    || channelFor(receipt.releaseVersion) === null
    || !Number.isSafeInteger(receipt.releaseSequence) || receipt.releaseSequence <= 0
    || !SHA256.test(receipt.manifestDigest ?? '')
    || !SHA256.test(receipt.artifactSetDigest ?? '')) return null;
  const latest = history.at(-1);
  if (!isRecord(latest)
    || latest.installationId !== receipt.installationId
    || latest.releaseVersion !== receipt.releaseVersion
    || latest.releaseSequence !== receipt.releaseSequence
    || latest.manifestDigest !== receipt.manifestDigest
    || latest.artifactSetDigest !== receipt.artifactSetDigest
    || latest.status !== 'installed') return null;
  return {
    version: receipt.releaseVersion,
    sequence: String(receipt.releaseSequence),
    channel: channelFor(receipt.releaseVersion),
  };
}

function validDoctorEnvelope(doctor) {
  return isRecord(doctor)
    && doctor.operation === 'doctor'
    && doctor.readOnly === true
    && typeof doctor.ready === 'boolean'
    && Array.isArray(doctor.blockers);
}

function installationMetadata(doctor, ledger) {
  if (!validDoctorEnvelope(doctor)) return { state: 'invalid' };
  if (ledger === null && doctor.installed?.state === 'not-installed') return { state: 'not-installed' };
  if (!isRecord(ledger) || doctor.installed?.state !== 'installed'
    || doctor.blockers.some(blocker =>
      isRecord(blocker) && RECEIPT_REJECTION_CODES.has(blocker.code))) return { state: 'invalid' };
  const release = matchingReceipt(ledger.currentReceipt, ledger.journal, ledger.releaseHistory);
  return release === null ? { state: 'invalid' } : { state: 'installed', ...release };
}

function installationFailureCode(doctor, installation) {
  if (installation.state === 'not-installed') return 'INSTALL_NOT_FOUND';
  const codes = Array.isArray(doctor?.blockers)
    ? doctor.blockers.flatMap(blocker => isRecord(blocker) ? [blocker.code] : [])
    : [];
  return [
    'INSTALL_INCOMPLETE', 'INSTALL_JOURNAL_INVALID', 'INSTALL_JOURNAL_MISSING',
    'INSTALL_AUTHORIZATION_MISMATCH', 'MIGRATION_CHECKSUM_MISMATCH',
    'RESOURCE_OWNERSHIP_MISMATCH', 'OWNER_MISMATCH', 'DRIFT_DETECTED',
    'DRIFT_BLOCKED', 'PLAN_STATE_CHANGED', 'CONNECTION_NOT_READ_ONLY',
    'PROVIDER_BASELINE_MISMATCH',
  ].find(code => codes.includes(code)) ?? 'HEALTH_FAILED';
}

function doctorChecks(doctor, installation) {
  const installationCode = installationFailureCode(doctor, installation);
  const installationCheck = installation.state === 'installed'
    ? { name: 'installation', status: 'PASS', code: null }
    : installation.state === 'not-installed'
      ? { name: 'installation', status: 'NOT_RUN', code: installationCode }
      : { name: 'installation', status: 'FAIL', code: installationCode };
  if (!validDoctorEnvelope(doctor)) {
    return [installationCheck, { name: 'doctor', status: 'FAIL', code: 'HEALTH_FAILED' }];
  }

  const recognized = [...new Set(doctor.blockers.flatMap(blocker =>
    isRecord(blocker) && FIXED_CODES.has(blocker.code) ? [blocker.code] : []))].sort();
  const hasUnknown = doctor.blockers.some(blocker => !isRecord(blocker) || !FIXED_CODES.has(blocker.code));
  if (doctor.ready === true && doctor.blockers.length === 0 && installation.state === 'installed') {
    return [installationCheck, { name: 'doctor', status: 'PASS', code: null }];
  }
  const failures = recognized
    .filter(code => code !== installationCheck.code)
    .map(code => ({ name: code, status: 'FAIL', code }));
  if (hasUnknown || doctor.blockers.length === 0) {
    failures.push({ name: 'doctor', status: installation.state === 'not-installed' ? 'NOT_RUN' : 'FAIL', code: 'HEALTH_FAILED' });
  }
  return [installationCheck, ...failures];
}

/**
 * Builds only RedactedReportV1 allowlisted fields from buildSupabaseDoctor and
 * readInstallState results. No report-local identifiers are emitted, so nonce
 * is intentionally not persisted or used to manufacture an ID.
 */
export function buildRedactedReport({ doctor, ledger, nonce: _nonce }) {
  const installation = installationMetadata(doctor, ledger);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'community-cloud',
    family: 'community-cloud-cli',
    installedVersion: installation.state === 'installed' ? installation.version : '',
    installedSequence: installation.state === 'installed' ? installation.sequence : '',
    channel: installation.state === 'installed' ? installation.channel : 'dev',
    checks: doctorChecks(doctor, installation),
    // Current install receipts carry aggregate digests, not a signing key or
    // Authenticode result. Do not mislabel an aggregate digest as an artifact.
    artifacts: [],
    redaction: {
      algorithm: 'hmac-sha256',
      scope: 'report-local',
      secrets: 'omitted',
      urls: 'omitted',
    },
  };
  assertSafeOutput(JSON.stringify(report));
  return report;
}

function safeReport(value) {
  if (!exactKeys(value, REPORT_KEYS)) fail();
  const report = {
    schemaVersion: value.schemaVersion,
    generatedAt: value.generatedAt,
    mode: value.mode,
    family: value.family,
    installedVersion: value.installedVersion,
    installedSequence: value.installedSequence,
    channel: value.channel,
    checks: Array.isArray(value.checks) ? value.checks.map(check => ({
      name: check?.name,
      status: check?.status,
      code: check?.code,
    })) : null,
    artifacts: Array.isArray(value.artifacts) ? value.artifacts.map(artifact => ({
      version: artifact?.version,
      sequence: artifact?.sequence,
      sha256: artifact?.sha256,
      signingKeyId: artifact?.signingKeyId,
      authenticode: artifact?.authenticode,
    })) : null,
    redaction: isRecord(value.redaction) ? {
      algorithm: value.redaction.algorithm,
      scope: value.redaction.scope,
      secrets: value.redaction.secrets,
      urls: value.redaction.urls,
    } : null,
  };
  const timestamp = typeof report.generatedAt === 'string' ? Date.parse(report.generatedAt) : Number.NaN;
  if (report.schemaVersion !== 1 || !Number.isFinite(timestamp)
    || new Date(timestamp).toISOString() !== report.generatedAt
    || !MODES.has(report.mode) || !FAMILIES.has(report.family) || !CHANNELS.has(report.channel)
    || typeof report.installedVersion !== 'string' || typeof report.installedSequence !== 'string'
    || ((report.installedVersion === '') !== (report.installedSequence === ''))
    || (report.installedVersion !== ''
      && (channelFor(report.installedVersion) !== report.channel || !validSequence(report.installedSequence)))
    || !Array.isArray(report.checks) || report.checks.length === 0
    || report.checks.some((check, index) => !exactKeys(value.checks[index], CHECK_KEYS)
      || !(check.name === 'installation' || check.name === 'doctor' || FIXED_CODES.has(check.name))
      || !STATUSES.has(check.status)
      || (check.status === 'PASS' ? check.code !== null : !FIXED_CODES.has(check.code))
      || (FIXED_CODES.has(check.name) && check.name !== check.code))
    || !Array.isArray(report.artifacts)
    || report.artifacts.some((artifact, index) => !exactKeys(value.artifacts[index], ARTIFACT_KEYS)
      || channelFor(artifact.version) !== report.channel || !validSequence(artifact.sequence)
      || !SHA256.test(artifact.sha256 ?? '') || !KEY_ID.test(artifact.signingKeyId ?? '')
      || !AUTHENTICODE.has(artifact.authenticode))
    || !exactKeys(value.redaction, REDACTION_KEYS)
    || report.redaction.algorithm !== 'hmac-sha256' || report.redaction.scope !== 'report-local'
    || report.redaction.secrets !== 'omitted' || report.redaction.urls !== 'omitted') fail();
  return report;
}

function identity(info) {
  return { dev: info.dev, ino: info.ino };
}

function sameIdentity(info, expected) {
  return info.dev === expected.dev && info.ino === expected.ino;
}

async function safeOperatorDirectory(path) {
  const requested = resolve(path);
  const requestedInfo = await lstat(requested);
  const canonical = await realpath(requested);
  const info = await lstat(canonical);
  const uid = process.getuid();
  if (!requestedInfo.isDirectory() || requestedInfo.isSymbolicLink()
    || !info.isDirectory() || info.isSymbolicLink()
    || !sameIdentity(requestedInfo, identity(info))
    || info.uid !== uid || (info.mode & 0o022) !== 0) fail();
  return { path: canonical, identity: identity(info), uid };
}

async function requireDirectory(record) {
  const info = await lstat(record.path);
  if (!info.isDirectory() || info.isSymbolicLink() || !sameIdentity(info, record.identity)
    || info.uid !== record.uid || (info.mode & 0o022) !== 0) fail();
}

async function unlinkKnown(path, expected, directory) {
  try {
    await requireDirectory(directory);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || !sameIdentity(info, expected)) return false;
    await unlink(path);
    return true;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

/**
 * Atomically publishes a new 0600 report on a verified POSIX owner boundary.
 * operatorDirectory must exist; outputPath must be its direct child.
 */
export async function writeRedactedReport({ report, outputPath, operatorDirectory }) {
  let document;
  try {
    document = `${JSON.stringify(safeReport(report), null, 2)}\n`;
  } catch (error) {
    if (error instanceof ReportFailure) throw error;
    fail();
  }
  assertSafeOutput(document);
  if (typeof outputPath !== 'string' || typeof operatorDirectory !== 'string') fail();
  if (process.platform === 'win32' || typeof process.getuid !== 'function') fail();

  let directory;
  let destination;
  let tempPath;
  let handle;
  let tempCreated = false;
  let tempIdentity;
  let destinationIdentity;
  try {
    directory = await safeOperatorDirectory(operatorDirectory);
    const requestedDestination = resolve(outputPath);
    if (await realpath(dirname(requestedDestination)) !== directory.path) fail();
    destination = resolve(directory.path, basename(requestedDestination));
    try {
      await lstat(destination);
      fail();
    } catch (error) {
      if (error instanceof ReportFailure) throw error;
      if (error?.code !== 'ENOENT') fail();
    }

    tempPath = resolve(directory.path, `.${basename(destination)}.${randomUUID()}.tmp`);
    await requireDirectory(directory);
    handle = await open(
      tempPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    tempCreated = true;
    let info = await handle.stat();
    tempIdentity = identity(info);
    const uid = process.getuid();
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600
      || info.uid !== uid) fail();
    await handle.writeFile(document, 'utf8');
    await handle.chmod(0o600);
    await handle.sync();
    info = await handle.stat();
    if (!info.isFile() || !sameIdentity(info, tempIdentity) || (info.mode & 0o777) !== 0o600) fail();
    await handle.close();
    handle = undefined;

    await requireDirectory(directory);
    await link(tempPath, destination);
    destinationIdentity = tempIdentity;
    info = await lstat(destination);
    if (!info.isFile() || info.isSymbolicLink() || !sameIdentity(info, destinationIdentity)
      || (info.mode & 0o777) !== 0o600) fail();
    if (!await unlinkKnown(tempPath, tempIdentity, directory)) fail();
    tempIdentity = undefined;
    const directoryHandle = await open(directory.path, 'r');
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    if (handle !== undefined) {
      if (tempIdentity === undefined) {
        try {
          tempIdentity = identity(await handle.stat());
        } catch {}
      }
      await handle.close().catch(() => {});
    }
    if (destinationIdentity !== undefined) await unlinkKnown(destination, destinationIdentity, directory);
    if (tempIdentity !== undefined) await unlinkKnown(tempPath, tempIdentity, directory);
    else if (tempCreated) await unlink(tempPath).catch(() => {});
    if (error instanceof ReportFailure) throw error;
    fail();
  }
}
