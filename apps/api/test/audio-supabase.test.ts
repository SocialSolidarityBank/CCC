import { describe, expect, it } from 'vitest';
import { createSupabaseAudioStore, AudioStoreError } from '../../../adapters/audio-supabase/src/index';
import type { AudioObjectMetadata } from '@ccc/contracts/runtime';

const origin = 'https://abcdefghijklmnopqrst.supabase.co';
const bucket = 'private-audio';
const key = 'audio/session_01/550e8400-e29b-41d4-a716-446655440000';
const version = 'cc730142-4c23-4cbb-baf0-15401b6044d3';
const now = Date.parse('2026-09-09T00:00:00.000Z');
const metadata: AudioObjectMetadata = { contentLength: 3, contentType: 'audio/webm', expiresAt: '2026-09-10T00:00:00.000Z' };
function source(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream({ pull(controller) {
    const chunk = chunks[index++];
    if (chunk === undefined) controller.close(); else controller.enqueue(chunk);
  } });
}
const abc = () => source(new Uint8Array([97]), new Uint8Array([98, 99]));

// A stateful HTTP-boundary double: consumes request streams, enforces no-upsert,
// preserves server metadata and supports independent inconsistent deletion observations.
function provider() {
  let time = now;
  let publicBucket = false;
  let stored: { bytes: Uint8Array[]; metadata: Record<string, unknown>; size: number } | undefined;
  let deleteStatus = 200;
  let metadataStatus: number | undefined;
  let directStatus: number | undefined;
  let listVisible = false;
  let retainedVersion = false;
  let failAfterUpload = false;
  let missingSecret = false;
  let malformedGet = false;
  let getBytes: Uint8Array[] | undefined;
  let secretReads = 0;
  let cancelDownload = false;
  let notifyCancelled: () => void;
  const cancelledSignal = new Promise<void>(resolve => { notifyCancelled = resolve; });
  const methods: string[] = [];
  const removals: unknown[] = [];
  const fetcher: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    expect(url.origin).toBe(origin);
    expect(init?.redirect).toBe('error');
    expect(init?.credentials).toBe('omit');
    expect(init?.cache).toBe('no-store');
    expect(headers.get('Authorization')).toBe('Bearer test-server-secret');
    methods.push(`${init?.method ?? 'GET'} ${url.pathname}`);
    if (url.pathname === `/storage/v1/bucket/${bucket}`) return Response.json({ id: bucket, public: publicBucket });
    if (init?.method === 'POST' && url.pathname === `/storage/v1/object/${bucket}/${key}`) {
      expect(headers.get('x-upsert')).toBe('false');
      if (stored) return new Response('duplicate provider private detail', { status: 409 });
      stored = { bytes: [], size: 0, metadata: JSON.parse(atob(headers.get('x-metadata')!)) };
      const request = new Request(String(input), init);
      const reader = request.body!.getReader();
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          stored.bytes.push(part.value.slice());
          stored.size += part.value.byteLength;
        }
      } finally { reader.releaseLock(); }
      if (failAfterUpload) throw new Error(`private provider ${key}`);
      return Response.json({ Id: version, Key: `${bucket}/${key}` });
    }
    if (init?.method === 'DELETE') {
      const payload = JSON.parse(String(init.body));
      removals.push(payload);
      if (deleteStatus !== 200) return new Response(`404 ${key} private provider`, { status: deleteStatus });
      for (const item of payload.prefixes) {
        if (item === key || (item.path === key && item.versionId === version)) stored = undefined;
      }
      return Response.json([]);
    }
    if (url.pathname === `/storage/v1/object/list/${bucket}`) {
      return Response.json(stored || listVisible ? [{ name: key.split('/').at(-1), id: version }] : []);
    }
    if (url.pathname === `/storage/v1/object/info/authenticated/${bucket}/${key}`) {
      if (metadataStatus !== undefined) return new Response('404 private provider', { status: metadataStatus });
      if (!stored) return new Response(null, { status: 404 });
      return Response.json({ name: key, bucket_id: bucket, version, size: stored.size, content_type: 'audio/webm',
        metadata: malformedGet ? {} : stored.metadata });
    }
    if (url.pathname === `/storage/v1/object/authenticated/${bucket}/${key}`) {
      if (retainedVersion && url.searchParams.get('versionId') === version) return new Response('abc');
      if (directStatus !== undefined) return new Response('404 private provider', { status: directStatus });
      if (!stored) return new Response(null, { status: 404 });
      let i = 0;
      const chunks = getBytes ?? stored.bytes;
      return new Response(new ReadableStream({
        pull(controller) { const chunk = chunks[i++]; if (chunk) controller.enqueue(chunk); else controller.close(); },
        cancel() { cancelDownload = true; notifyCancelled(); },
      }), { headers: { 'Content-Type': 'audio/webm', 'Content-Length': String(stored.size) } });
    }
    throw new Error('unexpected provider route');
  };
  const store = createSupabaseAudioStore({ origin, bucket, now: () => time, fetch: fetcher,
    secretStore: { async get(name) { expect(name).toBe('SUPABASE_SERVICE_ROLE_KEY'); secretReads++; return missingSecret ? null : 'test-server-secret'; } } });
  return { store, methods, removals, setPublic: () => { publicBucket = true; }, expire: () => { time = Date.parse(metadata.expiresAt); },
    failDelete: (status: number) => { deleteStatus = status; }, metadataStatus: (status: number) => { metadataStatus = status; },
    directStatus: (status: number) => { directStatus = status; }, showInList: () => { listVisible = true; },
    failUpload: () => { failAfterUpload = true; }, loseSecret: () => { missingSecret = true; },
    malformedMetadata: () => { malformedGet = true; }, downloadBytes: (bytes: Uint8Array[]) => { getBytes = bytes; },
    retainVersion: () => { retainedVersion = true; },
    exists: () => stored !== undefined, reads: () => secretReads, cancelled: () => cancelDownload, cancelledSignal };
}

