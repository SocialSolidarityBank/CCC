import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, lstat, open, realpath, unlink } from 'node:fs/promises';
import { basename, dirname, posix, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as verifier from '../../apps/community-cloud/dist/install-manifest-verifier.js';
import { createHostedInspector } from './hosted-inspector.mjs';
import {
  assertAuthorizationCurrent,
  configuredInstallTrust,
  readStrictJsonDocument,
  requireSignedOwnerPreflight,
} from './manifest-preflight.mjs';
import {
  BETA_TRUST_DOMAIN,
  PROVIDER_BASELINE_DOMAIN,
  requireProviderBaseline,
} from './provider-baseline.mjs';
import { providerInventoryFingerprint } from './provider-inventory.mjs';

const MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TRUST_STRING_BYTES = 1_024;
const MAX_SOURCE_RECORD_STRING_BYTES = 4_096;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const SOURCE_REVISION = /^[0-9a-f]{40}$/u;
const DATABASE_VERSION = /^[0-9]+(?:\.[0-9]+)*$/u;
const PUBLIC_KEY_BASE64 = /^[A-Za-z0-9+/]{43}=$/u;
const SIGNATURE_BASE64 = /^[A-Za-z0-9+/]{86}==$/u;
const FORBIDDEN_IDENTITY = /[\p{Cc}/\\]/u;
const SOURCE_URLS = new Set([
  'https://github.com/supabase/supabase',
  'https://github.com/supabase/postgres',
]);
const SOURCE_KINDS = new Set([
  'schema', 'relation', 'routine', 'type', 'catalog', 'column', 'default', 'role',
]);
const TRUST_UNSIGNED_KEYS = [
  'schemaVersion', 'profile', 'channel', 'provider', 'projectRefSha256',
  'ownerOrgIdSha256', 'region', 'rootKeyId', 'releaseKeyId', 'releasePublicKey',
  'notBefore', 'expiresAt',
].sort();
const SOURCE_EVIDENCE_KEYS = [
  'schemaVersion', 'provider', 'sourceRevision', 'databaseVersion', 'records',
].sort();
const SOURCE_RECORD_KEYS = [
  'kind', 'identitySha256', 'sourceUrl', 'sourcePath', 'sourceSha256',
].sort();
const EMPTY_BUSINESS_KEYS = [
  'userTableCount', 'userRowEstimate', 'authUserCount', 'bucketCount', 'storageObjectCount',
];
const OUTPUT_PATH_KEYS = ['baseline', 'releaseTrust'].sort();
const CLI_FLAGS = new Map([
  ['--source-evidence', 'sourceEvidenceInput'],
  ['--release-trust-output', 'releaseTrust'],
  ['--baseline-output', 'baseline'],
]);

class ProviderBaselineGenerationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProviderBaselineGenerationError';
    this.code = code;
  }
}

function fail(code = 'PROVIDER_BASELINE_INVALID') {
  throw new ProviderBaselineGenerationError(code);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join('\0') === keys.join('\0');
}

function boundedString(value) {
  return typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= MAX_TRUST_STRING_BYTES;
}

function boundedIdentity(value) {
  return boundedString(value) && value.length > 0 && !FORBIDDEN_IDENTITY.test(value);
}

function canonicalBase64(value, pattern, bytes) {
  return typeof value === 'string' && pattern.test(value)
    && Buffer.from(value, 'base64').byteLength === bytes
    && Buffer.from(value, 'base64').toString('base64') === value;
}

function validRootConfiguration(rootKeys, revokedRootKeyIds) {
  return isRecord(rootKeys) && Object.keys(rootKeys).length > 0
    && Object.entries(rootKeys).every(([keyId, key]) => (
      boundedIdentity(keyId) && canonicalBase64(key, PUBLIC_KEY_BASE64, 32)
    ))
    && Array.isArray(revokedRootKeyIds)
    && revokedRootKeyIds.every(boundedIdentity)
    && new Set(revokedRootKeyIds).size === revokedRootKeyIds.length;
}

