import { Buffer } from 'node:buffer';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';

import { canonicalizeJcs } from '@ccc/contracts/jcs';

import { verifyEd25519Bytes } from '../../apps/community-cloud/dist/install-manifest-verifier.js';
import { readStrictJsonDocument } from '../supabase/manifest-preflight.mjs';
import { loadReleaseTrustStore, selectSigningKey } from './release-trust.mjs';

const DOMAIN = 'CCC-EDGE-COMPONENT-MANIFEST-V1\0';
export const EDGE_PROTOCOL_VERSION = '1.0.0';
const MAX_DOCUMENT_BYTES = 1_048_576;
const SHA256 = /^[a-f0-9]{64}$/u;
const SIGNATURE = /^[A-Za-z0-9_-]{86}$/u;
const MANIFEST_KEYS = [
  'schemaVersion', 'protocolVersion', 'components', 'edgeArtifactSha256',
  'signingKeyId', 'ed25519Signature',
].sort();
const COMPONENT_KEYS = ['kind', 'path', 'artifactBytes', 'artifactSha256'].sort();
const KIND_BY_ROOT = Object.freeze({
  functions: 'function',
  templates: 'template',
  migrations: 'migration',
});

export class EdgeComponentManifestError extends Error {
  constructor(code) {
    super(code);
    this.name = 'EdgeComponentManifestError';
    this.code = code;
  }
}

function fail(code = 'EDGE_COMPONENT_SET_MISMATCH') {
  throw new EdgeComponentManifestError(code);
}

function exactKeys(value, keys) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === keys.join('\0');
}

function boundedString(value, { nonempty = false } = {}) {
  return typeof value === 'string'
    && (!nonempty || value.length > 0)
    && Buffer.byteLength(value, 'utf8') <= 4_096;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function componentKind(path) {
  if (!boundedString(path, { nonempty: true }) || path.includes('\\')
    || posix.isAbsolute(path) || win32.isAbsolute(path) || posix.normalize(path) !== path) fail();
  const parts = path.split('/');
  if (parts.length < 2 || parts.some(part => part === '' || part === '.' || part === '..')) fail();
  const kind = KIND_BY_ROOT[parts[0]];
  if (kind === undefined) fail();
  return kind;
}

async function regularFileBytes(path, {
  maxBytes = Number.POSITIVE_INFINITY,
  nonempty = false,
  errorCode = 'EDGE_COMPONENT_SET_MISMATCH',
} = {}) {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes
      || (nonempty && before.size === 0)) fail(errorCode);
    let bytes;
    if (Number.isFinite(maxBytes)) {
      const buffer = Buffer.alloc(maxBytes + 1);
      let length = 0;
      while (length < buffer.length) {
        const result = await handle.read(buffer, length, buffer.length - length, null);
        if (result.bytesRead === 0) break;
        length += result.bytesRead;
      }
      if (length > maxBytes || (nonempty && length === 0)) fail(errorCode);
      bytes = Buffer.from(buffer.subarray(0, length));
    } else {
      bytes = await handle.readFile();
    }
    const after = await handle.stat();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || after.nlink !== 1 || bytes.byteLength !== after.size) {
      fail(errorCode);
    }
    return bytes;
  } catch (error) {
    if (error instanceof EdgeComponentManifestError) throw error;
    fail(errorCode);
  } finally {
    await handle?.close();
  }
}

async function collectFiles(root) {
  let rootInfo;
  try {
    rootInfo = await lstat(root);
  } catch {
    fail();
  }
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) fail();

  const files = [];
  async function visit(directory, prefix) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      fail();
    }
    for (const entry of entries) {
      const path = `${prefix}/${entry.name}`;
      const absolute = join(directory, entry.name);
      const info = await lstat(absolute);
      if (entry.isSymbolicLink() || info.isSymbolicLink()) fail();
      if (entry.isDirectory() && info.isDirectory()) await visit(absolute, path);
      else if (entry.isFile() && info.isFile()) files.push({ path, absolute });
      else fail();
    }
  }
  for (const name of Object.keys(KIND_BY_ROOT)) {
    const directory = join(root, name);
    let info;
    try {
      info = await lstat(directory);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      fail();
    }
    if (!info.isDirectory() || info.isSymbolicLink()) fail();
    await visit(directory, name);
  }
  files.sort((left, right) => compareUtf8(left.path, right.path));
  return files;
}

async function componentsAt(root) {
  const files = await collectFiles(root);
  const components = [];
  for (const file of files) {
    const kind = componentKind(file.path);
    const bytes = await regularFileBytes(file.absolute);
    components.push({
      kind,
      path: file.path,
      artifactBytes: bytes.byteLength,
      artifactSha256: sha256(bytes),
    });
  }
  return components;
}

function signatureMessage(unsigned) {
  return Buffer.concat([
    Buffer.from(DOMAIN, 'ascii'),
    Buffer.from(canonicalizeJcs(unsigned), 'utf8'),
  ]);
}

