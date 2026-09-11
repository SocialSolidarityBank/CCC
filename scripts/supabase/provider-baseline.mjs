import { Buffer } from 'node:buffer';
import { isDeepStrictEqual } from 'node:util';
import { readStrictJsonDocument } from './manifest-preflight.mjs';

export const BETA_TRUST_DOMAIN = 'CCC-BETA-TRUST-ROOT-V1\0';
export const PROVIDER_BASELINE_DOMAIN = 'CCC-SUPABASE-PROVIDER-BASELINE-V1\0';

const MAX_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_RECORD_STRING_BYTES = 1_024;
const MAX_OBJECTS = 5_000;
const MAX_GRANTS = 20_000;
const SHA256_HEX = /^[a-f0-9]{64}$/u;
const SOURCE_REVISION = /^[a-f0-9]{40}$/u;
const DATABASE_VERSION = /^[0-9]+(?:\.[0-9]+)*$/u;
const PUBLIC_KEY_BASE64 = /^[A-Za-z0-9+/]{43}=$/u;
const SIGNATURE_BASE64 = /^[A-Za-z0-9+/]{86}==$/u;
const FORBIDDEN_IDENTITY = /[\p{Cc}/\\]/u;
const TRUST_KEYS = [
  'schemaVersion', 'profile', 'channel', 'provider', 'projectRefSha256',
  'ownerOrgIdSha256', 'region', 'rootKeyId', 'releaseKeyId', 'releasePublicKey',
  'notBefore', 'expiresAt', 'ed25519Signature',
].sort();
const BASELINE_KEYS = [
  'schemaVersion', 'profile', 'channel', 'provider', 'baselineVersion',
  'projectRefSha256', 'ownerOrgIdSha256', 'region', 'databaseVersion',
  'sourceRevision', 'sourceEvidenceSha256', 'emptyBusinessState', 'objects',
  'grants', 'objectInventorySha256', 'grantInventorySha256', 'issuedAt',
  'expiresAt', 'signingKeyId', 'ed25519Signature',
].sort();
const EMPTY_BUSINESS_STATE_KEYS = [
  'userTableCount', 'userRowEstimate', 'authUserCount', 'bucketCount',
  'storageObjectCount',
].sort();
const OBJECT_KEYS = [
  'kind', 'schema', 'identity', 'owner', 'definitionSha256', 'provenance',
].sort();
const GRANT_KEYS = [
  'kind', 'schema', 'objectIdentity', 'grantor', 'grantee', 'privilege',
  'grantable', 'inheritOption', 'setOption', 'provenance',
].sort();
const OBJECT_KINDS = new Set(['schema', 'relation', 'routine', 'type', 'catalog']);
const OBJECT_PROVENANCE = new Set(['extension', 'initial_privilege', 'supabase_managed']);
const GRANT_KINDS = new Set(['schema', 'relation', 'column', 'routine', 'type', 'default', 'role']);
const GRANT_PROVENANCE = new Set(['initial_privilege', 'supabase_managed']);

class ProviderBaselineError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ProviderBaselineError';
    this.code = code;
  }
}

function fail(code) {
  throw new ProviderBaselineError(code);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  return isRecord(value) && Object.keys(value).sort().join('\0') === keys.join('\0');
}

function isCanonicalBase64(value, pattern, byteLength) {
  return typeof value === 'string' && pattern.test(value)
    && Buffer.from(value, 'base64').byteLength === byteLength
    && Buffer.from(value, 'base64').toString('base64') === value;
}

function isBoundedString(value, { nonempty = false, identity = false } = {}) {
  return typeof value === 'string'
    && (!nonempty || value.length > 0)
    && Buffer.byteLength(value, 'utf8') <= MAX_RECORD_STRING_BYTES
    && (!identity || !FORBIDDEN_IDENTITY.test(value));
}

function parseInstant(value) {
  return isBoundedString(value) ? Date.parse(value) : Number.NaN;
}