function validUnsignedTrust(value, authorization, rootKeys, revokedRootKeyIds, now) {
  const notBefore = boundedString(value?.notBefore) ? Date.parse(value.notBefore) : Number.NaN;
  const expiresAt = boundedString(value?.expiresAt) ? Date.parse(value.expiresAt) : Number.NaN;
  return hasExactKeys(value, TRUST_UNSIGNED_KEYS)
    && value.schemaVersion === 1
    && value.profile === 'development'
    && value.channel === 'beta'
    && value.provider === 'supabase'
    && value.projectRefSha256 === authorization.projectRefHash
    && value.ownerOrgIdSha256 === authorization.expectedOwnerOrgIdHash
    && value.region === 'ap-northeast-2'
    && boundedIdentity(value.rootKeyId)
    && boundedIdentity(value.releaseKeyId)
    && canonicalBase64(value.releasePublicKey, PUBLIC_KEY_BASE64, 32)
    && Object.hasOwn(rootKeys, value.rootKeyId)
    && !revokedRootKeyIds.includes(value.rootKeyId)
    && !Number.isNaN(notBefore)
    && !Number.isNaN(expiresAt)
    && notBefore <= now.getTime()
    && now.getTime() < expiresAt
    && expiresAt > notBefore
    && expiresAt - notBefore <= MAX_LIFETIME_MS
    && expiresAt <= Date.parse(authorization.expiresAt);
}

function freshNow(clock) {
  let value;
  try {
    value = clock();
  } catch {
    fail('BETA_TRUST_INVALID');
  }
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) fail('BETA_TRUST_INVALID');
  return new Date(value.getTime());
}

function requireTrustCurrent(authorization, releaseTrustUnsigned, rootKeys, revokedRootKeyIds, clock) {
  const current = freshNow(clock);
  try {
    assertAuthorizationCurrent(authorization, { now: current });
    if (!validUnsignedTrust(
      releaseTrustUnsigned,
      authorization,
      rootKeys,
      revokedRootKeyIds,
      current,
    )) fail('BETA_TRUST_INVALID');
  } catch (error) {
    if (error instanceof ProviderBaselineGenerationError) throw error;
    fail('BETA_TRUST_INVALID');
  }
  return current;
}

async function signBytes(privateKey, bytes) {
  try {
    return Buffer.from(await crypto.subtle.sign('Ed25519', privateKey, bytes)).toString('base64');
  } catch {
    fail('BETA_TRUST_INVALID');
  }
}

async function verifyKeyPair(privateKey, publicKey) {
  const challenge = Buffer.from('CCC-BETA-PROVIDER-KEYPAIR-CHECK-V1\0', 'ascii');
  const signature = await signBytes(privateKey, challenge);
  return verifier.verifyEd25519Bytes(challenge, signature, publicKey);
}

async function signDomain(value, privateKey, domain) {
  const message = Buffer.concat([
    Buffer.from(domain, 'ascii'),
    Buffer.from(verifier.canonicalizeJcs(value), 'utf8'),
  ]);
  return { ...value, ed25519Signature: await signBytes(privateKey, message) };
}

async function verifySignedTrust(trust, rootPublicKey) {
  const { ed25519Signature, ...unsigned } = trust;
  if (!canonicalBase64(ed25519Signature, SIGNATURE_BASE64, 64)) return false;
  const message = Buffer.concat([
    Buffer.from(BETA_TRUST_DOMAIN, 'ascii'),
    Buffer.from(verifier.canonicalizeJcs(unsigned), 'utf8'),
  ]);
  return verifier.verifyEd25519Bytes(message, ed25519Signature, rootPublicKey);
}

function normalizedSourcePath(value) {
  return typeof value === 'string' && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= MAX_SOURCE_RECORD_STRING_BYTES
    && !posix.isAbsolute(value)
    && !/[\\\p{Cc}]/u.test(value)
    && posix.normalize(value) === value
    && value !== '.'
    && value !== '..'
    && !value.startsWith('../');
}

