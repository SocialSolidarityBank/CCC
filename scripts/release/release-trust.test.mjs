import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test from 'node:test';

import { loadReleaseTrustStore, selectSigningKey } from './release-trust.mjs';

function publicKey() {
  return generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }).x;
}

const records = [
  {
    keyId: 'next-key', publicKey: publicKey(), status: 'next',
    notBefore: '2026-09-01T00:00:00.000Z', notAfter: '2026-10-01T00:00:00.000Z',
  },
  {
    keyId: 'active-key', publicKey: publicKey(), status: 'active',
    notBefore: '2026-09-01T00:00:00.000Z', notAfter: '2026-10-01T00:00:00.000Z',
  },
  {
    keyId: 'retired-key', publicKey: publicKey(), status: 'retired',
    notBefore: '2026-08-01T00:00:00.000Z', notAfter: '2026-10-01T00:00:00.000Z',
    retiredAt: '2026-09-10T00:00:00.000Z',
  },
  {
    keyId: 'revoked-key', publicKey: publicKey(), status: 'revoked',
    notBefore: '2026-08-01T00:00:00.000Z', notAfter: '2026-10-01T00:00:00.000Z',
    revokedAt: '2026-09-10T00:00:00.000Z', revocationReason: 'synthetic compromise',
  },
];

function load(value = records) {
  return loadReleaseTrustStore(JSON.stringify({ keys: value }));
}

function throwsCode(callback, code) {
  assert.throws(callback, error => error instanceof Error && error.code === code && error.message === code);
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, error => error instanceof Error && error.code === code && error.message === code);
}

const trustStore = await load();

test('loads next, active, retired and revoked release key records without transitions', () => {
  assert.deepEqual(trustStore.keys, records);
  assert.deepEqual(trustStore.keys.map(record => record.status), ['next', 'active', 'retired', 'revoked']);
});

test('rejects unknown, missing, extra and wrong-typed record fields', async t => {
  const cases = [
    ['unknown status', value => { value[0].status = 'disabled'; }],
    ['missing field', value => { delete value[0].notAfter; }],
    ['extra field', value => { value[0].extra = true; }],
    ['wrong type', value => { value[0].keyId = 7; }],
    ['retired metadata on active', value => { value[1].retiredAt = '2026-09-10T00:00:00.000Z'; }],
    ['missing retiredAt', value => { delete value[2].retiredAt; }],
    ['missing revocation metadata', value => { delete value[3].revocationReason; }],
  ];
  for (const [name, change] of cases) {
    await t.test(name, async () => {
      const value = structuredClone(records);
      change(value);
      await rejectsCode(load(value), 'SIGNATURE_INVALID');
    });
  }
});

test('rejects duplicate JSON keys, duplicate key IDs and empty stores', async () => {
  const raw = JSON.stringify({ keys: records })
    .replace('"status":"active"', '"status":"active","status":"active"');
  await rejectsCode(loadReleaseTrustStore(raw), 'SIGNATURE_INVALID');
  const duplicate = structuredClone(records);
  duplicate[1].keyId = duplicate[0].keyId;
  await rejectsCode(load(duplicate), 'SIGNATURE_INVALID');
  await rejectsCode(loadReleaseTrustStore(JSON.stringify({ keys: records, extra: true })), 'SIGNATURE_INVALID');
  await rejectsCode(load([]), 'SIGNATURE_INVALID');
});

test('enforces canonical 43-character unpadded base64url public keys', async () => {
  for (const invalid of [
    `${records[0].publicKey}=`,
    records[0].publicKey.slice(0, -1),
    '+'.repeat(43),
  ]) {
    const value = structuredClone(records);
    value[0].publicKey = invalid;
    await rejectsCode(load(value), 'SIGNATURE_INVALID');
  }
});

test('enforces exact UTC validity windows and 4096-byte strings', async () => {
  for (const change of [
    value => { value[0].notBefore = '2026-09-01T09:00:00+09:00'; },
    value => { value[0].notAfter = value[0].notBefore; },
    value => { value[0].keyId = '가'.repeat(1366); },
    value => { value[2].retiredAt = '2026-07-31T23:59:59.999Z'; },
    value => { value[3].revokedAt = '2026-10-01T00:00:00.000Z'; },
  ]) {
    const value = structuredClone(records);
    change(value);
    await rejectsCode(load(value), 'SIGNATURE_INVALID');
  }
});

test('selects only an active key inside its validity window', () => {
  assert.equal(selectSigningKey(trustStore, 'active-key', new Date('2026-09-11T00:00:00.000Z'), {
    allowRetiredForRollback: false,
  }).keyId, 'active-key');
  throwsCode(() => selectSigningKey(trustStore, 'next-key', new Date('2026-09-11T00:00:00.000Z'), {
    allowRetiredForRollback: false,
  }), 'SIGNATURE_INVALID');
  throwsCode(() => selectSigningKey(trustStore, 'active-key', new Date('2026-10-01T00:00:00.000Z'), {
    allowRetiredForRollback: false,
  }), 'SIGNATURE_INVALID');
});

test('rejects unknown and revoked keys outright including rollback', () => {
  throwsCode(() => selectSigningKey(trustStore, 'missing-key', new Date('2026-09-09T00:00:00.000Z'), {
    allowRetiredForRollback: true,
  }), 'SIGNING_KEY_UNKNOWN');
  throwsCode(() => selectSigningKey(trustStore, 'revoked-key', new Date('2026-09-09T00:00:00.000Z'), {
    allowRetiredForRollback: true,
  }), 'SIGNING_KEY_REVOKED');
});

test('allows a retired key only for an explicit historical rollback before retirement', () => {
  const historicalTime = new Date('2026-09-09T23:59:59.999Z');
  throwsCode(() => selectSigningKey(trustStore, 'retired-key', historicalTime, {
    allowRetiredForRollback: false,
  }), 'SIGNATURE_INVALID');
  assert.equal(selectSigningKey(trustStore, 'retired-key', historicalTime, {
    allowRetiredForRollback: true,
  }).keyId, 'retired-key');
  throwsCode(() => selectSigningKey(trustStore, 'retired-key', new Date('2026-09-10T00:00:00.000Z'), {
    allowRetiredForRollback: true,
  }), 'SIGNATURE_INVALID');
});

test('fails closed on invalid selection inputs', () => {
  throwsCode(() => selectSigningKey(trustStore, '', new Date('2026-09-11T00:00:00.000Z'), {
    allowRetiredForRollback: false,
  }), 'SIGNING_KEY_UNKNOWN');
  throwsCode(() => selectSigningKey(trustStore, 'active-key', new Date('invalid'), {
    allowRetiredForRollback: false,
  }), 'SIGNATURE_INVALID');
  throwsCode(() => selectSigningKey(trustStore, 'active-key', new Date('2026-09-11T00:00:00.000Z'), {
    allowRetiredForRollback: 'yes',
  }), 'SIGNATURE_INVALID');
});