describe('private Supabase AudioStore', () => {
  it('streams bytes, returns the independent SHA256 vector and reads persisted metadata through authenticated HTTP', async () => {
    const p = provider();
    expect(await p.store.put(key, abc(), metadata)).toEqual({ sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad' });
    const download = await p.store.get(key);
    expect(download).toMatchObject({ ...metadata, sha256: null });
    expect(await new Response(download!.body).text()).toBe('abc');
    const reads = p.reads();
    expect(await p.store.createUploadTarget(key, metadata)).toBeNull();
    expect(await p.store.createDownloadTarget(key)).toBeNull();
    expect(p.reads()).toBe(reads);
  });

  it('does not overwrite or delete a preexisting object when upload fails with a collision', async () => {
    const p = provider();
    await p.store.put(key, abc(), metadata);
    await expect(p.store.put(key, source(new Uint8Array([120, 121, 122])), metadata)).rejects.toBeInstanceOf(AudioStoreError);
    const download = await p.store.get(key);
    expect(await new Response(download!.body).text()).toBe('abc');
    expect(p.removals).toEqual([]);
  });

  it.each([2, 4])('rejects a %i-byte stream declared as three bytes and deletes its own partial generation', async (length) => {
    const p = provider();
    await expect(p.store.put(key, source(new Uint8Array(length)), metadata)).rejects.toBeInstanceOf(AudioStoreError);
    expect(p.exists()).toBe(false);
    expect(p.removals).toEqual([{ prefixes: [{ path: key, versionId: version }] }]);
  });

  it('rejects metadata above 200MiB without sending audio', async () => {
    const p = provider();
    await expect(p.store.put(key, abc(), { ...metadata, contentLength: 200 * 1024 * 1024 + 1 })).rejects.toBeInstanceOf(AudioStoreError);
    expect(p.methods).toEqual([]);
  });

  it('rejects an interrupted source and attempts cleanup without leaking the source error', async () => {
    const p = provider();
    let reads = 0;
    const interrupted = new ReadableStream<Uint8Array>({ pull(controller) {
      if (reads++ === 0) controller.enqueue(new Uint8Array([97])); else controller.error(new Error('private source detail'));
    } });
    await expect(p.store.put(key, interrupted, metadata)).rejects.toThrow('audio storage operation failed');
    expect(p.exists()).toBe(false);
    expect(p.removals).toHaveLength(1);
  });

  it('cleans up an accepted upload whose HTTP completion fails, and never reports success if cleanup also fails', async () => {
    const p = provider();
    p.failUpload();
    p.failDelete(503);
    await expect(p.store.put(key, abc(), metadata)).rejects.toThrow('audio storage operation failed');
    expect(p.removals).toHaveLength(1);
    expect(p.exists()).toBe(true);
  });

  it('blocks public-bucket upload and read, but still deletes when the bucket has become public', async () => {
    const p = provider();
    await p.store.put(key, abc(), metadata);
    p.setPublic();
    await expect(p.store.get(key)).rejects.toBeInstanceOf(AudioStoreError);
    const before = p.methods.filter(method => method.startsWith('POST')).length;
    await expect(p.store.put(key, abc(), metadata)).rejects.toBeInstanceOf(AudioStoreError);
    expect(p.methods.filter(method => method.startsWith('POST'))).toHaveLength(before);
    expect((await p.store.delete(key)).deleteSucceeded).toBe(true);
    expect(p.exists()).toBe(false);
  });

  it('blocks expired reads before object data is fetched and permits deletion after expiry', async () => {
    const p = provider();
    await p.store.put(key, abc(), metadata);
    p.expire();
    await expect(p.store.get(key)).rejects.toBeInstanceOf(AudioStoreError);
    expect(p.methods.some(method => method.includes('/object/authenticated/'))).toBe(false);
    expect((await p.store.delete(key)).directReadAbsent).toBe(true);
  });

  it('does not return bytes with missing custom metadata or a truncated download', async () => {
    const malformed = provider();
    await malformed.store.put(key, abc(), metadata);
    malformed.malformedMetadata();
    await expect(malformed.store.get(key)).rejects.toBeInstanceOf(AudioStoreError);
    const truncated = provider();
    await truncated.store.put(key, abc(), metadata);
    truncated.downloadBytes([new Uint8Array([97])]);
    const result = await truncated.store.get(key);
    await expect(new Response(result!.body).arrayBuffer()).rejects.toThrow('audio storage operation failed');
  });

  it('propagates consumer cancellation to the provider stream', async () => {
    const p = provider();
    await p.store.put(key, abc(), metadata);
    const download = await p.store.get(key);
    await download!.body.cancel();
    await p.cancelledSignal;
    expect(p.cancelled()).toBe(true);
  });

  it('stops a previously opened download when its retention deadline arrives', async () => {
    const p = provider();
    await p.store.put(key, abc(), metadata);
    const download = await p.store.get(key);
    p.expire();
    await expect(new Response(download!.body).arrayBuffer()).rejects.toThrow('audio storage operation failed');
  });

  it('does not cache credentials and fails closed after the secret becomes unavailable', async () => {
    const p = provider();
    await p.store.put(key, abc(), metadata);
    p.loseSecret();
    await expect(p.store.get(key)).rejects.toBeInstanceOf(AudioStoreError);
  });

  it.each(['http://abcdefghijklmnopqrst.supabase.co', `${origin}/path`, `${origin}?x=1`, 'https://user@abcdefghijklmnopqrst.supabase.co', 'https://attacker.invalid'])('rejects unsafe trusted origins: %s', (unsafe) => {
    expect(() => createSupabaseAudioStore({ origin: unsafe, bucket, secretStore: { async get() { return null; } } })).toThrow(AudioStoreError);
  });

  it.each(['../private', 'audio/session/../../secret', `${key}?token=bad`, `${key}%2fextra`])('rejects invalid object keys before HTTP: %s', async (invalid) => {
    const p = provider();
    await expect(p.store.put(invalid, abc(), metadata)).rejects.toBeInstanceOf(AudioStoreError);
    await expect(p.store.delete(invalid)).rejects.toBeInstanceOf(AudioStoreError);
    expect(p.methods).toEqual([]);
  });
});

describe('Supabase independent deletion evidence', () => {
  it('confirms deletion only with separate list, metadata and authenticated GET observations', async () => {
    const p = provider();
    await p.store.put(key, abc(), metadata);
    const evidence = await p.store.delete(key);
    expect(evidence).toMatchObject({ deleteSucceeded: true, absentFromList: true, absentFromMetadata: true,
      directReadAbsent: true, verificationMethod: 'authenticated-get-404', providerStatus: 404 });
    expect(evidence.deletedAt).toBe(new Date(now).toISOString());
    expect(evidence.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(evidence)).not.toContain(key);
    expect(JSON.stringify(evidence)).not.toContain(origin);
    expect(JSON.stringify(evidence)).not.toContain('test-server-secret');
  });

  it('does not confirm deletion while the recorded generation remains directly readable', async () => {
    const p = provider();
    await p.store.put(key, abc(), metadata);
    p.retainVersion();
    const evidence = await p.store.delete(key);
    expect(evidence.absentFromList).toBe(true);
    expect(evidence.absentFromMetadata).toBe(true);
    expect(evidence.directReadAbsent).toBe(false);
    expect(evidence.deletedAt).toBeNull();
  });

  it.each([400, 401, 403, 503])('does not treat HTTP %i or its 404 body text as direct absence', async (status) => {
    const p = provider();
    await p.store.put(key, abc(), metadata);
    p.directStatus(status);
    const evidence = await p.store.delete(key);
    expect(evidence.directReadAbsent).toBe(false);
    expect(evidence.providerStatus).toBe(status);
    expect(evidence.deletedAt).toBeNull();
  });

  it('records a failed deletion even if later absence probes succeed independently', async () => {
    const p = provider();
    p.failDelete(503);
    const evidence = await p.store.delete(key);
    expect(evidence).toMatchObject({ deleteSucceeded: false, providerDeleteAcceptedAt: null, deletedAt: null,
      absentFromList: true, absentFromMetadata: true, directReadAbsent: true });
  });

  it('never substitutes one absence check for another', async () => {
    const p = provider();
    await p.store.put(key, abc(), metadata);
    p.showInList();
    p.metadataStatus(503);
    const evidence = await p.store.delete(key);
    expect(evidence).toMatchObject({ deleteSucceeded: true, absentFromList: false, absentFromMetadata: false, directReadAbsent: true, deletedAt: null });
  });
});
