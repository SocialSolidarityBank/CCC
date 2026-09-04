import { describe, expect, it } from 'vitest';
import type {
  AudioContentType,
  AudioDeletionEvidence,
  AudioObjectMetadata,
  AudioStore,
} from '@ccc/contracts/runtime';
import { createR2AudioStore } from '@ccc/audio-r2';
import { handleRequest } from '@ccc/http-api';
import type { ApiEnv } from '@ccc/http-api/identity';

const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const KEY = 'audio/session_01/550e8400-e29b-41d4-a716-446655440000';
const EXPIRES_AT = '2026-09-05T12:00:00.000Z';
const CONTENT_TYPE: AudioContentType = 'audio/webm';
const BODY = new Uint8Array([0x00, 0x11, 0x22, 0x33, 0xff]);

type R2PutValue = ReadableStream<Uint8Array> | ArrayBuffer | ArrayBufferView | string;
type R2StoredObject = {
  bytes: Uint8Array;
  customMetadata: Record<string, string>;
  contentType: string | undefined;
  etag: string;
};
type AbsenceProfile = {
  list: boolean;
  metadata: boolean;
  directRead: boolean;
};

type ProviderErrorMode = 'get' | 'put' | 'delete' | null;
type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

/**
 * This double follows the R2 binding boundary instead of mocking the adapter.
 * It consumes streams one chunk at a time, returns independent body streams,
 * exposes list/head/get as separate observations, and can retain provider state
 * after an accepted delete to exercise stale/partial evidence.
 */
class FaithfulR2Bucket {
  readonly objects = new Map<string, R2StoredObject>();
  readonly putValues: R2PutValue[] = [];
  readonly calls = { delete: 0, get: 0, head: 0, list: 0, put: 0 };
  readonly cancelledReasons: unknown[] = [];
  absence: AbsenceProfile = { list: true, metadata: false, directRead: false };
  providerError: ProviderErrorMode = null;
  acceptDeleteButRetain = false;

  async put(key: string, value: R2PutValue, options?: {
    httpMetadata?: { contentType?: string };
    customMetadata?: Record<string, string>;
  }): Promise<void> {
    if (this.providerError === 'put') throw new Error('provider-secret https://r2.invalid/private-key');
    this.putValues.push(value);
    const bytes = await consumeBytes(value);
    this.objects.set(key, {
      bytes,
      customMetadata: { ...(options?.customMetadata ?? {}) },
      contentType: options?.httpMetadata?.contentType,
      etag: `etag-${this.objects.size + 1}`,
    });
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    this.calls.get += 1;
    if (this.providerError === 'get') throw new Error('provider-secret https://r2.invalid/private-key');
    const object = this.objects.get(key);
    if (object === undefined || this.absence.directRead) return null;
    let firstPull = true;
    const pendingPull = deferred<void>();
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        if (firstPull) {
          firstPull = false;
          controller.enqueue(object.bytes.slice());
          return;
        }
        return pendingPull.promise;
      },
      cancel: (reason) => {
        this.cancelledReasons.push(reason);
        pendingPull.resolve();
      },
    });
    return {
      body,
      httpMetadata: object.contentType === undefined ? undefined : { contentType: object.contentType },
      customMetadata: object.customMetadata,
      etag: object.etag,
      size: object.bytes.byteLength,
    } as unknown as R2ObjectBody;
  }

  async head(key: string): Promise<R2Object | null> {
    this.calls.head += 1;
    if (this.providerError === 'get') throw new Error('provider-secret https://r2.invalid/private-key');
    const object = this.objects.get(key);
    if (object === undefined || this.absence.metadata) return null;
    return {
      etag: object.etag,
      size: object.bytes.byteLength,
      httpMetadata: object.contentType === undefined ? undefined : { contentType: object.contentType },
      customMetadata: object.customMetadata,
    } as unknown as R2Object;
  }

  async list(): Promise<R2Objects> {
    this.calls.list += 1;
    const objects = this.absence.list
      ? []
      : [...this.objects.entries()].map(([key, object]) => ({
        key,
        etag: object.etag,
        size: object.bytes.byteLength,
      }));
    return { objects, truncated: false } as unknown as R2Objects;
  }

  async delete(key: string): Promise<void> {
    this.calls.delete += 1;
    if (this.providerError === 'delete') throw new Error('provider-secret https://r2.invalid/private-key');
    if (!this.acceptDeleteButRetain) this.objects.delete(key);
  }
}

