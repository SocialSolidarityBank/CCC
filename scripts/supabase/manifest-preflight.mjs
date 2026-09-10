import { Buffer } from 'node:buffer';
import { open } from 'node:fs/promises';

const MAX_DOCUMENT_BYTES = 1_048_576;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const APPROVAL_KEYS = [
  'schemaVersion', 'institutionId', 'projectRef', 'expectedOwnerOrgId', 'installationId',
  'runtimeManifestSha256', 'contractVersion', 'expiresAt', 'signingKeyId', 'ed25519Signature',
].sort();
const TRUST_KEYS = ['institutionId', 'publicKeys', 'revokedKeyIds'].sort();
const AUTHORIZATION_HASH_FIELDS = [
  'institutionIdHash', 'projectRefHash', 'expectedOwnerOrgIdHash',
  'runtimeManifestSha256', 'approvalSha256', 'runtimeConfigurationSha256',
];

export class InstallAuthorizationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'InstallAuthorizationError';
    this.code = code;
  }
}

function fail(code = 'OWNER_EVIDENCE_MISSING') {
  throw new InstallAuthorizationError(code);
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonWithoutDuplicateKeys(source) {
  const parsed = JSON.parse(source);
  let offset = 0;
  const whitespace = () => {
    while (offset < source.length && /\s/u.test(source[offset])) offset += 1;
  };
  const string = () => {
    const start = offset;
    offset += 1;
    while (offset < source.length) {
      if (source[offset] === '\\') {
        offset += 2;
      } else if (source[offset] === '"') {
        offset += 1;
        return JSON.parse(source.slice(start, offset));
      } else {
        offset += 1;
      }
    }
    throw new SyntaxError();
  };
  const value = () => {
    whitespace();
    if (source[offset] === '{') {
      offset += 1;
      whitespace();
      const keys = new Set();
      if (source[offset] === '}') {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        whitespace();
        const key = string();
        if (keys.has(key)) throw new SyntaxError();
        keys.add(key);
        whitespace();
        if (source[offset] !== ':') throw new SyntaxError();
        offset += 1;
        value();
        whitespace();
        if (source[offset] === '}') {
          offset += 1;
          return;
        }
        if (source[offset] !== ',') throw new SyntaxError();
        offset += 1;
      }
      throw new SyntaxError();
    }
    if (source[offset] === '[') {
      offset += 1;
      whitespace();
      if (source[offset] === ']') {
        offset += 1;
        return;
      }
      while (offset < source.length) {
        value();
        whitespace();
        if (source[offset] === ']') {
          offset += 1;
          return;
        }
        if (source[offset] !== ',') throw new SyntaxError();
        offset += 1;
      }
      throw new SyntaxError();
    }
    if (source[offset] === '"') {
      string();
      return;
    }
    while (offset < source.length && !/[\s,\]}]/u.test(source[offset])) offset += 1;
  };
  value();
  whitespace();
  if (offset !== source.length) throw new SyntaxError();
  return parsed;
}

async function documentInput(input) {
  if (typeof input !== 'string' || input.trim().length === 0) fail();
  let source;
  if (input.trimStart().startsWith('{')) {
    if (Buffer.byteLength(input, 'utf8') > MAX_DOCUMENT_BYTES) fail();
    source = input;
  } else {
    const file = await open(input, 'r');
    try {
      if (!(await file.stat()).isFile()) fail();
      const buffer = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const read = await file.read(buffer, length, buffer.length - length);
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      if (length === 0 || length > MAX_DOCUMENT_BYTES) fail();
      source = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
    } finally {
      await file.close();
    }
  }
  return parseJsonWithoutDuplicateKeys(source);
}

function trustInput(input, organizationId) {
  if (typeof organizationId !== 'string' || organizationId.length === 0) fail();
  if (typeof input === 'string' && Buffer.byteLength(input, 'utf8') > MAX_DOCUMENT_BYTES) fail();
  const trust = typeof input === 'string'
    ? parseJsonWithoutDuplicateKeys(input)
    : input;
  if (!isRecord(trust) || Object.keys(trust).sort().join('\0') !== TRUST_KEYS.join('\0')
    || trust.institutionId !== organizationId || !isRecord(trust.publicKeys)
    || Object.keys(trust.publicKeys).length === 0
    || Object.entries(trust.publicKeys).some(([keyId, key]) => (
      keyId.length === 0 || typeof key !== 'string' || !/^[A-Za-z0-9+/]{43}=$/u.test(key)
      || Buffer.from(key, 'base64').toString('base64') !== key
    ))
    || !Array.isArray(trust.revokedKeyIds)
    || trust.revokedKeyIds.some(keyId => typeof keyId !== 'string' || keyId.length === 0)
    || new Set(trust.revokedKeyIds).size !== trust.revokedKeyIds.length) {
    fail();
  }
  return trust;
}

