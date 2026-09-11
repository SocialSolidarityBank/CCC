import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

import { canonicalizeJcs } from '@ccc/contracts/jcs';

import { verifyEd25519Bytes } from '../../apps/community-cloud/dist/install-manifest-verifier.js';
import { readStrictJsonDocument } from '../supabase/manifest-preflight.mjs';
import { ReleaseVerificationError, selectSigningKey } from './release-trust.mjs';
import { PINNED_RELEASE_ORIGIN } from './release-origin.mjs';

const MANIFEST_DOMAIN = 'CCC-RELEASE-MANIFEST-V1\0';
const BUNDLE_DOMAIN = 'CCC-RELEASE-BUNDLE-V1\0';
const MAX_UINT64 = 18_446_744_073_709_551_615n;
const SHA256 = /^[a-f0-9]{64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/u;
const DECIMAL = /^(0|[1-9][0-9]*)$/u;
const UTC_RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/u;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;
const MAX_DOCUMENT_BYTES = 1_048_576;
const RAW_URL_FORBIDDEN = /[\\\u0000-\u001f\u007f]/u;
const CHANNELS = new Set(['stable', 'beta', 'dev']);
const FAMILIES = [
  'community-cloud-cli',
  'local-single',
  'local-office-server',
  'local-office-client',
  'processing-agent',
];
const MODES = new Set(['community-cloud', 'local-single', 'local-office']);
const PLATFORMS = new Set(['macos', 'windows', 'ubuntu']);
const ARCHES = new Set(['arm64', 'x64']);
const PEER_NAMES = new Set(['cloud-cli', 'edge', 'office-server', 'office-client', 'agent']);
const FAMILY_MODES = Object.freeze({
  'community-cloud-cli': new Set(['community-cloud']),
  'local-single': new Set(['local-single']),
  'local-office-server': new Set(['local-office']),
  'local-office-client': new Set(['local-office']),
  'processing-agent': new Set(['community-cloud', 'local-single', 'local-office']),
});
const FAMILY_PEERS = Object.freeze({
  'community-cloud-cli': ['cloud-cli', 'edge'],
  'local-single': [],
  'local-office-server': ['office-server'],
  'local-office-client': ['office-client'],
  'processing-agent': ['agent'],
});
const MANIFEST_KEYS = [
  'version', 'sequence', 'channel', 'artifactUrl', 'artifactSha256', 'artifactBytes',
  'minSchemaVersion', 'maxSchemaVersion', 'publishedAt', 'expiresAt', 'signingKeyId',
  'ed25519Signature',
].sort();
const BUNDLE_KEYS = [
  'schemaVersion', 'bundleId', 'version', 'sequence', 'channel', 'publishedAt', 'expiresAt',
  'protocol', 'entries', 'sequenceFloor', 'modelManifestSha256', 'offlineRootSignature',
].sort();
const PROTOCOL_KEYS = ['apiName', 'apiVersion', 'contractsSha256', 'peers'].sort();
const PEER_KEYS = ['name', 'protocolVersion', 'contractsSha256'].sort();
const ENTRY_KEYS = ['family', 'artifacts'].sort();
const ARTIFACT_KEYS = [
  'manifestUrl', 'manifestSha256', 'edgeComponentManifestSha256', 'mode', 'platform', 'arch',
  'artifactSha256', 'artifactBytes', 'minSchemaVersion', 'maxSchemaVersion',
].sort();
const FLOOR_KEYS = ['family', 'mode', 'platform', 'arch', 'minimumSequence'].sort();
const SUFFIXES = [
  { text: '-macos-arm64.tar.gz', platform: 'macos', arch: 'arm64', ext: 'tar.gz' },
  { text: '-macos-x64.tar.gz', platform: 'macos', arch: 'x64', ext: 'tar.gz' },
  { text: '-ubuntu-x64.tar.gz', platform: 'ubuntu', arch: 'x64', ext: 'tar.gz' },
  { text: '-windows-x64.exe', platform: 'windows', arch: 'x64', ext: 'exe' },
];
const FAMILY_MODE_PREFIXES = FAMILIES.flatMap(family => (
  [...FAMILY_MODES[family]].map(mode => ({ family, mode, text: `${family}-${mode}-` }))
)).sort((left, right) => right.text.length - left.text.length);

function fail(code = 'SIGNATURE_INVALID') {
  throw new ReleaseVerificationError(code);
}

function exactKeys(value, keys) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === keys.join('\0');
}