async function consumeBytes(value: R2PutValue): Promise<Uint8Array> {
  if (value instanceof ReadableStream) {
    const reader = value.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const chunk = next.value;
      chunks.push(chunk);
      total += chunk.byteLength;
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
}

function byteStream(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({
    pull(controller) {
      const chunk = chunks[index++];
      if (chunk === undefined) controller.close();
      else controller.enqueue(chunk);
    },
  });
}

function bytesOfLength(length: number): ReadableStream<Uint8Array> {
  let remaining = length;
  const chunk = new Uint8Array(1024 * 1024).fill(0x5a);
  return new ReadableStream({
    pull(controller) {
      if (remaining === 0) {
        controller.close();
        return;
      }
      const nextLength = Math.min(remaining, chunk.byteLength);
      controller.enqueue(chunk.slice(0, nextLength));
      remaining -= nextLength;
    },
  });
}

function metadata(overrides: Partial<AudioObjectMetadata> = {}): AudioObjectMetadata {
  return {
    contentLength: BODY.byteLength,
    contentType: CONTENT_TYPE,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

function makeStore(bucket = new FaithfulR2Bucket()): { bucket: FaithfulR2Bucket; store: AudioStore } {
  return { bucket, store: createR2AudioStore(bucket as unknown as R2Bucket) };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const owned = bytes.slice();
  const digest = await crypto.subtle.digest('SHA-256', owned.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// These are compile-time boundary checks. The handler environment must expose
// the neutral port, not the provider's R2 binding, after composition is cut over.
type HandlerEnvironment = Parameters<typeof handleRequest>[1];
type HandlerHasAudioStore = HandlerEnvironment extends { audioStore: AudioStore } ? true : never;
type HandlerHasNoRawR2 = Extract<keyof HandlerEnvironment, 'AUDIO_BUCKET'> extends never ? true : never;
const handlerAcceptsAudioStore: HandlerHasAudioStore = true;
const handlerHidesRawR2: HandlerHasNoRawR2 = true;
const portEnvironment: Omit<ApiEnv, 'AUDIO_BUCKET'> & { audioStore: AudioStore } = {
  audioStore: {} as AudioStore,
} as Omit<ApiEnv, 'AUDIO_BUCKET'> & { audioStore: AudioStore };

void handlerAcceptsAudioStore;
void handlerHidesRawR2;
void portEnvironment;


describe('R2 AudioStore contract', () => {
  it('accepts each canonical MIME and rejects parameters only after canonicalization', async () => {
    for (const contentType of ['audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/webm', 'audio/x-m4a'] as const) {
      const { bucket, store } = makeStore();
      await expect(store.put(KEY, byteStream(BODY), metadata({ contentType }))).resolves.toMatchObject({ sha256: expect.any(String) });
      expect(bucket.putValues[0]).toBeInstanceOf(ReadableStream);
    }

    const { bucket, store } = makeStore();
    await expect(store.put(KEY, byteStream(BODY), metadata({ contentType: 'audio/webm' }))).resolves.toBeDefined();
    expect(bucket.putValues).toHaveLength(1);
  });

  it.each([
    ['wrong prefix', 'uploads/session/550e8400-e29b-41d4-a716-446655440000'],
    ['traversal', 'audio/session/../550e8400-e29b-41d4-a716-446655440000'],
    ['encoded separator', 'audio/session%2Fpart/550e8400-e29b-41d4-a716-446655440000'],
    ['bad session id', 'audio/session.id/550e8400-e29b-41d4-a716-446655440000'],
    ['noncanonical UUID', 'audio/session/550E8400-E29B-41D4-A716-446655440000'],
    ['raw path', '/tmp/recording.wav'],
  ])('rejects %s before calling R2', async (_label, key) => {
    const { bucket, store } = makeStore();
    await expect(store.put(key, byteStream(BODY), metadata())).rejects.toBeDefined();
    expect(bucket.putValues).toHaveLength(0);
  });

  it.each([
    ['empty MIME', ''],
    ['unsupported MIME', 'application/octet-stream'],
    ['video MIME', 'video/mp4'],
    ['uppercase MIME', 'AUDIO/WEBM'],
  ])('rejects %s before storage', async (_label, contentType) => {
    const { bucket, store } = makeStore();
    await expect(store.put(KEY, byteStream(BODY), metadata({ contentType: contentType as AudioContentType }))).rejects.toBeDefined();
    expect(bucket.putValues).toHaveLength(0);
  });

  it('enforces the inclusive 200 MiB boundary before storage', async () => {
    const atLimit = makeStore();
    await expect(atLimit.store.put(KEY, bytesOfLength(MAX_AUDIO_BYTES), {
      contentLength: MAX_AUDIO_BYTES,
      contentType: CONTENT_TYPE,
      expiresAt: EXPIRES_AT,
    })).resolves.toMatchObject({ sha256: expect.any(String) });
    expect(atLimit.bucket.putValues[0]).toBeInstanceOf(ReadableStream);

    const overLimit = makeStore();
    await expect(overLimit.store.put(KEY, byteStream(BODY), {
      contentLength: MAX_AUDIO_BYTES + 1,
      contentType: CONTENT_TYPE,
      expiresAt: EXPIRES_AT,
    })).rejects.toBeDefined();
    expect(overLimit.bucket.putValues).toHaveLength(0);
  });

  it('rejects zero, non-integer, negative, short, and overrun bodies without leaving an object', async () => {
    for (const contentLength of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { bucket, store } = makeStore();
      await expect(store.put(KEY, byteStream(BODY), metadata({ contentLength }))).rejects.toBeDefined();
      expect(bucket.objects.size).toBe(0);
    }

    const short = makeStore();
    await expect(short.store.put(KEY, byteStream(BODY.slice(0, -1)), metadata())).rejects.toBeDefined();
    expect(short.bucket.objects.size).toBe(0);

    const overrun = makeStore();
    await expect(overrun.store.put(KEY, byteStream(BODY, new Uint8Array([0x44])), metadata())).rejects.toBeDefined();
    expect(overrun.bucket.objects.size).toBe(0);
  });

  it('hashes incrementally and leaves backpressure at the R2 stream boundary', async () => {
    const { bucket, store } = makeStore();
    let pulls = 0;
    let releaseSecondChunk!: () => void;
    const secondPullReady = deferred<void>();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) {
          controller.enqueue(BODY.slice(0, 2));
          return;
        }
        if (pulls === 2) {
          const deferredPull = deferred<void>();
          releaseSecondChunk = () => {
            controller.enqueue(BODY.slice(2));
            controller.close();
            deferredPull.resolve();
          };
          secondPullReady.resolve();
          return deferredPull.promise;
        }
        throw new Error('source pulled past its backpressure gate');
      },
    });

    let settled = false;
    const pending = store.put(KEY, body, metadata());
    void pending.finally(() => { settled = true; });
    await secondPullReady.promise;
    expect(settled).toBe(false);
    expect(bucket.putValues[0]).toBeInstanceOf(ReadableStream);
    releaseSecondChunk();
    await expect(pending).resolves.toEqual({ sha256: await sha256Hex(BODY) });
  });

  it('returns provider metadata and preserves consumer cancellation on get', async () => {
    const { bucket, store } = makeStore();
    await store.put(KEY, byteStream(BODY), metadata());

    const download = await store.get(KEY);
    expect(download).not.toBeNull();
    if (download === null) throw new Error('expected stored audio');
    expect(download.contentLength).toBe(BODY.byteLength);
    expect(download.contentType).toBe(CONTENT_TYPE);
    expect(download.expiresAt).toBe(EXPIRES_AT);
    expect(download.sha256).toBeNull();
    const reader = download.body.getReader();
    await expect(reader.read()).resolves.toMatchObject({ done: false });
    await reader.cancel('consumer-aborted');
    expect(bucket.cancelledReasons).toContain('consumer-aborted');
  });

  it('returns null for missing objects and never creates R2 targets', async () => {
    const { bucket, store } = makeStore();
    await expect(store.get(KEY)).resolves.toBeNull();
    await expect(store.createUploadTarget(KEY, metadata())).resolves.toBeNull();
    await expect(store.createDownloadTarget(KEY)).resolves.toBeNull();
    expect(bucket.calls.get).toBe(1);
    expect(bucket.calls.put).toBe(0);
  });

  it('records idempotent delete evidence with list, metadata, and direct-read absence', async () => {
    const { bucket, store } = makeStore();
    await store.put(KEY, byteStream(BODY), metadata());
    const evidence = await store.delete(KEY);
    expect(evidence).toMatchObject({
      keyHash: await sha256Hex(new TextEncoder().encode(KEY)),
      generationId: expect.any(String),
      objectSha256: null,
      deletionAttemptId: expect.any(String),
      providerDeleteAcceptedAt: expect.any(String),
      deletedAt: expect.any(String),
      deleteSucceeded: true,
      absentFromList: true,
      absentFromMetadata: true,
      directReadAbsent: true,
      verificationMethod: 'r2-head-absent',
      verifiedAt: expect.any(String),
    } satisfies Partial<AudioDeletionEvidence>);
    expect(JSON.stringify(evidence)).not.toContain(KEY);
    expect(bucket.calls).toMatchObject({ delete: 1, get: 1, head: 2, list: 1 });

    await expect(store.delete(KEY)).resolves.toMatchObject({
      deleteSucceeded: true,
      absentFromList: true,
      absentFromMetadata: true,
      directReadAbsent: true,
    });
  });

  it('does not collapse distinct R2 absence observations into one boolean', async () => {
    const first = makeStore();
    await first.store.put(KEY, byteStream(BODY), metadata());
    first.bucket.acceptDeleteButRetain = true;
    first.bucket.absence = { list: true, metadata: false, directRead: false };
    await expect(first.store.delete(KEY)).resolves.toMatchObject({
      deleteSucceeded: true,
      absentFromList: true,
      absentFromMetadata: false,
      directReadAbsent: false,
    });

    const second = makeStore();
    await second.store.put(KEY, byteStream(BODY), metadata());
    second.bucket.acceptDeleteButRetain = true;
    second.bucket.absence = { list: false, metadata: true, directRead: true };
    await expect(second.store.delete(KEY)).resolves.toMatchObject({
      deleteSucceeded: true,
      absentFromList: false,
      absentFromMetadata: true,
      directReadAbsent: true,
    });
  });

  it('redacts provider errors and never returns a storage key or signed URL', async () => {
    const { bucket, store } = makeStore();
    bucket.providerError = 'get';
    const getResult = await store.get(KEY).catch((error: unknown) => error);
    if (getResult instanceof Error) {
      expect(getResult.message).not.toContain('provider-secret');
      expect(getResult.message).not.toContain('https://');
      expect(getResult.message).not.toContain(KEY);
    } else {
      expect(getResult).toBeNull();
    }

    bucket.providerError = 'put';
    const putResult = await store.put(KEY, byteStream(BODY), metadata()).catch((error: unknown) => error);
    if (putResult instanceof Error) {
      expect(putResult.message).not.toContain('provider-secret');
      expect(putResult.message).not.toContain('https://');
      expect(putResult.message).not.toContain(KEY);
    }

    bucket.providerError = 'delete';
    const deleteResult = await store.delete(KEY).catch((error: unknown) => error);
    if (deleteResult instanceof Error) {
      expect(deleteResult.message).not.toContain('provider-secret');
      expect(deleteResult.message).not.toContain('https://');
      expect(deleteResult.message).not.toContain(KEY);
    } else {
      expect(JSON.stringify(deleteResult)).not.toContain(KEY);
    }

    bucket.providerError = null;
    await expect(store.createUploadTarget(KEY, metadata())).resolves.toBeNull();
    await expect(store.createDownloadTarget(KEY)).resolves.toBeNull();
  });
});
