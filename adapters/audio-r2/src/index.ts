import type {
  AudioContentType,
  AudioDeletionEvidence,
  AudioDownload,
  AudioObjectMetadata,
  AudioStore,
} from '@ccc/contracts/runtime';
import { AUDIO_CONTENT_TYPES } from '@ccc/contracts/runtime';

const MAX_AUDIO_BYTES = 200 * 1024 * 1024;
const AUDIO_KEY = /^audio\/([A-Za-z0-9_-]+)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
const CONTENT_LENGTH = 'ccc-content-length';
const EXPIRES_AT = 'ccc-expires-at';
const SHA256 = 'ccc-sha256';

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

class Sha256 {
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

function hashKey(key: string): string {
  const hash = new Sha256();
  hash.update(new TextEncoder().encode(key));
  return hash.digestHex();
}

function validKey(key: string): boolean {
  return AUDIO_KEY.test(key);
}

function validMetadata(metadata: AudioObjectMetadata): boolean {
  return Number.isInteger(metadata.contentLength)
    && metadata.contentLength >= 1
    && metadata.contentLength <= MAX_AUDIO_BYTES
    && Object.prototype.hasOwnProperty.call(AUDIO_CONTENT_TYPES, metadata.contentType)
    && metadata.expiresAt.length > 0
    && metadata.expiresAt.endsWith('Z')
    && Number.isFinite(Date.parse(metadata.expiresAt));
}

function checkedBody(
  source: ReadableStream<Uint8Array>,
  expectedLength: number,
  hash: Sha256,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let length = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          if (length !== expectedLength) throw new AudioStoreError();
          controller.close();
          return;
        }
        if (!(next.value instanceof Uint8Array)) throw new AudioStoreError();
        length += next.value.byteLength;
        if (length > expectedLength || length > MAX_AUDIO_BYTES) throw new AudioStoreError();
        hash.update(next.value);
        controller.enqueue(next.value);
      } catch (error) {
        await reader.cancel().catch(() => undefined);
        controller.error(error instanceof AudioStoreError ? error : new AudioStoreError());
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function providerError(): AudioStoreError {
  return new AudioStoreError();
}

function metadataFromObject(object: R2ObjectBody): AudioObjectMetadata | null {
  const contentType = object.httpMetadata?.contentType;
  const custom = object.customMetadata ?? {};
  const contentLength = Number(custom[CONTENT_LENGTH] ?? object.size);
  const expiresAt = custom[EXPIRES_AT];
  if (!Object.prototype.hasOwnProperty.call(AUDIO_CONTENT_TYPES, contentType ?? '')
    || !Number.isInteger(contentLength)
    || contentLength < 1
    || contentLength > MAX_AUDIO_BYTES
    || expiresAt === undefined
    || !expiresAt.endsWith('Z')
    || !Number.isFinite(Date.parse(expiresAt))) return null;
  return {
    contentLength,
    contentType: contentType as AudioContentType,
    expiresAt,
  };
}

function evidenceBase(key: string, attempt: string, requestedAt: string, generationId: string | null): AudioDeletionEvidence {
  return {
    keyHash: hashKey(key),
    generationId,
    objectSha256: null,
    deletionAttemptId: attempt,
    deletionRequestedAt: requestedAt,
    providerDeleteAcceptedAt: null,
    deletedAt: null,
    deleteSucceeded: false,
    absentFromList: false,
    absentFromMetadata: false,
    directReadAbsent: false,
    verificationMethod: 'r2-head-absent',
    verifiedAt: requestedAt,
  };
}

export function createR2AudioStore(bucket: R2Bucket): AudioStore {
  return {
    async put(key, body, metadata) {
      if (!validKey(key) || !validMetadata(metadata)) throw new AudioStoreError();
      const hash = new Sha256();
      const stream = checkedBody(body, metadata.contentLength, hash);
      try {
        await bucket.put(key, stream, {
          httpMetadata: { contentType: metadata.contentType },
          customMetadata: {
            [CONTENT_LENGTH]: String(metadata.contentLength),
            [EXPIRES_AT]: metadata.expiresAt,
          },
        });
      } catch {
        await bucket.delete(key).catch(() => undefined);
        throw providerError();
      }
      return { sha256: hash.digestHex() };
    },

    async get(key) {
      if (!validKey(key)) return null;
      let object: R2ObjectBody | null;
      try {
        object = await bucket.get(key);
      } catch {
        throw providerError();
      }
      if (object === null) return null;
      const metadata = metadataFromObject(object);
      if (metadata === null) return null;
      const sha256 = object.customMetadata?.[SHA256] ?? null;
      return {
        ...metadata,
        body: object.body as ReadableStream<Uint8Array>,
        sha256: sha256 !== null && /^[0-9a-f]{64}$/.test(sha256) ? sha256 : null,
      } satisfies AudioDownload;
    },

    async delete(key) {
      if (!validKey(key)) throw new AudioStoreError();
      const requestedAt = new Date().toISOString();
      const attempt = crypto.randomUUID();
      let generationId: string | null = null;
      const evidence = evidenceBase(key, attempt, requestedAt, generationId);
      try {
        const before = await bucket.head(key);
        generationId = before?.etag ?? null;
        evidence.generationId = generationId;
      } catch {
        // A failed pre-delete head is represented by null generation evidence.
      }

      try {
        await bucket.delete(key);
        evidence.deleteSucceeded = true;
        evidence.providerDeleteAcceptedAt = new Date().toISOString();
        evidence.deletedAt = evidence.providerDeleteAcceptedAt;
      } catch {
        evidence.verifiedAt = new Date().toISOString();
        return evidence;
      }

      try {
        const listed = await bucket.list({ prefix: key });
        evidence.absentFromList = !listed.objects.some((object) => object.key === key);
      } catch {
        evidence.absentFromList = false;
      }
      try {
        evidence.absentFromMetadata = (await bucket.head(key)) === null;
      } catch {
        evidence.absentFromMetadata = false;
      }
      try {
        evidence.directReadAbsent = (await bucket.get(key)) === null;
      } catch {
        evidence.directReadAbsent = false;
      }
      evidence.verifiedAt = new Date().toISOString();
      return evidence;
    },

    async createUploadTarget() {
      return null;
    },

    async createDownloadTarget() {
      return null;
    },
  };
}

export { MAX_AUDIO_BYTES };
