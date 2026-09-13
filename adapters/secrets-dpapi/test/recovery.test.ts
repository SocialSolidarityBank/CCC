import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeCbor, decodeCbor, wipeCbor } from '#recovery-cbor';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProtectedRecordRepository } from '#protected-records';
import { sealRecoveryKit, openRecoveryKit } from '#recovery-kit';
import type { RecoveryBinding } from '#recovery-payload';
import { createDpapiSecretStore } from '../src/index.ts';

function binding(): RecoveryBinding {
  return { schemaVersion: 44, schemaDigest: new Uint8Array(32).fill(1), mode: 'local-single', kitId: 'kit-1',
    s10PayloadSha256: new Uint8Array(32).fill(2), sourceInstallationId: 'install-1', sourceOrgId: null,
    createdAt: '2026-07-16T00:00:00.000Z' };
}
function payload() {
  return { ...binding(), payloadVersion: 1, generation: 7, previousKitHash: null, stableUserId: 'single-user-1',
    dbMasterKey: { key: new Uint8Array(32).fill(19), version: 3 },
    fileMasterKey: { key: new Uint8Array(32).fill(31), version: 5 },
    piiEncKey: { key: new Uint8Array(32).fill(47), version: 2 }, officeCaKey: null,
    identityContinuity: { mode: 'local-single', stableUserId: 'single-user-1', actors: [] } };
}
const phrase = () => new TextEncoder().encode('synthetic phrase for test');

test('real Argon2id/GCM Kit roundtrip consumes secret buffers and authenticates scope and ciphertext', async () => {
  const source = payload(), passphrase = phrase();
  const wire = await sealRecoveryKit(source, passphrase);
  assert.deepEqual(passphrase, new Uint8Array(passphrase.length));
  assert.deepEqual(source.dbMasterKey.key, new Uint8Array(32));
  assert.deepEqual(wire.subarray(0, 5), new Uint8Array([67, 67, 67, 82, 1]));
  const opened = await openRecoveryKit(wire, phrase(), binding());
  assert.deepEqual(encodeCbor(opened), encodeCbor(payload())); wipeCbor(opened);
  await assert.rejects(openRecoveryKit(wire, phrase(), { ...binding(), sourceInstallationId: 'foreign-install' }), /^Error: recovery_kit_invalid$/);
  const wrongPhrase = new TextEncoder().encode('another synthetic phrase');
  await assert.rejects(openRecoveryKit(wire, wrongPhrase, binding()), /^Error: recovery_kit_integrity_failed$/);
  assert.deepEqual(wrongPhrase, new Uint8Array(wrongPhrase.length));
  wire[wire.length - 1]! ^= 1;
  await assert.rejects(openRecoveryKit(wire, phrase(), binding()), /^Error: recovery_kit_integrity_failed$/);
});

test('Kit rejects short scalar input and unknown payload fields, and exports with fresh salt and nonce', async () => {
  const short = new TextEncoder().encode('가'.repeat(15));
  await assert.rejects(sealRecoveryKit(payload(), short), /^Error: recovery_kit_invalid$/);
  assert.deepEqual(short, new Uint8Array(short.length));
  const malformed = { ...payload(), extra: 'unrecognized' };
  await assert.rejects(sealRecoveryKit(malformed, phrase()), /^Error: recovery_kit_invalid$/);
  assert.deepEqual(malformed.piiEncKey.key, new Uint8Array(32));
  const first = await sealRecoveryKit(payload(), new TextEncoder().encode('가'.repeat(16)));
  const second = await sealRecoveryKit(payload(), new TextEncoder().encode('가'.repeat(16)));
  function header(wire: Uint8Array) {
    const length = new DataView(wire.buffer, wire.byteOffset, wire.byteLength).getUint32(5);
    return JSON.parse(new TextDecoder().decode(wire.subarray(9, 9 + length)));
  }
  assert.notEqual(header(first).argon2id.saltB64, header(second).argon2id.saltB64);
  assert.notEqual(header(first).aes256Gcm.nonceB64, header(second).aes256Gcm.nonceB64);
  await assert.rejects(openRecoveryKit(first.subarray(0, first.length - 1), phrase(), binding()), /^Error: recovery_kit_invalid$/);
});

test('Kit rejects array coercion in actor kinds instead of sealing an invalid continuity record', async () => {
  const source = { ...payload(), mode: 'local-office', sourceOrgId: 'org-1', stableUserId: null,
    identityContinuity: { mode: 'local-office', stableUserId: null, actors: [
      { actorId: 'actor-1', kind: ['human'], roleIds: [], assignmentIds: [], credentialRefHashes: [],
        mfa: { required: false, enrolled: false, methodRefHashes: [] }, active: true },
    ] } };
  await assert.rejects(sealRecoveryKit(source, phrase()), /^Error: recovery_kit_invalid$/);
});