function validateSourceEvidenceShape(value) {
  if (!hasExactKeys(value, SOURCE_EVIDENCE_KEYS)
    || value.schemaVersion !== 1
    || value.provider !== 'supabase'
    || typeof value.sourceRevision !== 'string'
    || !SOURCE_REVISION.test(value.sourceRevision)
    || typeof value.databaseVersion !== 'string'
    || !DATABASE_VERSION.test(value.databaseVersion)
    || !Array.isArray(value.records)) fail();

  const identities = new Set();
  for (const record of value.records) {
    if (!hasExactKeys(record, SOURCE_RECORD_KEYS)
      || !SOURCE_KINDS.has(record.kind)
      || typeof record.identitySha256 !== 'string'
      || !SHA256_HEX.test(record.identitySha256)
      || !SOURCE_URLS.has(record.sourceUrl)
      || !normalizedSourcePath(record.sourcePath)
      || typeof record.sourceSha256 !== 'string'
      || !SHA256_HEX.test(record.sourceSha256)
      || identities.has(record.identitySha256)) fail();
    identities.add(record.identitySha256);
  }
  return value;
}

async function sourceIdentitySha256(record) {
  const { provenance: _provenance, ...identity } = record;
  return verifier.sha256Jcs(identity);
}

async function requireExactSourceMappings(evidence, inventory) {
  const expected = [
    ...inventory.objects.filter(record => record.provenance === 'supabase_managed'),
    ...inventory.grants.filter(record => record.provenance === 'supabase_managed'),
  ];
  if (evidence.records.length !== expected.length) fail();
  const mappings = new Map(evidence.records.map(record => [record.identitySha256, record]));
  for (const record of expected) {
    const mapping = mappings.get(await sourceIdentitySha256(record));
    if (mapping?.kind !== record.kind) fail();
  }
}

function validateOutputPaths(outputPaths) {
  if (!hasExactKeys(outputPaths, OUTPUT_PATH_KEYS)
    || !Object.values(outputPaths).every(path => typeof path === 'string' && path.length > 0)
    || resolve(outputPaths.releaseTrust) === resolve(outputPaths.baseline)) fail();
  return {
    releaseTrust: resolve(outputPaths.releaseTrust),
    baseline: resolve(outputPaths.baseline),
  };
}

function fileIdentity(info) {
  return Object.freeze({ device: info.dev, inode: info.ino });
}

function hasIdentity(info, identity) {
  return info.dev === identity.device && info.ino === identity.inode;
}

async function requireSafeAncestry(path) {
  const ancestors = [];
  for (let current = path; ; current = dirname(current)) {
    ancestors.push(current);
    if (dirname(current) === current) break;
  }
  for (const ancestor of ancestors.reverse()) {
    const info = await lstat(ancestor);
    if (!info.isDirectory() || info.isSymbolicLink()) fail();
  }
}

async function requireSafeDirectory(path) {
  try {
    await requireSafeAncestry(path);
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) fail();
    return info;
  } catch (error) {
    if (error instanceof ProviderBaselineGenerationError) throw error;
    fail();
  }
}

async function pathMustNotExist(output) {
  await requireSafeDirectory(output.directory);
  try {
    await lstat(output.path);
    fail();
  } catch (error) {
    if (error instanceof ProviderBaselineGenerationError) throw error;
    if (error?.code !== 'ENOENT') fail();
  }
  await requireSafeDirectory(output.directory);
}

async function prepareOutputPaths(paths) {
  const outputs = {};
  try {
    for (const [key, destination] of Object.entries(paths)) {
      const directory = await realpath(dirname(destination));
      const directoryIdentity = fileIdentity(await requireSafeDirectory(directory));
      outputs[key] = {
        path: resolve(directory, basename(destination)),
        directory,
        directoryIdentity,
      };
    }
    if (outputs.releaseTrust.path === outputs.baseline.path) fail();
    await Promise.all(Object.values(outputs).map(pathMustNotExist));
    return outputs;
  } catch (error) {
    if (error instanceof ProviderBaselineGenerationError) throw error;
    fail();
  }
}

async function assertKnownPath(record) {
  const directory = await lstat(record.directory);
  const info = await lstat(record.path);
  if (!directory.isDirectory() || directory.isSymbolicLink()
    || !hasIdentity(directory, record.directoryIdentity)
    || info.isSymbolicLink() || !info.isFile() || !hasIdentity(info, record.identity)) fail();
  return info;
}