function boundedString(value, { nonempty = false } = {}) {
  return typeof value === 'string'
    && (!nonempty || value.length > 0)
    && Buffer.byteLength(value, 'utf8') <= 4096;
}

function validHash(value) {
  return boundedString(value) && SHA256.test(value);
}

function validBase64url(value, pattern, bytes) {
  return boundedString(value) && pattern.test(value)
    && Buffer.from(value, 'base64url').byteLength === bytes
    && Buffer.from(value, 'base64url').toString('base64url') === value;
}

function uint64(value, { positive = false } = {}) {
  if (!boundedString(value) || !DECIMAL.test(value)) fail();
  const parsed = BigInt(value);
  if (parsed > MAX_UINT64 || (positive && parsed === 0n)) fail();
  return parsed;
}

function parseInstant(value) {
  const match = typeof value === 'string' ? UTC_RFC3339.exec(value) : null;
  if (match === null || Buffer.byteLength(value, 'utf8') > 4096) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  if (new Date(milliseconds).toISOString().slice(0, 19)
    !== `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`) fail();
  return milliseconds;
}

function semver(value, channel) {
  const match = boundedString(value, { nonempty: true }) ? SEMVER.exec(value) : null;
  if (match === null) fail();
  const prereleaseChannel = match[4]?.split('.')[0];
  if ((channel === 'stable' && prereleaseChannel !== undefined)
    || (channel !== 'stable' && prereleaseChannel !== channel)) fail();
  return value;
}

function validInteger(value, minimum) {
  return Number.isSafeInteger(value) && value >= minimum;
}

function exactHttpsUrl(value) {
  if (!boundedString(value, { nonempty: true })) fail();
  let url;
  try {
    url = new URL(value);
  } catch {
    fail();
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') fail();
  return url;
}

function lifetime(value, now, expiredCode) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail();
  const publishedAt = parseInstant(value.publishedAt);
  const expiresAt = parseInstant(value.expiresAt);
  if (publishedAt >= expiresAt || expiresAt - publishedAt > 30 * 24 * 60 * 60 * 1000
    || publishedAt > now.getTime()) fail();
  if (now.getTime() >= expiresAt) fail(expiredCode);
}

function bundleLifetimeBounds(value) {
  try {
    const publishedAt = parseInstant(value.publishedAt);
    const expiresAt = parseInstant(value.expiresAt);
    if (publishedAt >= expiresAt || expiresAt - publishedAt > 30 * 24 * 60 * 60 * 1000) {
      fail('BUNDLE_ENTRY_INVALID');
    }
    return { publishedAt, expiresAt };
  } catch (error) {
    if (error instanceof ReleaseVerificationError && error.code === 'BUNDLE_ENTRY_INVALID') throw error;
    fail('BUNDLE_ENTRY_INVALID');
  }
}

function platformAllowed(family, platform, arch) {
  if (family === 'community-cloud-cli') {
    return (platform === 'macos' && ARCHES.has(arch))
      || (platform === 'ubuntu' && arch === 'x64')
      || (platform === 'windows' && arch === 'x64');
  }
  return platform === 'windows' && arch === 'x64';
}

function tupleKey({ family, mode, platform, arch }) {
  return `${family}\0${mode}\0${platform}\0${arch}`;
}

function validTuple({ family, mode, platform, arch }) {
  return FAMILIES.includes(family) && MODES.has(mode) && PLATFORMS.has(platform) && ARCHES.has(arch)
    && FAMILY_MODES[family].has(mode) && platformAllowed(family, platform, arch);
}

async function parsedDocument(document, code) {
  try {
    if (typeof document !== 'string' || document.trim().length === 0) fail(code);
    let bytes;
    if (document.trimStart().startsWith('{')) {
      bytes = Buffer.from(document, 'utf8');
    } else {
      const file = await open(document, 'r');
      try {
        const buffer = Buffer.alloc(MAX_DOCUMENT_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
          const read = await file.read(buffer, length, buffer.length - length);
          if (read.bytesRead === 0) break;
          length += read.bytesRead;
        }
        bytes = Buffer.from(buffer.subarray(0, length));
      } finally {
        await file.close();
      }
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_BYTES) fail(code);
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { value: await readStrictJsonDocument(source), bytes };
  } catch (error) {
    if (error instanceof ReleaseVerificationError) throw error;
    fail(code);
  }
}