function validLifetime(start, expires, now) {
  return !Number.isNaN(start) && !Number.isNaN(expires)
    && start <= now && now < expires && expires > start
    && expires - start <= MAX_LIFETIME_MS;
}

function validExternalTrust(rootKeys, revokedRootKeyIds) {
  return isRecord(rootKeys) && Object.keys(rootKeys).length > 0
    && Object.entries(rootKeys).every(([keyId, publicKey]) => (
      isBoundedString(keyId, { nonempty: true, identity: true })
      && isCanonicalBase64(publicKey, PUBLIC_KEY_BASE64, 32)
    ))
    && Array.isArray(revokedRootKeyIds)
    && revokedRootKeyIds.every(keyId => isBoundedString(keyId, { nonempty: true, identity: true }))
    && new Set(revokedRootKeyIds).size === revokedRootKeyIds.length;
}

function validAuthorization(authorization) {
  return isRecord(authorization)
    && typeof authorization.projectRefHash === 'string'
    && SHA256_HEX.test(authorization.projectRefHash)
    && typeof authorization.expectedOwnerOrgIdHash === 'string'
    && SHA256_HEX.test(authorization.expectedOwnerOrgIdHash)
    && !Number.isNaN(parseInstant(authorization.expiresAt));
}

function validEmptyBusinessState(value) {
  return hasExactKeys(value, EMPTY_BUSINESS_STATE_KEYS)
    && EMPTY_BUSINESS_STATE_KEYS.every(key => value[key] === 0);
}

function validObjectRecord(value) {
  return hasExactKeys(value, OBJECT_KEYS)
    && OBJECT_KINDS.has(value.kind)
    && OBJECT_PROVENANCE.has(value.provenance)
    && isBoundedString(value.schema)
    && isBoundedString(value.identity, { nonempty: true, identity: true })
    && isBoundedString(value.owner)
    && typeof value.definitionSha256 === 'string'
    && SHA256_HEX.test(value.definitionSha256);
}

function validGrantRecord(value) {
  const roleMembership = value?.kind === 'role';
  return hasExactKeys(value, GRANT_KEYS)
    && GRANT_KINDS.has(value.kind)
    && GRANT_PROVENANCE.has(value.provenance)
    && isBoundedString(value.schema)
    && isBoundedString(value.objectIdentity, { nonempty: true, identity: true })
    && isBoundedString(value.grantor)
    && isBoundedString(value.grantee)
    && isBoundedString(value.privilege)
    && typeof value.grantable === 'boolean'
    && (roleMembership
      ? typeof value.inheritOption === 'boolean' && typeof value.setOption === 'boolean'
      : value.inheritOption === null && value.setOption === null);
}

function validSortedUniqueRecords(records, maximum, validate, canonicalizeJcs) {
  if (!Array.isArray(records) || records.length > maximum || !records.every(validate)) return false;
  let previous;
  for (const record of records) {
    const canonical = Buffer.from(canonicalizeJcs(record), 'utf8');
    if (previous !== undefined && Buffer.compare(previous, canonical) >= 0) return false;
    previous = canonical;
  }
  return true;
}

function validReleaseTrust(value, authorization, manifestExpiry, now) {
  const notBefore = parseInstant(value?.notBefore);
  const expiresAt = parseInstant(value?.expiresAt);
  return hasExactKeys(value, TRUST_KEYS)
    && value.schemaVersion === 1
    && value.profile === 'development'
    && value.channel === 'beta'
    && value.provider === 'supabase'
    && value.projectRefSha256 === authorization.projectRefHash
    && value.ownerOrgIdSha256 === authorization.expectedOwnerOrgIdHash
    && value.region === 'ap-northeast-2'
    && isBoundedString(value.rootKeyId, { nonempty: true, identity: true })
    && isBoundedString(value.releaseKeyId, { nonempty: true, identity: true })
    && isCanonicalBase64(value.releasePublicKey, PUBLIC_KEY_BASE64, 32)
    && isCanonicalBase64(value.ed25519Signature, SIGNATURE_BASE64, 64)
    && validLifetime(notBefore, expiresAt, now)
    && expiresAt <= manifestExpiry
    && expiresAt <= parseInstant(authorization.expiresAt);
}