async function removeKnownPath(record) {
  let directory;
  try {
    directory = await lstat(record.directory);
  } catch {
    return false;
  }
  if (!directory.isDirectory() || directory.isSymbolicLink()
    || !hasIdentity(directory, record.directoryIdentity)) return false;
  let info;
  try {
    info = await lstat(record.path);
  } catch (error) {
    return error?.code === 'ENOENT';
  }
  if (info.isSymbolicLink() || !info.isFile() || !hasIdentity(info, record.identity)) return false;
  try {
    await unlink(record.path);
    await lstat(record.path);
    return false;
  } catch (error) {
    return error?.code === 'ENOENT';
  }
}

async function cleanupKnownPaths(records) {
  let complete = true;
  for (const record of records) {
    if (!await removeKnownPath(record)) complete = false;
  }
  return complete;
}

async function writeOwnerOnlyTemp(output, contents) {
  const tempPath = resolve(output.directory, `.${basename(output.path)}.${randomUUID()}.tmp`);
  let handle;
  let created = false;
  let temp;
  try {
    await requireSafeDirectory(output.directory);
    handle = await open(
      tempPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    created = true;
    let info = await handle.stat();
    temp = {
      path: tempPath,
      directory: output.directory,
      directoryIdentity: output.directoryIdentity,
      identity: fileIdentity(info),
    };
    if (!info.isFile() || (info.mode & 0o777) !== 0o600) fail();
    await handle.writeFile(contents, 'utf8');
    await handle.chmod(0o600);
    await handle.sync();
    info = await handle.stat();
    if (!info.isFile() || !hasIdentity(info, temp.identity) || (info.mode & 0o777) !== 0o600) fail();
    await handle.close();
    handle = undefined;
    await assertKnownPath(temp);
    return temp;
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => {});
    const cleaned = !created || (temp !== undefined && await removeKnownPath(temp));
    if (!cleaned) fail('OUTPUT_CLEANUP_INCOMPLETE');
    if (error instanceof ProviderBaselineGenerationError) throw error;
    fail();
  }
}

// The output directory is an operator-controlled trust boundary. Node has no
// openat/unlinkat API, so cleanup is identity-checked and best effort rather
// than claiming safety against a principal concurrently renaming that directory.
async function installOutputs(outputs, documents, assertPublicationCurrent) {
  await Promise.all(Object.values(outputs).map(pathMustNotExist));
  const temps = {};
  const installed = [];
  try {
    temps.releaseTrust = await writeOwnerOnlyTemp(outputs.releaseTrust, documents.releaseTrust);
    temps.baseline = await writeOwnerOnlyTemp(outputs.baseline, documents.baseline);
    assertPublicationCurrent();
    for (const key of ['releaseTrust', 'baseline']) {
      const output = outputs[key];
      await assertKnownPath(temps[key]);
      await requireSafeDirectory(output.directory);
      await link(temps[key].path, output.path);
      const installedOutput = {
        path: output.path,
        directory: output.directory,
        directoryIdentity: output.directoryIdentity,
        identity: temps[key].identity,
      };
      installed.push(installedOutput);
      assertPublicationCurrent();
      const info = await lstat(output.path);
      if (info.isSymbolicLink() || !info.isFile() || !hasIdentity(info, installedOutput.identity)
        || (info.mode & 0o777) !== 0o600) fail();
    }
    if (!await cleanupKnownPaths(Object.values(temps))) fail('OUTPUT_CLEANUP_INCOMPLETE');
    assertPublicationCurrent();
  } catch (error) {
    const cleaned = await cleanupKnownPaths([...installed.reverse(), ...Object.values(temps)]);
    if (!cleaned) fail('OUTPUT_CLEANUP_INCOMPLETE');
    if (error instanceof ProviderBaselineGenerationError) throw error;
    fail();
  }
}

function stableObservation(observation, authorization, databaseVersion) {
  if (!isRecord(observation)
    || observation.project?.region !== 'ap-northeast-2'
    || observation.project?.ownerOrgIdHash !== authorization.expectedOwnerOrgIdHash
    || observation.project?.databaseVersion !== databaseVersion
    || observation.connection?.readOnly !== true
    || !isRecord(observation.state)
    || !EMPTY_BUSINESS_KEYS.every(key => observation.state[key] === 0)
    || !isRecord(observation.providerInventory)) fail('PROVIDER_BASELINE_MISMATCH');
  try {
    const computed = providerInventoryFingerprint(observation.providerInventory);
    if (computed.objectInventorySha256 !== observation.providerInventory.objectInventorySha256
      || computed.grantInventorySha256 !== observation.providerInventory.grantInventorySha256) {
      fail('PROVIDER_BASELINE_MISMATCH');
    }

  } catch {
    fail('PROVIDER_BASELINE_MISMATCH');
  }
  return observation;
}

