import type {
  AudioContentType,
  AudioDeletionEvidence,
  AudioDownload,
  AudioObjectMetadata,
  AudioStore,
} from '@ccc/contracts/runtime';
import { AUDIO_CONTENT_TYPES } from '@ccc/contracts/runtime';
import { AudioStoreError, MAX_AUDIO_BYTES, Sha256, checkedBody, hashKey, validKey, validMetadata, validSha256 } from '@ccc/contracts/audio';

const CONTENT_LENGTH = 'ccc-content-length';
const EXPIRES_AT = 'ccc-expires-at';
const SHA256 = 'ccc-sha256';


/**
 * R2 는 길이를 아는 본문만 받는다(요청·응답 본문 또는 FixedLengthStream 의 읽기 쪽).
 * checkedBody 가 만든 스트림은 길이 정보가 없으므로 workerd 에서는 FixedLengthStream 을
 * 통과시켜 선언 길이를 되살린다. 이 전역이 없는 실행기(Node 하네스)에서는 스트림을 그대로
 * 넘겨 소비자 backpressure 를 유지한다.
 */
function knownLengthBody(
  stream: ReadableStream<Uint8Array>,
  contentLength: number,
): ReadableStream<Uint8Array> {
  if (typeof FixedLengthStream === 'undefined') return stream;
  const fixed = new FixedLengthStream(contentLength);
  void stream.pipeTo(fixed.writable).catch(() => undefined);
  return fixed.readable as ReadableStream<Uint8Array>;
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
      const stream = knownLengthBody(
        checkedBody(body, metadata.contentLength, hash, metadata.expiresAt),
        metadata.contentLength,
      );
      let stored: R2Object;
      try {
        stored = await bucket.put(key, stream, {
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
      if (Date.now() > Date.parse(metadata.expiresAt) + 60_000) {
        await bucket.delete(key).catch(() => undefined);
        throw new AudioStoreError();
      }
      return { sha256: hash.digestHex(), generationId: stored.etag };
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
        generationId: object.etag,
        sha256: sha256 !== null && validSha256(sha256) ? sha256 : null,
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