function signatureMessage(domain, unsigned) {
  return Buffer.concat([
    Buffer.from(domain, 'ascii'),
    Buffer.from(canonicalizeJcs(unsigned), 'utf8'),
  ]);
}

function standardBase64(base64url) {
  return Buffer.from(base64url, 'base64url').toString('base64');
}

export function parseArtifactBasename(value) {
  try {
    if (!boundedString(value, { nonempty: true }) || value.includes('?') || value.includes('#')
      || RAW_URL_FORBIDDEN.test(value)) fail('ARTIFACT_IDENTITY_MISMATCH');
    const url = exactHttpsUrl(value);
    const authorityEnd = value.indexOf('/', value.indexOf('://') + 3);
    const rawPath = authorityEnd === -1 ? '' : value.slice(authorityEnd);
    const decodedPath = decodeURIComponent(rawPath);
    if (/%[0-9A-Fa-f]{2}/u.test(decodedPath)) fail('ARTIFACT_IDENTITY_MISMATCH');
    const segments = decodedPath.split('/');
    if (segments.some(segment => segment === '.' || segment === '..')) fail('ARTIFACT_IDENTITY_MISMATCH');
    const basename = segments.at(-1);
    if (basename === undefined || basename.length === 0 || url.pathname.endsWith('/')) {
      fail('ARTIFACT_IDENTITY_MISMATCH');
    }
    const prefix = FAMILY_MODE_PREFIXES.find(candidate => basename.startsWith(candidate.text));
    const suffix = SUFFIXES.find(candidate => basename.endsWith(candidate.text));
    if (prefix === undefined || suffix === undefined || !platformAllowed(prefix.family, suffix.platform, suffix.arch)) {
      fail('ARTIFACT_IDENTITY_MISMATCH');
    }
    const version = basename.slice(prefix.text.length, -suffix.text.length);
    if (SEMVER.exec(version) === null) fail('ARTIFACT_IDENTITY_MISMATCH');
    return {
      family: prefix.family,
      mode: prefix.mode,
      version,
      platform: suffix.platform,
      arch: suffix.arch,
      ext: suffix.ext,
    };
  } catch (error) {
    if (error instanceof ReleaseVerificationError) throw error;
    fail('ARTIFACT_IDENTITY_MISMATCH');
  }
}

export function requireExpectedTuple(parsed, expected) {
  if (!exactKeys(expected, ['arch', 'family', 'mode', 'platform'])
    || !validTuple(expected)
    || typeof parsed !== 'object' || parsed === null
    || ['family', 'mode', 'platform', 'arch'].some(field => parsed[field] !== expected[field])) {
    fail('ARTIFACT_IDENTITY_MISMATCH');
  }
  return parsed;
}

export async function verifyReleaseManifest({ document, trustStore, now, expectedTuple, bundleEntry }) {
  const { value, bytes } = await parsedDocument(document, 'SIGNATURE_INVALID');
  try {
    if (!exactKeys(value, MANIFEST_KEYS) || !CHANNELS.has(value.channel)
      || !validHash(value.artifactSha256)
      || !validInteger(value.artifactBytes, 1)
      || !validInteger(value.minSchemaVersion, 0)
      || !validInteger(value.maxSchemaVersion, 0)
      || !boundedString(value.signingKeyId, { nonempty: true })
      || !validBase64url(value.ed25519Signature, SIGNATURE, 64)) fail();
    semver(value.version, value.channel);
    uint64(value.sequence, { positive: true });
    lifetime(value, now, 'MANIFEST_EXPIRED');
    if (value.minSchemaVersion > value.maxSchemaVersion) fail('SCHEMA_INCOMPATIBLE');

    const artifactUrl = exactHttpsUrl(value.artifactUrl);
    const manifestUrl = exactHttpsUrl(bundleEntry?.manifestUrl);
    if (artifactUrl.origin !== PINNED_RELEASE_ORIGIN
      || manifestUrl.origin !== PINNED_RELEASE_ORIGIN) fail();
    const parsedArtifact = parseArtifactBasename(value.artifactUrl);
    if (parsedArtifact.version !== value.version) fail('ARTIFACT_IDENTITY_MISMATCH');
    requireExpectedTuple(parsedArtifact, expectedTuple);
    requireExpectedTuple({
      family: bundleEntry?.family ?? expectedTuple.family,
      mode: bundleEntry?.mode,
      platform: bundleEntry?.platform,
      arch: bundleEntry?.arch,
    }, expectedTuple);
    if (value.artifactSha256 !== bundleEntry.artifactSha256
      || value.artifactBytes !== bundleEntry.artifactBytes) fail('ARTIFACT_NOT_INDEXED');
    if (value.minSchemaVersion !== bundleEntry.minSchemaVersion
      || value.maxSchemaVersion !== bundleEntry.maxSchemaVersion) fail('SCHEMA_INCOMPATIBLE');

    const key = selectSigningKey(trustStore, value.signingKeyId, now, { allowRetiredForRollback: false });
    const { ed25519Signature, ...unsigned } = value;
    if (!await verifyEd25519Bytes(
      signatureMessage(MANIFEST_DOMAIN, unsigned),
      standardBase64(ed25519Signature),
      standardBase64(key.publicKey),
    )) fail();
    if (!validHash(bundleEntry.manifestSha256)
      || createHash('sha256').update(bytes).digest('hex') !== bundleEntry.manifestSha256) {
      fail('ARTIFACT_NOT_INDEXED');
    }
    return value;
  } catch (error) {
    if (error instanceof ReleaseVerificationError) throw error;
    fail();
  }
}