function baselineVersion(databaseVersion, now) {
  const day = now.toISOString().slice(0, 10).replaceAll('-', '');
  return `supabase-hosted-pg${databaseVersion.split('.')[0]}-${day}-v1`;
}
async function verifyGeneratedDocuments(documents, rootKeys, revokedRootKeyIds, authorization, current) {
  try {
    return await requireProviderBaseline({
      releaseTrust: documents.releaseTrust,
      providerBaseline: documents.baseline,
      rootKeys,
      revokedRootKeyIds,
      authorization,
      manifestExpiresAt: authorization.expiresAt,
      now: current,
      verifier,
    });
  } catch {
    fail();
  }
}

export async function generateProviderBaseline({
  authorization,
  releaseTrustUnsigned,
  rootPrivateKey,
  releasePrivateKey,
  rootKeys,
  revokedRootKeyIds,
  sourceEvidenceInput,
  inspector,
  now,
  outputPaths,
}) {
  const paths = validateOutputPaths(outputPaths);
  const initialNow = freshNow(now);
  try {
    assertAuthorizationCurrent(authorization, { now: initialNow });
    if (!validRootConfiguration(rootKeys, revokedRootKeyIds)
      || !validUnsignedTrust(
        releaseTrustUnsigned,
        authorization,
        rootKeys,
        revokedRootKeyIds,
        initialNow,
      )
      || !await verifyKeyPair(rootPrivateKey, rootKeys[releaseTrustUnsigned.rootKeyId])
      || !await verifyKeyPair(releasePrivateKey, releaseTrustUnsigned.releasePublicKey)) {
      fail('BETA_TRUST_INVALID');
    }
  } catch (error) {
    if (error instanceof ProviderBaselineGenerationError) throw error;
    fail('BETA_TRUST_INVALID');
  }

  requireTrustCurrent(authorization, releaseTrustUnsigned, rootKeys, revokedRootKeyIds, now);
  const releaseTrust = await signDomain(releaseTrustUnsigned, rootPrivateKey, BETA_TRUST_DOMAIN);
  requireTrustCurrent(authorization, releaseTrustUnsigned, rootKeys, revokedRootKeyIds, now);
  if (!await verifySignedTrust(releaseTrust, rootKeys[releaseTrust.rootKeyId])) {
    fail('BETA_TRUST_INVALID');
  }

  let sourceEvidence;
  let outputs;
  try {
    sourceEvidence = validateSourceEvidenceShape(await readStrictJsonDocument(sourceEvidenceInput));
    outputs = await prepareOutputPaths(paths);
  } catch (error) {
    if (error instanceof ProviderBaselineGenerationError) throw error;
    fail();
  }

  let first;
  let second;
  try {
    if (typeof inspector?.inspect !== 'function') fail('PROVIDER_BASELINE_MISMATCH');
    requireTrustCurrent(authorization, releaseTrustUnsigned, rootKeys, revokedRootKeyIds, now);
    first = stableObservation(await inspector.inspect(), authorization, sourceEvidence.databaseVersion);
    requireTrustCurrent(authorization, releaseTrustUnsigned, rootKeys, revokedRootKeyIds, now);
    second = stableObservation(await inspector.inspect(), authorization, sourceEvidence.databaseVersion);
    requireTrustCurrent(authorization, releaseTrustUnsigned, rootKeys, revokedRootKeyIds, now);
  } catch (error) {
    if (error instanceof ProviderBaselineGenerationError) throw error;
    fail('PROVIDER_BASELINE_MISMATCH');
  }
  if (first.providerInventory.objectInventorySha256 !== second.providerInventory.objectInventorySha256
    || first.providerInventory.grantInventorySha256 !== second.providerInventory.grantInventorySha256) {
    fail('PROVIDER_BASELINE_MISMATCH');
  }
  await requireExactSourceMappings(sourceEvidence, first.providerInventory);

  const issuedAt = requireTrustCurrent(
    authorization,
    releaseTrustUnsigned,
    rootKeys,
    revokedRootKeyIds,
    now,
  );
  const emptyBusinessState = Object.fromEntries(EMPTY_BUSINESS_KEYS.map(key => [key, 0]));
  const sourceEvidenceSha256 = await verifier.sha256Jcs(sourceEvidence);
  const unsignedBaseline = {
    schemaVersion: 1,
    profile: 'development',
    channel: 'beta',
    provider: 'supabase',
    baselineVersion: baselineVersion(sourceEvidence.databaseVersion, issuedAt),
    projectRefSha256: authorization.projectRefHash,
    ownerOrgIdSha256: authorization.expectedOwnerOrgIdHash,
    region: 'ap-northeast-2',
    databaseVersion: sourceEvidence.databaseVersion,
    sourceRevision: sourceEvidence.sourceRevision,
    sourceEvidenceSha256,
    emptyBusinessState,
    objects: first.providerInventory.objects,
    grants: first.providerInventory.grants,
    objectInventorySha256: first.providerInventory.objectInventorySha256,
    grantInventorySha256: first.providerInventory.grantInventorySha256,
    issuedAt: issuedAt.toISOString(),
    expiresAt: releaseTrust.expiresAt,
    signingKeyId: releaseTrust.releaseKeyId,
  };
  requireTrustCurrent(authorization, releaseTrustUnsigned, rootKeys, revokedRootKeyIds, now);
  const providerBaseline = await signDomain(unsignedBaseline, releasePrivateKey, PROVIDER_BASELINE_DOMAIN);
  const documents = {
    releaseTrust: JSON.stringify(releaseTrust),
    baseline: JSON.stringify(providerBaseline),
  };

  const verificationNow = requireTrustCurrent(
    authorization,
    releaseTrustUnsigned,
    rootKeys,
    revokedRootKeyIds,
    now,
  );
  await verifyGeneratedDocuments(
    documents,
    rootKeys,
    revokedRootKeyIds,
    authorization,
    verificationNow,
  );
  const publicationNow = requireTrustCurrent(
    authorization,
    releaseTrustUnsigned,
    rootKeys,
    revokedRootKeyIds,
    now,
  );
  const verified = await verifyGeneratedDocuments(
    documents,
    rootKeys,
    revokedRootKeyIds,
    authorization,
    publicationNow,
  );
  requireTrustCurrent(authorization, releaseTrustUnsigned, rootKeys, revokedRootKeyIds, now);
  await installOutputs(outputs, documents, () => (
    requireTrustCurrent(authorization, releaseTrustUnsigned, rootKeys, revokedRootKeyIds, now)
  ));
  return {
    releaseTrustSha256: verified.releaseTrustSha256,
    baselineSha256: verified.baselineSha256,
    baselineVersion: verified.baselineVersion,
    objectCount: verified.objects.length,
    grantCount: verified.grants.length,
    sourceEvidenceSha256,
  };
}

function parseCliArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== CLI_FLAGS.size * 2) fail();
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const field = CLI_FLAGS.get(argv[index]);
    const value = argv[index + 1];
    if (field === undefined || Object.hasOwn(parsed, field)
      || typeof value !== 'string' || value.length === 0 || value.startsWith('--')) fail();
    parsed[field] = value;
  }
  if (Object.keys(parsed).length !== CLI_FLAGS.size) fail();
  return {
    sourceEvidenceInput: parsed.sourceEvidenceInput,
    outputPaths: { releaseTrust: parsed.releaseTrust, baseline: parsed.baseline },
  };
}

function decodeCanonicalPrivateKey(value) {
  if (typeof value !== 'string' || value.length === 0) fail('BETA_TRUST_INVALID');
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length === 0 || bytes.toString('base64') !== value) fail('BETA_TRUST_INVALID');
  return bytes;
}

async function importPrivateKey(value) {
  try {
    return await crypto.subtle.importKey(
      'pkcs8',
      decodeCanonicalPrivateKey(value),
      { name: 'Ed25519' },
      true,
      ['sign'],
    );
  } catch (error) {
    if (error instanceof ProviderBaselineGenerationError) throw error;
    fail('BETA_TRUST_INVALID');
  }
}

async function publicKeyFromPrivate(privateKey) {
  try {
    const { x } = await crypto.subtle.exportKey('jwk', privateKey);
    if (typeof x !== 'string') fail('BETA_TRUST_INVALID');
    return Buffer.from(x, 'base64url').toString('base64');
  } catch (error) {
    if (error instanceof ProviderBaselineGenerationError) throw error;
    fail('BETA_TRUST_INVALID');
  }
}