/** Build institution-scoped trust only from externally injected public configuration. */
export function configuredInstallTrust({ organizationId, publicKeys, revokedKeyIds = '[]' }) {
  try {
    return trustInput({
      institutionId: organizationId,
      publicKeys: parseJsonWithoutDuplicateKeys(publicKeys),
      revokedKeyIds: parseJsonWithoutDuplicateKeys(revokedKeyIds),
    }, organizationId);
  } catch {
    fail();
  }
}

function approvalInput(value) {
  if (!isRecord(value) || Object.keys(value).sort().join('\0') !== APPROVAL_KEYS.join('\0')
    || value.schemaVersion !== 1 || value.contractVersion !== 'S11-install-approval-v1'
    || typeof value.runtimeManifestSha256 !== 'string'
    || !SHA256_HEX.test(value.runtimeManifestSha256)
    || Number.isNaN(Date.parse(value.expiresAt))) {
    fail();
  }
  for (const field of [
    'institutionId', 'projectRef', 'expectedOwnerOrgId', 'installationId',
    'expiresAt', 'signingKeyId', 'ed25519Signature',
  ]) {
    if (typeof value[field] !== 'string' || value[field].length === 0) fail();
  }
  return value;
}

async function verifierModule() {
  try {
    const url = new URL('../../apps/community-cloud/dist/install-manifest-verifier.js', import.meta.url);
    const verifier = await import(url.href);
    if ([
      verifier.verifySignedInstallManifest,
      verifier.verifyJcsEd25519Signature,
      verifier.sha256Jcs,
      verifier.sha256Utf8,
    ].some(exported => typeof exported !== 'function')) throw new Error();
    return verifier;
  } catch {
    fail('MANIFEST_VERIFIER_UNAVAILABLE');
  }
}

export async function hashCanonical(value) {
  return (await verifierModule()).sha256Jcs(value);
}

function hasAuthorizationBinding(value) {
  return isRecord(value)
    && typeof value.installationId === 'string' && value.installationId.length > 0
    && AUTHORIZATION_HASH_FIELDS.every(field => (
      typeof value[field] === 'string' && SHA256_HEX.test(value[field])
    ))
    && value.contractVersion === 'S11-install-approval-v1'
    && Number.isSafeInteger(value.runtimeSequence) && value.runtimeSequence >= 0
    && typeof value.expiresAt === 'string' && !Number.isNaN(Date.parse(value.expiresAt));
}

export function assertAuthorizationCurrent(authorization, { now = new Date() } = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())
    || !hasAuthorizationBinding(authorization)
    || Date.parse(authorization.expiresAt) <= now.getTime()) {
    fail();
  }
  return authorization;
}

export function assertAuthorizationMatches(previous, next, {
  renewAuthorization = false,
  resourcesSha256,
  migrationsSha256,
  now = new Date(),
}) {
  const stable = typeof renewAuthorization === 'boolean'
    && typeof resourcesSha256 === 'string' && SHA256_HEX.test(resourcesSha256)
    && typeof migrationsSha256 === 'string' && SHA256_HEX.test(migrationsSha256)
    && hasAuthorizationBinding(previous) && hasAuthorizationBinding(next)
    && previous.installationId === next.installationId
    && previous.institutionIdHash === next.institutionIdHash
    && previous.projectRefHash === next.projectRefHash
    && previous.expectedOwnerOrgIdHash === next.expectedOwnerOrgIdHash
    && previous.runtimeConfigurationSha256 === next.runtimeConfigurationSha256
    && previous.contractVersion === next.contractVersion
    && previous.resourcesSha256 === resourcesSha256
    && previous.migrationsSha256 === migrationsSha256;
  const artifactsMatch = previous?.runtimeManifestSha256 === next?.runtimeManifestSha256
    && previous?.approvalSha256 === next?.approvalSha256
    && previous?.runtimeSequence === next?.runtimeSequence
    && Date.parse(previous?.expiresAt) === Date.parse(next?.expiresAt);
  const renewalAdvances = Number.isSafeInteger(previous?.runtimeSequence)
    && Number.isSafeInteger(next?.runtimeSequence)
    && next.runtimeSequence > previous.runtimeSequence;
  try {
    assertAuthorizationCurrent(next, { now });
  } catch {
    fail('INSTALL_AUTHORIZATION_MISMATCH');
  }
  if (!stable || (renewAuthorization ? !renewalAdvances : !artifactsMatch)) {
    fail('INSTALL_AUTHORIZATION_MISMATCH');
  }
  return true;
}