test('protected records persist immutably across reopen and reject conflict or tampering without activation', async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ccc-protected-records-')), root = join(parent, 'records');
  // Opaque synthetic ciphertext, not a DPAPI or Windows qualification result.
  const record = { schemaVersion: 1 as const, name: 'PII_ENC_KEY' as const, version: 2, blob: new Uint8Array([17, 28, 39, 40]) };
  try {
    const repo = await createProtectedRecordRepository(root, 'local-single');
    const digest = await repo.stage(7, [record]);
    assert.equal(await repo.stage(7, [record]), digest);
    const reopened = await createProtectedRecordRepository(root, 'local-single');
    const restored = await reopened.read(7, digest);
    assert.deepEqual(restored, [record]); restored[0]!.blob.fill(0);
    assert.deepEqual(await repo.read(7, digest), [record]);
    await assert.rejects(repo.stage(7, [{ ...record, version: 3 }]), /^Error: secret_access_denied$/);
    await assert.rejects(repo.read(8, digest), /^Error: secret_access_denied$/);
    await assert.rejects(readFile(join(root, 'active.json')), { code: 'ENOENT' });
    const file = join(root, 'generation-7', 'keys.cbor');
    const original = await readFile(file);
    await writeFile(file, original.subarray(0, original.length - 1));
    await assert.rejects(reopened.read(7, digest), /^Error: secret_access_denied$/);
  } finally { await rm(parent, { recursive: true, force: true }); }
});

test('Windows protected records reopen into the public byte store with exact versions', { skip: process.platform !== 'win32' }, async () => {
  const parent = await mkdtemp(join(tmpdir(), 'ccc-dpapi-persistent-')), root = join(parent, 'records');
  const writer = createDpapiSecretStore('local-single', []);
  const keys = ['DB_MASTER_KEY', 'FILE_ENC_KEY', 'PII_ENC_KEY'] as const;
  const records = [];
  let reader: ReturnType<typeof createDpapiSecretStore> | undefined;
  try {
    for (const [index, name] of keys.entries()) {
      const bytes = new Uint8Array(32).fill(19 + index);
      try { records.push(writer.protect(name, { bytes, version: index + 2 })); } finally { bytes.fill(0); }
    }
    const repository = await createProtectedRecordRepository(root, 'local-single');
    const digest = await repository.stage(7, records); writer.close();
    const reopened = await createProtectedRecordRepository(root, 'local-single');
    const restored = await reopened.read(7, digest);
    try { reader = createDpapiSecretStore('local-single', restored); } finally { for (const record of restored) record.blob.fill(0); }
    for (const [index, name] of keys.entries()) {
      const value = await reader.getBytesWithVersion(name);
      assert.ok(value); assert.equal(value.version, index + 2);
      try { assert.deepEqual(value.bytes, new Uint8Array(32).fill(19 + index)); } finally { value.bytes.fill(0); }
    }
  } finally {
    writer.close(); reader?.close(); for (const record of records) record.blob.fill(0);
    await rm(parent, { recursive: true, force: true });
  }
});

test('deterministic CBOR matches the wire vector and returns independent mutable bytes', () => {
  const key = new Uint8Array([19, 31]);
  const wire = new Uint8Array([0xa2, 0x61, 0x61, 1, 0x61, 0x62, 0x42, 19, 31]);
  assert.deepEqual(encodeCbor({ b: key, a: 1 }), wire);
  const decoded = decodeCbor(wire);
  if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded) || decoded instanceof Uint8Array) throw new Error('wrong decoded type');
  assert.equal(decoded.a, 1);
  assert.deepEqual(decoded.b, key);
  wipeCbor(decoded);
  assert.deepEqual(decoded.b, new Uint8Array(2));
  assert.deepEqual(wire, new Uint8Array([0xa2, 0x61, 0x61, 1, 0x61, 0x62, 0x42, 19, 31]));
  assert.deepEqual(key, new Uint8Array([19, 31]));
});

test('CBOR rejects duplicate, unordered, indefinite, nonminimal, truncated and trailing encodings', () => {
  for (const bytes of [
    [0xa2, 0x61, 0x61, 1, 0x61, 0x61, 2],
    [0xa2, 0x61, 0x62, 1, 0x61, 0x61, 2],
    [0x9f, 1, 0xff], [0x18, 1], [0x42, 19], [1, 2], [0x61, 0xff], [0xfa, 0, 0, 0, 0],
  ]) assert.throws(() => decodeCbor(new Uint8Array(bytes)), /^Error: recovery_kit_invalid$/);
});

test('CBOR text preserves a leading Unicode BOM rather than normalizing the signed payload', () => {
  assert.equal(decodeCbor(new Uint8Array([0x64, 0xef, 0xbb, 0xbf, 0x61])), '\ufeffa');
});