async function defaultCliInputs({ sourceEvidenceInput, outputPaths }, environment) {
  const issuedAt = new Date();
  const authorize = (current = new Date()) => requireSignedOwnerPreflight({
    installManifest: environment.CCC_INSTALL_MANIFEST,
    installApproval: environment.CCC_INSTALL_APPROVAL,
    trust: configuredInstallTrust({
      organizationId: environment.CCC_ORGANIZATION_ID,
      publicKeys: environment.CCC_INSTALL_SIGNING_KEYS,
      revokedKeyIds: environment.CCC_INSTALL_REVOKED_KEY_IDS,
    }),
    organizationId: environment.CCC_ORGANIZATION_ID,
    projectRef: environment.CCC_SUPABASE_PROJECT_REF,
    now: current,
  });
  const authorization = await authorize(issuedAt);
  const rootKeys = await readStrictJsonDocument(environment.CCC_BETA_TRUST_ROOT_KEYS);
  let revokedRootKeyIds;
  try {
    revokedRootKeyIds = JSON.parse(environment.CCC_BETA_REVOKED_ROOT_KEY_IDS ?? '[]');
  } catch {
    fail('BETA_TRUST_INVALID');
  }
  const rootPrivateKey = await importPrivateKey(environment.CCC_BETA_ROOT_SIGNING_PRIVATE_KEY);
  const releasePrivateKey = await importPrivateKey(environment.CCC_BETA_RELEASE_SIGNING_PRIVATE_KEY);
  const rootPublicKey = await publicKeyFromPrivate(rootPrivateKey);
  const releasePublicKey = await publicKeyFromPrivate(releasePrivateKey);
  const rootKeyIds = Object.entries(rootKeys)
    .filter(([, publicKey]) => publicKey === rootPublicKey)
    .map(([keyId]) => keyId);
  if (rootKeyIds.length !== 1) fail('BETA_TRUST_INVALID');
  const releaseKeyId = `beta-release-${createHash('sha256').update(releasePublicKey, 'base64').digest('hex').slice(0, 16)}`;
  const expiresAt = new Date(Math.min(
    Date.parse(authorization.expiresAt),
    issuedAt.getTime() + MAX_LIFETIME_MS,
  )).toISOString();
  return {
    authorization,
    releaseTrustUnsigned: {
      schemaVersion: 1,
      profile: 'development',
      channel: 'beta',
      provider: 'supabase',
      projectRefSha256: authorization.projectRefHash,
      ownerOrgIdSha256: authorization.expectedOwnerOrgIdHash,
      region: 'ap-northeast-2',
      rootKeyId: rootKeyIds[0],
      releaseKeyId,
      releasePublicKey,
      notBefore: issuedAt.toISOString(),
      expiresAt,
    },
    rootPrivateKey,
    releasePrivateKey,
    rootKeys,
    revokedRootKeyIds,
    sourceEvidenceInput,
    inspector: createHostedInspector({
      accessToken: environment.SUPABASE_ACCESS_TOKEN,
      projectRef: authorization.projectRef,
      authorization,
      authorize,
    }),
    now: () => new Date(),
    outputPaths,
  };
}

export async function runProviderBaselineCli(argv, {
  environment = process.env,
  stdout = process.stdout,
  stderr: _stderr = process.stderr,
  loadInputs = options => defaultCliInputs(options, environment),
} = {}) {
  try {
    const options = parseCliArgs(argv);
    const result = await generateProviderBaseline(await loadInputs(options));
    stdout.write(`${JSON.stringify({
      baselineVersion: result.baselineVersion,
      objectCount: result.objectCount,
      grantCount: result.grantCount,
      sourceEvidenceSha256: result.sourceEvidenceSha256,
      releaseTrustSha256: result.releaseTrustSha256,
      baselineSha256: result.baselineSha256,
    })}\n`);
    return 0;
  } catch {
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runProviderBaselineCli(process.argv.slice(2));
}
