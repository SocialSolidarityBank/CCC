import { createCipheriv, createDecipheriv, createSecretKey, hkdfSync, randomBytes, randomUUID, type KeyObject } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';
import type { AudioObjectMetadata } from '@ccc/contracts/runtime';
import { AudioStoreError, validKey, validMetadata, validSha256 } from '@ccc/contracts/audio';
import { isRecord } from '@ccc/contracts/guards';

export const CHUNK_BYTES = 65_536;
const MAGIC = Buffer.from([0x43, 0x43, 0x43, 0x41, 1]);
const DOMAIN = Buffer.from('CCC-AUDIO-FILE\0v1');
const KEY_DOMAIN = Buffer.from('CCC-AUDIO-FILE\0v1\0object-key');
export interface FileContext {
  metadata: AudioObjectMetadata;
  generationId: string;
  keyHash: string;
  keyVersion: number;
  noncePrefix: Buffer;
  key: KeyObject;
  frame: Buffer;
  dataOffset: number;
  count: number;
  footerOffset: number;
  fileBytes: number;
}
export async function readExact(file: FileHandle, length: number, position: number): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(length);
  let offset = 0;
  while (offset < length) {
    const result = await file.read(bytes, offset, length - offset, position + offset);
    if (result.bytesRead === 0) throw new AudioStoreError();
    offset += result.bytesRead;
  }
  return bytes;
}
export async function writeAll(file: FileHandle, bytes: Uint8Array): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await file.write(bytes, offset, bytes.byteLength - offset);
    if (result.bytesWritten === 0) throw new AudioStoreError();
    offset += result.bytesWritten;
  }
}
function headerBytes(metadata: AudioObjectMetadata, keyHash: string, keyVersion: number, generationId: string, noncePrefix: Buffer): Buffer {
  return Buffer.from(JSON.stringify({ formatVersion: 1, keyVersion, chunkBytes: CHUNK_BYTES, keyHash, generationId, noncePrefix: noncePrefix.toString('hex'), contentLength: metadata.contentLength, contentType: metadata.contentType, expiresAt: metadata.expiresAt }));
}
function context(master: KeyObject, metadata: AudioObjectMetadata, keyHash: string, keyVersion: number, generationId: string, noncePrefix: Buffer): FileContext {
  const header = headerBytes(metadata, keyHash, keyVersion, generationId, noncePrefix);
  if (header.length > 4096) throw new AudioStoreError();
  const prefix = Buffer.alloc(9); MAGIC.copy(prefix); prefix.writeUInt32BE(header.length, 5);
  const frame = Buffer.concat([prefix, header]);
  const salt = Buffer.concat([Buffer.from(generationId.replaceAll('-', ''), 'hex'), noncePrefix]);
  const derived = Buffer.from(hkdfSync('sha256', master, salt, KEY_DOMAIN, 32));
  const key = createSecretKey(derived); derived.fill(0);
  const count = Math.ceil(metadata.contentLength / CHUNK_BYTES);
  const dataOffset = frame.length + 16;
  const footerOffset = dataOffset + metadata.contentLength + count * 16;
  return { metadata, keyHash, keyVersion, generationId, noncePrefix, key, frame, dataOffset, count, footerOffset, fileBytes: footerOffset + 56 };
}
export function newContext(master: KeyObject, metadata: AudioObjectMetadata, keyHash: string, keyVersion: number): FileContext {
  return context(master, { ...metadata }, keyHash, keyVersion, randomUUID(), randomBytes(8));
}
function recordParameters(ctx: FileContext, index: number, kind: number, length: number) {
  const nonce = Buffer.alloc(12); ctx.noncePrefix.copy(nonce); nonce.writeUInt32BE(index, 8);
  const record = Buffer.alloc(9); record[0] = kind; record.writeUInt32BE(index, 1); record.writeUInt32BE(length, 5);
  return { nonce, aad: Buffer.concat([DOMAIN, ctx.frame, record]) };
}
export function encryptRecord(ctx: FileContext, index: number, kind: number, plaintext: Uint8Array): Buffer {
  const { nonce, aad } = recordParameters(ctx, index, kind, plaintext.byteLength);
  const cipher = createCipheriv('aes-256-gcm', ctx.key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  return Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
}
export function decryptRecord(ctx: FileContext, index: number, kind: number, length: number, record: Buffer): Buffer {
  if (record.length !== length + 16) throw new AudioStoreError();
  const { nonce, aad } = recordParameters(ctx, index, kind, length);
  const decipher = createDecipheriv('aes-256-gcm', ctx.key, nonce, { authTagLength: 16 });
  decipher.setAAD(aad); decipher.setAuthTag(record.subarray(length));
  const plaintext = decipher.update(record.subarray(0, length));
  try { decipher.final(); return plaintext; }
  catch { plaintext.fill(0); throw new AudioStoreError(); }
}
export function footer(ctx: FileContext, sha256: string): Buffer {
  if (!validSha256(sha256)) throw new AudioStoreError();
  const body = Buffer.alloc(40);
  body.writeUInt32BE(ctx.metadata.contentLength); body.writeUInt32BE(ctx.count, 4);
  Buffer.from(sha256, 'hex').copy(body, 8);
  return encryptRecord(ctx, ctx.count + 1, 2, body);
}
export async function readFooter(file: FileHandle, ctx: FileContext): Promise<string> {
  const body = decryptRecord(ctx, ctx.count + 1, 2, 40, await readExact(file, 56, ctx.footerOffset));
  if (body.readUInt32BE(0) !== ctx.metadata.contentLength || body.readUInt32BE(4) !== ctx.count) throw new AudioStoreError();
  const extra = Buffer.alloc(1);
  if ((await file.read(extra, 0, 1, ctx.fileBytes)).bytesRead !== 0 || (await file.stat()).size !== ctx.fileBytes) throw new AudioStoreError();
  return body.subarray(8).toString('hex');
}
export async function readContext(file: FileHandle, master: KeyObject, keyHash: string, keyVersion: number): Promise<FileContext> {
  const prefix = await readExact(file, 9, 0);
  const length = prefix.readUInt32BE(5);
  if (!prefix.subarray(0, 5).equals(MAGIC) || length < 1 || length > 4096) throw new AudioStoreError();
  const header = await readExact(file, length, 9);
  const value: unknown = JSON.parse(header.toString('utf8'));
  if (!isRecord(value) || value.formatVersion !== 1 || value.keyVersion !== keyVersion || value.chunkBytes !== CHUNK_BYTES || value.keyHash !== keyHash
    || typeof value.generationId !== 'string' || !validKey(`audio/x/${value.generationId}`)
    || typeof value.noncePrefix !== 'string' || !/^[0-9a-f]{16}$/.test(value.noncePrefix)
    || typeof value.contentType !== 'string' || typeof value.expiresAt !== 'string' || typeof value.contentLength !== 'number') throw new AudioStoreError();
  const metadata = { contentLength: value.contentLength, contentType: value.contentType, expiresAt: value.expiresAt } as AudioObjectMetadata;
  if (!validMetadata(metadata, false)) throw new AudioStoreError();
  const ctx = context(master, metadata, keyHash, keyVersion, value.generationId, Buffer.from(value.noncePrefix, 'hex'));
  if (!ctx.frame.equals(Buffer.concat([prefix, header])) || (await file.stat()).size !== ctx.fileBytes) throw new AudioStoreError();
  decryptRecord(ctx, 0, 0, 0, await readExact(file, 16, ctx.frame.length));
  return ctx;
}