export async function requireSignedOwnerPreflight({
  installManifest,
  installApproval,
  trust,
  organizationId,
  projectRef,
  now = new Date(),
}) {
  let manifest;
  let approval;
  let configuredTrust;
  try {
    [manifest, approval] = await Promise.all([
      documentInput(installManifest),
      documentInput(installApproval),
    ]);
    approval = approvalInput(approval);
    configuredTrust = trustInput(trust, organizationId);
    if (typeof projectRef !== 'string' || projectRef.length === 0
      || !(now instanceof Date) || Number.isNaN(now.getTime())) {
      fail();
    }
  } catch (error) {
    if (error instanceof InstallAuthorizationError) throw error;
    fail();
  }

  const verifier = await verifierModule();
  try {
    const verifiedManifest = await verifier.verifySignedInstallManifest(manifest, {
      publicKeys: configuredTrust.publicKeys,
      revokedKeyIds: configuredTrust.revokedKeyIds,
      now,
    });
    const hasApprovalKey = Object.hasOwn(configuredTrust.publicKeys, approval.signingKeyId);
    const publicKey = hasApprovalKey ? configuredTrust.publicKeys[approval.signingKeyId] : undefined;
    if (verifiedManifest.mode !== 'community-cloud'
      || verifiedManifest.supabaseProjectRef !== projectRef
      || approval.institutionId !== organizationId
      || approval.projectRef !== projectRef
      || approval.projectRef !== verifiedManifest.supabaseProjectRef
      || approval.installationId !== verifiedManifest.installationId
      || typeof publicKey !== 'string'
      || configuredTrust.revokedKeyIds.includes(approval.signingKeyId)
      || Date.parse(approval.expiresAt) <= now.getTime()) {
      fail();
    }

    const runtimeManifestSha256 = await verifier.sha256Jcs(manifest);
    if (approval.runtimeManifestSha256 !== runtimeManifestSha256) fail();
    const { ed25519Signature: approvalSignature, ...unsignedApproval } = approval;
    if (!await verifier.verifyJcsEd25519Signature(unsignedApproval, approvalSignature, publicKey)) fail();

    const {
      publishedAt: _publishedAt,
      expiresAt: _manifestExpiresAt,
      sequence: _sequence,
      signingKeyId: _signingKeyId,
      ed25519Signature: _manifestSignature,
      ...runtimeConfiguration
    } = verifiedManifest;
    const manifestExpiry = Date.parse(verifiedManifest.expiresAt);
    const approvalExpiry = Date.parse(approval.expiresAt);
    return Object.freeze({
      installationId: approval.installationId,
      institutionId: approval.institutionId,
      projectRef: approval.projectRef,
      expectedOwnerOrgId: approval.expectedOwnerOrgId,
      institutionIdHash: await verifier.sha256Utf8(approval.institutionId),
      projectRefHash: await verifier.sha256Utf8(approval.projectRef),
      expectedOwnerOrgIdHash: await verifier.sha256Utf8(approval.expectedOwnerOrgId),
      runtimeManifestSha256,
      approvalSha256: await verifier.sha256Jcs(approval),
      runtimeConfigurationSha256: await verifier.sha256Jcs(runtimeConfiguration),
      contractVersion: approval.contractVersion,
      runtimeSequence: verifiedManifest.sequence,
      expiresAt: new Date(Math.min(manifestExpiry, approvalExpiry)).toISOString(),
    });
  } catch (error) {
    if (error instanceof InstallAuthorizationError) throw error;
    fail();
  }
}