async function signingIdentity() {
  const privateValue = process.env.CCC_RELEASE_SIGNING_PRIVATE_KEY;
  const trustValue = process.env.CCC_RELEASE_TRUST_STORE;
  if (!boundedString(privateValue, { nonempty: true }) || !boundedString(trustValue, { nonempty: true })) {
    fail('SIGNATURE_INVALID');
  }
  try {
    const privateKey = createPrivateKey(privateValue);
    if (privateKey.asymmetricKeyType !== 'ed25519') fail('SIGNATURE_INVALID');
    const publicKey = createPublicKey(privateKey).export({ format: 'jwk' }).x;
    const trustStore = await loadReleaseTrustStore(trustValue);
    const matches = trustStore.keys.filter(record => record.publicKey === publicKey);
    if (matches.length !== 1) fail('SIGNATURE_INVALID');
    selectSigningKey(trustStore, matches[0].keyId, new Date());
    return { privateKey, keyId: matches[0].keyId };
  } catch (error) {
    if (error instanceof EdgeComponentManifestError) throw error;
    fail('SIGNATURE_INVALID');
  }
}

async function documentBytes(document) {
  try {
    let bytes;
    if (typeof document === 'string' && document.trimStart().startsWith('{')) {
      bytes = Buffer.from(document, 'utf8');
    } else if (typeof document === 'string') {
      bytes = await regularFileBytes(document, {
        maxBytes: MAX_DOCUMENT_BYTES,
        nonempty: true,
        errorCode: 'SIGNATURE_INVALID',
      });
    } else {
      fail('SIGNATURE_INVALID');
    }
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_DOCUMENT_BYTES) fail('SIGNATURE_INVALID');
    const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (!source.trimStart().startsWith('{')) fail('SIGNATURE_INVALID');
    return { bytes, value: await readStrictJsonDocument(source) };
  } catch (error) {
    if (error instanceof EdgeComponentManifestError) throw error;
    fail('SIGNATURE_INVALID');
  }
}

function validateManifest(value) {
  if (value?.protocolVersion !== EDGE_PROTOCOL_VERSION) fail();
  if (!exactKeys(value, MANIFEST_KEYS) || value.schemaVersion !== 1
    || !boundedString(value.protocolVersion, { nonempty: true })
    || !Array.isArray(value.components) || value.components.length === 0
    || !boundedString(value.signingKeyId, { nonempty: true })
    || !SHA256.test(value.edgeArtifactSha256)
    || !boundedString(value.ed25519Signature) || !SIGNATURE.test(value.ed25519Signature)
    || Buffer.from(value.ed25519Signature, 'base64url').toString('base64url') !== value.ed25519Signature) {
    fail('SIGNATURE_INVALID');
  }
  const paths = [];
  for (const component of value.components) {
    if (!exactKeys(component, COMPONENT_KEYS) || component.kind !== componentKind(component.path)
      || !Number.isSafeInteger(component.artifactBytes) || component.artifactBytes < 0
      || !boundedString(component.artifactSha256) || !SHA256.test(component.artifactSha256)) fail();
    paths.push(component.path);
  }
  if (new Set(paths).size !== paths.length
    || paths.some((path, index) => index > 0 && compareUtf8(paths[index - 1], path) >= 0)
    || value.edgeArtifactSha256 !== sha256(canonicalizeJcs(value.components))) fail();
}

export async function buildEdgeComponentManifest(componentRoot) {
  const components = await componentsAt(componentRoot);
  if (components.length === 0) fail();
  const identity = await signingIdentity();
  const unsigned = {
    schemaVersion: 1,
    protocolVersion: EDGE_PROTOCOL_VERSION,
    components,
    edgeArtifactSha256: sha256(canonicalizeJcs(components)),
    signingKeyId: identity.keyId,
  };
  return {
    ...unsigned,
    ed25519Signature: sign(null, signatureMessage(unsigned), identity.privateKey).toString('base64url'),
  };
}
export async function verifyEdgeComponentManifest({
  document, stagedRoot, bundleRow, trustStore, now,
}) {
  const parsed = await documentBytes(document);
  validateManifest(parsed.value);
  if (!boundedString(bundleRow?.edgeComponentManifestSha256)
    || !SHA256.test(bundleRow.edgeComponentManifestSha256)
    || sha256(parsed.bytes) !== bundleRow.edgeComponentManifestSha256) fail();

  const embedded = await regularFileBytes(join(stagedRoot, 'edge-component-manifest.json'));
  if (!embedded.equals(parsed.bytes)) fail();
  const stagedComponents = await componentsAt(stagedRoot);
  if (canonicalizeJcs(stagedComponents) !== canonicalizeJcs(parsed.value.components)) fail();

  try {
    const key = selectSigningKey(trustStore, parsed.value.signingKeyId, now);
    const { ed25519Signature, ...unsigned } = parsed.value;
    const valid = await verifyEd25519Bytes(
      signatureMessage(unsigned),
      Buffer.from(ed25519Signature, 'base64url').toString('base64'),
      Buffer.from(key.publicKey, 'base64url').toString('base64'),
    );
    if (!valid) fail('SIGNATURE_INVALID');
    return parsed.value;
  } catch (error) {
    if (error instanceof EdgeComponentManifestError) throw error;
    throw error;
  }
}
