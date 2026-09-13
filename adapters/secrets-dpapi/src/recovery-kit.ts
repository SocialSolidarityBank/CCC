import * as crypto from 'node:crypto';
import { canonicalizeJcs } from '@ccc/contracts/jcs';
import { encodeCbor, decodeCbor, wipeCbor, type CborValue } from '#recovery-cbor';
import { validateRecoveryPayload, type RecoveryBinding, type RecoveryPayload } from '#recovery-payload';
export type { RecoveryBinding, RecoveryPayload } from '#recovery-payload';
export { wipeCbor };

const MAGIC = new Uint8Array([67, 67, 67, 82, 1]);
const PREFIX = new TextEncoder().encode('CCC-RECOVERY-KIT\0v1');
const MAX_BYTES = 64 * 1024 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const salts = new Set<string>(), nonces = new Set<string>();
interface Header {
  formatVersion: 1; payloadBytes: number; ciphertextBytes: number; payloadSha256: string;
  argon2id: { saltB64: string; memoryKiB: 65536; iterations: 3; parallelism: 1 };
  aes256Gcm: { nonceB64: string };
}
function invalid(): never { throw new Error('recovery_kit_invalid'); }
function integrity(): never { throw new Error('recovery_kit_integrity_failed'); }
function hash(value: Uint8Array): string { return crypto.createHash('sha256').update(value).digest('hex'); }
function mutable(value: Uint8Array): void {
  if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype
    || !(value.buffer instanceof ArrayBuffer) || value.buffer.resizable) invalid();
}
/** Count UTF-8 Unicode scalars without constructing an immutable passphrase string. */
function validatePassphrase(value: Uint8Array): void {
  mutable(value); let count = 0;
  for (let i = 0; i < value.length;) {
    const first = value[i]!; let size: number;
    if (first <= 0x7f) size = 1;
    else if (first >= 0xc2 && first <= 0xdf) size = 2;
    else if (first >= 0xe0 && first <= 0xef) size = 3;
    else if (first >= 0xf0 && first <= 0xf4) size = 4;
    else invalid();
    if (i + size > value.length) invalid();
    for (let j = 1; j < size; j++) if (value[i + j]! < 0x80 || value[i + j]! > 0xbf) invalid();
    if (first === 0xe0 && value[i + 1]! < 0xa0 || first === 0xed && value[i + 1]! > 0x9f
      || first === 0xf0 && value[i + 1]! < 0x90 || first === 0xf4 && value[i + 1]! > 0x8f) invalid();
    count++; i += size;
  }
  if (count < 16) invalid();
}
async function derive(passphrase: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  // Node 24 supplies Argon2id; unsupported runtimes fail closed, never substitute another KDF.
  const argon2 = Reflect.get(crypto, 'argon2');
  if (typeof argon2 !== 'function') invalid();
  return new Promise((resolve, reject) => {
    argon2('argon2id', { message: passphrase, nonce: salt, memory: 65536, passes: 3, parallelism: 1, tagLength: 32 },
      (error: Error | null, key: Uint8Array) => {
        if (error || !(key instanceof Uint8Array) || key.length !== 32) { if (key instanceof Uint8Array) key.fill(0); reject(new Error('recovery_kit_invalid')); }
        else resolve(key);
      });
  });
}
function frame(header: Uint8Array): Uint8Array {
  if (header.length < 1 || header.length > 4096) invalid();
  const prefix = new Uint8Array(9 + header.length); prefix.set(MAGIC);
  new DataView(prefix.buffer).setUint32(5, header.length); prefix.set(header, 9); return prefix;
}
function aad(prefix: Uint8Array): Uint8Array { const value = new Uint8Array(PREFIX.length + prefix.length); value.set(PREFIX); value.set(prefix, PREFIX.length); return value; }
function exact(value: unknown, keys: string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(',')) invalid();
}
function base64url(value: unknown, length: number): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) invalid();
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value) { bytes.fill(0); invalid(); }
  const result = new Uint8Array(bytes); bytes.fill(0); return result;
}
function headerFrom(bytes: Uint8Array): { header: Header; salt: Uint8Array; nonce: Uint8Array } {
  const source = decoder.decode(bytes); const value: unknown = JSON.parse(source);
  exact(value, ['formatVersion', 'payloadBytes', 'ciphertextBytes', 'payloadSha256', 'argon2id', 'aes256Gcm']);
  exact(value.argon2id, ['saltB64', 'memoryKiB', 'iterations', 'parallelism']); exact(value.aes256Gcm, ['nonceB64']);
  if (source !== canonicalizeJcs(value) || value.formatVersion !== 1
    || !Number.isSafeInteger(value.payloadBytes) || Number(value.payloadBytes) <= 0 || Number(value.payloadBytes) > MAX_BYTES
    || value.ciphertextBytes !== value.payloadBytes || typeof value.payloadSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.payloadSha256)
    || value.argon2id.memoryKiB !== 65536 || value.argon2id.iterations !== 3 || value.argon2id.parallelism !== 1) invalid();
  const salt = base64url(value.argon2id.saltB64, 16);
  try { return { header: value as unknown as Header, salt, nonce: base64url(value.aes256Gcm.nonceB64, 12) }; }
  catch { salt.fill(0); invalid(); }
}
/** Cryptographic primitive, not an authorized export operation. Consumes all input secret buffers. */
export async function sealRecoveryKit(payload: CborValue, passphrase: Uint8Array): Promise<Uint8Array> {
  let plain: Uint8Array | undefined, derived: Uint8Array | undefined, random: Uint8Array | undefined;
  let ciphertext: Uint8Array | undefined, final: Uint8Array | undefined, tag: Uint8Array | undefined;
  try {
    validatePassphrase(passphrase); validateRecoveryPayload(payload);
    plain = encodeCbor(payload);
    random = crypto.randomFillSync(new Uint8Array(28)); const salt = random.subarray(0, 16), nonce = random.subarray(16);
    const saltB64 = Buffer.from(salt).toString('base64url'), nonceB64 = Buffer.from(nonce).toString('base64url');
    if (salts.has(saltB64) || nonces.has(nonceB64)) invalid(); salts.add(saltB64); nonces.add(nonceB64);
    const header: Header = { formatVersion: 1, payloadBytes: plain.length, ciphertextBytes: plain.length, payloadSha256: hash(plain),
      argon2id: { saltB64, memoryKiB: 65536, iterations: 3, parallelism: 1 }, aes256Gcm: { nonceB64 } };
    const prefix = frame(encoder.encode(canonicalizeJcs(header)));
    derived = await derive(passphrase, salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', derived, nonce); cipher.setAAD(aad(prefix));
    ciphertext = cipher.update(plain); final = cipher.final(); tag = cipher.getAuthTag();
    const output = new Uint8Array(prefix.length + ciphertext.length + final.length + tag.length);
    output.set(prefix); output.set(ciphertext, prefix.length); output.set(final, prefix.length + ciphertext.length);
    output.set(tag, output.length - tag.length); return output;
  } catch { return invalid(); }
  finally { if (passphrase instanceof Uint8Array) passphrase.fill(0); wipeCbor(payload); plain?.fill(0); derived?.fill(0); random?.fill(0); ciphertext?.fill(0); final?.fill(0); tag?.fill(0); }
}
/** Returns owned bytes only after framing, GCM, payload hash, canonical shape and trusted source binding pass. */
export async function openRecoveryKit(wire: Uint8Array, passphrase: Uint8Array, expected: RecoveryBinding): Promise<RecoveryPayload> {
  let salt: Uint8Array | undefined, nonce: Uint8Array | undefined, derived: Uint8Array | undefined;
  let clear: Uint8Array | undefined, final: Uint8Array | undefined, plain: Uint8Array | undefined, decoded: CborValue | undefined;
  try {
    validatePassphrase(passphrase);
    if (wire.length < 26 || wire.length > MAX_BYTES + 4121 || !MAGIC.every((byte, i) => wire[i] === byte)) invalid();
    const length = new DataView(wire.buffer, wire.byteOffset, wire.byteLength).getUint32(5);
    if (length < 1 || length > 4096 || 9 + length + 16 >= wire.length) invalid();
    const parsed = headerFrom(wire.subarray(9, 9 + length)); salt = parsed.salt; nonce = parsed.nonce;
    if (wire.length !== 9 + length + parsed.header.ciphertextBytes + 16) invalid();
    derived = await derive(passphrase, salt);
    const decipher = crypto.createDecipheriv('aes-256-gcm', derived, nonce);
    decipher.setAAD(aad(wire.subarray(0, 9 + length))); decipher.setAuthTag(wire.subarray(wire.length - 16));
    try { clear = decipher.update(wire.subarray(9 + length, wire.length - 16)); final = decipher.final(); }
    catch { integrity(); }
    plain = new Uint8Array(clear.length + final.length); plain.set(clear); plain.set(final, clear.length);
    if (plain.length !== parsed.header.payloadBytes || hash(plain) !== parsed.header.payloadSha256) integrity();
    decoded = decodeCbor(plain); const payload = validateRecoveryPayload(decoded, expected); decoded = undefined;
    return payload;
  } catch (error) {
    if (error instanceof Error && error.message === 'recovery_kit_integrity_failed') integrity();
    // Never expose parser, KDF, native cipher or source metadata diagnostics.
    return invalid();
  } finally {
    if (passphrase instanceof Uint8Array) passphrase.fill(0);
    salt?.fill(0); nonce?.fill(0); derived?.fill(0); clear?.fill(0); final?.fill(0); plain?.fill(0);
    if (decoded !== undefined) wipeCbor(decoded);
  }
}
