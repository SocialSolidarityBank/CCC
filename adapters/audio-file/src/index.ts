import { constants } from 'node:fs';
import { open, mkdir, realpath, lstat, stat, readdir, rename, link, unlink, rm, type FileHandle } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createHash, createHmac, createSecretKey, randomUUID, timingSafeEqual } from 'node:crypto';
import type { AudioDeletionEvidence, AudioStore } from '@ccc/contracts/runtime';
import { AudioStoreError, checkedBody, hashKey, validKey, validMetadata, validSha256 } from '@ccc/contracts/audio';
import { isRecord } from '@ccc/contracts/guards';
import { CHUNK_BYTES, decryptRecord, encryptRecord, footer, newContext, readContext, readExact, readFooter, writeAll } from './format';

function hasCode(error: unknown, code: string): boolean { return isRecord(error) && error.code === code; }
async function privateDirectory(path: string): Promise<boolean> {
  try {
    const info = await lstat(path);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new AudioStoreError();
    return true;
  } catch (error) { if (hasCode(error, 'ENOENT')) return false; throw error; }
}
async function syncDirectory(path: string): Promise<void> {
  const directory = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await directory.sync(); } finally { await directory.close(); }
}
async function readFileHandle(path: string): Promise<FileHandle | null> {
  let file: FileHandle;
  try { file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (hasCode(error, 'ENOENT')) return null; throw error; }
  try { if (!(await file.stat()).isFile()) throw new AudioStoreError(); return file; }
  catch (error) { await file.close(); throw error; }
}
interface DeletionRecord {
  formatVersion: 1;
  keyVersion: number;
  keyHash: string;
  deletionAttemptId: string;
  deletionRequestedAt: string;
  generationId: string | null;
  deletedAt: string | null;
}
/** Composition supplies one versioned FILE_ENC_KEY; this adapter never fetches or persists secret material. */
export async function createFileAudioStore(rootPath: string, fileKey: { bytes: Uint8Array; version: number }): Promise<AudioStore> {
  if (!(fileKey.bytes instanceof Uint8Array) || fileKey.bytes.byteLength !== 32 || !Number.isInteger(fileKey.version) || fileKey.version < 1 || fileKey.version > 0xffffffff) throw new AudioStoreError();
  const master = createSecretKey(fileKey.bytes);
  const keyVersion = fileKey.version;
  let root: string;
  try {
    const supplied = resolve(rootPath);
    try { await mkdir(supplied, { mode: 0o700 }); }
    catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
    if (!(await privateDirectory(supplied)) || ((await lstat(supplied)).mode & 0o077) !== 0) throw new AudioStoreError();
    root = await realpath(supplied);
    await syncDirectory(root);
    await syncDirectory(dirname(root));
  } catch { throw new AudioStoreError(); }
  function mac(bytes: Uint8Array): Buffer { return createHmac('sha256', master).update('CCC-AUDIO-DELETE\0v1').update(bytes).digest(); }
  async function readJournal(path: string, expectedHash: string): Promise<DeletionRecord | null> {
    const file = await readFileHandle(path); if (file === null) return null;
    try {
      const size = (await file.stat()).size;
      if (size < 66 || size > 4096) throw new AudioStoreError();
      const bytes = await readExact(file, size, 0); const separator = bytes.length - 65;
      const digest = bytes.subarray(separator + 1).toString('ascii');
      if (bytes[separator] !== 10 || !validSha256(digest) || !timingSafeEqual(mac(bytes.subarray(0, separator)), Buffer.from(digest, 'hex'))) throw new AudioStoreError();
      const value: unknown = JSON.parse(bytes.subarray(0, separator).toString('utf8'));
      if (!isRecord(value) || value.formatVersion !== 1 || value.keyVersion !== keyVersion || value.keyHash !== expectedHash
        || typeof value.deletionAttemptId !== 'string' || !validKey(`audio/x/${value.deletionAttemptId}`)
        || typeof value.deletionRequestedAt !== 'string' || !Number.isFinite(Date.parse(value.deletionRequestedAt))
        || !(value.generationId === null || typeof value.generationId === 'string' && validKey(`audio/x/${value.generationId}`))
        || !(value.deletedAt === null || typeof value.deletedAt === 'string' && Number.isFinite(Date.parse(value.deletedAt)))) throw new AudioStoreError();
      return value as unknown as DeletionRecord;
    } finally { await file.close(); }
  }
  async function journal(path: string, value: DeletionRecord): Promise<DeletionRecord> {
    const temporary = join(root, `.journal-${randomUUID()}`);
    const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      try {
        const body = Buffer.from(JSON.stringify(value));
        await writeAll(file, Buffer.concat([body, Buffer.from(`\n${mac(body).toString('hex')}`)]));
        await file.sync();
      } finally { await file.close(); }
      try { await link(temporary, path); } catch (error) { if (!hasCode(error, 'EEXIST')) throw error; }
      await syncDirectory(root);
      const stored = await readJournal(path, value.keyHash);
      if (stored === null) throw new AudioStoreError();
      return stored;
    } finally { await unlink(temporary); await syncDirectory(root); }
  }
  return {
    async put(key, source, metadata) {
      if (!validKey(key) || !validMetadata(metadata)) throw new AudioStoreError();
      const hashed = hashKey(key); const directory = join(root, hashed); const marker = join(root, `${hashed}.delete`);
      const stage = join(directory, `${randomUUID()}.part`);
      let owned = false; let file: FileHandle | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        if (await readJournal(marker, hashed)) throw new AudioStoreError();
        await mkdir(directory, { mode: 0o700 }); owned = true;
        // The second check closes creation racing a durable deletion marker.
        if (await readJournal(marker, hashed)) throw new AudioStoreError();
        await syncDirectory(root);
        file = await open(stage, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        const ctx = newContext(master, metadata, hashed, keyVersion);
        await writeAll(file, ctx.frame); await writeAll(file, encryptRecord(ctx, 0, 0, new Uint8Array()));
        const hash = createHash('sha256');
        reader = checkedBody(source, metadata.contentLength, hash, metadata.expiresAt).getReader();
        const chunk = Buffer.alloc(CHUNK_BYTES); let used = 0; let index = 1;
        try {
          while (true) {
            const next = await reader.read(); if (next.done) break;
            let offset = 0;
            while (offset < next.value.byteLength) {
              const count = Math.min(CHUNK_BYTES - used, next.value.byteLength - offset);
              chunk.set(next.value.subarray(offset, offset + count), used); used += count; offset += count;
              if (used === CHUNK_BYTES) { await writeAll(file, encryptRecord(ctx, index++, 1, chunk)); used = 0; }
            }
          }
          if (used > 0) await writeAll(file, encryptRecord(ctx, index++, 1, chunk.subarray(0, used)));
        } finally { chunk.fill(0); }
        if (index !== ctx.count + 1 || Date.now() >= Date.parse(metadata.expiresAt)) throw new AudioStoreError();
        const sha256 = hash.digest('hex'); await writeAll(file, footer(ctx, sha256));
        await file.sync(); await file.close(); file = undefined;
        // Exclusive hard-link promotion never overwrites a committed generation.
        // A deletion renames the whole directory, making this original stage path unusable.
        await link(stage, join(directory, 'object'));
        await unlink(stage); await syncDirectory(directory);
        return { sha256, generationId: ctx.generationId };
      } catch {
        await reader?.cancel().catch(() => undefined);
        await file?.close().catch(() => undefined);
        try {
          if (owned) { await rm(directory, { recursive: true, force: true }); await syncDirectory(root); }
        } finally { throw new AudioStoreError(); }
      } finally { reader?.releaseLock(); }
    },
    async get(key) {
      if (!validKey(key)) return null;
      const hashed = hashKey(key); const directory = join(root, hashed);
      let file: FileHandle | null = null;
      try {
        if (!(await privateDirectory(directory))) return null;
        file = await readFileHandle(join(directory, 'object')); if (file === null) return null;
        const handle = file;
        const ctx = await readContext(handle, master, hashed, keyVersion);
        const sha256 = await readFooter(handle, ctx);
        const hash = createHash('sha256'); let index = 1; let position = ctx.dataOffset; let closed = false;
        async function close() { if (!closed) { closed = true; await handle.close(); } }
        const body = new ReadableStream<Uint8Array>({
          async pull(controller) {
            try {
              const length = Math.min(CHUNK_BYTES, ctx.metadata.contentLength - (index - 1) * CHUNK_BYTES);
              const plaintext = decryptRecord(ctx, index, 1, length, await readExact(handle, length + 16, position));
              position += length + 16; hash.update(plaintext);
              if (index === ctx.count) {
                try {
                  if (await readFooter(handle, ctx) !== sha256 || hash.digest('hex') !== sha256) throw new AudioStoreError();
                  await close();
                } catch (error) { plaintext.fill(0); throw error; }
                controller.enqueue(plaintext); controller.close();
              } else { index += 1; controller.enqueue(plaintext); }
            } catch { await close().catch(() => undefined); controller.error(new AudioStoreError()); }
          },
          async cancel() { await close(); },
        }, { highWaterMark: 0 });
        return { ...ctx.metadata, generationId: ctx.generationId, sha256, body };
      } catch (error) {
        await file?.close().catch(() => undefined);
        if (hasCode(error, 'EACCES') || hasCode(error, 'EPERM')) return null;
        throw new AudioStoreError();
      }
    },
    async delete(key) {
      if (!validKey(key)) throw new AudioStoreError();
      const hashed = hashKey(key); const directory = join(root, hashed);
      const requested = new Date().toISOString();
      const evidence: AudioDeletionEvidence = { keyHash: hashed, generationId: null, objectSha256: null, deletionAttemptId: randomUUID(), deletionRequestedAt: requested, providerDeleteAcceptedAt: null, deletedAt: null, deleteSucceeded: false, absentFromList: false, absentFromMetadata: false, directReadAbsent: false, verificationMethod: 'filesystem-stat-enoent', verifiedAt: requested };
      try {
        const intent = await journal(join(root, `${hashed}.delete`), { formatVersion: 1, keyVersion, keyHash: hashed, deletionAttemptId: evidence.deletionAttemptId, deletionRequestedAt: requested, generationId: null, deletedAt: null });
        evidence.deletionAttemptId = intent.deletionAttemptId; evidence.deletionRequestedAt = intent.deletionRequestedAt;
        const grave = join(root, `${hashed}.deleted-${intent.deletionAttemptId}`);
        const acceptedPath = join(root, `${hashed}.accepted`);
        const unverifiedPath = join(root, `${hashed}.unverified`);
        let unverified = await readJournal(unverifiedPath, hashed);
        let accepted = await readJournal(acceptedPath, hashed);
        if (await privateDirectory(directory)) {
          if (accepted !== null || await privateDirectory(grave)) throw new AudioStoreError();
          try { await rename(directory, grave); } catch (error) { if (!hasCode(error, 'ENOENT')) throw error; }
        }
        await syncDirectory(root);
        if (accepted === null && unverified === null) {
          let generationId: string | null = null;
          try {
            if (await privateDirectory(grave)) {
              const object = await readFileHandle(join(grave, 'object'));
              if (object !== null) {
                try { generationId = (await readContext(object, master, hashed, keyVersion)).generationId; }
                finally { await object.close(); }
              }
            }
          } catch {
            // Persist this distinction before removal: retry must not reinterpret corrupt audio
            // as a never-uploaded key merely because cleanup made its bytes absent.
            unverified = await journal(unverifiedPath, { ...intent, generationId: null, deletedAt: new Date().toISOString() });
          }
          if (unverified === null) accepted = await journal(acceptedPath, { ...intent, generationId, deletedAt: new Date().toISOString() });
        }
        const receipt = unverified ?? accepted;
        if (receipt === null || receipt.deletionAttemptId !== intent.deletionAttemptId || receipt.deletedAt === null) throw new AudioStoreError();
        if (await privateDirectory(grave)) await rm(grave, { recursive: true, force: true });
        await syncDirectory(root);
        evidence.generationId = unverified === null ? receipt.generationId : null;
        evidence.providerDeleteAcceptedAt = receipt.deletedAt; evidence.deletedAt = receipt.deletedAt;
        evidence.deleteSucceeded = unverified === null;
        evidence.absentFromList = !(await readdir(root)).includes(hashed);
        try { await lstat(join(directory, 'object')); } catch (error) { if (hasCode(error, 'ENOENT')) evidence.absentFromMetadata = true; }
        try { await stat(join(directory, 'object')); } catch (error) { if (hasCode(error, 'ENOENT')) evidence.directReadAbsent = true; }
      } catch { /* Failed durability or observation never becomes successful evidence. */ }
      evidence.verifiedAt = new Date().toISOString();
      return evidence;
    },
    async createUploadTarget() { return null; },
    async createDownloadTarget() { return null; },
  };
}