function validateArtifact(family, artifact, origins, tupleKeys, manifestUrls) {
  if (!exactKeys(artifact, ARTIFACT_KEYS) || !validTuple({ family, ...artifact })
    || !validHash(artifact.manifestSha256) || !validHash(artifact.artifactSha256)
    || !validInteger(artifact.artifactBytes, 1)
    || !validInteger(artifact.minSchemaVersion, 0)
    || !validInteger(artifact.maxSchemaVersion, 0)
    || artifact.minSchemaVersion > artifact.maxSchemaVersion) fail('BUNDLE_ENTRY_INVALID');
  if ((family === 'community-cloud-cli' && !validHash(artifact.edgeComponentManifestSha256))
    || (family !== 'community-cloud-cli' && artifact.edgeComponentManifestSha256 !== null)) {
    fail('BUNDLE_ENTRY_INVALID');
  }
  let manifestUrl;
  try {
    manifestUrl = exactHttpsUrl(artifact.manifestUrl);
  } catch {
    fail('BUNDLE_ENTRY_INVALID');
  }
  if (manifestUrl.origin !== PINNED_RELEASE_ORIGIN) fail('BUNDLE_ENTRY_INVALID');
  origins.add(manifestUrl.origin);
  const key = tupleKey({ family, ...artifact });
  if (tupleKeys.has(key) || manifestUrls.has(artifact.manifestUrl)) fail('BUNDLE_ENTRY_INVALID');
  tupleKeys.add(key);
  manifestUrls.add(artifact.manifestUrl);
}

function validateProtocol(protocol, families) {
  if (!exactKeys(protocol, PROTOCOL_KEYS) || protocol.apiName !== 'ccc-http-api'
    || !boundedString(protocol.apiVersion, { nonempty: true })
    || !validHash(protocol.contractsSha256) || !Array.isArray(protocol.peers)) {
    fail('PEER_PROTOCOL_MISMATCH');
  }
  const names = [];
  for (const peer of protocol.peers) {
    if (!exactKeys(peer, PEER_KEYS) || !PEER_NAMES.has(peer.name)
      || !boundedString(peer.protocolVersion, { nonempty: true })
      || !validHash(peer.contractsSha256)) fail('PEER_PROTOCOL_MISMATCH');
    names.push(peer.name);
  }
  const expected = [...new Set(families.flatMap(family => FAMILY_PEERS[family]))].sort();
  if (new Set(names).size !== names.length || names.sort().join('\0') !== expected.join('\0')) {
    fail('PEER_PROTOCOL_MISMATCH');
  }
}

