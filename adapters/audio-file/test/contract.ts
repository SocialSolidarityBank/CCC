/// <reference lib="es2024.promise" />
import { describe, it, expect } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, stat, readdir, mkdir, symlink, open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createFileAudioStore } from '../src/index';
import type { AudioObjectMetadata } from '@ccc/contracts/runtime';

const KEY = 'audio/session_01/550e8400-e29b-41d4-a716-446655440000';
const OTHER = 'audio/session_02/550e8400-e29b-41d4-a716-446655440001';
const keyHash = (key: string) => createHash('sha256').update(key).digest('hex');
const material = { bytes: new Uint8Array(32).fill(37), version: 1 };
const metadata = (contentLength: number): AudioObjectMetadata => ({ contentLength, contentType: 'audio/webm', expiresAt: new Date(Date.now() + 60_000).toISOString() });
function stream(length: number, chunk = 8191) {
  return new ReadableStream<Uint8Array>({ pull(controller) {
    if (length === 0) { controller.close(); return; }
    const count = Math.min(length, chunk); length -= count;
    controller.enqueue(new Uint8Array(count).fill(0x69));
  } });
}
async function fixture(run: (root: string, store: Awaited<ReturnType<typeof createFileAudioStore>>) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'ccc-audio-contract-'));
  try { await run(root, await createFileAudioStore(root, material)); }
  finally { await rm(root, { recursive: true, force: true }); }
}
async function digest(body: ReadableStream<Uint8Array>) {
  const hash = createHash('sha256'); let size = 0; let maxChunk = 0;
  for await (const chunk of body) { hash.update(chunk); size += chunk.length; maxChunk = Math.max(maxChunk, chunk.length); }
  return { sha256: hash.digest('hex'), size, maxChunk };
}
export function fileAudioStoreContract() {
  describe('encrypted filesystem AudioStore contract', () => {
    it('round trips canonical MIME metadata and bounded authenticated streams, without plaintext files', async () => fixture(async (root, store) => {
      for (const contentType of ['audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/x-m4a'] as const) {
        const key = KEY.replace('session_01', contentType.replaceAll('/', '_').replaceAll('-', '_'));
        const meta = { ...metadata(150_003), contentType };
        const written = await store.put(key, stream(meta.contentLength), meta);
        const download = await store.get(key); expect(download).not.toBeNull();
        expect(download).toMatchObject({ ...meta, ...written });
        expect(await digest(download!.body)).toEqual({ sha256: written.sha256, size: meta.contentLength, maxChunk: 65_536 });
        const persisted = await readFile(join(root, keyHash(key), 'object'));
        expect(persisted.includes(Buffer.alloc(1024, 0x69))).toBe(false);
      }
      expect(await store.createUploadTarget(KEY, metadata(1))).toBeNull();
      expect(await store.createDownloadTarget(KEY, 600)).toBeNull();
      expect(await store.get(OTHER)).toBeNull();
    }));
    it('enforces the inclusive 200 MiB boundary while streaming both directions', async () => fixture(async (_root, store) => {
      const limit = 200 * 1024 * 1024;
      const written = await store.put(KEY, stream(limit, 65_536), metadata(limit));
      expect(await digest((await store.get(KEY))!.body)).toEqual({ sha256: written.sha256, size: limit, maxChunk: 65_536 });
      await expect(store.put(OTHER, stream(limit + 1), metadata(limit + 1))).rejects.toThrow();
      expect(await store.get(OTHER)).toBeNull();
    }));
    it('rejects invalid keys, metadata and short or overrun streams without publishing partial objects', async () => fixture(async (root, store) => {
      for (const key of ['/tmp/audio.wav', KEY.replace('session_01', '..'), KEY.replace('session_01', 'session%2f01'), KEY.toUpperCase()]) {
        await expect(store.put(key, stream(1), metadata(1))).rejects.toThrow();
      }
      for (const meta of [{ ...metadata(1), contentType: 'video/mp4' }, metadata(0), metadata(1.5), { ...metadata(1), expiresAt: 'bad' }]) {
        await expect(store.put(KEY, stream(1), meta as AudioObjectMetadata)).rejects.toThrow();
      }
      for (const length of [9, 11]) {
        await expect(store.put(KEY, stream(length), metadata(10))).rejects.toThrow();
        expect(await store.get(KEY)).toBeNull();
        expect(await readdir(root)).toEqual([]);
      }
    }));
    it('rejects wrong material and key versions, including after reopening the store', async () => fixture(async (root, store) => {
      for (const key of [{ bytes: new Uint8Array(31), version: 1 }, { ...material, version: 0 }]) await expect(createFileAudioStore(root, key)).rejects.toThrow();
      await store.put(KEY, stream(10), metadata(10));
      const wrong = await createFileAudioStore(root, { bytes: new Uint8Array(32).fill(99), version: 1 });
      await expect(wrong.get(KEY)).rejects.toThrow();
      const version = await createFileAudioStore(root, { ...material, version: 2 });
      await expect(version.get(KEY)).rejects.toThrow();
      const restored = await createFileAudioStore(root, material);
      expect((await digest((await restored.get(KEY))!.body)).size).toBe(10);
    }));
    it('authenticates every chunk before release and rejects reordered records', async () => fixture(async (root, store) => {
      await store.put(KEY, stream(3 * 65_536), metadata(3 * 65_536));
      const path = join(root, keyHash(KEY), 'object'); const original = await readFile(path);
      const start = 9 + original.readUInt32BE(5) + 16;
      const tampered = Buffer.from(original); tampered[start] = tampered[start]! ^ 1;
      await writeFile(path, tampered);
      const reader = (await store.get(KEY))!.body.getReader();
      await expect(reader.read()).rejects.toThrow();
      const reordered = Buffer.from(original);
      original.copy(reordered, start, start + 65_552, start + 131_104);
      original.copy(reordered, start + 65_552, start, start + 65_552);
      await writeFile(path, reordered);
      await expect((await store.get(KEY))!.body.getReader().read()).rejects.toThrow();
    }));
    it('rejects final tag corruption, truncation, append and object substitution', async () => fixture(async (root, store) => {
      await store.put(KEY, stream(100), metadata(100));
      const path = join(root, keyHash(KEY), 'object'); const original = await readFile(path);
      const badTag = Buffer.from(original); badTag[badTag.length - 1] = badTag[badTag.length - 1]! ^ 1;
      for (const bytes of [badTag, original.subarray(0, -1), Buffer.concat([original, Buffer.from([0])])]) {
        await writeFile(path, bytes); await expect(store.get(KEY)).rejects.toThrow();
      }
      await writeFile(path, original);
      await mkdir(join(root, keyHash(OTHER)));
      await writeFile(join(root, keyHash(OTHER), 'object'), original);
      await expect(store.get(OTHER)).rejects.toThrow();
    }));
    it('cannot successfully complete a stream truncated after get authenticated its footer', async () => fixture(async (root, store) => {
      await store.put(KEY, stream(3 * 65_536), metadata(3 * 65_536));
      const download = (await store.get(KEY))!; const reader = download.body.getReader();
      expect((await reader.read()).value?.length).toBe(65_536);
      await writeFile(join(root, keyHash(KEY), 'object'), Buffer.alloc(0));
      await expect((async () => { while (!(await reader.read()).done) { /* drain through authenticated EOF */ } })()).rejects.toThrow();
    }));
    it('commits exclusively and records fresh durable deletion evidence across adapter restart', async () => fixture(async (root, store) => {
      const stored = await store.put(KEY, stream(10), metadata(10));
      await expect(store.put(KEY, stream(11), metadata(11))).rejects.toThrow();
      expect((await digest((await store.get(KEY))!.body)).size).toBe(10);
      const first = await store.delete(KEY);
      expect(first).toMatchObject({ generationId: stored.generationId, objectSha256: null, deleteSucceeded: true, absentFromList: true, absentFromMetadata: true, directReadAbsent: true, verificationMethod: 'filesystem-stat-enoent' });
      await expect(stat(join(root, keyHash(KEY), 'object'))).rejects.toMatchObject({ code: 'ENOENT' });
      const reopened = await createFileAudioStore(root, material); const again = await reopened.delete(KEY);
      expect(again).toMatchObject({ deletionAttemptId: first.deletionAttemptId, generationId: first.generationId, deletedAt: first.deletedAt, directReadAbsent: true });
      await expect(reopened.put(KEY, stream(1), metadata(1))).rejects.toThrow();
      expect(JSON.stringify(first)).not.toContain(KEY);
      expect((await reopened.delete(OTHER)).deleteSucceeded).toBe(true);
    }));
    it('recovers a durable rename before acceptance and rejects corrupt or recreated deletion state', async () => fixture(async (root, store) => {
      const stored = await store.put(KEY, stream(100), metadata(100));
      const original = await readFile(join(root, keyHash(KEY), 'object'));
      const first = await store.delete(KEY);
      const intent = JSON.parse((await readFile(join(root, `${keyHash(KEY)}.delete`), 'utf8')).split('\n')[0]!);
      const grave = join(root, `${keyHash(KEY)}.deleted-${intent.deletionAttemptId}`);
      // Reconstruct the real durable crash boundary: intent and encrypted tombstone, no acceptance.
      await unlink(join(root, `${keyHash(KEY)}.accepted`));
      await mkdir(grave); await writeFile(join(grave, 'object'), original);
      const object = await open(join(grave, 'object'), 'r'); await object.sync(); await object.close();
      const parent = await open(root, 'r'); await parent.sync(); await parent.close();
      const reopened = await createFileAudioStore(root, material);
      expect(await reopened.delete(KEY)).toMatchObject({ deletionAttemptId: first.deletionAttemptId, generationId: stored.generationId, deleteSucceeded: true, directReadAbsent: true });
      expect((await readdir(root)).includes(grave.split('/').at(-1)!)).toBe(false);
      await mkdir(join(root, keyHash(KEY))); await writeFile(join(root, keyHash(KEY), 'object'), original);
      expect((await reopened.delete(KEY)).deleteSucceeded).toBe(false);
      await rm(join(root, keyHash(KEY)), { recursive: true });
      const accepted = join(root, `${keyHash(KEY)}.accepted`);
      await writeFile(accepted, 'corrupt');
      expect((await reopened.delete(KEY)).deleteSucceeded).toBe(false);
    }));
    it('fails closed on header mutation and on completion modified during a live stream', async () => fixture(async (root, store) => {
      await store.put(KEY, stream(2 * 65_536), metadata(2 * 65_536));
      const path = join(root, keyHash(KEY), 'object'); const original = await readFile(path);
      const mutated = Buffer.from(original); mutated[9 + 20] = mutated[9 + 20]! ^ 1;
      await writeFile(path, mutated); await expect(store.get(KEY)).rejects.toThrow();
      await writeFile(path, original);
      const reader = (await store.get(KEY))!.body.getReader();
      expect((await reader.read()).value!.length).toBe(65_536);
      const late = Buffer.from(original); late[late.length - 1] = late[late.length - 1]! ^ 1;
      await writeFile(path, late); await expect(reader.read()).rejects.toThrow();
    }));
    it('deletes an in-flight stage without allowing its writer to publish later', async () => fixture(async (_root, store) => {
      const waiting = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      let first = true;
      const source = new ReadableStream<Uint8Array>({ async pull(controller) {
        if (first) { first = false; controller.enqueue(new Uint8Array(65_536)); return; }
        waiting.resolve(); await release.promise; controller.close();
      } });
      const pending = store.put(KEY, source, metadata(65_536)); const outcome = pending.catch(() => null);
      await waiting.promise; expect(await store.get(KEY)).toBeNull();
      expect((await store.delete(KEY)).directReadAbsent).toBe(true);
      release.resolve(); expect(await outcome).toBeNull(); expect(await store.get(KEY)).toBeNull();
    }));
    it('rejects symlink traversal and cancels a stalled upload at its deadline', async () => fixture(async (root, store) => {
      const outside = await mkdtemp(join(tmpdir(), 'ccc-audio-outside-'));
      try {
        await symlink(outside, join(root, keyHash(KEY)), 'dir');
        await expect(store.put(KEY, stream(1), metadata(1))).rejects.toThrow();
        await expect(store.get(KEY)).rejects.toThrow();
        expect(await readdir(outside)).toEqual([]);
      } finally { await rm(join(root, keyHash(KEY))); await rm(outside, { recursive: true }); }
      let cancelled = false;
      const source = new ReadableStream<Uint8Array>({ pull() { return Promise.withResolvers<void>().promise; }, cancel() { cancelled = true; } });
      await expect(store.put(KEY, source, { ...metadata(1), expiresAt: new Date(Date.now() + 100).toISOString() })).rejects.toThrow();
      expect(cancelled).toBe(true); expect(await store.get(KEY)).toBeNull();
    }));
  });
}