function validProviderBaseline(value, trust, authorization, manifestExpiry, now, verifier) {
  const issuedAt = parseInstant(value?.issuedAt);
  const expiresAt = parseInstant(value?.expiresAt);
  return hasExactKeys(value, BASELINE_KEYS)
    && value.schemaVersion === 1
    && value.profile === 'development'
    && value.channel === 'beta'
    && value.provider === 'supabase'
    && isBoundedString(value.baselineVersion, { nonempty: true, identity: true })
    && value.projectRefSha256 === trust.projectRefSha256
    && value.projectRefSha256 === authorization.projectRefHash
    && value.ownerOrgIdSha256 === trust.ownerOrgIdSha256
    && value.ownerOrgIdSha256 === authorization.expectedOwnerOrgIdHash
    && value.region === trust.region
    && value.region === 'ap-northeast-2'
    && isBoundedString(value.databaseVersion, { nonempty: true })
    && DATABASE_VERSION.test(value.databaseVersion)
    && typeof value.sourceRevision === 'string'
    && SOURCE_REVISION.test(value.sourceRevision)
    && typeof value.sourceEvidenceSha256 === 'string'
    && SHA256_HEX.test(value.sourceEvidenceSha256)
    && validEmptyBusinessState(value.emptyBusinessState)
    && validSortedUniqueRecords(value.objects, MAX_OBJECTS, validObjectRecord, verifier.canonicalizeJcs)
    && validSortedUniqueRecords(value.grants, MAX_GRANTS, validGrantRecord, verifier.canonicalizeJcs)
    && typeof value.objectInventorySha256 === 'string'
    && SHA256_HEX.test(value.objectInventorySha256)
    && typeof value.grantInventorySha256 === 'string'
    && SHA256_HEX.test(value.grantInventorySha256)
    && validLifetime(issuedAt, expiresAt, now)
    && expiresAt <= parseInstant(trust.expiresAt)
    && expiresAt <= manifestExpiry
    && expiresAt <= parseInstant(authorization.expiresAt)
    && value.signingKeyId === trust.releaseKeyId
    && isCanonicalBase64(value.ed25519Signature, SIGNATURE_BASE64, 64);
}

async function verifyDomainSignature(unsigned, signature, publicKey, domain, verifier) {
  const message = Buffer.concat([
    Buffer.from(domain, 'ascii'),
    Buffer.from(verifier.canonicalizeJcs(unsigned), 'utf8'),
  ]);
  return verifier.verifyEd25519Bytes(message, signature, publicKey);
}

async function builtVerifier() {
  const module = await import('../../apps/community-cloud/dist/install-manifest-verifier.js');
  if ([module.canonicalizeJcs, module.verifyEd25519Bytes, module.sha256Jcs]
    .some(exported => typeof exported !== 'function')) {
    throw new TypeError('invalid verifier');
  }
  return module;
}

function freezeRecords(records) {
  for (const record of records) Object.freeze(record);
  return Object.freeze(records);
}