function validateBundleShape(value, channel) {
  if (!exactKeys(value, BUNDLE_KEYS) || value.schemaVersion !== 1
    || !CHANNELS.has(value.channel) || value.channel !== channel
    || !boundedString(value.bundleId, { nonempty: true })
    || !validHash(value.modelManifestSha256)) fail('BUNDLE_ENTRY_INVALID');
  try {
    semver(value.version, value.channel);
    uint64(value.sequence, { positive: true });
  } catch {
    fail('BUNDLE_ENTRY_INVALID');
  }
  const lifetimeBounds = bundleLifetimeBounds(value);
  if (!Array.isArray(value.entries)) fail('BUNDLE_ENTRY_INVALID');
  const minimumRows = value.channel === 'stable' ? 5 : 1;
  if (value.entries.length < minimumRows || value.entries.length > 5) fail('BUNDLE_ENTRY_INVALID');

  const families = [];
  const tupleKeys = new Set();
  const manifestUrls = new Set();
  const origins = new Set();
  for (const entry of value.entries) {
    if (!exactKeys(entry, ENTRY_KEYS) || !FAMILIES.includes(entry.family)
      || !Array.isArray(entry.artifacts) || entry.artifacts.length === 0) fail('BUNDLE_ENTRY_INVALID');
    families.push(entry.family);
    for (const artifact of entry.artifacts) {
      validateArtifact(entry.family, artifact, origins, tupleKeys, manifestUrls);
    }
  }
  if (new Set(families).size !== families.length
    || (value.channel === 'stable' && FAMILIES.some(family => !families.includes(family)))
    || origins.size !== 1) fail('BUNDLE_ENTRY_INVALID');

  validateProtocol(value.protocol, families);
  if (!Array.isArray(value.sequenceFloor) || value.sequenceFloor.length !== tupleKeys.size) {
    fail('BUNDLE_ENTRY_INVALID');
  }
  const floorKeys = new Set();
  for (const floor of value.sequenceFloor) {
    if (!exactKeys(floor, FLOOR_KEYS) || !validTuple(floor)) fail('BUNDLE_ENTRY_INVALID');
    let minimum;
    try {
      minimum = uint64(floor.minimumSequence);
    } catch {
      fail('BUNDLE_ENTRY_INVALID');
    }
    const key = tupleKey(floor);
    if (!tupleKeys.has(key) || floorKeys.has(key) || minimum > BigInt(value.sequence)) {
      fail('BUNDLE_ENTRY_INVALID');
    }
    floorKeys.add(key);
  }
  return lifetimeBounds;
}

function validateRootTrust(rootKeys, revokedRootKeyIds) {
  if (typeof rootKeys !== 'object' || rootKeys === null || Array.isArray(rootKeys)
    || Object.keys(rootKeys).length === 0 || !Array.isArray(revokedRootKeyIds)
    || new Set(revokedRootKeyIds).size !== revokedRootKeyIds.length) fail('BUNDLE_SIGNATURE_INVALID');
  for (const [keyId, publicKey] of Object.entries(rootKeys)) {
    if (!boundedString(keyId, { nonempty: true })
      || !validBase64url(publicKey, PUBLIC_KEY, 32)) fail('BUNDLE_SIGNATURE_INVALID');
  }
  if (revokedRootKeyIds.some(keyId => !boundedString(keyId, { nonempty: true }))) {
    fail('BUNDLE_SIGNATURE_INVALID');
  }
}

export async function verifyReleaseBundle({ document, rootKeys, revokedRootKeyIds, now, channel }) {
  const { value } = await parsedDocument(document, 'BUNDLE_ENTRY_INVALID');
  const lifetimeBounds = validateBundleShape(value, channel);
  if (!validBase64url(value.offlineRootSignature, SIGNATURE, 64)) fail('BUNDLE_SIGNATURE_INVALID');
  validateRootTrust(rootKeys, revokedRootKeyIds);
  try {
    const { offlineRootSignature, ...unsigned } = value;
    const message = signatureMessage(BUNDLE_DOMAIN, unsigned);
    let authenticated = false;
    for (const [keyId, publicKey] of Object.entries(rootKeys)) {
      if (!revokedRootKeyIds.includes(keyId) && await verifyEd25519Bytes(
        message,
        standardBase64(offlineRootSignature),
        standardBase64(publicKey),
      )) {
        authenticated = true;
        break;
      }
    }
    if (!authenticated) fail('BUNDLE_SIGNATURE_INVALID');
    if (!(now instanceof Date) || Number.isNaN(now.getTime())) fail('BUNDLE_ENTRY_INVALID');
    if (now.getTime() < lifetimeBounds.publishedAt || now.getTime() >= lifetimeBounds.expiresAt) {
      fail('BUNDLE_LIFETIME_INVALID');
    }
    return value;
  } catch (error) {
    if (error instanceof ReleaseVerificationError) throw error;
    fail('BUNDLE_SIGNATURE_INVALID');
  }
}
