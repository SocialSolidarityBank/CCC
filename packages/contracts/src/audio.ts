import type { AudioObjectMetadata } from './runtime';
import { AUDIO_CONTENT_TYPES } from './runtime';
export const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const AUDIO_KEY = /^audio\/([A-Za-z0-9_-]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export class AudioStoreError extends Error {
  constructor() {
    super('audio storage operation failed');
    this.name = 'AudioStoreError';
  }
}

export class Sha256 {
  private readonly state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly block = new Uint8Array(64);
  private readonly words = new Uint32Array(64);
  private blockLength = 0;
  private byteLength = 0;

  update(bytes: Uint8Array): void {
    this.byteLength += bytes.byteLength;
    let offset = 0;
    while (offset < bytes.byteLength) {
      const copied = Math.min(64 - this.blockLength, bytes.byteLength - offset);
      this.block.set(bytes.subarray(offset, offset + copied), this.blockLength);
      this.blockLength += copied;
      offset += copied;
      if (this.blockLength === 64) {
        this.process(this.block, 0);
        this.blockLength = 0;
      }
    }
  }

  digestHex(): string {
    const bitLength = this.byteLength * 8;
    const paddedLength = ((this.blockLength + 9 + 63) >> 6) << 6;
    const padded = new Uint8Array(paddedLength);
    padded.set(this.block.subarray(0, this.blockLength));
    padded[this.blockLength] = 0x80;
    const view = new DataView(padded.buffer);
    view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
    view.setUint32(paddedLength - 4, bitLength >>> 0);
    for (let offset = 0; offset < paddedLength; offset += 64) this.process(padded, offset);

    let result = '';
    for (const word of this.state) result += word.toString(16).padStart(8, '0');
    return result;
  }

  private process(bytes: Uint8Array, offset: number): void {
    const words = this.words;
    for (let index = 0; index < 16; index++) {
      const at = offset + index * 4;
      words[index] = ((bytes[at] ?? 0) << 24) | ((bytes[at + 1] ?? 0) << 16) | ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    }
    for (let index = 16; index < 64; index++) {
      const value = words[index - 15] ?? 0;
      const previous = words[index - 2] ?? 0;
      const s0 = ((value >>> 7) | (value << 25)) ^ ((value >>> 18) | (value << 14)) ^ (value >>> 3);
      const s1 = ((previous >>> 17) | (previous << 15)) ^ ((previous >>> 19) | (previous << 13)) ^ (previous >>> 10);
      words[index] = ((words[index - 16] ?? 0) + s0 + (words[index - 7] ?? 0) + s1) >>> 0;
    }

    let a = this.state[0]!;
    let b = this.state[1]!;
    let c = this.state[2]!;
    let d = this.state[3]!;
    let e = this.state[4]!;
    let f = this.state[5]!;
    let g = this.state[6]!;
    let h = this.state[7]!;
    for (let index = 0; index < 64; index++) {
      const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + choose + (SHA256_K[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    this.state[0] = (this.state[0]! + a) >>> 0;
    this.state[1] = (this.state[1]! + b) >>> 0;
    this.state[2] = (this.state[2]! + c) >>> 0;
    this.state[3] = (this.state[3]! + d) >>> 0;
    this.state[4] = (this.state[4]! + e) >>> 0;
    this.state[5] = (this.state[5]! + f) >>> 0;
    this.state[6] = (this.state[6]! + g) >>> 0;
    this.state[7] = (this.state[7]! + h) >>> 0;
  }
}

export function hashKey(key: string): string {
  const hash = new Sha256();
  hash.update(new TextEncoder().encode(key));
  return hash.digestHex();
}

export function validKey(key: string): boolean {
  return AUDIO_KEY.test(key);
}

export function validMetadata(metadata: AudioObjectMetadata, requireUnexpired = true): boolean {
  const expiresAt = Date.parse(metadata.expiresAt);
  return Number.isInteger(metadata.contentLength)
    && metadata.contentLength >= 1
    && metadata.contentLength <= MAX_AUDIO_BYTES
    && Object.prototype.hasOwnProperty.call(AUDIO_CONTENT_TYPES, metadata.contentType)
    && metadata.expiresAt.length > 0
    && metadata.expiresAt.endsWith('Z')
    && Number.isFinite(expiresAt)
    && (!requireUnexpired || expiresAt > Date.now());
}

type TimerHandle = ReturnType<typeof setTimeout>;
export function checkedBody(
  source: ReadableStream<Uint8Array>,
  expectedLength: number,
  hash: Pick<Sha256, 'update'>,
  expiresAt: string,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  const deadline = Date.parse(expiresAt);
  let length = 0;
  let expired = false;
  let timer: TimerHandle | undefined;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      const expire = () => {
        expired = true;
        void reader.cancel(new AudioStoreError()).finally(() => {
          controller.error(new AudioStoreError());
        });
      };
      const remaining = deadline - Date.now();
      if (remaining <= 0) expire();
      else timer = setTimeout(expire, remaining);
    },
    async pull(controller) {
      try {
        const next = await reader.read();
        if (expired) return;
        if (next.done) {
          if (length !== expectedLength) throw new AudioStoreError();
          clearTimeout(timer);
          timer = undefined;
          controller.close();
          return;
        }
        if (!(next.value instanceof Uint8Array)) throw new AudioStoreError();
        length += next.value.byteLength;
        if (length > expectedLength || length > MAX_AUDIO_BYTES) throw new AudioStoreError();
        hash.update(next.value);
        controller.enqueue(next.value);
      } catch (error) {
        clearTimeout(timer);
        timer = undefined;
        if (expired) return;
        await reader.cancel().catch(() => undefined);
        controller.error(error instanceof AudioStoreError ? error : new AudioStoreError());
      }
    },
    cancel(reason) {
      clearTimeout(timer);
      timer = undefined;
      return reader.cancel(reason);
    },
  });
}

export function validSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

export type StorageSignerRequest = {
  bucket: 'ccc-audio';
  objectKey: string;
  action: 'upload' | 'agent_read' | 'delete' | 'head' | 'absence';
  principal: 'client' | 'agent' | 'scheduler';
  objectSha256: string | null;
  context:
    | { kind: 'upload'; audioObjectId: string }
    | { kind: 'claim'; jobId: string; claimToken: string; attempt: number }
    | { kind: 'deletion'; audioObjectId: string; generationId: string; deletionAttemptId: string };
};

export type StorageSignerDecision = {
  allowed: true;
  requestSha256: string;
  generationId: string;
  authorizedAt: string;
  authorizationExpiresAt: string;
  expiresAt: string | null;
};

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

function boundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= maxBytes;
}

function canonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

const STORAGE_SIGNER_ACTIONS = ['upload', 'agent_read', 'delete', 'head', 'absence'] as const;
const STORAGE_SIGNER_PRINCIPALS = ['client', 'agent', 'scheduler'] as const;

export function decodeStorageSignerRequest(value: unknown): StorageSignerRequest {
  if (!exactRecord(value, ['bucket', 'objectKey', 'action', 'principal', 'objectSha256', 'context'])) {
    throw new TypeError('invalid StorageSigner request');
  }
  const action = STORAGE_SIGNER_ACTIONS.find((candidate) => candidate === value.action);
  const principal = STORAGE_SIGNER_PRINCIPALS.find((candidate) => candidate === value.principal);
  if (
    value.bucket !== 'ccc-audio'
    || typeof value.objectKey !== 'string'
    || !validKey(value.objectKey)
    || action === undefined
    || principal === undefined
    || !(value.objectSha256 === null
      || typeof value.objectSha256 === 'string' && validSha256(value.objectSha256))
    // `absence` is deletion evidence the scheduler alone can ask for (S8 §2.3).
    || (action === 'absence' && principal !== 'scheduler')
  ) throw new TypeError('invalid StorageSigner request');

  const base = {
    bucket: 'ccc-audio',
    objectKey: value.objectKey,
    action,
    principal,
    objectSha256: value.objectSha256,
  } as const;
  const context = value.context;
  if (
    exactRecord(context, ['kind', 'audioObjectId'])
    && context.kind === 'upload'
    && action !== 'absence'
    && boundedString(context.audioObjectId, 256)
  ) return { ...base, context: { kind: context.kind, audioObjectId: context.audioObjectId } };
  if (
    exactRecord(context, ['kind', 'jobId', 'claimToken', 'attempt'])
    && context.kind === 'claim'
    && action !== 'absence'
    && boundedString(context.jobId, 256)
    && boundedString(context.claimToken, 512)
    && typeof context.attempt === 'number'
    && Number.isInteger(context.attempt)
    && context.attempt >= 1
    && context.attempt <= 3
  ) {
    return {
      ...base,
      context: {
        kind: context.kind,
        jobId: context.jobId,
        claimToken: context.claimToken,
        attempt: context.attempt,
      },
    };
  }
  if (
    exactRecord(context, ['kind', 'audioObjectId', 'generationId', 'deletionAttemptId'])
    && context.kind === 'deletion'
    && boundedString(context.audioObjectId, 256)
    && boundedString(context.generationId, 256)
    && boundedString(context.deletionAttemptId, 256)
  ) {
    return {
      ...base,
      context: {
        kind: context.kind,
        audioObjectId: context.audioObjectId,
        generationId: context.generationId,
        deletionAttemptId: context.deletionAttemptId,
      },
    };
  }
  throw new TypeError('invalid StorageSigner request');
}

export function decodeStorageSignerDecision(value: unknown): StorageSignerDecision {
  if (
    !exactRecord(value, [
      'allowed', 'requestSha256', 'generationId', 'authorizedAt',
      'authorizationExpiresAt', 'expiresAt',
    ])
    || value.allowed !== true
    || typeof value.requestSha256 !== 'string'
    || !validSha256(value.requestSha256)
    || !boundedString(value.generationId, 256)
    || !canonicalInstant(value.authorizedAt)
    || !canonicalInstant(value.authorizationExpiresAt)
    || Date.parse(value.authorizationExpiresAt) < Date.parse(value.authorizedAt)
    || Date.parse(value.authorizationExpiresAt) - Date.parse(value.authorizedAt) > 5_000
    || !(value.expiresAt === null || canonicalInstant(value.expiresAt))
    || (value.expiresAt !== null && Date.parse(value.expiresAt) <= Date.parse(value.authorizedAt))
  ) throw new TypeError('invalid StorageSigner decision');
  return {
    allowed: value.allowed,
    requestSha256: value.requestSha256,
    generationId: value.generationId,
    authorizedAt: value.authorizedAt,
    authorizationExpiresAt: value.authorizationExpiresAt,
    expiresAt: value.expiresAt,
  };
}