export async function requireProviderBaseline({
  releaseTrust,
  providerBaseline,
  rootKeys,
  revokedRootKeyIds,
  authorization,
  manifestExpiresAt,
  now = new Date(),
  verifier,
}) {
  let activeVerifier;
  let trust;
  const nowTime = now instanceof Date ? now.getTime() : Number.NaN;
  const manifestExpiry = parseInstant(manifestExpiresAt);
  try {
    activeVerifier = verifier ?? await builtVerifier();
    if ([activeVerifier.canonicalizeJcs, activeVerifier.verifyEd25519Bytes, activeVerifier.sha256Jcs]
      .some(exported => typeof exported !== 'function')
      || Number.isNaN(nowTime) || Number.isNaN(manifestExpiry)
      || !validAuthorization(authorization)
      || !validExternalTrust(rootKeys, revokedRootKeyIds)) {
      fail('BETA_TRUST_INVALID');
    }
    trust = await readStrictJsonDocument(releaseTrust);
    if (!validReleaseTrust(trust, authorization, manifestExpiry, nowTime)
      || !Object.hasOwn(rootKeys, trust.rootKeyId)
      || revokedRootKeyIds.includes(trust.rootKeyId)) {
      fail('BETA_TRUST_INVALID');
    }
    const { ed25519Signature, ...unsignedTrust } = trust;
    if (!await verifyDomainSignature(
      unsignedTrust,
      ed25519Signature,
      rootKeys[trust.rootKeyId],
      BETA_TRUST_DOMAIN,
      activeVerifier,
    )) {
      fail('BETA_TRUST_INVALID');
    }
  } catch (error) {
    if (error instanceof ProviderBaselineError) throw error;
    fail('BETA_TRUST_INVALID');
  }

  try {
    const baseline = await readStrictJsonDocument(providerBaseline);
    if (!validProviderBaseline(
      baseline,
      trust,
      authorization,
      manifestExpiry,
      nowTime,
      activeVerifier,
    )) {
      fail('PROVIDER_BASELINE_INVALID');
    }
    if (await activeVerifier.sha256Jcs(baseline.objects) !== baseline.objectInventorySha256
      || await activeVerifier.sha256Jcs(baseline.grants) !== baseline.grantInventorySha256) {
      fail('PROVIDER_BASELINE_INVALID');
    }
    const { ed25519Signature, ...unsignedBaseline } = baseline;
    if (!await verifyDomainSignature(
      unsignedBaseline,
      ed25519Signature,
      trust.releasePublicKey,
      PROVIDER_BASELINE_DOMAIN,
      activeVerifier,
    )) {
      fail('PROVIDER_BASELINE_INVALID');
    }
    return Object.freeze({
      baselineVersion: baseline.baselineVersion,
      projectRefSha256: baseline.projectRefSha256,
      ownerOrgIdSha256: baseline.ownerOrgIdSha256,
      region: baseline.region,
      databaseVersion: baseline.databaseVersion,
      objects: freezeRecords(baseline.objects),
      grants: freezeRecords(baseline.grants),
      objectInventorySha256: baseline.objectInventorySha256,
      grantInventorySha256: baseline.grantInventorySha256,
      baselineSha256: await activeVerifier.sha256Jcs(baseline),
      releaseTrustSha256: await activeVerifier.sha256Jcs(trust),
      expiresAt: baseline.expiresAt,
    });
  } catch (error) {
    if (error instanceof ProviderBaselineError) throw error;
    fail('PROVIDER_BASELINE_INVALID');
  }
}

export function compareProviderInventory(verifiedBaseline, observedInventory) {
  const hasExpectedObjects = Array.isArray(verifiedBaseline?.objects);
  const hasExpectedGrants = Array.isArray(verifiedBaseline?.grants);
  const hasObservedObjects = Array.isArray(observedInventory?.objects);
  const hasObservedGrants = Array.isArray(observedInventory?.grants);
  const expectedObjects = hasExpectedObjects ? verifiedBaseline.objects : [];
  const expectedGrants = hasExpectedGrants ? verifiedBaseline.grants : [];
  const observedObjects = hasObservedObjects ? observedInventory.objects : [];
  const observedGrants = hasObservedGrants ? observedInventory.grants : [];
  const matched = hasExpectedObjects && hasExpectedGrants && hasObservedObjects && hasObservedGrants
    && isDeepStrictEqual(expectedObjects, observedObjects)
    && isDeepStrictEqual(expectedGrants, observedGrants)
    && verifiedBaseline.objectInventorySha256 === observedInventory.objectInventorySha256
    && verifiedBaseline.grantInventorySha256 === observedInventory.grantInventorySha256;
  return {
    matched,
    code: matched ? null : 'PROVIDER_BASELINE_MISMATCH',
    expectedObjectCount: expectedObjects.length,
    observedObjectCount: observedObjects.length,
    expectedGrantCount: expectedGrants.length,
    observedGrantCount: observedGrants.length,
  };
}
