import assert from 'node:assert/strict';
import { test } from 'node:test';
import { byteStore, type NativeDpapi, type DpapiRecord } from '../src/store.ts';
import { createDpapiSecretStore } from '../src/index.ts';

const record = (): DpapiRecord => ({ schemaVersion: 1, name: 'FILE_ENC_KEY', version: 3, blob: new Uint8Array([1, 2, 3]) });
test('unprotect returns independent plain bytes and wipes native output without retaining caller records', async () => {
  const original = record(); const nativeOutput = Buffer.alloc(32, 37); let encrypted: Uint8Array | undefined;
  const native: NativeDpapi = { protectData() { throw new Error(); }, unprotectData(data, binding, scope) {
    assert.equal(scope, 'CurrentUser'); assert(binding !== null); encrypted = data;
    assert.deepEqual(Array.from(data), [1, 2, 3]); return nativeOutput;
  } };
  const store = byteStore(native, 'local-single', [original]); original.blob.fill(0);
  const result = await store.getBytesWithVersion('FILE_ENC_KEY'); assert(result !== null);
  try {
    assert.equal(result.version, 3); assert.equal(Object.getPrototypeOf(result.bytes), Uint8Array.prototype);
    assert(result.bytes.every(byte => byte === 37)); assert(nativeOutput.every(byte => byte === 0));
    assert.equal(await store.getBytesWithVersion('OFFICE_CA_KEY'), null);
    store.close(); assert(encrypted?.every(byte => byte === 0));
    await assert.rejects(store.getBytesWithVersion('FILE_ENC_KEY'), /^Error: secret_access_denied$/);
  } finally { result.bytes.fill(0); store.close(); }
});
test('native failures never expose vendor details or generate replacement material', async () => {
  let protects = 0;
  const store = byteStore({ protectData() { protects++; throw new Error(); }, unprotectData() { throw new Error('synthetic-sensitive-provider-detail'); } }, 'local-office', [record()]);
  try { await assert.rejects(store.getBytesWithVersion('FILE_ENC_KEY'), /^Error: secret_access_denied$/); assert.equal(protects, 0); }
  finally { store.close(); }
});
test('invalid decrypted key length is wiped and rejected', async () => {
  const nativeOutput = Buffer.alloc(31, 37);
  const store = byteStore({ protectData() { throw new Error(); }, unprotectData() { return nativeOutput; } }, 'local-single', [record()]);
  try { await assert.rejects(store.getBytesWithVersion('FILE_ENC_KEY'), /^Error: secret_access_denied$/); assert(nativeOutput.every(byte => byte === 0)); }
  finally { store.close(); }
});
test('protect wipes owned input even on failure and binds name/version without mutating caller bytes', () => {
  const caller = new Uint8Array(32).fill(37); let captured: Uint8Array | undefined; let binding: Uint8Array | null = null;
  const store = byteStore({ protectData(data, optionalEntropy, scope) {
    captured = data; binding = optionalEntropy; assert.equal(scope, 'CurrentUser');
    assert.match(new TextDecoder().decode(binding!), /FILE_ENC_KEY\u00003$/);
    throw new Error('synthetic-private-native-error');
  }, unprotectData() { throw new Error(); } }, 'local-single', []);
  try {
    assert.throws(() => store.protect('FILE_ENC_KEY', { bytes: caller, version: 3 }), /^Error: secret_access_denied$/);
    assert(captured?.every(byte => byte === 0)); assert(caller.every(byte => byte === 37));
    assert(binding !== null); assert((binding as Uint8Array).every(byte => byte === 0));
    assert.throws(() => store.protect('FILE_ENC_KEY', { bytes: Buffer.alloc(32), version: 3 }), /^Error: secret_invalid$/);
  } finally { caller.fill(0); store.close(); }
});
test('protect returns owned ciphertext while wiping native input/output and preserving caller material', () => {
  const caller = new Uint8Array(32).fill(37);
  const encrypted = Buffer.from([13, 17, 23]); let input: Uint8Array | undefined;
  const store = byteStore({ protectData(data, _entropy, scope) {
    assert.equal(scope, 'CurrentUser'); input = data; return encrypted;
  }, unprotectData() { assert.fail(); } }, 'local-office', []);
  try {
    const protectedRecord = store.protect('DB_MASTER_KEY', { bytes: caller, version: 2 });
    assert.deepEqual(protectedRecord, { schemaVersion: 1, name: 'DB_MASTER_KEY', version: 2, blob: new Uint8Array([13, 17, 23]) });
    assert(input?.every(byte => byte === 0)); assert(encrypted.every(byte => byte === 0));
    assert(caller.every(byte => byte === 37));
  } finally { caller.fill(0); store.close(); }
});
test('forbidden names, duplicate records and Office keys on Single fail before native access', async () => {
  const native: NativeDpapi = { protectData() { assert.fail(); }, unprotectData() { assert.fail(); } };
  assert.throws(() => byteStore(native, 'local-single', [record(), record()]), /^Error: secret_invalid$/);
  assert.throws(() => byteStore(native, 'local-single', [{ ...record(), name: 'OFFICE_CA_KEY' }]), /^Error: secret_invalid$/);
  const store = byteStore(native, 'local-office', []);
  try {
    // @ts-expect-error Python names are not TypeScript recovery secrets.
    await assert.rejects(store.getBytesWithVersion('AZURE_SPEECH_KEY'), /^Error: secret_invalid$/);
  } finally { store.close(); }
});
test('production loader refuses unsupported platforms without a fallback', { skip: process.platform === 'win32' ? 'Windows native evidence runs through build:native and the safe-machine handoff' : false }, () => {
  assert.throws(() => createDpapiSecretStore('local-single', []), /^Error: secret_access_denied$/);
});
