import { Buffer } from 'node:buffer';

import { readStrictJsonDocument } from '../supabase/manifest-preflight.mjs';

const PUBLIC_KEY = /^[A-Za-z0-9_-]{43}$/u;
const UTC_RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/u;
const BASE_KEYS = ['keyId', 'notAfter', 'notBefore', 'publicKey', 'status'].sort();
const STATUS_KEYS = Object.freeze({
  next: BASE_KEYS,
  active: BASE_KEYS,
  retired: [...BASE_KEYS, 'retiredAt'].sort(),
  revoked: [...BASE_KEYS, 'revocationReason', 'revokedAt'].sort(),
});

export class ReleaseVerificationError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReleaseVerificationError';
    this.code = code;
  }
}

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

function parseInstant(value) {
  const match = typeof value === 'string' ? UTC_RFC3339.exec(value) : null;
  if (match === null || Buffer.byteLength(value, 'utf8') > 4096) fail();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) fail();
  const calendar = new Date(milliseconds).toISOString().slice(0, 19);
  if (calendar !== `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`) fail();
  return milliseconds;
}

function canonicalPublicKey(value) {
  return boundedString(value, { nonempty: true }) && PUBLIC_KEY.test(value)
    && Buffer.from(value, 'base64url').byteLength === 32
    && Buffer.from(value, 'base64url').toString('base64url') === value;
}

function validateRecord(record) {
  const expectedKeys = typeof record === 'object' && record !== null
    ? STATUS_KEYS[record.status] : undefined;
  if (expectedKeys === undefined || !exactKeys(record, expectedKeys)
    || !boundedString(record.keyId, { nonempty: true })
    || !canonicalPublicKey(record.publicKey)) fail();
  const notBefore = parseInstant(record.notBefore);
  const notAfter = parseInstant(record.notAfter);
  if (notBefore >= notAfter) fail();
  if (record.status === 'retired') {
    const retiredAt = parseInstant(record.retiredAt);
    if (retiredAt < notBefore || retiredAt >= notAfter) fail();
  } else if (record.status === 'revoked') {
    const revokedAt = parseInstant(record.revokedAt);
    if (revokedAt < notBefore || revokedAt >= notAfter
      || !boundedString(record.revocationReason, { nonempty: true })) fail();
  }
  return Object.freeze(record);
}

export async function loadReleaseTrustStore(value) {
  try {
    const trustStore = await readStrictJsonDocument(value);
    if (!exactKeys(trustStore, ['keys']) || !Array.isArray(trustStore.keys)
      || trustStore.keys.length === 0) fail();
    const keys = trustStore.keys.map(validateRecord);
    if (new Set(keys.map(record => record.keyId)).size !== keys.length) fail();
    return Object.freeze({ keys: Object.freeze(keys) });
  } catch (error) {
    if (error instanceof ReleaseVerificationError) throw error;
    fail();
  }
}

export function selectSigningKey(
  trustStore,
  keyId,
  now,
  { allowRetiredForRollback = false } = {},
) {
  if (!exactKeys(trustStore, ['keys']) || !Array.isArray(trustStore.keys)
    || typeof keyId !== 'string' || keyId.length === 0) fail('SIGNING_KEY_UNKNOWN');
  if (!(now instanceof Date) || Number.isNaN(now.getTime())
    || typeof allowRetiredForRollback !== 'boolean') fail();
  const record = trustStore.keys.find(candidate => candidate?.keyId === keyId);
  if (record === undefined) fail('SIGNING_KEY_UNKNOWN');
  if (record.status === 'revoked') fail('SIGNING_KEY_REVOKED');
  const at = now.getTime();
  if (at < Date.parse(record.notBefore) || at >= Date.parse(record.notAfter)) fail();
  if (record.status === 'active') return record;
  if (record.status === 'retired' && allowRetiredForRollback
    && at < Date.parse(record.retiredAt)) return record;
  fail();
}
